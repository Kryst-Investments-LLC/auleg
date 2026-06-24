/**
 * Audit Analyzer — orchestrates clause detection then deterministic scoring.
 *
 * Detection strategy (the LLM-primary rewrite):
 *   1. PRIMARY:  LLM structured extraction (llm-extractor) — higher recall,
 *      detects clause types the regex engine cannot.
 *   2. FALLBACK: deterministic regex engine (audit-engine) when no LLM is
 *      configured, the LLM errors, or it returns nothing usable.
 *
 * Scoring, regulation mapping, gap analysis, and remediation remain entirely in
 * audit-engine.js — unchanged. This module only swaps *how clauses are detected*,
 * then feeds the resulting clause map through the existing deterministic
 * pipeline. That keeps risk-scoring logic stable and independently gated.
 */

const engine = require('./audit-engine');
const llmExtractor = require('./llm-extractor');
const logger = require('./logger');

/**
 * Analyze document text into a full audit report object.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {(text:string,opts?:object)=>Promise<Object|null>} [opts.extract]
 *        Override the LLM extractor (used in tests). Defaults to llm-extractor.
 * @param {boolean} [opts.disableLLM] Force the deterministic path.
 * @returns {Promise<{clauses:object,compliance_matrix:object,gap_report:string[],risk_profile:object,remediation_plan:object[],extractor:string}>}
 */
async function analyze(text, opts = {}) {
  let clauses = null;
  let extractor = 'deterministic';

  if (!opts.disableLLM) {
    const extract = opts.extract || llmExtractor.extractClauses;
    try {
      const llmClauses = await extract(text, opts);
      if (llmClauses && Object.keys(llmClauses).length > 0) {
        clauses = llmClauses;
        extractor = 'llm';
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'LLM clause extraction failed — using deterministic fallback');
    }
  }

  // Fallback: deterministic regex detection
  if (!clauses) {
    clauses = engine.detectClauses(text);
    extractor = 'deterministic';
  }

  // Shared deterministic pipeline (scoring unchanged regardless of detection source)
  const compliance_matrix = engine.mapRegulations(clauses);
  const gap_report = engine.analyzeGaps(clauses);
  const risk_profile = engine.scoreRisk(clauses, compliance_matrix, gap_report);
  const remediation_plan = engine.generateRemediation(gap_report, risk_profile.clause_scores);

  return { clauses, compliance_matrix, gap_report, risk_profile, remediation_plan, extractor };
}

module.exports = { analyze };
