"""Stella, the queue (every 10 minutes).

1. Drafts a reply for every new written review (free AI first: FreeLLM -> Groq -> Cloudflare).
   Under 5 stars, or anything about damage / smoke / FSD / claims, goes to Jared as needs_jared with a push signed by Stella.
   A plain 5-star is marked auto_ready; it only posts by itself when reputation_settings.auto_post_5star is on (Jared's switch).
2. Posts replies Jared approved (status approved). Nothing else ever posts.
3. Guest-rating watch: tracks the 10-day window to rate each guest, drafts the rating one day before the deadline,
   skips trips with an open Claims Closer case.
4. Never-host-cancel guard: a live Costco booking may not overlap a booked trip.

Flags: --dry  draft and print, write/post nothing
"""
import datetime
import json
import re
import subprocess
from zoneinfo import ZoneInfo

import freellm
import lib

LA = ZoneInfo("America/Los_Angeles")
VENV_PY = "/opt/bestly/turo-watch/.venv/bin/python"
READER = "/opt/bestly/cron/tools/turo_reviews_reader.py"
URL = "https://bestly.tech/admin/turo?tab=reviews"
SIGN = "Hope to host you again soon!"
RISKY = re.compile(r"damage|dent|scratch|smok|smell|odor|dirty|claim|insurance|ticket|toll|\bfsd\b|full self|self.?driv|autopilot|safety|strike|disabled|"
                   r"refund|rude|unsafe|broke|problem|issue|complain|never again|disappoint", re.I)
EMOJI = re.compile("[\U0001F000-\U0001FFFF☀-➿️]")
STYLE = (
    "You write public replies from Jared, a Turo host, to a guest's review of his Tesla Model 3. Rules: 2 to 3 short lines, plain and warm, "
    "first person, use the guest's first name once. Mention one or two true trip details from FACTS and what the guest praised. "
    "Describe trip length only in the general terms FACTS gives you (a couple of days, a week, two weeks) — never state an exact number of nights. "
    "Never invent details. No emoji. At most two exclamation marks. Never blame anyone and never mention damage, claims, other guests, "
    "fines or technical faults. End with exactly: " + SIGN + "\n"
    "Example of the voice: Thanks so much, GianPaula! Glad the late-night LAX pickup and your week with the Model 3 went smoothly. "
    "Fast replies are a big deal to me, so that means a lot. " + SIGN + "\nReturn only the reply text."
)


def short(s, n):
    """Cut at a word boundary. Never an ellipsis."""
    s = " ".join((s or "").split())
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(" ", 1)[0].rstrip(",;:- ")
    return cut + ("" if cut.endswith((".", "!", "?")) else ".")


def settings():
    return (lib.get("reputation_settings", "select=*&id=eq.true") or [{}])[0]


def notify(title, body, kind, dedupe, url=URL):
    return lib.rpc("rep_notify", p_agent="stella", p_title=title, p_body=body, p_kind=kind, p_url=url, p_dedupe=dedupe)


def patch(table, where, body):
    return lib._req("PATCH", f"/rest/v1/{table}?{where}", body)


def duration_phrase(n):
    """Round a night count to how a person would actually describe a trip, never an exact number."""
    if not n or n < 1:
        return None
    if n == 1:
        return "an overnight trip"
    if n <= 3:
        return "a few days"
    if n <= 9:
        return "about a week"
    if n <= 13:
        return "just over a week"
    if n <= 20:
        return "about two weeks"
    if n <= 27:
        return "about three weeks"
    return "about a month"


def trip_facts(r):
    t = r.get("trip") or {}
    bits = []
    if t:
        bits.append("LAX airport pickup" if t.get("lax") else "home pickup, not an airport")
        d = duration_phrase(t.get("nights"))
        if d:
            bits.append(d)
    bits.append(r.get("vehicle") or "Tesla Model 3 2020")
    return "; ".join(bits)


def norm(t):
    """Plain ASCII punctuation: FreeLLM models like narrow no-break spaces and non-breaking hyphens."""
    for a, b in (("\u202f", " "), ("\u00a0", " "), ("\u2011", "-"), ("\u2010", "-"), ("\u2014", ","), ("\u2013", "-"), ("\u2019", "'"), ("\u2018", "'"), ("\u201c", '"'), ("\u201d", '"')):
        t = t.replace(a, b)
    return t.strip()


def clean_reply(txt, name):
    txt = re.sub(r"<think>.*?</think>", "", txt or "", flags=re.S).strip().strip('"').strip()
    txt = EMOJI.sub("", txt).replace("—", ",").replace("–", "-")
    return txt


def valid_reply(txt):
    return 60 <= len(txt) <= 460 and txt.endswith(SIGN) and txt.count("!") <= 3 and not EMOJI.search(txt)


def draft_reply(r):
    name = r["guest_first"]
    user = (f"Guest first name: {name}\nStars: {r.get('stars')}\nReview: {r.get('text')}\nFACTS: {trip_facts(r)}\n"
            + (f"Jared's note for this reply: {r['jared_notes']}\n" if r.get("jared_notes") else "")
            + (f"The previous draft was: {r['draft']}\nWrite a different one.\n" if r.get("draft") and r["status"] == "redraft" else ""))
    for _ in range(2):
        try:
            msg, prov = freellm.chat([{"role": "system", "content": STYLE}, {"role": "user", "content": user}], max_tokens=300)
            txt = clean_reply(msg.get("content"), name)
            if valid_reply(txt):
                return txt, f"stella via {prov}"
        except Exception:  # noqa: BLE001
            pass
    return f"Thanks so much, {name}! Really glad the trip went well and appreciate the kind words. {SIGN}", "stella (template, AI unavailable)"


def run_drafts(dry):
    rows = lib.get("turo_reviews", "select=*&kind=eq.review&status=in.(new,redraft)&text=not.is.null&order=review_date.desc&limit=6") or []
    cfg, n = settings(), 0
    for r in rows:
        txt, by = draft_reply(r)
        risky = bool(RISKY.search(r.get("text") or ""))
        under5 = r.get("stars") is not None and r["stars"] < 5
        if r["status"] == "redraft":
            status, reason = "needs_jared", r.get("needs_reason") or "Redrafted with your notes"
        elif under5:
            status, reason = "needs_jared", f"{r['stars']} stars, nothing posts without your tap"
        elif risky:
            status, reason = "needs_jared", "Mentions something sensitive, check the wording"
        else:
            status, reason = "auto_ready", "5 stars" + ("" if cfg.get("auto_post_5star") else ", auto-post is off")
        if dry:
            print(f"[dry] {r['guest_first']} {r['review_date']} {r['stars']}* -> {status}: {txt}")
            continue
        patch("turo_reviews", f"id=eq.{r['id']}", {"draft": txt, "draft_by": by, "draft_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                                   "status": status, "needs_reason": reason, "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
        n += 1
        if under5 and r["status"] == "new":
            notify(f"{r['guest_first']} left {r['stars']} stars",
                   f"{short(r['text'], 160)} Draft reply is ready for your tap.", "under5", f"under5-{r['id']}")
        elif status == "needs_jared" and r["status"] == "new":
            notify(f"{r['guest_first']}'s review needs a look", short(r["text"], 160), "recap", f"review-look-{r['id']}")
    return n


def post_reply(r):
    p = subprocess.run([VENV_PY, READER, "--post"], input=json.dumps({"guest": r["guest_first"], "date": r["review_date"], "text": r["draft"]}),
                       capture_output=True, text=True, timeout=240)
    line = [x for x in p.stdout.splitlines() if x.startswith("{")]
    return json.loads(line[-1]) if line else {"ok": False, "error": (p.stderr or "no output")[-300:]}


def run_posts(dry):
    cfg = settings()
    want = ["approved"] + (["auto_ready"] if cfg.get("auto_post_5star") else [])
    rows = lib.get("turo_reviews", f"select=*&kind=eq.review&status=in.({','.join(want)})&draft=not.is.null&order=review_date.asc&limit=3") or []
    done = 0
    for r in rows:
        if dry:
            print(f"[dry] would post {r['status']} reply to {r['guest_first']} {r['review_date']}: {r['draft']}")
            continue
        if r["status"] == "auto_ready" and (r.get("stars") != 5 or RISKY.search(r.get("text") or "")):
            continue
        res = post_reply(r)
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if res.get("ok"):
            patch("turo_reviews", f"id=eq.{r['id']}", {"status": "posted" if r["status"] == "approved" else "auto_posted", "has_response": True,
                                                       "response_text": r["draft"], "posted_at": now, "post_error": None, "updated_at": now})
            notify(f"Replied to {r['guest_first']}", short(r["draft"], 200), "recap", f"posted-{r['id']}")
            done += 1
        else:
            patch("turo_reviews", f"id=eq.{r['id']}", {"status": "failed", "post_error": (res.get("error") or "unknown")[:300], "updated_at": now})
            notify(f"Could not post reply to {r['guest_first']}", (res.get("error") or "unknown")[:200], "recap", f"postfail-{r['id']}-{now[:13]}")
    return done


def rating_draft(g, trip, msgs):
    nights = max(1, round((datetime.datetime.fromisoformat(trip["ends_at"]) - datetime.datetime.fromisoformat(trip["starts_at"])).total_seconds() / 86400))
    user = (f"Guest first name: {g['guest_first']}\nTrip: {nights} night(s), {'LAX airport pickup' if trip.get('airport_code') == 'LAX' else 'home pickup'}\n"
            f"Guest messages sent during the trip: {msgs}\nOpen claims on this trip: none.")
    sysmsg = ("Draft a short public review of a Turo guest, written by their host Jared. 1 or 2 sentences, plain, warm, factual. "
              "Use only what FACTS show: you may say the trip was smooth and the guest is welcome back. Do not claim the car came back clean, "
              "on time or undamaged, and do not invent anything. No emoji. Return only the review text.")
    try:
        msg, _ = freellm.chat([{"role": "system", "content": sysmsg}, {"role": "user", "content": user}], max_tokens=120)
        txt = norm(EMOJI.sub("", re.sub(r"<think>.*?</think>", "", msg.get("content") or "", flags=re.S).strip().strip('"')))
        if 20 <= len(txt) <= 300:
            return txt
    except Exception:  # noqa: BLE001
        pass
    return f"{g['guest_first']} was easy to host and the trip went smoothly. Welcome back anytime."


def run_ratings(dry):
    if dry:
        return 0
    sync = lib.rpc("rep_guest_sync") or {}
    n = 0
    for g in sync.get("need_draft", []):
        t = (lib.get("turo_trips", f"select=starts_at,ends_at,airport_code&reservation_id=eq.{g['reservation_id']}") or [None])[0]
        if not t:
            continue
        msgs = len(lib.get("turo_inbox", f"select=message_id&reservation_id=eq.{g['reservation_id']}&role=eq.guest") or [])
        txt = rating_draft(g, t, msgs)
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        patch("turo_guest_ratings", f"reservation_id=eq.{g['reservation_id']}", {"draft": txt, "draft_at": now, "status": "draft_ready", "notified_at": now, "updated_at": now})
        d = datetime.date.fromisoformat(g["deadline"])
        notify(f"Rating for {g['guest_first']} is ready", f"Due {d.strftime('%b')} {d.day}. Draft is in Turo Watch for you to check and post.",
               "guest_rating_ready", f"rating-{g['reservation_id']}")
        n += 1
    return n


def run_guard(dry):
    """A live Costco booking may never overlap a booked trip (a host cancel would cost All-Star)."""
    ev = lib.get("fleet_maint_events", "select=id,value,text&kind=eq.booking&order=at.desc&limit=20") or []
    trips = lib.get("turo_trips", "select=reservation_id,guest_first,starts_at,ends_at&status=eq.BOOKED") or []
    bad = 0
    for e in ev:
        v = e.get("value") or {}
        if v.get("mode") != "live" or not v.get("start"):
            continue
        s, en = datetime.datetime.fromisoformat(v["start"]), datetime.datetime.fromisoformat(v["end"])
        for t in trips:
            if s < datetime.datetime.fromisoformat(t["ends_at"]) and en > datetime.datetime.fromisoformat(t["starts_at"]):
                bad += 1
                if not dry:
                    notify("Tire appointment clashes with a trip", f"The booking overlaps {t['guest_first']}'s trip. Move it, do not cancel the trip.",
                           "allostar_risk", f"clash-{e['id']}-{t['reservation_id']}")
    return bad


def main(argv):
    dry = "--dry" in argv
    d = run_drafts(dry)
    p = run_posts(dry)
    r = run_ratings(dry)
    g = run_guard(dry)
    return f"ok: drafted {d}, posted {p}, rating drafts {r}, clashes {g}"
