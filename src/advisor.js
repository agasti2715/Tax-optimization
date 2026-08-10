/* ============================================================================
 * advisor.js — THE RECOMMENDATION ENGINE ("the CA's brain")
 * ----------------------------------------------------------------------------
 * The engine tells you what you OWE. This file tells you what to DO about it.
 *
 * How each recommendation gets its rupee figure:
 *   We do NOT multiply by an assumed marginal rate. Instead every rule carries
 *   a `mutate()` function that edits a copy of the profile, and we re-run the
 *   full engine on it. The saving is the genuine difference in tax.
 *
 * Rules are then applied SEQUENTIALLY, each one measured on top of the ones
 * already applied. That means the individual savings add up exactly to the
 * headline total — no double counting, which is the usual bug in tax
 * calculators that estimate each deduction in isolation.
 * ========================================================================== */

const clone = (o) => JSON.parse(JSON.stringify(o));
const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const inr = (v) => '₹' + Math.round(v).toLocaleString('en-IN');

/* ============================================================================
 * THE RULE BOOK OF ADVICE
 * Each rule: when(ctx) -> boolean, then a payload describing the action.
 * ========================================================================== */

function buildCandidates(profile, regime, yearKey) {
  const Y = RULEBOOK.years[yearKey];
  const L = Y.limits;
  const S = RULEBOOK.sections;
  const s = profile.salary || {};
  const d = profile.deductions || {};
  const o = profile.other || {};
  const h = profile.house || {};
  const b = profile.business || {};
  const c = profile.capitalGains || {};
  const salaryBase = n(s.basic) + n(s.da);
  const isOld = regime === 'old';
  const out = [];

  /* ---- RULE 1: employer NPS u/s 80CCD(2) — works in BOTH regimes ---- */
  if (salaryBase > 0) {
    const cap = salaryBase * L.sec80CCD2_private;
    // This is a RESTRUCTURING, not a raise: the money is moved out of your
    // taxable special allowance into NPS, so total CTC is unchanged. The
    // headroom is therefore limited by how much allowance there is to move.
    const headroom = Math.max(0, Math.min(cap - n(s.employerNps), n(s.otherAllowances)));
    if (headroom > 1000) {
      out.push({
        id: 'nps-employer',
        title: 'Ask your employer to route part of your CTC into NPS',
        section: '80CCD(2)',
        category: 'Salary restructuring',
        zeroCost: true,
        finding: `Your employer contributes ${inr(n(s.employerNps))} to NPS. The law allows up to 14% of basic + DA, which is ${inr(cap)}.`,
        action: `Ask HR to move ${inr(headroom)} a year out of your special allowance and into your NPS Tier-1 account. Your CTC does not change — only how it is labelled — but that portion stops being taxable salary.`,
        invest: 0,
        instruments: S['80CCD(2)'].instruments,
        lockIn: 'Until age 60 (partial withdrawal allowed after 3 years)',
        risk: 'Market-linked. You choose the equity/debt mix.',
        forms: ['Revised salary structure letter from HR', 'Form 12BB', 'PRAN (open an NPS Tier-1 account first)'],
        why: 'This is the single most valuable move under the new regime — it is the only large deduction that survived s.115BAC.',
        mutate: (p) => {
          p.salary.employerNps = n(p.salary.employerNps) + headroom;
          p.salary.otherAllowances = Math.max(0, n(p.salary.otherAllowances) - headroom);
        },
      });
    }
  }

  /* ---- RULE 2: 80C headroom (old regime only) ---- */
  if (isOld) {
    const used = n(d.sec80C) + n(d.epfEmployee) + n(h.principalRepaid);
    const headroom = Math.max(0, L.sec80C - used);
    if (headroom > 1000) {
      out.push({
        id: 'sec80c',
        title: `Fill the unused ${inr(headroom)} of your 80C limit`,
        section: '80C',
        category: 'Investment',
        finding: `You have used ${inr(used)} of the ${inr(L.sec80C)} available under 80C (your EPF and home loan principal already count towards this).`,
        action: `Invest ${inr(headroom)} before 31 March. For the shortest lock-in choose ELSS; for guaranteed safety choose PPF.`,
        invest: headroom,
        instruments: S['80C'].instruments,
        lockIn: S['80C'].lockIn,
        risk: 'ELSS is equity (volatile). PPF and NSC carry sovereign guarantee.',
        forms: ['Form 12BB', 'Investment proof (statement/receipt)'],
        why: 'The most widely used deduction in the Act, but it only exists in the old regime.',
        mutate: (p) => { p.deductions.sec80C = n(p.deductions.sec80C) + headroom; },
      });
    } else if (used > L.sec80C) {
      out.push({
        id: 'sec80c-waste',
        title: `You are over-investing in 80C by ${inr(used - L.sec80C)}`,
        section: '80C',
        category: 'Warning',
        informational: true,
        finding: `Your 80C contributions total ${inr(used)} but the ceiling is ${inr(L.sec80C)}.`,
        action: `The excess ${inr(used - L.sec80C)} gives you no tax benefit. Redirect it to NPS u/s 80CCD(1B), or to an investment you actually want on merit.`,
        invest: 0,
        forms: [],
        why: 'Locking money into a 5-year FD for a deduction you cannot claim is a pure loss of liquidity.',
      });
    }
  }

  /* ---- RULE 3: 80CCD(1B) — the extra Rs.50,000 NPS window ---- */
  if (isOld) {
    const headroom = Math.max(0, L.sec80CCD1B - n(d.sec80CCD1B));
    if (headroom > 1000) {
      out.push({
        id: 'nps-self',
        title: `Claim the extra ${inr(headroom)} NPS deduction`,
        section: '80CCD(1B)',
        category: 'Investment',
        finding: `You have claimed ${inr(n(d.sec80CCD1B))} of the ${inr(L.sec80CCD1B)} available.`,
        action: `Contribute ${inr(headroom)} to your own NPS Tier-1 account. This sits OVER the Rs.1.5 lakh 80C ceiling.`,
        invest: headroom,
        instruments: S['80CCD(1B)'].instruments,
        lockIn: S['80CCD(1B)'].lockIn,
        risk: 'Market-linked, long lock-in. Only worthwhile if you are genuinely saving for retirement.',
        forms: ['NPS transaction statement', 'Form 12BB'],
        why: 'Most taxpayers stop at 80C and never use this separate Rs.50,000 window.',
        mutate: (p) => { p.deductions.sec80CCD1B = n(p.deductions.sec80CCD1B) + headroom; },
      });
    }
  }

  /* ---- RULE 4: 80D health insurance — self ---- */
  if (isOld) {
    const cap = profile.ageBand === 'below60' ? L.sec80D_self : L.sec80D_selfSenior;
    const headroom = Math.max(0, cap - n(d.sec80D_self));
    if (headroom > 1000) {
      out.push({
        id: 'sec80d-self',
        title: 'Buy or top up health insurance for yourself and your family',
        section: '80D',
        category: 'Insurance',
        finding: `You claim ${inr(n(d.sec80D_self))} against a limit of ${inr(cap)}.`,
        action: `A premium of ${inr(headroom)} more is deductible. Include a preventive health check-up (up to Rs.5,000 within this limit — cash is allowed for this item only).`,
        invest: headroom,
        instruments: S['80D'].instruments,
        lockIn: 'None — annual premium',
        risk: 'None. This is protection you should own regardless of tax.',
        forms: ['Premium payment receipt', 'Form 12BB'],
        why: 'The only deduction that buys you something you genuinely need. Premiums must be paid by a non-cash mode.',
        mutate: (p) => { p.deductions.sec80D_self = n(p.deductions.sec80D_self) + headroom; },
      });
    }
  }

  /* ---- RULE 5: 80D health insurance — parents ---- */
  if (isOld) {
    const cap = d.parentsAreSenior ? L.sec80D_parentsSenior : L.sec80D_parents;
    const headroom = Math.max(0, cap - n(d.sec80D_parents));
    if (headroom > 1000) {
      out.push({
        id: 'sec80d-parents',
        title: "Insure your parents — a completely separate limit",
        section: '80D',
        category: 'Insurance',
        finding: `You claim ${inr(n(d.sec80D_parents))} for your parents against a limit of ${inr(cap)}${d.parentsAreSenior ? ' (senior citizen rate)' : ''}.`,
        action: `Pay ${inr(headroom)} more towards a health policy for your parents. They do NOT have to be financially dependent on you.`,
        invest: headroom,
        instruments: S['80D'].instruments,
        lockIn: 'None — annual premium',
        risk: 'None.',
        forms: ['Premium receipt in your name', 'Form 12BB'],
        why: 'This limit is over and above your own 80D limit. Together they can reach Rs.1,00,000.',
        mutate: (p) => { p.deductions.sec80D_parents = n(p.deductions.sec80D_parents) + headroom; },
      });
    }
  }

  /* ---- RULE 6: rent paid but no HRA in the salary structure ---- */
  if (n(profile.rent.paidAnnual) > 0 && n(s.hraReceived) === 0 && salaryBase > 0) {
    out.push({
      id: 'hra-missing',
      title: 'You pay rent but your salary has no HRA component',
      section: 'HRA / 80GG',
      category: 'Salary restructuring',
      zeroCost: true,
      finding: `You pay ${inr(n(profile.rent.paidAnnual))} in rent a year but receive no House Rent Allowance.`,
      action:
        'Ask HR to carve an HRA component out of your special allowance — this costs the employer nothing and the exemption u/s 10(13A) is far larger than 80GG. ' +
        'Until that happens, claim s.80GG (capped at Rs.60,000 a year) by filing Form 10BA.',
      invest: 0,
      instruments: S['HRA'].instruments,
      lockIn: 'None',
      risk: 'None. Keep rent receipts and a rent agreement.',
      forms: ['Form 10BA (for 80GG)', "Landlord's PAN if annual rent exceeds Rs.1,00,000", 'Rent receipts'],
      why: 'Only available in the old regime. 80GG is capped at Rs.60,000 while HRA exemption is often 3-4x that.',
      onlyRegime: 'old',
    });
  }

  /* ---- RULE 7: HRA claimed but rent not declared ---- */
  if (n(s.hraReceived) > 0 && n(profile.rent.paidAnnual) === 0 && isOld) {
    out.push({
      id: 'hra-unclaimed',
      title: 'You receive HRA but have declared no rent',
      section: '10(13A)',
      category: 'Warning',
      informational: true,
      finding: `Your salary includes ${inr(n(s.hraReceived))} of HRA, but no rent has been entered, so the entire amount is taxable.`,
      action:
        'If you actually pay rent, enter it and re-run the analysis — this is usually the single largest ' +
        'exemption available to a salaried tenant. And if you live with your parents in a house THEY own, ' +
        'you may pay them rent and claim HRA against it: they declare it as house property income, where ' +
        'a flat 30% is deductible u/s 24(a) and the balance is taxed at their slab, often a lower one.',
      invest: 0,
      when: 'Before the year ends',
      where: 'Your HR / payroll team, and your landlord',
      forms: ['Rent receipts', 'Registered rent agreement', "Landlord's PAN if annual rent exceeds Rs.1,00,000"],
      why:
        'Claiming HRA without genuinely paying rent is a false claim, and the department cross-checks the ' +
        "landlord's PAN against their return. If you pay rent to a parent, the money must actually move by " +
        'bank transfer and they must declare it — otherwise it is evasion, not planning.',
    });
  }

  /* ---- RULE 8: 80TTA / 80TTB interest deduction ---- */
  if (isOld) {
    if (profile.ageBand === 'below60') {
      const claimable = Math.min(n(o.savingsInterest), L.sec80TTA);
      if (claimable > 500) {
        out.push({
          id: 'sec80tta',
          title: `Claim ${inr(claimable)} of savings account interest`,
          section: '80TTA',
          category: 'Compliance',
          finding: `You earn ${inr(n(o.savingsInterest))} of savings bank interest.`,
          action: `Up to ${inr(L.sec80TTA)} of savings interest is deductible. This is already applied in the calculation — just make sure you actually enter it in Schedule OS when you file.`,
          invest: 0,
          informational: true,
          forms: ['Bank interest certificate', 'Reconcile with AIS'],
          why: 'Fixed deposit interest does not qualify — only savings account interest.',
        });
      }
    } else {
      const claimable = Math.min(n(o.savingsInterest) + n(o.fdInterest), L.sec80TTB);
      if (claimable > 500) {
        out.push({
          id: 'sec80ttb',
          title: `Senior citizen: claim ${inr(claimable)} of interest income`,
          section: '80TTB',
          category: 'Compliance',
          finding: `Your interest income is ${inr(n(o.savingsInterest) + n(o.fdInterest))}.`,
          action: `Claim up to ${inr(L.sec80TTB)} u/s 80TTB — this covers FIXED DEPOSIT interest too, not just savings interest. Also file Form 15H at your bank so they stop deducting TDS.`,
          invest: 0,
          informational: true,
          forms: ['Form 15H', 'Bank interest certificate'],
          why: '80TTB is five times more generous than 80TTA and covers all deposit interest.',
        });
      }
    }
  }

  /* ---- RULE 9: education loan interest ---- */
  if (isOld && n(d.sec80E) > 0) {
    out.push({
      id: 'sec80e',
      title: 'Your education loan interest has no upper limit',
      section: '80E',
      category: 'Compliance',
      informational: true,
      finding: `You are claiming ${inr(n(d.sec80E))} of education loan interest.`,
      action: 'Claim the entire interest paid — there is no monetary ceiling. Get the annual interest certificate from your bank, which splits interest from principal.',
      invest: 0,
      forms: ['Bank interest certificate', 'Form 12BB'],
      why: 'Available for 8 consecutive years from the year repayment begins. Principal repayment does NOT qualify.',
    });
  }

  /* ---- RULE 10: harvest the annual LTCG exemption ---- */
  {
    const usedExemption = n(profile.capitalGains && profile.capitalGains.ltcgEquity);
    const headroom = Math.max(0, Y.capitalGains.ltcg112A.exemption - usedExemption);
    if (headroom > 10000) {
      out.push({
        id: 'ltcg-harvest',
        title: `Harvest ${inr(headroom)} of tax-free equity gains before 31 March`,
        section: '112A',
        category: 'Capital gains',
        zeroCost: true,
        informational: true,
        finding: `You have booked ${inr(usedExemption)} of long-term equity gains this year, leaving ${inr(headroom)} of the annual exemption unused.`,
        action:
          `If you hold equity or equity mutual funds bought more than 12 months ago with unrealised profit, sell enough to book ${inr(headroom)} of gain and buy the same units back. ` +
          'Your cost base resets higher and the gain costs you nothing in tax.',
        invest: 0,
        instruments: S['112A'].instruments,
        lockIn: 'None',
        risk: 'You are out of the market for the settlement gap. Watch brokerage and STT costs.',
        forms: ['Broker capital gains statement', 'Schedule CG in the ITR'],
        why: 'The Rs.1.25 lakh exemption resets every year and cannot be carried forward. Unused, it is simply lost.',
      });
    }
  }

  /* ---- RULE 11: home loan interest wasted in the new regime ---- */
  if (h.status === 'selfOccupied' && n(h.loanInterest) > 0 && regime === 'new') {
    out.push({
      id: 'home-loan-new-regime',
      title: 'Your home loan interest is giving you nothing in the new regime',
      section: '24(b)',
      category: 'Warning',
      informational: true,
      finding: `You pay ${inr(n(h.loanInterest))} of home loan interest on a self-occupied house. Under the new regime this is not deductible at all.`,
      action: 'Compare the two regimes carefully below. If the property is genuinely let out (and you declare the rent), the interest becomes deductible even in the new regime — but the resulting loss still cannot be set off against salary.',
      invest: 0,
      forms: ['Bank provisional interest certificate'],
      why: 'This is the most common reason a home-loan borrower is better off in the old regime.',
    });
  }

  /* ---- RULE 12: 80G donations ---- */
  if (isOld && (n(d.sec80G_100) > 0 || n(d.sec80G_50) > 0)) {
    out.push({
      id: 'sec80g',
      title: 'Get Form 10BE for every donation you claim',
      section: '80G',
      category: 'Compliance',
      informational: true,
      finding: `You are claiming donations under 80G.`,
      action: 'Ask each institution for Form 10BE. Without it the deduction is disallowed, because the department now matches your claim against the donee\'s Form 10BD filing.',
      invest: 0,
      forms: ['Form 10BE', 'Donation receipt showing the 80G registration number'],
      why: 'Cash donations above Rs.2,000 are not deductible at all — always pay by bank transfer or UPI.',
    });
  }

  /* ---- RULE 13: presumptive taxation for freelancers / professionals ---- */
  if (n(b.grossReceipts) > 0) {
    const isPro = !!b.isProfessional;
    const ceiling = isPro ? 7500000 : 30000000;
    const rate = isPro ? 0.5 : 0.06;
    if (n(b.grossReceipts) <= ceiling) {
      const presumptive = n(b.grossReceipts) * rate;
      if (presumptive < n(b.netProfit)) {
        out.push({
          id: 'presumptive',
          title: `Declare income under the presumptive scheme (s.${isPro ? '44ADA' : '44AD'})`,
          section: isPro ? '44ADA' : '44AD',
          category: 'Business',
          finding: `Your gross receipts are ${inr(n(b.grossReceipts))} and you are declaring a profit of ${inr(n(b.netProfit))}. Under s.${isPro ? '44ADA' : '44AD'} you may declare just ${isPro ? '50%' : '6%'} — ${inr(presumptive)}.`,
          action: `Declare ${inr(presumptive)} as your profit. No books of account and no tax audit are required. File ITR-4 (Sugam).`,
          invest: 0,
          zeroCost: true,
          instruments: (S[isPro ? '44ADA' : '44AD'] || {}).instruments || [],
          lockIn: isPro ? 'None' : 'Must continue for 5 years once opted',
          risk: 'Keep receipts above 95% digital to stay within the higher turnover ceiling.',
          forms: ['ITR-4 (Sugam)'],
          why: 'The law lets you presume your expenses. If your real expenses are lower than the presumed figure, this is a large legitimate saving.',
          mutate: (p) => { p.business.netProfit = presumptive; },
        });
      }
    }
  }

  /* ---- RULE 14: disability deductions not claimed ---- */
  if (isOld && d.sec80U === 'none' && d.sec80DD === 'none') {
    out.push({
      id: 'disability-check',
      title: 'Check whether 80DD, 80DDB or 80U applies to your family',
      section: '80DD / 80DDB / 80U',
      category: 'Often missed',
      informational: true,
      finding: 'You have not claimed any disability or specified-disease deduction.',
      action: 'If you or a dependent has a certified disability of 40% or more, you get a FLAT deduction of Rs.75,000 (Rs.1,25,000 if severe) with no need to prove what you spent. If a dependent is being treated for a specified disease, s.80DDB gives up to Rs.1,00,000.',
      invest: 0,
      forms: ['Form 10-IA', 'Certificate from a notified medical authority'],
      why: 'These are flat deductions, not reimbursements — among the most under-claimed provisions in the Act.',
    });
  }

  /* ---- RULE 15: move deposit interest into a parent's lower slab ---- */
  const totalInterest = n(o.savingsInterest) + n(o.fdInterest);
  if (totalInterest > 25000) {
    out.push({
      id: 'gift-parents',
      title: "Move your deposit interest into your parents' hands",
      section: '56(2)(x) / 80TTB',
      category: 'Family planning',
      informational: true,
      zeroCost: true,
      finding: `You earn ${inr(totalInterest)} of bank interest, taxed at your marginal rate on top of your salary.`,
      action:
        'A gift to your parents is entirely exempt — parents are "relatives" under s.56(2)(x). ' +
        'Crucially, the clubbing provisions in s.64 apply only to a spouse and to minor children, ' +
        'never to parents. Once the money is genuinely theirs, the interest is taxed in their hands, not yours.',
      why:
        'A senior citizen gets a higher basic exemption, a Rs.50,000 deduction u/s 80TTB, and the s.87A rebate. ' +
        'If your parents have little other income, the very same interest can end up taxed at nil. ' +
        'The gift must be real and irreversible — you cannot keep control of the money.',
      when: 'Before 31 March',
      where: 'Your bank — transfer by cheque or NEFT, never cash',
      forms: ['A simple written gift deed', 'Form 15H for your parents', 'Their own income tax return'],
    });
  }

  /* ---- RULE 16: tax-loss harvesting against booked gains ---- */
  const anyGains = n(c.stcgEquity) + n(c.ltcgEquity) + n(c.ltcgOther) + n(c.stcgOther);
  if (anyGains > 0) {
    out.push({
      id: 'loss-harvest',
      title: 'Book your losing positions to cancel out these gains',
      section: '70 / 71 / 74',
      category: 'Capital gains',
      informational: true,
      zeroCost: true,
      finding: `You have booked ${inr(anyGains)} of capital gains this year.`,
      action:
        'Sell any holding sitting at a loss before 31 March. A SHORT-term capital loss can be set off ' +
        'against both short-term and long-term gains; a LONG-term loss can only be set off against ' +
        'long-term gains. Whatever is left over carries forward for 8 years.',
      why:
        'Carrying a loss forward requires you to file your return BY the due date. File even one day late ' +
        'and the loss is lost permanently.',
      when: 'Before 31 March',
      where: 'Your broker or fund house',
      forms: ['Broker capital gains statement', 'Schedule CFL in the ITR'],
    });
  }

  /* ---- RULE 17: home loan interest above the self-occupied cap ---- */
  if (isOld && h.status === 'selfOccupied' && n(h.loanInterest) > L.homeLoanInterestSelfOccupied) {
    const wasted = n(h.loanInterest) - L.homeLoanInterestSelfOccupied;
    out.push({
      id: 'joint-home-loan',
      title: `${inr(wasted)} of your home loan interest is going unused`,
      section: '24(b)',
      category: 'Often missed',
      informational: true,
      finding: `You pay ${inr(n(h.loanInterest))} of interest, but only ${inr(L.homeLoanInterestSelfOccupied)} is deductible on a self-occupied house.`,
      action:
        'If the property AND the loan are held jointly with a working spouse or parent, each co-owner ' +
        'claims up to Rs.2,00,000 separately against their own income — effectively doubling the deduction.',
      why:
        'Both conditions must hold: co-OWNER of the property and co-BORROWER on the loan. ' +
        'Being only a co-borrower is not enough, and the split follows the ownership share.',
      when: 'At purchase, or through a loan restructure',
      where: 'Your bank and the sub-registrar',
      forms: ['Interest certificate naming both borrowers', 'Property registration document'],
    });
  }

  /* ---- RULE 18: convert special allowance into bill-backed reimbursements ---- */
  if (isOld && n(s.otherAllowances) > 200000) {
    out.push({
      id: 'restructure-allowances',
      title: 'Convert part of your special allowance into reimbursements',
      section: '10(14) / Rule 3',
      category: 'Salary restructuring',
      informational: true,
      zeroCost: true,
      finding: `${inr(n(s.otherAllowances))} of your pay sits in special allowance, which is fully taxable rupee for rupee.`,
      action:
        'Ask HR to re-label part of it as bill-backed reimbursements — fuel and driver, telephone and ' +
        'internet, books and periodicals, and a meal card. Each is either exempt or valued concessionally ' +
        'when supported by actual bills.',
      why:
        'Your CTC does not change, only the labelling. This works in the OLD regime only — s.115BAC ' +
        'withdraws most of these exemptions. You must genuinely incur and submit the bills.',
      when: 'Before the next payroll cycle',
      where: 'Your HR / payroll team',
      forms: ['Revised salary structure letter', 'Monthly bills', 'Form 12BB'],
    });
  }

  /* ---- RULE 19: a Hindu Undivided Family is a second taxpayer ---- */
  if (n(b.grossReceipts) > 0 || h.status === 'letOut') {
    out.push({
      id: 'huf',
      title: 'Consider forming a Hindu Undivided Family',
      section: 'HUF — a separate assessee',
      category: 'Family planning',
      informational: true,
      finding: 'You have rental or business income that could legitimately be assessed as a separate taxpayer.',
      action:
        'An HUF is a distinct assessee with its OWN PAN, its own basic exemption, its own Rs.1.5 lakh ' +
        '80C limit and its own s.87A rebate. Ancestral property income, or a new venture, can be ' +
        'assessed in the HUF rather than in your personal hands.',
      why:
        'In effect a second set of slabs for the same family. Salary income can never be routed through ' +
        'an HUF, and partition is legally difficult to reverse — take professional advice before creating one.',
      when: 'Plan before the financial year begins',
      where: 'A Chartered Accountant, then apply for a PAN',
      forms: ['Form 49A (PAN for the HUF)', 'HUF deed', 'A separate ITR-2 or ITR-3'],
    });
  }

  return out;
}

/* ============================================================================
 * SEQUENTIAL EVALUATION — measure each rule on top of the previous ones
 * ========================================================================== */

/**
 * Applies every applicable rule for one regime, one after another, and reports
 * how much each step actually saved on top of the previous ones.
 */
function sequence(profile, regime, yearKey) {
  const baseTax = TaxEngine.computeRegime(profile, regime, yearKey).totalTax;
  const candidates = buildCandidates(profile, regime, yearKey).filter(
    (c) => !c.onlyRegime || c.onlyRegime === regime
  );

  const actionable = candidates.filter((c) => typeof c.mutate === 'function');
  const informational = candidates.filter((c) => typeof c.mutate !== 'function');

  // Rank by standalone impact before sequencing them.
  actionable.forEach((c) => {
    const p = clone(profile);
    c.mutate(p);
    c._standalone = Math.max(0, baseTax - TaxEngine.computeRegime(p, regime, yearKey).totalTax);
  });
  actionable.sort((a, b) => {
    // Zero-cost moves first (nothing to pay), then by size of saving.
    if (!!b.zeroCost !== !!a.zeroCost) return b.zeroCost ? 1 : -1;
    return b._standalone - a._standalone;
  });

  let running = clone(profile);
  let runningTax = baseTax;
  const recommendations = [];

  for (const c of actionable) {
    const next = clone(running);
    c.mutate(next);
    const nextTax = TaxEngine.computeRegime(next, regime, yearKey).totalTax;
    const saving = Math.max(0, runningTax - nextTax);
    if (saving <= 0 && !c.informational) continue; // no longer worth anything
    recommendations.push({ ...c, saving, taxAfter: nextTax });
    running = next;
    runningTax = nextTax;
  }

  for (const c of informational) recommendations.push({ ...c, saving: 0 });

  return {
    baseTax,
    recommendations,
    profile: running,
    result: TaxEngine.computeRegime(running, regime, yearKey),
    /** Everything the taxpayer would have to pay out to reach this position. */
    outlay: recommendations.reduce((s, r) => s + (r.invest || 0), 0),
  };
}

function generateAdvice(profile, yearKey) {
  const comparison = TaxEngine.compareRegimes(profile, yearKey);
  const regime = comparison.winner;
  const baseTax = comparison.best.totalTax;

  const seq = sequence(profile, regime, yearKey);
  const recommendations = seq.recommendations;
  const running = seq.profile;
  const optimised = seq.result;

  /* --- What if the taxpayer went all-in on the OTHER regime instead? ---
   * A regime that loses today can still win once every deduction is filled.
   * This answers the question the taxpayer always asks next. */
  const other = regime === 'new' ? 'old' : 'new';
  const otherSeq = sequence(profile, other, yearKey);
  const crossRegime = {
    chosen: regime,
    chosenBestTax: optimised.totalTax,
    chosenOutlay: seq.outlay,
    other,
    otherBestTax: otherSeq.result.totalTax,
    otherOutlay: otherSeq.outlay,
    stillBetter: optimised.totalTax <= otherSeq.result.totalTax,
  };
  const regimeSwitchSaving =
    comparison.winner === 'new' ? comparison.old.totalTax - comparison.new.totalTax
                                : comparison.new.totalTax - comparison.old.totalTax;

  return {
    yearKey,
    comparison,
    regime,
    baseTax,
    optimisedTax: optimised.totalTax,
    totalSaving: Math.max(0, baseTax - optimised.totalTax),
    regimeSwitchSaving: Math.max(0, regimeSwitchSaving),
    crossRegime,
    recommendations,
    optimisedProfile: running,
    optimisedResult: optimised,
    filing: filingRequirements(profile, regime, yearKey),
    advanceTax: TaxEngine.advanceTaxPlan(optimised.totalTax, profile.taxPaid && profile.taxPaid.tds, profile),
  };
}

/* ============================================================================
 * WHICH FORMS DOES THIS TAXPAYER ACTUALLY NEED?
 * ========================================================================== */

function filingRequirements(profile, regime, yearKey) {
  const F = RULEBOOK.forms;
  const Y = RULEBOOK.years[yearKey];
  const c = profile.capitalGains || {};
  const b = profile.business || {};
  const h = profile.house || {};
  const s = profile.salary || {};
  const d = profile.deductions || {};

  const result = TaxEngine.computeRegime(profile, regime, yearKey);
  const hasBusiness = n(b.netProfit) > 0 || n(b.grossReceipts) > 0;
  const specialCG = n(c.stcgEquity) + n(c.ltcgOther) + n(c.stcgOther);
  const ltcgEq = n(c.ltcgEquity);
  const hasCG = specialCG > 0 || ltcgEq > Y.capitalGains.ltcg112A.exemption;
  const income = result.totalIncome;

  /* ---- Pick the ITR form ---- */
  let itr;
  let itrReason;
  if (hasBusiness) {
    const presumptiveOk = n(b.grossReceipts) > 0 && income <= 5000000;
    if (presumptiveOk && !hasCG) {
      itr = 'ITR-4';
      itrReason = 'You have presumptive business or professional income and total income within Rs.50 lakh.';
    } else {
      itr = 'ITR-3';
      itrReason = 'You have income from a business or profession.';
    }
  } else if (hasCG || income > 5000000 || h.status === 'letOut' && n(h.rentReceived) > 0 && n(s.basic) === 0) {
    itr = 'ITR-2';
    itrReason = hasCG
      ? 'You have capital gains beyond what ITR-1 permits.'
      : 'Your total income exceeds Rs.50 lakh.';
  } else {
    itr = 'ITR-1';
    itrReason = 'Salary/pension, one house property and other sources, with total income within Rs.50 lakh.';
  }

  /* ---- Supporting forms ---- */
  const supporting = [];
  const add = (key, why) => { if (F[key]) supporting.push({ ...F[key], why }); };

  if (n(s.basic) > 0 || n(s.otherAllowances) > 0) {
    add('Form 16', 'Your employer must give you this TDS certificate for salary.');
    add('Form 12BB', 'Declare your investments and rent to your employer so excess TDS is not deducted.');
  }
  add('Form 26AS', 'Confirm every rupee of TDS credited against your PAN before you file.');
  add('AIS/TIS', 'Shows the interest, dividends and share trades the department already knows about. Mismatches trigger notices.');

  if (n(o_(profile).fdInterest) > 0 || n(o_(profile).savingsInterest) > 0) {
    add('Form 16A', 'TDS certificate from your bank for interest income.');
    if (profile.ageBand !== 'below60') add('Form 15H', 'Stops your bank deducting TDS if your final liability is nil.');
    else add('Form 15G', 'Only if your total income is below the taxable limit.');
  }

  if (regime === 'old' && hasBusiness) {
    add('Form 10-IEA', 'MANDATORY. With business income you must file this to opt out of the new regime and use the old regime. Salaried taxpayers without business income simply tick the option inside the ITR.');
  }

  if (regime === 'old' && n(profile.rent.paidAnnual) > 0 && n(s.hraReceived) === 0) {
    add('Form 10BA', 'Mandatory declaration to claim the s.80GG deduction for rent paid.');
  }

  if (regime === 'old' && (d.sec80U !== 'none' || d.sec80DD !== 'none')) {
    add('Form 10-IA', 'Disability certificate required for s.80DD or s.80U.');
  }

  if (regime === 'old' && (n(d.sec80G_100) > 0 || n(d.sec80G_50) > 0)) {
    add('Form 10BE', 'Certificate from the donee institution — without it your 80G claim is disallowed.');
  }

  if (hasCG) add('Challan 280', 'Capital gains are not covered by salary TDS — you will usually need to pay advance or self-assessment tax.');

  return {
    itr: { ...F[itr], key: itr, reason: itrReason },
    supporting,
    calendar: RULEBOOK.calendar,
  };
}

const o_ = (p) => p.other || {};

/* ============================================================================
 * DOCUMENT CHECKLIST — what the user must collect
 * ========================================================================== */

function documentChecklist(profile, regime) {
  const s = profile.salary || {};
  const d = profile.deductions || {};
  const h = profile.house || {};
  const list = [
    { doc: 'PAN and Aadhaar (linked)', why: 'Filing is blocked if PAN and Aadhaar are not linked.' },
    { doc: 'Bank account details with IFSC', why: 'Pre-validated account is required to receive a refund.' },
    { doc: 'Form 26AS and AIS download', why: 'Reconcile before filing — mismatches are the top cause of notices.' },
  ];
  if (n(s.basic) > 0) list.push({ doc: 'Form 16 from every employer during the year', why: 'If you changed jobs, you need Form 16 from each.' });
  if (regime === 'old') {
    list.push({ doc: 'Investment proofs — ELSS/PPF/LIC/NSC statements', why: 'To substantiate 80C.' });
    list.push({ doc: 'Health insurance premium receipts', why: 'To substantiate 80D.' });
    if (n(profile.rent.paidAnnual) > 0) list.push({ doc: "Rent receipts, rent agreement, landlord's PAN", why: 'Landlord PAN is mandatory if annual rent exceeds Rs.1,00,000.' });
    if (n(h.loanInterest) > 0) list.push({ doc: 'Home loan interest certificate from the bank', why: 'Splits your EMI into principal (80C) and interest (24b).' });
    if (n(d.sec80E) > 0) list.push({ doc: 'Education loan interest certificate', why: 'To substantiate 80E.' });
  }
  const c = profile.capitalGains || {};
  if (n(c.ltcgEquity) + n(c.stcgEquity) + n(c.ltcgOther) + n(c.stcgOther) > 0) {
    list.push({ doc: 'Broker / AMC capital gains statement for the full year', why: 'Needed to fill Schedule CG scrip-wise.' });
  }
  return list;
}

window.Advisor = { generateAdvice, documentChecklist, buildCandidates, sequence, inr };
