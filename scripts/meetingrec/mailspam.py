#!/usr/bin/env python3
"""Spam Desk worker for the Mac mini (2026-10-07). Plan: docs/scout-vision-spam-opusplan.md, Part C.

agent.py runs tick() on a background thread every 60 seconds. Each tick:
  1. asks the spam-desk edge function for waiting jobs (op claim), authenticated with the same ~/MeetingRec/.agent-key
     the recorder uses (header x-recorder-key, checked as sha256 against meeting_recorder_state.key_sha256);
  2. for each job, drives Apple Mail with AppleScript: finds the account that owns the mailbox, looks for the message by
     its Message-ID in INBOX and then in Junk/Spam, reads its full source (.eml), and marks it junk
     (`set junk mail status of m to true`: Mail moves it to Junk and trains its own filter);
  3. uploads the source (op source, the server then sends the report emails) or reports why it could not (op fail).
     "junk only" jobs (a blocked sender wrote again) just junk the message (op junked), no report email.
     "restore" jobs (Jared tapped Not spam): un-junk it and move it back to INBOX (op restored).
     "dispose" jobs (an abuse desk replied to a report): mark it read and delete it to Trash (op disposed).

If macOS has not let this script control Mail yet, AppleScript fails with error -1743; the job is returned with code
automation_denied and the server raises "Mail needs your OK on the Mac mini". Jared clicks Allow once.

Standard library only; runs on the system python3. A bug in here must never stop the recorder agent: agent.py loads this
file fresh inside try/except on every tick, so a synced fix takes effect without a restart.
"""
import base64, json, subprocess, threading, time, urllib.error, urllib.request

URL = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/spam-desk"
SCRIPT_TIMEOUT_S = 150          # searching a big IMAP inbox with `whose message id is` can take a while
JUNK_NAMES = '{"Junk", "Spam", "Junk Mail", "Junk E-mail", "Bulk Mail"}'

# argv: 1 account email address, 2 message id without angle brackets, 3 "1" to junk it, 4 "1" to return the source,
#       5 mode: "" (as before), "restore" (not junk, back to INBOX) or "trash" (read, then deleted to Trash)
APPLESCRIPT = r'''
on run argv
	set theEmail to item 1 of argv
	set theId to item 2 of argv
	set doJunk to (item 3 of argv is "1")
	set wantSource to (item 4 of argv is "1")
	set theMode to ""
	if (count of argv) > 4 then set theMode to item 5 of argv
	set ids to {theId, "<" & theId & ">"}
	tell application "Mail"
		set theAcc to missing value
		repeat with a in accounts
			try
				if (email addresses of a) contains theEmail then
					set theAcc to a
					exit repeat
				end if
			end try
		end repeat
		if theAcc is missing value then error "no_account" number 9001
		set junkBox to missing value
		set inboxBox to missing value
		set boxes to {}
		try
			set inboxBox to mailbox "INBOX" of theAcc
			set end of boxes to inboxBox
		end try
		repeat with mb in (mailboxes of theAcc)
			try
				if (name of mb) is in ''' + JUNK_NAMES + r''' then
					set end of boxes to mb
					if junkBox is missing value then set junkBox to mb
				end if
			end try
		end repeat
		repeat with mb in boxes
			repeat with anId in ids
				set found to (messages of mb whose message id is (contents of anId))
				if (count of found) > 0 then
					set m to item 1 of found
					set src to ""
					if wantSource then set src to source of m
					set inJunk to ((name of mb) is in ''' + JUNK_NAMES + r''')
					if theMode is "restore" then
						set junk mail status of m to false
						if inJunk and inboxBox is not missing value then
							move m to inboxBox
						end if
						return "OK" & linefeed
					end if
					if theMode is "trash" then
						try
							set read status of m to true
						end try
						delete m
						return "OK" & linefeed
					end if
					if doJunk then
						set junk mail status of m to true
						if (not inJunk) and junkBox is not missing value then
							try
								move m to junkBox
							end try
						end if
					end if
					return "OK" & linefeed & src
				end if
			end repeat
		end repeat
	end tell
	error "not_found" number 9002
end run
'''


class Denied(Exception):
    pass


class NotFound(Exception):
    pass


class Failed(Exception):
    def __init__(self, msg, code="mail_error"):
        super().__init__(msg)
        self.code = code


def run_mail(mailbox, message_id, junk, want_source, mode=""):
    """Returns the .eml source as text ('' when not wanted). Raises Denied / NotFound / Failed."""
    mid = message_id.strip().strip("<>").strip()
    if not mid:
        raise Failed("empty message id", "bad_job")
    try:
        r = subprocess.run(["osascript", "-e", APPLESCRIPT, mailbox, mid, "1" if junk else "0", "1" if want_source else "0", mode],
                           capture_output=True, timeout=SCRIPT_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise Failed("Apple Mail took too long to search", "timeout")
    out = r.stdout.decode("utf-8", "replace")
    err = r.stderr.decode("utf-8", "replace")
    if r.returncode != 0:
        low = err.lower()
        if "-1743" in err or "not authorized" in low or "not allowed assistive" in low:
            raise Denied(err.strip()[:300])
        if "not_found" in err or "(9002)" in err:
            raise NotFound(mid)
        if "no_account" in err or "(9001)" in err:
            raise Failed(f"Apple Mail has no account for {mailbox}", "no_account")
        raise Failed(err.strip()[:400] or f"osascript exit {r.returncode}")
    if not out.startswith("OK"):
        raise Failed("unexpected AppleScript output")
    src = out[3:] if out.startswith("OK\n") else out[2:]
    # AppleScript hands back CR line endings; .eml wants CRLF
    src = src.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")
    return src


def post(key, body, timeout=60):
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "x-recorder-key": key})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            return {"ok": False, "error": f"http {e.code}"}


def handle(key, log, job):
    """One job. Returns False when the whole tick should stop (Mail automation not allowed)."""
    jid = job["id"]
    if job.get("restore") or job.get("dispose"):
        mode, done_op = ("restore", "restored") if job.get("restore") else ("trash", "disposed")
        try:
            run_mail(job["mailbox"], job["message_id"], False, False, mode)
        except Denied as e:
            log("mailspam: macOS has not allowed controlling Mail", str(e)[:120])
            return False
        except NotFound:
            post(key, {"op": done_op, "id": jid, "missing": True})
            return True
        except Failed as e:
            log("mailspam:", mode, "failed", jid, e.code, str(e)[:200])
            return True             # the claim goes stale and the server retries it (5 tries)
        post(key, {"op": done_op, "id": jid})
        log("mailspam:", mode, "done", jid)
        return True
    junk_only = bool(job.get("junk_only"))
    try:
        src = run_mail(job["mailbox"], job["message_id"], True, not junk_only)
    except Denied as e:
        log("mailspam: macOS has not allowed controlling Mail", str(e)[:120])
        post(key, {"op": "fail", "id": jid, "code": "automation_denied", "error": "Mail automation not allowed on the Mac mini"})
        return False
    except NotFound:
        if junk_only:           # already gone from the inbox (moved or deleted): nothing left to junk
            post(key, {"op": "junked", "id": jid})
        else:
            post(key, {"op": "fail", "id": jid, "code": "not_found", "error": "Apple Mail has no message with that Message-ID yet"})
        return True
    except Failed as e:
        log("mailspam: job failed", jid, e.code, str(e)[:200])
        post(key, {"op": "fail", "id": jid, "code": e.code, "error": str(e)[:400]})
        return True
    if junk_only:
        post(key, {"op": "junked", "id": jid})
        return True
    if not src.strip():
        post(key, {"op": "fail", "id": jid, "code": "empty_source", "error": "Apple Mail returned an empty source"})
        return True
    r = post(key, {"op": "source", "id": jid, "eml_b64": base64.b64encode(src.encode("utf-8", "replace")).decode()}, timeout=120)
    log("mailspam: source sent", jid, "->", json.dumps(r)[:200])
    return True


_lock = threading.Lock()


def tick(key, log):
    """Called by agent.py every 60 s. Never raises into the caller's loop beyond what agent.py already guards."""
    if not _lock.acquire(blocking=False):
        return
    try:
        try:
            r = post(key, {"op": "claim", "v": 2}, timeout=30)   # v2: knows restore + dispose jobs
        except Exception as e:  # noqa: BLE001
            log("mailspam: claim failed", e)
            return
        for job in r.get("jobs") or []:
            if not handle(key, log, job):
                break
            time.sleep(1)
    finally:
        _lock.release()


if __name__ == "__main__":
    # manual check on the Mac mini:  python3 mailspam.py you@icloud.com '<message-id>'   (reads and junks nothing)
    import sys
    if len(sys.argv) == 3:
        try:
            print(run_mail(sys.argv[1], sys.argv[2], False, True)[:600])
        except Exception as e:  # noqa: BLE001
            print("error:", type(e).__name__, e)
    else:
        print(__doc__)
