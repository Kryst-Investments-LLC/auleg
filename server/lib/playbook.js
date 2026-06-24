/**
 * Memory Loop — Organization Playbook.
 *
 * Captures human corrections to AI findings (AuditFindingOverride) and
 * aggregates them per org into a "playbook": a compact summary of how this
 * organization tends to treat each clause (accept / reject / adjust). The
 * playbook is fed back into the LLM extractor as context so future audits
 * reflect the org's established standards — the platform learns over time.
 *
 * Pure aggregation/formatting functions are exported separately so they can be
 * unit-tested without a database.
 */

const prisma = require('./prisma');

const VALID_ACTIONS = ['accept', 'reject', 'adjust'];

/**
 * Record a human override of an AI finding.
 * @returns {Promise<object>} the created override
 */
async function recordOverride({ auditId, orgId, userId, userEmail, clause, action, originalScore, overrideScore, note }) {
  if (!VALID_ACTIONS.includes(action)) {
    const err = new Error(`Invalid action "${action}". Must be one of: ${VALID_ACTIONS.join(', ')}`);
    err.status = 400;
    throw err;
  }
  return prisma.auditFindingOverride.create({
    data: {
      auditId,
      orgId: orgId || null,
      userId,
      userEmail,
      clause,
      action,
      originalScore: Number.isFinite(originalScore) ? originalScore : null,
      overrideScore: Number.isFinite(overrideScore) ? overrideScore : null,
      note: note || null
    }
  });
}

/**
 * Aggregate a list of override records into per-clause guidance. Pure.
 * @param {object[]} overrides
 * @returns {{clauses: Object<string,object>, total: number}}
 */
function aggregatePlaybook(overrides) {
  const clauses = {};
  for (const o of overrides || []) {
    const c = clauses[o.clause] || (clauses[o.clause] = { accept: 0, reject: 0, adjust: 0, adjustScores: [], lastNote: null });
    if (o.action === 'accept') c.accept++;
    else if (o.action === 'reject') c.reject++;
    else if (o.action === 'adjust') {
      c.adjust++;
      if (Number.isFinite(o.overrideScore)) c.adjustScores.push(o.overrideScore);
    }
    if (!c.lastNote && o.note) c.lastNote = o.note;
  }

  for (const c of Object.values(clauses)) {
    c.total = c.accept + c.reject + c.adjust;
    c.avgAdjustScore = c.adjustScores.length
      ? Math.round(c.adjustScores.reduce((a, b) => a + b, 0) / c.adjustScores.length)
      : null;
    c.tendency = c.reject > c.accept ? 'stricter' : c.accept > c.reject ? 'lenient' : 'mixed';
    delete c.adjustScores; // internal only
  }

  return { clauses, total: (overrides || []).length };
}

/**
 * Load and aggregate the playbook for an org. Returns an empty playbook when
 * there is no org (solo users) so callers never need to null-check.
 */
async function getOrgPlaybook(orgId) {
  if (!orgId) return { clauses: {}, total: 0 };
  const overrides = await prisma.auditFindingOverride.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    take: 500
  });
  return aggregatePlaybook(overrides);
}

/**
 * Render a playbook into prompt context for the LLM extractor. Pure.
 * Returns '' when there is nothing learned yet (so prompts stay clean).
 */
function buildPlaybookPromptContext(playbook) {
  if (!playbook || playbook.total === 0) return '';
  let s = '\n## Organization Playbook (past reviewer decisions for this org — weigh these when scoring)\n';
  for (const [clause, c] of Object.entries(playbook.clauses)) {
    const bits = [];
    if (c.accept) bits.push(`${c.accept} accepted`);
    if (c.reject) bits.push(`${c.reject} rejected`);
    if (c.adjust) bits.push(`${c.adjust} adjusted${c.avgAdjustScore != null ? ` (avg score ${c.avgAdjustScore})` : ''}`);
    s += `- ${clause.replace(/_/g, ' ')}: ${bits.join(', ')} — this org tends ${c.tendency}`;
    s += c.lastNote ? `; note: "${c.lastNote}"\n` : '\n';
  }
  return s;
}

module.exports = {
  recordOverride,
  getOrgPlaybook,
  aggregatePlaybook,
  buildPlaybookPromptContext,
  VALID_ACTIONS
};
