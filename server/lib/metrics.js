const client = require('prom-client');

// Create a registry
const register = new client.Registry();

// Add default metrics (GC, event loop lag, memory, CPU)
client.collectDefaultMetrics({ register, prefix: 'auleg_' });

// ─── Custom Metrics ──────────────────────────────────

const httpRequestDuration = new client.Histogram({
  name: 'auleg_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});
register.registerMetric(httpRequestDuration);

const httpRequestTotal = new client.Counter({
  name: 'auleg_http_requests_total',
  help: 'Total count of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});
register.registerMetric(httpRequestTotal);

const auditJobDuration = new client.Histogram({
  name: 'auleg_audit_job_duration_seconds',
  help: 'Duration of audit jobs in seconds',
  labelNames: ['status'],
  buckets: [1, 5, 10, 30, 60, 120, 300]
});
register.registerMetric(auditJobDuration);

const auditJobsTotal = new client.Counter({
  name: 'auleg_audit_jobs_total',
  help: 'Total count of audit jobs processed',
  labelNames: ['status']
});
register.registerMetric(auditJobsTotal);

const auditQueueSize = new client.Gauge({
  name: 'auleg_audit_queue_size',
  help: 'Current number of jobs in the audit queue'
});
register.registerMetric(auditQueueSize);

const activeUsers = new client.Gauge({
  name: 'auleg_active_users',
  help: 'Number of currently active users (logged in within last 15min)'
});
register.registerMetric(activeUsers);

const emailsSent = new client.Counter({
  name: 'auleg_emails_sent_total',
  help: 'Total emails sent',
  labelNames: ['type', 'status']
});
register.registerMetric(emailsSent);

const dbQueryDuration = new client.Histogram({
  name: 'auleg_db_query_duration_seconds',
  help: 'Duration of database queries',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
});
register.registerMetric(dbQueryDuration);

// ─── Middleware ───────────────────────────────────────

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;

    // Normalize route to avoid cardinality explosion from IDs
    const route = normalizeRoute(req.route?.path || req.originalUrl);

    httpRequestDuration.observe(
      { method: req.method, route, status_code: res.statusCode },
      durationSec
    );
    httpRequestTotal.inc(
      { method: req.method, route, status_code: res.statusCode }
    );
  });

  next();
}

function normalizeRoute(path) {
  // Replace UUIDs and numeric IDs with :id
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+/g, '/:id')
    .split('?')[0]; // Remove query string
}

module.exports = {
  register,
  metricsMiddleware,
  httpRequestDuration,
  httpRequestTotal,
  auditJobDuration,
  auditJobsTotal,
  auditQueueSize,
  activeUsers,
  emailsSent,
  dbQueryDuration
};
