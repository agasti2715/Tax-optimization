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

WHAT IS ANCHORED TO REAL DATA, AND WHAT IS NOT. This matters, so it is split
in two.

The income LEVELS are not invented. Every simulated career is rescaled so the
population's income distribution matches the one the Income Tax Department
actually publishes - see ml/calibration.py, which carries the source and the
figures, and ml/validate_population.py, which checks the generated population
against it band by band.

The DYNAMICS cannot be calibrated that way, because the published statistics
are a snapshot rather than a history: they say how many people earn Rs.10-50
lakh, not how a person's income moved from one year to the next. So the
generative process below encodes structural facts about how incomes behave
that are not in dispute — incomes compound rather than add, growth slows with age, changing
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

import calibration

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
    types = list(calibration.EMPLOYMENT_MIX.keys())
    etype = rng.choices(types, weights=[calibration.EMPLOYMENT_MIX[t] for t in types])[0]

    start_age = rng.randint(22, 34)
    metro = 1 if rng.random() < 0.45 else 0

    # How much of this person's pay is variable. Salaried people cluster low;
    # the self-employed are effectively all-variable.
    if etype == "salaried":
        variable_share = min(0.85, max(0.0, rng.gauss(0.22, 0.18)))
    else:
        variable_share = min(1.0, max(0.35, rng.gauss(0.70, 0.20)))

    # ---- STEP 1: simulate the SHAPE of the career -----------------------
    #
    # Started from 1.0 rather than from a rupee figure, because the level is
    # applied afterwards. What this loop produces is the trajectory: the
    # growth, the volatility, the jumps.
    shock = 0.0
    years_since_switch = 0
    path = [1.0]
    switches = [0]

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

        path.append(path[-1] * math.exp(drift + shock + jump))
        switches.append(switched)

    # ---- STEP 2: ANCHOR THE LEVEL TO THE PUBLISHED DISTRIBUTION ---------
    #
    # Draw the income this person should have at MID-career from the CBDT
    # published distribution, then scale the WHOLE path so it lands there.
    #
    # Rescaling after the fact rather than before is the whole trick, and the
    # first attempt got it wrong. That version worked backwards from the drift
    # alone to pick a starting income — but shocks and job-change jumps also
    # accumulate multiplicatively, and jumps are mean-positive, so by
    # mid-career everyone had drifted well above where they were aimed. The
    # generated population came out with 9% of people above Rs.50 lakh against
    # a published 1.4%, and a 24.8% total mismatch.
    #
    # Scaling the finished path fixes that exactly, because the target is hit
    # by construction rather than by prediction. Crucially it costs nothing:
    # multiplying every income by one constant leaves every log-growth
    # increment untouched, and those increments are precisely what the model
    # is trained on. The dynamics are identical; only the level moves.
    #
    # Why mid-career and not year one: the published statistics describe the
    # whole filing population, which is people at every career stage at once.
    # The middle of a simulated career is the closest single point to that
    # mixture. Anchoring at year one would leave the population far richer
    # than the published data, because everyone then grows for another decade
    # on top of an already-representative start.
    mid = years // 2
    target_mid = calibration.sample_income(rng)
    scale = target_mid / path[mid] if path[mid] > 0 else 1.0
    path = [max(MIN_INCOME, v * scale) for v in path]

    # ---- STEP 3: emit one training row per year -------------------------
    rows = []
    for t in range(years):
        income = path[t]
        next_income = path[t + 1]
        prev_income = path[t - 1] if t > 0 else path[0]
        years_since_switch = 0 if switches[t] else years_since_switch + 1

        rows.append({
            "logIncome": math.log(income),
            "age": start_age + t,
            "expYears": t + (start_age - 22),
            "variableShare": round(variable_share, 4),
            "recentGrowth": round(math.log(income / prev_income) if prev_income > 0 else 0.0, 6),
            "yearsSinceSwitch": years_since_switch,
            "isSalaried": 1 if etype == "salaried" else 0,
            "isProfessional": 1 if etype == "professional" else 0,
            "isBusiness": 1 if etype == "business" else 0,
            "isMetro": metro,
            # TARGET: log growth to next year. Modelling growth rather than the
            # level is what lets one model serve every income scale — and it is
            # exactly the quantity the rescaling above leaves untouched.
            "target_logGrowth": round(math.log(next_income / income), 6),
        })
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
