/* ============================================================================
 * verify_interest.js — REGRESSION TESTS FOR ss.234B, 234C AND 244A
 * ----------------------------------------------------------------------------
 * Run with:   node test/verify_interest.js
 *
 * Every expected figure below was worked out by hand from the bare text of the
 * section, and the working is written above each assertion. If a Finance Act
 * moves a rate or a threshold, these fail loudly.
 *
 * The last block is the important one for the project: it demonstrates the
 * ASYMMETRY that the whole advance-tax optimiser rests on. Underpaying by
 * Rs.X costs materially more than overpaying by the same Rs.X. If that ever
 * stops being true, the newsvendor formulation in advancetax.js is wrong and
 * should be torn out.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

global.window = global;
const SRC = path.join(__dirname, '..', 'src');
eval(fs.readFileSync(path.join(SRC, 'interest.js'), 'utf8'));

/* ---------- tiny assertion framework (same shape as verify.js) ----------- */

let pass = 0;
let fail = 0;
const inr = (v) => 'Rs.' + Math.round(v).toLocaleString('en-IN');

function eq(label, actual, expected, tolerance = 0) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    pass++;
    console.log('  PASS  ' + label);
    console.log('        = ' + inr(actual));
  } else {
    fail++;
    console.log('  FAIL  ' + label);
    console.log('        expected ' + inr(expected) + ', got ' + inr(actual));
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

const R = InterestRules;

/* ==========================================================================
 * 1. RULE 119A — the rounding nobody implements
 * ======================================================================== */
section('1. Rule 119A — rounding of the amount interest is charged on');

// 119A(a): round DOWN to the nearest Rs.100. A Rs.99 shortfall is free.
eq('Rs.99 shortfall rounds down to nil', R.roundDown100(99), 0);
eq('Rs.15,099 shortfall rounds down to Rs.15,000', R.roundDown100(15099), 15000);
eq('Rs.15,100 stays put', R.roundDown100(15100), 15100);

// 119A(b): part of a month counts as a whole month.
eq('3.1 months counts as 4', R.wholeMonths(3.1), 4);
eq('4.0 months counts as 4', R.wholeMonths(4), 4);

/* ==========================================================================
 * 2. SECTION 234C — the deferment ladder
 * ======================================================================== */
section('2. Section 234C — interest for deferment');

const ASSESSED = 100000;

// --- 2a. Textbook compliance: 15 / 45 / 75 / 100 exactly. Nothing is due. ---
const perfect = R.sec234C([15000, 30000, 30000, 25000], ASSESSED);
eq('Paying exactly 15/45/75/100 attracts no 234C', perfect.total, 0);

// --- 2b. Nothing paid all year. Worked by hand: -----------------------------
//   15 Jun  required 15,000, paid 0 -> 15,000 x 1% x 3 =   450
//   15 Sep  required 45,000, paid 0 -> 45,000 x 1% x 3 = 1,350
//   15 Dec  required 75,000, paid 0 -> 75,000 x 1% x 3 = 2,250
//   15 Mar  required 1,00,000, paid 0 -> 1,00,000 x 1% x 1 = 1,000
//                                                    total = 5,050
const nothing = R.sec234C([0, 0, 0, 0], ASSESSED);
eq('Paying nothing all year costs Rs.5,050 under 234C', nothing.total, 5050);
eq('  ...of which the 15 June instalment is', nothing.rows[0].interest, 450);
eq('  ...and the 15 March instalment is', nothing.rows[3].interest, 1000);

// --- 2c. THE SAFE HARBOURS. Pay only 12% by June and 36% by September and
//         the interest for those instalments is waived ENTIRELY. This is a
//         cliff, and it is worth real money to a taxpayer who is short in
//         the first half of the year. Almost no tool models it. --------------
const harbour = R.sec234C([12000, 24000, 39000, 25000], ASSESSED);
eq('12% by June + 36% by September attracts no 234C at all', harbour.total, 0);
ok('  ...and the waiver is reported, not silently swallowed',
   harbour.rows[0].waived !== null && harbour.rows[1].waived !== null,
   'June: "' + harbour.rows[0].waived + '"');

// One rupee below the harbour and the FULL shortfall to 15% is charged --
// not the shortfall to 12%. That is what makes it a cliff.
const justUnder = R.sec234C([11900, 24100, 39000, 25000], ASSESSED);
eq('Rs.100 below the June harbour costs the whole 15% shortfall',
   justUnder.rows[0].interest, Math.floor((15000 - 11900) / 100) * 100 * 0.01 * 3);

/* ==========================================================================
 * 3. THE FOURTH PROVISO — capital gains cannot be foreseen in June
 * ======================================================================== */
section('3. Fourth proviso to 234C — the capital gains shield');

// A taxpayer whose Rs.1,00,000 liability includes Rs.40,000 of tax on a gain
// booked in December. They pay advance tax on their FORESEEABLE income only
// (Rs.60,000 of liability), then settle the gain in the March instalment.
// The proviso forgives the shortfall attributable to that gain.
const shielded = R.sec234C(
  [9000, 18000, 18000, 15000],          // 15/45/75/100 percent of 60,000
  ASSESSED,
  { shielded: [6000, 18000, 30000, 40000] } // the CG share of each threshold
);
eq('A December capital gain attracts no 234C when settled later', shielded.total, 0);
ok('  ...and the forgiven amount is recorded for the audit trail',
   shielded.rows[3].forgiven === 40000,
   'March instalment forgave ' + inr(shielded.rows[3].forgiven));

// Without the shield, the very same payment schedule is expensive.
const unshielded = R.sec234C([9000, 18000, 18000, 15000], ASSESSED);
ok('  ...whereas the same schedule without the shield is charged',
   unshielded.total > 1500,
   'costs ' + inr(unshielded.total) + ' if the gain were foreseeable');

/* ==========================================================================
 * 4. SECTION 234B — the 90% cliff
 * ======================================================================== */
section('4. Section 234B — default in payment');

// 90% is a cliff too: at 89% you are charged on the whole shortfall to 100%.
const at90 = R.sec234B(90000, ASSESSED, 4);
ok('Paying exactly 90% escapes 234B entirely', at90.total === 0 && at90.applies === false,
   at90.reason);

// 89,900 paid -> shortfall 10,100 -> x 1% x 4 months = 404
const at89 = R.sec234B(89900, ASSESSED, 4);
eq('Paying 89.9% is charged on the full shortfall to 100%', at89.total, 404);
ok('  ...which is the cliff: Rs.100 less paid costs Rs.404',
   at89.total - at90.total === 404);

// Nothing paid at all: 1,00,000 x 1% x 4 = 4,000
eq('Paying no advance tax at all', R.sec234B(0, ASSESSED, 4).total, 4000);

/* ==========================================================================
 * 5. SECTION 244A — what the department pays you back
 * ======================================================================== */
section('5. Section 244A — interest on refunds');

// The proviso: no interest where the refund is under 10% of tax determined.
const smallRefund = R.sec244A(5000, ASSESSED, 4);
ok('A refund below 10% of the tax determined carries no interest',
   smallRefund.total === 0, smallRefund.reason);

// 15,000 refund -> 15,000 x 0.5% x 4 = 300
eq('A refund above the threshold earns 0.5% per month', R.sec244A(15000, ASSESSED, 4).total, 300);

/* ==========================================================================
 * 6. THE ASYMMETRY — the premise the whole optimiser rests on
 * ======================================================================== */
section('6. The asymmetry that makes this a newsvendor problem');

// Same liability, same magnitude of error, opposite directions.
// Underpay by Rs.30,000 across the year, versus overpay by Rs.30,000.
const ERR = 30000;
const onTarget = [15000, 30000, 30000, 25000];
const under = onTarget.map((p) => p * (1 - ERR / ASSESSED));
const over  = onTarget.map((p) => p * (1 + ERR / ASSESSED));

const costUnder = R.planCost(under, ASSESSED, 0, { opportunityRate: 0.06 });
const costOver  = R.planCost(over,  ASSESSED, 0, { opportunityRate: 0.06 });
const costExact = R.planCost(onTarget, ASSESSED, 0, { opportunityRate: 0.06 });

console.log('  Underpaying by ' + inr(ERR) + ' costs ' + inr(costUnder.net) +
            '  (penalty ' + inr(costUnder.penalty) + ')');
console.log('  Paying exactly right costs ' + inr(costExact.net) +
            '  (penalty ' + inr(costExact.penalty) + ')');
console.log('  Overpaying by ' + inr(ERR) + ' costs ' + inr(costOver.net) +
            '  (penalty ' + inr(costOver.penalty) + ')');

ok('Underpaying is strictly worse than paying correctly',
   costUnder.net > costExact.net,
   'difference ' + inr(costUnder.net - costExact.net));

ok('Overpaying is also worse than paying correctly',
   costOver.net > costExact.net,
   'difference ' + inr(costOver.net - costExact.net));

ok('THE KEY RESULT: an error downwards costs more than the same error upwards',
   (costUnder.net - costExact.net) > (costOver.net - costExact.net),
   'down ' + inr(costUnder.net - costExact.net) +
   '  vs  up ' + inr(costOver.net - costExact.net) +
   '   -> the optimum sits ABOVE the median forecast');

/* ==========================================================================
 * SUMMARY
 * ======================================================================== */
console.log('\n' + '='.repeat(74));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
