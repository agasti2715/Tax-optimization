"""
generate_population.py — A CALIBRATED SYNTHETIC POPULATION OF TAXPAYERS

===============================================================================
READ THIS BEFORE PRESENTING ANY RESULT THAT COMES OUT OF THIS FILE
===============================================================================
There is no public dataset of individual Indian taxpayers' year-by-year income
histories. There cannot be: it is exactly the kind of data that is protected,
and rightly so. So the forecaster in src/forecast.js is trained on a synthetic
population generated here.

That is a legitimate way to build and test the machinery. It is NOT a licence
to describe the result as a model trained on real taxpayers. The correct
phrasing, everywhere, is "calibrated synthetic population". If someone asks
whether the model would work on real data, the honest answer is: the METHOD
would transfer, the fitted parameters would not, and validating that would need
data we do not have.

What "calibrated" means here is narrow and specific. The generative process
below encodes structural facts about how incomes behave that are not in
dispute — incomes compound rather than add, growth slows with age, changing
employer produces a jump that an annual increment does not, self-employment is
more volatile than salaried employment, and shocks persist rather than being
independent year to year. The MAGNITUDES attached to those facts are assumptions,
and every one of them is a named constant below so it can be argued with rather
than having to be excavated from the code.

===============================================================================
THE GENERATIVE PROCESS
===============================================================================
For each simulated person, income evolves in logs:

    log Y(t+1) = log Y(t) + drift(age, type) + persistent_shock(t) + jump(t)

    drift              expected growth, tapering with age
    persistent_shock   AR(1), so a bad year makes the next year more likely to
                       be bad — this is the feature a plain lognormal walk
                       misses, and the main thing a fitted model can learn that
                       the analytic prior in forecast.js cannot
    jump               a job change or a large client win/loss; rare, and large
                       when it happens, which is what gives the distribution
                       its right skew

Usage:
    python ml/generate_population.py --n 20000 --years 12 --out ml/data/population.csv
"""

import argparse
import csv
import math
import os
import random

# =============================================================================
# CALIBRATION CONSTANTS — assumptions, stated openly so they can be challenged
# =============================================================================

# Starting income at the beginning of a career, by employment type. Lognormal:
# (median rupees, sigma of the log).
START_INCOME = {
    "salaried":     (450000, 0.55),
    "professional": (400000, 0.75),
    "business":     (350000, 0.95),
}

# Expected real+nominal income growth early in a career, before the age taper.
BASE_DRIFT = {
    "salaried":     0.085,
    "professional": 0.075,
    "business":     0.070,
}

# Year-to-year volatility of the growth rate.
BASE_SIGMA = {
    "salaried":     0.13,
    "professional": 0.26,
    "business":     0.33,
}

# Growth slows over a career. Multiplier on drift by age band.
def age_taper(age):
    if age < 25:  return 1.15
    if age < 35:  return 1.10
    if age < 45:  return 1.00
    if age < 55:  return 0.80
    return 0.55

# Shocks persist. An AR(1) coefficient of 0.35 means about a third of this
# year's surprise carries into next year — a good year tends to be followed by
# an above-average one. This is the structure the analytic prior cannot
# represent, and therefore the main thing the trained model has to earn its
# keep on.
SHOCK_PERSISTENCE = 0.35

# Probability of a job change / major client change in a given year, and the
# size of the jump when it happens.
JUMP_PROB = {
    "salaried":     0.14,   # changing employer
    "professional": 0.20,   # winning or losing an anchor client
    "business":     0.22,
}
JUMP_MEAN = 0.16    # a switch is usually a raise...
JUMP_SIGMA = 0.22   # ...but not always, and the spread is wide

# Variable pay (bonus, incentive, RSUs) widens the spread without moving the
# centre. This multiplier is applied to sigma per unit of variable share.
VARIABLE_PAY_AMPLIFIER = 0.9

# A floor, so that a run of bad draws cannot produce a nonsensical income.
MIN_INCOME = 60000


def draw_person(rng, years):
    """Simulate one taxpayer's career and return a list of yearly records."""
    etype = rng.choices(
        ["salaried", "professional", "business"], weights=[0.72, 0.14, 0.14]
    )[0]

    start_age = rng.randint(22, 34)
    metro = 1 if rng.random() < 0.45 else 0

    # How much of this person's pay is variable. Salaried people cluster low;
    # the self-employed are effectively all-variable.
    if etype == "salaried":
        variable_share = min(0.85, max(0.0, rng.gauss(0.22, 0.18)))
    else:
        variable_share = min(1.0, max(0.35, rng.gauss(0.70, 0.20)))

    median, sigma0 = START_INCOME[etype]
    income = median * math.exp(rng.gauss(0, sigma0))

    shock = 0.0
    years_since_switch = 0
    prev_income = income
    rows = []

    for t in range(years):
        age = start_age + t

        drift = BASE_DRIFT[etype] * age_taper(age)
        sigma = BASE_SIGMA[etype] * (1 + VARIABLE_PAY_AMPLIFIER * variable_share)

        # AR(1) shock: partly inherited from last year, partly fresh.
        innovation = rng.gauss(0, sigma * math.sqrt(1 - SHOCK_PERSISTENCE ** 2))
        shock = SHOCK_PERSISTENCE * shock + innovation

        # Occasional discrete jump.
        jump = 0.0
        switched = 0
        if rng.random() < JUMP_PROB[etype]:
            jump = rng.gauss(JUMP_MEAN, JUMP_SIGMA)
            switched = 1

        growth = drift + shock + jump
        next_income = max(MIN_INCOME, income * math.exp(growth))

        recent_growth = math.log(income / prev_income) if prev_income > 0 else 0.0

        # One training row: the state THIS year, and the growth to next year.
        rows.append({
            "logIncome": math.log(income),
            "age": age,
            "expYears": t + (start_age - 22),
            "variableShare": round(variable_share, 4),
            "recentGrowth": round(recent_growth, 6),
            "yearsSinceSwitch": years_since_switch,
            "isSalaried": 1 if etype == "salaried" else 0,
            "isProfessional": 1 if etype == "professional" else 0,
            "isBusiness": 1 if etype == "business" else 0,
            "isMetro": metro,
            # TARGET: log growth to next year. Modelling growth rather than the
            # level is what lets one model serve every income scale.
            "target_logGrowth": round(math.log(next_income / income), 6),
        })

        prev_income = income
        income = next_income
        years_since_switch = 0 if switched else years_since_switch + 1

    return rows


FIELDS = [
    "logIncome", "age", "expYears", "variableShare", "recentGrowth",
    "yearsSinceSwitch", "isSalaried", "isProfessional", "isBusiness", "isMetro",
    "target_logGrowth",
]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=20000, help="number of simulated taxpayers")
    ap.add_argument("--years", type=int, default=12, help="career years per taxpayer")
    ap.add_argument("--seed", type=int, default=20260908)
    ap.add_argument("--out", default=os.path.join("ml", "data", "population.csv"))
    args = ap.parse_args()

    rng = random.Random(args.seed)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    written = 0
    with open(args.out, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        for _ in range(args.n):
            for row in draw_person(rng, args.years):
                writer.writerow(row)
                written += 1

    print("Wrote {:,} rows from {:,} simulated taxpayers to {}".format(
        written, args.n, args.out))
    print()
    print("REMINDER: this is a calibrated synthetic population, not real")
    print("taxpayer data. Any result derived from it must say so.")


if __name__ == "__main__":
    main()
