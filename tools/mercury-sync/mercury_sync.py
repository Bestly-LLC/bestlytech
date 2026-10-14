#!/usr/bin/env python3
"""Mercury -> Nextcloud contacts sync -- Bestly Pi cron job.

Replaces the Claude scheduled task "Mercury nextcloud sync"
(trig_012PN2BMkaL5eN1z4MhAPucf, Mondays 8:00 AM PT). Runs on bestly-pi, stdlib
only, no AI at all.

Owner: Rolo (contacts). Heartbeat + Scout alerts are signed by him.

  run:      /opt/bestly/cron/run.sh mercury-sync
  by hand:  python3 /opt/bestly/cron/jobs/mercury_sync.py --dry
            python3 /opt/bestly/cron/jobs/mercury_sync.py --live --max-create 50

What it does: lists the customers in Mercury Invoicing (read-only GET), REPORTs
the Nextcloud CardDAV address book to see which emails are already there, and
PUTs one new vCard for each customer whose email is missing.

Safety rails, in order of importance:
  * It only ever CREATES. Every PUT carries `If-None-Match: *`, so the server
    refuses (412) rather than overwrite a card. There is no update or delete
    code path, and no Mercury verb other than GET.
  * The duplicate-email check is the last statement before every PUT.
  * If the address book cannot be read, nothing is created.
  * Hard cap per run (--max-create, default 200).
  * Customer text is sanitised before it goes into a vCard (no injected lines).
  * Default mode is DRY until state.json says {"mode": "live"}.
  * No credential is ever printed, logged or written to disk.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

JOB = "mercury-sync"
OWNER = "Rolo (contacts)"

MERCURY_BASE = "https://api.mercury.com/api/v1"
MERCURY_CUSTOMERS = "/ar/customers"
MERCURY_PAGE = 1000
MERCURY_MAX_PAGES = 50
DEFAULT_NEXTCLOUD = "https://cloud.bestly.tech"
ADDRESSBOOK = "contacts"
UA = "bestly-mercury-sync/1.0"

ENV_FILE = "/home/pi/scripts/.env"
WATCHDOG_TOKEN_FILE = "/home/pi/.bestly/db_watchdog_token"
PUBLISHABLE = os.environ.get("SUPABASE_PUBLISHABLE_KEY",
                             "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw")  # public by design
STATE_PATH = "/opt/bestly/cron/state/mercury_sync.json"

DEFAULT_MAX_CREATE = 200
MAX_CONSECUTIVE_PUT_FAILURES = 5
PAUSE_SECONDS = 0.15

DEFAULT_STATE = {
    "mode": "dry",
    "last_run": None,
    "created_customer_ids": [],
    "log": [],
}


class Skip(Exception):
    """Nothing wrong with the Pi, but the job cannot do its work. Reported as `skip: ...`."""


# ---------------------------------------------------------------- utilities

def log(msg):
    print("[%s] %s" % (datetime.now().strftime("%Y-%m-%d %I:%M:%S %p"), msg), flush=True)


def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        state = {}
    merged = dict(DEFAULT_STATE)
    merged.update(state)
    return merged


def save_state(state):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    state["log"] = state.get("log", [])[-30:]
    state["created_customer_ids"] = state.get("created_customer_ids", [])[-500:]
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, sort_keys=True)
    os.replace(tmp, STATE_PATH)


def _env_file_value(name):
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("export "):
                    line = line[7:]
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def env(name):
    return (os.environ.get(name) or _env_file_value(name) or "").strip()


# ------------------------------------------------------------------- http

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: it would carry our Authorization header along."""

    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def http(method, url, headers=None, body=None, timeout=60):
    """Returns (status, body bytes). HTTP errors are returned, not raised."""
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with _OPENER.open(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        try:
            data = exc.read() or b""
        except Exception:  # noqa: BLE001
            data = b""
        return exc.code, data


def http_read(method, url, headers=None, body=None, tries=3):
    """For idempotent reads (GET / REPORT): retries network errors, 429 and 5xx."""
    last = None
    for i in range(tries):
        if i:
            time.sleep(3 * i)
        try:
            status, data = http(method, url, headers, body)
        except (urllib.error.URLError, OSError) as exc:
            last = "network error (%s)" % type(exc).__name__
            continue
        if status == 429 or status >= 500:
            last = "HTTP %d" % status
            continue
        return status, data
    raise RuntimeError("%s %s failed: %s" % (method, urllib.parse.urlsplit(url).netloc, last))


# ---------------------------------------------------------------- secrets

def supabase_rpc(fn, payload, key=None, quiet=False):
    url = env("SUPABASE_URL")
    key = key or env("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        return None
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/rpc/" + fn,
        data=json.dumps(payload).encode(),
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else True
    except Exception as exc:  # noqa: BLE001
        if not quiet:
            log("rpc %s failed (%s)" % (fn, type(exc).__name__))
        return None


def vault_pi_secret(name):
    """Service-role RPC pi_secret: Vault names on the Pi allowlist (nextcloud_*)."""
    value = supabase_rpc("pi_secret", {"p_name": name}, quiet=True)
    return value.strip() if isinstance(value, str) and value.strip() else ""


def vault_pi_prefixed(name):
    """Service-role RPC pi_secret_get: Vault names that start with `pi:`."""
    value = supabase_rpc("pi_secret_get", {"p_name": name}, quiet=True)
    return value.strip() if isinstance(value, str) and value.strip() else ""


def vault_shim(service, account):
    """/opt/bestly/bin/security reads Vault `pi:<service>:<account>`."""
    try:
        out = subprocess.run(
            ["/opt/bestly/bin/security", "find-generic-password",
             "-a", account, "-s", service, "-w"],
            capture_output=True, text=True, timeout=30)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return ""


def get_mercury_token():
    """Same read-only token Penny and Bank Watch use. Order follows the house precedent:
    env / .env, then Vault pi:mercury_api_token (pi_secret_get), then mercury_token_t."""
    token = env("MERCURY_API_TOKEN")
    if token:
        return token
    token = vault_pi_prefixed("pi:mercury_api_token")
    if token:
        return token
    try:
        with open(WATCHDOG_TOKEN_FILE, "r", encoding="utf-8") as fh:
            wd = fh.read().strip()
    except OSError:
        wd = ""
    if wd:
        value = supabase_rpc("mercury_token_t", {"p_token": wd}, key=PUBLISHABLE, quiet=True)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def get_nextcloud():
    """(base_url, user, app_password). The shared Vault entries nextcloud_user /
    nextcloud_app_password / nextcloud_base_url are on the pi_secret allowlist (the same
    way reminders_sync reads them). pi:nextcloud:* copies are honoured if someone adds them."""
    user = vault_pi_secret("nextcloud_user") or vault_shim("nextcloud", "user") \
        or env("NEXTCLOUD_USER")
    password = vault_pi_secret("nextcloud_app_password") or vault_shim("nextcloud", "app_password") \
        or env("NEXTCLOUD_APP_PASSWORD")
    base = vault_pi_secret("nextcloud_base_url") or env("NEXTCLOUD_BASE_URL") or DEFAULT_NEXTCLOUD
    return base.rstrip("/"), user, password


# ---------------------------------------------------------------- mercury

def classify_mercury_error(status, body):
    """Turn a non-200 Mercury answer into a one-line reason for `skip:`. Never echoes the body."""
    code = ""
    try:
        parsed = json.loads(body.decode("utf-8", "replace"))
        errors = parsed.get("errors") if isinstance(parsed, dict) else None
        if isinstance(errors, dict):
            code = str(errors.get("errorCode") or "")
    except ValueError:
        pass
    if code == "ipNotWhitelisted":
        return "Mercury token is not allowed from this IP (add the Pi's address to the token allowlist)"
    if status in (401, 403):
        return "Mercury token lacks invoicing scope or was rejected (HTTP %d)" % status
    if status == 404:
        return "Mercury has no %s endpoint for this token (HTTP 404)" % MERCURY_CUSTOMERS
    return ""


def fetch_customers(token):
    """All Mercury Invoicing customers as [{'id','name','email'}]. GET only.
    Raises Skip when the token cannot list them."""
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json",
               "User-Agent": UA}
    out, start_after, seen_last = [], None, None
    for _ in range(MERCURY_MAX_PAGES):
        url = "%s%s?limit=%d&order=asc" % (MERCURY_BASE, MERCURY_CUSTOMERS, MERCURY_PAGE)
        if start_after:
            url += "&start_after=" + urllib.parse.quote(start_after)
        status, body = http_read("GET", url, headers)
        if status != 200:
            reason = classify_mercury_error(status, body)
            if reason:
                raise Skip(reason)
            raise RuntimeError("Mercury customers returned HTTP %d" % status)
        try:
            page = json.loads(body.decode("utf-8", "replace"))
        except ValueError:
            raise RuntimeError("Mercury customers returned something that is not JSON")
        rows = page.get("customers") if isinstance(page, dict) else None
        if not isinstance(rows, list):
            raise RuntimeError("Mercury customers answer has no 'customers' list")
        if not rows:
            return out
        for row in rows:
            if isinstance(row, dict):
                out.append({"id": str(row.get("id") or ""),
                            "name": row.get("name") or "",
                            "email": row.get("email") or ""})
        last = str(rows[-1].get("id") or "") if isinstance(rows[-1], dict) else ""
        if not last or last == seen_last:
            return out
        seen_last = start_after = last
    log("stopped at %d pages of Mercury customers" % MERCURY_MAX_PAGES)
    return out


# ------------------------------------------------------------------ vcard

_EMAIL_RE = re.compile(r"^[^@\s;,<>\"\\]+@[^@\s;,<>\"\\]+\.[^@\s;,<>\"\\]+$")
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f\u2028\u2029]+")
_ORG_RE = re.compile(
    r"(&|\d|\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|pllc|pc|"
    r"associates|group|partners|services|studio|studios|bank|university|foundation|church|"
    r"trust|holdings|properties|management|consulting|solutions|enterprises|agency)\b)", re.I)


def normalize_email(value):
    """Lowercase, trimmed, no mailto:. Returns '' when it is not a usable address."""
    text = (value or "").strip()
    if text.lower().startswith("mailto:"):
        text = text[7:]
    text = text.strip().lower()
    return text if _EMAIL_RE.match(text) else ""


def clean_text(value):
    """One line, no control characters, so customer text can never add vCard properties."""
    return " ".join(_CTRL_RE.sub(" ", str(value or "")).split())


def vcard_escape(value):
    return (value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,"))


def split_name(name):
    """(family, given). Companies and one-word names go whole into the family slot."""
    name = clean_text(name)
    parts = name.split(" ")
    if len(parts) < 2 or len(parts) > 4 or _ORG_RE.search(name):
        return name, ""
    return parts[-1], " ".join(parts[:-1])


def fold(line):
    """RFC 6350 line folding at 75 octets, never inside a UTF-8 character."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return [line]
    out, cur, size, limit = [], "", 0, 75
    for ch in line:
        n = len(ch.encode("utf-8"))
        if size + n > limit:
            out.append(cur)
            cur, size, limit = " ", 1, 75
        cur += ch
        size += n
    out.append(cur)
    return out


def build_vcard(name, email, uid):
    """vCard 3.0 for one Mercury customer. `email` must already be normalised."""
    display = clean_text(name) or email
    family, given = split_name(display)
    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:" + uid,
        "FN:" + vcard_escape(display),
        "N:%s;%s;;;" % (vcard_escape(family), vcard_escape(given)),
        "EMAIL;TYPE=WORK:" + email,
        "NOTE:Synced from Mercury Invoicing",
        "CATEGORIES:Mercury Customer",
        "END:VCARD",
    ]
    folded = []
    for line in lines:
        folded.extend(fold(line))
    return ("\r\n".join(folded) + "\r\n").encode("utf-8")


# --------------------------------------------------------------- carddav

REPORT_BODIES = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">'
    '<d:prop><d:getetag/><card:address-data>'
    '<card:prop name="UID"/><card:prop name="FN"/><card:prop name="EMAIL"/>'
    '</card:address-data></d:prop><card:filter/></card:addressbook-query>',
    '<?xml version="1.0" encoding="utf-8"?>'
    '<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">'
    '<d:prop><d:getetag/><card:address-data/></d:prop><card:filter/></card:addressbook-query>',
)


def unfold(text):
    return re.sub(r"\r?\n[ \t]", "", text)


def parse_existing(xml_bytes):
    """(emails set, card count) from a CardDAV multistatus. Group prefixes (item1.EMAIL),
    TYPE params, folded lines and mailto: are all handled."""
    root = ET.fromstring(xml_bytes)
    emails, cards = set(), 0
    for el in root.iter():
        if not el.tag.endswith("}address-data") and el.tag != "address-data":
            continue
        cards += 1
        for line in unfold(el.text or "").splitlines():
            head, sep, value = line.partition(":")
            if not sep:
                continue
            prop = head.split(";", 1)[0].rsplit(".", 1)[-1].strip().upper()
            if prop == "EMAIL":
                address = normalize_email(value)
                if address:
                    emails.add(address)
    return emails, cards


def addressbook_url(base, user):
    return "%s/remote.php/dav/addressbooks/users/%s/%s/" % (
        base, urllib.parse.quote(user, safe=""), ADDRESSBOOK)


def basic_auth(user, password):
    import base64
    token = base64.b64encode(("%s:%s" % (user, password)).encode("utf-8")).decode("ascii")
    return {"Authorization": "Basic " + token, "User-Agent": UA}


def read_existing(base, user, password):
    """REPORT the whole address book. Any failure raises: with no view of what exists,
    creating anything would risk duplicates."""
    url = addressbook_url(base, user)
    headers = dict(basic_auth(user, password))
    headers.update({"Depth": "1", "Content-Type": "application/xml; charset=utf-8"})
    last = None
    for body in REPORT_BODIES:
        status, data = http_read("REPORT", url, headers, body.encode("utf-8"))
        if status in (401, 403):
            raise RuntimeError("Nextcloud rejected the login (HTTP %d)" % status)
        if status == 404:
            raise RuntimeError("Nextcloud address book '%s' not found for this user" % ADDRESSBOOK)
        if status != 207:
            last = status
            continue
        try:
            return parse_existing(data)
        except ET.ParseError:
            last = "unparseable XML"
    raise RuntimeError("Nextcloud REPORT failed (%s)" % last)


def put_new_contact(base, user, password, vcard, uid):
    """Create one card. `If-None-Match: *` makes the server refuse to overwrite. Returns HTTP status."""
    url = "%s%s.vcf" % (addressbook_url(base, user), uid)
    headers = dict(basic_auth(user, password))
    headers.update({"Content-Type": "text/vcard; charset=utf-8", "If-None-Match": "*"})
    status, _ = http("PUT", url, headers, vcard, timeout=60)
    return status


# ------------------------------------------------------------------- sync

def sync_contacts(customers, existing_emails, put_fn, max_create, dry, new_uid=None):
    """Pure core, easy to test. put_fn(vcard_bytes, uid) -> HTTP status.
    Returns a dict of counters plus 'created_ids'."""
    new_uid = new_uid or (lambda: str(uuid.uuid4()))
    known = set(existing_emails)
    res = {"customers": len(customers), "created": 0, "exists": 0, "no_email": 0,
           "dup_in_mercury": 0, "failed": 0, "over_cap": 0, "created_ids": []}
    seen_in_mercury, consecutive_failures = set(), 0
    for cust in customers:
        email = normalize_email(cust.get("email"))
        if not email:
            res["no_email"] += 1
            continue
        if email in seen_in_mercury:
            res["dup_in_mercury"] += 1
            continue
        seen_in_mercury.add(email)
        if email in known:
            res["exists"] += 1
            continue
        if res["created"] >= max_create:
            res["over_cap"] += 1
            continue
        uid = new_uid()
        vcard = build_vcard(cust.get("name"), email, uid)
        if dry:
            res["created"] += 1
            known.add(email)
            continue
        # Last thing before the PUT: the duplicate-email check.
        if email in known:
            res["exists"] += 1
            continue
        status = put_fn(vcard, uid)
        if status == 201:
            res["created"] += 1
            known.add(email)
            res["created_ids"].append(cust.get("id") or "")
            consecutive_failures = 0
        elif status == 412:
            res["exists"] += 1
            known.add(email)
            consecutive_failures = 0
        else:
            res["failed"] += 1
            consecutive_failures += 1
            log("PUT refused with HTTP %s for one contact" % status)
            if consecutive_failures >= MAX_CONSECUTIVE_PUT_FAILURES:
                raise RuntimeError("stopped after %d failed creates in a row (last HTTP %s)"
                                   % (consecutive_failures, status))
        time.sleep(PAUSE_SECONDS)
    return res


def summarize(res, dry):
    parts = ["%s %d" % ("would create" if dry else "created", res["created"]),
             "%d already in Nextcloud" % res["exists"]]
    for key, label in (("no_email", "no usable email"), ("dup_in_mercury", "duplicate email in Mercury"),
                       ("failed", "failed"), ("over_cap", "left for next run (cap)")):
        if res[key]:
            parts.append("%d %s" % (res[key], label))
    return "%s%s (of %d Mercury customers)" % ("DRY " if dry else "", ", ".join(parts), res["customers"])


def scout_notify(title, body, severity, dedupe):
    supabase_rpc("scout_notify", {
        "p_title": title, "p_body": body, "p_severity": severity, "p_push": False,
        "p_url": "/admin/team", "p_dedupe": dedupe})


# ------------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(description="Mercury customers -> Nextcloud contacts")
    parser.add_argument("--dry", action="store_true", help="never create anything")
    parser.add_argument("--live", action="store_true", help="create, ignoring state mode")
    parser.add_argument("--max-create", type=int, default=DEFAULT_MAX_CREATE)
    parser.add_argument("--quiet", action="store_true", help="no Scout alert")
    args = parser.parse_args(argv or [])

    state = load_state()
    dry = True
    if args.live:
        dry = False
    elif not args.dry and state.get("mode") == "live":
        dry = False
    stamp = datetime.now().strftime("%Y%m%d")

    def finish_skip(reason):
        line = "skip: " + reason
        log(line)
        state["last_run"] = datetime.now().isoformat(timespec="seconds")
        state.setdefault("log", []).append({"at": state["last_run"], "skip": reason})
        save_state(state)
        if not args.quiet and not dry:
            scout_notify("%s: contact sync skipped" % OWNER, reason + ". Nothing was created.",
                         "warning", "mercury-sync.skip.%s" % stamp)
        return line

    token = get_mercury_token()
    if not token:
        return finish_skip("no Mercury token in Vault (pi:mercury_api_token) or .env")
    base, user, password = get_nextcloud()
    if not (user and password):
        return finish_skip("no Nextcloud login available (Vault nextcloud_user / nextcloud_app_password)")

    try:
        customers = fetch_customers(token)
    except Skip as why:
        return finish_skip(str(why))
    log("Mercury customers: %d" % len(customers))

    existing, cards = read_existing(base, user, password)
    log("Nextcloud address book: %d cards, %d distinct emails" % (cards, len(existing)))
    if cards >= 5 and not existing:
        raise RuntimeError("address book has %d cards but no emails could be read; refusing to "
                           "create anything (parser sanity check)" % cards)

    res = sync_contacts(
        customers, existing,
        lambda vcard, uid: put_new_contact(base, user, password, vcard, uid),
        max(args.max_create, 0), dry)

    state["last_run"] = datetime.now().isoformat(timespec="seconds")
    if not dry:
        state["created_customer_ids"] = state.get("created_customer_ids", []) + res["created_ids"]
    state.setdefault("log", []).append({
        "at": state["last_run"], "mode": "dry" if dry else "live",
        "customers": res["customers"], "created": res["created"], "exists": res["exists"],
        "no_email": res["no_email"], "failed": res["failed"], "over_cap": res["over_cap"]})
    save_state(state)

    summary = summarize(res, dry)
    log(summary)
    if not args.quiet and not dry and (res["created"] or res["failed"] or res["over_cap"]):
        severity = "warning" if (res["failed"] or res["over_cap"]) else "info"
        scout_notify("%s: %d new contacts" % (OWNER, res["created"]), summary + ".",
                     severity, "mercury-sync.%s" % stamp)
    return summary


if __name__ == "__main__":
    try:
        print(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001
        print("mercury-sync failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
