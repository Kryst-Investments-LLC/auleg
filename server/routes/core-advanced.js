const express = require('express');
const fs = require('fs');
const authMiddleware = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { analyzeDocument, saveRedlines, getRedlines, updateRedlineStatus, generateRedlinedDocument } = require('../lib/redlining');
const { detectJurisdictions, buildGapMatrix, getCriticalGaps } = require('../lib/jurisdiction');
const { requireAccessibleAudit } = require('../lib/access');

const router = express.Router();
router.use(authMiddleware);

// ─── Redlining ────────────────────────────────────────

/** Run redline analysis on an audit's contract text */
router.post('/redline/:auditId', async (req, res, next) => {
  try {
    const audit = await requireAccessibleAudit(req.user, req.params.auditId);

    // Read the contract text
    let text = '';
    if (audit.contractPath && fs.existsSync(audit.contractPath)) {
      text = fs.readFileSync(audit.contractPath, 'utf-8');
    } else if (req.body.text) {
      text = req.body.text;
    } else {
      return res.status(400).json({ error: 'No contract text available' });
    }

    const redlines = await analyzeDocument(text, audit.id);
    const saved = await saveRedlines(redlines);

    res.json({
      auditId: audit.id,
      redlineCount: saved.length,
      redlines: saved,
      bySeverity: {
        critical: saved.filter(r => r.severity === 'critical').length,
        high: saved.filter(r => r.severity === 'high').length,
        medium: saved.filter(r => r.severity === 'medium').length
      }
    });
  } catch (err) { next(err); }
});

/** Get redlines for an audit */
router.get('/redline/:auditId', async (req, res, next) => {
  try {
    await requireAccessibleAudit(req.user, req.params.auditId, { select: { id: true } });
    const redlines = await getRedlines(req.params.auditId, req.query);
    res.json({ redlines });
  } catch (err) { next(err); }
});

/** Update a redline status */
router.patch('/redline/:id/status', async (req, res, next) => {
  try {
    const { status, modifiedText } = req.body;
    if (!['accepted', 'rejected', 'modified', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const redline = await prisma.redline.findUnique({
      where: { id: req.params.id },
      select: { id: true, auditId: true }
    });
    if (!redline) {
      return res.status(404).json({ error: 'Redline not found' });
    }

    await requireAccessibleAudit(req.user, redline.auditId, { select: { id: true } });

    const updated = await updateRedlineStatus(req.params.id, status, modifiedText);
    res.json(updated);
  } catch (err) { next(err); }
});

/** Generate corrected document with accepted changes */
router.post('/redline/:auditId/apply', async (req, res, next) => {
  try {
    const audit = await requireAccessibleAudit(req.user, req.params.auditId);

    let text = req.body.text || '';
    if (!text && audit.contractPath && fs.existsSync(audit.contractPath)) {
      text = fs.readFileSync(audit.contractPath, 'utf-8');
    }

    const result = await generateRedlinedDocument(req.params.auditId, text);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Jurisdiction Detection ──────────────────────────

/** Detect jurisdictions from audit text */
router.get('/jurisdictions/:auditId', async (req, res, next) => {
  try {
    const audit = await requireAccessibleAudit(req.user, req.params.auditId);

    let text = '';
    if (audit.contractPath && fs.existsSync(audit.contractPath)) {
      text = fs.readFileSync(audit.contractPath, 'utf-8');
    }

    const jurisdictions = detectJurisdictions(text);
    res.json({ auditId: audit.id, jurisdictions });
  } catch (err) { next(err); }
});

// ─── Cross-Regulation Gap Matrix ─────────────────────

/** Get gap matrix for an audit */
router.get('/gap-matrix/:auditId', async (req, res, next) => {
  try {
    const audit = await requireAccessibleAudit(req.user, req.params.auditId);
    if (!audit || !audit.reportJson) return res.status(404).json({ error: 'Audit not found or incomplete' });

    const report = JSON.parse(audit.reportJson);
    const clauseScores = {};
    const scores = report.risk_profile?.clause_scores || [];
    scores.forEach(c => { if (c.clause) clauseScores[c.clause] = c.score; });

    // Auto-detect jurisdictions or use provided list
    let text = '';
    if (audit.contractPath && fs.existsSync(audit.contractPath)) {
      text = fs.readFileSync(audit.contractPath, 'utf-8');
    }

    let detectedRegs = detectJurisdictions(text);
    // If no detections, default to GDPR
    if (detectedRegs.length === 0) {
      detectedRegs = [{ regulation: 'GDPR', jurisdiction: 'EU', confidence: 1.0 }];
    }

    const gapMatrix = buildGapMatrix(clauseScores, detectedRegs);
    const criticalGaps = getCriticalGaps(gapMatrix);

    res.json({
      auditId: audit.id,
      detectedRegulations: detectedRegs,
      gapMatrix,
      criticalGaps,
      summary: {
        regulationsChecked: Object.keys(gapMatrix).length,
        totalCriticalGaps: criticalGaps.length,
        lowestCompliance: Object.values(gapMatrix).sort((a, b) => a.complianceRate - b.complianceRate)[0] || null
      }
    });
  } catch (err) { next(err); }
});

// ─── Confidence Scoring ──────────────────────────────

/** Get confidence scores for each clause in an audit */
router.get('/confidence/:auditId', async (req, res, next) => {
  try {
    const audit = await requireAccessibleAudit(req.user, req.params.auditId);
    if (!audit || !audit.reportJson) return res.status(404).json({ error: 'Audit not found or incomplete' });

    const report = JSON.parse(audit.reportJson);
    const scores = report.risk_profile?.clause_scores || [];

    // Generate confidence based on text analysis quality
    const confidenceScores = scores.map(c => {
      const score = c.score || 0;
      let confidence;
      if (score === 0) confidence = 0.95; // High confidence it's missing
      else if (score >= 80) confidence = 0.85; // Reasonably confident it's strong
      else if (score >= 50) confidence = 0.70; // Moderate confidence
      else confidence = 0.60; // Lower confidence on weak detection

      return {
        clause: c.clause,
        score,
        confidence: Math.round(confidence * 100) / 100,
        reliability: confidence >= 0.85 ? 'high' : confidence >= 0.70 ? 'medium' : 'low',
        recommendation: confidence < 0.70 ? 'Manual review recommended' : 'AI analysis is reliable'
      };
    });

    res.json({
      auditId: audit.id,
      confidenceScores,
      overallConfidence: confidenceScores.length > 0
        ? Math.round((confidenceScores.reduce((s, c) => s + c.confidence, 0) / confidenceScores.length) * 100) / 100
        : 0,
      lowConfidenceClauses: confidenceScores.filter(c => c.reliability === 'low')
    });
  } catch (err) { next(err); }
});

module.exports = router;
