/**
 * CSRF protection via double-submit cookie pattern.
 *
 * - On every response, sets an `auleg_csrf` cookie with a random token (readable by JS).
 * - On every state-changing request (POST/PUT/PATCH/DELETE), validates that
 *   the `X-CSRF-Token` header matches the cookie value.
 * - API-key authenticated requests and webhook callbacks bypass CSRF.
 */
const crypto = require('crypto');

const CSRF_COOKIE = 'auleg_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Paths that are exempt from CSRF (auth, health, webhook callbacks, public portal submissions)
const EXEMPT_PATHS = ['/api/auth/', '/api/health', '/api/billing/webhook', '/api/workflow/counterparty/portal/'];

function csrfProtection(req, res, next) {
  // Requests with explicit Authorization header bypass CSRF
  // (they don't rely on ambient cookie credentials, so CSRF is not a risk)
  if (req.headers.authorization) {
    return next();
  }

  // Set CSRF cookie on every response if not present
  const cookies = parseCookies(req.headers.cookie || '');
  let csrfToken = cookies[CSRF_COOKIE];
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false, // must be readable by JS
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });
  }

  // Safe methods don't need validation
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Exempt certain paths
  if (EXEMPT_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Validate CSRF token
  const headerToken = req.headers[CSRF_HEADER];
  if (!headerToken || headerToken !== csrfToken) {
    return res.status(403).json({ error: 'CSRF token missing or invalid' });
  }

  next();
}

function parseCookies(header) {
  return header
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return cookies;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (key) cookies[key] = decodeURIComponent(val);
      return cookies;
    }, {});
}

module.exports = csrfProtection;
