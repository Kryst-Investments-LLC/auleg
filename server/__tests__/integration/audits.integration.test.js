/**
 * Integration tests — Audits CRUD (/api/audits)
 *
 * Tests file upload → DB persistence → listing → retrieval → deletion.
 * Uses a real .txt file uploaded via multipart/form-data.
 */
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../../index');
const prisma = require('../../lib/prisma');

const TEST_EMAIL = `integ-audit-${Date.now()}@test.dev`;
const TEST_PASSWORD = 'SecurePass123!';
let authToken;
let userId;
let auditId;

// Create a small test contract file
const TMP_CONTRACT = path.join(__dirname, 'test-contract.txt');

beforeAll(async () => {
  fs.writeFileSync(TMP_CONTRACT,
    'This Data Processing Agreement ensures breach notification within 72 hours.\n' +
    'The processor shall delete all personal data upon termination.\n' +
    'The controller retains the right to audit the processor annually.\n'
  );

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
  // Clean up test contract file
  if (fs.existsSync(TMP_CONTRACT)) fs.unlinkSync(TMP_CONTRACT);

  if (userId) {
    // Delete audits and related data
    const audits = await prisma.audit.findMany({ where: { userId }, select: { id: true, contractPath: true } });
    for (const a of audits) {
      await prisma.auditComment.deleteMany({ where: { auditId: a.id } });
      await prisma.auditShare.deleteMany({ where: { auditId: a.id } });
      // Clean up uploaded files
      if (a.contractPath && fs.existsSync(a.contractPath)) {
        fs.unlinkSync(a.contractPath);
      }
    }
    await prisma.audit.deleteMany({ where: { userId } });
    await prisma.activityLog.deleteMany({ where: { userId } });
    await prisma.userPreference.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('POST /api/audits', () => {
  test('uploads a contract and creates an audit in DB', async () => {
    const res = await request(app)
      .post('/api/audits')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('contract', TMP_CONTRACT);

    expect(res.status).toBe(202);
    expect(res.body.id).toBeDefined();
    expect(res.body.contractName).toBe('test-contract.txt');
    expect(res.body.status).toBe('processing');

    auditId = res.body.id;

    // Verify audit record in DB
    const dbAudit = await prisma.audit.findUnique({ where: { id: auditId } });
    expect(dbAudit).not.toBeNull();
    expect(dbAudit.contractName).toBe('test-contract.txt');
    // Audit may complete synchronously in in-memory worker mode
    expect(['processing', 'complete']).toContain(dbAudit.status);
    expect(dbAudit.userId).toBe(userId);
    // Uploaded file should exist on disk
    expect(fs.existsSync(dbAudit.contractPath)).toBe(true);
  });

  test('rejects request without file', async () => {
    const res = await request(app)
      .post('/api/audits')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no contract file/i);
  });

  test('rejects unauthenticated upload', async () => {
    try {
      const res = await request(app)
        .post('/api/audits')
        .attach('contract', TMP_CONTRACT);

      // May get 401 (auth middleware) or 403 (CSRF) depending on how the request is processed
      expect([401, 403]).toContain(res.status);
    } catch (err) {
      // Multipart uploads without auth may cause ECONNRESET — the server
      // closes the connection before the stream finishes, which is valid behavior
      expect(err.code || err.message).toMatch(/ECONNRESET|socket hang up/i);
    }
  });
});

describe('GET /api/audits', () => {
  test('lists audits for authenticated user', async () => {
    const res = await request(app)
      .get('/api/audits')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.audits).toBeInstanceOf(Array);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBeDefined();

    const found = res.body.audits.find(a => a.id === auditId);
    expect(found).toBeDefined();
    expect(found.contractName).toBe('test-contract.txt');
  });

  test('supports pagination', async () => {
    const res = await request(app)
      .get('/api/audits?page=1&limit=1')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.audits.length).toBeLessThanOrEqual(1);
    expect(res.body.limit).toBe(1);
  });

  test('supports status filter', async () => {
    const res = await request(app)
      .get('/api/audits?status=processing')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    // All returned audits should have status=processing
    for (const audit of res.body.audits) {
      expect(audit.status).toBe('processing');
    }
  });
});

describe('GET /api/audits/:id', () => {
  test('returns full audit details', async () => {
    const res = await request(app)
      .get(`/api/audits/${auditId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(auditId);
    expect(res.body.contractName).toBe('test-contract.txt');
    expect(res.body.userId).toBe(userId);
  });

  test('returns 404 for non-existent audit', async () => {
    const res = await request(app)
      .get('/api/audits/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get(`/api/audits/${auditId}`);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/audits/:id', () => {
  test('deletes audit and removes from DB', async () => {
    // Get contract path before deletion
    const dbAudit = await prisma.audit.findUnique({ where: { id: auditId } });
    const contractPath = dbAudit.contractPath;

    const res = await request(app)
      .delete(`/api/audits/${auditId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(204);

    // Verify removal from DB
    const deleted = await prisma.audit.findUnique({ where: { id: auditId } });
    expect(deleted).toBeNull();

    // Verify uploaded file was cleaned up
    expect(fs.existsSync(contractPath)).toBe(false);
  });

  test('returns 404 for already-deleted audit', async () => {
    const res = await request(app)
      .delete(`/api/audits/${auditId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/audits/queue', () => {
  test('returns queue status', async () => {
    const res = await request(app)
      .get('/api/audits/queue')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    // Queue status shape depends on whether BullMQ or in-memory queue is active
    expect(res.body).toBeDefined();
  });
});
