/* ============================================================================
 * llm.js — CLAUDE AS AN INTAKE CLERK, NOT AN ACCOUNTANT
 * ----------------------------------------------------------------------------
 * The README has always said that no language model computes a number here.
 * This file is where that promise is kept or broken, so it is worth being
 * precise about what Claude is allowed to do.
 *
 *   ALLOWED   turning "I'm 29, freelance UX, made about 16 lakh, been paying
 *             off an education loan" into a filled-in profile object
 *   NOT       working out the tax on 16 lakh, choosing a regime, deciding
 *             whether the old regime is better, or producing any figure that
 *             is not a direct restatement of something the user said
 *
 * The reason is not stylistic. A model that is asked for tax arithmetic will
 * produce it, confidently and often wrongly, and a wrong tax figure delivered
 * fluently is worse than no tool at all. So Claude fills a form, the
 * deterministic engine does the rest, and everything Claude returns passes
 * through validation before it is allowed near the engine.
 *
 * ----------------------------------------------------------------------------
 * THREE DEFENCES
 * ----------------------------------------------------------------------------
 * 1. STRUCTURED OUTPUT. Claude is given a tool definition and must answer by
 *    calling it. There is no free-text path into the profile at all, so there
 *    is nothing to parse out of prose and nothing to misparse.
 *
 * 2. SCHEMA VALIDATION. Every field that comes back is checked against the
 *    shape blankProfile() defines, coerced to a number where a number is
 *    expected, and rejected if it is not one. Anything unrecognised is
 *    dropped rather than merged, so a hallucinated field cannot reach the
 *    engine even if the model invents one.
 *
 * 3. CITATION FIREWALL. Any section Claude mentions in its commentary is
 *    checked against the rulebook. A reference to a section this project does
 *    not implement is flagged to the user rather than shown as fact — which
 *    is the specific failure mode of an LLM asked about tax law, since the
 *    Income-tax Act has hundreds of sections and a model will happily cite
 *    ones that do not apply.
 *
 * ----------------------------------------------------------------------------
 * ABOUT THE API KEY
 * ----------------------------------------------------------------------------
 * This calls the Anthropic API straight from the browser, which means the key
 * is present in the page. That is acceptable for a locally run demo and is NOT
 * acceptable for anything deployed — a key in a public page will be found and
 * used. The key is kept in localStorage, never committed, and the UI says so.
 * A deployed version would put a small server in front and keep the key there.
 * ========================================================================== */

const LLM_MODEL = 'claude-sonnet-5';
const LLM_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/* ============================================================================
 * THE TOOL — the only shape Claude is allowed to answer in
 * ==========================================================================*/

/**
 * Deliberately mirrors blankProfile(). Descriptions matter here: they are the
 * only instructions Claude gets about what each field means, and vague ones
 * are how a "salary" ends up in the wrong slot.
 */
const PROFILE_TOOL = {
  name: 'record_taxpayer',
  description:
    'Record the taxpayer details stated by the user. Only record figures the ' +
    'user actually gave or clearly implied. Never estimate, never compute tax, ' +
    'and never fill a field just because it exists — leave it out instead.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Their name, if given.' },
      ageBand: { type: 'string', enum: ['below60', 'senior', 'superSenior'],
                 description: 'below60 unless they say they are 60+ (senior) or 80+ (superSenior).' },
      city: { type: 'string', enum: ['metro', 'nonmetro'],
              description: 'metro for Mumbai, Delhi, Kolkata, Chennai — HRA is 50% there and 40% elsewhere.' },
      employmentType: { type: 'string', enum: ['salaried', 'professional', 'business', 'retired'],
                        description: 'professional for freelance consultants, doctors, lawyers, designers.' },
      age: { type: 'number', description: 'Exact age in years if stated. Used for income forecasting.' },
      variableShare: { type: 'number',
                       description: 'Fraction 0-1 of pay that is variable (bonus, RSUs, commission). ' +
                                    'Salaried with a normal bonus is about 0.2; a freelancer is 0.6 or more.' },

      salary_basic: { type: 'number', description: 'Annual basic salary.' },
      salary_da: { type: 'number', description: 'Dearness allowance.' },
      salary_hraReceived: { type: 'number', description: 'HRA component received.' },
      salary_otherAllowances: { type: 'number', description: 'All other salary, including bonus.' },
      salary_employerNps: { type: 'number', description: "Employer's NPS contribution." },
      rent_paidAnnual: { type: 'number', description: 'Annual rent paid.' },

      house_status: { type: 'string', enum: ['none', 'selfOccupied', 'letOut'] },
      house_loanInterest: { type: 'number', description: 'Home loan interest paid this year.' },
      house_principalRepaid: { type: 'number', description: 'Home loan principal repaid — counts within 80C.' },
      house_rentReceived: { type: 'number', description: 'Rent received if let out.' },

      business_netProfit: { type: 'number', description: 'Net profit from business or profession.' },
      business_grossReceipts: { type: 'number', description: 'Gross receipts or turnover.' },
      business_isProfessional: { type: 'boolean', description: 'True for a profession (44ADA) rather than a trade.' },

      deductions_sec80C: { type: 'number', description: 'ELSS, PPF, LIC, tuition fees already invested.' },
      deductions_epfEmployee: { type: 'number', description: 'Own EPF contribution — also inside the 80C limit.' },
      deductions_sec80CCD1B: { type: 'number', description: 'Additional NPS, separate Rs.50,000 limit.' },
      deductions_sec80D_self: { type: 'number', description: 'Health insurance premium for self and family.' },
      deductions_sec80D_parents: { type: 'number', description: "Health insurance premium for parents." },
      deductions_parentsAreSenior: { type: 'boolean' },
      deductions_sec80E: { type: 'number', description: 'Education loan INTEREST paid this year.' },

      other_savingsInterest: { type: 'number', description: 'Savings bank interest.' },
      other_fdInterest: { type: 'number', description: 'Fixed deposit interest.' },
      capitalGains_ltcgEquity: { type: 'number', description: 'Long term gains on listed shares or equity funds.' },
      capitalGains_stcgEquity: { type: 'number', description: 'Short term gains on listed shares or equity funds.' },
      taxPaid_tds: { type: 'number', description: 'TDS already deducted this year.' },

      missing: {
        type: 'array',
        items: { type: 'string' },
        description: 'Things you would need to ask about that the user did not mention. ' +
                     'Be specific and brief, e.g. "whether the parents are over 60".',
      },
      notes: {
        type: 'string',
        description: 'One or two sentences on how you read what they said. ' +
                     'Do NOT state any tax figure, saving, or regime recommendation.',
      },
    },
    required: [],
  },
};

const SYSTEM_PROMPT =
  'You are an intake assistant for an Indian income tax tool. Your ONLY job is to ' +
  'convert what the user says about themselves into structured fields by calling ' +
  'the record_taxpayer tool.\n\n' +
  'Hard rules:\n' +
  '- Never compute tax, never suggest a regime, never state a saving. A separate ' +
  'deterministic engine does all arithmetic, and any number you invent would be wrong.\n' +
  '- Record only what the user gave. If they said "around 16 lakh" record 1600000. ' +
  'If they did not mention something, leave the field out entirely rather than guessing 0.\n' +
  '- Amounts are ANNUAL and in rupees. "16 lakh" is 1600000, "50k" is 50000.\n' +
  '- If they describe monthly figures, multiply by 12 and say so in notes.\n' +
  '- Put anything you would need to ask about into the missing array.';

/* ============================================================================
 * VALIDATION — nothing reaches the engine unchecked
 * ==========================================================================*/

/** The flat tool fields map onto the nested profile shape. */
const FIELD_MAP = {
  name: 'name', ageBand: 'ageBand', city: 'city', employmentType: 'employmentType',
  salary_basic: 'salary.basic', salary_da: 'salary.da',
  salary_hraReceived: 'salary.hraReceived', salary_otherAllowances: 'salary.otherAllowances',
  salary_employerNps: 'salary.employerNps',
  rent_paidAnnual: 'rent.paidAnnual',
  house_status: 'house.status', house_loanInterest: 'house.loanInterest',
  house_principalRepaid: 'house.principalRepaid', house_rentReceived: 'house.rentReceived',
  business_netProfit: 'business.netProfit', business_grossReceipts: 'business.grossReceipts',
  business_isProfessional: 'business.isProfessional',
  deductions_sec80C: 'deductions.sec80C', deductions_epfEmployee: 'deductions.epfEmployee',
  deductions_sec80CCD1B: 'deductions.sec80CCD1B',
  deductions_sec80D_self: 'deductions.sec80D_self',
  deductions_sec80D_parents: 'deductions.sec80D_parents',
  deductions_parentsAreSenior: 'deductions.parentsAreSenior',
  deductions_sec80E: 'deductions.sec80E',
  other_savingsInterest: 'other.savingsInterest', other_fdInterest: 'other.fdInterest',
  capitalGains_ltcgEquity: 'capitalGains.ltcgEquity',
  capitalGains_stcgEquity: 'capitalGains.stcgEquity',
  taxPaid_tds: 'taxPaid.tds',
};

const ENUMS = {
  ageBand: ['below60', 'senior', 'superSenior'],
  city: ['metro', 'nonmetro'],
  employmentType: ['salaried', 'professional', 'business', 'retired'],
  'house.status': ['none', 'selfOccupied', 'letOut'],
};

function setDeep(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = obj;
  for (const k of keys) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[last] = value;
}

/**
 * Turn a tool call into a profile, dropping anything that does not validate.
 *
 * Rejections are collected and returned rather than thrown, because the useful
 * behaviour is to fill in what was understood and tell the user plainly what
 * was not — not to fail the whole intake over one odd field.
 */
function validateToolInput(input) {
  const profile = blankProfile();
  const rejected = [];
  const filled = [];

  for (const key of Object.keys(input || {})) {
    if (key === 'missing' || key === 'notes' || key === 'age' || key === 'variableShare') continue;

    const path = FIELD_MAP[key];
    if (!path) {
      // A field the schema does not define. Dropped, not merged — this is the
      // line a hallucinated field would have to cross, and it cannot.
      rejected.push(key + ' (not a field this tool recognises)');
      continue;
    }

    const value = input[key];
    const allowed = ENUMS[path] || ENUMS[key];

    if (allowed) {
      if (allowed.indexOf(value) === -1) {
        rejected.push(key + ' = ' + JSON.stringify(value) + ' (not one of ' + allowed.join(', ') + ')');
        continue;
      }
      setDeep(profile, path, value);
    } else if (typeof value === 'boolean') {
      setDeep(profile, path, value);
    } else if (path === 'name') {
      setDeep(profile, path, String(value).slice(0, 120));
    } else {
      const n = Number(value);
      // A negative or non-finite amount is not a typo to be corrected, it is a
      // sign the model misread something. Drop it and say so.
      if (!Number.isFinite(n) || n < 0) {
        rejected.push(key + ' = ' + JSON.stringify(value) + ' (not a valid amount)');
        continue;
      }
      setDeep(profile, path, n);
    }
    filled.push(path);
  }

  // Forecasting features live alongside the profile rather than inside it.
  const age = Number(input && input.age);
  const vs = Number(input && input.variableShare);
  const features = {
    employmentType: profile.employmentType === 'retired' ? 'salaried' : profile.employmentType,
    city: profile.city,
    age: Number.isFinite(age) && age > 15 && age < 100 ? age : 35,
    variableShare: Number.isFinite(vs) && vs >= 0 && vs <= 1 ? vs
                 : (profile.employmentType === 'salaried' ? 0.2 : 0.6),
  };

  return {
    profile,
    features,
    filled,
    rejected,
    missing: Array.isArray(input && input.missing) ? input.missing.slice(0, 8) : [],
    notes: typeof (input && input.notes) === 'string' ? input.notes : '',
  };
}

/* ============================================================================
 * THE CITATION FIREWALL
 * ==========================================================================*/

/**
 * Every section reference in a piece of model text, checked against the
 * rulebook.
 *
 * The Income-tax Act has hundreds of sections and a language model will cite
 * them fluently, including ones that do not exist, do not apply, or were
 * repealed. Since this tool only implements what is in rulebook.js, anything
 * outside that list is something we cannot stand behind — so it is surfaced as
 * unverified rather than displayed as fact.
 */
function checkCitations(text) {
  const known = new Set(Object.keys(RULEBOOK.sections || {}));
  // Sections the engine implements directly without a rulebook entry.
  ['115BAC', '87A', '234A', '234B', '234C', '244A', '288A', '16', '24', '10',
   '44AD', '44ADA', '54', '54F', '54EC', '64', '71', '80CCE', '139', '119A',
   '111A', '112', '112A', '211', '207'].forEach((s) => known.add(s));

  const cited = [];
  const unknown = [];
  const re = /\b(?:section|sec\.?|u\/s|under)\s*([0-9]{1,3}[A-Z]{0,4}(?:\([0-9A-Za-z]+\))?)/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const raw = m[1].toUpperCase();
    const base = raw.replace(/\(.*/, '');
    cited.push(raw);
    if (!known.has(raw) && !known.has(base)) unknown.push(raw);
  }

  return {
    cited: Array.from(new Set(cited)),
    unknown: Array.from(new Set(unknown)),
    ok: unknown.length === 0,
  };
}

/* ============================================================================
 * THE CALL
 * ==========================================================================*/

/**
 * Ask Claude to read a plain-English description and fill the form.
 *
 * Returns the validated profile plus everything the caller needs to be honest
 * with the user about what happened: which fields were filled, which were
 * rejected, what is still missing, and whether any citation failed the
 * firewall.
 */
async function extractProfile(text, opts) {
  const o = opts || {};
  const apiKey = o.apiKey;
  if (!apiKey) throw new Error('No API key. Paste one into the box above — it stays in this browser.');
  if (!text || !text.trim()) throw new Error('Nothing to read. Describe your situation first.');

  const response = await fetch(LLM_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for calling the API directly from a browser. See the note at
      // the top of this file about why that is a demo-only arrangement.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: o.model || LLM_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: [PROFILE_TOOL],
      tool_choice: { type: 'tool', name: 'record_taxpayer' },
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    let detail = body;
    try { detail = JSON.parse(body).error.message; } catch (e) { /* keep raw */ }
    throw new Error('Claude returned ' + response.status + ': ' + detail);
  }

  const data = await response.json();
  const call = (data.content || []).find((c) => c.type === 'tool_use');
  if (!call) throw new Error('Claude did not fill the form. Try describing your situation more directly.');

  const result = validateToolInput(call.input);
  result.citations = checkCitations(result.notes);
  result.usage = data.usage || null;
  return result;
}

/* ---------------------------------------------------------------------------
 * Plain global, plus a CommonJS tail for the Node tests.
 * ------------------------------------------------------------------------ */
const LLM = {
  extractProfile,
  validateToolInput,
  checkCitations,
  PROFILE_TOOL,
  SYSTEM_PROMPT,
  FIELD_MAP,
  LLM_MODEL,
};

if (typeof window !== 'undefined') window.LLM = LLM;
if (typeof module !== 'undefined' && module.exports) module.exports = LLM;
