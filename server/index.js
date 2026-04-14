const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { validateEnv } = require('./lib/config');
const requestLogger = require('./middleware/request-logger');
const { sanitizeBody } = require('./middleware/validate');
const logger = require('./lib/logger');
const { register: metricsRegistry, metricsMiddleware } = require('./lib/metrics');

// Validate configuration before starting
const configResult = validateEnv();

const authRoutes = require('./routes/auth');
const auditRoutes = require('./routes/audits');
const healthRoutes = require('./routes/health');
const adminRoutes = require('./routes/admin');
const orgRoutes = require('./routes/orgs');
const exportRoutes = require('./routes/export');
const webhookRoutes = require('./routes/webhooks');
const templateRoutes = require('./routes/templates');
const notificationRoutes = require('./routes/notifications');
const apiKeyRoutes = require('./routes/api-keys');
const analyticsRoutes = require('./routes/analytics');
const shareRoutes = require('./routes/shares');
const scheduleRoutes = require('./routes/schedules');
const scoringRuleRoutes = require('./routes/scoring-rules');
const commentRoutes = require('./routes/comments');
const preferenceRoutes = require('./routes/preferences');
const billingRoutes = require('./routes/billing');
const aiRoutes = require('./routes/ai');
const publicApiV1 = require('./routes/public-api-v1');
const legalRoutes = require('./routes/legal');
const coreAdvancedRoutes = require('./routes/core-advanced');
const workflowRoutes = require('./routes/workflow');
const reportingRoutes = require('./routes/reporting');
const integrationsRoutes = require('./routes/integrations');
const ssoRoutes = require('./routes/sso');
const auditLogRoutes = require('./routes/audit-logs');
const tosRoutes = require('./routes/terms');
const dataResidencyRoutes = require('./routes/data-residency');

const app = express();
const PORT = process.env.PORT || 4000;
const jsonParser = express.json({ limit: '10mb' });

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],  // swagger-ui needs inline scripts
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:']
    }
  },
  crossOriginEmbedderPolicy: false  // allow swagger-ui assets
}));
// CORS — guard against wildcard with credentials
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
if (corsOrigin === '*') {
  console.error('FATAL: CORS_ORIGIN="*" is not allowed with credentials. Set a specific origin.');
  if (process.env.NODE_ENV !== 'development') process.exit(1);
}
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(compression());
app.use((req, res, next) => {
  if (req.path === '/api/billing/webhook') {
    return next();
  }

  return jsonParser(req, res, next);
});

// Request ID + logging
app.use(requestLogger);

// Prometheus metrics collection
app.use(metricsMiddleware);

// Input sanitization (for JSON bodies)
app.use(sanitizeBody);

// CSRF protection via double-submit cookie pattern
const csrfProtection = require('./middleware/csrf');
app.use(csrfProtection);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // Modern browsers; CSP is preferred
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Rate limiting
const apiRateLimitMax = Number.parseInt(process.env.API_RATE_LIMIT_MAX || '200', 10);
const authRateLimitMax = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || '20', 10);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.isFinite(apiRateLimitMax) ? apiRateLimitMax : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.isFinite(authRateLimitMax) ? authRateLimitMax : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' }
});
app.use('/api/', apiLimiter);
app.use('/api/auth', authLimiter);

// Swagger — disabled in production
if (process.env.NODE_ENV !== 'production') {
  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Auleg API',
        version: '1.0.0',
        description: 'REST API for the Auleg platform — www.auleg.com'
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
        }
      }
    },
    apis: [path.join(__dirname, 'routes', '*.js')]
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/audits', auditRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/orgs', orgRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/scoring-rules', scoringRuleRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/preferences', preferenceRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/legal', legalRoutes);
app.use('/api/core', coreAdvancedRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/reporting', reportingRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/sso', ssoRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/terms', tosRoutes);
app.use('/api/data-residency', dataResidencyRoutes);
app.use('/api/v1', publicApiV1);

// Prometheus metrics endpoint (internal, not rate-limited)
app.get('/metrics', async (req, res) => {
  // Optionally restrict to internal IPs or require auth
  const metricsToken = process.env.METRICS_TOKEN;
  if (metricsToken && req.headers.authorization !== `Bearer ${metricsToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.set('Content-Type', metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Structured error handler
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV === 'development';

  // Log full error server-side
  logger.error({
    reqId: req.id,
    method: req.method,
    path: req.originalUrl,
    status,
    message: err.message,
    stack: isDev ? err.stack : undefined
  }, 'request error');

  // Don't leak internal details outside development
  res.status(status).json({
    error: status >= 500 && !isDev ? 'Internal server error' : err.message || 'Internal server error',
    ...(req.id ? { requestId: req.id } : {})
  });
});

// Start server
const server = app.listen(PORT, async () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV }, 'Auleg API running');
  logger.info({ url: `http://localhost:${PORT}/api/docs` }, 'API docs');

  // Auto-seed the legal knowledge base
  try {
    const { seedLegalDatabase } = require('./lib/legal-knowledge');
    const result = await seedLegalDatabase();
    logger.info(result, 'Legal KB seeded');
  } catch (err) {
    logger.error({ err: err.message }, 'Legal KB seed error');
  }
});

// Graceful shutdown
function gracefulShutdown(signal) {
  logger.info({ signal }, 'Starting graceful shutdown');

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      // Shutdown BullMQ workers
      const { shutdownWorker } = require('./lib/audit-worker');
      await shutdownWorker();
      const { shutdownEmailQueue } = require('./lib/email');
      await shutdownEmailQueue();
      logger.info('Job queues shut down');
    } catch (err) {
      logger.error({ err: err.message }, 'Error shutting down queues');
    }

    try {
      const prisma = require('./lib/prisma');
      await prisma.$disconnect();
      logger.info('Database disconnected');
    } catch (err) {
      logger.error({ err: err.message }, 'Error disconnecting database');
    }

    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason: String(reason) }, 'unhandledRejection');
});

process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({ type: 'uncaughtException', message: err.message, stack: err.stack }));
  gracefulShutdown('uncaughtException');
});
