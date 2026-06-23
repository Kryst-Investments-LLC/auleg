/**
 * KB-backed retrieval source for the STORM pipeline.
 *
 * Grounds STORM synthesis in the platform's ALREADY-VERIFIED knowledge base —
 * enforcement actions and regulatory guidance that carry real sourceUrls — so
 * generated findings inherit a citable source. This needs no external API or
 * keys. A web-search backend can be swapped in by passing a different `retrieve`
 * to STORM; this is the safe default.
 *
 * Returns [{ title, url, snippet }]; only items with a sourceUrl are eligible
 * (STORM drops unsourced findings, so grounding must carry a URL).
 */

function terms(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 3);
}

function matches(text, qTerms) {
  const t = String(text || '').toLowerCase();
  return qTerms.some(term => t.includes(term));
}

/**
 * Retrieve grounding sources from the KB for a question.
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.limit=5]
 * @param {Function} [opts.getEnforcementActions] inject for tests
 * @param {Function} [opts.getGuidance] inject for tests
 * @returns {Promise<Array<{title:string,url:string,snippet:string}>>}
 */
async function kbRetrieve(query, opts = {}) {
  let getEnf = opts.getEnforcementActions;
  let getGuid = opts.getGuidance;
  // Load the real KB getters lazily so injected tests never touch prisma.
  if (!getEnf || !getGuid) {
    const regulator = require('./regulator-research');
    getEnf = getEnf || regulator.getEnforcementActions;
    getGuid = getGuid || regulator.getGuidance;
  }
  const qTerms = terms(query);
  if (qTerms.length === 0) return [];

  const [enforcements, guidance] = await Promise.all([
    getEnf({ limit: 30 }).catch(() => []),
    getGuid({ limit: 30 }).catch(() => [])
  ]);

  const sources = [];

  for (const e of enforcements || []) {
    if (!e.sourceUrl) continue;
    if (matches(`${e.entity} ${e.summary} ${e.impact} ${e.authority} ${e.regulation}`, qTerms)) {
      sources.push({ title: `${e.authority}: ${e.entity}`, url: e.sourceUrl, snippet: e.summary || '' });
    }
  }

  for (const g of guidance || []) {
    if (!g.sourceUrl) continue;
    if (matches(`${g.title} ${g.summary} ${g.implications} ${g.authority} ${g.regulation}`, qTerms)) {
      sources.push({ title: g.title, url: g.sourceUrl, snippet: g.summary || '' });
    }
  }

  return sources.slice(0, opts.limit || 5);
}

module.exports = { kbRetrieve };
