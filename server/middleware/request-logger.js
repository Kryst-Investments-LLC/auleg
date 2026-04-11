const crypto = require('crypto');

/**
 * Assigns a unique request ID and logs request/response.
 * Header: X-Request-Id
 */
function requestLogger(req, res, next) {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = {
      reqId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 120),
      userId: req.user?.id || null
    };

    // Skip noisy health checks and docs
    if (req.originalUrl === '/api/health' || req.originalUrl.startsWith('/api/docs')) return;

    if (res.statusCode >= 500) {
      console.error('[REQ]', JSON.stringify(log));
    } else if (res.statusCode >= 400) {
      console.warn('[REQ]', JSON.stringify(log));
    } else {
      console.log('[REQ]', JSON.stringify(log));
    }
  });

  next();
}

module.exports = requestLogger;
