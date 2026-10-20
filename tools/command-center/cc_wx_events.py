"""cc_wx_events (Pi cron job): copy the calendar + Turo items the projection wall already shows on its weather scenes
into cc_wx_events, so the admin weather card shows the same events with the same rules.

The wall (server.py, port 8099) is the single owner of those rules: every calendar (iCloud + Nextcloud), wx_keep()
filtering, and Turo Pickup / Return items from wall_pi_turo_wx. This job only READS its local /api/data (loopback)
and writes one row through the service-role-only RPC cc_wx_ingest. It never touches the wall's behavior or its
credentials, and the browser never gets a calendar token: the admin reads the copy through admin_cc_wx_events().

Schedule: every 5 minutes (crontab: 3-58/5 * * * *). Watchdog: cloud_admin_watch.py (check `calendar_feed`).
If the wall is briefly down the last good copy stays and the card says how old it is.
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402

WALL = "http://127.0.0.1:8099/api/data"


def main(argv):
    dry = "--dry" in argv
    with urllib.request.urlopen(urllib.request.Request(WALL, headers={"User-Agent": "bestly-cc-wx/1.0"}), timeout=15) as r:
        d = json.loads(r.read().decode())
    cal = d.get("calendar") or {}
    evs = cal.get("wx_events")
    if not isinstance(evs, list):
        raise RuntimeError("the wall has no weather-scene event list yet (calendar_error=%s)" % str(d.get("calendar_error"))[:120])
    keep = ("title", "start", "end", "all_day", "calendar", "location", "source", "turo", "partiful")
    out = [{k: e.get(k) for k in keep if k in e} for e in evs if e.get("start") and e.get("end")]
    at = d.get("calendar_at")
    cal_at = datetime.fromtimestamp(float(at), timezone.utc).isoformat() if at else None
    err = d.get("calendar_wx_error") or d.get("calendar_error") or d.get("calendar_nc_error")
    if dry:
        print(json.dumps({"n": len(out), "calendar_at": cal_at, "err": err, "first": out[:2]}, indent=1)[:1500])
        return "ok dry"
    lib.rpc("cc_wx_ingest", p_events=out, p_calendar_at=cal_at, p_err=str(err) if err else None)
    age = int(time.time() - float(at)) // 60 if at else None
    return "ok %d events (%d Turo), wall calendar %s min old%s" % (len(out), sum(1 for e in out if e.get("source") == "turo"), age, (" ; wall error: " + str(err)[:80]) if err else "")
