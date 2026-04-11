const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: List notifications for the current user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: List of notifications
 */
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const where = { userId: req.user.id };
    if (req.query.unreadOnly === 'true') where.read = false;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, type: true, title: true, message: true, read: true, data: true, createdAt: true }
      }),
      prisma.notification.count({ where: { userId: req.user.id, read: false } })
    ]);

    const formatted = notifications.map(n => ({
      ...n,
      data: n.data ? JSON.parse(n.data) : null
    }));

    res.json({ notifications: formatted, unreadCount });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/notifications/{id}/read:
 *   patch:
 *     summary: Mark a notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification marked as read
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const notif = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!notif) return res.status(404).json({ error: 'Notification not found' });

    const updated = await prisma.notification.update({
      where: { id: notif.id },
      data: { read: true }
    });
    res.json({ id: updated.id, read: updated.read });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All marked as read
 */
router.patch('/read-all', async (req, res, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true }
    });
    res.json({ marked: result.count });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
