const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const prisma = require('../lib/prisma');
const ai = require('../lib/ai');

// Helper: extract clause scores as {clauseName: score} from report
function getClauseScoreMap(report) {
  // Check top-level clause_scores object first
  if (report.clause_scores && typeof report.clause_scores === 'object' && !Array.isArray(report.clause_scores) && Object.keys(report.clause_scores).length > 0) {
    return report.clause_scores;
  }
  // Fall back to risk_profile.clause_scores array
  const arr = report.risk_profile?.clause_scores || [];
  const map = {};
  arr.forEach(c => { if (c.clause) map[c.clause] = c.score ?? 0; });
  return map;
}

/**
 * @swagger
 * /api/ai/summary/{id}:
 *   post:
 *     summary: Generate AI executive summary for an audit
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 */
router.post('/summary/:id', auth, async (req, res) => {
  const audit = await prisma.audit.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  if (audit.status !== 'complete' || !audit.reportJson) {
    return res.status(400).json({ error: 'Audit must be complete with a report' });
  }
  const report = JSON.parse(audit.reportJson);
  const summary = ai.generateExecutiveSummary(audit, report);
  res.json({ auditId: audit.id, summary });
});

/**
 * @swagger
 * /api/ai/analyze/{id}:
 *   post:
 *     summary: AI deep-dive analysis of audit clauses
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 */
router.post('/analyze/:id', auth, async (req, res) => {
  const audit = await prisma.audit.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  if (audit.status !== 'complete' || !audit.reportJson) {
    return res.status(400).json({ error: 'Audit must be complete with a report' });
  }
  const report = JSON.parse(audit.reportJson);
  const clauseScores = getClauseScoreMap(report);

  const clause = req.body.clause;
  if (clause) {
    const score = clauseScores[clause] ?? null;
    if (score === null) return res.status(404).json({ error: `Clause "${clause}" not found in report` });
    const analysis = ai.analyzeClause(clause, score, report);
    return res.json({ auditId: audit.id, analysis });
  }

  const analyses = Object.entries(clauseScores).map(([c, s]) => ai.analyzeClause(c, s, report));
  res.json({ auditId: audit.id, analyses });
});

/**
 * @swagger
 * /api/ai/remediate/{id}:
 *   post:
 *     summary: Generate AI remediation plan for audit gaps
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 */
router.post('/remediate/:id', auth, async (req, res) => {
  const audit = await prisma.audit.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  if (audit.status !== 'complete' || !audit.reportJson) {
    return res.status(400).json({ error: 'Audit must be complete with a report' });
  }
  const report = JSON.parse(audit.reportJson);
  const plan = ai.generateRemediationPlan(audit, report);
  res.json({ auditId: audit.id, plan });
});

/**
 * @swagger
 * /api/ai/explain/{id}:
 *   post:
 *     summary: AI risk explanation for an audit
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 */
router.post('/explain/:id', auth, async (req, res) => {
  const audit = await prisma.audit.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  if (audit.status !== 'complete' || !audit.reportJson) {
    return res.status(400).json({ error: 'Audit must be complete with a report' });
  }
  const report = JSON.parse(audit.reportJson);
  const explanation = ai.explainRisk(audit, report);
  res.json({ auditId: audit.id, explanation });
});

/**
 * @swagger
 * /api/ai/search:
 *   post:
 *     summary: Natural language search across audits
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               query:
 *                 type: string
 */
router.post('/search', auth, async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query string is required' });
  }
  const parsed = ai.parseNaturalLanguageQuery(query);

  const where = { userId: req.user.id };
  if (parsed.filters.status) where.status = parsed.filters.status;
  if (parsed.filters.risk) where.overallRisk = parsed.filters.risk;
  if (parsed.filters.from) where.createdAt = { gte: new Date(parsed.filters.from) };
  if (parsed.filters.search) where.contractName = { contains: parsed.filters.search };

  const orderBy = {};
  if (parsed.filters.sort) {
    orderBy[parsed.filters.sort] = parsed.filters.order || 'desc';
  } else {
    orderBy.createdAt = 'desc';
  }

  const audits = await prisma.audit.findMany({
    where,
    orderBy,
    take: 50,
    select: {
      id: true, contractName: true, status: true, overallRisk: true,
      riskScore: true, createdAt: true, version: true
    }
  });

  // If clauseFocus filter, enrich with clause scores
  let results = audits;
  if (parsed.filters.clauseFocus) {
    const clause = parsed.filters.clauseFocus;
    const enriched = [];
    for (const a of audits) {
      const full = await prisma.audit.findUnique({ where: { id: a.id } });
      if (full.reportJson) {
        const r = JSON.parse(full.reportJson);
        const score = (r.clause_scores || {})[clause];
        if (score !== undefined) {
          enriched.push({ ...a, clauseScore: score, clauseFocus: clause });
        }
      }
    }
    results = enriched.sort((a, b) => a.clauseScore - b.clauseScore);
  }

  res.json({
    query,
    interpretation: parsed.explanation.trim(),
    filters: parsed.filters,
    count: results.length,
    results
  });
});

module.exports = router;
