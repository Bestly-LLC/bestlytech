"""Plug Puller (Charging Attendant): ends Jared's ChargePoint session the moment the Tesla is done.

Pi cron job, every minute: /opt/bestly/cron/run.sh charge_stop   (code copy: tools/plug-puller/ in the bestlytech repo)

Target = the one-off target set on /admin/turo (Plug Puller card), else the car's own charge limit, so whatever
Jared sets in the Tesla app that day is what counts. The session is ended when any of these is true:
  1. the car is at/over the target (fresh reading, car parked at the station)
  2. the car says charging is Complete
  3. ChargePoint shows no power for 10+ min after energy already went in (car is done; idle fee time)
Ending the session closes it in ChargePoint, so billing (and the idle fee) stops.

Polls ChargePoint every 1-2 min while a session is on, every 2 min while the car is plugged in, else every 30 min.
Self-heal: rebuilds the venv if the library breaks; retries a stop 3 times before asking Jared; raises
chargepoint.signin (owned by Plug Puller) when ChargePoint signs it out and clears it when it's back.
Watchdog: pi_job_report every run (pi_jobs.max_gap_min 10 -> Scout if silent).

Flags: --dry  read and decide, change nothing
"""
import datetime
import json
import math
import os
import subprocess
import time

import lib

VENV = "/opt/bestly/chargepoint/venv"
BRIDGE = "/opt/bestly/chargepoint/cp.py"
STATE_FILE = "/opt/bestly/cron/state/charge_stop.json"
IDLE_MIN = 10
# ChargePoint session states that mean the session is still open (anything else after a stop = closed).
ACTIVE = {"in_use", "charging", "fully_charged", "waiting", "starting", "suspended", "suspended_ev", "suspended_evse"}
UTC = datetime.timezone.utc


def _now():
    return datetime.datetime.now(UTC)


def _ts(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def _local():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def _save_local(d):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(d, f)


def _dist_m(a, b, c, d):
    if None in (a, b, c, d) or not a or not c:
        return None
    r = 6371000
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = p2 - p1, math.radians(d - b)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _heal_venv(loc):
    """Rebuild the ChargePoint venv (at most every 6 h)."""
    last = loc.get("venv_heal_at", 0)
    if time.time() - last < 6 * 3600:
        return "venv broken; rebuilt recently, waiting"
    loc["venv_heal_at"] = time.time()
    _save_local(loc)
    subprocess.run(["python3", "-m", "venv", VENV], capture_output=True, timeout=120)
    r = subprocess.run([VENV + "/bin/pip", "install", "-q", "--upgrade", "python-chargepoint"], capture_output=True, text=True, timeout=600)
    return "venv rebuilt" if r.returncode == 0 else "venv rebuild failed: " + (r.stderr or "")[-200:]


def _cp(cmd, user, token, *args):
    env = dict(os.environ, CP_USERNAME=user, CP_TOKEN=token)
    r = subprocess.run([VENV + "/bin/python", BRIDGE, cmd, *args], capture_output=True, text=True, timeout=90, env=env)
    line = (r.stdout or "").strip().splitlines()
    if not line:
        return {"ok": False, "kind": "bridge", "msg": (r.stderr or "no output")[-300:]}
    try:
        return json.loads(line[-1])
    except ValueError:
        return {"ok": False, "kind": "bridge", "msg": line[-1][:300]}


def _notify(title, body, level="active", tag=None):
    try:
        lib.rpc("charge_stop_notify", p_title=title, p_body=body, p_level=level, p_tag=tag)
    except Exception as e:  # noqa: BLE001
        print(f"  notify failed: {e}", flush=True)


def _raise(key, kind, title=None, body=None, needs=None):
    try:
        lib.rpc("bestly_raise", p_key=key, p_kind=kind, p_severity="warning", p_title=title, p_body=body,
                p_area="car", p_needs_jared=needs, p_healed=False)
    except Exception as e:  # noqa: BLE001
        print(f"  bestly_raise failed: {e}", flush=True)


def _car():
    r = lib.get("tesla_fleet_state", "select=observed_at,battery,charging,raw&id=eq.1")
    if not r:
        return {}
    c = r[0]
    raw = c.get("raw") or {}
    ch = raw.get("charge") or {}
    return {
        "at": _ts(c.get("observed_at")), "battery": c.get("battery"), "state": c.get("charging") or "",
        "limit": ch.get("limit_pct"), "fast": bool(ch.get("fast")), "plugged": bool(raw.get("plugged_in")),
        "lat": raw.get("latitude"), "lon": raw.get("longitude"),
    }


def _want_refresh():
    """Ask the Tesla worker for a fresh reading (car is awake while charging, so this never wakes it)."""
    q = lib.get("tesla_fleet_commands", "select=id&action=eq.refresh&status=in.(queued,running)&limit=1")
    if not q:
        lib._req("POST", "/rest/v1/tesla_fleet_commands", {"action": "refresh", "auto": True})


def main(argv):
    dry = "--dry" in argv
    st = (lib.get("charge_stop_state", "select=*&id=eq.1") or [{}])[0]
    if not st.get("enabled", True):
        return "skip: paused on /admin/turo"
    token = lib.rpc("pi_secret_get", p_name="pi:chargepoint:token")
    user = lib.rpc("pi_secret_get", p_name="pi:chargepoint:username")
    if not token or not user:
        return "skip: ChargePoint not connected yet (/admin/turo, Plug Puller card)"

    loc = _local()
    car = _car()
    now = _now()
    watching = st.get("session_id")
    target = st.get("target_override") or car.get("limit")
    fresh = car.get("at") and now - car["at"] < datetime.timedelta(minutes=15)
    near = fresh and target and car.get("battery") is not None and car["battery"] >= target - 2
    plugged = car.get("plugged") or car.get("state") in ("Charging", "Starting", "Complete", "Stopped", "NoPower")

    # How often to ask ChargePoint (keeps us well under anything that looks like a bot).
    last = _ts(st.get("last_cp_check_at"))
    if watching:
        every = 1 if (near or car.get("state") == "Complete" or st.get("stop_tries")) else 2
    elif plugged and not car.get("fast"):
        every = 2
    else:
        every = 30
    if last and now - last < datetime.timedelta(minutes=every, seconds=-10):
        return f"ok: next ChargePoint check in <{every} min"

    if watching and near and car["at"] and now - car["at"] > datetime.timedelta(minutes=2) and not dry:
        try:
            _want_refresh()
        except Exception as e:  # noqa: BLE001
            print(f"  refresh request failed: {e}", flush=True)

    res = _cp("status", user, token)
    if not res.get("ok"):
        kind = res.get("kind")
        if kind == "bridge":
            return _heal_venv(loc) + " | " + res.get("msg", "")[:200]
        if kind in ("signed_out", "captcha"):
            if not dry:
                lib.rpc("charge_stop_save", p={"signed_in": False, "last_error": res.get("msg") or kind, "checked": True,
                                               **({"log_kind": "signed_out"} if st.get("signed_in") is not False else {})})
                _raise("chargepoint.signin", "problem", "Plug Puller: ChargePoint signed me out",
                       "I can't see or end your charging sessions until I'm signed back in.",
                       "Log in at driver.chargepoint.com, then paste the fresh coulomb_sess cookie on /admin/turo (Plug Puller card).")
            return f"signed out of ChargePoint ({kind})"
        loc["errs"] = loc.get("errs", 0) + 1
        _save_local(loc)
        if loc["errs"] >= 3:
            raise RuntimeError(f"ChargePoint check failed {loc['errs']}x: {res.get('msg')}")
        return f"ok: ChargePoint hiccup {loc['errs']}x (retrying): {res.get('msg', '')[:120]}"

    loc["errs"] = 0
    _save_local(loc)
    if res.get("token") and not dry:
        lib.rpc("pi_secret_put", p_name="pi:chargepoint:token", p_value=res["token"])
    patch = {"signed_in": True, "last_error": None, "checked": True,
             "battery": car.get("battery"), "car_limit": car.get("limit")}
    if st.get("signed_in") is False and not dry:
        _raise("chargepoint.signin", "resolved")
        patch["log_kind"] = "signed_in"

    s = res.get("session")
    if not s:
        if watching:
            patch.update({"session_id": None, "session_state": "ended", "power_kw": None, "idle_since": None,
                          "stop_tries": 0, "clear_target": True, "log_kind": "ended", "log_session": str(watching)})
        if not dry:
            lib.rpc("charge_stop_save", p=patch)
        return "ok: no ChargePoint session" + (" (watched one ended)" if watching else "")

    sid = s["session_id"]
    power = float(s.get("power_kw") or 0)
    energy = float(s.get("energy_kwh") or 0)
    idle_since = _ts(st.get("idle_since")) if watching == sid else None
    if power < 0.1:
        idle_since = idle_since or now
    else:
        idle_since = None
    patch.update({"session_id": sid, "session_state": s.get("state"), "power_kw": power, "energy_kwh": energy,
                  "cost": s.get("cost"), "station": s.get("device_name") or s.get("company"),
                  "station_lat": s.get("lat"), "station_lon": s.get("lon"),
                  "idle_since": idle_since.isoformat() if idle_since else None})
    station = s.get("device_name") or s.get("company") or "ChargePoint"
    new_session = False
    stopped_before = str(sid) in loc.get("stopped", {})
    if stopped_before and (s.get("state") or "").lower() not in ACTIVE:
        if not dry:
            lib.rpc("charge_stop_save", p={k: v for k, v in patch.items() if k in ("signed_in", "last_error", "checked", "battery", "car_limit")})
        return f"ok: session {sid} already closed ({s.get('state')})"
    if watching != sid and not stopped_before:
        start = _ts(s.get("start")) or now
        patch.update({"session_started_at": start.isoformat(), "stop_tries": 0,
                      "log_kind": "watching", "log_session": str(sid),
                      "log_detail": {"station": station, "target": target, "override": st.get("target_override")}})
        new_session = True

    # Is the Tesla reading about this plug? (car parked at the station, or the station has no location)
    d = _dist_m(car.get("lat"), car.get("lon"), s.get("lat"), s.get("lon"))
    car_here = d is None or d < 800
    started = _ts(st.get("session_started_at")) if watching == sid else now
    reason = None
    if stopped_before:
        reason = "I ended it before but ChargePoint still shows it open"
    elif fresh and car_here and target and car.get("battery") is not None and car["battery"] >= target:
        reason = f"car at {car['battery']}% (target {target}%)"
    elif fresh and car_here and car.get("state") == "Complete":
        reason = f"car says charging is complete ({car.get('battery')}%)"
    elif idle_since and energy > 0.5 and now - idle_since >= datetime.timedelta(minutes=IDLE_MIN) \
            and started and now - started >= datetime.timedelta(minutes=IDLE_MIN):
        reason = f"no power flowing for {int((now - idle_since).total_seconds() // 60)} min"

    if not reason:
        if not dry:
            lib.rpc("charge_stop_save", p=patch)
            if new_session:
                tgt = (f"{target}%" + (" (your one-off target)" if st.get("target_override") else " (the car's limit)")) if target else "when the car is done"
                _notify(f"Watching your charge at {station}", f"I'll end the ChargePoint session at {tgt}.", "passive", f"cp-watch-{sid}")
        b = car.get("battery")
        return f"ok: watching session {sid} at {station}: car {b}% / target {target}%, {power:.1f} kW"

    if dry:
        return f"DRY would end session {sid}: {reason}"
    tries = int(st.get("stop_tries") or 0) + 1 if (watching == sid or stopped_before) else 1
    out = _cp("stop", user, token, str(sid))
    after = out.get("session") if out.get("ok") else None
    ended = out.get("ok") and (after is None or (after.get("state") or "").lower() not in ACTIVE)
    if ended:
        loc.setdefault("stopped", {})[str(sid)] = time.time()
        loc["stopped"] = {k: v for k, v in loc["stopped"].items() if time.time() - v < 2 * 86400}
        _save_local(loc)
        cost = (after or s).get("cost")
        kwh = (after or s).get("energy_kwh") or energy
        summary = f"Ended at {car.get('battery')}%: {reason}. {kwh:.1f} kWh" + (f", ${float(cost):.2f}" if cost else "") + f" at {station}."
        patch.update({"session_id": None, "session_state": "ended by Plug Puller", "stop_tries": 0, "clear_target": True,
                      "stopped_summary": summary, "log_kind": "stopped", "log_session": str(sid),
                      "log_detail": {"reason": reason, "battery": car.get("battery"), "kwh": kwh, "cost": cost, "station": station}})
        lib.rpc("charge_stop_save", p=patch)
        if tries > 1:
            _raise("chargepoint.stop", "resolved")
        _notify(f"Ended your charge at {car.get('battery')}%",
                f"{kwh:.1f} kWh" + (f", ${float(cost):.2f}" if cost else "") + f" at {station}. "
                "The ChargePoint session is closed, so no idle fee. Unplug whenever.", "active", f"cp-stopped-{sid}")
        return "STOPPED " + summary
    patch.update({"stop_tries": tries, "log_kind": "stop_failed", "log_session": str(sid),
                  "log_detail": {"try": tries, "reason": reason, "msg": out.get("msg")}})
    lib.rpc("charge_stop_save", p=patch)
    if tries >= 3:
        _notify("I couldn't end your ChargePoint session",
                f"Tried {tries} times ({reason}). End it in the ChargePoint app so the idle fee doesn't start.",
                "time-sensitive", f"cp-stopfail-{sid}")
        _raise("chargepoint.stop", "problem", "Plug Puller: couldn't end a ChargePoint session",
               f"Session {sid} at {station}: {out.get('msg') or 'ChargePoint still shows it running'}.",
               "End it in the ChargePoint app.")
    return f"stop try {tries} for session {sid} did not confirm: {out.get('msg') or (after or {}).get('state')}"
