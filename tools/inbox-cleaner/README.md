# inbox-cleaner — daily iCloud inbox cleanup on bestly-pi

Replaces the Claude scheduled task **Daily iCloud Inbox Cleanup**
(`trig_01KsEa7kVMR2ERcvJQaNsmnR`, retired 2026-10-14). Stdlib Python only,
no paid AI, no Mac dependency.

**Owner:** Hermes (inbox). Every alert is signed by him.

## Where things live

| What | Path |
| --- | --- |
| Worker | `/opt/bestly/cron/jobs/inbox_cleaner.py` |
| Rules (edit this) | `/opt/bestly/cron/jobs/inbox_cleaner_rules.py` |
| Wrapper for `runjob.py` | `/opt/bestly/cron/jobs/inbox-cleaner.py` |
| State | `/opt/bestly/cron/state/inbox_cleaner.json` |
| Log | `/home/pi/scripts/cron-logs/inbox-cleaner.log` |
| Source of truth | `tools/inbox-cleaner/` in `bestlytech` |

Cron (pi user, Pi clock is America/Los_Angeles), inside the `# --- bestly-cron`
markers:

```
5 6 * * * /opt/bestly/cron/run.sh inbox-cleaner
```

## How it authenticates

The iCloud app-specific password is already in Vault as
`pi:bestly-mail-bridge:jaredbest@icloud.com` — the same credential the Pi's
`mail_bridge` job uses. The worker reads it through
`/opt/bestly/bin/security`, falls back to the `pi_secret_get` RPC, and finally
to an `ICLOUD_APP_PASSWORD` env var. It is never printed or written to disk.

## What it does

1. `UID SEARCH BEFORE <7 days ago>` on INBOX, headers only (`BODY.PEEK`).
2. Drops every message that is protected — by sender, by domain, or by topic
   keyword — before the sender is even considered.
3. Groups what is left by sender and classifies:
   - known marketing sender or generic job-alert blast → trash
   - heuristic score ≥ 0.80 → trash
   - score < 0.45 → leave alone
   - in between → one question to the free AI ladder (`freellm.py`), which
     answers KEEP when unsure. If the ladder is down, the sender is left alone.
4. Moves the trashable UIDs to the iCloud Trash, a sender at a time.
5. Queues the Hide My Email alias (or the unsubscribe link) behind each dead
   sender, so they can be switched off at the source.
6. Writes state, reports a one-line summary, pings Scout as Hermes.

### Hide My Email

Most promo senders reach this inbox through a per-sender alias, so the From
address arrives rewritten as `hello_at_craftdlondon_com_<id>@icloud.com`.
`unmask_relay()` recovers the real sender, which is what the rule lists match
against — and the alias itself goes in `alias_queue`. **Deactivating an alias
at icloud.com kills that sender permanently**, which beats unsubscribing. That
step needs a signed-in browser, so the Pi queues it and does not do it.

## Safety rails

- Messages are **moved to Trash**, never deleted. 30-day recovery. The worker
  has no `EXPUNGE` path at all.
- Nothing moves without an explicit per-sender UID list.
- Hard cap per run (`--max-move`, default 3000).
- **Starts in DRY mode.** It moves nothing until `state.json` says
  `"mode": "live"`.
- Unparseable senders are treated as protected.
- When the free AI is unreachable, borderline senders are kept, not trashed.

## Running it

```sh
/opt/bestly/cron/run.sh inbox-cleaner                       # as cron does
python3 /opt/bestly/cron/jobs/inbox_cleaner.py --dry        # show, move nothing
python3 /opt/bestly/cron/jobs/inbox_cleaner.py --live --max-move 500
python3 /opt/bestly/cron/jobs/inbox_cleaner.py --no-ai      # rules only
python3 selftest.py                                         # rules, no mailbox
```

## Watchdog

`run.sh` → `runjob.py` → `pi_job_report('inbox-cleaner', ok, summary, ms)`.
The `pi_jobs` row is already inserted (`max_gap_min` 1560 = 26 hours,
`replaced_claude_task` = the retired trigger id). `pg_cron`'s `pi-jobs-watch`
pushes to Scout once a day if no run lands inside that window — which fires
even if the Pi is off.

Enable it once the job is installed and has run:

```sql
update pi_jobs set enabled = true where job = 'inbox-cleaner';
```

## Tuning

Everything that decides a verdict is in `inbox_cleaner_rules.py`:
`PROTECTED_ADDRESSES`, `PROTECTED_DOMAINS`, `PROTECTED_KEYWORDS`,
`MARKETING_SENDERS`, `MARKETING_SUBJECT_HINTS`, `AUTO_KILL_SCORE`.
Per-sender exceptions can also go in `state.json` → `protected_additions`
without touching code.

Senders that mix account mail with promos (tesla.com, apple.com, chase.com,
doordash.com, robinhood.com, github.com, vercel.com, usps, the Blake) are
protected wholesale. That gives up some cleaning volume on purpose: a wrongly
kept email costs nothing, a wrongly trashed one costs trust.

## Measured on a real sample

Replayed against the top 45 senders in the inbox older than 7 days
(927 messages): **505 trashed, 85 sent to the free AI, 337 left alone**, with
every Apple/Tesla/Chase/USPS/Blake/GitHub/Vercel notice in the keep pile.
