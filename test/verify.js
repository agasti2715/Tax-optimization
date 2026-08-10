/* ============================================================================
 * verify.js — REGRESSION TEST HARNESS
 * ----------------------------------------------------------------------------
 * Run with:   node test/verify.js
 *
 * The browser files attach themselves to `window`. Node has no window, so we
 * fake one, eval the same source files the browser loads, and then assert the
 * engine's output against figures computed BY HAND (see TEST_CASES.md).
 *
 * If a Finance Act changes a rate, these tests fail loudly — which is exactly
 * what you want in a tax calculator.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

global.window = global;
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['rulebook.js', 'engine.js', 'advisor.js', 'samples.js']) {
  eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
}

/* ---------- tiny assertion framework ------------------------------------ */

let pass = 0;
let fail = 0;
const inr = (v) => '₹' + Math.round(v).toLocaleString('en-IN');

function eq(label, actual, expected, tolerance = 0) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
    console.log(`        = ${inr(actual)}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${inr(expected)}, got ${inr(actual)}  (off by ${inr(actual - expected)})`);
  }
}

function section(t) {
  console.log('\n' + '='.repeat(74));
  console.log(t);
  console.log('='.repeat(74));
}

const YEAR = 'FY2025-26';

/* ==========================================================================
 * TEST 1 — Priya. Fully hand-computed in TEST_CASES.md.
 * ======================================================================== */

section('TEST 1 — Priya Sharma, salaried, Mumbai, pays rent (FY 2025-26)');

const priya = JSON.parse(JSON.stringify(SAMPLES.priya));
const pOld = TaxEngine.computeRegime(priya, 'old', YEAR);
const pNew = TaxEngine.computeRegime(priya, 'new', YEAR);

console.log('\n-- Old regime --');
eq('HRA exemption (least of 3,00,000 / 1,80,000 / 3,00,000)', pOld.salary.hra.amount, 180000);
eq('Salary income (14,00,000 - 1,80,000 - 50,000 - 2,500)', pOld.salary.income, 1167500);
eq('Income from other sources (12,000 + 40,000)', pOld.otherSources, 52000);
eq('Gross Total Income', pOld.grossTotalNormal, 1219500);
eq('Chapter VI-A (80C 97,000 + 80TTA 10,000)', pOld.deductions.total, 107000);
eq('Total Income', pOld.totalIncome, 1112500);
eq('Tax before cess (12,500 + 1,00,000 + 33,750)', pOld.normalTax, 146250);
eq('Cess @ 4%', pOld.cess, 5850);
eq('TOTAL TAX — old regime', pOld.totalTax, 152100);

console.log('\n-- New regime --');
eq('Salary income (14,00,000 - 75,000 std deduction)', pNew.salary.income, 1325000);
eq('Chapter VI-A (nothing available)', pNew.deductions.total, 0);
eq('Total Income', pNew.totalIncome, 1377000);
eq('Tax before cess (20,000 + 40,000 + 26,550)', pNew.normalTax, 86550);
eq('Cess @ 4%', pNew.cess, 3462);
eq('TOTAL TAX — new regime', pNew.totalTax, 90010, 5); // rounded to nearest ₹10

console.log('\n-- Regime choice --');
const pCmp = TaxEngine.compareRegimes(priya, YEAR);
eq('New regime wins by', pCmp.saving, 62090, 5);
console.log(`  ${pCmp.winner === 'new' ? 'PASS' : 'FAIL'}  Recommended regime is "new"`);
pCmp.winner === 'new' ? pass++ : fail++;

console.log('\n-- Advisory --');
const pAdv = Advisor.generateAdvice(priya, YEAR);
console.log(`        Tax today      : ${inr(pAdv.baseTax)}`);
console.log(`        After the plan : ${inr(pAdv.optimisedTax)}`);
console.log(`        Total saving   : ${inr(pAdv.totalSaving)}`);
console.log(`        ITR form       : ${pAdv.filing.itr.key}`);
console.log(`        Recommendations: ${pAdv.recommendations.length}`);
pAdv.recommendations.forEach((r, i) =>
  console.log(`          ${i + 1}. [${r.section}] ${r.title} -> ${inr(r.saving)}`)
);

// The employer-NPS lever must be the top actionable item in the new regime:
// 14% of 6,00,000 basic = 84,000 deduction at a 15% marginal rate + 4% cess.
const npsRec = pAdv.recommendations.find((r) => r.id === 'nps-employer');
console.log('');
if (npsRec) {
  pass++;
  console.log('  PASS  Agent identified the 80CCD(2) employer-NPS lever');
  eq('  saving from routing 84,000 of CTC into NPS', npsRec.saving, 13100, 20);
} else {
  fail++;
  console.log('  FAIL  Agent missed the 80CCD(2) employer-NPS lever');
}

// Savings must add up exactly — this is the sequential-evaluation guarantee.
const sumOfParts = pAdv.recommendations.reduce((s, r) => s + r.saving, 0);
eq('Sum of individual savings equals the headline total', sumOfParts, pAdv.totalSaving, 1);

/* ==========================================================================
 * TEST 2 — the 87A rebate cliff and marginal relief in the new regime.
 * ======================================================================== */

section('TEST 2 — Section 87A rebate and marginal relief (new regime)');

function salaryOnly(gross) {
  const p = blankProfile();
  p.salary.basic = gross;
  return p;
}

// Salary of 12,75,000 - 75,000 standard deduction = 12,00,000 total income.
// Tax = 20,000 + 40,000 = 60,000, fully wiped out by the 60,000 rebate.
const cliff = TaxEngine.computeRegime(salaryOnly(1275000), 'new', YEAR);
eq('Total income at the rebate ceiling', cliff.totalIncome, 1200000);
eq('Tax before rebate', cliff.normalTax, 60000);
eq('Rebate u/s 87A', cliff.rebate, 60000);
eq('TOTAL TAX on a 12.75 lakh salary (the famous "tax-free" figure)', cliff.totalTax, 0);

// Just over the cliff: total income 12,10,000. Tax would be 61,500, but
// marginal relief caps it at the 10,000 by which income exceeds 12,00,000.
const over = TaxEngine.computeRegime(salaryOnly(1285000), 'new', YEAR);
eq('Total income just above the ceiling', over.totalIncome, 1210000);
eq('Tax before relief (20,000 + 40,000 + 1,500)', over.normalTax, 61500);
eq('Marginal relief granted', over.marginalRelief87A, 51500);
eq('TOTAL TAX after marginal relief + cess', over.totalTax, 10400);

/* ==========================================================================
 * TEST 3 — capital gains, including the basic exemption set-off.
 * ======================================================================== */

section('TEST 3 — Capital gains at special rates');

const cgP = blankProfile();
cgP.capitalGains.ltcgEquity = 325000; // 1,25,000 exempt -> 2,00,000 taxable
cgP.salary.basic = 875000; // 8,75,000 - 75,000 = 8,00,000 total normal income
const cgR = TaxEngine.computeRegime(cgP, 'new', YEAR);
eq('Normal taxable income', cgR.normalTaxable, 800000);
eq('LTCG annual exemption applied', cgR.capitalGains.buckets[0].annualExemption, 125000);
eq('Taxable LTCG', cgR.capitalGains.buckets[0].taxable, 200000);
eq('Tax on LTCG @ 12.5%', cgR.capitalGains.tax, 25000);
eq('Tax at slab rates on 8,00,000', cgR.normalTax, 20000);

// Basic exemption soaking up capital gains: no other income at all.
const soak = blankProfile();
soak.capitalGains.stcgEquity = 600000;
const soakR = TaxEngine.computeRegime(soak, 'new', YEAR);
eq('Unused basic exemption absorbed against STCG', soakR.capitalGains.buckets[0].exemptionUsed, 400000);
eq('Taxable STCG after absorbing the exemption', soakR.capitalGains.buckets[0].taxable, 200000);
eq('Tax on STCG @ 20%', soakR.capitalGains.tax, 40000);

/* ==========================================================================
 * TEST 4 — old regime wins for a home-loan borrower.
 * ======================================================================== */

section('TEST 4 — Rajesh, home loan borrower (old regime should win)');

const rCmp = TaxEngine.compareRegimes(SAMPLES.rajesh, YEAR);
console.log(`        Old regime : ${inr(rCmp.old.totalTax)}`);
console.log(`        New regime : ${inr(rCmp.new.totalTax)}`);
console.log(`        Winner     : ${rCmp.winner} (saves ${inr(rCmp.saving)})`);
eq('Home loan interest allowed, capped at 2,00,000', rCmp.old.house.interestAllowed, 200000);
eq('Home loan interest allowed in the new regime', rCmp.new.house.interestAllowed, 0);
if (rCmp.winner === 'old') { pass++; console.log('  PASS  Old regime correctly recommended for a home-loan borrower'); }
else { fail++; console.log('  FAIL  Expected the old regime to win'); }

/* ==========================================================================
 * TEST 5 — senior citizen, and presumptive taxation.
 * ======================================================================== */

section('TEST 5 — Senior citizen and presumptive taxation');

const sOld = TaxEngine.computeRegime(SAMPLES.suresh, 'old', YEAR);
const ttb = sOld.deductions.items.find((i) => i.section === '80TTB');
if (ttb) { pass++; console.log(`  PASS  80TTB applied for the senior citizen: ${inr(ttb.amount)}`); }
else { fail++; console.log('  FAIL  80TTB was not applied for the senior citizen'); }
eq('80TTB capped at 50,000', ttb ? ttb.amount : 0, 50000);

const aAdv = Advisor.generateAdvice(SAMPLES.ananya, YEAR);
const pres = aAdv.recommendations.find((r) => r.id === 'presumptive');
if (pres) { pass++; console.log(`  PASS  s.44ADA presumptive scheme recommended: saves ${inr(pres.saving)}`); }
else { fail++; console.log('  FAIL  s.44ADA was not recommended for the freelance professional'); }
console.log(`        ITR form selected for a freelancer with capital gains: ${aAdv.filing.itr.key}`);

/* ==========================================================================
 * TEST 6 — surcharge and marginal relief at the 50 lakh threshold.
 * ======================================================================== */

section('TEST 6 — Surcharge on high income');

const rich = blankProfile();
rich.salary.basic = 6000000; // 60 lakh
const richR = TaxEngine.computeRegime(rich, 'new', YEAR);
console.log(`        Total income : ${inr(richR.totalIncome)}`);
console.log(`        Surcharge    : ${inr(richR.surcharge.amount)} @ ${(richR.surcharge.rate * 100).toFixed(0)}%`);
eq('Surcharge rate band applied', richR.surcharge.rate * 100, 10);
if (richR.surcharge.amount > 0) { pass++; console.log('  PASS  Surcharge levied above 50 lakh'); }
else { fail++; console.log('  FAIL  Surcharge not levied'); }

/* ==========================================================================
 * TEST 7 — the agent must optimise BOTH regimes before choosing between them.
 * This is what separates it from a regime calculator.
 * ======================================================================== */

section('TEST 7 — Vikram: optimising reverses the regime verdict');

const vAdv = Advisor.generateAdvice(SAMPLES.vikram, YEAR);
console.log(`        as-is     : old ${inr(vAdv.comparison.old.totalTax)} | new ${inr(vAdv.comparison.new.totalTax)}  -> ${vAdv.asIsWinner}`);
console.log(`        optimised : chosen ${inr(vAdv.optimisedTax)} | other ${inr(vAdv.crossRegime.otherBestTax)}  -> ${vAdv.regime}`);

if (vAdv.asIsWinner === 'new') { pass++; console.log('  PASS  A plain comparison picks the NEW regime'); }
else { fail++; console.log('  FAIL  Expected a plain comparison to pick the new regime'); }

if (vAdv.regime === 'old') { pass++; console.log('  PASS  After optimising both, the OLD regime wins instead'); }
else { fail++; console.log('  FAIL  Expected the old regime to win after optimisation'); }

if (vAdv.flipped) { pass++; console.log('  PASS  The flip is detected and flagged'); }
else { fail++; console.log('  FAIL  flipped flag not set'); }

const switchStep = vAdv.recommendations.find((r) => r.id === 'regime-switch');
if (switchStep) { pass++; console.log('  PASS  The regime switch appears as its own step in the plan'); }
else { fail++; console.log('  FAIL  No regime-switch step in the plan'); }

if (switchStep && switchStep.saving < 0) {
  pass++;
  console.log(`  PASS  The switch alone COSTS money (${inr(switchStep.saving)}) — it only pays as a package`);
} else { fail++; console.log('  FAIL  Expected the standalone switch to be a cost'); }

eq('Tax today (best regime, nothing changed)', vAdv.baseTax, 114350, 5);
eq('Tax after the full plan', vAdv.optimisedTax, 92140, 5);
eq('Net saving', vAdv.totalSaving, 22210, 5);

const vSum = vAdv.recommendations.reduce((s, r) => s + r.saving, 0);
eq('Steps still sum exactly, including the negative one', vSum, vAdv.totalSaving, 1);

/* Every sample must keep its steps summing to the headline. */
section('TEST 8 — the sequential guarantee holds for every sample');
for (const key of Object.keys(SAMPLES)) {
  const adv = Advisor.generateAdvice(SAMPLES[key], YEAR);
  const sum = adv.recommendations.reduce((s, r) => s + r.saving, 0);
  const ok = Math.abs(sum - adv.totalSaving) <= 1;
  if (ok) { pass++; console.log(`  PASS  ${key.padEnd(8)} steps sum to ${inr(adv.totalSaving)}`); }
  else { fail++; console.log(`  FAIL  ${key}: steps sum to ${inr(sum)} but headline says ${inr(adv.totalSaving)}`); }
}

/* ---------- summary ------------------------------------------------------ */

section('SUMMARY');
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
