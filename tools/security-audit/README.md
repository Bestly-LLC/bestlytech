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
| Database side | `supabase/migrations/20261014210000_security_audit_pi_rpcs.sql` (**not applied**), `20261014210100_security_audit_pi_job.sql` (applied) |
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
* Secrets: tokens come from Vault (`pi:vercel:api_token`, `pi:supabase:management_token`) via `/opt/bestly/bin/security`, falling back to `pi_secret_get`. They are never printed, logged or written to disk. Vercel env var **values** are discarded as they arrive and `decrypt` is never requested. Vercel member emails are counted and dropped.
* Only GETs go to Vercel and Supabase Management. No redirect is followed with an Authorization header.
* Dry by default. `state.mode` is `dry` until you set it to `live`; a dry run reads but writes nothing. A second scheduled run inside 6 hours is refused (`nights_open` would double count). `--force` overrides.

## If the migration is not applied yet

The job degrades honestly instead of failing: no batch RPC means one `security_check` call per check; no `security_audit_facts()` means the anon-writer scan is recorded as skip and the admin count falls back to a plain `user_roles` read. Token state is simply not recorded.

## Switch-on steps

1. Apply `20261014210000_security_audit_pi_rpcs.sql` (adds the token RPCs, the facts and batch RPCs, and a small state table).
2. On the Pi, from this folder: `sh install.sh` (copies files, seeds DRY state, adds the cron line, runs the selftest). It warns if `requests`, `git` or `npm` is missing.
3. On `bestly.tech/admin/security`, Audit tokens card: paste the Vercel token and the Supabase Management token.
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

## Tuning

Edit the constants at the top of `security_audit.py`: `DEPLOY_WINDOW_HOURS` (26), `DUP_GUARD_HOURS` (6), `EXTRA_HOSTS`, `MAIL_DOMAINS`, `EXPECTED_SUPABASE`.
Selftest: `python3 selftest.py`.
