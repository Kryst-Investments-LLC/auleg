/**
 * Data Residency Routes
 * 
 * Enterprise feature: Configure per-org data storage regions,
 * retention policies, and encryption settings.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const logger = require('../lib/logger');

const VALID_REGIONS = ['eu', 'us', 'ap', 'custom'];

/**
 * @swagger
 * /api/orgs/data-residency:
 *   get:
 *     summary: Get data residency config for current org
 *     tags: [DataResidency]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  if (!req.user.orgId) {
    return res.status(400).json({ error: 'User must belong to an organization' });
  }

  const config = await prisma.dataResidencyConfig.findUnique({
    where: { orgId: req.user.orgId }
  });

  if (!config) {
    return res.json({
      configured: false,
      defaults: { region: 'us', retentionDays: 365, deletionPolicy: 'soft' }
    });
  }

  res.json({
    configured: true,
    region: config.region,
    storageZone: config.storageZone,
    retentionDays: config.retentionDays,
    deletionPolicy: config.deletionPolicy,
    updatedAt: config.updatedAt
  });
});

/**
 * @swagger
 * /api/orgs/data-residency:
 *   put:
 *     summary: Configure data residency for org (admin only)
 *     tags: [DataResidency]
 *     security: [{ bearerAuth: [] }]
 */
router.put('/', authMiddleware, requireRole('admin'), async (req, res) => {
  if (!req.user.orgId) {
    return res.status(400).json({ error: 'User must belong to an organization' });
  }

  const { region, storageZone, retentionDays, deletionPolicy } = req.body;

  if (region && !VALID_REGIONS.includes(region)) {
    return res.status(400).json({ error: `region must be one of: ${VALID_REGIONS.join(', ')}` });
  }

  if (retentionDays !== undefined && (!Number.isFinite(retentionDays) || retentionDays < 30)) {
    return res.status(400).json({ error: 'retentionDays must be at least 30' });
  }

  if (deletionPolicy && !['soft', 'hard'].includes(deletionPolicy)) {
    return res.status(400).json({ error: 'deletionPolicy must be "soft" or "hard"' });
  }

  const data = {
    orgId: req.user.orgId,
    region: region || 'us',
    storageZone: storageZone || null,
    retentionDays: retentionDays || 365,
    deletionPolicy: deletionPolicy || 'soft'
  };

  const config = await prisma.dataResidencyConfig.upsert({
    where: { orgId: req.user.orgId },
    create: data,
    update: data
  });

  logger.info({ orgId: req.user.orgId, region: config.region }, 'Data residency configured');

  res.json({
    region: config.region,
    storageZone: config.storageZone,
    retentionDays: config.retentionDays,
    deletionPolicy: config.deletionPolicy
  });
});

module.exports = router;
