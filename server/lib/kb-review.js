/**
 * Human-review gate for AI-generated KB findings.
 *
 * STORM / deep-researcher findings are enqueued here as "pending". Only when an
 * admin approves does a finding get ingested into the live knowledge base (via
 * the deep researcher's dedupe/normalize ingest). This is the control that keeps
 * the KB defensible — nothing machine-generated goes live unreviewed.
 */

const prisma = require('./prisma');

/**
 * Enqueue findings for review.
 * @param {{enforcement?:object[], guidance?:object[], source?:string}} input
 * @returns {Promise<{queued:number}>}
 */
async function enqueueFindings({ enforcement = [], guidance = [], source = 'storm' } = {}) {
  const rows = [
    ...enforcement.map(f => ({ kind: 'enforcement', f })),
    ...guidance.map(f => ({ kind: 'guidance', f }))
  ];
  let queued = 0;
  for (const { kind, f } of rows) {
    await prisma.kbReviewItem.create({
      data: { kind, payload: JSON.stringify(f), source, sourceUrl: f.sourceUrl || null }
    });
    queued++;
  }
  return { queued };
}

/** List pending review items (oldest first). */
async function listPending({ limit = 50, kind } = {}) {
  const where = { status: 'pending' };
  if (kind) where.kind = kind;
  return prisma.kbReviewItem.findMany({ where, orderBy: { createdAt: 'asc' }, take: limit });
}

function notFound() { const e = new Error('Review item not found'); e.status = 404; return e; }
function alreadyReviewed() { const e = new Error('Item already reviewed'); e.status = 409; return e; }

/**
 * Approve a pending item: ingest its payload into the live KB, mark approved.
 * @param {string} id
 * @param {string} userId reviewer
 * @param {object} [opts] opts.researcher injectable (tests)
 */
async function approveItem(id, userId, opts = {}) {
  const item = await prisma.kbReviewItem.findUnique({ where: { id } });
  if (!item) throw notFound();
  if (item.status !== 'pending') throw alreadyReviewed();

  const dr = opts.researcher || require('./deep-researcher');
  const payload = JSON.parse(item.payload);
  const ingest = item.kind === 'enforcement'
    ? await dr.ingestEnforcement([payload])
    : await dr.ingestGuidance([payload]);

  await prisma.kbReviewItem.update({
    where: { id },
    data: { status: 'approved', reviewedBy: userId, reviewedAt: new Date() }
  });
  return { approved: true, kind: item.kind, ingest };
}

/** Reject a pending item with an optional note. */
async function rejectItem(id, userId, note) {
  const item = await prisma.kbReviewItem.findUnique({ where: { id } });
  if (!item) throw notFound();
  if (item.status !== 'pending') throw alreadyReviewed();
  await prisma.kbReviewItem.update({
    where: { id },
    data: { status: 'rejected', reviewedBy: userId, reviewNote: note || null, reviewedAt: new Date() }
  });
  return { rejected: true };
}

/**
 * Run STORM for a topic and enqueue its sourced findings for review (instead of
 * ingesting directly — STORM output is machine-generated and needs the gate).
 */
async function enqueueFromStorm(topic, opts = {}) {
  const { createStormSource } = opts.storm || require('./storm');
  const source = createStormSource(topic, opts);
  const findings = await source();
  return enqueueFindings({ ...findings, source: 'storm' });
}

module.exports = { enqueueFindings, listPending, approveItem, rejectItem, enqueueFromStorm };
