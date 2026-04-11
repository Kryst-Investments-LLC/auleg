const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middleware/auth');
const prisma = require('../lib/prisma');
const {
  createNegotiation, getNegotiations, getNegotiation,
  addNegotiationRound, updateNegotiationClause, updateNegotiationStatus,
  createApprovalChain, getApprovalChains, processApprovalStep,
  createCounterpartyLink, getCounterpartyLink, submitCounterpartyDPA, getCounterpartyLinks,
  createVendorAssessment, addVendorToAssessment, updateVendorEntry,
  getVendorAssessments, getVendorAssessment
} = require('../lib/workflow');
const { enqueueAudit } = require('../lib/audit-worker');
const { requireQuota, incrementUsage } = require('../lib/billing');

const router = express.Router();

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
    cb(null, allowed.includes(ext));
  }
});

// ─── Negotiations ─────────────────────────────────────

router.post('/negotiations', authMiddleware, async (req, res, next) => {
  try {
    const neg = await createNegotiation(req.user.id, req.user.orgId, req.body);
    res.status(201).json(neg);
  } catch (err) { next(err); }
});

router.get('/negotiations', authMiddleware, async (req, res, next) => {
  try {
    const negs = await getNegotiations(req.user.id, req.user.orgId);
    res.json({ negotiations: negs });
  } catch (err) { next(err); }
});

router.get('/negotiations/:id', authMiddleware, async (req, res, next) => {
  try {
    const neg = await getNegotiation(req.params.id);
    if (!neg) return res.status(404).json({ error: 'Not found' });
    res.json(neg);
  } catch (err) { next(err); }
});

router.post('/negotiations/:id/rounds', authMiddleware, async (req, res, next) => {
  try {
    const round = await addNegotiationRound(req.params.id, req.body);
    res.status(201).json(round);
  } catch (err) { next(err); }
});

router.patch('/negotiations/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const neg = await updateNegotiationStatus(req.params.id, req.body.status);
    res.json(neg);
  } catch (err) { next(err); }
});

router.patch('/negotiation-clauses/:id', authMiddleware, async (req, res, next) => {
  try {
    const clause = await updateNegotiationClause(req.params.id, req.body);
    res.json(clause);
  } catch (err) { next(err); }
});

// ─── Approval Chains ──────────────────────────────────

router.post('/approvals', authMiddleware, async (req, res, next) => {
  try {
    const { auditId, steps } = req.body;
    if (!auditId || !steps || !steps.length) {
      return res.status(400).json({ error: 'auditId and steps required' });
    }
    const chain = await createApprovalChain(auditId, req.user.orgId, steps);
    res.status(201).json(chain);
  } catch (err) { next(err); }
});

router.get('/approvals/:auditId', authMiddleware, async (req, res, next) => {
  try {
    const chains = await getApprovalChains(req.params.auditId);
    res.json({ chains });
  } catch (err) { next(err); }
});

router.post('/approvals/steps/:stepId/decide', authMiddleware, async (req, res, next) => {
  try {
    const { decision, comments } = req.body;
    if (!['approved', 'rejected', 'skipped'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision' });
    }
    const result = await processApprovalStep(req.params.stepId, req.user.id, decision, comments);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Counterparty Portal ──────────────────────────────

router.post('/counterparty/links', authMiddleware, async (req, res, next) => {
  try {
    const link = await createCounterpartyLink(req.user.id, req.body);
    res.status(201).json({
      ...link,
      portalUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/portal/${link.token}`
    });
  } catch (err) { next(err); }
});

router.get('/counterparty/links', authMiddleware, async (req, res, next) => {
  try {
    const links = await getCounterpartyLinks(req.user.id);
    res.json({ links });
  } catch (err) { next(err); }
});

/** Public endpoint — no auth required (token-based access) */
router.get('/counterparty/portal/:token', async (req, res, next) => {
  try {
    const link = await getCounterpartyLink(req.params.token);
    if (!link) return res.status(404).json({ error: 'Invalid or expired link' });
    res.json({
      companyName: link.companyName,
      status: link.status,
      expiresAt: link.expiresAt
    });
  } catch (err) { next(err); }
});

/** Public endpoint — counterparty submits their DPA */
router.post('/counterparty/portal/:token/submit', upload.single('contract'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const link = await getCounterpartyLink(req.params.token);
    if (!link) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Invalid or expired link' });
    }

    // Create an audit for the submitted DPA
    const audit = await prisma.audit.create({
      data: {
        contractName: `[Counterparty] ${link.companyName} - ${req.file.originalname}`,
        contractPath: req.file.path,
        status: 'processing',
        userId: link.userId
      }
    });

    enqueueAudit(audit.id, req.file.path, link.userId, null);
    await submitCounterpartyDPA(req.params.token, req.file.path, audit.id);

    res.status(202).json({
      message: 'DPA submitted successfully. It will be reviewed shortly.',
      status: 'submitted'
    });
  } catch (err) { next(err); }
});

// ─── Bulk Vendor Assessment ───────────────────────────

router.post('/vendor-assessments', authMiddleware, async (req, res, next) => {
  try {
    const assessment = await createVendorAssessment(req.user.id, req.user.orgId, req.body.name || 'Vendor Assessment');
    res.status(201).json(assessment);
  } catch (err) { next(err); }
});

router.get('/vendor-assessments', authMiddleware, async (req, res, next) => {
  try {
    const assessments = await getVendorAssessments(req.user.id, req.user.orgId);
    res.json({ assessments });
  } catch (err) { next(err); }
});

router.get('/vendor-assessments/:id', authMiddleware, async (req, res, next) => {
  try {
    const assessment = await getVendorAssessment(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Not found' });
    res.json(assessment);
  } catch (err) { next(err); }
});

/** Upload vendor DPAs to a bulk assessment */
router.post('/vendor-assessments/:id/vendors', authMiddleware, upload.array('contracts', 50), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const assessment = await prisma.vendorAssessment.findUnique({ where: { id: req.params.id } });
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const entries = [];
    for (const file of req.files) {
      const vendorName = file.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      const entry = await addVendorToAssessment(req.params.id, vendorName, file.originalname, file.path);

      // Create an audit and enqueue
      const audit = await prisma.audit.create({
        data: {
          contractName: `[Vendor] ${vendorName}`,
          contractPath: file.path,
          status: 'processing',
          userId: req.user.id
        }
      });

      await updateVendorEntry(entry.id, { status: 'auditing', auditId: audit.id });
      enqueueAudit(audit.id, file.path, req.user.id, req.user.email);
      entries.push({ ...entry, auditId: audit.id });
    }

    await prisma.vendorAssessment.update({
      where: { id: req.params.id },
      data: { status: 'processing' }
    });

    res.status(202).json({
      message: `${entries.length} vendor DPAs queued for analysis`,
      entries
    });
  } catch (err) { next(err); }
});

// ─── Multi-File Audit (Bundles) ───────────────────────

router.post('/bundles', authMiddleware, upload.array('contracts', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const bundle = await prisma.auditBundle.create({
      data: {
        name: req.body.name || 'DPA Bundle',
        userId: req.user.id,
        orgId: req.user.orgId,
        status: 'processing'
      }
    });

    const files = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const fileType = i === 0 ? 'primary' : (req.body[`type_${i}`] || 'annex');

      // Create audit for each file
      const audit = await prisma.audit.create({
        data: {
          contractName: `[Bundle] ${file.originalname}`,
          contractPath: file.path,
          status: 'processing',
          userId: req.user.id
        }
      });

      const bundleFile = await prisma.auditBundleFile.create({
        data: {
          bundleId: bundle.id,
          auditId: audit.id,
          fileName: file.originalname,
          fileType,
          filePath: file.path,
          order: i
        }
      });

      if (i === 0) {
        await prisma.auditBundle.update({
          where: { id: bundle.id },
          data: { primaryAuditId: audit.id }
        });
      }

      enqueueAudit(audit.id, file.path, req.user.id, req.user.email);
      files.push({ ...bundleFile, auditId: audit.id });
    }

    res.status(202).json({
      bundleId: bundle.id,
      name: bundle.name,
      fileCount: files.length,
      files,
      message: `${files.length} files queued for analysis`
    });
  } catch (err) { next(err); }
});

router.get('/bundles', authMiddleware, async (req, res, next) => {
  try {
    const bundles = await prisma.auditBundle.findMany({
      where: { userId: req.user.id },
      include: { files: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ bundles });
  } catch (err) { next(err); }
});

router.get('/bundles/:id', authMiddleware, async (req, res, next) => {
  try {
    const bundle = await prisma.auditBundle.findUnique({
      where: { id: req.params.id },
      include: { files: { orderBy: { order: 'asc' } } }
    });
    if (!bundle) return res.status(404).json({ error: 'Not found' });
    res.json(bundle);
  } catch (err) { next(err); }
});

module.exports = router;
