/**
 * EPSS Routes — /api/epss
 *
 * Fetches EPSS (Exploit Prediction Scoring System) scores
 * with bounded LRU + TTL caching.
 *
 * Hardening:
 *   - Cache flush is admin-only (it forces every other tenant to refetch).
 *   - CVE IDs are validated by the lib (regex), so bad IDs return 400.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const epss = require('../lib/epss');

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/epss/cache/stats
 */
router.get('/cache/stats', async (req, res) => {
  res.json({ size: epss.cacheSize() });
});

/**
 * DELETE /api/epss/cache  (admin-only)
 * Flushes the global cache — every tenant will refetch from FIRST.org.
 */
router.delete('/cache', requireRole('admin'), async (req, res) => {
  epss.clearCache();
  res.json({ message: 'EPSS cache cleared' });
});

/**
 * POST /api/epss/batch
 * Body: { cves: ["CVE-2024-1234", ...] }   (max 100, concurrency-capped server-side)
 */
router.post('/batch', async (req, res, next) => {
  try {
    const { cves } = req.body || {};
    if (!Array.isArray(cves) || cves.length === 0) {
      return res.status(400).json({ error: 'cves array is required' });
    }
    if (cves.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 CVEs per batch' });
    }
    const results = await epss.getScores(cves);
    res.json({ results, cacheSize: epss.cacheSize() });
  } catch (err) { next(err); }
});

/**
 * GET /api/epss/:cveId
 */
router.get('/:cveId', async (req, res, next) => {
  try {
    const result = await epss.getScore(req.params.cveId);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
