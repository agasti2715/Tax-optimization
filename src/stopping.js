/* ============================================================================
 * stopping.js — THE REGIME CHOICE AS AN OPTIMAL STOPPING PROBLEM
 * ----------------------------------------------------------------------------
 * This is the feature that no other tax tool has, and the reason is that no
 * other tax tool reads s.115BAC(6) as anything other than a filing formality.
 *
 * ----------------------------------------------------------------------------
 * THE RULE EVERYONE MISSES
 * ----------------------------------------------------------------------------
 * A SALARIED taxpayer picks a regime afresh every single year. For them the
 * question really is just "which is cheaper this year", and every calculator
 * on the internet answers it correctly.
 *
 * A taxpayer with BUSINESS OR PROFESSIONAL income cannot do that. Under
 * s.115BAC(6), filing Form 10-IEA to leave the new regime is a once-in-a-
 * lifetime move. Having left, they may return to the new regime once — and
 * that is the end of it. From then on they are locked into the new regime for
 * the rest of their working life, whatever their income does.
 *
 * So the freelancer's decision is not a comparison. It is the EXERCISE OF AN
 * IRREVERSIBLE OPTION, and the correct treatment is the one finance uses for
 * every other irreversible option: an optimal stopping problem.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS CHANGES THE ANSWER
 * ----------------------------------------------------------------------------
 * Exercising an option has two costs: what you pay, and what you give up by no
 * longer holding it. A calculator that compares this year's tax sees only the
 * first. The consequence is a specific, repeatable, expensive mistake:
 *
 *     A consultant in a lean year finds the old regime saves Rs.18,000. Every
 *     tool on the internet tells them to file Form 10-IEA. They do. Their
 *     practice grows, the new regime becomes the better home for them, they
 *     use their one re-entry — and they are locked. Ten years later a bad year
 *     arrives where the old regime would have saved them a great deal, and the
 *     door is shut.
 *
 * The option was worth more than the Rs.18,000 it was spent on. That is
 * invisible to a one-year comparison and obvious to a dynamic program.
 *
 * ----------------------------------------------------------------------------
 * THE FORMULATION
 * ----------------------------------------------------------------------------
 * State:  (year t, income level y, regime status s)
 *
 * Because the statute allows exactly one exit and one return, there are only
 * three reachable regime statuses over a whole career:
 *
 *     FRESH   in the new regime, opt-out still available
 *     OPTED   in the old regime, having spent the opt-out; re-entry available
 *     LOCKED  back in the new regime, both moves spent — absorbing
 *
 * Bellman recursion, minimising discounted lifetime tax:
 *
 *     V(t, y, s) = min over admissible actions a of
 *                     tax(y, regime(s,a)) + delta * E_y'[ V(t+1, y', s') ]
 *
 * The expectation is taken over next year's income, which is exactly what
 * forecast.js supplies. Backward induction from retirement gives the policy.
 *
 * The number worth printing is not V itself but the difference between the
 * optimal policy and the myopic one — the rupee value of thinking ahead.
 *
 * ----------------------------------------------------------------------------
 * HOW THE DEFAULTS WERE CHOSEN — A CONVERGENCE STUDY, NOT A GUESS
 * ----------------------------------------------------------------------------
 * Early runs gave an unstable answer on the demo taxpayer, and the obvious
 * diagnosis — "not enough Monte Carlo draws" — turned out to be wrong. Running
 * the ensemble across grid sizes and draw counts on SAMPLES.meera:
 *
 *     grid  draws   recommendation   agreement
 *       24    150   optout                 60%
 *       24    350   optout                 60%     <- 2.3x the draws, no change
 *       36    150   optout                 60%
 *       36    350   stay                   60%
 *       48    150   stay                  100%     <- resolution is what mattered
 *       48    350   stay                  100%
 *
 * The instability was DISCRETISATION error, not sampling error. Tripling the
 * draws bought nothing; doubling the grid resolved the question outright. The
 * reason is that the regime crossover is a sharp boundary in income, and a
 * coarse log-spaced grid steps straight over it — no amount of sampling fixes
 * a state space that cannot represent the thing being decided.
 *
 * Hence gridSize 48 by default, and a modest draw count. Spend the compute on
 * resolution.
 *
 * That default was only affordable because of the shift-invariance trick in
 * buildKernelShiftInvariant, which took a single analysis from 4.5 seconds to
 * 0.10 and an ensemble from 22 seconds to 0.38. Before it, the resolution the
 * problem actually needs would have been impossible in a browser.
 * ========================================================================== */

/* ---------- status codes -------------------------------------------------- */

const FRESH = 0;  // new regime, opt-out unused
const OPTED = 1;  // old regime, opt-out spent, re-entry available
const LOCKED = 2; // new regime, both moves spent — no way out

const STATUS_LABEL = ['New regime (opt-out still available)',
                      'Old regime (re-entry still available)',
                      'New regime (locked in permanently)'];

/**
 * Which regime you are actually taxed under in each status, and where each
 * admissible action takes you.
 *
 * FRESH  : stay in new, or spend the opt-out and move to old
 * OPTED  : stay in old, or spend the re-entry and move back to new
 * LOCKED : nothing to decide
 */
const REGIME_OF = ['new', 'old', 'new'];

const ACTIONS = [
  // from FRESH
  [{ id: 'stay', to: FRESH, regime: 'new', label: 'Stay in the new regime, keeping the option' },
   { id: 'optout', to: OPTED, regime: 'old', label: 'File Form 10-IEA and move to the old regime' }],
  // from OPTED
  [{ id: 'stay', to: OPTED, regime: 'old', label: 'Stay in the old regime, keeping the re-entry' },
   { id: 'reenter', to: LOCKED, regime: 'new', label: 'Return to the new regime — this is the last move available' }],
  // from LOCKED
  [{ id: 'stay', to: LOCKED, regime: 'new', label: 'Locked in the new regime — no choice remains' }],
];

/* ============================================================================
 * STEP 1 — DISCRETISE INCOME
 * ==========================================================================*/

/**
 * Build a log-spaced grid of income levels spanning where this taxpayer's
 * income plausibly goes over the horizon.
 *
 * Log spacing rather than linear because income is multiplicative — a 10%
 * move matters the same whether you earn 8 lakh or 80 lakh — and because the
 * forecast is lognormal, so a log grid puts the state points where the
 * probability mass actually is.
 */
function buildIncomeGrid(features, years, size, seed) {
  const paths = Forecast.simulatePaths(features, years, 400, seed);
  const all = [];
  for (const row of paths) for (const v of row) all.push(v);
  all.sort((a, b) => a - b);

  // Trim the extreme tails so a single freak path does not stretch the grid
  // and waste most of the states on income levels that will never be visited.
  const lo = Math.max(50000, all[Math.floor(all.length * 0.01)]);
  const hi = Math.max(lo * 1.5, all[Math.floor(all.length * 0.99)]);

  const grid = [];
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  for (let i = 0; i < size; i++) {
    grid.push(Math.exp(logLo + ((logHi - logLo) * i) / (size - 1)));
  }
  return grid;
}

/** Nearest grid index for an income level, on the log scale the grid uses. */
function nearestIndex(grid, value) {
  let best = 0;
  let bestD = Infinity;
  const lv = Math.log(Math.max(1, value));
  for (let i = 0; i < grid.length; i++) {
    const d = Math.abs(Math.log(grid[i]) - lv);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/* ============================================================================
 * STEP 2 — THE TRANSITION KERNEL
 * ==========================================================================*/

/**
 * P[t][i][j] — the probability that a taxpayer at income level i in year t is
 * at level j in year t+1, estimated by sampling the forecaster.
 *
 * The kernel is time-varying rather than fixed, because expected income growth
 * tapers with age: a 28-year-old's income and a 56-year-old's do not diffuse
 * at the same rate, and a stationary kernel would quietly assume they do.
 */
function buildKernel(features, grid, years, draws, seed) {
  // Fast path — see buildKernelShiftInvariant for why this is exact, not an
  // approximation, whenever the analytic prior is in use.
  if (!Forecast.hasTrainedModel()) {
    return buildKernelShiftInvariant(features, grid, years, draws, seed);
  }
  return buildKernelGeneral(features, grid, years, draws, seed);
}

/**
 * THE FAST KERNEL.
 *
 * Under the analytic prior, log-income moves as a random walk:
 *
 *     log Y' = log Y + mu + sigma * Z
 *
 * and crucially mu and sigma depend on age, employment type and variable-pay
 * share — but NOT on the income level itself. The step distribution is
 * therefore identical from every state, and on a UNIFORMLY log-spaced grid
 * that means every row of the transition matrix is the same row, shifted.
 *
 * So instead of sampling n separate rows we sample one offset histogram per
 * year and slide it. That turns an O(years * n * draws) build into
 * O(years * draws), which for a 31-year horizon on a 48-point grid is a
 * 48-fold reduction — the difference between a four-second wait and an
 * instant answer, and what makes running the model in a browser viable at the
 * resolution the convergence study says it actually needs.
 *
 * This is exact rather than an approximation, with one caveat: probability
 * that would fall off either end of the grid is accumulated at the boundary
 * state instead, which is the same clamping the sampled version does.
 *
 * It does NOT hold once a trained model is loaded, because a fitted quantile
 * regressor takes logIncome as a feature and so its step distribution varies
 * with income level. That case falls through to the general builder.
 */
function buildKernelShiftInvariant(features, grid, years, draws, seed) {
  const rng = Forecast.makeRng(seed);
  const n = grid.length;
  const h = (Math.log(grid[n - 1]) - Math.log(grid[0])) / (n - 1); // uniform log step
  const kernel = [];

  for (let t = 0; t < years; t++) {
    // One reference distribution for the whole year, taken at any income
    // level — the step is the same from all of them.
    const dist = Forecast.predict({
      currentIncome: grid[0],
      employmentType: features.employmentType,
      city: features.city,
      age: (features.age || 35) + t,
      expYears: (features.expYears || 10) + t,
      variableShare: features.variableShare,
    });

    // Histogram of integer grid offsets produced by one year's step.
    const offsets = new Map();
    for (let d = 0; d < draws; d++) {
      const step = Math.log(Math.max(1, dist.quantile(rng()))) - Math.log(grid[0]);
      const k = Math.round(step / h);
      offsets.set(k, (offsets.get(k) || 0) + 1);
    }

    const layer = [];
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(n);
      for (const [k, count] of offsets) {
        // Clamp at the ends rather than discarding, so each row still sums
        // to one and no probability mass quietly disappears.
        const j = Math.max(0, Math.min(n - 1, i + k));
        row[j] += count / draws;
      }
      layer.push(row);
    }
    kernel.push(layer);
  }
  return kernel;
}

/** The general builder — one sampled row per state. Used for trained models. */
function buildKernelGeneral(features, grid, years, draws, seed) {
  const rng = Forecast.makeRng(seed);
  const kernel = [];
  const n = grid.length;

  for (let t = 0; t < years; t++) {
    const layer = [];
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(n);
      const dist = Forecast.predict({
        currentIncome: grid[i],
        employmentType: features.employmentType,
        city: features.city,
        age: (features.age || 35) + t,
        expYears: (features.expYears || 10) + t,
        variableShare: features.variableShare,
      });
      for (let d = 0; d < draws; d++) {
        row[nearestIndex(grid, dist.quantile(rng()))] += 1;
      }
      for (let j = 0; j < n; j++) row[j] /= draws;
      layer.push(row);
    }
    kernel.push(layer);
  }
  return kernel;
}

/* ============================================================================
 * STEP 3 — THE TAX TABLE
 * ==========================================================================*/

/**
 * tax[i][regime] — liability at each grid income under each regime.
 *
 * Computed once through the real engine rather than approximated, so slab
 * kinks, the 87A cliff and surcharge bands are all in the dynamic program
 * rather than smoothed away by a linear stand-in.
 */
function buildTaxTable(profile, yearKey, grid) {
  return grid.map((income) => {
    const p = AdvanceTax.profileAtIncome(profile, income);
    return {
      new: TaxEngine.computeRegime(p, 'new', yearKey).totalTax,
      old: TaxEngine.computeRegime(p, 'old', yearKey).totalTax,
    };
  });
}

/* ============================================================================
 * STEP 4 — BACKWARD INDUCTION
 * ==========================================================================*/

/**
 * TERMINAL CONDITION — and it has to be chosen carefully.
 *
 * Beyond the horizon we freeze income and value the rest of the taxpayer's
 * life as a perpetuity. The question is which regime to charge them in, and
 * the obvious answer is wrong.
 *
 * Charging each status its CURRENT regime — new for FRESH, old for OPTED —
 * quietly asserts that a FRESH taxpayer can never opt out again. At any income
 * where the old regime is cheaper that makes FRESH look worse than OPTED, i.e.
 * it makes holding an unspent option worse than having already spent it. That
 * is impossible, and it propagates backwards through the whole recursion.
 *
 * So each status is valued at the best regime STILL AVAILABLE to it:
 *
 *     FRESH   min(new, old)  — the opt-out is unspent and can still be used
 *     OPTED   min(old, new)  — the re-entry is unspent and can still be used
 *     LOCKED  new            — genuinely stuck, and the only status that is
 *
 * This was caught by the dominance test in test/verify_stopping.js rather than
 * by reading the code, which is exactly the sort of error a dynamic program
 * hides well: every number it produced looked plausible.
 */
function applyTerminal(layer, taxTable, discount) {
  const perpetuity = 1 / (1 - discount);
  for (let i = 0; i < taxTable.length; i++) {
    const best = Math.min(taxTable[i].new, taxTable[i].old);
    layer[FRESH][i] = best * perpetuity;
    layer[OPTED][i] = best * perpetuity;
    layer[LOCKED][i] = taxTable[i].new * perpetuity;
  }
}

/**
 * Solve the Bellman recursion by backward induction from the final year.
 *
 * Returns V[t][s][i] (expected discounted lifetime tax) and the policy
 * A[t][s][i] (which action is optimal there).
 */
function solve(taxTable, kernel, years, discount) {
  const n = taxTable.length;
  const V = [];
  const A = [];

  for (let t = 0; t <= years; t++) {
    V.push([new Float64Array(n), new Float64Array(n), new Float64Array(n)]);
    A.push([new Array(n).fill('stay'), new Array(n).fill('stay'), new Array(n).fill('stay')]);
  }

  applyTerminal(V[years], taxTable, discount);

  for (let t = years - 1; t >= 0; t--) {
    for (let s = 0; s < 3; s++) {
      for (let i = 0; i < n; i++) {
        let bestVal = Infinity;
        let bestAction = 'stay';

        for (const act of ACTIONS[s]) {
          const immediate = taxTable[i][act.regime];

          // Expected continuation value, integrated over next year's income.
          let cont = 0;
          const row = kernel[t][i];
          const Vnext = V[t + 1][act.to];
          for (let j = 0; j < n; j++) {
            if (row[j] > 0) cont += row[j] * Vnext[j];
          }

          const total = immediate + discount * cont;
          if (total < bestVal) { bestVal = total; bestAction = act.id; }
        }

        V[t][s][i] = bestVal;
        A[t][s][i] = bestAction;
      }
    }
  }

  return { V, A };
}

/* ============================================================================
 * STEP 5 — THE MYOPIC BENCHMARK
 * ==========================================================================*/

/**
 * What every other tool does: in each year, take whichever regime is cheaper
 * right now, subject only to the moves still legally available.
 *
 * Evaluating this policy on the SAME kernel and the SAME tax table is what
 * lets us put a rupee figure on the mistake. Without a benchmark, "we solved
 * a dynamic program" is a technique; with one, it is a result.
 */
function evaluateMyopic(taxTable, kernel, years, discount) {
  const n = taxTable.length;
  const V = [];
  for (let t = 0; t <= years; t++) {
    V.push([new Float64Array(n), new Float64Array(n), new Float64Array(n)]);
  }

  // The SAME terminal condition as the optimal solve. Scoring the two
  // policies against different endings would confound the comparison — the
  // gap between them has to come from the policies alone.
  applyTerminal(V[years], taxTable, discount);

  for (let t = years - 1; t >= 0; t--) {
    for (let s = 0; s < 3; s++) {
      for (let i = 0; i < n; i++) {
        // The myopic rule: pick this year's cheaper regime, ignoring the fact
        // that the move can never be undone.
        let chosen = ACTIONS[s][0];
        for (const act of ACTIONS[s]) {
          if (taxTable[i][act.regime] < taxTable[i][chosen.regime]) chosen = act;
        }

        let cont = 0;
        const row = kernel[t][i];
        const Vnext = V[t + 1][chosen.to];
        for (let j = 0; j < n; j++) if (row[j] > 0) cont += row[j] * Vnext[j];

        V[t][s][i] = taxTable[i][chosen.regime] + discount * cont;
      }
    }
  }
  return V;
}

/* ============================================================================
 * THE PUBLIC ENTRY POINT
 * ==========================================================================*/

/**
 * Should this taxpayer opt out of the new regime this year?
 *
 * @param profile   the taxpayer
 * @param yearKey   'FY2025-26'
 * @param features  what forecast.js needs (age, employment type, variability)
 * @param opts.status        FRESH | OPTED | LOCKED — where they stand today
 * @param opts.retirementAge horizon for the recursion (default 60)
 * @param opts.discount      time value of money (default 0.94, about 6%)
 */
function analyse(profile, yearKey, features, opts) {
  const o = Object.assign({
    status: FRESH,
    retirementAge: 60,
    discount: 0.94,
    gridSize: 48,
    draws: 300,
    seed: 20260908,
  }, opts || {});

  const feat = Object.assign({
    currentIncome: AdvanceTax.totalIncomeOf(profile),
    employmentType: profile.employmentType || 'salaried',
    city: profile.city,
    age: 35,
    variableShare: 0,
  }, features || {});

  const years = Math.max(1, Math.min(40, o.retirementAge - (feat.age || 35)));

  /* --- does the irreversibility even apply to this taxpayer? ------------ */
  // s.115BAC(6) binds only those with business or professional income. A
  // purely salaried taxpayer chooses afresh every year, so there is no option
  // to value and the honest answer is to say so rather than manufacture one.
  const hasBusinessIncome =
    (profile.business && (profile.business.netProfit > 0 || profile.business.grossReceipts > 0)) ||
    feat.employmentType === 'business' || feat.employmentType === 'professional';

  const grid = buildIncomeGrid(feat, years, o.gridSize, o.seed);
  const taxTable = buildTaxTable(profile, yearKey, grid);
  const kernel = buildKernel(feat, grid, years, o.draws, o.seed + 1);

  const { V, A } = solve(taxTable, kernel, years, o.discount);
  const Vmyopic = evaluateMyopic(taxTable, kernel, years, o.discount);

  const here = nearestIndex(grid, feat.currentIncome);
  const status = o.status;

  /* --- THIS YEAR'S DECISION, TAKEN AT THE TAXPAYER'S EXACT INCOME -------- */
  // The grid exists to solve the recursion, not to answer the question. Its
  // nodes are log-spaced, so consecutive nodes differ by double-digit
  // percentages of income — wide enough to sit on opposite sides of the
  // regime crossover from where the taxpayer actually is. Reading the year-0
  // action straight off A[0][status][here] therefore produces advice for a
  // neighbouring income rather than for this one.
  //
  // So year 0 is evaluated exactly: real tax figures from the engine, and a
  // continuation value obtained by pushing the taxpayer's ACTUAL income
  // through the forecaster and integrating V(1, .) over where it lands.
  const thisYearTax = {
    new: TaxEngine.computeRegime(profile, 'new', yearKey).totalTax,
    old: TaxEngine.computeRegime(profile, 'old', yearKey).totalTax,
  };

  const startRow = (function () {
    const rng = Forecast.makeRng(o.seed + 2);
    const row = new Float64Array(grid.length);
    const dist = Forecast.predict(feat);
    const draws = Math.max(400, o.draws);
    for (let d = 0; d < draws; d++) row[nearestIndex(grid, dist.quantile(rng()))] += 1;
    for (let j = 0; j < grid.length; j++) row[j] /= draws;
    return row;
  })();

  const actionValues = ACTIONS[status].map((act) => {
    let cont = 0;
    const Vnext = V[1][act.to];
    for (let j = 0; j < grid.length; j++) if (startRow[j] > 0) cont += startRow[j] * Vnext[j];
    return { act, value: thisYearTax[act.regime] + o.discount * cont };
  });
  actionValues.sort((a, b) => a.value - b.value);

  const actionSpec = actionValues[0].act;
  const optimalAction = actionSpec.id;

  // What the decision is worth relative to the runner-up. A near-tie is worth
  // saying out loud rather than presenting as a confident recommendation.
  const margin = actionValues.length > 1
    ? Math.round(actionValues[1].value - actionValues[0].value)
    : null;

  /* --- what the myopic rule would pick in this same state --------------- */
  // Naming the rival's answer explicitly matters. "Stay" means stay in the NEW
  // regime from FRESH but stay in the OLD regime from OPTED, so a bare
  // comparison of action ids against "is old cheaper" gets the sign wrong in
  // one of the two states.
  let myopicSpec = ACTIONS[status][0];
  for (const act of ACTIONS[status]) {
    if (thisYearTax[act.regime] < thisYearTax[myopicSpec.regime]) myopicSpec = act;
  }

  /* --- this year's naive comparison, for contrast ----------------------- */
  // Computed from the taxpayer's ACTUAL profile, not from the nearest grid
  // point. The grid is a device for solving the recursion; quoting a rupee
  // figure off it would be off by however far the taxpayer sits from a node.
  const thisYearNew = thisYearTax.new;
  const thisYearOld = thisYearTax.old;
  const myopicPrefersOld = thisYearOld < thisYearNew;
  const thisYearGap = Math.abs(thisYearOld - thisYearNew);

  /* --- the value of the option ------------------------------------------ */
  // What the taxpayer's position is worth holding the option, against what it
  // is worth having already spent it. The difference is the option's value.
  const valueHolding = V[0][FRESH][here];
  const valueSpent = status === FRESH ? V[0][OPTED][here] : null;

  const costOfMyopia = Vmyopic[0][status][here] - V[0][status][here];

  /* --- where does the policy flip? -------------------------------------- */
  // The income level at which the optimal action changes. This is the
  // "exercise boundary" in options language, and it is the single most useful
  // thing to show a taxpayer: not just what to do, but at what income the
  // advice would change.
  let boundary = null;
  for (let i = 1; i < grid.length; i++) {
    if (A[0][status][i] !== A[0][status][i - 1]) {
      boundary = { income: grid[i], from: A[0][status][i - 1], to: A[0][status][i] };
      break;
    }
  }

  return {
    applicable: hasBusinessIncome,
    reason: hasBusinessIncome
      ? 'Business or professional income — s.115BAC(6) makes the regime choice irreversible.'
      : 'Salaried with no business income — the regime may be chosen afresh every year, ' +
        'so there is no option to value and the one-year comparison is the right answer.',

    status,
    statusLabel: STATUS_LABEL[status],
    horizonYears: years,
    currentIncome: feat.currentIncome,

    thisYear: {
      newRegime: thisYearNew,
      oldRegime: thisYearOld,
      cheaper: myopicPrefersOld ? 'old' : 'new',
      gap: thisYearGap,
    },

    recommendation: {
      action: optimalAction,
      label: actionSpec.label,
      margin,
      /** What a one-year comparison — every rival tool — would have said. */
      myopicAction: myopicSpec.id,
      myopicLabel: myopicSpec.label,
      /**
       * THE HEADLINE. True when looking ahead genuinely changes the advice,
       * rather than merely confirming it. This is the case worth putting in
       * front of a taxpayer, because it is the one no other tool can reach.
       */
      contradictsMyopic: hasBusinessIncome && myopicSpec.id !== optimalAction,
    },

    lifetime: {
      optimal: Math.round(V[0][status][here]),
      myopic: Math.round(Vmyopic[0][status][here]),
      costOfMyopia: Math.round(costOfMyopia),
    },

    optionValue: valueSpent === null ? null : Math.round(valueSpent - valueHolding),

    boundary,
    grid,
    policy: A[0][status],
    taxTable,
  };
}

/* ============================================================================
 * ENSEMBLE — HOW MUCH OF THIS IS SIGNAL?
 * ==========================================================================*/

/**
 * Run the analysis under several random seeds and report the agreement.
 *
 * WHY THIS EXISTS. A single `analyse` returns a confident-looking action and a
 * confident-looking rupee margin. Measurement showed the first is trustworthy
 * and the second is not: across twelve seed and resolution settings on the
 * same taxpayer, the recommended action held at "stay" eleven times, while the
 * margin ranged from Rs.502 to Rs.3,25,341.
 *
 * That spread is not a bug to be fixed by tuning. It is inherent: the margin is
 * the difference between two discounted lifetime values of the order of six
 * crore, so a Monte Carlo error of well under a tenth of a percent in each is
 * enough to move it by an order of magnitude. The difference is small; the
 * quantities it is drawn from are not.
 *
 * The honest response is to report the direction, which is stable, and to
 * report the strength of the evidence for it rather than a fabricated precise
 * figure. A recommendation backed by 11 of 12 seeds should be presented
 * differently from one backed by 7 of 12, and neither should be presented with
 * a rupee margin quoted to the last digit.
 */
function analyseEnsemble(profile, yearKey, features, opts) {
  const o = Object.assign({ runs: 7 }, opts || {});
  const runs = [];

  for (let k = 0; k < o.runs; k++) {
    runs.push(analyse(profile, yearKey, features,
      Object.assign({}, o, { seed: 1000 + k * 7919 })));
  }

  // Which action wins most often?
  const tally = {};
  for (const r of runs) tally[r.recommendation.action] = (tally[r.recommendation.action] || 0) + 1;
  let modal = runs[0].recommendation.action;
  for (const k of Object.keys(tally)) if (tally[k] > tally[modal]) modal = k;

  const agreement = tally[modal] / runs.length;
  const margins = runs.map((r) => r.recommendation.margin).filter((m) => m !== null).sort((a, b) => a - b);
  const representative = runs.find((r) => r.recommendation.action === modal) || runs[0];

  return Object.assign({}, representative, {
    ensemble: {
      runs: runs.length,
      action: modal,
      agreement,
      /**
       * A plain-language reading of the evidence, so the UI is not left to
       * invent one. Anything below unanimity is worth flagging as a close
       * call rather than dressing up as a recommendation.
       */
      confidence: agreement === 1 ? 'unanimous'
                : agreement >= 0.8 ? 'strong'
                : agreement >= 0.6 ? 'leaning'
                : 'genuinely close — treat the two options as equivalent',
      marginRange: margins.length
        ? { low: margins[0], median: margins[Math.floor(margins.length / 2)], high: margins[margins.length - 1] }
        : null,
      tally,
    },
  });
}

/* ---------------------------------------------------------------------------
 * Plain global, plus a CommonJS tail for the Node tests.
 * ------------------------------------------------------------------------ */
const RegimeStopping = {
  analyse,
  analyseEnsemble,
  buildIncomeGrid,
  buildKernel,
  buildKernelShiftInvariant,
  buildKernelGeneral,
  buildTaxTable,
  solve,
  applyTerminal,
  evaluateMyopic,
  nearestIndex,
  FRESH,
  OPTED,
  LOCKED,
  STATUS_LABEL,
  ACTIONS,
};

if (typeof window !== 'undefined') window.RegimeStopping = RegimeStopping;
if (typeof module !== 'undefined' && module.exports) module.exports = RegimeStopping;
