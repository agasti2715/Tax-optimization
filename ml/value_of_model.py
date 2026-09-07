"""
value_of_model.py — WHAT IS THE TRAINED FORECASTER WORTH, IN RUPEES?

===============================================================================
WHY THIS CANNOT BE ANSWERED INSIDE THE APP
===============================================================================
AdvanceTax.valueOfModel() in the browser can compare two payment plans, but it
can only score them against a FORECAST — and the forecast is the thing under
test. Scoring a model against its own predictions is circular: a confidently
wrong model marks its own homework and passes.

The first attempt did exactly that, scoring each plan against its own forecast,
and reported the trained model LOSING money on three of four sample taxpayers.
That number was an artefact of the yardstick, not a property of the model.

Here there is no such problem. The held-out rows carry `target_logGrowth` — the
income that ACTUALLY happened. So both plans can be scored against reality:

    1. take a held-out taxpayer-year
    2. build a payment plan from the PRIOR's forecast
    3. build a payment plan from the TRAINED model's forecast
    4. reveal the realised income, compute the true liability
    5. charge both plans the real s.234B / s.234C / s.244A consequences
    6. average over thousands of taxpayer-years

The difference is the rupee value of the forecaster. It is the only version of
this number that means anything.

===============================================================================
TWO SIMPLIFICATIONS, STATED PLAINLY
===============================================================================
1. LIABILITY. Tax is computed under the NEW regime slab schedule only, with the
   87A rebate and cess — not the full engine in src/engine.js. Both plans face
   the identical function, so the COMPARISON is unaffected; only the absolute
   rupee scale is approximate.

2. THE DECISION RULE IS NOT HELD FIXED, AND THAT TURNED OUT TO MATTER A LOT.

   The first version of this script paid at the same percentile (~0.68) from
   both forecasts, on the reasoning that holding the rule constant isolates
   the value of the forecast. It reported the trained model LOSING Rs.986 per
   taxpayer-year, and winning only 44% of decided cases.

   That reasoning was wrong, and the error is instructive. The optimal
   percentile depends on the SPREAD of the distribution it is drawn from, so
   forcing a differently-calibrated forecast onto another one's operating
   point handicaps it. Letting each side choose its own theta on a calibration
   half — and judging both on rows neither was tuned on — reverses the result,
   and shows the mechanism:

       prior          pays at the 72nd percentile
       trained model  pays at the 52nd percentile

   The prior cannot represent the AR(1) persistence or the job-change jumps in
   the population, so it understates the spread and has to systematically
   OVER-pay to buy the same protection against a shortfall. The
   better-calibrated model gets that protection at the median.

   That is how the forecaster actually saves money, and a fixed-theta
   comparison hides it completely while looking perfectly reasonable.

Usage:
    python ml/value_of_model.py
"""

import argparse
import json
import math
import os

import numpy as np
from sklearn.model_selection import train_test_split

from train_forecaster import FEATURES, QUANTILES, load, prior_quantiles
from verify_export import score_all

SEED = 20260908

# The newsvendor critical ratio measured in test/verify_interest.js: underpaying
# costs roughly twice what overpaying costs, so the optimal instalment sits near
# the 68th percentile rather than the median.
TARGET_PERCENTILE = 0.68


# =============================================================================
# TAX — new regime, FY 2025-26 (see simplification 1 above)
# =============================================================================

SLABS = [(400000, 0.00), (800000, 0.05), (1200000, 0.10),
         (1600000, 0.15), (2000000, 0.20), (2400000, 0.25),
         (float("inf"), 0.30)]


def tax_new_regime(income):
    """Slab tax, 87A rebate with marginal relief, then 4% cess."""
    income = max(0.0, income)
    tax, lower = 0.0, 0.0
    for upto, rate in SLABS:
        if income > lower:
            tax += (min(income, upto) - lower) * rate
            lower = upto
        else:
            break

    # s.87A: full rebate up to Rs.12 lakh, then marginal relief just above it.
    if income <= 1200000:
        tax = max(0.0, tax - 60000)
    else:
        excess = income - 1200000
        if tax > excess:
            tax = excess

    return round((tax * 1.04) / 10) * 10


# =============================================================================
# THE STATUTORY COST OF A PLAN — mirrors src/interest.js
# =============================================================================

SCHEDULE = [(0.15, 0.12, 3), (0.45, 0.36, 3), (0.75, None, 3), (1.00, None, 1)]
MONTHS_TO_SETTLEMENT = [13.5, 10.5, 7.5, 4.5]


def round_down_100(x):
    return math.floor(max(0.0, x) / 100) * 100


def plan_cost(payments, assessed, opportunity_rate=0.06, settlement_months=4):
    """Total cost of a payment schedule once the true liability is known."""
    penalty = 0.0
    cumulative = 0.0
    for i, (threshold, harbour, months) in enumerate(SCHEDULE):
        cumulative += payments[i]
        required = assessed * threshold
        floor = required if harbour is None else assessed * harbour
        if cumulative >= floor:
            continue
        penalty += round_down_100(required - cumulative) * 0.01 * months

    paid = sum(payments)
    if assessed > 0 and paid < assessed * 0.9:
        penalty += round_down_100(assessed - paid) * 0.01 * settlement_months

    carry = sum(p * opportunity_rate * (m / 12)
                for p, m in zip(payments, MONTHS_TO_SETTLEMENT))

    excess = max(0.0, paid - assessed)
    credit = (round_down_100(excess) * 0.005 * settlement_months
              if assessed > 0 and excess >= assessed * 0.10 else 0.0)

    return penalty + carry - credit


def schedule_for(total):
    total = max(0.0, total)
    cum = [total * f for f in (0.15, 0.45, 0.75, 1.0)]
    return [cum[0], cum[1] - cum[0], cum[2] - cum[1], cum[3] - cum[2]]


def interp_quantile(grid, levels, p):
    """The same linear interpolation over fitted quantiles that forecast.js does."""
    if p <= grid[0]:
        return levels[0]
    if p >= grid[-1]:
        return levels[-1]
    for i in range(len(grid) - 1):
        if grid[i] <= p <= grid[i + 1]:
            w = (p - grid[i]) / (grid[i + 1] - grid[i])
            return levels[i] + w * (levels[i + 1] - levels[i])
    return levels[-1]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artefact", default=os.path.join("models", "forecaster.json"))
    ap.add_argument("--data", default=os.path.join("ml", "data", "population.csv"))
    ap.add_argument("--rows", type=int, default=8000)
    args = ap.parse_args()

    with open(args.artefact) as fh:
        artefact = json.load(fh)

    X, y = load(args.data)
    _, Xte, _, yte = train_test_split(X, y, test_size=0.25, random_state=SEED)
    n = min(args.rows, len(yte))
    Xte, yte = Xte[:n], yte[:n]

    print("Scoring {:,} held-out taxpayer-years against REALISED income.".format(n))
    print("Each forecast picks its own operating point on a calibration half;")
    print("both are then judged on rows neither was tuned on.\n")

    idx = {f: i for i, f in enumerate(FEATURES)}
    model_growth = np.sort(score_all(artefact, Xte), axis=1)
    prior_growth = np.sort(prior_quantiles(Xte), axis=1)

    def cost_at(rows, growth, grid, theta):
        """Average realised cost of paying at percentile `theta` on these rows."""
        total = 0.0
        for r in rows:
            income_now = math.exp(Xte[r, idx["logIncome"]])
            assessed = tax_new_regime(income_now * math.exp(yte[r]))
            predicted = income_now * math.exp(interp_quantile(grid, growth[r], theta))
            total += plan_cost(schedule_for(tax_new_regime(predicted)), assessed)
        return total / len(rows)

    # ---- each forecast picks its own operating point --------------------
    #
    # Holding theta fixed at 0.68 for both sides handicaps whichever forecast
    # is differently calibrated: the optimal percentile depends on the spread
    # of the distribution it is drawn from, so a better-calibrated model
    # forced onto someone else's operating point can easily look worse.
    #
    # So each forecast is allowed to choose its own theta on a CALIBRATION
    # half, and both are then judged on the untouched EVALUATION half. Picking
    # theta on the same rows used to score it would leak, and would flatter
    # both sides equally but meaninglessly.
    half = n // 2
    calib, evalr = list(range(half)), list(range(half, n))

    thetas = [t / 100 for t in range(30, 96, 2)]
    best_model_theta = min(thetas, key=lambda t: cost_at(calib, model_growth, artefact["quantiles"], t))
    best_prior_theta = min(thetas, key=lambda t: cost_at(calib, prior_growth, QUANTILES, t))

    print("  operating point chosen on the calibration half:")
    print("    prior          -> pay at the {:.0f}th percentile".format(best_prior_theta * 100))
    print("    trained model  -> pay at the {:.0f}th percentile".format(best_model_theta * 100))
    print()

    avg_model = cost_at(evalr, model_growth, artefact["quantiles"], best_model_theta)
    avg_prior = cost_at(evalr, prior_growth, QUANTILES, best_prior_theta)
    saving = avg_prior - avg_model

    # Per-case tally on the evaluation half, at each side's own theta.
    model_better = 0
    ties = 0
    for r in evalr:
        income_now = math.exp(Xte[r, idx["logIncome"]])
        assessed = tax_new_regime(income_now * math.exp(yte[r]))
        cm = plan_cost(schedule_for(tax_new_regime(income_now * math.exp(
            interp_quantile(artefact["quantiles"], model_growth[r], best_model_theta)))), assessed)
        cp = plan_cost(schedule_for(tax_new_regime(income_now * math.exp(
            interp_quantile(QUANTILES, prior_growth[r], best_prior_theta)))), assessed)
        if abs(cm - cp) < 1e-9:
            ties += 1
        elif cm < cp:
            model_better += 1
    n = len(evalr)

    print("=" * 70)
    print("AVERAGE STATUTORY COST PER TAXPAYER-YEAR, AGAINST REALISED INCOME")
    print("=" * 70)
    print("  plan from the analytic prior : Rs.{:,.0f}".format(avg_prior))
    print("  plan from the trained model  : Rs.{:,.0f}".format(avg_model))
    print("  difference                   : Rs.{:,.0f}  ({:+.2f}%)".format(
        saving, (saving / avg_prior * 100) if avg_prior else 0.0))
    decisive = n - ties
    print("\n  the trained model's plan was cheaper in {:,} of {:,} non-tied cases"
          " ({:.1f}%)".format(model_better, decisive,
                              (model_better / decisive * 100) if decisive else 0.0))
    print("  ({:,} cases produced identical plans)".format(ties))

    if saving > 0:
        print("\n  -> The forecaster pays for itself. This is the number to quote,")
        print("     because it was measured against income that actually happened.")
    else:
        print("\n  -> The trained model does NOT beat the prior on this measure,")
        print("     despite winning on pinball loss. A better-calibrated forecast")
        print("     is not automatically a cheaper decision: the cost function has")
        print("     plateaus (the safe harbours) where a more accurate percentile")
        print("     changes nothing. Report this rather than the pinball number.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
