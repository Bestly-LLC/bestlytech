# Blue Steel on the sky maps — opusplan (2026-10-11)

Jared, 9:12 PM: show Blue Steel (the 2020 Model 3) on the wall's sky map at its current location — not tracking, just "if the map is up and the car is inside it, it shows." 9:15 PM: picked marker **A (top-down car)**, and wants it on the **/admin Sky** map too.

## What it does
- Car shows only when it is inside the map's visible area. Outside the view → nothing, no edge arrow, no alert.
- Parked: car icon + tag "Blue Steel". Driving (shift D or R): tag "Blue Steel · 34 mph" (speed rounded, mph).
- Car points the way it last moved (bearing from the last two fixes ≥ 50 ft apart). No heading yet → nose up the street (Kings Rd direction), i.e. 0° on the turned map.
- Stale reading (observed_at older than 30 min): hide it. "Current location" only.
- Near home (< 150 ft from the Home marker): draw the car beside the Home tag, not on top of it (offset along the street, toward the right of Home).

## Data (already live)
`turo_vehicle_state` (one row, `display_name` = "Blue Steel"), refreshed about every minute: `latitude`, `longitude`, `observed_at`, `raw->fleet_api->>shift`, `raw->fleet_api->>speed_mph`. No heading field — derive it client-side.

## Marker A spec (both maps)
- Top-down sedan, nose up, ~22 × 46 units: body `#5B8FC9`, glass roof `#16243C`, two mirror nubs, light headlight ticks `#EAF2FF`, red tail ticks `#E5484D`.
- Soft feathered halo behind it: radial gradient `#5B8FC9` 0.55 → 0.18 at 55% → 0 at the edge. Never a hard edge.
- Tag: pill `#13213A`, 0.5 stroke `#5B8FC9`, text `#DCE7F5`. Never truncated ("..."), never wrapped; number and "mph" stay together (`&nbsp;`).
- Fade in/out 600 ms when it enters/leaves the view or goes stale. Position glides between fixes (no jumps).

## 1. Database — migration `supabase/migrations/20261012050000_wall_pi_car.sql`
- `public.wall_pi_car(p_token text) returns jsonb`, STABLE SECURITY DEFINER, `search_path public`; same token gate as `wall_pi_handoff` (`p_token <> get_home_hub_agent_key()` → raise 'not allowed').
- Returns `{at, name, lat, lon, observed_at, fresh (observed_at > now()-30 min), shift, speed_mph}` for the `tesla_fleet_settings.vin` row (same lookup as `car_return_state()`), or `{known:false}`.
- `revoke all … from public, anon, authenticated; grant execute … to service_role` (match the handoff migration's grants).
- Apply with Supabase MCP `apply_migration`, project `rcqfqhguwpmaarseifqg`.

## 2. Pi server — `/opt/bestly/wall/server.py` (root-owned; CLAUDE.md patch rules)
- Backup `server.py.bak_car_<stamp>`, patch via `sudo -n python3 -`, `py_compile`, then `sudo -n systemctl restart bestly-wall`.
- `CAR = {"at":0,"data":None,"error":None,"fails":0}` cache + `_car_fetch()` mirroring `_handoff_fetch()` (refetch after 30 s, `rpc("wall_pi_car", {})`).
- New GET `/api/car` → cached JSON (next to `/api/air` in the router).
- Watchdog hook: 3 fetch failures in a row → raise Scout alert `wall.car` via the existing Wall Watchdog alert helper (signed by Wall Watchdog); first good fetch resolves it.

## 3. Wall page — `/opt/bestly/wall/www/wall.html`
- Backup `www/wall.html.bak_car_<stamp>`.
- New screen-space element `#airCar` inside `#airScrP` (same pattern as planes: position with `skyPt(...airXY(lat,lon))` so it stays sharp on the ceiling, scaled by `PJ.kp`).
- Inline SVG for marker A + halo; tag text drawn with the sky label rule (reads from the desk facing east, parallel to the street like the Home tag — reuse whatever orientation `scrLabels()` gives the Home item).
- `pullCar()` every 30 s from `/api/car`; visible only if fresh AND the projected point is inside the sky clip (`AF` bounds / `PJ.clip`, same test planes use with `inView`). Hide with the rest of the sky (`body.skit`, `body.mapping`, `pf-noyou`, `#air` off).
- Register in `SKYLAYERS` (`car:{own:['airCar'], at:()=>CAR_AT}`) and stamp `{hx,hy,ppn,brg}` on each paint so Sky Sync audits it and the page self-heals on move-home.
- Re-paint on `homeStep` / `airFit` like other layers.

## 4. Admin Sky — `src/pages/admin/Sky.tsx`
- Read `turo_vehicle_state` (admin already reads it in `AdminTuro.tsx`) every 30 s + Supabase realtime if cheap; same fresh/stale rule.
- Place with `toMi(lat, lon, home)` → `X()/Y()`; render only if inside the current radius circle.
- Same marker A SVG + halo + tag; tag counter-rotated by `mapUp` like the HOME/YOU labels.
- No new switch (it shows when it's in view).

## Repo rules that apply (CLAUDE.md)
- Check which key the Pi's `rpc()` uses. If it is the publishable key, add `wall_pi_car` to `security_public_rpcs` in the same migration (or Ares's Auto-Fixer locks it within an hour).
- `wall.car` alert prefix goes on the Wall Watchdog's team card (`owns`) via `team_onboard` update — no new bot, no new card.
- UI pass: load `.claude/skills/apple-design` first, then a second pass with `ui-ux-pro-max`.
- Regenerate `src/integrations/supabase/types.ts` after the migration.

## 5. Verify
- `npx tsc --noEmit -p tsconfig.app.json` (only the 2 known `ScoutToday.tsx` errors allowed) and `npm run build`.
- Wall: screenshot from the Mac copy (hidden Chrome on CDP 47333, or the wall-sky-sync `--test`) showing the car at its spot, then `window.__skyAudit()` reports `car` in sync.
- Admin: load /admin/sky, confirm the car shows at the DB lat/lon inside radius and hides when zoomed in past it.
- Commit + push to `main` (CLAUDE.md rule). Write decisions to `bestly_memory` key `house/wall/blue-steel-sky-2026-10-11` with the undo steps.

## Undo
Restore `server.py.bak_car_*` and `www/wall.html.bak_car_*`, restart `bestly-wall`; `drop function public.wall_pi_car(text)`; `git revert` the Sky.tsx commit.
