const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { activityFromReq } = require('../lib/activity');

const router = express.Router();
router.use(authMiddleware);

/**
 * @swagger
 * /api/webhooks:
 *   get:
 *     summary: List user's webhooks
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of webhooks
 */
router.get('/', async (req, res, next) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { userId: req.user.id },
      select: { id: true, url: true, events: true, active: true, createdAt: true, updatedAt: true }
    });
    res.json({ webhooks });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/webhooks:
 *   post:
 *     summary: Create a webhook
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url, events]
 *             properties:
 *               url: { type: string, format: uri }
 *               events: { type: string, description: "Comma-separated: audit.complete,audit.failed" }
 *     responses:
 *       201:
 *         description: Webhook created (includes secret)
 */
router.post('/', async (req, res, next) => {
  try {
    const { url, events } = req.body;
    if (!url || !events) {
      return res.status(400).json({ error: 'url and events are required' });
    }

    const validEvents = ['audit.complete', 'audit.failed'];
    const eventList = events.split(',').map(e => e.trim());
    const invalid = eventList.filter(e => !validEvents.includes(e));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid events: ${invalid.join(', ')}. Valid: ${validEvents.join(', ')}` });
    }

    let parsedUrl;
    try { parsedUrl = new URL(url); } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'URL must use http or https' });
    }

    const secret = crypto.randomBytes(32).toString('hex');

    const webhook = await prisma.webhook.create({
      data: {
        url: parsedUrl.href,
        events: eventList.join(','),
        secret,
        userId: req.user.id
      }
    });

    await activityFromReq(req, 'webhook.create', parsedUrl.href);
    res.status(201).json({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      secret,
      active: webhook.active,
      createdAt: webhook.createdAt
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/webhooks/{id}:
 *   patch:
 *     summary: Update a webhook (toggle active, change events)
 *     tags: [Webhooks]
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
 *               events: { type: string }
 *               url: { type: string }
 *     responses:
 *       200:
 *         description: Webhook updated
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const hook = await prisma.webhook.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!hook) return res.status(404).json({ error: 'Webhook not found' });

    const updates = {};
    if (req.body.active !== undefined) updates.active = !!req.body.active;
    if (req.body.events) updates.events = req.body.events;
    if (req.body.url) {
      try { new URL(req.body.url); } catch {
        return res.status(400).json({ error: 'Invalid URL' });
      }
      updates.url = req.body.url;
    }

    const updated = await prisma.webhook.update({
      where: { id: hook.id },
      data: updates,
      select: { id: true, url: true, events: true, active: true, updatedAt: true }
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/webhooks/{id}:
 *   delete:
 *     summary: Delete a webhook
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const hook = await prisma.webhook.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!hook) return res.status(404).json({ error: 'Webhook not found' });

    await prisma.webhook.delete({ where: { id: hook.id } });
    await activityFromReq(req, 'webhook.delete', hook.url);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
