# Cloudflare pass for the nightly security audit (opusplan, 2026-10-15)

The nightly audit (`tools/security-audit/`, Pi, 1:00 AM PT, owner Ares) covers Vercel, Supabase, DNS/mail and the Pi.
Cloudflare is completely unaudited, and a Worker route on the free plan took bestly.tech and cloud.bestly.tech down on
2026-10-05 (error 1027). This adds a Cloudflare section to the same job. Read-only. No AI.

Plan: Opus (this file). Build: Sonnet. Install: one command on the Pi from a Mac-linked chat (see the end).

## Facts checked on 2026-10-15 (read-only Cloudflare tools from the cloud)

Workers on the account (7):
`bestly-site-outage-splash`, `bestly-cloud-maintenance-splash` (both Edge Guard, attached only during an outage),
`bestly-studio-mail` (Studio inbox email Worker), `bestly-content-bot` (Listing Bot, retired 2026-10-04, still deployed),
`confesh-info`, `confesh-moderation`, `stitch-proxy` (no owner found in the repo or team cards).

`bestly-content-bot`: email handler plus HTTP `/health` (public, reveals its inbox address and which AI it uses),
`/inbound`, `/clients`, `/dryrun` (Bearer token). Its email route `content@hoku-clean.com` was disabled 2026-10-04
(bestly_memory area studio, key studio/inbox). studio_mail has 21 rows, newest 2026-10-01, none touched by listing intake. Nothing
found that still calls it.

## Token

* New Vault secret `pi:cloudflare:api_token`, read the same way as the other two:
  `/opt/bestly/bin/security find-generic-password -a api_token -s cloudflare -w`, then `pi_secret_get`.
* Third field on the Audit tokens card (`src/pages/admin/SecurityTokensCard.tsx`), same write-only pattern.
* Create at dash.cloudflare.com > My Profile > API Tokens > Create Custom Token. All READ, nothing else:
  - Account: Account Settings Read, Workers Scripts Read, Account Analytics Read, Cloudflare Tunnel Read
  - Zone (All zones): Zone Read, DNS Read, Workers Routes Read, Zone Settings Read
  - User: API Tokens Read (only for the token-scope check; without it that one check records skip)
  Put this list in the card's help text.

## Database (new migration, append-only, `2026101515xxxx_security_audit_cloudflare_token.sql`)

* `security_token_state.which` check: allow `'cloudflare'`. Drop and re-add the constraint by name (look it up; do not
  guess it).
* New RPC `security_tokens_save_cloudflare(p_token text)`: admin only (`team_is_admin()`), trims, refuses blank and
  anything with whitespace or under 20 chars, writes Vault `pi:cloudflare:api_token` (create or update), returns
  `security_tokens_status()`. A separate function, NOT a third argument on `security_tokens_save`: adding an argument
  means dropping the old signature (PostgREST overload ambiguity), and the cloud Supabase connector hangs on drops and
  deletes. Revoke from public, anon; grant authenticated, service_role.
* `security_tokens_status()`: `create or replace`, same return shape plus a `cloudflare` key. Old page builds ignore it.
* `pi_secret_get` has an allowlist (see `20261006221500_pi_secret_fireworks.sql` for how a name was added). Add
  `pi:cloudflare:api_token` the same way, in this migration.
* Copy the exact body of the current live functions before replacing them (`pg_get_functiondef`), change only what this
  needs.

## Checks (all new keys, layer `Edge (Cloudflare)`)

Discovery: `GET /client/v4/accounts` (expect exactly one account; more than one is itself a yellow
`cf:account:count`), `GET /zones?per_page=50`. Every call is a GET with the token as Bearer, no redirects followed,
paginate with `page`/`per_page` and `result_info.total_pages`. 401/403 on the first call = token rejected
(`TokenProblem`), same as Vercel.

| Key | Result rules |
|---|---|
| `cf:<zone>:worker_routes` | `GET /zones/{id}/workers/routes`. No routes = pass. Any route = RED, **except** when `edge_guard_log` says Edge Guard is in an outage for a host that route covers (newest row for that site in the last 2 hours has a down/splash state; read the table to learn the exact state values) = yellow "Splash route on during an outage". Evidence: pattern, script, `request_limit_fail_open`. A route that is fail-closed is always red. |
| `cf:account:workers_usage` | GraphQL `POST /client/v4/graphql` (read-only query; it is the one non-GET, allowed explicitly), dataset `workersInvocationsAdaptive`, sum `requests` for the previous full UTC day across all scripts. Free plan cap 100,000/day. Under 50% pass, 50 to 80% yellow (early warning), 80% and up red. Evidence: total and the top 3 scripts. If GraphQL is denied, skip naming Account Analytics Read. |
| `cf:worker:<name>:orphan` | `GET /accounts/{acct}/workers/scripts`. Owned Workers live in a constant `CF_WORKER_OWNERS` (`bestly-site-outage-splash` and `bestly-cloud-maintenance-splash` = edge-guard, `bestly-studio-mail` = studio). Any other Worker = yellow "Worker with no owner", detail includes its 7-day request count (same GraphQL) and whether it has a cron schedule (`GET /accounts/{acct}/workers/scripts/{name}/schedules`). Owned Workers record pass under the same key so a finding closes once an owner is added. Expected first run: 4 yellows (content-bot, confesh-info, confesh-moderation, stitch-proxy). |
| `cf:<zone>:dangling_cname` | `GET /zones/{id}/dns_records?type=CNAME`. For each target: `*.cfargotunnel.com` = look the tunnel id up in `GET /accounts/{acct}/cfd_tunnel?is_deleted=false`; missing = red. Any other target = resolve with `socket.getaddrinfo` (timeout 5 s); NXDOMAIN = red when the target is a takeover-prone host (vercel-dns.com, vercel.app, github.io, herokuapp.com, azurewebsites.net, cloudfront.net, s3 and s3-website, netlify.app, pages.dev, workers.dev), yellow otherwise. Temporary DNS failure = skip, never pass. One key per zone; evidence lists each bad record (name, target, why). |
| `cf:token:scope` | `GET /user/tokens/verify` (status must be active; expiring within 14 days = yellow). Then `GET /user/tokens` (needs API Tokens Read; 403 = skip naming that permission). For every token: any permission group whose name contains `Edit` or `Write` AND (no IP restriction OR no expiry) = yellow, listed by token name only (never ids, never values). The audit's own token having any write permission = red. |
| `cf:<zone>:ssl_mode` | `GET /zones/{id}/settings/ssl`: `strict` pass, `full` yellow, `flexible` or `off` red. Also `min_tls_version` below 1.2 = yellow (same key, worst wins, both in evidence). |
| `cf:account:members` | `GET /accounts/{acct}/members`. Exactly 1 member (status accepted) = pass. More = red like `vercel_members_check`. Pending invites = yellow. Count only; emails dropped as they arrive. |

Missing token: one `skip_missing_token(checks, "cloudflare", "cf:account:members", ...)` listing every check above,
plus `token_state(db, "cloudflare", "missing")`. Rejected: `token_state(... "rejected")`, unverified entry,
same Scout notice path as Vercel/Supabase (update its text to name Cloudflare too).

## Code shape

* `class Cloudflare` next to `class Vercel` (same `api=http_json` injection, `get`, `paged`, plus `graphql`).
* Pure check builders (`cf_route_check`, `cf_usage_check`, ...) like `vercel_members_check`, so selftest can drive them.
* Run the Cloudflare block after 4d (Vercel), before 4e. Inventory gets `cloudflare: {account, zones, workers}`.
* README: add the token, the keys, the expected first-run yellows, and the NOT-verified list (every endpoint shape
  above comes from Cloudflare's docs, not a live call; the GraphQL field names especially).

## Selftest (offline, extends `selftest.py`)

Fake Cloudflare API in `FakeWorld`. Cases: no token (one skip, nothing else under `cf:`); token rejected; healthy
account (all pass); a route present (red); a route present during an Edge Guard outage (yellow); usage 60k (yellow),
85k (red); unowned Worker (yellow) and owned Worker (pass); dangling Vercel CNAME (red), deleted tunnel (red), DNS
timeout (skip); ssl flexible (red); 2 members (red); a write token without expiry (yellow); the token value never
appears in any db payload or the log. Run `python3 selftest.py`: all must pass.

## Install (the only Mac-linked step)

From a chat linked to the Mac, one SSH session to bestly-pi-lan:
copy `tools/security-audit/` plus `scripts/security-audit/web_checks.py` to the Pi the way the Oct 14 install did (scp from
the Mac checkout; web_checks.py goes beside install.sh), run `sh install.sh` there, then
`python3 /opt/bestly/cron/jobs/security_audit.py --dry` and read the one line. The job is already live nightly, so the
next 1:00 AM run picks it up. Before that, Jared pastes the Cloudflare token on /admin/security.
