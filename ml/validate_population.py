"""
validate_population.py — DOES THE SYNTHETIC POPULATION LOOK LIKE THE REAL ONE?

===============================================================================
WHY THIS EXISTS
===============================================================================
ml/generate_population.py claims its income levels are anchored to the
distribution the Income Tax Department publishes. This checks that claim.

It is easy to write a generator that is *intended* to match a target
distribution and quietly does not — a floor applied in the wrong place, a
growth path that drifts everyone up a band, a tail parameter that never
produces anyone above Rs.50 lakh. None of those raise an error. They just
produce a population that is subtly not India, and a model trained on it that
is subtly wrong about who it is advising.

So this script reads the generated file, bins every income the same way CBDT
does, and prints the two distributions side by side.

Usage:
    python ml/generate_population.py --n 40000 --years 14
    python ml/validate_population.py
"""

import argparse
import csv
import math
import os

import calibration


def load_incomes(path, at_year=None):
    """
    Read incomes out of the generated population.

    Each row is one taxpayer-YEAR, so simply taking every row would weight
    long careers more heavily and mix a person's early and late income
    together. The published statistics are a snapshot of one filing year, so
    the fair comparison takes one row per person: the mid-career row, which is
    the point the generator anchors.
    """
    rows = []
    with open(path, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append((float(r["logIncome"]), int(r["expYears"]), int(r["age"])))

    # Rows are written person by person, and expYears increases within a
    # person and drops when the next one starts. That is enough to split them.
    people = []
    current = []
    last_exp = None
    for logInc, exp, age in rows:
        if last_exp is not None and exp <= last_exp:
            people.append(current)
            current = []
        current.append(math.exp(logInc))
        last_exp = exp
    if current:
        people.append(current)

    if at_year is None:
        # Mid-career, matching where the generator anchors.
        return [p[len(p) // 2] for p in people if p], len(people)
    return [p[min(at_year, len(p) - 1)] for p in people if p], len(people)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default=os.path.join("ml", "data", "population.csv"))
    args = ap.parse_args()

    path = args.data
    if not os.path.exists(path):
        path = os.path.join("data", "population.csv")   # when run from ml/
    if not os.path.exists(path):
        print("No population file. Run ml/generate_population.py first.")
        return 1

    incomes, n_people = load_incomes(path)
    rows, deviation = calibration.compare(incomes)

    print(calibration.describe())
    print()
    print("=" * 72)
    print("SYNTHETIC POPULATION vs PUBLISHED DISTRIBUTION")
    print("=" * 72)
    print("  %-22s %10s %10s %10s" % ("Income band", "Published", "Generated", "Diff"))
    print("  " + "-" * 54)
    for r in rows:
        print("  %-22s %9.1f%% %9.1f%% %+9.1f%%" % (
            r["band"], r["published"] * 100, r["synthetic"] * 100, r["diff"] * 100))
    print("  " + "-" * 54)
    print("  %-22s %10s %10s" % ("people", "", "{:,}".format(n_people)))
    print()
    print("  Total mismatch: %.1f%% of the population would have to move band" %
          (deviation * 100))

    if deviation < 0.03:
        print("  -> The generated population matches the published distribution.")
    elif deviation < 0.08:
        print("  -> Close, but drifting. Worth a look at the tail parameters.")
    else:
        print("  -> NOT MATCHING. The anchoring in generate_population.py is not")
        print("     working, and any claim that this data reflects the published")
        print("     distribution should be withdrawn until it is fixed.")

    # A few summary statistics, which are the things a reader will ask about.
    incomes_sorted = sorted(incomes)
    q = lambda p: incomes_sorted[min(len(incomes_sorted) - 1,
                                     int(p * len(incomes_sorted)))]
    print()
    print("  Generated income percentiles (mid-career):")
    for p in (0.10, 0.25, 0.50, 0.75, 0.90, 0.99):
        print("    p%-4s Rs.%s" % (int(p * 100), "{:,.0f}".format(q(p))))

    return 0 if deviation < 0.08 else 1


if __name__ == "__main__":
    raise SystemExit(main())
