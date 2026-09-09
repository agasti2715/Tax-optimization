/* ============================================================================
 * verify_agents.js — THE MULTI-AGENT FRAMEWORK, AND A BROWSER-ONLY BUG CLASS
 * ----------------------------------------------------------------------------
 * Run with:   node test/verify_agents.js
 *
 * Section 1 tests something the other suites structurally CANNOT catch, and
 * that is why it is first.
 *
 * The browser loads every module as a separate <script>, so all of them share
 * one global lexical scope. Two files declaring the same top-level name is a
 * hard SyntaxError that stops the page dead. The Node suites never see it,
 * because they eval each file into its own scope — so a module can pass every
 * test and still break the application the moment it is loaded in a browser.
 *
 * That is not hypothetical. It has happened twice:
 *
 *   `clone`     declared in advisor.js and agents.js. Hard SyntaxError; the
 *               entire page failed to start.
 *   `optimise`  declared in advancetax.js and allocate.js. Function
 *               declarations do NOT throw on redeclaration — the later one
 *               silently wins. AdvanceTax.valueOfModel() called bare
 *               `optimise(...)`, which in the browser resolved to allocate's
 *               function with a completely different signature. Silently
 *               wrong, and invisible to every Node test.
 *
 * So this suite parses the source files the way the browser loads them and
 * fails if any top-level name is declared twice.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

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

/* ==========================================================================
 * 1. NO TWO MODULES MAY DECLARE THE SAME TOP-LEVEL NAME
 * ======================================================================== */
section('1. Global scope is shared in the browser — no duplicate declarations');

/** The load order in index.html, which is the order that matters. */
function scriptOrder() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const re = /<script src="src\/([a-z]+)\.js/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

const modules = scriptOrder();
ok('index.html loads the modules this test knows about',
   modules.length >= 10, modules.join(' → '));

const declaredIn = {};
const duplicates = [];
const declRe = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

for (const mod of modules) {
  const file = path.join(SRC, mod + '.js');
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = declRe.exec(src))) {
    // Column 0 only — anything indented is inside a function or block and
    // therefore not in the shared global scope.
    if (m.index !== 0 && src[m.index - 1] !== '\n') continue;
    const name = m[1];
    if (declaredIn[name] && declaredIn[name] !== mod) {
      duplicates.push(name + ' (' + declaredIn[name] + '.js and ' + mod + '.js)');
    } else {
      declaredIn[name] = mod;
    }
  }
}

ok('No top-level name is declared by two modules',
   duplicates.length === 0,
   duplicates.length
     ? duplicates.join('; ')
     : Object.keys(declaredIn).length + ' top-level names across ' +
       modules.length + ' modules, all unique');

/* ---- now load everything the way the browser would --------------------- */
global.window = global;
for (const mod of modules) {
  const file = path.join(SRC, mod + '.js');
  if (fs.existsSync(file) && mod !== 'app') {
    eval(fs.readFileSync(file, 'utf8'));
  }
}

/* ==========================================================================
 * 2. THE DEPENDENCY GRAPH IS A DAG
 * ======================================================================== */
section('2. The orchestrator resolves a directed acyclic graph');

const order = AgentFramework.topologicalOrder(AgentFramework.AGENTS);
ok('All four agents are scheduled', order.length === 4,
   order.map((a) => a.name).join(' → '));

// Report §4.1: "each agent receives fully processed input from its
// predecessor before executing". So every dependency must appear earlier.
let outOfOrder = 0;
const position = {};
order.forEach((a, i) => { position[a.name] = i; });
for (const a of order) {
  for (const dep of a.dependsOn) {
    if (position[dep] >= position[a.name]) outOfOrder++;
  }
}
ok('Every agent runs after everything it depends on', outOfOrder === 0);

ok('DataValidationAgent runs first', order[0].name === 'DataValidationAgent',
   'nothing may compute on unvalidated input');

// A cycle must be refused outright rather than deadlocking.
const cyclic = [
  { name: 'A', role: 'a', dependsOn: ['B'], run: () => ({}) },
  { name: 'B', role: 'b', dependsOn: ['A'], run: () => ({}) },
];
let threw = false;
try { AgentFramework.topologicalOrder(cyclic); } catch (e) { threw = /cycle/i.test(e.message); }
ok('A cyclic graph is rejected rather than deadlocking', threw);

/* ==========================================================================
 * 3. THE PIPELINE RUNS AND PUBLISHES
 * ======================================================================== */
section('3. The pipeline runs end to end and publishes its progress');

const events = [];
const run = AgentFramework.orchestrate(SAMPLES.vikram, 'FY2025-26',
  { budget: 150000, onEvent: (e) => events.push(e) });

ok('The pipeline completes', run.ok === true, run.totalMs + 'ms total');
ok('Every agent produced output',
   Object.keys(run.results).length === 4, Object.keys(run.results).join(', '));

ok('The publish-subscribe bus emitted a start and done event per agent',
   events.filter((e) => e.type === 'agent:start').length === 4 &&
   events.filter((e) => e.type === 'agent:done').length === 4,
   events.length + ' events in total');

ok('Performance is within the 3-second target of report §3.1.2',
   run.totalMs < 3000, run.totalMs + 'ms against a 3000ms requirement');

/* ==========================================================================
 * 4. VALIDATION AGENT
 * ======================================================================== */
section('4. The Data Validation Agent cleans and reports');

const bad = JSON.parse(JSON.stringify(SAMPLES.priya));
bad.salary.basic = -500000;
const badRun = AgentFramework.orchestrate(bad, 'FY2025-26', {});
ok('A negative amount halts the pipeline rather than being computed on',
   badRun.ok === false && badRun.errors.length > 0, badRun.errors.join('; '));

ok('Nothing downstream ran after the halt',
   badRun.results.TaxProjectionAgent === undefined,
   'only ' + Object.keys(badRun.results).join(', ') + ' executed');

// Report §5.2 turns on deduction utilisation, so it must be measured.
const util = run.validation.utilisation;
ok('Deduction utilisation is reported per section',
   util.length === 3 && util.every((u) => typeof u.pct === 'number'),
   util.map((u) => u.section + ' ' + u.pct + '%').join(', '));

ok('Utilisation never exceeds 100%',
   util.every((u) => u.pct >= 0 && u.pct <= 100));

/* ==========================================================================
 * 5. PROJECTION AND OPTIMIZATION AGENTS
 * ======================================================================== */
section('5. Projection and optimization agree with the engine');

const direct = TaxEngine.compareRegimes(SAMPLES.vikram, 'FY2025-26');
ok('The Projection Agent does not invent its own arithmetic',
   run.projection.best.totalTax === direct.best.totalTax,
   'agent ' + inr(run.projection.best.totalTax) + ' = engine ' + inr(direct.best.totalTax));

ok('Optimised tax is never above the baseline',
   run.optimization.optimisedTax <= run.optimization.baseTax,
   inr(run.optimization.baseTax) + ' -> ' + inr(run.optimization.optimisedTax));

ok('The saving is the difference, not a separately computed number',
   run.optimization.totalSaving ===
     run.optimization.baseTax - run.optimization.optimisedTax,
   inr(run.optimization.totalSaving));

// Figure 6 needs this, and percentages that do not sum are the classic way a
// pie chart lies.
const bd = run.optimization.breakdown;
const sumPct = bd.reduce((s, b) => s + b.pct, 0);
ok('The saving breakdown percentages sum to about 100',
   bd.length === 0 || Math.abs(sumPct - 100) <= 2,
   bd.map((b) => b.section + ' ' + b.pct + '%').join(', ') + '  (sum ' + sumPct + ')');

// The donut sits directly under the KPI card, so its centre total and the
// headline saving have to be the same number. They were not: advisor.js
// measures each step from the post-optimisation regime, while the headline is
// measured from what the taxpayer pays today. Where optimising flips the
// regime those baselines differ by the cost of the switch itself, which put
// Rs.78k in the donut beneath a card reading Rs.22,210.
for (const key of ['vikram', 'arjun', 'priya', 'meera']) {
  const r = AgentFramework.orchestrate(SAMPLES[key], 'FY2025-26', { budget: 150000 });
  const slices = r.optimization.breakdown;
  const sliceSum = slices.reduce((s, b) => s + b.saving, 0);
  ok('Donut slices sum to the headline saving for ' + key,
     Math.abs(sliceSum - r.optimization.totalSaving) <= slices.length,
     'headline ' + inr(r.optimization.totalSaving) + ', slices ' + inr(sliceSum));
}

/* ==========================================================================
 * 6. SCENARIO AGENT
 * ======================================================================== */
section('6. Scenarios are real re-runs, not estimates');

const sc = run.scenarios;
ok('Every scenario in report §3.1.1(4) is modelled',
   sc.scenarios.length === AgentFramework.SCENARIOS.length,
   sc.scenarios.map((s) => s.id).join(', '));

// The whole point of cloning the profile is that a scenario cannot corrupt the
// baseline it is measured against.
const rerun = AgentFramework.orchestrate(SAMPLES.vikram, 'FY2025-26', { budget: 150000 });
ok('Running scenarios leaves the baseline untouched',
   rerun.projection.best.totalTax === run.projection.best.totalTax,
   'baseline still ' + inr(rerun.projection.best.totalTax));

ok('Each scenario delta matches its own recomputed tax',
   sc.scenarios.every((s) => Math.abs((s.tax - sc.baseline) - s.delta) < 1));

ok('A saving is never reported for a scenario that raises tax',
   sc.scenarios.every((s) => (s.delta > 0 ? s.saving === 0 : true)),
   'the raise scenario costs ' +
   inr(Math.abs((sc.scenarios.find((s) => s.id === 'raise') || {}).delta || 0)));

/* ==========================================================================
 * 7. THE CHARTS
 * ======================================================================== */
section('7. Charts render, and refuse to render nonsense');

ok('Figure 6 (donut) renders from the optimization breakdown',
   Charts.donut(run.optimization.breakdown).startsWith('<svg'));

ok('Figure 7 (before/after) renders',
   Charts.beforeAfter(1600000, run.optimization.baseTax,
                      run.optimization.optimisedTax).startsWith('<svg'));

ok('An empty breakdown says so rather than drawing an empty circle',
   Charts.donut([]).includes('No saving'));

ok('A single 100% slice draws as a ring, not a collapsed arc',
   Charts.donut([{ section: '80C', saving: 5000, pct: 100 }]).includes('<circle'));

// Chart labels come from data, and data can contain anything.
const hostile = Charts.donut([{ section: '<script>x</script>', saving: 100, pct: 100 }]);
ok('Section labels are escaped before going into SVG',
   hostile.includes('&lt;script&gt;') && !hostile.includes('<script>'));

ok('SVG height is left to CSS, not set as an invalid attribute',
   !Charts.donut(run.optimization.breakdown).includes('height="auto"'),
   'height="auto" is not a valid SVG attribute value and the browser rejects it');

/* ==========================================================================
 * SUMMARY
 * ======================================================================== */
console.log('\n' + '='.repeat(74));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
