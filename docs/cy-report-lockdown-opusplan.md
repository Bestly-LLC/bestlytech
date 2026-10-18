# cy_report_site_issue lockdown (opusplan, 2026-10-17)

Pi migration list, item d. Same shape as ltx_report (`20261017120000_ltx_report_keyed.sql`, then
`20261018001232_ltx_report_revoke_anon.sql`): add a keyed twin, move every caller to it, watch, then revoke anon on
the old one. The difference: ltx had one caller we control (a Lambda). This one has shipped extensions on users'
machines, so the dual run is long and the old function stays open until they update.

Plan: Opus (this file). Build: Sonnet. Owner of the alerts: Cookie Yeti (`bestly_raise(..., 'cookie-yeti', ...)`).

## Why it matters

`cy_report_site_issue(p_domain, p_reason, p_version, p_platform)` is SECURITY DEFINER and callable with the
publishable key. 3 reports for one domain in 7 days switch Cookie Yeti off on that site **for every user** for 14 days
(doubling, max 180). The only limit is 60 reports per domain per hour. So anyone with curl can switch Cookie Yeti off
on any big site in three requests. Today it is on the public allowlist (`security_public_rpcs`), so Ares's
Auto-Fixer leaves it alone.

## Every caller (checked 2026-10-17)

| Caller | How it calls today | Version |
|---|---|---|
| Chrome MV3 extension, `chrome-extension/cy-failsafe.js` line 222 | `POST /rest/v1/rpc/cy_report_site_issue`, header `apikey: sb_publishable_...`, body `{p_domain, p_reason, p_version, p_platform}` | manifest 1.2.5 |
| Safari Web Extension (Mac + iOS), `safari/Cookie Yeti/Cookie Yeti Extension/Resources/cy-failsafe.js` line 222 | same file, same call | manifest 1.2.5 |
| bestly.tech site, edge functions, Pi, Mac | none (only `src/integrations/supabase/types.ts` and the security-audit SQL mention it) | |
| iOS VPN shield (`ios-vpn/CookieYetiShield`) | none | |

Source: GitHub `fungus-amungus/cookie-yeti-unified` main (`a7bf741`, 2026-09-26) plus `docs/cookie-yeti-extension/`
here. **The Mac checkout `~/Developer/cookie-yeti-unified` may be ahead of GitHub**; the release chat checks it first.

Live traffic: 36 rows in `cy_site_guard_reports`, 2026-09-29 to 2026-10-17, **all `1.2.5` / `safari`**. No Chrome
reports yet (either the Chrome build with the guard is not live or no Chrome user has tripped it). `cy_site_guard` has
0 learned rows, so nothing is switched off for users right now.

The extension sends its version in `p_version` on every report. That is how we watch the dual run: new builds send
the new version through the twin, old builds keep sending `1.2.5` through the old function.

## Steps

### 1. Keyed twin, additive (DONE 2026-10-18, migration `20261018004751_cy_report_site_issue_keyed.sql`)

* Table `cy_report_keys(key_hash, label, active, created_at, retired_at)`: one sha256 per extension release, RLS on,
  no grants to anon or authenticated.
* `cy_report_site_issue_k(p_key, p_domain, p_reason, p_version, p_platform)`: key must be 32 to 200 chars and match an
  active hash, or it returns `{ok:false, error:'bad key'}` and writes nothing. Otherwise it runs the unchanged
  `cy_report_site_issue`.
* Allowlisted in `security_public_rpcs` (the extension has no sign-in).
* No key row exists yet, so the twin refuses every call. Live users are unaffected.
* Tested as `anon`: no key, short key, wrong key, retired key all returned `bad key`; 4 bad calls plus 1 good call wrote
  exactly 1 row. Anon cannot read `cy_report_keys`.

### 2. Server-side poisoning guard (optional, no release needed; Jared decides)

The key in step 3 ships inside the extension, so anyone who unzips it has it (see Limits). What actually stops a
3-request takedown is counting **distinct reporters**, not reports:

* Add `reporter_hash text` to `cy_site_guard_reports`. In the twin, hash the caller's IP with a server salt:
  `current_setting('request.headers', true)::json->>'x-forwarded-for'` (first hop) + salt from Vault, sha256, keep 16
  hex chars. Never store the IP.
* Switch-off rule becomes: 3 reports from **at least 3 distinct `reporter_hash`** in 7 days. Old-function reports
  (null hash) count as one reporter between them.
* Trade-off: Jared alone tripping a site 3 times would no longer switch it off for everyone. That is the point.
* Privacy map: the hash is not an email or phone, so no `privacy_data_map` row is required; mention it in the privacy
  policy's Cookie Yeti analytics section anyway.

### 3. Release (Mac-linked chat, needs the Cookie Yeti source and store accounts)

1. Generate the key in the Mac-linked chat (`openssl rand -hex 32`), never print it to chat. Store the plaintext in
   Vault as `cy_report_key_v1` (via `home_hub_vault_put` or the Vault UI), and insert only
   `encode(digest(key,'sha256'),'hex')` into `cy_report_keys` with label `ext-1.2.6`.
2. In both copies of `cy-failsafe.js`: `SITE_ISSUE_ENDPOINT` -> `/rest/v1/rpc/cy_report_site_issue_k`, add
   `var REPORT_KEY = "...";` and send `p_key: REPORT_KEY` in `reportSite`. Keep `docs/cookie-yeti-extension/cy-failsafe.js`
   here in sync (with a placeholder, not the key).
3. Bump to 1.2.6 (both manifests, Safari `MARKETING_VERSION`). Ship Chrome Web Store + App Store (Mac and iOS).
4. Smoke: trip the scroll guard on a test page with the new build; confirm a `1.2.6` row lands.

**Status 2026-10-17 (6:10 PM PT): built and tested, NOT shipped.**

* Key: generated on the Mac, never printed. Vault `cy_report_key_v1`; `cy_report_keys` row `ext-1.2.6`
  (sha256 `e1cd91b9ca1d…`), hashed inside the database from the Vault copy, so the two cannot drift.
* Code: cookie-yeti-unified `66020d1` on GitHub main. Both `cy-failsafe.js` copies byte-identical, key embedded;
  docs copy here keeps `__CY_REPORT_KEY__`.
* Version: 1.2.6 / build 114. The real Safari version lives in three Info.plists
  (`Cookie Yeti (iOS)`, `Cookie Yeti (macOS)`, `Cookie Yeti Extension`); the old `Cookie Yeti.xcodeproj`
  `MARKETING_VERSION` was a stale 1.2.3 and is now 1.2.6 too. The release project is `Cookie Yeti Unified.xcodeproj`.
* Builds on the Mac: `chrome-extension/Cookie-Yeti-Chrome-Store-v1.2.6.zip`; archives
  `~/cy-ship/1.2.6/mac.xcarchive` and `ios.xcarchive` (archive only, `~/cy-ship/1.2.6/build.sh`). Each was checked
  for 1.2.6 (114) and the embedded key hash.
* Smoke: `~/cy-ship/1.2.6/test-report.js` loads the shipped Chrome zip unpacked, trips the scroll guard on a routed
  test page, and lets only the keyed RPC reach Supabase. Page restored, site paused, `{"ok": true, "site_off": false}`,
  and a `1.2.6 / chrome / scroll_jump` row landed. That test row was then removed so step 4 counts only real users.
  Safari cannot be driven by Playwright; its file is byte-identical to the tested one.
* Left to do: export + upload both archives, submit Mac + iOS for review, upload the Chrome zip and submit.

### 4. Dual run, then revoke (cloud chat, weeks later)

* Watchdog, owned by Cookie Yeti, pg_cron weekly, `cy_report_dualrun_watch()`:
  - `info` while old-version reports still arrive (count by version, last 30 days).
  - raise `success` "ready to lock" once there are **0 reports with version < 1.2.6 for 30 days AND at least 5
    reports from >= 1.2.6**.
  - raise `warning` if 1.2.6+ installs exist (store stats or `product_events`) but no 1.2.6 report has landed in
    30 days: the key or endpoint is broken and reports are being dropped.
* When ready: new migration, wrapped as usual:
  `revoke execute on function public.cy_report_site_issue(text,text,text,text) from public, anon;`
  `do $$ begin delete from public.security_public_rpcs where fn = 'cy_report_site_issue'; end $$;`
  Keep `authenticated` only if a signed-in admin page needs it (none found); otherwise revoke it too.
* Users who never update lose site reports only. Their local 3-day pause and the 12-hour off-list pull
  (`cy_site_guard_list`) keep working.

## Limits (be honest about these)

* The release key is **not a secret**: it ships in the extension bundle. It buys rotation (retire `ext-1.2.6`, ship a
  new key) and a clean cut-off for old builds, not authentication. Step 2 is the real abuse guard.
* `cy_site_guard_list` stays public on purpose (read-only, returns domains only).

## Leftover from the step 1 test (DONE 2026-10-17, run from the Mac with `supabase db query --linked`)

The connector cancelled the cleanup three times; the Mac's linked Supabase CLI ran it fine. Kept for the record:

```sql
do $$ begin
  delete from public.cy_site_guard_reports where domain = 'cy-k-selftest.invalid';
  delete from public.cy_report_keys where label = 'selftest-2026-10-18';
end $$;
```

## Undo

* Step 1: `drop function if exists public.cy_report_site_issue_k(text,text,text,text,text);`
  `drop table if exists public.cy_report_keys;`
  `do $$ begin delete from public.security_public_rpcs where fn = 'cy_report_site_issue_k'; end $$;`
* Step 4: `grant execute on function public.cy_report_site_issue(text,text,text,text) to anon, authenticated;`
  and re-insert its `security_public_rpcs` row.
