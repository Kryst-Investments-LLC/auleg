#!/usr/bin/env node
/**
 * CLI: evaluate the DPA audit engine against the golden set.
 *
 *   node scripts/eval-engine.js            # human-readable report
 *   node scripts/eval-engine.js --json     # machine-readable JSON
 *   node scripts/eval-engine.js --min-f1 0.6   # exit 1 if detection F1 below threshold (CI gate)
 *
 * Use this to baseline the current engine and to gate the LLM-primary rewrite:
 * the rewrite must not regress detection F1, gap accuracy, or risk-band accuracy.
 */

const fs = require('fs');
const path = require('path');
const { evaluate } = require('../lib/audit-eval');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const goldenPath = path.resolve(__dirname, '../__tests__/fixtures/golden/golden-set.json');
  const goldenSet = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));
  const report = await evaluate(goldenSet);

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const d = report.detection.overall;
    const g = report.gapAnalysis.overall;
    console.log('\n=== DPA Audit Engine — Golden Set Evaluation ===\n');
    console.log(`Cases:               ${report.caseCount}`);
    console.log(`Detection  P/R/F1:   ${d.precision} / ${d.recall} / ${d.f1}  (TP ${d.tp}, FP ${d.fp}, FN ${d.fn})`);
    console.log(`Gap-analysis P/R/F1: ${g.precision} / ${g.recall} / ${g.f1}`);
    console.log(`Gap exact-case rate: ${report.gapAnalysis.exactCaseMatchRate}`);
    console.log(`Risk-band accuracy:  ${report.riskBandAccuracy}\n`);

    console.log('Per-clause recall (where the detection gaps are):');
    for (const [clause, m] of Object.entries(report.detection.perClause)) {
      const flag = m.fn > 0 ? '  ⚠ MISSED' : '';
      console.log(`  ${clause.padEnd(26)} R=${m.recall}  P=${m.precision}  F1=${m.f1}${flag}`);
    }

    console.log('\nPer-case detail:');
    for (const c of report.cases) {
      console.log(`  [${c.id}] risk=${c.riskBand}${c.riskBandOk ? '' : ' (UNEXPECTED)'}`);
      if (c.missed.length) console.log(`      missed: ${c.missed.join(', ')}`);
      if (c.falsePositives.length) console.log(`      false positives: ${c.falsePositives.join(', ')}`);
    }
    console.log('');
  }

  const minF1 = Number.parseFloat(arg('--min-f1', ''));
  if (Number.isFinite(minF1) && report.detection.overall.f1 < minF1) {
    console.error(`FAIL: detection F1 ${report.detection.overall.f1} < required ${minF1}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
