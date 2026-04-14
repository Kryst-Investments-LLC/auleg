/**
 * Reporting Engine
 * 
 * Board-ready PDF reports, compliance certificates,
 * audit evidence trails, and scheduled re-audits.
 */

const crypto = require('crypto');
const prisma = require('./prisma');
const { requireAccessibleAudit, notFound } = require('./access');

// ─── Board-Ready Report Generation ───────────────────

/**
 * Generate a structured board report from audit data.
 * Returns HTML that can be converted to PDF on the frontend.
 */
async function generateBoardReport(auditId, user) {
  const audit = await requireAccessibleAudit(user, auditId);
  if (!audit || !audit.reportJson) throw new Error('Audit not found or incomplete');

  const report = JSON.parse(audit.reportJson);
  const rp = report.risk_profile || {};
  const clauseScores = rp.clause_scores || [];
  const gaps = report.gap_report || [];
  const remediation = report.remediation_plan || [];

  // Calculate summary stats
  const totalClauses = clauseScores.length;
  const criticalClauses = clauseScores.filter(c => c.score < 30).length;
  const strongClauses = clauseScores.filter(c => c.score >= 80).length;
  const weakClauses = clauseScores.filter(c => c.score > 0 && c.score < 50).length;

  // Top 5 issues
  const topIssues = [...clauseScores]
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(c => ({
      clause: c.clause,
      score: c.score,
      displayName: c.clause?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      severity: c.score < 30 ? 'critical' : c.score < 50 ? 'high' : c.score < 70 ? 'medium' : 'low'
    }));

  // Risk heatmap data
  const heatmapData = clauseScores.map(c => ({
    clause: c.clause,
    score: c.score,
    category: c.score >= 80 ? 'strong' : c.score >= 50 ? 'moderate' : c.score > 0 ? 'weak' : 'missing'
  }));

  // Remediation timeline
  const timeline = remediation.map((r, i) => ({
    priority: i + 1,
    clause: r.clause,
    displayName: r.clause?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    effort: r.effort || 'medium',
    estimatedDays: r.effort === 'high' ? 14 : r.effort === 'medium' ? 7 : 3,
    impact: r.impact || 'Improves compliance posture'
  }));

  return {
    title: `DPA Audit Report — ${audit.contractName}`,
    generatedAt: new Date().toISOString(),
    audit: {
      id: audit.id,
      contractName: audit.contractName,
      version: audit.version,
      createdAt: audit.createdAt,
      status: audit.status
    },
    executiveSummary: {
      overallRisk: rp.overall_risk || audit.overallRisk || 'Unknown',
      riskScore: rp.score || audit.riskScore || 0,
      totalClauses,
      criticalClauses,
      strongClauses,
      weakClauses,
      gapsFound: gaps.length,
      complianceRate: totalClauses > 0 ? Math.round((strongClauses / totalClauses) * 100) : 0
    },
    topIssues,
    heatmapData,
    clauseBreakdown: clauseScores.map(c => ({
      clause: c.clause,
      displayName: c.clause?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      score: c.score,
      status: c.score >= 80 ? 'compliant' : c.score >= 50 ? 'partial' : c.score > 0 ? 'weak' : 'missing'
    })),
    remediationTimeline: timeline,
    gaps: gaps.slice(0, 10)
  };
}

// ─── Compliance Certificates ──────────────────────────

async function issueCertificate(auditId, user, data) {
  const audit = await requireAccessibleAudit(user, auditId);
  if (!audit) throw new Error('Audit not found');
  if (audit.riskScore == null || audit.riskScore >= 60) {
    throw new Error(`Compliance score too low (${audit.riskScore || 0}). Minimum threshold: score < 60 risk.`);
  }

  const certNumber = `AULEG-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const validFrom = new Date();
  const validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const cert = await prisma.complianceCertificate.create({
    data: {
      auditId,
      certificateNumber: certNumber,
      issuedTo: data.issuedTo || audit.contractName,
      issuedBy: data.issuedBy || 'Auleg Compliance Platform',
      overallScore: audit.riskScore,
      frameworks: data.frameworks || 'GDPR',
      validFrom,
      validUntil,
      userId: user.id
    }
  });

  // Log evidence
  await logEvidence(auditId, 'certificate_issued', user.id, user.name || user.email,
    `Certificate ${certNumber} issued. Valid until ${validUntil.toISOString().split('T')[0]}.`);

  return cert;
}

async function getCertificates(userId) {
  return prisma.complianceCertificate.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
}

async function getCertificate(id, user) {
  return prisma.complianceCertificate.findFirst({
    where: { id, userId: user.id }
  });
}

async function verifyCertificate(certNumber) {
  const cert = await prisma.complianceCertificate.findUnique({
    where: { certificateNumber: certNumber }
  });
  if (!cert) return { valid: false, reason: 'Certificate not found' };
  if (cert.status === 'revoked') return { valid: false, reason: 'Certificate has been revoked' };
  if (cert.validUntil < new Date()) return { valid: false, reason: 'Certificate has expired', cert };
  return { valid: true, cert };
}

async function revokeCertificate(id, user) {
  const certificate = await getCertificate(id, user);
  if (!certificate) {
    throw notFound('Certificate not found');
  }

  return prisma.complianceCertificate.update({
    where: { id: certificate.id },
    data: { status: 'revoked' }
  });
}

// ─── Audit Evidence Trail ─────────────────────────────

async function logEvidence(auditId, action, actorId, actorName, detail, metadata) {
  return prisma.auditEvidence.create({
    data: {
      auditId,
      action,
      actor: actorId,
      actorName,
      detail,
      metadata: metadata ? JSON.stringify(metadata) : null
    }
  });
}

async function getEvidenceTrail(auditId, user) {
  await requireAccessibleAudit(user, auditId, { select: { id: true } });

  return prisma.auditEvidence.findMany({
    where: { auditId },
    orderBy: { createdAt: 'asc' }
  });
}

/**
 * Generate exportable evidence pack.
 */
async function generateEvidencePack(auditId, user) {
  const audit = await requireAccessibleAudit(user, auditId);
  if (!audit) throw new Error('Audit not found');

  const evidence = await getEvidenceTrail(auditId, user);
  const certificates = await prisma.complianceCertificate.findMany({ where: { auditId } });
  const redlines = await prisma.redline.findMany({ where: { auditId } });
  const approvals = await prisma.approvalChain.findMany({
    where: { auditId },
    include: { steps: true }
  });

  return {
    title: `Audit Evidence Pack — ${audit.contractName}`,
    generatedAt: new Date().toISOString(),
    audit: {
      id: audit.id,
      contractName: audit.contractName,
      version: audit.version,
      status: audit.status,
      riskScore: audit.riskScore,
      overallRisk: audit.overallRisk,
      createdAt: audit.createdAt,
      updatedAt: audit.updatedAt
    },
    timeline: evidence.map(e => ({
      timestamp: e.createdAt,
      action: e.action,
      actor: e.actorName || e.actor,
      detail: e.detail,
      metadata: e.metadata ? JSON.parse(e.metadata) : null
    })),
    certificates: certificates.map(c => ({
      number: c.certificateNumber,
      issuedTo: c.issuedTo,
      issuedBy: c.issuedBy,
      validFrom: c.validFrom,
      validUntil: c.validUntil,
      status: c.status,
      frameworks: c.frameworks
    })),
    redlinesSummary: {
      total: redlines.length,
      accepted: redlines.filter(r => r.status === 'accepted').length,
      rejected: redlines.filter(r => r.status === 'rejected').length,
      pending: redlines.filter(r => r.status === 'pending').length,
      modified: redlines.filter(r => r.status === 'modified').length
    },
    approvals: approvals.map(a => ({
      title: a.title,
      status: a.status,
      steps: a.steps.map(s => ({
        order: s.stepOrder,
        role: s.role,
        assignedEmail: s.assignedEmail,
        status: s.status,
        comments: s.comments,
        decidedAt: s.decidedAt
      }))
    }))
  };
}

// ─── Clause Benchmarks ───────────────────────────────

async function updateBenchmarks() {
  // Get all completed audits' clause scores
  const audits = await prisma.audit.findMany({
    where: { status: 'complete', reportJson: { not: null } }
  });

  const clauseData = {};
  for (const audit of audits) {
    try {
      const report = JSON.parse(audit.reportJson);
      const scores = report.risk_profile?.clause_scores || [];
      for (const cs of scores) {
        if (!clauseData[cs.clause]) clauseData[cs.clause] = [];
        clauseData[cs.clause].push(cs.score);
      }
    } catch {}
  }

  for (const [clause, scores] of Object.entries(clauseData)) {
    if (scores.length < 2) continue;
    scores.sort((a, b) => a - b);

    const avg = scores.reduce((a, b) => a + b) / scores.length;
    const median = scores[Math.floor(scores.length / 2)];
    const p25 = scores[Math.floor(scores.length * 0.25)];
    const p75 = scores[Math.floor(scores.length * 0.75)];

    await prisma.clauseBenchmark.upsert({
      where: { id: clause }, // use clause as a proxy — we'll search by clause field
      update: { avgScore: avg, medianScore: median, p25Score: p25, p75Score: p75, sampleSize: scores.length },
      create: { clause, avgScore: avg, medianScore: median, p25Score: p25, p75Score: p75, sampleSize: scores.length }
    }).catch(async () => {
      // If upsert fails (no unique constraint on clause), try findFirst + update/create
      const existing = await prisma.clauseBenchmark.findFirst({ where: { clause } });
      if (existing) {
        await prisma.clauseBenchmark.update({
          where: { id: existing.id },
          data: { avgScore: avg, medianScore: median, p25Score: p25, p75Score: p75, sampleSize: scores.length }
        });
      } else {
        await prisma.clauseBenchmark.create({
          data: { clause, avgScore: avg, medianScore: median, p25Score: p25, p75Score: p75, sampleSize: scores.length }
        });
      }
    });
  }

  return Object.keys(clauseData).length;
}

async function getBenchmarks() {
  return prisma.clauseBenchmark.findMany({ orderBy: { clause: 'asc' } });
}

/**
 * Get percentile rank for a clause score.
 */
async function getPercentileRank(clause, score) {
  const benchmark = await prisma.clauseBenchmark.findFirst({ where: { clause } });
  if (!benchmark) return null;

  // Estimate percentile from quartiles
  let percentile;
  if (score <= benchmark.p25Score) percentile = Math.round((score / benchmark.p25Score) * 25);
  else if (score <= benchmark.medianScore) percentile = 25 + Math.round(((score - benchmark.p25Score) / (benchmark.medianScore - benchmark.p25Score)) * 25);
  else if (score <= benchmark.p75Score) percentile = 50 + Math.round(((score - benchmark.medianScore) / (benchmark.p75Score - benchmark.medianScore)) * 25);
  else percentile = 75 + Math.round(((score - benchmark.p75Score) / (100 - benchmark.p75Score)) * 25);

  return {
    clause,
    score,
    percentile: Math.min(99, Math.max(1, percentile)),
    benchmark: {
      avg: benchmark.avgScore,
      median: benchmark.medianScore,
      p25: benchmark.p25Score,
      p75: benchmark.p75Score,
      sampleSize: benchmark.sampleSize
    }
  };
}

// ─── Remediation Auto-Apply ──────────────────────────

/**
 * Generate a corrected document by applying all remediation suggestions.
 */
async function autoApplyRemediation(auditId, contractText, user) {
  await requireAccessibleAudit(user, auditId, { select: { id: true } });

  const redlines = await prisma.redline.findMany({
    where: { auditId },
    orderBy: { lineStart: 'asc' }
  });

  if (redlines.length === 0) return { text: contractText, appliedCount: 0 };

  let result = contractText;
  let appliedCount = 0;

  // Apply each suggestion (process from end to start to preserve indices)
  for (const r of [...redlines].reverse()) {
    const idx = result.indexOf(r.originalText);
    if (idx !== -1) {
      result = result.substring(0, idx) + r.suggestedText + result.substring(idx + r.originalText.length);
      appliedCount++;

      await prisma.redline.update({
        where: { id: r.id },
        data: { status: 'accepted' }
      });
    }
  }

  return { text: result, appliedCount, totalSuggestions: redlines.length };
}

module.exports = {
  // Board reports
  generateBoardReport,
  // Certificates
  issueCertificate,
  getCertificates,
  getCertificate,
  verifyCertificate,
  revokeCertificate,
  // Evidence
  logEvidence,
  getEvidenceTrail,
  generateEvidencePack,
  // Benchmarks
  updateBenchmarks,
  getBenchmarks,
  getPercentileRank,
  // Remediation
  autoApplyRemediation
};
