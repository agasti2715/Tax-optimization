# The machine learning layer

## What the ML is actually for

It is not decoration, and it is not a chatbot. Two features in this project are
mathematically impossible without a **probabilistic** forecast of next year's
income:

| Feature | What it needs | Why a point estimate fails |
|---|---|---|
| `src/advancetax.js` | `F⁻¹(0.68)` | The cost of underpaying advance tax is ~2× the cost of overpaying, so the optimal instalment is a *quantile*, not a mean |
| `src/stopping.js` | the full conditional distribution | The dynamic program integrates `E[V(next year)]` over where income lands |

So the model predicts a **distribution**, using quantile regression, and is
scored with **pinball loss** — the proper scoring rule for quantile forecasts,
and the loss quantile regression actually minimises.

## Honesty about the data

**There is no public dataset of individual Indian taxpayers' income histories.**
There cannot be — it is precisely the data that is protected. The model is
therefore trained on a **calibrated synthetic population**.

That is a legitimate way to build and test the machinery. It is not a licence to
call this a model trained on real taxpayers. Say "calibrated synthetic
population", every time. The `provenance` string travels with every prediction
into the UI so the claim cannot be quietly lost.

What "calibrated" means is narrow: the generative process encodes structural
facts that are not in dispute — incomes compound rather than add, growth slows
with age, changing employer produces a jump an annual increment does not,
self-employment is more volatile than salaried employment, and shocks persist
year to year. The *magnitudes* are assumptions, and each is a named constant at
the top of `generate_population.py` so it can be argued with.

## The baseline the model must beat

`src/forecast.js` ships a working forecaster with **no training at all**: a
lognormal random walk with drift (tier 1). Any trained model has to beat it,
and "the R² is 0.4" would not tell us whether it does.

So `train_forecaster.py` scores three models on held-out data and reports the
improvement of each over that prior:

1. the analytic prior, reimplemented in Python identically
2. linear quantile regression
3. gradient-boosted quantile regression

**If neither trained model beats the prior, nothing is exported.** Shipping a
model that scores worse than the thing it replaces, in order to have machine
learning in the project, would make the product worse. The script says so and
exits.

The synthetic population contains one structure the prior *cannot* represent:
AR(1) persistence in shocks, exposed through the `recentGrowth` feature. That is
the specific thing a fitted model is expected to earn its keep on.

## Running it

Python is not currently installed on this machine — only the Microsoft Store
stub. Install Python 3.11+, then:

```bash
pip install -r ml/requirements.txt
python ml/generate_population.py --n 20000 --years 12
python ml/train_forecaster.py
```

This writes `models/forecaster.json`. `src/forecast.js` picks it up on next load
and switches from tier 1 (prior) to tier 2 (trained), automatically. Nothing
else changes.

## The language boundary

The model is fitted in Python and scored in JavaScript, with a serialised
artefact between them. That is the classic place for a model to go silently
wrong: features in a different order, a tree's `value` array left nested, a
learning rate dropped, quantiles returned unsorted. **None of those throw.**

Two defences:

- The **feature order lives in the artefact**, not duplicated in both languages.
  `buildFeatureVector()` in `forecast.js` reads it back rather than assuming.
- `test/verify_forecast.js` hand-builds small model files whose correct output
  can be computed on paper, and checks the JavaScript scorer against them —
  including a test that every tree in an ensemble contributes, not just the
  first. The inference path is proven before any real model reaches it.

## Quantile crossing

Independently fitted quantile regressors can come out in the wrong order — the
fitted 60th percentile below the fitted 50th — which produces an invalid
distribution and nonsensical advice. Both sides repair it by sorting, which
cannot increase pinball loss and so is free.
