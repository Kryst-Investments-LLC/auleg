/**
 * Deep Researcher (Phase 3 moat).
 *
 * Keeps the legal knowledge base current by ingesting new enforcement actions
 * and regulatory guidance, then recomputing the clause risk signals that bias
 * audit scoring (see regulator-research.js). This is what makes "which clause is
 * risky *this quarter*" true instead of a static seed.
 *
 * The data SOURCE is pluggable and injectable. It deliberately defaults to a
 * no-op: the KB is a defensibility asset, so entries must come from a verified
 * source (a curated feed, or an LLM+web pipeline whose findings carry sourceUrls
 * and pass human review) — never unsourced model hallucinations. The ingest /
 * dedupe / normalize / signal-recompute machinery here is provider-agnostic and
 * fully unit-tested.
 */

const prisma = require('./prisma');
const logger = require('./logger');
const ai = require('./ai');

// Clause taxonomy (single source — shared with the extractor).
const CLAUSE_TYPES = Object.keys(ai.CLAUSE_KNOWLEDGE || {});

/** Keep only recognized clause keys; accepts array or comma string. Pure. */
function normalizeClauseImpact(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || '').split(',');
  return list
    .map(s => String(s).trim())
    .filter(c => CLAUSE_TYPES.includes(c))
    .join(',');
}

/** Normalize a raw enforcement finding into EnforcementAction shape. Pure. */
function normalizeEnforcement(raw) {
  return {
    authority: String(raw.authority || 'Unknown'),
    country: String(raw.country || 'Unknown'),
    date: new Date(raw.date || Date.now()),
    entity: String(raw.entity || 'Unknown'),
    fineAmount: Number.isFinite(raw.fineAmount) ? raw.fineAmount : null,
    regulation: String(raw.regulation || 'GDPR'),
    articles: Array.isArray(raw.articles) ? raw.articles.join(',') : String(raw.articles || ''),
    summary: String(raw.summary || ''),
    impact: String(raw.impact || ''),
    clauseImpact: normalizeClauseImpact(raw.clauseImpact),
    sourceUrl: raw.sourceUrl || null,
    severity: ['low', 'medium', 'high', 'critical'].includes(raw.severity) ? raw.severity : 'medium'
  };
}

/** Normalize a raw guidance finding into RegulatoryGuidance shape. Pure. */
function normalizeGuidance(raw) {
  return {
    authority: String(raw.authority || 'Unknown'),
    title: String(raw.title || 'Untitled guidance'),
    date: new Date(raw.date || Date.now()),
    regulation: String(raw.regulation || 'GDPR'),
    summary: String(raw.summary || ''),
    implications: String(raw.implications || ''),
    clauseImpact: normalizeClauseImpact(raw.clauseImpact),
    sourceUrl: raw.sourceUrl || null
  };
}

/** Ingest enforcement findings, skipping duplicates (sourceUrl, else authority+entity+date). */
async function ingestEnforcement(items = []) {
  let added = 0;
  let skipped = 0;
  for (const raw of items) {
    const data = normalizeEnforcement(raw);
    const where = data.sourceUrl
      ? { sourceUrl: data.sourceUrl }
      : { authority: data.authority, entity: data.entity, date: data.date };
    const exists = await prisma.enforcementAction.findFirst({ where });
    if (exists) { skipped++; continue; }
    await prisma.enforcementAction.create({ data });
    added++;
  }
  return { added, skipped };
}

/** Ingest guidance findings, skipping duplicates (sourceUrl, else authority+title). */
async function ingestGuidance(items = []) {
  let added = 0;
  let skipped = 0;
  for (const raw of items) {
    const data = normalizeGuidance(raw);
    const where = data.sourceUrl
      ? { sourceUrl: data.sourceUrl }
      : { authority: data.authority, title: data.title };
    const exists = await prisma.regulatoryGuidance.findFirst({ where });
    if (exists) { skipped++; continue; }
    await prisma.regulatoryGuidance.create({ data });
    added++;
  }
  return { added, skipped };
}

/**
 * Resolve the configured research source. Returns null unless one is wired,
 * keeping the cycle a safe no-op by default. A real source returns
 * { enforcement: [...], guidance: [...] }.
 */
function getResearchSource() {
  // Hook point: a future verified feed / reviewed LLM pipeline is injected here.
  return null;
}

/**
 * Run one research cycle: pull findings from the source, ingest new ones, and
 * recompute clause risk signals so audit scoring reflects fresh enforcement.
 *
 * @param {object} [opts]
 * @param {() => Promise<{enforcement?:object[],guidance?:object[]}>} [opts.source]
 * @param {() => Promise<object>} [opts.computeSignals] injectable for tests
 * @returns {Promise<object>} summary
 */
async function runResearchCycle(opts = {}) {
  const source = opts.source || getResearchSource();
  if (typeof source !== 'function') {
    logger.info('deep-researcher: no source configured — cycle skipped');
    return { skipped: true, reason: 'no-source' };
  }

  let findings;
  try {
    findings = await source();
  } catch (err) {
    logger.error({ err: err.message }, 'deep-researcher: source failed');
    return { skipped: true, reason: 'source-error', error: err.message };
  }

  const enforcement = await ingestEnforcement(findings?.enforcement || []);
  const guidance = await ingestGuidance(findings?.guidance || []);

  let hotClauses = [];
  if (enforcement.added > 0 || guidance.added > 0) {
    const computeSignals = opts.computeSignals || require('./regulator-research').computeRiskSignals;
    const signals = await computeSignals();
    hotClauses = Object.entries(signals || {})
      .filter(([, v]) => v && v.riskMultiplier > 1.0)
      .map(([clause, v]) => ({ clause, riskMultiplier: v.riskMultiplier }));
  }

  const summary = { skipped: false, enforcement, guidance, hotClauses };
  logger.info(summary, 'deep-researcher: cycle complete');
  return summary;
}

module.exports = {
  runResearchCycle,
  ingestEnforcement,
  ingestGuidance,
  normalizeEnforcement,
  normalizeGuidance,
  normalizeClauseImpact,
  getResearchSource,
  CLAUSE_TYPES
};
