/**
 * Unit tests for server/lib/access.js
 * Tests access control helpers: scoping, audit access, error factories.
 */

jest.mock('../../lib/prisma', () => ({
  audit: {
    findFirst: jest.fn()
  },
  template: {
    findFirst: jest.fn()
  }
}));

describe('Access control module', () => {
  let access;
  let prisma;

  beforeAll(() => {
    access = require('../../lib/access');
    prisma = require('../../lib/prisma');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Error Factories ───
  describe('notFound()', () => {
    test('returns error with 404 status and default message', () => {
      const err = access.notFound();
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Not found');
      expect(err.status).toBe(404);
    });

    test('accepts custom message', () => {
      const err = access.notFound('Audit not found');
      expect(err.message).toBe('Audit not found');
      expect(err.status).toBe(404);
    });
  });

  describe('forbidden()', () => {
    test('returns error with 403 status and default message', () => {
      const err = access.forbidden();
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Forbidden');
      expect(err.status).toBe(403);
    });

    test('accepts custom message', () => {
      const err = access.forbidden('Access denied');
      expect(err.message).toBe('Access denied');
      expect(err.status).toBe(403);
    });
  });

  // ─── buildUserOrgScope ───
  describe('buildUserOrgScope()', () => {
    test('builds scope for user with org', () => {
      const user = { id: 'u1', orgId: 'o1' };
      const scope = access.buildUserOrgScope(user);
      expect(scope.OR).toEqual([
        { userId: 'u1' },
        { orgId: 'o1' }
      ]);
    });

    test('builds scope for user without org', () => {
      const user = { id: 'u1', orgId: null };
      const scope = access.buildUserOrgScope(user);
      expect(scope.userId).toBe('u1');
      expect(scope.OR).toBeUndefined();
    });

    test('merges with existing where clause', () => {
      const user = { id: 'u1', orgId: 'o1' };
      const scope = access.buildUserOrgScope(user, { active: true });
      expect(scope.active).toBe(true);
      expect(scope.OR).toBeDefined();
    });

    test('handles user with undefined orgId', () => {
      const user = { id: 'u1' };
      const scope = access.buildUserOrgScope(user);
      expect(scope.userId).toBe('u1');
    });
  });

  // ─── getAccessibleAudit ───
  describe('getAccessibleAudit()', () => {
    test('happy path: finds audit accessible by user', async () => {
      const mockAudit = { id: 'a1', userId: 'u1', contractName: 'Test' };
      prisma.audit.findFirst.mockResolvedValue(mockAudit);

      const result = await access.getAccessibleAudit({ id: 'u1', orgId: null }, 'a1');
      expect(result).toEqual(mockAudit);
      expect(prisma.audit.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'a1' })
      });
    });

    test('returns null when audit not found', async () => {
      prisma.audit.findFirst.mockResolvedValue(null);
      const result = await access.getAccessibleAudit({ id: 'u1', orgId: null }, 'nonexistent');
      expect(result).toBeNull();
    });

    test('includes org scope for org users', async () => {
      prisma.audit.findFirst.mockResolvedValue(null);
      await access.getAccessibleAudit({ id: 'u1', orgId: 'o1' }, 'a1');
      const call = prisma.audit.findFirst.mock.calls[0][0];
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          { userId: 'u1' },
          { orgId: 'o1' }
        ])
      );
    });
  });

  // ─── requireAccessibleAudit ───
  describe('requireAccessibleAudit()', () => {
    test('happy path: returns audit when found', async () => {
      const mockAudit = { id: 'a1', userId: 'u1' };
      prisma.audit.findFirst.mockResolvedValue(mockAudit);

      const result = await access.requireAccessibleAudit({ id: 'u1', orgId: null }, 'a1');
      expect(result).toEqual(mockAudit);
    });

    test('throws 404 when audit not found', async () => {
      prisma.audit.findFirst.mockResolvedValue(null);
      await expect(
        access.requireAccessibleAudit({ id: 'u1', orgId: null }, 'missing')
      ).rejects.toThrow('Audit not found');
    });

    test('thrown error has status 404', async () => {
      prisma.audit.findFirst.mockResolvedValue(null);
      try {
        await access.requireAccessibleAudit({ id: 'u1' }, 'missing');
      } catch (err) {
        expect(err.status).toBe(404);
      }
    });
  });

  // ─── canAccessUserOrgRecord ───
  describe('canAccessUserOrgRecord()', () => {
    test('returns true when user owns the record', () => {
      expect(access.canAccessUserOrgRecord(
        { id: 'u1', orgId: null },
        { userId: 'u1', orgId: null }
      )).toBe(true);
    });

    test('returns true when record belongs to same org', () => {
      expect(access.canAccessUserOrgRecord(
        { id: 'u1', orgId: 'o1' },
        { userId: 'u2', orgId: 'o1' }
      )).toBe(true);
    });

    test('returns false for different user without org', () => {
      expect(access.canAccessUserOrgRecord(
        { id: 'u1', orgId: null },
        { userId: 'u2', orgId: null }
      )).toBe(false);
    });

    test('returns false for different org', () => {
      expect(access.canAccessUserOrgRecord(
        { id: 'u1', orgId: 'o1' },
        { userId: 'u2', orgId: 'o2' }
      )).toBe(false);
    });

    test('returns false for null record', () => {
      expect(access.canAccessUserOrgRecord({ id: 'u1' }, null)).toBe(false);
    });

    test('returns false for undefined record', () => {
      expect(access.canAccessUserOrgRecord({ id: 'u1' }, undefined)).toBe(false);
    });
  });
});
