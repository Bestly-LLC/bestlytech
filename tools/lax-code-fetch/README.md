# Parker — LAX garage code fetcher (Pi)

Gets the monthly Park My Share lobby QR by itself so guests and Apple Wallet passes always have the active code.

- **Job:** `lax_code_fetch.py` → `/opt/bestly/cron/jobs/`, cron `*/30 * * * * /opt/bestly/cron/run.sh lax_code_fetch`
- **Fallback:** `browser.py` → `/opt/bestly/parkmyshare/`, run with `/opt/bestly/turo-watch/.venv/bin/python` (Playwright)
- **Install / update (on the Pi):** `sh install.sh` from this folder
- **DB:** `supabase/migrations/20261013200000_lax_code_fetch.sql` (`lax_fetch_*`, team card `lax-code-fetch`, alerts `lax.code.*`)
- **Login:** saved on Turo Watch → Settings → Park My Share (write-only Vault `pi:parkmyshare:email|password`)
- **Tests:** `python3 -m unittest test_lax_code_fetch -v` (offline)

How it decides: `lax_fetch_gate()` says when a check is due (code missing, once a day, month end, or Check now). It saves only a code
Park My Share marks `active` with an expiration still ahead, then confirms guests see it (`lax_fetch_save` → `lax_pass_current_row`).

Park My Share API (from app.parkmycarshare.com's own bundle, 2026-10-13): base `https://iq.parkimo.com/`, `POST user/login {email,password}`
→ `accessToken` (sent as header `X-AccessToken`), `GET parkingfacility/active` (garages with `supportQRCodes`),
`GET twofactorauthcode?companyId=&facilityId=` → `[{barcode, status: active|expiring, expirationDate}]`. Read only: never calls create/expire.
