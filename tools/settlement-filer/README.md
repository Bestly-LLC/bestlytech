# settlement-filer (Claim Filer, Nickel's tool)

Files the class action claims Jared approved. Runs on the **Mac mini** (launchd `tech.bestly.settlement-filer`, `RunAtLoad` + every
1800 s). Team card `settlement-filer` (tool of `settlements`, alert prefix `settle.filer.`). Worker lives in
`~/bestly-agents/settlement-filer/` (`filer.py`, `venv/`, `receipts/<claim id>/`). Log: `~/logs/settlement-filer.log`.

## The rule that matters
A claim form is a sworn statement. The filer **only** works claims in status `approved` (Jared tapped Yes), handed out one at a
time by `settlement_take_approved_t`, and ticks the form's attestation box only for those. It also refuses to run until Jared has
confirmed his claim details on the Settlements page (`settlement_profile.confirmed_at`) and street/city/state/zip are filled in
(the run just checks in with "waiting for claim details").

## What a run does
1. Take the lock (`run.lock`), read `settlement_profile_t`. Not confirmed/complete -> heartbeat "waiting for claim details", exit.
2. Prove Chromium launches (reinstalls Playwright/Chromium once if missing and says so in the heartbeat).
3. Up to 3 times: `settlement_take_approved_t(token, 1)` -> open `claim_url` in headless Chromium -> find the form (follows a
   "File a Claim" link, or an iframe) -> map fields -> fill -> pick the payout -> tick attestation -> full-page screenshot ->
   submit -> read the confirmation page -> `settlement_filed_t(... ok=true, confirmation, payout)`.
4. Anything it must not guess -> `settlement_filed_t(... ok=false, claim_url, one plain sentence)` = status `needs_you`:
   Class Member / Notice / Claim ID or code, document upload, login/account, CAPTCHA or bot wall, bank/card/SSN/ID fields,
   a question that is not in his saved details, a payout form with no PayPal/Venmo/check option, a claim period that is over,
   a rejected form, a submit it could not confirm (then "check your email for a receipt").
5. Heartbeat `settlement_filer_beat_t` -> `agent_beat('settlement-filer')` every run (ok=false on a crash or hang). The card's
   pulse gap is 90 min, so three silent runs alert Scout.

## How fields get their values
Deterministic label rules first (name, email, phone, street, unit, city, state, ZIP, country, PayPal email, Venmo handle).
Only *required* fields the rules do not know go to the free AI (FreeLLM via the Pi, ssh tunnel on localhost:13001, key from the
Pi's `pi_secret`), which sees labels and the class definition only - never his data - and may answer only "this profile field",
"yes, class member" (code-checked against a keyword filter), "attestation box", "terms box" or "none". Values are typed by the
code from the profile. Free text is never invented. Optional unknown fields are left blank.

Payout: PayPal (needs `paypal_email`) or Venmo (needs `venmo_handle`) per `payout_pref`, else paper check; never ACH,
direct deposit, e-check, Zelle, prepaid card or anything with a bank number.

## Self-heal
Run lock (a second run skips), 14-minute run guard, 3-minute cooperative deadline per claim plus a watchdog thread at 215 s that
marks the claim needs_you, reports `ok=false`, kills Chromium and exits. Anything stuck in `filing` is re-released by the RPC
after 2 hours. Leftover headless Chromium from a killed run is cleaned at the start of each run.

## Test it (nothing real is filed)
```
cd ~/bestly-agents/settlement-filer
venv/bin/python filer.py --dry https://httpbin.org/forms/post   # fills with a DEMO profile, screenshots, never submits, never calls Supabase
venv/bin/python filer.py --selftest                              # fake claim site on 127.0.0.1: filed / ID / CAPTCHA / upload / unknown-field cases
venv/bin/python filer.py                                         # real run (reports "waiting for claim details" until Jared confirms)
```

## Install / update
Copy this folder to the Mac mini and run `sh install.sh`. Auth is the house watchdog token from the Keychain item
`bestly-db-watchdog` (never printed or committed). No secrets are in this folder.

## Not done / limits
- Receipts (screenshots + `receipt.json`, which holds field labels and value *sources*, not values) stay local on the Mac mini.
- Multi-page wizards with a review step are handled up to 9 steps; anything odd ends in needs_you rather than a guess.
- Sites that insist on a CAPTCHA, a code from the notice, or a document are Jared's, by design.
