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
2. **Match** - `settlement_unjudged_t` (up to 60 per run, soonest deadline first). Per settlement:
   - AI triage: search terms, plausibility, kind (breach / device / vehicle / service / ...), class period dates, one yes/no
     question, and a `fact_key` (+ a generic `fact_question`) for the underlying fact. Known facts (`settlement_facts_t`) are
     passed in so keys are reused; a fact Jared already answered settles the claim at once (yes -> ready, no -> skipped) via
     `settlement_judge2_t`, no search needed.
   - Evidence: his email by class-period dates **including body text** (`settlement_mail_search2_t`, 40 hits, falls back to
     all time), devices seen on his home network (`settlement_devices_t`), Turo vehicles (`settlement_vehicles_t`).
   - AI judge picks candidate labels; **code re-checks** the cited real rows (header names the company, date inside the class
     period, breach wording, device/vehicle name overlaps the class text) before accepting `proven`.
   - `proven`: a breach notice email from that company, a receipt/order/account email inside the class period, or an owned
     device/vehicle clearly inside the class. `likely`: transactional / breach-notice / device evidence not fully confirmed.
     `ask`: broad class, nothing proves it -> one yes/no (the fact is stored once and reused). `no`: clearly not him.
   - Evidence is built from the real rows (email subject + date, device name, vehicle), never from AI text.
   - `--rejudge-asks`: one-off pass over claims still at `ask` (`settlement_rejudge_list_t`) to give them fact keys and re-check
     proof. Note his mailbox in `bestly_mail` only goes back to 2026-04-09, so old purchases cannot be proven from email.
3. **Details + reasons** (`details_phase`, runs before the matcher and again for the claims judged just now; `--details-only` runs
   only this) - `settlement_needs_details_t` lists open settlements with no details or details older than 14 days (claims that are
   ask / ready / approved first, then the rest, 40 per run) plus live claims with no `reasoning` yet. For each: read the official
   site (the claim URL host; its FAQ / "who is included" page when linked; the page's meta description for JS-only sites; the
   listing text when the site is blocked, empty or has no readable robots.txt), politely (robots.txt incl. Crawl-delay, 4 s between
   requests, normal UA, a 401/403/challenge is never worked around, topclassactions.com HTML is never fetched), then the free AI
   ladder returns strict JSON that `clean_details` shapes into `settlements.details` (who_qualifies, class_period, locations,
   excluded, payout_no_proof, payout_with_proof, proof_examples, how_to_check, official_site, claim_form, fetched_at; plus
   `basis` = `site` or `listing`). URLs come from the fetched pages' own links, never from AI text. Then one `reasoning` per
   live claim (1-3 plain sentences; only evidence rows that really exist; a guard replaces a reply that invents records) and a
   sharper claim question with the specific dates / places (only while the claim is still waiting for his answer; the shared fact
   question is only reworded when one claim rests on the fact). The matcher then uses the details (class period, places, who is
   left out) in its triage prompt. A details failure is logged and counted in the summary, it never fails the run.
4. **Heartbeat** - `runjob.py` calls `pi_job_report` with the one-line summary, ok=false on any failure.

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
python3 /opt/bestly/cron/jobs/settlement_finder.py --rejudge-asks [--dry]   # re-judge claims waiting at ask
python3 /opt/bestly/cron/jobs/settlement_finder.py --details-only [--limit 40] [--dry] [--examples]   # details + reasons only
```
Install/update: copy this folder to the Pi and `sh install.sh`.
