# Delivery route to car — opusplan (2026-10-13)

Jared, 12:49 PM: "an automation that sends the address for delivery including LAX to the car before I drive it for the
delivery. Needs to be smart so it's not sending if I use the car beforehand."

## Goal
Before Jared drives Blue Steel to a guest (delivery address, named spot like a hotel or Union Station, or the LAX
Park My Share garage), the car's navigation already shows that destination. Errands he runs beforehand must not get
the delivery route pushed onto them. Home pickups (N Kings Rd) need nothing.

## Facts found (verified)
- Car nav = `tesla_fleet_commands` row, action `nav_point`, args `{lat, lon, label}` → trigger `tesla_cmd_route` routes
  it to TezLab → edge fn `tezlab` → `navigate_to_point(latitude, longitude)`. Coordinates only, no address text.
  `nav_home` / `nav_garage_lax` have worked via TezLab (job 4842). Never use the paid Tesla API.
- LAX garage pin: 33.9472637, -118.3826063 (same as `nav_garage_lax`). Home garage spot: 34.084241, -118.371793.
- `trip_place(res)` → 'lax' | 'home' | 'delivery'. `trip_delivery_json(res)` → address/short/lat/lon.
  For custom deliveries Turo's pin is APPROXIMATE, so lat/lon come back null (fixed today, 20261013194500); the exact
  street address is in `address`. Named spots (`delivery_locations`) have their own lat/lon.
- `admin_car_ready()` already computes the next trip's place, miles and a "Leave by" (start − 1 h − drive time).
  Reuse that formula; do not invent a second one.
- Car position/motion: `turo_vehicle_state` (latest) and `car_trail` (at, lat, lon, speed_mph, shift, locked, battery).
- Owner: Car Guard (`car-guard`), which already runs car automations (Sentry at home) through `car_cmd()` / TezLab.

## The smart rule (what "not if I use the car beforehand" means here)
For the next trip where Jared drives the car (place = 'delivery' or 'lax'), with D = destination:

Never send when ANY of these is true:
1. Feature switched off, or the trip is cancelled/test, or `now() >= starts_at`.
2. Another reservation is active right now (a guest still has the car; the reservation is the source of truth).
3. The car is already within 400 m of D.
4. This trip already got `max_sends` (default 3) sends, or a send for this trip is queued/running.
5. Destination has no coordinates yet (geocode pending) — record reason, retry next tick.

Send when, inside the window `[starts_at − lead_hours (default 5), starts_at)`:
- **A. Parked pre-load at leave-by:** `now() >= leave_by − 20 min`, the car is parked (latest reading shift P or null and
  speed 0, unmoved ≥ 5 min), and no send has happened since the car last parked. This is the normal case: the route is
  waiting when he gets in.
- **B. Heading there early:** the car is moving, and over the last ≥ 4 minutes of `car_trail` readings (≥ 3 points) the
  straight-line distance to D dropped by ≥ 1.5 mi and it is now ≥ 1 mi from the home spot. He left early for the
  delivery; route it now. Errands that wander or go elsewhere never meet this.
- **C. After an errand:** if a send happened, then the car drove and parked somewhere other than D, the "sent since last
  park" flag resets, so A or B can send again (still capped by max_sends).

Moving + not clearly heading to D = do nothing. That is the "using the car beforehand" guard.

## Build
1. **Geocode (free, no key).** Exact coordinates for custom delivery addresses via the US Census geocoder
   (`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=…&benchmark=Public_AR_Current&format=json`),
   fallback Nominatim (`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=…`, set a User-Agent
   `bestly.tech delivery-nav`). Cache in a new table `trip_delivery_geo (reservation_id pk, address, lat, lon, source,
   geocoded_at, error)`; re-geocode only if the address text changes. Run it from SQL with `pg_net` if the extension is
   present (async insert + read-back on next tick), otherwise a tiny edge function `delivery-geocode` called by pg_cron.
   Pick whichever matches existing repo patterns. Sanity check: result must be within 3 mi of Turo's approximate pin
   when one exists, else reject and flag. Named spots and LAX skip geocoding.
2. **Settings + log.** `delivery_nav_settings` (id=1: enabled bool default true, lead_hours numeric default 5,
   max_sends int default 3) with admin-guarded `delivery_nav_admin()` / `delivery_nav_admin_set(...)` (bounded values).
   `delivery_nav_sends` (id, reservation_id, at, trigger 'parked'|'heading'|'manual', dest_lat, dest_lon, label,
   car_lat, car_lon, cmd_id, status, error). Address text is personal: add rows to `privacy_data_map` for the new tables
   (follow existing rows' shape; blank/delete after the trip like other trip data).
3. **Brain.** `delivery_nav_decide(jsonb) returns jsonb` — pure rules above, no I/O, so it can be unit-tested with
   SQL fixtures. `delivery_nav_tick()` gathers inputs, calls decide, inserts the `nav_point` command (label = short
   place name, e.g. "6135 Eleanor Avenue" or "LAX Park My Share"), logs the send. Reason strings start `delivery-nav:`.
   pg_cron `delivery-nav` every 2 minutes.
4. **Manual send.** `delivery_nav_send_now()` (admin only): same destination, skips the timing rule but still refuses
   while another guest's reservation is active.
5. **Admin UI.** In the Ready widget (next to the Sentry-at-home switch, same pattern as
   `src/components/admin/turo/SentryHome.tsx`): row "Route to car" with switch, one status line
   ("Sends around 6:20 PM", "Sent 6:21 PM: 6135 Eleanor Avenue", "Waiting: car in use", "Finding the address"), and a
   "Send now" button. 12-hour times. No text truncation, numbers never split from units, Apple design skill rules.
6. **Notifications (signed Car Guard).** Successful send → `notify_route` success (recap only). A send that fails
   → auto-retry next tick (self-heal); after the 3rd failure, or no successful send by leave-by while the car is parked
   at home → one passive alert "Car Guard: couldn't send the route for <Guest>'s delivery" with the address. Never
   interrupt for this. `notification_owners` prefix `car.delivery_nav` → car-guard.
7. **Watchdog.** `delivery_nav_watchdog()` on its own cron (every 15 min): tick ran in the last 10 min; no `nav_point`
   stuck queued/running > 10 min (mark failed so the tick retries); geocode errors for trips in the next 24 h raise
   `car.delivery_nav.geocode.<res>`; each issue resolves itself when fixed. Team card via `team_onboard`
   (slug `delivery-nav`, tool_of `car-guard`, pulse job `delivery-nav`, also `delivery-nav-watchdog`,
   owns `car.delivery_nav`).
8. **Tests before live.** SQL fixtures for decide(): parked at home 30 min before leave-by → send; errand driving away
   → no send; driving toward D early → send; another guest active → no send; already at D → no send; cap reached → no
   send. Then a dry run of `delivery_nav_tick()` for Marcus (res 62275681, 8:00 PM today) with sending disabled to see
   what it would do. Geocode Marcus's address for real and check it lands on Eleanor Ave.
9. **Ship.** One migration file `supabase/migrations/2026101320xxxx_delivery_nav.sql`, frontend commit, push to main.
   Save undo SQL for any replaced function in `bestly_memory` first. Write the result to `bestly_memory`
   (`house/turo/delivery-nav-2026-10-13`). Must be live before 3:00 PM PT today (Marcus's window opens then).

## Out of scope
Home pickups; changing the trip pages; the guest's own nav (Leo already sends Superchargers / car washes).
