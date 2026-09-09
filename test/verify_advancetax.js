/* ============================================================================
 * verify_advancetax.js — TESTS FOR THE NEWSVENDOR ADVANCE TAX OPTIMISER
 * ----------------------------------------------------------------------------
 * Run with:   node test/verify_advancetax.js
 *
 * These are not arithmetic tests — verify_interest.js already pins the rupee
 * figures. These test the CLAIM the feature makes:
 *
 *   "The correct advance tax instalment is not your expected liability. It is
 *    a quantile of your liability distribution, and that quantile sits above
 *    the median because underpaying costs about twice what overpaying costs."
 *
 * If that claim is false, the feature is worthless, and these tests are what
 * would tell us. They assert the SHAPE of the answer, not a magic number.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

global.window = global;
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['rulebook.js', 'engine.js', 'interest.js', 'forecast.js',
                 'advancetax.js', 'samples.js']) {
  eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
}

/* ---------- assertions --------------------------------------------------- */

let pass = 0;
let fail = 0;
const inr = (v) => 'Rs.' + Math.round(v).toLocaleString('en-IN');

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

const YEAR = 'FY2025-26';
const OPTS = { samples: 300 };

/* ==========================================================================
 * 1. THE HEADLINE CLAIM — the optimum sits above the median
 * ======================================================================== */
section('1. The optimal instalment is ABOVE the median forecast');

const cases = [
  ['Salaried, steady pay',     SAMPLES.priya, { employmentType: 'salaried', age: 31, variableShare: 0.0 }],
  ['Salaried, 35% variable',   SAMPLES.priya, { employmentType: 'salaried', age: 31, variableShare: 0.35 }],
  ['Salaried, 80% variable',   SAMPLES.priya, { employmentType: 'salaried', age: 31, variableShare: 0.8 }],
];

const results = [];
for (const [label, profile, features] of cases) {
  const r = AdvanceTax.optimise(profile, YEAR, features, OPTS);
  results.push([label, r]);
  ok(label + ' -> theta* = ' + r.optimal.theta,
     r.optimal.theta > 0.5,
     'forecast spread ' + (r.forecast.spread * 100).toFixed(0) + '% of median; ' +
     'liability median ' + inr(r.liability.median));
}

/* ==========================================================================
 * 2. THE OPTIMUM ACTUALLY BEATS THE ALTERNATIVES
 * ======================================================================== */
section('2. The optimum beats every naive schedule');

for (const [label, r] of results) {
  ok(label + ': beats paying at the median',
     r.optimal.expectedCost <= r.alternatives.median.expectedCost,
     inr(r.optimal.expectedCost) + ' vs ' + inr(r.alternatives.median.expectedCost) +
     '  (saves ' + inr(r.savingVsMedian) + ')');

  ok(label + ': beats the conventional point estimate',
     r.optimal.expectedCost <= r.alternatives.pointEstimate.expectedCost,
     inr(r.optimal.expectedCost) + ' vs ' + inr(r.alternatives.pointEstimate.expectedCost) +
     '  (saves ' + inr(r.savingVsPoint) + ')');

  ok(label + ': beats paying nothing',
     r.optimal.expectedCost < r.alternatives.nothing.expectedCost,
     inr(r.optimal.expectedCost) + ' vs ' + inr(r.alternatives.nothing.expectedCost));
}

/* ==========================================================================
 * 3. THE CLOSED FORM AGREES WITH THE SEARCH — APPROXIMATELY
 * ======================================================================== */
section('3. The newsvendor formula predicts where the search lands');

// The two do NOT agree exactly, and it is worth being clear about why rather
// than fudging the tolerance. The textbook critical ratio assumes a smooth
// cost function with constant Cu and Co. The Income-tax Act does not supply
// one: the 12% and 36% safe harbours put plateaus in it, Rule 119A rounds the
// base down to hundreds, and 234B is a cliff at 90% rather than a slope. So
// the closed form is a good explanation of WHY the optimum is above the
// median, and the grid search is what actually decides WHERE.
for (const [label, r] of results) {
  ok(label + ': closed form is on the same side of 0.5',
     r.closedForm.ratio > 0.5,
     'formula ' + r.closedForm.ratio.toFixed(3) + '  vs search ' + r.optimal.theta +
     '   (Cu ' + r.closedForm.cu.toFixed(4) + '/rupee, Co ' + r.closedForm.co.toFixed(4) + '/rupee)');

  ok(label + ': closed form is within 0.2 of the search',
     Math.abs(r.closedForm.ratio - r.optimal.theta) < 0.2,
     'gap ' + Math.abs(r.closedForm.ratio - r.optimal.theta).toFixed(3));
}

// The asymmetry itself is the mechanism. If Cu ever stops exceeding Co, the
// optimum would fall back to the median and this whole feature is pointless.
for (const [label, r] of results) {
  ok(label + ': underpaying costs more per rupee than overpaying',
     r.closedForm.cu > r.closedForm.co,
     'Cu/Co = ' + (r.closedForm.cu / r.closedForm.co).toFixed(2) + 'x');
}

/* ==========================================================================
 * 4. MORE UNCERTAINTY WIDENS THE FORECAST
 * ======================================================================== */
section('4. Variable pay widens the forecast, as it should');

const steady = results[0][1];
const volatile = results[2][1];
ok('80% variable pay produces a wider forecast than flat salary',
   volatile.forecast.spread > steady.forecast.spread,
   'spread ' + (steady.forecast.spread * 100).toFixed(0) + '% -> ' +
   (volatile.forecast.spread * 100).toFixed(0) + '%');

ok('...and a wider liability distribution with it',
   (volatile.liability.p90 - volatile.liability.p10) >
   (steady.liability.p90 - steady.liability.p10),
   inr(steady.liability.p90 - steady.liability.p10) + ' -> ' +
   inr(volatile.liability.p90 - volatile.liability.p10));

/* ==========================================================================
 * 5. REPRODUCIBILITY
 * ======================================================================== */
section('5. The same seed gives the same answer');

const a = AdvanceTax.optimise(SAMPLES.priya, YEAR, { employmentType: 'salaried', age: 31, variableShare: 0.3 }, { samples: 200, seed: 7 });
const b = AdvanceTax.optimise(SAMPLES.priya, YEAR, { employmentType: 'salaried', age: 31, variableShare: 0.3 }, { samples: 200, seed: 7 });
ok('Monte Carlo is seeded, so a demo is repeatable',
   a.optimal.theta === b.optimal.theta && a.optimal.expectedCost === b.optimal.expectedCost,
   'theta ' + a.optimal.theta + ', cost ' + inr(a.optimal.expectedCost));

/* ==========================================================================
 * 6. THE CAPITAL GAINS SHIELD IS PICKED UP
 * ======================================================================== */
section('6. Capital gains are recognised as shielded under the fourth proviso');

const withGains = JSON.parse(JSON.stringify(SAMPLES.priya));
withGains.capitalGains = { stcgEquity: 0, ltcgEquity: 600000, stcgOther: 0, ltcgOther: 0 };
const g = AdvanceTax.optimise(withGains, YEAR, { employmentType: 'salaried', age: 31, variableShare: 0.2 }, OPTS);
ok('Tax on declared capital gains is identified and shielded',
   g.cgShield > 0,
   inr(g.cgShield) + ' of the liability is attributable to capital gains, ' +
   'and a shortfall up to that amount is forgiven if settled later');

/* ==========================================================================
 * SUMMARY
 * ======================================================================== */
console.log('\n' + '='.repeat(74));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
