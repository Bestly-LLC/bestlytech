# insurance-filer (Insurance Filer, a tool of Claims Closer)

When a Turo guest's own auto insurance is in play, Claims Closer files and chases the insurance claim itself. Jared only taps. This
folder is the **Mac mini** half: it fills the insurer's online claim form, and sends the follow-up emails Jared approved. Team card
`insurance-filer` (tool of `claims-closer`, alerts carry the `claims.` prefix so they are signed Claims Closer). launchd
`tech.bestly.insurance-filer`, `RunAtLoad` + every 300 s. Worker lives in `~/bestly-agents/insurance-filer/`. Log: `~/logs/insurance-filer.log`.

The brains live elsewhere: Postgres (`supabase/migrations/20261029140000_insurance_filer.sql`: cases, packet, approvals, mail matching,
nudge and call clocks, watchdog), the `insurance-filer` edge function (free-AI drafting, private photo bucket `insurance-photos`, signed
URLs), and the Pi Turo reader v1.4.0 (photo download). This tool has no AI and holds no secrets beyond the house watchdog token in the
Keychain item `bestly-db-watchdog`.

## The safety model
- Jobs come only from `ins_mac_take`. A `submit` or `send_mail` job is handed out **only after Jared tapped that exact approval**.
- The form walker has three modes. `dry`: never consents, never submits. `fill`: never submits. `submit`: runs only after the tap, and
  re-checks the packet hash right before the single click (changed facts -> it refuses, tells the database `not_sent`, and the case
  fills again for a new tap).
- Never solves or bypasses a CAPTCHA or bot check (stops, reports `blocked`, Jared finishes by hand with every answer ready).
- Never invents an answer: a question is answered only when a rule in `rules.py` ties it to a fact in the packet. Unknown fields are
  left blank and listed on the approval page.
- A submit or email whose outcome is unknown is **never retried**; the database tells Jared to check.
- The consent click (`consent_before_tap`, default on): the insurer's wizard shows "I Agree and Continue" (arbitration clause and consent
  to texts) before any later screen. The fill pass clicks it so it can reach the review screen; the approval page shows the exact consent
  text. Turn it off (`update ins_settings set consent_before_tap = false`) and the fill stops at that screen instead.

## Files
| file | what |
|---|---|
| `filer.py` | the run: lock, take jobs, watchdog per job, heartbeat. Also `--dry-case`, `--selftest` |
| `walker.py` | label-driven form walker (Playwright). Modes dry / fill / submit |
| `rules.py` | question and field -> packet fact. Pure Python, unit-tested |
| `send-bestly-multi.applescript` | sends from `jared@bestly.tech` with the `Bestly` signature and many attachments |
| `verify-sent.applescript` | confirms the message really is in Sent |
| `fetch-attachments.applescript` | saves an email's attachments (the Snapsheet estimate) |
| `tests/selftest.py`, `tests/fixtures/` | stand-in portal + saved copies of Progressive's first two screens |
| `tests/build_packet.mjs` | builds a case's packet offline (PGlite) from read-only copies of live rows |

## Test it (nothing real is filed)
```
cd ~/bestly-agents/insurance-filer
venv/bin/python filer.py --selftest                                   # stand-in portal: every mode, CAPTCHA, unknown question, stale hash, photos
venv/bin/python filer.py --dry-case <claim_cases id>                  # REHEARSAL on the live insurer page. Cannot consent. Cannot submit. Writes nothing.
venv/bin/python filer.py --dry-case <id> --packet cody.json --url file:///.../standin.html   # saved packet + stand-in page
```
Rehearsals set `INS_BASE=/tmp/ins_rehearsal` to keep screenshots and logs out of the install folder.

## Install (rollout step 3; not done by the build)
`sh install.sh` on the Mac mini. Mail.app must be running, signed in to `jared@bestly.tech`, with the `Bestly` signature; allow Automation
for the launchd python once (System Settings, Privacy, Automation).

## Not verified yet
Only Progressive's first two screens were seen live (safety question; name + phone + consent). Everything after is handled by rules and
tested on the stand-in. The first real fill may stop with "the form asked X and I have no answer"; that is the design, and the approval
page then hands Jared every answer to type in. Add the rule to `rules.py` and the next case flies.
