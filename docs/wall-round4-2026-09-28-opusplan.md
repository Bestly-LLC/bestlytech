# Wall round 4 — opusplan (2026-09-28, 3:40 PM PT)

Jared's list (attachment, 40 asks), grouped by system so parallel workers never fight over the same code.
Status legend: [ ] todo · [x] done · [~] partial / needs Jared · [?] waiting on Jared's input

Photos (3:49 PM) are in `docs/wall-round4-assets/`: `sky-key-bulbs.jpg` (bulb blocks "Tail … where it's seen" + "Closest to…"),
`scout-chat-sticky-box.jpg` (the stuck "Fix LAX guest…" card), `flighty-live-activity.jpg` (the look for the Live Activity + sign-wall name tag),
`led-sign-off-dark.jpg`, `led-sign-off-flash.jpg`, `led-sign-on-purple.jpg`, `led-sign-grid-C6-C7.jpg` (neon line-art sign on the sign wall, grid cells C6–C7).

## Shared contracts
**New `wall_state.state` keys** (server.py DEFAULT_STATE + `wall_clean_toggles`/`wall_clean_patch` + admin Wall.tsx):
| key | type | default | meaning |
|---|---|---|---|
| `dnd` | object | `{on:true, from:"22:30", to:"07:00", override:null}` | Do Not Disturb for wall sounds/pop-ups. `override` = `{mode:"on"\|"off", until:ts}`; admin edits times + override + off |
| `homePos` | object\|null | null | where "home" sits on the sky `{x,y}` 0..1; the whole sky re-projects around it (not just the label) |
| `layoutSel` | string\|null | null | id of the layout block being adjusted; wall outlines it while the grid is on |
| `motivate` | object\|null | null | `{seq, ts}` — admin/remote "Motivate me" button; wall plays the show once per new seq |
| `airFocus` | object\|null | null | `{hex, until}` — the aircraft on the wall name tag right now (Live Activity follows it) |

**Do Not Disturb helpers (W4, live on the Pi 4:00 PM):** anything that makes noise or pops up checks DND first.
Page: `window.dndNow()` → `{on, why:'schedule'|'override'|'off', until?}` (`play()` and the hourly chime already respect it).
server.py: `dnd_now()` → `(on, why)`. SQL: `wall_dnd_now()` → `{on, why, until?}` (authenticated/service_role). Alarms + heads-ups Jared set still ring.
**Admin Sky (W4):** Pi `sky_share_loop` → `wall_pi_air_put` → table `wall_air_live` (3 s while /admin/sky is open, else 10 s); admin reads `wall_admin_air()`.

**LED sign (W8)** — `ledSign` object `{on, look:"lit"|"breathe"|"wash"|"trace"|"none", color:"#hex", x, y (offset, 0..1 of screen), s (scale), r (deg), sx (width), outline, notify, shield, test:{fx, at}}`, cleaned by `wall_clean_ledsign()`. **`wall_admin_set` now chains `wall_clean_ledsign` after `wall_clean_r4admin` — keep it if you redefine `wall_admin_set`.**
**LED sign keep-out box (W5 signatures):** sign center (0.1721, 0.8031) of the screen, traced size 69x70 ref px (960x540). Keep-out (sign + acrylic + margin) = screen **x 0.1307–0.2135, y 0.7290–0.8772**; in sign-wall px (1000x980) **[433, 492, 777, 802]** (tube box [445, 504, 765, 790] + 12 px). Live values in the page: `window.LEDSIGN_BOX = {norm:[x0,y0,x1,y1], wing:[x0,y0,x1,y1]}` (follows admin nudges), `'ledsign:box'` window event on change, and `WING_AVOID`'s neon entry is kept equal to it.

**Aircraft extras** (server.py air → page): each plane may carry `from`/`to` (IATA + city), `news:{station,call}`, `police:"LAPD"|"LASD"|null`.
Table `wall_news_helis(hex, reg, station, channel, notes)` + `wall_pi_news_helis(p_token)`.

**Feeds** (`wall_pi_feeds`): `mail.items[]` (one-line summaries), `energy.today_cents`, `turo.calendar[{date, status:'booked'|'blocked'|'open', guest?}]` (30 days), `claude{pct, label, resets_at, source}` (usage arch), `packages[{id, carrier, what, eta, status, done}]`.
**Packages (W2 data, W4 UI)** — table `wall_packages(id bigint, key text unique, carrier, what, eta, status, source, done bool, done_at, first_seen, last_seen)`, filled from the `deliveries` feed + USPS Informed Delivery parcels.
Admin RPCs (admin auth like `wall_admin_set`): `wall_admin_packages() → [{id, carrier, what, eta, status, source, done, done_at, first_seen, last_seen}]` (last 21 days, newest first) and
`wall_package_done(p_id bigint, p_done boolean) → {ok, id, done}` (true = "got it", hides it from the wall; false = show again).
`wall_pi_feeds.packages[{id, carrier, what, eta, status}]` excludes done ones (legacy `deliveries` also filtered).

**Pi editing rule (several workers share wall.html/server.py):** every edit = small anchored replace, under
`flock /opt/bestly/wall/.edit.lock`, re-read the live file first, backup `*.bak_r4<w>_*`, `node --check` (page script) /
`py_compile`, restart, bump `wall_state.version`. Never write a whole file from an old copy. Quiet hours: no audible tests after 10:45 PM.

## W1 Sky + aircraft (wall.html sky, server.py air)
- [ ] Name tag stays up longer (+~40%) and never flickers in/out (hysteresis on "in view", one owner of the tag, no re-mount).
- [ ] Flight card always shows from → to when a route exists (callsign route lookup + cache; United etc.).
- [ ] Rings + red dot only on the plane in the name tag; dots animate in/out.
- [ ] News helicopters: stored database (hex → station/channel), tag shows "KTLA 5" etc., colored blue.
- [ ] LAPD helicopters: black-and-white checkered tail boom, white rotor end.
- [ ] Flip-sky toggle: test; fix or remove.
- [ ] Movable home (`homePos`): the whole sky (planes, rings, compass) re-projects around it.
- [ ] Sky animation speed + timing pass (smooth motion, easing, no jumps).
- [ ] Sun ⇄ moon animate + fade.
- [ ] Sky key: move the "tail …" line under "Bigger = flying lower"; move the blue-dot "closest to you" line under the red-dot line (light bulbs block the old spots).
- [ ] LAX tower status tag under the weather: no clipping/cut-off text (Apple HIG).

## W2 Strip + widgets (wall.html strip/widgets, server.py feeds, Supabase feeds)
- [ ] Purple Scout to-dos: slower (hold each page longer, readable).
- [ ] Quotes + mantras: big new set (Gandhi, Martha Stewart, Buddha, Steve Irwin, Dolly Parton, Catherine O'Hara, Robin Williams, Heath Ledger, Albert Einstein, Christopher Nolan, Jony Ive + more); shuffle-deck so nothing repeats until every one has shown.
- [ ] 30-day Turo calendar widget on the right: booked / blocked / open with clear contrast (Apple HIG).
- [ ] Home energy shows cents.
- [ ] Mail widget: "2 pieces of mail" then a short summary of what they are.
- [ ] Mail this week: never just "Letter" — say who it's from + what it likely is (read the Informed Delivery scan: sender/return address via OCR or a free vision model), e.g. "Mon · Chase — card statement".
- [ ] Batteries: iPhone must not hide under EcoFlow when it isn't detected.
- [ ] Claude usage widget under batteries: arch gauge + Claude mark in the middle.
- [ ] Packages on the wall hide once checked off in admin (W4 builds the admin tool).

## W3 Audio (server.py audio, relay, HA, AirPlay)
- [~] AirPlay target not showing on his iPhone — root-cause + fix + watchdog. (Root cause: the Pi never answered unicast mDNS (Apple "unicast assist" refreshes); HA zeroconf bound 192.168.1.211:5353 and swallowed them, so Bestly Wall aged out of iPhone lists while HomePods stayed. Fix: `bestly-mdns-unicast` helper (scripts/pi/airplay) + avahi IPv4-only; dig now answers v4+v6, 74/94 live Apple queries answered in the first minute. Watchdog `wall.airplay_visible` every 10 min, heal tested. Not yet seen on the iPhone itself.)
- [x] LAX tower (ATC) does not play on the HomePod — fix end to end, audible test before 10:45 PM. (Relay ID3 header broke pyatv + zero-lead underrun killed HA stream; relay now plain frames, 4 s lead, silence fill. 4:05 PM: 45 s steady "playing", Pi mic heard it.)
- [x] Radio still broken — fix end to end, audible test. (Same relay root cause; retry once then Scout after 2 min in plain words. 4:08 PM: KCRW AAC via wall_state.radio played, Pi mic heard it. `POST 127.0.0.1:8099/api/homepod` play/stop helper for W7.)

## W4 Admin (repo: Wall.tsx + admin shell + Scout chat)
- [ ] Do Not Disturb back: edit times, override now, turn off (`dnd`).
- [ ] Admin desktop: use the width (side-by-side columns), simplify + organize (Apple HIG).
- [ ] Sky tab: full-screen digital sky for computer/phone (same planes as the wall).
- [ ] NEEDS YOU: collapse duplicates (4–5 identical wall notices → one row with a count).
- [ ] Scout chat: the "fix LAX guest…" info boxes sit inline in time order, not stuck to the bottom.
- [ ] Packages: check off "got it" → hides from the wall. (Apple's order tracking has no API — answer in the reply.)
- [ ] Layout editor: the selected block (`layoutSel`) is outlined on the projector while the grid is on.
- [ ] "Motivate me" button (`motivate`).

## W5 Shows + home automation (wall.html shows, server.py, HA/Homebridge, sign page)
- [ ] "Motivate me" projection show (Apple-grade).
- [ ] Indoor air bad → turn on the Dyson purifier (Homebridge) automatically + a cute "open the door" takeover; watchdog.
- [ ] Skit: UFO beams Jared up from his desk (desk = the home label); story reworked for anyone, Kings Road / Melrose / WeHo, 733 N Kings Rd.
- [ ] Turo notification: the wall strip fires at the same moment as the iPhone + HomePod announcement.
- [ ] Live signatures: capture stroke timing on the sign page; new signature replays full screen, glides to its spot; the board re-writes signatures one by one (newest → oldest, staggered, overlaps OK), random tilt/placement, graffiti-wall-by-Apple.

## W6 iPhone Live Activity (aircraft)
- [ ] Flighty-style aircraft Live Activity (compact + expanded) with a Find-My-style arrow pointing to the aircraft.
- [ ] Sign-wall plane name tag redesigned to match it.
- [ ] Phone and wall show the same aircraft (`airFocus`), rotating together.

## W7 Voice — "Hey Scout" (Pi + NZXT USB mic)
- [ ] Wake word "Hey Scout" on the Pi using the NZXT mic Jared plugged into it (local, always-on, low CPU; custom openWakeWord-style model, with a tuned threshold + false-wake log).
- [ ] Pipeline: wake → listening chime + wall "listening" glow → speech-to-text → Scout (admin-chat, free LLM first) → spoken reply on the Desk HomePod (or projector speaker) + reply card on the wall.
- [ ] Respect DND / sleep; mute switch in admin; watchdog → Scout (mic missing, wake engine down, STT/LLM failures).

## W8 LED sign mapping (wall.html sign-wall layer)
- [ ] Trace the neon sign (legs/arms line art) from the photos + a live grid pass into a vector outline aligned to the projector (grid cells C6–C7), with an admin nudge/scale to fine-align.
- [ ] Projected effects on/around it: make it look lit when it's off (projected neon glow along the tubes), outline trace, color washes.
- [ ] Tie into notifications (e.g. new signature, Turo booking, motivate) with short sign animations; respect DND; watchdog.

## Waiting on Jared
- [?] Dyson **air purifier** (not a vacuum — Jared, 3:46 PM) on the wall: a "Devices" row under batteries showing it live (on/off, air quality, filter life). Mockup first, build only after he OKs it.

## Rules for every worker
12-hour times, US units, a number never wraps from its unit, Apple HIG for UI, self-healing watchdog tied to Scout for anything new,
secrets only in Supabase Vault, short guest links, backups before Pi edits, bump `wall_state.version` after wall changes,
record decisions in `bestly_memory` (kind `decision`, short SHAs only), commit + push to main with the repo trailer.
