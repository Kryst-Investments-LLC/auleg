/**
 * VEX (Vulnerability Exploitability eXchange) Reader
 *
 * Reads CSAF/VEX JSON documents from the filesystem.
 * Storage: vex-data/<auditId>/<statement-id>.json
 *
 * Hardening:
 *   - All public functions are async (fs/promises) — no event-loop blocking.
 *   - Path-traversal protection via safePath().
 *   - Per-file MAX_FILE_BYTES and per-audit MAX_FILES caps prevent OOM
 *     from JSON-bomb / directory-stuffing attacks.
 *   - Field whitelist in saveStatement prevents bloat from unknown keys.
 */

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const VEX_DIR = path.join(__dirname, '../vex-data');

// Resource caps — tunable via env.
const MAX_FILE_BYTES = parseInt(process.env.VEX_MAX_FILE_BYTES, 10) || 64 * 1024;     // 64 KB / file
const MAX_FILES_PER_AUDIT = parseInt(process.env.VEX_MAX_FILES, 10) || 10_000;
const MAX_JUSTIFICATION_LEN = 5_000;
const MAX_FIELD_LEN = 500;

// Whitelist of fields persisted to disk. Anything else is dropped.
const ALLOWED_FIELDS = ['vulnerability', 'product', 'status', 'justification'];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Validate a path segment (auditId/statementId) against traversal attacks. */
function safePath(segment, label) {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw httpError(400, `${label} is required`);
  }
  if (
    segment.includes('..') ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw httpError(400, `Invalid ${label}`);
  }
  const resolved = path.resolve(VEX_DIR, segment);
  if (!resolved.startsWith(path.resolve(VEX_DIR) + path.sep)) {
    throw httpError(400, `Invalid ${label}`);
  }
  return segment;
}

/** Whitelist + length-cap a statement payload before persisting. */
function sanitizeStatement(input) {
  if (!input || typeof input !== 'object') {
    throw httpError(400, 'statement must be an object');
  }
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    const val = input[key];
    if (val == null) continue;
    if (typeof val !== 'string') {
      throw httpError(400, `${key} must be a string`);
    }
    const cap = key === 'justification' ? MAX_JUSTIFICATION_LEN : MAX_FIELD_LEN;
    if (val.length > cap) {
      throw httpError(400, `${key} exceeds maximum length of ${cap}`);
    }
    out[key] = val;
  }
  return out;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

/**
 * Save a VEX statement to disk.
 * @returns {Promise<{ id: string, path: string }>}
 */
async function saveStatement(auditId, statement) {
  safePath(auditId, 'auditId');
  const clean = sanitizeStatement(statement);
  const dir = path.join(VEX_DIR, auditId);
  await ensureDir(dir);

  // Enforce per-audit file count cap before writing.
  const existing = await fsp.readdir(dir).catch(() => []);
  const jsonCount = existing.filter(f => f.endsWith('.json')).length;
  if (jsonCount >= MAX_FILES_PER_AUDIT) {
    throw httpError(429, `VEX statement limit reached for this audit (${MAX_FILES_PER_AUDIT})`);
  }

  const id = crypto.randomUUID();
  const doc = {
    id,
    auditId,
    timestamp: new Date().toISOString(),
    ...clean,
  };

  const filePath = path.join(dir, `${id}.json`);
  await fsp.writeFile(filePath, JSON.stringify(doc, null, 2));
  return { id, path: filePath };
}

/**
 * Read all VEX statements for an audit. Files exceeding MAX_FILE_BYTES
 * are silently skipped. Reads are issued concurrently.
 * @returns {Promise<object[]>}
 */
async function readStatements(auditId) {
  safePath(auditId, 'auditId');
  const dir = path.join(VEX_DIR, auditId);

  let files;
  try {
    files = (await fsp.readdir(dir)).filter(f => f.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  if (files.length > MAX_FILES_PER_AUDIT) {
    files = files.slice(0, MAX_FILES_PER_AUDIT);
  }

  const results = await Promise.all(
    files.map(async f => {
      const fp = path.join(dir, f);
      try {
        const stat = await fsp.stat(fp);
        if (stat.size > MAX_FILE_BYTES) return null;
        const raw = await fsp.readFile(fp, 'utf-8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
  );

  return results.filter(Boolean);
}

/**
 * Read a single VEX statement.
 * @returns {Promise<object|null>}
 */
async function readStatement(auditId, statementId) {
  safePath(auditId, 'auditId');
  safePath(statementId, 'statementId');
  const filePath = path.join(VEX_DIR, auditId, `${statementId}.json`);

  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      throw httpError(413, 'VEX statement exceeds maximum size');
    }
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Delete all VEX data for an audit. Idempotent.
 * @returns {Promise<number>} number of files removed
 */
async function deleteStatements(auditId) {
  safePath(auditId, 'auditId');
  const dir = path.join(VEX_DIR, auditId);

  let files;
  try {
    files = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }

  await fsp.rm(dir, { recursive: true, force: true });
  return files.length;
}

module.exports = {
  saveStatement,
  readStatements,
  readStatement,
  deleteStatements,
  VEX_DIR,
  MAX_FILE_BYTES,
  MAX_FILES_PER_AUDIT,
};
