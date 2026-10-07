#!/usr/bin/env python3
"""
Turo Watch on bestly-pi (2026-10-03). Prices Blue Steel (Tesla Model 3, Turo vehicle 2522178) twice a day,
the same job the "Turo Watch 7:05am / 7:12pm" Claude scheduled tasks did through Chrome on the Mac mini.

Rules come from bestly_private_memory area='turo' (algorithm, gates, run-procedure) and are unchanged:
  - never log in, never enter credentials, never solve a CAPTCHA, never work around a bot check
  - "You've been blocked" / a challenge = Bridge down -> PROPOSE-ONLY, write nothing, say so
  - never below the Turo dynamic floor, max +/-25% per day per run
  - 2026-10-06 (pi-1.1.0): market is compared in LISTING dollars (renter median x 0.603). Before this the
    ceiling was renter dollars vs listing prices, so the market never touched a price and the only driver
    was Turo's price x the lead multiplier - which marked every open day DOWN as it got closer.
    Now: pull up to the market median, hold any price still within 10% of market (no markdowns from the
    lead tiers), Busy/Hot demand adds 5%/10%. Only prices more than 10% over market AND over Turo x lead come down.
  - never touch booked days, only vehicle 2522178, never listing content
  - HTTP 200 is not proof: every write is verified by a re-pull ~20 s later, stop on the first mismatch
  - every run is recorded (turo_runs, turo_day_prices, turo_comps, turo_competitor_prices, turo_demand)
    and relayed to Scout in 3 short lines

How it gets in: it does NOT launch a browser. It opens a tab in the Pi Turo reader's own Chromium
(bestly-turo-reader.service, plain Chromium Jared signed in to once, DevTools on 127.0.0.1:9334) and closes
that tab when done. Turo blocks Playwright-launched browsers, so this never launches one.

  turo_watch_pi.py            normal run (respects turo_settings.paused)
  turo_watch_pi.py --dry      compute + print only: no Turo writes, nothing recorded
"""
import datetime, json, re, statistics, sys, time, traceback
from zoneinfo import ZoneInfo

import requests
from playwright.sync_api import sync_playwright

VERSION = "pi-1.1.0"
TZ = ZoneInfo("America/Los_Angeles")
CDP = "http://127.0.0.1:9334"
DRY = "--dry" in sys.argv
CFG = {
    "VEHICLE_ID": 2522178, "COMP_RADIUS_MI": 25.0, "CEILING_MULT": 1.10, "HOST_FACTOR": 0.603,
    "WINDOW_DAYS": 8, "MAX_MOVE": 0.25, "WHIPLASH": 0.30, "MIN_N": 5, "MIN_CAL_DAYS": 30,
    "SETTLE_S": 9, "DEMAND_BOOST": {"Busy": 0.05, "Hot": 0.10}, "VERIFY_WAIT_S": 20, "ENV": "/home/pi/scripts/.env",
}
LOG = []


def log(msg):
    line = f"[{datetime.datetime.now(TZ).strftime('%I:%M:%S %p')}] {msg}"
    print(line, flush=True)
    LOG.append(line)


def load_env(path):
    env = {}
    for raw in open(path):
        raw = raw.strip()
        if raw and not raw.startswith("#") and "=" in raw:
            k, v = raw.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env(CFG["ENV"])
SB_URL = ENV["SUPABASE_URL"].rstrip("/")
SB_KEY = ENV.get("SUPABASE_SECRET_KEY") or ENV["SUPABASE_SERVICE_ROLE_KEY"]
SB_HEAD = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}


def sb(method, path, **kw):
    r = requests.request(method, f"{SB_URL}/rest/v1/{path}", headers=kw.pop("headers", SB_HEAD), timeout=30, **kw)
    r.raise_for_status()
    return r.json() if r.text.strip() else None


def rpc(fn, args):
    return sb("POST", f"rpc/{fn}", json=args)


def fmt_d(d):
    return d.strftime("%m/%d/%Y").replace("/", "%2F")


def blocked_page(page):
    try:
        t = (page.title() or "") + " " + (page.evaluate("document.body ? document.body.innerText.slice(0, 400) : ''") or "")
    except Exception:
        return False
    return bool(re.search(r"you've been blocked|verify you are human|attention required|just a moment", t, re.I))


# ---------------------------------------------------------------- Turo reads

CAL_JS = """
async (payload) => {
  const r = await fetch('https://turo.com/api/fleet/calendar', {method:'POST', credentials:'include',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch(e) {}
  return {status: r.status, body: j, snippet: t.slice(0,200)};
}"""

PRICE_JS = """
async (payload) => {
  const r = await fetch('https://turo.com/api/fleet/pricing', {method:'PUT', credentials:'include',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
  const t = await r.text(); return {status: r.status, snippet: t.slice(0,300)};
}"""

# One card per listing: walk up from the listing link until the element holds the distance and the
# "$X$Y total" line, but never far enough to swallow a second listing. Discounted total = last $ before "total".
CARDS_JS = r"""() => {
  const out = [], seen = new Set();
  const idOf = h => { const m = (h||'').match(/\/(\d{5,})(?:[/?#]|$)/); return m ? m[1] : null; };
  for (const a of document.querySelectorAll('a[href*="/car-rental/"]')) {
    const id = idOf(a.getAttribute('href')); if (!id || seen.has(id)) continue;
    let el = a, root = null;
    for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
      const ids = new Set([...el.querySelectorAll('a[href*="/car-rental/"]')].map(x => idOf(x.getAttribute('href'))).filter(Boolean));
      if (ids.size > 1) break;
      const t = el.innerText || '';
      if (/\btotal\b/i.test(t) && /\$\d/.test(t)) { root = el; break; }
    }
    if (!root) continue;
    seen.add(id);
    const t = (root.innerText || '').replace(/\s+/g, ' ').trim();
    const dm = t.match(/([\d.]+)\s*mi\b/i);
    const tm = t.match(/((?:\$[\d,]+(?:\.\d+)?)+)\s*total/i);
    const d = tm ? [...tm[1].matchAll(/\$([\d,]+(?:\.\d+)?)/g)].map(x => parseFloat(x[1].replace(/,/g, ''))) : [];
    const name = (t.split(' Add car')[0] || '').slice(0, 40);
    const yr = (t.match(/\b(20\d\d|19\d\d)\b/) || [])[1] || '';
    out.push({id, dist: dm ? parseFloat(dm[1]) : null, dollars: d, name: (name + ' ' + yr).trim()});
  }
  return out;
}"""

SCROLL_JS = r"""() => { const as = [...document.querySelectorAll('a[href*="/car-rental/"]')];
  if (as.length) as[as.length - 1].scrollIntoView({block: 'center'}); window.scrollBy(0, 900);
  document.querySelectorAll('*').forEach(el => { if (el.scrollHeight > el.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop += 900; }); }"""


def read_cards(page, rounds=12):
    allc = {}
    for _ in range(rounds):
        for c in page.evaluate(CARDS_JS):
            allc.setdefault(c["id"], c)
        page.evaluate(SCROLL_JS)
        time.sleep(1.5)
    for c in page.evaluate(CARDS_JS):
        allc.setdefault(c["id"], c)
    return list(allc.values())


def fetch_calendar(page, today):
    res = page.evaluate(CAL_JS, {"daysPerPage": 35, "includeVehicleDetails": True,
                                 "startDate": today.isoformat(), "vehicleIds": [CFG["VEHICLE_ID"]]})
    if res["status"] in (401, 403):
        return None, f"Turo is signed out on the Pi (HTTP {res['status']})"
    if res["status"] != 200 or not res.get("body"):
        return None, f"calendar HTTP {res['status']}"
    fc = (res["body"].get("fleetCalendar") or [None])[0]
    if not fc:
        return None, "calendar returned no fleetCalendar entry"
    if (fc.get("vehicleDetails") or {}).get("id") != CFG["VEHICLE_ID"]:
        return None, "calendar returned the wrong vehicle"
    days = {}
    for d in fc.get("dailyData") or []:
        date = d.get("date")
        if not date:
            continue
        cur = ((d.get("price") or {}).get("price") or {}).get("amount")
        dflt = ((d.get("defaultPrice") or {}).get("price") or {}).get("amount")
        floor = dflt if dflt else cur
        days[date] = {"floor": int(floor) if floor else None, "cur": int(cur) if cur else None,
                      "booked": bool(d.get("unavailabilities"))}
    return days, None


def scrape_comps(page, start, end):
    url = ("https://turo.com/us/en/search?country=US"
           f"&startDate={fmt_d(start)}&startTime=10%3A00&endDate={fmt_d(end)}&endTime=10%3A00"
           "&location=Los%20Angeles%2C%20CA&locationType=CITY&makes=Tesla&models=Model%203")
    page.goto(url, timeout=60000)
    time.sleep(CFG["SETTLE_S"])
    if blocked_page(page):
        return None, "search page blocked"
    comps = []
    for c in read_cards(page):
        if str(c["id"]) == str(CFG["VEHICLE_ID"]) or c["dist"] is None or c["dist"] > CFG["COMP_RADIUS_MI"] or not c["dollars"]:
            continue
        total = c["dollars"][-1]
        comps.append({"listing_id": str(c["id"]), "distance_mi": c["dist"], "trip_total": total,
                      "daily_renter": round(total / 7.0, 2)})
    return comps, None


def check_competitors(page, start, end):
    """Runbook 7b: discounted trip total per car on each target page for the window. Missing = booked."""
    rows = []
    nights = (end - start).days
    q = f"startDate={fmt_d(start)}&startTime=10%3A00&endDate={fmt_d(end)}&endTime=10%3A00"
    for t in sb("GET", "turo_watch_targets?select=id,page_url,vehicle&active=is.true") or []:
        page.goto(t["page_url"] + ("&" if "?" in t["page_url"] else "?") + q, timeout=60000)
        time.sleep(CFG["SETTLE_S"])
        if blocked_page(page):
            log(f"competitor {t['id']}: blocked, skipped")
            continue
        if "/car-rental/" in t["page_url"]:
            m = None
            for _ in range(6):            # the booking panel can render a few seconds after the page
                txt = page.evaluate("document.body.innerText")
                m = re.search(r"((?:\$[\d,]+(?:\.\d+)?)+)\s*total", txt)
                if m:
                    break
                time.sleep(3)
            if m:
                total = [float(x.replace(",", "")) for x in re.findall(r"\$([\d,]+(?:\.\d+)?)", m.group(1))][-1]
                rows.append({"target_id": t["id"], "car": t["vehicle"], "total": total})
        else:
            for c in read_cards(page, rounds=4):
                if c["dollars"]:
                    rows.append({"target_id": t["id"], "car": c["name"] or f"listing {c['id']}", "total": c["dollars"][-1]})
    return [{"target_id": r["target_id"], "car": r["car"], "window_start": start.isoformat(), "window_end": end.isoformat(),
             "nights": nights, "trip_total": r["total"], "renter_daily": round(r["total"] / nights, 2),
             "host_equiv": round(r["total"] / nights * CFG["HOST_FACTOR"]), "src": "bestly-pi"} for r in rows]


DEMAND_URL = ("https://turo.com/us/en/search?country=US&isMapSearch=false&itemsPerPage=200&latitude=34.0907087"
              "&longitude=-118.3703284&location=West%20Hollywood%2C%20CA&locationType=CITY&placeId=ChIJ4zPwIdm-woARpyaKDi1M5FA"
              "&region=CA&pickupType=ALL&searchDurationType=DAILY&sortType=RELEVANCE"
              "&startDate={s}&startTime=10%3A00&endDate={e}&endTime=10%3A00")


def demand_load(page, s, e, model3):
    page.goto(DEMAND_URL.format(s=fmt_d(s), e=fmt_d(e)) + ("&makes=Tesla&models=Model%203" if model3 else ""), timeout=60000)
    time.sleep(CFG["SETTLE_S"])
    if blocked_page(page):
        return None
    for _ in range(12):                    # results load ~20 at a time as the list scrolls; load them all (max 200)
        page.evaluate(SCROLL_JS)
        time.sleep(1.5)
    txt = page.evaluate("document.body.innerText")
    m = re.search(r"([\d,]+)(\+?)\s+cars?\s+available", txt)
    # The search page sends its results in pages of ~20 to window.dataLayer (search_results_page events).
    ev = page.evaluate("(() => (window.dataLayer||[]).filter(x => x && x.event === 'search_results_page')"
                       ".map(x => ({ids: x.vehicle_ids || [], amts: x.total_price_amounts || []})))()") or []
    ids, amts = set(), []
    for x in ev:
        for i, a in zip(x["ids"], x["amts"]):
            if i not in ids:
                ids.add(i)
                amts.append(a)
    count = int(m.group(1).replace(",", "")) if m else (len(ids) or None)
    capped = bool(m and m.group(2)) or (count is not None and count >= 200)
    med = round(statistics.median(amts) / 7.0) if amts else None
    return {"count": min(count, 200) if count is not None else None, "capped": capped, "med": med}


def check_demand(page, cal, today):
    """Runbook 7c: near = tomorrow..+7 nights, far = same weekday 35 days out; four loads + the car's own score."""
    ns, ne = today + datetime.timedelta(days=1), today + datetime.timedelta(days=8)
    fs, fe = ns + datetime.timedelta(days=35), ne + datetime.timedelta(days=35)
    rows = []
    if cal:
        nxt = [(today + datetime.timedelta(days=i)).isoformat() for i in range(1, 15)]
        booked = sum(1 for d in nxt if (cal.get(d) or {}).get("booked"))
        rows.append({"scope": "car", "score": round(100 * booked / 14), "booked_share": round(booked / 14, 3)})
    for scope, m3 in (("model3", True), ("all", False)):
        near, far = demand_load(page, ns, ne, m3), demand_load(page, fs, fe, m3)
        if not near or not far or not near["med"] or not far["med"]:
            log(f"demand {scope}: could not read (blocked or empty)")
            continue
        ratio = max(0.0, min(1.0, 0.35 + near["med"] / far["med"] - 1))
        if scope == "model3" and near["count"] is not None and far["count"]:
            score = round(60 * (1 - near["count"] / far["count"]) + 40 * ratio)
        else:
            score = round(100 * ratio)
        rows.append({"scope": scope, "score": max(0, min(100, score)), "near_count": near["count"], "far_count": far["count"],
                     "far_capped": far["capped"], "near_median_daily": near["med"], "far_median_daily": far["med"]})
    keys = ("scope", "score", "booked_share", "near_count", "far_count", "far_capped", "near_median_daily", "far_median_daily")
    # PostgREST bulk inserts need every row to carry the same keys.
    return [{**{k: r.get(k) for k in keys}, "window_start": ns.isoformat(), "window_end": ne.isoformat(), "src": "bestly-pi"} for r in rows]


def band(score):
    return "Slow" if score < 30 else "Normal" if score < 55 else "Busy" if score < 75 else "Hot"


# ------------------------------------------------------------------ compute

def lead_mult(lead):
    return 1.20 if lead >= 8 else 1.12 if lead >= 4 else 1.06 if lead >= 2 else 1.00


def plan_day(lead, floor, cur, mkt, boost=0.0):
    """mkt = nearby Model 3 median in LISTING dollars. Moves up when the market allows, holds when competitive."""
    mult = lead_mult(lead)
    base = round(floor * mult)                                    # Turo's price + the lead premium
    pull = round(mkt * (1 + boost))                               # the market median (plus demand)
    cap = round(mkt * CFG["CEILING_MULT"] * (1 + boost))          # still competitive up to 10% over market
    target = max(base, pull)
    why = f"lead {lead} x{mult:g} = ${base}, market ${round(mkt)}" + (f" +{round(boost * 100)}% demand" if boost else "")
    if cur > target:
        if cur <= max(base, cap):
            target, why = cur, why + f" - hold ${cur} (within 10% of market)"
        else:
            target, why = max(base, cap), why + f" - over market, back to ${max(base, cap)}"
    elif pull > base:
        why += " - up to market"
    final = max(round(cur * (1 - CFG["MAX_MOVE"])), min(target, round(cur * (1 + CFG["MAX_MOVE"]))))
    if final != target:
        why += f" - 25% move cap ${final}"
    final = max(final, floor)                                     # floor beats the move cap
    return int(final), ("no-op" if final == cur else "planned"), why + (" - floor wins" if final == floor else "")


def build_plan(cal, today, mkt, boost=0.0):
    rows = []
    for i in range(1, CFG["WINDOW_DAYS"] + 1):
        ds = (today + datetime.timedelta(days=i)).isoformat()
        info = cal.get(ds)
        base = {"date": ds, "lead": i, "src": "fleet calendar"}
        if not info:
            rows.append({**base, "floor": None, "cur": None, "proposed": None, "status": "no-data", "reason": "day absent from fleet calendar"})
        elif info["booked"]:
            rows.append({**base, "floor": info["floor"], "cur": info["cur"], "proposed": None, "status": "booked", "reason": "booked - never touched"})
        elif not info["floor"] or not info["cur"]:
            rows.append({**base, "floor": info["floor"], "cur": info["cur"], "proposed": None, "status": "no-data", "reason": "null/zero floor or price"})
        else:
            p, st, why = plan_day(i, info["floor"], info["cur"], mkt, boost)
            rows.append({**base, "floor": info["floor"], "cur": info["cur"], "proposed": p, "status": st, "reason": why})
    return rows


def run_gates(comps, cal, cal_err, plan, market_base, prev_mb, today, bridge_err):
    g = []
    n = len(comps or [])
    g.append({"gate": "thin sample", "result": "tripped" if n < CFG["MIN_N"] else "pass", "detail": f"n={n} rendered cards within 25mi"})
    if prev_mb and market_base:
        mv = (market_base - prev_mb) / prev_mb
        g.append({"gate": "market whiplash", "result": "tripped" if abs(mv) > CFG["WHIPLASH"] else "pass",
                  "detail": f"market_base {market_base} vs {prev_mb} prev = {mv*100:+.1f}%"})
    else:
        g.append({"gate": "market whiplash", "result": "n/a", "detail": "no previous market_base"})
    if cal_err or not cal:
        g.append({"gate": "bad calendar", "result": "tripped", "detail": cal_err or "no calendar"})
    elif len(cal) < CFG["MIN_CAL_DAYS"]:
        g.append({"gate": "bad calendar", "result": "tripped", "detail": f"only {len(cal)} days returned"})
    elif any(r["floor"] in (None, 0) for r in plan if r["status"] != "no-data"):
        g.append({"gate": "bad calendar", "result": "tripped", "detail": "a floor came back null or zero"})
    else:
        g.append({"gate": "bad calendar", "result": "pass", "detail": f"{len(cal)} days returned, no null/zero floors"})
    g.append({"gate": "bridge down", "result": "tripped" if (cal_err or bridge_err) else "pass",
              "detail": cal_err or bridge_err or "Pi Turo browser signed in, no block page"})
    below = [r["date"] for r in plan if r.get("proposed") and r.get("floor") and r["proposed"] < r["floor"]]
    g.append({"gate": "never below floor", "result": "tripped" if below else "pass", "detail": f"below floor on {below}" if below else "all finals at or above floor"})
    first = min(cal) if cal else None
    g.append({"gate": "pt-date check", "result": "pass" if (not cal or first == today.isoformat()) else "tripped",
              "detail": f"PT today {today}, calendar starts {first}"})
    return g, any(x["result"] == "tripped" for x in g)


# ------------------------------------------------------------- write + verify

def apply_writes(page, plan):
    groups = {}
    for r in plan:
        if r["status"] == "planned":
            groups.setdefault(r["proposed"], []).append(r["date"])
    intended = []
    for amount, dates in sorted(groups.items()):
        res = page.evaluate(PRICE_JS, {"updateAmount": int(amount), "updateType": "FIXED_AMOUNT",
                                       "vehicleDates": [{"dates": sorted(dates), "vehicleId": CFG["VEHICLE_ID"]}]})
        log(f"PUT ${amount} x{len(dates)} days -> HTTP {res['status']}")
        intended += [{"date": d, "amount": int(amount), "http_ok": res["status"] == 200} for d in dates]
        if res["status"] != 200:
            log("stopping writes: a PUT failed")
            break
        time.sleep(1.2)
    return intended


def verify_writes(page, intended, today):
    if not intended:
        return {}, None
    time.sleep(CFG["VERIFY_WAIT_S"])
    cal2, err = fetch_calendar(page, today)
    if err or not cal2:
        return {}, err or "verification re-pull failed"
    return {w["date"]: {"intended": w["amount"], "actual": (cal2.get(w["date"]) or {}).get("cur"),
                        "verified": (cal2.get(w["date"]) or {}).get("cur") == w["amount"]} for w in intended}, None


# ------------------------------------------------------------------ persist

def record(mode, start, end, market_base, host_net, comps, ceiling, gates, plan, vmap, notes):
    run = sb("POST", "turo_runs", headers={**SB_HEAD, "Prefer": "return=representation"}, json={
        "runner": "bestly-pi", "mode": mode, "vehicle_id": CFG["VEHICLE_ID"], "window_start": start.isoformat(),
        "window_end": end.isoformat(), "market_base": market_base, "host_net": host_net, "comp_n": len(comps or []),
        "ceiling": ceiling, "gates": gates, "days_written": sum(1 for r in plan if r.get("applied")),
        "days_verified": sum(1 for v in vmap.values() if v["verified"]),
        "days_blocked": sum(1 for r in plan if r["status"] in ("blocked", "no-data")), "ok": True, "notes": notes})[0]
    rid = run["id"]
    rows = [{"run_id": rid, "date": r["date"], "lead": r["lead"], "floor": r["floor"], "cur": r["cur"], "proposed": r["proposed"],
             "applied": r.get("applied"), "actual": (vmap.get(r["date"]) or {}).get("actual"),
             "verified": bool((vmap.get(r["date"]) or {}).get("verified")), "status": r["status"], "gate": r.get("gate"),
             "reason": r["reason"], "src": r["src"]} for r in plan]
    if rows:
        sb("POST", "turo_day_prices", json=rows)
    if comps:
        sb("POST", "turo_comps", json=[{**c, "run_id": rid} for c in comps])
    return rid


def main():
    now = datetime.datetime.now(TZ)
    today = now.date()
    start, end = today + datetime.timedelta(days=1), today + datetime.timedelta(days=CFG["WINDOW_DAYS"])
    log(f"Turo Watch {VERSION}{' (dry)' if DRY else ''} - today {today}, window {start}..{end}")

    settings = (sb("GET", "turo_settings?select=paused,pause_reason,note_for_claude") or [{}])[0]
    paused = bool(settings.get("paused"))
    if not DRY and "--force" not in sys.argv:
        recent = sb("GET", "turo_runs?select=ran_at,runner&ran_at=gte." + (datetime.datetime.utcnow() - datetime.timedelta(minutes=20)).strftime("%Y-%m-%dT%H:%M:%SZ")) or []
        if recent:
            log(f"another run landed {recent[0]['ran_at']} ({recent[0]['runner']}); this one stops (run lock)")
            return

    comps, cal, cal_err, plan, competitors, demand = [], None, None, [], [], []
    market_base = host_net = ceiling = None
    vmap, notes, bridge_err = {}, "", None

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].new_page()
        try:
            page.goto("https://turo.com/us/en/trips/calendar", timeout=60000)
            time.sleep(CFG["SETTLE_S"])
            if blocked_page(page):
                bridge_err = "Turo showed a block page"
            else:
                cal, cal_err = fetch_calendar(page, today)
            log(f"calendar: {cal_err or bridge_err or f'{len(cal)} days'}")

            if not bridge_err:
                comps, cerr = scrape_comps(page, start, end)
                if cerr:
                    bridge_err, comps = cerr, []
            if comps:
                market_base = round(statistics.median(c["daily_renter"] for c in comps), 2)
                host_net = round(market_base * CFG["HOST_FACTOR"])       # market median in listing dollars
                ceiling = round(market_base * CFG["HOST_FACTOR"] * CFG["CEILING_MULT"])  # listing dollars too
            log(f"comps n={len(comps)} market ${market_base} renter = ${host_net} listing, cap ${ceiling}")

            # Demand first, so a Busy/Hot week can push prices up this run.
            if not bridge_err:
                try:
                    demand = check_demand(page, cal, today)
                except Exception as e:
                    log(f"demand failed: {e}")
            dm = {d["scope"]: d for d in demand}
            dscore = (dm.get("model3") or dm.get("all") or {}).get("score")
            boost = CFG["DEMAND_BOOST"].get(band(dscore), 0.0) if dscore is not None else 0.0
            if cal and market_base:
                plan = build_plan(cal, today, market_base * CFG["HOST_FACTOR"], boost)

            prev = sb("GET", "turo_runs?select=market_base&market_base=not.is.null&order=ran_at.desc&limit=1") or []
            gates, tripped = run_gates(comps, cal, cal_err, plan, market_base, float(prev[0]["market_base"]) if prev else None, today, bridge_err)
            for g in gates:
                log(f"gate {g['gate']}: {g['result']} ({g['detail']})")
            for r in plan:
                log(f"  {r['date']} lead {r['lead']} floor {r['floor']} cur {r['cur']} -> {r['proposed']} [{r['status']}]")

            if not bridge_err:
                try:
                    competitors = check_competitors(page, start, end)
                except Exception as e:
                    log(f"competitors failed: {e}")
            for c in competitors:
                log(f"competitor {c['target_id']}: {c['car']} ${c['trip_total']} = ${c['renter_daily']}/day")
            for d in demand:
                log(f"demand {d['scope']}: {d['score']} ({band(d['score'])})")

            if DRY:
                log("DRY RUN: nothing written to Turo, nothing recorded")
                return

            if tripped or paused:
                why = "paused by Jared" if paused and not tripped else ", ".join(g["gate"] for g in gates if g["result"] == "tripped")
                mode = "propose-only" if (cal_err or bridge_err or paused) else "blocked"
                for r in plan:
                    if r["status"] in ("planned", "no-op"):
                        r["status"], r["gate"] = "blocked", why
                if not plan:
                    plan = [{"date": (start + datetime.timedelta(days=i)).isoformat(), "lead": i + 1, "floor": None, "cur": None,
                             "proposed": None, "status": "no-data", "gate": why, "reason": "no calendar this run", "src": "none"}
                            for i in range(CFG["WINDOW_DAYS"])]
                notes = f"{mode.upper()}: {why}. Nothing written."
            else:
                intended = apply_writes(page, plan)
                for r in plan:
                    if r["status"] == "planned" and any(w["date"] == r["date"] for w in intended):
                        r["applied"] = r["proposed"]
                vmap, verr = verify_writes(page, intended, today)
                if verr:
                    notes = f"Writes sent but the verification re-pull failed: {verr}"
                else:
                    for r in plan:
                        v = vmap.get(r["date"])
                        if v:
                            r["status"] = "applied" if v["verified"] else "not-verified"
                            if not v["verified"]:
                                r["reason"] += f" | NOT VERIFIED intended {v['intended']} actual {v['actual']}"
                    notes = f"{sum(1 for v in vmap.values() if v['verified'])}/{len(vmap)} written days verified." if vmap else "Nothing needed writing."
                mode = "applied"
            notes += f" Runner {VERSION} on bestly-pi (Pi Turo reader browser). " + " | ".join(LOG[-25:])[:3500]
            rid = record(mode, start, end, market_base, host_net, comps, ceiling, gates, plan, vmap, notes)
            for table, data in (("turo_competitor_prices", competitors), ("turo_demand", demand)):
                if data:
                    try:
                        sb("POST", table, json=data)
                    except Exception as e:
                        log(f"saving {table} failed: {e}")
            log(f"recorded run {rid} ({mode})")

            # Relay: 3 short lines to Scout.
            ed = next((c for c in competitors if c["target_id"] == "edgar-model3"), None)
            open_days = [r for r in plan if r.get("cur") and r["status"] not in ("booked", "no-data")]
            ours = round(sum(r["cur"] for r in open_days) / len(open_days), 2) if open_days else None
            wrote = sum(1 for r in plan if r.get("applied"))
            ver = sum(1 for v in vmap.values() if v["verified"])
            line1 = f"Market ${market_base}/day (n={len(comps)})" + (f", demand {band(dm['model3']['score'])} {dm['model3']['score']}" if "model3" in dm else "")
            line2 = (f"Edgar ${ed['renter_daily']}/day vs ours ${ours}" if ed else "Edgar booked or unreadable for the window")
            line3 = (f"Wrote {wrote}, verified {ver}" if mode == "applied" and wrote else
                     "Nothing needed writing" if mode == "applied" else notes.split(" Runner")[0])
            bad = mode != "applied" or wrote != ver
            rpc("scout_notify", {"p_title": "Turo: " + ("prices updated" if wrote else "no change" if mode == "applied" else "nothing written"),
                                 "p_body": f"{line1}\n{line2}\n{line3}", "p_severity": "warning" if bad else "info", "p_push": bool(bad and (cal_err or bridge_err)),
                                 "p_url": "/admin/turo", "p_dedupe": "turo.run." + now.strftime("%Y%m%d%H")})
        finally:
            page.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        tb = traceback.format_exc()
        print(tb, file=sys.stderr)
        if not DRY:
            try:
                sb("POST", "turo_runs", json={"runner": "bestly-pi", "mode": "blocked", "ok": True, "vehicle_id": CFG["VEHICLE_ID"],
                                              "gates": [{"gate": "bridge down", "result": "tripped", "detail": "runner crashed"}],
                                              "notes": f"CRASH ({VERSION}): {tb[-800:]}"})
                rpc("scout_notify", {"p_title": "Turo Watch crashed on the Pi", "p_body": tb[-300:], "p_severity": "warning", "p_push": True,
                                     "p_url": "/admin/turo", "p_dedupe": "turo.crash." + datetime.datetime.now(TZ).strftime("%Y%m%d%H")})
            except Exception:
                pass
        sys.exit(1)
