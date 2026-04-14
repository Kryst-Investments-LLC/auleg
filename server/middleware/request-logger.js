const crypto = require('crypto');
const logger = require('../lib/logger');

/**
 * Assigns a unique request ID and logs request/response with structured logging (pino).
 * Header: X-Request-Id
 */
function requestLogger(req, res, next) {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = reqId;
  req.log = logger.child({ reqId });
  res.setHeader('X-Request-Id', reqId);

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = {
      reqId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 120),
      userId: req.user?.id || null
    };

    // Skip noisy health checks and docs
    if (req.originalUrl === '/api/health' || req.originalUrl.startsWith('/api/docs')) return;

    if (res.statusCode >= 500) {
      req.log.error(log, 'request completed');
    } else if (res.statusCode >= 400) {
      req.log.warn(log, 'request completed');
    } else {
      req.log.info(log, 'request completed');
    }
  });

  next();
}

module.exports = requestLogger;
