/* ============================================================================
 * interest.js — THE PRICE OF GETTING ADVANCE TAX WRONG
 * ----------------------------------------------------------------------------
 * Sections 234B, 234C and 244A, implemented as a cost function.
 *
 * Every other tax tool treats advance tax as arithmetic: take the liability,
 * split it 15 / 45 / 75 / 100, print four dates. That is only correct for a
 * taxpayer who already knows what they will earn. Nobody does on 15 June.
 *
 * The whole point of this file is that the cost of being wrong is ASYMMETRIC:
 *
 *   pay too little -> 1% per month, charged across four deadlines (234C),
 *                     plus 1% per month from 1 April of the assessment year
 *                     if you end the year under 90% (234B)
 *   pay too much   -> the department returns it with 0.5% per month (244A),
 *                     which is less than the money would have earned for you
 *
 * Underpaying costs roughly twice what overpaying costs. That asymmetry is
 * exactly what makes the optimal instalment a QUANTILE of your income
 * distribution rather than its mean — see advancetax.js, which minimises the
 * `planCost` defined at the bottom of this file.
 *
 * DETAILS MOST TOOLS MISS, IMPLEMENTED HERE:
 *   - Rule 119A: the amount interest is charged on is rounded DOWN to the
 *     nearest Rs.100, and any part of a month counts as a whole month.
 *   - The 234C safe harbours: pay 12% by 15 June (not 15%) or 36% by
 *     15 September (not 45%) and that instalment's interest is waived
 *     entirely. A cliff, not a slope.
 *   - The fourth proviso to 234C: a shortfall caused by capital gains, lottery
 *     winnings, dividend, or first-time business income is FORGIVEN, provided
 *     the tax on it is paid in the remaining instalments. This is what makes
 *     the problem a multistage one with recourse rather than a single bet.
 * ========================================================================== */

/* ---------- helpers ------------------------------------------------------ */

const iNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Rule 119A(a): interest is computed on the shortfall rounded DOWN to a
 * multiple of Rs.100. A Rs.99 shortfall attracts no interest at all.
 */
function roundDown100(amount) {
  return Math.floor(iNum(amount) / 100) * 100;
}

/** Rule 119A(b): a part of a month is treated as a full month. */
function wholeMonths(months) {
  return Math.ceil(Math.max(0, months));
}

/* ============================================================================
 * SECTION 234C — interest for DEFERMENT of advance tax
 * ==========================================================================*/

/**
 * The four deadlines. `threshold` is what you are supposed to have paid by
 * that date as a fraction of assessed tax; `safeHarbour` is the lower figure
 * that still escapes interest entirely (first two instalments only);
 * `months` is the period interest runs for.
 */
const SCHEDULE_234C = [
  { by: '15 June',      threshold: 0.15, safeHarbour: 0.12, months: 3 },
  { by: '15 September', threshold: 0.45, safeHarbour: 0.36, months: 3 },
  { by: '15 December',  threshold: 0.75, safeHarbour: null, months: 3 },
  { by: '15 March',     threshold: 1.00, safeHarbour: null, months: 1 },
];

const RATE_234BC = 0.01;  // 1% per month — s.234B and s.234C
const RATE_244A  = 0.005; // 0.5% per month — s.244A

/**
 * Interest under s.234C.
 *
 * @param payments      four numbers — the amount paid ON each due date
 *                      (not cumulative; this function accumulates them).
 * @param assessedTax   total tax liability LESS TDS/TCS and reliefs. The Act
 *                      calls this "tax due on the returned income".
 * @param opts.shielded tax attributable to capital gains / lottery / dividend
 *                      / first-time business income, per instalment. A
 *                      shortfall up to this amount is forgiven under the
 *                      fourth proviso, provided it is made good later.
 */
function sec234C(payments, assessedTax, opts) {
  const o = opts || {};
  const shielded = o.shielded || [0, 0, 0, 0];
  const assessed = iNum(assessedTax);
  const rows = [];
  let cumulative = 0;
  let total = 0;

  for (let i = 0; i < SCHEDULE_234C.length; i++) {
    const step = SCHEDULE_234C[i];
    cumulative += iNum(payments[i]);

    const required = assessed * step.threshold;
    const harbour = step.safeHarbour === null ? required : assessed * step.safeHarbour;

    // Clearing the safe harbour waives the whole instalment's interest.
    if (cumulative >= harbour) {
      rows.push({
        by: step.by,
        required,
        paid: cumulative,
        shortfall: 0,
        forgiven: 0,
        interest: 0,
        waived: cumulative < required
          ? 'Cleared the ' + (step.safeHarbour * 100).toFixed(0) + '% safe harbour'
          : null,
      });
      continue;
    }

    let shortfall = required - cumulative;

    // Fourth proviso: the part of the shortfall caused by income you could not
    // have foreseen is not charged, so long as it is paid up later.
    const forgiven = Math.min(shortfall, iNum(shielded[i]));
    shortfall -= forgiven;

    const base = roundDown100(shortfall);
    const interest = base * RATE_234BC * step.months;
    total += interest;

    rows.push({
      by: step.by,
      required,
      paid: cumulative,
      shortfall,
      forgiven,
      base,
      months: step.months,
      interest,
      waived: null,
    });
  }

  return { total: Math.round(total), rows };
}

/* ============================================================================
 * SECTION 234B — interest for DEFAULT in payment of advance tax
 * ==========================================================================*/

/**
 * Charged when advance tax paid across the whole year comes to less than 90%
 * of assessed tax. Note the cliff: 89% triggers interest on the ENTIRE
 * shortfall to 100%, not on the 1% you missed by.
 *
 * @param monthsToSettlement months from 1 April of the assessment year to the
 *                           date the return is filed / the tax determined.
 */
function sec234B(totalAdvancePaid, assessedTax, monthsToSettlement) {
  const assessed = iNum(assessedTax);
  const paid = iNum(totalAdvancePaid);
  const months = wholeMonths(monthsToSettlement);

  if (assessed <= 0 || paid >= assessed * 0.9) {
    return {
      total: 0,
      applies: false,
      paid,
      assessed,
      reason: assessed <= 0
        ? 'No tax payable.'
        : 'At least 90% of the liability was paid in advance.',
    };
  }

  const base = roundDown100(assessed - paid);
  return {
    total: Math.round(base * RATE_234BC * months),
    applies: true,
    paid,
    assessed,
    base,
    months,
    reason: 'Advance tax paid was ' + ((paid / assessed) * 100).toFixed(1) +
            '% of the liability, below the 90% floor.',
  };
}

/* ============================================================================
 * SECTION 244A — interest the department pays YOU on a refund
 * ==========================================================================*/

/**
 * 0.5% per month on excess tax paid — half the rate charged for underpaying,
 * and nothing at all if the refund is under 10% of the tax determined.
 */
function sec244A(excessPaid, assessedTax, monthsToRefund) {
  const excess = iNum(excessPaid);
  const assessed = iNum(assessedTax);
  if (excess <= 0) return { total: 0, applies: false };
  if (assessed > 0 && excess < assessed * 0.10) {
    return {
      total: 0,
      applies: false,
      reason: 's.244A(1) proviso — a refund below 10% of the tax determined carries no interest.',
    };
  }
  const months = wholeMonths(monthsToRefund);
  return { total: Math.round(roundDown100(excess) * RATE_244A * months), applies: true, months };
}

/* ============================================================================
 * THE COST FUNCTION
 * ==========================================================================*/

/**
 * How long each instalment's money is tied up, measured to a 31 July filing
 * in the assessment year. Paying on 15 June means parting with the money
 * about 13.5 months before it is finally reckoned.
 */
const MONTHS_TO_SETTLEMENT = [13.5, 10.5, 7.5, 4.5];

/**
 * THE OBJECTIVE that the advance tax optimiser minimises.
 *
 * Given a payment schedule and the liability that ACTUALLY materialised, what
 * did that schedule cost? Three components:
 *
 *   penalty   234C + 234B — the price of paying too little
 *   carry     the return you gave up by handing money over early
 *   credit    244A interest — the department's partial compensation
 *
 * `carry` minus `credit` is the price of paying too much. Because 244A pays
 * 0.5%/month against a penalty of 1%/month, the two sides are not symmetric,
 * and so the minimiser of the expectation is not the mean.
 *
 * @param opportunityRate annual return the taxpayer could otherwise earn on
 *                        the money — 6% by default, roughly a liquid fund.
 */
function planCost(payments, actualLiability, tds, opts) {
  const o = opts || {};
  const opportunityRate = o.opportunityRate === undefined ? 0.06 : o.opportunityRate;
  const settlementMonths = o.settlementMonths === undefined ? 4 : o.settlementMonths;

  const assessed = Math.max(0, iNum(actualLiability) - iNum(tds));
  const paid = payments.reduce((s, p) => s + iNum(p), 0);

  const c234C = sec234C(payments, assessed, o);
  const c234B = sec234B(paid, assessed, settlementMonths);

  // Money handed over early cannot be earning elsewhere.
  let carry = 0;
  for (let i = 0; i < payments.length; i++) {
    carry += iNum(payments[i]) * opportunityRate * (MONTHS_TO_SETTLEMENT[i] / 12);
  }

  const excess = Math.max(0, paid - assessed);
  const credit = sec244A(excess, assessed, settlementMonths);

  const penalty = c234C.total + c234B.total;
  const net = penalty + carry - credit.total;

  return {
    assessed,
    paid,
    penalty,
    interest234C: c234C,
    interest234B: c234B,
    carry: Math.round(carry),
    credit: credit.total,
    net: Math.round(net),
  };
}

/* ---------------------------------------------------------------------------
 * Expose as a plain global — no bundler needed, same as every other module.
 * The `module.exports` tail lets the Node test suite require this file
 * directly without a build step.
 * ------------------------------------------------------------------------ */
const InterestRules = {
  sec234C,
  sec234B,
  sec244A,
  planCost,
  roundDown100,
  wholeMonths,
  SCHEDULE_234C,
  MONTHS_TO_SETTLEMENT,
  RATE_234BC,
  RATE_244A,
};

if (typeof window !== 'undefined') window.InterestRules = InterestRules;
if (typeof module !== 'undefined' && module.exports) module.exports = InterestRules;
