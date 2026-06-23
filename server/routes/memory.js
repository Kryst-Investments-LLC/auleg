/**
 * Memory Loop API — record human overrides of AI findings and read the
 * aggregated organization playbook.
 */
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireAccessibleAudit } = require('../lib/access');
const { recordOverride, getOrgPlaybook, VALID_ACTIONS } = require('../lib/playbook');
const { activityFromReq } = require('../lib/activity');

router.use(authMiddleware);

/**
 * @swagger
 * /api/memory/overrides:
 *   post:
 *     summary: Record a human override of an AI clause finding
 *     tags: [Memory]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Override recorded }
 */
router.post('/overrides', async (req, res, next) => {
  try {
    const { auditId, clause, action, originalScore, overrideScore, note } = req.body || {};
    if (!auditId || !clause || !action) {
      return res.status(400).json({ error: 'auditId, clause, and action are required' });
    }
    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    // Authorize: caller must have access to the audit (404 otherwise).
    const audit = await requireAccessibleAudit(req.user, auditId);

    const override = await recordOverride({
      auditId: audit.id,
      orgId: audit.orgId || req.user.orgId || null,
      userId: req.user.id,
      userEmail: req.user.email,
      clause,
      action,
      originalScore,
      overrideScore,
      note
    });

    await activityFromReq(req, 'finding.override', `${clause} -> ${action}`);
    res.status(201).json(override);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/memory/playbook:
 *   get:
 *     summary: Get the organization's learned playbook (aggregated overrides)
 *     tags: [Memory]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Aggregated per-clause guidance }
 */
router.get('/playbook', async (req, res, next) => {
  try {
    const playbook = await getOrgPlaybook(req.user.orgId || null);
    res.json(playbook);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
