/**
 * Regulator Research Agent
 * 
 * Monitors enforcement actions and regulatory guidance to dynamically
 * adjust audit risk assessments. Provides real-time context on what
 * regulators are focusing on.
 */

const prisma = require('./prisma');

/**
 * Get recent enforcement actions, optionally filtered.
 */
async function getEnforcementActions({ limit = 20, regulation, severity, clauseType } = {}) {
  const where = {};
  if (regulation) where.regulation = regulation;
  if (severity) where.severity = severity;
  if (clauseType) where.clauseImpact = { contains: clauseType };

  return prisma.enforcementAction.findMany({
    where,
    orderBy: { date: 'desc' },
    take: limit
  });
}

/**
 * Get regulatory guidance, optionally filtered.
 */
async function getGuidance({ limit = 20, regulation, clauseType } = {}) {
  const where = {};
  if (regulation) where.regulation = regulation;
  if (clauseType) where.clauseImpact = { contains: clauseType };

  return prisma.regulatoryGuidance.findMany({
    where,
    orderBy: { date: 'desc' },
    take: limit
  });
}

/**
 * Compute dynamic risk signals based on recent enforcement trends.
 * Returns clause-level risk adjustments that can augment audit scores.
 */
async function computeRiskSignals() {
  const recentEnforcements = await prisma.enforcementAction.findMany({
    where: { date: { gte: new Date(Date.now() - 365 * 86400000) } },
    orderBy: { date: 'desc' }
  });

  const recentGuidance = await prisma.regulatoryGuidance.findMany({
    where: { date: { gte: new Date(Date.now() - 365 * 86400000) } },
    orderBy: { date: 'desc' }
  });

  // Aggregate enforcement focus by clause
  const clauseHeatMap = {};
  const CLAUSE_TYPES = [
    'audit_rights', 'breach_notification', 'data_subject_rights',
    'subprocessor_controls', 'security_measures', 'data_processing_purpose',
    'data_retention', 'cross_border_transfer', 'liability', 'termination'
  ];

  for (const clause of CLAUSE_TYPES) {
    clauseHeatMap[clause] = { enforcementCount: 0, totalFines: 0, guidanceCount: 0, riskMultiplier: 1.0, signals: [] };
  }

  for (const ea of recentEnforcements) {
    const clauses = (ea.clauseImpact || '').split(',').map(c => c.trim()).filter(Boolean);
    for (const clause of clauses) {
      if (clauseHeatMap[clause]) {
        clauseHeatMap[clause].enforcementCount++;
        clauseHeatMap[clause].totalFines += ea.fineAmount || 0;
        clauseHeatMap[clause].signals.push({
          type: 'enforcement',
          entity: ea.entity,
          authority: ea.authority,
          date: ea.date,
          fine: ea.fineAmount,
          summary: ea.summary
        });
      }
    }
  }

  for (const rg of recentGuidance) {
    const clauses = (rg.clauseImpact || '').split(',').map(c => c.trim()).filter(Boolean);
    for (const clause of clauses) {
      if (clauseHeatMap[clause]) {
        clauseHeatMap[clause].guidanceCount++;
        clauseHeatMap[clause].signals.push({
          type: 'guidance',
          authority: rg.authority,
          title: rg.title,
          date: rg.date,
          implications: rg.implications
        });
      }
    }
  }

  // Calculate risk multipliers based on enforcement intensity
  for (const clause of CLAUSE_TYPES) {
    const entry = clauseHeatMap[clause];
    let multiplier = 1.0;

    // More enforcement focus → higher risk multiplier
    if (entry.enforcementCount >= 3) multiplier += 0.3;
    else if (entry.enforcementCount >= 1) multiplier += 0.15;

    // Large fines indicate regulator priority
    if (entry.totalFines >= 100000000) multiplier += 0.3; // €100M+
    else if (entry.totalFines >= 10000000) multiplier += 0.2; // €10M+
    else if (entry.totalFines >= 1000000) multiplier += 0.1; // €1M+

    // Recent guidance = evolving expectations
    if (entry.guidanceCount >= 2) multiplier += 0.15;
    else if (entry.guidanceCount >= 1) multiplier += 0.1;

    entry.riskMultiplier = Math.min(multiplier, 2.0); // Cap at 2x
    // Keep only top 3 signals for display
    entry.signals = entry.signals.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);
  }

  return clauseHeatMap;
}

/**
 * Get an enhanced risk profile for an audit by applying regulator signals.
 */
async function enhanceAuditRisk(auditReport) {
  const clauseScores = auditReport.clause_scores || {};
  const riskSignals = await computeRiskSignals();
  const enhanced = {};

  for (const [clause, score] of Object.entries(clauseScores)) {
    const signal = riskSignals[clause];
    if (signal && signal.riskMultiplier > 1.0) {
      // Weak clauses become even riskier when regulators are focused on them
      const adjustedScore = score < 80 ? Math.max(0, score / signal.riskMultiplier) : score;
      enhanced[clause] = {
        originalScore: score,
        adjustedScore: Math.round(adjustedScore),
        riskMultiplier: signal.riskMultiplier,
        enforcementCount: signal.enforcementCount,
        totalFines: signal.totalFines,
        reason: signal.signals.length > 0
          ? `Recent enforcement focus: ${signal.signals[0].summary?.slice(0, 100)}...`
          : 'Elevated regulatory attention in this area'
      };
    } else {
      enhanced[clause] = { originalScore: score, adjustedScore: score, riskMultiplier: 1.0 };
    }
  }

  return enhanced;
}

/**
 * Generate regulator trend summary.
 */
async function getTrendSummary() {
  const signals = await computeRiskSignals();
  const hotClauses = Object.entries(signals)
    .filter(([, v]) => v.riskMultiplier > 1.0)
    .sort((a, b) => b[1].riskMultiplier - a[1].riskMultiplier);

  const totalFines = Object.values(signals).reduce((sum, v) => sum + v.totalFines, 0);
  const totalActions = Object.values(signals).reduce((sum, v) => sum + v.enforcementCount, 0);

  return {
    period: 'Last 12 months',
    totalEnforcementActions: totalActions,
    totalFines: totalFines,
    totalFinesFormatted: totalFines >= 1e9 ? `€${(totalFines / 1e9).toFixed(1)}B` : totalFines >= 1e6 ? `€${(totalFines / 1e6).toFixed(0)}M` : `€${(totalFines / 1e3).toFixed(0)}K`,
    hotAreas: hotClauses.map(([clause, data]) => ({
      clause,
      displayName: clause.replace(/_/g, ' '),
      riskMultiplier: data.riskMultiplier,
      enforcementCount: data.enforcementCount,
      totalFines: data.totalFines,
      guidanceCount: data.guidanceCount,
      topSignal: data.signals[0] || null
    })),
    recommendation: hotClauses.length > 0
      ? `Focus DPA remediation on: ${hotClauses.slice(0, 3).map(([c]) => c.replace(/_/g, ' ')).join(', ')}. These areas have elevated regulatory attention.`
      : 'No elevated enforcement trends detected. Standard audit scoring applies.'
  };
}

module.exports = {
  getEnforcementActions,
  getGuidance,
  computeRiskSignals,
  enhanceAuditRisk,
  getTrendSummary
};
