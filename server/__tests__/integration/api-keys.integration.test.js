/**
 * Integration tests — API Keys CRUD (/api/api-keys)
 *
 * Full flow: create → list → delete.
 * Verifies hashing, prefix storage, and cascade deletion in PostgreSQL.
 */
const request = require('supertest');
const crypto = require('crypto');
const app = require('../../index');
const prisma = require('../../lib/prisma');

const TEST_EMAIL = `integ-apikey-${Date.now()}@test.dev`;
const TEST_PASSWORD = 'SecurePass123!';
let authToken;
let userId;
let createdKeyId;
let createdRawKey;

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
    await prisma.apiKey.deleteMany({ where: { userId } });
    await prisma.activityLog.deleteMany({ where: { userId } });
    await prisma.userPreference.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('POST /api/api-keys', () => {
  test('creates an API key and returns full key only once', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'CI Pipeline Key',
        scopes: ['audits:read', 'audits:write'],
        expiresInDays: 30
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.key).toBeDefined();
    expect(res.body.key).toMatch(/^auleg_/);
    expect(res.body.name).toBe('CI Pipeline Key');
    expect(res.body.prefix).toBe(res.body.key.slice(0, 14));
    expect(res.body.scopes).toEqual(['audits:read', 'audits:write']);
    expect(res.body.expiresAt).toBeDefined();

    createdKeyId = res.body.id;
    createdRawKey = res.body.key;

    // Verify in DB — key is stored as SHA-256 hash, NOT plaintext
    const dbKey = await prisma.apiKey.findUnique({ where: { id: createdKeyId } });
    expect(dbKey).not.toBeNull();
    expect(dbKey.keyHash).not.toBe(createdRawKey);
    const expectedHash = crypto.createHash('sha256').update(createdRawKey).digest('hex');
    expect(dbKey.keyHash).toBe(expectedHash);
    expect(dbKey.prefix).toBe(createdRawKey.slice(0, 14));
    expect(dbKey.userId).toBe(userId);
  });

  test('rejects invalid scopes', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Bad Scopes', scopes: ['admin:nuke'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid scopes/i);
  });

  test('rejects missing name', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  test('defaults to audits:read scope when none specified', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Default Scope Key' });

    expect(res.status).toBe(201);
    expect(res.body.scopes).toEqual(['audits:read']);

    // Clean up this extra key
    await prisma.apiKey.delete({ where: { id: res.body.id } });
  });
});

describe('GET /api/api-keys', () => {
  test('lists keys without exposing full key', async () => {
    const res = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.keys).toBeInstanceOf(Array);
    expect(res.body.keys.length).toBeGreaterThanOrEqual(1);

    const found = res.body.keys.find(k => k.id === createdKeyId);
    expect(found).toBeDefined();
    expect(found.name).toBe('CI Pipeline Key');
    expect(found.prefix).toMatch(/^auleg_/);
    // Full key must NOT appear in list responses
    expect(found.key).toBeUndefined();
    expect(found.keyHash).toBeUndefined();
  });
});

describe('API key authentication', () => {
  test('can authenticate with the created API key', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${createdRawKey}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);
  });
});

describe('DELETE /api/api-keys/:id', () => {
  test('revokes an API key', async () => {
    const res = await request(app)
      .delete(`/api/api-keys/${createdKeyId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(204);

    // Verify removal from DB
    const dbKey = await prisma.apiKey.findUnique({ where: { id: createdKeyId } });
    expect(dbKey).toBeNull();
  });

  test('revoked key can no longer authenticate', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${createdRawKey}`);

    expect(res.status).toBe(401);
  });

  test('returns 404 for already-deleted key', async () => {
    const res = await request(app)
      .delete(`/api/api-keys/${createdKeyId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });
});
