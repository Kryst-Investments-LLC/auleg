/**
 * Unit tests for server/lib/plans.js and server/lib/config.js
 */

describe('Plans module', () => {
  let plans;

  beforeAll(() => {
    plans = require('../../lib/plans');
  });

  describe('PLANS', () => {
    test('contains all 5 plan tiers', () => {
      expect(Object.keys(plans.PLANS)).toEqual(
        expect.arrayContaining(['free', 'starter', 'pro', 'business', 'enterprise'])
      );
    });

    test('free plan has expected limits', () => {
      const free = plans.PLANS.free;
      expect(free.price).toBe(0);
      expect(free.auditsPerMonth).toBe(3);
      expect(free.maxUsers).toBe(1);
      expect(free.features).toContain('basic_audit');
    });

    test('enterprise plan has unlimited resources (-1)', () => {
      const ent = plans.PLANS.enterprise;
      expect(ent.auditsPerMonth).toBe(-1);
      expect(ent.maxUsers).toBe(-1);
      expect(ent.storageMb).toBe(-1);
      expect(ent.apiCallsPerMonth).toBe(-1);
    });

    test('plans have increasing prices', () => {
      const { free, starter, pro, business, enterprise } = plans.PLANS;
      expect(free.price).toBeLessThan(starter.price);
      expect(starter.price).toBeLessThan(pro.price);
      expect(pro.price).toBeLessThan(business.price);
      expect(business.price).toBeLessThan(enterprise.price);
    });

    test('enterprise plan includes SSO feature', () => {
      expect(plans.PLANS.enterprise.features).toContain('sso');
    });

    test('free plan does not include webhooks', () => {
      expect(plans.PLANS.free.features).not.toContain('webhooks');
    });

    test('all plans have required properties', () => {
      for (const [key, plan] of Object.entries(plans.PLANS)) {
        expect(plan).toHaveProperty('name');
        expect(plan).toHaveProperty('price');
        expect(plan).toHaveProperty('auditsPerMonth');
        expect(plan).toHaveProperty('maxUsers');
        expect(plan).toHaveProperty('storageMb');
        expect(plan).toHaveProperty('features');
        expect(plan).toHaveProperty('description');
        expect(Array.isArray(plan.features)).toBe(true);
      }
    });
  });

  describe('getPlan()', () => {
    test('returns correct plan by name', () => {
      expect(plans.getPlan('pro').name).toBe('Pro');
      expect(plans.getPlan('free').name).toBe('Free');
    });

    test('returns free plan for unknown name', () => {
      expect(plans.getPlan('nonexistent').name).toBe('Free');
    });

    test('returns free plan for null', () => {
      expect(plans.getPlan(null).name).toBe('Free');
    });

    test('returns free plan for undefined', () => {
      expect(plans.getPlan(undefined).name).toBe('Free');
    });

    test('returns free plan for empty string', () => {
      expect(plans.getPlan('').name).toBe('Free');
    });
  });
});

describe('Config module', () => {
  let config;
  let originalEnv;

  beforeAll(() => {
    config = require('../../lib/config');
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateEnv()', () => {
    test('returns valid when JWT_SECRET is set', () => {
      process.env.JWT_SECRET = 'my-secure-secret';
      const result = config.validateEnv();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('returns error when JWT_SECRET is missing', () => {
      delete process.env.JWT_SECRET;
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const result = config.validateEnv();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('JWT_SECRET'))).toBe(true);
      consoleSpy.mockRestore();
    });

    test('returns error when JWT_SECRET is empty', () => {
      process.env.JWT_SECRET = '   ';
      const result = config.validateEnv();
      expect(result.valid).toBe(false);
    });

    test('sets default PORT when not set', () => {
      delete process.env.PORT;
      process.env.JWT_SECRET = 'test';
      config.validateEnv();
      expect(process.env.PORT).toBe('4000');
    });

    test('sets default CORS_ORIGIN when not set', () => {
      delete process.env.CORS_ORIGIN;
      process.env.JWT_SECRET = 'test';
      config.validateEnv();
      expect(process.env.CORS_ORIGIN).toBe('http://localhost:3000');
    });

    test('does not override existing PORT', () => {
      process.env.PORT = '8080';
      process.env.JWT_SECRET = 'test';
      config.validateEnv();
      expect(process.env.PORT).toBe('8080');
    });

    test('warns about insecure JWT_SECRET in development', () => {
      process.env.JWT_SECRET = 'change-this-to-a-secure-random-string-in-production';
      process.env.NODE_ENV = 'development';
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = config.validateEnv();
      expect(result.valid).toBe(true); // not an error in dev
      consoleSpy.mockRestore();
    });

    test('errors on insecure JWT_SECRET in production', () => {
      process.env.JWT_SECRET = 'change-this-to-a-secure-random-string-in-production';
      process.env.NODE_ENV = 'production';
      // Prevent process.exit
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const result = config.validateEnv();
      expect(result.valid).toBe(false);
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
