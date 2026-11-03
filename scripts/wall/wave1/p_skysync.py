#!/usr/bin/env python3
import ast, shutil, sys, time
p = '/Users/jaredbest/Bestly/skysync/skysync.py'
s = open(p).read()
assert 'WAVE1_20261102' not in s
shutil.copy(p, p + '.bak_wave1_' + time.strftime('%Y%m%d-%H%M'))


def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)


# 1. event(): who signs (default Sky Sync; bus events are signed Mae)
rep('def event(st, key, kind, severity, title, body, push=False):',
    'def event(st, key, kind, severity, title, body, push=False, who="Sky Sync", role="wall sky keeper"):')
rep('"title": "Sky Sync: " + title,\n               "body": body + "\\n\\n- Sky Sync, wall sky keeper", "push": push},',
    '"title": who + ": " + title,\n               "body": body + "\\n\\n- " + who + ", " + role, "push": push},')
# 2. bus_check -> Mae, with self-heal
a = s.index('BUS_HEALTH = ')
b = s.index('def main():')
new = '''BUS_HEALTH = "http://192.168.1.182:8097/health"      # bus collector on Clio (bestly-bus.service)
CLIO = "pi@192.168.1.182"


def bus_event(st, key, kind, title, body):
    """WAVE1_20261102: bus alerts belong to Mae (notification_owners wall.skysync.bus -> mae). Digest only, never a push."""
    event(st, key, kind, "warning" if kind == "problem" else "info", title, body, push=False, who="Mae", role="bus keeper")


def bus_restart(st, why):
    """Self-heal: restart bestly-bus on Clio, at most 3 times an hour and not twice within 20 minutes."""
    bs = st.setdefault("bus", {})
    now = time.time()
    bs["restarts"] = [t for t in bs.get("restarts", []) if now - t < 3600]
    if bs["restarts"] and now - max(bs["restarts"]) < 1200:
        return "restart held (one just ran)"
    if len(bs["restarts"]) >= 3:
        return "restart skipped (3 in the last hour)"
    bs["restarts"].append(now)
    rc, out = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", CLIO, "sudo systemctl restart bestly-bus"], 40)
    log("bus self-heal (%s): restart rc=%s %s" % (why, rc, out[:100]))
    return "restarted bestly-bus on Clio (rc %s)" % rc


def bus_check(st):
    """Bus feed (Metro 4/10/105 live, CityLine live, DASH schedule). Mae's watchdog: if /health stalls for 2 checks or Metro data is older
    than 5 min, restart bestly-bus on Clio (the wall already falls back to the labeled printed schedule); a stops/routes/walk refresh older
    than 8 days is run here too. Reports to Scout as Mae (wall.skysync.bus), digest only, resolves itself."""
    bs = st.setdefault("bus", {"down": 0, "none": 0})
    try:
        rc, out = run(['curl', '-sS', '-m', '8', BUS_HEALTH], 15)
        if rc != 0:
            raise RuntimeError('curl rc %s' % rc)
        h = json.loads(out)
    except Exception as e:
        bs["down"] = bs.get("down", 0) + 1
        if bs["down"] >= 2:
            act = bus_restart(st, "health stalled")
            bus_event(st, "wall.skysync.bus", "problem", "bus feed stopped",
                      "The bus collector on Clio is not answering (%s). I %s. The wall bus card falls back to the printed schedule, labeled Scheduled, until it answers again; this clears on its own." % (str(e)[:80], act))
        return "bus: collector not answering"
    bs["down"] = 0
    problems, acts = [], []
    ta, va = h.get("metro_trips_age_s"), h.get("metro_veh_age_s")
    if ta is None or va is None:
        bs["none"] = bs.get("none", 0) + 1
        if bs["none"] >= 2 and h.get("static_ready"):
            problems.append("Metro live data has not arrived since the collector started (%s)" % (h.get("metro_trips_err") or "no error recorded"))
            acts.append(bus_restart(st, "no Metro data"))
    else:
        bs["none"] = 0
        if ta > 300 or va > 300:
            problems.append("Metro 4, 10 and 105 live data is %d min old (%s)" % (max(ta, va) // 60, h.get("metro_trips_err") or h.get("metro_veh_err") or "no error recorded"))
            acts.append(bus_restart(st, "Metro data stale"))
    if h.get("cycle_age_s", 0) > 120:
        problems.append("the collector's main loop stalled for %d s" % h["cycle_age_s"])
        acts.append(bus_restart(st, "cycle stalled"))
    if h.get("cityline_age_s") is not None and h["cityline_age_s"] > 300:
        problems.append("WeHo CityLine live data is %d min old (%s); CityLine shows its printed commuter schedule meanwhile" % (h["cityline_age_s"] // 60, h.get("cityline_err") or "no error recorded"))
    if h.get("starts_1h", 0) >= 4:
        problems.append("the collector restarted %d times in the last hour" % h["starts_1h"])
    if h.get("static_age_d") is not None and h["static_age_d"] > 8:
        problems.append("the weekly stops, routes and walk-time refresh is %.0f days old" % h["static_age_d"])
        rc, out = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", CLIO,
                       "cd /opt/bestly/bus && (nohup sh -c 'python3 bus_collect.py --rebuild-static && sudo systemctl restart bestly-bus' > /tmp/bus_refresh.log 2>&1 &)"], 30)
        acts.append("started a stops/routes/walk refresh (rc %s)" % rc)
    if problems:
        bus_event(st, "wall.skysync.bus", "problem", "live Metro buses are on schedule only" if ta is None or (ta or 0) > 300 else "bus feed needs a look",
                  "; ".join(problems) + ". " + ("I " + "; ".join(a for a in acts if a) + ". " if acts else "") + "The wall bus card shows the labeled printed schedule where live data is missing. The collector retries with backoff and this clears on its own.")
        return "bus: " + "; ".join(problems)
    bus_event(st, "wall.skysync.bus", "resolved", "bus feed is back", "Live Metro and CityLine times and bus positions are updating again.")
    return "bus: ok (metro %ds, cityline %ss old, walks osm %s)" % (ta or 0, h.get("cityline_age_s"), h.get("walks_osm"))


'''
s = s[:a] + new + s[b:]
s = s.replace('def main():', '# WAVE1_20261102 (bus watchdog signed Mae)\ndef main():', 1)
ast.parse(s)
open(p, 'w').write(s)
print('ok')
