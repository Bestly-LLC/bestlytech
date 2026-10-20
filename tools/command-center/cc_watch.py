"""Command Center v2 freshness watchdog (Pi cron, called by cloud_admin_watch.py every 5 min). Built 2026-10-19.

Why: the admin home (bestly.tech/admin, framed in Cloud) answers four questions from live sources. If a source goes
quiet the page must say "Updated 3 hours ago" on that card, never blank, and a person who can fix it must hear about it,
signed by the employee who owns that source. Free, no AI.

Checks (each is one lead-card source), owner = who signs the alert (notification_owners prefix cc.*):
  mercury_balance  Money    cc_mercury_pulse.updated_at older than 3 h.        Heal: re-run the mercury_pulse job (read-only).   Rolo   (cc.money.*)
  turo_widget      Turo     turo_vehicle_state.observed_at older than 6 h (the Turo card's car numbers).  Alert only.            Turo Reader (cc.turo.*)
  turo_reader      Turo     the Pi Turo reader has not pulled trips for 30 min or is signed out. Heal: the wall's own poke,
                            wall_pi_turo_wx (same RPC and same 30 min / 15 min rule as the wall). Alert if still stale at 45 min.  Turo Reader
  calendar_feed    My day   cc_wx_events (the wall's calendar + Turo copy) older than 20 min, or the calendar read erroring.
                            Heal: re-run the cc_wx_events job.                                                                       Nimbus (cc.infra.*)
  next_meeting     My day   the next-meeting edge function does not answer (401 JSON = alive, it wants a signed-in user). Alert only. Nimbus
  weatherkit       My day   weatherkit-proxy answers without currentWeather, hourly, daily or the weatherAlerts block. Alert only.   Nimbus
  air_quality      My day   weatherkit-proxy returns no airQuality (Open-Meteo, fetched server-side). Alert only.                      Nimbus
  admin_today      AI team  admin_today() (the Needs-you feed) errors. Alert only.                                                    Nimbus

A bad check alerts after 2 bad runs in a row (about 10 min) except turo_reader (45 min stale) and mercury_balance (3 h stale
by definition). An alert is a monitor_issues row with key cc.<owner area>.<check>, which also lights the page's one health dot.
It resolves itself the first green run. Heals are tried before raising.

Flags (via cloud_admin_watch argv): --dry  --no-heal  --sim=<check> (force that check red; with --raise-now alerts at once;
state is not saved, the next normal run resolves the alert and proves the loop).
Off switch: touch /opt/bestly/cron/state/cc_watch.OFF
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402

OFF = "/opt/bestly/cron/state/cc_watch.OFF"
STATE = "/opt/bestly/cron/state/cc_watch.json"
WALL_REPORT = "/opt/bestly/wall/.report.json"
RUN = "/opt/bestly/cron/run.sh"
HOME_LAT, HOME_LON = 34.0835, -118.3698

AREA = {
    "mercury_balance": ("cc.money.mercury_balance", "Money card: the bank balance is out of date"),
    "turo_widget": ("cc.turo.widget", "Turo card: the car numbers are out of date"),
    "turo_reader": ("cc.turo.reader", "Turo card: the Turo reader has stopped pulling trips"),
    "calendar_feed": ("cc.infra.calendar_feed", "My day: the calendar feed on the weather is out of date"),
    "next_meeting": ("cc.infra.next_meeting", "My day: the next-meeting lookup is not answering"),
    "weatherkit": ("cc.infra.weatherkit", "My day: the weather (Apple WeatherKit) is not answering right"),
    "air_quality": ("cc.infra.air_quality", "My day: air quality is missing from the weather"),
    "admin_today": ("cc.infra.admin_today", "AI team: the Needs-you feed is erroring"),
}
HINT = {
    "mercury_balance": "Run /opt/bestly/cron/run.sh mercury_pulse on the Pi and read its output. It needs the Mercury read token in Vault (pi:mercury_api_token) and the IPv4-only route.",
    "turo_widget": "Check the Tesla fleet token and the turo_vehicle_state poller (car-guard).",
    "turo_reader": "Open Turo in the Pi browser profile and sign in again if it is signed out; the reader pulls trips once it is signed in.",
    "calendar_feed": "Check the wall at http://127.0.0.1:8099/api/data (calendar_error) and run.sh cc_wx_events.",
    "next_meeting": "Check the next-meeting edge function logs in Supabase and the Nextcloud calendar.",
    "weatherkit": "Check the weatherkit-proxy edge function logs and the Apple WeatherKit key.",
    "air_quality": "Check the Open-Meteo air-quality call inside weatherkit-proxy (airFor).",
    "admin_today": "Run select * from admin_today() in Supabase and read the error.",
}


def _now():
    return datetime.now(timezone.utc)


def _age_min(iso):
    if not iso:
        return None
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (_now() - t).total_seconds() / 60.0
    except Exception:  # noqa: BLE001
        return None


def _res(check, status, detail, **extra):
    return {"check": check, "status": status, "detail": detail, **extra}


def _first(rows):
    return rows[0] if isinstance(rows, list) and rows else {}


def _human(mins):
    if mins is None:
        return "never"
    if mins < 90:
        return f"{int(mins)} min ago"
    if mins < 60 * 36:
        return f"{mins / 60:.0f} hours ago"
    return f"{mins / 1440:.0f} days ago"


# --- the checks ------------------------------------------------------------------------------------------------------
def check_mercury():
    try:
        row = _first(lib.get("cc_mercury_pulse", "select=updated_at,total&limit=1"))
    except Exception as e:  # noqa: BLE001
        return _res("mercury_balance", "red", f"could not read cc_mercury_pulse: {str(e)[:160]}")
    age = _age_min(row.get("updated_at"))
    if age is None:
        return _res("mercury_balance", "red", "the Money card has never had a Mercury reading", age=None)
    if age > 180:
        return _res("mercury_balance", "red", f"the Mercury balance was last read {_human(age)}", age=age)
    return _res("mercury_balance", "green", f"Mercury balance read {_human(age)}", age=age)


def check_turo_widget():
    try:
        row = _first(lib.get("turo_vehicle_state", "select=observed_at&order=observed_at.desc&limit=1"))
    except Exception as e:  # noqa: BLE001
        return _res("turo_widget", "red", f"could not read turo_vehicle_state: {str(e)[:160]}")
    age = _age_min(row.get("observed_at"))
    if age is None or age > 360:
        return _res("turo_widget", "red", f"the car's last reading was {_human(age)} (the Turo card shows charge and Supercharging from it)", age=age)
    return _res("turo_widget", "green", f"car reading {_human(age)}", age=age)


def check_turo_reader():
    try:
        st = _first(lib.get("turo_reader_state", "select=last_trips_at,signed_in,last_error&id=eq.1"))
    except Exception as e:  # noqa: BLE001
        return _res("turo_reader", "red", f"could not read turo_reader_state: {str(e)[:160]}")
    age = _age_min(st.get("last_trips_at"))
    signed_in = st.get("signed_in") is True
    stale = age is None or age > 30 or not signed_in
    if not stale:
        return _res("turo_reader", "green", f"Turo trips pulled {_human(age)}", age=age, stale=False)
    why = ("signed out of Turo" if not signed_in else f"last pulled trips {_human(age)}") + (f" ({str(st.get('last_error'))[:80]})" if st.get("last_error") else "")
    # alert only past 45 min: the poke below gives the reader time to refresh first
    status = "red" if (age is None or age > 45 or not signed_in) else "green"
    return _res("turo_reader", status, "the Turo reader " + why, age=age, stale=True)


def heal_turo_reader():
    """The wall's own self-heal: wall_pi_turo_wx pokes the reader when it is stale (30 min), at most every 15 min."""
    try:
        cfg = json.load(open(WALL_REPORT))
        out = lib.rpc("wall_pi_turo_wx", p_token=cfg["agent_key"])
        rd = (out or {}).get("reader") or {}
        return {"target": "turo reader", "action": "poked the Turo reader (wall_pi_turo_wx)", "ok": True, "stale": rd.get("stale")}
    except Exception as e:  # noqa: BLE001
        return {"target": "turo reader", "action": "poke the Turo reader", "ok": False, "error": str(e)[:160]}


def check_calendar():
    try:
        row = _first(lib.get("cc_wx_events", "select=updated_at,calendar_at,err&limit=1"))
    except Exception as e:  # noqa: BLE001
        return _res("calendar_feed", "red", f"could not read cc_wx_events: {str(e)[:160]}")
    up, cal = _age_min(row.get("updated_at")), _age_min(row.get("calendar_at"))
    if up is None or up > 20:
        return _res("calendar_feed", "red", f"the calendar copy for the weather was last refreshed {_human(up)}", age=up)
    if row.get("err"):
        return _res("calendar_feed", "red", f"the wall could not read the calendar: {str(row['err'])[:140]}", age=up)
    if cal is not None and cal > 30:
        return _res("calendar_feed", "red", f"the wall last read the calendar {_human(cal)}", age=up)
    return _res("calendar_feed", "green", f"calendar copy refreshed {_human(up)}", age=up)


def check_next_meeting():
    try:
        lib._req("POST", "/functions/v1/next-meeting", {}, timeout=20)
        return _res("next_meeting", "green", "next-meeting answered")
    except RuntimeError as e:
        msg = str(e)
        if "HTTP 401" in msg and "unauthorized" in msg:  # alive; it wants a signed-in user, which a watchdog is not
            return _res("next_meeting", "green", "next-meeting is up (it answers the signed-out check with 401, as designed)")
        return _res("next_meeting", "red", "next-meeting answered badly: " + msg[:160])
    except Exception as e:  # noqa: BLE001
        return _res("next_meeting", "red", "next-meeting did not answer: " + str(e)[:160])


_WX = {}


def _weather():
    if "j" not in _WX:
        try:
            _WX["j"] = lib._req("POST", "/functions/v1/weatherkit-proxy",
                                {"lat": HOME_LAT, "lon": HOME_LON, "dataSets": "currentWeather,forecastHourly,forecastDaily,weatherAlerts",
                                 "air": True, "country": "US", "lang": "en"}, timeout=40)
        except Exception as e:  # noqa: BLE001
            _WX["j"] = {"_err": str(e)[:160]}
    return _WX["j"]


def check_weatherkit():
    j = _weather()
    if j.get("_err"):
        return _res("weatherkit", "red", "weatherkit-proxy failed: " + j["_err"])
    missing = []
    if not (j.get("currentWeather") or {}).get("temperature") and (j.get("currentWeather") or {}).get("temperature") != 0:
        missing.append("current conditions")
    if not ((j.get("forecastHourly") or {}).get("hours")):
        missing.append("hourly")
    if not ((j.get("forecastDaily") or {}).get("days")):
        missing.append("daily")
    if not isinstance(j.get("weatherAlerts"), dict):
        missing.append("the alerts block")
    if missing:
        return _res("weatherkit", "red", "weatherkit-proxy is missing " + ", ".join(missing))
    return _res("weatherkit", "green", "WeatherKit answers with current, hourly, daily and alerts")


def check_air():
    j = _weather()
    if j.get("_err"):
        return _res("air_quality", "red", "weatherkit-proxy failed: " + j["_err"])
    aq = j.get("airQuality")
    if not isinstance(aq, dict) or not isinstance(aq.get("aqi"), (int, float)):
        return _res("air_quality", "red", "weatherkit-proxy returned no air quality number")
    return _res("air_quality", "green", f"air quality {int(aq['aqi'])}")


def check_admin_today():
    try:
        rows = lib.rpc("admin_today")
        if not isinstance(rows, list):
            return _res("admin_today", "red", "admin_today() did not return a list")
        return _res("admin_today", "green", f"admin_today returns {len(rows)} rows")
    except Exception as e:  # noqa: BLE001
        return _res("admin_today", "red", "admin_today() errored: " + str(e)[:200])


CHECKS = {"mercury_balance": check_mercury, "turo_widget": check_turo_widget, "turo_reader": check_turo_reader, "calendar_feed": check_calendar,
          "next_meeting": check_next_meeting, "weatherkit": check_weatherkit, "air_quality": check_air, "admin_today": check_admin_today}
JOBS = {"mercury_balance": "mercury_pulse", "calendar_feed": "cc_wx_events"}


def _run_job(job):
    try:
        p = subprocess.run([RUN, job], capture_output=True, text=True, timeout=150)
        return p.returncode == 0, (p.stdout + p.stderr).strip()[-300:]
    except Exception as e:  # noqa: BLE001
        return False, str(e)[:200]


def _raise(check, r, fails, severity="warning"):
    key, title = AREA[check]
    lib.rpc("bestly_raise", p_key=key, p_kind="problem", p_severity=severity, p_title=title,
            p_body=r["detail"] + f" (checked every 5 min, bad {fails} run(s) in a row). The page shows that card as 'Updated ...' and keeps working.",
            p_area="admin", p_needs_jared=HINT[check], p_healed=False)


def _resolve(check, r):
    key, title = AREA[check]
    lib.rpc("bestly_raise", p_key=key, p_kind="resolved", p_severity="info", p_title="Fixed: " + title, p_body=r["detail"], p_area="admin",
            p_needs_jared=None, p_healed=bool(r.get("healed")))


IP_ALLOW = "/opt/bestly/etc/mercury_ip_allow"   # the home IPv4 Jared whitelisted on the Mercury token (one line)
IP_KEY = "cost.mercury_ip"                      # Penny (cost-cutter, prefix 'cost') owns the Mercury numbers
IP_TITLE = "Penny: home internet IP changed, Mercury may refuse the bank feed"


def _public_ipv4():
    """Current public IPv4 via curl -4 (cheap, no AI). '' when every lookup fails."""
    import re
    for url in ("https://api.ipify.org", "https://ipv4.icanhazip.com"):
        try:
            p = subprocess.run(["curl", "-4", "-s", "--max-time", "10", url], capture_output=True, text=True, timeout=15)
            ip = p.stdout.strip()
            if re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", ip):
                return ip
        except Exception:  # noqa: BLE001
            pass
    return ""


def mercury_ip_watch(dry=False):
    """Compare the Pi's public IPv4 with the one whitelisted on the Mercury token. Raise once through Penny (cost.mercury_ip)
    on a change, resolve by itself when they match again. Lookup failure or missing config = no change, no alert."""
    try:
        allowed = open(IP_ALLOW).read().strip()
    except Exception:  # noqa: BLE001
        return {"status": "skip", "detail": "no %s yet" % IP_ALLOW}
    now = _public_ipv4()
    if not now:
        return {"status": "skip", "detail": "could not read the public IPv4 (no change assumed)"}
    out = {"status": "green" if now == allowed else "red", "allowed": allowed, "now": now}
    if dry:
        return out
    try:
        open_now = bool(lib.get("monitor_issues", "key=eq.%s&status=eq.open&select=key" % IP_KEY))
    except Exception:  # noqa: BLE001
        return dict(out, status="skip", detail="could not read monitor_issues")
    if now != allowed and not open_now:
        lib.rpc("bestly_raise", p_key=IP_KEY, p_kind="problem", p_severity="warning", p_title=IP_TITLE,
                p_body="Home internet IP changed from %s to %s. Mercury will refuse the bank feed until %s is added to the token's IP list in Mercury." % (allowed, now, now),
                p_area="cost", p_needs_jared="Add %s to the Mercury token's IP list" % now, p_healed=False)
        out["raised"] = True
    elif now == allowed and open_now:
        lib.rpc("bestly_raise", p_key=IP_KEY, p_kind="resolved", p_severity="info", p_title="Fixed: " + IP_TITLE,
                p_body="Home internet IP is %s again, matching the Mercury token's IP list." % now, p_area="cost", p_needs_jared=None, p_healed=False)
        out["resolved"] = True
    return out


def run(argv):
    """-> (results, heals). Never raises."""
    if os.path.exists(OFF):
        return [], []
    dry = "--dry" in argv
    no_heal = dry or "--no-heal" in argv
    raise_now = "--raise-now" in argv
    sim = next((a.split("=", 1)[1] for a in argv if a.startswith("--sim=")), None)
    try:
        st = json.load(open(STATE))
    except Exception:  # noqa: BLE001
        st = {}
    st.setdefault("fails", {})
    results, heals = [], []
    for name, fn in CHECKS.items():
        try:
            r = fn()
        except Exception as e:  # noqa: BLE001
            r = _res(name, "red", "check crashed: " + str(e)[:160])
        if sim == name:
            r = _res(name, "red", f"SIMULATED: {name} forced stale for a watchdog test", age=999)
        # heal first
        if r["status"] == "red" and not no_heal and sim != name:
            if name in JOBS:
                ok, out = _run_job(JOBS[name])
                heals.append({"target": name, "action": f"re-ran {JOBS[name]}", "ok": ok, "output": out})
                if ok:
                    again = CHECKS[name]()
                    if again["status"] == "green":
                        again["healed"] = True
                        again["detail"] = "was stale; re-ran the job and it is fresh again. " + again["detail"]
                        r = again
        if name == "turo_reader" and r.get("stale") and not no_heal and sim != name:
            heals.append(heal_turo_reader())
        # an explicit --sim with --no-heal exercises the alert path; a plain --sim exercises heal where one exists
        if sim == name and not no_heal and name in JOBS:
            ok, out = _run_job(JOBS[name])
            heals.append({"target": name, "action": f"re-ran {JOBS[name]} (simulation)", "ok": ok, "output": out})
            real = CHECKS[name]()
            if ok and real["status"] == "green":
                real["healed"] = True
                real["detail"] = "SIMULATED stale source; the heal re-ran the job and the real reading is fresh. " + real["detail"]
                r = real
        c = name
        st["fails"][c] = (st["fails"].get(c, 0) + 1) if r["status"] == "red" else 0
        r["fails"] = st["fails"][c]
        results.append(r)
    if not dry:
        if not sim:
            with open(STATE + ".tmp", "w") as f:
                json.dump(st, f)
            os.replace(STATE + ".tmp", STATE)
        try:
            open_keys = {i["key"] for i in lib.get("monitor_issues", "key=like.cc.*&status=eq.open&select=key")}
        except Exception:  # noqa: BLE001
            open_keys = set()
        for r in results:
            c = r["check"]
            key = AREA[c][0]
            try:
                if r["status"] == "red" and key not in open_keys and (r["fails"] >= 2 or raise_now or c in ("mercury_balance", "turo_reader")):
                    _raise(c, r, r["fails"])
                elif r["status"] == "green" and key in open_keys and not sim:
                    _resolve(c, r)
            except Exception as e:  # noqa: BLE001
                r["raise_error"] = str(e)[:120]
    try:
        mercury_ip_watch(dry=dry or bool(sim))   # Penny's IP-change check; own alert key, not part of the Command Center cards
    except Exception:  # noqa: BLE001
        pass
    return results, heals
