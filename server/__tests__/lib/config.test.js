/**
 * Tests for environment config validation, focused on the production-only
 * Redis requirement. Uses collectErrors() (the pure helper) so we never trip
 * validateEnv()'s process.exit in production mode.
 */

const { collectErrors } = require('../../lib/config');

describe('config.collectErrors — Redis requirement', () => {
  const saved = {};
  const keys = ['NODE_ENV', 'REDIS_URL', 'JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];

  beforeEach(() => {
    keys.forEach(k => { saved[k] = process.env[k]; });
    // A valid baseline so only the variable under test drives the result.
    process.env.JWT_SECRET = 'a-real-secret';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    keys.forEach(k => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  test('requires REDIS_URL in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;
    const errors = collectErrors();
    expect(errors.some(e => /REDIS_URL is required in production/.test(e))).toBe(true);
  });

  test('passes in production when REDIS_URL is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const errors = collectErrors();
    expect(errors.some(e => /REDIS_URL/.test(e))).toBe(false);
  });

  test('does not require REDIS_URL outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.REDIS_URL;
    const errors = collectErrors();
    expect(errors.some(e => /REDIS_URL/.test(e))).toBe(false);
  });
});
