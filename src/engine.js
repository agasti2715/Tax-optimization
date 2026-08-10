/* ============================================================================
 * engine.js — THE DETERMINISTIC TAX COMPUTATION ENGINE
 * ----------------------------------------------------------------------------
 * This file turns a taxpayer profile into a tax liability, under BOTH regimes,
 * following the head-wise scheme of the Income-tax Act:
 *
 *   Step 1  Compute income under each of the 5 heads
 *   Step 2  Set off losses  (s.70, s.71, s.71B)
 *   Step 3  Gross Total Income
 *   Step 4  Chapter VI-A deductions (80C .. 80U)
 *   Step 5  Total Income  (rounded to nearest Rs.10 — s.288A)
 *   Step 6  Tax on slab income + tax on special-rate capital gains
 *   Step 7  Rebate u/s 87A (with marginal relief)
 *   Step 8  Surcharge (with marginal relief, 15% cap on capital gains)
 *   Step 9  Health & Education Cess @ 4%
 *   Step 10 Less TDS / advance tax -> refund or balance payable
 *
 * DESIGN NOTE FOR THE VIVA:
 *   No language model computes any number here. An LLM that guesses tax
 *   arithmetic is a liability. The maths is deterministic and auditable; the
 *   AI layer only explains what this engine decided. Every step appends to a
 *   `trace` array, which the UI renders as the agent's visible reasoning.
 * ========================================================================== */

/* ---------- small helpers ------------------------------------------------ */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const round10 = (v) => Math.round(v / 10) * 10; // s.288A rounding

/** Progressive slab tax. */
function slabTax(income, slabs) {
  let tax = 0;
  let prev = 0;
  for (const s of slabs) {
    if (income <= prev) break;
    tax += (Math.min(income, s.upto) - prev) * s.rate;
    prev = s.upto;
  }
  return tax;
}

/** The basic exemption limit = top of the first nil-rate slab. */
function basicExemption(slabs) {
  const nil = slabs.find((s) => s.rate === 0);
  return nil ? nil.upto : 0;
}

/* ---------- head 1: SALARY ----------------------------------------------- */

/**
 * HRA exemption u/s 10(13A) — least of three amounts.
 * "Salary" for this purpose means basic + dearness allowance only.
 */
function hraExemption(profile, limits) {
  const s = profile.salary;
  const salaryBase = num(s.basic) + num(s.da);
  const hra = num(s.hraReceived);
  const rent = num(profile.rent.paidAnnual);
  if (hra <= 0 || rent <= 0 || salaryBase <= 0) return { amount: 0, workings: [] };

  const rate = profile.city === 'metro' ? limits.hraMetroRate : limits.hraNonMetroRate;
  const options = [
    { label: 'Actual HRA received', value: hra },
    { label: 'Rent paid minus 10% of (basic + DA)', value: Math.max(0, rent - 0.1 * salaryBase) },
    {
      label: `${rate * 100}% of (basic + DA) — ${profile.city === 'metro' ? 'metro' : 'non-metro'} city`,
      value: rate * salaryBase,
    },
  ];
  const amount = Math.max(0, Math.min(...options.map((o) => o.value)));
  return { amount, workings: options };
}

function salaryHead(profile, regime, cfg, limits, trace) {
  const s = profile.salary;
  const gross =
    num(s.basic) + num(s.da) + num(s.hraReceived) + num(s.otherAllowances) + num(s.employerNps);
  if (gross <= 0) return { gross: 0, income: 0, hra: { amount: 0, workings: [] } };

  // Employer's NPS contribution is taxable salary first, then deducted u/s 80CCD(2).
  let exempt = 0;
  const hra = hraExemption(profile, limits);

  if (regime === 'old') {
    exempt = hra.amount + num(s.exemptAllowances);
    if (hra.amount > 0) {
      trace.push({
        step: 'HRA exemption u/s 10(13A)',
        detail: 'Least of the three statutory options',
        amount: -hra.amount,
      });
    }
  } else {
    // New regime: HRA and LTA exemptions are withdrawn.
    trace.push({
      step: 'HRA / LTA exemption',
      detail: 'Not available under the new regime u/s 115BAC',
      amount: 0,
    });
  }

  const afterExempt = Math.max(0, gross - exempt);
  const std = Math.min(cfg.standardDeduction, afterExempt);
  // Professional tax is capped by the regime card (s.16(iii)), not by `limits`.
  const pt = regime === 'old' ? Math.min(num(s.professionalTax), cfg.professionalTaxCap || 0) : 0;

  trace.push({
    step: 'Standard deduction u/s 16(ia)',
    detail: regime === 'new' ? 'Rs.75,000 under the new regime' : 'Rs.50,000 under the old regime',
    amount: -std,
  });
  if (pt > 0) trace.push({ step: 'Professional tax u/s 16(iii)', detail: 'State tax actually paid', amount: -pt });

  return { gross, income: Math.max(0, afterExempt - std - pt), hra, standardDeduction: std, professionalTax: pt };
}

/* ---------- head 2: HOUSE PROPERTY --------------------------------------- */

function housePropertyHead(profile, regime, limits, trace) {
  const h = profile.house;
  const result = { income: 0, setOff: 0, carriedForward: 0, interestAllowed: 0 };
  if (!h || h.status === 'none') return result;

  if (h.status === 'selfOccupied') {
    // Annual value of a self-occupied house is NIL. Only interest creates a loss.
    if (regime === 'new') {
      trace.push({
        step: 'Home loan interest u/s 24(b)',
        detail: 'Self-occupied property interest is NOT deductible under the new regime',
        amount: 0,
      });
      return result;
    }
    const allowed = Math.min(num(h.loanInterest), limits.homeLoanInterestSelfOccupied);
    result.interestAllowed = allowed;
    result.income = -allowed;
    result.setOff = -allowed;
    trace.push({
      step: 'Home loan interest u/s 24(b)',
      detail: `Self-occupied house, capped at Rs.${limits.homeLoanInterestSelfOccupied.toLocaleString('en-IN')}`,
      amount: -allowed,
    });
    return result;
  }

  // Let-out property
  const gav = num(h.rentReceived);
  const nav = Math.max(0, gav - num(h.municipalTax));
  const stdDed = nav * 0.3; // s.24(a) — flat 30%, no proof required
  const interest = num(h.loanInterest);
  result.interestAllowed = interest;
  const net = nav - stdDed - interest;

  trace.push({
    step: 'Let-out property',
    detail: `Rent ${gav.toLocaleString('en-IN')} less municipal tax, less 30% standard deduction u/s 24(a), less interest u/s 24(b)`,
    amount: net,
  });

  if (net >= 0) {
    result.income = net;
    return result;
  }

  // It is a loss. How much can be set off against other heads?
  const loss = -net;
  if (regime === 'new') {
    // s.115BAC — house property loss cannot be set off against any other head.
    result.income = 0;
    result.carriedForward = loss;
    trace.push({
      step: 'House property loss',
      detail: 'New regime: cannot be set off against salary. Carried forward for 8 years.',
      amount: 0,
    });
  } else {
    const allowed = Math.min(loss, limits.housePropertyLossSetOff);
    result.income = -allowed;
    result.setOff = -allowed;
    result.carriedForward = loss - allowed;
    trace.push({
      step: 'House property loss set-off u/s 71(3A)',
      detail: `Capped at Rs.${limits.housePropertyLossSetOff.toLocaleString('en-IN')} per year`,
      amount: -allowed,
    });
  }
  return result;
}

/* ---------- head 5: OTHER SOURCES ---------------------------------------- */

function otherSourcesHead(profile, cfg, trace) {
  const o = profile.other || {};
  let total = num(o.savingsInterest) + num(o.fdInterest) + num(o.dividend) + num(o.misc);

  const fp = num(o.familyPension);
  if (fp > 0) {
    // s.57(iia) — least of one-third of the pension or the statutory cap.
    const ded = Math.min(fp / 3, cfg.familyPensionDeduction);
    total += fp - ded;
    trace.push({ step: 'Family pension deduction u/s 57(iia)', detail: 'One-third of pension or the cap, whichever is lower', amount: -ded });
  }
  return total;
}

/* ---------- Chapter VI-A -------------------------------------------------- */

function chapterVIA(profile, regime, limits, grossTotalNormal, trace) {
  const d = profile.deductions || {};
  const s = profile.salary || {};
  const items = [];
  const push = (section, label, amount, note) => {
    if (amount > 0) items.push({ section, label, amount: Math.round(amount), note });
  };

  // --- 80CCD(2): employer NPS. The ONLY big deduction alive in both regimes.
  const salaryBase = num(s.basic) + num(s.da);
  const nps2Cap = salaryBase * limits.sec80CCD2_private;
  const nps2 = Math.min(num(s.employerNps), nps2Cap);
  push('80CCD(2)', "Employer's contribution to NPS", nps2, `Capped at 14% of basic + DA = Rs.${Math.round(nps2Cap).toLocaleString('en-IN')}`);

  if (regime === 'new') {
    // Everything else is switched off under s.115BAC.
    if (nps2 > 0) trace.push({ step: 'Chapter VI-A (new regime)', detail: 'Only 80CCD(2) survives', amount: -nps2 });
    else trace.push({ step: 'Chapter VI-A (new regime)', detail: 'No deductions claimed — 80C, 80D etc. are not available', amount: 0 });
    const total = Math.min(nps2, grossTotalNormal);
    return { items, total: Math.round(total) };
  }

  /* ---------------- OLD REGIME: the full deduction menu ---------------- */

  // 80C — combined ceiling of Rs.1.5 lakh with 80CCC and 80CCD(1) per s.80CCE.
  const raw80C = num(d.sec80C) + num(d.epfEmployee) + num(profile.house && profile.house.principalRepaid);
  const c80 = Math.min(raw80C, limits.sec80C);
  push('80C', 'Life insurance, PPF, ELSS, EPF, tuition fees, home loan principal', c80,
    raw80C > limits.sec80C ? `Rs.${(raw80C - limits.sec80C).toLocaleString('en-IN')} wasted above the ceiling` : undefined);

  // 80CCD(1B) — the extra Rs.50,000 for NPS, over and above 80C.
  push('80CCD(1B)', 'Additional NPS contribution', Math.min(num(d.sec80CCD1B), limits.sec80CCD1B));

  // 80D — health insurance, two separate buckets.
  const selfCap = profile.ageBand === 'below60' ? limits.sec80D_self : limits.sec80D_selfSenior;
  const parentCap = d.parentsAreSenior ? limits.sec80D_parentsSenior : limits.sec80D_parents;
  push('80D', 'Health insurance — self, spouse & children', Math.min(num(d.sec80D_self), selfCap));
  push('80D', 'Health insurance — parents', Math.min(num(d.sec80D_parents), parentCap), d.parentsAreSenior ? 'Senior citizen parents — higher Rs.50,000 limit' : undefined);

  // 80DD / 80U — flat deductions, no expenditure proof needed.
  if (d.sec80DD === 'normal') push('80DD', 'Disabled dependent (40-79%)', limits.sec80DD_normal);
  if (d.sec80DD === 'severe') push('80DD', 'Disabled dependent (80%+)', limits.sec80DD_severe);
  if (d.sec80U === 'normal') push('80U', 'Taxpayer with a disability (40-79%)', limits.sec80U_normal);
  if (d.sec80U === 'severe') push('80U', 'Taxpayer with a disability (80%+)', limits.sec80U_severe);

  // 80DDB — specified diseases.
  const ddbCap = profile.ageBand === 'below60' ? limits.sec80DDB_normal : limits.sec80DDB_senior;
  push('80DDB', 'Treatment of specified diseases', Math.min(num(d.sec80DDB), ddbCap));

  // 80E — education loan interest, no ceiling.
  push('80E', 'Education loan interest', num(d.sec80E), 'No monetary limit, available for 8 years');

  // 80EEB — electric vehicle loan interest.
  push('80EEB', 'Electric vehicle loan interest', Math.min(num(d.sec80EEB), limits.sec80EEB));

  // 80G — donations. (The 10%-of-adjusted-GTI qualifying limit is simplified here.)
  const g100 = num(d.sec80G_100);
  const g50 = num(d.sec80G_50) * 0.5;
  push('80G', 'Donations — 100% deductible funds', g100);
  push('80G', 'Donations — 50% deductible funds', g50, 'Half of the amount donated');

  // 80TTA / 80TTB — interest income.
  const o = profile.other || {};
  if (profile.ageBand === 'below60') {
    push('80TTA', 'Savings bank interest', Math.min(num(o.savingsInterest), limits.sec80TTA));
  } else {
    push('80TTB', 'Interest income — senior citizen', Math.min(num(o.savingsInterest) + num(o.fdInterest), limits.sec80TTB));
  }

  // 80GG — rent paid where NO HRA is received.
  if (num(s.hraReceived) === 0 && num(profile.rent.paidAnnual) > 0) {
    const rent = num(profile.rent.paidAnnual);
    const adjGTI = grossTotalNormal;
    const gg = Math.max(0, Math.min(limits.sec80GG_monthlyCap * 12, 0.25 * adjGTI, rent - 0.1 * adjGTI));
    push('80GG', 'Rent paid without HRA', gg, 'Requires Form 10BA');
  }

  const sum = items.reduce((a, b) => a + b.amount, 0);
  // Chapter VI-A deductions can never exceed gross total income.
  const total = Math.min(sum, grossTotalNormal);
  trace.push({ step: 'Chapter VI-A deductions', detail: `${items.length} deduction(s) claimed`, amount: -total });
  return { items, total: Math.round(total) };
}

/* ---------- capital gains at special rates -------------------------------- */

/**
 * Applies the unused basic exemption against capital gains (proviso to s.111A
 * and s.112A) — highest-taxed gains absorbed first, which is optimal.
 */
function capitalGainsTax(profile, cg, unusedExemption, trace) {
  const c = profile.capitalGains || {};
  let left = unusedExemption;
  const buckets = [];

  const absorb = (amount) => {
    const used = Math.min(amount, left);
    left -= used;
    return { taxable: amount - used, used };
  };

  // 1) STCG on listed equity — s.111A @ 20% (highest special rate, absorb first).
  const stcgEq = num(c.stcgEquity);
  if (stcgEq > 0) {
    const a = absorb(stcgEq);
    buckets.push({ label: 'STCG on listed equity — s.111A', rate: cg.stcg111A, gross: stcgEq, exemptionUsed: a.used, taxable: a.taxable, tax: a.taxable * cg.stcg111A });
  }

  // 2) LTCG on other assets — s.112 @ 12.5%.
  const ltcgOther = num(c.ltcgOther);
  if (ltcgOther > 0) {
    const a = absorb(ltcgOther);
    buckets.push({ label: 'LTCG on other assets — s.112', rate: cg.ltcgOther, gross: ltcgOther, exemptionUsed: a.used, taxable: a.taxable, tax: a.taxable * cg.ltcgOther });
  }

  // 3) LTCG on listed equity — s.112A, first Rs.1.25 lakh is exempt.
  const ltcgEq = num(c.ltcgEquity);
  if (ltcgEq > 0) {
    const afterAnnual = Math.max(0, ltcgEq - cg.ltcg112A.exemption);
    const a = absorb(afterAnnual);
    buckets.push({
      label: 'LTCG on listed equity — s.112A',
      rate: cg.ltcg112A.rate,
      gross: ltcgEq,
      annualExemption: Math.min(ltcgEq, cg.ltcg112A.exemption),
      exemptionUsed: a.used,
      taxable: a.taxable,
      tax: a.taxable * cg.ltcg112A.rate,
    });
    trace.push({
      step: 'LTCG annual exemption u/s 112A',
      detail: `First Rs.${cg.ltcg112A.exemption.toLocaleString('en-IN')} of equity LTCG is exempt every year`,
      amount: -Math.min(ltcgEq, cg.ltcg112A.exemption),
    });
  }

  const tax = buckets.reduce((a, b) => a + b.tax, 0);
  const totalSpecialIncome = stcgEq + ltcgOther + ltcgEq;
  return { buckets, tax, totalSpecialIncome, exemptionRemaining: left };
}

/* ---------- surcharge with marginal relief -------------------------------- */

function computeSurcharge(totalIncome, normalTax, cgTax, bands, slabs) {
  let rate = 0;
  let threshold = 0;
  for (const b of bands) {
    if (totalIncome > b.above) {
      rate = b.rate;
      threshold = b.above;
    }
  }
  if (rate === 0) return { rate: 0, amount: 0, relief: 0 };

  // Surcharge on capital gains taxed u/s 111A / 112A / 112 is capped at 15%.
  const cgRate = Math.min(rate, 0.15);
  let amount = normalTax * rate + cgTax * cgRate;

  // Marginal relief: the extra tax cannot exceed the extra income above the threshold.
  const baseTax = normalTax + cgTax;
  const taxAtThreshold = slabTax(threshold, slabs);
  const extraIncome = totalIncome - threshold;
  const extraTax = baseTax + amount - taxAtThreshold;
  let relief = 0;
  if (extraTax > extraIncome) {
    const capped = Math.max(0, taxAtThreshold + extraIncome - baseTax);
    relief = amount - capped;
    amount = capped;
  }
  return { rate, amount, relief, cgRate };
}

/* ============================================================================
 * MAIN: compute the liability under one regime
 * ========================================================================== */

function computeRegime(profile, regime, yearKey) {
  const Y = RULEBOOK.years[yearKey];
  const cfg = regime === 'new' ? Y.newRegime : Y.oldRegime;
  const limits = Y.limits;
  const slabs = regime === 'new' ? cfg.slabs : cfg.slabsByAge[profile.ageBand || 'below60'];
  const trace = [];

  /* --- Steps 1 & 2: heads of income and loss set-off --- */
  const salary = salaryHead(profile, regime, cfg, limits, trace);
  const house = housePropertyHead(profile, regime, limits, trace);
  const business = num(profile.business && profile.business.netProfit);
  const other = otherSourcesHead(profile, cfg, trace);
  // Short-term gains on non-equity assets are taxed at slab rates, so they
  // belong with normal income, not with the special-rate buckets.
  const stcgSlab = num(profile.capitalGains && profile.capitalGains.stcgOther);

  const grossTotalNormal = Math.max(0, salary.income + house.income + business + other + stcgSlab);
  trace.push({ step: 'Gross Total Income (excluding special-rate gains)', detail: 'Sum of all heads after loss set-off', amount: grossTotalNormal });

  /* --- Step 4: Chapter VI-A --- */
  const deductions = chapterVIA(profile, regime, limits, grossTotalNormal, trace);

  /* --- Step 5: Total Income --- */
  const normalTaxable = Math.max(0, grossTotalNormal - deductions.total);
  const exemption = basicExemption(slabs);
  const unusedExemption = Math.max(0, exemption - normalTaxable);

  const cg = capitalGainsTax(profile, Y.capitalGains, unusedExemption, trace);
  const totalIncome = round10(normalTaxable + cg.totalSpecialIncome);

  /* --- Step 6: tax --- */
  const normalTax = slabTax(normalTaxable, slabs);
  trace.push({ step: 'Tax on slab income', detail: `${regime === 'new' ? 'New' : 'Old'} regime slab rates applied`, amount: normalTax });
  if (cg.tax > 0) trace.push({ step: 'Tax on capital gains', detail: 'Special rates u/s 111A / 112 / 112A', amount: cg.tax });

  /* --- Step 7: rebate u/s 87A --- */
  // The rebate applies to tax on ordinary income only, not to special-rate gains.
  let rebate = 0;
  let marginalRelief87A = 0;
  let normalTaxAfterRebate = normalTax;
  const r = cfg.rebate87A;
  if (totalIncome <= r.incomeLimit) {
    rebate = Math.min(normalTax, r.maxRebate);
    normalTaxAfterRebate = normalTax - rebate;
    trace.push({ step: 'Rebate u/s 87A', detail: `Total income is within Rs.${r.incomeLimit.toLocaleString('en-IN')}`, amount: -rebate });
  } else if (r.marginalRelief) {
    // Just above the threshold, tax must not exceed the income above it.
    const excess = totalIncome - r.incomeLimit;
    if (normalTaxAfterRebate > excess) {
      marginalRelief87A = normalTaxAfterRebate - excess;
      normalTaxAfterRebate = excess;
      trace.push({ step: 'Marginal relief', detail: `Income just above Rs.${r.incomeLimit.toLocaleString('en-IN')} — tax capped at the excess income`, amount: -marginalRelief87A });
    }
  }

  const taxBeforeSurcharge = normalTaxAfterRebate + cg.tax;

  /* --- Step 8: surcharge --- */
  const sur = computeSurcharge(totalIncome, normalTaxAfterRebate, cg.tax, cfg.surcharge, slabs);
  if (sur.amount > 0) trace.push({ step: `Surcharge @ ${(sur.rate * 100).toFixed(0)}%`, detail: sur.relief > 0 ? 'Marginal relief applied' : 'High income surcharge', amount: sur.amount });

  /* --- Step 9: cess --- */
  const cess = (taxBeforeSurcharge + sur.amount) * cfg.cess;
  trace.push({ step: 'Health & Education Cess @ 4%', detail: 'On tax plus surcharge', amount: cess });

  const totalTax = round10(taxBeforeSurcharge + sur.amount + cess);

  /* --- Step 10: taxes already paid --- */
  const paid = num(profile.taxPaid && profile.taxPaid.tds) + num(profile.taxPaid && profile.taxPaid.advanceTax);
  const balance = round10(totalTax - paid);

  return {
    regime,
    yearKey,
    slabs,
    salary,
    house,
    business,
    otherSources: other,
    stcgSlab,
    grossTotalNormal,
    deductions,
    normalTaxable,
    capitalGains: cg,
    totalIncome,
    normalTax,
    rebate,
    marginalRelief87A,
    surcharge: sur,
    cess,
    totalTax,
    taxPaid: paid,
    balance,
    effectiveRate: totalIncome > 0 ? (totalTax / totalIncome) * 100 : 0,
    trace,
  };
}

/** Run both regimes and pick the cheaper one. */
function compareRegimes(profile, yearKey) {
  const oldR = computeRegime(profile, 'old', yearKey);
  const newR = computeRegime(profile, 'new', yearKey);
  const winner = newR.totalTax <= oldR.totalTax ? 'new' : 'old';
  return {
    old: oldR,
    new: newR,
    winner,
    saving: Math.abs(oldR.totalTax - newR.totalTax),
    best: winner === 'new' ? newR : oldR,
  };
}

/* ---------- advance tax schedule ----------------------------------------- */

function advanceTaxPlan(totalTax, tdsExpected, profile) {
  const cfg = RULEBOOK.advanceTax;
  const net = Math.max(0, totalTax - num(tdsExpected));
  if (net < cfg.threshold) {
    return { required: false, net, reason: `Liability after TDS is below Rs.${cfg.threshold.toLocaleString('en-IN')} — no advance tax is due.` };
  }
  if (profile.ageBand !== 'below60' && num(profile.business && profile.business.netProfit) === 0) {
    return { required: false, net, reason: cfg.seniorExemption };
  }
  return {
    required: true,
    net,
    instalments: cfg.schedule.map((s) => ({ by: s.by, cumulativePct: s.cumulative * 100, amount: round10(net * s.cumulative) })),
  };
}

window.TaxEngine = { computeRegime, compareRegimes, advanceTaxPlan, slabTax, hraExemption, round10 };
