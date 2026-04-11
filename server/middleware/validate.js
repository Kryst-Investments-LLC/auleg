/**
 * Input validation & sanitization middleware factory.
 * Strips dangerous patterns, enforces size limits.
 */

// Sanitize a string: trim, strip null bytes, limit length
function sanitizeString(val, maxLen = 1000) {
  if (typeof val !== 'string') return val;
  return val.trim().replace(/\0/g, '').substring(0, maxLen);
}

// Deep sanitize object values
function sanitizeObject(obj, maxDepth = 5) {
  if (maxDepth <= 0 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.slice(0, 500).map(item => sanitizeObject(item, maxDepth - 1));
  if (typeof obj === 'object') {
    const cleaned = {};
    const keys = Object.keys(obj).slice(0, 100); // limit key count
    for (const key of keys) {
      cleaned[sanitizeString(key, 200)] = sanitizeObject(obj[key], maxDepth - 1);
    }
    return cleaned;
  }
  return obj;
}

// Middleware: sanitize req.body
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body = sanitizeObject(req.body);
  }
  next();
}

// Middleware factory: validate required fields
function requireFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter(f => !req.body || req.body[f] === undefined || req.body[f] === null || req.body[f] === '');
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }
    next();
  };
}

// Middleware: validate email format
function validateEmail(req, res, next) {
  const { email } = req.body || {};
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  next();
}

// Middleware: validate pagination params
function validatePagination(req, res, next) {
  if (req.query.page) {
    const page = parseInt(req.query.page);
    if (isNaN(page) || page < 1) return res.status(400).json({ error: 'Invalid page parameter' });
    req.query.page = page;
  }
  if (req.query.limit) {
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    if (isNaN(limit) || limit < 1) return res.status(400).json({ error: 'Invalid limit parameter' });
    req.query.limit = limit;
  }
  next();
}

module.exports = { sanitizeBody, sanitizeString, sanitizeObject, requireFields, validateEmail, validatePagination };
