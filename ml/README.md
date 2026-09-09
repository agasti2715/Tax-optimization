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

## Where the data comes from

**The short version:** the income *levels* are anchored to real published
government data. The income *dynamics* are simulated, because nobody publishes
the data that would be needed to do otherwise.

### Why there is no real dataset to use

Two different datasets matter here, and only one of them exists in public:

| | |
|---|---|
| **What a forecaster needs** | Year-by-year income histories for individual taxpayers |
| **What actually exists** | Aggregate counts — how many returns were filed in each income band |

Individual income histories are protected personal data. No tax authority
publishes them, and no legitimate project has them. Any project claiming to
have trained on real Indian income histories should be asked where they got
them.

### What we anchor to instead

| | |
|---|---|
| **Publisher** | Central Board of Direct Taxes (CBDT), Ministry of Finance, Government of India |
| **Publication** | *Income Tax Return Statistics*, released annually |
| **Contains** | Income-range-wise count of returns filed, by taxpayer type |
| **Source** | https://www.incometaxindia.gov.in — Direct Taxes Data |
| **Version used** | AY 2023-24 |

CBDT has published this since AY 2012-13 as part of its open-data commitment.
It is the authoritative public description of how income is distributed across
Indian taxpayers.

The figures live in **one file**, `ml/calibration.py`, with the citation
directly above them. Everything downstream reads from there, so correcting a
number is a one-line change.

### How the anchoring works

Each simulated career is generated first as a *shape* — growth, volatility,
job-change jumps — starting from 1.0. Then an income is drawn from the
published CBDT distribution and the **whole path is multiplied** so it lands
there at mid-career.

Rescaling after the fact rather than before is the point, and getting it wrong
is easy. The first attempt worked backwards from the drift alone to pick a
starting income — but shocks and jumps also compound, and jumps are
mean-positive, so everyone drifted upward. It produced **9% of people above
₹50 lakh against a published 1.4%**, a 24.8% total mismatch.

Scaling the finished path hits the target by construction instead of by
prediction, and it costs nothing: multiplying every income by one constant
leaves every log-growth increment untouched, and those increments are exactly
what the model trains on. **The dynamics are identical; only the level moves.**

Mid-career is the anchor point because the published statistics describe the
whole filing population — people at every career stage at once — and the
middle of a career is the closest single point to that mixture.

### Verifying it

```bash
python ml/validate_population.py
```

Bins every generated income the way CBDT does and prints both distributions
side by side. Current result on 40,000 simulated careers:

| Income band | Published | Generated | Diff |
|---|---|---|---|
| up to ₹5L | 33.6% | 33.6% | +0.0% |
| ₹5L to ₹10L | 46.7% | 46.7% | +0.0% |
| ₹10L to ₹50L | 18.3% | 18.2% | −0.1% |
| above ₹50L | 1.4% | 1.3% | −0.1% |

**0.1% of the population would have to move band.** The script fails loudly if
that drifts past 8%, so a generator change that breaks the anchoring cannot
pass silently.

### What is still assumed

The *dynamics* cannot be calibrated against a snapshot: the published data says
how many people earn ₹10–50 lakh, not how one person's income moved from year
to year. So growth rates, volatility, AR(1) shock persistence and job-change
frequency are reasoned assumptions. Each is a named constant at the top of
`generate_population.py`, so they can be argued with rather than excavated.

### What to call it

**"A synthetic population calibrated to the CBDT published income
distribution."** Never "trained on real taxpayer data". The `provenance` field
is written into the model artefact itself and travels with every prediction to
the UI, so the claim cannot be quietly lost in a copy.

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
