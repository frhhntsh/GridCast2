// State, persistence and derived numbers (everything the pages need, computed once per change).
import { buildTimeline, peakMask, mdMaskFor, monthlyBills, applyDR, applyPlanToActual, TARIFF_PRESETS, mapDateToDemo, dayIdxToDate, monthAlerts } from './engine.js';

const KEY = 'gridcast.v2';
export const S = {
  data: null, tl: null, validation: null,
  settings: null,
  clock: { y: 2021, m: 5, d: 23, hour: 14, playing: false, speed: 1, pauseOnAlert: true },
  page: 'today', month: 5, usageView: 'day', usageDay: null, savMonth: null,
  _ctx: null, _ctxKey: '', _dr: {}, pins: [], whatDay: null, plan: null,
};

export const defaultLevers = () => ([
  { id: 'hvac', type: 'hvac', on: true, share: 50, cut: 100, start: 14, end: 16, backPct: 30, spread: 3 },
  { id: 'light', type: 'light', on: false, share: 12, cut: 40, start: 9, end: 18, backPct: 0, spread: 1 },
  { id: 'ev', type: 'ev', on: false, share: 6, cut: 100, start: 14, end: 22, backPct: 100, spread: 4 },
  { id: 'pump', type: 'pump', on: false, share: 5, cut: 100, start: 14, end: 20, backPct: 100, spread: 3 },
  { id: 'equip', type: 'equip', on: false, share: 8, cut: 50, start: 14, end: 18, backPct: 0, spread: 1 },
]);

export const defaultSettings = () => ({
  managerName: 'Aisyah', company: 'Demo Holdings Sdn Bhd', building: 'Menara Demo', type: 'Office tower',
  peakKw: 2000, tariff: { ...TARIFF_PRESETS.mvtou }, model: 'XGBoost',
  strategy: 'shift', flexKw: 200, flexHours: 4, reboundPct: 5, capPct: 8, margin: 3, onboarded: false,
  scn: { weekdaysOnly: true, setC: 24, limitC: 26, tau: 6, perDeg: 6, wxMode: 'my', levers: defaultLevers() },
});

const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : d);
/** Never trust saved settings: fall back to safe defaults for anything missing, corrupt or out of range. */
export function sanitize(raw, models) {
  const d = defaultSettings(), s = { ...d, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.peakKw = num(s.peakKw, 100, 50000, d.peakKw);
  s.flexKw = num(s.flexKw, 0, 25000, d.flexKw); s.flexHours = num(s.flexHours, 1, 8, d.flexHours);
  s.reboundPct = num(s.reboundPct, 0, 50, d.reboundPct); s.capPct = num(s.capPct, 1, 50, d.capPct); s.margin = num(s.margin, 0, 30, d.margin);
  for (const k of ['managerName', 'company', 'building', 'type']) if (typeof s[k] !== 'string' || !s[k].trim()) s[k] = d[k];
  if (!['shift', 'curtail', 'cap'].includes(s.strategy)) s.strategy = d.strategy;
  if (models && !models.includes(s.model)) s.model = d.model;
  const t = s.tariff && typeof s.tariff === 'object' ? s.tariff : {}, dt = d.tariff, tt = { ...dt, ...t };
  for (const [k, lo, hi] of [['energyPeak', 0, 5], ['energyOff', 0, 5], ['capacity', 0, 1000], ['network', 0, 1000], ['retail', 0, 1e6], ['afaSen', -100, 100], ['otherPct', 0, 100]]) tt[k] = num(tt[k], lo, hi, dt[k]);
  tt.peakStart = num(tt.peakStart, 0, 24, dt.peakStart); tt.peakEnd = num(tt.peakEnd, 0, 24, dt.peakEnd);
  if (tt.peakEnd <= tt.peakStart) { tt.peakStart = dt.peakStart; tt.peakEnd = dt.peakEnd; }
  tt.offDays = Array.isArray(tt.offDays) ? tt.offDays.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : dt.offDays;
  tt.mdPeakOnly = !!tt.mdPeakOnly; tt.id = tt.id || 'custom'; tt.name = tt.name || 'Custom tariff';
  s.tariff = tt;
  const sc = { ...d.scn, ...(s.scn && typeof s.scn === 'object' ? s.scn : {}) }, dl = defaultLevers();
  sc.levers = dl.map((L) => { const g = Array.isArray(sc.levers) ? sc.levers.find((x) => x && x.id === L.id) : null; const m = { ...L, ...(g || {}) };
    m.on = !!m.on; m.share = num(m.share, 0, 90, L.share); m.cut = num(m.cut, 0, 100, L.cut); m.start = Math.round(num(m.start, 0, 23, L.start)); m.end = Math.round(num(m.end, 1, 24, L.end));
    if (m.end <= m.start) { m.start = L.start; m.end = L.end; } m.backPct = num(m.backPct, 0, 100, L.backPct); m.spread = Math.round(num(m.spread, 1, 8, L.spread)); return m; });
  sc.setC = num(sc.setC, 18, 30, 24); sc.limitC = num(sc.limitC, 22, 32, 26); sc.tau = num(sc.tau, 1, 24, 6); sc.perDeg = num(sc.perDeg, 1, 20, 6);
  sc.wxMode = sc.wxMode === 'demo' ? 'demo' : 'my'; sc.weekdaysOnly = sc.weekdaysOnly !== false;
  s.scn = sc;
  return s;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw), S.data && S.data.meta.models);
  } catch (e) { /* private mode, corrupt JSON … */ }
  return defaultSettings();
}
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(S.settings)); } catch (e) { /* ignore */ }
  S._ctx = null; S._dr = {};
}
export function resetSettings() { S.settings = defaultSettings(); saveSettings(); }

export const SCHEMA = 1;
export function validateData(d) {
  if (!d || !d.meta) throw new Error('the data file is empty or not in the expected format');
  if (d.meta.schema_version !== SCHEMA) throw new Error(`data file schema v${d.meta.schema_version} does not match this app (v${SCHEMA}) — re-run the pipeline`);
  const n = d.meta.hours;
  if (n !== 8760 || !Array.isArray(d.actual_mw) || d.actual_mw.length !== n) throw new Error('the data file does not contain 8,760 hourly values');
  for (const m of d.meta.models) if (!d.forecast_mw[m] || d.forecast_mw[m].length !== n || !d.rel_q[m] || d.rel_q[m].length !== 99) throw new Error(`forecast data for ${m} is incomplete`);
  if (!(d.meta.ref_peak_mw > 0)) throw new Error('reference peak is missing');
}
export function init(data) {
  validateData(data);
  S.data = data; S.tl = buildTimeline(); S.settings = loadSettings();
}
export function clampMonth() { const cm = clockInfo().month; if (S.month > cm) S.month = cm; if (S.month < 0) S.month = 0; }

// ---- derived context -------------------------------------------------------
export function ctx() {
  const s = S.settings, key = JSON.stringify([s.peakKw, s.tariff, s.model, s.margin]);
  if (S._ctx && S._ctxKey === key) return S._ctx;
  const { data, tl } = S;
  const k = s.peakKw / data.meta.ref_peak_mw;
  const actualKw = Float64Array.from(data.actual_mw, (v) => v * k);
  const fcKw = Float64Array.from(data.forecast_mw[s.model], (v) => v * k);
  const relQ = data.rel_q[s.model];
  const loKw = Float64Array.from(fcKw, (v) => v * (1 + relQ[4]));
  const hiKw = Float64Array.from(fcKw, (v) => v * (1 + relQ[94]));
  const t = s.tariff;
  const pmask = peakMask(tl, t), mdmask = mdMaskFor(tl, t, pmask);
  const c = {
    tl, tariff: t, k, actualKw, fcKw, loKw, hiKw, relQ, pmask, mdmask, margin: s.margin, mdRate: t.capacity + t.network,
    billsAct: monthlyBills(actualKw, tl, pmask, mdmask, t), billsFc: monthlyBills(fcKw, tl, pmask, mdmask, t),
  };
  S._ctx = c; S._ctxKey = key; S._dr = {};
  return c;
}

export function drParams() { const s = S.settings; return { flexKw: s.flexKw, flexHours: s.flexHours, reboundPct: s.reboundPct, capPct: s.capPct }; }

/** strategy → { bills (planned on forecast), real (plan made from the forecast, applied to the real meter), perfect (plan made knowing the real meter) } */
export function dr(strategy) {
  const c = ctx(), p = drParams(), key = strategy + JSON.stringify(p);
  if (!S._dr[key]) {
    const planned = applyDR(c.fcKw, c.tl, c.pmask, c.mdmask, strategy, p);
    const realOut = applyPlanToActual(c.actualKw, c.fcKw, planned.out);
    const perfect = applyDR(c.actualKw, c.tl, c.pmask, c.mdmask, strategy, p);
    S._dr[key] = { ...planned, bills: monthlyBills(planned.out, c.tl, c.pmask, c.mdmask, c.tariff),
      realOut, real: monthlyBills(realOut, c.tl, c.pmask, c.mdmask, c.tariff),
      perfectOut: perfect.out, perfect: monthlyBills(perfect.out, c.tl, c.pmask, c.mdmask, c.tariff) };
  }
  return S._dr[key];
}
/** Year-to-date total of a per-month metric up to (and including) the demo-clock month. */
export const ytd = (arr, f = (x) => x) => arr.slice(0, clockInfo().month + 1).reduce((a, x) => a + f(x), 0);

// ---- demo clock --------------------------------------------------------------
export function clockInfo() {
  const c = S.clock, map = mapDateToDemo(c.y, c.m, c.d);
  return { idx: map.dayIdx * 24 + c.hour, dayIdx: map.dayIdx, month: map.month, exact: map.exact,
    pickedMs: Date.UTC(c.y, c.m, c.d), demoMs: dayIdxToDate(map.dayIdx).getTime() };
}
export function setClockDate(y, m, d) { Object.assign(S.clock, { y, m, d }); S.month = clockInfo().month; }
export const MLAB = (m) => `${['January','February','March','April','May','June','July','August','September','October','November','December'][m]} 2021`;
export function stepClock(n = 1) {
  const c = S.clock;
  let hr = c.hour + n;
  let dt = Date.UTC(c.y, c.m, c.d);
  while (hr >= 24) { hr -= 24; dt += 864e5; }
  while (hr < 0) { hr += 24; dt -= 864e5; }
  const d = new Date(dt);
  c.y = d.getUTCFullYear(); c.m = d.getUTCMonth(); c.d = d.getUTCDate(); c.hour = hr;
  S.month = clockInfo().month;
}
export function jumpTo(dayIdx, hour) {
  const d = dayIdxToDate(dayIdx);
  Object.assign(S.clock, { y: 2021, m: d.getUTCMonth(), d: d.getUTCDate(), hour });
  S.month = d.getUTCMonth();
}
/** Find the moment, in a given month, when GridCast would raise its first hard peak alert. */
export function findAlertMoment(month) {
  const c = ctx(), r = monthAlerts(c, month);
  const hard = r.alerts.filter((a) => a.hard).sort((a, b) => a.i - b.i);
  return hard.length ? hard[0].i : null;
}
export function findBusiestHour(month) {
  const c = ctx(), s = c.tl.monthStartDay[month] * 24, e = s + c.tl.daysInMonth[month] * 24;
  let best = s;
  for (let i = s; i < e; i++) if (c.mdmask[i] && c.actualKw[i] > c.actualKw[best]) best = i;
  return best;
}
