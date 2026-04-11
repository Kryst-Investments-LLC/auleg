const express = require('express');
const authMiddleware = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { seedLegalDatabase, getRegulations, getRegulation, getArticlesForClause, searchArticles } = require('../lib/legal-knowledge');
const { getEnforcementActions, getGuidance, getTrendSummary, enhanceAuditRisk } = require('../lib/regulator-research');
const legalAgent = require('../lib/legal-agent');

const router = express.Router();

// ─── Law Awareness ────────────────────────────────────

/**
 * @swagger
 * /api/legal/regulations:
 *   get:
 *     summary: List all regulations with article counts
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/regulations', authMiddleware, async (req, res, next) => {
  try {
    const regulations = await getRegulations();
    res.json({ regulations });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/legal/regulations/{code}:
 *   get:
 *     summary: Get a regulation with full articles
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/regulations/:code', authMiddleware, async (req, res, next) => {
  try {
    const regulation = await getRegulation(req.params.code.toUpperCase());
    if (!regulation) return res.status(404).json({ error: 'Regulation not found' });
    res.json(regulation);
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/legal/articles/clause/{clauseType}:
 *   get:
 *     summary: Get all articles relevant to a DPA clause type
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/articles/clause/:clauseType', authMiddleware, async (req, res, next) => {
  try {
    const articles = await getArticlesForClause(req.params.clauseType);
    res.json({ articles });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/legal/articles/search:
 *   get:
 *     summary: Search articles by keyword
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 */
router.get('/articles/search', authMiddleware, async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });
    const articles = await searchArticles(q);
    res.json({ articles });
  } catch (err) { next(err); }
});

// ─── Regulator Research ───────────────────────────────

/**
 * @swagger
 * /api/legal/enforcement:
 *   get:
 *     summary: Get recent enforcement actions
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: regulation
 *         schema: { type: string }
 *       - in: query
 *         name: severity
 *         schema: { type: string, enum: [low, medium, high, critical] }
 *       - in: query
 *         name: clause
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 */
router.get('/enforcement', authMiddleware, async (req, res, next) => {
  try {
    const { regulation, severity, clause, limit } = req.query;
    const actions = await getEnforcementActions({
      regulation, severity, clauseType: clause,
      limit: limit ? parseInt(limit) : 20
    });
    res.json({ actions });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/legal/guidance:
 *   get:
 *     summary: Get regulatory guidance documents
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/guidance', authMiddleware, async (req, res, next) => {
  try {
    const { regulation, clause, limit } = req.query;
    const guidance = await getGuidance({
      regulation, clauseType: clause,
      limit: limit ? parseInt(limit) : 20
    });
    res.json({ guidance });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/legal/trends:
 *   get:
 *     summary: Get enforcement trend summary with risk signals
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/trends', authMiddleware, async (req, res, next) => {
  try {
    const trends = await getTrendSummary();
    res.json(trends);
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/legal/enhance-risk/{auditId}:
 *   get:
 *     summary: Get regulator-enhanced risk profile for an audit
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/enhance-risk/:auditId', authMiddleware, async (req, res, next) => {
  try {
    const audit = await prisma.audit.findFirst({
      where: { id: req.params.auditId, userId: req.user.id }
    });
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    if (!audit.reportJson) return res.status(400).json({ error: 'Audit has no report' });

    const report = JSON.parse(audit.reportJson);
    const enhanced = await enhanceAuditRisk(report);
    res.json({ auditId: audit.id, contractName: audit.contractName, enhancedRisk: enhanced });
  } catch (err) { next(err); }
});

// ─── Legal Expert Agent (Chat) ────────────────────────

/**
 * @swagger
 * /api/legal/chat:
 *   post:
 *     summary: Chat with the legal expert agent
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string }
 *               chatId: { type: string }
 *               auditId: { type: string }
 */
router.post('/chat', authMiddleware, async (req, res, next) => {
  try {
    const { message, chatId, auditId } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

    // Load or create chat
    let chatRecord = null;
    let history = [];

    if (chatId) {
      chatRecord = await prisma.legalChat.findFirst({
        where: { id: chatId, userId: req.user.id }
      });
      if (chatRecord) {
        try { history = JSON.parse(chatRecord.messages); } catch {}
      }
    }

    // Build audit context if linked to an audit
    let auditContext = null;
    if (auditId) {
      const audit = await prisma.audit.findFirst({
        where: { id: auditId, userId: req.user.id }
      });
      if (audit && audit.reportJson) {
        const report = JSON.parse(audit.reportJson);
        auditContext = {
          contractName: audit.contractName,
          riskScore: audit.riskScore,
          overallRisk: audit.overallRisk,
          clauseScores: report.clause_scores || {}
        };
      }
    }

    // Get response from legal agent
    const response = await legalAgent.chat(message, history, auditContext);

    // Update chat history
    history.push({ role: 'user', content: message, timestamp: new Date().toISOString() });
    history.push({ role: 'assistant', content: response.answer, timestamp: new Date().toISOString() });

    // Save/update chat record
    if (chatRecord) {
      await prisma.legalChat.update({
        where: { id: chatRecord.id },
        data: {
          messages: JSON.stringify(history),
          title: history.length <= 2 ? message.slice(0, 80) : chatRecord.title
        }
      });
    } else {
      chatRecord = await prisma.legalChat.create({
        data: {
          userId: req.user.id,
          title: message.slice(0, 80),
          messages: JSON.stringify(history),
          context: auditId ? JSON.stringify({ auditId }) : null
        }
      });
    }

    res.json({
      chatId: chatRecord.id,
      answer: response.answer,
      sources: response.sources,
      detectedClause: response.detectedClause,
      detectedRegulation: response.detectedRegulation,
      provider: response.provider
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/legal/chats:
 *   get:
 *     summary: List user's chat conversations
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/chats', authMiddleware, async (req, res, next) => {
  try {
    const chats = await prisma.legalChat.findMany({
      where: { userId: req.user.id },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50
    });
    res.json({ chats });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/legal/chats/{id}:
 *   get:
 *     summary: Get a specific chat conversation
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/chats/:id', authMiddleware, async (req, res, next) => {
  try {
    const chat = await prisma.legalChat.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    let messages = [];
    try { messages = JSON.parse(chat.messages); } catch {}

    res.json({ id: chat.id, title: chat.title, messages, createdAt: chat.createdAt });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/legal/draft:
 *   post:
 *     summary: Draft DPA clause language
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clauseType]
 *             properties:
 *               clauseType: { type: string }
 *               regulation: { type: string }
 *               currentLanguage: { type: string }
 */
router.post('/draft', authMiddleware, async (req, res, next) => {
  try {
    const { clauseType, regulation, currentLanguage } = req.body;
    if (!clauseType) return res.status(400).json({ error: 'clauseType is required' });

    const result = await legalAgent.draftClause(clauseType, regulation || 'GDPR', currentLanguage || '');
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Database Seeding ─────────────────────────────────

/**
 * @swagger
 * /api/legal/seed:
 *   post:
 *     summary: Seed the legal knowledge database
 *     tags: [Legal]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/seed', authMiddleware, async (req, res, next) => {
  try {
    const result = await seedLegalDatabase();
    res.json({ message: 'Legal database seeded', ...result });
  } catch (err) { next(err); }
});

module.exports = router;
