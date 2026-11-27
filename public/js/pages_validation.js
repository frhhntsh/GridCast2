// "Validated on a real building" — results of validation/validate_cubems.py (and validate_bdg2.py if it has been run).
import { h, nf, rm } from './dom.js';
import { S } from './store.js';
import { make, afterMount, COL } from './charts.js';
import { section, card, stat, chartBox } from './ui.js';

const f1 = (x) => nf(x, 1);

export function validationSection() {
  const V = S.validation;
  if (!V || !V.cubems) return null;
  const C = V.cubems, A = C.accuracy, X = A.XGBoost, N = A['Naive (lag-1)'], G = C.gridcast, ToU = G.tariffs['MV ToU'], Gen = G.tariffs['MV General'];
  const Z = C.zero_shot_SEWA_to_CUBEMS, ZT = C.same_features_trained_on_the_building, hist = C.history_needed_XGBoost, SH = C.load_shares, L = C.lunch_effect;

  const headline = h('div', { class: 'grid g4' },
    stat('Hourly CV(RMSE)', f1(X['CV_RMSE_%']) + '%', `limit 30% (ASHRAE Guideline 14) · naive last-hour guess: ${f1(N['CV_RMSE_%'])}%`, 'sky'),
    stat('Bias (NMBE)', (X['NMBE_%'] > 0 ? '+' : '') + nf(X['NMBE_%'], 2) + '%', 'limit ±10% · over- and under-forecasts cancel out', 'lilac'),
    stat('Peak-hour F1', nf(G.peak_hour_F1, 2), 'finding the building’s busiest 10% of hours', 'peach'),
    stat('Range coverage', f1(G['interval_coverage_%']) + '%', 'of real hours fell inside the 90% “expected range”'));

  const tr = (label, a, b) => h('tr', null, h('td', null, label), h('td', { class: 'r' }, a), h('td', { class: 'r' }, b));
  const promises = card('', h('h3', null, 'What GridCast promises vs what happened'),
    h('p', { class: 'tiny', style: 'margin:4px 0 8px' }, `Tested on ${nf(C.rows.test_hours)} unseen hours (${C.protocol.test}). Peak window for ToU = 2–10 PM weekdays.`),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', 'MV ToU', 'MV General'].map((x, k) => h('th', { class: k ? 'r' : '' }, x)))),
      h('tbody', null,
        tr('Monthly peak (MD) error — average', f1(ToU['MD_error_mean_%']) + '%', f1(Gen['MD_error_mean_%']) + '%'),
        tr('Monthly peak (MD) error — worst month', f1(ToU['MD_error_max_%']) + '%', f1(Gen['MD_error_max_%']) + '%'),
        tr('Monthly bill error', nf(ToU['bill_error_mean_%'], 2) + '%', nf(Gen['bill_error_mean_%'], 2) + '%'),
        tr('Alerts: caught real new peaks', `${nf(ToU['peak_recall_%'])}%`, `${nf(Gen['peak_recall_%'])}%`),
        tr('Alerts: were real', `${nf(ToU['alert_precision_%'])}%`, `${nf(Gen['alert_precision_%'])}%`),
        tr('Saving, realistic (plan from forecast)', rm(ToU.dr_saving_realistic_RM), rm(Gen.dr_saving_realistic_RM)),
        tr('Saving, ceiling (perfect forecast)', rm(ToU.dr_saving_perfect_RM), rm(Gen.dr_saving_perfect_RM)))),
    h('p', { class: 'tiny', style: 'margin-top:10px' }, `Savings use the “shift to quiet hours” plan with ${nf(ToU.dr_flex_kW)} kW of flexible load over ${ToU.months} test months. MV General is weaker: this building’s highest peak is the 8 AM start-up ramp, which is hard to forecast one hour ahead.`));

  const names = ['XGBoost', 'LightGBM', 'CatBoost', 'Blend', 'Naive (lag-1)', 'Seasonal naive (lag-24)', 'Seasonal naive (lag-168)'];
  const models = card('', h('h3', null, 'The models on this building'),
    h('table', { class: 'tbl', style: 'margin-top:8px' }, h('thead', null, h('tr', null, ['Model', 'MAE (kW)', 'CV(RMSE)', 'NMBE', 'Passes G14'].map((x, k) => h('th', { class: k ? 'r' : '' }, x)))),
      h('tbody', null, names.map((n) => h('tr', null, h('td', null, n), h('td', { class: 'r' }, f1(A[n].MAE)), h('td', { class: 'r' }, f1(A[n]['CV_RMSE_%']) + '%'), h('td', { class: 'r' }, nf(A[n]['NMBE_%'], 2) + '%'), h('td', { class: 'r ' + (A[n].ASHRAE_G14_hourly_pass ? 'good' : 'bad') }, A[n].ASHRAE_G14_hourly_pass ? 'yes' : 'no'))))),
    h('p', { class: 'tiny', style: 'margin-top:10px' }, 'Here CatBoost and the blend edge ahead of XGBoost, while on SEWA XGBoost won. No single model wins everywhere — which is why GridCast benchmarks all of them on each building’s own data.'));

  const c1 = chartBox('short'), c2 = chartBox('short'), c3 = chartBox();
  const mo = Object.entries(ToU.monthly);
  const prof = SH.weekday_profile_kW;
  afterMount(() => {
    make(c1.canvas, 'bar', { labels: mo.map(([m]) => m), datasets: [
      { label: 'Actual monthly peak', data: mo.map(([, v]) => v.actual_md), backgroundColor: COL.sky, borderRadius: 6 },
      { label: 'GridCast forecast', data: mo.map(([, v]) => v.forecast_md), backgroundColor: COL.orange, borderRadius: 6 }] }, { scales: { y: { title: { display: true, text: 'kW (ToU peak window)' }, beginAtZero: true } } });
    make(c2.canvas, 'line', { labels: Object.keys(hist).map((k) => `${k} mo`), datasets: [{ label: 'CV(RMSE) %', data: Object.values(hist).map((v) => +v['CV_RMSE_%'].toFixed(1)), borderColor: COL.purple, backgroundColor: COL.purple, borderWidth: 3, pointRadius: 5, tension: .25 }] },
      { plugins: { legend: { display: false }, hline: { y: 30, label: 'ASHRAE limit 30%', color: COL.alert } }, scales: { y: { title: { display: true, text: 'error (CV(RMSE) %)' }, beginAtZero: true } } });
    make(c3.canvas, 'bar', { labels: Array.from({ length: 24 }, (_, k) => k), datasets: [
      { label: 'Aircond', data: prof.ac_kw, backgroundColor: COL.orange, stack: 's' }, { label: 'Lighting', data: prof.light_kw, backgroundColor: COL.sky, stack: 's' }, { label: 'Plug loads', data: prof.plug_kw, backgroundColor: '#B9A8F5', stack: 's' }] },
    { scales: { x: { stacked: true, title: { display: true, text: 'hour of day (weekdays)' } }, y: { stacked: true, title: { display: true, text: 'average kW' } } } });
  });

  const transfer = card('peach tilt2', h('h3', null, 'Does the SEWA-trained model work on a real building as-is?'),
    h('p', { style: 'margin-top:6px' }, h('b', null, 'No. '), `Applied directly (rescaled to the building’s size) the SEWA model gets CV(RMSE) ${f1(Z['CV_RMSE_%'])}%, bias ${(Z['NMBE_%'] > 0 ? '+' : '') + f1(Z['NMBE_%'])}% and R² ${nf(Z.R2, 2)} — it fails the 30% test. The same recipe trained on this building’s own history: ${f1(ZT['CV_RMSE_%'])}%.`),
    h('p', { style: 'margin-top:10px' }, 'So what is validated is the ', h('b', null, 'method'), ': GridCast must be trained per building. The SEWA model is the prototype, not something to copy onto other buildings.'));
  const shares = card('sky', h('h3', null, 'What the real building says about the what-if assumptions'),
    h('p', { style: 'margin-top:6px' }, `Measured shares of this building’s load: aircond ${f1(SH['overall_%'].ac_kw)}%, lighting ${f1(SH['overall_%'].light_kw)}%, plug loads ${f1(SH['overall_%'].plug_kw)}%. The What-if default of about half for the aircond is in line with this.`),
    h('p', { style: 'margin-top:10px' }, h('b', null, 'A real rebound: '), `the building lets its aircond fall at lunch (${nf(L.ac_11h)} → ${nf(L.ac_12h)} kW) and the whole building then jumps to ${nf(L.total_13h)} kW at 1 PM — higher than at 11 AM (${nf(L.total_11h)} kW). That is the “snap-back” the What-if tab warns about.`));

  const B = V.bdg2;
  const bdg = B ? card('', h('h3', null, `Many buildings: BDG2 (${B.buildings_tested} commercial buildings)`),
    h('p', { style: 'margin-top:6px' }, `Median hourly CV(RMSE): XGBoost ${f1(B.XGBoost['CV_RMSE_median_%'])}% (IQR ${f1(B.XGBoost['CV_RMSE_p25_%'])}–${f1(B.XGBoost['CV_RMSE_p75_%'])}%) vs naive ${f1(B.naive_lag1['CV_RMSE_median_%'])}%. ${f1(B.XGBoost['ASHRAE_G14_pass_%'])}% of buildings pass the ASHRAE hourly test.`),
    h('p', { class: 'tiny', style: 'margin-top:8px' }, `Weather removed: median ${f1(B.weather_effect_h1['median_%_worse_without_weather'])}% change at 1 h ahead, ${f1(B.weather_effect_h24['median_%_worse_without_weather'])}% at 24 h ahead.`))
    : card('', h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap' }, h('h3', null, 'Many buildings: BDG2'), h('span', { class: 'tag watch' }, 'NOT RUN YET')),
      h('p', { style: 'margin-top:6px' }, 'The BDG2 files supplied were Git LFS stubs (131 bytes each), not data. The script validation/validate_bdg2.py is ready and tested on synthetic BDG2-format files; run it once the real files are downloaded and re-export this page.'));

  const limits = card('', h('h3', null, 'What this does not prove'), h('ul', { style: 'padding-left:18px;margin:8px 0 0;display:grid;gap:6px' }, [
    'One building, one climate, one owner type (a university office) — a start, not the end.',
    `Only ${nf(C.rows.test_hours)} test hours (July – 22 October 2019): the supplied 2019Floor6.csv is truncated, so later months are unusable.`,
    'About 6 weeks of data are missing in Oct–Nov 2018, inside the training year.',
    'No outdoor weather in this dataset, so weather was not used; indoor sensors are not forecastable inputs.',
    'Hourly averages, not TNB’s half-hour peaks, and Thai working-week patterns.'].map((x) => h('li', null, x))));

  return h('div', null,
    section('Validated on a real building', 'Real smart-meter data from a 7-storey office building in Bangkok (CU-BEMS, Chulalongkorn University): a tropical climate like Malaysia’s, peak load around 700–880 kW. Trained on 12 months, tested on the unseen months after.'),
    headline, h('div', { class: 'grid g-wide', style: 'margin-top:20px' }, promises, models),
    h('div', { class: 'grid g2', style: 'margin-top:20px' }, card('', h('h3', null, 'Monthly peak: real vs forecast'), c1.box), card('', h('h3', null, 'How much history does a building need?'), c2.box)),
    h('div', { class: 'grid g-wide', style: 'margin-top:20px' }, card('', h('h3', null, 'Where this building’s electricity goes (weekday average)'), c3.box), h('div', { style: 'display:grid;gap:20px' }, transfer, shares)),
    h('div', { class: 'grid g2', style: 'margin-top:20px' }, bdg, limits));
}
