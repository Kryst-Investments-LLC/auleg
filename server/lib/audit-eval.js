/**
 * Audit Engine Evaluation Harness (pure).
 *
 * Scores the deterministic audit engine against a labeled golden set and
 * reports precision / recall / F1 for clause detection, gap-analysis accuracy,
 * and risk-band accuracy.
 *
 * This is the regression gate for any change to the engine — including the
 * planned LLM-primary rewrite. It performs no I/O of its own: callers pass in
 * the golden set and an `analyze(text)` function (defaults to the deterministic
 * engine), so an LLM-backed analyzer can be evaluated with the same harness.
 */

const defaultEngine = require('./audit-engine');

/**
 * Compute precision/recall/F1 from confusion counts.
 */
function prf(tp, fp, fn) {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    tp,
    fp,
    fn
  };
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Evaluate an analyzer against a golden set.
 *
 * @param {object} goldenSet Parsed golden-set.json.
 * @param {(text:string)=>{clauses:object,gap_report:string[],risk_profile:object}} [analyze]
 *        Analysis function. Defaults to the deterministic engine's `analyze`.
 *        Async analyzers are supported (the function is awaited).
 * @returns {Promise<object>} Metrics report.
 */
async function evaluate(goldenSet, analyze = defaultEngine.analyze) {
  const universe = goldenSet.clauseUniverse;
  const required = goldenSet.requiredClauses;

  // Per-clause detection confusion counts across all cases
  const detection = {};
  for (const c of universe) detection[c] = { tp: 0, fp: 0, fn: 0 };

  // Gap-analysis counts (over required clauses)
  let gapTp = 0;
  let gapFp = 0;
  let gapFn = 0;
  let gapExactCases = 0;

  let riskCorrect = 0;
  const cases = [];

  for (const testCase of goldenSet.cases) {
    const result = await analyze(testCase.text);
    const detected = new Set(Object.keys(result.clauses || {}));
    const expected = new Set(testCase.expected.clausesPresent || []);

    // Clause detection confusion (over the full clause universe)
    for (const clause of universe) {
      const inDetected = detected.has(clause);
      const inExpected = expected.has(clause);
      if (inDetected && inExpected) detection[clause].tp++;
      else if (inDetected && !inExpected) detection[clause].fp++;
      else if (!inDetected && inExpected) detection[clause].fn++;
    }

    // Gap analysis (which required clauses are reported missing)
    const detectedGaps = new Set(result.gap_report || []);
    const expectedGaps = new Set(testCase.expected.requiredGaps || []);
    let caseGapExact = true;
    for (const clause of required) {
      const inDetected = detectedGaps.has(clause);
      const inExpected = expectedGaps.has(clause);
      if (inDetected && inExpected) gapTp++;
      else if (inDetected && !inExpected) {
        gapFp++;
        caseGapExact = false;
      } else if (!inDetected && inExpected) {
        gapFn++;
        caseGapExact = false;
      }
    }
    if (caseGapExact) gapExactCases++;

    // Risk band accuracy
    const band = result.risk_profile?.overall_risk;
    const bandOk = !testCase.expected.riskBand || testCase.expected.riskBand.includes(band);
    if (bandOk) riskCorrect++;

    cases.push({
      id: testCase.id,
      name: testCase.name,
      detected: [...detected],
      expected: [...expected],
      missed: [...expected].filter(c => !detected.has(c)),
      falsePositives: [...detected].filter(c => !expected.has(c)),
      riskBand: band,
      riskBandOk: bandOk
    });
  }

  // Aggregate detection metrics (micro-averaged across clauses)
  let TP = 0;
  let FP = 0;
  let FN = 0;
  const perClause = {};
  for (const clause of universe) {
    const { tp, fp, fn } = detection[clause];
    TP += tp;
    FP += fp;
    FN += fn;
    perClause[clause] = prf(tp, fp, fn);
  }

  return {
    detection: {
      overall: prf(TP, FP, FN),
      perClause
    },
    gapAnalysis: {
      overall: prf(gapTp, gapFp, gapFn),
      exactCaseMatchRate: round(gapExactCases / goldenSet.cases.length)
    },
    riskBandAccuracy: round(riskCorrect / goldenSet.cases.length),
    caseCount: goldenSet.cases.length,
    cases
  };
}

module.exports = { evaluate, prf };
