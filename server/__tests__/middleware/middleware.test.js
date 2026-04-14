/**
 * Unit tests for middleware: CSRF, RBAC, validation.
 */

describe('CSRF middleware', () => {
  let csrfMiddleware;

  beforeAll(() => {
    csrfMiddleware = require('../../middleware/csrf');
  });

  function createReq(method, path, headers = {}) {
    return {
      method,
      path,
      headers,
      cookies: headers.cookie ? undefined : {}
    };
  }

  function createRes() {
    const res = {
      statusCode: 200,
      headers: {},
      cookie(name, value, opts) { this.cookies = this.cookies || {}; this.cookies[name] = value; },
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    return res;
  }

  test('GET requests pass through without CSRF check', (done) => {
    const req = createReq('GET', '/api/health');
    const res = createRes();
    csrfMiddleware(req, res, () => {
      done();
    });
  });

  test('billing webhook path is exempted', (done) => {
    const req = createReq('POST', '/api/billing/webhook');
    const res = createRes();
    csrfMiddleware(req, res, () => {
      done();
    });
  });
});

describe('RBAC middleware', () => {
  const { requireRole } = require('../../middleware/rbac');

  function createReq(role) {
    return { user: { id: '1', email: 'test@test.com', role } };
  }

  function createRes() {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    return res;
  }

  test('allows matching role', (done) => {
    const middleware = requireRole('admin');
    const req = createReq('admin');
    const res = createRes();
    middleware(req, res, () => done());
  });

  test('rejects non-matching role', () => {
    const middleware = requireRole('admin');
    const req = createReq('auditor');
    const res = createRes();
    middleware(req, res, () => {
      throw new Error('should not reach next');
    });
    expect(res.statusCode).toBe(403);
  });
});
