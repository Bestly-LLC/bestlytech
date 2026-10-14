# mercury-sync — weekly Mercury customers → Nextcloud contacts on bestly-pi

Replaces the Claude scheduled task **Mercury nextcloud sync**
(`trig_012PN2BMkaL5eN1z4MhAPucf`, Mondays 8:00 AM PT). Stdlib Python only,
no AI at all, no Mac dependency.

**Owner:** Rolo (contacts). Every alert is signed by him.

## Where things live

| What | Path |
| --- | --- |
| Worker | `/opt/bestly/cron/jobs/mercury_sync.py` |
| Wrapper for `runjob.py` | `/opt/bestly/cron/jobs/mercury-sync.py` |
| State | `/opt/bestly/cron/state/mercury_sync.json` |
| Log | `/home/pi/scripts/cron-logs/mercury-sync.log` |
| Source of truth | `tools/mercury-sync/` in `bestlytech` |
| DB side | `supabase/migrations/20261014130000_mercury_sync_pi_job.sql` |

Cron (pi user, Pi clock is America/Los_Angeles), inside the `# --- bestly-cron`
markers:

```
0 8 * * 1 /opt/bestly/cron/run.sh mercury-sync
```

## How it authenticates

Nothing is stored on the Pi's disk and nothing is printed.

- **Mercury:** the read-only token the Penny and Bank Watch jobs already use.
  Looked up in this order: `MERCURY_API_TOKEN` in `/home/pi/scripts/.env`,
  Vault `pi:mercury_api_token` through the `pi_secret_get` RPC, then
  `mercury_token_t` with the db-watchdog token. Same precedent as
  `tools/settlement-mercury/`.
- **Nextcloud:** the shared Vault entries `nextcloud_user`,
  `nextcloud_app_password` and `nextcloud_base_url`, read through the
  `pi_secret` RPC (they are on its allowlist, exactly how `reminders_sync`
  reads them). If someone later adds `pi:nextcloud:user` /
  `pi:nextcloud:app_password`, the `/opt/bestly/bin/security` shim is tried as
  a fallback. No Vault copy was needed.

## What it does

1. `GET https://api.mercury.com/api/v1/ar/customers` (1000 a page, follows
   `start_after`) with the read-only token. GET is the only Mercury verb in the file.
2. `REPORT` on the Nextcloud address book
   (`/remote.php/dav/addressbooks/users/<user>/contacts/`) and collect every
   `EMAIL` on every card, lowercased.
3. For each Mercury customer with a usable email that is not in that set,
   `PUT` a new vCard 3.0 to `.../contacts/<uuid>.vcf`:
   `FN`, `N`, `EMAIL;TYPE=WORK`, `NOTE:Synced from Mercury Invoicing`,
   `CATEGORIES:Mercury Customer`. People get `N` split into family and given
   name; companies and one-word names go whole into the family slot.
4. Writes state, reports a one-line summary, pings Scout as Rolo.

Summary line looks like:
`created 3, 41 already in Nextcloud, 1 no usable email (of 45 Mercury customers)`

## Safety rails

- **Create only.** Every `PUT` sends `If-None-Match: *`, so Nextcloud answers
  412 instead of overwriting. There is no update, delete or `PROPPATCH` code.
- The duplicate-email check is the last statement before every `PUT`, and a 412
  adds the email to the known set.
- If the address book cannot be read (login rejected, book missing, bad XML),
  the run fails and creates nothing. A book with 5+ cards but zero readable
  emails is treated as a parser failure and refused.
- Hard cap per run (`--max-create`, default 200); the rest waits for next week.
- Five failed creates in a row stops the run.
- Customer names are stripped of control characters and escaped, so a name
  cannot inject extra vCard lines or a second card.
- Redirects are never followed (the Authorization header would ride along).
- **Starts in DRY mode.** It creates nothing until `state.json` says
  `"mode": "live"`. Dry still reads Mercury and Nextcloud, so it shows exactly
  what a live run would do.
- State keeps counts and Mercury customer ids only, never names or emails.

## `skip:` is a clear answer, not a crash

The Mercury token is IP-allowlisted and its invoicing scope has not been
proven (see below). When Mercury refuses, the job returns one line and creates
nothing:

- `skip: Mercury token lacks invoicing scope or was rejected (HTTP 401/403)`
- `skip: Mercury token is not allowed from this IP (add the Pi's address ...)`
- `skip: Mercury has no /ar/customers endpoint for this token (HTTP 404)`
- `skip: no Mercury token in Vault ...` / `skip: no Nextcloud login ...`

A live run that skips also posts a warning to the bell, so a quiet week is
never a silent one.

## Running it

```sh
/opt/bestly/cron/run.sh mercury-sync                          # as cron does
python3 /opt/bestly/cron/jobs/mercury_sync.py --dry           # show, create nothing
python3 /opt/bestly/cron/jobs/mercury_sync.py --live --max-create 20
python3 selftest.py                                           # vCards, matching, caps; no network
```

## Watchdog

`run.sh` → `runjob.py` → `pi_job_report('mercury-sync', ok, summary, ms)`.
The `pi_jobs` row is already inserted (`enabled` false, `max_gap_min` 10200 =
a week plus slack, `replaced_claude_task` = the retired trigger id). The team
card is **Rolo** (`rolo`, reports to Scout, pulse `pi_job` / `mercury-sync`).

Enable it once the job is installed and a real run has reported ok:

```sql
update pi_jobs set enabled = true where job = 'mercury-sync';
```

## Not verified yet

- Whether the read-only token can list invoicing customers. From the cloud it
  answers `ipNotWhitelisted`, so only the Pi can prove it. The first dry run
  on the Pi settles it.
- The `/ar/customers` path (taken from Mercury's accounts-receivable API; the
  docs pages could not be fetched here).
- The CardDAV `REPORT` body against the live server. A second, plainer body is
  tried automatically if the first is refused.
