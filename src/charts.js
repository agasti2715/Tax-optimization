/* ============================================================================
 * charts.js — THE VISUALISATIONS THE REPORT SPECIFIES
 * ----------------------------------------------------------------------------
 * Report §3.1.1 requirement 5: "The system shall present financial data, tax
 * projections, and optimization results through intuitive visual dashboards
 * including bar charts, pie charts, and line graphs that clearly illustrate
 * tax liability trends and savings opportunities."
 *
 * Two of these are named figures in the report and had no implementation at
 * all until now:
 *
 *   Figure 6   Tax Saving Pie Chart          -> donut()
 *   Figure 7   Income vs Tax Payable,
 *              Before and After              -> beforeAfter()
 *
 * ----------------------------------------------------------------------------
 * WHY HAND-WRITTEN SVG RATHER THAN RECHARTS
 * ----------------------------------------------------------------------------
 * The report's technology stack (§3.4.1) names Recharts, which assumes React
 * and a build step. This application deliberately has neither — it is a single
 * folder of plain files that opens in a browser with nothing installed, which
 * is what lets the whole thing run offline with no data leaving the machine.
 *
 * Pulling in a charting library would mean adding a bundler, a package
 * manifest and a node_modules tree to draw four charts. These are four charts.
 * Written directly as SVG they are about 200 lines, have no supply chain, and
 * render identically everywhere including in the print stylesheet — which
 * matters, because §3.1.1 requirement 6 asks for a report the user can print.
 *
 * The charts are functionally what the report specifies. The library is not.
 * ========================================================================== */

/* ---------- shared drawing helpers --------------------------------------- */

const CHART_PALETTE = [
  '#5B4BC4', '#2E9E7E', '#D98324', '#C2456B', '#3A7CA5', '#8A6FD1', '#6B8E23',
];

const cEsc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cInr = (v) => {
  const x = Math.round(Number(v) || 0);
  const s = Math.abs(x).toLocaleString('en-IN');
  return (x < 0 ? '−₹' : '₹') + s;
};

/** Compact rupees for axis labels — 1.2L, 45k — so ticks do not collide. */
const cShort = (v) => {
  const x = Math.abs(Math.round(Number(v) || 0));
  if (x >= 10000000) return '₹' + (x / 10000000).toFixed(1).replace(/\.0$/, '') + 'Cr';
  if (x >= 100000) return '₹' + (x / 100000).toFixed(1).replace(/\.0$/, '') + 'L';
  if (x >= 1000) return '₹' + Math.round(x / 1000) + 'k';
  return '₹' + x;
};

/**
 * Wrap chart markup in a responsive SVG.
 *
 * viewBox plus width:100% means the chart scales to its container without
 * any JavaScript resize handling, which keeps it correct on a phone and in
 * a print preview alike.
 */
function svg(w, h, body, title) {
  // Height is left to CSS rather than set as an attribute. SVG attributes take
  // a length, not a keyword, so height="auto" is invalid and the browser
  // reports it — the aspect ratio has to come from viewBox plus a CSS rule.
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" ' +
         'preserveAspectRatio="xMidYMid meet" role="img" ' +
         'aria-label="' + cEsc(title || 'chart') + '" ' +
         'style="display:block; height:auto; overflow:visible; font-family:inherit;">' +
         body + '</svg>';
}

const txt = (x, y, s, o) => {
  const opt = o || {};
  return '<text x="' + x + '" y="' + y + '"' +
    ' fill="' + (opt.fill || '#3A3A4A') + '"' +
    ' font-size="' + (opt.size || 12) + '"' +
    ' font-weight="' + (opt.weight || 400) + '"' +
    ' text-anchor="' + (opt.anchor || 'start') + '"' +
    (opt.family ? ' font-family="' + opt.family + '"' : '') +
    '>' + cEsc(s) + '</text>';
};

/* ============================================================================
 * FIGURE 6 — TAX SAVING PIE CHART
 * ==========================================================================*/

/**
 * A donut showing where the saving actually comes from.
 *
 * Report §5.1.2 breaks savings down by deduction category and gives cohort
 * averages (80C about 45%, 80D 18%, 80CCD(1B) 22%, the rest 15%). This chart
 * does not draw those averages — it draws the split measured for the taxpayer
 * on screen, because the report's own §2.2.2 criticism of existing tools is
 * precisely that they "apply standardized formulas and generic
 * recommendations".
 *
 * @param slices [{ section, saving, pct }]
 */
function donut(slices, opts) {
  const o = opts || {};
  const W = 460, H = 240;
  const cx = 118, cy = 120, rOuter = 92, rInner = 54;

  const data = (slices || []).filter((s) => s.saving > 0);
  if (!data.length) {
    return svg(W, H,
      txt(W / 2, H / 2, 'No saving to break down yet', { anchor: 'middle', fill: '#8A8A9A', size: 14 }),
      'Tax saving breakdown');
  }

  const total = data.reduce((s, d) => s + d.saving, 0);
  let angle = -Math.PI / 2;   // start at 12 o'clock
  let paths = '';

  data.forEach((d, i) => {
    const sweep = (d.saving / total) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const colour = CHART_PALETTE[i % CHART_PALETTE.length];

    // A single slice equal to the whole circle cannot be drawn as an arc —
    // start and end land on the same point and the path collapses to nothing.
    if (data.length === 1) {
      paths += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((rOuter + rInner) / 2) + '" ' +
               'fill="none" stroke="' + colour + '" stroke-width="' + (rOuter - rInner) + '"/>';
    } else {
      const x1 = cx + rOuter * Math.cos(angle), y1 = cy + rOuter * Math.sin(angle);
      const x2 = cx + rOuter * Math.cos(end), y2 = cy + rOuter * Math.sin(end);
      const x3 = cx + rInner * Math.cos(end), y3 = cy + rInner * Math.sin(end);
      const x4 = cx + rInner * Math.cos(angle), y4 = cy + rInner * Math.sin(angle);
      paths += '<path d="M' + x1 + ' ' + y1 +
               ' A' + rOuter + ' ' + rOuter + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 +
               ' L' + x3 + ' ' + y3 +
               ' A' + rInner + ' ' + rInner + ' 0 ' + large + ' 0 ' + x4 + ' ' + y4 + ' Z" ' +
               'fill="' + colour + '" stroke="#fff" stroke-width="1.5"/>';
    }
    angle = end;
  });

  // Centre label — the total, which is the number people actually want.
  const centre =
    txt(cx, cy - 4, cShort(total), { anchor: 'middle', size: 22, weight: 700, fill: '#1A1A2E' }) +
    txt(cx, cy + 15, o.centreLabel || 'total saving', { anchor: 'middle', size: 11, fill: '#8A8A9A' });

  // Legend down the right-hand side.
  let legend = '';
  const lx = 250;
  data.slice(0, 6).forEach((d, i) => {
    const ly = 40 + i * 30;
    legend += '<rect x="' + lx + '" y="' + (ly - 9) + '" width="11" height="11" rx="2.5" ' +
              'fill="' + CHART_PALETTE[i % CHART_PALETTE.length] + '"/>';
    legend += txt(lx + 19, ly, d.section, { size: 12.5, weight: 600, fill: '#1A1A2E' });
    legend += txt(lx + 19, ly + 14, cInr(d.saving) + '  ·  ' + d.pct + '%', { size: 11.5, fill: '#6A6A7A' });
  });

  return svg(W, H, paths + centre + legend, 'Tax saving by section');
}

/* ============================================================================
 * FIGURE 7 — INCOME VS TAX PAYABLE, BEFORE AND AFTER
 * ==========================================================================*/

/**
 * Grouped bars: what you earn, what you paid, what you would pay.
 *
 * The point of putting income on the same axis is proportion. A saving of
 * Rs.50,000 means something different against Rs.8 lakh of income than
 * against Rs.80 lakh, and a chart of tax alone hides that completely.
 */
function beforeAfter(income, taxBefore, taxAfter, opts) {
  const o = opts || {};
  const W = 460, H = 250;
  const padL = 54, padR = 16, padT = 26, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const bars = [
    { label: 'Gross income', value: Math.max(0, income), colour: '#3A7CA5' },
    { label: 'Tax before', value: Math.max(0, taxBefore), colour: '#C2456B' },
    { label: 'Tax after', value: Math.max(0, taxAfter), colour: '#2E9E7E' },
  ];
  const max = Math.max(...bars.map((b) => b.value), 1);

  // Gridlines at quarters of the maximum, rounded to something readable.
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const y = padT + plotH - (v / max) * plotH;
    grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y +
            '" stroke="#E8E6F0" stroke-width="1"/>';
    grid += txt(padL - 8, y + 4, cShort(v), { anchor: 'end', size: 10.5, fill: '#9A9AAA' });
  }

  const slot = plotW / bars.length;
  const bw = Math.min(74, slot * 0.52);
  let body = '';

  bars.forEach((b, i) => {
    const h = (b.value / max) * plotH;
    const x = padL + slot * i + (slot - bw) / 2;
    const y = padT + plotH - h;
    body += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(1, h) +
            '" rx="5" fill="' + b.colour + '"/>';
    body += txt(x + bw / 2, y - 7, cShort(b.value), { anchor: 'middle', size: 12, weight: 700, fill: '#1A1A2E' });
    body += txt(x + bw / 2, H - padB + 18, b.label, { anchor: 'middle', size: 11.5, fill: '#5A5A6A' });
  });

  // The saving, called out between the two tax bars.
  const saved = Math.max(0, taxBefore - taxAfter);
  if (saved > 0) {
    const pct = taxBefore > 0 ? Math.round((saved / taxBefore) * 100) : 0;
    body += txt(W - padR, padT - 10, 'saves ' + cInr(saved) + ' (' + pct + '%)',
      { anchor: 'end', size: 12, weight: 700, fill: '#2E9E7E' });
  }

  return svg(W, H, grid + body, o.title || 'Income against tax payable, before and after');
}

/* ============================================================================
 * REGIME COMPARISON
 * ==========================================================================*/

/** Two horizontal bars — old against new — with the winner marked. */
function regimeBars(oldTax, newTax) {
  const W = 460, H = 132;
  const padL = 74, padR = 90;
  const plotW = W - padL - padR;
  const max = Math.max(oldTax, newTax, 1);

  const rows = [
    { label: 'Old regime', value: oldTax, y: 34 },
    { label: 'New regime', value: newTax, y: 84 },
  ];
  const winner = newTax <= oldTax ? 'New regime' : 'Old regime';

  let body = '';
  for (const r of rows) {
    const w = Math.max(2, (r.value / max) * plotW);
    const isWin = r.label === winner;
    body += txt(padL - 10, r.y + 5, r.label, { anchor: 'end', size: 12.5, weight: isWin ? 700 : 400, fill: '#1A1A2E' });
    body += '<rect x="' + padL + '" y="' + (r.y - 13) + '" width="' + w + '" height="26" rx="5" ' +
            'fill="' + (isWin ? '#2E9E7E' : '#B9B4D4') + '"/>';
    body += txt(padL + w + 10, r.y + 5, cInr(r.value),
      { size: 12.5, weight: isWin ? 700 : 400, fill: isWin ? '#2E9E7E' : '#6A6A7A' });
  }
  body += txt(padL, 118, 'The ' + winner.toLowerCase() + ' is cheaper by ' +
    cInr(Math.abs(oldTax - newTax)), { size: 11.5, fill: '#6A6A7A' });

  return svg(W, H, body, 'Old regime against new regime');
}

/* ============================================================================
 * DEDUCTION UTILISATION
 * ==========================================================================*/

/**
 * How much of each limit is actually used.
 *
 * This is the chart for report §5.2's central finding — "the average user in
 * the test cohort was utilizing only 58% of their available Section 80C limit
 * and 43% of their Section 80D limit". The unfilled part of each bar is the
 * money still on the table, so the empty space is the point.
 */
function utilisationBars(rows) {
  const W = 460;
  const rowH = 46;
  const H = 16 + rows.length * rowH;
  const padL = 92, padR = 74;
  const plotW = W - padL - padR;

  let body = '';
  rows.forEach((r, i) => {
    const y = 26 + i * rowH;
    const w = Math.max(0, Math.min(1, r.pct / 100)) * plotW;
    const colour = r.pct >= 90 ? '#2E9E7E' : r.pct >= 50 ? '#D98324' : '#C2456B';

    body += txt(padL - 10, y + 5, r.section, { anchor: 'end', size: 12.5, weight: 600, fill: '#1A1A2E' });
    body += '<rect x="' + padL + '" y="' + (y - 11) + '" width="' + plotW + '" height="22" rx="5" fill="#EDEBF5"/>';
    if (w > 0) {
      body += '<rect x="' + padL + '" y="' + (y - 11) + '" width="' + w + '" height="22" rx="5" fill="' + colour + '"/>';
    }
    body += txt(padL + plotW + 10, y + 5, r.pct + '%', { size: 12.5, weight: 700, fill: colour });
    body += txt(padL, y + 25, cInr(r.used) + ' of ' + cInr(r.limit) +
      (r.headroom > 0 ? '  ·  ' + cInr(r.headroom) + ' unused' : '  ·  fully used'),
      { size: 11, fill: '#8A8A9A' });
  });

  return svg(W, H, body, 'Deduction limits used');
}

/* ============================================================================
 * SCENARIO COMPARISON
 * ==========================================================================*/

/**
 * A diverging bar per what-if scenario: left of the line saves money, right
 * of it costs money.
 *
 * A zero line down the middle is what makes "get a raise" legible — it is the
 * only scenario that moves tax UP, and on a one-sided chart it would look like
 * just another option rather than the opposite of one.
 */
function scenarioBars(scenarios) {
  // LAYOUT NOTE. The labels are right-anchored so they line up against the
  // bars, which means they grow LEFTWARDS from their x. The first version put
  // that x at 88 with only ~76px of room, so anything longer ran off into
  // negative coordinates and was clipped — leaving the reader the tail of the
  // sentence ("basic through em…") instead of its start.
  //
  // So the label gutter is sized first and everything else is placed after it,
  // and labels are truncated to what that gutter can actually hold.
  const labelW = 208;          // room reserved for the label text
  const gap = 14;              // between label and the zero line
  const halfW = 104;           // longest bar, either side of zero
  const valueW = 62;           // room for the figure beside each bar

  const mid = labelW + gap + halfW;
  const W = mid + halfW + valueW;
  const rowH = 38;
  const list = (scenarios || []).slice(0, 7);
  const H = 34 + list.length * rowH;

  const maxAbs = Math.max(1, ...list.map((s) => Math.abs(s.delta)));

  // Roughly 5.6px per character at 11.5px in a normal UI face.
  const maxChars = Math.floor(labelW / 5.6);
  const fit = (s) => (s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s);

  let body = '<line x1="' + mid + '" y1="18" x2="' + mid + '" y2="' + (H - 8) +
             '" stroke="#C9C4DE" stroke-width="1" stroke-dasharray="3 3"/>';

  list.forEach((s, i) => {
    const y = 34 + i * rowH;
    const w = (Math.abs(s.delta) / maxAbs) * halfW;
    const saves = s.delta < 0;
    const colour = saves ? '#2E9E7E' : (s.delta === 0 ? '#B9B4D4' : '#C2456B');
    const x = saves ? mid - w : mid;

    body += txt(labelW, y + 4, fit(s.label), { anchor: 'end', size: 11.5, fill: '#1A1A2E' });
    if (w > 0.5) {
      body += '<rect x="' + x + '" y="' + (y - 9) + '" width="' + w + '" height="18" rx="4" fill="' + colour + '"/>';
    }
    const lx = saves ? mid + 8 : mid + w + 8;
    body += txt(lx, y + 4, (s.delta === 0 ? 'no change' : (saves ? '−' : '+') + cShort(Math.abs(s.delta))),
      { size: 11.5, weight: 600, fill: colour });
  });

  body += txt(mid - 8, 16, 'saves you money', { anchor: 'end', size: 10.5, fill: '#2E9E7E' });
  body += txt(mid + 8, 16, 'costs you money', { size: 10.5, fill: '#C2456B' });

  return svg(W, H, body, 'What-if scenarios compared');
}

/* ---------------------------------------------------------------------------
 * Plain global, plus a CommonJS tail for the Node tests.
 * ------------------------------------------------------------------------ */
const Charts = {
  donut, beforeAfter, regimeBars, utilisationBars, scenarioBars,
  PALETTE: CHART_PALETTE, short: cShort, inr: cInr,
};

if (typeof window !== 'undefined') window.Charts = Charts;
if (typeof module !== 'undefined' && module.exports) module.exports = Charts;
