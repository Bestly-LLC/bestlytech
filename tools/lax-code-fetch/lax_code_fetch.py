"""Parker, the Parking Pass Clerk: gets the LAX garage QR from Park My Share by itself (bestly-pi, free, no AI).

Installed as /opt/bestly/cron/jobs/lax_code_fetch.py; cron: */30 * * * * /opt/bestly/cron/run.sh lax_code_fetch
Repo copy: tools/lax-code-fetch/ in bestlytech. DB side: supabase/migrations/20261013200000_lax_code_fetch.sql.

Each run asks lax_fetch_gate() whether a check is due (code missing, daily check, month end, or "Check now"). Most runs
end there with no network at all. When one is due:
  1. Signs in to the Park My Share API (iq.parkimo.com, the API app.parkmycarshare.com itself uses) with the login saved
     on Turo Watch > Settings (Vault pi:parkmyshare:*, read through pi_secret_get).
  2. Lists the host QR codes for the garage (twofactorauthcode) and keeps only one Park My Share marks ACTIVE whose
     expiration is still ahead. An "expiring" or expired code is never sent to guests.
  3. Saves it with lax_fetch_save(), which also refreshes saved Wallet passes, then confirms guests are shown that code.

Self-heal: a fresh sign-in every run; timeouts and 5xx retried 3 times with backoff; if the API answers in a shape this
code doesn't know, it falls back to a headless browser (browser.py) that signs in to the portal and reads the codes the
page loads. Failures are reported to lax_fetch_report(), which alerts (signed by Parker) only after 3 misses in a row,
or right away when Park My Share rejects the login, the one thing only Jared can fix.

The code itself is never printed or logged (only its last 2 characters). Flags: --dry (read only), --force (ignore the gate).
"""
import datetime
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

import lib

JOB = "lax_code_fetch"
API = "https://iq.parkimo.com/"
PORTAL = "https://app.parkmycarshare.com/"
BROWSER = ["/opt/bestly/turo-watch/.venv/bin/python", "/opt/bestly/parkmyshare/browser.py"]
UTC = datetime.timezone.utc
LA = ZoneInfo("America/Los_Angeles")
HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": PORTAL.rstrip("/"),
    "Referer": PORTAL,
    "User-Agent": "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
}
LAX_HINT = re.compile(r"\b(lax|los angeles|airport|century|inglewood|westchester|el segundo)\b", re.I)


class AuthError(Exception):
    """Park My Share said the email or password is wrong (only Jared can fix)."""


class Transient(Exception):
    """Network trouble or a 5xx: worth retrying."""


class Shape(Exception):
    """The API answered, but not in a shape this code knows: try the browser."""


# ---------------------------------------------------------------- small helpers

def mask(code):
    code = str(code or "")
    return "…" + code[-2:] if len(code) > 2 else "…"


def parse_when(v):
    """ISO strings or ServiceStack's /Date(1700000000000-0000)/ -> aware UTC datetime (or None)."""
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return datetime.datetime.fromtimestamp(v / 1000 if v > 1e11 else v, UTC)
    s = str(v).strip()
    m = re.match(r"^/Date\((-?\d+)([+-]\d{4})?\)/$", s)
    if m:
        return datetime.datetime.fromtimestamp(int(m.group(1)) / 1000, UTC)
    try:
        d = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=UTC)
    except ValueError:
        return None


def call(method, path, token=None, body=None, timeout=25):
    h = dict(HEADERS)
    if token:
        h["X-AccessToken"] = token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path.lstrip("/"), data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            status = r.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        status = e.code
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        raise Transient(f"{method} {path}: {e}") from e
    if status >= 500 or status == 429:
        raise Transient(f"{method} {path}: HTTP {status}")
    try:
        j = json.loads(raw) if raw.strip() else None
    except ValueError:
        if status < 400:
            raise Shape(f"{method} {path}: not JSON (HTTP {status})")
        j = None
    return status, j


def as_list(j, *keys):
    if isinstance(j, list):
        return j
    if isinstance(j, dict):
        for k in keys + ("results", "items", "data", "result"):
            if isinstance(j.get(k), list):
                return j[k]
    return None


# ---------------------------------------------------------------- the API path

def api_codes(email, password):
    st, j = call("POST", "user/login", body={"email": email, "password": password})
    if st in (400, 401, 403):
        msg = ((j or {}).get("responseStatus") or {}).get("message") if isinstance(j, dict) else None
        raise AuthError(msg or f"HTTP {st}")
    if st >= 400 or not isinstance(j, dict):
        raise Shape(f"login: HTTP {st}")
    token, user = j.get("accessToken"), j.get("user") or {}
    if not token:
        raise Shape("login: no accessToken in the answer")
    if user.get("isEmailVerified") is False:
        raise AuthError("Park My Share says the account's email isn't verified")
    company = user.get("companyId") or (user.get("company") or {}).get("id")
    if not company:
        raise Shape("login: no companyId on the user")

    st, fj = call("GET", "parkingfacility/active", token)
    facilities = as_list(fj, "facilities") or []
    qr_fac = [f for f in facilities if isinstance(f, dict) and f.get("supportQRCodes")]
    if not qr_fac:
        # the host's own garage list, then anything with an id
        st, cj = call("GET", f"company/{company}", token)
        ids = set((cj or {}).get("twoFactorAuthFacilities") or []) if isinstance(cj, dict) else set()
        qr_fac = [f for f in facilities if isinstance(f, dict) and f.get("id") in ids] or \
                 [{"id": i, "name": None} for i in ids]
    if not qr_fac:
        raise Shape("no garage with QR codes on this account")
    qr_fac.sort(key=lambda f: 0 if LAX_HINT.search(" ".join(str(f.get(k) or "") for k in ("name", "code", "city", "address"))) else 1)

    out = []
    for f in qr_fac[:4]:
        st, qj = call("GET", f"twofactorauthcode?companyId={company}&facilityId={f['id']}", token)
        if st >= 400:
            continue
        rows = as_list(qj, "codes", "qrCodes")
        if rows is None:
            raise Shape("QR list came back in an unknown shape")
        for r in rows:
            if isinstance(r, dict):
                out.append(dict(r, _facility=f.get("name") or f.get("code") or str(f.get("id"))))
        if out:
            break
    return out


# ---------------------------------------------------------------- the browser path (fallback)

def browser_codes(email, password):
    env = dict(os.environ, PMS_EMAIL=email, PMS_PASSWORD=password)
    p = subprocess.run(BROWSER, env=env, capture_output=True, text=True, timeout=240)
    line = (p.stdout.strip().splitlines() or [""])[-1]
    try:
        j = json.loads(line)
    except ValueError:
        raise RuntimeError(f"browser: no answer (exit {p.returncode}) {p.stderr.strip()[-300:]}")
    if j.get("auth"):
        raise AuthError(j.get("message") or "the portal rejected the login")
    if j.get("error"):
        raise RuntimeError("browser: " + str(j["error"])[:300])
    return [dict(r, _facility=r.get("_facility") or "Park My Share") for r in (j.get("codes") or []) if isinstance(r, dict)]


# ---------------------------------------------------------------- choosing the code

def choose(codes):
    """The newest code Park My Share marks ACTIVE that is still good for at least an hour. Never an expiring one."""
    now = datetime.datetime.now(UTC)
    good = []
    for c in codes:
        code = str(c.get("barcode") or c.get("code") or c.get("qrCode") or "").strip()
        status = str(c.get("status") or "").strip().lower()
        exp = parse_when(c.get("expirationDate") or c.get("expiration") or c.get("expiresAt"))
        if code and status == "active" and (exp is None or exp > now + datetime.timedelta(hours=1)):
            good.append((exp or now + datetime.timedelta(days=3650), code, exp, c.get("_facility")))
    if not good:
        return None
    good.sort(reverse=True)
    _, code, exp, fac = good[0]
    return {"code": code, "expires": exp, "facility": fac}


def describe(codes):
    kinds = {}
    for c in codes:
        k = str(c.get("status") or "?").lower()
        kinds[k] = kinds.get(k, 0) + 1
    return ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())) or "no codes"


def report(ok, kind, result=None, error=None, method=None, expires=None, facility=None, dry=False):
    if dry:
        return
    lib.rpc("lax_fetch_report", p_ok=ok, p_kind=kind, p_result=result, p_error=error, p_method=method,
            p_expires=expires.isoformat() if expires else None, p_facility=facility)


# ---------------------------------------------------------------- main

def main(argv):
    dry, force = "--dry" in argv, "--force" in argv
    g = lib.rpc("lax_fetch_gate") or {}
    if not g.get("configured"):
        return "skip: Park My Share login not saved yet (Turo Watch > Settings)"
    if not g.get("need") and not force:
        return f"ok: nothing due ({g.get('why')})"

    email = lib.rpc("pi_secret_get", p_name="pi:parkmyshare:email") or ""
    password = lib.rpc("pi_secret_get", p_name="pi:parkmyshare:password") or ""
    if not email or not password:
        report(False, "auth", error="The saved login is missing the email or the password.", dry=dry)
        return "skip: login incomplete"

    method, codes, api_err = "api", None, None
    for attempt in range(3):
        try:
            codes = api_codes(email, password)
            break
        except AuthError as e:
            report(False, "auth", error=str(e)[:300], method="api", dry=dry)
            return "skip: Park My Share rejected the login (alerted)"
        except Transient as e:
            api_err = e
            time.sleep(10 * (attempt + 1))
        except Shape as e:
            api_err = e
            break
    if codes is None:
        method = "browser"
        try:
            codes = browser_codes(email, password)
        except AuthError as e:
            report(False, "auth", error=str(e)[:300], method="browser", dry=dry)
            return "skip: Park My Share rejected the login (alerted)"
        except Exception as e:  # noqa: BLE001
            report(False, "down", error=f"api: {api_err}; browser: {e}"[:600], method="browser", dry=dry)
            return "skip: couldn't read Park My Share this run (will retry)"

    pick = choose(codes)
    if not pick:
        report(False, "nocode", result=f"No active code yet ({describe(codes)}).", method=method, dry=dry)
        return f"skip: no active code yet ({describe(codes)})"
    exp_txt = pick["expires"].astimezone(LA).strftime("%b %d") if pick["expires"] else "no end date"
    if dry:
        return f"ok: dry run, active code {mask(pick['code'])} good until {exp_txt} via {method} (gate: {g.get('why')})"

    res = lib.rpc("lax_fetch_save", p_payload=pick["code"], p_expires=pick["expires"].isoformat() if pick["expires"] else None,
                  p_facility=pick["facility"], p_method=method) or {}
    if not res.get("guests_see"):
        time.sleep(3)
        res = lib.rpc("lax_fetch_save", p_payload=pick["code"], p_expires=pick["expires"].isoformat() if pick["expires"] else None,
                      p_facility=pick["facility"], p_method=method) or {}
    if not res.get("guests_see"):
        report(False, "verify", error="Saved the code, but the guest page still shows a different one.", method=method,
               expires=pick["expires"], facility=pick["facility"])
        return "skip: saved but guests don't see it yet (alert after 3)"

    kind = "saved" if res.get("saved") else "same"
    result = (f"New active code {mask(pick['code'])} saved for guests, good until {exp_txt}." if kind == "saved"
              else f"Guests already have the active code {mask(pick['code'])}, good until {exp_txt}.")
    report(True, kind, result=result, method=method, expires=pick["expires"], facility=pick["facility"])
    return f"ok: {kind} {mask(pick['code'])} until {exp_txt} via {method} (gate: {g.get('why')})"
