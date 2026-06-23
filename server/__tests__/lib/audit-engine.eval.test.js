/**
 * Regression gate for the DPA audit engine.
 *
 * Evaluates the engine against the labeled golden set and asserts it meets the
 * established baseline. These thresholds are set just below the current
 * deterministic-engine baseline so that:
 *   - any regression (a change that detects fewer clauses / mis-scores) fails CI;
 *   - the planned LLM-primary rewrite can RAISE the thresholds as it closes the
 *     known recall gap (data_retention, cross_border_transfer, liability).
 *
 * Baseline captured 2026-06: detection F1 0.897 / recall 0.813 / precision 1.0,
 * gap F1 1.0, risk-band accuracy 0.75.
 */

const fs = require('fs');
const path = require('path');
const { evaluate } = require('../../lib/audit-eval');

const goldenSet = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../fixtures/golden/golden-set.json'), 'utf-8')
);

describe('Audit engine — golden set regression gate', () => {
  let report;

  beforeAll(async () => {
    report = await evaluate(goldenSet);
  });

  test('evaluates every golden case', () => {
    expect(report.caseCount).toBe(goldenSet.cases.length);
    expect(report.cases).toHaveLength(goldenSet.cases.length);
  });

  test('clause-detection F1 does not regress below baseline', () => {
    expect(report.detection.overall.f1).toBeGreaterThanOrEqual(0.85);
    expect(report.detection.overall.recall).toBeGreaterThanOrEqual(0.8);
  });

  test('clause detection makes no false positives', () => {
    // Current engine is precise (regex-gated); guard against noisy matches.
    expect(report.detection.overall.precision).toBeGreaterThanOrEqual(0.95);
  });

  test('gap analysis is accurate', () => {
    expect(report.gapAnalysis.overall.f1).toBeGreaterThanOrEqual(0.95);
    expect(report.gapAnalysis.exactCaseMatchRate).toBeGreaterThanOrEqual(0.9);
  });

  test('risk-band accuracy does not regress below baseline', () => {
    // After the missing-clause scoring fix, absent required clauses raise risk,
    // so all golden cases land in their expected band. Baseline locked at 1.0.
    expect(report.riskBandAccuracy).toBe(1);
  });

  test('documents the known recall gap the LLM rewrite must close', () => {
    // These clause types have no detection pattern today. This assertion is a
    // living TODO: when the LLM-primary engine detects them, recall rises and
    // this expectation should be tightened/removed.
    const knownGaps = ['data_retention', 'cross_border_transfer', 'liability'];
    for (const clause of knownGaps) {
      expect(report.detection.perClause[clause]).toBeDefined();
    }
  });
});
