#!/usr/bin/env python3
"""Client to-do auto-tick -- Bestly Pi cron job.

Ticks off client_todos that point at a Mercury invoice or a LibreSign contract once the
invoice is Paid / every signer has signed. Runs on bestly-pi, stdlib only, no AI at all.
(The Mercury token only works from the Pi's IPv4 address, which is why this cannot run in the cloud.)

Owner: Tally. Heartbeat + Scout alerts are signed by her.

  run:      /opt/bestly/cron/run.sh todo-autotick
  by hand:  python3 /opt/bestly/cron/jobs/todo_autotick.py --dry
            python3 /opt/bestly/cron/jobs/todo_autotick.py --live
            python3 todo_autotick.py --dry --mock fixture.json     (no network at all)

Safety rails:
  * Mercury: GET only (/ar/invoices/{id}). LibreSign: GET only on the public sign page.
    Nothing is ever written to either.
  * The only write is the client_todo_autotick_done RPC, which re-checks that the to-do is
    still open, the source kind and id match, and the evidence says Paid / signed.
  * Unknown is not done: an unreachable, unparseable or odd answer leaves the to-do open.
  * Default mode is DRY until state.json says {"mode": "live"} (or --live).
  * No credential is ever printed, logged or written to disk.
"""

import argparse
import base64
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

JOB = "todo-autotick"
OWNER = "Tally (client to-dos)"

MERCURY_BASE = "https://api.mercury.com/api/v1"
LIBRESIGN_BASE = "https://cloud.bestly.tech/apps/libresign/p/sign/"
UA = "bestly-todo-autotick/1.0"

ENV_FILE = "/home/pi/scripts/.env"
WATCHDOG_TOKEN_FILE = "/home/pi/.bestly/db_watchdog_token"
PUBLISHABLE = os.environ.get("SUPABASE_PUBLISHABLE_KEY",
                             "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw")  # public by design
STATE_PATH = "/opt/bestly/cron/state/todo_autotick.json"

DEFAULT_STATE = {"mode": "dry", "last_run": None, "ticked": [], "log": []}
UUID_RE = re.compile(r"^[0-9a-fA-F-]{8,64}$")
LIBRESIGN_SIGNED = 3  # LibreSign file status: 0 draft, 1 able to sign, 2 partially signed, 3 signed


class Skip(Exception):
    """Nothing wrong with the Pi, but this source cannot be read right now."""


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
    state["ticked"] = state.get("ticked", [])[-500:]
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


class force_ipv4(object):
    """Use IPv4 for the duration of the block. Mercury allowlists the token by source
    address and the Pi's IPv6 (SLAAC, rotating) address is not on it."""

    def __enter__(self):
        self._real = socket.getaddrinfo

        def ipv4_only(host, port, family=0, *args, **kwargs):
            return self._real(host, port, socket.AF_INET, *args, **kwargs)

        socket.getaddrinfo = ipv4_only
        return self

    def __exit__(self, *exc):
        socket.getaddrinfo = self._real
        return False


def http_get(url, headers=None, tries=3, timeout=45):
    """GET with retries on network errors, 429 and 5xx. Returns (status, body bytes).
    GET is the only verb in this file."""
    last = None
    for i in range(tries):
        if i:
            time.sleep(3 * i)
        req = urllib.request.Request(url, method="GET", headers=headers or {})
        try:
            with _OPENER.open(req, timeout=timeout) as resp:
                status, data = resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            try:
                data = exc.read() or b""
            except Exception:  # noqa: BLE001
                data = b""
            status = exc.code
        except (urllib.error.URLError, OSError) as exc:
            last = "network error (%s)" % type(exc).__name__
            continue
        if status == 429 or status >= 500:
            last = "HTTP %d" % status
            continue
        return status, data
    raise Skip("%s unreachable: %s" % (urllib.parse.urlsplit(url).netloc, last))


# ---------------------------------------------------------------- supabase

def supabase_rpc(fn, payload, key=None, quiet=False):
    """Returns the JSON answer, or None on any failure (None means 'could not ask')."""
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


def get_mercury_token():
    """Same read-only token Penny / Bank Watch / Rolo use: env / .env, then Vault
    pi:mercury_api_token (pi_secret_get), then mercury_token_t with the db-watchdog token."""
    token = env("MERCURY_API_TOKEN")
    if token:
        return token
    value = supabase_rpc("pi_secret_get", {"p_name": "pi:mercury_api_token"}, quiet=True)
    if isinstance(value, str) and value.strip():
        return value.strip()
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


# ---------------------------------------------------------------- mercury

def classify_mercury_error(status, body):
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
    return ""


def parse_invoice_status(body):
    """Mercury invoice JSON -> status string ('' if absent). Pure, testable."""
    try:
        data = json.loads(body.decode("utf-8", "replace") if isinstance(body, bytes) else body)
    except ValueError:
        return ""
    if isinstance(data, dict):
        if isinstance(data.get("invoice"), dict):
            data = data["invoice"]
        return str(data.get("status") or "")
    return ""


def fetch_invoice_status(token, invoice_id):
    """Status string for one invoice, GET only. Raises Skip when the token is refused.
    Returns '' (unknown) when the invoice cannot be read."""
    if not UUID_RE.match(invoice_id):
        return ""
    url = "%s/ar/invoices/%s" % (MERCURY_BASE, urllib.parse.quote(invoice_id, safe=""))
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json", "User-Agent": UA}
    with force_ipv4():
        status, body = http_get(url, headers)
    if status == 200:
        return parse_invoice_status(body)
    reason = classify_mercury_error(status, body)
    if reason:
        raise Skip(reason)
    log("Mercury invoice answered HTTP %d (left open)" % status)
    return ""


# --------------------------------------------------------------- libresign

def _state_value(html, name):
    m = re.search(r'id="initial-state-libresign-%s"\s+value="([^"]*)"' % re.escape(name), html)
    if not m:
        return None
    try:
        return json.loads(base64.b64decode(m.group(1)).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def parse_libresign(html):
    """LibreSign public sign page -> (signed: True/False/None, detail dict).
    None means 'could not tell' (never treated as signed).
    Signed when the file status is 3 (Signed), or when there is at least one signer and every
    signer has a non-null `signed` timestamp. NOTE the file status is already 2 'Partially
    signed' once the first party has signed, so status 2 alone is NOT done."""
    signers = _state_value(html, "signers")
    status = _state_value(html, "status")
    if not isinstance(signers, list) and status is None:
        return None, {"reason": "sign page has no LibreSign state"}
    detail = {"file_status": status if isinstance(status, int) else None,
              "signers": len(signers) if isinstance(signers, list) else None,
              "signers_signed": (sum(1 for s in signers if isinstance(s, dict) and s.get("signed"))
                                 if isinstance(signers, list) else None)}
    if status == LIBRESIGN_SIGNED:
        return True, detail
    if isinstance(signers, list) and signers and all(isinstance(s, dict) and s.get("signed") for s in signers):
        return True, detail
    return False, detail


def fetch_libresign(uuid_):
    if not UUID_RE.match(uuid_):
        return None, {"reason": "bad uuid"}
    status, body = http_get(LIBRESIGN_BASE + urllib.parse.quote(uuid_, safe=""),
                            {"User-Agent": UA, "Accept": "text/html"})
    if status != 200:
        return None, {"reason": "sign page answered HTTP %d" % status}
    return parse_libresign(body.decode("utf-8", "replace"))


# ------------------------------------------------------------------- core

def process(todos, invoice_status_fn, contract_fn, done_fn, dry):
    """Pure core. invoice_status_fn(id)->status str; contract_fn(uuid)->(signed|None, detail);
    done_fn(todo_id, evidence)->RPC answer dict. Returns counters + notes."""
    res = {"checked": 0, "ticked": 0, "waiting": 0, "unknown": 0, "refused": 0,
           "ticked_ids": [], "skips": []}
    skipped_sources = set()
    for t in todos:
        kind = t.get("kind")
        res["checked"] += 1
        evidence = None
        try:
            if kind == "invoice":
                if "mercury" in skipped_sources:
                    res["unknown"] += 1
                    continue
                inv = t.get("mercury_invoice_id") or ""
                st = invoice_status_fn(inv)
                if not st:
                    res["unknown"] += 1
                elif st.lower() == "paid":
                    evidence = {"kind": "invoice", "mercury_invoice_id": inv, "status": st}
                else:
                    res["waiting"] += 1
            elif kind == "contract":
                if "libresign" in skipped_sources:
                    res["unknown"] += 1
                    continue
                uid = t.get("libresign_uuid") or ""
                signed, detail = contract_fn(uid)
                if signed is True:
                    evidence = dict(detail, kind="contract", libresign_uuid=uid, signed=True)
                elif signed is False:
                    res["waiting"] += 1
                else:
                    res["unknown"] += 1
            else:
                res["unknown"] += 1
        except Skip as why:
            skipped_sources.add("mercury" if kind == "invoice" else "libresign")
            res["skips"].append(str(why))
            res["unknown"] += 1
            continue
        if evidence is None:
            continue
        if dry:
            res["ticked"] += 1
            continue
        ans = done_fn(t["todo_id"], evidence)
        if isinstance(ans, dict) and ans.get("ok"):
            if ans.get("changed"):
                res["ticked"] += 1
                res["ticked_ids"].append(t["todo_id"])
        else:
            res["refused"] += 1
            log("done RPC refused for one to-do: %s" % (ans.get("reason") if isinstance(ans, dict) else "no answer"))
    return res


def summarize(res, dry, total):
    parts = ["%s %d" % ("would tick" if dry else "ticked", res["ticked"]),
             "%d still waiting" % res["waiting"]]
    if res["unknown"]:
        parts.append("%d could not be checked" % res["unknown"])
    if res["refused"]:
        parts.append("%d refused by the database" % res["refused"])
    line = "%s%s (of %d open to-dos with an invoice or contract)" % ("DRY " if dry else "", ", ".join(parts), total)
    if res["skips"]:
        line += "; " + "; ".join(sorted(set(res["skips"])))
    return line


def scout_notify(title, body, severity, dedupe):
    supabase_rpc("scout_notify", {
        "p_title": title, "p_body": body, "p_severity": severity, "p_push": False,
        "p_url": "/admin/team", "p_dedupe": dedupe})


# ------------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(description="Tick off client to-dos for paid invoices / signed contracts")
    parser.add_argument("--dry", action="store_true", help="never tick anything")
    parser.add_argument("--live", action="store_true", help="tick, ignoring state mode")
    parser.add_argument("--quiet", action="store_true", help="no Scout alert")
    parser.add_argument("--mock", help="JSON fixture: no network, no database, forces dry "
                        "({open:[...], invoices:{id:status}, pages:{uuid:html}})")
    args = parser.parse_args(argv or [])

    state = load_state() if not args.mock else dict(DEFAULT_STATE)
    dry = True
    if args.live:
        dry = False
    elif not args.dry and state.get("mode") == "live":
        dry = False
    if args.mock:
        dry = True
        args.quiet = True
    stamp = datetime.now().strftime("%Y%m%d%H")

    def remember(entry):
        if args.mock:
            return
        state["last_run"] = datetime.now().isoformat(timespec="seconds")
        entry["at"] = state["last_run"]
        state.setdefault("log", []).append(entry)
        save_state(state)

    if args.mock:
        with open(args.mock, "r", encoding="utf-8") as fh:
            fx = json.load(fh)
        todos = fx.get("open", [])
        inv_fn = lambda i: (fx.get("invoices", {}).get(i) or "")  # noqa: E731
        con_fn = lambda u: parse_libresign(fx.get("pages", {}).get(u, ""))  # noqa: E731
    else:
        todos = supabase_rpc("client_todo_autotick_open", {})
        if not isinstance(todos, list):
            raise RuntimeError("could not read the open to-dos (client_todo_autotick_open)")
        token = get_mercury_token() if any(t.get("kind") == "invoice" for t in todos) else ""

        def inv_fn(invoice_id):
            if not token:
                raise Skip("no Mercury token in Vault (pi:mercury_api_token) or .env")
            return fetch_invoice_status(token, invoice_id)

        con_fn = fetch_libresign

    log("open to-dos with an invoice or contract: %d" % len(todos))
    done_fn = lambda tid, ev: supabase_rpc("client_todo_autotick_done", {"p_todo": tid, "p_evidence": ev})  # noqa: E731
    res = process(todos, inv_fn, con_fn, done_fn, dry)

    summary = summarize(res, dry, len(todos))
    remember({"mode": "dry" if dry else "live", "checked": res["checked"], "ticked": res["ticked"],
              "waiting": res["waiting"], "unknown": res["unknown"], "refused": res["refused"]})
    if not dry:
        state["ticked"] = state.get("ticked", []) + res["ticked_ids"]
        save_state(state)
    log(summary)
    if not args.quiet and not dry:
        if res["ticked"]:
            scout_notify("%s: %d to-do(s) ticked off" % (OWNER, res["ticked"]), summary + ".",
                         "success", "todo-autotick.%s" % stamp)
        if res["skips"] or res["refused"]:
            scout_notify("%s: could not check everything" % OWNER,
                         summary + ". Those to-dos stay open.", "warning",
                         "todo-autotick.skip.%s" % datetime.now().strftime("%Y%m%d"))
    if res["skips"] and res["ticked"] == 0 and res["waiting"] == 0:
        return "skip: " + "; ".join(sorted(set(res["skips"])))
    return summary


if __name__ == "__main__":
    try:
        print(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001
        print("todo-autotick failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
