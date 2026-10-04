"""Bestly to-dos <-> Apple Reminders list "Bestly" (2026-10-04).

The list lives on Jared's Nextcloud as a CalDAV task list (VTODO). Reminders.app on his Mac, iPhone and iPad
already has the Nextcloud account, so the list shows up there on every device.

Same items as admin Today "You", the wall, and the Home Assistant "Bestly" list: Jared's open call to-dos
(last 7 days) + today's picks (RPC reminders_todo_sync, service_role).
- Open in Bestly -> appears in Reminders.  Done/dismissed in Bestly -> checked / removed in Reminders.
- Checked in Reminders -> done in Bestly.  Unchecked -> reopened.  Deleted in Reminders -> dismissed.
- Added in Reminders -> new Bestly to-do for Jared ("Added in Reminders").
- Checked items are removed from Reminders a day after they were done.
Self-healing: recreates the list if it is deleted, re-maps by UID if the state file is lost, never
mass-dismisses (3+ items vanishing at once = a reset), and a per-title loop guard.
Watchdog: pi_jobs (job reminders_sync, alerts Scout if it fails or goes quiet).
"""
import base64
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lib  # noqa: E402

STATE = "/opt/bestly/cron/state/reminders_sync.json"
LIST_SLUG = "bestly-todos"
LIST_NAME = "Bestly"
CLEAR_DONE_AFTER = 24 * 3600


class Dav:
    def __init__(self):
        self.user = lib.rpc("pi_secret", p_name="nextcloud_user")
        pw = lib.rpc("pi_secret", p_name="nextcloud_app_password")
        self.base = (lib.rpc("pi_secret", p_name="nextcloud_base_url") or "https://cloud.bestly.tech").rstrip("/")
        self.auth = "Basic " + base64.b64encode(f"{self.user}:{pw}".encode()).decode()
        self.cal = f"/remote.php/dav/calendars/{self.user}/{LIST_SLUG}/"

    def req(self, method, path, body=None, headers=None, ok=(200, 201, 204, 207)):
        h = {"Authorization": self.auth, **(headers or {})}
        r = urllib.request.Request(self.base + path, data=body.encode() if isinstance(body, str) else body,
                                   method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, resp.read().decode(), dict(resp.headers)
        except urllib.error.HTTPError as e:
            if e.code in ok:
                return e.code, e.read().decode(), dict(e.headers)
            raise RuntimeError(f"{method} {path.rsplit('/', 2)[-2]} -> HTTP {e.code}")

    def ensure_list(self):
        """Self-heal: (re)create the "Bestly" task list if it is missing."""
        code, _, _ = self.req("PROPFIND", self.cal, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
                              {"Depth": "0", "Content-Type": "application/xml"}, ok=(207, 404))
        if code != 404:
            return False
        # Extended MKCOL (RFC 5689): the proxy in front of Nextcloud answers 501 to the MKCALENDAR method.
        self.req("MKCOL", self.cal, f'''<?xml version="1.0" encoding="UTF-8"?>
<d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
 <d:set><d:prop>
  <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
  <d:displayname>{LIST_NAME}</d:displayname>
  <a:calendar-color>#2F6FEB</a:calendar-color>
  <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
 </d:prop></d:set>
</d:mkcol>''', {"Content-Type": "application/xml"})
        return True

    def items(self):
        _, x, _ = self.req("REPORT", self.cal, '''<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
 <d:prop><d:getetag/><c:calendar-data/></d:prop>
 <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter>
</c:calendar-query>''', {"Depth": "1", "Content-Type": "application/xml"})
        out = {}
        for resp in re.findall(r"<d:response>(.*?)</d:response>", x, re.S):
            href = re.search(r"<d:href>(.*?)</d:href>", resp).group(1)
            data = re.search(r"<\w+:calendar-data[^>]*>(.*?)</\w+:calendar-data>", resp, re.S)
            etag = re.search(r"<d:getetag>(.*?)</d:getetag>", resp)
            if not data:
                continue
            ics = _unxml(data.group(1))
            uid = _prop(ics, "UID")
            if not uid:
                continue
            out[uid] = {"href": href, "etag": _unxml(etag.group(1)) if etag else None, "ics": ics,
                        "summary": _unescape(_prop(ics, "SUMMARY") or ""),
                        "note": _unescape(_prop(ics, "DESCRIPTION") or ""),
                        "status": "completed" if (_prop(ics, "STATUS") or "").upper() == "COMPLETED" or _prop(ics, "COMPLETED") else "needs_action"}
        return out

    def put(self, href, ics, etag=None, new=False):
        h = {"Content-Type": "text/calendar; charset=utf-8"}
        if new:
            h["If-None-Match"] = "*"
        elif etag:
            h["If-Match"] = etag
        self.req("PUT", href, ics, h)

    def delete(self, href, etag=None):
        self.req("DELETE", href, None, {"If-Match": etag} if etag else {}, ok=(200, 204, 404, 412))


def _unxml(s):
    return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#13;", "").replace("&amp;", "&")


def _unfold(ics):
    return re.sub(r"\r?\n[ \t]", "", ics)


def _prop(ics, name):
    m = re.search(rf"^{name}(?:;[^:\r\n]*)?:(.*)$", _unfold(ics), re.M)
    return m.group(1).strip() if m else None


def _escape(t):
    return (t or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r", "").replace("\n", "\\n")


def _unescape(t):
    return t.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _now():
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def _new_ics(uid, title, note):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bestly//Reminders sync//EN", "BEGIN:VTODO",
             f"UID:{uid}", f"DTSTAMP:{_now()}", f"CREATED:{_now()}", f"LAST-MODIFIED:{_now()}",
             f"SUMMARY:{_escape(title[:255])}", "STATUS:NEEDS-ACTION"]
    if note:
        lines.append(f"DESCRIPTION:{_escape(note[:1500])}")
    lines += ["END:VTODO", "END:VCALENDAR"]
    return "\r\n".join(lines) + "\r\n"


def _edit(ics, status=None, title=None):
    """Change status / title inside an existing VTODO, keeping everything Reminders put there."""
    ics = _unfold(ics).replace("\r\n", "\n")
    head, rest = ics.split("BEGIN:VTODO", 1)
    body, tail = rest.split("END:VTODO", 1)
    keep = [l for l in body.split("\n") if l and not re.match(r"^(LAST-MODIFIED|DTSTAMP)[;:]", l)]
    if status:
        keep = [l for l in keep if not re.match(r"^(STATUS|COMPLETED|PERCENT-COMPLETE)[;:]", l)]
        if status == "completed":
            keep += ["STATUS:COMPLETED", f"COMPLETED:{_now()}", "PERCENT-COMPLETE:100"]
        else:
            keep += ["STATUS:NEEDS-ACTION"]
    if title:
        keep = [l for l in keep if not re.match(r"^SUMMARY[;:]", l)] + [f"SUMMARY:{_escape(title[:255])}"]
    keep += [f"LAST-MODIFIED:{_now()}", f"DTSTAMP:{_now()}"]
    return (head + "BEGIN:VTODO\n" + "\n".join(keep) + "\nEND:VTODO" + tail).replace("\n", "\r\n")


def norm(t):
    t = unicodedata.normalize("NFKC", t or "")
    for d in ("\u2011", "\u2010", "\u2013", "\u2014"):
        t = t.replace(d, "-")
    return re.sub(r"\s+", " ", t).strip().lower()[:255]


def load():
    try:
        s = json.load(open(STATE))
    except Exception:
        s = {}
    for k in ("map", "tomb", "flips"):
        s.setdefault(k, {})
    return s


def save(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f, indent=1)
    os.replace(tmp, STATE)


def flip(st, title, now):
    """Loop guard: more than 3 adds/dismisses of one title in an hour = stop touching it."""
    k = norm(title)
    st["flips"][k] = [t for t in st["flips"].get(k, []) if now - t < 3600] + [now]
    return len(st["flips"][k]) > 3


def main(argv):
    dry = "--dry" in argv
    dav = Dav()
    st = load()
    if dav.ensure_list():
        st["map"] = {}
        lib.notify("Reminders list recreated", "The \"Bestly\" list was missing from Reminders, so it was made again.",
                   severity="info", push=False, dedupe="reminders-list-recreated-" + time.strftime("%Y%m%d"))
    m, now = st["map"], time.time()
    st["tomb"] = {k: t for k, t in st["tomb"].items() if now - t < 86400}
    st["flips"] = {k: v for k, v in st["flips"].items() if any(now - t < 3600 for t in v)}
    guard = {k for k, v in st["flips"].items() if len([t for t in v if now - t < 3600]) > 3}

    have = dav.items()
    r1 = lib.rpc("reminders_todo_sync", p_known=list(m.keys()), p_ops=[])
    open_by = {o["id"]: o for o in r1.get("open") or []}
    known = r1.get("known") or {}

    # Lost state file: re-adopt our own items by UID (bestly-<id>).
    for uid in have:
        if uid.startswith("bestly-") and uid[7:] not in m and uid[7:] in (set(open_by) | set(known)):
            it = have[uid]
            m[uid[7:]] = {"uid": uid, "c": it["status"], "title": it["summary"], "since": now}

    ops, dav_ops = [], []
    missing = [b for b, x in m.items() if x["uid"] not in have and x.get("c") == "needs_action"]
    reset = len(missing) >= 3 and len(missing) >= len(m) / 2

    for bid, x in list(m.items()):
        it, b, o = have.get(x["uid"]), known.get(bid), open_by.get(bid)
        if it is None:                                   # deleted in Reminders
            if now - x.get("since", 0) < 300 or norm(x.get("title")) in guard:
                continue
            if not reset and x.get("c") == "needs_action" and b == "open" and not flip(st, x.get("title"), now):
                ops.append({"op": "dismiss", "id": bid})
            del m[bid]
            continue
        if it["status"] != x.get("c"):                   # changed in Reminders -> Bestly
            if it["status"] == "completed" and b == "open":
                ops.append({"op": "done", "id": bid}); x["done_at"] = now
            elif it["status"] == "needs_action" and b in ("done", "dismissed"):
                ops.append({"op": "open", "id": bid}); x.pop("done_at", None)
            x["c"] = it["status"]
            continue
        if b == "done":                                  # unchanged in Reminders -> follow Bestly
            if it["status"] == "needs_action":
                dav_ops.append(("edit", it, {"status": "completed"})); x["c"] = "completed"; x["done_at"] = now
            elif now - x.setdefault("done_at", now) > CLEAR_DONE_AFTER:
                dav_ops.append(("delete", it, None)); del m[bid]
        elif b == "open" and o is not None:
            if it["status"] == "completed":
                dav_ops.append(("edit", it, {"status": "needs_action"})); x["c"] = "needs_action"
            if o["title"] != x.get("title") and o["title"] != it["summary"]:
                dav_ops.append(("edit", it, {"title": o["title"]})); x["title"] = o["title"]
        else:                                            # dismissed, handed off, or out of the Today window
            st["tomb"][norm(x.get("title"))] = now
            dav_ops.append(("delete", it, None)); del m[bid]

    mapped = {x["uid"] for x in m.values()}
    mapped_titles = {norm(x.get("title")) for x in m.values()}
    for uid, it in have.items():                         # items nobody knows
        if uid in mapped:
            continue
        nt = norm(it["summary"])
        pb = next((b for b, o in open_by.items() if b not in m and norm(o["title"]) == nt), None)
        if pb:
            m[pb] = {"uid": uid, "c": it["status"], "title": it["summary"], "since": now}
            mapped.add(uid); mapped_titles.add(nt)
        elif uid.startswith("bestly-") or nt in st["tomb"] or nt in mapped_titles:
            dav_ops.append(("delete", it, None))         # ours but closed in Bestly, or a duplicate
        elif it["status"] == "needs_action" and nt and nt not in guard and not flip(st, it["summary"], now):
            ops.append({"op": "add", "uid": uid, "title": it["summary"], "note": it["note"]})

    if dry:
        return f"dry: {len(have)} in Reminders, {len(open_by)} open in Bestly, {len(ops)} to Bestly, {len(dav_ops)} to Reminders, adds {len([b for b in open_by if b not in m])}"

    r2 = lib.rpc("reminders_todo_sync", p_known=[], p_ops=ops)
    for uid, bid in (r2.get("added") or {}).items():
        if bid:
            m[bid] = {"uid": uid, "c": "needs_action", "title": have[uid]["summary"], "since": now}
            open_by.pop(bid, None)
    save(st)

    for kind, it, arg in dav_ops:
        try:
            if kind == "edit":
                dav.put(it["href"], _edit(it["ics"], **arg), it["etag"])
            else:
                dav.delete(it["href"], it["etag"])
        except Exception as e:  # noqa: BLE001  a changed item is retried next run
            print("Reminders", kind, "failed:", e)

    added = 0
    for bid, o in open_by.items():
        if bid in m or norm(o["title"]) in guard:
            continue
        uid = "bestly-" + bid
        href = dav.cal + urllib.parse.quote(uid) + ".ics"
        try:
            dav.put(href, _new_ics(uid, o["title"], o.get("note")), new=True)
        except RuntimeError as e:
            if "412" not in str(e):                     # 412 = already there: it gets mapped next run
                raise
        m[bid] = {"uid": uid, "c": "needs_action", "title": o["title"], "since": now}
        added += 1
        save(st)
    save(st)
    if ops or dav_ops or added:
        return f"ok synced: {len(ops)} to Bestly, {len(dav_ops) + added} to Reminders ({len(m)} mapped)"
    return f"ok nothing to sync ({len(m)} mapped, {len(have)} in Reminders)"
