"""Review Reader (Maya's tool): files new Trustpilot reviews. bestly-pi, every 15 minutes at :07/:22/:37/:52.

Installed as /opt/bestly/cron/jobs/trustpilot_reviews.py (+ trustpilot_parse.py beside it) and run by
/opt/bestly/cron/run.sh trustpilot_reviews, which reports the heartbeat to pi_jobs (Scout pings on failure, pi_jobs_watch
if it goes quiet for 2 hours).

  1. Read Trustpilot-sender rows from bestly_mail (the Pi mail_bridge already copies jared@bestly.tech there every 5 min).
  2. For each one not filed yet that looks like a review: re-check its own headers over IMAP with BODY.PEEK
     (Authentication-Results: dkim=pass for trustpilot.com AND dmarc=pass). A forged email never reaches the public site.
  3. Parse stars / title / text / first name (trustpilot_parse.py). If the rules cannot, the free-AI ladder may try, but it
     may only return text that is verbatim in the email, otherwise nothing is saved.
  4. rpc trustpilot_ingest_review: insert once by Message-ID, and only on a real insert one quiet recap note signed Maya.

HARD LIMITS: mail is never moved, deleted, flagged or marked read (IMAP SELECT is readonly, fetches are BODY.PEEK).
Never invents a rating. No paid AI. Credentials: none new. The IMAP password is read through /opt/bestly/bin/security
(Vault pi:bestly-mail-bridge:jared@bestly.tech), the same way mail_sync does; never printed. Supabase: service key in the Pi .env.

  python3 trustpilot_reviews.py [--dry] [--days N] [--no-ai] [--check-auth <message-id>]
"""
import email
import imaplib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, HERE)
import trustpilot_parse as P  # noqa: E402

JOB = "trustpilot_reviews"
MAILBOX = "jared@bestly.tech"
IMAP_HOST, IMAP_PORT = "mail.privateemail.com", 993
STATE_PATH = os.environ.get("TRUSTPILOT_STATE", "/opt/bestly/cron/state/trustpilot_reviews.json")
FOLDERS_FIRST = ["INBOX", "Archive", "Trash", "Spam", "Junk"]
UNVERIFIED_FLAG_AFTER = timedelta(hours=24)
BRIDGE_STALE = timedelta(minutes=120)


def log(msg):
    print("[%s] %s" % (datetime.now().strftime("%Y-%m-%d %I:%M:%S %p"), msg), flush=True)


# ---------------------------------------------------------------- state (only ids we already flagged, so we alert once)

def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as fh:
            st = json.load(fh)
    except (OSError, ValueError):
        st = {}
    st.setdefault("flagged", {})
    return st


def save_state(st):
    st["flagged"] = dict(list(st["flagged"].items())[-200:])
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(st, fh, indent=1)
    os.replace(tmp, STATE_PATH)


# ---------------------------------------------------------------- IMAP sender check (read-only)

class Imap:
    def __init__(self):
        self.M = None

    def _pw(self):
        r = subprocess.run(["/opt/bestly/bin/security", "find-generic-password", "-a", MAILBOX, "-s", "bestly-mail-bridge", "-w"],
                           capture_output=True, text=True, timeout=30)
        pw = (r.stdout or "").strip()
        if not pw:
            raise RuntimeError("no IMAP password for %s in Vault (pi:bestly-mail-bridge:%s)" % (MAILBOX, MAILBOX))
        return pw

    def connect(self):
        if self.M is None:
            self.M = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=40)
            self.M.login(MAILBOX, self._pw())
        return self.M

    def close(self):
        if self.M is not None:
            try:
                self.M.logout()
            except Exception:  # noqa: BLE001
                pass
            self.M = None

    def _folders(self):
        names = []
        try:
            for line in self.connect().list()[1]:
                m = re.search(r'"([^"]+)"\s*$|(\S+)\s*$', line.decode(errors="replace"))
                if m:
                    names.append(m.group(1) or m.group(2))
        except Exception:  # noqa: BLE001
            pass
        return names

    def headers_for(self, message_id, hint_folder=None):
        """Header block of the message with this Message-ID, or None if it is in no folder we can see. Read-only."""
        mid = message_id.strip().strip("<>").replace("\\", "").replace('"', "")
        order = []
        for f in [hint_folder] + FOLDERS_FIRST:
            if f and f not in order:
                order.append(f)
        tried = set()
        for pass_no in (1, 2):
            for f in order:
                if f in tried:
                    continue
                tried.add(f)
                M = self.connect()
                typ, _ = M.select('"%s"' % f, readonly=True)
                if typ != "OK":
                    continue
                typ, d = M.uid("SEARCH", None, "HEADER", "Message-ID", '"%s"' % mid)
                ids = d[0].split() if typ == "OK" and d and d[0] else []
                if not ids:
                    continue
                typ, d = M.uid("FETCH", ids[0].decode(), "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM AUTHENTICATION-RESULTS)])")
                if typ == "OK" and d and isinstance(d[0], tuple):
                    return d[0][1].decode(errors="replace")
            if pass_no == 1:
                order = [f for f in self._folders() if f not in tried]  # rare: it was filed somewhere unusual
        return None


def check_auth(headers, message_id):
    """(ok, why). Needs the top Authentication-Results (added by our own mail server) to show dkim=pass for a
    trustpilot.com domain AND dmarc=pass, and the fetched message to be the one we asked for."""
    msg = email.message_from_string(headers)
    got = (msg.get("Message-ID") or "").strip().strip("<>")
    if got.lower() != message_id.strip().strip("<>").lower():
        return False, "fetched a different message"
    frm = (msg.get("From") or "").lower()
    if not re.search(r"@([a-z0-9\-]+\.)*trustpilot\.com>?\s*$", frm.strip()):
        return False, "From header is not trustpilot.com"
    ars = msg.get_all("Authentication-Results") or []
    if not ars:
        return False, "no Authentication-Results header"
    top = re.sub(r"\s+", " ", str(ars[0]))
    dkim_ok = any(re.search(r"(?:^|\.)trustpilot\.com$", d.lower()) for d in
                  re.findall(r"dkim=pass[^;]*?header\.d=([\w\.\-]+)", top, re.I))
    dmarc_ok = bool(re.search(r"dmarc=pass", top, re.I))
    if not dkim_ok:
        return False, "dkim did not pass for trustpilot.com"
    if not dmarc_ok:
        return False, "dmarc did not pass"
    return True, "dkim+dmarc pass"


# ---------------------------------------------------------------- free-AI fallback (verbatim-only)

AI_SYSTEM = ("You read one Trustpilot notification email about a new customer review of bestly.tech. Reply with ONE JSON object: "
             '{"stars": integer 1-5 or null, "title": string or null, "snippet": string or null, "reviewer_first_name": string or null}. '
             "Copy title and snippet EXACTLY as written in the email, character for character. Never paraphrase, never invent, "
             "never add anything. If a field is not in the email use null.")


def ai_extract(subject, body):
    import freellm  # /opt/bestly/cron/freellm.py (free ladder; imported lazily so tests need nothing)
    msg, who = freellm.chat([{"role": "system", "content": AI_SYSTEM},
                             {"role": "user", "content": "Subject: %s\n\n%s" % (subject, "\n".join(P.clean_lines(body))[:6000])}],
                            max_tokens=600, json_mode=True)
    txt = (msg.get("content") or "").strip()
    m = re.search(r"\{.*\}", txt, re.S)
    return json.loads(m.group(0)), who


# ---------------------------------------------------------------- the job

def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main(argv):
    import lib  # Supabase REST + rpc helpers (service key from the Pi .env)
    dry = "--dry" in argv
    use_ai = "--no-ai" not in argv
    days = 30
    if "--days" in argv:
        days = int(argv[argv.index("--days") + 1])
    now = datetime.now(timezone.utc)

    if "--check-auth" in argv:
        mid = argv[argv.index("--check-auth") + 1]
        im = Imap()
        try:
            h = im.headers_for(mid)
        finally:
            im.close()
        return "auth: message not found" if h is None else "auth: %s (%s)" % check_auth(h, mid)

    # Upstream first: if mail_bridge itself has stopped, this job is blind, and Scout should hear about that.
    st_rows = lib.get("bestly_mail_state", "select=last_run_at,last_error&mailbox=eq.%s&folder=eq.INBOX" % MAILBOX)
    if st_rows and st_rows[0].get("last_run_at"):
        age = now - _parse_ts(st_rows[0]["last_run_at"])
        if age > BRIDGE_STALE:
            raise RuntimeError("mail bridge has not polled %s INBOX for %d min, so no new reviews can be seen "
                               "(last_error: %s)" % (MAILBOX, age.total_seconds() // 60, st_rows[0].get("last_error")))

    since = _iso(now - timedelta(days=days))
    rows = lib.get("bestly_mail",
                   "select=message_id,folder,from_addr,subject,sent_at,body_text&from_addr=ilike.*trustpilot.com"
                   "&sent_at=gte.%s&order=sent_at.asc&limit=300" % since) or []
    known = {r["msg_id"] for r in (lib.get("trustpilot_reviews", "select=msg_id&limit=2000") or [])}
    state = load_state()
    filed, skipped, waiting, unreadable, rejected = [], 0, [], [], []
    im = Imap()
    flags = []  # (key, title, body) to raise once

    try:
        for r in rows:
            mid = r.get("message_id")
            if not mid or mid in known:
                continue
            subject, body = r.get("subject") or "", r.get("body_text") or ""
            try:
                P.parse_review(subject, r["from_addr"], body)
                rule_ok, rule_err = True, None
            except P.NotReview:
                skipped += 1
                continue
            except P.Unparseable as e:
                rule_ok, rule_err = False, str(e)

            # It claims to be a review. Prove it came from Trustpilot before anything else touches it.
            try:
                hdr = im.headers_for(mid, r.get("folder"))
            except Exception as e:  # noqa: BLE001
                raise RuntimeError("IMAP sender check failed: %s: %s" % (type(e).__name__, e))
            if hdr is None:
                age = now - _parse_ts(r["sent_at"])
                waiting.append(mid)
                if age > UNVERIFIED_FLAG_AFTER and mid not in state["flagged"]:
                    flags.append((mid, "Maya: a Trustpilot review email cannot be checked",
                                  "Subject: %s. I cannot find the message on the mail server to check it came from Trustpilot, "
                                  "so nothing was saved." % subject[:200]))
                continue
            ok, why = check_auth(hdr, mid)
            if not ok:
                rejected.append(mid)
                if mid not in state["flagged"]:
                    flags.append((mid, "Maya: a fake-looking Trustpilot review email was ignored",
                                  "Subject: %s. Check failed: %s. It was not saved or shown on the site." % (subject[:200], why)))
                continue

            if rule_ok:
                review = P.parse_review(subject, r["from_addr"], body)
            else:
                review = None
                if use_ai:
                    try:
                        obj, who = ai_extract(subject, body)
                        review = P.verify_ai_extraction(obj, subject, body)
                        log("rules failed (%s); free AI %s read it and passed the verbatim check" % (rule_err, who))
                    except Exception as e:  # noqa: BLE001
                        log("free AI fallback did not produce a verified review: %s" % e)
                if review is None:
                    unreadable.append(mid)
                    if mid not in state["flagged"]:
                        flags.append((mid, "Maya: a Trustpilot review email could not be read",
                                      "Subject: %s. %s. Nothing was saved. The reader's parser needs a look "
                                      "(tools/trustpilot-reader)." % (subject[:200], rule_err)))
                    continue

            alert = P.alert_text(review)
            if dry:
                log("DRY would file %s: %s | title=%r snippet=%r name=%r" % (mid[:40], alert, review["title"],
                                                                         (review["snippet"] or "")[:60], review["reviewer_first_name"]))
                filed.append(mid)
                continue
            inserted = lib.rpc("trustpilot_ingest_review", p_msg_id=mid, p_stars=review["stars"], p_title=review["title"],
                               p_snippet=review["snippet"], p_name=review["reviewer_first_name"],
                               p_received_at=r["sent_at"], p_alert=alert)
            if inserted:
                filed.append(mid)
                log("filed: " + alert)
    finally:
        im.close()

    new_flag = False
    for key, title, text in flags:
        if dry:
            log("DRY would flag: %s | %s" % (title, text))
            continue
        lib.rpc("trustpilot_reader_flag", p_key=re.sub(r"\W+", "", key)[-120:], p_title=title, p_body=text)
        state["flagged"][key] = now.isoformat()
        new_flag = True
    if not dry and flags:
        save_state(state)

    parts = ["%d new review%s filed" % (len(filed), "" if len(filed) == 1 else "s"),
             "%d mails seen, %d not reviews" % (len(rows), skipped)]
    if waiting:
        parts.append("%d waiting for a sender check" % len(waiting))
    if rejected:
        parts.append("%d failed the sender check" % len(rejected))
    if unreadable:
        parts.append("%d could not be read" % len(unreadable))
    summary = ", ".join(parts)
    if new_flag and (unreadable or rejected):
        # first sighting of something wrong: fail this one run so Scout hears it; later runs stay quiet (already flagged)
        raise RuntimeError(summary)
    # pi_job_report counts summaries starting with ok/nothing as quiet; a filed review is worth keeping in history.
    return ("ok " if not filed else "") + summary


if __name__ == "__main__":
    print(main(sys.argv[1:]))
