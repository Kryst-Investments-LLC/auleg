/**
 * Unit tests for server/lib/session.js
 * Tests cookie parsing, session token management.
 */

const {
  getSessionCookieOptions,
  getSessionTokenFromRequest,
  AUTH_COOKIE_NAME
} = require('../../lib/session');

describe('Session module', () => {
  describe('getSessionCookieOptions', () => {
    test('returns httpOnly and sameSite options', () => {
      const opts = getSessionCookieOptions();
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/');
    });

    test('secure is false in non-production', () => {
      const opts = getSessionCookieOptions();
      expect(opts.secure).toBe(false); // NODE_ENV = test
    });

    test('maxAge is defined', () => {
      const opts = getSessionCookieOptions();
      expect(opts.maxAge).toBeGreaterThan(0);
    });
  });

  describe('getSessionTokenFromRequest', () => {
    test('extracts session token from cookie header', () => {
      const req = { headers: { cookie: `${AUTH_COOKIE_NAME}=jwt-token-here` } };
      expect(getSessionTokenFromRequest(req)).toBe('jwt-token-here');
    });

    test('returns null when no cookie header', () => {
      const req = { headers: {} };
      expect(getSessionTokenFromRequest(req)).toBeNull();
    });

    test('returns null when session cookie missing', () => {
      const req = { headers: { cookie: 'other=value' } };
      expect(getSessionTokenFromRequest(req)).toBeNull();
    });

    test('handles multiple cookies correctly', () => {
      const req = { headers: { cookie: `foo=bar; ${AUTH_COOKIE_NAME}=my-token; baz=qux` } };
      expect(getSessionTokenFromRequest(req)).toBe('my-token');
    });
  });

  describe('AUTH_COOKIE_NAME', () => {
    test('is a non-empty string', () => {
      expect(typeof AUTH_COOKIE_NAME).toBe('string');
      expect(AUTH_COOKIE_NAME.length).toBeGreaterThan(0);
    });
  });
});
