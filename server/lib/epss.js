/**
 * EPSS (Exploit Prediction Scoring System) Cache
 *
 * Fetches EPSS scores from the FIRST.org API and caches them
 * in-memory with a bounded LRU + TTL.
 *
 * Cache: per-process Map (LRU). Note: with cluster.js, every worker
 * has its own cache — for shared state across workers, swap LRU for
 * a Redis-backed implementation.
 *
 * Defaults: TTL 24h, LRU max 10,000 entries.
 */

const logger = require('./logger');

const EPSS_API_BASE = 'https://api.first.org/data/v1/epss';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;          // 24 hours
const DEFAULT_MAX_ENTRIES = 10_000;
const FETCH_TIMEOUT_MS = 5_000;                       // 5 s
const MAX_RESPONSE_BYTES = 256 * 1024;                // 256 KB
const BATCH_CONCURRENCY = 5;                          // p-limit equivalent

const CVE_REGEX = /^CVE-\d{4}-\d{4,}$/;

// ─── Bounded LRU ──────────────────────────────────────────────────
// Map preserves insertion order; promote-on-read evicts oldest first.
class LruCache {
  constructor(max = DEFAULT_MAX_ENTRIES) {
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, val); // promote
    return val;
  }
  set(key, val) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      // Evict least-recently-used (first entry)
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, val);
  }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

const cache = new LruCache(parseInt(process.env.EPSS_MAX_ENTRIES, 10) || DEFAULT_MAX_ENTRIES);
let ttlMs = DEFAULT_TTL_MS;

// ─── Fetcher (DI) ─────────────────────────────────────────────────
// The fetcher is injectable so tests can swap it without monkey-patching.

/**
 * Default fetcher — calls FIRST.org with timeout & response-size cap.
 * @param {string} cveId
 * @returns {Promise<{ epss: number, percentile: number }>}
 */
async function defaultFetcher(cveId) {
  const url = `${EPSS_API_BASE}?cve=${encodeURIComponent(cveId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`EPSS API returned ${res.status}`);

  // Cap response body size to prevent memory blow-up.
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`EPSS response too large (${contentLength} bytes)`);
  }

  // Stream + count bytes (defends against missing Content-Length).
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      controller.abort();
      throw new Error('EPSS response exceeded maximum size');
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  const body = JSON.parse(text);

  const entry = body.data?.[0];
  if (!entry) throw new Error(`No EPSS data for ${cveId}`);
  return {
    epss: parseFloat(entry.epss),
    percentile: parseFloat(entry.percentile),
  };
}

let fetcher = defaultFetcher;

/** Inject a custom fetcher (used for tests / future Redis-backed impl). */
function setFetcher(fn) {
  fetcher = typeof fn === 'function' ? fn : defaultFetcher;
}

/** Reset to the default network fetcher. */
function resetFetcher() { fetcher = defaultFetcher; }

// ─── Public API ───────────────────────────────────────────────────

/** Validate a CVE ID. Throws 400 on bad input. */
function validateCveId(cveId) {
  if (typeof cveId !== 'string') {
    const err = new Error('cveId must be a string'); err.status = 400; throw err;
  }
  const normalized = cveId.toUpperCase().trim();
  if (!CVE_REGEX.test(normalized)) {
    const err = new Error('Invalid CVE ID format'); err.status = 400; throw err;
  }
  return normalized;
}

/**
 * Get the EPSS score for a CVE, using the LRU+TTL cache when fresh.
 * @returns {Promise<{ cve: string, epss: number, percentile: number, cached: boolean }>}
 */
async function getScore(cveId) {
  const normalized = validateCveId(cveId);

  const hit = cache.get(normalized);
  if (hit && (Date.now() - hit.fetchedAt) < ttlMs) {
    return { cve: normalized, epss: hit.epss, percentile: hit.percentile, cached: true };
  }

  const result = await fetcher(normalized);
  cache.set(normalized, { ...result, fetchedAt: Date.now() });
  logger.info({ cve: normalized, epss: result.epss }, 'EPSS fetched');
  return { cve: normalized, ...result, cached: false };
}

/**
 * Get scores for many CVEs concurrently, capped by BATCH_CONCURRENCY.
 * @param {string[]} cveIds
 * @returns {Promise<object[]>}
 */
async function getScores(cveIds) {
  const results = new Array(cveIds.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= cveIds.length) return;
      try {
        results[i] = await getScore(cveIds[i]);
      } catch (err) {
        results[i] = {
          cve: cveIds[i],
          epss: null,
          percentile: null,
          cached: false,
          error: err.message,
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(BATCH_CONCURRENCY, cveIds.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

function clearCache() { cache.clear(); }
function cacheSize() { return cache.size; }
function setTtl(ms) { ttlMs = ms; }

module.exports = {
  getScore,
  getScores,
  clearCache,
  cacheSize,
  setTtl,
  setFetcher,
  resetFetcher,
  validateCveId,
  // Internal — exported for visibility in tests.
  _defaultFetcher: defaultFetcher,
};
