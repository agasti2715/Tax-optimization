# Tax Optimisation Agent for Personal Finance

An advisory agent for Indian personal income tax. The user answers the questions a Chartered
Accountant would ask; the agent computes their liability under both tax regimes, ranks the
legal ways they can reduce it, and names the exact government forms required for each.

**Financial year covered:** FY 2025-26 (AY 2026-27), with FY 2024-25 also selectable.

---

## Running it

No installation, no build step, no internet connection required.

**Option 1 — just open it.** Double-click `index.html`. Everything runs in the browser.

**Option 2 — serve it locally** (needed only if your browser blocks local files):

```bash
python -m http.server 5180 --directory .
```

Then open `http://localhost:5180`.

**Run the test suite:**

```bash
node test/verify.js
```

44 assertions, all checked against figures computed by hand in `TEST_CASES.md`.

---

## Architecture

The single most important design decision in this project:

> **A language model never computes a number. The tax arithmetic is deterministic and auditable.**

An LLM that guesses slab rates or deduction ceilings will confidently produce wrong tax advice.
So the system separates *knowing the law* from *explaining the law*:

```
                    ┌──────────────────────────────┐
   User answers ───►│  rulebook.js                 │  Every rate, limit, section
   the interview    │  THE KNOWLEDGE BASE          │  and form — as DATA, not code.
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │  engine.js                   │  Head-wise computation,
                    │  DETERMINISTIC COMPUTATION   │  both regimes, with a
                    └──────────────┬───────────────┘  step-by-step trace.
                                   │
                    ┌──────────────▼───────────────┐
                    │  advisor.js                  │  Fires ~14 advisory rules,
                    │  RECOMMENDATION ENGINE       │  measures each by re-running
                    └──────────────┬───────────────┘  the engine.
                                   │
                    ┌──────────────▼───────────────┐
                    │  app.js                      │  Interview, live estimate,
                    │  PRESENTATION                │  report, printable output.
                    └──────────────────────────────┘
```

| File | Lines | Responsibility |
|---|---|---|
| `src/rulebook.js` | ~490 | Slabs, deduction ceilings, section library, forms directory, compliance calendar |
| `src/engine.js` | ~400 | The 10-step computation: heads → set-off → GTI → Chapter VI-A → tax → rebate → surcharge → cess |
| `src/advisor.js` | ~430 | Advisory rules, sequential what-if evaluation, ITR form selection, document checklist |
| `src/app.js` | ~450 | Interview stepper, live agent reasoning panel, six-tab report |
| `src/samples.js` | ~150 | Four demo taxpayers exercising every branch |
| `test/verify.js` | ~230 | Regression tests against hand-computed figures |

### Why savings are measured, not estimated

Most tax calculators estimate a deduction's benefit as `amount × assumed marginal rate`. That
breaks whenever the deduction crosses a slab boundary or touches the section 87A rebate.

This agent instead attaches a `mutate()` function to each recommendation, applies it to a copy
of the profile, and **re-runs the entire engine**. The saving is the genuine difference.

Recommendations are then applied **sequentially**, each measured on top of the ones already
applied — so the individual figures add up exactly to the headline total, with no double
counting.

---

## What the agent knows

### Regimes
Old regime (all deductions) and the new regime under section 115BAC (lower slabs, almost no
deductions). The new regime is the default; the agent flags when you must actively opt out.

### Heads of income
Salary · House property (self-occupied and let-out, with the section 71(3A) set-off cap) ·
Business or profession · Capital gains · Other sources

### Exemptions and deductions
HRA under 10(13A) with the full three-way least-of working · Standard deduction · Professional
tax · 80C · 80CCD(1B) · 80CCD(2) · 80D · 80DD · 80DDB · 80E · 80EEB · 80G · 80GG · 80TTA ·
80TTB · 80U · 24(b) home loan interest · family pension under 57(iia)

### Capital gains (post 23 July 2024 rules)
STCG on listed equity at 20% (s.111A) · LTCG on listed equity at 12.5% above the ₹1.25 lakh
annual exemption (s.112A) · LTCG on other assets at 12.5% (s.112) · short-term gains on
non-equity assets at slab rates · **unused basic exemption absorbed against gains**, highest
rate first

### Tax computation subtleties the agent handles correctly
- Section 87A rebate — ₹60,000 under the new regime up to ₹12 lakh, ₹12,500 under the old up to ₹5 lakh
- **Marginal relief** just above the ₹12 lakh rebate threshold
- Surcharge bands, with **marginal relief**, and the **15% cap on surcharge over capital gains**
- Rebate applies to ordinary income only, never to special-rate capital gains
- Chapter VI-A deductions capped at gross total income
- Rounding to the nearest ₹10 under section 288A

### Compliance output
ITR form selection (ITR-1 / 2 / 3 / 4) with the reason · supporting forms (16, 16A, 26AS, AIS,
12BB, 12BAA, 10-IEA, 10E, 10BA, 10-IA, 10BE, 15G, 15H, 67, Challan 280, ITR-U) · advance tax
instalment schedule under section 211 · document checklist · compliance calendar

---

## Accuracy and limitations

**This is an academic project, not professional tax advice.**

Known simplifications, stated openly:

1. **The 80G qualifying limit is simplified.** The 10%-of-adjusted-gross-total-income cap that
   applies to some donation categories is not modelled; the agent applies the 50%/100% rate only.
2. **Clubbing provisions (s.60–64) are not modelled.** Income transferred to a spouse or minor
   child is not clubbed back.
3. **Carry-forward losses from earlier years are not accepted as input.** Current-year house
   property loss is computed and carried forward correctly, but prior-year balances are not.
4. **Residential status is assumed to be Resident.** NRI rules, DTAA relief and Form 67 mechanics
   are named but not computed.
5. **Sections 54 / 54F / 54EC are described but not computed.** Capital gains reinvestment
   exemptions appear in the section library and advice text, not in the arithmetic.
6. **Relief under section 89(1) for salary arrears is not computed** — Form 10E is named only.
7. **Rates must be re-verified.** Indian tax rates change with every Finance Act. Before any
   real-world use, confirm every figure in `src/rulebook.js` against `incometax.gov.in`.
8. **The Income-tax Act, 2025** replaces the 1961 Act and introduces the "tax year" concept for
   periods from 1 April 2026. Section numbering changes under the new Act. This project is built
   on the 1961 Act, which still governs the returns being filed for FY 2025-26. Migrating means
   adding a new year card to `rulebook.js` — the computation logic is unaffected.

---

## Extending it

**Adding a new financial year:** copy a year card in `RULEBOOK.years`, edit the slabs and limits.
No other file changes.

**Adding a new advisory rule:** append an object to the array in `buildCandidates()` in
`src/advisor.js`. Give it a `mutate()` function and the engine measures its value automatically.

**Adding an LLM explanation layer:** the agent's output is already structured JSON. Feeding
`advice.recommendations` to a language model to produce a conversational narrative is a natural
extension — but the numbers must keep coming from the engine.
