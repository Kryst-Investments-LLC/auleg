/**
 * Unit tests for server/lib/billing.js
 * Tests billing account management, quota checks, and usage tracking.
 */

jest.mock('../../lib/prisma', () => ({
  user: { findUnique: jest.fn() },
  audit: { count: jest.fn() },
  billingAccount: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  }
}));

jest.mock('../../lib/plans', () => ({
  getPlan: jest.fn((name) => {
    const plans = {
      free: { name: 'Free', auditsPerMonth: 3, maxUsers: 1, storageMb: 50, apiCallsPerMonth: 0, features: ['basic_audit'] },
      pro: { name: 'Pro', auditsPerMonth: 100, maxUsers: 15, storageMb: 2000, apiCallsPerMonth: 5000, features: ['basic_audit', 'webhooks'] },
      enterprise: { name: 'Enterprise', auditsPerMonth: -1, maxUsers: -1, storageMb: -1, apiCallsPerMonth: -1, features: ['basic_audit', 'sso', 'sla'] }
    };
    return plans[name] || plans.free;
  })
}));

describe('Billing module', () => {
  let billing;
  let prisma;

  beforeAll(() => {
    billing = require('../../lib/billing');
    prisma = require('../../lib/prisma');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── getBillingAccount ───
  describe('getBillingAccount()', () => {
    test('returns null for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await billing.getBillingAccount('nonexistent');
      expect(result).toBeNull();
    });

    test('returns virtual free account for solo user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: null, org: null });
      prisma.audit.count.mockResolvedValue(2);

      const result = await billing.getBillingAccount('u1');
      expect(result.virtual).toBe(true);
      expect(result.plan).toBe('free');
      expect(result.auditsUsed).toBe(2);
      expect(result.auditsLimit).toBe(3);
      expect(result.userId).toBe('u1');
    });

    test('returns existing billing account for org user', async () => {
      const mockBilling = {
        id: 'b1', orgId: 'o1', plan: 'pro',
        auditsUsed: 10, auditsLimit: 100,
        currentPeriodEnd: new Date(Date.now() + 86400000) // future
      };
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: 'o1', org: { plan: 'pro' } });
      prisma.billingAccount.findUnique.mockResolvedValue(mockBilling);

      const result = await billing.getBillingAccount('u1');
      expect(result.plan).toBe('pro');
      expect(result.orgId).toBe('o1');
    });

    test('creates billing account when none exists for org', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: 'o1', org: { plan: 'pro' } });
      prisma.billingAccount.findUnique.mockResolvedValue(null);
      prisma.billingAccount.create.mockResolvedValue({
        id: 'b-new', orgId: 'o1', plan: 'pro', auditsLimit: 100
      });

      const result = await billing.getBillingAccount('u1');
      expect(prisma.billingAccount.create).toHaveBeenCalled();
      expect(result.plan).toBe('pro');
    });

    test('resets counters when period has rolled over', async () => {
      const expiredBilling = {
        id: 'b1', orgId: 'o1', plan: 'pro',
        auditsUsed: 50,
        currentPeriodEnd: new Date(Date.now() - 86400000) // past
      };
      const refreshedBilling = { ...expiredBilling, auditsUsed: 0, apiCallsUsed: 0 };

      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: 'o1', org: { plan: 'pro' } });
      prisma.billingAccount.findUnique.mockResolvedValue(expiredBilling);
      prisma.billingAccount.update.mockResolvedValue(refreshedBilling);

      const result = await billing.getBillingAccount('u1');
      expect(prisma.billingAccount.update).toHaveBeenCalled();
      expect(result.auditsUsed).toBe(0);
    });
  });

  // ─── checkLimit ───
  describe('checkLimit()', () => {
    test('allows audit within quota', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: null, org: null });
      prisma.audit.count.mockResolvedValue(1);

      const result = await billing.checkLimit('u1', 'audits');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.limit).toBe(3);
    });

    test('denies audit when quota exceeded', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: null, org: null });
      prisma.audit.count.mockResolvedValue(3);

      const result = await billing.checkLimit('u1', 'audits');
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(3);
      expect(result.limit).toBe(3);
    });

    test('always allows when limit is -1 (unlimited)', async () => {
      const entBilling = {
        id: 'b1', orgId: 'o1', plan: 'enterprise',
        auditsUsed: 999, auditsLimit: -1,
        apiCallsUsed: 50000, apiCallsLimit: -1,
        currentPeriodEnd: new Date(Date.now() + 86400000)
      };
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: 'o1', org: { plan: 'enterprise' } });
      prisma.billingAccount.findUnique.mockResolvedValue(entBilling);

      const result = await billing.checkLimit('u1', 'audits');
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
    });

    test('returns allowed for unknown resource type', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: null, org: null });
      prisma.audit.count.mockResolvedValue(0);

      const result = await billing.checkLimit('u1', 'widgets');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── incrementUsage ───
  describe('incrementUsage()', () => {
    test('increments audit count for org user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: 'o1' });
      prisma.billingAccount.findUnique.mockResolvedValue({ id: 'b1', orgId: 'o1' });
      prisma.billingAccount.update.mockResolvedValue({});

      await billing.incrementUsage('u1', 'audits');
      expect(prisma.billingAccount.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { auditsUsed: { increment: 1 } }
      });
    });

    test('increments with custom amount', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: 'o1' });
      prisma.billingAccount.findUnique.mockResolvedValue({ id: 'b1', orgId: 'o1' });
      prisma.billingAccount.update.mockResolvedValue({});

      await billing.incrementUsage('u1', 'storage', 50);
      expect(prisma.billingAccount.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { storageUsedMb: { increment: 50 } }
      });
    });

    test('no-op for solo user (no orgId)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: null });

      await billing.incrementUsage('u1', 'audits');
      expect(prisma.billingAccount.update).not.toHaveBeenCalled();
    });

    test('no-op for unknown resource', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: 'o1' });
      prisma.billingAccount.findUnique.mockResolvedValue({ id: 'b1', orgId: 'o1' });

      await billing.incrementUsage('u1', 'unknown_resource');
      expect(prisma.billingAccount.update).not.toHaveBeenCalled();
    });
  });

  // ─── requireQuota middleware ───
  describe('requireQuota()', () => {
    test('calls next() when within quota', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: null, org: null });
      prisma.audit.count.mockResolvedValue(0);

      const middleware = billing.requireQuota('audits');
      const req = { user: { id: 'u1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('returns 402 when quota exceeded', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: null, org: null });
      prisma.audit.count.mockResolvedValue(5);

      const middleware = billing.requireQuota('audits');
      const req = { user: { id: 'u1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(402);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ─── requireFeature middleware ───
  describe('requireFeature()', () => {
    test('calls next() when feature is available', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: null, org: null });
      prisma.audit.count.mockResolvedValue(0);

      const middleware = billing.requireFeature('basic_audit');
      const req = { user: { id: 'u1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('returns 403 when feature not available', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', orgId: null, org: null });
      prisma.audit.count.mockResolvedValue(0);

      const middleware = billing.requireFeature('sso');
      const req = { user: { id: 'u1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'sso' })
      );
    });
  });
});
