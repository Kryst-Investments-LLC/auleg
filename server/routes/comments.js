const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/comments/{auditId}:
 *   get:
 *     summary: List comments for an audit
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: auditId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of comments
 */
router.get('/:auditId', authMiddleware, async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.auditId, userId: req.user.id }
    });

    // Also allow if shared with user
    let hasAccess = !!audit;
    if (!hasAccess) {
      const share = await prisma.auditShare.findFirst({
        where: { auditId: req.params.auditId, sharedWith: req.user.email }
      });
      hasAccess = !!share;
    }
    if (!hasAccess) return res.status(404).json({ error: 'Audit not found' });

    const comments = await prisma.auditComment.findMany({
      where: { auditId: req.params.auditId },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ comments });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/comments/{auditId}:
 *   post:
 *     summary: Add a comment to an audit
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: auditId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body: { type: string }
 *               clause: { type: string }
 *               parentId: { type: string }
 *     responses:
 *       201:
 *         description: Comment created
 */
router.post('/:auditId', authMiddleware, async (req, res, next) => {
  try {
    const { body, clause, parentId } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Comment body is required' });
    }

    const audit = await prisma.audit.findFirst({
      where: { id: req.params.auditId, userId: req.user.id }
    });

    let hasAccess = !!audit;
    if (!hasAccess) {
      const share = await prisma.auditShare.findFirst({
        where: {
          auditId: req.params.auditId,
          sharedWith: req.user.email,
          permission: 'comment'
        }
      });
      hasAccess = !!share;
    }
    if (!hasAccess) return res.status(403).json({ error: 'No permission to comment' });

    if (parentId) {
      const parent = await prisma.auditComment.findUnique({ where: { id: parentId } });
      if (!parent || parent.auditId !== req.params.auditId) {
        return res.status(400).json({ error: 'Invalid parent comment' });
      }
    }

    const comment = await prisma.auditComment.create({
      data: {
        auditId: req.params.auditId,
        userId: req.user.id,
        userEmail: req.user.email,
        userName: req.user.name || null,
        clause: clause || null,
        body: body.trim(),
        parentId: parentId || null
      }
    });

    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/comments/{auditId}/{commentId}:
 *   put:
 *     summary: Edit a comment
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: auditId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body: { type: string }
 *     responses:
 *       200:
 *         description: Comment updated
 */
router.put('/:auditId/:commentId', authMiddleware, async (req, res, next) => {
  try {
    const { body } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Comment body is required' });
    }

    const comment = await prisma.auditComment.findUnique({
      where: { id: req.params.commentId }
    });
    if (!comment || comment.auditId !== req.params.auditId) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (comment.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Can only edit your own comments' });
    }

    const updated = await prisma.auditComment.update({
      where: { id: req.params.commentId },
      data: { body: body.trim() }
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/comments/{auditId}/{commentId}:
 *   delete:
 *     summary: Delete a comment
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: auditId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Comment deleted
 */
router.delete('/:auditId/:commentId', authMiddleware, async (req, res, next) => {
  try {
    const comment = await prisma.auditComment.findUnique({
      where: { id: req.params.commentId }
    });
    if (!comment || comment.auditId !== req.params.auditId) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (comment.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Can only delete your own comments' });
    }

    await prisma.auditComment.delete({ where: { id: req.params.commentId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
