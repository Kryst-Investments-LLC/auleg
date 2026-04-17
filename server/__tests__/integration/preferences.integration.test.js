/**
 * Integration tests — Preferences (/api/preferences)
 *
 * Tests auto-creation of defaults, PATCH persistence, and validation.
 */
const request = require('supertest');
const app = require('../../index');
const prisma = require('../../lib/prisma');

const TEST_EMAIL = `integ-prefs-${Date.now()}@test.dev`;
const TEST_PASSWORD = 'SecurePass123!';
let authToken;
let userId;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });

  await request(app)
    .post('/api/auth/register')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

  const cookies = loginRes.headers['set-cookie'];
  authToken = cookies.find(c => c.startsWith('auleg_session=')).match(/auleg_session=([^;]+)/)[1];
  userId = loginRes.body.user.id;
});

afterAll(async () => {
  if (userId) {
    await prisma.userPreference.deleteMany({ where: { userId } });
    await prisma.activityLog.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('GET /api/preferences', () => {
  test('auto-creates default preferences on first access', async () => {
    // Ensure no preferences exist before test
    await prisma.userPreference.deleteMany({ where: { userId } });

    const res = await request(app)
      .get('/api/preferences')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
    expect(res.body.emailDigest).toBe('none');
    expect(res.body.notifyAuditComplete).toBe(true);
    expect(res.body.notifyAuditFailed).toBe(true);
    expect(res.body.notifyShare).toBe(true);
    expect(res.body.theme).toBe('dark');

    // Verify persisted
    const dbPref = await prisma.userPreference.findUnique({ where: { userId } });
    expect(dbPref).not.toBeNull();
    expect(dbPref.emailDigest).toBe('none');
  });

  test('returns existing preferences on subsequent access', async () => {
    const res = await request(app)
      .get('/api/preferences')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    // Should return same data without creating duplicates
    const count = await prisma.userPreference.count({ where: { userId } });
    expect(count).toBe(1);
  });
});

describe('PATCH /api/preferences', () => {
  test('updates preferences and persists', async () => {
    const res = await request(app)
      .patch('/api/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        emailDigest: 'weekly',
        notifyAuditComplete: false,
        theme: 'light'
      });

    expect(res.status).toBe(200);
    expect(res.body.emailDigest).toBe('weekly');
    expect(res.body.notifyAuditComplete).toBe(false);
    expect(res.body.theme).toBe('light');

    // Verify in DB
    const dbPref = await prisma.userPreference.findUnique({ where: { userId } });
    expect(dbPref.emailDigest).toBe('weekly');
    expect(dbPref.notifyAuditComplete).toBe(false);
    expect(dbPref.theme).toBe('light');
    // Unchanged fields should keep defaults
    expect(dbPref.notifyShare).toBe(true);
  });

  test('partial update only changes specified fields', async () => {
    const res = await request(app)
      .patch('/api/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ notifyShare: false });

    expect(res.status).toBe(200);
    expect(res.body.notifyShare).toBe(false);
    // Previously set values are retained
    expect(res.body.emailDigest).toBe('weekly');
    expect(res.body.theme).toBe('light');
  });

  test('rejects invalid emailDigest value', async () => {
    const res = await request(app)
      .patch('/api/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ emailDigest: 'hourly' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/emailDigest/i);
  });

  test('rejects invalid theme value', async () => {
    const res = await request(app)
      .patch('/api/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ theme: 'pink' });

    expect(res.status).toBe(400);
  });

  test('rejects empty update body', async () => {
    const res = await request(app)
      .patch('/api/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no valid fields/i);
  });
});
