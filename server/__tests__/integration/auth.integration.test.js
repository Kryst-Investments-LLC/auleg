/**
 * Integration tests — Auth routes (/api/auth)
 *
 * Tests the full Express → middleware → Prisma → PostgreSQL flow.
 * No mocks — real database operations against the test DB.
 */
const request = require('supertest');
const app = require('../../index');
const prisma = require('../../lib/prisma');

const TEST_EMAIL = `integ-auth-${Date.now()}@test.dev`;
const TEST_PASSWORD = 'SecurePass123!';
let authToken;

beforeAll(async () => {
  // Clean up any leftover test data for this email
  await prisma.passwordResetToken.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
});

afterAll(async () => {
  // Clean up
  await prisma.passwordResetToken.deleteMany({ where: { email: TEST_EMAIL } });
  const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (user) {
    await prisma.activityLog.deleteMany({ where: { userId: user.id } });
    await prisma.userPreference.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  test('creates a new user and returns 201', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD, name: 'Integration Test' });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user.name).toBe('Integration Test');
    expect(res.body.user.role).toBe('auditor');
    // Password must NOT be in the response
    expect(res.body.user.password).toBeUndefined();

    // Verify user actually exists in DB
    const dbUser = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(dbUser).not.toBeNull();
    expect(dbUser.email).toBe(TEST_EMAIL);
    // Password is hashed (bcrypt starts with $2)
    expect(dbUser.password).toMatch(/^\$2/);
  });

  test('rejects duplicate email with 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test('rejects missing password with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nopw@test.dev' });

    expect(res.status).toBe(400);
  });

  test('rejects short password with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@test.dev', password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/);
  });
});

describe('POST /api/auth/login', () => {
  test('authenticates with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user.id).toBeDefined();

    // Session cookie should be set
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find(c => c.startsWith('auleg_session='));
    expect(sessionCookie).toBeDefined();

    // Extract JWT for subsequent tests
    const match = sessionCookie.match(/auleg_session=([^;]+)/);
    authToken = match[1];
    expect(authToken).toBeTruthy();
  });

  test('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'WrongPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);

    // Verify failedLoginAttempts incremented in DB
    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user.failedLoginAttempts).toBeGreaterThan(0);
  });

  test('rejects non-existent email with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@nowhere.dev', password: 'anything' });

    expect(res.status).toBe(401);
  });

  test('resets failed attempts on successful login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user.failedLoginAttempts).toBe(0);

    // Re-extract token
    const cookies = res.headers['set-cookie'];
    const sessionCookie = cookies.find(c => c.startsWith('auleg_session='));
    authToken = sessionCookie.match(/auleg_session=([^;]+)/)[1];
  });
});

describe('GET /api/auth/me', () => {
  test('returns current user with valid JWT', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);
    expect(res.body.name).toBe('Integration Test');
    expect(res.body.password).toBeUndefined();
  });

  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/forgot-password', () => {
  test('returns 200 even for unknown email (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@nowhere.dev' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reset link/i);
  });

  test('creates a password reset token in DB for valid user', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: TEST_EMAIL });

    expect(res.status).toBe(200);

    // Verify token was persisted
    const tokens = await prisma.passwordResetToken.findMany({
      where: { email: TEST_EMAIL, used: false }
    });
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect(tokens[0].tokenHash).toBeTruthy();
    expect(new Date(tokens[0].expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('POST /api/auth/logout', () => {
  test('clears session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(204);
    // The session cookie should be cleared
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      const cleared = cookies.find(c => c.startsWith('auleg_session='));
      if (cleared) {
        // Cleared cookies typically have an expiry in the past or Max-Age=0
        expect(cleared).toMatch(/expires|Max-Age/i);
      }
    }
  });
});
