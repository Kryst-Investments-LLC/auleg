const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

const startedAt = new Date().toISOString();

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
  res.json({
    status: 'healthy',
    service: 'Auleg API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    startedAt
  });
});

/**
 * @swagger
 * /api/health/ready:
 *   get:
 *     summary: Readiness check (includes DB probe)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is not ready
 */
router.get('/ready', async (req, res) => {
  const checks = { database: 'unknown', memory: 'unknown' };
  let healthy = true;

  // Database probe
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    checks.database = 'connected';
  } catch (err) {
    checks.database = 'disconnected';
    healthy = false;
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

module.exports = router;
