const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { activityFromReq } = require('../lib/activity');

const router = express.Router();
router.use(authMiddleware);

const VALID_SCOPES = ['audits:read', 'audits:write', 'templates:read', 'templates:write', 'webhooks:read', 'webhooks:write'];

/**
 * @swagger
 * /api/api-keys:
 *   get:
 *     summary: List API keys for the current user
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of API keys (without full key)
 */
router.get('/', async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.user.id },
      select: { id: true, name: true, prefix: true, scopes: true, lastUsed: true, expiresAt: true, createdAt: true }
    });
    res.json({ keys: keys.map(k => ({ ...k, scopes: k.scopes.split(',') })) });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/api-keys:
 *   post:
 *     summary: Create an API key
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, description: "Human-friendly key name" }
 *               scopes: { type: array, items: { type: string }, description: "Permission scopes" }
 *               expiresInDays: { type: integer, description: "Days until expiry (null = never)" }
 *     responses:
 *       201:
 *         description: API key created (full key shown ONLY here)
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, scopes, expiresInDays } = req.body;
    if (!name || name.length < 1) {
      return res.status(400).json({ error: 'name is required' });
    }

    const scopeList = Array.isArray(scopes) && scopes.length > 0 ? scopes : ['audits:read'];
    const invalid = scopeList.filter(s => !VALID_SCOPES.includes(s));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid scopes: ${invalid.join(', ')}. Valid: ${VALID_SCOPES.join(', ')}` });
    }

    // Generate a securely random key: auleg_<48 hex chars>
    const rawKey = `auleg_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 14); // auleg_XXXXXXXX

    let expiresAt = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date(Date.now() + expiresInDays * 86400000);
    }

    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        keyHash,
        prefix,
        scopes: scopeList.join(','),
        expiresAt,
        userId: req.user.id
      }
    });

    await activityFromReq(req, 'apikey.create', name);

    res.status(201).json({
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey, // shown only on creation
      prefix: apiKey.prefix,
      scopes: scopeList,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/api-keys/{id}:
 *   delete:
 *     summary: Revoke an API key
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Key revoked
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const key = await prisma.apiKey.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!key) return res.status(404).json({ error: 'API key not found' });

    await prisma.apiKey.delete({ where: { id: key.id } });
    await activityFromReq(req, 'apikey.revoke', key.name);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
