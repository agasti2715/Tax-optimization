/* ============================================================================
 * rulebook.js — THE AGENT'S KNOWLEDGE BASE
 * ----------------------------------------------------------------------------
 * Every number the agent uses to compute tax lives here, and nowhere else.
 * The engine (engine.js) and the advisor (advisor.js) read from this file;
 * they never hard-code a rate or a limit.
 *
 * Why it is built this way:
 *   Indian tax rates change every year with the Finance Act. By keeping the
 *   rates as DATA rather than as CODE, updating the agent for a new financial
 *   year means editing this one file — not rewriting the logic.
 *
 * Statutory basis for the FY 2025-26 figures below:
 *   - Income-tax Act, 1961
 *   - Finance Act, 2025 (new-regime slabs, s.87A rebate of Rs.60,000)
 *   - Finance (No.2) Act, 2024 (capital gains overhaul w.e.f. 23-07-2024)
 *
 * !! VERIFY BEFORE ANY REAL-WORLD USE !!
 *   Confirm every figure against incometax.gov.in for the year you are filing.
 *   See README.md -> "Accuracy and limitations".
 * ========================================================================== */

const RULEBOOK = {
  meta: {
    version: '1.1.1',
    defaultYear: 'FY2025-26',
    disclaimer:
      'Educational project. Not professional tax advice. Verify every figure ' +
      'with a qualified Chartered Accountant before acting.',
  },

  /* ==========================================================================
   * PART 1 — YEAR-WISE RATE CARDS
   * ======================================================================== */
  years: {
    'FY2025-26': {
      label: 'FY 2025-26 (AY 2026-27)',
      note: 'Return being filed in 2026. Slabs per Finance Act 2025.',

      /* ---- NEW REGIME — s.115BAC(1A). This is the DEFAULT regime. ---- */
      newRegime: {
        slabs: [
          { upto: 400000, rate: 0.0 },
          { upto: 800000, rate: 0.05 },
          { upto: 1200000, rate: 0.1 },
          { upto: 1600000, rate: 0.15 },
          { upto: 2000000, rate: 0.2 },
          { upto: 2400000, rate: 0.25 },
          { upto: Infinity, rate: 0.3 },
        ],
        standardDeduction: 75000, // s.16(ia), salary/pension
        familyPensionDeduction: 25000, // s.57(iia)
        rebate87A: { incomeLimit: 1200000, maxRebate: 60000, marginalRelief: true },
        // Surcharge is capped at 25% under the new regime (no 37% band).
        surcharge: [
          { above: 5000000, rate: 0.1 },
          { above: 10000000, rate: 0.15 },
          { above: 20000000, rate: 0.25 },
        ],
        cess: 0.04, // Health & Education Cess
      },

      /* ---- OLD REGIME — the classic slabs with all deductions ---- */
      oldRegime: {
        slabsByAge: {
          below60: [
            { upto: 250000, rate: 0.0 },
            { upto: 500000, rate: 0.05 },
            { upto: 1000000, rate: 0.2 },
            { upto: Infinity, rate: 0.3 },
          ],
          senior: [
            // 60 to 79 years
            { upto: 300000, rate: 0.0 },
            { upto: 500000, rate: 0.05 },
            { upto: 1000000, rate: 0.2 },
            { upto: Infinity, rate: 0.3 },
          ],
          superSenior: [
            // 80 years and above
            { upto: 500000, rate: 0.0 },
            { upto: 1000000, rate: 0.2 },
            { upto: Infinity, rate: 0.3 },
          ],
        },
        standardDeduction: 50000, // s.16(ia)
        professionalTaxCap: 2500, // s.16(iii)
        familyPensionDeduction: 15000, // s.57(iia)
        rebate87A: { incomeLimit: 500000, maxRebate: 12500, marginalRelief: false },
        surcharge: [
          { above: 5000000, rate: 0.1 },
          { above: 10000000, rate: 0.15 },
          { above: 20000000, rate: 0.25 },
          { above: 50000000, rate: 0.37 },
        ],
        cess: 0.04,
      },

      /* ---- CAPITAL GAINS — post 23-07-2024 regime ---- */
      capitalGains: {
        stcg111A: 0.2, // listed equity / equity MF with STT
        ltcg112A: { rate: 0.125, exemption: 125000 }, // listed equity / equity MF
        ltcgOther: 0.125, // s.112, without indexation
        note:
          'Holding period: 12 months for listed securities, 24 months for all ' +
          'other assets. Debt MFs bought on/after 01-04-2023 are always taxed ' +
          'at slab rates regardless of holding period.',
      },

      /* ---- DEDUCTION CEILINGS (old regime unless flagged otherwise) ---- */
      limits: {
        sec80C: 150000, // combined 80C + 80CCC + 80CCD(1) via s.80CCE
        sec80CCD1B: 50000, // additional NPS
        sec80CCD2_private: 0.14, // % of salary — allowed in BOTH regimes
        sec80CCD2_govt: 0.14,
        sec80D_self: 25000,
        sec80D_selfSenior: 50000,
        sec80D_parents: 25000,
        sec80D_parentsSenior: 50000,
        sec80D_preventiveCheckup: 5000, // within the above limits
        sec80DD_normal: 75000,
        sec80DD_severe: 125000,
        sec80DDB_normal: 40000,
        sec80DDB_senior: 100000,
        sec80U_normal: 75000,
        sec80U_severe: 125000,
        sec80EEB: 150000, // EV loan interest (loan sanctioned up to 31-03-2023)
        sec80TTA: 10000, // savings interest, age < 60
        sec80TTB: 50000, // all interest, age >= 60
        sec80GG_monthlyCap: 5000, // rent paid, no HRA received
        homeLoanInterestSelfOccupied: 200000, // s.24(b)
        housePropertyLossSetOff: 200000, // s.71(3A) annual cap
        hraMetroRate: 0.5,
        hraNonMetroRate: 0.4,
      },
    },

    'FY2024-25': {
      label: 'FY 2024-25 (AY 2025-26)',
      note: 'Previous year. Kept for comparison and belated/revised returns.',
      newRegime: {
        slabs: [
          { upto: 300000, rate: 0.0 },
          { upto: 700000, rate: 0.05 },
          { upto: 1000000, rate: 0.1 },
          { upto: 1200000, rate: 0.15 },
          { upto: 1500000, rate: 0.2 },
          { upto: Infinity, rate: 0.3 },
        ],
        standardDeduction: 75000,
        familyPensionDeduction: 25000,
        rebate87A: { incomeLimit: 700000, maxRebate: 25000, marginalRelief: true },
        surcharge: [
          { above: 5000000, rate: 0.1 },
          { above: 10000000, rate: 0.15 },
          { above: 20000000, rate: 0.25 },
        ],
        cess: 0.04,
      },
      oldRegime: {
        slabsByAge: {
          below60: [
            { upto: 250000, rate: 0.0 },
            { upto: 500000, rate: 0.05 },
            { upto: 1000000, rate: 0.2 },
            { upto: Infinity, rate: 0.3 },
          ],
          senior: [
            { upto: 300000, rate: 0.0 },
            { upto: 500000, rate: 0.05 },
            { upto: 1000000, rate: 0.2 },
            { upto: Infinity, rate: 0.3 },
          ],
          superSenior: [
            { upto: 500000, rate: 0.0 },
            { upto: 1000000, rate: 0.2 },
            { upto: Infinity, rate: 0.3 },
          ],
        },
        standardDeduction: 50000,
        professionalTaxCap: 2500,
        familyPensionDeduction: 15000,
        rebate87A: { incomeLimit: 500000, maxRebate: 12500, marginalRelief: false },
        surcharge: [
          { above: 5000000, rate: 0.1 },
          { above: 10000000, rate: 0.15 },
          { above: 20000000, rate: 0.25 },
          { above: 50000000, rate: 0.37 },
        ],
        cess: 0.04,
      },
      capitalGains: {
        stcg111A: 0.2,
        ltcg112A: { rate: 0.125, exemption: 125000 },
        ltcgOther: 0.125,
        note: 'Rates changed mid-year on 23-07-2024; this card uses the post-change rates.',
      },
      limits: {
        sec80C: 150000,
        sec80CCD1B: 50000,
        sec80CCD2_private: 0.14,
        sec80CCD2_govt: 0.14,
        sec80D_self: 25000,
        sec80D_selfSenior: 50000,
        sec80D_parents: 25000,
        sec80D_parentsSenior: 50000,
        sec80D_preventiveCheckup: 5000,
        sec80DD_normal: 75000,
        sec80DD_severe: 125000,
        sec80DDB_normal: 40000,
        sec80DDB_senior: 100000,
        sec80U_normal: 75000,
        sec80U_severe: 125000,
        sec80EEB: 150000,
        sec80TTA: 10000,
        sec80TTB: 50000,
        sec80GG_monthlyCap: 5000,
        homeLoanInterestSelfOccupied: 200000,
        housePropertyLossSetOff: 200000,
        hraMetroRate: 0.5,
        hraNonMetroRate: 0.4,
      },
    },
  },

  /* ==========================================================================
   * PART 2 — SECTION LIBRARY
   * Everything the agent knows about each tax-saving section: what it is,
   * which regime it survives in, what you must buy, how long your money is
   * locked, and which form proves the claim.
   * ======================================================================== */
  sections: {
    '80C': {
      title: 'Investments & specified payments',
      limit: 150000,
      regimes: ['old'],
      lockIn: '3 years (ELSS) to 15 years (PPF)',
      instruments: [
        'ELSS mutual funds — 3-year lock-in, equity returns, shortest lock-in in 80C',
        'PPF — 15 years, currently tax-free interest, sovereign safety',
        'EPF employee contribution — already deducted from your salary, counts automatically',
        'Life insurance premium — for self, spouse, children',
        'Sukanya Samriddhi Yojana — girl child under 10',
        '5-year tax-saver fixed deposit',
        'NSC (National Savings Certificate)',
        'Home loan PRINCIPAL repayment',
        'Tuition fees — up to 2 children, full-time courses in India',
        'Stamp duty & registration charges on house purchase',
      ],
      forms: ['Form 12BB (declare to employer)', 'Investment proofs', 'Form 16 Part B'],
      note: 'Shared ceiling with 80CCC and 80CCD(1) under s.80CCE — all three together cap at Rs.1.5 lakh.',
    },
    '80CCD(1B)': {
      title: 'Additional NPS contribution',
      limit: 50000,
      regimes: ['old'],
      lockIn: 'Until age 60',
      instruments: ['NPS Tier-1 account — self contribution over and above 80C'],
      forms: ['NPS transaction statement', 'PRAN details', 'Form 12BB'],
      note: 'This Rs.50,000 sits OVER the Rs.1.5 lakh 80C ceiling — a genuinely extra deduction.',
    },
    '80CCD(2)': {
      title: 'Employer contribution to NPS',
      limit: 'Up to 14% of salary (basic + DA)',
      regimes: ['old', 'new'],
      lockIn: 'Until age 60',
      instruments: ['Employer routes part of your CTC into your NPS Tier-1 account'],
      forms: ['Salary structure letter', 'Form 16 Part B', 'Form 12BB'],
      note:
        'THE MOST IMPORTANT SECTION IN THE NEW REGIME. It is the only major ' +
        'deduction that survives in the new regime. Requires your employer to ' +
        'restructure your CTC — it costs the employer nothing extra.',
    },
    '80D': {
      title: 'Health insurance premium',
      limit: 'Rs.25,000 self+family; Rs.50,000 if senior; plus the same again for parents',
      regimes: ['old'],
      lockIn: 'None — annual premium',
      instruments: [
        'Health insurance for self, spouse, dependent children',
        'Health insurance for parents (separate limit, even if they are not dependent)',
        'Preventive health check-up — Rs.5,000 within the limit, cash allowed',
      ],
      forms: ['Premium receipts', 'Form 12BB'],
      note: 'Maximum possible is Rs.1,00,000 when both you and your parents are senior citizens.',
    },
    '80DD': {
      title: 'Maintenance of a disabled dependent',
      limit: 'Rs.75,000 (40-79% disability) / Rs.1,25,000 (80%+)',
      regimes: ['old'],
      lockIn: 'None',
      instruments: ['Expenditure on treatment/training, or LIC/UTI scheme for the dependent'],
      forms: ['Form 10-IA (disability certificate)', 'Medical authority certificate'],
      note: 'Flat deduction — you get the full amount regardless of what you actually spent.',
    },
    '80DDB': {
      title: 'Treatment of specified diseases',
      limit: 'Rs.40,000 (Rs.1,00,000 if the patient is a senior citizen)',
      regimes: ['old'],
      lockIn: 'None',
      instruments: ['Actual expenditure on cancer, chronic renal failure, neurological ailments etc.'],
      forms: ['Prescription from a specialist', 'Form 10-I equivalent certificate'],
      note: 'Reduce the claim by any amount reimbursed by insurance or your employer.',
    },
    '80E': {
      title: 'Interest on education loan',
      limit: 'No monetary ceiling',
      regimes: ['old'],
      lockIn: '8 assessment years from the year repayment starts',
      instruments: ['Interest on a loan for higher education — self, spouse, children'],
      forms: ['Bank interest certificate', 'Form 12BB'],
      note: 'Only INTEREST qualifies, not principal. Loan must be from a bank or approved institution.',
    },
    '80EEB': {
      title: 'Interest on electric vehicle loan',
      limit: 150000,
      regimes: ['old'],
      lockIn: 'Loan tenure',
      instruments: ['Interest on a loan to buy an electric vehicle'],
      forms: ['Bank interest certificate', 'Vehicle registration'],
      note: 'Sunset clause — only for loans SANCTIONED on or before 31-03-2023.',
    },
    '80G': {
      title: 'Donations to charity',
      limit: '50% or 100% of the donation, some subject to a 10%-of-adjusted-GTI cap',
      regimes: ['old'],
      lockIn: 'None',
      instruments: ['PM CARES / PM National Relief Fund (100%)', 'Registered NGOs (usually 50%)'],
      forms: ['Form 10BE (certificate the institution must issue you)', 'Donation receipt with 80G registration number'],
      note: 'Cash donations above Rs.2,000 are NOT allowed. Pay by cheque, UPI or bank transfer.',
    },
    '80GG': {
      title: 'Rent paid when you get no HRA',
      limit: 'Least of Rs.60,000/yr, 25% of total income, or rent minus 10% of total income',
      regimes: ['old'],
      lockIn: 'None',
      instruments: ['Rent paid for your own accommodation'],
      forms: ['Form 10BA (mandatory declaration)', 'Rent receipts'],
      note: 'Not available if you, your spouse or your minor child owns a house in the same city.',
    },
    '80TTA': {
      title: 'Savings bank interest',
      limit: 10000,
      regimes: ['old'],
      lockIn: 'None',
      instruments: ['Interest on savings accounts — bank, co-operative, post office'],
      forms: ['Bank interest certificate', 'AIS reconciliation'],
      note: 'Savings interest only. Fixed deposit interest does NOT qualify.',
    },
    '80TTB': {
      title: 'Interest income for senior citizens',
      limit: 50000,
      regimes: ['old'],
      lockIn: 'None',
      instruments: ['Interest from savings AND fixed deposits AND recurring deposits'],
      forms: ['Form 15H (to stop TDS)', 'Bank interest certificate'],
      note: 'Replaces 80TTA once you turn 60, and is 5x more generous.',
    },
    '80U': {
      title: 'Deduction for a taxpayer with a disability',
      limit: 'Rs.75,000 (40-79%) / Rs.1,25,000 (80%+)',
      regimes: ['old'],
      lockIn: 'None',
      instruments: ['Flat deduction — no expenditure proof needed'],
      forms: ['Form 10-IA', 'Certificate from a notified medical authority'],
      note: 'Claimed by the disabled taxpayer personally (80DD is for a disabled DEPENDENT).',
    },
    '24(b)': {
      title: 'Home loan interest',
      limit: 'Rs.2,00,000 for a self-occupied house; no cap for a let-out house',
      regimes: ['old (self-occupied)', 'new (let-out only)'],
      lockIn: 'Loan tenure',
      instruments: ['Interest component of your home loan EMI'],
      forms: ['Bank provisional interest certificate', 'Form 12BB'],
      note:
        'Under the new regime, interest on a SELF-OCCUPIED house gives you nothing. ' +
        'Interest on a LET-OUT house is still deductible, but the resulting loss ' +
        'cannot be set off against salary.',
    },
    'HRA': {
      title: 'House Rent Allowance exemption — s.10(13A)',
      limit: 'Least of: actual HRA / rent minus 10% of salary / 50% of salary (metro) or 40% (non-metro)',
      regimes: ['old'],
      lockIn: 'None',
      instruments: ['Rent actually paid for accommodation you do not own'],
      forms: ['Rent receipts', "Landlord's PAN if annual rent exceeds Rs.1,00,000", 'Form 12BB'],
      note: 'Metro means Delhi, Mumbai, Kolkata or Chennai only — Bengaluru and Pune count as non-metro.',
    },
    '112A': {
      title: 'Long-term capital gains on listed equity',
      limit: 'First Rs.1,25,000 of gains each year is exempt; the rest is taxed at 12.5%',
      regimes: ['old', 'new'],
      lockIn: '12 months to qualify as long-term',
      instruments: ['Listed shares', 'Equity mutual funds', 'Units of a business trust'],
      forms: ['Schedule CG in the ITR', 'Broker capital gains statement'],
      note: 'The Rs.1,25,000 exemption resets every year — it cannot be carried forward.',
    },
    '54EC': {
      title: 'Capital gains bonds',
      limit: 'Rs.50,00,000 per financial year',
      regimes: ['old', 'new'],
      lockIn: '5 years',
      instruments: ['NHAI, REC, PFC and IRFC bonds'],
      forms: ['Bond certificate', 'Schedule CG'],
      note: 'Must be invested within 6 months of the sale. Applies to gains from land or buildings.',
    },
    '54F': {
      title: 'Reinvesting capital gains in a house',
      limit: 'Capped at a Rs.10 crore investment',
      regimes: ['old', 'new'],
      lockIn: '3 years',
      instruments: ['Buy a residential house within 2 years, or construct within 3 years'],
      forms: ['Capital Gains Account Scheme deposit proof if not reinvested before the due date', 'Schedule CG'],
      note: 'You must not own more than one other residential house on the date of sale.',
    },
    '44ADA': {
      title: 'Presumptive taxation for professionals',
      limit: 'Gross receipts up to Rs.75,00,000',
      regimes: ['old', 'new'],
      lockIn: 'None',
      instruments: ['Declare 50% of gross receipts as profit; the other 50% is treated as expenses'],
      forms: ['ITR-4 (Sugam)'],
      note:
        'For doctors, lawyers, architects, engineers, accountants, technical ' +
        'consultants, interior designers. The Rs.75 lakh ceiling applies only if ' +
        'cash receipts are 5% or less of turnover.',
    },
    '44AD': {
      title: 'Presumptive taxation for small business',
      limit: 'Turnover up to Rs.3,00,00,000',
      regimes: ['old', 'new'],
      lockIn: 'Must continue for 5 years once opted',
      instruments: ['Declare 6% of digital turnover (or 8% of cash turnover) as profit'],
      forms: ['ITR-4 (Sugam)'],
      note: 'No books of account and no tax audit required. The Rs.3 crore ceiling needs cash receipts of 5% or less.',
    },
  },

  /* ==========================================================================
   * PART 3 — GOVERNMENT FORMS DIRECTORY
   * The agent names the exact form for every action it recommends.
   * ======================================================================== */
  forms: {
    'ITR-1': {
      name: 'ITR-1 (Sahaj)',
      who: 'Resident individual, total income up to Rs.50 lakh, from salary/pension, ONE house property, other sources, and LTCG u/s 112A up to Rs.1.25 lakh',
      where: 'incometax.gov.in — e-Filing portal',
      due: '31 July',
    },
    'ITR-2': {
      name: 'ITR-2',
      who: 'Individuals with capital gains, more than one house property, foreign income or assets, or total income above Rs.50 lakh — but NO business income',
      where: 'incometax.gov.in — e-Filing portal',
      due: '31 July',
    },
    'ITR-3': {
      name: 'ITR-3',
      who: 'Individuals and HUFs with income from a business or profession (including F&O trading)',
      where: 'incometax.gov.in — e-Filing portal',
      due: '31 July (31 October if a tax audit applies)',
    },
    'ITR-4': {
      name: 'ITR-4 (Sugam)',
      who: 'Residents opting for presumptive taxation under s.44AD, 44ADA or 44AE, with total income up to Rs.50 lakh',
      where: 'incometax.gov.in — e-Filing portal',
      due: '31 July',
    },
    'Form 16': {
      name: 'Form 16',
      who: 'Every salaried employee — your employer must issue it',
      where: 'From your employer by 15 June',
      due: 'Received, not filed',
    },
    'Form 16A': {
      name: 'Form 16A',
      who: 'TDS certificate for non-salary income — bank interest, professional fees, rent',
      where: 'From the deductor, or download from TRACES',
      due: 'Received, not filed',
    },
    'Form 26AS': {
      name: 'Form 26AS',
      who: 'Everyone — your consolidated annual tax statement',
      where: 'incometax.gov.in — e-File > Income Tax Returns > View Form 26AS',
      due: 'Check before filing',
    },
    'AIS/TIS': {
      name: 'Annual Information Statement / Taxpayer Information Summary',
      who: 'Everyone — shows every transaction the department already knows about',
      where: 'incometax.gov.in — Services > AIS',
      due: 'Reconcile before filing; submit feedback on wrong entries',
    },
    'Form 12BB': {
      name: 'Form 12BB',
      who: 'Salaried employees declaring investments and rent to their employer',
      where: 'Submit to your employer, usually in January',
      due: 'Before the financial year ends, so TDS is adjusted',
    },
    'Form 12BAA': {
      name: 'Form 12BAA',
      who: 'Salaried employees who want TDS/TCS paid elsewhere adjusted against salary TDS',
      where: 'Submit to your employer',
      due: 'During the financial year',
    },
    'Form 10-IEA': {
      name: 'Form 10-IEA',
      who: 'Anyone WITH business or professional income who wants to opt OUT of the new regime and use the old regime',
      where: 'incometax.gov.in — e-File > Income Tax Forms',
      due: 'On or before the ITR due date. Salaried people without business income simply choose the regime inside the ITR.',
    },
    'Form 10E': {
      name: 'Form 10E',
      who: 'Anyone claiming relief u/s 89(1) on salary arrears, gratuity or leave encashment',
      where: 'incometax.gov.in — e-File > Income Tax Forms',
      due: 'MUST be filed BEFORE the ITR, otherwise the relief is disallowed',
    },
    'Form 10BA': {
      name: 'Form 10BA',
      who: 'Anyone claiming a deduction u/s 80GG for rent paid without HRA',
      where: 'incometax.gov.in — e-File > Income Tax Forms',
      due: 'Before filing the ITR',
    },
    'Form 10-IA': {
      name: 'Form 10-IA',
      who: 'Anyone claiming s.80DD or s.80U for a disability',
      where: 'Certificate from a notified medical authority, uploaded on the portal',
      due: 'Before filing the ITR',
    },
    'Form 10BE': {
      name: 'Form 10BE',
      who: 'Anyone claiming s.80G — the donee institution issues this certificate to you',
      where: 'Issued by the charitable institution',
      due: 'By 31 May following the donation year',
    },
    'Form 15G': {
      name: 'Form 15G',
      who: 'Individuals below 60 whose total income is below the taxable limit, to stop TDS on interest',
      where: 'Submit to your bank at the start of the financial year',
      due: 'April, and on every new deposit',
    },
    'Form 15H': {
      name: 'Form 15H',
      who: 'Senior citizens (60+) whose final tax is nil, to stop TDS on interest',
      where: 'Submit to your bank at the start of the financial year',
      due: 'April, and on every new deposit',
    },
    'Form 67': {
      name: 'Form 67',
      who: 'Anyone claiming Foreign Tax Credit on income taxed abroad',
      where: 'incometax.gov.in — e-File > Income Tax Forms',
      due: 'On or before the ITR filing due date',
    },
    'Challan 280': {
      name: 'Challan ITNS-280',
      who: 'Anyone paying advance tax or self-assessment tax',
      where: 'incometax.gov.in — e-Pay Tax',
      due: 'Advance tax: 15 Jun / 15 Sep / 15 Dec / 15 Mar',
    },
    'ITR-U': {
      name: 'ITR-U (Updated Return)',
      who: 'Anyone who missed something and wants to correct a past return',
      where: 'incometax.gov.in — e-Filing portal',
      due: 'Up to 48 months from the end of the assessment year, with additional tax',
    },
  },

  /* ==========================================================================
   * PART 4 — COMPLIANCE CALENDAR
   * ======================================================================== */
  calendar: [
    { date: '15 June', event: '1st advance tax instalment — 15% of your estimated liability' },
    { date: '15 June', event: 'Employer must issue Form 16 for the previous financial year' },
    { date: '15 September', event: '2nd advance tax instalment — cumulative 45%' },
    { date: '15 December', event: '3rd advance tax instalment — cumulative 75%' },
    { date: '15 March', event: '4th advance tax instalment — cumulative 100%' },
    { date: '31 March', event: 'LAST DAY to make tax-saving investments for the financial year' },
    { date: '31 July', event: 'ITR filing due date for individuals not subject to audit' },
    { date: '31 October', event: 'ITR filing due date where a tax audit applies' },
    { date: '31 December', event: 'Last date for a belated or revised return' },
  ],

  /* Advance tax instalment schedule — s.211, used to build the payment plan. */
  advanceTax: {
    threshold: 10000, // no advance tax if liability after TDS is below this
    schedule: [
      { by: '15 June', cumulative: 0.15 },
      { by: '15 September', cumulative: 0.45 },
      { by: '15 December', cumulative: 0.75 },
      { by: '15 March', cumulative: 1.0 },
    ],
    seniorExemption: 'A resident senior citizen with no business income is exempt from advance tax (s.207).',
  },
};

/* Expose to the other scripts (plain global — no bundler needed). */
window.RULEBOOK = RULEBOOK;
