const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/**
 * @swagger
 * /api/analytics/overview:
 *   get:
 *     summary: Get analytics overview for the current user
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Analytics summary
 */
router.get('/overview', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [totalAudits, completed, failed, processing] = await Promise.all([
      prisma.audit.count({ where: { userId } }),
      prisma.audit.count({ where: { userId, status: 'complete' } }),
      prisma.audit.count({ where: { userId, status: 'failed' } }),
      prisma.audit.count({ where: { userId, status: 'processing' } })
    ]);

    // Risk distribution
    const audits = await prisma.audit.findMany({
      where: { userId, status: 'complete' },
      select: { overallRisk: true, riskScore: true, clausesDetected: true, gapsFound: true, createdAt: true }
    });

    const riskDist = { Low: 0, Moderate: 0, High: 0, Critical: 0 };
    let totalScore = 0;
    let totalClauses = 0;
    let totalGaps = 0;
    for (const a of audits) {
      if (a.overallRisk && riskDist[a.overallRisk] !== undefined) riskDist[a.overallRisk]++;
      totalScore += a.riskScore || 0;
      totalClauses += a.clausesDetected || 0;
      totalGaps += a.gapsFound || 0;
    }

    const avgScore = audits.length > 0 ? Math.round((totalScore / audits.length) * 10) / 10 : 0;
    const avgClauses = audits.length > 0 ? Math.round((totalClauses / audits.length) * 10) / 10 : 0;
    const avgGaps = audits.length > 0 ? Math.round((totalGaps / audits.length) * 10) / 10 : 0;

    res.json({
      totalAudits,
      completed,
      failed,
      processing,
      riskDistribution: riskDist,
      averageRiskScore: avgScore,
      averageClauses: avgClauses,
      averageGaps: avgGaps
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/analytics/trend:
 *   get:
 *     summary: Get audit trend data (by day) for the last N days
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 30 }
 *     responses:
 *       200:
 *         description: Daily audit counts and average risk
 */
router.get('/trend', async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400000);

    const audits = await prisma.audit.findMany({
      where: { userId: req.user.id, createdAt: { gte: since } },
      select: { createdAt: true, status: true, riskScore: true, overallRisk: true },
      orderBy: { createdAt: 'asc' }
    });

    // Group by day
    const byDay = {};
    for (let d = 0; d < days; d++) {
      const date = new Date(since.getTime() + d * 86400000);
      const key = date.toISOString().slice(0, 10);
      byDay[key] = { date: key, count: 0, completed: 0, failed: 0, totalScore: 0 };
    }

    for (const a of audits) {
      const key = a.createdAt.toISOString().slice(0, 10);
      if (!byDay[key]) byDay[key] = { date: key, count: 0, completed: 0, failed: 0, totalScore: 0 };
      byDay[key].count++;
      if (a.status === 'complete') {
        byDay[key].completed++;
        byDay[key].totalScore += a.riskScore || 0;
      }
      if (a.status === 'failed') byDay[key].failed++;
    }

    const trend = Object.values(byDay).map(d => ({
      date: d.date,
      count: d.count,
      completed: d.completed,
      failed: d.failed,
      avgScore: d.completed > 0 ? Math.round((d.totalScore / d.completed) * 10) / 10 : null
    }));

    res.json({ days, trend });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
