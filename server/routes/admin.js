const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { activityFromReq } = require('../lib/activity');

const router = express.Router();
router.use(authMiddleware);
router.use(requireRole('admin'));

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: List all users (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: List of users
 */
router.get('/users', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const whereClause = req.user.orgId ? { orgId: req.user.orgId } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        select: { id: true, email: true, name: true, role: true, orgId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.user.count({ where: whereClause })
    ]);

    res.json({ users, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/admin/users/{id}/role:
 *   patch:
 *     summary: Update a user's role (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [admin, auditor, viewer] }
 *     responses:
 *       200:
 *         description: Role updated
 */
router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body;
    const validRoles = ['admin', 'auditor', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Org-scoped: admin can only manage users in their own org
    if (req.user.orgId && user.orgId !== req.user.orgId) {
      return res.status(403).json({ error: 'Cannot manage users outside your organization' });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, email: true, name: true, role: true }
    });

    await activityFromReq(req, 'user.role_change', `${user.email} -> ${role}`);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/admin/users/{id}:
 *   delete:
 *     summary: Delete a user (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: User deleted
 */
router.delete('/users/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Org-scoped: admin can only delete users in their own org
    if (req.user.orgId && user.orgId !== req.user.orgId) {
      return res.status(403).json({ error: 'Cannot delete users outside your organization' });
    }

    await prisma.audit.deleteMany({ where: { userId: req.params.id } });
    await prisma.user.delete({ where: { id: req.params.id } });

    await activityFromReq(req, 'user.delete', user.email);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/admin/activity:
 *   get:
 *     summary: View activity log (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Activity log entries
 */
router.get('/activity', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.activityLog.count()
    ]);

    res.json({ logs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/admin/stats:
 *   get:
 *     summary: Platform statistics (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Platform statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const [userCount, orgCount, auditCount, auditsByRisk] = await Promise.all([
      prisma.user.count(),
      prisma.org.count(),
      prisma.audit.count(),
      prisma.audit.groupBy({ by: ['overallRisk'], _count: true })
    ]);

    res.json({
      users: userCount,
      orgs: orgCount,
      audits: auditCount,
      auditsByRisk: auditsByRisk.reduce((acc, r) => {
        acc[r.overallRisk || 'Unknown'] = r._count;
        return acc;
      }, {})
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
