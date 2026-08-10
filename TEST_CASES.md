# Test cases — worked by hand, then checked against the engine

Every figure below was computed manually first. `test/verify.js` asserts the engine reproduces
them. If a Finance Act changes a rate, these tests fail — which is the point.

Run: `node test/verify.js` → **44 assertions, all passing.**

---

## Case 1 — Priya Sharma (the main demo case)

Software engineer, age 32, **Mumbai (metro)**, pays rent, no property.

| Input | Amount |
|---|---|
| Basic salary | ₹6,00,000 |
| HRA received | ₹3,00,000 |
| Other allowances | ₹5,00,000 |
| **Gross salary** | **₹14,00,000** |
| Rent paid (₹20,000 × 12) | ₹2,40,000 |
| EPF contribution | ₹72,000 |
| LIC premium (80C) | ₹25,000 |
| Savings interest | ₹12,000 |
| FD interest | ₹40,000 |
| Professional tax | ₹2,500 |
| TDS already deducted | ₹90,000 |

### Old regime — by hand

**HRA exemption u/s 10(13A)** — least of three:

| Option | Working | Amount |
|---|---|---|
| Actual HRA received | — | ₹3,00,000 |
| Rent − 10% of basic | 2,40,000 − 60,000 | **₹1,80,000** ← least |
| 50% of basic (metro) | 50% × 6,00,000 | ₹3,00,000 |

**Salary income** = 14,00,000 − 1,80,000 (HRA) − 50,000 (standard) − 2,500 (professional tax)
= **₹11,67,500**

**Other sources** = 12,000 + 40,000 = **₹52,000**

**Gross Total Income** = **₹12,19,500**

**Chapter VI-A:**
- 80C = 25,000 + 72,000 = ₹97,000 *(within the ₹1,50,000 ceiling)*
- 80TTA = min(12,000 savings interest, 10,000) = ₹10,000
- **Total = ₹1,07,000**

**Total Income** = 12,19,500 − 1,07,000 = **₹11,12,500**

**Tax:**

| Slab | Taxable | Rate | Tax |
|---|---|---|---|
| 0 – 2,50,000 | 2,50,000 | Nil | ₹0 |
| 2,50,001 – 5,00,000 | 2,50,000 | 5% | ₹12,500 |
| 5,00,001 – 10,00,000 | 5,00,000 | 20% | ₹1,00,000 |
| Above 10,00,000 | 1,12,500 | 30% | ₹33,750 |
| **Tax before cess** | | | **₹1,46,250** |
| Health & Education Cess | | 4% | ₹5,850 |
| **TOTAL — OLD REGIME** | | | **₹1,52,100** |

### New regime — by hand

**Salary income** = 14,00,000 − 75,000 (standard deduction) = **₹13,25,000**
*(HRA exemption and professional tax are both unavailable)*

**Total Income** = 13,25,000 + 52,000 = **₹13,77,000**
*(no Chapter VI-A deductions available)*

**Tax:**

| Slab | Taxable | Rate | Tax |
|---|---|---|---|
| 0 – 4,00,000 | 4,00,000 | Nil | ₹0 |
| 4,00,001 – 8,00,000 | 4,00,000 | 5% | ₹20,000 |
| 8,00,001 – 12,00,000 | 4,00,000 | 10% | ₹40,000 |
| 12,00,001 – 16,00,000 | 1,77,000 | 15% | ₹26,550 |
| **Tax before cess** | | | **₹86,550** |
| Health & Education Cess | | 4% | ₹3,462 |
| **TOTAL — NEW REGIME** | | | **₹90,012 → ₹90,010** *(s.288A rounding)* |

### Verdict

**The new regime wins by ₹62,090** — despite Priya claiming HRA, 80C and 80TTA in the old regime.

### What the agent then recommends

| # | Action | Section | Saving |
|---|---|---|---|
| 1 | Move ₹84,000 of special allowance into employer NPS | 80CCD(2) | **₹13,100** |
| 2 | Harvest the unused ₹1,25,000 LTCG exemption | 112A | advisory |

₹84,000 = 14% of ₹6,00,000 basic. It leaves taxable salary at a 15% marginal rate,
so 84,000 × 15% × 1.04 = **₹13,104 → ₹13,100**.

**Final position: ₹90,010 → ₹76,910.**

### The cross-regime check

| Best possible position | Tax | Cash to invest |
|---|---|---|
| New regime, fully optimised | **₹76,910** | nothing |
| Old regime, fully optimised | ₹85,900 | ₹1,78,000 |

Even after maxing out 80C, 80CCD(1B) and both 80D limits, the old regime still costs ₹8,990
more **and** ties up ₹1,78,000 of cash. This is the demo's punchline.

---

## Case 2 — The section 87A rebate cliff (new regime)

| Salary | Total income | Tax before rebate | Rebate | Marginal relief | **Tax payable** |
|---|---|---|---|---|---|
| ₹12,75,000 | ₹12,00,000 | ₹60,000 | ₹60,000 | — | **₹0** |
| ₹12,85,000 | ₹12,10,000 | ₹61,500 | nil | ₹51,500 | **₹10,400** |

The first row is the widely quoted "₹12.75 lakh salary is tax-free" figure — ₹12,00,000 after
the ₹75,000 standard deduction, with tax fully wiped out by the ₹60,000 rebate.

The second row proves **marginal relief**: income exceeds the threshold by ₹10,000, so tax is
capped at ₹10,000 (+ 4% cess = ₹10,400) instead of ₹61,500. Without marginal relief, earning
₹10,000 more would cost ₹61,500 in tax.

---

## Case 3 — Capital gains

**LTCG on listed equity, with salary income:**

Salary ₹8,75,000 → ₹8,00,000 taxable. LTCG ₹3,25,000.

- Annual exemption u/s 112A: ₹1,25,000
- Taxable LTCG: ₹2,00,000 @ 12.5% = **₹25,000**
- Slab tax on ₹8,00,000 = ₹20,000

**Unused basic exemption absorbed against gains** (proviso to s.111A):

No other income. STCG on equity ₹6,00,000.

- Basic exemption ₹4,00,000 is unused → absorbed against the STCG
- Taxable STCG: ₹2,00,000 @ 20% = **₹40,000**

Without this rule the tax would be ₹1,20,000. This is a genuine provision that most online
calculators get wrong.

---

## Case 4 — Rajesh Kumar (old regime wins)

Bank manager, Pune, home loan, no rent paid.

| | Old regime | New regime |
|---|---|---|
| Tax as-is | **₹87,360** | ₹89,390 |
| Home loan interest allowed | ₹2,00,000 *(capped)* | ₹0 |

The old regime wins because ₹2,00,000 of section 24(b) interest, ₹50,000 of 80CCD(1B) and
₹70,000 of 80D together outweigh the new regime's lower slabs.

**The agent also catches a mistake:** Rajesh's EPF (₹96,000) plus home loan principal
(₹1,50,000) totals ₹2,46,000 against a ₹1,50,000 ceiling. It flags that **₹96,000 of his 80C
contributions produce no tax benefit at all** and should be redirected.

After the plan: **₹87,360 → ₹78,000.**

---

## Case 5 — Suresh Menon, retired senior citizen

Pension ₹4,20,000 + let-out property + ₹3,38,000 of interest income = ₹8,67,600 total income.

**Tax = ₹0.** Tax of ₹26,760 is fully wiped out by the section 87A rebate, since total income
is under ₹12,00,000. The agent also flags **Form 15H** so his bank stops deducting TDS on FD
interest, and confirms he is **exempt from advance tax** under section 207.

---

## Case 6 — Ananya Iyer, freelance consultant

Gross receipts ₹24,00,000, declared profit ₹18,00,000, plus equity gains.

The agent recommends **section 44ADA**: declare 50% of receipts (₹12,00,000) as profit instead
of ₹18,00,000. No books of account, no tax audit.

**₹1,88,240 → ₹81,900. A saving of ₹1,06,340.**

It correctly routes her to **ITR-3** rather than ITR-4, because ITR-4 cannot report capital gains.

---

## Case 7 — Surcharge

Salary ₹60,00,000 → total income ₹59,25,000. Surcharge at **10%** correctly applied above the
₹50 lakh threshold, with marginal relief tested.
