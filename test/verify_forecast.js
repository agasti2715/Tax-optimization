/* ============================================================================
 * verify_forecast.js — TESTS FOR THE FORECASTER, BOTH TIERS
 * ----------------------------------------------------------------------------
 * Run with:   node test/verify_forecast.js
 *
 * WHY THIS FILE MATTERS MORE THAN IT LOOKS.
 *
 * The trained model is produced in Python (ml/train_forecaster.py) and scored
 * in JavaScript (src/forecast.js). That is a language boundary with a
 * serialised artefact across it, and it is the classic place for a model to go
 * quietly wrong: features in a different order, a tree's `value` array left
 * nested, a learning rate dropped, quantiles returned unsorted. None of those
 * throw. They just produce confident, wrong numbers.
 *
 * So rather than wait for a trained artefact to exist, these tests hand-build
 * small model files whose correct output can be computed on paper, and check
 * the JavaScript scorer against them. When the real model is trained, the
 * inference path it lands on is already proven.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

global.window = global;
const SRC = path.join(__dirname, '..', 'src');
eval(fs.readFileSync(path.join(SRC, 'forecast.js'), 'utf8'));

/* ---------- assertions --------------------------------------------------- */

let pass = 0;
let fail = 0;

function close(label, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) {
    pass++;
    console.log('  PASS  ' + label);
    console.log('        = ' + actual.toFixed(6) + '  (expected ' + expected.toFixed(6) + ')');
  } else {
    fail++;
    console.log('  FAIL  ' + label);
    console.log('        got ' + actual.toFixed(6) + ', expected ' + expected.toFixed(6));
  }
}

function ok(label, condition, detail) {
  if (condition) {
    pass++;
    console.log('  PASS  ' + label);
    if (detail) console.log('        ' + detail);
  } else {
    fail++;
    console.log('  FAIL  ' + label);
    if (detail) console.log('        ' + detail);
  }
}

function section(t) {
  console.log('\n' + '='.repeat(74));
  console.log(t);
  console.log('='.repeat(74));
}

/* ==========================================================================
 * 1. THE PROBIT — the prior's quantile function depends on it
 * ======================================================================== */
section('1. Inverse normal CDF (Acklam)');

close('probit(0.5) is 0', Forecast.probit(0.5), 0, 1e-9);
close('probit(0.975) is 1.959964', Forecast.probit(0.975), 1.959964, 1e-5);
close('probit(0.025) is -1.959964', Forecast.probit(0.025), -1.959964, 1e-5);
close('probit(0.68) is 0.467699', Forecast.probit(0.68), 0.467699, 1e-5);
ok('probit is monotone increasing',
   Forecast.probit(0.1) < Forecast.probit(0.4) &&
   Forecast.probit(0.4) < Forecast.probit(0.9));

/* ==========================================================================
 * 2. TIER 1 — the analytic prior
 * ======================================================================== */
section('2. The analytic prior');

const feat = { currentIncome: 1000000, employmentType: 'salaried', age: 30, variableShare: 0 };
const prior = Forecast.predict(feat);

ok('With no model loaded, the prior is used', prior.kind === 'prior', prior.provenance);

// mu = 0.080 * ageTaper(30) = 0.080 * 1.10 = 0.088; sigma = 0.14 * (1+0) = 0.14
// median = 1,000,000 * exp(0.088) = 1,092,000
close('Median is current income times exp(mu)',
      prior.median, 1000000 * Math.exp(0.088), 1);

// The lognormal mean sits above its median.
close('Mean is exp(mu + sigma^2/2) times current',
      prior.mean, 1000000 * Math.exp(0.088 + (0.14 * 0.14) / 2), 1);
ok('...and therefore exceeds the median', prior.mean > prior.median,
   'mean ' + Math.round(prior.mean) + ' vs median ' + Math.round(prior.median));

ok('Quantiles are monotone',
   prior.quantile(0.1) < prior.quantile(0.5) && prior.quantile(0.5) < prior.quantile(0.9));

// Variable pay widens the distribution without moving its centre.
const volatile = Forecast.predict(Object.assign({}, feat, { variableShare: 0.8 }));
close('Variable pay leaves the median where it was', volatile.median, prior.median, 1);
ok('...but widens the spread', volatile.spread > prior.spread,
   (prior.spread * 100).toFixed(0) + '% -> ' + (volatile.spread * 100).toFixed(0) + '%');

// The self-employed are harder to forecast than the salaried.
const biz = Forecast.predict(Object.assign({}, feat, { employmentType: 'business' }));
ok('Business income is forecast with a wider spread than salary',
   biz.spread > prior.spread,
   'salaried ' + (prior.spread * 100).toFixed(0) + '% vs business ' + (biz.spread * 100).toFixed(0) + '%');

/* ==========================================================================
 * 3. QUANTILE CROSSING
 * ======================================================================== */
section('3. Quantile crossing is repaired');

const crossed = Forecast.repairCrossing([0.10, 0.30, 0.20, 0.50, 0.40]);
ok('Out-of-order quantile estimates are sorted',
   JSON.stringify(crossed) === JSON.stringify([0.10, 0.20, 0.30, 0.40, 0.50]),
   'independently fitted quantiles can cross; sorting is the standard repair');

/* ==========================================================================
 * 4. TIER 2 — LINEAR MODEL INFERENCE
 * ======================================================================== */
section('4. Scoring a linear quantile model exported from Python');

// A hand-built artefact whose output can be checked on paper.
//   score = intercept + 0.01*logIncome + 0.20*variableShare
// For income 1,000,000 (log = 13.815511) and variableShare 0.5:
//   0.01*13.815511 + 0.20*0.5 = 0.13815511 + 0.10 = 0.23815511
const LOG_1M = Math.log(1000000);
const expectedBase = 0.01 * LOG_1M + 0.20 * 0.5;

Forecast.loadModel({
  version: 1,
  kind: 'quantile-linear',
  features: ['logIncome', 'variableShare'],
  quantiles: [0.25, 0.50, 0.75],
  models: [
    { kind: 'linear', intercept: -0.05, coef: [0.01, 0.20] },
    { kind: 'linear', intercept: 0.00,  coef: [0.01, 0.20] },
    { kind: 'linear', intercept: 0.05,  coef: [0.01, 0.20] },
  ],
  metrics: { priorPinball: 0.09, chosenPinball: 0.08, improvementOverPriorPct: 11.1 },
});

ok('A loaded model switches the forecaster to tier 2', Forecast.hasTrainedModel());

const trained = Forecast.predict({
  currentIncome: 1000000, employmentType: 'salaried', age: 30, variableShare: 0.5,
});
ok('...and predictions are labelled as trained', trained.kind === 'trained', trained.provenance);

// The median quantile has intercept 0, so log-growth = expectedBase.
close('Median matches the hand-computed linear score',
      trained.median, 1000000 * Math.exp(expectedBase), 1);

// The 25th percentile carries intercept -0.05.
close('The 25th percentile matches too',
      trained.quantile(0.25), 1000000 * Math.exp(expectedBase - 0.05), 1);

ok('Feature ORDER is taken from the artefact, not assumed',
   Math.abs(trained.median - 1000000 * Math.exp(0.20 * LOG_1M + 0.01 * 0.5)) > 1,
   'swapping the two coefficients would give a very different answer, and does not');

ok('Training metrics survive into the prediction for the UI to show',
   trained.metrics !== null && trained.metrics.improvementOverPriorPct === 11.1);

/* ==========================================================================
 * 5. FORCING THE PRIOR
 * ======================================================================== */
section('5. The prior can still be forced, for measuring what the model adds');

const forced = Forecast.predict({
  currentIncome: 1000000, employmentType: 'salaried', age: 30, variableShare: 0.5,
}, { forcePrior: true });
ok('forcePrior bypasses a loaded model', forced.kind === 'prior',
   'this is what AdvanceTax.valueOfModel() uses to price the forecaster in rupees');

/* ==========================================================================
 * 6. TIER 2 — TREE ENSEMBLE INFERENCE
 * ======================================================================== */
section('6. Walking a gradient-boosted tree exported from sklearn');

// One stump: if logIncome <= 13.0 take 0.10, else take 0.30.
// Node 0 is the split; nodes 1 and 2 are leaves (children_left = -1).
const stump = {
  feature: [0, -2, -2],
  threshold: [13.0, -2, -2],
  children_left: [1, -1, -1],
  children_right: [2, -1, -1],
  value: [0.0, 0.10, 0.30],
};

Forecast.loadModel({
  version: 1,
  kind: 'quantile-gbm',
  features: ['logIncome'],
  quantiles: [0.5],
  models: [{ kind: 'gbm', init: 0.02, learningRate: 0.5, trees: [stump, stump] }],
});

// log(1,000,000) = 13.8155 > 13.0, so both stumps take the right leaf:
//   0.02 + 0.5*0.30 + 0.5*0.30 = 0.32
const high = Forecast.predict({ currentIncome: 1000000, employmentType: 'salaried', age: 30 });
close('Boosted score above the split threshold',
      high.median, 1000000 * Math.exp(0.32), 1);

// log(300,000) = 12.6115 <= 13.0, so both take the left leaf:
//   0.02 + 0.5*0.10 + 0.5*0.10 = 0.12
const low = Forecast.predict({ currentIncome: 300000, employmentType: 'salaried', age: 30 });
close('Boosted score below the split threshold',
      low.median, 300000 * Math.exp(0.12), 1);

// Both stumps must contribute. Scoring only the first would give
// 0.02 + 0.5*0.30 = 0.17 instead of 0.32 — a 16% error in the forecast, with
// nothing thrown and nothing logged.
ok('Every tree in the ensemble contributes, not just the first',
   Math.abs(high.median - 1000000 * Math.exp(0.02 + 0.5 * 0.30)) > 1,
   'one-tree answer would be ' + Math.round(1000000 * Math.exp(0.17)) +
   ', full ensemble gives ' + Math.round(high.median));

/* ==========================================================================
 * 7. A MALFORMED ARTEFACT IS REFUSED
 * ======================================================================== */
section('7. A bad model file falls back rather than corrupting the forecast');

ok('A model without quantiles is rejected', Forecast.loadModel({ models: [] }) === false);
ok('An empty payload is rejected', Forecast.loadModel(null) === false);

/* ==========================================================================
 * SUMMARY
 * ======================================================================== */
console.log('\n' + '='.repeat(74));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
