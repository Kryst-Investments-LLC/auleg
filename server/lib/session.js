const AUTH_COOKIE_NAME = 'auleg_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function parseCookies(header = '') {
  return header
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();

      if (key) {
        cookies[key] = decodeURIComponent(value);
      }

      return cookies;
    }, {});
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS
  };
}

function setSessionCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, getSessionCookieOptions());
}

function clearSessionCookie(res) {
  const { maxAge, ...options } = getSessionCookieOptions();
  res.clearCookie(AUTH_COOKIE_NAME, options);
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[AUTH_COOKIE_NAME] || null;
}

module.exports = {
  AUTH_COOKIE_NAME,
  SESSION_TTL_MS,
  getSessionCookieOptions,
  setSessionCookie,
  clearSessionCookie,
  getSessionTokenFromRequest
};