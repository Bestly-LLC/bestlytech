import sys, time, shutil
P="/opt/bestly/cron/jobs/charge_plan.py"
src=open(P).read()
shutil.copy(P, P+".bak_carcard_"+time.strftime("%Y%m%d-%H%M"))
def sub(a,b):
    global src
    assert src.count(a)==1,(src.count(a),a[:60])
    src=src.replace(a,b)
sub('''        if s <= now < e:
            d["out"] = True
''','''        if s <= now < e:
            d["out"] = True
            d["end"] = e   # CARCARD_20261103: trip_end for the wall Cars card
''')
sub('''"hours_to_target": None, "kwh_needed": None, "est_cost": None, "updated_at": iso(now)}
    name = car["car"]
    if (trips.get(car["vin"]) or {}).get("out"):
        p.update(status="away", plan_text=f"{name} is out on a trip")''','''"hours_to_target": None, "kwh_needed": None, "est_cost": None, "updated_at": iso(now),
         "trip_end": None, "sweep_due": None, "sweep_end": None}
    name = car["car"]
    if (trips.get(car["vin"]) or {}).get("out"):
        p.update(status="away", plan_text=f"{name} is out on a trip", trip_end=iso(trips[car["vin"]]["end"]) if trips[car["vin"]].get("end") else None)''')
sub('''# ------------------------------------------------------------------ alerts
def alert_texts''','''# ------------------------------------------------------------------ street sweeping (CARCARD_20261103)
def sweep_for(car, trips, now):
    """(move_by, sweep_end) when the car is parked on a swept curb of N Kings Rd and the next sweep starts within 12 h (or is under way); else (None, None).
    Source = the same live tables the Blue Steel sweep alert uses: bluesteel_sweep_locate(lat, lon) + bluesteel_sweep_config.skip_dates."""
    if car.get("stale") or car.get("lat") is None or car.get("lon") is None or (trips.get(car["vin"]) or {}).get("out"):
        return None, None
    try:
        loc = lib.rpc("bluesteel_sweep_locate", p_lat=car["lat"], p_lon=car["lon"])
        if not loc or loc.get("dow") is None:
            return None, None
        skips = ((lib.get("bluesteel_sweep_config", "select=skip_dates&id=eq.1") or [{}])[0].get("skip_dates")) or []
        la = now.astimezone(LA)
        for off in (0, 1):
            day = (la + datetime.timedelta(days=off)).date()
            if day.isoweekday() % 7 != int(loc["dow"]) or str(day) in skips:
                continue
            base = datetime.datetime(day.year, day.month, day.day, tzinfo=LA)
            start = base + datetime.timedelta(minutes=int(loc["start_min"]))
            end = base + datetime.timedelta(minutes=int(loc["end_min"]))
            if end <= now:
                continue
            if start - datetime.timedelta(hours=12) <= now:
                return start.astimezone(UTC), end.astimezone(UTC)
            return None, None
    except Exception as e:  # noqa: BLE001
        print(f"  sweep lookup failed: {type(e).__name__}: {str(e)[:100]}", flush=True)
    return None, None


# ------------------------------------------------------------------ alerts
def alert_texts''')
sub('''        p = plan_car(car, trips, station, c, hub, now)
        alerts = run_alerts(p, c, station, now, dry)''','''        p = plan_car(car, trips, station, c, hub, now)
        sw = sweep_for(car, trips, now)
        p["sweep_due"], p["sweep_end"] = (iso(sw[0]), iso(sw[1])) if sw[0] else (None, None)
        alerts = run_alerts(p, c, station, now, dry)''')
open(P,"w").write(src)
print("planner patched")
