#!/usr/bin/env python3
# Patch /opt/bestly/wall/server.py: TURO RETURN LIVE ACTIVITY (native Bestly Sky app). Run with sudo on the Pi.
import re, sys
P = "/opt/bestly/wall/server.py"
s = open(P).read()
if "TURO RETURN LIVE ACTIVITY" in s:
    sys.exit("already patched")

BLOCK = r'''
# ---------- TURO RETURN LIVE ACTIVITY (2026-10-06): the return card with the ring, drawn by the native Bestly Sky app ----------
# Same path as the plane (W6): this loop decides WHAT the card says from _handoff_returns() + trip_return_phase() and asks
# the edge function wall-live-activity (attr=turo) to start / update / end it over APNs. While the native activity is healthy
# (start token registered + no push failures) sky_ret_owns() is True and the Home Assistant return card (_la_return) stays off;
# otherwise HA is the fallback, automatically. Watchdog: hb["sky_ret"] -> watchdog.py sky_ret_watch -> Scout ("Turo Reader: ...").
# Off switch: state.liveActs.turo = false (admin) ends it, or state.liveActs.turoNative = false uses HA only.
# Keys of the content state MUST match ios/BestlySky/Shared/TuroReturnAttributes.swift.
SKY_RET = {"active": False, "trip": None, "started_at": 0.0, "sent_at": 0.0, "sig": None, "gone_at": None, "last_ok": 0.0,
           "fail_since": None, "error": None, "last": None, "starts": [], "tokens": None, "health_at": 0.0, "ending": 0,
           "end_at": 0.0, "loop_at": 0.0, "target": None, "pushes_hour": [], "heading_since": {}, "back_at": {}, "st": None, "gone": False}


def _sky_ret_pick():
    """(trip, end_ts) the return card is about: the same rule _la_return uses (soonest not-closed return within 2 h)."""
    if (state.get("liveActs") or {}).get("turo") is False:
        return None
    now, pick = time.time(), None
    for t in _handoff_returns():
        if t.get("host_completed"):
            continue
        if ((t.get("phase") or {}).get("phase") or "away") == "closed":
            continue
        end = _iso(t.get("end"))
        if not end or end - now > 2 * 3600:
            continue
        if pick is None or end < pick[1]:
            pick = (t, end)
    return pick


def _ret_split(ts):
    """(8:42, PM) for the Dynamic Island compact trailing."""
    d = datetime.fromtimestamp(ts)
    return d.strftime("%-I:%M"), d.strftime("%p")


def _sky_ret_state(t, end):
    now = time.time()
    ph = t.get("phase") or {}
    phase = ph.get("phase") or "away"
    tid = str(t["id"])
    guest, car = (t.get("guest") or "Guest"), (t.get("car") or "")
    first = guest.split()[0]
    who = f"{first} · {car}" if car and len(first) + 3 + len(car) <= 24 else first
    low = phase in ("home_low", "wrapping_low")
    back = phase in ("home", "home_low", "wrapping", "wrapping_low")
    done = phase in ("wrapping", "wrapping_low")
    heading = phase == "heading_home"
    stage = 3 if done else 2 if back else 1 if heading else 0
    batt, pickb = ph.get("battery"), ph.get("pickup")
    eta_min, eta_at = ph.get("eta_min"), _iso(ph.get("eta_at"))
    dist = ph.get("dist_mi")
    late_min = ph.get("late_min")
    issue = bool(ph.get("issue") or ph.get("crash"))        # hook: no data source for a crash / new damage yet
    dest = "LAX" if ph.get("airport") else "Home"
    S = SKY_RET
    if heading:
        S["heading_since"].setdefault(tid, now)
    if back:
        S["back_at"].setdefault(tid, now)
    over = (not back) and now - end > 10 * 60

    # tint + icon (colored glyph only; the ring wears the tint)
    if done and issue:
        tint, icon = ORANGE, "alert"
    elif low and stage >= 2:
        tint, icon = ORANGE, "low"
    elif done:
        tint, icon = "#30D158", "check"
    elif over and (now - end) >= 3600:
        tint, icon = ORANGE, "alert"
    else:
        tint, icon = "#0A84FF", "ret"

    # main lines
    trail, trail_small = "", None
    if stage == 0:
        status, big = f"Due {_t12(end)}", "Out on the trip"
        if over:
            status, big = f"{_span((now - end) / 60)} over", f"Due {_t12(end)}"
        place = f"{round(dist)}{NB}mi from home" if isinstance(dist, (int, float)) and dist >= 1 else None
        trail, trail_small = _ret_split(end)
        if over:
            trail, trail_small = _ret_split(end)
    elif stage == 1:
        status = "Heading home"
        if eta_at:
            big = f"{dest} ~{_t12(eta_at)}"
            trail, trail_small = _ret_split(eta_at)
        else:
            big, trail = "Heading home", "Home"
        bits = []
        if isinstance(eta_min, (int, float)):
            bits.append(f"{int(eta_min)}{NB}min")
        if isinstance(dist, (int, float)):
            bits.append(f"{round(dist)}{NB}mi away")
        place = " · ".join(bits) or None
    elif stage == 2:
        status, big = "Back home", f"Back {_t12(S['back_at'][tid])}"
        place = ph.get("spot_label")
        trail = f"{int(batt)}%" if low and isinstance(batt, (int, float)) else "Back"
    else:
        status, big = ("Check the car", "Crash alert") if issue else ("Done", "All good")
        place = ph.get("spot_label")
        trail = "Check" if issue else "Done"

    # charge line
    if low and isinstance(batt, (int, float)) and isinstance(pickb, (int, float)):
        charge = f"Low {int(batt)}%{NB}· was {int(pickb)}%".replace(f"%{NB}·", "% ·")
    elif isinstance(batt, (int, float)):
        tail = ""
        if back:
            tail = f" · {late_min}{NB}min late" if isinstance(late_min, int) and late_min >= 5 else " · on time"
        charge = f"{int(batt)}% charge{tail}"
    else:
        charge = "Charge not reported"
    n, cost = int(ph.get("sc_stops") or 0), float(ph.get("sc_cost") or 0)
    sc = (f"{n}{NB}Supercharger{NB}stop{'s' if n != 1 else ''} · ${cost:.0f}{NB}to{NB}bill{NB}back") if n else None

    eta_start = None
    if heading and eta_at:
        eta_start = min(S["heading_since"][tid], eta_at - 120)
    st = {"tripId": tid[:24], "who": who, "status": status, "big": big, "place": place, "pin": bool(stage >= 2 and place),
          "charge": charge, "sc": sc, "stage": stage, "low": bool(low and stage >= 2), "issue": issue and done, "icon": icon,
          "tint": tint, "trail": trail, "trailSmall": trail_small, "etaAt": round(eta_at, 1) if (heading and eta_at) else None,
          "etaStart": round(eta_start, 1) if eta_start else None, "url": _trip_url(t), "at": round(now, 1)}
    # low-battery heads-up (what the HA path sends when the card turns orange): keep it while the native card owns the slot
    if done and low and isinstance(batt, (int, float)) and isinstance(pickb, (int, float)) and not HANDOFF["rpushed"].get(("low", t["id"])):
        HANDOFF["rpushed"][("low", t["id"])] = now
        try:
            la_send({"title": "Turo Reader: car back low",
                     "message": f"{guest} finished with {car or 'the Tesla'} and left it at {int(batt)}%. It was {int(pickb)}% at pickup.",
                     "data": {"push": {"interruption-level": "time-sensitive"}, "url": _trip_url(t), "tag": "bestly_turo_return_low", "group": "turo"}})
        except Exception as e:
            print(f"turo return activity: low-battery push failed: {e}", flush=True)
    return st


def _sky_ret_push(event, st, priority=5, alert=None, dismiss_s=0):
    now = time.time()
    SKY_RET["pushes_hour"] = [x for x in SKY_RET["pushes_hour"] if now - x < 3600] + [now]
    body = {"op": "push", "attr": "turo", "event": event, "state": st, "priority": priority, "stale_s": 600, "dismiss_s": dismiss_s}
    if alert:
        body["alert"] = alert
    r = _sky_call(body)
    codes = sorted({f"{x.get('status')}{(' ' + x['reason']) if x.get('reason') else ''}" for x in (r.get("results") or [])})
    SKY_RET["last"] = {"at": now, "event": event, "trip": (st or {}).get("tripId"), "sent": r.get("sent"), "ok": r.get("delivered"), "codes": codes}
    good = bool(r.get("ok"))
    if good:
        SKY_RET["last_ok"], SKY_RET["fail_since"], SKY_RET["error"] = now, None, None
    elif r.get("sent") == 0 and event != "start" and r.get("http") is None:
        good = True          # no update token (the card was swiped away on the phone): not a failure, the loop will start a new one
        SKY_RET["error"] = "no live activity token"
        SKY_RET["gone"] = True
    else:
        SKY_RET["fail_since"] = SKY_RET["fail_since"] or now
        SKY_RET["error"] = (r.get("error") or ", ".join(codes) or "no tokens")[:160]
    print(f"turo return activity: {event} {(st or {}).get('big', '')} -> {r.get('delivered')}/{r.get('sent')} {codes or r.get('error')}", flush=True)
    return good, r


def sky_ret_owns():
    """True when the native app path is set up and working -> the HA return card stays off (no duplicates)."""
    if (state.get("liveActs") or {}).get("turoNative") is False:
        return False
    t = SKY_RET.get("tokens") or {}
    return bool(t.get("start")) and SKY_RET.get("fail_since") is None


def sky_ret_health():
    now = time.time()
    return {"active": SKY_RET["active"], "trip": SKY_RET["trip"], "target": SKY_RET["target"], "error": SKY_RET["error"],
            "fail_min": round((now - SKY_RET["fail_since"]) / 60) if SKY_RET["fail_since"] else None,
            "last": SKY_RET["last"], "tokens": SKY_RET["tokens"], "owns": sky_ret_owns(),
            "active_min": round((now - SKY_RET["started_at"]) / 60) if SKY_RET["active"] else None,
            "ending": SKY_RET["ending"], "loop_age_s": round(now - SKY_RET["loop_at"], 1) if SKY_RET["loop_at"] else None,
            "pushes_hour": len([x for x in SKY_RET["pushes_hour"] if now - x < 3600])}


def sky_ret_loop():
    time.sleep(25)
    while True:
        now = time.time()
        SKY_RET["loop_at"] = now
        try:
            if now - SKY_RET["health_at"] > 300:
                SKY_RET["health_at"] = now
                h = _sky_call({"op": "health", "attr": "turo"})
                if h.get("ok"):
                    SKY_RET["tokens"] = h.get("tokens")
                    if not SKY_RET["active"] and not SKY_RET["ending"] and SKY_RET["fail_since"]:
                        SKY_RET["fail_since"], SKY_RET["error"] = None, None     # a network blip must not stick forever
            pick = _sky_ret_pick()
            st = _sky_ret_state(*pick) if pick else None
            SKY_RET["target"] = {"trip": st["tripId"] if st else None, "stage": st["stage"] if st else None}
            old = SKY_RET["active"] and now - SKY_RET["started_at"] > 7.5 * 3600
            if SKY_RET.get("gone"):
                SKY_RET.update({"active": False, "gone": False})                 # swiped away on the phone: start a fresh one
            if st is None or old or (SKY_RET["active"] and st["tripId"] != SKY_RET["trip"]):
                if SKY_RET["active"]:
                    ok, _ = _sky_ret_push("end", SKY_RET.get("st") or {}, 10)
                    SKY_RET.update({"active": False, "trip": None, "sig": None, "ending": 0 if ok else 1, "end_at": now})
                elif SKY_RET["ending"] and 0 < SKY_RET["ending"] <= 5 and now - SKY_RET["end_at"] > 60:
                    ok, _ = _sky_ret_push("end", SKY_RET.get("st") or {}, 10)
                    SKY_RET["ending"], SKY_RET["end_at"] = (0 if ok else SKY_RET["ending"] + 1), now
            if st is not None and not old:
                ring_step = int(max(0, min(1, ((now - st["etaStart"]) / max(1, st["etaAt"] - st["etaStart"])))) * 12) if st.get("etaAt") and st.get("etaStart") else 0
                sig = (st["tripId"], st["stage"], st["big"], st["place"], st["trail"], st["charge"], st["sc"], st["status"], st["icon"], ring_step)
                if not SKY_RET["active"]:
                    SKY_RET["starts"] = [x for x in SKY_RET["starts"] if now - x < 3600]
                    if len(SKY_RET["starts"]) < 6 and (SKY_RET["tokens"] or {}).get("start") and now - SKY_RET["end_at"] > 20 \
                            and (state.get("liveActs") or {}).get("turoNative") is not False:
                        SKY_RET["starts"].append(now)
                        ok, _ = _sky_ret_push("start", st, 10, {"title": "Turo return", "body": f"{st['who']} · {st['big']}".replace(" ", " ")})
                        if ok:
                            SKY_RET.update({"active": True, "trip": st["tripId"], "started_at": now, "sent_at": now, "sig": sig, "st": st, "ending": 0})
                            SKY_RET["health_at"] = now - 240            # re-check tokens in ~1 min (the activity's update token)
                elif (sig != SKY_RET["sig"] and now - SKY_RET["sent_at"] >= 40) or now - SKY_RET["sent_at"] >= 240:
                    _sky_ret_push("update", st, 5)
                    SKY_RET.update({"sent_at": now, "sig": sig, "st": st})
        except Exception as e:
            SKY_RET["error"] = str(e)[:160]
            SKY_RET["fail_since"] = SKY_RET["fail_since"] or time.time()
            print(f"turo return activity error: {e}", flush=True)
        time.sleep(10)

'''

# 1. insert the block right before the aircraft loop's definition end -> after sky_la_loop; simplest: before "HOMECHG = " is too early
#    (needs _sky_call + _trip_url + _handoff_returns, all defined by then only at call time, so placement just has to precede thread start).
anchor = "# ---------- W6 SKY LIVE ACTIVITY"
assert anchor in s
# put the new block AFTER the whole W6 section: find the next top-level def after sky_la_loop that is not part of it
i = s.index("def sky_la_loop():")
m = re.search(r"\n(?=(?:def |class |[A-Z_]+ = |# ----------)[^\n]*)", s[i + 20:])
# find the first top-level statement after sky_la_loop body (a line at column 0 that is not blank/indented/comment-continuation)
j = i + 1
lines = s[i:].split("\n")
off = len(lines[0]) + 1
k = 1
while k < len(lines):
    ln = lines[k]
    if ln and not ln.startswith((" ", "\t")) :
        break
    off += len(ln) + 1
    k += 1
ins = i + off
s = s[:ins] + BLOCK + "\n" + s[ins:]

# 2. HA return card stays off while native owns it
old = '"turo_return": _la_return(),'
assert old in s
s = s.replace(old, '"turo_return": None if sky_ret_owns() else _la_return(),   # TURO RETURN: the Sky app owns it when healthy\n                     ', 1)
# 3. heartbeat
old = '            hb["sky_la"] = sky_la_health()   # W6 round 4: iPhone aircraft Live Activity (Bestly Sky app)\n'
assert old in s
s = s.replace(old, old + '            hb["sky_ret"] = sky_ret_health()   # Turo return Live Activity (Bestly Sky app)\n', 1)
# 4. thread
old = "    threading.Thread(target=sky_la_loop, daemon=True).start()   # W6 round 4\n"
assert old in s
s = s.replace(old, old + "    threading.Thread(target=sky_ret_loop, daemon=True).start()   # Turo return Live Activity (Bestly Sky app)\n", 1)
open(P, "w").write(s)
print("patched")
