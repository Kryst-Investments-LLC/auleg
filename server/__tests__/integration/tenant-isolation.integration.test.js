/**
 * Integration tests — cross-tenant data isolation.
 *
 * Encodes the multi-tenant access-control contract: user B must never be able to
 * read, mutate, delete, or comment on user A's resources. Guards against IDOR /
 * broken-object-level-authorization regressions in route handlers.
 *
 * Requires a live Postgres (integration config) — runs in CI.
 */
const request = require('supertest');
const app = require('../../index');
const prisma = require('../../lib/prisma');

const A_EMAIL = `iso-a-${Date.now()}@test.dev`;
const B_EMAIL = `iso-b-${Date.now()}@test.dev`;
const PW = 'SecurePass123!';

let cookieA;
let cookieB;
let userA;
let auditId;

function sessionCookie(loginRes) {
  const setCookie = loginRes.headers['set-cookie'] || [];
  const session = setCookie.find(c => c.startsWith('auleg_session='));
  return session ? session.split(';')[0] : '';
}

async function registerAndLogin(email) {
  await prisma.user.deleteMany({ where: { email } });
  await request(app).post('/api/auth/register').send({ email, password: PW });
  const res = await request(app).post('/api/auth/login').send({ email, password: PW });
  return { cookie: sessionCookie(res), id: res.body.user.id };
}

beforeAll(async () => {
  const a = await registerAndLogin(A_EMAIL);
  const b = await registerAndLogin(B_EMAIL);
  cookieA = a.cookie;
  cookieB = b.cookie;
  userA = a.id;

  // Seed an audit owned by tenant A.
  const audit = await prisma.audit.create({
    data: {
      contractName: 'Tenant A confidential DPA',
      contractPath: '/tmp/none.txt',
      status: 'complete',
      userId: userA
    }
  });
  auditId = audit.id;
});

afterAll(async () => {
  await prisma.auditComment.deleteMany({ where: { auditId } }).catch(() => {});
  await prisma.audit.deleteMany({ where: { userId: userA } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { in: [A_EMAIL, B_EMAIL] } } }).catch(() => {});
});

describe('cross-tenant isolation — audits', () => {
  test('owner (A) can read their own audit', async () => {
    const res = await request(app).get(`/api/audits/${auditId}`).set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body.contractName).toBe('Tenant A confidential DPA');
  });

  test("B cannot read A's audit (404)", async () => {
    const res = await request(app).get(`/api/audits/${auditId}`).set('Cookie', cookieB);
    expect(res.status).toBe(404);
    expect(res.body.contractName).toBeUndefined();
  });

  test("B's audit list does not include A's audit", async () => {
    const res = await request(app).get('/api/audits').set('Cookie', cookieB);
    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.audits || res.body.data || [];
    expect(items.some(a => a.id === auditId)).toBe(false);
  });

  test("B cannot comment on A's audit (403)", async () => {
    const res = await request(app)
      .post(`/api/comments/${auditId}`)
      .set('Cookie', cookieB)
      .send({ body: 'I should not be able to post this' });
    expect([403, 404]).toContain(res.status);
  });

  test("B cannot delete A's audit, and it survives", async () => {
    const del = await request(app).delete(`/api/audits/${auditId}`).set('Cookie', cookieB);
    expect([403, 404]).toContain(del.status);

    // A can still read it — the delete attempt did not take effect.
    const still = await request(app).get(`/api/audits/${auditId}`).set('Cookie', cookieA);
    expect(still.status).toBe(200);
  });
});
