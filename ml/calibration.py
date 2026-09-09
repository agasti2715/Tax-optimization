"""
calibration.py — WHERE THE DATA COMES FROM

===============================================================================
THE HONEST POSITION, STATED ONCE AND CLEARLY
===============================================================================
There are two different datasets a project like this might want, and only one
of them exists in public.

  WHAT WE NEED       year-by-year income histories for individual taxpayers,
                     so a model can learn how income moves from one year to
                     the next.
  WHAT EXISTS        aggregate distributions — how many returns were filed in
                     each income band. No individual histories, anywhere.

Individual income histories are protected personal data. No tax authority
publishes them, and no legitimate project has them. So a model that forecasts
income cannot be trained directly on real data, and any project claiming
otherwise should be asked where they got it.

What CAN be done, and what this file does, is calibration. The Income Tax
Department publishes the real income distribution of Indian taxpayers. We
generate a synthetic population and then force its income distribution to
match that published one. The result is synthetic data whose *shape* is
anchored to reality, even though no individual in it is real.

===============================================================================
THE SOURCE
===============================================================================
  Publisher    Central Board of Direct Taxes (CBDT), Department of Revenue,
               Ministry of Finance, Government of India
  Publication  "Income Tax Return Statistics", published annually
  Contains     Income-range-wise count of returns filed, by taxpayer type
  Available    https://www.incometaxindia.gov.in  (Direct Taxes Data section)
  Latest at
  time of use  Assessment Year 2023-24

CBDT has released this data publicly since AY 2012-13 as part of its open-data
commitment, alongside time-series direct tax statistics. It is the
authoritative published description of how income is distributed among Indian
taxpayers.

===============================================================================
A CAVEAT YOU SHOULD READ BEFORE QUOTING THESE NUMBERS
===============================================================================
The band shares below are the widely reported headline figures from the CBDT
return statistics. They are internally consistent — they sum to 100% — and
they are the right order of magnitude, but they were taken from reporting of
the CBDT release rather than read cell-by-cell out of the source PDF.

Before this appears in a submitted report, open the primary PDF at the URL
above and check the four numbers. If they differ, change them HERE, in this
one table, and re-run the pipeline. Everything downstream reads from this
file, so no other code needs touching.

Being able to say "the calibration targets are in one file with the source
next to them" is worth more than any individual figure in it.
"""

# =============================================================================
# THE PUBLISHED DISTRIBUTION
# =============================================================================

SOURCE = {
    "publisher": "Central Board of Direct Taxes (CBDT), Ministry of Finance, "
                 "Government of India",
    "publication": "Income Tax Return Statistics",
    "assessment_year": "AY 2023-24",
    "url": "https://www.incometaxindia.gov.in",
    "accessed": "2026-09",
    "note": "Income-range-wise distribution of returns filed by individual "
            "taxpayers. Aggregate counts only — no individual records are "
            "published, and none are used here.",
}

# Share of individual taxpayers falling in each income band.
# (lower rupees, upper rupees or None for open-ended, share of taxpayers)
INCOME_BANDS = [
    (0,         500000,   0.336),   # up to Rs.5 lakh
    (500000,    1000000,  0.467),   # Rs.5 lakh to Rs.10 lakh
    (1000000,   5000000,  0.183),   # Rs.10 lakh to Rs.50 lakh
    (5000000,   None,     0.014),   # above Rs.50 lakh
]

# A sanity check that runs on import. If someone edits the table above and the
# shares stop summing to one, that is a data-entry error and it should surface
# immediately rather than quietly skewing every population generated after it.
_total = sum(b[2] for b in INCOME_BANDS)
assert abs(_total - 1.0) < 1e-9, (
    "INCOME_BANDS shares must sum to 1.0, got %.6f. Check the table against "
    "the CBDT publication." % _total
)


# =============================================================================
# EMPLOYMENT MIX
# =============================================================================
# Split of individual filers between salaried and non-salaried. CBDT reports
# salary income separately from business and professional income; the split
# below is the approximate shape of that reporting.
#
# This one is a coarser assumption than the income bands and is labelled as
# such. It affects which volatility regime a simulated person gets, not their
# income level, so an error here is less damaging than an error above.
EMPLOYMENT_MIX = {
    "salaried": 0.72,
    "professional": 0.14,
    "business": 0.14,
}

_emp_total = sum(EMPLOYMENT_MIX.values())
assert abs(_emp_total - 1.0) < 1e-9, "EMPLOYMENT_MIX must sum to 1.0"


# =============================================================================
# USING THE TARGETS
# =============================================================================

def sample_band(rng):
    """Pick an income band according to the published shares."""
    r = rng.random()
    cumulative = 0.0
    for lo, hi, share in INCOME_BANDS:
        cumulative += share
        if r <= cumulative:
            return lo, hi
    return INCOME_BANDS[-1][0], INCOME_BANDS[-1][1]


def sample_income(rng):
    """
    Draw one income consistent with the published distribution.

    Within a band the draw is log-uniform rather than uniform, because income
    is multiplicative: between Rs.10 lakh and Rs.50 lakh, a uniform draw would
    put far too much mass near the top of the band. The open-ended top band is
    given a Pareto tail, which is the standard shape for the upper end of an
    income distribution.
    """
    import math

    lo, hi = sample_band(rng)

    if hi is None:
        # Pareto tail above the last threshold. alpha near 2 is the usual
        # empirical range for top incomes; higher alpha means a thinner tail.
        alpha = 2.0
        return lo * (1.0 - rng.random()) ** (-1.0 / alpha)

    lo_eff = max(lo, 50000)   # the lowest band starts at zero; give it a floor
    return math.exp(rng.uniform(math.log(lo_eff), math.log(hi)))


def classify(income):
    """Which published band does an income fall in? Returns the band index."""
    for i, (lo, hi, _) in enumerate(INCOME_BANDS):
        if income >= lo and (hi is None or income < hi):
            return i
    return len(INCOME_BANDS) - 1


def band_label(i):
    lo, hi, _ = INCOME_BANDS[i]
    fmt = lambda v: ("Rs.%.0fL" % (v / 100000)) if v < 10000000 else ("Rs.%.1fCr" % (v / 10000000))
    if hi is None:
        return "above " + fmt(lo)
    if lo == 0:
        return "up to " + fmt(hi)
    return fmt(lo) + " to " + fmt(hi)


def compare(incomes):
    """
    Compare a generated population against the published distribution.

    Returns a list of rows and the total absolute deviation, which is the
    single number worth watching: it is the share of the population that would
    have to move bands for the synthetic distribution to match the published
    one exactly.
    """
    counts = [0] * len(INCOME_BANDS)
    for v in incomes:
        counts[classify(v)] += 1
    n = max(1, len(incomes))

    rows = []
    deviation = 0.0
    for i, (lo, hi, target) in enumerate(INCOME_BANDS):
        actual = counts[i] / n
        deviation += abs(actual - target)
        rows.append({
            "band": band_label(i),
            "published": target,
            "synthetic": actual,
            "diff": actual - target,
            "count": counts[i],
        })
    # Each misplaced person is counted in two bands (one short, one over), so
    # halve the total to get the share that would have to move.
    return rows, deviation / 2.0


def describe():
    """One block of text naming the source, for reports and for the UI."""
    return (
        "Calibrated against {publication} ({assessment_year}), published by "
        "the {publisher}. Source: {url}. {note}"
    ).format(**SOURCE)


if __name__ == "__main__":
    print(describe())
    print()
    print("Published income distribution of individual taxpayers:")
    for i, (lo, hi, share) in enumerate(INCOME_BANDS):
        print("  %-22s %5.1f%%" % (band_label(i), share * 100))
