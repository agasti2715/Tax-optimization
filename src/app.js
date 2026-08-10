/* ============================================================================
 * app.js — UI CONTROLLER
 * ----------------------------------------------------------------------------
 * Binds the interview form to a profile object, runs the engine live as the
 * user types, and renders the advisory report.
 *
 * The form fields carry a data-path attribute (e.g. data-path="salary.basic")
 * so the whole form maps onto the profile object generically — no per-field
 * wiring code.
 * ========================================================================== */

(function () {
  'use strict';

  /* ---------- state ------------------------------------------------------ */

  let profile = blankProfile();
  let year = RULEBOOK.meta.defaultYear;
  let step = 0;
  let advice = null;

  const STEPS = [
    { label: 'About you', q: "Let's start with the basics. Your age group decides your exemption limit, and your city decides how much HRA you can claim." },
    { label: 'Salary & rent', q: 'Now your salary. Open your Form 16 Part B — I need the split between basic, HRA and other allowances, because every limit in the Act is calculated on basic salary.' },
    { label: 'House property', q: 'Do you own a house? A home loan changes the answer completely — interest of up to ₹2 lakh is deductible, but only in the old regime.' },
    { label: 'Business income', q: 'Any freelance or business income? If you are a professional, section 44ADA may let you declare only half your receipts as profit.' },
    { label: 'Investments', q: 'Tell me what you have already invested and insured. I need this to find your unused headroom — most people leave 80D and 80CCD(1B) completely untouched.' },
    { label: 'Gains & tax paid', q: 'Finally, any share or property sales this year, other income, and how much tax has already been deducted. Then I will run the full computation.' },
  ];

  /* ---------- tiny helpers ----------------------------------------------- */

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Negatives read as "−₹1,07,000", not "₹-1,07,000".
  const fmt = (v) => {
    const x = Math.round(Number(v) || 0);
    return (x < 0 ? '−₹' : '₹') + Math.abs(x).toLocaleString('en-IN');
  };
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, val) {
    const keys = path.split('.');
    const last = keys.pop();
    let o = obj;
    for (const k of keys) {
      if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
      o = o[k];
    }
    o[last] = val;
  }

  /* ---------- form <-> profile ------------------------------------------- */

  function readForm() {
    $$('[data-path]').forEach((el) => {
      const path = el.dataset.path;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number') v = el.value === '' ? 0 : Number(el.value);
      else v = el.value;
      setPath(profile, path, v);
    });
  }

  function writeForm() {
    $$('[data-path]').forEach((el) => {
      const v = getPath(profile, el.dataset.path);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'number') el.value = v ? v : '';
      else el.value = v == null ? '' : v;
    });
  }

  /* ---------- stepper ----------------------------------------------------- */

  function renderChips() {
    $('#stepChips').innerHTML = STEPS.map(
      (s, i) =>
        `<button type="button" class="step-chip ${i === step ? 'active' : i < step ? 'done' : ''}" data-goto="${i}">${i + 1}. ${esc(s.label)}</button>`
    ).join('');
  }

  function showStep(i) {
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    $$('.step-panel').forEach((p) => p.classList.toggle('hidden', Number(p.dataset.step) !== step));
    $('#agentQuestionText').textContent = STEPS[step].q;
    $('#progressBadge').textContent = `Step ${step + 1} of ${STEPS.length}`;
    $('#btnBack').disabled = step === 0;
    renderChips();
  }

  /* ---------- live estimate ---------------------------------------------- */

  function updateLive() {
    readForm();
    const cmp = TaxEngine.compareRegimes(profile, year);
    const best = cmp.best;

    const anyIncome = best.grossTotalNormal > 0 || best.capitalGains.totalSpecialIncome > 0;
    if (!anyIncome) {
      $('#liveEstimate').innerHTML =
        '<div class="empty" style="padding:24px 10px;"><div class="icon">₹</div>Enter your income to see a live estimate.</div>';
      return;
    }

    $('#liveEstimate').innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
        <span style="font-size:12px; color:var(--ink-faint); text-transform:uppercase; letter-spacing:.05em; font-weight:600;">Estimated tax</span>
        <span class="badge ${cmp.winner === 'new' ? 'info' : 'warn'}">${cmp.winner} regime</span>
      </div>
      <div style="font-size:28px; font-weight:700; font-family:var(--mono); letter-spacing:-.02em;">${fmt(best.totalTax)}</div>
      <div style="font-size:12.5px; color:var(--ink-soft); margin-top:4px;">
        on a total income of ${fmt(best.totalIncome)} — effective rate ${best.effectiveRate.toFixed(1)}%
      </div>
      <table style="margin-top:14px;">
        <tr><td style="padding-left:0;">Old regime</td><td class="num">${fmt(cmp.old.totalTax)}</td></tr>
        <tr><td style="padding-left:0;">New regime</td><td class="num">${fmt(cmp.new.totalTax)}</td></tr>
        <tr class="total"><td style="padding-left:0;">Difference</td><td class="num" style="color:var(--good);">${fmt(cmp.saving)}</td></tr>
      </table>`;

    const trace = best.trace;
    $('#liveLog').innerHTML = trace
      .map(
        (t) => `<div class="log-line">
          <div class="dot"></div>
          <div class="txt"><b>${esc(t.step)}</b><span>${esc(t.detail)}</span></div>
          <div class="amt ${t.amount < 0 ? 'neg' : 'pos'}">${t.amount === 0 ? '—' : (t.amount < 0 ? '−' : '') + fmt(Math.abs(t.amount))}</div>
        </div>`
      )
      .join('');
  }

  /* ============================================================================
   * RESULT RENDERING
   * ========================================================================== */

  function renderHeadline() {
    const a = advice;
    const best = a.comparison.best;
    const payable = best.balance;
    $('#headlineStats').innerHTML = `
      <div class="stat">
        <div class="k">Tax as you stand today</div>
        <div class="v">${fmt(a.baseTax)}</div>
        <div class="n">Best available regime, no changes made</div>
      </div>
      <div class="stat win">
        <div class="k">Tax after my recommendations</div>
        <div class="v">${fmt(a.optimisedTax)}</div>
        <div class="n">If you act on the plan below</div>
      </div>
      <div class="stat hero">
        <div class="k">You can legally save</div>
        <div class="v">${fmt(a.totalSaving)}</div>
        <div class="n">${a.baseTax > 0 ? ((a.totalSaving / a.baseTax) * 100).toFixed(0) : 0}% of your current liability</div>
      </div>
      <div class="stat">
        <div class="k">${payable >= 0 ? 'Still payable' : 'Expected refund'}</div>
        <div class="v">${fmt(Math.abs(payable))}</div>
        <div class="n">After ${fmt(best.taxPaid)} of TDS and advance tax</div>
      </div>`;
  }

  /**
   * "But what if I switched to the other regime and invested everything?"
   * Fills every deduction available in BOTH regimes and compares the two
   * best-case positions, along with the cash each one demands.
   */
  function renderCrossRegime() {
    const x = advice.crossRegime;
    const label = (k) => (k === 'new' ? 'New regime' : 'Old regime');
    const gap = Math.abs(x.chosenBestTax - x.otherBestTax);

    return `
      <div class="card" style="margin-bottom:20px;">
        <header><h2>What if you went all-in on the other regime?</h2></header>
        <div class="body">
          <p style="margin-top:0; color:var(--ink-soft); font-size:13.5px;">
            A regime that loses today can still win once every deduction is filled. Here is the best you could
            possibly do under each, and what it would cost you in cash to get there.
          </p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Best possible position</th><th class="num">Tax</th><th class="num">Cash you must invest</th></tr></thead>
              <tbody>
                <tr><td><b>${label(x.chosen)}</b> — fully optimised</td><td class="num">${fmt(x.chosenBestTax)}</td><td class="num">${x.chosenOutlay ? fmt(x.chosenOutlay) : 'nothing'}</td></tr>
                <tr><td><b>${label(x.other)}</b> — fully optimised</td><td class="num">${fmt(x.otherBestTax)}</td><td class="num">${x.otherOutlay ? fmt(x.otherOutlay) : 'nothing'}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="note-box ${x.stillBetter ? '' : 'warn'}" style="margin:16px 0 0;">
            ${
              x.stillBetter
                ? `Even after maxing out every deduction the ${label(x.other).toLowerCase()} offers, it would still cost you
                   <strong>${fmt(gap)} more</strong> in tax${x.otherOutlay ? ` — and it would tie up <strong>${fmt(x.otherOutlay)}</strong> of your cash to get there` : ''}.
                   The ${label(x.chosen).toLowerCase()} is genuinely your answer, not just today's answer.`
                : `Switching to the <strong>${label(x.other).toLowerCase()}</strong> and filling every deduction would bring your tax down to
                   <strong>${fmt(x.otherBestTax)}</strong> — ${fmt(gap)} less. It requires investing <strong>${fmt(x.otherOutlay)}</strong>,
                   so it only makes sense if you were going to save that money anyway.`
            }
          </div>
        </div>
      </div>`;
  }

  function renderOverview() {
    const a = advice;
    const c = a.comparison;
    const top = a.recommendations.filter((r) => r.saving > 0).slice(0, 3);

    const side = (key, res, label, note) => `
      <div class="side ${c.winner === key ? 'winner' : ''}">
        <h3>${label} ${c.winner === key ? '<span class="badge good">recommended</span>' : ''}</h3>
        <div class="amount">${fmt(res.totalTax)}</div>
        <div class="note">${note}</div>
        <table style="margin-top:12px;">
          <tr><td style="padding-left:0;">Gross total income</td><td class="num">${fmt(res.grossTotalNormal + res.capitalGains.totalSpecialIncome)}</td></tr>
          <tr><td style="padding-left:0;">Deductions claimed</td><td class="num">${fmt(res.deductions.total)}</td></tr>
          <tr><td style="padding-left:0;">Total income</td><td class="num">${fmt(res.totalIncome)}</td></tr>
          <tr><td style="padding-left:0;">Effective rate</td><td class="num">${res.effectiveRate.toFixed(1)}%</td></tr>
        </table>
      </div>`;

    $('#tab-overview').innerHTML = `
      <div class="card" style="margin-bottom:20px;">
        <header><h2>Which regime should you choose?</h2></header>
        <div class="body">
          <div class="versus">
            ${side('old', c.old, 'Old regime', 'All deductions available — 80C, 80D, HRA, home loan interest.')}
            ${side('new', c.new, 'New regime — section 115BAC', 'Lower slab rates, but almost no deductions. This is the default if you do nothing.')}
          </div>
          <div class="note-box" style="margin-top:16px; margin-bottom:0;">
            <strong>Choosing the ${c.winner} regime saves you ${fmt(c.saving)} straight away.</strong>
            ${
              c.winner === 'old'
                ? ' The new regime is the default, so you must actively opt out. Salaried taxpayers pick this inside the ITR; anyone with business income must file <strong>Form 10-IEA</strong> before the due date.'
                : ' The new regime is already the default, so no separate form is needed unless you had previously opted out.'
            }
          </div>
        </div>
      </div>

      ${renderCrossRegime()}

      <div class="card">
        <header><h2>Your three biggest opportunities</h2><span class="badge good">${fmt(top.reduce((s, r) => s + r.saving, 0))} of savings</span></header>
        <div class="body">
          ${
            top.length
              ? top
                  .map(
                    (r, i) => `
            <div style="display:flex; gap:14px; padding:12px 0; ${i < top.length - 1 ? 'border-bottom:1px solid var(--line);' : ''}">
              <div class="rank" style="background:${r.zeroCost ? 'var(--good)' : 'var(--brand)'};">${i + 1}</div>
              <div style="flex:1; min-width:0;">
                <div style="font-weight:650;">${esc(r.title)}</div>
                <div style="font-size:13px; color:var(--ink-soft); margin-top:2px;">${esc(r.action)}</div>
              </div>
              <div style="text-align:right; flex-shrink:0;">
                <div style="font-family:var(--mono); font-weight:700; color:var(--good); font-size:16px;">${fmt(r.saving)}</div>
                <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-faint);">${r.invest ? 'invest ' + fmt(r.invest) : 'no cost'}</div>
              </div>
            </div>`
                  )
                  .join('')
              : '<div class="empty">Nothing left to optimise — you are already using every deduction available to you.</div>'
          }
        </div>
      </div>`;
  }

  /* ---- sensible defaults for when/where, overridable per rule ---------- */

  const STEP_DEFAULTS = {
    'Salary restructuring': { when: 'Before the next payroll cycle', where: 'Your HR / payroll team' },
    Investment: { when: 'Before 31 March', where: 'Your bank, fund house or the NPS portal' },
    Insurance: { when: 'Before 31 March', where: 'Your insurer' },
    'Capital gains': { when: 'Before 31 March', where: 'Your broker or fund house' },
    'Family planning': { when: 'Before 31 March', where: 'Your bank' },
    Compliance: { when: 'Before you file', where: 'incometax.gov.in' },
    Business: { when: 'When you file your return', where: 'incometax.gov.in' },
    Warning: { when: 'Review now', where: '—' },
    'Often missed': { when: 'Review now', where: '—' },
  };
  const stepMeta = (r) => {
    const d = STEP_DEFAULTS[r.category] || { when: 'Before 31 March', where: '—' };
    return { when: r.when || d.when, where: r.where || d.where };
  };

  /**
   * The waterfall: starting tax on the left, one falling bar per action,
   * final tax on the right. Drawn as inline SVG so it prints and scales.
   */
  function renderWaterfall(steps) {
    const start = advice.baseTax;
    const end = advice.optimisedTax;
    if (start <= 0 || !steps.length) return '';

    const W = 960, H = 330, top = 46, bottom = 262;
    const plot = bottom - top;
    const cols = steps.length + 2;
    const slot = W / cols;
    const bw = Math.min(96, slot * 0.54);
    const scale = plot / start;
    const y = (v) => bottom - v * scale;
    const cx = (i) => slot * i + slot / 2;

    let svg = '';
    // baseline
    svg += `<line x1="0" y1="${bottom}" x2="${W}" y2="${bottom}" stroke="var(--line-strong)" stroke-width="1.5"/>`;

    // opening bar
    svg += `<rect x="${cx(0) - bw / 2}" y="${y(start)}" width="${bw}" height="${plot}" rx="5" fill="url(#gStart)"/>`;
    svg += `<text x="${cx(0)}" y="${y(start) - 12}" class="wf-val">${fmt(start)}</text>`;
    svg += `<text x="${cx(0)}" y="${bottom + 22}" class="wf-lab">Tax today</text>`;

    // falling steps
    let running = start;
    steps.forEach((s, i) => {
      const after = running - s.saving;
      const yTop = y(running);
      const h = Math.max(3, running * scale - after * scale);
      const x = cx(i + 1) - bw / 2;
      svg += `<line x1="${cx(i) + bw / 2}" y1="${yTop}" x2="${x}" y2="${yTop}" stroke="var(--ink-300)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      svg += `<rect x="${x}" y="${yTop}" width="${bw}" height="${h}" rx="5" fill="url(#gCut)"/>`;
      svg += `<text x="${cx(i + 1)}" y="${yTop - 12}" class="wf-cut">−${fmt(s.saving)}</text>`;
      svg += `<text x="${cx(i + 1)}" y="${bottom + 22}" class="wf-lab">${esc(s.section)}</text>`;
      svg += `<text x="${cx(i + 1)}" y="${bottom + 40}" class="wf-sub">step ${i + 1}</text>`;
      running = after;
    });

    // closing bar
    const last = cols - 1;
    svg += `<line x1="${cx(last - 1) + bw / 2}" y1="${y(end)}" x2="${cx(last) - bw / 2}" y2="${y(end)}" stroke="var(--ink-300)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    svg += `<rect x="${cx(last) - bw / 2}" y="${y(end)}" width="${bw}" height="${Math.max(3, end * scale)}" rx="5" fill="url(#gEnd)"/>`;
    svg += `<text x="${cx(last)}" y="${y(end) - 12}" class="wf-val end">${fmt(end)}</text>`;
    svg += `<text x="${cx(last)}" y="${bottom + 22}" class="wf-lab">Tax after</text>`;

    return `
      <div class="wf-wrap">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
             aria-label="Waterfall showing tax falling from ${fmt(start)} to ${fmt(end)}">
          <defs>
            <linearGradient id="gStart" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#4338ca"/>
            </linearGradient>
            <linearGradient id="gCut" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#d97706"/>
            </linearGradient>
            <linearGradient id="gEnd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#10b981"/><stop offset="100%" stop-color="#047857"/>
            </linearGradient>
          </defs>
          ${svg}
        </svg>
      </div>`;
  }

  function renderHowYouSave() {
    const a = advice;
    const steps = a.recommendations.filter((r) => r.saving > 0);
    const advisory = a.recommendations.filter((r) => r.saving === 0);

    // Three distinct levers, so the user understands the *kind* of saving.
    const leverRegime = a.comparison.saving;
    const leverStructure = steps.filter((r) => r.zeroCost).reduce((s, r) => s + r.saving, 0);
    const leverInvest = steps.filter((r) => !r.zeroCost).reduce((s, r) => s + r.saving, 0);
    const outlay = steps.reduce((s, r) => s + (r.invest || 0), 0);

    const lever = (n, title, amt, body, cls) => `
      <div class="lever ${cls}">
        <div class="lever-n">${n}</div>
        <div class="lever-b">
          <div class="lever-t">${title}</div>
          <div class="lever-v">${fmt(amt)}</div>
          <div class="lever-d">${body}</div>
        </div>
      </div>`;

    let running = a.baseTax;
    const timeline = steps
      .map((r, i) => {
        const m = stepMeta(r);
        running -= r.saving;
        return `
        <li class="tl-item">
          <div class="tl-mark">${i + 1}</div>
          <div class="tl-card">
            <div class="tl-head">
              <div>
                <div class="tl-title">${esc(r.title)}</div>
                <div class="tl-tags">
                  <span class="badge brand">Section ${esc(r.section)}</span>
                  <span class="badge grey">${esc(m.when)}</span>
                  ${r.zeroCost ? '<span class="badge good">no money needed</span>' : `<span class="badge warn">invest ${fmt(r.invest)}</span>`}
                </div>
              </div>
              <div class="tl-save"><div class="v">−${fmt(r.saving)}</div><div class="k">tax saved</div></div>
            </div>
            <p class="tl-do">${esc(r.action)}</p>
            <div class="tl-meta">
              <div><span class="mk">Where</span>${esc(m.where)}</div>
              <div><span class="mk">Proof</span>${(r.forms || []).map((f) => esc(f)).join(' · ') || '—'}</div>
            </div>
            <div class="tl-after">Your tax after this step: <b>${fmt(running)}</b></div>
          </div>
        </li>`;
      })
      .join('');

    const at = a.advanceTax;
    const finalStep = `
      <li class="tl-item">
        <div class="tl-mark done">✓</div>
        <div class="tl-card final">
          <div class="tl-title">File ${esc(a.filing.itr.key)} and you are done</div>
          <p class="tl-do">
            ${at.required
              ? `Because your liability after TDS is ${fmt(at.net)}, you must also pay advance tax in four instalments — 15% by 15 June, 45% by 15 September, 75% by 15 December and 100% by 15 March — using Challan ITNS-280. Missing them costs 1% a month under sections 234B and 234C.`
              : esc(at.reason)}
          </p>
          <div class="tl-after">Final tax for the year: <b>${fmt(a.optimisedTax)}</b> instead of ${fmt(a.baseTax)}.</div>
        </div>
      </li>`;

    $('#tab-howyousave').innerHTML = `
      <div class="card feature" style="margin-bottom:22px;">
        <header><h2>Where your saving actually comes from</h2><span class="badge good">${fmt(a.totalSaving)} still to capture</span></header>
        <div class="body">
          <p class="lede">
            The agent does not find loopholes. It applies three kinds of legal lever, ordered by what they
            cost you — the ones needing no money at all come first. Lever 1 is <b>already yours</b> the moment
            you file under the right regime; levers 2 and 3 are the <b>${fmt(a.totalSaving)}</b> you have
            not captured yet, which is the figure quoted at the top of this report.
          </p>
          <div class="levers">
            ${lever(1, 'Choose the right regime', leverRegime,
              `<b>Already secured.</b> The law lets you pick, and running both computations shows the
               <b>${esc(a.regime)} regime</b> costs you ${fmt(leverRegime)} less. It is yours the moment you
               file correctly — no money, no lock-in, just the right box ticked.`, 'l1')}
            ${lever(2, 'Restructure what you already earn', leverStructure,
              leverStructure > 0
                ? 'Same salary, same CTC — only relabelled so the law stops taxing part of it. No money leaves your pocket.'
                : 'Nothing further to restructure — your salary is already efficiently arranged.', 'l2')}
            ${lever(3, 'Invest where the law rewards you', leverInvest,
              leverInvest > 0
                ? `Requires putting ${fmt(outlay)} into instruments the Act encourages. Only worth it if you wanted to save that money anyway.`
                : 'No investment-linked deduction is available to you in this regime — so the agent is not going to tell you to lock money away for nothing.', 'l3')}
          </div>
        </div>
      </div>

      ${steps.length ? `
      <div class="card" style="margin-bottom:22px;">
        <header><h2>Your tax, falling step by step</h2>
          <span class="badge grey">${(a.comparison.best.effectiveRate).toFixed(1)}% → ${(a.optimisedResult.effectiveRate).toFixed(1)}% effective rate</span></header>
        <div class="body">${renderWaterfall(steps)}</div>
      </div>` : ''}

      <div class="card" style="margin-bottom:22px;">
        <header><h2>Do these, in this order</h2><span class="badge brand">${steps.length + 1} steps</span></header>
        <div class="body">
          <ol class="timeline">${timeline}${finalStep}</ol>
        </div>
      </div>

      ${advisory.length ? `
      <div class="card">
        <header><h2>Also worth knowing</h2><span class="badge grey">${advisory.length} points</span></header>
        <div class="body">
          <p class="lede">These do not change your number today, but each one is a real provision that applies to your situation.</p>
          ${advisory.map((r) => `
            <div class="advis">
              <div class="advis-t">${esc(r.title)} <span class="badge grey">${esc(r.section)}</span></div>
              <div class="advis-d">${esc(r.action)}</div>
              ${r.why ? `<div class="advis-w">${esc(r.why)}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>` : ''}`;
  }

  function renderActions() {
    const a = advice;
    const cards = a.recommendations
      .map((r, i) => {
        const cls = r.category === 'Warning' ? 'warn' : r.saving === 0 ? 'info' : r.zeroCost ? 'zero' : '';
        const forms = (r.forms || []).map((f) => `<span class="form-pill">${esc(f)}</span>`).join('');
        const instruments = (r.instruments || []).length
          ? `<dt>Where to put it</dt><dd><ul>${r.instruments.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd>`
          : '';
        return `
        <details class="rec ${cls}" ${i === 0 ? 'open' : ''}>
          <summary>
            <div class="rank">${i + 1}</div>
            <div class="head-main">
              <div class="t">${esc(r.title)}</div>
              <div class="meta">
                <span class="badge grey">Section ${esc(r.section)}</span>
                <span>${esc(r.category)}</span>
                ${r.zeroCost ? '<span class="badge good">costs you nothing</span>' : ''}
              </div>
            </div>
            <div class="save">
              ${r.saving > 0 ? `<div class="v">${fmt(r.saving)}</div><div class="k">tax saved</div>` : `<div class="k">advisory</div>`}
            </div>
          </summary>
          <div class="detail">
            <dl>
              <dt>What I found</dt><dd>${esc(r.finding)}</dd>
              <dt>What to do</dt><dd>${esc(r.action)}</dd>
              ${r.invest ? `<dt>Amount to invest</dt><dd>${fmt(r.invest)}${r.saving > 0 ? ` — a return of ${((r.saving / r.invest) * 100).toFixed(1)}% in tax saved alone` : ''}</dd>` : ''}
              ${instruments}
              ${r.lockIn ? `<dt>Lock-in</dt><dd>${esc(r.lockIn)}</dd>` : ''}
              ${r.risk ? `<dt>Risk</dt><dd>${esc(r.risk)}</dd>` : ''}
              ${forms ? `<dt>Forms &amp; proof</dt><dd>${forms}</dd>` : ''}
            </dl>
            ${r.why ? `<div class="why"><b>Why this matters:</b> ${esc(r.why)}</div>` : ''}
          </div>
        </details>`;
      })
      .join('');

    $('#tab-actions').innerHTML = `
      <div class="note-box">
        Recommendations are ranked by how much tax each one actually saves, measured by re-running the full computation
        with that change applied. Because they are evaluated one after another, the individual figures add up exactly to
        the ${fmt(a.totalSaving)} headline — no double counting.
      </div>
      ${cards || '<div class="empty">No further recommendations.</div>'}`;
  }

  function renderComputation() {
    const a = advice;
    const o = a.comparison.old;
    const nw = a.comparison.new;

    const row = (label, ko, kn, cls) =>
      `<tr class="${cls || ''}"><td>${label}</td><td class="num">${fmt(ko)}</td><td class="num">${fmt(kn)}</td></tr>`;

    const dedRows = (res) =>
      res.deductions.items.length
        ? res.deductions.items
            .map(
              (d) =>
                `<tr><td>${esc(d.section)}</td><td>${esc(d.label)}${d.note ? `<br><span style="font-size:11.5px;color:var(--ink-faint);">${esc(d.note)}</span>` : ''}</td><td class="num">${fmt(d.amount)}</td></tr>`
            )
            .join('')
        : '<tr><td colspan="3" style="color:var(--ink-faint);">No deductions available under this regime.</td></tr>';

    const cgRows = a.comparison.best.capitalGains.buckets
      .map(
        (b) => `<tr>
          <td>${esc(b.label)}</td>
          <td class="num">${fmt(b.gross)}</td>
          <td class="num">${b.annualExemption ? '−' + fmt(b.annualExemption) : '—'}</td>
          <td class="num">${fmt(b.taxable)}</td>
          <td class="num">${(b.rate * 100).toFixed(1)}%</td>
          <td class="num">${fmt(b.tax)}</td>
        </tr>`
      )
      .join('');

    const best = a.comparison.best;
    const hra = best.salary.hra;

    $('#tab-computation').innerHTML = `
      <div class="card" style="margin-bottom:20px;">
        <header><h2>Side-by-side computation — ${esc(RULEBOOK.years[a.yearKey].label)}</h2></header>
        <div class="body table-wrap">
          <table>
            <thead><tr><th>Particulars</th><th class="num">Old regime</th><th class="num">New regime</th></tr></thead>
            <tbody>
              ${row('Income from salary (after exemptions &amp; standard deduction)', o.salary.income, nw.salary.income)}
              ${row('Income from house property', o.house.income, nw.house.income)}
              ${row('Profits from business or profession', o.business, nw.business)}
              ${row('Income from other sources', o.otherSources, nw.otherSources)}
              ${o.stcgSlab || nw.stcgSlab ? row('Short-term gains taxed at slab rates', o.stcgSlab, nw.stcgSlab) : ''}
              ${row('<b>Gross Total Income</b>', o.grossTotalNormal, nw.grossTotalNormal, 'total')}
              ${row('Less: Chapter VI-A deductions', -o.deductions.total, -nw.deductions.total)}
              ${row('Add: capital gains at special rates', o.capitalGains.totalSpecialIncome, nw.capitalGains.totalSpecialIncome)}
              ${row('<b>Total Income</b>', o.totalIncome, nw.totalIncome, 'total')}
              ${row('Tax at slab rates', o.normalTax, nw.normalTax)}
              ${row('Tax on capital gains', o.capitalGains.tax, nw.capitalGains.tax)}
              ${row('Less: rebate u/s 87A', -o.rebate, -nw.rebate)}
              ${o.marginalRelief87A || nw.marginalRelief87A ? row('Less: marginal relief', -o.marginalRelief87A, -nw.marginalRelief87A) : ''}
              ${o.surcharge.amount || nw.surcharge.amount ? row('Add: surcharge', o.surcharge.amount, nw.surcharge.amount) : ''}
              ${row('Add: Health &amp; Education Cess @ 4%', o.cess, nw.cess)}
              ${row('<b>Total tax liability</b>', o.totalTax, nw.totalTax, 'total')}
              ${row('Less: TDS and advance tax paid', -o.taxPaid, -nw.taxPaid)}
              ${row('<b>Balance payable / (refund)</b>', o.balance, nw.balance, 'total')}
            </tbody>
          </table>
        </div>
      </div>

      ${
        hra && hra.amount > 0
          ? `<div class="card" style="margin-bottom:20px;">
        <header><h2>HRA exemption working — section 10(13A)</h2><span class="badge good">${fmt(hra.amount)} exempt</span></header>
        <div class="body table-wrap">
          <p style="margin-top:0; color:var(--ink-soft); font-size:13.5px;">The exemption is the <em>least</em> of these three amounts:</p>
          <table>
            <tbody>${hra.workings.map((w) => `<tr><td>${esc(w.label)}</td><td class="num">${fmt(w.value)}</td></tr>`).join('')}
            <tr class="total"><td>Exemption allowed (lowest of the three)</td><td class="num">${fmt(hra.amount)}</td></tr></tbody>
          </table>
          <div class="note-box" style="margin:14px 0 0;">Available in the old regime only. Under the new regime the whole HRA is taxable.</div>
        </div>
      </div>`
          : ''
      }

      ${
        cgRows
          ? `<div class="card" style="margin-bottom:20px;">
        <header><h2>Capital gains working</h2></header>
        <div class="body table-wrap">
          <table>
            <thead><tr><th>Type of gain</th><th class="num">Gain</th><th class="num">Annual exemption</th><th class="num">Taxable</th><th class="num">Rate</th><th class="num">Tax</th></tr></thead>
            <tbody>${cgRows}</tbody>
          </table>
        </div>
      </div>`
          : ''
      }

      <div class="split">
        <div class="card">
          <header><h2>Deductions — old regime</h2><span class="badge grey">${fmt(o.deductions.total)}</span></header>
          <div class="body table-wrap"><table><thead><tr><th>Section</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${dedRows(o)}</tbody></table></div>
        </div>
        <div class="card">
          <header><h2>Deductions — new regime</h2><span class="badge grey">${fmt(nw.deductions.total)}</span></header>
          <div class="body table-wrap"><table><thead><tr><th>Section</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${dedRows(nw)}</tbody></table></div>
        </div>
      </div>`;
  }

  function renderForms() {
    const a = advice;
    const f = a.filing;
    const at = a.advanceTax;

    const advBlock = at.required
      ? `<table>
          <thead><tr><th>Pay by</th><th class="num">Cumulative</th><th class="num">Amount due by then</th></tr></thead>
          <tbody>${at.instalments.map((i) => `<tr><td>${esc(i.by)}</td><td class="num">${i.cumulativePct}%</td><td class="num">${fmt(i.amount)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="note-box warn" style="margin:14px 0 0;">Missing an instalment attracts interest at 1% a month under sections 234B and 234C. Pay using <strong>Challan ITNS-280</strong> on the e-Pay Tax page.</div>`
      : `<div class="note-box" style="margin:0;">${esc(at.reason)}</div>`;

    $('#tab-forms').innerHTML = `
      <div class="card" style="margin-bottom:20px;">
        <header><h2>The return you must file</h2><span class="badge info">${esc(f.itr.key)}</span></header>
        <div class="body">
          <div style="font-size:22px; font-weight:700; margin-bottom:6px;">${esc(f.itr.name)}</div>
          <p style="margin:0 0 10px; color:var(--ink-soft);">${esc(f.itr.reason)}</p>
          <dl style="display:grid; grid-template-columns:120px 1fr; gap:8px 14px; margin:0; font-size:13.5px;">
            <dt style="font-weight:650; color:var(--ink-soft);">Who files it</dt><dd style="margin:0;">${esc(f.itr.who)}</dd>
            <dt style="font-weight:650; color:var(--ink-soft);">Where</dt><dd style="margin:0;">${esc(f.itr.where)}</dd>
            <dt style="font-weight:650; color:var(--ink-soft);">Due date</dt><dd style="margin:0;">${esc(f.itr.due)}</dd>
          </dl>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <header><h2>Supporting forms you need</h2><span class="badge grey">${f.supporting.length} forms</span></header>
        <div class="body table-wrap">
          <table>
            <thead><tr><th>Form</th><th>Why you need it</th><th>Where / when</th></tr></thead>
            <tbody>
              ${f.supporting
                .map(
                  (s) => `<tr>
                <td><span class="form-pill">${esc(s.name)}</span></td>
                <td>${esc(s.why)}</td>
                <td style="font-size:12.5px; color:var(--ink-soft);">${esc(s.where)}<br><em>${esc(s.due)}</em></td>
              </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="split">
        <div class="card">
          <header><h2>Advance tax plan</h2></header>
          <div class="body table-wrap">${advBlock}</div>
        </div>
        <div class="card">
          <header><h2>Compliance calendar</h2></header>
          <div class="body">
            <ul class="cal">${f.calendar.map((c) => `<li><span class="date">${esc(c.date)}</span><span>${esc(c.event)}</span></li>`).join('')}</ul>
          </div>
        </div>
      </div>`;
  }

  function renderChecklist() {
    const list = Advisor.documentChecklist(profile, advice.regime);
    $('#tab-checklist').innerHTML = `
      <div class="card">
        <header><h2>Documents to collect before you file</h2><span class="badge grey">${list.length} items</span></header>
        <div class="body">
          <ul class="checklist">
            ${list
              .map(
                (l, i) => `<li>
              <input type="checkbox" id="chk${i}">
              <div><label for="chk${i}" class="d">${esc(l.doc)}</label><div class="w">${esc(l.why)}</div></div>
            </li>`
              )
              .join('')}
          </ul>
        </div>
      </div>`;
  }

  function renderReasoning() {
    const best = advice.comparison.best;
    const rows = best.trace
      .map(
        (t, i) => `<tr>
        <td style="color:var(--ink-faint); font-family:var(--mono);">${i + 1}</td>
        <td><b>${esc(t.step)}</b><br><span style="font-size:12.5px; color:var(--ink-soft);">${esc(t.detail)}</span></td>
        <td class="num" style="color:${t.amount < 0 ? 'var(--good)' : 'var(--ink)'};">${t.amount === 0 ? '—' : (t.amount < 0 ? '−' : '') + fmt(Math.abs(t.amount))}</td>
      </tr>`
      )
      .join('');

    $('#tab-reasoning').innerHTML = `
      <div class="note-box">
        This is the agent's full reasoning chain for the recommended <strong>${esc(advice.regime)} regime</strong>.
        Every line is produced by a deterministic rule in <code>engine.js</code> reading limits from <code>rulebook.js</code> —
        nothing here is generated by a language model, which is why the arithmetic can be audited line by line.
      </div>
      <div class="card">
        <header><h2>Computation trace</h2><span class="badge grey">${best.trace.length} steps</span></header>
        <div class="body table-wrap">
          <table><thead><tr><th style="width:40px;">#</th><th>Rule applied</th><th class="num">Effect</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>`;
  }

  /* ---------- run the analysis ------------------------------------------- */

  function analyse() {
    readForm();
    advice = Advisor.generateAdvice(profile, year);

    $('#resultYearBadge').textContent = RULEBOOK.years[year].label;
    renderHeadline();
    renderOverview();
    renderHowYouSave();
    renderActions();
    renderComputation();
    renderForms();
    renderChecklist();
    renderReasoning();

    $('#intakeView').classList.add('hidden');
    $('#resultsView').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- wiring ------------------------------------------------------ */

  function init() {
    // Year selector
    $('#yearSel').innerHTML = Object.keys(RULEBOOK.years)
      .map((k) => `<option value="${k}" ${k === year ? 'selected' : ''}>${esc(RULEBOOK.years[k].label)}</option>`)
      .join('');

    $('#yearSel').addEventListener('change', (e) => {
      year = e.target.value;
      updateLive();
      if (advice) analyse();
    });

    $('#sampleSel').addEventListener('change', (e) => {
      const key = e.target.value;
      profile = key && SAMPLES[key] ? JSON.parse(JSON.stringify(SAMPLES[key])) : blankProfile();
      writeForm();
      updateLive();
    });

    $('#intakeForm').addEventListener('input', updateLive);
    $('#intakeForm').addEventListener('change', updateLive);
    $('#intakeForm').addEventListener('submit', (e) => e.preventDefault());

    $('#btnNext').addEventListener('click', () => {
      if (step === STEPS.length - 1) analyse();
      else showStep(step + 1);
    });
    $('#btnBack').addEventListener('click', () => showStep(step - 1));
    $('#btnAnalyse').addEventListener('click', analyse);
    $('#btnEdit').addEventListener('click', () => {
      $('#resultsView').classList.add('hidden');
      $('#intakeView').classList.remove('hidden');
      window.scrollTo({ top: 0 });
    });
    $('#btnPrint').addEventListener('click', () => window.print());

    $('#stepChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-goto]');
      if (b) showStep(Number(b.dataset.goto));
    });

    $('#resultTabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (!t) return;
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + t.dataset.tab));
    });

    showStep(0);
    writeForm();
    updateLive();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
