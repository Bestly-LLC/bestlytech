"""SkyTouch morning check (bestly-pi, 8:11 AM Pacific daily). No AI, free.

Installed as /opt/bestly/cron/jobs/skytouch_morning.py; run by /opt/bestly/cron/run.sh skytouch_morning.
Replaces the Claude scheduled task "SkyTouch morning availability check" (trig_01KvqCmUx3AEbEYnpkTrNWfP, left disabled as the fallback).

  1. Asks Jared for today's open hours, ONLY on his own text thread, ONLY when "Text me each morning" is on (ships off), at most once a day.
     His reply is picked up by the front desk job (skytouch_triage), which saves it as today's availability.
  2. Reads Jared's Google Calendar through the private iCal links he saves on /admin/skytouch (read only) for the next 7 days.
  3. Looks at client texts from the last 24 hours that were handled or flagged. Where a booking was talked about but nothing on the
     calendar matches the client, it makes a "calendar gap" card. It never adds or changes a calendar event and never texts a client.
  4. Saves the brief for the SkyTouch page and a heartbeat (counts only).

When paused it writes one "paused" heartbeat and exits before touching Gmail. Flags: --dry (read only, nothing written or sent),
--force-on (pretend the switches are on; implies --dry).
"""
import re
from datetime import datetime, timedelta

import lib  # noqa: E402

from jobs import skytouch_common as C  # noqa: E402
from jobs import skytouch_ical as ICAL  # noqa: E402

JOB = "skytouch_morning"
SLUG = "skytouch-morning"

_CONFIRM = re.compile(r"\b(booked|confirmed?|see you|locked in|lock it in|you'?re set|you are set|works for me|sounds good|"
                      r"i'?ll be there|on my way|ok(ay)? for)\b", re.I)


def mentions_booking(texts):
    t = " \n".join(texts)
    if C._SEXUAL.search(t) or C._ROOF.search(t):
        return False
    has_when = bool(C._TIME.search(t))
    has_what = bool(C.service_of(t) or C.duration_of(t) or C._SERVICE.search(t))
    return (has_when and (has_what or bool(_CONFIRM.search(t)))) or (bool(_CONFIRM.search(t)) and has_what)


def _on_calendar(events, name, number):
    last4 = number[-4:] if number else ""
    n = (name or "").lower()
    for e in events:
        s = e["summary"].lower()
        if (n and n in s) or (last4 and last4 in s):
            return True
    return False


def _when(e):
    if e["all_day"]:
        return "All day"
    return C.fmt_time(e["start"]) + " to " + C.fmt_time(e["end"])


def main(argv):
    force = "--force-on" in argv
    dry = "--dry" in argv or force

    g = C.gate(lib, JOB)
    if not (g["job_on"] or force):
        if not dry:
            C.beat(lib, SLUG, True, "paused: switched off on the SkyTouch page")
        return "skip: paused (switched off on /admin/skytouch)"

    pw = C.secret(lib, "pi:skytouch:gmail_app_password")
    if not pw:
        if not dry:
            C.beat(lib, SLUG, False, "skip: Gmail not connected yet")
        return "skip: Gmail not connected yet (save the app password on /admin/skytouch)"

    now = datetime.now(C.TZ)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    prev = {}
    try:
        rows = lib.get("skytouch_state", "select=brief&id=eq.true") or []
        prev = (rows[0].get("brief") if rows else None) or {}
    except Exception:  # noqa: BLE001
        prev = {}

    # ---- calendar (optional second connection)
    urls = [u.strip() for u in (C.secret(lib, "pi:skytouch:calendar_urls") or "").splitlines() if u.strip().startswith("https://")]
    events, cal_state = [], "not connected"
    if urls:
        docs, bad = [], 0
        for u in urls:
            try:
                docs.append(ICAL.fetch(u))
            except Exception:  # noqa: BLE001
                bad += 1
        if docs:
            events = ICAL.events_between(docs, day0, day0 + timedelta(days=7))
            cal_state = "ok" if not bad else "partly read ({} of {} links failed)".format(bad, len(urls))
        else:
            cal_state = "could not read"

    days = []
    for i in range(7):
        d = (day0 + timedelta(days=i)).date()
        items = [{"time": _when(e), "title": e["summary"][:80]} for e in events if e["start"].date() <= d <= (e["end"] - timedelta(seconds=1)).date()]
        days.append({"label": (day0 + timedelta(days=i)).strftime("%a %b ") + str(d.day), "items": items})

    asked, ask_note = prev.get("asked_on") == str(C.today()), ""
    gaps = 0
    try:
        gm = C.Gmail(pw, readonly=True)
    except Exception as e:  # noqa: BLE001
        if not dry:
            C.beat(lib, SLUG, False, "skip: Gmail rejected the login")
        return "skip: Gmail rejected the login (" + type(e).__name__ + ")"
    try:
        # ---- 1. the morning question, Jared's own thread only
        if g["morning_text_jared"] and not asked:
            mine = [gm.fetch(u) for u in gm.search("from:{} {} newer_than:30d".format(C.GV_DOMAIN, C.JARED))[-3:]]
            mine = sorted([m for m in mine if m and C.is_jared(C.sender_number(m["from_addr"]))], key=lambda m: m["date"])
            if not mine:
                ask_note = "no thread with Jared's cell to reply on"
            elif dry:
                ask_note = "would ask Jared for today's hours"
            else:
                C.send_availability_ask(pw, mine[-1])
                asked, ask_note = True, "asked Jared for today's hours"
        elif not g["morning_text_jared"]:
            ask_note = "morning text is off"

        # ---- 3. booking talk with nothing on the calendar
        if cal_state in ("ok",) or cal_state.startswith("partly"):
            seen = {}
            q = "from:{} (label:{} OR label:{}) newer_than:1d".format(C.GV_DOMAIN, C.LABEL_HANDLED.replace("/", "-"), C.LABEL_FLAGGED.replace("/", "-"))
            for u in gm.search(q):
                m = gm.fetch(u)
                if m and m["thrid"] and not C.is_jared(C.sender_number(m["from_addr"])):
                    seen.setdefault(m["thrid"], m)
            for thrid, first in list(seen.items())[:30]:
                msgs = [m for m in (gm.fetch(u) for u in gm.thread_uids(thrid)[:20]) if m]
                msgs.sort(key=lambda m: m["date"])
                texts = [m["text"] for m in msgs if m["text"]]
                if not mentions_booking(texts):
                    continue
                inbound = [m for m in msgs if C.is_gv_address(m["from_addr"]) and not C.is_jared(C.sender_number(m["from_addr"]))]
                if not inbound:
                    continue
                number, name = C.sender_number(inbound[-1]["from_addr"]), C.first_name(inbound[-1]["from_name"])
                if _on_calendar(events, name, number):
                    continue
                gaps += 1
                if not dry:
                    lib.rpc("skytouch_card_save", p={
                        "kind": "calendar_gap", "thread_key": thrid, "client_number": number, "client_name": name, "job": JOB,
                        "ask": " | ".join(texts)[-300:],
                        "why": "A booking was talked about in the last 24 hours, but nothing on your calendar mentions this client. Check it and add it if it is real."})
    finally:
        gm.close()

    nev = sum(len(d["items"]) for d in days)
    if not dry:
        brief = {"generated_at": C.fmt_time(now), "generated_date": str(now.date()), "calendar": cal_state, "days": days,
                 "asked_on": str(C.today()) if asked else prev.get("asked_on"), "ask_note": ask_note, "gaps": gaps}
        lib.rpc("skytouch_state_save", p={"brief": brief})
    summary = "calendar {}, {} events in 7 days, {} booking gaps, {}".format(cal_state, nev, gaps, ask_note or "ok")
    if dry:
        return "ok (dry run, nothing written or sent): " + summary
    C.beat(lib, SLUG, True, summary)
    return "ok: " + summary
