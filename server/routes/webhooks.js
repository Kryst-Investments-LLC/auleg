const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { activityFromReq } = require('../lib/activity');
const { normalizeAndValidateOutboundUrl } = require('../lib/url-security');
const { encrypt } = require('../lib/crypto');

const VALID_EVENTS = ['audit.complete', 'audit.failed'];

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

    const eventList = events.split(',').map(e => e.trim()).filter(Boolean);
    if (eventList.length === 0) {
      return res.status(400).json({ error: 'At least one webhook event is required' });
    }
    const invalid = eventList.filter(e => !VALID_EVENTS.includes(e));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid events: ${invalid.join(', ')}. Valid: ${VALID_EVENTS.join(', ')}` });
    }

    const normalizedUrl = await normalizeAndValidateOutboundUrl(url);

    const secret = crypto.randomBytes(32).toString('hex');
    const { encrypted, iv, tag } = encrypt(secret);

    const webhook = await prisma.webhook.create({
      data: {
        url: normalizedUrl,
        events: eventList.join(','),
        secretEncrypted: encrypted,
        secretIv: iv,
        secretTag: tag,
        userId: req.user.id
      }
    });

    await activityFromReq(req, 'webhook.create', normalizedUrl);
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
    if (req.body.events) {
      const eventList = req.body.events.split(',').map(e => e.trim()).filter(Boolean);
      if (eventList.length === 0) {
        return res.status(400).json({ error: 'At least one webhook event is required' });
      }
      const invalid = eventList.filter(e => !VALID_EVENTS.includes(e));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Invalid events: ${invalid.join(', ')}. Valid: ${VALID_EVENTS.join(', ')}` });
      }
      updates.events = eventList.join(',');
    }
    if (req.body.url) {
      updates.url = await normalizeAndValidateOutboundUrl(req.body.url);
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
