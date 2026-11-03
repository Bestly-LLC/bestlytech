"""Mae's charging planner watchdog (CHARGEPLAN_20261103). Hestia cron job, every 10 min: /opt/bestly/cron/run.sh charge_plan_watch

Checks the planner and heals what it can. DIGEST-ONLY: nothing here ever pushes to Jared's phone. Problems become one line in the
7 AM digest (signed Mae) plus a quiet Scout row; they clear on their own when the cause is gone.
  1. planner loop stalled (no run in 25 min, or last run failed)   -> runs the planner once itself
  2. station data stale > 30 min                                    -> re-syncs the ChargePoint token from Home Assistant if it expired, re-polls
  3. ChargePoint captcha / signed out                               -> digest line (polling pauses itself: 6 h for a captcha)
  4. car data stale                                                 -> digest line
Heartbeat: pi_job_report every run (pi_jobs charge_plan_watch, max gap 25 min -> Scout). The planner has its own heartbeat.
Off switch: touch /opt/bestly/cron/state/charge_plan_watch.OFF
"""
import datetime
import json
import os

import lib
import charge_plan as cp

STATE = "/opt/bestly/cron/state/charge_plan_watch.json"
OFF = "/opt/bestly/cron/state/charge_plan_watch.OFF"
REDIGEST_H = 24
UTC = datetime.timezone.utc


def load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"open": {}}


def save(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f:
        json.dump(s, f)


def main(argv):
    if os.path.exists(OFF):
        return "skip: charge_plan_watch.OFF"
    dry = "--dry" in argv
    c = cp.cfg()
    now = cp.now_utc()
    state = load()
    problems, healed = {}, []

    # 1. planner loop
    job = (lib.get("pi_jobs", "select=last_run_at,last_ok,last_summary&job=eq.charge_plan") or [{}])[0]
    last = cp.ts(job.get("last_run_at"))
    if not last or now - last > datetime.timedelta(minutes=25) or job.get("last_ok") is False:
        try:
            if not dry:
                cp.main(["--force"])
            healed.append("planner re-run")
        except Exception as e:  # noqa: BLE001
            problems["car.charge.loop"] = ("The charging planner is not running", f"It stopped or failed and a re-run did not fix it: {type(e).__name__}: {str(e)[:150]}")

    # 2 + 3. station data
    st = (lib.get("charge_station_state", "select=*&id=eq.1") or [{}])[0]
    ok_at = cp.ts(st.get("ok_at"))
    if not ok_at or now - ok_at > datetime.timedelta(minutes=c["station_fresh_min"]):
        kind = st.get("err_kind")
        if kind == "signed_out" and not dry:
            if cp.sync_token_from_ha():
                st, note = cp.refresh_station(c, force=True)
                healed.append("ChargePoint token re-synced: " + note[:40])
                ok_at = cp.ts(st.get("ok_at"))
        if not ok_at or now - ok_at > datetime.timedelta(minutes=c["station_fresh_min"]):
            if kind == "captcha":
                problems["car.charge.station"] = ("ChargePoint asked for a human check",
                                                  "I stopped polling The Blake charger for 6 hours. Charge plans use the saved price schedule, and charger availability shows as unknown.")
            elif kind == "signed_out":
                problems["car.charge.station"] = ("The ChargePoint token needs a refresh",
                                                  "I cannot read The Blake charger right now. Plans still use the saved price schedule; charger availability shows as unknown.")
            else:
                since = f"since {cp.fmt_clock(ok_at, now)}" if ok_at else "yet"
                problems["car.charge.station"] = ("The Blake charger data is stale",
                                                  f"No good reading {since}. {(st.get('last_error') or 'No error recorded.')[:140]} I keep retrying with a backoff.")

    # 4. car data
    for r in lib.get("car_charge_plan", "select=vin,car,data_at,stale,updated_at") or []:
        da = cp.ts(r.get("data_at"))
        if not da or now - da > datetime.timedelta(hours=6):
            seen = cp.fmt_clock(da, now) if da else "never"
            problems[f"car.charge.car.{r['vin'][-6:]}"] = (f"{r['car']} car data is old", f"Last reading {seen}. The charge plan for it is paused until fresh data arrives.")

    # report new problems (digest + quiet Scout row), clear solved ones
    opened = state.setdefault("open", {})
    for key, (title, body) in problems.items():
        prev = cp.ts(opened.get(key))
        if prev is None or now - prev > datetime.timedelta(hours=REDIGEST_H):
            if not dry:
                lib.rpc("car_charge_digest", p_title=title, p_body=body, p_tag=f"{key}.{now.astimezone(cp.LA).strftime('%Y%m%d')}")
                try:
                    lib.notify("Mae: " + title, body, severity="info", push=False, url="/admin", dedupe=f"{key}-{now.astimezone(cp.LA).strftime('%Y%m%d')}")
                except Exception as e:  # noqa: BLE001
                    print(f"  scout row failed: {e}", flush=True)
            opened[key] = cp.iso(now) if prev is None else opened[key]
            if prev is not None:
                opened[key] = cp.iso(now)
    for key in list(opened):
        if key not in problems:
            del opened[key]
            healed.append("cleared " + key)
    if not dry:
        save(state)
    summary = ("problems: " + "; ".join(t for t, _ in problems.values())) if problems else "all clear"
    return f"ok: {summary}" + (f" | healed: {', '.join(healed)}" if healed else "")
