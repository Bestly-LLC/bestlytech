#!/usr/bin/env python3
"""Daily iCloud inbox cleanup -- Bestly Pi cron job.

Replaces the Claude scheduled task "Daily iCloud Inbox Cleanup"
(trig_01KsEa7kVMR2ERcvJQaNsmnR). Runs on bestly-pi, stdlib only, no paid AI.

Owner: Hermes (inbox). Heartbeat + Scout alerts are signed by him.

  run:      /opt/bestly/cron/run.sh inbox-cleaner
  by hand:  python3 /opt/bestly/cron/jobs/inbox_cleaner.py --dry
            python3 /opt/bestly/cron/jobs/inbox_cleaner.py --live --max-move 500

Safety rails, in order of importance:
  * Messages are MOVED to the iCloud Trash, never deleted. 30-day recovery.
  * Nothing is ever moved without an explicit per-sender UID list.
  * Protected senders, domains and topics are checked per message.
  * Hard cap per run (--max-move, default 3000).
  * Default mode is DRY until state.json says {"mode": "live"}.
"""

import argparse
import email.header
import email.utils
import imaplib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import inbox_cleaner_rules as R  # noqa: E402

JOB = "inbox-cleaner"
OWNER = "Hermes (inbox)"
MAILBOX = "jaredbest@icloud.com"
IMAP_HOST = "imap.mail.me.com"
IMAP_PORT = 993
VAULT_SERVICE = "bestly-mail-bridge"

STATE_PATH = "/opt/bestly/cron/state/inbox_cleaner.json"
FETCH_CHUNK = 200       # headers per FETCH
MOVE_CHUNK = 100        # uids per MOVE
PAUSE_SECONDS = 0.4     # be polite to iCloud; it throttles bursts

DEFAULT_STATE = {
    "mode": "dry",
    "killed_senders": [],
    "alias_queue": [],
    "unsubscribe_queue": [],
    "protected_additions": [],
    "last_run": None,
    "log": [],
}


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
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, sort_keys=True)
    os.replace(tmp, STATE_PATH)


def decode_header(raw):
    if not raw:
        return ""
    try:
        parts = email.header.decode_header(raw)
    except Exception:
        return str(raw)
    out = []
    for text, charset in parts:
        if isinstance(text, bytes):
            try:
                out.append(text.decode(charset or "utf-8", "replace"))
            except (LookupError, UnicodeDecodeError):
                out.append(text.decode("utf-8", "replace"))
        else:
            out.append(text)
    return " ".join(" ".join(out).split())


def get_password():
    """Vault via the Pi's `security` shim, then RPC, then env. Never printed."""
    try:
        out = subprocess.run(
            ["/opt/bestly/bin/security", "find-generic-password",
             "-a", MAILBOX, "-s", VAULT_SERVICE, "-w"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        body = json.dumps({"p_name": "pi:%s:%s" % (VAULT_SERVICE, MAILBOX)}).encode()
        req = urllib.request.Request(
            url.rstrip("/") + "/rest/v1/rpc/pi_secret_get",
            data=body,
            headers={"apikey": key, "Authorization": "Bearer " + key,
                     "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                value = json.loads(resp.read().decode())
                if isinstance(value, str) and value.strip():
                    return value.strip()
        except (urllib.error.URLError, ValueError, OSError):
            pass

    env = os.environ.get("ICLOUD_APP_PASSWORD")
    if env:
        return env
    raise RuntimeError(
        "no iCloud app password: Vault pi:%s:%s unreachable" % (VAULT_SERVICE, MAILBOX))


def supabase_rpc(fn, payload):
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
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
    except Exception as exc:  # noqa: BLE001 - never let a notify kill the run
        log("scout_notify failed (%s)" % exc)
        return None


def ask_free(prompt):
    """One call to the Pi's free ladder. Returns text or None. Never Claude."""
    try:
        import freellm
    except ImportError:
        return None
    for name in ("ask", "complete", "chat", "run", "generate"):
        fn = getattr(freellm, name, None)
        if not callable(fn):
            continue
        try:
            result = fn(prompt)
        except TypeError:
            try:
                result = fn(prompt=prompt)
            except Exception:  # noqa: BLE001
                continue
        except Exception:  # noqa: BLE001
            continue
        if isinstance(result, dict):
            result = result.get("text") or result.get("content") or ""
        if isinstance(result, str) and result.strip():
            return result.strip()
    return None


# ------------------------------------------------------------------- imap

class Mail:
    def __init__(self, password):
        self.conn = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        self.conn.login(MAILBOX, password)
        self.trash = self._find_trash()

    def _find_trash(self):
        typ, data = self.conn.list()
        names = []
        if typ == "OK":
            for line in data or []:
                line = line.decode("utf-8", "replace") if isinstance(line, bytes) else line
                if "\\Trash" in line:
                    match = re.search(r'"([^"]+)"\s*$', line.strip())
                    if match:
                        return match.group(1)
                match = re.search(r'"([^"]+)"\s*$', line.strip())
                if match:
                    names.append(match.group(1))
        for candidate in ("Deleted Messages", "Trash", "Deleted Items"):
            if candidate in names:
                return candidate
        return "Deleted Messages"

    def select_inbox(self):
        typ, _ = self.conn.select("INBOX")
        if typ != "OK":
            raise RuntimeError("cannot select INBOX")

    def search_before(self, days):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")
        typ, data = self.conn.uid("SEARCH", None, "BEFORE", cutoff)
        if typ != "OK":
            raise RuntimeError("UID SEARCH failed")
        return [uid.decode() for uid in (data[0] or b"").split()]

    def fetch_headers(self, uids):
        """Yield (uid, from_name, from_addr, to_addr, subject, has_unsub)."""
        fields = "BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT LIST-UNSUBSCRIBE)]"
        for i in range(0, len(uids), FETCH_CHUNK):
            batch = uids[i:i + FETCH_CHUNK]
            typ, data = self.conn.uid("FETCH", ",".join(batch), "(%s)" % fields)
            if typ != "OK":
                continue
            current_uid = None
            for item in data:
                if isinstance(item, tuple):
                    meta = item[0].decode("utf-8", "replace")
                    match = re.search(r"UID (\d+)", meta)
                    current_uid = match.group(1) if match else current_uid
                    raw = item[1].decode("utf-8", "replace")
                    headers = {}
                    key = None
                    for line in raw.splitlines():
                        if line[:1] in (" ", "\t") and key:
                            headers[key] += " " + line.strip()
                        elif ":" in line:
                            key, _, val = line.partition(":")
                            key = key.strip().lower()
                            headers[key] = val.strip()
                    name, addr = email.utils.parseaddr(
                        decode_header(headers.get("from", "")))
                    _, to_addr = email.utils.parseaddr(
                        decode_header(headers.get("to", "")))
                    if current_uid:
                        yield (current_uid, name, addr.lower(), to_addr.lower(),
                               decode_header(headers.get("subject", "")),
                               bool(headers.get("list-unsubscribe")))
            time.sleep(PAUSE_SECONDS)

    def move_to_trash(self, uids):
        """MOVE where supported, COPY+flag otherwise. Never expunges."""
        moved = 0
        caps = tuple(str(c).upper() for c in (self.conn.capabilities or ()))
        supports_move = "MOVE" in caps
        for i in range(0, len(uids), MOVE_CHUNK):
            batch = ",".join(uids[i:i + MOVE_CHUNK])
            if supports_move:
                typ, _ = self.conn.uid("MOVE", batch, '"%s"' % self.trash)
            else:
                typ, _ = self.conn.uid("COPY", batch, '"%s"' % self.trash)
                if typ == "OK":
                    self.conn.uid("STORE", batch, "+FLAGS", "(\\Deleted)")
            if typ == "OK":
                moved += len(uids[i:i + MOVE_CHUNK])
            time.sleep(PAUSE_SECONDS)
        return moved

    def close(self):
        try:
            self.conn.logout()
        except Exception:  # noqa: BLE001
            pass


# -------------------------------------------------------------- classify

def is_apple_alias(address):
    """A per-sender Hide My Email address, on either the From or the To line."""
    address = (address or "").lower()
    if R.is_relay_alias(address):
        return True
    local = address.split("@")[0]
    return (address.endswith("@icloud.com")
            and address not in R.OWN_ADDRESSES
            and len(local) >= 10
            and not re.search(r"[._-]", local)
            and bool(re.search(r"\d", local)))


def ai_verdict(sender, subjects):
    sample = "; ".join(subjects[:6])[:600]
    prompt = (
        "You sort a personal inbox. Answer with one word: MARKETING or KEEP.\n"
        "MARKETING = promotional blasts, newsletters, drip sequences, event promos, "
        "petitions, generic job alerts, re-engagement mail.\n"
        "KEEP = anything personal, transactional (orders, shipping, receipts, "
        "appointments), financial, legal, security, insurance, housing, a job "
        "application reply, or anything you are unsure about.\n"
        "When in doubt answer KEEP.\n\n"
        "Sender: %s\nRecent subjects: %s\nAnswer:" % (sender, sample)
    )
    answer = ask_free(prompt)
    if not answer:
        return None
    return "MARKETING" if "marketing" in answer.lower()[:40] else "KEEP"


# ------------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(description="Daily iCloud inbox cleanup")
    parser.add_argument("--dry", action="store_true", help="never move anything")
    parser.add_argument("--live", action="store_true", help="move, ignoring state mode")
    parser.add_argument("--before-days", type=int, default=7)
    parser.add_argument("--max-move", type=int, default=3000)
    parser.add_argument("--limit", type=int, default=6000, help="max headers scanned")
    parser.add_argument("--no-ai", action="store_true")
    parser.add_argument("--quiet", action="store_true", help="no Scout alert")
    args = parser.parse_args(argv or [])

    state = load_state()
    dry = True
    if args.live:
        dry = False
    elif not args.dry and state.get("mode") == "live":
        dry = False

    killed = {s.lower() for s in state.get("killed_senders", [])}
    extra_protected = state.get("protected_additions", [])
    alias_queue = {a.lower() for a in state.get("alias_queue", [])}
    unsub_queue = {u.lower() for u in state.get("unsubscribe_queue", [])}

    mail = Mail(get_password())
    try:
        mail.select_inbox()
        uids = mail.search_before(args.before_days)
        backlog = len(uids)
        uids = uids[-args.limit:] if len(uids) > args.limit else uids
        log("backlog older than %d days: %d (scanning %d)" % (
            args.before_days, backlog, len(uids)))

        senders = {}
        protected_hits = 0
        for uid, name, addr, to_addr, subject, has_unsub in mail.fetch_headers(uids):
            if R.is_protected_message(addr, name, subject, extra_protected):
                protected_hits += 1
                continue
            entry = senders.setdefault(addr, {
                "name": name, "uids": [], "subjects": [],
                "to": set(), "unsub": False,
            })
            entry["uids"].append(uid)
            if len(entry["subjects"]) < 8:
                entry["subjects"].append(subject)
            if to_addr:
                entry["to"].add(to_addr)
            entry["unsub"] = entry["unsub"] or has_unsub

        kill, leave, asked = [], 0, 0
        for addr, entry in sorted(senders.items(),
                                  key=lambda kv: -len(kv[1]["uids"])):
            if not addr:
                continue
            if R.is_known_marketing(addr, entry["name"]) or addr in killed:
                kill.append((addr, entry))
                continue
            score = R.marketing_score(entry["subjects"], entry["unsub"],
                                      len(entry["uids"]))
            if score >= R.AUTO_KILL_SCORE:
                kill.append((addr, entry))
            elif score < R.IGNORE_BELOW_SCORE or args.no_ai:
                leave += 1
            else:
                asked += 1
                if ai_verdict(addr, entry["subjects"]) == "MARKETING":
                    kill.append((addr, entry))
                else:
                    leave += 1

        moved_total, budget, killed_now = 0, args.max_move, []
        for addr, entry in kill:
            if budget <= 0:
                break
            batch = entry["uids"][:budget]
            if dry:
                log("DRY would move %4d from %s" % (len(batch), addr))
                moved_total += len(batch)
            else:
                moved = mail.move_to_trash(batch)
                log("moved %4d from %s" % (moved, addr))
                moved_total += moved
            budget -= len(batch)
            killed_now.append(addr)
            # Deactivating the alias kills the sender permanently -- far better
            # than unsubscribing. The alias is the From address when the sender
            # was signed up for with Hide My Email, otherwise check the To line.
            if is_apple_alias(addr):
                alias_queue.add("%s  (%s)" % (addr, R.unmask_relay(addr)))
            else:
                alias = next((t for t in entry["to"] if is_apple_alias(t)), None)
                if alias:
                    alias_queue.add("%s  (%s)" % (alias, addr))
                elif entry["unsub"]:
                    unsub_queue.add(addr)
    finally:
        mail.close()

    if not dry:
        state["killed_senders"] = sorted(killed | {a.lower() for a in killed_now})
    state["alias_queue"] = sorted(alias_queue)
    state["unsubscribe_queue"] = sorted(unsub_queue)
    state["last_run"] = datetime.now().isoformat(timespec="seconds")
    state.setdefault("log", []).append({
        "at": state["last_run"], "mode": "dry" if dry else "live",
        "backlog": backlog, "moved": moved_total,
        "senders": len(killed_now), "protected": protected_hits,
    })
    save_state(state)

    summary = ("%s%d trashed, %d senders, %d protected, %d left, %d aliases queued, "
               "%d backlog" % ("DRY " if dry else "", moved_total, len(killed_now),
                               protected_hits, leave, len(alias_queue),
                               max(backlog - moved_total, 0)))
    log(summary)

    if not args.quiet and not dry and moved_total:
        detail = "%d messages trashed from %d senders. %d left alone. %s" % (
            moved_total, len(killed_now), leave,
            ("%d Hide My Email aliases waiting to be switched off."
             % len(alias_queue)) if alias_queue else "No aliases waiting.")
        supabase_rpc("scout_notify", {
            "p_title": "Hermes (inbox): %d trashed" % moved_total,
            "p_body": detail, "p_level": "info", "p_push": False,
            "p_link": "/admin/team", "p_dedupe": "inbox-cleaner." +
            datetime.now().strftime("%Y%m%d"),
        })
    return summary


if __name__ == "__main__":
    try:
        print(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001
        print("inbox-cleaner failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
