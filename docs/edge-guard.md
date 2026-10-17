# Edge Guard

The AI employee that owns the Cloudflare edge for `bestly.tech`, `www.bestly.tech` and `cloud.bestly.tech`.
Team card: `/admin/team` > Edge Guard (Cloudflare and uptime guard, reports to Ares, runs on the Mac mini).
Source: `scripts/edge-guard/`. Live copy: `~/bestly-agents/edge-guard/` on the Mac mini.

## Why it exists

2026-10-05: the Cloudflare account is on the Workers FREE plan (100,000 requests a day, shared by all Workers).
Two splash Workers sat on every request to the sites, the cap was hit, and every visitor got Cloudflare error
1027/429 ("temporarily rate limited"). The fix is structural: **no Worker route exists normally**, so normal traffic
uses zero Worker quota. Edge Guard puts a splash route on a site only while that site is failing.

## What it does (every minute)

1. Probes `https://bestly.tech/`, `https://www.bestly.tech/` and `https://cloud.bestly.tech/status.php` like a visitor
   (through Cloudflare, cache-busted). Healthy = anything under 500 that is not a Cloudflare 1027/429.
2. **2 failed checks in a row**: attaches that site's splash route (`bestly.tech` + `www` use Worker
   `bestly-site-outage-splash`; `cloud` uses `bestly-cloud-maintenance-splash`) with `request_limit_fail_open: true`,
   and tells Jared once.
3. **3 healthy checks in a row**: detaches the route and tells Jared once ("back up after N minutes").
   While a splash is on, the Worker passes healthy responses through and only intercepts 5xx, so probing through it
   judges the origin correctly.
4. **Invariants, enforced every run** (Jared: it must not stay broken "on its own or by me"):
   - Any Worker route on the zone that is fail-closed is switched to fail open, whoever created it. Alert.
   - Any splash route attached while the site is healthy is detached after 3 healthy checks (undoes a redeploy that
     left it always on). Bell note, no push.
   - Cloudflare 1027/429 seen: removes the splash routes, keeps everything fail open, alerts (once an hour).
   - **No cached lie about a file that exists** (every 5 minutes, added 2026-10-17). See below.
   - The cache rule that keeps a 404 out of the cache is still there (once a day).
5. Writes a heartbeat to `edge_guard_beat` every run. Team Watch reads it through the card's pulse (gap 5 minutes);
   if Edge Guard stops, the card goes yellow then red and Team Watch raises `team.silent.edge-guard`.
6. Every action is logged: `edge_guard_log` table (at, site, state, action, detail) and
   `~/bestly-agents/edge-guard/edge-guard.log` on the Mac.

## Cached lies — the class that killed /neckpilot (2026-10-17)

Vercel tags **every** `/assets/*` response `public, max-age=31536000, immutable` — including its own 404. A hashed
asset that 404s for one moment while a deploy swaps builds can therefore become a year-long answer for a file that
exists, and Cloudflare caches 404/410 for three minutes on its own even with no cache-control at all.

`/neckpilot` was dead for real visitors on 2026-10-17: Chrome got a 404 for a JS chunk it imports, the page fell to
its error boundary, and **every probe we owned said 200** — `probe-external`, `site-depth-check`, a plain `curl`.
Redeploying cannot fix it (the filename is content-hashed, so it is identical in every build) and neither can
rolling back.

The tell is the difference between two requests for the same file: without a cache-buster the edge answers from its
own copy (`cf-cache-status: hit`), with one it goes to the origin (`miss`). A plain 404 that a busted request says
is 200 means the edge is the problem. Edge Guard now checks every asset the homepage references that way every five
minutes, and:

- **detects** it with no Cloudflare permission at all — that is why it lives in Edge Guard and not in the account;
- **purges** the URL when a token exists (below), then says so;
- **alerts** either way: a lie, or a file the build genuinely never shipped (a purge cannot help that one — it is
  Depth Check's deploy-side job).

### The permission this needs

The wrangler OAuth login Edge Guard already holds **cannot do any of it**: its scopes are `zone:read` plus workers,
d1, pages and friends — no cache purge, no cache rules. Verified 2026-10-17 (purge answers 401, rulesets 403). So
clearing a cached lie, and enforcing the rule that prevents one, need their own token:

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token, zone `bestly.tech`:
   **Zone → Cache Purge: Edit** and **Zone → Cache Rules: Edit**. Nothing else.
2. Keychain Access → add a password item, name `bestly-cf-cache`, account `bestly.tech`, value = the token.

With that item present Edge Guard purges a poisoned URL, and once a day confirms the cache rule exists and puts it
back if somebody removed it. Without it, detection and the alert still work, and the heartbeat summary says
`no cache token (rule unverified)` rather than implying the edge is covered. If the token is refused, that is itself
an alert, because a check that silently stops checking is worse than no check.

## Alerts (signed Edge Guard, through `scout_notify`, deduped per incident)

- "Edge Guard: the edge is serving a cached lie" (with the URL and the one-line fix)
- "Edge Guard: a page is loading a file the build never shipped"
- "Edge Guard: I could not confirm the rule that keeps 404s out of the cache"
- "Edge Guard: bestly.tech is down, showing the splash"
- "Edge Guard: bestly.tech back up after 6 minutes"
- "Edge Guard: switched a blocking route to fail open"
- "Edge Guard: Cloudflare is rate limiting the sites (error 1027)"
- "Edge Guard: I lost my Cloudflare login" with the fix line
- "Edge Guard: bestly.tech is still down after 60 minutes" (one reminder an hour at most)

Times are 12-hour. An outage pings once, not every minute. If the database is unreachable, alerts go to the phone
through `~/bin/hapush` and the log lines are queued and sent later.

## Where it runs and why

The Mac mini, launchd `tech.bestly.edge-guard` (every 60 seconds). Plain Python, no AI, no Claude.

- It holds the Cloudflare login (wrangler OAuth). The Pi cannot hold it without copying the token, which we
  do not do.
- `cloud.bestly.tech` is served from the Pi (cloudflared). A guard on the Pi cannot show the splash when the Pi is
  down. The Mac is independent of both the Pi and Vercel.
- Credentials, nothing new: Cloudflare = `~/Library/Preferences/.wrangler/config/default.toml` (refreshed with
  `npx wrangler whoami`; the token is held in memory only, never printed or logged); database = publishable key +
  the watchdog token in Keychain (`bestly-db-watchdog`), same as `~/bin/bestly-watchdog.py`.

## Controls

- Stop: `launchctl bootout gui/$(id -u)/tech.bestly.edge-guard`. Or `touch ~/bestly-agents/edge-guard/PAUSED` (it
  keeps the heartbeat, enforces nothing, and the card shows "paused"). Remove the file to resume.
- Start/update: `cd scripts/edge-guard && sh install.sh` (copy to `~/bestly-agents/edge-guard`, load launchd).
- Look: `tail ~/bestly-agents/edge-guard/edge-guard.log`, `python3 ~/bestly-agents/edge-guard/edge-guard.py --status`,
  `select * from edge_guard_log order by id desc limit 20`.
- Test without touching a site: write `~/bestly-agents/edge-guard/probe-override.json` as
  `{"until": <epoch seconds>, "bestly.tech": ["http://127.0.0.1:8599/"]}` and run a local server that returns 500.
  The override expires on its own; alerts for an overridden site say "(test)" and never push the phone.

## If wrangler is logged out

Check first that it is a real logout. Since wrangler 4.149 `npx wrangler whoami` prints a "missing some expected OAuth scopes ...
run `wrangler login`" warning while you are still logged in. Edge Guard now treats "You are logged in" as healthy and ignores that
warning (2026-10-11; before that fix it raised a false "I lost my Cloudflare login" every minute). A real logout prints
"not authenticated" / "not logged in" and no "You are logged in" line.

Edge Guard alerts "I lost my Cloudflare login". On the Mac mini, run:

    npx wrangler login

(Account `jared@bestly.tech`.) Nothing else; the next minute's run picks it up.

## Rules

- Never add a permanent Worker route (`[[routes]]` in a `wrangler.toml`, or in the dashboard). Free plan: it burns
  the shared 100,000 requests/day and causes error 1027. Edge Guard owns the routes. If one is left on, it removes it.
- `wrangler deploy` of either splash Worker uploads the code only; both `wrangler.toml` files have no `[[routes]]`.
- Migration: `supabase/migrations/20261006000000_edge_guard.sql` (tables, `edge_guard_note_t`, `edge_guard_beat_t`,
  team card).
