"""Hermes (Mail Clerk): file a copy of every email sent from /admin/emails into jared@bestly.tech -> Sent.

Installed on Hestia as /opt/bestly/cron/jobs/sent_copies.py, run by cron every 5 min via run.sh (heartbeat
pi_job_report 'sent_copies', Scout alerts when it stops). Repo copy: tools/sent-copies/sent_copies.py.

Why: the email builder sends through Resend, which sends from outside the mailbox, so nothing ever reached the
Sent folder. email-builder-send snapshots each sent email into email_sent_copies; this job builds the real
message (Python email library: text + html + attachments from the private email-attachments bucket) and
IMAP-APPENDs it to the Sent folder, marked read, dated when it was sent. Then it blanks the snapshot and keeps
the row as a log. A row that fails 5 times is marked failed and Hermes tells Jared (digest, not a push).

  sent_copies.py          file what is pending
  sent_copies.py --dry    build the messages, append nothing
Mailbox password: Vault pi:bestly-mail-bridge:jared@bestly.tech through /opt/bestly/bin/security (same as the mail bridge).
"""
import imaplib
import mimetypes
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid

import lib

HOST, PORT = "mail.privateemail.com", 993
MAX_TRIES = 5
BATCH = 10
STALE_MIN = 30


def password(mailbox):
    out = subprocess.run(["/opt/bestly/bin/security", "find-generic-password", "-a", mailbox, "-s", "bestly-mail-bridge", "-w"],
                         capture_output=True, text=True, timeout=30)
    if out.returncode != 0 or not out.stdout.strip():
        raise RuntimeError(f"no mailbox password for {mailbox} (Vault pi:bestly-mail-bridge:{mailbox}): {out.stderr.strip()[:160]}")
    return out.stdout.strip()


def download(path):
    url = f"{lib.URL}/storage/v1/object/email-attachments/" + "/".join(urllib.parse.quote(p) for p in path.split("/"))
    req = urllib.request.Request(url, headers={k: v for k, v in lib._headers().items() if k != "Content-Type"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def when(row):
    try:
        return datetime.fromisoformat(str(row.get("sent_at") or row["created_at"]).replace("Z", "+00:00"))
    except (ValueError, KeyError):
        return datetime.now(timezone.utc)


def build(row):
    m = EmailMessage()
    m["From"] = row["from_header"]
    if row.get("to_list"):
        m["To"] = ", ".join(row["to_list"])
    if row.get("cc_list"):
        m["Cc"] = ", ".join(row["cc_list"])
    if row.get("bcc_list"):
        m["Bcc"] = ", ".join(row["bcc_list"])  # the sender's own copy shows who was blind-copied, like Mail does
    if row.get("reply_to"):
        m["Reply-To"] = row["reply_to"]
    m["Subject"] = row["subject"]
    m["Date"] = format_datetime(when(row))
    m["Message-ID"] = make_msgid(domain="bestly.tech")
    m["X-Bestly-Source"] = f"{row.get('source') or 'email-builder'} {row['id']}"
    m.set_content(row.get("text_body") or row["subject"])
    if row.get("html"):
        m.add_alternative(row["html"], subtype="html")
    for a in row.get("attachments") or []:
        data = download(a["path"])
        ctype = a.get("type") or mimetypes.guess_type(a.get("name") or "")[0] or "application/octet-stream"
        maintype, _, subtype = ctype.partition("/")
        m.add_attachment(data, maintype=maintype or "application", subtype=subtype or "octet-stream", filename=a.get("name") or "file")
    return m


def sent_folder(M):
    """The server's \\Sent folder (special-use flag first, then the usual names)."""
    typ, rows = M.list()
    names = []
    for raw in rows or []:
        line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else str(raw)
        flags = line[line.find("(") + 1:line.find(")")].lower()
        name = line.rsplit(' "', 1)[-1].rstrip('"') if line.endswith('"') else line.split()[-1]
        if "\\sent" in flags:
            return name
        names.append(name)
    for want in ("Sent", "Sent Items", "Sent Messages", "INBOX.Sent"):
        if want in names:
            return want
    raise RuntimeError("no Sent folder on the server (LIST: " + ", ".join(names[:12]) + ")")


def patch(row_id, body):
    lib._req("PATCH", f"/rest/v1/email_sent_copies?id=eq.{row_id}", body, headers={"Prefer": "return=minimal"})


def main(argv):
    dry = "--dry" in argv
    rows = lib.get("email_sent_copies", f"status=eq.pending&order=created_at.asc&limit={BATCH}&select=*") or []
    if not rows:
        return "ok nothing to file"
    filed, failed, notes = 0, 0, []
    by_box = {}
    for r in rows:
        by_box.setdefault(r.get("mailbox") or "jared@bestly.tech", []).append(r)
    for box, items in by_box.items():
        M = imaplib.IMAP4_SSL(HOST, PORT, timeout=60)
        try:
            M.login(box, password(box))
            folder = sent_folder(M)
            for r in items:
                try:
                    msg = build(r)
                    if dry:
                        notes.append(f"dry {r['id'][:8]} {len(msg.as_bytes())} bytes -> {folder}")
                        continue
                    when_ts = time.mktime(when(r).astimezone().timetuple())
                    mbox = '"' + folder.replace('"', '\\"') + '"'
                    typ, resp = M.append(mbox, "(\\Seen)", imaplib.Time2Internaldate(when_ts), msg.as_bytes())
                    if typ != "OK":
                        raise RuntimeError(f"APPEND {typ}: {resp!r}"[:200])
                    patch(r["id"], {"status": "filed", "filed_at": datetime.now(timezone.utc).isoformat(), "imap_folder": folder,
                                    "html": None, "text_body": None, "error": None, "attempts": (r.get("attempts") or 0) + 1})
                    filed += 1
                except Exception as e:  # noqa: BLE001
                    tries = (r.get("attempts") or 0) + 1
                    gave_up = tries >= MAX_TRIES
                    patch(r["id"], {"attempts": tries, "error": f"{type(e).__name__}: {e}"[:400], **({"status": "failed"} if gave_up else {})})
                    failed += 1
                    if gave_up:
                        lib.notify("Hermes: a sent email is missing from your Sent folder",
                                   f'"{r["subject"]}" went out, but I could not file the copy in {box} -> Sent after {tries} tries: {e}',
                                   severity="warning", push=False, url="/admin/emails", dedupe=f"sent-copy-{r['id']}")
        finally:
            try:
                M.logout()
            except Exception:  # noqa: BLE001
                pass
    # Watchdog: anything still waiting after 30 minutes means this job is stuck, not just slow.
    stale = lib.get("email_sent_copies", "status=eq.pending&select=id&created_at=lt." +
                    urllib.parse.quote(datetime.fromtimestamp(time.time() - STALE_MIN * 60, timezone.utc).isoformat())) or []
    if stale and not dry:
        lib.notify("Hermes: sent emails are waiting to be filed", f"{len(stale)} sent email(s) have waited over {STALE_MIN} minutes for the Sent folder. I keep retrying every 5 minutes.",
                   severity="warning", push=False, url="/admin/emails", dedupe="sent-copies-stale")
    if dry:
        return "ok (dry) " + " | ".join(notes)
    if failed and not filed:
        raise RuntimeError(f"filed 0, failed {failed}")
    return f"ok filed {filed}" + (f", {failed} will retry" if failed else "")
