/* ============================================================================
 * verify_export.js — THE JAVASCRIPT HALF OF THE CROSS-LANGUAGE CHECK
 * ----------------------------------------------------------------------------
 * Run with:   python ml/verify_export.py     (writes the fixtures)
 *             node test/verify_export.js     (this file)
 *
 * ml/verify_export.py proves the exported JSON reproduces the pinball loss the
 * fitted model actually achieved — that link is sklearn -> artefact.
 *
 * This file proves the second link, artefact -> JavaScript: that the scorer in
 * src/forecast.js returns exactly what a pure-Python reading of the same file
 * returns, on rows spread across the feature space so that different branches
 * of the trees are exercised.
 *
 * Together the two say the number a taxpayer is shown is the number the model
 * was fitted to produce. Neither on its own does.
 *
 * If the fixtures are missing this exits 0 with a notice rather than failing,
 * so that the suite still runs on a machine where the model has not been
 * trained. A missing model is a known state; a wrong model is not.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

global.window = global;
const ROOT = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'src', 'forecast.js'), 'utf8'));

// Both paths may be overridden on the command line, so the same test can be
// pointed at a smaller artefact while a full training run is still going.
const ARTEFACT = process.argv[2] || path.join(ROOT, 'models', 'forecaster.json');
const FIXTURES = process.argv[3] || path.join(ROOT, 'ml', 'data', 'export_check.json');

if (!fs.existsSync(ARTEFACT) || !fs.existsSync(FIXTURES)) {
  console.log('\n  SKIPPED — no trained model on this machine.');
  console.log('  Run:  python ml/generate_population.py');
  console.log('        python ml/train_forecaster.py');
  console.log('        python ml/verify_export.py\n');
  process.exit(0);
}

const artefact = JSON.parse(fs.readFileSync(ARTEFACT, 'utf8'));
const fixtures = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));

let pass = 0;
let fail = 0;

function ok(label, condition, detail) {
  if (condition) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label); }
  if (detail) console.log('        ' + detail);
}

console.log('\n' + '='.repeat(74));
console.log('Cross-language fidelity: ' + artefact.kind);
console.log('='.repeat(74));

/* ---- the artefact's own declarations must line up --------------------- */
ok('Feature list matches between artefact and fixtures',
   JSON.stringify(artefact.features) === JSON.stringify(fixtures.features),
   artefact.features.join(', '));

ok('Quantile grid matches',
   JSON.stringify(artefact.quantiles) === JSON.stringify(fixtures.quantiles),
   artefact.quantiles.length + ' quantiles from ' +
   artefact.quantiles[0] + ' to ' + artefact.quantiles[artefact.quantiles.length - 1]);

/* ---- score every fixture row through the shipping scorer -------------- */
// Scored through the same internal path predict() uses, so this tests the code
// that actually runs in the browser rather than a test-only replica.
Forecast.loadModel(artefact);

let worst = 0;
let worstAt = null;
let compared = 0;

for (let r = 0; r < fixtures.rows.length; r++) {
  const row = fixtures.rows[r];
  for (let c = 0; c < artefact.models.length; c++) {
    const got = Forecast.scoreQuantileForTest(artefact.models[c], row.x);
    const want = row.expected[c];
    const d = Math.abs(got - want);
    if (d > worst) { worst = d; worstAt = { row: r, quantile: artefact.quantiles[c], got, want }; }
    compared++;
  }
}

ok('JavaScript reproduces the Python reading on every fixture',
   worst < 1e-9,
   compared + ' scores compared across ' + fixtures.rows.length +
   ' rows; largest disagreement ' + worst.toExponential(2) +
   (worstAt && worst >= 1e-9
     ? '  (row ' + worstAt.row + ', q=' + worstAt.quantile +
       ': got ' + worstAt.got + ', expected ' + worstAt.want + ')'
     : ''));

/* ---- and the loaded model produces a usable distribution -------------- */
const d = Forecast.predict({
  currentIncome: 1600000, employmentType: 'professional', age: 29,
  variableShare: 0.4, expYears: 7, recentGrowth: 0.08, yearsSinceSwitch: 2,
  city: 'metro',
});

ok('The loaded model yields a monotone quantile function',
   d.quantile(0.1) < d.quantile(0.5) && d.quantile(0.5) < d.quantile(0.9),
   'p10 ' + Math.round(d.quantile(0.1)) +
   '  median ' + Math.round(d.median) +
   '  p90 ' + Math.round(d.quantile(0.9)));

ok('...and reports itself as trained, with provenance intact',
   d.kind === 'trained' && /synthetic/i.test(d.provenance),
   d.provenance);

ok('...and carries the measured improvement over the prior',
   d.metrics && typeof d.metrics.improvementOverPriorPct === 'number',
   d.metrics
     ? 'pinball loss ' + d.metrics.priorPinball.toFixed(6) + ' -> ' +
       d.metrics.chosenPinball.toFixed(6) +
       '  (' + d.metrics.improvementOverPriorPct.toFixed(2) + '% better than the prior)'
     : 'no metrics');

console.log('\n' + '='.repeat(74));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
