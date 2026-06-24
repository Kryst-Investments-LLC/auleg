/**
 * Unified Vendor Risk (Phase 3 vertical wedge).
 *
 * Fuses a vendor's DPA/contract risk (from its audit) with supply-chain risk
 * (VEX vulnerability statements weighted by EPSS exploit probability) and license
 * risk into a single score + breakdown. This is the differentiated view no
 * legal-AI competitor offers: "third-party risk = contract risk + supply-chain
 * risk, unified."
 *
 * The scoring functions are pure and unit-tested; the orchestrator's data
 * sources are injectable.
 */

const DIMENSION_WEIGHTS = { contract: 0.5, supplyChain: 0.35, license: 0.15 };

function band(score) {
  return score <= 20 ? 'Low' : score <= 50 ? 'Moderate' : score <= 75 ? 'High' : 'Critical';
}

/**
 * Supply-chain risk from VEX statements + EPSS exploit probabilities. Pure.
 * @param {Array<{vulnerability:string,status:string}>} statements
 * @param {Object<string,number>} epssScores cveId -> probability 0..1
 */
function scoreFromVex(statements, epssScores = {}) {
  if (!Array.isArray(statements) || statements.length === 0) return { score: 0, affectedCount: 0 };
  let total = 0;
  let counted = 0;
  for (const s of statements) {
    const status = String(s.status || '').toLowerCase();
    let base;
    if (status === 'affected') base = 70;
    else if (status === 'under_investigation') base = 40;
    else continue; // not_affected / fixed contribute nothing
    const epss = epssScores[s.vulnerability];
    const epssBoost = Number.isFinite(epss) ? epss * 30 : 0; // actively-exploited -> up to +30
    total += Math.min(100, base + epssBoost);
    counted++;
  }
  if (counted === 0) return { score: 0, affectedCount: 0 };
  const avg = total / counted;
  const breadth = Math.min(20, counted * 5); // more open vulns -> higher
  return { score: Math.min(100, Math.round(avg * 0.8 + breadth)), affectedCount: counted };
}

/**
 * License risk: blocked licenses are high risk, review pending is moderate. Pure.
 * @param {Array<{status:string}>} licenses
 */
function scoreFromLicenses(licenses) {
  if (!Array.isArray(licenses) || licenses.length === 0) return { score: 0, blocked: 0, review: 0 };
  let score = 0;
  let blocked = 0;
  let review = 0;
  for (const l of licenses) {
    const st = String(l.status || '').toLowerCase();
    if (st === 'blocked') { score += 40; blocked++; }
    else if (st === 'review') { score += 15; review++; }
  }
  return { score: Math.min(100, score), blocked, review };
}

/**
 * Fuse the three dimensions into one vendor risk score. Pure.
 */
function fuseVendorRisk({ contractScore = 0, vexStatements = [], epssScores = {}, licenses = [] } = {}) {
  const contract = Number.isFinite(contractScore) ? Math.max(0, Math.min(100, contractScore)) : 0;
  const vex = scoreFromVex(vexStatements, epssScores);
  const lic = scoreFromLicenses(licenses);
  const w = DIMENSION_WEIGHTS;
  const overall = Math.round(contract * w.contract + vex.score * w.supplyChain + lic.score * w.license);

  const dimensions = {
    contract: { score: contract, level: band(contract), weight: w.contract },
    supplyChain: { score: vex.score, level: band(vex.score), weight: w.supplyChain, affectedVulnerabilities: vex.affectedCount },
    license: { score: lic.score, level: band(lic.score), weight: w.license, blocked: lic.blocked, review: lic.review }
  };

  // Rank dimensions by weighted contribution so the UI can show what drives risk.
  const topDrivers = Object.entries(dimensions)
    .map(([k, d]) => ({ dimension: k, contribution: Math.round(d.score * d.weight) }))
    .sort((a, b) => b.contribution - a.contribution);

  return { overall, level: band(overall), dimensions, topDrivers };
}

/**
 * Gather a vendor's data and compute its unified risk. Data sources injectable.
 *
 * @param {string} vendorEntryId
 * @param {object} [opts]
 * @param {(id:string)=>Promise<object|null>} [opts.getVendorEntry]
 * @param {(auditId:string)=>Promise<object[]>} [opts.readStatements]
 * @param {(cveIds:string[])=>Promise<object[]>} [opts.getEpssScores]
 * @param {(orgId:string,userId:string)=>Promise<object[]>} [opts.getLicenses]
 */
async function getVendorRisk(vendorEntryId, opts = {}) {
  const getVendorEntry = opts.getVendorEntry || defaultGetVendorEntry;
  const entry = await getVendorEntry(vendorEntryId);
  if (!entry) return null;

  const readStatements = opts.readStatements || (async (auditId) => (await require('./vex').readStatements(auditId)).statements || []);
  const getEpss = opts.getEpssScores || (async (cveIds) => require('./epss').getScores(cveIds));
  const getLicenses = opts.getLicenses || defaultGetLicenses;

  const vexStatements = entry.auditId ? await readStatements(entry.auditId).catch(() => []) : [];
  const cveIds = [...new Set(vexStatements.map(s => s.vulnerability).filter(Boolean))];
  const epssList = cveIds.length ? await getEpss(cveIds).catch(() => []) : [];
  const epssScores = {};
  for (const e of epssList || []) {
    if (e && e.cve) epssScores[e.cve] = Number(e.epss);
  }
  const licenses = await getLicenses(entry.orgId, entry.userId).catch(() => []);

  const fused = fuseVendorRisk({
    contractScore: entry.riskScore,
    vexStatements,
    epssScores,
    licenses
  });

  return { vendorEntryId, vendorName: entry.vendorName, auditId: entry.auditId || null, ...fused };
}

// ─── Default (prisma-backed) data sources (lazy-required) ──────────────

async function defaultGetVendorEntry(id) {
  const prisma = require('./prisma');
  return prisma.vendorEntry.findUnique({
    where: { id },
    include: { assessment: { select: { userId: true, orgId: true } } }
  }).then(e => e && {
    id: e.id, vendorName: e.vendorName, auditId: e.auditId, riskScore: e.riskScore,
    userId: e.assessment?.userId, orgId: e.assessment?.orgId
  });
}

async function defaultGetLicenses(orgId, userId) {
  const prisma = require('./prisma');
  const where = orgId ? { orgId } : { userId };
  return prisma.license.findMany({ where, select: { status: true, packageName: true, spdxId: true } });
}

module.exports = {
  getVendorRisk,
  fuseVendorRisk,
  scoreFromVex,
  scoreFromLicenses,
  band,
  DIMENSION_WEIGHTS
};
