const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { activityFromReq } = require('../lib/activity');
const { enqueueAudit, getQueueStatus } = require('../lib/audit-worker');
const { requireQuota, incrementUsage } = require('../lib/billing');

const router = express.Router();
router.use(authMiddleware);

const UPLOADS_DIR = path.join(__dirname, '../uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.pdf', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}`));
  }
});

/**
 * @swagger
 * /api/audits:
 *   post:
 *     summary: Upload a contract and run a DPA audit
 *     tags: [Audits]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               contract:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Audit created and processing
 *       400:
 *         description: No file uploaded
 */
router.post('/', upload.single('contract'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No contract file uploaded' });
    }

    // Check audit quota before creating
    const { checkLimit } = require('../lib/billing');
    const quota = await checkLimit(req.user.id, 'audits');
    if (!quota.allowed) {
      // Clean up uploaded file
      fs.unlink(req.file.path, () => {});
      return res.status(402).json({
        error: `Audit quota exceeded (${quota.current}/${quota.limit}). Upgrade your plan.`,
        resource: 'audits', current: quota.current, limit: quota.limit
      });
    }

    const audit = await prisma.audit.create({
      data: {
        contractName: req.file.originalname,
        contractPath: req.file.path,
        status: 'processing',
        userId: req.user.id
      }
    });

    await activityFromReq(req, 'audit.create', req.file.originalname);
    await incrementUsage(req.user.id, 'audits');
    await incrementUsage(req.user.id, 'storage', req.file.size / (1024 * 1024));

    // Async processing via worker queue
    enqueueAudit(audit.id, req.file.path, req.user.id, req.user.email);

    res.status(202).json({
      id: audit.id,
      contractName: audit.contractName,
      status: 'processing',
      message: 'Audit queued for processing. Poll GET /api/audits/:id for status.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/audits/batch:
 *   post:
 *     summary: Upload multiple contracts for batch audit
 *     tags: [Audits]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               contracts:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       202:
 *         description: Batch audits queued
 */
router.post('/batch', upload.array('contracts', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No contract files uploaded' });
    }

    const results = [];
    for (const file of req.files) {
      const audit = await prisma.audit.create({
        data: {
          contractName: file.originalname,
          contractPath: file.path,
          status: 'processing',
          userId: req.user.id
        }
      });

      enqueueAudit(audit.id, file.path, req.user.id, req.user.email);
      results.push({ id: audit.id, contractName: file.originalname, status: 'processing' });
    }

    await activityFromReq(req, 'audit.batch', `${results.length} contracts`);
    res.status(202).json({
      audits: results,
      message: `${results.length} audits queued for processing.`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/audits/queue:
 *   get:
 *     summary: Get audit queue status
 *     tags: [Audits]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Queue status
 */
router.get('/queue', async (req, res) => {
  res.json(getQueueStatus());
});

/**
 * @swagger
 * /api/audits:
 *   get:
 *     summary: List all audits for the current user
 *     tags: [Audits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of audits
 */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    // Build filter conditions
    const where = { userId: req.user.id };
    if (req.query.status) where.status = req.query.status;
    if (req.query.risk) where.overallRisk = req.query.risk;
    if (req.query.search) where.contractName = { contains: req.query.search };
    if (req.query.from) where.createdAt = { ...(where.createdAt || {}), gte: new Date(req.query.from) };
    if (req.query.to) where.createdAt = { ...(where.createdAt || {}), lte: new Date(req.query.to) };

    // Sort
    const sortField = ['createdAt', 'riskScore', 'contractName', 'clausesDetected', 'gapsFound'].includes(req.query.sort) ? req.query.sort : 'createdAt';
    const sortDir = req.query.order === 'asc' ? 'asc' : 'desc';

    const [audits, total] = await Promise.all([
      prisma.audit.findMany({
        where,
        select: {
          id: true, contractName: true, status: true,
          clausesDetected: true, gapsFound: true,
          overallRisk: true, riskScore: true,
          createdAt: true, updatedAt: true
        },
        orderBy: { [sortField]: sortDir },
        skip,
        take: limit
      }),
      prisma.audit.count({ where })
    ]);

    res.json({ audits, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/audits/{id}:
 *   get:
 *     summary: Get a specific audit with full report
 *     tags: [Audits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Audit details with report
 *       404:
 *         description: Audit not found
 */
router.get('/:id', async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!audit) {
      return res.status(404).json({ error: 'Audit not found' });
    }

    const result = { ...audit };
    if (audit.reportJson) {
      result.report = JSON.parse(audit.reportJson);
      delete result.reportJson;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/audits/{id}:
 *   delete:
 *     summary: Delete an audit
 *     tags: [Audits]
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
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!audit) {
      return res.status(404).json({ error: 'Audit not found' });
    }

    // Clean up uploaded file
    if (audit.contractPath && fs.existsSync(audit.contractPath)) {
      fs.unlinkSync(audit.contractPath);
    }

    await prisma.audit.delete({ where: { id: audit.id } });
    await activityFromReq(req, 'audit.delete', audit.contractName);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/audits/{id}/re-audit:
 *   post:
 *     summary: Re-audit a contract (creates a new version)
 *     tags: [Audits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202:
 *         description: New version queued
 */
router.post('/:id/re-audit', async (req, res, next) => {
  try {
    const parent = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!parent) return res.status(404).json({ error: 'Audit not found' });
    if (!parent.contractPath || !fs.existsSync(parent.contractPath)) {
      return res.status(400).json({ error: 'Original contract file no longer available' });
    }

    // Find highest version for this contract chain
    const rootId = parent.parentId || parent.id;
    const siblings = await prisma.audit.findMany({
      where: {
        userId: req.user.id,
        OR: [{ id: rootId }, { parentId: rootId }]
      },
      select: { version: true }
    });
    const maxVersion = Math.max(...siblings.map(s => s.version), parent.version);

    const newAudit = await prisma.audit.create({
      data: {
        contractName: parent.contractName,
        contractPath: parent.contractPath,
        status: 'processing',
        version: maxVersion + 1,
        parentId: rootId,
        userId: req.user.id,
        orgId: parent.orgId
      }
    });

    await activityFromReq(req, 'audit.re-audit', `${parent.contractName} v${newAudit.version}`);
    enqueueAudit(newAudit.id, parent.contractPath, req.user.id, req.user.email);

    res.status(202).json({
      id: newAudit.id,
      contractName: newAudit.contractName,
      version: newAudit.version,
      parentId: newAudit.parentId,
      status: 'processing',
      message: `Re-audit queued as version ${newAudit.version}.`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/audits/{id}/versions:
 *   get:
 *     summary: Get all versions of an audit
 *     tags: [Audits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Version history
 */
router.get('/:id/versions', async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    const rootId = audit.parentId || audit.id;
    const versions = await prisma.audit.findMany({
      where: {
        userId: req.user.id,
        OR: [{ id: rootId }, { parentId: rootId }]
      },
      select: {
        id: true, contractName: true, status: true, version: true,
        overallRisk: true, riskScore: true, clausesDetected: true,
        gapsFound: true, createdAt: true
      },
      orderBy: { version: 'desc' }
    });

    res.json({ rootId, versions });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/audits/{id}/tags:
 *   patch:
 *     summary: Update audit tags
 *     tags: [Audits]
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
 *             required: [tags]
 *             properties:
 *               tags:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Tags updated
 */
router.patch('/:id/tags', async (req, res, next) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'tags must be an array of strings' });
    }
    // Sanitize: lowercase, trim, unique, max 10
    const cleaned = [...new Set(tags.map(t => String(t).trim().toLowerCase()).filter(t => t.length > 0 && t.length <= 50))].slice(0, 10);

    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    const updated = await prisma.audit.update({
      where: { id: req.params.id },
      data: { tags: cleaned.join(',') }
    });

    res.json({ id: updated.id, tags: updated.tags ? updated.tags.split(',').filter(Boolean) : [] });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/audits/{id}/diff/{compareId}:
 *   get:
 *     summary: Diff two audit versions
 *     tags: [Audits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: compareId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Diff between two audit versions
 */
router.get('/:id/diff/:compareId', async (req, res, next) => {
  try {
    const [a, b] = await Promise.all([
      prisma.audit.findFirst({ where: { id: req.params.id, userId: req.user.id } }),
      prisma.audit.findFirst({ where: { id: req.params.compareId, userId: req.user.id } })
    ]);
    if (!a || !b) return res.status(404).json({ error: 'One or both audits not found' });

    const reportA = a.reportJson ? JSON.parse(a.reportJson) : null;
    const reportB = b.reportJson ? JSON.parse(b.reportJson) : null;

    const diff = {
      meta: {
        left: { id: a.id, version: a.version, contractName: a.contractName, createdAt: a.createdAt },
        right: { id: b.id, version: b.version, contractName: b.contractName, createdAt: b.createdAt }
      },
      riskScore: { left: a.riskScore, right: b.riskScore, delta: (b.riskScore || 0) - (a.riskScore || 0) },
      overallRisk: { left: a.overallRisk, right: b.overallRisk, changed: a.overallRisk !== b.overallRisk },
      clausesDetected: { left: a.clausesDetected, right: b.clausesDetected, delta: b.clausesDetected - a.clausesDetected },
      gapsFound: { left: a.gapsFound, right: b.gapsFound, delta: b.gapsFound - a.gapsFound },
      clauses: []
    };

    // Compare clause-by-clause if both have reports
    if (reportA?.clause_scores && reportB?.clause_scores) {
      const allClauses = new Set([
        ...Object.keys(reportA.clause_scores),
        ...Object.keys(reportB.clause_scores)
      ]);
      for (const clause of allClauses) {
        const scoreA = reportA.clause_scores[clause];
        const scoreB = reportB.clause_scores[clause];
        diff.clauses.push({
          clause,
          left: scoreA ?? null,
          right: scoreB ?? null,
          delta: (scoreB || 0) - (scoreA || 0),
          status: !scoreA ? 'added' : !scoreB ? 'removed' : scoreA !== scoreB ? 'changed' : 'unchanged'
        });
      }
    }

    res.json(diff);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/audits/{id}/compliance:
 *   get:
 *     summary: Generate compliance summary report
 *     tags: [Audits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Compliance summary report
 */
router.get('/:id/compliance', async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    if (audit.status !== 'complete') {
      return res.status(400).json({ error: 'Audit not complete yet' });
    }

    const report = audit.reportJson ? JSON.parse(audit.reportJson) : {};
    const clauseScores = report.clause_scores || {};
    const gaps = report.gaps || [];
    const remediations = report.remediation || [];

    const totalClauses = Object.keys(clauseScores).length;
    const strongClauses = Object.entries(clauseScores).filter(([, s]) => s >= 80);
    const weakClauses = Object.entries(clauseScores).filter(([, s]) => s > 0 && s < 50);
    const missingClauses = Object.entries(clauseScores).filter(([, s]) => s === 0);

    const compliance = {
      generatedAt: new Date().toISOString(),
      audit: {
        id: audit.id,
        contractName: audit.contractName,
        version: audit.version,
        auditDate: audit.createdAt,
        overallRisk: audit.overallRisk,
        riskScore: audit.riskScore
      },
      summary: {
        totalClauses,
        compliant: strongClauses.length,
        partial: totalClauses - strongClauses.length - missingClauses.length,
        nonCompliant: missingClauses.length,
        complianceRate: totalClauses > 0 ? Math.round((strongClauses.length / totalClauses) * 100) : 0,
        gapsIdentified: gaps.length,
        remediationsAvailable: remediations.length
      },
      clauseBreakdown: Object.entries(clauseScores).map(([clause, score]) => ({
        clause,
        score,
        status: score >= 80 ? 'compliant' : score >= 50 ? 'partial' : score > 0 ? 'weak' : 'missing',
        gaps: gaps.filter(g => g.clause === clause),
        remediation: remediations.find(r => r.clause === clause)
      })),
      criticalFindings: weakClauses.concat(missingClauses).map(([clause, score]) => ({
        clause,
        score,
        severity: score === 0 ? 'critical' : 'high',
        recommendation: remediations.find(r => r.clause === clause)?.suggestion || 'Review and strengthen this clause'
      })),
      frameworks: report.framework_details || {}
    };

    res.json(compliance);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
