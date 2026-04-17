/**
 * Unit tests for server/middleware/auth.js
 * Tests JWT auth, API key auth, session auth, and error cases.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

jest.mock('../../lib/prisma', () => ({
  user: { findUnique: jest.fn() },
  apiKey: {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({})
  }
}));

jest.mock('../../lib/session', () => ({
  getSessionTokenFromRequest: jest.fn()
}));

describe('Auth middleware', () => {
  let authMiddleware;
  let prisma;
  let session;

  const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests';

  beforeAll(() => {
    authMiddleware = require('../../middleware/auth');
    prisma = require('../../lib/prisma');
    session = require('../../lib/session');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function mockRes() {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    return res;
  }

  // ─── JWT Auth ───
  describe('JWT authentication', () => {
    test('happy path: authenticates valid JWT', async () => {
      const token = jwt.sign({ id: 'u1' }, JWT_SECRET);
      const user = { id: 'u1', email: 'test@test.com', name: 'Test', role: 'admin', orgId: null };

      session.getSessionTokenFromRequest.mockReturnValue(null);
      prisma.user.findUnique.mockResolvedValue(user);

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(user);
    });

    test('rejects expired JWT', async () => {
      const token = jwt.sign({ id: 'u1' }, JWT_SECRET, { expiresIn: '-1s' });
      session.getSessionTokenFromRequest.mockReturnValue(null);

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects JWT with wrong secret', async () => {
      const token = jwt.sign({ id: 'u1' }, 'wrong-secret');
      session.getSessionTokenFromRequest.mockReturnValue(null);

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('rejects JWT when user not found in DB', async () => {
      const token = jwt.sign({ id: 'deleted-user' }, JWT_SECRET);
      session.getSessionTokenFromRequest.mockReturnValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
    });
  });

  // ─── API Key Auth ───
  describe('API key authentication', () => {
    test('happy path: authenticates valid API key', async () => {
      const rawKey = 'auleg_testkey123456';
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const user = { id: 'u2', email: 'api@test.com', name: 'API User', role: 'auditor', orgId: 'o1' };

      session.getSessionTokenFromRequest.mockReturnValue(null);
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'ak1', userId: 'u2', keyHash, scopes: 'read,write', expiresAt: null
      });
      prisma.user.findUnique.mockResolvedValue(user);

      const req = { headers: { authorization: `Bearer ${rawKey}` } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(user);
      expect(req.apiKey.scopes).toEqual(['read', 'write']);
    });

    test('rejects unknown API key', async () => {
      const rawKey = 'auleg_unknownkey';
      session.getSessionTokenFromRequest.mockReturnValue(null);
      prisma.apiKey.findUnique.mockResolvedValue(null);

      const req = { headers: { authorization: `Bearer ${rawKey}` } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
    });

    test('rejects expired API key', async () => {
      const rawKey = 'auleg_expiredkey';
      session.getSessionTokenFromRequest.mockReturnValue(null);
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'ak2', userId: 'u2', scopes: 'read',
        expiresAt: new Date(Date.now() - 86400000) // expired yesterday
      });

      const req = { headers: { authorization: `Bearer ${rawKey}` } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'API key has expired' });
    });

    test('rejects API key when user not found', async () => {
      const rawKey = 'auleg_orphanedkey';
      session.getSessionTokenFromRequest.mockReturnValue(null);
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'ak3', userId: 'gone', scopes: 'read', expiresAt: null
      });
      prisma.user.findUnique.mockResolvedValue(null);

      const req = { headers: { authorization: `Bearer ${rawKey}` } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'API key user not found' });
    });

    test('updates lastUsed on API key auth', async () => {
      const rawKey = 'auleg_trackedkey';
      session.getSessionTokenFromRequest.mockReturnValue(null);
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'ak4', userId: 'u3', scopes: 'read', expiresAt: null
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u3', email: 't@t.com', name: 'T', role: 'viewer', orgId: null });

      const req = { headers: { authorization: `Bearer ${rawKey}` } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ak4' } })
      );
    });
  });

  // ─── No Auth ───
  describe('missing authentication', () => {
    test('returns 401 when no token provided', async () => {
      session.getSessionTokenFromRequest.mockReturnValue(null);

      const req = { headers: {} };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    });

    test('rejects invalid authorization format', async () => {
      session.getSessionTokenFromRequest.mockReturnValue(null);

      const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('rejects raw API key without Bearer prefix treated as JWT', async () => {
      session.getSessionTokenFromRequest.mockReturnValue('auleg_rawtoken');

      const req = { headers: {} };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // ─── Session Token ───
  describe('session token auth', () => {
    test('uses session token when no Authorization header', async () => {
      const token = jwt.sign({ id: 'u5' }, JWT_SECRET);
      session.getSessionTokenFromRequest.mockReturnValue(token);
      prisma.user.findUnique.mockResolvedValue({ id: 'u5', email: 's@t.com', name: 'S', role: 'admin', orgId: null });

      const req = { headers: {} };
      const res = mockRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user.id).toBe('u5');
    });
  });
});
