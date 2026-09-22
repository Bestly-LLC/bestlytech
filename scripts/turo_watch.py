#!/usr/bin/env python3
"""
Turo Watch runner — runs on the Mac mini (launchd, 7:05 and 19:12 PT), independent of Claude.
It can also run on bestly-pi: every machine-specific path comes from the environment.

  turo_watch.py                 normal run (writes prices when every gate passes)
  turo_watch.py --propose-only  read and plan, never write
  turo_watch.py --login         open a visible Chrome window on this machine's screen at the Turo
                                sign-in page, using the runner's own profile, so Jared can sign in
                                himself. The runner never types a password.

Prices the Tesla Model 3 "Blue Steel" (vehicleId 2522178) twice a day.
Model Y 3494788 was totaled 2026-08-05 and must NEVER be priced.

Non-negotiables enforced here:
  - never log in, never enter credentials, never solve a CAPTCHA
  - a blocked run is a SUCCESSFUL run, and is always recorded
  - never price below the Turo dynamic floor
  - HTTP 200 is not proof: every write is verified by a re-pull
  - never touch booked days

Every run writes a row to turo_runs even when it writes nothing to Turo.
"""
import json, os, re, sys, time, statistics, datetime, traceback
from zoneinfo import ZoneInfo

import requests
from playwright.sync_api import sync_playwright

TZ = ZoneInfo("America/Los_Angeles")

CFG = {
    "VEHICLE_ID": 2522178,
    "COMP_RADIUS_MI": 25.0,   # do NOT tighten: below ~25mi the sample drops under n<5
    "CEILING_MULT": 1.10,     # not 1.15 until FSD is confirmed in the listing copy
    "HOST_FACTOR": 0.603,
    "WINDOW_DAYS": 8,
    "MAX_MOVE": 0.25,
    "WHIPLASH": 0.30,
    "MIN_N": 5,
    "MIN_CAL_DAYS": 30,
    "PROFILE": os.environ.get("TURO_PROFILE", "/var/lib/bestly/turo-profile"),
    "CHROMIUM": os.environ.get("TURO_CHROMIUM", "/usr/bin/chromium"),   # "chrome" = installed Google Chrome
    "ENV": os.environ.get("TURO_ENV", "/home/pi/scripts/.env"),
    "RUNNER": os.environ.get("TURO_RUNNER", "bestly-pi"),
    "SETTLE_S": 9,            # navigate, wait, then read. never been rate-limited
    "VERIFY_WAIT_S": 20,
}

LOG = []


def log(msg):
    stamp = datetime.datetime.now(TZ).strftime("%H:%M:%S")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    LOG.append(line)


def load_env(path):
    env = {}
    with open(path) as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            k, v = raw.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env(CFG["ENV"])
SB_URL = ENV["SUPABASE_URL"].rstrip("/")
SB_KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"]
NTFY = ENV.get("NTFY_TOPIC", "").strip()
SB_HEAD = {
    "apikey": SB_KEY,
    "Authorization": f"Bearer {SB_KEY}",
    "Content-Type": "application/json",
}


def sb(method, path, headers=None, **kw):
    r = requests.request(method, f"{SB_URL}/rest/v1/{path}", headers={**SB_HEAD, **(headers or {})}, timeout=30, **kw)
    r.raise_for_status()
    return r.json() if r.text.strip() else None


def notify(title, body, priority="default"):
    """Make failure loud. Silence is how the Aug and Sept outages hid.
    Goes to the admin bell + phone (scout_notify) and, if set, the old ntfy topic."""
    try:
        sb("POST", "rpc/scout_notify", json={
            "p_title": title[:200], "p_body": body[:500],
            "p_severity": "warning" if priority in ("high", "urgent") else "info",
            "p_push": priority in ("high", "urgent"), "p_url": "/admin/turo",
            "p_dedupe": "turo." + re.sub(r"[^a-z]+", "-", title.lower())[:40] + "." + datetime.datetime.now(TZ).strftime("%Y%m%d%H"),
        })
    except Exception as exc:
        log(f"bell notify failed (non-fatal): {exc}")
    if not NTFY:
        return
    try:
        requests.post(
            f"https://ntfy.sh/{NTFY}",
            data=body.encode("utf-8"),
            # HTTP headers must be ASCII: an em dash here broke every ntfy alert.
            headers={"Title": title.replace("\u2014", "-").encode("ascii", "replace").decode(), "Priority": priority, "Tags": "car"},
            timeout=15,
        )
    except Exception as exc:
        log(f"ntfy failed (non-fatal): {exc}")


# ---------------------------------------------------------------- Turo reads

CAL_JS = """
async (payload) => {
  const r = await fetch('https://turo.com/api/fleet/calendar', {
    method:'POST', credentials:'include',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)});
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch(e) {}
  return {status: r.status, body: j, snippet: t.slice(0,200)};
}
"""

PRICE_JS = """
async (payload) => {
  const r = await fetch('https://turo.com/api/fleet/pricing', {
    method:'PUT', credentials:'include',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)});
  const t = await r.text();
  return {status: r.status, snippet: t.slice(0,300)};
}
"""

COMPS_JS = """
() => {
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/car-rental/"]')) {
    const m = (a.getAttribute('href')||'').match(/(\\d{5,})/);
    if (!m) continue;
    const id = m[1]; if (seen.has(id)) continue; seen.add(id);
    const root = a.closest('div[class],li') || a;
    const txt = (root.innerText||'').replace(/\\s+/g,' ').trim();
    const dm = txt.match(/([\\d.]+)\\s*mi\\b/i);
    const dollars = [...txt.matchAll(/\\$([\\d,]+(?:\\.\\d+)?)/g)]
        .map(x => parseFloat(x[1].replace(/,/g,'')));
    out.push({id, dist: dm ? parseFloat(dm[1]) : null, dollars});
  }
  return out;
}
"""


def fetch_calendar(page, today):
    res = page.evaluate(CAL_JS, {
        "daysPerPage": 35,
        "includeVehicleDetails": True,
        "startDate": today.isoformat(),
        "vehicleIds": [CFG["VEHICLE_ID"]],
    })
    if res["status"] != 200 or not res.get("body"):
        return None, f"calendar HTTP {res['status']}"
    fc = (res["body"].get("fleetCalendar") or [None])[0]
    if not fc:
        return None, "calendar returned no fleetCalendar entry"
    veh = (fc.get("vehicleDetails") or {}).get("id")
    if veh != CFG["VEHICLE_ID"]:
        return None, f"calendar returned wrong vehicle {veh}"
    days = {}
    for d in fc.get("dailyData") or []:
        date = d.get("date")
        if not date:
            continue
        cur_obj = (d.get("price") or {}).get("price") or {}
        def_obj = (d.get("defaultPrice") or {}).get("price") or {}
        cur = cur_obj.get("amount")
        floor = def_obj.get("amount") if def_obj.get("amount") else cur
        days[date] = {
            "floor": int(floor) if floor else None,
            "cur": int(cur) if cur else None,
            "booked": bool(d.get("unavailabilities")),
        }
    return days, None


def scrape_comps(page, start, end):
    url = (
        "https://turo.com/us/en/search?country=US"
        f"&startDate={start.strftime('%m/%d/%Y').replace('/', '%2F')}&startTime=10%3A00"
        f"&endDate={end.strftime('%m/%d/%Y').replace('/', '%2F')}&endTime=10%3A00"
        "&location=Los%20Angeles%2C%20CA&locationType=CITY&makes=Tesla&models=Model%203"
    )
    page.goto(url, timeout=60000)
    time.sleep(CFG["SETTLE_S"])
    for _ in range(3):
        page.mouse.wheel(0, 4000)
        time.sleep(1.5)
    raw = page.evaluate(COMPS_JS)
    comps = []
    for c in raw:
        if str(c["id"]) == str(CFG["VEHICLE_ID"]):
            continue
        if c["dist"] is None or c["dist"] > CFG["COMP_RADIUS_MI"]:
            continue
        if not c["dollars"]:
            continue
        total = c["dollars"][-1]          # the DISCOUNTED total is the last $ on the card
        comps.append({
            "listing_id": str(c["id"]),
            "distance_mi": c["dist"],
            "trip_total": total,
            "daily_renter": round(total / 7.0, 2),
        })
    return comps


# ------------------------------------------------------------------ compute

def lead_mult(lead):
    return 1.20 if lead >= 8 else 1.12 if lead >= 4 else 1.06 if lead >= 2 else 1.00


def plan_day(date, lead, floor, cur, ceiling):
    """Returns (proposed, status, reason). Floor always wins."""
    mult = lead_mult(lead)
    computed = round(floor * mult)
    final = max(floor, min(computed, ceiling))
    final = max(round(cur * (1 - CFG["MAX_MOVE"])), min(final, round(cur * (1 + CFG["MAX_MOVE"]))))
    final = max(final, floor)                       # floor beats the move cap
    reason = f"lead {lead} x{mult:g}" + (" - floor wins" if final == floor else "")
    status = "no-op" if final == cur else "planned"
    return int(final), status, reason


def build_plan(cal, today, ceiling):
    rows = []
    for i in range(1, CFG["WINDOW_DAYS"] + 1):
        d = today + datetime.timedelta(days=i)
        ds = d.isoformat()
        info = cal.get(ds)
        if not info:
            rows.append({"date": ds, "lead": i, "floor": None, "cur": None, "proposed": None,
                         "status": "no-data", "reason": "day absent from fleet calendar", "src": "fleet calendar"})
            continue
        if info["booked"]:
            rows.append({"date": ds, "lead": i, "floor": info["floor"], "cur": info["cur"], "proposed": None,
                         "status": "booked", "reason": "booked - never touched", "src": "fleet calendar"})
            continue
        floor, cur = info["floor"], info["cur"]
        if not floor or not cur:
            rows.append({"date": ds, "lead": i, "floor": floor, "cur": cur, "proposed": None,
                         "status": "no-data", "reason": "null/zero floor or price", "src": "fleet calendar"})
            continue
        proposed, status, reason = plan_day(ds, i, floor, cur, ceiling)
        rows.append({"date": ds, "lead": i, "floor": floor, "cur": cur, "proposed": proposed,
                     "status": status, "reason": reason, "src": "fleet calendar"})
    return rows


def run_gates(comps, cal, cal_err, plan, market_base, prev_host_net, host_net, fallback):
    """Five gates. Any TRIPPED means write nothing."""
    n = len(comps)
    gates = []

    gates.append({"gate": "Thin sample", "cond": "n < 5 or full-LA fallback",
                  "result": "TRIPPED" if (n < CFG["MIN_N"] or fallback) else "PASS",
                  "detail": f"n = {n}" + (" (full-LA fallback fired)" if fallback else "")})

    if prev_host_net and host_net:
        move = (host_net - prev_host_net) / float(prev_host_net)
        gates.append({"gate": "Market whiplash", "cond": "marketBase moved > 30%",
                      "result": "TRIPPED" if abs(move) > CFG["WHIPLASH"] else "PASS",
                      "detail": f"host-net {prev_host_net} -> {host_net} = {move*100:+.1f}%"})
    else:
        gates.append({"gate": "Market whiplash", "cond": "marketBase moved > 30%",
                      "result": "N/A", "detail": "no previous market point to compare"})

    if cal_err or not cal:
        cal_res, cal_detail = "TRIPPED", cal_err or "no calendar"
    elif len(cal) < CFG["MIN_CAL_DAYS"]:
        cal_res, cal_detail = "TRIPPED", f"only {len(cal)} days returned"
    elif any(r["floor"] in (None, 0) for r in plan if r["status"] not in ("no-data",)):
        cal_res, cal_detail = "TRIPPED", "a floor came back null or zero"
    else:
        cal_res, cal_detail = "PASS", f"{len(cal)} days, all floors present"
    gates.append({"gate": "Bad calendar", "cond": "<30 days or null/zero floor",
                  "result": cal_res, "detail": cal_detail})

    gates.append({"gate": "Bridge down", "cond": "session dead or page failed",
                  "result": "TRIPPED" if cal_err else "PASS",
                  "detail": cal_err or "Turo session live"})

    below = [r["date"] for r in plan if r.get("proposed") and r.get("floor") and r["proposed"] < r["floor"]]
    gates.append({"gate": "Never below floor", "cond": "final < floor",
                  "result": "TRIPPED" if below else "PASS",
                  "detail": f"below floor on {below}" if below else "none below floor"})

    return gates, any(g["result"] == "TRIPPED" for g in gates)


# ------------------------------------------------------------- write + verify

def apply_writes(page, plan, today):
    """Group same-price days into one call. Returns list of intended writes."""
    groups = {}
    for r in plan:
        if r["status"] != "planned":
            continue
        groups.setdefault(r["proposed"], []).append(r["date"])

    intended = []
    for amount, dates in sorted(groups.items()):
        res = page.evaluate(PRICE_JS, {
            "updateAmount": int(amount),
            "updateType": "FIXED_AMOUNT",
            "vehicleDates": [{"dates": sorted(dates), "vehicleId": CFG["VEHICLE_ID"]}],
        })
        log(f"PUT ${amount} x{len(dates)} days -> HTTP {res['status']}")
        ok = res["status"] == 200
        for d in dates:
            intended.append({"date": d, "amount": int(amount), "http_ok": ok})
        time.sleep(1.2)
    return intended


def verify_writes(page, intended, today):
    """HTTP 200 is NOT proof. Re-pull and compare every day."""
    if not intended:
        return {}, None
    log(f"waiting {CFG['VERIFY_WAIT_S']}s before verification re-pull")
    time.sleep(CFG["VERIFY_WAIT_S"])
    cal2, err = fetch_calendar(page, today)
    if err or not cal2:
        return {}, err or "verification re-pull failed"
    out = {}
    for w in intended:
        actual = (cal2.get(w["date"]) or {}).get("cur")
        out[w["date"]] = {"intended": w["amount"], "actual": actual,
                          "verified": actual == w["amount"]}
    return out, None


# ------------------------------------------------------------------ persist

def record_run(mode, today, start, end, market_base, host_net, comps, ceiling,
               gates, plan, verified_map, notes):
    written = sum(1 for r in plan if r.get("applied"))
    verified = sum(1 for v in verified_map.values() if v["verified"])
    blocked = sum(1 for r in plan if r["status"] in ("blocked", "no-data"))

    run = sb("POST", "turo_runs", headers={**SB_HEAD, "Prefer": "return=representation"},
             json={
                 "runner": CFG["RUNNER"], "mode": mode, "vehicle_id": CFG["VEHICLE_ID"],
                 "window_start": start.isoformat(), "window_end": end.isoformat(),
                 "market_base": market_base, "host_net": host_net,
                 "comp_n": len(comps), "ceiling": ceiling,
                 "gates": gates, "days_written": written, "days_verified": verified,
                 "days_blocked": blocked, "ok": True, "notes": notes,
             })[0]
    rid = run["id"]

    day_rows = []
    for r in plan:
        v = verified_map.get(r["date"], {})
        day_rows.append({
            "run_id": rid, "date": r["date"], "lead": r["lead"],
            "floor": r["floor"], "cur": r["cur"], "proposed": r["proposed"],
            "applied": r.get("applied"), "actual": v.get("actual"),
            "verified": bool(v.get("verified")), "status": r["status"],
            "gate": r.get("gate"), "reason": r["reason"], "src": r["src"],
        })
    if day_rows:
        sb("POST", "turo_day_prices", json=day_rows)
    if comps:
        sb("POST", "turo_comps", json=[{**c, "run_id": rid} for c in comps])
    return rid


def prev_host_net():
    rows = sb("GET", "turo_runs?select=host_net&host_net=not.is.null&order=ran_at.desc&limit=1")
    return rows[0]["host_net"] if rows else None


# --------------------------------------------------------------------- main

PROPOSE_ONLY = "--propose-only" in sys.argv


def open_browser(p, headless):
    kw = dict(headless=headless, viewport={"width": 1440, "height": 1000})
    if CFG["CHROMIUM"] == "chrome":
        kw["channel"] = "chrome"          # the Mac mini's real Google Chrome
    else:
        kw["executable_path"] = CFG["CHROMIUM"]
        kw["args"] = ["--no-sandbox", "--disable-dev-shm-usage"]
        kw["user_agent"] = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                            "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36")
    return p.chromium.launch_persistent_context(CFG["PROFILE"], **kw)


def login_window():
    """Show the sign-in page on this machine's screen; Jared signs in himself."""
    with sync_playwright() as p:
        ctx = open_browser(p, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://turo.com/us/en/login", timeout=60000)
        log("Turo sign-in window is open on this machine's screen. Waiting up to 15 minutes.")
        deadline = time.time() + 900
        while time.time() < deadline:
            time.sleep(10)
            try:
                cal, err = fetch_calendar(page, datetime.datetime.now(TZ).date())
                if not err:
                    log("Signed in: the calendar answers. Closing the window.")
                    notify("Turo is signed in again", "The next price run will be able to write.")
                    break
            except Exception:
                pass
        ctx.close()

def main():
    today = datetime.datetime.now(TZ).date()
    start = today + datetime.timedelta(days=1)
    end = today + datetime.timedelta(days=CFG["WINDOW_DAYS"])
    log(f"run start · today {today} · window {start}..{end}")

    comps, cal, cal_err, plan = [], None, None, []
    market_base = host_net = ceiling = None
    verified_map = {}

    with sync_playwright() as p:
        ctx = open_browser(p, headless=True)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            # 1. session probe. NEVER log in.
            page.goto("https://turo.com/us/en/trips/calendar", timeout=60000)
            time.sleep(CFG["SETTLE_S"])
            cal, cal_err = fetch_calendar(page, today)
            if cal_err:
                log(f"SESSION PROBLEM: {cal_err}")
            else:
                log(f"calendar ok: {len(cal)} days")

            # 2. comps (public page, works even when logged out)
            comps = scrape_comps(page, start, end)
            log(f"comps: n={len(comps)}")
            if comps:
                market_base = round(statistics.median(c["daily_renter"] for c in comps), 2)
                host_net = round(market_base * CFG["HOST_FACTOR"])
                ceiling = round(market_base * CFG["CEILING_MULT"])
                log(f"marketBase ${market_base} · hostNet ${host_net} · ceiling ${ceiling}")

            # 3. plan
            if cal and ceiling:
                plan = build_plan(cal, today, ceiling)

            # 4. gates
            gates, tripped = run_gates(comps, cal, cal_err, plan, market_base,
                                       prev_host_net(), host_net, fallback=False)
            for g in gates:
                log(f"gate {g['gate']}: {g['result']} ({g['detail']})")

            # 5. apply, only if nothing tripped (and not a propose-only run)
            if PROPOSE_ONLY and not tripped:
                tripped = True
                gates.append({"gate": "Propose only", "result": "TRIPPED", "detail": "asked for a dry run"})
            if tripped:
                mode = "propose-only" if (cal_err or PROPOSE_ONLY) else "blocked"
                blockers = ", ".join(g["gate"] for g in gates if g["result"] == "TRIPPED")
                for r in plan:
                    if r["status"] in ("planned", "no-op"):
                        r["status"] = "blocked"
                        r["gate"] = blockers
                if not plan:
                    plan = [{"date": (start + datetime.timedelta(days=i)).isoformat(),
                             "lead": i + 1, "floor": None, "cur": None, "proposed": None,
                             "status": "no-data", "gate": blockers,
                             "reason": "no calendar this run", "src": "none"}
                            for i in range(CFG["WINDOW_DAYS"])]
                notes = f"GATES TRIPPED: {blockers}. Nothing written."
                log(f"WRITE BLOCKED: {blockers}")
                notify("Turo Watch — nothing written",
                       f"{blockers}\nMarket ${market_base} n={len(comps)}\n"
                       f"{'Turo session is dead. Tap Log in to Turo on the admin Turo page.' if cal_err else ''}",
                       priority="low" if PROPOSE_ONLY and not cal_err else "high")
            else:
                intended = apply_writes(page, plan, today)
                for r in plan:
                    if r["status"] == "planned":
                        r["applied"] = r["proposed"]
                verified_map, verr = verify_writes(page, intended, today)
                if verr:
                    log(f"VERIFICATION FAILED: {verr}")
                    notes = f"Writes sent but verification re-pull failed: {verr}"
                    notify("Turo Watch — NOT verified", verr, priority="high")
                else:
                    for r in plan:
                        v = verified_map.get(r["date"])
                        if v:
                            r["status"] = "applied" if v["verified"] else "not-verified"
                            r["reason"] += "" if v["verified"] else \
                                f" | NOT VERIFIED intended {v['intended']} actual {v['actual']}"
                    ok_n = sum(1 for v in verified_map.values() if v["verified"])
                    bad = [d for d, v in verified_map.items() if not v["verified"]]
                    notes = f"{ok_n}/{len(verified_map)} days verified."
                    log(notes)
                    if bad:
                        notify("Turo Watch — some days NOT verified", f"{bad}", priority="high")
                mode = "applied"

            rid = record_run(mode, today, start, end, market_base, host_net, comps,
                             ceiling, gates, plan, verified_map, notes)
            log(f"recorded run {rid} mode={mode}")
        finally:
            ctx.close()


if __name__ == "__main__":
    if "--login" in sys.argv:
        login_window()
        sys.exit(0)
    try:
        main()
    except Exception:
        tb = traceback.format_exc()
        print(tb, file=sys.stderr)
        try:
            sb("POST", "turo_runs", json={
                "runner": CFG["RUNNER"], "mode": "blocked", "ok": True,
                "gates": [{"gate": "Bridge down", "result": "TRIPPED", "detail": "runner crashed"}],
                "notes": f"CRASH: {tb[-800:]}"})
            notify("Turo Watch — runner crashed", tb[-300:], priority="urgent")
        except Exception:
            pass
        sys.exit(1)
