/**
 * Audit Engine — deterministic DPA analysis core.
 *
 * Pure, side-effect-free functions for clause detection, regulation mapping,
 * gap analysis, risk scoring, and remediation. Extracted from audit-worker.js
 * so that both the worker and the evaluation harness share a single source of
 * truth (no copy-paste drift).
 *
 * This module performs NO I/O beyond loading the static engine data files at
 * require-time, and touches no database. Document text comes in, a structured
 * report goes out.
 */

const path = require('path');
const fs = require('fs');

// Load audit engine data files (bundled in server/data/)
const ENGINE_DATA = path.resolve(__dirname, '../data');
const clauseDetection = JSON.parse(fs.readFileSync(path.join(ENGINE_DATA, 'clause-detection.json.hbs'), 'utf-8'));
const regulationMapping = JSON.parse(fs.readFileSync(path.join(ENGINE_DATA, 'regulation-mapping.json.hbs'), 'utf-8'));
const remediationLanguage = JSON.parse(fs.readFileSync(path.join(ENGINE_DATA, 'remediation-language.json.hbs'), 'utf-8'));

// ─── Clause Detection ──────────────────────────────────

/**
 * Detect DPA clauses in a document via regex + keyword heuristics.
 * @param {string} text Full contract text.
 * @returns {Object<string,string>} Map of clause key → matched paragraph.
 */
function detectClauses(text) {
  const paragraphs = String(text || '').split(/(\r?\n){2,}/);
  const clauses = {};

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length < clauseDetection.heuristics.min_clause_length) continue;

    for (const key of Object.keys(clauseDetection.patterns)) {
      const regexList = clauseDetection.patterns[key];
      const keywords = clauseDetection.keywords[key] || [];

      let regexHit = false;
      for (const regex of regexList) {
        // Strip Python-style (?i) inline flags — JS uses RegExp flag arg instead
        const cleaned = regex.replace(/\(\?[imsx]+\)/g, '');
        if (new RegExp(cleaned, 'i').test(trimmed)) {
          regexHit = true;
          break;
        }
      }

      let keywordHits = 0;
      for (const kw of keywords) {
        if (new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(trimmed)) {
          keywordHits++;
        }
      }

      const keywordScore = keywords.length > 0 ? keywordHits / keywords.length : 0;
      const confidence = regexHit ? 0.7 + (keywordScore * 0.3) : keywordScore;

      if (confidence >= clauseDetection.heuristics.confidence_threshold) {
        if (!clauses[key]) {
          clauses[key] = trimmed;
        }
      }
    }
  }

  return clauses;
}

// ─── Regulation Mapping ─────────────────────────────────

/**
 * Map detected clauses to their regulatory framework references.
 * @param {Object<string,string>} clauses
 * @returns {Object<string,string[]>}
 */
function mapRegulations(clauses) {
  const matrix = {};
  for (const clause of Object.keys(clauses)) {
    matrix[clause] = regulationMapping.mapping[clause] || [];
  }
  return matrix;
}

// ─── Gap Analysis ───────────────────────────────────────

const REQUIRED_CLAUSES = [
  'data_processing_purpose',
  'subprocessor_controls',
  'breach_notification',
  'data_subject_rights',
  'security_measures',
  'audit_rights'
];

/**
 * Identify required clauses that are absent from the document.
 * @param {Object<string,string>} clauses
 * @returns {string[]} Missing required clause keys.
 */
function analyzeGaps(clauses) {
  return REQUIRED_CLAUSES.filter(req => !clauses[req]);
}

// ─── Risk Scoring ───────────────────────────────────────

const FRAMEWORK_WEIGHTS = { GDPR: 5, CCPA: 3, 'ISO 27701': 2, 'SOC 2': 2 };

const SEVERITY_LIKELIHOOD = {
  breach_notification: [5, 4],
  subprocessor_controls: [4, 3],
  data_subject_rights: [4, 3],
  security_measures: [5, 3],
  audit_rights: [3, 2],
  // Clause types now detectable via the LLM extractor — scored as first-class.
  data_retention: [4, 3],
  cross_border_transfer: [5, 3],
  liability: [3, 3],
  termination: [3, 2]
};

// Severity/likelihood assumed for a REQUIRED clause that is entirely missing.
// Absence is high-likelihood-of-harm, so missing clauses carry a strong default.
const MISSING_CLAUSE_SEVERITY_LIKELIHOOD = [4, 3];

/**
 * Compute a 1–5 regulatory-exposure score from framework references.
 * @param {string[]} frameworkRefs
 * @returns {number}
 */
function getRegulatoryExposure(frameworkRefs) {
  let total = 0;
  for (const ref of frameworkRefs) {
    for (const [fw, weight] of Object.entries(FRAMEWORK_WEIGHTS)) {
      if (ref.startsWith(fw)) total += weight;
    }
  }
  if (total <= 0) return 1;
  return Math.min(5, Math.round(total / 3));
}

/**
 * Score risk per detected clause and overall.
 * @param {Object<string,string>} clauses
 * @param {Object<string,string[]>} matrix
 * @param {string[]} gaps
 * @returns {{overall_risk:string, score:number, clause_scores:object[], missing_clauses:string[]}}
 */
function scoreRisk(clauses, matrix, gaps) {
  const clauseScores = [];
  const riskContributions = [];

  // Present clauses contribute their inherent topic risk.
  for (const clauseKey of Object.keys(clauses)) {
    const frameworkRefs = matrix[clauseKey] || [];
    const regExposure = getRegulatoryExposure(frameworkRefs);
    const [sev, lik] = SEVERITY_LIKELIHOOD[clauseKey] || [3, 2];
    const clauseScore = Math.round(((sev * 0.5) + (lik * 0.3) + (regExposure * 0.2)) * 20);

    riskContributions.push(clauseScore);
    clauseScores.push({
      clause: clauseKey,
      severity: sev,
      likelihood: lik,
      regulatory_exposure: regExposure,
      score: clauseScore
    });
  }

  // Missing required clauses are unmitigated gaps and MUST raise overall risk.
  // Previously gaps were excluded from the average, so a sparse contract that
  // omitted critical clauses could paradoxically score low. Each gap now
  // contributes maximum regulatory exposure for its (assumed-high) severity.
  for (const gap of gaps) {
    const [sev, lik] = SEVERITY_LIKELIHOOD[gap] || MISSING_CLAUSE_SEVERITY_LIKELIHOOD;
    const gapScore = Math.round(((sev * 0.5) + (lik * 0.3) + (5 * 0.2)) * 20);
    riskContributions.push(gapScore);
  }

  const overall = riskContributions.length > 0
    ? Math.round(riskContributions.reduce((sum, s) => sum + s, 0) / riskContributions.length)
    : 0;
  const riskLevel = overall <= 20 ? 'Low' : overall <= 50 ? 'Moderate' : overall <= 75 ? 'High' : 'Critical';

  return {
    overall_risk: riskLevel,
    score: overall,
    clause_scores: clauseScores,
    missing_clauses: gaps
  };
}

// ─── Remediation ────────────────────────────────────────

/**
 * Build remediation items for missing and strengthen-able clauses.
 * @param {string[]} gaps
 * @param {object[]} clauseScores
 * @returns {object[]}
 */
function generateRemediation(gaps, clauseScores) {
  const remediation = [];

  for (const gap of gaps) {
    const template = remediationLanguage.templates[gap];
    if (template) {
      remediation.push({
        clause: gap,
        action: 'missing',
        title: template.title,
        severity: template.severity,
        suggested_language: template.suggested_language,
        references: template.references
      });
    } else {
      remediation.push({
        clause: gap,
        action: 'missing',
        title: `Add clause: ${gap}`,
        severity: 'Moderate',
        suggested_language: 'No template available. Consult legal counsel.',
        references: []
      });
    }
  }

  for (const cs of clauseScores) {
    if (cs.score >= 70) {
      const template = remediationLanguage.templates[cs.clause];
      if (template) {
        remediation.push({
          clause: cs.clause,
          action: 'strengthen',
          title: `Strengthen: ${template.title}`,
          severity: template.severity,
          risk_score: cs.score,
          suggested_language: template.suggested_language,
          references: template.references
        });
      }
    }
  }

  return remediation;
}

// ─── Full deterministic pipeline ────────────────────────

/**
 * Run the full deterministic audit pipeline on document text.
 * Pure: no DB, no network, no file writes (beyond data already loaded).
 * @param {string} text
 * @returns {{clauses:object, compliance_matrix:object, gap_report:string[], risk_profile:object, remediation_plan:object[]}}
 */
function analyze(text) {
  const clauses = detectClauses(text);
  const compliance_matrix = mapRegulations(clauses);
  const gap_report = analyzeGaps(clauses);
  const risk_profile = scoreRisk(clauses, compliance_matrix, gap_report);
  const remediation_plan = generateRemediation(gap_report, risk_profile.clause_scores);

  return { clauses, compliance_matrix, gap_report, risk_profile, remediation_plan };
}

module.exports = {
  detectClauses,
  mapRegulations,
  analyzeGaps,
  scoreRisk,
  getRegulatoryExposure,
  generateRemediation,
  analyze,
  // Constants exported for tests / harness
  REQUIRED_CLAUSES,
  FRAMEWORK_WEIGHTS,
  SEVERITY_LIKELIHOOD,
  _data: { clauseDetection, regulationMapping, remediationLanguage }
};
