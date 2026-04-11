const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { activityFromReq } = require('../lib/activity');

const router = express.Router();
router.use(authMiddleware);

const VALID_CONDITIONS = ['missing', 'weak', 'present', 'strong'];
const VALID_ACTIONS = ['flag', 'boost', 'reduce', 'ignore'];

/**
 * @swagger
 * /api/scoring-rules:
 *   get:
 *     summary: List custom scoring rules
 *     tags: [Scoring Rules]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of scoring rules
 */
router.get('/', async (req, res, next) => {
  try {
    const rules = await prisma.scoringRule.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ rules });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/scoring-rules:
 *   post:
 *     summary: Create a custom scoring rule
 *     tags: [Scoring Rules]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, clause, condition]
 *             properties:
 *               name: { type: string }
 *               clause: { type: string, description: "Clause type (e.g. breach_notification)" }
 *               condition: { type: string, enum: [missing, weak, present, strong] }
 *               weight: { type: number, default: 1.0 }
 *               action: { type: string, enum: [flag, boost, reduce, ignore], default: flag }
 *     responses:
 *       201:
 *         description: Rule created
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, clause, condition, weight, action } = req.body;
    if (!name || !clause || !condition) {
      return res.status(400).json({ error: 'name, clause, and condition are required' });
    }
    if (!VALID_CONDITIONS.includes(condition)) {
      return res.status(400).json({ error: `Invalid condition. Valid: ${VALID_CONDITIONS.join(', ')}` });
    }
    if (action && !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Valid: ${VALID_ACTIONS.join(', ')}` });
    }

    const rule = await prisma.scoringRule.create({
      data: {
        name,
        clause,
        condition,
        weight: weight != null ? parseFloat(weight) : 1.0,
        action: action || 'flag',
        userId: req.user.id,
        orgId: req.user.orgId || null
      }
    });

    await activityFromReq(req, 'scoring.create', `${name} (${clause}:${condition})`);
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/scoring-rules/{id}:
 *   put:
 *     summary: Update a scoring rule
 *     tags: [Scoring Rules]
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
 *               name: { type: string }
 *               clause: { type: string }
 *               condition: { type: string }
 *               weight: { type: number }
 *               action: { type: string }
 *               active: { type: boolean }
 *     responses:
 *       200:
 *         description: Rule updated
 */
router.put('/:id', async (req, res, next) => {
  try {
    const rule = await prisma.scoringRule.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!rule) return res.status(404).json({ error: 'Rule not found' });

    const updates = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.clause) updates.clause = req.body.clause;
    if (req.body.condition) {
      if (!VALID_CONDITIONS.includes(req.body.condition)) {
        return res.status(400).json({ error: `Invalid condition. Valid: ${VALID_CONDITIONS.join(', ')}` });
      }
      updates.condition = req.body.condition;
    }
    if (req.body.weight != null) updates.weight = parseFloat(req.body.weight);
    if (req.body.action) {
      if (!VALID_ACTIONS.includes(req.body.action)) {
        return res.status(400).json({ error: `Invalid action. Valid: ${VALID_ACTIONS.join(', ')}` });
      }
      updates.action = req.body.action;
    }
    if (req.body.active !== undefined) updates.active = !!req.body.active;

    const updated = await prisma.scoringRule.update({
      where: { id: rule.id },
      data: updates
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/scoring-rules/{id}:
 *   delete:
 *     summary: Delete a scoring rule
 *     tags: [Scoring Rules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Rule deleted
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const rule = await prisma.scoringRule.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!rule) return res.status(404).json({ error: 'Rule not found' });

    await prisma.scoringRule.delete({ where: { id: rule.id } });
    await activityFromReq(req, 'scoring.delete', rule.name);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
