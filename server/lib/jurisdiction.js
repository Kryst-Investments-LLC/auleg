/**
 * Jurisdiction Auto-Detection & Cross-Regulation Gap Matrix
 *
 * Detects applicable regulations from DPA text based on:
 * - Party locations mentioned
 * - Data flow descriptions
 * - Explicit regulation references
 * - Data subject categories
 *
 * Then builds a cross-regulation compliance matrix.
 */

const prisma = require('./prisma');

const JURISDICTION_SIGNALS = {
  GDPR: {
    keywords: ['gdpr', 'general data protection regulation', 'eu regulation 2016/679', 'article 28', 'article 32', 'article 33', 'eea', 'european economic area'],
    locations: ['european union', 'eu', 'germany', 'france', 'spain', 'italy', 'netherlands', 'belgium', 'austria', 'ireland', 'portugal', 'poland', 'sweden', 'denmark', 'finland', 'czech', 'romania', 'hungary', 'bulgaria', 'croatia', 'greece', 'luxembourg', 'slovakia', 'slovenia', 'estonia', 'latvia', 'lithuania', 'malta', 'cyprus'],
    jurisdiction: 'EU',
    weight: 1.0
  },
  'UK-GDPR': {
    keywords: ['uk gdpr', 'united kingdom', 'data protection act 2018', 'ico', 'information commissioner'],
    locations: ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'northern ireland', 'london'],
    jurisdiction: 'UK',
    weight: 0.9
  },
  CCPA: {
    keywords: ['ccpa', 'cpra', 'california consumer privacy', 'california privacy rights', '1798.100', 'service provider', 'business purpose'],
    locations: ['california', 'united states', 'us', 'usa', 'san francisco', 'los angeles', 'silicon valley'],
    jurisdiction: 'US-CA',
    weight: 0.85
  },
  LGPD: {
    keywords: ['lgpd', 'lei geral', 'proteção de dados', 'anpd', 'autoridade nacional'],
    locations: ['brazil', 'brasil', 'são paulo', 'rio de janeiro'],
    jurisdiction: 'Brazil',
    weight: 0.8
  },
  POPIA: {
    keywords: ['popia', 'protection of personal information', 'information regulator', 'responsible party'],
    locations: ['south africa', 'johannesburg', 'cape town'],
    jurisdiction: 'South Africa',
    weight: 0.8
  },
  DPDPA: {
    keywords: ['dpdpa', 'digital personal data protection', 'data fiduciary', 'data principal'],
    locations: ['india', 'mumbai', 'delhi', 'bangalore', 'hyderabad'],
    jurisdiction: 'India',
    weight: 0.8
  },
  PIPEDA: {
    keywords: ['pipeda', 'personal information protection', 'privacy commissioner of canada'],
    locations: ['canada', 'toronto', 'vancouver', 'montreal', 'ottawa'],
    jurisdiction: 'Canada',
    weight: 0.8
  },
  HIPAA: {
    keywords: ['hipaa', 'health insurance portability', 'protected health information', 'phi', 'covered entity', 'business associate'],
    locations: [],
    jurisdiction: 'US-Health',
    weight: 0.9
  },
  'PCI-DSS': {
    keywords: ['pci', 'payment card', 'cardholder data', 'pci-dss', 'pci dss'],
    locations: [],
    jurisdiction: 'Global-Payment',
    weight: 0.7
  },
  SOX: {
    keywords: ['sarbanes-oxley', 'sox', 'section 404', 'internal controls over financial reporting'],
    locations: [],
    jurisdiction: 'US-Finance',
    weight: 0.7
  }
};

// Clause requirements per regulation
const REGULATION_CLAUSE_REQUIREMENTS = {
  GDPR: {
    audit_rights: { required: true, article: 'Art. 28(3)(h)', minScore: 70 },
    breach_notification: { required: true, article: 'Art. 33', minScore: 80 },
    data_subject_rights: { required: true, article: 'Art. 15-22', minScore: 70 },
    subprocessor_controls: { required: true, article: 'Art. 28(2)(4)', minScore: 70 },
    security_measures: { required: true, article: 'Art. 32', minScore: 75 },
    cross_border_transfer: { required: true, article: 'Art. 44-49', minScore: 80 },
    data_retention: { required: true, article: 'Art. 17, 28(3)(g)', minScore: 65 },
    data_processing_purpose: { required: true, article: 'Art. 28(3)', minScore: 70 },
    liability: { required: true, article: 'Art. 82', minScore: 60 },
    termination: { required: true, article: 'Art. 28(3)(g)', minScore: 65 }
  },
  'UK-GDPR': {
    audit_rights: { required: true, article: 'Art. 28(3)(h) UK GDPR', minScore: 70 },
    breach_notification: { required: true, article: 'Art. 33 UK GDPR', minScore: 80 },
    data_subject_rights: { required: true, article: 'Art. 15-22 UK GDPR', minScore: 70 },
    subprocessor_controls: { required: true, article: 'Art. 28(2)(4) UK GDPR', minScore: 70 },
    security_measures: { required: true, article: 'Art. 32 UK GDPR', minScore: 75 },
    cross_border_transfer: { required: true, article: 'Art. 44-49 UK GDPR + IDTA', minScore: 80 },
    data_retention: { required: true, article: 'Art. 17, 28(3)(g) UK GDPR', minScore: 65 },
    data_processing_purpose: { required: true, article: 'Art. 28(3) UK GDPR', minScore: 70 },
    liability: { required: true, article: 'Art. 82 UK GDPR', minScore: 60 },
    termination: { required: true, article: 'Art. 28(3)(g) UK GDPR', minScore: 65 }
  },
  CCPA: {
    breach_notification: { required: true, article: '§1798.150', minScore: 60 },
    data_subject_rights: { required: true, article: '§1798.100-125', minScore: 70 },
    data_processing_purpose: { required: true, article: '§1798.140(e)', minScore: 65 },
    security_measures: { required: true, article: '§1798.150(a)', minScore: 60 },
    subprocessor_controls: { required: false, article: '§1798.140(ag)', minScore: 50 },
    data_retention: { required: true, article: '§1798.105', minScore: 60 }
  },
  LGPD: {
    breach_notification: { required: true, article: 'Art. 48', minScore: 65 },
    data_subject_rights: { required: true, article: 'Art. 17-22', minScore: 65 },
    security_measures: { required: true, article: 'Art. 46', minScore: 60 },
    data_processing_purpose: { required: true, article: 'Art. 7-10', minScore: 65 },
    cross_border_transfer: { required: true, article: 'Art. 33-36', minScore: 70 }
  },
  HIPAA: {
    breach_notification: { required: true, article: '45 CFR 164.410', minScore: 85 },
    security_measures: { required: true, article: '45 CFR 164.312', minScore: 85 },
    audit_rights: { required: true, article: '45 CFR 164.504(e)', minScore: 75 },
    subprocessor_controls: { required: true, article: '45 CFR 164.502(e)', minScore: 75 },
    data_retention: { required: true, article: '45 CFR 164.530(j)', minScore: 70 },
    termination: { required: true, article: '45 CFR 164.504(e)(2)(iii)', minScore: 75 }
  }
};

/**
 * Detect jurisdictions from document text.
 * Returns sorted array of detected regulations with confidence scores.
 */
function detectJurisdictions(text) {
  const lower = text.toLowerCase();
  const detected = [];

  for (const [reg, signals] of Object.entries(JURISDICTION_SIGNALS)) {
    let score = 0;
    const matches = [];

    for (const kw of signals.keywords) {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const count = (lower.match(regex) || []).length;
      if (count > 0) {
        score += count * 3 * signals.weight;
        matches.push({ type: 'keyword', term: kw, count });
      }
    }

    for (const loc of signals.locations) {
      const regex = new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const count = (lower.match(regex) || []).length;
      if (count > 0) {
        score += count * 2 * signals.weight;
        matches.push({ type: 'location', term: loc, count });
      }
    }

    if (score > 0) {
      const confidence = Math.min(0.99, score / 30);
      detected.push({
        regulation: reg,
        jurisdiction: signals.jurisdiction,
        confidence: Math.round(confidence * 100) / 100,
        score,
        matches
      });
    }
  }

  return detected.sort((a, b) => b.score - a.score);
}

/**
 * Build cross-regulation gap matrix.
 * Given clause scores and detected regulations, returns a matrix showing
 * compliance status per regulation per clause.
 */
function buildGapMatrix(clauseScores, detectedRegulations) {
  const matrix = {};

  for (const det of detectedRegulations) {
    const reg = det.regulation;
    const requirements = REGULATION_CLAUSE_REQUIREMENTS[reg];
    if (!requirements) continue;

    matrix[reg] = {
      regulation: reg,
      jurisdiction: det.jurisdiction,
      confidence: det.confidence,
      clauses: {},
      compliantCount: 0,
      totalRequired: 0,
      complianceRate: 0
    };

    for (const [clause, req] of Object.entries(requirements)) {
      const score = clauseScores[clause] ?? 0;
      const status = score >= req.minScore ? 'compliant' : score > 0 ? 'partial' : 'missing';

      matrix[reg].clauses[clause] = {
        score,
        required: req.required,
        minScore: req.minScore,
        article: req.article,
        status,
        gap: Math.max(0, req.minScore - score)
      };

      if (req.required) {
        matrix[reg].totalRequired++;
        if (status === 'compliant') matrix[reg].compliantCount++;
      }
    }

    matrix[reg].complianceRate = matrix[reg].totalRequired > 0
      ? Math.round((matrix[reg].compliantCount / matrix[reg].totalRequired) * 100)
      : 100;
  }

  return matrix;
}

/**
 * Get the biggest gaps across all regulations.
 */
function getCriticalGaps(gapMatrix) {
  const gaps = [];
  for (const [reg, data] of Object.entries(gapMatrix)) {
    for (const [clause, info] of Object.entries(data.clauses)) {
      if (info.status !== 'compliant' && info.required) {
        gaps.push({
          regulation: reg,
          jurisdiction: data.jurisdiction,
          clause,
          article: info.article,
          currentScore: info.score,
          requiredScore: info.minScore,
          gap: info.gap,
          status: info.status
        });
      }
    }
  }
  return gaps.sort((a, b) => b.gap - a.gap);
}

module.exports = {
  detectJurisdictions,
  buildGapMatrix,
  getCriticalGaps,
  JURISDICTION_SIGNALS,
  REGULATION_CLAUSE_REQUIREMENTS
};
