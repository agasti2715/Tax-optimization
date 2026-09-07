/* ============================================================================
 * verify_allocate.js — TESTS FOR THE BUDGET-CONSTRAINED ALLOCATOR
 * ----------------------------------------------------------------------------
 * Run with:   node test/verify_allocate.js
 *
 * The claim allocate.js makes is a strong one — that its answer is not merely
 * good but OPTIMAL. That claim has to be tested, not asserted, so section 5
 * checks the solver against brute force on a fine grid. If a random search can
 * beat it, the decomposition argument in the header is wrong.
 *
 * Section 2 tests the thing the whole module exists for: that the objective is
 * tax PLUS the real cost of the action. Minimise tax alone and the optimiser
 * recommends giving all your money to charity, which saves a great deal of tax
 * and leaves the taxpayer far poorer.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

global.window = global;
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['rulebook.js', 'engine.js', 'interest.js', 'forecast.js',
                 'advancetax.js', 'allocate.js', 'samples.js']) {
  eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
}

/* ---------- assertions --------------------------------------------------- */

let pass = 0;
let fail = 0;
const inr = (v) => 'Rs.' + Math.round(v).toLocaleString('en-IN');

function ok(label, condition, detail) {
  if (condition) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label); }
  if (detail) console.log('        ' + detail);
}

function section(t) {
  console.log('\n' + '='.repeat(74));
  console.log(t);
  console.log('='.repeat(74));
}

const YEAR = 'FY2025-26';
const PROFILES = ['priya', 'rajesh', 'ananya', 'vikram', 'suresh', 'meera'];
const BUDGETS = [0, 25000, 50000, 100000, 200000, 350000];

/* ==========================================================================
 * 1. THE EXACT SOLVER IS NEVER BEATEN BY GREEDY
 * ======================================================================== */
section('1. The optimality gap is never negative');

// The greedy policy is admissible, so the minimising policy cannot do worse.
// A negative gap anywhere means the two are being scored inconsistently.
let cases = 0, nonZero = 0, negative = 0, worst = 0, total = 0;
let worstCase = null;

for (const key of PROFILES) {
  for (const budget of BUDGETS) {
    const g = Allocate.optimalityGap(SAMPLES[key], YEAR, budget);
    cases++;
    total += g.gap;
    if (g.gap > 0) nonZero++;
    if (g.gap < 0) negative++;
    if (g.gap > worst) { worst = g.gap; worstCase = key + ' at ' + inr(budget); }
  }
}

ok('No case where greedy beats the exact solver',
   negative === 0,
   cases + ' profile/budget combinations tested');

ok('Greedy leaves money on the table in a meaningful fraction of cases',
   nonZero > 0,
   nonZero + ' of ' + cases + ' cases show a gap; mean ' + inr(total / cases) +
   ', worst ' + inr(worst) + ' (' + worstCase + ')');

/* ==========================================================================
 * 2. CHARITY IS NOT A TAX STRATEGY
 * ======================================================================== */
section('2. The optimiser is offered donations and refuses them');

// 80G is deliberately in the instrument list with a cost ratio of 1.00, so the
// optimiser HAS the option. A model that cannot choose charity has not
// refused it. Giving a rupee away to save at most 30 paise is a loss, and the
// objective has to be able to see that.
let donations = 0;
for (const key of PROFILES) {
  for (const budget of [50000, 200000, 500000]) {
    const r = Allocate.optimise(SAMPLES[key], YEAR, { budget });
    if (r.allocation.some((a) => a.section === '80G')) donations++;
  }
}
ok('Never recommends donating in order to save tax', donations === 0,
   'a solver minimising tax alone would donate the entire budget every time');

// And it must be a real refusal, not an absence of opportunity.
const offered = Allocate.availableInstruments(SAMPLES.rajesh, 'old', YEAR)
  .some((i) => i.section === '80G');
ok('...and 80G really was on the menu', offered,
   'the instrument list includes donations at a cost ratio of 1.00');

/* ==========================================================================
 * 3. NEVER RECOMMEND A LOSING MOVE
 * ======================================================================== */
section('3. Every recommendation leaves the taxpayer better off');

let losing = 0;
for (const key of PROFILES) {
  for (const budget of BUDGETS) {
    const r = Allocate.optimise(SAMPLES[key], YEAR, { budget });
    if (r.netGain < -0.5) losing++;
  }
}
ok('Net gain is never negative — doing nothing is always available',
   losing === 0,
   'the empty allocation is in the candidate set, so the optimum can never be worse than it');

/* ==========================================================================
 * 4. MORE BUDGET IS NEVER WORSE
 * ======================================================================== */
section('4. A larger budget never produces a worse answer');

// Monotonicity: the feasible set grows with the budget, so the minimum over it
// cannot rise. This catches a whole class of bug in candidateTargets, where a
// larger budget shifts the grid and accidentally skips the good point.
let violations = 0;
let detail = '';
for (const key of PROFILES) {
  let previous = Infinity;
  for (const budget of BUDGETS) {
    const r = Allocate.optimise(SAMPLES[key], YEAR, { budget });
    if (r.objective > previous + 1) {
      violations++;
      detail = key + ': objective rose from ' + inr(previous) + ' to ' + inr(r.objective) +
               ' when the budget grew to ' + inr(budget);
    }
    previous = Math.min(previous, r.objective);
  }
}
ok('Objective is non-increasing in the budget', violations === 0, detail || 'checked across all profiles');

/* ==========================================================================
 * 5. THE OPTIMALITY CLAIM, AGAINST BRUTE FORCE
 * ======================================================================== */
section('5. Brute force cannot beat the solver');

// The header argues the solver is exact: for a fixed total deduction the
// cheapest way to reach it is a continuous knapsack, so scanning breakpoints
// finds the global optimum. That argument is worth exactly as much as this
// test.
//
// Brute force here means: try thousands of random feasible allocations
// directly, evaluate each through the real engine, and see whether any beats
// the solver's answer. If the decomposition is sound, none can.
function bruteForce(profile, regime, budget, trials, seed) {
  const instruments = Allocate.availableInstruments(profile, regime, YEAR);
  if (!instruments.length) return null;

  let rng = seed >>> 0;
  const rand = () => {
    rng ^= rng << 13; rng >>>= 0;
    rng ^= rng >> 17;
    rng ^= rng << 5; rng >>>= 0;
    return rng / 4294967296;
  };

  let best = Infinity;
  for (let t = 0; t < trials; t++) {
    const picks = [];
    let outlay = 0;
    let cost = 0;
    // Random order, random amounts — no knowledge of the cost ratios at all.
    const shuffled = instruments.slice().sort(() => rand() - 0.5);
    for (const inst of shuffled) {
      const room = inst.restructuring ? Infinity : Math.max(0, budget - outlay);
      const take = Math.min(inst.headroom, room) * rand();
      if (take <= 0.5) continue;
      picks.push({ instrument: inst, amount: take, cost: take * inst.costRatio });
      if (!inst.restructuring) outlay += take;
      cost += take * inst.costRatio;
    }
    const p = Allocate.applyAllocation(profile, { picks });
    const objective = TaxEngine.computeRegime(p, regime, YEAR).totalTax + cost;
    if (objective < best) best = objective;
  }
  return best;
}

let beaten = 0;
let closest = Infinity;
let checked = 0;

for (const key of ['priya', 'rajesh', 'vikram']) {
  for (const budget of [50000, 150000]) {
    for (const regime of ['old', 'new']) {
      const solved = Allocate.solveRegime(SAMPLES[key], YEAR, regime, budget);
      if (!solved.best) continue;
      const brute = bruteForce(SAMPLES[key], regime, budget, 4000, 12345 + checked);
      if (brute === null) continue;
      checked++;
      // The bound is Rs.10, and it is a property of the statute rather than
      // slack in the search. s.288A rounds total income to the nearest Rs.10
      // and the engine rounds tax the same way, so the objective is a step
      // function with Rs.10 treads. A random allocation at a fractional
      // amount can occasionally catch a rounding step and come in a few
      // rupees under. Two plans separated by less than Rs.10 are the same
      // plan in law, so that is the honest bound to test against.
      if (brute < solved.best.objective - 10) {
        beaten++;
        console.log('        BEATEN: ' + key + ' ' + regime + ' @' + inr(budget) +
                    ' — brute ' + inr(brute) + ' vs solver ' + inr(solved.best.objective));
      }
      closest = Math.min(closest, brute - solved.best.objective);
    }
  }
}

ok('4,000 random allocations per case never beat the solver by more than Rs.10',
   beaten === 0,
   checked + ' cases brute-forced; the best random allocation came within ' +
   inr(Math.abs(closest)) + ' of the solver. The Rs.10 bound is the rounding ' +
   'granularity of the statute itself (s.288A), not slack in the search.');

/* ==========================================================================
 * 6. RESTRUCTURING IS FREE, AND WORKS IN THE NEW REGIME
 * ======================================================================== */
section('6. Salary restructuring needs no budget and survives s.115BAC');

// 80CCD(2) is the one substantial deduction the new regime keeps, and it is a
// restructuring rather than an outlay: the CTC does not change, only the form
// the money arrives in. So it must be available even at a budget of zero.
const broke = Allocate.optimise(SAMPLES.priya, YEAR, { budget: 0 });
ok('With no money to invest, restructuring is still recommended',
   broke.allocation.length > 0 && broke.allocation.every((a) => a.section === '80CCD(2)'),
   broke.allocation.map((a) => a.section + ' ' + inr(a.amount)).join(', ') +
   ' — outlay ' + inr(broke.outlay) + ', saving ' + inr(broke.taxSaved));

ok('...and it genuinely reduces tax rather than cancelling itself out',
   broke.taxSaved > 0,
   'employer NPS is added to gross salary and then deducted, so it only saves ' +
   'tax if cash allowances fall by the same amount — ' + inr(broke.taxSaved) + ' saved');

ok('...in the NEW regime, where nothing else is available',
   broke.regime === 'new', 'regime chosen: ' + broke.regime);

/* ==========================================================================
 * SUMMARY
 * ======================================================================== */
console.log('\n' + '='.repeat(74));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
