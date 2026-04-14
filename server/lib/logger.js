const pino = require('pino');

const level = process.env.LOG_LEVEL
  || (process.env.NODE_ENV === 'test' ? 'silent'
    : process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const logger = pino({
  level,
  formatters: {
    level(label) {
      return { level: label };
    }
  },
  // Human-readable in dev, structured JSON in production
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino/file', options: { destination: 1 } }
    : undefined,
  base: {
    service: 'auleg-api',
    version: '1.0.0',
    env: process.env.NODE_ENV || 'development'
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token', 'secret'],
    censor: '[REDACTED]'
  }
});

module.exports = logger;
