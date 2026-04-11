const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { activityFromReq } = require('../lib/activity');

const router = express.Router();
router.use(authMiddleware);

/**
 * @swagger
 * /api/orgs:
 *   post:
 *     summary: Create an organization
 *     tags: [Orgs]
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
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: Organization created
 */
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Organization name is required' });
    }

    const org = await prisma.org.create({ data: { name: name.trim() } });

    await prisma.user.update({
      where: { id: req.user.id },
      data: { orgId: org.id, role: 'admin' }
    });

    await activityFromReq(req, 'org.create', org.name);
    res.status(201).json(org);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/orgs/mine:
 *   get:
 *     summary: Get current user's organization
 *     tags: [Orgs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Organization details with members
 */
router.get('/mine', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { orgId: true }
    });

    if (!user?.orgId) {
      return res.json({ org: null });
    }

    const org = await prisma.org.findUnique({
      where: { id: user.orgId },
      include: {
        users: { select: { id: true, email: true, name: true, role: true, createdAt: true } },
        _count: { select: { audits: true } }
      }
    });

    res.json({ org });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/orgs/invite:
 *   post:
 *     summary: Add a user to org by email (admin only)
 *     tags: [Orgs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *               role: { type: string, default: auditor }
 *     responses:
 *       200:
 *         description: User added to org
 */
router.post('/invite', requireRole('admin'), async (req, res, next) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const admin = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { orgId: true }
    });
    if (!admin?.orgId) return res.status(400).json({ error: 'You are not in an organization' });

    const target = await prisma.user.findUnique({ where: { email } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.orgId) return res.status(409).json({ error: 'User already belongs to an organization' });

    const validRoles = ['admin', 'auditor', 'viewer'];
    const assignRole = validRoles.includes(role) ? role : 'auditor';

    await prisma.user.update({
      where: { id: target.id },
      data: { orgId: admin.orgId, role: assignRole }
    });

    await activityFromReq(req, 'org.invite', `${email} as ${assignRole}`);
    res.json({ message: `${email} added as ${assignRole}` });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/orgs/members/{id}:
 *   delete:
 *     summary: Remove a user from org (admin only)
 *     tags: [Orgs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: User removed
 */
router.delete('/members/:id', requireRole('admin'), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }

    const admin = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { orgId: true }
    });

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.orgId !== admin.orgId) {
      return res.status(404).json({ error: 'User not found in your organization' });
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { orgId: null, role: 'auditor' }
    });

    await activityFromReq(req, 'org.remove', target.email);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
