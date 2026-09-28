# Wall round 3 — opusplan (2026-09-27, 10:40 PM PT)

Jared's list (attachment), answers: purple Scout = a detail list of its items; new widgets = Turo earnings, air quality + pollen, home energy, streaks/habits; Co-Star = a daily Leo line.

## Shared contracts
**New `wall_state` keys** (DEFAULT_STATE + `wall_clean_toggles` + admin Wall.tsx):
| key | type | default | meaning |
|---|---|---|---|
| `issTag` | bool | true | name tag on the space station |
| `skyHome` | bool | true | the "You / home" marker in the sky |
| `airRadiusMi` | number | current radius | sky radius in miles; admin − / + (1 mi steps, 2–25) |
| `atc` | bool | false | LAX tower/approach audio on the Desk HomePod |
| `widgets` | object | all on | per-widget switches: news, mail, turo$, air, energy, habits, leo, appstore |

**Feeds** — `wall_pi_feeds(p_token)` (same agent token as `wall_pi_trips`) returns
`{news[{title,source,at}], mail{bullets[], count, since}, deliveries[{carrier,what,eta,status}], appstore[{app,version,status,at}], turo{today,week,next_payout,next_payout_at}, air{aqi,label,pollen{tree,grass,weed}|null,uv}, energy{watts,today_usd,month_usd,rate_c_kwh}, habits{steps,move,exercise,stand,streak}, leo{line,date}, at}` — any part may be null.

**New Turo booking** — Realtime event `turo_booking` on the wall channel `{guest, car, starts_at, ends_at, days, earnings}`; the Pi also sees `new:true` on the trip in `wall_pi_trips` for 10 min.

**AirPods** — Mac agent adds `{name, kind:'airpods'|'airpods_max', pct, charging}` to the devices the batteries card already reads.

**Pi editing rule (4 workers share wall.html/server.py):** every edit = small anchored replace, done under `flock /opt/bestly/wall/.edit.lock`, re-reading the live file first, backup, `node --check` / `py_compile`, restart. Never write a whole file from an old copy. Quiet hours: no audible tests after 10:45 PM (verify streams silently / volume 0).

## W1 Sky (wall.html sky + server.py air_loop)
- [ ] Space station: better image, halo glow behind it, `issTag` switch.
- [ ] Closest plane: blue dot same size/look as the red dots; red dots + circle on the other tagged planes when name tags are on.
- [ ] Home marker back + `skyHome` switch.
- [ ] Constant jet-stream (contrail) lines on all aircraft.
- [ ] Helicopter rotors always spin (self-heal).
- [ ] Star labels offset so they don't sit on the stars.
- [ ] Name tag in/out transition smooth (no lag/chop).
- [ ] Name tags only for planes really drawn in the sky; sky key shows the radius; admin − / + radius (`airRadiusMi`).
- [ ] Close-pass mode: when a plane/helicopter is unusually low + close (police helicopter), faster updates, smooth motion, drawn a bit larger.
- [ ] ATC audio switch (`atc`): LAX tower/approach stream on the Desk HomePod.

## W2 Strip (wall.html strip + server.py strip parts)
- [ ] "Show today's date" → much larger, filling text.
- [ ] 10-day forecast: ends on the last day, holds the same time, then moves to the next widget (never back to day 1 first).
- [ ] Ambient must show tomorrow's call with Eli (not "All clear").
- [ ] Quotes: remove Elon Musk, add Marie Curie.
- [ ] Purple Scout: detail view — bullet summary of its items (e.g. the 7).
- [ ] Sleep/wake + power demos: plane name tag hides immediately; wake/sleep animation text back.
- [ ] Audio self-heal for party, skit and all sounds (pre-built buffers like the chime) + watchdog.
- [ ] Album artwork on the strip (Apple Music).
- [ ] AirPods + AirPods Max on batteries; themed soft low alert (≤20% yellow arch; ≤10% red arch; ≤5% red arch flashing + middle icon flash; no sound).
- [ ] New Turo booking pop-up on the strip + a demo screenshot for Jared.
- [ ] Left widget: news (NPR / Ground News); render the new widgets from `wall_pi_feeds`.

## W3 Data + sign (Supabase, feed fetchers, admin sign section)
- [ ] `wall_pi_feeds`: news (NPR + Ground News), USPS Informed Delivery mail summary (rolling 7 days, from the iCloud inbox) + deliveries, App Store app statuses, Turo earnings, air quality + pollen, home energy (LADWP), streaks/habits, daily Leo line. Watchdog per feed.
- [ ] New-booking event (`turo_booking`).
- [ ] Sign wall: reset to just Jared's signature (count 01).
- [ ] Clearing a name in admin also deletes that guest's emoji.

## W4 Audio, projector, alarm, power (server.py audio/alarm parts, HA, adb, admin power)
- [ ] Radio: fix; explain HA stations vs Radio Browser.
- [ ] Alarm: Live Activity/notification with Snooze + Dismiss buttons that work.
- [ ] Sign-wall focus: the sign wall sits ~5–6 in behind the strip; repeatable focus strategy (lock focus at the best compromise, reassert after wake/sleep) + render the sign wall crisper (bolder strokes, pre-sharpen).
- [ ] Admin › Power › Advanced: live electricity cost estimate (LADWP rates).
- [ ] AirPods battery source on the Mac agent.
