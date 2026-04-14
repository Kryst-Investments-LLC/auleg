/**
 * Terms of Service / DPA Acceptance Routes
 * 
 * Enterprise features:
 * - Versioned legal documents (ToS, DPA, Privacy Policy)
 * - User acceptance tracking with IP/timestamp
 * - Enforce acceptance before platform use
 * - Admin: manage documents
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const logger = require('../lib/logger');

/**
 * @swagger
 * /api/terms/current:
 *   get:
 *     summary: Get current active legal documents
 *     tags: [Terms]
 */
router.get('/current', async (req, res) => {
  const docs = await prisma.legalDocument.findMany({
    where: { active: true },
    select: {
      id: true,
      type: true,
      version: true,
      title: true,
      effectiveDate: true
    },
    orderBy: { effectiveDate: 'desc' }
  });

  res.json({ documents: docs });
});

/**
 * @swagger
 * /api/terms/{type}/{version}:
 *   get:
 *     summary: Get a specific legal document by type and version
 *     tags: [Terms]
 */
router.get('/:type/:version', async (req, res) => {
  const { type, version } = req.params;
  const allowed = ['tos', 'dpa', 'privacy_policy'];
  if (!allowed.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${allowed.join(', ')}` });
  }

  const doc = await prisma.legalDocument.findUnique({
    where: { type_version: { type, version } }
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  res.json(doc);
});

/**
 * @swagger
 * /api/terms/accept:
 *   post:
 *     summary: Accept a legal document version
 *     tags: [Terms]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/accept', authMiddleware, async (req, res) => {
  const { documentType, documentVersion } = req.body;

  if (!documentType || !documentVersion) {
    return res.status(400).json({ error: 'documentType and documentVersion are required' });
  }

  // Verify the document exists
  const doc = await prisma.legalDocument.findUnique({
    where: { type_version: { type: documentType, version: documentVersion } }
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Check if already accepted
  const existing = await prisma.termsAcceptance.findFirst({
    where: {
      userId: req.user.id,
      documentType,
      documentVersion
    }
  });

  if (existing) {
    return res.json({ accepted: true, acceptedAt: existing.acceptedAt, alreadyAccepted: true });
  }

  const acceptance = await prisma.termsAcceptance.create({
    data: {
      userId: req.user.id,
      documentType,
      documentVersion,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 255)
    }
  });

  logger.info({ userId: req.user.id, documentType, documentVersion }, 'Terms accepted');

  res.json({
    accepted: true,
    acceptedAt: acceptance.acceptedAt
  });
});

/**
 * @swagger
 * /api/terms/status:
 *   get:
 *     summary: Check which terms the current user has accepted
 *     tags: [Terms]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/status', authMiddleware, async (req, res) => {
  // Get all current active documents
  const activeDocs = await prisma.legalDocument.findMany({
    where: { active: true },
    select: { type: true, version: true, title: true }
  });

  // Get user's acceptances
  const acceptances = await prisma.termsAcceptance.findMany({
    where: { userId: req.user.id },
    orderBy: { acceptedAt: 'desc' }
  });

  const status = activeDocs.map(doc => {
    const accepted = acceptances.find(
      a => a.documentType === doc.type && a.documentVersion === doc.version
    );
    return {
      type: doc.type,
      version: doc.version,
      title: doc.title,
      accepted: !!accepted,
      acceptedAt: accepted?.acceptedAt || null
    };
  });

  const allAccepted = status.every(s => s.accepted);

  res.json({ allAccepted, documents: status });
});

/**
 * @swagger
 * /api/terms/documents:
 *   post:
 *     summary: Create a new legal document version (admin only)
 *     tags: [Terms]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/documents', authMiddleware, requireRole('admin'), async (req, res) => {
  const { type, version, title, content, effectiveDate } = req.body;

  if (!type || !version || !title || !content) {
    return res.status(400).json({ error: 'type, version, title, and content are required' });
  }

  const allowed = ['tos', 'dpa', 'privacy_policy'];
  if (!allowed.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${allowed.join(', ')}` });
  }

  // Deactivate previous versions of this type
  await prisma.legalDocument.updateMany({
    where: { type, active: true },
    data: { active: false }
  });

  const doc = await prisma.legalDocument.create({
    data: {
      type,
      version,
      title,
      content,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      active: true
    }
  });

  logger.info({ type, version }, 'New legal document published');

  res.status(201).json(doc);
});

module.exports = router;
