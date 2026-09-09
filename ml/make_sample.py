"""
make_sample.py - A COMMITTABLE SLICE OF THE DATASET, AND ITS DATA DICTIONARY

===============================================================================
WHY A SAMPLE
===============================================================================
The full population is 640,000 rows and 38 MB. That is fine on disk and
regenerable from a fixed seed, but it is too big to sit comfortably in a git
repository, so .gitignore excludes it.

The problem with excluding it is that anyone opening the repository then has
no idea what the data looks like. So this writes a small sample that IS
committed, alongside a data dictionary explaining every column.

===============================================================================
WHY THE SAMPLE IS DRAWN BY PERSON, NOT BY ROW
===============================================================================
The obvious way to make a sample is to take the first N rows. That would be
wrong here, and quietly so.

Each row is one taxpayer-YEAR, and the rows are written person by person. The
first 10,000 rows are therefore the complete careers of roughly the first 625
people - a tiny, arbitrary group whose income distribution has no reason to
match the calibrated whole. Someone checking the sample against the published
CBDT distribution would find it does not match, and would reasonably conclude
the calibration was broken when in fact only the sampling was.

So this samples whole PEOPLE at random and keeps all of their years. The
sample then carries the same income distribution as the full population, and
the same career dynamics, at a fraction of the size.

Usage:
    python ml/make_sample.py
"""

import argparse
import csv
import math
import os
import random

import calibration

# What every column means. This is the data dictionary, and it is the thing a
# reader of the repository will actually want.
COLUMNS = [
    ("logIncome", "float", "Natural log of this year's total income in rupees. "
     "Logged because income is multiplicative - a 10% rise means the same thing "
     "at 5 lakh and at 50 lakh.", "feature"),
    ("age", "integer", "Age in years during this tax year.", "feature"),
    ("expYears", "integer", "Years of working experience so far.", "feature"),
    ("variableShare", "float 0-1", "Fraction of income that is variable - bonus, "
     "incentive, or fee income rather than fixed salary. The single biggest "
     "driver of how uncertain next year's income is.", "feature"),
    ("recentGrowth", "float", "Log growth from last year to this year. This is "
     "the column that carries the AR(1) shock persistence, and it is the main "
     "thing a trained model can learn that the analytic baseline cannot.", "feature"),
    ("yearsSinceSwitch", "integer", "Years since the last job or major client "
     "change. Resets to 0 in a year a switch happened.", "feature"),
    ("isSalaried", "0 or 1", "Employment type indicator - salaried employee.", "feature"),
    ("isProfessional", "0 or 1", "Employment type indicator - freelancer or "
     "professional filing under s.44ADA.", "feature"),
    ("isBusiness", "0 or 1", "Employment type indicator - business owner.", "feature"),
    ("isMetro", "0 or 1", "Lives in a metro city (Delhi, Mumbai, Kolkata, "
     "Chennai), which changes the HRA exemption rate.", "feature"),
    ("target_logGrowth", "float", "TARGET. Log growth from this year to next "
     "year. Modelling growth rather than the income level is what lets a single "
     "model serve every income scale.", "target"),
]


def read_people(path):
    """
    Group rows back into people.

    Rows are written person by person and expYears increases within a person,
    so a drop in expYears marks the start of the next one.
    """
    people = []
    current = []
    last_exp = None
    with open(path, encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        fields = reader.fieldnames
        for row in reader:
            exp = int(row["expYears"])
            if last_exp is not None and exp <= last_exp:
                people.append(current)
                current = []
            current.append(row)
            last_exp = exp
    if current:
        people.append(current)
    return people, fields


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default=os.path.join("ml", "data", "population.csv"))
    ap.add_argument("--out", default=os.path.join("ml", "data", "population_sample.csv"))
    ap.add_argument("--dict", default=os.path.join("ml", "data", "DATA_DICTIONARY.csv"))
    ap.add_argument("--people", type=int, default=800,
                    help="how many whole careers to keep")
    ap.add_argument("--seed", type=int, default=20260909)
    args = ap.parse_args()

    path = args.data
    if not os.path.exists(path):
        path = os.path.join("data", "population.csv")   # when run from ml/
    if not os.path.exists(path):
        print("No population file. Run ml/generate_population.py first.")
        return 1

    print("Reading %s ..." % path)
    people, fields = read_people(path)
    print("  %s people, %s rows" % ("{:,}".format(len(people)),
                                    "{:,}".format(sum(len(p) for p in people))))

    rng = random.Random(args.seed)
    keep = rng.sample(people, min(args.people, len(people)))

    out = args.out
    if not os.path.isdir(os.path.dirname(out)):
        out = os.path.join("data", os.path.basename(out))
    os.makedirs(os.path.dirname(out), exist_ok=True)

    rows = 0
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for person in keep:
            for row in person:
                w.writerow(row)
                rows += 1

    size_kb = os.path.getsize(out) / 1024
    print("\nWrote %s rows from %s whole careers to %s  (%.0f KB)" % (
        "{:,}".format(rows), "{:,}".format(len(keep)), out, size_kb))

    # Does the sample still look like the published distribution? If sampling
    # by person is doing its job, it should.
    mid_incomes = [math.exp(float(p[len(p) // 2]["logIncome"])) for p in keep]
    _, deviation = calibration.compare(mid_incomes)
    print("  Sample vs published distribution: %.1f%% mismatch %s" % (
        deviation * 100,
        "(the sample is representative)" if deviation < 0.08
        else "(TOO FAR - the sample is not representative)"))

    # ---- the data dictionary -------------------------------------------
    dpath = args.dict
    if not os.path.isdir(os.path.dirname(dpath)):
        dpath = os.path.join("data", os.path.basename(dpath))
    with open(dpath, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["column", "type", "role", "description"])
        for name, typ, desc, role in COLUMNS:
            w.writerow([name, typ, role, desc])
        w.writerow([])
        w.writerow(["# DATASET", "", "", ""])
        w.writerow(["rows (full)", "640,000", "", "one row per taxpayer-year"])
        w.writerow(["careers (full)", "40,000", "", "16 years each"])
        w.writerow(["rows (this sample)", "{:,}".format(rows), "",
                    "%d whole careers, sampled by person" % len(keep)])
        w.writerow([])
        w.writerow(["# PROVENANCE", "", "", ""])
        w.writerow(["nature", "synthetic", "",
                    "Simulated careers. No real individual appears in this data."])
        w.writerow(["calibrated to", calibration.SOURCE["publication"], "",
                    "%s, %s" % (calibration.SOURCE["publisher"],
                                calibration.SOURCE["assessment_year"])])
        w.writerow(["source url", calibration.SOURCE["url"], "", ""])
        w.writerow(["what is anchored", "income levels", "",
                    "Rescaled so the population matches the published income "
                    "band distribution (0.1% mismatch)"])
        w.writerow(["what is assumed", "income dynamics", "",
                    "Growth, volatility, shock persistence and job-change "
                    "frequency. A published snapshot cannot supply these."])
        w.writerow([])
        for i, (lo, hi, share) in enumerate(calibration.INCOME_BANDS):
            w.writerow(["published band", calibration.band_label(i),
                        "%.1f%%" % (share * 100), "share of individual taxpayers"])

    print("Wrote the data dictionary to %s" % dpath)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
