"""Mae's charging planner (CHARGEPLAN_20261103). Hestia cron job, every 10 min: /opt/bestly/cron/run.sh charge_plan

1. STATION: reads The Blake ChargePoint charger (live ports + time-of-use price) through /opt/bestly/chargepoint/cp.py (read-only).
   Polls at most every 10 min, backs off on errors, stops for 6 h on a DataDome captcha. Station id lives in /opt/bestly/chargepoint/station.json.
2. CARS: every row of turo_vehicle_state (freshest of vehicle state, tesla_fleet_state, car_trail), home or not, next Turo trip from turo_trips.
3. PLAN: cheapest contiguous charging window that reaches the target (80%) before the next trip, from the station price schedule.
4. ALERTS (Mae): charge-now nudge and won't-be-ready, both time-sensitive pushes; quiet hours 11 PM to 7 AM hold them. Everything else is digest-only.

No AI, no paid service. Flags: --dry (compute, print, write and send nothing)  --force (ignore the 10 min poll gap)
--preview (print what each alert WOULD say for a made-up low-battery car; writes and sends nothing)
Off switch: touch /opt/bestly/cron/state/charge_plan.OFF
"""
import datetime
import json
import math
import os
import subprocess
from zoneinfo import ZoneInfo

import lib

LA = ZoneInfo("America/Los_Angeles")
UTC = datetime.timezone.utc
CFG_FILE = "/opt/bestly/chargepoint/station.json"
VENV_PY = "/opt/bestly/chargepoint/venv/bin/python"
BRIDGE = "/opt/bestly/chargepoint/cp.py"
HA_ENTRIES = "/mnt/ssd/apps/homeassistant/.storage/core.config_entries"
OFF = "/opt/bestly/cron/state/charge_plan.OFF"
SLOT = datetime.timedelta(minutes=15)
DEFAULTS = {
    "device_id": 187133, "name": "ESSEX / THE BLAKE 01", "short_name": "the Blake charger",
    "home_lat": 34.08436, "home_lon": -118.37193, "home_radius_m": 150,
    "port_kw": 6.6, "wall_efficiency": 0.90, "target_pct": 80, "trip_buffer_min": 30,
    "pack_kwh": {"default": 52.0}, "poll_min": 10, "station_fresh_min": 30, "car_stale_min": 180,
    "alert_cooldown_h": 3, "trip_window_h": 12, "horizon_h": 30, "service_fee": 0.25,
    "captcha_backoff_h": 6, "quiet_from": 23, "quiet_to": 7,
}


# ------------------------------------------------------------------ helpers
def cfg():
    c = dict(DEFAULTS)
    try:
        with open(CFG_FILE) as f:
            c.update(json.load(f))
    except (OSError, ValueError):
        pass
    return c


def now_utc():
    return datetime.datetime.now(UTC)


def ts(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def iso(dt):
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def ceil5(dt):
    """Round a time up to the next 5 minutes so nothing reads like 12:01 AM."""
    m = dt.minute + (1 if dt.second or dt.microsecond else 0)
    return dt.replace(second=0, microsecond=0) + datetime.timedelta(minutes=(-m) % 5)


def fmt_clock(dt, now=None, day=True, full=False):
    """12-hour clock: 8 PM, 3:15 AM (full=True gives 9:00 AM). Adds 'tomorrow' or a weekday when it is not today."""
    l = dt.astimezone(LA)
    h = l.hour % 12 or 12
    s = f"{h}" + (f":{l.minute:02d}" if (l.minute or full) else "") + (" AM" if l.hour < 12 else " PM")
    if day:
        today = (now or now_utc()).astimezone(LA).date()
        if l.date() == today + datetime.timedelta(days=1):
            s = "tomorrow " + s
        elif l.date() != today:
            s = l.strftime("%a ") + s
    return s


def fmt_dur(hours):
    mins = int(math.ceil(hours * 60 / 5.0) * 5)
    h, m = divmod(mins, 60)
    if h and m:
        return f"{h} h {m} min"
    return f"{h} h" if h else f"{m} min"


def money(x):
    return f"${x:.2f}"


def quiet_now(c, now=None):
    h = (now or now_utc()).astimezone(LA).hour
    return h >= c["quiet_from"] or h < c["quiet_to"]


def dist_m(a, b, c, d):
    if None in (a, b, c, d):
        return None
    r = 6371000
    p1, p2 = math.radians(a), math.radians(c)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(d - b) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def patch(table, where, body):
    return lib._req("PATCH", f"/rest/v1/{table}?{where}", body, headers={"Prefer": "return=minimal"})


def upsert(table, key, body):
    return lib._req("POST", f"/rest/v1/{table}?on_conflict={key}", body, headers={"Prefer": "resolution=merge-duplicates,return=minimal"})


# ------------------------------------------------------------------ ChargePoint (read-only)
def sync_token_from_ha():
    """Self-heal: Home Assistant's ChargePoint add-on keeps its own live sign-in for the same account. When the Vault copy
    has expired, copy HA's current token into Vault (pi:chargepoint:token). Never printed, never logged."""
    try:
        with open(HA_ENTRIES) as f:
            entries = json.load(f)["data"]["entries"]
        e = [x for x in entries if x.get("domain") == "chargepoint"][0]["data"]
        tok, user = e.get("access_token"), e.get("username")
    except (OSError, ValueError, KeyError, IndexError):
        return False
    if not tok or not user:
        return False
    cur = lib.rpc("pi_secret_get", p_name="pi:chargepoint:token")
    if cur == tok:
        return False
    lib.rpc("pi_secret_put", p_name="pi:chargepoint:token", p_value=tok)
    if lib.rpc("pi_secret_get", p_name="pi:chargepoint:username") != user:
        lib.rpc("pi_secret_put", p_name="pi:chargepoint:username", p_value=user)
    return True


def cp_call(cmd, *args):
    user = lib.rpc("pi_secret_get", p_name="pi:chargepoint:username")
    token = lib.rpc("pi_secret_get", p_name="pi:chargepoint:token")
    if not token or not user:
        return {"ok": False, "kind": "signed_out", "msg": "no ChargePoint token stored"}
    env = dict(os.environ, CP_USERNAME=user, CP_TOKEN=token)
    try:
        r = subprocess.run([VENV_PY, BRIDGE, cmd, *[str(a) for a in args]], capture_output=True, text=True, timeout=90, env=env)
    except subprocess.TimeoutExpired:
        return {"ok": False, "kind": "error", "msg": "ChargePoint bridge timed out"}
    lines = (r.stdout or "").strip().splitlines()
    if not lines:
        return {"ok": False, "kind": "error", "msg": (r.stderr or "no output")[-200:]}
    try:
        out = json.loads(lines[-1])
    except ValueError:
        return {"ok": False, "kind": "error", "msg": lines[-1][:200]}
    new = out.pop("token", None)
    if new:
        lib.rpc("pi_secret_put", p_name="pi:chargepoint:token", p_value=new)
    return out


def refresh_station(c, force=False, dry=False):
    """Returns (station_row, note). Never raises on ChargePoint trouble: records it and backs off."""
    rows = lib.get("charge_station_state", "select=*&id=eq.1") or [{}]
    st = rows[0]
    now = now_utc()
    bo = ts(st.get("backoff_until"))
    if not force and bo and now < bo:
        return st, "backoff until " + fmt_clock(bo)
    fa = ts(st.get("fetched_at"))
    if not force and fa and now - fa < datetime.timedelta(minutes=c["poll_min"] - 1):
        return st, "fresh"
    out = cp_call("station", c["device_id"])
    healed = False
    if not out.get("ok") and out.get("kind") == "signed_out" and sync_token_from_ha():
        healed = True
        out = cp_call("station", c["device_id"])
    body = {"fetched_at": iso(now), "updated_at": iso(now)}
    if out.get("ok"):
        s = out["station"]
        ports = [{"outlet": p.get("outlet"), "status": p.get("status_v2") or p.get("status"), "max_kw": p.get("max_kw")} for p in s.get("ports", [])]
        tou = []
        for t in s["price"].get("tou", []):      # ChargePoint sometimes sends midnight as 0 instead of 86400
            a, b = int(t.get("start") or 0), int(t.get("end") or 0)
            if b == 0 and a > 0:
                b = 86400
            if b > a and t.get("amount") is not None:
                tou.append({"start": a, "end": b, "amount": t["amount"]})
        body.update({
            "device_id": c["device_id"], "name": " / ".join(s.get("name") or []) or c["name"], "address": s.get("address"),
            "station_status": s.get("status_v2") or s.get("station_status"), "ports": ports,
            "ports_free": sum(1 for p in ports if p["status"] == "available"), "ports_total": len(ports),
            "tou": tou, "service_fee": ((s["price"].get("service_fee") or {}).get("amount")),
            "idle_rate_hr": s["price"].get("idle_per_hr"),
            "idle_grace_min": int((s["price"].get("idle_grace_s") or 0) / 60),
            "ok_at": iso(now), "last_error": None, "err_kind": None, "err_count": 0, "backoff_until": None,
        })
        note = "ok" + (" (token re-synced from Home Assistant)" if healed else "")
    else:
        kind, errs = out.get("kind") or "error", int(st.get("err_count") or 0) + 1
        if kind == "captcha":
            back = datetime.timedelta(hours=c["captcha_backoff_h"])
        elif kind == "signed_out":
            back = datetime.timedelta(minutes=30)
        else:
            back = datetime.timedelta(minutes=min(10 * 2 ** (errs - 1), 120))
        body.update({"last_error": (out.get("msg") or kind)[:300], "err_kind": kind, "err_count": errs, "backoff_until": iso(now + back)})
        note = f"{kind}: {(out.get('msg') or '')[:100]}; backing off {int(back.total_seconds() // 60)} min"
    if not dry:
        patch("charge_station_state", "id=eq.1", body)
        st = (lib.get("charge_station_state", "select=*&id=eq.1") or [st])[0]
    else:
        st = {**st, **body}
    return st, note


# ------------------------------------------------------------------ pricing and windows
def price_at(dt, tou, hub):
    l = dt.astimezone(LA)
    sod = l.hour * 3600 + l.minute * 60 + l.second
    for t in tou or []:
        if t["start"] <= sod < t["end"]:
            return float(t["amount"])
    return float(hub["night_rate"] if (l.hour >= hub["night_from_hour"] or l.hour < hub["night_to_hour"]) else hub["day_rate"])


def window_cost(start, kwh_wall, c, tou, hub):
    per_slot = c["port_kw"] * 0.25
    rem, t, cost = kwh_wall, start, 0.0
    while rem > 1e-9:
        e = min(per_slot, rem)
        cost += e * price_at(t, tou, hub)
        rem -= e
        t += SLOT
    return cost


def best_window(first_start, limit, kwh_wall, c, tou, hub):
    """Cheapest contiguous window starting at first_start or on a 15 min boundary after it; earliest wins a tie."""
    dur = datetime.timedelta(hours=kwh_wall / c["port_kw"])
    starts = [first_start]
    t = first_start.astimezone(LA).replace(second=0, microsecond=0)
    t = (t + datetime.timedelta(minutes=15 - t.minute % 15)).astimezone(UTC)
    while t + dur <= limit:
        starts.append(t)
        t += SLOT
    best = None
    for s in starts:
        if s + dur > limit:
            continue
        cost = window_cost(s, kwh_wall, c, tou, hub)
        if best is None or cost < best[0] - 1e-6:
            best = (cost, s)
    return best, dur


# ------------------------------------------------------------------ cars
def load_cars(c):
    cars = []
    vs = lib.get("turo_vehicle_state", "select=vin,display_name,observed_at,battery_pct,range_epa,range_real,latitude,longitude,charging_state,plugged_in,connection_state") or []
    fleet = (lib.get("tesla_fleet_settings", "select=vin&id=eq.1") or [{}])[0].get("vin")
    fs = (lib.get("tesla_fleet_state", "select=observed_at,battery,range_mi,charging&id=eq.1") or [None])[0]
    for v in vs:
        row = {"vin": v["vin"], "car": v.get("display_name") or v["vin"][-6:], "soc": v.get("battery_pct"),
               "range_mi": v.get("range_epa") or v.get("range_real"), "lat": v.get("latitude"), "lon": v.get("longitude"),
               "state": v.get("charging_state"), "plugged": bool(v.get("plugged_in")), "at": ts(v.get("observed_at")),
               "source": "turo_vehicle_state", "online": v.get("connection_state")}
        if fs and v["vin"] == fleet and ts(fs.get("observed_at")) and (not row["at"] or ts(fs["observed_at"]) > row["at"]):
            row.update({"soc": fs.get("battery"), "range_mi": fs.get("range_mi") or row["range_mi"], "state": fs.get("charging") or row["state"],
                        "at": ts(fs["observed_at"]), "source": "tesla_fleet_state"})
        tr = (lib.get("car_trail", f"select=at,lat,lon,battery&vin=eq.{v['vin']}&order=at.desc&limit=1") or [None])[0]
        if tr and ts(tr.get("at")) and ts(tr["at"]) > now_utc() - datetime.timedelta(hours=6):
            row["lat"], row["lon"] = tr["lat"], tr["lon"]
            if row["at"] is None or ts(tr["at"]) > row["at"]:
                if tr.get("battery") is not None:
                    row["soc"] = tr["battery"]
                row["at"], row["source"] = ts(tr["at"]), "car_trail"
        d = dist_m(row["lat"], row["lon"], c["home_lat"], c["home_lon"])
        row["home"] = d is not None and d <= c["home_radius_m"]
        row["stale"] = (row["at"] is None) or (now_utc() - row["at"] > datetime.timedelta(minutes=c["car_stale_min"]))
        cars.append(row)
    return cars


def load_trips(now):
    rows = lib.get("turo_trips", "select=reservation_id,vin,starts_at,ends_at,status,in_progress&status=in.(BOOKED,IN_PROGRESS)"
                                 f"&ends_at=gt.{iso(now)}&order=starts_at.asc") or []
    out = {}
    for t in rows:
        s, e = ts(t["starts_at"]), ts(t["ends_at"])
        d = out.setdefault(t["vin"], {"out": False, "next": None})
        if s <= now < e:
            d["out"] = True
        elif s > now and d["next"] is None:
            d["next"] = {"id": t["reservation_id"], "at": s}
    return out


def plan_car(car, trips, station, c, hub, now):
    tou = station.get("tou") or []
    fee = float(station.get("service_fee") if station.get("service_fee") is not None else c["service_fee"])
    st_fresh = bool(ts(station.get("ok_at")) and now - ts(station["ok_at"]) <= datetime.timedelta(minutes=c["station_fresh_min"]))
    ports_free = station.get("ports_free") if st_fresh else None
    trip = (trips.get(car["vin"]) or {}).get("next")
    p = {"vin": car["vin"], "car": car["car"], "soc": car["soc"], "range_mi": car["range_mi"], "home": car["home"],
         "plugged_in": car["plugged"], "charging_state": car["state"], "data_at": iso(car["at"]), "stale": car["stale"],
         "data_source": car["source"], "next_trip_at": iso(trip["at"]) if trip else None, "next_trip_id": trip["id"] if trip else None,
         "target_pct": c["target_pct"], "charger_status": ("%s of %s free" % (ports_free, station.get("ports_total")) if st_fresh else "unknown"),
         "price_now": round(price_at(now, tou, hub), 4), "est_is_estimate": True, "plan_start": None, "plan_end": None,
         "hours_to_target": None, "kwh_needed": None, "est_cost": None, "updated_at": iso(now)}
    name = car["car"]
    if (trips.get(car["vin"]) or {}).get("out"):
        p.update(status="away", plan_text=f"{name} is out on a trip")
        return p
    if car["soc"] is None or car["stale"]:
        seen = f", last seen {fmt_clock(car['at'], now)}" if car["at"] else ""
        p.update(status="stale", plan_text=f"{name} data is old{seen}")
        return p
    if not car["home"]:
        p.update(status="away", plan_text=f"{name} is away from The Blake")
        return p
    if car["soc"] >= c["target_pct"]:
        p.update(status="ready", plan_text=f"{name} is at {car['soc']}%, no charge needed")
        return p
    pack = float(c["pack_kwh"].get(car["vin"], c["pack_kwh"]["default"]))
    kwh_batt = (c["target_pct"] - car["soc"]) / 100.0 * pack
    kwh_wall = kwh_batt / c["wall_efficiency"]
    dur_h = kwh_wall / c["port_kw"]
    p.update(kwh_needed=round(kwh_wall, 1), hours_to_target=round(dur_h, 2))
    limit = (trip["at"] - datetime.timedelta(minutes=c["trip_buffer_min"])) if trip else now + datetime.timedelta(hours=c["horizon_h"])
    first = now
    busy = ports_free == 0 and car["state"] not in ("Charging", "Starting")
    if busy:
        first = now + datetime.timedelta(hours=1)
    cost_now = window_cost(now, kwh_wall, c, tou, hub) + fee
    p["detail_cost_now"] = round(cost_now, 2)
    best, dur = best_window(first, limit, kwh_wall, c, tou, hub)
    if car["state"] in ("Charging", "Starting"):
        end = ceil5(now + dur)
        p.update(status="charging", plan_start=iso(now), plan_end=iso(end), est_cost=round(window_cost(now, kwh_wall, c, tou, hub) + fee, 2),
                 plan_text=f"{name} is charging, at {car['soc']}%, done about {fmt_clock(end, now)}")
        return p
    if best is None:
        end = ceil5(now + dur)
        trip_s = fmt_clock(trip["at"], now, full=True) if trip else "soon"
        p.update(status="wont_make", plan_start=iso(now), plan_end=iso(end), est_cost=round(cost_now, 2),
                 plan_text=f"{name} won't be ready: {car['soc']}%, trip at {trip_s}, needs about {fmt_dur(dur_h)} on {c['short_name']}")
        return p
    cost, start = best
    end = ceil5(start + dur)
    est = round(cost + fee, 2)
    starts_now = start - now < datetime.timedelta(minutes=15)
    when = f"now until {fmt_clock(end, now)}" if starts_now else f"{fmt_clock(start, now)} to {fmt_clock(end, start, day=False)}"
    p.update(status="busy" if busy else "plan", plan_start=iso(start), plan_end=iso(end), est_cost=est,
             plan_text=f"Charge {name} {when} · est. {money(est)}" + (" (charger busy now)" if busy else ""))
    return p


# ------------------------------------------------------------------ alerts
def alert_texts(p, c, now):
    """The exact text each alert would carry. Returns (charge_now, wont_ready), either may be None."""
    name, soc = p["car"], p["soc"]
    cn = wr = None
    cost_now = p.get("detail_cost_now")
    if cost_now is not None and p.get("hours_to_target"):
        cn = (f"{c['short_name'][0].upper() + c['short_name'][1:]} is free: {name} {soc}%, charge now (est. {money(cost_now)} to {p['target_pct']}%)",
              f"Plug in now. About {fmt_dur(p['hours_to_target'])} to {p['target_pct']}% at this charger.")
    if p.get("next_trip_at") and p.get("hours_to_target"):
        wr = (f"{name} won't be ready: {soc}%, trip at {fmt_clock(ts(p['next_trip_at']), now, full=True)}, needs ~{fmt_dur(p['hours_to_target'])} on {c['short_name']}",
              f"Plug in as soon as you can. {name} is at {soc}% and needs about {fmt_dur(p['hours_to_target'])} to reach {p['target_pct']}%.")
    return cn, wr


def already(vin, kind, since=None, trip_id=None):
    q = f"select=id&vin=eq.{vin}&kind=eq.{kind}&result=neq.held&limit=1"
    if since:
        q += f"&sent_at=gt.{iso(since)}"
    if trip_id is not None:
        q += f"&trip_id=eq.{trip_id}"
    return bool(lib.get("car_charge_alert_log", q))


def log_alert(vin, kind, trip_id, text, result):
    lib._req("POST", "/rest/v1/car_charge_alert_log", {"vin": vin, "kind": kind, "trip_id": trip_id, "text": text, "result": result},
             headers={"Prefer": "return=minimal"})


def run_alerts(p, c, station, now, dry):
    out = []
    if p["status"] in ("away", "stale", "ready") or p.get("soc") is None or p["stale"]:
        return out
    cn, wr = alert_texts(p, c, now)
    st_fresh = bool(ts(station.get("ok_at")) and now - ts(station["ok_at"]) <= datetime.timedelta(minutes=c["station_fresh_min"]))
    trip_at = ts(p.get("next_trip_at"))
    # 1. Charger is free, car is home and under target, and it is a good time or a trip is close.
    if cn and st_fresh and (station.get("ports_free") or 0) >= 1 and p["home"] and p["soc"] < p["target_pct"] \
            and not p["plugged_in"] and p["status"] in ("plan", "wont_make"):
        in_window = ts(p["plan_start"]) <= now + datetime.timedelta(minutes=15) <= ts(p["plan_end"]) + datetime.timedelta(minutes=15)
        soon = trip_at is not None and trip_at - now < datetime.timedelta(hours=c["trip_window_h"])
        if in_window or soon:
            if quiet_now(c, now):
                out.append("charge-now held for quiet hours")
            elif already(p["vin"], "charge_now", since=now - datetime.timedelta(hours=c["alert_cooldown_h"])):
                out.append("charge-now cooling down (3 h)")
            elif dry:
                out.append("DRY would send charge-now: " + cn[0])
            else:
                res = lib.rpc("car_charge_notify", p_title=cn[0], p_body=cn[1], p_tag=f"car.charge.now.{p['vin']}.{now.astimezone(LA).strftime('%Y%m%d%H')}")
                log_alert(p["vin"], "charge_now", None, cn[0], str(res))
                out.append("SENT charge-now: " + cn[0])
    # 2. The plan cannot reach the target before the next trip. Once per trip.
    if wr and p["status"] == "wont_make" and p["home"] and p.get("next_trip_id") is not None:
        if quiet_now(c, now):
            out.append("wont-be-ready held for quiet hours")
        elif already(p["vin"], "wont_ready", trip_id=p["next_trip_id"]):
            out.append("wont-be-ready already sent for this trip")
        elif dry:
            out.append("DRY would send wont-be-ready: " + wr[0])
        else:
            res = lib.rpc("car_charge_notify", p_title=wr[0], p_body=wr[1], p_tag=f"car.charge.late.{p['next_trip_id']}")
            log_alert(p["vin"], "wont_ready", p["next_trip_id"], wr[0], str(res))
            out.append("SENT wont-be-ready: " + wr[0])
    return out


# ------------------------------------------------------------------ main
def preview(c, station, hub, now):
    """What each alert would say for a made-up car: 34%, home, trip tomorrow 9 AM. Prints only."""
    tomorrow9 = (now.astimezone(LA) + datetime.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0).astimezone(UTC)
    car = {"vin": "PREVIEW", "car": "Blue Steel", "soc": 34, "range_mi": 64, "lat": c["home_lat"], "lon": c["home_lon"], "state": "Disconnected",
           "plugged": False, "at": now, "source": "preview", "home": True, "stale": False}
    for label, trip_in_h in (("trip tomorrow 9 AM", None), ("trip in 2 h (cannot make it)", 2)):
        at = tomorrow9 if trip_in_h is None else now + datetime.timedelta(hours=trip_in_h)
        trips = {"PREVIEW": {"out": False, "next": {"id": 1, "at": at}}}
        p = plan_car(car, trips, station, c, hub, now)
        cn, wr = alert_texts(p, c, now)
        print(f"  [{label}] plan: {p['plan_text']}")
        print(f"     charge-now : {cn[0] if cn else None}")
        print(f"     won't-ready: {wr[0] if wr else None}")


def main(argv):
    if os.path.exists(OFF):
        return "skip: charge_plan.OFF"
    dry, force = "--dry" in argv, "--force" in argv
    c = cfg()
    now = now_utc()
    hub = lib.get("home_charge_settings", "select=*&id=eq.1")[0]
    station, note = refresh_station(c, force=force or "--preview" in argv, dry=dry or "--preview" in argv)
    print(f"  station: {station.get('name')} status={station.get('station_status')} ports={station.get('ports')} free={station.get('ports_free')}/{station.get('ports_total')} ({note})", flush=True)
    print("  price schedule: " + "; ".join(f"{t['start']//3600}:00-{t['end']//3600}:00 ${t['amount']}" for t in station.get("tou") or []), flush=True)
    if "--preview" in argv:
        preview(c, station, hub, now)
        return "ok: preview only"
    cars, trips = load_cars(c), load_trips(now)
    lines = []
    for car in cars:
        p = plan_car(car, trips, station, c, hub, now)
        alerts = run_alerts(p, c, station, now, dry)
        row = {k: v for k, v in p.items() if not k.startswith("detail_")}
        if not dry:
            upsert("car_charge_plan", "vin", row)
        print(f"  {car['car']}: {p['status']} soc={p['soc']}% home={p['home']} stale={p['stale']} src={p['data_source']} trip={p['next_trip_at']} "
              f"plan={p['plan_start']}..{p['plan_end']} kwh={p['kwh_needed']} est={p['est_cost']} | {p['plan_text']}", flush=True)
        for a in alerts:
            print("     alert: " + a, flush=True)
        lines.append(f"{car['car']} {p['status']}")
    return "ok: " + "; ".join(lines) + f" | station {note[:60]}"
