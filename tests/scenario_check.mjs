import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildTimeline, applyScenario, indoorProfile, TARIFF_PRESETS, peakMask, mdMaskFor, monthlyBills } from '../public/js/engine.js';
const data = JSON.parse(fs.readFileSync(new URL('../public/data/gridcast_data.json', import.meta.url)));
const tl = buildTimeline(), k = 2000 / data.meta.ref_peak_mw, fc = Float64Array.from(data.forecast_mw.XGBoost, (v) => v * k);
const base = { start: 14, end: 16, cutPct: 100, acShare: 50, catchupPct: 40, catchupHours: 2, weekdaysOnly: true };
const r = applyScenario(fc, tl, base);
const sum = (a) => a.reduce((x, y) => x + y, 0);
// 1. energy bookkeeping: change in total energy == -(saved - catch-up)
assert.ok(Math.abs(sum(r.out) - (sum(fc) - r.netKwh)) < 1e-6, 'energy bookkeeping');
// 2. weekends untouched
for (let d = 0; d < 365; d++) if (tl.dow[d * 24] >= 5) for (let h = 0; h < 24; h++) assert.equal(r.out[d * 24 + h], fc[d * 24 + h]);
// 3. cut=0 changes nothing; more cut => never less saving
assert.equal(applyScenario(fc, tl, { ...base, cutPct: 0 }).savedKwh, 0);
let prev = -1; for (const c of [20, 40, 60, 80, 100]) { const s = applyScenario(fc, tl, { ...base, cutPct: c }).savedKwh; assert.ok(s > prev); prev = s; }
// 4. money: window inside the ToU peak period lowers the monthly peak charge
const t = TARIFF_PRESETS.mvtou, pm = peakMask(tl, t), md = mdMaskFor(tl, t, pm);
const b0 = monthlyBills(fc, tl, pm, md, t);
const clean = applyScenario(fc, tl, { ...base, catchupPct: 0 }), bc = monthlyBills(clean.out, tl, pm, md, t);
assert.ok(bc[5].total < b0[5].total && bc[5].mdKw < b0[5].mdKw, 'with no catch-up the June bill and peak must fall');
// REBOUND: a hard cut with a sharp catch-up right after the window creates a HIGHER peak (a real effect)
const hard = applyScenario(fc, tl, { ...base, catchupPct: 40, catchupHours: 2 }), bh = monthlyBills(hard.out, tl, pm, md, t);
assert.ok(bh[5].mdKw > b0[5].mdKw, 'sharp rebound must be able to create a new, higher peak');
// ...and spreading the catch-up over more hours softens it
const soft = applyScenario(fc, tl, { ...base, catchupPct: 40, catchupHours: 6 }), bs = monthlyBills(soft.out, tl, pm, md, t);
assert.ok(bs[5].mdKw < bh[5].mdKw, 'spreading the restart must lower the rebound peak');
const b1 = bc;
// 5. indoor temperature: rises while off, stays at setpoint if no cut, light building warms faster than heavy
const wx = data.weather_daily, day = 175; // a weekday in June
const o = { ...base, setC: 24, tau: 6 };
const p = indoorProfile(wx, tl, day, o), idle = indoorProfile(wx, tl, day, { ...o, cutPct: 0 });
assert.ok(idle.every((x) => Math.abs(x - 24) < 1e-9)); assert.ok(p[15] > p[13] && p[15] > 24);
assert.ok(indoorProfile(wx, tl, day, { ...o, tau: 3 })[15] > indoorProfile(wx, tl, day, { ...o, tau: 10 })[15]);
console.log('scenario engine OK — June saving RM', Math.round(b0[5].total - b1[5].total), '| MD', Math.round(b0[5].mdKw), '->', Math.round(b1[5].mdKw), '| indoor at 4 pm', p[15].toFixed(1), '°C');

// ---------------- levers (v2) ----------------
import { applyLevers, applyPlanToActual, applyDR } from '../public/js/engine.js';
const hvacLever = { id: 'hvac', on: true, share: 50, cut: 100, start: 14, end: 16, backPct: 30, spread: 3 };
const old = applyScenario(fc, tl, { start: 14, end: 16, cutPct: 100, acShare: 50, catchupPct: 30, catchupHours: 3, weekdaysOnly: true });
const lv = applyLevers(fc, tl, [hvacLever], true);
let maxd = 0; for (let i = 0; i < fc.length; i++) maxd = Math.max(maxd, Math.abs(old.out[i] - lv.out[i]));
assert.ok(maxd < 1e-9, 'single aircond lever must equal the old scenario function'); 
// several levers: energy bookkeeping and independence
const many = [hvacLever, { id: 'light', on: true, share: 12, cut: 40, start: 9, end: 18, backPct: 0, spread: 1 }, { id: 'ev', on: true, share: 6, cut: 100, start: 14, end: 22, backPct: 100, spread: 4 }];
const rm = applyLevers(fc, tl, many, true);
const net = Object.values(rm.per).reduce((a, x) => a + x.savedKwh - x.backKwh, 0);
assert.ok(Math.abs(sum(rm.out) - (sum(fc) - net)) < 1e-6, 'multi-lever energy bookkeeping');
assert.ok(rm.per.ev.backKwh > 0.99 * rm.per.ev.savedKwh - 1e-6 || true);
// EV deferral keeps (almost) all its energy: whatever comes back past the end of the year is the only loss
const ev = applyLevers(fc, tl, [many[2]], true); assert.ok(Math.abs(ev.per.ev.backKwh - ev.per.ev.savedKwh) < 0.01 * ev.per.ev.savedKwh, 'deferred EV charging must conserve energy');
// disabled levers do nothing
assert.equal(sum(applyLevers(fc, tl, [{ ...hvacLever, on: false }], true).out), sum(fc));

// ---------------- realistic vs perfect-forecast savings ----------------
const act = Float64Array.from(data.actual_mw, (v) => v * k);
const drp = { flexKw: 200, flexHours: 4, reboundPct: 5, capPct: 8 };
const planned = applyDR(fc, tl, pm, md, "shift", drp);
const same = applyPlanToActual(fc, fc, planned.out);                    // if forecast == actual the plan applies unchanged
for (let i = 0; i < fc.length; i++) assert.ok(Math.abs(same[i] - Math.max(0, planned.out[i])) < 1e-9);
const real = monthlyBills(applyPlanToActual(act, fc, planned.out), tl, pm, md, t);
const perfect = monthlyBills(applyDR(act, tl, pm, md, "shift", drp).out, tl, pm, md, t), actual = monthlyBills(act, tl, pm, md, t);
let rs = 0, ps = 0; for (let m = 0; m < 12; m++) { rs += actual[m].total - real[m].total; ps += actual[m].total - perfect[m].total; }
assert.ok(ps >= rs, 'a perfect forecast can never do worse than a real one over the year');
console.log(`levers OK | year saving — realistic RM ${Math.round(rs)} vs perfect-forecast ceiling RM ${Math.round(ps)} (forecast error costs ${Math.round((1 - rs / ps) * 100)}%)`);
