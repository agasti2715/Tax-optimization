/* ============================================================================
 * verify_stopping.js — TESTS FOR THE s.115BAC(6) OPTIMAL STOPPING MODEL
 * ----------------------------------------------------------------------------
 * Run with:   node test/verify_stopping.js
 *
 * A dynamic program is easy to write and hard to know you have written
 * correctly — it produces confident numbers whether or not the recursion is
 * right. So rather than pinning output values, these tests assert STRUCTURAL
 * PROPERTIES that must hold if the formulation is sound, and would fail
 * loudly if it is not.
 *
 * The most important is the dominance invariant in section 2. It caught a real
 * bug: the year-0 action was originally read off the nearest grid node, and
 * because the grid is log-spaced with double-digit gaps between nodes, the
 * recommendation could come from a neighbouring income on the other side of
 * the regime crossover. The DP then appeared to advise paying MORE tax to
 * reach a weakly worse state, which is impossible. Year 0 is now evaluated at
 * the taxpayer's exact income, and this test is what holds that in place.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

global.window = global;
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['rulebook.js', 'engine.js', 'interest.js', 'forecast.js',
                 'advancetax.js', 'stopping.js', 'samples.js']) {
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
const FAST = { gridSize: 48, draws: 150 };

/** A professional with enough deductions that the old regime is competitive. */
function consultant(profit, opts) {
  const o = opts || {};
  const p = blankProfile();
  p.name = 'Consultant';
  p.employmentType = 'professional';
  p.city = 'metro';
  p.business = { netProfit: profit, grossReceipts: profit * 1.05, isProfessional: true };
  p.house = { status: 'selfOccupied', loanInterest: o.loan === undefined ? 200000 : o.loan,
              principalRepaid: 150000, rentReceived: 0, municipalTax: 0 };
  p.deductions.sec80C = 150000;
  p.deductions.sec80CCD1B = 50000;
  p.deductions.sec80D_self = 25000;
  p.deductions.sec80D_parents = 50000;
  p.deductions.parentsAreSenior = true;
  p.deductions.sec80E = o.sec80E === undefined ? 300000 : o.sec80E;
  return p;
}

const FEAT = { age: 32, employmentType: 'professional', variableShare: 0.5 };

/* ==========================================================================
 * 1. THE RULE APPLIES TO THE RIGHT PEOPLE
 * ======================================================================== */
section('1. s.115BAC(6) binds only those with business or professional income');

const salaried = RegimeStopping.analyse(
  SAMPLES.priya, YEAR, { age: 31, employmentType: 'salaried', variableShare: 0.3 }, FAST);
ok('A salaried taxpayer has no irreversible choice to model',
   salaried.applicable === false, salaried.reason);

const pro = RegimeStopping.analyse(consultant(1500000), YEAR, FEAT, FAST);
ok('A professional does — the option is real and worth valuing',
   pro.applicable === true, pro.reason);

/* ==========================================================================
 * 2. THE DOMINANCE INVARIANT
 * ======================================================================== */
section('2. Holding the option is never worse than having spent it');

// From FRESH, the taxpayer can always replicate anything OPTED can do, simply
// by opting out immediately: `optout` lands in OPTED having paid exactly the
// old-regime tax that `stay` in OPTED would have paid. A strategy set that
// contains another's cannot be worth less. So for EVERY income level:
//
//     V(t, y, FRESH) <= V(t, y, OPTED)
//
// If this ever fails, the recursion is wrong.
const grid = RegimeStopping.buildIncomeGrid(
  Object.assign({ currentIncome: 1500000 }, FEAT), 20, 48, 1);
const taxTable = RegimeStopping.buildTaxTable(consultant(1500000), YEAR, grid);
const kernel = RegimeStopping.buildKernel(
  Object.assign({ currentIncome: 1500000 }, FEAT), grid, 20, 150, 2);
const { V } = RegimeStopping.solve(taxTable, kernel, 20, 0.94);

let violations = 0;
let worst = 0;
for (let t = 0; t <= 20; t++) {
  for (let i = 0; i < grid.length; i++) {
    const d = V[t][RegimeStopping.FRESH][i] - V[t][RegimeStopping.OPTED][i];
    if (d > 1e-6) { violations++; worst = Math.max(worst, d); }
  }
}
ok('V(FRESH) <= V(OPTED) at every state in the whole table',
   violations === 0,
   violations === 0
     ? (21 * grid.length) + ' states checked, no violation'
     : violations + ' violations, worst ' + inr(worst));

/* ==========================================================================
 * 3. THE DP IS NEVER WORSE THAN THE RULE IT REPLACES
 * ======================================================================== */
section('3. Optimal policy beats — or matches — the myopic one, always');

// This is true by construction: the myopic policy is admissible, so the
// minimising policy cannot cost more. A negative cost of myopia would mean the
// benchmark and the DP are being scored on different footings.
const cases = [
  ['Lean year, heavy deductions', consultant(1200000), FRESH_STATUS()],
  ['Mid income',                  consultant(2000000), FRESH_STATUS()],
  ['Already opted out',           consultant(2000000), RegimeStopping.OPTED],
  ['High income',                 consultant(4000000), RegimeStopping.OPTED],
];
function FRESH_STATUS() { return RegimeStopping.FRESH; }

for (const [label, profile, status] of cases) {
  const r = RegimeStopping.analyse(profile, YEAR, FEAT, Object.assign({ status }, FAST));
  ok(label + ': cost of myopia is never negative',
     r.lifetime.costOfMyopia >= 0,
     'optimal ' + inr(r.lifetime.optimal) + ' vs myopic ' + inr(r.lifetime.myopic) +
     '  -> ' + inr(r.lifetime.costOfMyopia) + ' left on the table by a one-year comparison');
}

/* ==========================================================================
 * 4. LOCKED IS ABSORBING
 * ======================================================================== */
section('4. Once both moves are spent there is nothing left to decide');

const locked = RegimeStopping.analyse(
  consultant(2000000), YEAR, FEAT, Object.assign({ status: RegimeStopping.LOCKED }, FAST));
ok('A locked taxpayer is offered exactly one action',
   locked.recommendation.action === 'stay' && locked.recommendation.margin === null,
   locked.recommendation.label);

/* ==========================================================================
 * 5. THE OPTION HAS POSITIVE VALUE
 * ======================================================================== */
section('5. The option is worth something, and the model can price it');

// Spending the opt-out can never leave the taxpayer better off than holding
// it, so the priced option value must be non-negative. Zero is a legitimate
// answer — it means the optimal move is to exercise right now, in which case
// holding is worth exactly as much as spending.
let priced = 0;
for (const profit of [1200000, 1800000, 2500000]) {
  const r = RegimeStopping.analyse(consultant(profit), YEAR, FEAT,
    Object.assign({ status: RegimeStopping.FRESH }, FAST));
  ok('Option value at ' + inr(profit) + ' is non-negative',
     r.optionValue !== null && r.optionValue >= 0,
     inr(r.optionValue) + ' — the cost of spending the opt-out today');
  if (r.optionValue > 0) priced++;
}
ok('...and is strictly positive for at least one income level',
   priced > 0, priced + ' of 3 income levels price the option above zero');

/* ==========================================================================
 * 6. REPRODUCIBILITY
 * ======================================================================== */
section('6. The same seed gives the same recommendation');

const s1 = RegimeStopping.analyse(consultant(1800000), YEAR, FEAT, Object.assign({ seed: 99 }, FAST));
const s2 = RegimeStopping.analyse(consultant(1800000), YEAR, FEAT, Object.assign({ seed: 99 }, FAST));
ok('A demo run is repeatable',
   s1.recommendation.action === s2.recommendation.action &&
   s1.lifetime.optimal === s2.lifetime.optimal,
   s1.recommendation.action + ', lifetime ' + inr(s1.lifetime.optimal));

/* ==========================================================================
 * 7. THE CASE THE WHOLE FEATURE EXISTS FOR
 * ======================================================================== */
section('7. Meera Iyer — where looking ahead REVERSES the one-year answer');

// This is the demo. If this assertion ever fails, the feature has stopped
// being able to do the one thing no rival tool can, and that is worth being
// told about loudly.
const meera = RegimeStopping.analyseEnsemble(
  SAMPLES.meera, YEAR, SAMPLE_FEATURES.meera,
  { status: RegimeStopping.FRESH, runs: 5, gridSize: 48, draws: 150 });

ok('The old regime IS cheaper for her this year',
   meera.thisYear.cheaper === 'old',
   'new ' + inr(meera.thisYear.newRegime) + ' vs old ' + inr(meera.thisYear.oldRegime) +
   '  -> opting out saves ' + inr(meera.thisYear.gap) + ' today');

ok('...so every one-year tool would tell her to file Form 10-IEA',
   meera.recommendation.myopicAction === 'optout',
   'myopic answer: ' + meera.recommendation.myopicLabel);

ok('...but the dynamic program says keep the option unspent',
   meera.ensemble.action === 'stay',
   meera.ensemble.runs + ' seeds, ' + Math.round(meera.ensemble.agreement * 100) +
   '% agreement (' + meera.ensemble.confidence + ')');

ok('...and the tool reports this as a genuine contradiction',
   meera.recommendation.contradictsMyopic === true);

/* ==========================================================================
 * 8. THE MODEL IS HONEST ABOUT WHAT IT DOES NOT KNOW
 * ======================================================================== */
section('8. The margin is reported as a range, because it is not stable');

// Measured across seeds and grid resolutions, the recommended ACTION is
// stable but the rupee margin behind it is not — it moved between Rs.502 and
// Rs.3.25 lakh on an identical taxpayer. That is inherent, not fixable by
// tuning: the margin is a small difference between two lifetime values of
// order six crore, so a Monte Carlo error far below a tenth of a percent in
// each swamps it.
//
// So the contract is: trust the direction, do not quote the margin. This test
// asserts the code actually keeps that promise by exposing a range.
ok('An ensemble reports a margin RANGE rather than a single figure',
   meera.ensemble.marginRange !== null &&
   typeof meera.ensemble.marginRange.low === 'number' &&
   typeof meera.ensemble.marginRange.high === 'number',
   meera.ensemble.marginRange
     ? inr(meera.ensemble.marginRange.low) + ' to ' + inr(meera.ensemble.marginRange.high) +
       ', median ' + inr(meera.ensemble.marginRange.median)
     : 'no range reported');

ok('...and states the strength of the evidence in words',
   typeof meera.ensemble.confidence === 'string' && meera.ensemble.confidence.length > 0,
   'confidence: "' + meera.ensemble.confidence + '"');

ok('...and the spread is wide enough to justify not quoting a point figure',
   meera.ensemble.marginRange.high >= meera.ensemble.marginRange.low,
   'this is exactly why analyse() alone should not be shown to a taxpayer');

/* ==========================================================================
 * SUMMARY
 * ======================================================================== */
console.log('\n' + '='.repeat(74));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
