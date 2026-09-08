/* ============================================================================
 * verify_llm.js — TESTS FOR THE GUARDS AROUND CLAUDE
 * ----------------------------------------------------------------------------
 * Run with:   node test/verify_llm.js
 *
 * No network and no API key. What is tested here is the part that matters:
 * the validation and the citation firewall, which are what stand between a
 * confident wrong answer from a language model and a taxpayer's return.
 *
 * The model itself is not the risk. The risk is trusting it, so these tests
 * feed the validator deliberately bad tool calls — hallucinated fields,
 * negative amounts, invented enum values — and check that none of them reach
 * the profile.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

global.window = global;
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['rulebook.js', 'samples.js', 'llm.js']) {
  eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
}

let pass = 0, fail = 0;
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

/* ==========================================================================
 * 1. A WELL-FORMED CALL IS ACCEPTED
 * ======================================================================== */
section('1. A good tool call fills the profile');

const good = LLM.validateToolInput({
  name: 'Meera Iyer',
  ageBand: 'below60',
  city: 'metro',
  employmentType: 'professional',
  age: 29,
  variableShare: 0.4,
  business_netProfit: 1600000,
  business_isProfessional: true,
  deductions_sec80E: 200000,
  house_status: 'selfOccupied',
  house_loanInterest: 200000,
  missing: ['whether the parents are over 60'],
  notes: 'Read "about 16 lakh" as annual net profit of Rs.16,00,000.',
});

ok('Nested paths are populated from flat tool fields',
   good.profile.business.netProfit === 1600000 &&
   good.profile.deductions.sec80E === 200000 &&
   good.profile.house.status === 'selfOccupied',
   good.filled.length + ' fields filled');

ok('Forecasting features are separated from the profile',
   good.features.age === 29 && good.features.variableShare === 0.4 &&
   good.features.employmentType === 'professional',
   JSON.stringify(good.features));

ok('Nothing was rejected from a clean call', good.rejected.length === 0);
ok('Open questions are carried through for the UI to show',
   good.missing.length === 1, good.missing[0]);

/* ==========================================================================
 * 2. HALLUCINATED FIELDS CANNOT REACH THE ENGINE
 * ======================================================================== */
section('2. Invented fields are dropped, not merged');

const invented = LLM.validateToolInput({
  salary_basic: 800000,
  deductions_sec80ZZ: 999999,      // no such section
  taxPayable: 123456,              // the model trying to do arithmetic
  regimeRecommendation: 'old',     // the model trying to advise
});

ok('A field outside the schema never lands on the profile',
   invented.profile.deductions.sec80ZZ === undefined &&
   invented.profile.taxPayable === undefined,
   'rejected: ' + invented.rejected.join('; '));

ok('...and the rejection is reported rather than silent',
   invented.rejected.length === 3);

ok('The legitimate field alongside them still gets through',
   invented.profile.salary.basic === 800000,
   'one bad field does not fail the whole intake');

/* ==========================================================================
 * 3. IMPOSSIBLE VALUES ARE REFUSED
 * ======================================================================== */
section('3. Nonsense amounts are refused, not coerced');

const nonsense = LLM.validateToolInput({
  salary_basic: -500000,           // negative income
  deductions_sec80C: 'about 1.5 lakh', // unparsed text
  ageBand: 'middle-aged',          // not in the enum
  city: 'Bengaluru',               // a city, not a category
  house_status: 'rented',          // not in the enum
});

ok('A negative amount is refused',
   nonsense.profile.salary.basic === 0,
   'a negative income is a misread, not a typo to be silently fixed');

ok('Unparseable text in a number field is refused',
   nonsense.profile.deductions.sec80C === 0);

ok('Values outside an enum are refused, leaving the safe default',
   nonsense.profile.ageBand === 'below60' &&
   nonsense.profile.city === 'metro' &&
   nonsense.profile.house.status === 'none',
   nonsense.rejected.length + ' values rejected');

ok('Every refusal is explained',
   nonsense.rejected.length === 5 &&
   nonsense.rejected.every((r) => r.indexOf('(') > 0),
   nonsense.rejected[2]);

/* ==========================================================================
 * 4. THE CITATION FIREWALL
 * ======================================================================== */
section('4. Sections the rulebook does not know are flagged');

const real = LLM.checkCitations(
  'Claimed under section 80C and section 80D, with the regime set by section 115BAC.');
ok('Sections the project implements pass',
   real.ok && real.cited.length === 3,
   'cited: ' + real.cited.join(', '));

const fake = LLM.checkCitations(
  'You can also claim this under section 80ZZZ and u/s 91B of the Act.');
ok('Sections the project does NOT implement are caught',
   !fake.ok && fake.unknown.length === 2,
   'flagged: ' + fake.unknown.join(', ') +
   ' — shown to the user as unverified rather than as fact');

ok('Plain text with no citations passes cleanly',
   LLM.checkCitations('Read the figure as an annual amount.').ok);

/* ==========================================================================
 * 5. THE MODEL IS NEVER ASKED FOR ARITHMETIC
 * ======================================================================== */
section('5. The prompt forbids computation, and the schema gives no route to it');

ok('The system prompt forbids computing tax',
   /[Nn]ever compute tax/.test(LLM.SYSTEM_PROMPT) &&
   /never suggest a regime/i.test(LLM.SYSTEM_PROMPT));

// The guard is against fields that would be OUTPUTS of the engine — a tax
// figure, a saving, a regime recommendation. It must not catch legitimate
// inputs that merely contain one of those words: `other_savingsInterest` is
// savings bank interest received, and `taxPaid_tds` is TDS already deducted.
// Both are things the user tells us, not things the engine works out.
const props = Object.keys(LLM.PROFILE_TOOL.input_schema.properties);
const arithmetic = props.filter((p) =>
  /(^|_)(taxable|taxpayable|totaltax|liability|regime|refund|saving)($|_)/i.test(p));
ok('No field in the schema can carry a computed figure',
   arithmetic.length === 0,
   props.length + ' fields, none of which is an output of the engine' +
   (arithmetic.length ? ' — offending: ' + arithmetic.join(', ') : ''));

ok('The notes field is explicitly barred from stating figures',
   /Do NOT state any tax figure/.test(
     LLM.PROFILE_TOOL.input_schema.properties.notes.description));

/* ==========================================================================
 * SUMMARY
 * ======================================================================== */
console.log('\n' + '='.repeat(74));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
