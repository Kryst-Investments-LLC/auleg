const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { activityFromReq } = require('../lib/activity');

const router = express.Router();
router.use(authMiddleware);

// Sanitize a cell value to prevent CSV formula injection
function csvSafe(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  // If the cell starts with a formula trigger char, prefix with a single quote
  if (/^[=+\-@\t\r]/.test(str)) return "'" + str;
  return str;
}

function csvCell(val) {
  const safe = csvSafe(val);
  // Escape double quotes and wrap in double quotes
  return '"' + safe.replace(/"/g, '""') + '"';
}

/**
 * @swagger
 * /api/export/{id}/json:
 *   get:
 *     summary: Download audit report as JSON
 *     tags: [Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: JSON file download
 */
router.get('/:id/json', async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    if (!audit.reportJson) return res.status(404).json({ error: 'No report available' });

    const safeName = audit.contractName.replace(/[^a-zA-Z0-9._-]/g, '_');
    await activityFromReq(req, 'export', `${safeName} as JSON`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${safeName}.json"`);
    res.send(audit.reportJson);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/export/{id}/csv:
 *   get:
 *     summary: Download audit report as CSV
 *     tags: [Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: CSV file download
 */
router.get('/:id/csv', async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    if (!audit.reportJson) return res.status(404).json({ error: 'No report available' });

    const report = JSON.parse(audit.reportJson);
    const lines = [];

    // Clause scores
    lines.push('Section,Clause,Severity,Likelihood,Regulatory Exposure,Score');
    const scores = report.risk_profile?.clause_scores || [];
    scores.forEach(c => {
      lines.push(`${csvCell('Clause Scores')},${csvCell(c.clause)},${csvCell(c.severity)},${csvCell(c.likelihood)},${csvCell(c.regulatory_exposure)},${csvCell(c.score)}`);
    });

    // Compliance matrix
    lines.push('');
    lines.push('Section,Clause,Framework References');
    const matrix = report.compliance_matrix || {};
    Object.entries(matrix).forEach(([clause, refs]) => {
      const refStr = Array.isArray(refs) ? refs.join('; ') : '';
      lines.push(`${csvCell('Compliance')},${csvCell(clause)},${csvCell(refStr)}`);
    });

    // Gap report
    lines.push('');
    lines.push('Section,Missing Clause');
    const gaps = report.gap_report || [];
    if (gaps.length === 0) {
      lines.push(`${csvCell('Gaps')},${csvCell('None')}`);
    } else {
      gaps.forEach(g => lines.push(`${csvCell('Gaps')},${csvCell(g)}`));
    }

    // Remediation plan
    lines.push('');
    lines.push('Section,Clause,Action,Severity,Risk Score,References');
    const plan = report.remediation_plan || [];
    plan.forEach(r => {
      const refs = (r.references || []).join('; ');
      lines.push(`${csvCell('Remediation')},${csvCell(r.clause)},${csvCell(r.action)},${csvCell(r.severity || '')},${csvCell(r.risk_score || '')},${csvCell(refs)}`);
    });

    // Summary
    lines.push('');
    lines.push('Section,Key,Value');
    lines.push(`${csvCell('Summary')},${csvCell('Overall Risk')},${csvCell(report.risk_profile?.overall_risk || '')}`);
    lines.push(`${csvCell('Summary')},${csvCell('Risk Score')},${csvCell(report.risk_profile?.score || '')}`);
    lines.push(`${csvCell('Summary')},${csvCell('Clauses Detected')},${csvCell(Object.keys(report.clauses || {}).length)}`);
    lines.push(`${csvCell('Summary')},${csvCell('Gaps Found')},${csvCell(gaps.length)}`);
    lines.push(`${csvCell('Summary')},${csvCell('Generated')},${csvCell(report.generated || '')}`);

    const csv = lines.join('\n');
    const safeName = audit.contractName.replace(/[^a-zA-Z0-9._-]/g, '_');
    await activityFromReq(req, 'export', `${safeName} as CSV`);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${safeName}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/export/compare:
 *   post:
 *     summary: Compare two audit reports side by side
 *     tags: [Export]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [auditA, auditB]
 *             properties:
 *               auditA: { type: string, description: Audit ID A }
 *               auditB: { type: string, description: Audit ID B }
 *     responses:
 *       200:
 *         description: Comparison result
 */
router.post('/compare', async (req, res, next) => {
  try {
    const { auditA, auditB } = req.body;
    if (!auditA || !auditB) {
      return res.status(400).json({ error: 'Two audit IDs required (auditA, auditB)' });
    }

    const [a, b] = await Promise.all([
      prisma.audit.findFirst({ where: { id: auditA, userId: req.user.id } }),
      prisma.audit.findFirst({ where: { id: auditB, userId: req.user.id } })
    ]);

    if (!a) return res.status(404).json({ error: 'Audit A not found' });
    if (!b) return res.status(404).json({ error: 'Audit B not found' });
    if (!a.reportJson || !b.reportJson) {
      return res.status(400).json({ error: 'Both audits must have completed reports' });
    }

    const reportA = JSON.parse(a.reportJson);
    const reportB = JSON.parse(b.reportJson);

    const clausesA = new Set(Object.keys(reportA.clauses || {}));
    const clausesB = new Set(Object.keys(reportB.clauses || {}));
    const allClauses = new Set([...clausesA, ...clausesB]);

    const clauseComparison = [];
    for (const clause of allClauses) {
      const inA = clausesA.has(clause);
      const inB = clausesB.has(clause);
      const scoreA = reportA.risk_profile?.clause_scores?.find(c => c.clause === clause);
      const scoreB = reportB.risk_profile?.clause_scores?.find(c => c.clause === clause);

      clauseComparison.push({
        clause,
        inA,
        inB,
        scoreA: scoreA?.score ?? null,
        scoreB: scoreB?.score ?? null,
        delta: scoreA && scoreB ? scoreB.score - scoreA.score : null
      });
    }

    const gapsA = new Set(reportA.gap_report || []);
    const gapsB = new Set(reportB.gap_report || []);

    const comparison = {
      summary: {
        a: { id: a.id, name: a.contractName, risk: a.overallRisk, score: a.riskScore, clauses: a.clausesDetected, gaps: a.gapsFound, date: a.createdAt },
        b: { id: b.id, name: b.contractName, risk: b.overallRisk, score: b.riskScore, clauses: b.clausesDetected, gaps: b.gapsFound, date: b.createdAt },
        scoreDelta: (b.riskScore ?? 0) - (a.riskScore ?? 0)
      },
      clauseComparison,
      gapChanges: {
        fixed: [...gapsA].filter(g => !gapsB.has(g)),
        new: [...gapsB].filter(g => !gapsA.has(g)),
        remaining: [...gapsA].filter(g => gapsB.has(g))
      },
      remediationA: reportA.remediation_plan || [],
      remediationB: reportB.remediation_plan || []
    };

    await activityFromReq(req, 'compare', `${a.contractName} vs ${b.contractName}`);
    res.json(comparison);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
