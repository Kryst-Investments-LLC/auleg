const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { activityFromReq } = require('../lib/activity');
const { notify } = require('../lib/notifications');
const emailService = require('../lib/email');

const router = express.Router();

/**
 * @swagger
 * /api/shares:
 *   post:
 *     summary: Share an audit with another user
 *     tags: [Sharing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [auditId, email]
 *             properties:
 *               auditId: { type: string }
 *               email: { type: string }
 *               permission: { type: string, enum: [view, comment], default: view }
 *               expiresInDays: { type: integer }
 *     responses:
 *       201:
 *         description: Share created
 */
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { auditId, email, permission, expiresInDays } = req.body;
    if (!auditId || !email) {
      return res.status(400).json({ error: 'auditId and email are required' });
    }

    const audit = await prisma.audit.findFirst({
      where: { id: auditId, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    if (email === req.user.email) {
      return res.status(400).json({ error: 'Cannot share with yourself' });
    }

    // Check if already shared
    const existing = await prisma.auditShare.findFirst({
      where: { auditId, sharedWith: email }
    });
    if (existing) {
      return res.status(409).json({ error: 'Already shared with this user' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    let expiresAt = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date(Date.now() + expiresInDays * 86400000);
    }

    const share = await prisma.auditShare.create({
      data: {
        auditId,
        sharedWith: email,
        permission: permission || 'view',
        token,
        expiresAt
      }
    });

    await activityFromReq(req, 'audit.share', `${audit.contractName} → ${email}`);

    // Notify the recipient if they exist
    const recipient = await prisma.user.findUnique({ where: { email } });
    if (recipient) {
      await notify(recipient.id, 'audit.shared',
        'Audit Shared With You',
        `${req.user.email} shared "${audit.contractName}" with you.`,
        { auditId, shareId: share.id }
      );
    }

    // Send share invitation email
    await emailService.sendShareInvite(email, req.user.email, audit.contractName, token).catch(e =>
      console.error('Share email failed:', e.message)
    );

    res.status(201).json({
      id: share.id,
      auditId: share.auditId,
      sharedWith: share.sharedWith,
      permission: share.permission,
      token: share.token,
      expiresAt: share.expiresAt,
      shareUrl: `/shared/${share.token}`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/shares/mine:
 *   get:
 *     summary: List audits shared with the current user
 *     tags: [Sharing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Shared audits
 */
router.get('/mine', authMiddleware, async (req, res, next) => {
  try {
    const shares = await prisma.auditShare.findMany({
      where: { sharedWith: req.user.email },
      include: {
        audit: {
          select: {
            id: true, contractName: true, status: true,
            overallRisk: true, riskScore: true,
            clausesDetected: true, gapsFound: true, createdAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Filter out expired shares
    const active = shares.filter(s => !s.expiresAt || new Date(s.expiresAt) > new Date());
    res.json({ shares: active });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/shares/audit/{auditId}:
 *   get:
 *     summary: List shares for a specific audit
 *     tags: [Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: auditId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Share list
 */
router.get('/audit/:auditId', authMiddleware, async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.auditId, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    const shares = await prisma.auditShare.findMany({
      where: { auditId: req.params.auditId },
      select: { id: true, sharedWith: true, permission: true, expiresAt: true, createdAt: true }
    });
    res.json({ shares });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/shares/token/{token}:
 *   get:
 *     summary: Access a shared audit via share token (no auth required)
 *     tags: [Sharing]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Shared audit report
 */
router.get('/token/:token', async (req, res, next) => {
  try {
    const share = await prisma.auditShare.findUnique({
      where: { token: req.params.token },
      include: { audit: true }
    });
    if (!share) return res.status(404).json({ error: 'Share not found' });
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    const result = {
      contractName: share.audit.contractName,
      status: share.audit.status,
      overallRisk: share.audit.overallRisk,
      riskScore: share.audit.riskScore,
      clausesDetected: share.audit.clausesDetected,
      gapsFound: share.audit.gapsFound,
      createdAt: share.audit.createdAt,
      permission: share.permission
    };

    if (share.audit.reportJson) {
      result.report = JSON.parse(share.audit.reportJson);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/shares/{id}:
 *   delete:
 *     summary: Revoke a share
 *     tags: [Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Share revoked
 */
router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const share = await prisma.auditShare.findUnique({
      where: { id: req.params.id },
      include: { audit: { select: { userId: true } } }
    });
    if (!share || share.audit.userId !== req.user.id) {
      return res.status(404).json({ error: 'Share not found' });
    }

    await prisma.auditShare.delete({ where: { id: share.id } });
    await activityFromReq(req, 'audit.unshare', share.sharedWith);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
