/**
 * Unit tests for tenant rate limiting module.
 */

const { PLAN_LIMITS, AUDIT_PLAN_LIMITS } = require('../../middleware/tenant-rate-limit');

describe('Tenant Rate Limiting', () => {
  test('plan limits are defined for all tiers', () => {
    expect(PLAN_LIMITS.free).toBeDefined();
    expect(PLAN_LIMITS.starter).toBeDefined();
    expect(PLAN_LIMITS.pro).toBeDefined();
    expect(PLAN_LIMITS.business).toBeDefined();
    expect(PLAN_LIMITS.enterprise).toBeDefined();
  });

  test('higher plans have higher limits', () => {
    expect(PLAN_LIMITS.starter).toBeGreaterThan(PLAN_LIMITS.free);
    expect(PLAN_LIMITS.pro).toBeGreaterThan(PLAN_LIMITS.starter);
    expect(PLAN_LIMITS.business).toBeGreaterThan(PLAN_LIMITS.pro);
    expect(PLAN_LIMITS.enterprise).toBeGreaterThan(PLAN_LIMITS.business);
  });

  test('audit limits scale with plan tier', () => {
    expect(AUDIT_PLAN_LIMITS.enterprise).toBeGreaterThan(AUDIT_PLAN_LIMITS.free);
    expect(AUDIT_PLAN_LIMITS.pro).toBeGreaterThan(AUDIT_PLAN_LIMITS.starter);
  });
});
