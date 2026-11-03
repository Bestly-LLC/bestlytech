import fs from 'node:fs';
// usage: node mkman5.mjs <set: main|sweep> -> man5_<set>.json
const D = '/Users/jaredbest/tmp/carcard/', W = '/Users/jaredbest/tmp/walldown/';
const live = { station: { ports_free: 2, ports_total: 2, price_now: null }, cars: [{ car: 'Blue Steel', soc: 51, range_mi: 97.5, home: true, plugged_in: false, charging_state: 'Disconnected', data_at: new Date().toISOString(), updated_at: new Date().toISOString(), stale: false,
  next_trip_at: '2026-11-23T06:00:00+00:00', target_pct: 80, status: 'plan', plan_start: '2026-11-04T04:00:00+00:00', plan_end: '2026-11-04T06:34:00+00:00', est_cost: 4.59, charger_status: '2 of 2 free', price_now: 0.2882, trip_end: null, sweep_due: null, sweep_end: null }] };
const mk = (o, x = {}) => JSON.stringify({ station: Object.assign({}, live.station, x), cars: o.map(p => Object.assign({}, live.cars[0], p)) });
const clip = { x: 1290, y: 300, width: 480, height: 300, scale: 2 };
const set = process.argv[2];
let shots;
if (set === 'main') {
  const S = {
    live: mk([{}]),
    charging: mk([{ soc: 63, range_mi: 120, plugged_in: true, charging_state: 'Charging', status: 'charging' }], { ports_free: 1 }),
    now: mk([{ soc: 34, range_mi: 65, status: 'plan', plan_start: '2026-11-03T21:00:00+00:00', plan_end: '2026-11-04T01:00:00+00:00', est_cost: 5.12 }]),
    trip: mk([{ status: 'away', home: false, trip_end: '2026-11-23T06:00:00+00:00', soc: 72, range_mi: 138 }]),
    wont: mk([{ soc: 34, range_mi: 65, status: 'wont_make', next_trip_at: '2026-11-04T17:00:00+00:00' }]),
  };
  shots = Object.keys(S).map(n => ({ js: `__ccd.feed(${S[n]}); __ccd.show()`, out: W + 'cl_' + n + '.jpg', wait: 3200, clip }));
} else {
  const due = '2026-11-04T16:00:00+00:00', end = '2026-11-04T18:00:00+00:00';
  shots = [{ js: `__ccd.feed(${mk([{ sweep_due: due, sweep_end: end }])}); __ccd.show()`, out: W + 'cl_sweep.jpg', wait: 3200, clip },
    { js: `__ccd.feed(${mk([{ status: 'wont_make', soc: 34, next_trip_at: '2026-11-04T17:00:00+00:00', sweep_due: due, sweep_end: end }])}); 1`, out: W + 'cl_prio.jpg', wait: 1500, clip }];
}
fs.writeFileSync(D + 'man5_' + set + '.json', JSON.stringify({ shots }));
