/**
 * Public API v1 Routes
 * Versioned, scope-enforced endpoints for external integrations.
 * All endpoints accept JWT or API key authentication.
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireScope } = require('../middleware/scope');
const prisma = require('../lib/prisma');
const { enqueueAudit } = require('../lib/audit-worker');
const ai = require('../lib/ai');
const { normalizeAndValidateOutboundUrl } = require('../lib/url-security');

router.use(auth);

const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${crypto.randomUUID()}-${safeName}`);
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

// Helper: extract clause scores
function getClauseScoreMap(report) {
  if (report.clause_scores && typeof report.clause_scores === 'object' && !Array.isArray(report.clause_scores) && Object.keys(report.clause_scores).length > 0) {
    return report.clause_scores;
  }
  const arr = (report.risk_profile && report.risk_profile.clause_scores) || [];
  const map = {};
  arr.forEach(c => { if (c.clause) map[c.clause] = c.score != null ? c.score : 0; });
  return map;
}

// ========== AUDITS ==========

/**
 * @swagger
 * /api/v1/audits:
 *   get:
 *     summary: List audits (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, processing, complete, failed] }
 *       - in: query
 *         name: risk
 *         schema: { type: string, enum: [Low, Moderate, High, Critical] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 */
router.get('/audits', requireScope('audits:read'), async (req, res, next) => {
  try {
    const where = { userId: req.user.id };
    if (req.query.status) where.status = req.query.status;
    if (req.query.risk) where.overallRisk = req.query.risk;

    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = parseInt(req.query.offset) || 0;

    const [audits, total] = await Promise.all([
      prisma.audit.findMany({
        where,
        select: {
          id: true, contractName: true, status: true, overallRisk: true,
          riskScore: true, clausesDetected: true, gapsFound: true,
          version: true, tags: true, createdAt: true, updatedAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      }),
      prisma.audit.count({ where })
    ]);

    res.json({
      data: audits.map(a => ({
        ...a,
        tags: a.tags ? a.tags.split(',').filter(Boolean) : []
      })),
      pagination: { total, limit, offset, hasMore: offset + limit < total }
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/audits/{id}:
 *   get:
 *     summary: Get audit detail (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/audits/:id', requireScope('audits:read'), async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    const result = {
      id: audit.id, contractName: audit.contractName, status: audit.status,
      overallRisk: audit.overallRisk, riskScore: audit.riskScore,
      clausesDetected: audit.clausesDetected, gapsFound: audit.gapsFound,
      version: audit.version, tags: audit.tags ? audit.tags.split(',').filter(Boolean) : [],
      createdAt: audit.createdAt, updatedAt: audit.updatedAt
    };

    if (audit.reportJson) {
      result.report = JSON.parse(audit.reportJson);
    }

    res.json({ data: result });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/audits:
 *   post:
 *     summary: Upload and audit a contract (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/audits', requireScope('audits:write'), upload.single('contract'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No contract file uploaded' });

    const audit = await prisma.audit.create({
      data: {
        contractName: req.file.originalname,
        contractPath: req.file.path,
        userId: req.user.id,
        orgId: req.user.orgId || null,
        status: 'processing'
      }
    });

    enqueueAudit(audit.id, req.file.path, audit.contractName, req.user.id);

    res.status(202).json({
      data: {
        id: audit.id,
        contractName: audit.contractName,
        status: 'processing',
        message: 'Audit queued for processing'
      }
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/audits/{id}/report:
 *   get:
 *     summary: Download audit report (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/audits/:id/report', requireScope('audits:read'), async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    if (!audit.reportJson) return res.status(404).json({ error: 'Report not available yet' });

    const format = req.query.format || 'json';
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit-${audit.id}.json"`);
      return res.send(audit.reportJson);
    }
    // CSV format
    const report = JSON.parse(audit.reportJson);
    const scores = getClauseScoreMap(report);
    let csv = 'clause,score,status\n';
    Object.entries(scores).forEach(([clause, score]) => {
      const status = score >= 80 ? 'compliant' : score >= 50 ? 'partial' : score > 0 ? 'weak' : 'missing';
      csv += `${clause},${score},${status}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${audit.id}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// ========== AI ==========

/**
 * @swagger
 * /api/v1/audits/{id}/ai/summary:
 *   post:
 *     summary: AI executive summary (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/audits/:id/ai/summary', requireScope('audits:read'), async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    if (audit.status !== 'complete' || !audit.reportJson) {
      return res.status(400).json({ error: 'Audit must be complete' });
    }
    const report = JSON.parse(audit.reportJson);
    const summary = ai.generateExecutiveSummary(audit, report);
    res.json({ data: { auditId: audit.id, summary } });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/audits/{id}/ai/analyze:
 *   post:
 *     summary: AI clause analysis (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/audits/:id/ai/analyze', requireScope('audits:read'), async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    if (audit.status !== 'complete' || !audit.reportJson) {
      return res.status(400).json({ error: 'Audit must be complete' });
    }
    const report = JSON.parse(audit.reportJson);
    const clauseScores = getClauseScoreMap(report);
    const { clause } = req.body || {};
    if (clause) {
      const score = clauseScores[clause];
      if (score === undefined) return res.status(404).json({ error: `Clause "${clause}" not found` });
      return res.json({ data: ai.analyzeClause(clause, score, report) });
    }
    const analyses = Object.entries(clauseScores).map(([c, s]) => ai.analyzeClause(c, s, report));
    res.json({ data: analyses });
  } catch (err) { next(err); }
});

// ========== WEBHOOKS ==========

/**
 * @swagger
 * /api/v1/webhooks:
 *   get:
 *     summary: List webhooks (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/webhooks', requireScope('webhooks:read'), async (req, res, next) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { userId: req.user.id },
      select: { id: true, url: true, events: true, active: true, createdAt: true, updatedAt: true }
    });
    res.json({
      data: webhooks.map(w => ({ ...w, events: w.events.split(',') }))
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/webhooks/{id}/deliveries:
 *   get:
 *     summary: List webhook delivery attempts (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/webhooks/:id/deliveries', requireScope('webhooks:read'), async (req, res, next) => {
  try {
    const webhook = await prisma.webhook.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = parseInt(req.query.offset) || 0;

    const [deliveries, total] = await Promise.all([
      prisma.webhookDelivery.findMany({
        where: { webhookId: webhook.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      }),
      prisma.webhookDelivery.count({ where: { webhookId: webhook.id } })
    ]);

    res.json({
      data: deliveries,
      pagination: { total, limit, offset, hasMore: offset + limit < total }
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/webhooks/{id}/deliveries/{deliveryId}/retry:
 *   post:
 *     summary: Retry a failed webhook delivery (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/webhooks/:id/deliveries/:deliveryId/retry', requireScope('webhooks:write'), async (req, res, next) => {
  try {
    const webhook = await prisma.webhook.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    const delivery = await prisma.webhookDelivery.findFirst({
      where: { id: req.params.deliveryId, webhookId: webhook.id }
    });
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

    // Re-dispatch the webhook payload
    const crypto = require('crypto');
    const payload = delivery.payload;
    const signature = crypto.createHmac('sha256', webhook.secret).update(payload).digest('hex');
    const safeUrl = await normalizeAndValidateOutboundUrl(webhook.url);

    let status = 'failed', statusCode = null, response = null, error = null;
    try {
      const resp = await fetch(safeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': delivery.event,
          'X-Delivery-Id': delivery.id
        },
        body: payload,
        signal: AbortSignal.timeout(10000)
      });
      statusCode = resp.status;
      response = (await resp.text()).substring(0, 500);
      status = resp.ok ? 'success' : 'failed';
    } catch (e) {
      error = e.message;
    }

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status, statusCode, response, error, attempts: delivery.attempts + 1, updatedAt: new Date() }
    });

    res.json({ data: { id: delivery.id, status, statusCode, attempts: delivery.attempts + 1 } });
  } catch (err) { next(err); }
});

// ========== TEMPLATES ==========

/**
 * @swagger
 * /api/v1/templates:
 *   get:
 *     summary: List audit templates (Public API v1)
 *     tags: [Public API v1]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/templates', requireScope('templates:read'), async (req, res, next) => {
  try {
    const templates = await prisma.auditTemplate.findMany({
      where: { userId: req.user.id }
    });
    res.json({
      data: templates.map(t => ({
        ...t,
        clauseTypes: t.clauseTypes.split(','),
        frameworks: t.frameworks.split(',')
      }))
    });
  } catch (err) { next(err); }
});

// ========== INTEGRATIONS ==========

/**
 * @swagger
 * /api/v1/integrations/zapier:
 *   post:
 *     summary: Zapier-compatible trigger check endpoint
 *     tags: [Public API v1 - Integrations]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/integrations/zapier', requireScope('audits:read'), async (req, res, next) => {
  try {
    // Zapier polls this to check for new completed audits
    const since = req.body.since ? new Date(req.body.since) : new Date(Date.now() - 86400000);
    const audits = await prisma.audit.findMany({
      where: {
        userId: req.user.id,
        status: 'complete',
        createdAt: { gte: since }
      },
      select: {
        id: true, contractName: true, overallRisk: true, riskScore: true,
        clausesDetected: true, gapsFound: true, createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    res.json(audits);
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/integrations/slack:
 *   post:
 *     summary: Generate Slack message payload for an audit
 *     tags: [Public API v1 - Integrations]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/integrations/slack', requireScope('audits:read'), async (req, res, next) => {
  try {
    const { auditId } = req.body;
    if (!auditId) return res.status(400).json({ error: 'auditId is required' });

    const audit = await prisma.audit.findFirst({
      where: { id: auditId, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    const riskEmoji = {
      Low: ':white_check_mark:',
      Moderate: ':warning:',
      High: ':x:',
      Critical: ':rotating_light:'
    };

    const slackPayload = {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `DPA Audit: ${audit.contractName}` }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Risk Level:*\n${riskEmoji[audit.overallRisk] || ''} ${audit.overallRisk || 'N/A'}` },
            { type: 'mrkdwn', text: `*Risk Score:*\n${audit.riskScore ?? 'N/A'}/100` },
            { type: 'mrkdwn', text: `*Clauses Detected:*\n${audit.clausesDetected}` },
            { type: 'mrkdwn', text: `*Gaps Found:*\n${audit.gapsFound}` }
          ]
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Audited: ${new Date(audit.createdAt).toISOString()} | ID: ${audit.id}` }
          ]
        }
      ]
    };

    res.json({ data: slackPayload });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/integrations/csv-export:
 *   post:
 *     summary: Bulk export audits as CSV
 *     tags: [Public API v1 - Integrations]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/integrations/csv-export', requireScope('audits:read'), async (req, res, next) => {
  try {
    const { auditIds, status, risk } = req.body;
    const where = { userId: req.user.id };
    if (auditIds && Array.isArray(auditIds)) where.id = { in: auditIds };
    if (status) where.status = status;
    if (risk) where.overallRisk = risk;

    const audits = await prisma.audit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500
    });

    let csv = 'id,contractName,status,overallRisk,riskScore,clausesDetected,gapsFound,version,createdAt\n';
    audits.forEach(a => {
      csv += `${a.id},"${a.contractName}",${a.status},${a.overallRisk || ''},${a.riskScore ?? ''},${a.clausesDetected},${a.gapsFound},${a.version},${a.createdAt.toISOString()}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audits-export.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

module.exports = router;
