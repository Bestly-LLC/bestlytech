#!/usr/bin/env python3
"""Hermes guard (systemd bestly-hermes-guard): keeps iPostal1 emails out of Jared's inbox.

Jared must never see iPostal1 alert emails. The right tool is a server-side Sieve rule on PrivateEmail, but PrivateEmail does not
offer ManageSieve to us (port 4190 resets every connection) and its webmail filter screen needs Jared's password. So this is the
closest thing that runs on our side: it keeps one IMAP connection open, looks at INBOX every 15 seconds, and the moment a message
arrives from service@ipostal1.com or admin@ipostal1.com it is copied into the "Mailroom" folder and removed from the inbox.

  * Exact From address only (a look-alike such as service@ipostal1.com.evil.example is left alone for the spam tools).
  * Copy first, verify the copy is in Mailroom, only then remove the original. Never removes anything it could not copy.
  * PrivateEmail has no MOVE and no UIDPLUS, so removing means flag-deleted + EXPUNGE, and EXPUNGE takes every flagged message in
    the folder. If something else is flagged deleted, those flags are lifted for the instant of the expunge and put back.
  * Heartbeat to hermes_state.guard_beat_at every 60 seconds. If it stops, hermes_mailroom restarts this unit and hermes_watch
    (Supabase, every 5 minutes) alerts Scout. systemd Restart=always covers a crash.

Mail text is never read here beyond the From header. Standard library only.
"""
import imaplib
import re
import sys
import time
from email.utils import getaddresses

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402

MAILBOX = "jared@bestly.tech"
HOST, PORT = "mail.privateemail.com", 993
VAULT_MAIL = "pi:bestly-mail-bridge:" + MAILBOX
FOLDER = "Mailroom"
SENDERS = {"service@ipostal1.com", "admin@ipostal1.com"}
POLL_S = 15
BEAT_S = 60


def log(msg):
    print("[%s] %s" % (time.strftime("%Y-%m-%d %I:%M:%S %p"), msg), flush=True)


def connect():
    pw = lib.rpc("pi_secret_get", p_name=VAULT_MAIL)
    if not pw:
        raise RuntimeError("no IMAP password in Vault")
    M = imaplib.IMAP4_SSL(HOST, PORT, timeout=60)
    M.login(MAILBOX, pw)
    typ, boxes = M.list()
    if not any(re.search(r'"/" "?%s"?$' % FOLDER, (b or b"").decode(errors="replace")) for b in boxes or []):
        M.create(FOLDER)
    try:
        M.subscribe(FOLDER)
    except Exception:  # noqa: BLE001
        pass
    return M


def from_addr(M, uid):
    typ, d = M.uid("fetch", uid, "(BODY.PEEK[HEADER.FIELDS (FROM MESSAGE-ID)])")
    raw = next((x[1] for x in d if isinstance(x, tuple)), b"")
    m = re.search(rb"(?im)^from:(.*(?:\r?\n[ \t].*)*)", raw)
    addrs = getaddresses([m.group(1).decode(errors="replace")]) if m else []
    mid = re.search(rb"(?im)^message-id:\s*(<[^>]+>)", raw)
    return (addrs[0][1].lower() if addrs else ""), (mid.group(1) if mid else None)


def in_mailroom(M, mid):
    if not mid:
        return False
    M.select(FOLDER, readonly=True)
    typ, d = M.uid("search", None, "HEADER", "Message-ID", mid.decode())
    return bool(d and d[0])


def sweep(M):
    """Move every iPostal1 message out of INBOX. Returns how many moved."""
    M.select("INBOX")
    typ, d = M.uid("search", None, "UNDELETED", "OR", "FROM", '"service@ipostal1.com"', "FROM", '"admin@ipostal1.com"')
    uids = [u.decode() for u in (d[0].split() if d and d[0] else [])]
    moved = 0
    for u in uids:
        M.select("INBOX")
        addr, mid = from_addr(M, u)
        if addr not in SENDERS:
            continue
        typ, _ = M.uid("copy", u, FOLDER)
        if typ != "OK" or not in_mailroom(M, mid):
            log("copy of uid %s not confirmed, left in the inbox" % u)
            continue
        M.select("INBOX")
        typ, dd = M.uid("search", None, "DELETED")
        others = [x.decode() for x in (dd[0].split() if dd and dd[0] else []) if x.decode() != u]
        try:
            if others:
                M.uid("store", ",".join(others), "-FLAGS.SILENT", "(\\Deleted)")
            M.uid("store", u, "+FLAGS.SILENT", "(\\Deleted)")
            M.expunge()
            moved += 1
        finally:
            if others:
                try:
                    M.uid("store", ",".join(others), "+FLAGS.SILENT", "(\\Deleted)")
                except Exception as e:  # noqa: BLE001
                    log("could not restore flags on %d message(s): %s" % (len(others), e))
    return moved


def beat(moved_total):
    try:
        lib.rpc("hermes_guard_beat_t", p_moved=moved_total)
    except Exception as e:  # noqa: BLE001
        log("heartbeat failed: %s" % str(e)[:100])


def main():
    log("guard starting")
    moved_total, last_beat, backoff = 0, 0.0, 5
    while True:
        try:
            M = connect()
            backoff = 5
            while True:
                n = sweep(M)
                if n:
                    moved_total += n
                    log("moved %d iPostal1 message(s) from the inbox to %s" % (n, FOLDER))
                    beat(moved_total)
                    last_beat = time.time()
                if time.time() - last_beat >= BEAT_S:
                    beat(moved_total)
                    last_beat = time.time()
                time.sleep(POLL_S)
                M.noop()
        except Exception as e:  # noqa: BLE001
            log("connection problem: %s; retrying in %ds" % (str(e)[:140], backoff))
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)


if __name__ == "__main__":
    main()
