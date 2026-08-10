/* ============================================================================
 * samples.js — DEMO PROFILES
 * ----------------------------------------------------------------------------
 * Four taxpayers chosen so that between them they exercise every branch of the
 * engine: regime choice, HRA, home loan, capital gains, senior citizen rules,
 * presumptive taxation and surcharge.
 *
 * Load any of these from the "Load a sample" dropdown during the demo.
 * ========================================================================== */

function blankProfile() {
  return {
    name: '',
    ageBand: 'below60', // below60 | senior | superSenior
    city: 'metro', // metro | nonmetro
    employmentType: 'salaried',

    salary: {
      basic: 0,
      da: 0,
      hraReceived: 0,
      otherAllowances: 0,
      employerNps: 0,
      professionalTax: 0,
      exemptAllowances: 0, // LTA and other s.10(14) exemptions actually claimed
    },

    rent: { paidAnnual: 0 },

    house: {
      status: 'none', // none | selfOccupied | letOut
      loanInterest: 0,
      principalRepaid: 0,
      rentReceived: 0,
      municipalTax: 0,
    },

    business: { netProfit: 0, grossReceipts: 0, isProfessional: false },

    capitalGains: { stcgEquity: 0, ltcgEquity: 0, stcgOther: 0, ltcgOther: 0 },

    other: { savingsInterest: 0, fdInterest: 0, dividend: 0, familyPension: 0, misc: 0 },

    deductions: {
      sec80C: 0,
      epfEmployee: 0,
      sec80CCD1B: 0,
      sec80D_self: 0,
      sec80D_parents: 0,
      parentsAreSenior: false,
      sec80DD: 'none', // none | normal | severe
      sec80DDB: 0,
      sec80U: 'none',
      sec80E: 0,
      sec80EEB: 0,
      sec80G_100: 0,
      sec80G_50: 0,
    },

    taxPaid: { tds: 0, advanceTax: 0 },
  };
}

const SAMPLES = {
  /* ------------------------------------------------------------------------
   * SAMPLE A — the main demo case. Use this one in front of the teacher.
   * A software engineer in Mumbai who assumes the old regime is better
   * because "everyone says invest in 80C". The agent proves otherwise.
   * ---------------------------------------------------------------------- */
  priya: Object.assign(blankProfile(), {
    name: 'Priya Sharma — Software Engineer, Mumbai',
    ageBand: 'below60',
    city: 'metro',
    employmentType: 'salaried',
    salary: {
      basic: 600000,
      da: 0,
      hraReceived: 300000,
      otherAllowances: 500000,
      employerNps: 0,
      professionalTax: 2500,
      exemptAllowances: 0,
    },
    rent: { paidAnnual: 240000 }, // Rs.20,000 a month
    house: { status: 'none', loanInterest: 0, principalRepaid: 0, rentReceived: 0, municipalTax: 0 },
    business: { netProfit: 0, grossReceipts: 0, isProfessional: false },
    capitalGains: { stcgEquity: 0, ltcgEquity: 0, stcgOther: 0, ltcgOther: 0 },
    other: { savingsInterest: 12000, fdInterest: 40000, dividend: 0, familyPension: 0, misc: 0 },
    deductions: Object.assign(blankProfile().deductions, {
      sec80C: 25000, // LIC premium
      epfEmployee: 72000, // 12% of basic
      sec80D_self: 0,
      sec80D_parents: 0,
      parentsAreSenior: true,
    }),
    taxPaid: { tds: 90000, advanceTax: 0 },
  }),

  /* ------------------------------------------------------------------------
   * SAMPLE B — home loan borrower. The classic case where the OLD regime wins,
   * because Rs.2 lakh of 24(b) interest plus a full 80C beats the new slabs.
   * ---------------------------------------------------------------------- */
  rajesh: Object.assign(blankProfile(), {
    name: 'Rajesh Kumar — Bank Manager, Pune (home loan)',
    ageBand: 'below60',
    city: 'nonmetro',
    employmentType: 'salaried',
    salary: {
      basic: 800000,
      da: 200000,
      hraReceived: 0,
      otherAllowances: 400000,
      employerNps: 100000,
      professionalTax: 2500,
      exemptAllowances: 0,
    },
    rent: { paidAnnual: 0 },
    house: { status: 'selfOccupied', loanInterest: 240000, principalRepaid: 150000, rentReceived: 0, municipalTax: 0 },
    other: { savingsInterest: 8000, fdInterest: 25000, dividend: 15000, familyPension: 0, misc: 0 },
    deductions: Object.assign(blankProfile().deductions, {
      sec80C: 0, // the home loan principal alone fills 80C
      epfEmployee: 96000,
      sec80CCD1B: 50000,
      sec80D_self: 25000,
      sec80D_parents: 45000,
      parentsAreSenior: true,
      sec80E: 60000,
    }),
    taxPaid: { tds: 150000, advanceTax: 0 },
  }),

  /* ------------------------------------------------------------------------
   * SAMPLE C — freelance consultant with capital gains. Exercises presumptive
   * taxation u/s 44ADA, LTCG harvesting and ITR-4 / ITR-3 selection.
   * ---------------------------------------------------------------------- */
  ananya: Object.assign(blankProfile(), {
    name: 'Ananya Iyer — Freelance UX Consultant, Bengaluru',
    ageBand: 'below60',
    city: 'nonmetro',
    employmentType: 'professional',
    salary: { basic: 0, da: 0, hraReceived: 0, otherAllowances: 0, employerNps: 0, professionalTax: 0, exemptAllowances: 0 },
    rent: { paidAnnual: 300000 },
    house: { status: 'none', loanInterest: 0, principalRepaid: 0, rentReceived: 0, municipalTax: 0 },
    business: { netProfit: 1800000, grossReceipts: 2400000, isProfessional: true },
    capitalGains: { stcgEquity: 60000, ltcgEquity: 90000, stcgOther: 0, ltcgOther: 0 },
    other: { savingsInterest: 15000, fdInterest: 0, dividend: 30000, familyPension: 0, misc: 0 },
    deductions: Object.assign(blankProfile().deductions, {
      sec80C: 50000,
      sec80D_self: 20000,
    }),
    taxPaid: { tds: 240000, advanceTax: 0 },
  }),

  /* ------------------------------------------------------------------------
   * SAMPLE E — THE CASE THAT PROVES THE AGENT IS NOT A REGIME CALCULATOR.
   *
   * Vikram has never invested anything. Compare the regimes as he stands and
   * the NEW regime wins comfortably — every online calculator will say so.
   *
   * But optimise each regime to its own ceiling and the answer REVERSES: the
   * old regime, with 80C, 80CCD(1B), 80D and employer NPS all filled, beats
   * the best the new regime can ever reach for him.
   *
   * The switch on its own LOSES him money. It only pays as a package. No tool
   * that compares first and optimises second can find this.
   * ---------------------------------------------------------------------- */
  vikram: Object.assign(blankProfile(), {
    name: 'Vikram Rao — Marketing Manager, Delhi (has never invested)',
    ageBand: 'below60',
    city: 'metro',
    employmentType: 'salaried',
    salary: {
      basic: 800000,
      da: 0,
      hraReceived: 400000,
      otherAllowances: 400000,
      employerNps: 0,
      professionalTax: 2500,
      exemptAllowances: 0,
    },
    rent: { paidAnnual: 360000 },
    house: { status: 'none', loanInterest: 0, principalRepaid: 0, rentReceived: 0, municipalTax: 0 },
    business: { netProfit: 0, grossReceipts: 0, isProfessional: false },
    capitalGains: { stcgEquity: 0, ltcgEquity: 0, stcgOther: 0, ltcgOther: 0 },
    other: { savingsInterest: 8000, fdInterest: 0, dividend: 0, familyPension: 0, misc: 0 },
    deductions: Object.assign(blankProfile().deductions, {
      sec80C: 0, // nothing beyond the EPF his employer deducts
      epfEmployee: 96000, // 12% of basic
      sec80CCD1B: 0,
      sec80D_self: 0,
      sec80D_parents: 0,
      parentsAreSenior: true, // both parents are over 60 — a Rs.50,000 limit
    }),
    taxPaid: { tds: 110000, advanceTax: 0 },
  }),

  /* ------------------------------------------------------------------------
   * SAMPLE D — retired senior citizen. Exercises the higher basic exemption,
   * 80TTB, Form 15H and the advance-tax exemption for seniors.
   * ---------------------------------------------------------------------- */
  suresh: Object.assign(blankProfile(), {
    name: 'Suresh Menon — Retired, age 68, Kochi',
    ageBand: 'senior',
    city: 'nonmetro',
    employmentType: 'retired',
    salary: { basic: 0, da: 0, hraReceived: 0, otherAllowances: 420000, employerNps: 0, professionalTax: 0, exemptAllowances: 0 }, // pension
    rent: { paidAnnual: 0 },
    house: { status: 'letOut', loanInterest: 0, principalRepaid: 0, rentReceived: 240000, municipalTax: 12000 },
    other: { savingsInterest: 18000, fdInterest: 320000, dividend: 25000, familyPension: 0, misc: 0 },
    deductions: Object.assign(blankProfile().deductions, {
      sec80C: 100000,
      sec80D_self: 42000,
      sec80DDB: 60000,
    }),
    taxPaid: { tds: 45000, advanceTax: 0 },
  }),
};

window.SAMPLES = SAMPLES;
window.blankProfile = blankProfile;
