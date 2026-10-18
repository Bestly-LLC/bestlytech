# tools/trustpilot-reader

Review Reader (Maya's tool). Pi cron job `trustpilot_reviews`, every 15 minutes (`7-59/15`). Files real Trustpilot "new review" emails into `public.trustpilot_reviews`; the site, the email badge and the recap pick it up with no deploy.

- Reads the copy of jared@bestly.tech that `mail_bridge` already keeps in `bestly_mail`. No new IMAP login, no new credential.
- Before filing, re-checks that message's own headers over IMAP (`BODY.PEEK`, read-only): top `Authentication-Results` must show `dkim=pass` for trustpilot.com and `dmarc=pass`. Forged mail is flagged, never filed.
- `trustpilot_parse.py` reads stars, title, text, first name. Format drift: several star formats, labelled or not. No rating found means nothing is saved and one quiet warning is raised. The free-AI ladder may retry, but only text that is verbatim in the email (and a star number with evidence) is accepted.
- New review: one silent bell row signed Maya (`success` for 4-5 stars, `info` for 3 and under) via `trustpilot_ingest_review`. It does not go through `notify_route` on purpose (review words like "refund" would trip `interrupt_class`).
- Fixtures: `fixtures/` (a, b, c, d, e, f, i are SYNTHETIC, no real new-review email existed yet; g, h are real non-review Trustpilot mail from 2026-10-15). When the first real review email lands, add it as a fixture and fix the parser if it disagrees.
- Tests: `python3 selftest.py` (parser plus the whole job with Supabase and IMAP faked).
- Install on the Pi: `sh install.sh`. Heartbeat `pi_jobs.trustpilot_reviews` (2 h), card `review-reader` under Maya.
- Check one message's sender proof by hand: `python3 -c "import sys; sys.path.insert(0,'/opt/bestly/cron'); from jobs import trustpilot_reviews as j; print(j.main(['--check-auth','<message-id>']))"`
