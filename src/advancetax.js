/* ============================================================================
 * advancetax.js — ADVANCE TAX AS A NEWSVENDOR PROBLEM
 * ----------------------------------------------------------------------------
 * On 15 June a taxpayer must hand money to the government based on what they
 * think they will earn by the following March. They do not know. A bonus may
 * or may not land; a client may or may not pay; a stock grant may or may not
 * vest.
 *
 * Every tax tool in existence answers this by pretending the uncertainty is
 * not there: take the liability, split it 15 / 45 / 75 / 100, print four
 * dates. That is the right answer to a question nobody is actually asking.
 *
 * ----------------------------------------------------------------------------
 * THE ACTUAL PROBLEM
 * ----------------------------------------------------------------------------
 * You are choosing a quantity under uncertain demand, where running short and
 * running over cost different amounts. That is the NEWSVENDOR PROBLEM, one of
 * the oldest results in operations research, and its solution is not the
 * expected demand — it is a QUANTILE of the demand distribution:
 *
 *       q* = F-inverse( Cu / (Cu + Co) )
 *
 *   Cu  cost of paying one rupee too little — 1% per month under s.234C, and
 *       1% per month under s.234B if the year ends below 90%
 *   Co  cost of paying one rupee too much — the return that rupee would have
 *       earned you, less the 0.5% per month s.244A pays you back
 *
 * Because Cu is roughly twice Co (see test/verify_interest.js, which pins this
 * down empirically), the ratio lands near 0.68 rather than 0.5. The correct
 * instalment is therefore ABOVE the median forecast: you should deliberately
 * over-pay relative to your best guess, because the penalty for being short
 * bites harder than the carrying cost of being long.
 *
 * That is a genuinely counter-intuitive, genuinely actionable result, and it
 * falls straight out of the statute once you stop pretending income is known.
 *
 * ----------------------------------------------------------------------------
 * WHAT THIS FILE DOES
 * ----------------------------------------------------------------------------
 *   1. Draws income samples from forecast.js
 *   2. Pushes each through the deterministic tax engine to get a distribution
 *      over LIABILITY (not income — the slab structure is non-linear, so the
 *      liability distribution is not just a rescaled income distribution)
 *   3. Grid-searches the target percentile that minimises expected cost under
 *      the real statutory cost function in interest.js
 *   4. Checks the numerical optimum against the closed-form critical ratio
 *   5. Reports what the naive alternatives would have cost instead
 *
 * The optimiser never guesses at tax arithmetic and never guesses at interest.
 * It searches over a cost function that is itself the Act.
 * ========================================================================== */

/* ---------- helpers ------------------------------------------------------ */

const aNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Total income implied by a profile, on the salary side. Used to rescale a
 * profile so that it represents a sampled income level.
 */
function salaryTotal(profile) {
  const s = profile.salary || {};
  return aNum(s.basic) + aNum(s.da) + aNum(s.hraReceived) + aNum(s.otherAllowances);
}

/**
 * The earning base the forecaster should be pointed at — salary AND business
 * profit. A consultant with no salary line has an income of zero by
 * `salaryTotal` alone, which would forecast from the wrong base entirely.
 */
function totalIncomeOf(profile) {
  return salaryTotal(profile) + aNum(profile.business && profile.business.netProfit);
}

/**
 * Produce a copy of the profile earning `targetIncome` instead.
 *
 * This has to respect WHERE the taxpayer's income comes from. Basic pay and
 * HRA are contractual and move slowly; what actually swings from year to year
 * is the variable component — bonus and incentive on the salary side,
 * net profit on the business side. So the variable components absorb the
 * change, in proportion to their present size, and the contractual ones are
 * held still.
 *
 * Getting this wrong is not a rounding error. Writing the target into salary
 * for a consultant whose income is business profit leaves the profit sitting
 * there too, and every liability in the study comes out roughly double.
 */
function profileAtIncome(profile, targetIncome) {
  const p = JSON.parse(JSON.stringify(profile));
  const s = p.salary || (p.salary = {});
  const b = p.business || (p.business = { netProfit: 0, grossReceipts: 0, isProfessional: false });

  const target = Math.max(0, targetIncome);
  const fixed = aNum(s.basic) + aNum(s.da) + aNum(s.hraReceived);
  const variable = aNum(s.otherAllowances) + aNum(b.netProfit);

  if (variable > 0 && target >= fixed) {
    // The normal case: flex the variable components to meet the target.
    const scale = (target - fixed) / variable;
    s.otherAllowances = aNum(s.otherAllowances) * scale;
    if (aNum(b.netProfit) > 0) {
      const bScale = scale;
      b.netProfit = aNum(b.netProfit) * bScale;
      if (aNum(b.grossReceipts) > 0) b.grossReceipts = aNum(b.grossReceipts) * bScale;
    }
    return p;
  }

  const current = fixed + variable;
  if (current > 0) {
    // Either there is nothing variable to flex, or the target has fallen below
    // contractual pay. Scale everything proportionally instead — a salary cut
    // takes basic and HRA down with it.
    const scale = target / current;
    s.basic = aNum(s.basic) * scale;
    s.da = aNum(s.da) * scale;
    s.hraReceived = aNum(s.hraReceived) * scale;
    s.otherAllowances = aNum(s.otherAllowances) * scale;
    if (aNum(b.netProfit) > 0) {
      b.netProfit = aNum(b.netProfit) * scale;
      if (aNum(b.grossReceipts) > 0) b.grossReceipts = aNum(b.grossReceipts) * scale;
    }
    return p;
  }

  // An empty profile — put the income where this taxpayer's type says it goes.
  if (p.employmentType === 'business' || p.employmentType === 'professional') {
    b.netProfit = target;
    b.grossReceipts = target;
  } else {
    s.otherAllowances = target;
  }
  return p;
}

/* ============================================================================
 * STEP 1 — THE LIABILITY DISTRIBUTION
 * ==========================================================================*/

/**
 * Turn a distribution over INCOME into a distribution over TAX.
 *
 * This has to go through the engine sample by sample rather than being
 * approximated, because the map from income to tax is not linear and not even
 * continuous: slab boundaries kink it, the 87A rebate puts a cliff in it, and
 * surcharge bands put more cliffs further up. A taxpayer sitting just under
 * Rs.12 lakh has a liability distribution with a step in the middle of it,
 * and averaging income before taxing it would hide exactly that.
 */
function liabilitySamples(profile, yearKey, distribution, n, seed) {
  const incomes = distribution.sample(n, seed);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = profileAtIncome(profile, incomes[i]);
    out[i] = TaxEngine.compareRegimes(p, yearKey).best.totalTax;
  }
  out.sort((a, b) => a - b);
  return { incomes, liabilities: out };
}

/** Empirical quantile of a pre-sorted sample. */
function empiricalQuantile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

/* ============================================================================
 * STEP 2 — THE SCHEDULE IMPLIED BY A TARGET PERCENTILE
 * ==========================================================================*/

/**
 * Pay as though your liability were the theta-th percentile of the forecast,
 * following the statutory 15 / 45 / 75 / 100 ladder.
 *
 * theta is the single decision variable, and it is the one worth reporting:
 * "pay at the 68th percentile of your forecast" is advice a person can act on,
 * where four rupee amounts with no explanation is not.
 */
function scheduleForTarget(sortedLiabilities, theta, tds) {
  const target = Math.max(0, empiricalQuantile(sortedLiabilities, theta) - aNum(tds));
  return scheduleForTotal(target);
}

/** The statutory 15 / 45 / 75 / 100 ladder, expressed as per-date amounts. */
function scheduleForTotal(target) {
  const cum = [0.15, 0.45, 0.75, 1.0].map((f) => Math.max(0, target) * f);
  return [cum[0], cum[1] - cum[0], cum[2] - cum[1], cum[3] - cum[2]];
}

/**
 * Expected cost of a schedule, averaged over every sampled outcome.
 * This is the objective. Everything else in this file is search.
 */
function expectedCost(payments, sortedLiabilities, tds, opts) {
  let total = 0;
  for (let i = 0; i < sortedLiabilities.length; i++) {
    total += InterestRules.planCost(payments, sortedLiabilities[i], tds, opts).net;
  }
  return total / sortedLiabilities.length;
}

/* ============================================================================
 * STEP 3 — THE CLOSED FORM, FOR EXPLANATION
 * ==========================================================================*/

/**
 * The textbook critical ratio, measured on this taxpayer's own cost function
 * rather than assumed.
 *
 * WHERE TO MEASURE, AND WHY IT IS NOT AT THE OPTIMUM. For a newsvendor cost
 *
 *     C(Q) = Cu.E[(D-Q)+] + Co.E[(Q-D)+]
 *     dC/dQ = -Cu.(1 - F(Q)) + Co.F(Q)
 *
 * the derivative at the optimum is zero — that is what makes it the optimum.
 * So the unit costs cannot be read off there. They are the TAIL slopes:
 * far below the optimum almost every outcome is a shortfall and the slope
 * tends to -Cu; far above it almost every outcome is an excess and the slope
 * tends to +Co. So that is where we measure.
 *
 * Doing this empirically rather than quoting "1% against 0.5%" means the safe
 * harbours, the Rule 119A rounding and the 234B cliff are all reflected in the
 * ratio, because they are all inside the cost function being differentiated.
 */
function criticalRatio(sortedLiabilities, tds, opts, referenceTotal) {
  // Probe by PAYMENT AMOUNT rather than by percentile. Percentile probes go
  // degenerate for anyone with substantial TDS: several low quantiles all
  // floor to a zero payment once TDS is subtracted, leaving two probe points
  // sitting on the same spot and a slope of 0/0.
  const at = (q) => ({
    q,
    cost: expectedCost(scheduleForTotal(q), sortedLiabilities, tds, opts),
  });

  const ref = Math.max(1, referenceTotal);

  // Lower tail: nearly every draw is a shortfall here, so the slope is -Cu.
  const lo1 = at(0.20 * ref);
  const lo2 = at(0.50 * ref);
  const cu = Math.max(1e-9, (lo1.cost - lo2.cost) / (lo2.q - lo1.q));

  // Upper tail: nearly every draw is an excess here, so the slope is +Co.
  const hi1 = at(1.50 * ref);
  const hi2 = at(2.00 * ref);
  const co = Math.max(1e-9, (hi2.cost - hi1.cost) / (hi2.q - hi1.q));

  return { cu, co, ratio: cu / (cu + co) };
}

/* ============================================================================
 * STEP 4 — THE OPTIMISER
 * ==========================================================================*/

/**
 * THE MAIN ENTRY POINT.
 *
 * @param profile   the taxpayer
 * @param yearKey   'FY2025-26'
 * @param features  what forecast.js needs — age, employment type, variable
 *                  pay share, and so on
 * @param opts.samples          Monte Carlo draws (default 400)
 * @param opts.opportunityRate  what the taxpayer's money earns elsewhere
 */
function optimiseAdvanceTax(profile, yearKey, features, opts) {
  const o = Object.assign({ samples: 400, opportunityRate: 0.06, seed: 20260908 }, opts || {});
  const tds = aNum(profile.taxPaid && profile.taxPaid.tds);

  /* --- the forecast, and the liability distribution it implies ---------- */
  const feat = Object.assign(
    { currentIncome: totalIncomeOf(profile), employmentType: profile.employmentType || 'salaried',
      city: profile.city, age: 35, variableShare: 0 },
    features || {}
  );
  const dist = Forecast.predict(feat, { forcePrior: !!o.forcePrior });
  const { liabilities } = liabilitySamples(profile, yearKey, dist, o.samples, o.seed);

  /* --- capital gains shielding under the fourth proviso ------------------ */
  // Tax on gains the taxpayer could not have foreseen in June is excused,
  // provided it is settled in a later instalment. We approximate the shielded
  // amount as the tax attributable to declared capital gains.
  const cgProfile = JSON.parse(JSON.stringify(profile));
  cgProfile.capitalGains = { stcgEquity: 0, ltcgEquity: 0, stcgOther: 0, ltcgOther: 0 };
  const taxWithoutCG = TaxEngine.compareRegimes(cgProfile, yearKey).best.totalTax;
  const taxWithCG = TaxEngine.compareRegimes(profile, yearKey).best.totalTax;
  const cgTax = Math.max(0, taxWithCG - taxWithoutCG);
  const shielded = [0.15, 0.45, 0.75, 1.0].map((f) => cgTax * f);

  const costOpts = { opportunityRate: o.opportunityRate, shielded };

  /* --- grid search over the target percentile --------------------------- */
  // The objective is piecewise constant in theta (the empirical quantile only
  // moves when theta crosses a sample), so a fine grid is both sufficient and
  // more robust here than a gradient method.
  let best = null;
  const curve = [];
  for (let t = 1; t <= 99; t++) {
    const theta = t / 100;
    const payments = scheduleForTarget(liabilities, theta, tds);
    const cost = expectedCost(payments, liabilities, tds, costOpts);
    curve.push({ theta, cost });
    if (!best || cost < best.cost) best = { theta, cost, payments };
  }

  /* --- what the closed form predicts ------------------------------------ */
  const optimalTotal = best.payments.reduce((s, p) => s + p, 0);
  const cr = criticalRatio(liabilities, tds, costOpts, optimalTotal);

  /* --- what the naive answers would have cost --------------------------- */
  const naiveMedian = scheduleForTarget(liabilities, 0.50, tds);
  const costMedian = expectedCost(naiveMedian, liabilities, tds, costOpts);

  // The conventional tool's answer: assume this year repeats last year exactly.
  const pointEstimate = TaxEngine.compareRegimes(profile, yearKey).best.totalTax;
  const naivePoint = (function () {
    const target = Math.max(0, pointEstimate - tds);
    const cum = [0.15, 0.45, 0.75, 1.0].map((f) => target * f);
    return [cum[0], cum[1] - cum[0], cum[2] - cum[1], cum[3] - cum[2]];
  })();
  const costPoint = expectedCost(naivePoint, liabilities, tds, costOpts);

  const costNothing = expectedCost([0, 0, 0, 0], liabilities, tds, costOpts);

  /* --- assemble ---------------------------------------------------------- */
  const dates = InterestRules.SCHEDULE_234C.map((s) => s.by);
  return {
    forecast: {
      kind: dist.kind,
      provenance: dist.provenance,
      median: dist.median,
      p10: dist.p10,
      p90: dist.p90,
      spread: dist.spread,
    },
    liability: {
      p10: empiricalQuantile(liabilities, 0.10),
      median: empiricalQuantile(liabilities, 0.50),
      p90: empiricalQuantile(liabilities, 0.90),
      pointEstimate,
    },
    cgShield: cgTax,
    optimal: {
      theta: best.theta,
      payments: best.payments.map((p, i) => ({ by: dates[i], amount: Math.round(p) })),
      expectedCost: Math.round(best.cost),
    },
    closedForm: {
      cu: cr.cu,
      co: cr.co,
      ratio: cr.ratio,
      /** Where the newsvendor formula says the optimum should be. */
      predictedTheta: Math.round(cr.ratio * 100) / 100,
    },
    alternatives: {
      median:       { theta: 0.5, expectedCost: Math.round(costMedian) },
      pointEstimate: { expectedCost: Math.round(costPoint) },
      nothing:      { expectedCost: Math.round(costNothing) },
    },
    savingVsMedian: Math.round(costMedian - best.cost),
    savingVsPoint: Math.round(costPoint - best.cost),
    curve,
  };
}

/**
 * How much the trained forecaster is worth, in rupees.
 *
 * Runs the optimiser twice — once forced onto the analytic prior, once on
 * whatever model is loaded — and reports the difference in realised expected
 * cost. This is the honest way to state what the machine learning contributes:
 * not "the model is accurate" but "using it instead of the baseline saves this
 * taxpayer this many rupees a year."
 */
function valueOfModel(profile, yearKey, features, opts) {
  if (!Forecast.hasTrainedModel()) {
    return { available: false, reason: 'No trained model loaded — running on the analytic prior.' };
  }

  const o = Object.assign({ samples: 400, opportunityRate: 0.06, seed: 20260908 }, opts || {});
  const tds = aNum(profile.taxPaid && profile.taxPaid.tds);

  const withModel = optimiseAdvanceTax(profile, yearKey, features, opts);
  const withPrior = optimiseAdvanceTax(profile, yearKey, features,
    Object.assign({}, opts || {}, { forcePrior: true }));

  /*
   * SCORING THE TWO PLANS FAIRLY — AND WHY THE OBVIOUS WAY IS WRONG.
   *
   * The tempting comparison is each plan's expected cost as its own
   * `optimise` call reported it. That is meaningless, because each was scored
   * against its OWN forecast. A model that is confidently wrong scores itself
   * well; that is the classic way to flatter a model in evaluation. Measured
   * that way the trained model appeared to LOSE money on three of the four
   * sample taxpayers, which was an artefact of the yardstick rather than
   * anything about the model.
   *
   * So both plans are re-scored against BOTH liability distributions. If the
   * trained model's plan is cheaper under both, that means something. If it
   * wins only under its own forecast, the honest answer is that the app cannot
   * tell, and `verdict` says exactly that instead of printing a number.
   *
   * What actually settles it is ml/value_of_model.py, which scores both plans
   * against REALISED outcomes on held-out data — income that actually
   * happened, rather than either model's opinion about what might.
   */
  const feat = Object.assign(
    { currentIncome: totalIncomeOf(profile), employmentType: profile.employmentType || 'salaried',
      city: profile.city, age: 35, variableShare: 0 },
    features || {}
  );
  const modelWorld = liabilitySamples(profile, yearKey,
    Forecast.predict(feat, { forcePrior: false }), o.samples, o.seed).liabilities;
  const priorWorld = liabilitySamples(profile, yearKey,
    Forecast.predict(feat, { forcePrior: true }), o.samples, o.seed).liabilities;

  const totalOf = (r) => r.optimal.payments.reduce((s, p) => s + p.amount, 0);
  const planModel = scheduleForTotal(totalOf(withModel));
  const planPrior = scheduleForTotal(totalOf(withPrior));

  const costOpts = { opportunityRate: o.opportunityRate };
  const underModel = {
    model: expectedCost(planModel, modelWorld, tds, costOpts),
    prior: expectedCost(planPrior, modelWorld, tds, costOpts),
  };
  const underPrior = {
    model: expectedCost(planModel, priorWorld, tds, costOpts),
    prior: expectedCost(planPrior, priorWorld, tds, costOpts),
  };

  const winsUnderModel = underModel.model <= underModel.prior;
  const winsUnderPrior = underPrior.model <= underPrior.prior;

  return {
    available: true,
    thetaWithModel: withModel.optimal.theta,
    thetaWithPrior: withPrior.optimal.theta,
    /** Each plan scored in each world, so the yardstick is always explicit. */
    scored: {
      underTrainedForecast: {
        modelPlan: Math.round(underModel.model), priorPlan: Math.round(underModel.prior),
      },
      underPriorForecast: {
        modelPlan: Math.round(underPrior.model), priorPlan: Math.round(underPrior.prior),
      },
    },
    winsUnderModel,
    winsUnderPrior,
    verdict: (winsUnderModel && winsUnderPrior)
      ? "The trained model's plan is cheaper under both forecasts."
      : (!winsUnderModel && !winsUnderPrior)
        ? "The trained model's plan is not cheaper under either forecast for this taxpayer."
        : 'Inconclusive from inside the app — the two forecasts disagree about which ' +
          'plan is better. ml/value_of_model.py settles it against realised outcomes.',
    note: 'ml/train_forecaster.py reports the underlying pinball-loss improvement.',
  };
}

/* ---------------------------------------------------------------------------
 * Plain global, plus a CommonJS tail for the Node tests.
 * ------------------------------------------------------------------------ */
const AdvanceTax = {
  optimise: optimiseAdvanceTax,
  valueOfModel,
  liabilitySamples,
  scheduleForTarget,
  scheduleForTotal,
  expectedCost,
  criticalRatio,
  empiricalQuantile,
  profileAtIncome,
  salaryTotal,
  totalIncomeOf,
};

if (typeof window !== 'undefined') window.AdvanceTax = AdvanceTax;
if (typeof module !== 'undefined' && module.exports) module.exports = AdvanceTax;
