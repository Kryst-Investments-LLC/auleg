const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { activityFromReq } = require('../lib/activity');

const router = express.Router();
router.use(authMiddleware);

/**
 * @swagger
 * /api/templates:
 *   get:
 *     summary: List audit templates
 *     tags: [Templates]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of templates
 */
router.get('/', async (req, res, next) => {
  try {
    const templates = await prisma.auditTemplate.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' }
    });
    res.json({ templates: templates.map(formatTemplate) });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/templates:
 *   post:
 *     summary: Create an audit template
 *     tags: [Templates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, clauseTypes, frameworks]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               clauseTypes: { type: array, items: { type: string } }
 *               frameworks: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Template created
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, description, clauseTypes, frameworks } = req.body;
    if (!name || !clauseTypes || !frameworks) {
      return res.status(400).json({ error: 'name, clauseTypes, and frameworks are required' });
    }
    if (!Array.isArray(clauseTypes) || !Array.isArray(frameworks)) {
      return res.status(400).json({ error: 'clauseTypes and frameworks must be arrays' });
    }

    const template = await prisma.auditTemplate.create({
      data: {
        name,
        description: description || null,
        clauseTypes: clauseTypes.join(','),
        frameworks: frameworks.join(','),
        userId: req.user.id
      }
    });

    await activityFromReq(req, 'template.create', name);
    res.status(201).json(formatTemplate(template));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/templates/{id}:
 *   get:
 *     summary: Get a template by ID
 *     tags: [Templates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Template details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const template = await prisma.auditTemplate.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(formatTemplate(template));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/templates/{id}:
 *   put:
 *     summary: Update a template
 *     tags: [Templates]
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
 *               description: { type: string }
 *               clauseTypes: { type: array, items: { type: string } }
 *               frameworks: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Template updated
 */
router.put('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.auditTemplate.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const updates = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description || null;
    if (req.body.clauseTypes) updates.clauseTypes = req.body.clauseTypes.join(',');
    if (req.body.frameworks) updates.frameworks = req.body.frameworks.join(',');

    const updated = await prisma.auditTemplate.update({
      where: { id: existing.id },
      data: updates
    });

    res.json(formatTemplate(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/templates/{id}:
 *   delete:
 *     summary: Delete a template
 *     tags: [Templates]
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
    const template = await prisma.auditTemplate.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    await prisma.auditTemplate.delete({ where: { id: template.id } });
    await activityFromReq(req, 'template.delete', template.name);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

function formatTemplate(t) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    clauseTypes: t.clauseTypes.split(',').filter(Boolean),
    frameworks: t.frameworks.split(',').filter(Boolean),
    userId: t.userId,
    orgId: t.orgId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt
  };
}

module.exports = router;
