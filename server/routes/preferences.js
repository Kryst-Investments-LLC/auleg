const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const VALID_DIGESTS = ['none', 'daily', 'weekly'];
const VALID_THEMES = ['dark', 'light'];

/**
 * @swagger
 * /api/preferences:
 *   get:
 *     summary: Get user preferences
 *     tags: [Preferences]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User preferences
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    let prefs = await prisma.userPreference.findUnique({
      where: { userId: req.user.id }
    });

    if (!prefs) {
      prefs = await prisma.userPreference.create({
        data: { userId: req.user.id }
      });
    }

    res.json(prefs);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/preferences:
 *   patch:
 *     summary: Update user preferences
 *     tags: [Preferences]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               emailDigest: { type: string, enum: [none, daily, weekly] }
 *               notifyAuditComplete: { type: boolean }
 *               notifyAuditFailed: { type: boolean }
 *               notifyShare: { type: boolean }
 *               defaultTemplateId: { type: string }
 *               theme: { type: string, enum: [dark, light] }
 *     responses:
 *       200:
 *         description: Preferences updated
 */
router.patch('/', authMiddleware, async (req, res, next) => {
  try {
    const { emailDigest, notifyAuditComplete, notifyAuditFailed, notifyShare, defaultTemplateId, theme } = req.body;

    if (emailDigest && !VALID_DIGESTS.includes(emailDigest)) {
      return res.status(400).json({ error: `Invalid emailDigest. Valid: ${VALID_DIGESTS.join(', ')}` });
    }
    if (theme && !VALID_THEMES.includes(theme)) {
      return res.status(400).json({ error: `Invalid theme. Valid: ${VALID_THEMES.join(', ')}` });
    }

    const data = {};
    if (emailDigest !== undefined) data.emailDigest = emailDigest;
    if (notifyAuditComplete !== undefined) data.notifyAuditComplete = !!notifyAuditComplete;
    if (notifyAuditFailed !== undefined) data.notifyAuditFailed = !!notifyAuditFailed;
    if (notifyShare !== undefined) data.notifyShare = !!notifyShare;
    if (defaultTemplateId !== undefined) data.defaultTemplateId = defaultTemplateId || null;
    if (theme !== undefined) data.theme = theme;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const prefs = await prisma.userPreference.upsert({
      where: { userId: req.user.id },
      update: data,
      create: { userId: req.user.id, ...data }
    });

    res.json(prefs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
