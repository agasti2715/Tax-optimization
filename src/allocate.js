/* ============================================================================
 * allocate.js — WHERE SHOULD A LIMITED AMOUNT OF MONEY GO?
 * ----------------------------------------------------------------------------
 * advisor.js answers "what could you claim" by walking a list of rules and
 * filling every ceiling it finds. That is the right answer for a taxpayer with
 * unlimited cash, and nobody has unlimited cash.
 *
 * The real question in February is narrower and harder: I have Rs.2 lakh I can
 * still commit before 31 March. Where does it go?
 *
 * ----------------------------------------------------------------------------
 * TWO THINGS A NAIVE OPTIMISER GETS WRONG
 * ----------------------------------------------------------------------------
 * 1. MINIMISING TAX IS THE WRONG OBJECTIVE. Ask a solver to minimise tax and
 *    it will tell you to donate everything to charity: Rs.1 given away under
 *    80G removes Rs.1 from taxable income and saves you 30 paise. You are 70
 *    paise worse off, and the solver reports a triumph.
 *
 *    So the objective is tax PLUS the real cost of the action. Money put into
 *    PPF or ELSS is still yours — it costs only its illiquidity. A health
 *    insurance premium buys cover you have some use for. A donation is gone.
 *    Those are completely different things and a deduction-shaped hole in the
 *    Act does not make them equivalent.
 *
 * 2. THE BUDGET CHANGES THE ORDER. Without a budget, "fill 80C, then NPS, then
 *    80D" is fine because you eventually reach all of them. With Rs.50,000 to
 *    spend, which one you reach FIRST is the whole decision, and a rule list
 *    walked in a fixed order cannot see that.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS IS SOLVED EXACTLY, AND WITHOUT A SOLVER
 * ----------------------------------------------------------------------------
 * This looks like a mixed integer program — piecewise linear tax, cliffs at
 * the 87A rebate and the surcharge bands, capacity constraints, a budget. It
 * would be entirely reasonable to compile a MILP solver to WebAssembly and
 * hand the problem over.
 *
 * That is unnecessary here, because the problem decomposes:
 *
 *   (a) Every instrument below reduces total income rupee for rupee. So for a
 *       FIXED total deduction D, the tax is already determined — it does not
 *       matter which instruments produced D.
 *
 *   (b) Therefore the cheapest way to reach D is a continuous knapsack: take
 *       the lowest cost-ratio instrument first, fill it to its cap, move on.
 *       Greedy is provably optimal for the continuous knapsack, so cost(D) is
 *       exact, and it is convex and piecewise linear in D.
 *
 *   (c) The objective tax(GTI - D) + cost(D) is therefore piecewise linear in
 *       a single variable. Its minimum must lie at a breakpoint of one of the
 *       two pieces, and every breakpoint is enumerable: instrument capacities,
 *       budget exhaustion, slab boundaries, the 87A threshold, surcharge bands.
 *
 * Evaluate the objective at every breakpoint and the global optimum falls out.
 * No solver, no dependency — and, unlike a MILP solver, the answer arrives
 * with the reason attached, which for a tax tool matters more than the answer.
 *
 * THE PRECISE CLAIM, since "optimal" is easy to overstate: the result is
 * optimal to within Rs.10. Not because the search is approximate, but because
 * the objective itself is a step function with Rs.10 treads — s.288A rounds
 * total income to the nearest Rs.10 and the engine rounds tax the same way. A
 * random search will occasionally land a few rupees under the solver by
 * catching a rounding step at a fractional allocation. Two plans separated by
 * less than Rs.10 are the same plan as far as the Act is concerned, and
 * test/verify_allocate.js checks against that bound rather than pretending to
 * a precision the statute does not have.
 *
 * Assumption (a) is the load-bearing one, and it is the assumption that broke
 * first: it holds only if the deduction the solver thinks it is buying is the
 * deduction the engine actually grants. Hand-deriving each ceiling in this
 * file got that wrong for anyone with a home loan. Headroom is now measured
 * by probing the engine — see availableInstruments below.
 * ========================================================================== */

/* ---------- helpers ------------------------------------------------------ */

const gNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/* ============================================================================
 * THE INSTRUMENTS, AND WHAT THEY ACTUALLY COST
 * ==========================================================================*/

/**
 * `costRatio` is the fraction of each rupee committed that the taxpayer does
 * not get back. It is the single most important number in this file, and the
 * one most open to argument, so each is justified rather than asserted.
 *
 *   0.00  the money is already being spent, or the deduction is a
 *         restructuring rather than an outlay. Claiming it is free.
 *   0.03  invested and still yours (ELSS, PPF, EPF). The cost is the lock-in:
 *         three years for ELSS, longer for PPF. Priced as a small liquidity
 *         penalty, not as a loss.
 *   0.10  NPS under 80CCD(1B). Also still yours, but locked until 60 and then
 *         partly forced into an annuity, so the illiquidity is far more
 *         severe than a three-year ELSS lock.
 *   0.35  health insurance. A premium is spent, but it buys cover with real
 *         value. A taxpayer who would have insured anyway faces a cost of
 *         zero; one who would not is buying something they did not want. 0.35
 *         is a deliberate middle.
 *   1.00  donations. The money is gone. This is what stops the optimiser
 *         recommending charity as a tax strategy.
 *
 * These are assumptions. They are written here, in one table, so that a
 * taxpayer who disagrees can change them and re-run rather than having to
 * argue with a black box.
 */
function availableInstruments(profile, regime, yearKey) {
  const L = RULEBOOK.years[yearKey].limits;
  const d = profile.deductions || {};
  const out = [];

  const baseline = TaxEngine.computeRegime(profile, regime, yearKey).deductions.total;

  /*
   * HEADROOM IS MEASURED, NOT DERIVED — and this was a bug before it was a
   * design.
   *
   * The first version worked out each ceiling by hand: 80C headroom is
   * Rs.1.5 lakh less what you have declared under 80C plus EPF. That is
   * wrong, and quietly so. s.80C also absorbs home loan PRINCIPAL repayment,
   * tuition fees and several other things, all of which engine.js already
   * accounts for. For a taxpayer with a home loan the ceiling was full and
   * this file thought it had Rs.54,000 of room, so the solver "bought"
   * Rs.54,000 of deduction that did not exist, paid a real cost for it, and
   * received nothing. It then reported that plan as optimal.
   *
   * Re-deriving the Act in a second place is what caused it, so the fix is to
   * stop: ask the engine. Push a probe through each instrument, see how much
   * the deduction ACTUALLY moves, and take that as the headroom. The engine
   * is the single source of truth for what the Act grants, which is what it
   * was written to be.
   *
   * This costs one extra engine call per instrument and cannot drift out of
   * step with the rulebook, because it has no opinion of its own to drift.
   */
  const measure = (spec, probe) => {
    const p = JSON.parse(JSON.stringify(profile));
    if (!p.deductions) p.deductions = {};
    if (!p.salary) p.salary = {};
    spec.apply(p, probe);
    const after = TaxEngine.computeRegime(p, regime, yearKey).deductions.total;
    return Math.max(0, after - baseline);
  };

  /**
   * `probe` is the largest amount worth offering — the statutory ceiling. The
   * headroom that comes back is what the engine will actually allow, which
   * may be less, and may be nothing at all.
   */
  const add = (spec, probe) => {
    spec.headroom = measure(spec, probe);
    if (spec.headroom > 0.5) out.push(spec);
  };

  /* ---- available in BOTH regimes ------------------------------------- */

  // 80CCD(2) — employer's NPS contribution. The one substantial deduction the
  // new regime keeps, and it is a salary restructuring rather than new
  // spending: the money was already coming to you, it simply arrives via NPS
  // instead of as cash. Hence a cost of illiquidity only.
  const basic = gNum(profile.salary && profile.salary.basic) + gNum(profile.salary && profile.salary.da);
  if (basic > 0) {
    const cap = basic * L.sec80CCD2_private;
    const capHeadroom = Math.max(0, cap - gNum(profile.salary.employerNps));

    // This is a RESTRUCTURING, not a contribution, and the distinction is the
    // whole point. The engine adds employer NPS to gross salary and then
    // deducts it under 80CCD(2) (engine.js), so simply increasing the NPS
    // figure adds taxable income and deducts the same amount — a net saving of
    // exactly nothing. What actually saves tax is moving rupees OUT of cash
    // allowances INTO NPS: the CTC is unchanged, but the part arriving as NPS
    // is no longer taxed.
    //
    // The headroom is therefore bounded twice: by the 14% statutory ceiling,
    // and by how much cash allowance there is left to move.
    const movable = gNum(profile.salary.otherAllowances);
    add({
      id: 'employerNps',
      section: '80CCD(2)',
      label: "Route part of your CTC through your employer's NPS instead of as cash",
      costRatio: 0.10,
      apply: (p, amount) => {
        p.salary.employerNps = gNum(p.salary.employerNps) + amount;
        p.salary.otherAllowances = Math.max(0, gNum(p.salary.otherAllowances) - amount);
      },
      note: 'Works in the new regime too — almost nothing else does. ' +
            'Your CTC does not change; only the form it arrives in.',
      restructuring: true,
    }, Math.min(capHeadroom, movable));
  }

  // The old regime alone opens everything below.
  if (regime !== 'old') return out;

  /* ---- 80C ------------------------------------------------------------ */
  const used80C = gNum(d.sec80C) + gNum(d.epfEmployee);
  add({
    id: 'sec80C',
    section: '80C',
    label: 'ELSS, PPF or a life insurance premium',
    costRatio: 0.03,
    apply: (p, amount) => { p.deductions.sec80C = gNum(p.deductions.sec80C) + amount; },
    note: 'The money stays yours — only the lock-in costs you anything.',
  }, L.sec80C);

  /* ---- 80CCD(1B) ------------------------------------------------------ */
  add({
    id: 'sec80CCD1B',
    section: '80CCD(1B)',
    label: 'Additional NPS contribution',
    costRatio: 0.10,
    apply: (p, amount) => { p.deductions.sec80CCD1B = gNum(p.deductions.sec80CCD1B) + amount; },
    note: 'A separate limit on top of 80C, but locked until you are 60.',
  }, L.sec80CCD1B);

  /* ---- 80D ------------------------------------------------------------ */
  const selfCap = profile.ageBand === 'below60' ? L.sec80D_self : L.sec80D_selfSenior;
  add({
    id: 'sec80D_self',
    section: '80D',
    label: 'Health cover for yourself and your family',
    costRatio: 0.35,
    apply: (p, amount) => { p.deductions.sec80D_self = gNum(p.deductions.sec80D_self) + amount; },
    note: 'A premium is spent, but it buys cover worth having.',
  }, selfCap);

  const parentCap = d.parentsAreSenior ? L.sec80D_parentsSenior : L.sec80D_parents;
  add({
    id: 'sec80D_parents',
    section: '80D',
    label: 'Health cover for your parents',
    costRatio: 0.35,
    apply: (p, amount) => { p.deductions.sec80D_parents = gNum(p.deductions.sec80D_parents) + amount; },
    note: 'A completely separate limit from your own cover.',
  }, parentCap);

  /* ---- 80G ------------------------------------------------------------ */
  // Included deliberately, and priced at 1.00, so that the optimiser has the
  // OPPORTUNITY to recommend donating and declines it on the arithmetic. A
  // model that cannot choose charity has not refused it.
  add({
    id: 'sec80G_100',
    section: '80G',
    label: 'Donation to a fund deductible in full',
    costRatio: 1.00,
    apply: (p, amount) => { p.deductions.sec80G_100 = gNum(p.deductions.sec80G_100) + amount; },
    note: 'Give a rupee to save at most 30 paise. Never a way to make money.',
  }, 100000);

  return out;
}

/* ============================================================================
 * STEP 1 — THE COST CURVE
 * ==========================================================================*/

/**
 * The cheapest way to buy `target` rupees of deduction.
 *
 * This is a continuous knapsack — every instrument is infinitely divisible,
 * so the greedy rule (cheapest cost-ratio first, fill to capacity, move on) is
 * exactly optimal rather than merely a good heuristic. No integrality gap, no
 * approximation, nothing to prove beyond the standard exchange argument.
 *
 * Returns null when the target cannot be reached — either the ceilings do not
 * allow it, or the budget runs out first.
 */
function cheapestWayTo(target, instruments, budget) {
  const order = instruments.slice().sort((a, b) => a.costRatio - b.costRatio);
  const picks = [];
  let remaining = target;
  let outlay = 0; // cash the taxpayer actually has to find
  let cost = 0;   // what that cash genuinely costs them

  for (const inst of order) {
    if (remaining <= 0.5) break;

    // A restructuring does not consume the budget. Redirecting salary into
    // employer NPS moves money the taxpayer was already receiving, so it is
    // available even to someone with nothing left to invest — which is
    // exactly the taxpayer who needs to hear about it most.
    const room = inst.restructuring ? Infinity : Math.max(0, budget - outlay);

    const take = Math.min(inst.headroom, remaining, room);
    if (take <= 0.5) continue;

    picks.push({ instrument: inst, amount: take, cost: take * inst.costRatio });
    remaining -= take;
    if (!inst.restructuring) outlay += take;
    cost += take * inst.costRatio;
  }

  if (remaining > 0.5) return null; // unreachable within caps and budget
  return { picks, outlay, cost };
}

/* ============================================================================
 * STEP 2 — WHERE THE OPTIMUM CAN POSSIBLY LIE
 * ==========================================================================*/

/**
 * Every breakpoint of the one-dimensional objective.
 *
 * The objective is piecewise linear in the total deduction D, so its minimum
 * sits at a kink. Kinks come from two places:
 *
 *   the COST curve   each time an instrument fills up and the next, more
 *                    expensive one starts being used
 *   the TAX curve    slab boundaries, the 87A rebate threshold, and each
 *                    surcharge band — expressed as the D that lands total
 *                    income exactly on them
 *
 * Enumerating both sets and testing every one is what makes this exact rather
 * than a search. A fine grid is added as well: it costs almost nothing, and it
 * is cheap insurance against a kink this function has not thought of.
 */
function candidateTargets(instruments, budget, grossTotal, regime, yearKey) {
  const Y = RULEBOOK.years[yearKey];
  const cfg = regime === 'new' ? Y.newRegime : Y.oldRegime;
  const slabs = regime === 'new' ? cfg.slabs : cfg.slabsByAge['below60'];

  const set = new Set([0]);

  // Cost-curve kinks: cumulative capacity, cheapest first. Restructuring
  // capacity is always reachable; everything else is bounded by the budget.
  const order = instruments.slice().sort((a, b) => a.costRatio - b.costRatio);
  const freeCapacity = order
    .filter((i) => i.restructuring)
    .reduce((s, i) => s + i.headroom, 0);
  const paidCapacity = order
    .filter((i) => !i.restructuring)
    .reduce((s, i) => s + i.headroom, 0);

  let cumulative = 0;
  let spent = 0;
  for (const inst of order) {
    cumulative += inst.headroom;
    if (!inst.restructuring) spent += inst.headroom;
    if (spent <= budget) set.add(cumulative);
  }

  const reachable = freeCapacity + Math.min(budget, paidCapacity);
  set.add(reachable);

  // Tax-curve kinks: the deduction that brings income onto each boundary.
  const boundaries = slabs.map((s) => s.upto).filter((v) => Number.isFinite(v));
  boundaries.push(cfg.rebate87A.incomeLimit);
  for (const band of cfg.surcharge) boundaries.push(band.above);

  for (const b of boundaries) {
    const d = grossTotal - b;
    if (d > 0 && d <= reachable) set.add(d);
  }

  // Insurance: a coarse sweep on top of the exact breakpoints.
  const step = Math.max(1000, reachable / 60);
  for (let d = 0; d <= reachable; d += step) set.add(Math.round(d));

  return Array.from(set).filter((d) => d >= 0 && d <= reachable).sort((a, b) => a - b);
}

/* ============================================================================
 * STEP 3 — THE OPTIMISER
 * ==========================================================================*/

/**
 * Apply an allocation to a copy of the profile.
 */
function applyAllocation(profile, allocation) {
  const p = JSON.parse(JSON.stringify(profile));
  if (!p.deductions) p.deductions = {};
  if (!p.salary) p.salary = {};
  for (const pick of allocation.picks) pick.instrument.apply(p, pick.amount);
  return p;
}

/**
 * Solve for one regime.
 */
function solveRegime(profile, yearKey, regime, budget) {
  const instruments = availableInstruments(profile, regime, yearKey);
  const base = TaxEngine.computeRegime(profile, regime, yearKey);
  const grossTotal = base.grossTotalNormal;

  const targets = candidateTargets(instruments, budget, grossTotal, regime, yearKey);

  let best = null;
  const curve = [];

  for (const target of targets) {
    const allocation = cheapestWayTo(target, instruments, budget);
    if (!allocation) continue;

    const p = applyAllocation(profile, allocation);
    const tax = TaxEngine.computeRegime(p, regime, yearKey).totalTax;

    // THE OBJECTIVE. Tax plus what the actions genuinely cost, which is the
    // only formulation under which donating is correctly rejected.
    const objective = tax + allocation.cost;
    curve.push({ target, tax, cost: allocation.cost, objective });

    if (!best || objective < best.objective) {
      best = { target, tax, allocation, objective, profile: p };
    }
  }

  return { regime, base: base.totalTax, best, curve, instruments };
}

/**
 * THE MAIN ENTRY POINT.
 *
 * Solves both regimes and returns the better, on the same principle as
 * advisor.js: the regime is a RESULT of the optimisation, not an assumption
 * made before it starts. A budget that is too small to reach the old regime's
 * ceiling can leave the new regime winning where it would otherwise lose.
 *
 * @param budget how much the taxpayer can still commit this year, in rupees.
 *               Infinity reproduces the unconstrained question advisor.js asks.
 */
function optimiseAllocation(profile, yearKey, opts) {
  const o = Object.assign({ budget: Infinity }, opts || {});
  const budget = o.budget === Infinity ? 1e12 : gNum(o.budget);

  const oldR = solveRegime(profile, yearKey, 'old', budget);
  const newR = solveRegime(profile, yearKey, 'new', budget);

  const pick = (!oldR.best ? newR
             : !newR.best ? oldR
             : (oldR.best.objective <= newR.best.objective ? oldR : newR));
  const other = pick === oldR ? newR : oldR;

  const asIs = TaxEngine.compareRegimes(profile, yearKey);

  return {
    budget: o.budget,
    regime: pick.regime,
    otherRegime: other.regime,
    taxAsIs: asIs.best.totalTax,
    tax: pick.best ? pick.best.tax : pick.base,
    outlay: pick.best ? pick.best.allocation.outlay : 0,
    cost: pick.best ? pick.best.allocation.cost : 0,
    objective: pick.best ? pick.best.objective : pick.base,

    /** What to actually do, cheapest-first. */
    allocation: pick.best
      ? pick.best.allocation.picks.map((p) => ({
          id: p.instrument.id,
          section: p.instrument.section,
          label: p.instrument.label,
          amount: Math.round(p.amount),
          costRatio: p.instrument.costRatio,
          realCost: Math.round(p.cost),
          note: p.instrument.note,
        }))
      : [],

    /** Tax saved, and what it cost to save it. */
    taxSaved: asIs.best.totalTax - (pick.best ? pick.best.tax : pick.base),
    netGain: asIs.best.totalTax - (pick.best ? pick.best.objective : pick.base),

    profile: pick.best ? pick.best.profile : profile,
    curve: pick.curve,
    comparedWith: { regime: other.regime, objective: other.best ? other.best.objective : other.base },
  };
}

/* ============================================================================
 * THE BENCHMARK — what does filling every ceiling in order actually cost?
 * ==========================================================================*/

/**
 * The greedy policy, run under the same budget.
 *
 * This is what advisor.js does and what every tax tool does: walk the
 * instruments in a fixed, sensible-looking order — biggest headline saving
 * first — and fill each until the money runs out.
 *
 * It is not stupid, and with an unlimited budget it is optimal, because it
 * eventually reaches everything. Under a budget it can spend the whole
 * allowance on an instrument whose deduction is real but whose cost is high,
 * and the exact solver is what shows by how much.
 */
function greedyBaseline(profile, yearKey, regime, budget) {
  const instruments = availableInstruments(profile, regime, yearKey);

  // Ordered by TAX SAVED, largest first — which is what advisor.js does when
  // it ranks candidate moves by standalone impact.
  //
  // Every instrument here reduces total income rupee for rupee, so they all
  // save tax at the same marginal rate; ranking by tax saved is therefore
  // exactly ranking by headroom. That is not a strawman, it is what a
  // sensible tool actually does. The blind spot is that nothing in this
  // ordering knows what the rupee COSTS, so a taxpayer whose ceilings are
  // already full has nothing left with headroom except donations — and greedy
  // will cheerfully spend the whole budget giving money away to save 30% of
  // it. SAMPLES.meera is exactly that case.
  const order = instruments.slice().sort((a, b) => b.headroom - a.headroom);

  const picks = [];
  let spent = 0;
  let cost = 0;
  for (const inst of order) {
    const take = Math.min(inst.headroom, Math.max(0, budget - spent));
    if (take <= 0.5) continue;
    picks.push({ instrument: inst, amount: take, cost: take * inst.costRatio });
    spent += take;
    cost += take * inst.costRatio;
  }

  const p = applyAllocation(profile, { picks });
  const tax = TaxEngine.computeRegime(p, regime, yearKey).totalTax;
  return { picks, outlay: spent, cost, tax, objective: tax + cost };
}

/**
 * Optimality gap between the exact solver and the greedy policy, for one
 * taxpayer at one budget. Positive means greedy left money on the table.
 */
function optimalityGap(profile, yearKey, budget) {
  const exact = optimiseAllocation(profile, yearKey, { budget });
  const greedyOld = greedyBaseline(profile, yearKey, 'old', budget);
  const greedyNew = greedyBaseline(profile, yearKey, 'new', budget);
  const greedy = greedyOld.objective <= greedyNew.objective ? greedyOld : greedyNew;

  return {
    budget,
    exactObjective: Math.round(exact.objective),
    greedyObjective: Math.round(greedy.objective),
    gap: Math.round(greedy.objective - exact.objective),
    exactRegime: exact.regime,
    greedyRegime: greedyOld.objective <= greedyNew.objective ? 'old' : 'new',
    exact,
    greedy,
  };
}

/* ---------------------------------------------------------------------------
 * Plain global, plus a CommonJS tail for the Node tests.
 * ------------------------------------------------------------------------ */
const Allocate = {
  optimise: optimiseAllocation,
  solveRegime,
  greedyBaseline,
  optimalityGap,
  availableInstruments,
  cheapestWayTo,
  candidateTargets,
  applyAllocation,
};

if (typeof window !== 'undefined') window.Allocate = Allocate;
if (typeof module !== 'undefined' && module.exports) module.exports = Allocate;
