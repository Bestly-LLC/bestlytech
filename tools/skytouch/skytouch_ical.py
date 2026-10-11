"""Minimal Google Calendar iCal reader for the SkyTouch morning check (stdlib only, read-only).

Installed on the Pi as /opt/bestly/cron/jobs/skytouch_ical.py. Reads the "Secret address in iCal format" links Jared saves on
/admin/skytouch. Handles what Google actually sends: folded lines, TZID and UTC times, all-day dates, EXDATE, and the common
RRULE forms (DAILY, WEEKLY with BYDAY, MONTHLY by day-of-month, YEARLY; INTERVAL, COUNT, UNTIL). Anything fancier falls back to the
first occurrence only, which is the safe direction for a "is anything already on the calendar" check.
"""
import re
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Los_Angeles")
_DAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "bestly-pi-skytouch/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def _unfold(text):
    return re.sub(r"\r?\n[ \t]", "", text).splitlines()


def _prop(line):
    head, _, val = line.partition(":")
    parts = head.split(";")
    params = {}
    for p in parts[1:]:
        k, _, v = p.partition("=")
        params[k.upper()] = v
    return parts[0].upper(), params, val


def _dt(val, params):
    """-> (aware datetime in Pacific, all_day)"""
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", val):
        d = datetime.strptime(val, "%Y%m%d")
        return d.replace(tzinfo=TZ), True
    if val.endswith("Z"):
        return datetime.strptime(val, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).astimezone(TZ), False
    tz = TZ
    if params.get("TZID"):
        try:
            tz = ZoneInfo(params["TZID"])
        except Exception:  # noqa: BLE001
            tz = TZ
    return datetime.strptime(val[:15], "%Y%m%dT%H%M%S").replace(tzinfo=tz).astimezone(TZ), False


def parse(text):
    """-> list of raw events: dict(summary, start, end, all_day, rrule, exdates, uid, recurrence_id, status)"""
    events, cur = [], None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            cur = {"exdates": [], "rrule": None, "summary": "", "uid": "", "recurrence_id": None, "status": "", "end": None}
        elif line == "END:VEVENT" and cur is not None:
            if cur.get("start"):
                if not cur["end"]:
                    cur["end"] = cur["start"] + (timedelta(days=1) if cur["all_day"] else timedelta(hours=1))
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            name, params, val = _prop(line)
            try:
                if name == "DTSTART":
                    cur["start"], cur["all_day"] = _dt(val, params)
                elif name == "DTEND":
                    cur["end"], _ = _dt(val, params)
                elif name == "SUMMARY":
                    cur["summary"] = val.replace("\\,", ",").replace("\\n", " ").strip()
                elif name == "RRULE":
                    cur["rrule"] = val
                elif name == "EXDATE":
                    for v in val.split(","):
                        cur["exdates"].append(_dt(v, params)[0])
                elif name == "UID":
                    cur["uid"] = val
                elif name == "RECURRENCE-ID":
                    cur["recurrence_id"] = _dt(val, params)[0]
                elif name == "STATUS":
                    cur["status"] = val.upper()
            except Exception:  # noqa: BLE001
                continue
    return events


def _rule(rr):
    d = {}
    for part in (rr or "").split(";"):
        k, _, v = part.partition("=")
        d[k.upper()] = v
    return d


def expand(ev, lo, hi):
    """Occurrences of one raw event that overlap [lo, hi). Returns [(start, end)]."""
    dur = ev["end"] - ev["start"]
    out = []
    if not ev["rrule"]:
        if ev["start"] < hi and ev["end"] > lo:
            out.append((ev["start"], ev["end"]))
        return out
    r = _rule(ev["rrule"])
    freq, interval = r.get("FREQ", ""), max(1, int(r.get("INTERVAL", "1") or 1))
    count = int(r["COUNT"]) if r.get("COUNT") else None
    until = None
    if r.get("UNTIL"):
        try:
            until = _dt(r["UNTIL"], {})[0]
        except Exception:  # noqa: BLE001
            until = None
    byday = [_DAYS[x[-2:]] for x in r.get("BYDAY", "").split(",") if x[-2:] in _DAYS]
    cands, n = [], 0
    base = ev["start"]
    if freq == "DAILY":
        cur = base
        while cur < hi and n < 4000:
            cands.append(cur)
            cur += timedelta(days=interval)
            n += 1
    elif freq == "WEEKLY":
        days = byday or [base.weekday()]
        week0 = base - timedelta(days=base.weekday())
        k = 0
        while n < 4000:
            wk = week0 + timedelta(weeks=k * interval)
            if wk > hi:
                break
            for d in sorted(days):
                cur = wk + timedelta(days=d)
                if cur >= base:
                    cands.append(cur)
                    n += 1
            k += 1
    elif freq in ("MONTHLY", "YEARLY"):
        cur, k = base, 0
        while cur < hi and k < 600:
            cands.append(cur)
            k += 1
            months = interval if freq == "MONTHLY" else 12 * interval
            y, m = cur.year + (cur.month - 1 + months) // 12, (cur.month - 1 + months) % 12 + 1
            try:
                cur = cur.replace(year=y, month=m)
            except ValueError:
                cur = cur.replace(year=y, month=m, day=28)
    else:
        cands = [base]
    for i, st in enumerate(sorted(cands)):
        if count is not None and i >= count:
            break
        if until and st > until:
            break
        if st in ev["exdates"]:
            continue
        en = st + dur
        if st < hi and en > lo:
            out.append((st, en))
    return out


def events_between(texts, lo, hi):
    """texts: list of iCal documents. -> sorted list of dict(start, end, summary, all_day) overlapping [lo, hi)."""
    out = []
    for t in texts:
        raws = parse(t)
        replaced = {(e["uid"], e["recurrence_id"]) for e in raws if e["recurrence_id"]}
        for ev in raws:
            if ev["status"] == "CANCELLED":
                continue
            for st, en in expand(ev, lo, hi):
                if not ev["recurrence_id"] and (ev["uid"], st) in replaced:
                    continue
                out.append({"start": st, "end": en, "summary": ev["summary"], "all_day": ev["all_day"]})
    out.sort(key=lambda e: e["start"])
    return out
