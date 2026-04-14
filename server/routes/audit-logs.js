/**
 * Audit Log Export & Retention Routes
 * 
 * Enterprise features:
 * - Export activity logs as CSV/JSON with filters
 * - Configurable retention policies
 * - Log retention cleanup (admin-only)
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const logger = require('../lib/logger');

/**
 * @swagger
 * /api/audit-logs:
 *   get:
 *     summary: List activity logs with filters (admin only)
 *     tags: [AuditLogs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: action
 *         in: query
 *         description: Filter by action type
 *       - name: userId
 *         in: query
 *         description: Filter by user ID
 *       - name: from
 *         in: query
 *         description: Start date (ISO)
 *       - name: to
 *         in: query
 *         description: End date (ISO)
 *       - name: page
 *         in: query
 *         description: Page number
 *       - name: limit
 *         in: query
 *         description: Items per page (max 500)
 */
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { action, userId, from, to, page = 1, limit = 50 } = req.query;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(500, Math.max(1, Number(limit) || 50));

  const where = {};
  if (action) where.action = { contains: action };
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip: (pageNum - 1) * limitNum
    }),
    prisma.activityLog.count({ where })
  ]);

  res.json({
    logs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum)
    }
  });
});

/**
 * @swagger
 * /api/audit-logs/export:
 *   get:
 *     summary: Export activity logs as CSV or JSON
 *     tags: [AuditLogs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: format
 *         in: query
 *         description: Export format (csv or json)
 *       - name: from
 *         in: query
 *       - name: to
 *         in: query
 *       - name: action
 *         in: query
 */
router.get('/export', authMiddleware, requireRole('admin'), async (req, res) => {
  const { format = 'json', action, from, to } = req.query;

  const where = {};
  if (action) where.action = { contains: action };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const logs = await prisma.activityLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10000 // Max 10k records per export
  });

  if (format === 'csv') {
    const header = 'id,action,detail,userId,userEmail,ip,createdAt\n';
    const rows = logs.map(l =>
      `"${l.id}","${l.action}","${(l.detail || '').replace(/"/g, '""')}","${l.userId || ''}","${l.userEmail || ''}","${l.ip || ''}","${l.createdAt.toISOString()}"`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(header + rows);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.json"`);
  res.json({ exported: logs.length, logs });
});

/**
 * @swagger
 * /api/audit-logs/retention:
 *   post:
 *     summary: Apply retention policy — delete logs older than specified days
 *     tags: [AuditLogs]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/retention', authMiddleware, requireRole('admin'), async (req, res) => {
  const { retentionDays = 365 } = req.body;

  if (!Number.isFinite(retentionDays) || retentionDays < 30) {
    return res.status(400).json({ error: 'retentionDays must be at least 30' });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const result = await prisma.activityLog.deleteMany({
    where: { createdAt: { lt: cutoff } }
  });

  logger.info({ deletedCount: result.count, retentionDays }, 'Audit log retention applied');

  res.json({
    deleted: result.count,
    retentionDays,
    cutoffDate: cutoff.toISOString()
  });
});

/**
 * @swagger
 * /api/audit-logs/stats:
 *   get:
 *     summary: Get audit log statistics
 *     tags: [AuditLogs]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/stats', authMiddleware, requireRole('admin'), async (req, res) => {
  const [total, oldestLog, actionCounts] = await Promise.all([
    prisma.activityLog.count(),
    prisma.activityLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.$queryRawUnsafe(`
      SELECT action, COUNT(*)::int as count 
      FROM "ActivityLog" 
      GROUP BY action 
      ORDER BY count DESC 
      LIMIT 20
    `)
  ]);

  res.json({
    total,
    oldestEntry: oldestLog?.createdAt || null,
    actionBreakdown: actionCounts
  });
});

module.exports = router;
