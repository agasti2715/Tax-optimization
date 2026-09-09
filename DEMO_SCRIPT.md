# Demo script — 6 minutes

Everything below is rehearsed against the live app. Numbers are exact.

**Before you start:** open `index.html`, set the year to **FY 2025-26 (AY 2026-27)**, and make
sure the sample dropdown reads "— Start blank —".

---

## 0:00 — The problem (30 seconds)

> "Every salaried Indian faces the same question in January: old regime or new regime, and what
> should I invest in? The honest answer needs a Chartered Accountant, and most people don't have
> one. So we built an agent that asks the same questions a CA asks, and answers from the Income-tax
> Act itself."

---

## 0:30 — The architecture slide (60 seconds)

**This is the part that earns marks. Say it clearly:**

> "The most important decision we made was that **no language model computes any number**. An LLM
> that guesses a slab rate will give confidently wrong tax advice, and a wrong tax return is a
> legal problem, not a bug.
>
> So we separated the two things. `rulebook.js` holds every rate, ceiling, section and form as
> **data** — because Indian tax rates change every Finance Act, and updating for a new year means
> editing one file, not rewriting logic. `engine.js` does deterministic arithmetic that can be
> audited line by line. Only the explanation layer is conversational."

Show the four-box diagram in `README.md`.

---

## 1:30 — Live demo (2 minutes 30)

### Load the sample

Choose **"Priya — Salaried, Mumbai, pays rent"** from the top-right dropdown.

> "Priya earns ₹14 lakh in Mumbai, pays ₹20,000 a month in rent, has EPF and an LIC policy.
> She's convinced the old regime is better because she claims HRA and 80C."

**Point at the right-hand panel** as the numbers fill in.

> "That's the agent reasoning live — every line is a rule firing. HRA exemption, standard
> deduction, Chapter VI-A. Nothing is hidden."

### Click **"Analyse my tax →"**

Four numbers appear across the top:

| | |
|---|---|
| Tax as you stand today | **₹90,010** |
| Tax after my recommendations | **₹76,910** |
| You can legally save | **₹13,100** |
| Still payable | ₹10 |

### The regime comparison

> "Old regime: **₹1,52,100**. New regime: **₹90,010**. Priya was wrong — even with HRA and 80C,
> the new regime saves her **₹62,090**."

### Scroll to "What if you went all-in on the other regime?" — **this is the punchline**

> "The obvious objection is: what if she invested more? So the agent fills every deduction the
> old regime offers and re-runs the whole computation.
>
> Old regime, fully optimised: **₹85,900** — but it costs her **₹1,78,000** in cash, locked up.
> New regime, fully optimised: **₹76,910** — and it costs her **nothing**.
>
> The new regime isn't just today's answer. It's genuinely her answer."

### Click the **How you save** tab — spend the most time here

> "This tab answers the question the numbers alone never do: *where does the saving actually come from?*
>
> The agent pulls three different kinds of lever, ordered by what they cost you.
> **Lever 1 — choose the right regime: ₹62,090.** Already secured, costs nothing but a correct tick-box.
> **Lever 2 — restructure what she already earns: ₹13,100.** Same CTC, just relabelled.
> **Lever 3 — invest where the law rewards you: ₹0.** And notice the agent says so honestly — in the new
> regime there is no investment-linked deduction, so it refuses to tell her to lock money away for nothing.
> A tool that always recommends buying something is selling, not advising."

Scroll to the **waterfall**.

> "Her tax falling bar by bar — ₹90,010, minus ₹13,100 at section 80CCD(2), landing at ₹76,910.
> Effective rate drops from 6.5% to 5.9%."

Scroll to **"Do these, in this order"**.

> "And this is the deliverable. Every action has a deadline, a place to go, the proof to keep, and the
> running tax figure after that step — so she knows exactly what to do on Monday morning."

### Click the **Action plan** tab

> "One recommendation actually moves money: ask HR to move ₹84,000 of her special allowance into
> employer NPS under **80CCD(2)** — the only large deduction that survived the new regime. Her CTC
> doesn't change, only the label. That saves **₹13,100**.
>
> Every card names the section, the lock-in, the risk, and the forms — **Form 12BB**, a revised
> salary structure letter, and a PRAN."

### Click **Computation**, then **Forms & filing**

> "Full side-by-side computation, including the HRA least-of-three working.
>
> And it tells her exactly what to file: **ITR-1 (Sahaj)**, due 31 July, plus Form 16, Form 12BB,
> Form 26AS and the AIS to reconcile against."

---

## 4:00 — Prove it isn't guessing (60 seconds)

Click the **Agent trace** tab.

> "Every step of the computation, in order, auditable."

Then run the tests in a terminal:

```bash
node test/verify.js
```

> "**44 assertions, all passing.** Every one of these was computed by hand first — the full
> working is in `TEST_CASES.md`. Including the tricky ones: the section 87A marginal relief just
> above ₹12 lakh, and the unused basic exemption being absorbed against capital gains, which most
> online calculators get wrong."

---

## 5:00 — THE CLINCHER: load **Vikram** (60 seconds)

If you only have time for one more thing, do this one. It is the answer to
*"isn't this just a regime calculator?"*

Load **"Vikram — Never invested (optimising flips the regime)"**, click Analyse, open **How you save**.

> "Vikram earns ₹16 lakh and has never invested a rupee. Compare the two regimes as he stands —
> which is exactly what every online calculator does — and the **new regime wins by ₹56,160**.
> A calculator would stop right there and tell him he's done.
>
> Our agent doesn't compare first. It **optimises both regimes to their own ceiling, and compares
> after**. And the verdict reverses: the old regime, fully used, reaches **₹92,140** — below the
> **₹96,880** that is the absolute best the new regime can ever do for him.
>
> Now look at step 1. It's **red**. Switching to the old regime, on its own, **costs him ₹56,160**.
> It only pays as a package with the five steps that follow. He invests ₹1,79,000, and ends up
> **₹22,210** better off than the answer a calculator gave him.
>
> That recommendation is *unreachable* if you compare before you optimise. That's the difference
> between a calculator and an agent."

## 5:45 — Show a contrasting profile (30 seconds)

Load **"Rajesh — Salaried, home loan, Pune"**, click Analyse.

> "Different person, opposite answer. Rajesh has a home loan, so ₹2 lakh of section 24(b) interest
> plus 80D and 80CCD(1B) make the **old regime** win.
>
> And the agent catches a real mistake: his EPF plus home loan principal total ₹2,46,000 against a
> ₹1,50,000 ceiling — **₹96,000 of his 80C money earns him nothing**. That's the kind of thing
> people do for years without noticing."

---

## 5:45 — Close (15 seconds)

> "Limitations are documented honestly in the README — clubbing provisions, sections 54 and 54F,
> and NRI rules aren't computed yet. And every rate must be re-verified against the Finance Act
> before real use. It's an academic project, and the disclaimer is on every screen."

---

# Questions your teacher will probably ask

**"Isn't this just telling me the difference between the old and new regime?"**
> That is exactly what it would be if it compared the regimes and stopped — and that is the trap
> most tax tools fall into. The regimes aren't two prices for the same thing; they're two rule sets
> with different **ceilings**. We optimise each one to its own limit and compare *after*, so the
> regime recommendation is an output of the agent, not an assumption it starts from.
> Load Vikram: a plain comparison says new regime by ₹56,160, our agent says old regime, and it's
> right by ₹4,740 at the ceiling. The switch on its own is a **loss** — no comparison-first tool can
> ever surface that combination.

**"Where is the AI? This looks like a calculator."**
> The intelligence is in rule selection and ranking, not arithmetic. Fourteen advisory rules
> compete; each is measured by re-running the full computation with that change applied, then
> applied sequentially so the savings don't double-count. Deliberately keeping the LLM out of the
> arithmetic is the engineering decision — a hallucinated slab rate is a legal problem, not a bug.
> The natural extension is an LLM narrating this structured output, and the code is already shaped
> for it.

**"How do you know the numbers are right?"**
> 44 assertions in `test/verify.js`, each computed by hand first in `TEST_CASES.md`. Show the
> Priya working — HRA least-of-three, slab-by-slab tax, cess.

**"What happens when the rates change next year?"**
> Copy one object in `rulebook.js` and edit the slabs. No logic changes. That's exactly why the
> rates are data.

**"Why not just use ChatGPT?"**
> Ask it for the section 87A marginal relief on ₹12,10,000 and check the answer. Tax needs
> reproducibility: the same input must give the same rupee figure every time, and you must be able
> to show your working to an assessing officer.

**"Is this legal? Is it tax evasion?"**
> Every recommendation is a deduction or exemption written into the Act, and each one names its
> section. Tax *avoidance* using statutory provisions is legal; evasion is concealment. The agent
> also refuses to encourage a false claim — if you claim HRA with no rent declared, it flags that
> the department cross-checks the landlord's PAN.

**"What about the new Income-tax Act, 2025?"**
> It replaces the 1961 Act for periods from 1 April 2026 and renumbers sections. The returns being
> filed right now, for FY 2025-26, are still under the 1961 Act, which is what we've built.
> Migrating means adding a year card — the computation logic is unaffected. It's noted in the
> README's limitations.

**"Who is it for, and what's next?"**
> Salaried Indians without a CA. Next: OCR of Form 16 to skip the interview, an LLM narrative
> layer over the structured output, and computing sections 54/54F for property sales.

---

---

# The advanced material (add 3 minutes)

Everything above is the original demo and still runs. This section is the new work. It lives
behind the **Advanced analysis** tab, and the whole analysis takes well under a second, so you
can click straight through it.

**Setup:** pick **Meera — Consultant** from the sample dropdown, press **Analyse my tax**, then
open **Advanced analysis**. That is the entire click path.

## The line that lands

> "The old regime saves her twenty-three thousand rupees this year. Every tax calculator on the
> internet tells her to file Form 10-IEA and take it. Ours tells her not to."

Then read the card. Under **s.115BAC(6)**, a taxpayer with professional income can leave the new
regime **once in a lifetime**, and return once. So it is not a comparison, it is an irreversible
option — and the saving on the table has to be worth more than the option it spends. Solved as an
optimal stopping problem over her remaining 25 working years, it is not.

**If asked "how do you know that isn't noise":** the recommendation is checked across several
random seeds and reported with its agreement level. The *direction* is stable; the rupee margin
behind it is not, because it is a small difference between two lifetime figures of around six
crore. So the tool deliberately does not quote that margin. Saying this before you are asked is
better than saying it afterwards.

## The second card — advance tax

> "On the fifteenth of June you have to pay tax on money you have not earned yet. Underpaying
> costs one percent a month. Overpaying earns back only half a percent. Those are not symmetric,
> so the right instalment is not what you expect to owe — it is a *quantile* of it."

That is the newsvendor problem, and the tool solves it as one. The percentile it lands on is
around **66–68**, which is the answer falling out of the statute rather than being chosen.

**Expect the question "why would I pay more than I expect to owe?"** — that *is* the point.
The penalty for being short bites about twice as hard as the cost of being long.

## The third card — where the money goes

Move the budget field. The answer changes, and that is the demonstration: with unlimited cash the
order does not matter because you reach everything; with fifty thousand rupees, which you reach
*first* is the whole decision.

> "And notice it never tells you to donate. It is offered the option. A rupee given away saves you
> thirty paise, so the objective is tax *plus what the action costs you* — not tax alone. A solver
> that minimises tax alone gives your money away and reports a triumph."

## Claude (back on the intake screen)

Paste an API key, type a sentence like *"I'm 29, freelance UX in Bengaluru, made about 16 lakh,
paying off an education loan"*, and press **Fill the form**.

> "Claude fills the form. It never computes a number. It cannot — it is given a tool definition
> and has to answer by calling it, so there is no free-text route into the profile at all."

Everything it returns is validated before it is applied, and the panel says what it ignored. If a
grader asks how you stop it hallucinating, that panel *is* the answer: an invented section, a
field where the model tried to do the arithmetic itself, and a citation of a section we do not
implement are all caught and reported rather than used.

**Have the key ready in the box before you present**, and clear it afterwards.

## If you only have one extra minute

Show Meera and the regime card. Nothing else in the project reverses a recommendation that every
competing tool gets wrong.

---

# If something goes wrong on the day

- **Blank page / nothing happens** → open the browser console (F12). If you see a file-loading
  error, run `python -m http.server 5180` in the project folder and use `http://localhost:5180`.
- **Numbers look wrong** → check the financial year selector reads FY 2025-26.
- **You lose your place** → every sample reloads instantly from the dropdown. Nothing is stored.
- **Projector washes out the colours** → the theme is deliberately light and high-contrast; don't
  switch the browser to dark mode.
- **Have `node test/verify.js` output ready in a second terminal** in case the browser misbehaves —
  it proves the engine independently of the UI.
- **The Advanced tab is blank** → it needs `models/forecaster.json`. If it is missing the app still
  works on its built-in forecaster; nothing breaks, the numbers just shift slightly.
- **Claude says "Could not read that"** → the key is wrong or missing. Everything else on the page
  works without it; skip the Claude section and carry on.
- **Serve the folder rather than opening the file directly** (`python -m http.server 5180`), or the
  browser will refuse to load the trained model from disk.
