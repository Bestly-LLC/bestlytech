# Citizen local alerts (Sky Sync)

PRIVATE / INTERNAL USE ONLY. Feeds Jared's home projector wall and his /admin Sky map. Never client-facing, never sold.
Citizen's terms very likely forbid automated access (Vera note: bestly_memory house/compliance/citizen-feed-internal-only).

- `citizen_collect.py`: runs on Hestia every ~2 min (`bestly-citizen.timer`, oneshot service as `pi`), installed at /opt/bestly/citizen.
  Citizen web feed first (one request per run, browser User-Agent, exponential backoff, 410 = gone, retried hourly);
  while Citizen fails 3x in a row (or 410) it polls the free backups: NWS alerts and CHP CAD incidents. Reports through `citizen_ingest()`.
- Supabase: tables `citizen_incidents`, `citizen_feed_state` (RLS on, no policies); token-gated SECURITY DEFINER functions
  `citizen_ingest`, `wall_citizen_snapshot`, `citizen_status`; admin-only `wall_admin_citizen`. See supabase/migrations/*citizen_local_alerts.sql.
- Wall: `/api/citizen` in server.py (patch in scripts/wall/citizen/), layer `cit` in wall.html SKYLAYERS, switch `skyAlerts`.
- Admin: Sky map "Local alerts" button + Wall > Sky details > Local alerts.
- Watchdog: tools/wall-sky-sync/skysync.py `citizen_check()` (every 5 min), alerts signed Sky Sync.
- Finding (Oct 28 2026): Citizen's web endpoint returns HTTP 410 and citizen.com/explore redirects to Citizen Enterprise, so the layer runs on NWS + CHP.

Install on a new Hestia: copy this folder to /opt/bestly/citizen (owner pi), the two unit files to /etc/systemd/system,
`systemctl daemon-reload && systemctl enable --now bestly-citizen.timer`. It reads the agent key from /opt/bestly/wall/.report.json.
