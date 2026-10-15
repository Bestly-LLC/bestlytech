# settlement-mercury (Bank Watch, a tool of Nickel / Settlements Clerk)

Runs on `bestly-pi` every 2 hours at minute 7. Checks Jared's Mercury accounts for **deposits** and matches each one to a
settlement claim, so every claim shows the money that actually landed. Plain code, no AI, **read-only** (only `GET
/accounts` and `GET /account/<id>/transactions`; no transfer, payment, recipient or webhook call exists in the code).
Heartbeat: `pi_jobs` row `settlement-mercury` (gap 300 min, Scout alert). Team card: `settlement-mercury` ("Bank Watch").

## Flow
1. Pull the last 14 days of transactions from every Mercury account (`--backfill` = 365 days).
2. Keep credits only: amount > 0, status `sent`, not an internal transfer between his own Mercury accounts.
3. `settlement_mercury_ingest_t(p_token, p_txns)` (migration `20261011011000_settlements_mercury.sql`):
   - skips transactions already seen (`txn_id = 'mercury:<id>'`);
   - matches ONE open claim (filed / approved / filing / needs_you, or paid with no amount) when the settlement
     administrator, the settlement name, or an administrator from `settlement_admins` appears in counterparty or
     description (word boundaries, so "Rust" does not match "trust"); the defendant alone counts only with a
     settlement/class action hint, so App Store proceeds from Apple never match an Apple settlement;
   - PayPal / Venmo / Zelle / Cash App deposits match only when the amount equals one claim's known `amount_cents`;
   - match = ledger row in `settlement_payments`, claim `amount_cents` filled if empty, claim marked `paid`
     (`paid_source = 'mercury'`, `paid_ref = mercury:<id>`), and a "Money in $X" alert signed Nickel;
   - settlement-looking credits it cannot place go to `settlement_unmatched_bank` (pick the claim with
     `settlement_bank_unmatched_resolve`). Anything from Turo / Stripe / Mercury is never parked.
   - returns `{matched, unmatched, skipped, newly_paid}`.
4. Ledger for the page: `settlement_payments_list()` (admin) = `[{claim_id, source, amount_cents, posted_at, counterparty, txn_id}]`.
   Mail / email / button payments land there too (trigger on `settlement_claims`); once Mercury shows the real deposit for
   a claim, those earlier guesses are hidden so money is not counted twice.

## Auth
- Mercury: `MERCURY_API_TOKEN` in `/home/pi/scripts/.env`, or the token saved on /admin/cost-cutter (write-only field, Vault `pi:mercury_api_token`, fetched with `mercury_token_t`). Read-only API token; the same key Penny's `penny_bank` job reads.
  Never printed, logged or committed. Missing token = run reports `ok no Mercury token yet` and does nothing.
- Supabase: the house db-watchdog token in `/home/pi/.bestly/db_watchdog_token` (mode 600) + publishable key.

## Run by hand (on the Pi)
```
/opt/bestly/cron/run.sh settlement-mercury                         # real run, log: /home/pi/scripts/cron-logs/settlement-mercury.log
python3 /opt/bestly/cron/jobs/settlement_mercury.py --dry          # fetch + count, send nothing
python3 /opt/bestly/cron/jobs/settlement_mercury.py --backfill     # 365 days, once
```
Install/update: copy this folder to the Pi and `sh install.sh` (idempotent crontab line `7 */2 * * *`).

## 2026-10-15: token lookup and IPv4

- Token order is now `.env` `MERCURY_API_TOKEN`, then Vault `pi:mercury_api_token` through the service-role `pi_secret_get` (the path mercury-sync uses), then `mercury_token_t`. Until this change the Pi run reported "no Mercury token yet" in about 1 ms, which matches the db-watchdog token file being unreadable (reproduced offline, not confirmed on the Pi). The message now names the reason.
- Mercury calls run inside `force_ipv4()`: Mercury allowlists the token by source address and the Pi is dual-stack, so without it requests leave over IPv6. Same fix as mercury-sync.
- Install: copy `settlement_mercury.py` to `/opt/bestly/cron/jobs/` on the Pi (back up the old one first), `python3 -m py_compile` it, then `python3 /opt/bestly/cron/jobs/settlement_mercury.py --dry`.
- Note: `settlement_mercury_ingest_t` still authenticates with the db-watchdog token file. If the dry run works but live ingest fails with FileNotFoundError, that file is the thing to fix.
