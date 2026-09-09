"""
train_forecaster.py — QUANTILE REGRESSION FOR NEXT YEAR'S INCOME

===============================================================================
WHAT IS BEING PREDICTED, AND WHY IT IS NOT A POINT ESTIMATE
===============================================================================
Both headline features of this project need a DISTRIBUTION, not a number:

    src/advancetax.js   needs F-inverse(0.68) to place an advance tax
                        instalment, because the cost of underpaying is about
                        twice the cost of overpaying
    src/stopping.js     needs the whole conditional distribution to build the
                        transition kernel its dynamic program runs on

A model that predicts expected income would be useless to both. So we fit
QUANTILE REGRESSION at a grid of quantiles, which estimates the conditional
distribution directly rather than assuming a shape for it.

===============================================================================
THE HONEST COMPARISON
===============================================================================
src/forecast.js already ships a working forecaster without any training: a
lognormal random walk with drift, parameterised by employment type and
variable-pay share. Any trained model has to beat that, and "it has an R^2 of
0.4" would not tell us whether it does.

So this script scores three models on held-out data using PINBALL LOSS — the
proper scoring rule for quantile estimates, and the loss quantile regression
actually minimises:

    1. the analytic prior from forecast.js, reimplemented here identically
    2. linear quantile regression
    3. gradient-boosted quantile regression

and reports the improvement of each over the prior. If the trained model does
not beat the prior, the honest thing is to ship the prior, and this script will
say so rather than exporting a model that is worse than nothing.

The synthetic population has one structural feature the prior CANNOT represent:
AR(1) persistence in shocks, exposed through the `recentGrowth` feature. That
is the specific thing a fitted model is expected to earn its keep on, and if
the improvement is real it should come mostly from there.

Usage:
    python ml/generate_population.py --n 20000 --years 12
    python ml/train_forecaster.py
"""

import argparse
import csv
import json
import math
import os

import numpy as np
import calibration
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import QuantileRegressor
from sklearn.model_selection import train_test_split

# The feature order is written into the exported model and read back by
# buildFeatureVector() in src/forecast.js. Keeping it in the artefact rather
# than duplicating it in both languages is what stops Python and JavaScript
# silently disagreeing about which column is which — the most common way an
# exported model goes quietly wrong.
FEATURES = [
    "logIncome", "age", "expYears", "variableShare", "recentGrowth",
    "yearsSinceSwitch", "isSalaried", "isProfessional", "isBusiness", "isMetro",
]

QUANTILES = [0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95]


# =============================================================================
# THE BASELINE — forecast.js's analytic prior, reimplemented exactly
# =============================================================================

PRIOR_PARAMS = {
    "salaried":     (0.080, 0.14),
    "professional": (0.070, 0.28),
    "business":     (0.065, 0.35),
}


def age_taper(age):
    if age < 25:  return 1.15
    if age < 35:  return 1.10
    if age < 45:  return 1.00
    if age < 55:  return 0.80
    return 0.55


def prior_quantiles(X):
    """
    The prior's predicted log-growth at each quantile, for every row.

    This MUST match priorParams() and makeDistribution() in src/forecast.js. If
    the two ever drift apart, the reported improvement becomes meaningless,
    because it would be measured against a baseline the product does not use.
    """
    from scipy.stats import norm

    idx = {name: i for i, name in enumerate(FEATURES)}
    out = np.zeros((X.shape[0], len(QUANTILES)))

    for r in range(X.shape[0]):
        if X[r, idx["isProfessional"]] == 1:
            etype = "professional"
        elif X[r, idx["isBusiness"]] == 1:
            etype = "business"
        else:
            etype = "salaried"

        mu0, sigma0 = PRIOR_PARAMS[etype]
        mu = mu0 * age_taper(X[r, idx["age"]])
        sigma = sigma0 * (1 + 0.9 * X[r, idx["variableShare"]])

        for c, q in enumerate(QUANTILES):
            out[r, c] = mu + sigma * norm.ppf(q)

    return out


# =============================================================================
# PINBALL LOSS — the proper scoring rule for quantile forecasts
# =============================================================================

def pinball_loss(y_true, y_pred, quantile):
    """
    Asymmetric absolute loss. Under-predicting the q-th quantile is penalised
    with weight q, over-predicting with weight (1-q). Its minimiser is exactly
    the q-th conditional quantile, which is what makes it the right scoring
    rule here — and, pleasingly, the same asymmetry that makes the advance tax
    problem a newsvendor.
    """
    delta = y_true - y_pred
    return np.mean(np.maximum(quantile * delta, (quantile - 1) * delta))


def mean_pinball(y_true, preds):
    """Average pinball loss across the whole quantile grid."""
    return float(np.mean([
        pinball_loss(y_true, preds[:, c], q) for c, q in enumerate(QUANTILES)
    ]))


def repair_crossing(preds):
    """
    Independently fitted quantile regressors can come out in the wrong order —
    the fitted 60th percentile landing below the fitted 50th. Sorting each row
    repairs it, and cannot increase the pinball loss, so it is free. The same
    repair is applied at inference time in src/forecast.js.
    """
    return np.sort(preds, axis=1)


# =============================================================================
# EXPORT — into the shape src/forecast.js knows how to score
# =============================================================================

def export_tree(tree):
    """
    One sklearn decision tree, flattened into the arrays walkTree() expects.

    sklearn stores `value` with shape (n_nodes, n_outputs, n_classes); for a
    regressor both trailing dimensions are 1, so it is flattened to one number
    per node. Leaving it nested is a silent way to export a broken model.
    """
    t = tree.tree_
    return {
        "feature": t.feature.tolist(),
        "threshold": t.threshold.tolist(),
        "children_left": t.children_left.tolist(),
        "children_right": t.children_right.tolist(),
        "value": [float(v[0][0]) for v in t.value],
    }


def export_gbm(model):
    return {
        "kind": "gbm",
        "init": float(model.init_.constant_[0][0]) if hasattr(model.init_, "constant_")
                else float(np.mean(model.train_score_[:1])),
        "learningRate": float(model.learning_rate),
        "trees": [export_tree(est[0]) for est in model.estimators_],
    }


def export_linear(model):
    return {
        "kind": "linear",
        "intercept": float(model.intercept_),
        "coef": [float(c) for c in model.coef_],
    }


# =============================================================================
# MAIN
# =============================================================================

def load(path):
    rows = []
    with open(path) as fh:
        for row in csv.DictReader(fh):
            rows.append(row)
    X = np.array([[float(r[f]) for f in FEATURES] for r in rows])
    y = np.array([float(r["target_logGrowth"]) for r in rows])
    return X, y


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default=os.path.join("ml", "data", "population.csv"))
    ap.add_argument("--out", default=os.path.join("models", "forecaster.json"))
    ap.add_argument("--trees", type=int, default=120)
    ap.add_argument("--depth", type=int, default=3)
    ap.add_argument("--seed", type=int, default=20260908)
    ap.add_argument("--linear-sample", type=int, default=25000,
                    help="cap rows for the linear baseline (0 = use all); "
                         "the exact LP solver scales badly, see source note")
    args = ap.parse_args()

    print("Loading {} ...".format(args.data))
    X, y = load(args.data)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=args.seed)
    print("  {:,} train rows, {:,} test rows, {} features".format(
        len(ytr), len(yte), len(FEATURES)))

    # ---- 1. the baseline we have to beat --------------------------------
    print("\nScoring the analytic prior (the baseline src/forecast.js ships with)...")
    prior_preds = repair_crossing(prior_quantiles(Xte))
    prior_loss = mean_pinball(yte, prior_preds)
    print("  prior mean pinball loss:            {:.6f}".format(prior_loss))

    # ---- 2. linear quantile regression ----------------------------------
    # NOTE ON SCALING. sklearn's QuantileRegressor solves an exact linear
    # program, and the highs solver's cost grows sharply with the number of
    # rows — at ~84,000 training rows it runs for tens of minutes per quantile,
    # eleven times over. The boosted model, which is the one that actually
    # ships, fits the full set in a fraction of that.
    #
    # Since the linear fit is only a BASELINE for comparison and never the
    # exported artefact, it is fitted on a capped subsample by default. The cap
    # is reported in the metrics so the comparison is never quietly unequal.
    lin_rows = len(ytr) if args.linear_sample <= 0 else min(len(ytr), args.linear_sample)
    if lin_rows < len(ytr):
        rs = np.random.RandomState(args.seed)
        sub = rs.choice(len(ytr), lin_rows, replace=False)
        Xlin, ylin = Xtr[sub], ytr[sub]
        print("\nFitting linear quantile regression on a {:,}-row subsample"
              " (of {:,}) — see the note in the source...".format(lin_rows, len(ytr)))
    else:
        Xlin, ylin = Xtr, ytr
        print("\nFitting linear quantile regression on all {:,} rows...".format(len(ytr)))

    lin_models, lin_preds = [], np.zeros((len(yte), len(QUANTILES)))
    for c, q in enumerate(QUANTILES):
        m = QuantileRegressor(quantile=q, alpha=0.0, solver="highs")
        m.fit(Xlin, ylin)
        lin_models.append(export_linear(m))
        lin_preds[:, c] = m.predict(Xte)
        print("    q={:.2f} done".format(q))
    lin_loss = mean_pinball(yte, repair_crossing(lin_preds))
    print("  linear mean pinball loss:           {:.6f}".format(lin_loss))

    # ---- 3. gradient boosted quantile regression ------------------------
    print("\nFitting gradient-boosted quantile regression...")
    gbm_models, gbm_preds = [], np.zeros((len(yte), len(QUANTILES)))
    for c, q in enumerate(QUANTILES):
        m = GradientBoostingRegressor(
            loss="quantile", alpha=q,
            n_estimators=args.trees, max_depth=args.depth,
            learning_rate=0.08, random_state=args.seed,
        )
        m.fit(Xtr, ytr)
        gbm_models.append(export_gbm(m))
        gbm_preds[:, c] = m.predict(Xte)
        print("    q={:.2f} done".format(q))
    gbm_loss = mean_pinball(yte, repair_crossing(gbm_preds))
    print("  boosted mean pinball loss:          {:.6f}".format(gbm_loss))

    # ---- the verdict -----------------------------------------------------
    print("\n" + "=" * 70)
    print("IMPROVEMENT OVER THE ANALYTIC PRIOR")
    print("=" * 70)
    lin_gain = (prior_loss - lin_loss) / prior_loss * 100
    gbm_gain = (prior_loss - gbm_loss) / prior_loss * 100
    print("  linear quantile regression:  {:+.2f}%".format(lin_gain))
    print("  gradient boosted:            {:+.2f}%".format(gbm_gain))

    best_loss, best_models, best_kind = (
        (gbm_loss, gbm_models, "quantile-gbm") if gbm_loss <= lin_loss
        else (lin_loss, lin_models, "quantile-linear")
    )

    if best_loss >= prior_loss:
        print("\n  NEITHER TRAINED MODEL BEATS THE PRIOR.")
        print("  Nothing has been exported. src/forecast.js will keep using its")
        print("  analytic baseline, which is the correct outcome — shipping a")
        print("  model that scores worse than the thing it replaces would make")
        print("  the product worse in order to have machine learning in it.")
        return

    print("\n  Exporting: {}".format(best_kind))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    artefact = {
        "version": 1,
        "kind": best_kind,
        "features": FEATURES,
        "quantiles": QUANTILES,
        "models": best_models,
        "metrics": {
            "priorPinball": prior_loss,
            "linearPinball": lin_loss,
            "gbmPinball": gbm_loss,
            "chosenPinball": best_loss,
            "improvementOverPriorPct": (prior_loss - best_loss) / prior_loss * 100,
            "testRows": int(len(yte)),
            "trainRows": int(len(ytr)),
            "linearBaselineRows": int(lin_rows),
        },
        "provenance": (
            "Trained on a calibrated SYNTHETIC population generated by "
            "ml/generate_population.py. Not fitted on real taxpayer data. "
            + calibration.describe()
        ),
        # The source travels INSIDE the artefact, not just in a README. A model
        # file that gets copied somewhere else still carries the answer to
        # "where did this data come from".
        "calibration": {
            "source": calibration.SOURCE,
            "incomeBands": [
                {"from": lo, "to": hi, "publishedShare": share}
                for lo, hi, share in calibration.INCOME_BANDS
            ],
            "employmentMix": calibration.EMPLOYMENT_MIX,
        },
    }
    with open(args.out, "w") as fh:
        json.dump(artefact, fh)

    size_kb = os.path.getsize(args.out) / 1024
    print("  Wrote {} ({:.0f} KB)".format(args.out, size_kb))
    print("\n  src/forecast.js will pick this up automatically on next load and")
    print("  switch from tier 1 (prior) to tier 2 (trained).")


if __name__ == "__main__":
    main()
