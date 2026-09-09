/* ============================================================================
 * agents.js — THE MULTI-AGENT FRAMEWORK AND ITS ORCHESTRATOR
 * ----------------------------------------------------------------------------
 * This file implements the architecture described in Chapter 2.3 and Chapter
 * 4.1 of the project report: a network of specialised, cooperating agents,
 * each with domain-specific expertise, operating over a unified financial
 * data schema, coordinated by a central orchestration layer.
 *
 * THE FOUR CORE AGENTS (report §2.3)
 *
 *   DataValidationAgent    handles financial data input, cleansing and
 *                          structuring
 *   TaxProjectionAgent     computes estimated annual tax liability using a
 *                          multi-slab calculation model, under both regimes
 *   TaxOptimizationAgent   identifies applicable deductions and recommends
 *                          tax-saving instruments
 *   ScenarioAnalysisAgent  models multiple "what-if" scenarios and presents
 *                          comparative outcomes
 *
 * EXECUTION MODEL (report §4.1)
 *
 * "Agent interactions follow a directed acyclic graph (DAG) execution model.
 *  The orchestrator initiates agents in topological order, ensuring that each
 *  agent receives fully processed input from its predecessor before executing.
 *  This design eliminates race conditions and ensures deterministic,
 *  reproducible outputs."
 *
 * That is implemented literally below: each agent declares what it depends on,
 * the orchestrator topologically sorts the graph, and refuses to run at all if
 * the declared dependencies contain a cycle.
 *
 * ----------------------------------------------------------------------------
 * A NOTE ON WHAT "AGENT" MEANS HERE, BECAUSE IT MATTERS
 * ----------------------------------------------------------------------------
 * These agents are deterministic software components with declared input and
 * output schemas — the sense used by Wooldridge & Jennings (report ref [7]),
 * where an agent is an autonomous unit with domain expertise and defined
 * behaviour. They are NOT language-model agents, and none of them calls an
 * LLM.
 *
 * That distinction is deliberate and worth defending: tax arithmetic produced
 * by a language model is confidently wrong at unpredictable moments, and a
 * wrong tax figure delivered fluently is worse than no tool at all. The only
 * LLM in this project is the intake assistant in llm.js, which fills a form
 * and is forbidden from computing anything.
 *
 * The agents wrap the existing, separately tested computation modules rather
 * than reimplementing them. engine.js remains the single source of truth for
 * what the Act says; an agent that recomputed tax itself would be a second
 * place for the law to live, and those two places would drift.
 * ========================================================================== */

/* ---------- small helpers ------------------------------------------------ */

const agNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Named agClone rather than clone: every module here shares one global
// lexical scope in the browser, and advisor.js already declares `clone`.
// A duplicate top-level const is a hard SyntaxError that stops the page.
const agClone = (o) => JSON.parse(JSON.stringify(o));

/* ============================================================================
 * AGENT 1 — DATA COLLECTION AND VALIDATION
 * ==========================================================================*/

/**
 * Validates and normalises the raw profile before any computation touches it.
 *
 * Report §3.6.3: "the Data Agent first validates and normalizes input,
 * signaling the Projection Agent upon completion."
 *
 * This agent is the reason the rest of the pipeline can assume its input is
 * sane. It does three things: coerces every amount to a non-negative number,
 * checks the internal consistency the Act cares about, and raises warnings for
 * things that are legal but almost certainly a data-entry mistake.
 */
const DataValidationAgent = {
  name: 'DataValidationAgent',
  role: 'Validates, cleanses and structures the financial data',
  dependsOn: [],

  run(ctx) {
    const p = agClone(ctx.profile);
    const errors = [];
    const warnings = [];
    const normalised = [];

    // --- coerce every monetary field to a sane number -------------------
    const walk = (obj, path) => {
      for (const key of Object.keys(obj || {})) {
        const val = obj[key];
        const here = path ? path + '.' + key : key;
        if (val && typeof val === 'object') { walk(val, here); continue; }
        if (typeof val === 'number') {
          if (!Number.isFinite(val)) { obj[key] = 0; normalised.push(here + ' was not a number'); }
          else if (val < 0) { obj[key] = 0; errors.push(here + ' cannot be negative'); }
        }
      }
    };
    walk(p, '');

    // --- consistency checks --------------------------------------------
    const s = p.salary || {};
    const gross = agNum(s.basic) + agNum(s.da) + agNum(s.hraReceived) + agNum(s.otherAllowances);

    if (agNum(s.hraReceived) > 0 && agNum(p.rent && p.rent.paidAnnual) === 0) {
      warnings.push('You receive HRA but have declared no rent paid. The HRA exemption ' +
                    'under s.10(13A) needs rent to compute against, so it will come out as nil.');
    }
    if (agNum(p.rent && p.rent.paidAnnual) > 0 && agNum(s.hraReceived) === 0 && gross > 0) {
      warnings.push('You pay rent but your salary has no HRA component. Section 80GG may ' +
                    'apply instead, capped at Rs.60,000 a year.');
    }
    if (agNum(s.basic) > 0 && agNum(s.basic) < gross * 0.2 && gross > 0) {
      warnings.push('Basic pay is under 20% of your salary. Most limits in the Act are ' +
                    'computed on basic, so check this against your Form 16 Part B.');
    }
    if (p.house && p.house.status === 'letOut' && agNum(p.house.rentReceived) === 0) {
      warnings.push('The property is marked let out but no rent is recorded.');
    }
    const b = p.business || {};
    if (agNum(b.netProfit) > agNum(b.grossReceipts) && agNum(b.grossReceipts) > 0) {
      errors.push('Net profit cannot exceed gross receipts.');
    }

    // --- deduction utilisation, the metric report §5.2 turns on ---------
    // "the average user in the test cohort was utilizing only 58% of their
    //  available Section 80C limit and 43% of their Section 80D limit"
    const L = RULEBOOK.years[ctx.yearKey].limits;
    const d = p.deductions || {};
    const used80C = Math.min(L.sec80C, agNum(d.sec80C) + agNum(d.epfEmployee) +
                                       agNum(p.house && p.house.principalRepaid));
    const cap80D = (p.ageBand === 'below60' ? L.sec80D_self : L.sec80D_selfSenior) +
                   (d.parentsAreSenior ? L.sec80D_parentsSenior : L.sec80D_parents);
    const used80D = Math.min(cap80D, agNum(d.sec80D_self) + agNum(d.sec80D_parents));

    const utilisation = [
      { section: '80C', label: 'Investments and life insurance',
        used: used80C, limit: L.sec80C },
      { section: '80CCD(1B)', label: 'Additional NPS',
        used: Math.min(L.sec80CCD1B, agNum(d.sec80CCD1B)), limit: L.sec80CCD1B },
      { section: '80D', label: 'Health insurance', used: used80D, limit: cap80D },
    ].map((u) => Object.assign(u, {
      pct: u.limit > 0 ? Math.round((u.used / u.limit) * 100) : 0,
      headroom: Math.max(0, u.limit - u.used),
    }));

    return {
      profile: p,
      valid: errors.length === 0,
      errors,
      warnings,
      normalised,
      utilisation,
      grossSalary: gross,
    };
  },
};

/* ============================================================================
 * AGENT 2 — TAX PROJECTION
 * ==========================================================================*/

/**
 * Computes the liability under both regimes.
 *
 * Report §3.3.2: "a deterministic, rule-based computation pipeline grounded in
 * the provisions of the Indian Income Tax Act ... supports both the Old Tax
 * Regime (with deductions) and the New Tax Regime (without most deductions),
 * enabling direct comparative analysis."
 *
 * Delegates to engine.js, which implements the ten-step scheme of the Act and
 * is pinned by its own regression suite. This agent's job is to present that
 * result in the shape the rest of the pipeline expects, not to redo it.
 */
const TaxProjectionAgent = {
  name: 'TaxProjectionAgent',
  role: 'Computes annual tax liability under both regimes',
  dependsOn: ['DataValidationAgent'],

  run(ctx) {
    const profile = ctx.results.DataValidationAgent.profile;
    const comparison = TaxEngine.compareRegimes(profile, ctx.yearKey);

    const advance = TaxEngine.advanceTaxPlan(
      comparison.best.totalTax,
      agNum(profile.taxPaid && profile.taxPaid.tds),
      profile
    );

    return {
      old: comparison.old,
      new: comparison.new,
      winner: comparison.winner,
      best: comparison.best,
      spread: Math.abs(comparison.old.totalTax - comparison.new.totalTax),
      effectiveRate: comparison.best.effectiveRate,
      advanceTax: advance,
      /** The step-by-step working, which the UI renders as the agent's trace. */
      trace: comparison.best.trace,
    };
  },
};

/* ============================================================================
 * AGENT 3 — TAX OPTIMIZATION
 * ==========================================================================*/

/**
 * Finds what the taxpayer could legally claim, and what it is worth.
 *
 * Report §3.3.3 describes this as a constraint-satisfaction problem solver
 * "identifying the combination of legally available deductions and tax-saving
 * investments that minimizes the user's net tax liability subject to
 * regulatory limits and user-defined constraints (e.g. liquidity
 * requirements)".
 *
 * Two engines run here, and they answer different questions:
 *
 *   advisor.js    what could you claim if money were no object? Ranked
 *                 recommendations with the working shown.
 *   allocate.js   given a real budget, where should the next rupee go? Solved
 *                 exactly, with the liquidity cost of each instrument priced
 *                 in — which is the "user-defined constraints" half of §3.3.3.
 *
 * Report §4.2.2 specifies a GREEDY allocation strategy. The implementation
 * goes further: allocate.js solves the same problem exactly and reports how
 * much the greedy strategy would have left on the table. The greedy path is
 * kept as the benchmark rather than as the answer.
 */
const TaxOptimizationAgent = {
  name: 'TaxOptimizationAgent',
  role: 'Identifies deductions and recommends tax-saving instruments',
  dependsOn: ['DataValidationAgent', 'TaxProjectionAgent'],

  run(ctx) {
    const profile = ctx.results.DataValidationAgent.profile;
    const budget = ctx.budget === undefined ? Infinity : ctx.budget;

    const advice = Advisor.generateAdvice(profile, ctx.yearKey);
    const allocation = Allocate.optimise(profile, ctx.yearKey, { budget });
    const gap = Allocate.optimalityGap(profile, ctx.yearKey,
      budget === Infinity ? 1e12 : budget);

    /* --- saving attributed to each section, for the pie chart ---------- */
    // Report Figure 6 is a "Tax Saving Pie Chart", and §5.1.2 breaks savings
    // down by deduction category. Rather than hard-code the report's average
    // percentages, this measures the split for THIS taxpayer.
    const bySection = {};
    for (const r of advice.recommendations) {
      if (!r.saving || r.saving <= 0) continue;
      const key = r.section || r.category || 'Other';
      bySection[key] = (bySection[key] || 0) + r.saving;
    }
    const gross = Object.values(bySection).reduce((s, v) => s + v, 0);

    /*
     * THE SLICES ARE SCALED TO THE HEADLINE SAVING, AND THIS IS NOT COSMETIC.
     *
     * advisor.js measures each recommendation sequentially inside whichever
     * regime wins AFTER optimisation, so those savings are measured from that
     * regime's starting tax. The headline saving is measured from what the
     * taxpayer would pay today, in whichever regime is better for them NOW.
     * Those two baselines are different whenever optimising flips the regime.
     *
     * For SAMPLES.vikram the gap is stark: the individual steps sum to
     * Rs.78,370 because they start from the old regime's Rs.1,70,510, while
     * the headline saving is Rs.22,210 measured from Rs.1,14,350. The
     * difference is the regime switch itself, which COSTS him Rs.56,160 before
     * the deductions earn it back.
     *
     * A pie chart cannot draw a negative slice, so showing the raw figures put
     * Rs.78k in the middle of the donut directly beneath a card reading
     * Rs.22,210. The percentages are the honest part — they are the relative
     * contribution of each section — so those are kept and the rupee figures
     * are scaled to the saving the taxpayer actually gets.
     */
    const headline = Math.max(0, advice.totalSaving);
    const scale = gross > 0 ? headline / gross : 0;

    const breakdown = Object.keys(bySection)
      .map((k) => ({
        section: k,
        /** Share of the headline saving attributable to this section. */
        saving: Math.round(bySection[k] * scale),
        /** Relative contribution — unaffected by the scaling. */
        pct: gross > 0 ? Math.round((bySection[k] / gross) * 100) : 0,
        /** The raw sequential figure, kept so the trace can still show it. */
        rawSaving: Math.round(bySection[k]),
      }))
      .sort((a, b) => b.saving - a.saving);

    return {
      regime: advice.regime,
      baseTax: advice.baseTax,
      recommendations: advice.recommendations,
      // Taken straight from generateAdvice rather than recomputed. An earlier
      // version read `advice.result`, a field that does not exist, so the
      // optimised figure silently fell back to the baseline and every saving
      // reported as zero.
      optimisedTax: advice.optimisedTax,
      totalSaving: advice.totalSaving,
      regimeSwitchSaving: advice.regimeSwitchSaving,
      optimisationSaving: advice.optimisationSaving,
      flipped: advice.flipped,
      optimisedProfile: advice.optimisedProfile,
      outlay: advice.outlay || 0,
      breakdown,
      allocation,
      greedyGap: gap.gap,
      // generateAdvice already resolves the ITR form and supporting forms, so
      // they are taken from its result rather than recomputed here.
      filing: advice.filing,
      checklist: Advisor.documentChecklist(profile, advice.regime),
    };
  },
};

/* ============================================================================
 * AGENT 4 — SCENARIO ANALYSIS
 * ==========================================================================*/

/**
 * Models "what-if" decisions and compares them against the baseline.
 *
 * Report §3.1.1 requirement 4: "The system shall support 'what-if' scenario
 * analysis, allowing users to model the tax impact of hypothetical financial
 * decisions (e.g., taking a home loan, increasing NPS contribution, switching
 * tax regimes) before making actual commitments."
 *
 * Each scenario is a named mutation of the profile. The agent applies it to a
 * COPY, re-runs the real engine, and reports the delta — so a scenario can
 * never corrupt the baseline it is being compared against, and no scenario
 * result is ever estimated.
 */
const SCENARIOS = [
  {
    id: 'homeLoan',
    label: 'Take a home loan',
    detail: 'Rs.2 lakh of interest under s.24(b) and Rs.1.5 lakh of principal inside 80C',
    apply: (p) => {
      p.house = p.house || {};
      p.house.status = 'selfOccupied';
      p.house.loanInterest = Math.max(agNum(p.house.loanInterest), 200000);
      p.house.principalRepaid = Math.max(agNum(p.house.principalRepaid), 150000);
    },
  },
  {
    id: 'maxNps',
    label: 'Contribute the full Rs.50,000 to NPS',
    detail: 'Section 80CCD(1B), a limit that sits on top of 80C',
    apply: (p, L) => { p.deductions.sec80CCD1B = L.sec80CCD1B; },
  },
  {
    id: 'max80C',
    label: 'Fill the 80C limit',
    detail: 'ELSS, PPF or life insurance up to Rs.1.5 lakh',
    apply: (p, L) => {
      const used = agNum(p.deductions.epfEmployee) + agNum(p.house && p.house.principalRepaid);
      p.deductions.sec80C = Math.max(0, L.sec80C - used);
    },
  },
  {
    id: 'healthCover',
    label: 'Insure yourself and your parents',
    detail: 'Section 80D — two separate limits, and most people use only one',
    apply: (p, L) => {
      p.deductions.sec80D_self = p.ageBand === 'below60' ? L.sec80D_self : L.sec80D_selfSenior;
      p.deductions.sec80D_parents = p.deductions.parentsAreSenior
        ? L.sec80D_parentsSenior : L.sec80D_parents;
    },
  },
  {
    id: 'employerNps',
    label: 'Route 10% of basic through employer NPS',
    detail: 'Section 80CCD(2) — the one big deduction the new regime keeps',
    apply: (p) => {
      const s = p.salary || (p.salary = {});
      const move = (agNum(s.basic) + agNum(s.da)) * 0.10;
      s.employerNps = agNum(s.employerNps) + move;
      s.otherAllowances = Math.max(0, agNum(s.otherAllowances) - move);
    },
  },
  {
    id: 'raise',
    label: 'Get a 20% raise',
    detail: 'What the next bracket actually costs you',
    apply: (p) => {
      const s = p.salary || (p.salary = {});
      if (agNum(s.otherAllowances) + agNum(s.basic) > 0) {
        s.otherAllowances = agNum(s.otherAllowances) +
          0.20 * (agNum(s.basic) + agNum(s.da) + agNum(s.hraReceived) + agNum(s.otherAllowances));
      } else if (p.business) {
        p.business.netProfit = agNum(p.business.netProfit) * 1.20;
      }
    },
  },
];

const ScenarioAnalysisAgent = {
  name: 'ScenarioAnalysisAgent',
  role: 'Models what-if decisions and compares outcomes',
  dependsOn: ['DataValidationAgent', 'TaxProjectionAgent'],

  run(ctx) {
    const profile = ctx.results.DataValidationAgent.profile;
    const baseline = ctx.results.TaxProjectionAgent.best.totalTax;
    const L = RULEBOOK.years[ctx.yearKey].limits;

    const scenarios = SCENARIOS.map((sc) => {
      const p = agClone(profile);
      sc.apply(p, L);
      const r = TaxEngine.compareRegimes(p, ctx.yearKey);
      return {
        id: sc.id,
        label: sc.label,
        detail: sc.detail,
        tax: r.best.totalTax,
        regime: r.winner,
        delta: r.best.totalTax - baseline,
        /** Negative delta is a saving. Reported separately so the UI cannot
         *  accidentally show a tax increase as a good thing. */
        saving: Math.max(0, baseline - r.best.totalTax),
      };
    }).sort((a, b) => a.delta - b.delta);

    /* --- the regime switch, modelled explicitly ------------------------ */
    const proj = ctx.results.TaxProjectionAgent;
    const regimeSwitch = {
      current: proj.winner,
      alternative: proj.winner === 'new' ? 'old' : 'new',
      currentTax: proj.best.totalTax,
      alternativeTax: proj.winner === 'new' ? proj.old.totalTax : proj.new.totalTax,
    };
    regimeSwitch.delta = regimeSwitch.alternativeTax - regimeSwitch.currentTax;

    return { baseline, scenarios, regimeSwitch };
  },
};

/* ============================================================================
 * THE ORCHESTRATION LAYER
 * ==========================================================================*/

/**
 * Report §3.4.2: "A custom orchestration module manages agent initialization,
 * sequential and parallel execution, data sharing between agents, and
 * aggregation of results for frontend delivery. The orchestrator implements a
 * publish-subscribe pattern for inter-agent communication."
 *
 * Both halves of that are here: a topological scheduler over the declared
 * dependency graph, and an event bus that anything can subscribe to. The UI
 * subscribes to it to render the live agent log, which means the trace the
 * user sees is emitted by the pipeline itself rather than narrated afterwards.
 */
const AGENTS = [
  DataValidationAgent,
  TaxProjectionAgent,
  TaxOptimizationAgent,
  ScenarioAnalysisAgent,
];

/**
 * Kahn's algorithm over the dependency graph.
 *
 * Returns the order agents must run in. Throws if the graph has a cycle,
 * rather than deadlocking or silently running agents on missing input — the
 * report promises a DAG, and this is what enforces it.
 */
function topologicalOrder(agents) {
  const byName = {};
  const indegree = {};
  const dependents = {};

  for (const a of agents) {
    byName[a.name] = a;
    indegree[a.name] = 0;
    dependents[a.name] = [];
  }
  for (const a of agents) {
    for (const dep of a.dependsOn) {
      if (!byName[dep]) throw new Error(a.name + ' depends on unknown agent ' + dep);
      indegree[a.name]++;
      dependents[dep].push(a.name);
    }
  }

  const ready = Object.keys(indegree).filter((n) => indegree[n] === 0).sort();
  const order = [];
  while (ready.length) {
    const n = ready.shift();
    order.push(byName[n]);
    for (const d of dependents[n]) {
      if (--indegree[d] === 0) ready.push(d);
    }
    ready.sort();
  }

  if (order.length !== agents.length) {
    throw new Error('The agent dependency graph contains a cycle, so it is not a DAG.');
  }
  return order;
}

/** A minimal publish-subscribe bus, as specified in report §3.4.2. */
function createBus() {
  const listeners = [];
  return {
    subscribe(fn) { listeners.push(fn); return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    }; },
    publish(event) { for (const fn of listeners.slice()) { try { fn(event); } catch (e) { /* a
      broken subscriber must not take the pipeline down with it */ } } },
  };
}

/**
 * Run the whole pipeline.
 *
 * @param profile  the taxpayer
 * @param yearKey  'FY2025-26'
 * @param opts.budget    what they can still commit, for the allocation agent
 * @param opts.onEvent   subscriber for the live agent log
 */
function orchestrate(profile, yearKey, opts) {
  const o = opts || {};
  const bus = createBus();
  if (o.onEvent) bus.subscribe(o.onEvent);

  const order = topologicalOrder(AGENTS);
  const ctx = {
    profile,
    yearKey,
    budget: o.budget,
    results: {},
  };

  const timeline = [];
  const started = Date.now();

  bus.publish({ type: 'pipeline:start', agents: order.map((a) => a.name) });

  for (const agent of order) {
    const t0 = Date.now();
    bus.publish({ type: 'agent:start', agent: agent.name, role: agent.role });

    let output;
    try {
      output = agent.run(ctx);
    } catch (err) {
      bus.publish({ type: 'agent:error', agent: agent.name, error: err.message });
      throw new Error(agent.name + ' failed: ' + err.message);
    }

    ctx.results[agent.name] = output;
    const ms = Date.now() - t0;
    timeline.push({ agent: agent.name, role: agent.role, ms });
    bus.publish({ type: 'agent:done', agent: agent.name, ms, output });

    // The Data agent is the only one that can halt the pipeline: everything
    // downstream would be computing on numbers it has already rejected.
    if (agent.name === 'DataValidationAgent' && !output.valid) {
      bus.publish({ type: 'pipeline:halted', reason: output.errors.join('; ') });
      return { ok: false, errors: output.errors, results: ctx.results, timeline };
    }
  }

  const totalMs = Date.now() - started;
  bus.publish({ type: 'pipeline:done', ms: totalMs });

  return {
    ok: true,
    yearKey,
    results: ctx.results,
    timeline,
    totalMs,
    /** Flattened for convenience — the UI reads mostly from here. */
    validation: ctx.results.DataValidationAgent,
    projection: ctx.results.TaxProjectionAgent,
    optimization: ctx.results.TaxOptimizationAgent,
    scenarios: ctx.results.ScenarioAnalysisAgent,
  };
}

/* ---------------------------------------------------------------------------
 * Plain global, plus a CommonJS tail for the Node tests.
 * ------------------------------------------------------------------------ */
const AgentFramework = {
  orchestrate,
  topologicalOrder,
  createBus,
  AGENTS,
  SCENARIOS,
  DataValidationAgent,
  TaxProjectionAgent,
  TaxOptimizationAgent,
  ScenarioAnalysisAgent,
};

if (typeof window !== 'undefined') window.AgentFramework = AgentFramework;
if (typeof module !== 'undefined' && module.exports) module.exports = AgentFramework;
