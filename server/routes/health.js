const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');

const startedAt = new Date().toISOString();

// SLA tracking
const slaMetrics = {
  totalRequests: 0,
  errorRequests: 0,
  uptimeStart: Date.now()
};

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 */
router.get('/', (req, res) => {
  slaMetrics.totalRequests++;
  res.json({
    status: 'healthy',
    service: 'Auleg API',
    version: '1.0.0-beta',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    startedAt,
    beta: process.env.BETA_MODE === 'true'
  });
});

/**
 * @swagger
 * /api/health/ready:
 *   get:
 *     summary: Readiness check (includes DB probe + Redis + queue status)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is not ready
 */
router.get('/ready', async (req, res) => {
  const checks = { database: 'unknown', memory: 'unknown', redis: 'unknown', queue: 'unknown' };
  let healthy = true;

  // Database probe
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    checks.database = 'connected';
  } catch (err) {
    checks.database = 'disconnected';
    healthy = false;
  }

  // Redis probe
  if (process.env.REDIS_URL) {
    try {
      const IORedis = require('ioredis');
      const redis = new IORedis(process.env.REDIS_URL, { connectTimeout: 2000, lazyConnect: true });
      await redis.connect();
      await redis.ping();
      checks.redis = 'connected';
      await redis.disconnect();
    } catch {
      checks.redis = 'disconnected';
      // Redis failure is a warning, not fatal (in-memory fallback exists)
    }
  } else {
    checks.redis = 'not_configured';
  }

  // Queue status
  try {
    const { getQueueStatus } = require('../lib/audit-worker');
    checks.queue = await getQueueStatus();
  } catch {
    checks.queue = 'unavailable';
  }

  // Memory check (warn if > 512MB RSS)
  const mem = process.memoryUsage();
  checks.memory = {
    rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
    heap: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
    status: mem.rss < 512 * 1024 * 1024 ? 'ok' : 'warning'
  };
  if (mem.rss > 1024 * 1024 * 1024) healthy = false; // >1GB = unhealthy

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ready' : 'not_ready',
    checks,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * @swagger
 * /api/health/sla:
 *   get:
 *     summary: SLA / uptime metrics
 *     tags: [Health]
 */
router.get('/sla', (req, res) => {
  const uptimeSeconds = (Date.now() - slaMetrics.uptimeStart) / 1000;
  const availability = slaMetrics.totalRequests > 0
    ? ((slaMetrics.totalRequests - slaMetrics.errorRequests) / slaMetrics.totalRequests * 100).toFixed(4)
    : '100.0000';

  res.json({
    uptime: {
      seconds: Math.round(uptimeSeconds),
      human: formatUptime(uptimeSeconds),
      startedAt
    },
    availability: `${availability}%`,
    requests: {
      total: slaMetrics.totalRequests,
      errors: slaMetrics.errorRequests,
      successRate: availability + '%'
    },
    sla: {
      target: '99.9%',
      current: availability + '%',
      met: parseFloat(availability) >= 99.9
    }
  });
});

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

module.exports = router;
module.exports.slaMetrics = slaMetrics;
