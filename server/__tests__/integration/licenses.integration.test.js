/**
 * Integration test — License Pagination with Summary Counts
 *
 * Seeds 100 license records (50 blocked, 50 approved).
 * Verifies that GET /api/licenses?limit=10 returns only 10 items
 * but the summary object still reports all 50 blocked and 50 approved.
 */
const request = require('supertest');
const app = require('../../index');
const prisma = require('../../lib/prisma');

const TEST_EMAIL = `integ-lic-${Date.now()}@test.dev`;
const TEST_PASSWORD = 'SecurePass123!';
const TOTAL_RECORDS = 100;
const BLOCKED_COUNT = 50;
const APPROVED_COUNT = 50;
const PAGE_LIMIT = 10;

let authToken;
let userId;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });

  await request(app)
    .post('/api/auth/register')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD, name: 'License Tester' });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

  const cookies = loginRes.headers['set-cookie'];
  authToken = cookies.find(c => c.startsWith('auleg_session=')).match(/auleg_session=([^;]+)/)[1];
  userId = loginRes.body.user.id;

  // Seed 100 license records: 50 blocked, 50 approved
  const records = [];
  for (let i = 0; i < TOTAL_RECORDS; i++) {
    records.push({
      userId,
      packageName: `pkg-${String(i).padStart(3, '0')}`,
      version: '1.0.0',
      spdxId: i < BLOCKED_COUNT ? 'GPL-3.0-only' : 'MIT',
      status: i < BLOCKED_COUNT ? 'blocked' : 'approved',
      source: 'npm',
    });
  }
  await prisma.license.createMany({ data: records });
});

afterAll(async () => {
  if (userId) {
    await prisma.license.deleteMany({ where: { userId } });
    await prisma.activityLog.deleteMany({ where: { userId } });
    await prisma.userPreference.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('License Pagination + Summary', () => {
  test('returns paginated results with correct summary counts', async () => {
    const res = await request(app)
      .get(`/api/licenses?limit=${PAGE_LIMIT}`)
      .set('Cookie', `auleg_session=${authToken}`);

    expect(res.status).toBe(200);

    // Pagination: only 10 items returned
    expect(res.body.licenses).toHaveLength(PAGE_LIMIT);

    // Pagination metadata
    expect(res.body.pagination.limit).toBe(PAGE_LIMIT);
    expect(res.body.pagination.total).toBe(TOTAL_RECORDS);
    expect(res.body.pagination.pages).toBe(TOTAL_RECORDS / PAGE_LIMIT);

    // Summary counts reflect ALL records regardless of page
    expect(res.body.summary.blocked).toBe(BLOCKED_COUNT);
    expect(res.body.summary.approved).toBe(APPROVED_COUNT);
    expect(res.body.summary.review).toBe(0);
  });

  test('status filter narrows results but summary stays global', async () => {
    const res = await request(app)
      .get(`/api/licenses?status=blocked&limit=${PAGE_LIMIT}`)
      .set('Cookie', `auleg_session=${authToken}`);

    expect(res.status).toBe(200);

    // Every returned license must be blocked
    res.body.licenses.forEach(lic => expect(lic.status).toBe('blocked'));

    // Total for this filter is 50
    expect(res.body.pagination.total).toBe(BLOCKED_COUNT);

    // Summary is still global — shows all statuses
    expect(res.body.summary.blocked).toBe(BLOCKED_COUNT);
    expect(res.body.summary.approved).toBe(APPROVED_COUNT);
  });

  test('page 2 returns different items than page 1', async () => {
    const [page1, page2] = await Promise.all([
      request(app)
        .get(`/api/licenses?page=1&limit=${PAGE_LIMIT}`)
        .set('Cookie', `auleg_session=${authToken}`),
      request(app)
        .get(`/api/licenses?page=2&limit=${PAGE_LIMIT}`)
        .set('Cookie', `auleg_session=${authToken}`),
    ]);

    expect(page1.body.licenses).toHaveLength(PAGE_LIMIT);
    expect(page2.body.licenses).toHaveLength(PAGE_LIMIT);

    const ids1 = page1.body.licenses.map(l => l.id);
    const ids2 = page2.body.licenses.map(l => l.id);

    // No overlap between pages
    const overlap = ids1.filter(id => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  test('summary counts are consistent across all pages', async () => {
    const pages = [1, 5, 10];
    for (const page of pages) {
      const res = await request(app)
        .get(`/api/licenses?page=${page}&limit=${PAGE_LIMIT}`)
        .set('Cookie', `auleg_session=${authToken}`);

      expect(res.body.summary.blocked).toBe(BLOCKED_COUNT);
      expect(res.body.summary.approved).toBe(APPROVED_COUNT);
    }
  });

  test('creating a new license updates summary', async () => {
    const createRes = await request(app)
      .post('/api/licenses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ packageName: 'new-pkg', spdxId: 'Apache-2.0', status: 'review' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('review');

    const res = await request(app)
      .get(`/api/licenses?limit=${PAGE_LIMIT}`)
      .set('Cookie', `auleg_session=${authToken}`);

    expect(res.body.summary.review).toBe(1);
    expect(res.body.summary.blocked).toBe(BLOCKED_COUNT);
    expect(res.body.summary.approved).toBe(APPROVED_COUNT);
    expect(res.body.pagination.total).toBe(TOTAL_RECORDS + 1);
  });
});
