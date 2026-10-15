# security-audit

Replaces the Claude scheduled task **Bestly - nightly security audit (1 AM PT)** (`trig_01HYfnxG2mTTdjo6hrZZKZaJ`), which spent about 18 minutes of Opus every night on checks that are almost entirely mechanical.
This job runs the same checks on the Pi, with no AI at all.

| | |
|---|---|
| Owner | Ares, Head of Security & IT (team slug `security-auditor`). Alerts are raised by `security_run_finish`, already under his `security` prefix. |
| Schedule | `0 1 * * * /opt/bestly/cron/run.sh security-audit` (Pi clock is America/Los_Angeles) |
| `pi_jobs` row | `security-audit`, `max_gap_min` 1560, **registered disabled** |
| Replaces | the Claude task above. Retire it only after a night or two of this one running clean. |

## Where things live

| Thing | Path |
|---|---|
| Worker | `/opt/bestly/cron/jobs/security_audit.py` |
| Wrapper (hyphenated name for `runjob.py`) | `/opt/bestly/cron/jobs/security-audit.py` |
| Website, DNS, mail and code checks (reused, unchanged) | `scripts/security-audit/web_checks.py`, installed as `/opt/bestly/cron/jobs/security_audit_web_checks.py` |
| State (`mode`, last run, last 30 runs) | `/opt/bestly/cron/state/security_audit.json` |
| Database side | `supabase/migrations/20261014210000_security_audit_pi_rpcs.sql` (**not applied**), `20261014210100_security_audit_pi_job.sql` (applied), `20261015150000_security_audit_cloudflare_token.sql` (Cloudflare token, **not applied**) |
| Token paste box | `src/pages/admin/SecurityTokensCard.tsx`, mounted at the bottom of `/admin/security` |

## What it does, in order

1. Builds the inventory: Vercel projects and domains, the Supabase project list, team member count. With no Vercel token it carries last night's host list forward.
2. `security_run_start`.
3. Runs `web_checks.py` as a subprocess with a scrubbed environment (no database key, no tokens): TLS, headers, exposed paths, DNS and mail, secrets in the repo, `npm audit`, and a text fingerprint of each homepage.
4. Platform checks:
   - Supabase security advisors for each project (Management API).
   - Admin count and anon-callable SECURITY DEFINER writers (`security_audit_facts()`).
   - Cron health (`cron_health(24)`).
   - Vercel: preview protection, team members, browser-exposed env var names, "homepage changed with no deploy".
   - Cloudflare (read-only, layer `Edge (Cloudflare)`): Worker routes per zone, Workers usage against the free daily cap, Workers with no owner, CNAMEs pointing at nothing, API token scope, SSL mode and minimum TLS per zone, account members. Details in the Cloudflare section below.
   - El Dora domain ownership (`bestly_memory eldora/domain-risk`).
5. **One** batched write of every check, passes included (`security_checks_record`), then `security_scan_pi` for the `pi:bestly-pi:*` keys.
6. Saves the fingerprints onto the run's `inventory` (tomorrow night compares against them).
7. `security_run_finish`. If anything above failed, it is called with `p_failed = true` so the admin shows "Last run failed" instead of going quiet.

Check keys are exactly the Claude task's, because findings de-duplicate by key and a renamed key would reopen a closed finding:
`supa:<project>:advisor:<lint>`, `...:leaked_password_protection`, `...:function_search_path`, `supa:Bestly:rpc:mail_functions_anon`, `supa:Bestly:rpc:anon_writer:<fn>` (check `anon_rpc`, evidence has `function`, which Ares's Auto-Fixer reads), `supa:Bestly:staff:admins`, `vercel:<project>:preview_protection`, `vercel:team:members`, `vercel:<project>:client_secret_env`, `web:<host>:content_changed`, `dns:eldoraluxe.com:ownership`, `ops:supabase:cron_startup`, and `pi:bestly-pi:*`.
`pi:bestly-pi:internal_scan` is never recorded (bestly_memory PROCEDURE UPDATE 2026-09-23).

New keys this job adds, all passes in the normal case: `supa:<project>:advisor:scan` (so a "couldn't check" finding can close) and `vercel:team:client_secret_env`.

## How it stays honest

* A check that did not run is recorded as **skip**, never pass. `security_check` turns a skip into a yellow finding at `<key>:unreachable`, titled "Not checked: ...", and closes that twin the first night the check runs for real. Nothing real is closed or changed by a skip.
* **Missing token = skip, not failure.** One skip per missing token (not one per check), naming the token. The run still succeeds. **Until Jared pastes the tokens, expect two yellow "Not checked" findings on /admin/security.** That is intended.
* Defacement check without a Vercel token: unchanged text passes, changed text records nothing (it cannot know whether a deploy happened).
* If `web_checks.py` cannot run (for example `requests` is missing), the run **fails** with `p_failed = true` rather than reporting empty website results as passes.
* Secrets: tokens come from Vault (`pi:vercel:api_token`, `pi:supabase:management_token`, `pi:cloudflare:api_token`) via `/opt/bestly/bin/security`, falling back to `pi_secret_get`. They are never printed, logged or written to disk. Vercel env var **values** are discarded as they arrive and `decrypt` is never requested. Vercel member emails are counted and dropped.
* Only GETs go to Vercel, Supabase Management and Cloudflare. The one exception is Cloudflare's GraphQL endpoint, which takes a read-only `query` by POST (the code refuses to send anything else). No redirect is followed with an Authorization header.
* Dry by default. `state.mode` is `dry` until you set it to `live`; a dry run reads but writes nothing. A second scheduled run inside 6 hours is refused (`nights_open` would double count). `--force` overrides.

## Cloudflare section (2026-10-15, plan: `docs/cloudflare-audit-opusplan.md`)

Why: the Cloudflare account was completely unaudited, and a Worker route on the free plan took bestly.tech and cloud.bestly.tech down on 2026-10-05 (error 1027). Read-only, no AI.

**Token.** Vault name `pi:cloudflare:api_token`, read the same two ways as the other tokens (`/opt/bestly/bin/security find-generic-password -a api_token -s cloudflare -w`, then `pi_secret_get`). Paste it in the third field of the Audit tokens card on `/admin/security`. Create it at dash.cloudflare.com > My Profile > API Tokens > Create Custom Token, as a **user** token, All **Read**, nothing else:

* Account: Account Settings Read, Workers Scripts Read, Account Analytics Read, Cloudflare Tunnel Read
* Zone (All zones): Zone Read, DNS Read, Workers Routes Read, Zone Settings Read
* User: API Tokens Read (only for the token-scope check; without it that one check records skip)

A missing token is one skip, `cf:account:members`, listing every check that did not run, plus token state `missing`. A refused token (401/403 on the first call) is the same single skip, token state `rejected`, and the Scout notice names Cloudflare too.

**Keys** (all layer `Edge (Cloudflare)`, zones by name):

| Key | Result |
|---|---|
| `cf:account:count` | exactly 1 account pass; more than 1 yellow (account-level checks ran on the first only); 0 skip |
| `cf:<zone>:worker_routes` | no route pass; any route red, except yellow "Splash route on during an outage" when `edge_guard_log` says the covered host is down (newest row per site in the last 2 hours has state `down`) and the route fails open; a fail-closed route is always red |
| `cf:account:workers_usage` | previous full UTC day, all scripts, via GraphQL. Under 50% of 100,000 pass, 50 to 80% yellow, 80% and up red. Evidence: total and the top 3 scripts |
| `cf:worker:<name>:orphan` | owned Workers (`CF_WORKER_OWNERS`) pass, any other Worker yellow "Worker with no owner" with its 7-day request count and whether it has a cron. A deleted Worker's finding closes by pass |
| `cf:<zone>:dangling_cname` | `*.cfargotunnel.com` to a tunnel that is not in the account: red. Other targets that do not resolve: red for takeover-prone hosts (vercel-dns.com, vercel.app, github.io, herokuapp.com, azurewebsites.net, cloudfront.net, S3, netlify.app, pages.dev, workers.dev), yellow otherwise. A DNS timeout is skip |
| `cf:token:scope` | audit token active and not expiring within 14 days; any token with an Edit or Write permission and (no IP restriction or no expiry) yellow, by token name only; the audit token with any write permission red |
| `cf:<zone>:ssl_mode` | `strict` pass, `full` yellow, `flexible` or `off` red; `min_tls_version` below 1.2 yellow (worst wins, both in evidence) |
| `cf:account:members` | exactly 1 accepted member pass; more red; pending invites yellow. Counts only: emails are dropped as they arrive |

Two keys beyond the plan, added so a "could not read it" skip has a real key to close under: `cf:account:zones` (zone list readable) and `cf:account:workers_list` (Worker list readable).

**Expected first run.** Four yellows, "Worker with no owner": `bestly-content-bot` (Listing Bot, retired 2026-10-04, still deployed), `confesh-info`, `confesh-moderation`, `stitch-proxy`. Each closes the night it is deleted or added to `CF_WORKER_OWNERS`. Anything else yellow or red on the first run (SSL `full`, a pending invite, a write token without an expiry, a CNAME to a dead host) is a real thing to look at, not noise. If the token is missing on the first run, expect one yellow "Not checked" finding at `cf:account:members:unreachable`.

**Free-plan rule.** The audit adds no Worker route and never writes to Cloudflare. It makes a few dozen GET calls plus 1 or 2 GraphQL queries a night, from the Pi. They are API calls, not Worker requests, so they do not touch the 100,000 a day cap.

## If the migration is not applied yet

The job degrades honestly instead of failing (for Cloudflare, token state is not recorded and the card hides the third field's status until `20261015150000_security_audit_cloudflare_token.sql` is applied): no batch RPC means one `security_check` call per check; no `security_audit_facts()` means the anon-writer scan is recorded as skip and the admin count falls back to a plain `user_roles` read. Token state is simply not recorded.

## Switch-on steps

1. Apply `20261014210000_security_audit_pi_rpcs.sql` (adds the token RPCs, the facts and batch RPCs, and a small state table).
2. On the Pi, from this folder: `sh install.sh` (copies files, seeds DRY state, adds the cron line, runs the selftest). It warns if `requests`, `git` or `npm` is missing.
3. Apply `20261015150000_security_audit_cloudflare_token.sql`. On `bestly.tech/admin/security`, Audit tokens card: paste the Vercel token, the Supabase Management token and the Cloudflare token.
4. `python3 /opt/bestly/cron/jobs/security_audit.py --dry` and read the one-line result.
5. `python3 /opt/bestly/cron/jobs/security_audit.py --live --force` for one real run. Check /admin/security.
6. Set `"mode": "live"` in `/opt/bestly/cron/state/security_audit.json`, then `update pi_jobs set enabled = true where job = 'security-audit';`
7. After a night or two clean, retire the Claude task and set Ares's card `runs_on` to `pi`. Until then both writers share the same finding keys, which is safe (same rules, same outcomes) but means nights_open can count a night twice if they overlap within a run; stop the Claude task first if that matters.

## NOT verified. Read before trusting it.

Everything below could not be proven from where this was built (no Pi, no tokens).

* **Never run on the Pi or against live Vercel / Supabase Management with a real token.** The selftest drives the real code against fakes shaped from the official docs. The request and response shapes below come from the docs, not from a call.
* **Supabase advisors endpoint is documented as experimental** ("subject to change or removal"): `GET https://api.supabase.com/v1/projects/{ref}/advisors/security`. The level strings documented are only `ERROR`; existing findings suggest `WARN` and `INFO` also exist. The mapping assumes lint names `auth_leaked_password_protection` and `function_search_path_mutable` and `security_definer_view`, from the Supabase lint catalogue, not from a live response. If a name differs, that check will pass wrongly, so the first live run must be compared by eye against the Supabase dashboard advisor.
* The exact Supabase token page URL is not confirmed; the card says "Account, Access Tokens". Fine-grained scopes `advisors_read` and `projects_read` are from the docs.
* **Vercel:** pagination uses `pagination.next` as the next `until`; unconfirmed against a project list longer than one page (12 projects fit in one). `ssoProtection` null is treated as "previews open"; unconfirmed for projects with only password protection. `/v7/deployments` with `target=production&state=READY&since=<ms>` is from the docs. A token without env read access gets a 403, handled as skip. Whether a Vercel token can be made read-only at creation was not checked.
* `team_is_admin()` guards the token RPCs; verified in a local scratch Postgres with stubs (non-admin refused, admin saves, status never returns a value, bad token refused), **not** against the real Supabase auth and Vault.
* `git`, `npm` and `requests` on the Pi are assumed; `install.sh` warns if missing.
* A duplicate-run guard compares timestamps with `datetime.fromisoformat`; on Python older than 3.11 an odd microsecond format could make it silently not guard.
* Verified live against the real database (read-only queries): signatures of `scout_notify`, `security_check`, `security_run_start/finish`, `security_scan_pi`, `cron_health`, `pi_job_report`, `pi_secret_get`, `team_onboard`; the `team_pulses()` sources (a Pi job uses `src: pi_job`, `cron` would look for a pg_cron job); `security_check` skip semantics; the anon-writer SQL (returned `card_scan_log`, `cy_report_site_issue`, `ltx_report`, all on the public allowlist but still recorded, as the Claude task did).

### Cloudflare: NOT verified

Written 2026-10-15 from Cloudflare's documentation and the plan, with no Cloudflare token and no Pi. The selftest drives the real code against a fake Cloudflare API shaped from the docs, so it proves the logic, not the field names. **Every endpoint shape below comes from the docs, not a live call.** The first `--dry` run with a real token must be compared by eye against the Cloudflare dashboard.

* **GraphQL is the weakest part.** Dataset `workersInvocationsAdaptive`, filter fields `datetime_geq` / `datetime_lt`, `sum { requests }`, dimension `scriptName`, `accounts(filter: {accountTag})`, `limit: 10000`: all from the docs. If a name is wrong the query returns an `errors` array; the code reads that as skip (or skip naming Account Analytics Read when the message looks like an authorization error), never as zero usage. Whether the dataset is sampled (adaptive datasets are) and whether a 7-day window is allowed on the free plan was not checked. The 7-day Worker request count is only a hint for deciding what to delete.
* **Field names read from REST answers:** accounts `id`; zones `id`, `name`; Worker scripts `id` (the script name); routes `pattern`, `script`, `request_limit_fail_open`; DNS records `name`, `content`; tunnels `id` (query `is_deleted=false`); settings `result.value` for `ssl` and `min_tls_version`; members `status` (`accepted` / `pending`); tokens `name`, `status`, `expires_on`, `condition.request_ip.in`, `policies[].permission_groups[].name`; verify `id`, `status`, `expires_on`; Worker schedules `result.schedules[]`. None confirmed live.
* **Pagination.** `page` / `per_page` with `result_info.total_pages` is used for accounts, zones, DNS records, tunnels, members and tokens. Routes, Worker scripts and settings are read in one call (not paginated as far as the docs say). More than 40 pages is an error, never a silent partial list.
* **`/user/tokens/verify` and `/user/tokens` only work for a user token.** An account-owned token (created under Manage Account) gets an error there and `cf:token:scope` records skip. The permission group name for the token list is "API Tokens Read" in the plan; the dashboard's exact wording was not checked.
* **Edge Guard outage rule.** The `edge_guard_log.state` values were read from the live table (`ok`, `down`, `quota`, `recovered`, `repaired`, `token`, `error`). Only `down` counts as an outage, matched on `site` (`bestly.tech` also covers `www.`; wildcard route hosts never count). If `edge_guard_log` cannot be read, a route is red.
* **Dangling CNAME detection uses the Pi's own resolver** through `socket.getaddrinfo`, which cannot tell NXDOMAIN from other "no such name" answers perfectly. An NXDOMAIN only counts if `cloudflare.com` still resolves right after; otherwise the whole zone records skip. A CNAME to a name that exists but serves nothing (an unclaimed `vercel.app` project) is **not** detected.
* **Token scope check** treats a permission group as a write permission when its name contains the word Edit or Write. Only active tokens are examined. Names are listed, ids and values are never stored.
* Account names and member emails are dropped as they arrive, but a Cloudflare 5xx/429 retries up to 3 times; the retry sleeps are untested against a real rate limit.

## Tuning

Edit the constants at the top of `security_audit.py`: `DEPLOY_WINDOW_HOURS` (26), `DUP_GUARD_HOURS` (6), `EXTRA_HOSTS`, `MAIL_DOMAINS`, `EXPECTED_SUPABASE`, `CF_WORKER_OWNERS` (every Worker needs an owner), `CF_TAKEOVER_SUFFIXES`, `CF_FREE_CAP`.
Selftest: `python3 selftest.py`.
