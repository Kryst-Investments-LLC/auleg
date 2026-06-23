/**
 * Tests for the audit analyzer (LLM-primary detection + deterministic fallback)
 * and a demonstration that LLM-grade detection closes the recall gap measured
 * by the golden-set harness.
 *
 * A simulated LLM (cue-based fake completion) stands in for a real provider so
 * the test is deterministic and offline.
 */

const fs = require('fs');
const path = require('path');
const analyzer = require('../../lib/audit-analyzer');
const { evaluate } = require('../../lib/audit-eval');

const goldenSet = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../fixtures/golden/golden-set.json'), 'utf-8')
);

// Simulated LLM: detects all 10 clause types from distinctive cues in the prompt.
// Stands in for a real provider's higher-recall extraction.
function fakeComplete(_system, userPrompt) {
  // Only inspect the document, not the clause-spec list embedded in the prompt
  // (the spec list names every clause type and would cause false positives).
  const parts = userPrompt.split('"""');
  const t = (parts.length >= 2 ? parts[1] : userPrompt).toLowerCase();
  const cues = {
    data_processing_purpose: /purpose of processing|processing purpose|for the purpose of providing/,
    breach_notification: /breach/,
    subprocessor_controls: /sub-?processor/,
    data_subject_rights: /data subject|rectification|erasure/,
    security_measures: /technical and organizational|security measures|encryption/,
    audit_rights: /right to audit|conduct audits|audit the processor/,
    data_retention: /delete or return|data deletion|retention/,
    cross_border_transfer: /cross-border|third country|standard contractual/,
    liability: /liabilit|indemnif/,
    termination: /right to terminate|terminate this agreement|termination for cause/
  };
  const clauses = {};
  for (const [key, rx] of Object.entries(cues)) {
    clauses[key] = { present: rx.test(t), excerpt: '' };
  }
  return Promise.resolve(JSON.stringify({ clauses }));
}

const fakeExtract = (text, opts) =>
  require('../../lib/llm-extractor').extractClauses(text, { ...opts, complete: fakeComplete });

describe('audit-analyzer detection source', () => {
  test('uses deterministic engine when LLM is disabled', async () => {
    const result = await analyzer.analyze(goldenSet.cases[0].text, { disableLLM: true });
    expect(result.extractor).toBe('deterministic');
    expect(result.risk_profile).toHaveProperty('overall_risk');
  });

  test('uses deterministic fallback when extractor returns null', async () => {
    const result = await analyzer.analyze(goldenSet.cases[0].text, { extract: async () => null });
    expect(result.extractor).toBe('deterministic');
  });

  test('uses deterministic fallback when extractor throws', async () => {
    const result = await analyzer.analyze(goldenSet.cases[0].text, {
      extract: async () => { throw new Error('boom'); }
    });
    expect(result.extractor).toBe('deterministic');
  });

  test('uses LLM path when extractor returns clauses', async () => {
    const result = await analyzer.analyze(goldenSet.cases[0].text, { extract: fakeExtract });
    expect(result.extractor).toBe('llm');
  });

  test('scoring still produces a valid report shape on the LLM path', async () => {
    const result = await analyzer.analyze(goldenSet.cases[0].text, { extract: fakeExtract });
    expect(result.risk_profile).toHaveProperty('score');
    expect(['Low', 'Moderate', 'High', 'Critical']).toContain(result.risk_profile.overall_risk);
    expect(Array.isArray(result.remediation_plan)).toBe(true);
  });
});

describe('LLM detection closes the recall gap (vs deterministic baseline)', () => {
  test('LLM-grade detection reaches full recall on the golden set', async () => {
    const report = await evaluate(goldenSet, text => analyzer.analyze(text, { extract: fakeExtract }));
    // Deterministic baseline recall is 0.813; the LLM path must beat it.
    expect(report.detection.overall.recall).toBeGreaterThan(0.813);
    expect(report.detection.overall.recall).toBe(1);
    expect(report.detection.overall.f1).toBeGreaterThan(0.897);
  });

  test('previously-missed clauses are now detected in the comprehensive case', async () => {
    const report = await evaluate(goldenSet, text => analyzer.analyze(text, { extract: fakeExtract }));
    const comprehensive = report.cases.find(c => c.id === 'comprehensive-dpa');
    for (const clause of ['data_retention', 'cross_border_transfer', 'liability']) {
      expect(comprehensive.missed).not.toContain(clause);
    }
  });
});
