# settlement-finder (Nickel, Settlements Clerk)

Daily FINDER + MATCHER that runs on `bestly-pi` at 7:20 AM PT. Owner: Nickel (`settlements`). Heartbeat: `pi_jobs` row
`settlement-finder` (gap 1560 min; if it does not succeed for 26 hours the pi_jobs gap alert fires).

**Read-only by design.** It never files or submits a claim, never fills a form, never solves a CAPTCHA, never emails anyone.
It reads public listing pages and his email *search RPC* (sender/subject only) and writes verdicts. Free AI only
(`/opt/bestly/cron/freellm.py`: FreeLLM, then Gemini, Groq, Cloudflare).

## What it does
1. **Find** - `classaction.org/settlements` (HTML cards) and the public RSS feed of Top Class Actions' open-settlements
   category (their HTML page sits behind a Cloudflare challenge, which is not bypassed). Obeys robots.txt, one request per
   source, 4 s apart, normal User-Agent, retries with backoff. Keeps only rows with a claim deadline today or later.
   `settlement_upsert_t` with stable keys `ca:<slug>` / `tca:<slug>`. Rows whose deadline has passed are marked `closed`.
2. **Match** - `settlement_unjudged_t` (up to 40 per run, soonest deadline first). Per settlement: AI triage (search terms,
   plausibility, one yes/no question) -> `settlement_mail_search_t` -> AI judge -> `settlement_judge_t`.
   - `proven`: a receipt/order/account/statement email, inside the class period (evidence = the real email subject + date)
   - `likely`: transactional emails that strongly suggest it
   - `ask`: broad class, nothing in email proves it -> one short yes/no question
   - `no`: clearly not him (other state, business-only, narrow product with no email trace)
   Evidence is built from the real email rows, never from AI text. Unsure between proven and ask -> ask.
3. **Heartbeat** - `runjob.py` calls `pi_job_report` with the one-line summary, ok=false on any failure.

## Self-heal
`flock` in `run.sh` plus an in-process lock; HTTP retries with backoff; one source failing never kills the run (3 days in a
row -> silent Scout bell signed Nickel); zero rows parsed counts as a failure (layout change); if every free model fails the
settlements stay unjudged for tomorrow and the run reports failed when nothing could be judged.

## Auth
`p_token` = the house db-watchdog token (checked by `db_watchdog_ok`), read from `/home/pi/.bestly/db_watchdog_token`
(mode 600, never printed or committed), sent with the project's publishable key. State: `/opt/bestly/cron/state/settlement_finder.json`.

## Run by hand (on the Pi)
```
/opt/bestly/cron/run.sh settlement-finder            # real run, logs to /home/pi/scripts/cron-logs/settlement-finder.log
python3 /opt/bestly/cron/jobs/settlement_finder.py --dry        # fetch + judge, write nothing
python3 /opt/bestly/cron/jobs/settlement_finder.py --find-only | --match-only | --limit 5
```
Install/update: copy this folder to the Pi and `sh install.sh`.
