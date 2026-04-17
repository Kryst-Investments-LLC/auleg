/**
 * Integration tests — Templates CRUD (/api/templates)
 *
 * Full flow: register user → create templates → list → get → update → delete.
 * Verifies data persists correctly in PostgreSQL after each mutation.
 */
const request = require('supertest');
const app = require('../../index');
const prisma = require('../../lib/prisma');

const TEST_EMAIL = `integ-tpl-${Date.now()}@test.dev`;
const TEST_PASSWORD = 'SecurePass123!';
let authToken;
let userId;
let templateId;

beforeAll(async () => {
  // Clean up and create test user
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });

  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD, name: 'Template Tester' });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

  const cookies = loginRes.headers['set-cookie'];
  authToken = cookies.find(c => c.startsWith('auleg_session=')).match(/auleg_session=([^;]+)/)[1];
  userId = loginRes.body.user.id;
});

afterAll(async () => {
  // Cascade cleanup
  if (userId) {
    await prisma.auditTemplate.deleteMany({ where: { userId } });
    await prisma.activityLog.deleteMany({ where: { userId } });
    await prisma.userPreference.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('POST /api/templates', () => {
  test('creates a template and persists to DB', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'GDPR Standard',
        description: 'Standard GDPR DPA audit template',
        clauseTypes: ['breach_notification', 'data_deletion', 'audit_rights'],
        frameworks: ['GDPR', 'SOC2']
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('GDPR Standard');
    expect(res.body.clauseTypes).toEqual(['breach_notification', 'data_deletion', 'audit_rights']);
    expect(res.body.frameworks).toEqual(['GDPR', 'SOC2']);

    templateId = res.body.id;

    // Verify in DB
    const dbTemplate = await prisma.auditTemplate.findUnique({ where: { id: templateId } });
    expect(dbTemplate).not.toBeNull();
    expect(dbTemplate.name).toBe('GDPR Standard');
    expect(dbTemplate.clauseTypes).toBe('breach_notification,data_deletion,audit_rights');
    expect(dbTemplate.frameworks).toBe('GDPR,SOC2');
    expect(dbTemplate.userId).toBe(userId);
  });

  test('rejects template without required fields', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Incomplete' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('rejects unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/templates')
      .send({ name: 'No Auth', clauseTypes: ['x'], frameworks: ['y'] });

    // Without Authorization header, CSRF middleware may reject before auth (403)
    expect([401, 403]).toContain(res.status);
  });
});

describe('GET /api/templates', () => {
  test('lists templates for authenticated user', async () => {
    const res = await request(app)
      .get('/api/templates')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.templates).toBeInstanceOf(Array);
    expect(res.body.templates.length).toBeGreaterThanOrEqual(1);

    const found = res.body.templates.find(t => t.id === templateId);
    expect(found).toBeDefined();
    expect(found.name).toBe('GDPR Standard');
  });
});

describe('GET /api/templates/:id', () => {
  test('returns template by ID', async () => {
    const res = await request(app)
      .get(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(templateId);
    expect(res.body.name).toBe('GDPR Standard');
    expect(res.body.description).toBe('Standard GDPR DPA audit template');
  });

  test('returns 404 for non-existent template', async () => {
    const res = await request(app)
      .get('/api/templates/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/templates/:id', () => {
  test('updates template and persists changes', async () => {
    const res = await request(app)
      .put(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'GDPR Enhanced',
        description: 'Updated description',
        clauseTypes: ['breach_notification', 'data_deletion', 'audit_rights', 'subprocessor'],
        frameworks: ['GDPR', 'SOC2', 'CCPA']
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('GDPR Enhanced');
    expect(res.body.clauseTypes).toContain('subprocessor');
    expect(res.body.frameworks).toContain('CCPA');

    // Verify persistence
    const dbTemplate = await prisma.auditTemplate.findUnique({ where: { id: templateId } });
    expect(dbTemplate.name).toBe('GDPR Enhanced');
    expect(dbTemplate.clauseTypes).toContain('subprocessor');
  });

  test('returns 404 when updating non-existent template', async () => {
    const res = await request(app)
      .put('/api/templates/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/templates/:id', () => {
  test('deletes template and removes from DB', async () => {
    const res = await request(app)
      .delete(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(204);

    // Verify removal from DB
    const dbTemplate = await prisma.auditTemplate.findUnique({ where: { id: templateId } });
    expect(dbTemplate).toBeNull();
  });

  test('returns 404 when deleting already-deleted template', async () => {
    const res = await request(app)
      .delete(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });
});
