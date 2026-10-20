# Hermes, the Mail Clerk (iPostal1 virtual mailbox)

Bestly, 5850 W 3rd St, Ste E PMB1012, Los Angeles, CA 90036. Built 2026-10-19 for Jared. Team card: **Hermes** (Mail Clerk, Mail Room dept).
The same employee also runs the iCloud inbox cleaner (`inbox-cleaner`, daily 6:05 AM).

## What happens to an iPostal1 email
1. `service@ipostal1.com` / `admin@ipostal1.com` mail arrives at jared@bestly.tech.
2. **`hermes_guard.py`** (systemd `bestly-hermes-guard`, polls every 15 seconds) copies it into the **Mailroom** folder, checks the copy is there, then removes it from the inbox. Jared should never see it.
   *This is the closest server-side option, not a true Sieve filter:* PrivateEmail's ManageSieve port (4190) resets every connection and its webmail filter screen needs Jared's password. If Jared sets a real filter in PrivateEmail webmail (Settings, Filters: From is service@ipostal1.com, move to Mailroom), the guard becomes a safety net and can stay.
3. **`hermes_mailroom.py`** (cron, every 5 minutes) reads Mailroom with BODY.PEEK, checks the sender (exact address plus DKIM pass for ipostal1.com), reads the envelope picture if there is one (free vision model), names and types the mail (bill, check, government, bank, legal, junk, package, other), files it in `hermes_items`.
4. Free AI only: FreeLLM router, then Groq, then Cloudflare. Rules in `hermes_rules.py` cover for a model that is down or fooled.

## Ask, never spend
Every paid iPostal1 step (open and scan, shred, forward, recycle, check deposit, package handling) is a `hermes_actions` row that starts `proposed`.
It becomes `approved` only inside `hermes_action_decide()` for a signed-in admin (Jared's Approve tap in Needs you). A trigger refuses every other path, including the Pi's service key.
The job only ever runs rows that are `approved`, re-checks them right before the browser opens, and never retries a paid action after a click may have happened.

## Notifications (all signed Hermes)
Push + Needs you only for money (checks, bills with an amount or due date), government or legal notices, a failed iPostal1 payment. Everything else is a silent success row that the evening recap groups as "Hermes: N done (...)". Ares alerts if iPostal1 reports a sign-in Hermes did not make.

## Login (Vault only)
Saved once at **/admin/security, "iPostal1 mailbox login"** (the "Add the iPostal1 login" row in Needs you links there). Vault name `pi:ipostal1_login` (JSON {email, password}). Hermes works from the alert emails alone until it is saved. Every sign-in is logged in `hermes_logins` and shown on the Team card.

## Safety
Mail text is data: fenced for the AI, validated against fixed lists, never turned into an action, URL, command or query. Links in emails are never followed; the only fetch an email can cause is an https picture on ipostal1.com (no cookies, no redirects). The browser worker stops on CAPTCHA, 2FA or any payment form, stays on ipostal1.com, and clicks only when the screen shows exactly one match.

## Files
`hermes_mailroom.py` (job), `hermes_rules.py` (parsing and rules), `hermes_guard.py` (service), `ipostal_browser.py` (Playwright worker, runs under /opt/bestly/turo-watch/.venv), `bestly-hermes-guard.service`, `selftest.py`, `install.sh`.
Database: `supabase/migrations/20261019190*_hermes_mailroom*.sql`. Watchdog: `hermes_watch()` (pg_cron every 5 minutes) plus the job restarting a stale guard.

## Test
`python3 hermes_mailroom.py --test-alert` drops a clearly marked test alert into Mailroom; the next run files it (test rows never push). `--dry` reads and classifies without writing.
