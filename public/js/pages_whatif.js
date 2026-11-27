// Page: What-if studio — "what happens if we change how the building runs?"
// Five levers (aircond, lighting, EV chargers, pumps, non-essential equipment) can be combined.
import { h, nf, rm, kw, fmtHour, fmtDate } from './dom.js';
import { S, ctx, saveSettings, defaultLevers, MLAB, ytd, clockInfo } from './store.js';
import { applyLevers, indoorProfile, outdoorTemp, monthlyBills, MONTHS, dayIdxToDate } from './engine.js';
import { make, afterMount, ranges, COL } from './charts.js';
import { hooks, section, card, stat, chartBox, monthSelect, seg, slider } from './ui.js';

const INFO = {
  hvac: ['Aircond (chillers & AHUs)', 'Usually the biggest flexible load. Cutting it warms the room, and a sudden restart can cause a “snap-back” peak.'],
  light: ['Lighting', 'Dim or switch off lights in daylight areas, corridors and car parks. Little or no rebound.'],
  ev: ['EV chargers', 'Pause charging at peak and charge later. The energy is deferred, not lost.'],
  pump: ['Water pumps & storage', 'Fill storage tanks off-peak instead of pumping at peak. Deferred, not lost.'],
  equip: ['Non-essential equipment', 'Vending machines, display screens, printers, back-of-house. Mostly a straight cut.'],
};
const hr24 = (v) => (v === 24 ? '12 AM' : fmtHour(v));
const sc = () => S.settings.scn;
const save = () => { S.plan = null; saveSettings(); hooks.rerender(); };
const setScn = (patch) => { Object.assign(sc(), patch); save(); };
const setLever = (id, patch) => { Object.assign(sc().levers.find((l) => l.id === id), patch); save(); };

const PRESETS = [
  ['Aircond off, 2–4 PM', { hvac: { on: true, cut: 100, start: 14, end: 16, backPct: 30, spread: 3 } }],
  ['Setpoint +2 °C, 2–6 PM', { hvac: { on: true, cut: 12, start: 14, end: 18, backPct: 30, spread: 4 } }],
  ['Pause EV charging at peak', { ev: { on: true } }],
  ['Dim lights + trim equipment', { light: { on: true }, equip: { on: true } }],
  ['Everything together', { hvac: { on: true, cut: 12, start: 14, end: 18, backPct: 30, spread: 4 }, light: { on: true }, ev: { on: true }, pump: { on: true }, equip: { on: true } }],
];
const applyPreset = (patch) => setScn({ levers: defaultLevers().map((L) => ({ ...L, on: false, ...(patch[L.id] || {}) })) });

function wxSource(o) {
  if (o.wxMode === 'demo') return S.data.weather_daily;
  return { tmax: new Array(365).fill(33), tmin: new Array(365).fill(25) }; // typical Malaysian day, 25–33 °C
}
const summary = (L) => `${L.cut === 100 ? 'off' : L.cut + '% cut'} · ${fmtHour(L.start)}–${hr24(L.end)}${L.backPct ? ` · ${L.backPct}% comes back over ${L.spread} h` : ''}`;
function peakHour(c, arr, month) {
  const s = c.tl.monthStartDay[month] * 24, e = s + c.tl.daysInMonth[month] * 24; let best = s;
  for (let i = s; i < e; i++) if (c.mdmask[i] && arr[i] > arr[best]) best = i;
  return best % 24;
}
function runLevers(c, levers, weekdaysOnly) {
  const r = applyLevers(c.actualKw, c.tl, levers, weekdaysOnly);
  return { r, bills: monthlyBills(r.out, c.tl, c.pmask, c.mdmask, c.tariff) };
}
function comfortOpts(o, hv) { return { start: hv.start, end: hv.end, cutPct: hv.cut, setC: o.setC, tau: o.tau, perDeg: o.perDeg, weekdaysOnly: o.weekdaysOnly }; }

/** Try every start time, depth and restart speed of the AIRCOND lever (others fixed); keep the biggest saving that stays within the comfort limit. */
function bestPlan(c, o, month, day) {
  const hv = o.levers.find((l) => l.id === 'hvac'), dur = hv.end - hv.start, b0 = c.billsAct[month], wx = wxSource(o); let best = null;
  for (let st = 6; st + dur <= 24; st++) for (let cut = 10; cut <= 100; cut += 10) for (let sp = 2; sp <= 6; sp++) {
    const nh = { ...hv, start: st, end: st + dur, cut, spread: sp };
    const T = indoorProfile(wx, c.tl, day, comfortOpts(o, nh)); const mx = Math.max(...T); if (mx > o.limitC + 1e-9) continue;
    const { bills } = runLevers(c, o.levers.map((l) => (l.id === 'hvac' ? nh : l)), o.weekdaysOnly);
    const saving = b0.total - bills[month].total;
    if (saving > (best ? best.saving : 0)) best = { start: st, end: st + dur, cut, spread: sp, saving, md: bills[month].mdKw, maxT: mx };
  }
  return best;
}

function leverCard(L) {
  const o = sc();
  const head = h('label', { class: 'lever-head' }, h('input', { type: 'checkbox', checked: L.on, onchange: (e) => setLever(L.id, { on: e.target.checked }) }),
    h('div', null, h('b', null, INFO[L.id][0]), h('span', { class: 'tiny' }, L.on ? summary(L) : INFO[L.id][1])));
  if (!L.on) return h('div', { class: 'lever' }, head);
  const body = h('div', { class: 'lever-body' }, h('p', { class: 'tiny', style: 'margin-bottom:10px' }, INFO[L.id][1]),
    h('div', { class: 'grid g2' },
      slider({ label: 'From', min: 0, max: 23, value: L.start, fmt: fmtHour, onChange: (v) => setLever(L.id, { start: v, end: Math.max(L.end, v + 1) }) }),
      slider({ label: 'Until', min: 1, max: 24, value: L.end, fmt: hr24, onChange: (v) => setLever(L.id, { end: v, start: Math.min(L.start, v - 1) }) })),
    slider({ label: L.id === 'hvac' ? 'How much of the aircond do you cut?' : 'How much of this load do you cut or defer?', min: 0, max: 100, step: 5, value: L.cut, fmt: (v) => (v === 100 ? 'All' : v + '%'), onChange: (v) => setLever(L.id, { cut: v }) }),
    L.id === 'hvac' ? h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:-4px 0 12px' }, [['Off', 100], ['+1 °C', o.perDeg], ['+2 °C', 2 * o.perDeg], ['+3 °C', 3 * o.perDeg]].map(([l, v]) => h('button', { class: 'chipbtn' + (L.cut === v ? ' accent' : ''), onclick: () => setLever('hvac', { cut: v }) }, l))) : null,
    h('div', { class: 'grid g2' },
      slider({ label: 'Share of the whole building’s load', min: 1, max: 80, value: L.share, fmt: (v) => v + '%', onChange: (v) => setLever(L.id, { share: v }), hint: 'An assumption — use sub-meter data if you have it.' }),
      slider({ label: 'How much of the energy comes back later?', min: 0, max: 100, step: 5, value: L.backPct, fmt: (v) => v + '%', onChange: (v) => setLever(L.id, { backPct: v }) })),
    L.backPct > 0 ? slider({ label: 'Spread the comeback over', min: 1, max: 8, value: L.spread, fmt: (v) => `${v} h`, onChange: (v) => setLever(L.id, { spread: v }), hint: 'A sudden restart makes everything run flat out at once — a new peak.' }) : null);
  return h('div', { class: 'lever on' }, head, body);
}

export function pageWhatIf() {
  const c = ctx(), o = sc(), m = S.month, tl = c.tl, t = c.tariff, wx = wxSource(o);
  const levers = o.levers, active = levers.filter((l) => l.on), hv = active.find((l) => l.id === 'hvac');
  const s0 = tl.monthStartDay[m], nd = tl.daysInMonth[m];
  if (S.whatDay == null || S.whatDay < s0 || S.whatDay >= s0 + nd) {
    let best = s0, bv = -1;
    for (let d = s0; d < s0 + nd; d++) { if (o.weekdaysOnly && tl.dow[d * 24] >= 5) continue; for (let k = 0; k < 24; k++) { const j = d * 24 + k; if (c.mdmask[j] && c.actualKw[j] > bv) { bv = c.actualKw[j]; best = d; } } }
    S.whatDay = best;
  }
  const day = S.whatDay, a0 = day * 24;
  const { r, bills } = runLevers(c, levers, o.weekdaysOnly);
  const b0 = c.billsAct[m], b1 = bills[m];
  const saving = b0.total - b1.total, mdDelta = b1.mdKw - b0.mdKw, kwhDelta = b1.kwh - b0.kwh;
  const ph1 = peakHour(c, r.out, m);
  const sumShare = active.reduce((a, l) => a + l.share, 0);
  const dayApplies = !(o.weekdaysOnly && tl.dow[a0] >= 5);
  const touches = !t.mdPeakOnly || active.some((l) => l.start < t.peakEnd && l.end > t.peakStart);
  // rebound attribution: does the comeback energy itself create a higher peak?
  const noBack = runLevers(c, levers.map((l) => ({ ...l, backPct: 0 })), o.weekdaysOnly).bills[m];
  const rebound = mdDelta > 1 && noBack.mdKw < b0.mdKw + 1e-6;
  // comfort (aircond only)
  let T = null, Tmax = NaN, Tpk = 0, over = 0;
  if (hv) { T = indoorProfile(wx, tl, day, comfortOpts(o, hv)); Tmax = Math.max(...T); Tpk = T.indexOf(Tmax); over = T.filter((v) => v > o.limitC + 1e-9).length; }

  // ---------------------------------------------------------------- controls
  const presets = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, PRESETS.map(([label, patch]) => h('button', { class: 'chipbtn', onclick: () => applyPreset(patch) }, label)));
  const controls = h('div', null,
    card('', h('div', { class: 'label' }, 'Start from a scenario'), h('div', { style: 'margin:10px 0 4px' }, presets),
      h('div', { class: 'grid g2', style: 'margin-top:14px' },
        h('div', { class: 'field', style: 'margin:0' }, h('span', null, 'Which days?'), seg([['wk', 'Weekdays'], ['all', 'Every day']], o.weekdaysOnly ? 'wk' : 'all', (v) => setScn({ weekdaysOnly: v === 'wk' }))), monthSelect())),
    h('div', { class: 'sec', style: 'margin:22px 0 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap' }, h('div', { class: 'hand' }, 'switch on the levers you can really pull'),
      S.validation ? h('button', { class: 'chipbtn', title: 'From the CU-BEMS Bangkok office building (real meter data)', onclick: () => { const sh = S.validation.cubems.load_shares['overall_%']; setScn({ levers: levers.map((l) => (l.id === 'hvac' ? { ...l, share: Math.round(sh.ac_kw) } : l.id === 'light' ? { ...l, share: Math.round(sh.light_kw) } : l)) }); } }, `Use real-office shares (AC ${Math.round(S.validation.cubems.load_shares['overall_%'].ac_kw)}%, lights ${Math.round(S.validation.cubems.load_shares['overall_%'].light_kw)}%)`) : null),
    levers.map(leverCard),
    sumShare > 90 ? h('p', { class: 'bad', style: 'margin:6px 0 10px' }, `The active levers add up to ${sumShare}% of the building’s load — that is unrealistic. Lower their shares.`) : null,
    h('details', { class: 'fold' }, h('summary', null, 'Room-temperature assumptions (aircond)'),
      h('div', { class: 'grid g2' },
        slider({ label: 'Aircond setpoint', min: 22, max: 26, value: o.setC, fmt: (v) => v + ' °C', onChange: (v) => setScn({ setC: v }) }),
        slider({ label: 'Comfort limit', min: 25, max: 29, value: o.limitC, fmt: (v) => v + ' °C', onChange: (v) => setScn({ limitC: v }) }),
        slider({ label: '% cooling cut per +1 °C setpoint', min: 3, max: 12, value: o.perDeg, fmt: (v) => v + '%', onChange: (v) => setScn({ perDeg: v }), hint: 'Rule of thumb, not a measured value. Change it to match your building.' }),
        h('div', null)),
      h('div', { class: 'field' }, h('span', null, 'How quickly does the building warm up?'), seg([[3, 'Light glass tower'], [6, 'Typical'], [10, 'Heavy concrete']], o.tau, (v) => setScn({ tau: v }))),
      h('div', { class: 'field' }, h('span', null, 'Outdoor weather for the room model'), seg([['my', 'Typical Malaysia 25–33 °C'], ['demo', 'Demo data (hot desert)']], o.wxMode || 'my', (v) => setScn({ wxMode: v })),
        h('small', null, 'The research dataset is from the UAE, so by default the room model uses a typical Malaysian day.'))));

  // ---------------------------------------------------------------- plan finder
  const plan = S.plan;
  const planCard = card('lilac tilt2', h('h3', null, 'Not sure? Let GridCast tune the aircond'),
    h('p', { class: 'tiny', style: 'margin:4px 0 12px' }, hv ? `Keeps the aircond window ${hv.end - hv.start} h long and tries every start time, depth and restart speed. Other levers stay as you set them. Only plans that keep the room under ${o.limitC} °C on the day shown are kept.` : 'Switch on the aircond lever first — this tuner optimises it.'),
    hv ? h('button', { class: 'btn small', onclick: () => { S.plan = bestPlan(c, o, m, day) || 'none'; hooks.rerender(); } }, '✨ Find the best aircond plan') : null,
    plan === 'none' ? h('p', { style: 'margin-top:12px' }, 'No aircond plan of that length stays under your comfort limit and saves money. Try a shorter window or a higher limit.')
      : plan ? h('div', { style: 'margin-top:14px' },
        h('p', { style: 'font-size:16px' }, plan.cut === 100 ? 'Turn the aircond ' : `Cut the aircond by ${plan.cut}% `, plan.cut === 100 ? h('b', null, 'off') : null, ' from ', h('b', null, fmtHour(plan.start)), ' to ', h('b', null, hr24(plan.end)), ', restarting over ', h('b', null, `${plan.spread} h`), '.'),
        h('p', { class: 'muted', style: 'margin-top:4px' }, `Saves about ${rm(plan.saving)} in ${MLAB(m)} · peak ${kw(plan.md)} · room peaks at ${nf(plan.maxT, 1)} °C.`),
        h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn small', onclick: () => setLever('hvac', { start: plan.start, end: plan.end, cut: plan.cut, spread: plan.spread }) }, 'Apply this plan'))) : null);
  const tips = card('sky', h('h3', null, 'How to read this'), h('ul', { style: 'padding-left:18px;margin:8px 0 0;display:grid;gap:7px;font-size:14.5px' }, [
    'The peak charge is set by ONE hour a month — cutting that hour matters far more than trimming energy overall.',
    'Cutting a load and getting the energy back right after (the “comes back” slider) can create a new, higher peak.',
    'Deferrable loads (EV chargers, pumps with storage) are the safest levers: they lose nothing, they just move.',
    'The baseline is the real meter, so numbers match the Bills page.',
    S.validation ? `Real example: a Bangkok office building lets its aircond drop at lunch (${nf(S.validation.cubems.lunch_effect.ac_11h)} → ${nf(S.validation.cubems.lunch_effect.ac_12h)} kW), then the whole building jumps to ${nf(S.validation.cubems.lunch_effect.total_13h)} kW at 1 PM — higher than at 11 AM (${nf(S.validation.cubems.lunch_effect.total_11h)} kW).` : null].filter(Boolean).map((x) => h('li', null, x))));

  // ---------------------------------------------------------------- results
  const good = saving > 0.5, tone = good ? (over ? 'watch' : 'ok') : 'alert';
  const sticker = !good ? 'Costs you money' : over ? 'Saves, but too warm' : 'Good trade';
  const resCards = h('div', { class: 'grid g4' },
    h('div', { class: 'card ' + (good ? 'sky' : 'peach') }, h('div', { class: 'label' }, `Bill · ${MLAB(m)}`), h('div', { class: 'stat-big' }, (saving >= 0 ? '− ' : '+ ') + rm(Math.abs(saving))), h('div', { class: 'stat-sub' }, `${rm(b0.total)} → ${rm(b1.total)}`)),
    stat('Peak charge level', kw(b1.mdKw), mdDelta === 0 ? 'unchanged' : h('span', { class: mdDelta < 0 ? 'good' : 'bad' }, `${mdDelta < 0 ? '▼' : '▲'} ${kw(Math.abs(mdDelta))} vs ${kw(b0.mdKw)}`)),
    stat('Energy used', `${nf(Math.abs(kwhDelta))} kWh`, kwhDelta <= 0 ? h('span', { class: 'good' }, `less than before (${nf(Math.abs(kwhDelta / b0.kwh) * 100, 1)}%)`) : h('span', { class: 'bad' }, 'more than before')),
    hv ? h('div', { class: 'card ' + (over ? 'peach' : 'lilac') }, h('div', { class: 'label' }, 'Warmest the room gets'), h('div', { class: 'stat-big' }, `${nf(Tmax, 1)} °C`),
      h('div', { class: 'stat-sub' }, dayApplies ? (Tmax <= o.setC + 0.05 ? 'stays at setpoint' : `around ${fmtHour(Tpk + 1)}${over ? ` · ${over} h over your ${o.limitC} °C limit` : ' · within your limit'}`) : 'selected day is not affected'))
      : stat('Room temperature', '—', 'Aircond lever is off, so nothing to warm up.', 'lilac'));

  const bits = [];
  if (!active.length) bits.push('Switch on at least one lever to see what it would do.');
  if (active.length && !touches) bits.push(`None of your windows overlaps the period your peak charge is measured (${fmtHour(t.peakStart)}–${fmtHour(t.peakEnd)}), so this can only save energy, not the peak charge.`);
  if (rebound) bits.push(`<b>Rebound warning:</b> the energy that comes back afterwards pushes the month’s highest peak to <b>${fmtHour(ph1)}</b>, up by <b>${kw(mdDelta)}</b>. Spread the comeback over more hours, or defer it to after the peak period.`);
  else if (good && mdDelta < -1) bits.push(`The monthly peak drops by <b>${kw(-mdDelta)}</b>, worth about <b>${rm(-mdDelta * c.mdRate * (1 + t.otherPct / 100))}</b> in peak charge.`);
  if (over) bits.push(`The room reaches about <b>${nf(Tmax, 1)} °C</b> — ${over} hour${over > 1 ? 's' : ''} above your ${o.limitC} °C comfort limit. Try a shallower aircond cut over a longer window.`);
  else if (good && hv && dayApplies) bits.push('The room stays within your comfort limit.');
  const ytdSave = ytd(c.billsAct, (x) => x.total) - ytd(bills, (x) => x.total);
  if (active.length) bits.push(ytdSave >= 0 ? `Over the replay so far (January–${MONTHS[clockInfo().month]}) this would be worth about <b>${rm(ytdSave)}</b>.` : `Over the replay so far this would cost you about <b>${rm(-ytdSave)}</b> more.`);
  const verdict = h('div', { class: 'card', style: 'margin-top:20px' }, active.length ? h('span', { class: 'sticker ' + tone, style: 'margin-bottom:12px' }, sticker) : null, h('p', { style: 'margin-top:8px;font-size:16.5px;line-height:1.6', html: bits.join(' ') }));

  // per-lever (each on its own)
  let whereTable = null;
  if (active.length > 1) {
    const rows = active.map((L) => { const b = runLevers(c, levers.map((x) => ({ ...x, on: x.id === L.id })), o.weekdaysOnly).bills[m]; return { L, save: b0.total - b.total, md: b.mdKw - b0.mdKw }; });
    whereTable = card('', h('h3', null, 'Where it comes from'), h('p', { class: 'tiny', style: 'margin:4px 0 8px' }, 'Each lever on its own. They don’t simply add up, because only the single highest hour sets the peak charge.'),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Lever', 'Plan', 'Bill change', 'Peak change'].map((x, k) => h('th', { class: k > 1 ? 'r' : '' }, x)))),
        h('tbody', null, rows.map(({ L, save: sv, md }) => h('tr', null, h('td', null, INFO[L.id][0]), h('td', null, summary(L)), h('td', { class: 'r ' + (sv >= 0 ? 'good' : 'bad') }, (sv >= 0 ? '− ' : '+ ') + rm(Math.abs(sv))), h('td', { class: 'r' }, (md > 0 ? '+' : '') + nf(md) + ' kW'))))));
  }

  // ---------------------------------------------------------------- charts
  const lab = Array.from({ length: 24 }, (_, k) => fmtHour(k).replace('\u00A0', ' '));
  const cA = chartBox(), cB = chartBox('short');
  const win = dayApplies ? active.map((l) => [l.start, l.end - 1]) : [];
  afterMount(() => {
    make(cA.canvas, 'line', { labels: lab, datasets: [
      { label: 'Before (real meter)', data: Array.from({ length: 24 }, (_, k) => Math.round(c.actualKw[a0 + k])), borderColor: COL.ink, borderWidth: 3, pointRadius: 0, tension: .3 },
      { label: 'After your scenario', data: Array.from({ length: 24 }, (_, k) => Math.round(r.out[a0 + k])), borderColor: COL.ok, backgroundColor: 'rgba(31,163,138,.13)', fill: 0, borderWidth: 3.4, pointRadius: 0, tension: .3 }] },
    { plugins: { peakBands: { ranges: ranges(c.pmask, a0, a0 + 24), label: 'peak hours' }, windowBand: { ranges: win, label: 'your change' } }, scales: { y: { title: { display: true, text: 'kW' } } } });
    if (T) make(cB.canvas, 'line', { labels: lab, datasets: [
      { label: 'Indoor (estimate)', data: T.map((v) => +v.toFixed(2)), borderColor: over ? COL.alert : COL.orangeDeep, borderWidth: 3.2, pointRadius: 0, tension: .3 },
      { label: o.wxMode === 'demo' ? 'Outdoor (demo data, hot desert)' : 'Outdoor (typical Malaysia)', data: Array.from({ length: 24 }, (_, k) => +outdoorTemp(wx, day, k + 0.5).toFixed(1)), borderColor: COL.sky, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: .3 }] },
    { plugins: { hline: { y: o.limitC, label: 'comfort limit', color: COL.purple }, windowBand: { ranges: hv && dayApplies ? [[hv.start, hv.end - 1]] : [] } }, scales: { y: { title: { display: true, text: '°C' }, suggestedMin: o.setC - 1 } } });
  });
  const daySel = h('label', { class: 'field', style: 'max-width:240px' }, h('span', null, 'Show day'),
    h('select', { class: 'sel', onchange: (e) => { S.whatDay = +e.target.value; hooks.rerender(); } },
      Array.from({ length: nd }, (_, k) => h('option', { value: s0 + k, selected: s0 + k === day }, fmtDate(dayIdxToDate(s0 + k).getTime(), true)))));

  // ---------------------------------------------------------------- pins
  const label = active.length ? active.map((l) => `${INFO[l.id][0].split(' (')[0].split(' &')[0]} ${l.cut === 100 ? 'off' : l.cut + '%'} ${fmtHour(l.start)}–${hr24(l.end)}`).join(' + ') : 'nothing';
  const pin = () => { if (S.pins.length >= 5) S.pins.shift(); S.pins.push({ label, month: MLAB(m), saving, md: b1.mdKw, maxT: Tmax, over }); hooks.rerender(); };
  const pins = card('', h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap' }, h('h3', null, 'Compare scenarios side by side'), h('button', { class: 'btn ghost small', onclick: pin }, '📌 Pin this scenario')),
    S.pins.length ? h('div', { style: 'overflow-x:auto;margin-top:10px' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Scenario', 'Month', 'Bill change', 'Peak (kW)', 'Warmest room', ''].map((x, k) => h('th', { class: k > 1 && k < 5 ? 'r' : '' }, x)))),
      h('tbody', null, S.pins.map((p, k) => h('tr', null, h('td', null, p.label), h('td', null, p.month), h('td', { class: 'r ' + (p.saving > 0 ? 'good' : 'bad') }, (p.saving >= 0 ? '− ' : '+ ') + rm(Math.abs(p.saving))), h('td', { class: 'r' }, nf(p.md)),
        h('td', { class: 'r ' + (p.over ? 'bad' : '') }, isNaN(p.maxT) ? '—' : nf(p.maxT, 1) + ' °C'), h('td', null, h('button', { class: 'chipbtn', onclick: () => { S.pins.splice(k, 1); hooks.rerender(); } }, 'remove')))))))
      : h('p', { class: 'tiny', style: 'margin-top:8px' }, 'Set up a scenario, press “Pin”, change it, pin again — and compare them here.'));

  return h('div', null,
    section('What-if studio', 'Pick the loads you could change, set the hours, and see what happens to the bill, the peak charge and — for the aircond — the room temperature.', true),
    h('div', { class: 'grid g-wide', style: 'align-items:start' }, controls, h('div', { style: 'display:grid;gap:20px' }, planCard, tips)),
    section('What changes', `${label} — ${MLAB(m)}`), resCards, verdict,
    whereTable ? h('div', { style: 'margin-top:20px' }, whereTable) : null,
    section('That day, hour by hour', 'Purple bands = your changes. Orange band = hours your peak charge is measured.'), daySel,
    h('div', { class: 'grid ' + (T ? 'g-wide' : '') }, card('', h('h3', null, 'Building demand'), cA.box), T ? card('', h('h3', null, 'Room temperature (indicative)'), cB.box) : null),
    h('p', { class: 'tiny', style: 'margin:12px 0 18px' }, 'Assumptions: each lever is a fixed share of building load (the demo data has no sub-meters), and only the aircond has a room-temperature model — a simple one-room warm-up estimate, not a simulation of your building. Treat comfort numbers as a guide and calibrate them with your own readings.'),
    pins);
}
