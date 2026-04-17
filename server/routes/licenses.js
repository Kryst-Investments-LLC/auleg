/**
 * License Management Routes — /api/licenses
 *
 * CRUD for third-party software licenses referenced in DPAs.
 * Supports status filtering (approved/blocked/review) and a `summary`
 * field that returns counts independent of pagination.
 *
 * Hardening:
 *   - Length caps on all free-text fields.
 *   - parseInt with explicit radix.
 *   - Empty PATCH bodies short-circuit (no spurious updatedAt bumps).
 *   - Summary is Redis-cached (60s TTL) and invalidated on every write.
 *     Falls back gracefully when Redis is unavailable.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { buildUserOrgScope } = require('../lib/access');
const logger = require('../lib/logger');

const router = express.Router();
router.use(authMiddleware);

const ALLOWED_STATUSES = ['approved', 'blocked', 'review'];

const FIELD_CAPS = {
  packageName: 200,
  version: 50,
  spdxId: 100,
  source: 50,
  notes: 5_000,
};

const SUMMARY_TTL_SEC = 60;

// ─── Lazy Redis client (mirrors the pattern used in audit-worker, email) ──
let redisClient = null;
let redisAttempted = false;
function getRedis() {
  if (redisAttempted) return redisClient;
  redisAttempted = true;
  if (!process.env.REDIS_URL) return null;
  try {
    const IORedis = require('ioredis');
    redisClient = new IORedis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redisClient.on('error', err => logger.warn({ err }, 'License summary Redis error'));
    return redisClient;
  } catch (err) {
    logger.warn({ err }, 'ioredis not available; license summary will not be cached');
    return null;
  }
}

function summaryCacheKey(user) {
  // Per-org when applicable, else per-user.
  return user.orgId ? `licenses:summary:org:${user.orgId}` : `licenses:summary:user:${user.id}`;
}

async function getCachedSummary(user) {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(summaryCacheKey(user));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function setCachedSummary(user, summary) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(summaryCacheKey(user), JSON.stringify(summary), 'EX', SUMMARY_TTL_SEC);
  } catch { /* swallow */ }
}

async function invalidateSummary(user) {
  const r = getRedis();
  if (!r) return;
  try { await r.del(summaryCacheKey(user)); } catch { /* swallow */ }
}

// ─── Validators ───────────────────────────────────────────────────

function validateStringField(name, value, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) return `${name} is required`;
    return null;
  }
  if (typeof value !== 'string') return `${name} must be a string`;
  const cap = FIELD_CAPS[name];
  if (cap && value.length > cap) return `${name} exceeds maximum length of ${cap}`;
  return null;
}

// ─── Routes ───────────────────────────────────────────────────────

/**
 * GET /api/licenses
 * List licenses with pagination + summary counts.
 */
router.get('/', async (req, res, next) => {
  try {
    const scope = buildUserOrgScope(req.user);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const statusFilter = req.query.status || '';

    const where = { ...scope };
    if (statusFilter && ALLOWED_STATUSES.includes(statusFilter)) {
      where.status = statusFilter;
    }

    // Try cached summary first; only run groupBy if cache miss.
    let summary = await getCachedSummary(req.user);

    const [licenses, total] = await Promise.all([
      prisma.license.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.license.count({ where }),
    ]);

    if (!summary) {
      const groups = await prisma.license.groupBy({
        by: ['status'],
        where: scope,
        _count: { id: true },
      });
      summary = { approved: 0, blocked: 0, review: 0 };
      groups.forEach(g => { summary[g.status] = g._count.id; });
      await setCachedSummary(req.user, summary);
    }

    res.json({
      licenses,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/licenses
 */
router.post('/', async (req, res, next) => {
  try {
    const { packageName, version, spdxId, status, source, notes } = req.body || {};

    const errors = [
      validateStringField('packageName', packageName, { required: true }),
      validateStringField('spdxId', spdxId, { required: true }),
      validateStringField('version', version),
      validateStringField('source', source),
      validateStringField('notes', notes),
    ].filter(Boolean);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
    }

    const license = await prisma.license.create({
      data: {
        userId: req.user.id,
        orgId: req.user.orgId || null,
        packageName,
        version: version || null,
        spdxId,
        status: status || 'review',
        source: source || 'manual',
        notes: notes || null,
      },
    });

    await invalidateSummary(req.user);
    res.status(201).json(license);
  } catch (err) { next(err); }
});

/**
 * PATCH /api/licenses/:id
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const scope = buildUserOrgScope(req.user);
    const existing = await prisma.license.findFirst({ where: { id: req.params.id, ...scope } });
    if (!existing) return res.status(404).json({ error: 'License not found' });

    const { status, notes } = req.body || {};
    const data = {};

    if (status !== undefined) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      data.status = status;
    }
    if (notes !== undefined) {
      const err = validateStringField('notes', notes);
      if (err) return res.status(400).json({ error: err });
      data.notes = notes;
    }

    // Empty body — no-op, return existing record without bumping updatedAt.
    if (Object.keys(data).length === 0) {
      return res.json(existing);
    }

    const updated = await prisma.license.update({ where: { id: req.params.id }, data });
    if (data.status) await invalidateSummary(req.user);
    res.json(updated);
  } catch (err) { next(err); }
});

/**
 * DELETE /api/licenses/:id
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const scope = buildUserOrgScope(req.user);
    const existing = await prisma.license.findFirst({ where: { id: req.params.id, ...scope } });
    if (!existing) return res.status(404).json({ error: 'License not found' });

    await prisma.license.delete({ where: { id: req.params.id } });
    await invalidateSummary(req.user);
    res.json({ message: 'License deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
