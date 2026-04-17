/**
 * Unit tests for server/middleware/rbac.js and server/middleware/scope.js
 * Tests role-based access control and API key scope enforcement.
 */

describe('RBAC middleware', () => {
  let rbac;

  beforeAll(() => {
    rbac = require('../../middleware/rbac');
  });

  describe('requireRole()', () => {
    test('allows user with matching role', () => {
      const middleware = rbac.requireRole('admin');
      const req = { user: { id: 'u1', role: 'admin' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('allows when role matches any in list', () => {
      const middleware = rbac.requireRole('admin', 'auditor');
      const req = { user: { id: 'u1', role: 'auditor' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('rejects user with wrong role', () => {
      const middleware = rbac.requireRole('admin');
      const req = { user: { id: 'u1', role: 'viewer' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when no user on request', () => {
      const middleware = rbac.requireRole('admin');
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    });

    test('rejects null user', () => {
      const middleware = rbac.requireRole('admin');
      const req = { user: null };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});

describe('Scope middleware', () => {
  let scope;

  beforeAll(() => {
    scope = require('../../middleware/scope');
  });

  describe('requireScope()', () => {
    test('bypasses scope check for JWT users (no apiKey)', () => {
      const middleware = scope.requireScope('write');
      const req = { user: { id: 'u1' } }; // no req.apiKey
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('allows API key with matching scope', () => {
      const middleware = scope.requireScope('read');
      const req = {
        user: { id: 'u1' },
        apiKey: { id: 'ak1', scopes: ['read', 'write'] }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('allows when all required scopes are present', () => {
      const middleware = scope.requireScope('read', 'write');
      const req = {
        user: { id: 'u1' },
        apiKey: { id: 'ak1', scopes: ['read', 'write', 'admin'] }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('rejects when scope is missing', () => {
      const middleware = scope.requireScope('write');
      const req = {
        user: { id: 'u1' },
        apiKey: { id: 'ak1', scopes: ['read'] }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Insufficient API key scope',
          required: ['write'],
          granted: ['read']
        })
      );
    });

    test('rejects when one of multiple scopes is missing', () => {
      const middleware = scope.requireScope('read', 'admin');
      const req = {
        user: { id: 'u1' },
        apiKey: { id: 'ak1', scopes: ['read'] }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('rejects with empty scopes array', () => {
      const middleware = scope.requireScope('read');
      const req = {
        user: { id: 'u1' },
        apiKey: { id: 'ak1', scopes: [] }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
