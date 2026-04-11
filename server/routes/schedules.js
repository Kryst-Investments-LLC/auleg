const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { activityFromReq } = require('../lib/activity');

const router = express.Router();
router.use(authMiddleware);

// Simple cron validation (5-part cron: min hour dom month dow)
function isValidCron(expr) {
  return /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/.test(expr.trim());
}

// Calculate next run from a simple cron (approximation for common patterns)
function nextRunFromCron(cron) {
  const now = new Date();
  // Return next hour as a simple default — real cron parsing out of scope
  return new Date(now.getTime() + 3600000);
}

/**
 * @swagger
 * /api/schedules:
 *   get:
 *     summary: List scheduled audits
 *     tags: [Schedules]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of schedules
 */
router.get('/', async (req, res, next) => {
  try {
    const schedules = await prisma.scheduledAudit.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ schedules });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/schedules:
 *   post:
 *     summary: Create a scheduled audit
 *     tags: [Schedules]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, auditId, cron]
 *             properties:
 *               name: { type: string }
 *               auditId: { type: string, description: "Source audit to re-run on schedule" }
 *               cron: { type: string, description: "5-part cron expression" }
 *               templateId: { type: string }
 *     responses:
 *       201:
 *         description: Schedule created
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, auditId, cron, templateId } = req.body;
    if (!name || !auditId || !cron) {
      return res.status(400).json({ error: 'name, auditId, and cron are required' });
    }
    if (!isValidCron(cron)) {
      return res.status(400).json({ error: 'Invalid cron expression. Use 5-part format: min hour dom month dow' });
    }

    const audit = await prisma.audit.findFirst({
      where: { id: auditId, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Source audit not found' });
    if (!audit.contractPath) {
      return res.status(400).json({ error: 'Source audit has no contract file' });
    }

    const schedule = await prisma.scheduledAudit.create({
      data: {
        name,
        contractPath: audit.contractPath,
        contractName: audit.contractName,
        cron: cron.trim(),
        nextRun: nextRunFromCron(cron),
        userId: req.user.id,
        templateId: templateId || null
      }
    });

    await activityFromReq(req, 'schedule.create', `${name} (${cron})`);
    res.status(201).json(schedule);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/schedules/{id}:
 *   patch:
 *     summary: Toggle a schedule active/inactive
 *     tags: [Schedules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               active: { type: boolean }
 *               cron: { type: string }
 *     responses:
 *       200:
 *         description: Schedule updated
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const schedule = await prisma.scheduledAudit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    const updates = {};
    if (req.body.active !== undefined) updates.active = !!req.body.active;
    if (req.body.cron) {
      if (!isValidCron(req.body.cron)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
      updates.cron = req.body.cron.trim();
      updates.nextRun = nextRunFromCron(req.body.cron);
    }

    const updated = await prisma.scheduledAudit.update({
      where: { id: schedule.id },
      data: updates
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/schedules/{id}:
 *   delete:
 *     summary: Delete a schedule
 *     tags: [Schedules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Schedule deleted
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const schedule = await prisma.scheduledAudit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    await prisma.scheduledAudit.delete({ where: { id: schedule.id } });
    await activityFromReq(req, 'schedule.delete', schedule.name);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
