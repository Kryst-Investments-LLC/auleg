/**
 * LLM Clause Extractor
 *
 * Primary clause-detection path for the audit engine. Uses the configured LLM
 * (via ai.js, provider-agnostic) to identify which DPA clause types are present
 * in a document — including types the regex engine has no pattern for
 * (data_retention, cross_border_transfer, liability, termination).
 *
 * Design constraints:
 *   - Detection ONLY. This module decides *which clauses are present*; it does
 *     not score risk. Scoring stays in audit-engine.js unchanged.
 *   - Graceful: returns null when no LLM is configured or on any failure, so the
 *     caller falls back to the deterministic engine. A live deployment with no
 *     AI_PROVIDER key behaves exactly as before.
 *   - Testable: the completion function is injectable.
 */

const ai = require('./ai');

// Single source of clause taxonomy + descriptions (shared with ai.js).
const CLAUSE_KNOWLEDGE = ai.CLAUSE_KNOWLEDGE || {};
const CLAUSE_KEYS = Object.keys(CLAUSE_KNOWLEDGE);

const MAX_DOC_CHARS = 12000;

function buildSystemPrompt() {
  return [
    'You are a DPA (Data Processing Agreement) clause-detection engine.',
    'Given contract text, determine which of the known clause types are present.',
    'A clause is "present" only if the document contains substantive language addressing it — not a mere mention.',
    'Return STRICT JSON only, no prose, no markdown fences, in exactly this shape:',
    '{"clauses": {"<clause_key>": {"present": true|false, "excerpt": "<short verbatim excerpt or empty>"}}}',
    'Use only these clause keys: ' + CLAUSE_KEYS.join(', ') + '.'
  ].join('\n');
}

function buildUserPrompt(text) {
  const specs = CLAUSE_KEYS
    .map(k => `- ${k}: ${CLAUSE_KNOWLEDGE[k].description}`)
    .join('\n');
  const doc = String(text || '').slice(0, MAX_DOC_CHARS);
  return `Clause types:\n${specs}\n\nDocument:\n"""\n${doc}\n"""`;
}

/**
 * Parse the model's JSON response into a clause map compatible with the
 * deterministic engine: { clauseKey: excerptString } for present clauses only.
 * Returns null if the response can't be parsed into a usable shape.
 */
function parseClauseResponse(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Strip code fences / leading prose; grab the outermost JSON object.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }

  const clausesObj = parsed && parsed.clauses;
  if (!clausesObj || typeof clausesObj !== 'object') return null;

  const result = {};
  for (const key of CLAUSE_KEYS) {
    const entry = clausesObj[key];
    if (entry && entry.present === true) {
      result[key] = typeof entry.excerpt === 'string' && entry.excerpt.trim()
        ? entry.excerpt.trim()
        : `Detected by LLM: ${key.replace(/_/g, ' ')}`;
    }
  }
  return result;
}

/**
 * Extract present clauses from document text using the LLM.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {(system:string,user:string)=>Promise<string|null>} [opts.complete]
 *        Completion function. Defaults to ai.llmComplete (null when no provider).
 * @returns {Promise<Object<string,string>|null>} Clause map, or null to fall back.
 */
async function extractClauses(text, opts = {}) {
  const complete = opts.complete || ai.llmComplete;
  if (typeof complete !== 'function') return null;
  if (CLAUSE_KEYS.length === 0) return null;

  let raw;
  try {
    raw = await complete(buildSystemPrompt(), buildUserPrompt(text));
  } catch {
    return null;
  }
  if (!raw) return null;

  return parseClauseResponse(raw);
}

module.exports = {
  extractClauses,
  parseClauseResponse,
  CLAUSE_KEYS,
  buildSystemPrompt,
  buildUserPrompt
};
