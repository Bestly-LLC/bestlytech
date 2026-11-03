#!/usr/bin/env python3
"""Parse Google Calendar invitation mails (as stored in bestly_mail) into Meet watch rows.

parse_invite(subject, body, sent_at, mail_id) -> dict | None
    {event_key, meet_code, title, starts_at, ends_at (ISO UTC), organizer, guests[], source, source_mail_id, google_event_id}
parse_cancel(subject, body) -> dict | None      {title, date (YYYY-MM-DD), event_id|None}
Pure functions, no network. Tested in tests/test_meetparse.py.
"""
import base64
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

CODE_RE = re.compile(r"meet\.google\.com/([a-z]{3}-[a-z]{4}-[a-z]{3})")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
# "Pacific Time - Los Angeles" and friends
TZ_NAMES = {
    "pacific": "America/Los_Angeles", "mountain": "America/Denver", "central": "America/Chicago", "eastern": "America/New_York",
    "alaska": "America/Anchorage", "hawaii": "Pacific/Honolulu", "arizona": "America/Phoenix",
}
WHEN_RE = re.compile(
    r"(?P<dow>[A-Za-z]{3,9})\w*\s+(?P<mon>[A-Za-z]{3})[a-z]*\s+(?P<day>\d{1,2}),\s+(?P<year>\d{4})\s*[⋅·\-•|]*\s*"
    r"(?P<h1>\d{1,2})(?::(?P<m1>\d{2}))?\s*(?P<ap1>am|pm)?\s*[–—\-]\s*(?P<h2>\d{1,2})(?::(?P<m2>\d{2}))?\s*(?P<ap2>am|pm)\b",
    re.I)


def _hour(h, m, ap):
    h = int(h) % 12
    if ap.lower() == "pm":
        h += 12
    return h, int(m or 0)


def _tz(body):
    m = re.search(r"\b(Pacific|Mountain|Central|Eastern|Alaska|Hawaii|Arizona)\b[^\n]*\bTime\b|\b(Pacific|Mountain|Central|Eastern|Alaska|Hawaii|Arizona) Time", body or "")
    name = (m.group(1) or m.group(2)).lower() if m else ""
    z = re.search(r"\b((?:America|Europe|Asia|Pacific|Australia)/[A-Za-z_]+)\b", body or "")
    if z:
        return ZoneInfo(z.group(1))
    return ZoneInfo(TZ_NAMES.get(name, "America/Los_Angeles"))


def google_event_id(text):
    """The calendar event id inside a calendar.google.com ...eid=<base64>... link (base64 of '<eventid> <calendar email>')."""
    m = re.search(r"[?&]eid=([A-Za-z0-9_\-]+)", text or "")
    if not m:
        return None
    s = m.group(1)
    try:
        raw = base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)).decode("utf8", "ignore")
    except Exception:  # noqa: BLE001
        return None
    first = raw.split(" ")[0].strip()
    return first if re.fullmatch(r"[A-Za-z0-9_]{5,}", first) else None


def _title(subject):
    s = re.sub(r"\s+", " ", subject or "").strip()
    s = re.sub(r"^(updated invitation( with note)?|invitation( from google calendar)?|accepted|canceled event|cancelled event)\s*:\s*", "", s, flags=re.I)
    s = re.split(r"\s@\s", s)[0]
    return s.strip()


def _guests(body, mail_to=None):
    m = re.search(r"\nGuests\s*\n(.*?)(?:\nView all guest info|\nReply for|\n~~//~~|$)", body or "", re.S)
    out = []
    if m:
        for e in EMAIL_RE.findall(m.group(1)):
            e = e.lower()
            if e not in out:
                out.append(e)
    return out


def _organizer(body):
    m = re.search(r"\nOrganizer\s*\n([^\n]*)\n([^\n]*)", body or "")
    if m:
        e = EMAIL_RE.search(m.group(2)) or EMAIL_RE.search(m.group(1))
        if e:
            return e.group(0).lower()
    return None


def parse_invite(subject, body, sent_at=None, mail_id=None):
    body = (body or "").replace("\r\n", "\n")
    if re.match(r"\s*(canceled|cancelled) event", subject or "", re.I):
        return None
    c = CODE_RE.search(body)
    w = WHEN_RE.search(body)
    if not c or not w:
        return None
    tz = _tz(body)
    mon = MONTHS.get(w.group("mon").lower()[:3])
    if not mon:
        return None
    ap2 = w.group("ap2")
    ap1 = w.group("ap1") or ap2
    h1, m1 = _hour(w.group("h1"), w.group("m1"), ap1)
    h2, m2 = _hour(w.group("h2"), w.group("m2"), ap2)
    y, d = int(w.group("year")), int(w.group("day"))
    start = datetime(y, mon, d, h1, m1, tzinfo=tz)
    end = datetime(y, mon, d, h2, m2, tzinfo=tz)
    if end <= start:
        end += timedelta(days=1)
    gid = google_event_id(body)
    code = c.group(1)
    utc = ZoneInfo("UTC")
    return {
        "event_key": f"m:{gid}" if gid else f"m:{code}|{start.astimezone(utc).strftime('%Y%m%dT%H%MZ')}",
        "meet_code": code,
        "title": _title(subject) or None,
        "starts_at": start.astimezone(utc).isoformat(),
        "ends_at": end.astimezone(utc).isoformat(),
        "organizer": _organizer(body),
        "guests": _guests(body),
        "source": "mail",
        "source_mail_id": mail_id,
        "google_event_id": gid,
    }


def parse_cancel(subject, body=None):
    s = re.sub(r"\s+", " ", subject or "").strip()
    m = re.match(r"(?:canceled|cancelled) event:\s*(.*?)\s@\s*(?:\w+)\s+(\w{3})\w*\s+(\d{1,2}),\s+(\d{4})", s, re.I)
    if not m:
        return None
    mon = MONTHS.get(m.group(2).lower()[:3])
    if not mon:
        return None
    return {"title": m.group(1).strip(), "date": f"{int(m.group(4)):04d}-{mon:02d}-{int(m.group(3)):02d}", "event_id": google_event_id((body or "").replace("\r\n", "\n"))}
