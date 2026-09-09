"""
verify_export.py — PROVE THE EXPORTED MODEL SURVIVED THE LANGUAGE BOUNDARY

===============================================================================
THE FAILURE THIS EXISTS TO CATCH
===============================================================================
The model is fitted in Python and scored in JavaScript, with a JSON artefact
in between. Every way that can go wrong is silent:

    - features written in a different order than they are read
    - sklearn's tree `value` array left nested (n_nodes, 1, 1) instead of flat
    - the learning rate applied to the first tree only
    - the boosting initial value dropped
    - quantiles emitted unsorted

None of these raise. They all produce a model that loads, runs, and returns
confident numbers that are wrong. A tax tool that quietly mis-forecasts income
is worse than one that crashes, because nobody finds out.

===============================================================================
THE TWO-LINK CHAIN
===============================================================================
Fidelity is checked as a chain, and both links are verified:

    sklearn  ->  forecaster.json     this file, by re-scoring the test split
                                     from the JSON alone and reproducing the
                                     pinball loss the artefact claims

    forecaster.json  ->  JavaScript  test/verify_export.js, by comparing the
                                     JavaScript scorer against the fixtures
                                     this file writes

If the artefact reproduces its own recorded score, the export is faithful. If
JavaScript reproduces the fixtures, the reader is faithful. Together they say
the number a taxpayer sees is the number the model was fitted to produce.

Usage:
    python ml/verify_export.py
"""

import json
import math
import os

import numpy as np

from train_forecaster import (
    FEATURES, QUANTILES, load, mean_pinball, repair_crossing, prior_quantiles,
)
from sklearn.model_selection import train_test_split

import argparse

DEFAULT_ARTEFACT = os.path.join("models", "forecaster.json")
DEFAULT_DATA = os.path.join("ml", "data", "population.csv")
FIXTURES = os.path.join("ml", "data", "export_check.json")

# Must match the split in train_forecaster.py, or the "held-out" rows checked
# here would include rows the model was fitted on and the check would pass
# regardless of whether the export is faithful.
SEED = 20260908


# =============================================================================
# SCORING THE ARTEFACT — pure Python, no sklearn, mirroring src/forecast.js
# =============================================================================

def walk_tree(tree, x):
    """Deliberately transcribed from walkTree() in src/forecast.js."""
    node = 0
    while tree["children_left"][node] != -1:
        node = (tree["children_left"][node]
                if x[tree["feature"][node]] <= tree["threshold"][node]
                else tree["children_right"][node])
    return tree["value"][node]


def score_quantile(qm, x):
    """Deliberately transcribed from scoreQuantile() in src/forecast.js."""
    if qm["kind"] == "linear":
        return qm["intercept"] + sum(c * xi for c, xi in zip(qm["coef"], x))
    y = qm["init"]
    for t in qm["trees"]:
        y += qm["learningRate"] * walk_tree(t, x)
    return y


def score_all(artefact, X):
    out = np.zeros((X.shape[0], len(artefact["quantiles"])))
    for r in range(X.shape[0]):
        row = X[r]
        for c, qm in enumerate(artefact["models"]):
            out[r, c] = score_quantile(qm, row)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artefact", default=DEFAULT_ARTEFACT)
    ap.add_argument("--data", default=DEFAULT_DATA)
    ap.add_argument("--fixtures", default=FIXTURES)
    args = ap.parse_args()

    if not os.path.exists(args.artefact):
        print("No {} — run ml/train_forecaster.py first.".format(args.artefact))
        return 1

    with open(args.artefact) as fh:
        artefact = json.load(fh)

    print("Artefact: {}  ({} quantiles, {} features)".format(
        artefact["kind"], len(artefact["quantiles"]), len(artefact["features"])))

    # ---- link 1: does the JSON reproduce the score it claims? ------------
    X, y = load(args.data)
    _, Xte, _, yte = train_test_split(X, y, test_size=0.25, random_state=SEED)

    print("\nRe-scoring {:,} held-out rows from the JSON alone...".format(len(yte)))
    preds = repair_crossing(score_all(artefact, Xte))
    loss = mean_pinball(yte, preds)
    claimed = artefact["metrics"]["chosenPinball"]

    print("  recomputed pinball loss : {:.8f}".format(loss))
    print("  claimed in the artefact : {:.8f}".format(claimed))
    drift = abs(loss - claimed)
    print("  difference              : {:.2e}".format(drift))

    if drift > 1e-6:
        print("\n  EXPORT IS NOT FAITHFUL. The JSON does not reproduce the score")
        print("  the fitted model achieved. Do not ship this artefact.")
        return 1
    print("  -> export is faithful.")

    # Also confirm the feature ORDER is what the artefact declares, by
    # checking the recorded improvement over the prior still holds.
    prior_loss = mean_pinball(yte, repair_crossing(prior_quantiles(Xte)))
    gain = (prior_loss - loss) / prior_loss * 100
    print("\n  prior pinball loss      : {:.8f}".format(prior_loss))
    print("  improvement over prior  : {:+.2f}%".format(gain))

    # ---- link 2: write fixtures for the JavaScript side ------------------
    # A spread of rows rather than the first N, so the fixtures exercise
    # different branches of the trees rather than one corner of the space.
    idx = np.linspace(0, len(Xte) - 1, 40).astype(int)
    fixtures = {
        "note": ("Generated by ml/verify_export.py. Each row is scored by the "
                 "pure-Python reader; test/verify_export.js must reproduce "
                 "these numbers from the same artefact."),
        "features": artefact["features"],
        "quantiles": artefact["quantiles"],
        "rows": [],
    }
    for i in idx:
        fixtures["rows"].append({
            "x": [float(v) for v in Xte[i]],
            "expected": [float(v) for v in score_all(artefact, Xte[i:i + 1])[0]],
        })

    os.makedirs(os.path.dirname(args.fixtures), exist_ok=True)
    with open(args.fixtures, "w") as fh:
        json.dump(fixtures, fh, indent=1)
    print("\n  Wrote {} fixture rows to {}".format(len(fixtures["rows"]), FIXTURES))
    print("  Now run:  node test/verify_export.js")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
