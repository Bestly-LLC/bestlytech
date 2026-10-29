#!/usr/bin/env python3
"""Insurance Filer (Mac mini, launchd tech.bestly.insurance-filer, every 5 min). Team card: insurance-filer, a tool of Claims Closer.

When a Turo guest's own auto insurance is in play, this fills the insurer's online claim form from the packet Postgres built
(ins_build_packet), stops BEFORE sending with screenshots and a field list, and sends only after Jared's one tap on exactly what he
saw. It also sends the follow-up emails Jared taps to approve (with the photos and the repair estimate attached) from Mail on this Mac,
signed with his "Bestly" signature, and confirms each one landed in Sent. Everything is signed "Claims Closer".

HARD RULES (do not loosen):
  - Jobs come only from ins_mac_take. A 'submit' or 'send_mail' job is only handed out after Jared approved that exact thing.
  - Walker modes: dry never consents and never submits; fill never submits; submit re-checks the packet hash right before one click.
  - Never solves or bypasses a CAPTCHA or bot check. Never creates an account. Never invents an answer: no fact, no field.
  - A send that could not be confirmed is never retried. The database tells Jared to look.
  - Secrets: only the house watchdog token from the Keychain item bestly-db-watchdog. Photos reach this machine as 10-minute signed URLs.
Free AI only (and this tool needs none: the writing happens in the insurance-filer edge function). Python 3.9 compatible.

  python3 filer.py                     one run (what launchd does)
  python3 filer.py --dry-case <case>   REHEARSAL for a case: reads its packet, fills the live page, never consents, never submits
  python3 filer.py --dry-case <case> --packet tests/fixtures/cody_packet.json --url file:///...   same, from a saved packet / saved page
  python3 filer.py --selftest          fake claim site on this Mac: every mode, CAPTCHA, unknown question, stale hash, photos, mail scripts
"""
import argparse
import base64
import fcntl
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rules  # noqa: E402

SB = "https://rcqfqhguwpmaarseifqg.supabase.co"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"      # publishable key (same one every Mac agent uses)
HOME = os.path.expanduser("~")
BASE = os.environ.get("INS_BASE") or os.path.join(HOME, "bestly-agents", "insurance-filer")   # INS_BASE: rehearsals write under /tmp instead
RUNS = os.path.join(BASE, "runs")
LOG = os.path.join(BASE if os.environ.get("INS_BASE") else os.path.join(HOME, "logs"), "insurance-filer.log")
LOCK = os.path.join(BASE, "run.lock")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

MAX_JOBS_PER_RUN = 4
FILL_SECONDS = 480           # cooperative deadline inside the walker
JOB_HARD_SECONDS = 600       # watchdog thread: reports the job failed, kills the browser, exits
RUN_HARD_SECONDS = 3600          # a submit may wait on live questions to Jared (2026-10-29)


# ------------------------------------------------------------------------------------------------ plumbing
def log(*a):
    line = time.strftime("%Y-%m-%d %I:%M:%S %p ") + " ".join(str(x) for x in a)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line, flush=True)


_TOKEN = [None]


def token():
    if not _TOKEN[0]:
        _TOKEN[0] = os.environ.get("INS_TOKEN") or subprocess.run(["security", "find-generic-password", "-s", "bestly-db-watchdog", "-w"],
                                                                 capture_output=True, text=True).stdout.strip()
    return _TOKEN[0]


def http(url, body=None, headers=None, timeout=60):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return json.loads(raw.decode())
            except Exception:
                return raw
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s from %s: %s" % (e.code, url.split("?")[0], e.read().decode()[:300]))


def rpc(name, args=None):
    a = dict(args or {})
    a["p_token"] = token()
    return http("%s/rest/v1/rpc/%s" % (SB, name), a, {"apikey": ANON, "Authorization": "Bearer " + ANON})


def edge(op, **body):
    body["op"] = op
    return http("%s/functions/v1/insurance-filer" % SB, body, {"apikey": ANON, "x-ins-mac": token()}, timeout=120)


def beat(ok, summary):
    try:
        rpc("ins_mac_beat_t", {"p_ok": bool(ok), "p_summary": (summary or "")[:480]})
    except Exception as e:
        log("heartbeat failed:", e)


def done(job_id, status, result=None, error=None):
    try:
        return rpc("ins_mac_done_t", {"p_job": job_id, "p_status": status, "p_result": result or {}, "p_error": (error or None) and str(error)[:480]})
    except Exception as e:
        log("could not report job %s: %s" % (job_id, e))


def short_id():
    return time.strftime("%Y%m%d-%I%M%S%p").lower()


# ------------------------------------------------------------------------------------------------ photos in and out
def download_files(items, tmp):
    """items: [{path, name?}] -> list of local file paths, in order. Uses 10-minute signed URLs from the edge function."""
    paths = [i["path"] for i in items if i.get("path")]
    if not paths:
        return []
    urls = (edge("signed_urls", paths=paths) or {}).get("urls") or {}
    out = []
    for i, it in enumerate(items):
        u = urls.get(it.get("path"))
        if not u:
            continue
        ext = os.path.splitext(it["path"])[1] or ".jpg"
        name = re.sub(r"[^A-Za-z0-9._-]+", "-", it.get("name") or ("file-%d%s" % (i + 1, ext)))
        dest = os.path.join(tmp, name)
        with urllib.request.urlopen(u, timeout=90) as r, open(dest, "wb") as f:
            f.write(r.read())
        out.append(dest)
    return out


PHOTO_ORDER = {"after": 0, "guest_report": 1, "return": 2, "checkin": 3, "before": 4}


def photo_fetcher(job, tmp):
    def go():
        ph = [p for p in (job.get("photos") or []) if p.get("source") in PHOTO_ORDER]
        ph.sort(key=lambda p: PHOTO_ORDER[p["source"]])
        items = [{"path": p["path"], "name": "damage-photo-%d%s" % (n + 1, os.path.splitext(p["path"])[1] or ".jpg")} for n, p in enumerate(ph[:10])]
        return download_files(items, tmp)
    return go


# ------------------------------------------------------------------------------------------------ the browser
def new_context(p):
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1100, "height": 1500}, user_agent=UA)
    return b, ctx


def unknown_why(packet):
    return dict((u.get("key"), u.get("why")) for u in (packet.get("unknown") or []) if u.get("key"))


def live_ask(job):
    """File-based live question for the submit walk: writes inbox/q-<job>.json, waits up to 25 min for inbox/a-<job>.json
    ({"answer": "..."}; "" means skip). Relayed to Jared; later the Command Center card answers it. (2026-10-29)"""
    jid = (job.get("id") or "x")[:8]
    qf, af = os.path.join(HERE, "inbox", "q-%s.json" % jid), os.path.join(HERE, "inbox", "a-%s.json" % jid)

    def ask(question, options):
        for x in (af,):
            if os.path.exists(x):
                os.remove(x)
        json.dump({"question": question, "options": options, "at": time.strftime("%I:%M %p")}, open(qf, "w"))
        log("ASKING JARED: %s %s" % (question, options or ""))
        end = time.time() + 25 * 60
        while time.time() < end:
            if os.path.exists(af):
                try:
                    raw = json.load(open(af))
                    a = raw if raw.get("set") else raw.get("answer")
                except Exception:
                    time.sleep(1)
                    continue
                os.remove(af)
                os.remove(qf)
                log("JARED ANSWERED: %s" % a)
                return a
            time.sleep(2)
        os.remove(qf)
        return None
    return ask


def run_walk(job, mode, url, packet, tmp, approved_hash=None, upload_shots=True, seconds=FILL_SECONDS, consent_before_tap=True, with_photos=True):
    """Open the form and walk it. -> walker result dict. The browser is always closed."""
    from playwright.sync_api import sync_playwright
    import walker
    run_dir = os.path.join(RUNS, short_id() + "-" + (job.get("id") or "dry")[:8])
    os.makedirs(run_dir, exist_ok=True)
    oc_id = job.get("oc_id")
    pre = "%s-%s" % (mode, short_id())

    def on_shot(path, name):
        if not (upload_shots and oc_id):
            return
        with open(path, "rb") as f:
            edge("shot_put", oc_id=oc_id, name="%s-%s" % (pre, name), png_b64=base64.b64encode(f.read()).decode())

    with sync_playwright() as p:
        b, ctx = new_context(p)
        try:
            page = ctx.new_page()
            walker.open_claim(page, url, log)
            values = dict(packet.get("values") or {})
            ov = os.path.join(HERE, "inbox", "overrides-%s.json" % (oc_id or "x")[:8])
            if os.path.exists(ov):                   # facts Jared corrected in chat for this claim (e.g. the policyholder's name)
                values.update(json.load(open(ov)))
                log("overrides from Jared: %s" % ", ".join(sorted(json.load(open(ov)))))
            w = walker.Walker(page, values, mode=mode, shots_dir=run_dir, consent_before_tap=consent_before_tap,
                              fetch_photos=photo_fetcher(job, tmp) if (with_photos and job.get("photos")) else None,
                              packet_hash=packet.get("hash"), approved_hash=approved_hash,
                              turo_claim_no=(packet.get("values") or {}).get("turo.claim_no"), unknown_why=unknown_why(packet),
                              on_shot=on_shot, log=log, seconds=seconds, ask=live_ask(job) if mode == "submit" else None)
            res = w.run()
            res["run_dir"] = run_dir
            return res
        finally:
            try:
                b.close()
            except Exception:
                pass


# ------------------------------------------------------------------------------------------------ jobs
def job_fill(job):
    packet = job.get("packet") or {}
    insurer = job.get("insurer") or {}
    url = insurer.get("claim_url")
    if not url:
        return done(job["id"], "failed", {}, "No claim URL for this insurer")
    with tempfile.TemporaryDirectory() as tmp:
        res = run_walk(job, "dry" if job.get("dry") else "fill", url, packet, tmp, consent_before_tap=job.get("consent_before_tap", True))
    status = "blocked" if res.get("stop") in ("blocked", "error") else "done"
    result = dict((k, res.get(k)) for k in ("url", "reached", "consent_clicked", "consent", "screens", "filled", "left_blank", "shots", "photos_uploaded", "blocked_reason"))
    log("fill %s: %s, %d filled, %d left blank, reached %s%s" % (job["id"][:8], status, len(res.get("filled") or []), len(res.get("left_blank") or []),
                                                                res.get("reached"), (" (" + res["blocked_reason"] + ")") if res.get("blocked_reason") else ""))
    return done(job["id"], status, result)


def job_submit(job):
    packet = job.get("packet") or {}
    insurer = job.get("insurer") or {}
    url = insurer.get("claim_url")
    approved = job.get("approved_hash")
    if not url or not approved:
        return done(job["id"], "failed", {"not_sent": True}, "Missing claim URL or approved hash; nothing was sent")
    if packet.get("hash") != approved:
        return done(job["id"], "failed", {"not_sent": True, "blocked_reason": "The facts changed after you approved."}, "stale packet; nothing was sent")
    with tempfile.TemporaryDirectory() as tmp:
        res = run_walk(job, "submit", url, packet, tmp, approved_hash=approved, consent_before_tap=True)
    if res.get("reached") == "submitted":
        log("submit %s: sent, claim number %s" % (job["id"][:8], res.get("claim_no")))
        return done(job["id"], "done", {"claim_no": res.get("claim_no"), "confirmation_text": res.get("confirmation_text"), "shots": res.get("shots"),
                                        "url": res.get("url")})
    # we stopped before the click: tell the database it is safe to start over
    log("submit %s: NOT sent (%s)" % (job["id"][:8], res.get("blocked_reason")))
    return done(job["id"], "failed", {"not_sent": bool(res.get("not_sent")), "blocked_reason": res.get("blocked_reason"), "shots": res.get("shots")},
                res.get("blocked_reason") or "did not reach the send button")


def osascript(script, *args, **kw):
    return subprocess.run(["osascript", os.path.join(HERE, script)] + [str(a) for a in args], capture_output=True, text=True, timeout=kw.get("timeout", 120))


def job_send_mail(job):
    d = job.get("draft") or {}
    atts = job.get("attachments") or []
    sender = (job.get("sender") or "jared@bestly.tech")
    if sender != "jared@bestly.tech":
        return done(job["id"], "failed", {}, "Refusing to send from %s" % sender)
    if job.get("dry"):
        return done(job["id"], "failed", {}, "dry job; nothing sent")
    with tempfile.TemporaryDirectory() as tmp:
        files = download_files([{"path": a["path"], "name": a.get("name")} for a in atts], tmp)
        if len(files) != len(atts):
            return done(job["id"], "failed", {"verified": False}, "Could not download all %d attachments (%d)" % (len(atts), len(files)))
        body_path = os.path.join(tmp, "body.txt")
        with open(body_path, "w", encoding="utf-8") as f:
            f.write(d.get("body") or "")
        r = osascript("send-bestly-multi.applescript", d["to"], d["subject"], body_path, d.get("cc") or "-", *files, timeout=180)
        if r.returncode != 0 or "sent" not in r.stdout:
            return done(job["id"], "failed", {"verified": False}, "Mail did not accept the message: %s" % (r.stderr or r.stdout)[:300])
    # Mail says "sent" before the server has it. Wait for it to show up in Sent.
    verified = False
    for _ in range(18):
        time.sleep(5)
        v = osascript("verify-sent.applescript", d["to"], d["subject"], 20, timeout=60)
        if v.stdout.strip().startswith("found:"):
            verified = True
            break
    log("send_mail %s to %s: %s, %d attachment(s)" % (job["id"][:8], d.get("to"), "in Sent" if verified else "NOT confirmed", len(atts)))
    return done(job["id"], "done" if verified else "failed", {"verified": verified, "attachments": len(atts)}, None if verified else "not found in Sent after 90 seconds")


def job_attach_fetch(job):
    pl = job.get("payload") or {}
    oc_id = job.get("oc_id")
    folder = os.path.join(BASE, "inbox", (oc_id or "x")[:8], short_id())
    os.makedirs(folder, exist_ok=True)
    r = osascript("fetch-attachments.applescript", pl.get("message_id") or "", pl.get("subject") or "", folder, timeout=120)
    names = [n for n in r.stdout.splitlines() if n.strip() and n.strip() != "none"]
    uploaded = 0
    if pl.get("estimate"):
        for n in names:
            ext = os.path.splitext(n)[1].lower()
            mime = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(ext)
            path = os.path.join(folder, n)
            if mime and os.path.getsize(path) < 11_000_000:
                with open(path, "rb") as f:
                    edge("doc_put", oc_id=oc_id, name=n, mime=mime, source="estimate_doc", b64=base64.b64encode(f.read()).decode())
                uploaded += 1
    log("attach_fetch %s: saved %d, uploaded %d" % (job["id"][:8], len(names), uploaded))
    return done(job["id"], "done" if names else "failed", {"saved": len(names), "uploaded": uploaded, "names": names}, None if names else "no attachments found")


JOBS = {"fill": job_fill, "submit": job_submit, "send_mail": job_send_mail, "attach_fetch": job_attach_fetch}


class Watchdog(object):
    """If a job hangs, say so, then end the process (and the browser with it). A hung submit is reported as unknown, never retried."""
    def __init__(self, job, seconds):
        self.job = job
        self.t = threading.Timer(seconds, self.fire)
        self.t.daemon = True

    def fire(self):
        log("watchdog: job %s (%s) hung" % (self.job["id"][:8], self.job["kind"]))
        done(self.job["id"], "failed", {"stuck": True, "not_sent": self.job["kind"] == "fill"}, "the filer hung and was stopped")
        beat(False, "a %s job hung and was stopped" % self.job["kind"])
        os._exit(3)

    def __enter__(self):
        self.t.start()
        return self

    def __exit__(self, *a):
        self.t.cancel()


def main_run():
    os.makedirs(BASE, exist_ok=True)
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("another run holds the lock; skipping")
        return 0
    threading.Timer(RUN_HARD_SECONDS, lambda: os._exit(4)).start()
    ran = []
    try:
        for _ in range(MAX_JOBS_PER_RUN):
            t = rpc("ins_mac_take") or {}
            job = t.get("job")
            if not job:
                break
            fn = JOBS.get(job["kind"])
            if not fn:
                done(job["id"], "failed", {}, "this filer does not do '%s'" % job["kind"])
                continue
            try:
                with Watchdog(job, 3300 if job["kind"] == "submit" else JOB_HARD_SECONDS):   # submit can wait on live questions
                    fn(job)
                ran.append(job["kind"])
            except Exception as e:
                log("job %s (%s) crashed: %s" % (job["id"][:8], job["kind"], e))
                log(traceback.format_exc())
                # a submit/send that crashed may have gone through: report it as unknown (the database will not retry it)
                done(job["id"], "failed", {"not_sent": job["kind"] == "fill"}, "crashed: %s" % str(e)[:200])
        beat(True, ("ran " + ", ".join(ran)) if ran else "idle, nothing waiting")
        return 0
    except Exception as e:
        log("run failed:", e)
        log(traceback.format_exc())
        beat(False, "run failed: %s" % str(e)[:200])
        return 1


# ------------------------------------------------------------------------------------------------ rehearsal
def dry_case(case_id, packet_file=None, url=None, show=True):
    """A rehearsal for one case. Reads the packet (from Postgres, or a saved JSON), fills the page, NEVER consents, NEVER submits,
    writes nothing to Supabase and uploads nothing. -> result dict."""
    if packet_file:
        data = json.load(open(packet_file))
    else:
        data = rpc("ins_mac_packet_t", {"p_case": case_id})
    packet = data.get("packet") or data
    insurer = data.get("insurer") or {}
    target = url or insurer.get("claim_url") or "https://www.progressive.com/support/report-a-claim/"
    log("REHEARSAL (cannot submit, cannot consent) for case %s -> %s" % (case_id, target))
    with tempfile.TemporaryDirectory() as tmp:
        res = run_walk({"id": "dry-" + (case_id or "x")[:8], "oc_id": None}, "dry", target, packet, tmp, upload_shots=False, with_photos=False, seconds=240)
    known = packet.get("values") or {}
    summary = {
        "packet_fields": len(known), "packet_unknown": [u.get("key") for u in packet.get("unknown") or []],
        "reached": res.get("reached"), "blocked_reason": res.get("blocked_reason"),
        "filled": [(f.get("label"), f.get("value")) for f in res.get("filled") or []],
        "left_blank": [(b.get("label"), b.get("why")) for b in res.get("left_blank") or []],
        "screens": [(s["n"], s.get("step_key"), s.get("question")) for s in res.get("screens") or []],
        "consent_clicked": res.get("consent_clicked"), "shots_dir": res.get("run_dir"),
    }
    if show:
        print(json.dumps(summary, indent=2))
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-case", help="rehearse this claim_cases id: never consents, never submits, writes nothing")
    ap.add_argument("--packet", help="use a saved packet JSON instead of asking Postgres")
    ap.add_argument("--url", help="fill this page instead of the insurer's claim URL (a saved copy, or a stand-in)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.path.insert(0, os.path.join(HERE, "tests"))
        import selftest
        return selftest.main()
    if a.dry_case:
        dry_case(a.dry_case, a.packet, a.url)
        return 0
    return main_run()


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    os._exit(code or 0)
