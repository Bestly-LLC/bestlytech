import shutil, time, subprocess
R = '/opt/bestly/wall/'
T = time.strftime('%Y%m%d-%H%M%S')
def patch(path, edits):
    s = open(R + path, encoding='utf-8').read()
    shutil.copy(R + path, R + path + '.bak_alerts_' + T)
    for a, b in edits:
        assert s.count(a) == 1, (path, a[:70], s.count(a))
        s = s.replace(a, b)
    open(R + path, 'w', encoding='utf-8').write(s)
    print('patched', path, 'backup .bak_alerts_' + T)

# ---- server.py: the 'over' line for helicopters, read from alerts_over.json (written by alerts_batch.py)
patch('server.py', [
('def _v2_compact(r):\n',
'''_ALOV = {"mt": 0.0, "at": 0.0, "d": {}}


def _alerts_over():
    """ALERTS_20261103: hex -> 'reported robbery \\u00b7 0.4 mi' for helicopters over a nearby incident (alerts_batch.py). Entries older than 3 min are ignored."""
    now = time.time()
    if now - _ALOV["at"] < 4:
        return _ALOV["d"]
    _ALOV["at"] = now
    try:
        d = json.load(open(os.path.join(ROOT, "alerts_over.json")))
        _ALOV["d"] = {h: v["line"] for h, v in d.items() if isinstance(v, dict) and v.get("line") and now - (v.get("at") or 0) < 180}
    except Exception:
        _ALOV["d"] = {}
    return _ALOV["d"]


def _v2_compact(r):
'''),
('''                    item["area"] = area_for(item["lat"], item["lon"])
                out.append(item)
''',
'''                    item["area"] = area_for(item["lat"], item["lon"])
                try:                                               # ALERTS_20261103: why the helicopter is there
                    _ov = _alerts_over().get(str(item.get("hex") or "").lower())
                    if _ov:
                        item["over"] = _ov
                except Exception:
                    pass
                out.append(item)
'''),
])

# ---- aircraft_enrich.py: rare aircraft -> gold NOTABLE card (existing notable style)
patch('aircraft_enrich.py', [
('    _out = {"hex": hx, "label": label, "sublabel": sub, "tier": tier,\n',
'''    try:                                                   # ALERTS_20261103: rare / special aircraft list (alerts_rare.json) -> gold notable card
        import alerts_rare as _AR
        _rr = _AR.rare_match(cs, m.get("icao") or (live or {}).get("t") or "", flags, hx)
        if _rr:
            notable.insert(0, _rr)
            if tier == "registration":
                label = _rr
    except Exception:
        pass
    _out = {"hex": hx, "label": label, "sublabel": sub, "tier": tier,
'''),
])

# ---- wall.html: tag line 2 and plane card line show the 'over' text
patch('www/wall.html', [
("  const logoOk=APX.logo[ic]==='ok', lgOn=",
 "  if(!em&&!ph&&o.a&&o.a.over) l2='Over '+o.a.over;   /* ALERTS_20261103 */\n  const logoOk=APX.logo[ic]==='ok', lgOn="),
("a.area?'Over '+a.area:''", "a.over?'Over '+a.over:(a.area?'Over '+a.area:'')"),
])

# ---- watchdog.py: keeper for the alerts daemon (self-heal notices go to the 7 AM digest only)
patch('watchdog.py', [
('def power_watch(mem, hb):\n',
'''def alerts_watch(mem, hb):
    """ALERTS_20261103 Sky Sync / Wall Watchdog: keeps alerts_batch.py alive (wall-off push, helicopter reasons, rare aircraft).
    Self-heal notices are digest-only (push False)."""
    g = load(os.path.join(ROOT, "alerts_status.json"), {})
    if not g:
        return
    now = time.time()
    age = now - (g.get("at") or 0)
    loops = g.get("loops") or {}
    why = None
    if age > 90:
        why = f"The wall alerts keeper has not checked in for {age / 60:.0f} min."
    elif any(now - (loops.get(k) or 0) > 180 for k in ("wall", "sky")):
        why = "A loop in the wall alerts keeper stalled."
    if why:
        if now - mem.get("alerts_restart_at", 0) > 300:
            mem["alerts_restart_at"] = now
            try:
                subprocess.run(["sudo", "-n", "systemctl", "restart", "bestly-wall-alerts"], capture_output=True, timeout=30)
                log("wall alerts keeper restarted by watchdog: " + why)
            except Exception as e:
                log(f"wall alerts keeper restart failed: {e}")
        report(mem, "wall.skysync.alerts", "problem", "info", "Wall alerts keeper restarted",
               why + " The watchdog restarted it. Wall-off, helicopter and rare-aircraft alerts resume on their own.\\n\\n- Sky Sync, wall sky alerts keeper")
    elif g.get("feed_fail", 0) >= 12:
        report(mem, "wall.skysync.alerts", "problem", "info", "Wall alerts cannot read the aircraft feed",
               "The wall server's aircraft feed failed for about 3 min in a row. Helicopter reasons and rare-aircraft alerts wait for it.\\n\\n- Sky Sync, wall sky alerts keeper")
    else:
        report(mem, "wall.skysync.alerts", "resolved", "info", "Wall alerts keeper is running", "Watching the wall power, helicopters and rare aircraft.")


def power_watch(mem, hb):
'''),
('        alarm_guard_watch(mem, hb)      # ALARMFIX_20261031\n',
 '        alarm_guard_watch(mem, hb)      # ALARMFIX_20261031\n        alerts_watch(mem, hb)           # ALERTS_20261103\n'),
])
