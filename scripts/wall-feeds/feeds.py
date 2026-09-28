#!/usr/bin/env python3
"""Bestly wall feeds (Pi side) — /opt/bestly/feeds/feeds.py, run by bestly-wall-feeds.timer every 30 min.

Plan: docs/wall-round3-2026-09-27-opusplan.md (W3). Fills what only the Pi can reach:
  mail   USPS Informed Delivery daily digests in Jared's iCloud inbox (IMAP, the Vault app password served by
         wall_pi_icloud). Each photographed mail piece is OCR'd locally (tesseract), the recipient's name/address
         and long numbers are stripped, and only that text is posted (wall_pi_mail_put). The free AI in the
         wall-feeds edge function turns it into "DMV letter" and then drops the text. Images never leave the Pi
         and are never written to disk except a temp file that is deleted right away.
  habits iPhone steps from the Home Assistant companion app (sensor.jareds_iphone_steps), streak = days in a row
         at or over the goal. Posted as {available:false} when the sensor is off.
Messages are read with BODY.PEEK, so nothing is marked read. Scout watchdog: wall_feeds_watch (wall.feeds.mail/habits).
"""
import datetime as dt
import email
import imaplib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from email.utils import parsedate_to_datetime

ROOT = "/opt/bestly/feeds"
STATE = os.path.join(ROOT, "state.json")
REPORT = "/opt/bestly/wall/.report.json"          # {supabase_url, agent_key} (shared with the wall server, read-only)
PUB = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
HA_URL = "http://127.0.0.1:8123"
TZ = dt.timezone(dt.timedelta(hours=-7))           # only used to name days; LA date comes from the digest itself
STEP_GOAL = 8000
MAX_OCR_PER_RUN = 8
REDACT = re.compile(r"(jared|best\b|milo|kings|k1ngs|kinos|apt\b|apt\s*20|205|90069|733|los ang|angeles ca)", re.I)


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def rpc(fn, args, timeout=20):
    cfg = json.load(open(REPORT))
    req = urllib.request.Request(cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/" + fn,
                                 data=json.dumps({**args, "p_token": cfg["agent_key"]}).encode(),
                                 headers={"Content-Type": "application/json", "apikey": PUB, "Authorization": "Bearer " + PUB})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def load_state():
    try:
        return json.load(open(STATE))
    except Exception:
        return {"done": {}, "steps": {}}


def save_state(s):
    tmp = STATE + ".tmp"
    json.dump(s, open(tmp, "w"))
    os.replace(tmp, STATE)


def ocr(jpg: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".jpg", dir="/dev/shm" if os.path.isdir("/dev/shm") else None) as f:
        f.write(jpg)
        f.flush()
        r = subprocess.run(["nice", "-n", "15", "tesseract", f.name, "-", "--psm", "6"], capture_output=True, text=True,
                           timeout=240, env={**os.environ, "OMP_THREAD_LIMIT": "1"})
    lines = []
    for ln in r.stdout.splitlines():
        ln = re.sub(r"\s+", " ", ln).strip()
        if len(ln) < 3 or REDACT.search(ln):
            continue
        ln = re.sub(r"\d[\d\s-]{5,}\d", "#", ln)        # account / tracking-like numbers
        if sum(c.isalpha() for c in ln) < 3:
            continue
        lines.append(ln)
    return "\n".join(lines)[:1400]


def html_text(h):
    h = re.sub(r"(?is)<(style|script).*?</\1>", " ", h)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h)).strip()


def digest_day(msg, text):
    m = re.search(r"Today's Deliveries:\s*(\d{2})/(\d{2})/(\d{4})", text)
    if m:
        return f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
    m = re.search(r"Digest for \w+, (\d{1,2})/(\d{1,2})", msg.get("Subject", ""))
    d = parsedate_to_datetime(msg["Date"]).astimezone(TZ)
    if m:
        return f"{d.year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return d.strftime("%Y-%m-%d")


def parcels_from(text):
    """Best-effort: the digest's PACKAGES section (sender + expected day) when it lists any."""
    sec = text.split("PACKAGES", 1)[1] if "PACKAGES" in text else ""
    sec = sec.split("Informed Delivery ®", 1)[0][:3000]
    if not sec or "No packages" in sec:
        return []
    out = []
    for m in re.finditer(r"(?:FROM|From):\s*([A-Z0-9][^|]{1,40}?)\s+(?:Expected Delivery(?: Day| by| on)?:?\s*([A-Z][a-z]+day,?\s+[A-Z][a-z]+\s+\d{1,2}|[A-Z][a-z]+day|\d{1,2}/\d{1,2}))?", sec):
        frm = m.group(1).strip()
        if REDACT.search(frm):
            continue
        out.append({"from": frm, "eta": m.group(2), "status": "On the way"})
    if not out:
        for m in re.finditer(r"Expected Delivery(?: Day| by| on)?:?\s*([A-Z][a-z]+day,?\s+[A-Z][a-z]+\s+\d{1,2}|[A-Z][a-z]+day)", sec):
            out.append({"from": None, "eta": m.group(1), "status": "On the way"})
    return out[:6]


def mail(state):
    c = rpc("wall_pi_icloud", {})
    M = imaplib.IMAP4_SSL("imap.mail.me.com", 993, timeout=40)
    try:
        M.login(c["user"], c["password"])
        M.select("INBOX", readonly=True)
        since = (dt.date.today() - dt.timedelta(days=8)).strftime("%d-%b-%Y")
        _, d = M.search(None, f'(FROM "informeddelivery" SINCE "{since}")')
        ids = d[0].split()
        digests, budget = [], MAX_OCR_PER_RUN
        for i in reversed(ids):                         # newest first, so today's mail gets OCR budget first
            _, dd = M.fetch(i, "(BODY.PEEK[])")
            msg = email.message_from_bytes(dd[0][1])
            key = (msg.get("Message-ID") or f"uid{i.decode()}").strip("<> ")[:180]
            html, imgs = "", {}
            for part in msg.walk():
                ct = part.get_content_type()
                if ct == "text/html":
                    html = part.get_payload(decode=True).decode("utf-8", "replace")
                elif ct.startswith("image/") and part.get("Content-ID"):
                    imgs[part.get("Content-ID").strip("<> ")] = part.get_payload(decode=True)
            text = html_text(html)
            m = re.search(r"You have\s+(\d+)\s+mailpiece\(s\)\s+and\s+(\d+)\s+inbound package", text)
            day = digest_day(msg, text)
            dg = {"key": key, "day": day, "mailpieces": int(m.group(1)) if m else None,
                  "packages": int(m.group(2)) if m else None, "pieces": [], "parcels": parcels_from(text)}
            # only the scans USPS labels "Mailpiece Image" (the rest are ads riding along)
            cids = [re.search(r'src="cid:([^"]+)"', t).group(1) for t in re.findall(r"<img[^>]+>", html)
                    if 'alt="Mailpiece Image"' in t and 'src="cid:' in t]
            done = set(state["done"].get(key, []))
            for n, cid in enumerate(cids, 1):
                if str(n) in done or cid not in imgs:
                    continue
                if budget <= 0:
                    break
                budget -= 1
                try:
                    txt = ocr(imgs[cid])
                except Exception as e:
                    log("ocr failed", key[:20], n, type(e).__name__)
                    continue
                dg["pieces"].append({"n": n, "ocr": txt or "(unreadable)"})
                done.add(str(n))
            state["done"][key] = sorted(done)
            digests.append(dg)
        # forget digests older than 12 days
        keep = {d["key"] for d in digests}
        state["done"] = {k: v for k, v in state["done"].items() if k in keep}
        r = rpc("wall_pi_mail_put", {"p_digests": digests}, timeout=30)
        log("mail", len(digests), "digests,", sum(len(d["pieces"]) for d in digests), "new pieces ->", r)
    finally:
        try:
            M.logout()
        except Exception:
            pass


def ha(path):
    tok = None
    for line in open("/home/pi/scripts/.env"):
        if line.startswith("HA_TOKEN="):
            tok = line.split("=", 1)[1].strip().strip('"').strip("'")
    req = urllib.request.Request(HA_URL + path, headers={"Authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def habits(state):
    st = ha("/api/states/sensor.jareds_iphone_steps")
    val = st.get("state")
    if val in (None, "unknown", "unavailable", ""):
        rpc("wall_pi_feed_put", {"p_kind": "habits", "p_data": {
            "available": False, "reason": "The iPhone step sensor is off in the Home Assistant app (Motion & Fitness permission)."}})
        log("habits: steps sensor unavailable")
        return
    steps = int(float(val))
    today = dt.date.today().isoformat()
    hist = state.setdefault("steps", {})
    hist[today] = max(steps, hist.get(today, 0))
    # backfill daily maxima from HA history (10 days) so a fresh Pi still knows the streak
    try:
        start = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=10)).isoformat()
        h = ha(f"/api/history/period/{start}?filter_entity_id=sensor.jareds_iphone_steps&minimal_response&no_attributes")
        for p in (h[0] if h else []):
            try:
                d = dt.datetime.fromisoformat(p["last_changed"]).astimezone().date().isoformat()
                hist[d] = max(hist.get(d, 0), int(float(p["state"])))
            except Exception:
                pass
    except Exception as e:
        log("habits history", type(e).__name__)
    streak, d = 0, dt.date.today()
    if hist.get(d.isoformat(), 0) < STEP_GOAL:
        d -= dt.timedelta(days=1)                    # today still in progress: count from yesterday
    while hist.get(d.isoformat(), 0) >= STEP_GOAL:
        streak += 1
        d -= dt.timedelta(days=1)
    state["steps"] = {k: v for k, v in hist.items() if k >= (dt.date.today() - dt.timedelta(days=60)).isoformat()}
    # Move / Exercise / Stand are Apple Health rings; the HA companion app doesn't expose them.
    rpc("wall_pi_feed_put", {"p_kind": "habits", "p_data": {
        "steps": steps, "move": None, "exercise": None, "stand": None, "streak": streak, "goal": STEP_GOAL}})
    log("habits", steps, "steps, streak", streak)


def main():
    state = load_state()
    rc = 0
    for name, fn in (("habits", habits), ("mail", mail)):
        try:
            fn(state)
        except Exception as e:
            rc = 1
            msg = f"{type(e).__name__}: {str(e)[:200]}"
            log(name, "failed", msg)
            try:
                if name == "mail":
                    rpc("wall_pi_mail_put", {"p_digests": [], "p_error": msg})
                else:
                    rpc("wall_pi_feed_put", {"p_kind": name, "p_data": None, "p_error": msg})
            except Exception:
                pass
        save_state(state)
    sys.exit(rc)


if __name__ == "__main__":
    main()
