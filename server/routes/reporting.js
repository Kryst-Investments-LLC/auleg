const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  generateBoardReport, issueCertificate, getCertificates, getCertificate,
  verifyCertificate, revokeCertificate, logEvidence, getEvidenceTrail,
  generateEvidencePack, updateBenchmarks, getBenchmarks, getPercentileRank,
  autoApplyRemediation
} = require('../lib/reporting');

const router = express.Router();

// ─── Board Reports ────────────────────────────────────

router.get('/board-report/:auditId', authMiddleware, async (req, res, next) => {
  try {
    const report = await generateBoardReport(req.params.auditId);
    res.json(report);
  } catch (err) { next(err); }
});

// ─── Compliance Certificates ──────────────────────────

router.post('/certificates', authMiddleware, async (req, res, next) => {
  try {
    const cert = await issueCertificate(req.body.auditId, req.user.id, req.body);
    res.status(201).json(cert);
  } catch (err) { next(err); }
});

router.get('/certificates', authMiddleware, async (req, res, next) => {
  try {
    const certs = await getCertificates(req.user.id);
    res.json({ certificates: certs });
  } catch (err) { next(err); }
});

router.get('/certificates/:id', authMiddleware, async (req, res, next) => {
  try {
    const cert = await getCertificate(req.params.id);
    if (!cert) return res.status(404).json({ error: 'Not found' });
    res.json(cert);
  } catch (err) { next(err); }
});

/** Public verification endpoint */
router.get('/verify/:certNumber', async (req, res, next) => {
  try {
    const result = await verifyCertificate(req.params.certNumber);
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/certificates/:id', authMiddleware, async (req, res, next) => {
  try {
    await revokeCertificate(req.params.id);
    res.json({ message: 'Certificate revoked' });
  } catch (err) { next(err); }
});

// ─── Audit Evidence Trail ─────────────────────────────

router.get('/evidence/:auditId', authMiddleware, async (req, res, next) => {
  try {
    const trail = await getEvidenceTrail(req.params.auditId);
    res.json({ evidence: trail });
  } catch (err) { next(err); }
});

router.post('/evidence', authMiddleware, async (req, res, next) => {
  try {
    const { auditId, action, detail, metadata } = req.body;
    const entry = await logEvidence(auditId, action, req.user.id, req.user.name || req.user.email, detail, metadata);
    res.status(201).json(entry);
  } catch (err) { next(err); }
});

router.get('/evidence-pack/:auditId', authMiddleware, async (req, res, next) => {
  try {
    const pack = await generateEvidencePack(req.params.auditId);
    res.json(pack);
  } catch (err) { next(err); }
});

// ─── Clause Benchmarks ───────────────────────────────

router.get('/benchmarks', authMiddleware, async (req, res, next) => {
  try {
    const benchmarks = await getBenchmarks();
    res.json({ benchmarks });
  } catch (err) { next(err); }
});

router.post('/benchmarks/refresh', authMiddleware, async (req, res, next) => {
  try {
    const count = await updateBenchmarks();
    res.json({ message: `Benchmarks updated for ${count} clause types` });
  } catch (err) { next(err); }
});

router.get('/benchmarks/percentile/:clause/:score', authMiddleware, async (req, res, next) => {
  try {
    const result = await getPercentileRank(req.params.clause, parseFloat(req.params.score));
    if (!result) return res.status(404).json({ error: 'No benchmark data for this clause' });
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Remediation Auto-Apply ──────────────────────────

router.post('/auto-remediate/:auditId', authMiddleware, async (req, res, next) => {
  try {
    const fs = require('fs');
    const prisma = require('../lib/prisma');
    const audit = await prisma.audit.findUnique({ where: { id: req.params.auditId } });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    let text = req.body.text || '';
    if (!text && audit.contractPath && fs.existsSync(audit.contractPath)) {
      text = fs.readFileSync(audit.contractPath, 'utf-8');
    }
    if (!text) return res.status(400).json({ error: 'No contract text available' });

    const result = await autoApplyRemediation(req.params.auditId, text);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
