# ---------- WAVE1_20261102: Mae's leave-now push (one per bus trip, only at home, never 11 PM to 7 AM) ----------
# Same rule as the wall bus card: per line the earliest arrival whose leave-by has not passed; "leave now" = leave-by inside [-20 s, +60 s].
# Live arrivals only (a printed-schedule bus is not worth a time-sensitive push). Pushes: only time-to-leave goes straight to the phone.
BUSPUSH = {"sent": {}, "last_at": 0.0, "last": None, "err": None, "ok_at": 0.0, "n": 0}


def _bus_key(r):
    s = (str(r.get("line") or "") + " " + str(r.get("name") or "")).upper()
    if "CITY" in s:
        return "CITYLINE"
    if "DASH" in s or "FAIRFAX" in s:
        return "DASH"
    return str(r.get("line") or "")


def bus_leave_now(body, now_ms):
    best = {}
    for r in (body or {}).get("lines") or []:
        k = _bus_key(r)
        if k not in ("10", "4", "105", "CITYLINE"):
            continue
        if k == "105" and "LAX" not in ((r.get("toward") or "") + (r.get("direction") or "") + (r.get("headsign") or "")).upper():
            continue
        walk = r.get("walk_min") if r.get("walk_min") is not None else 5
        for a in r.get("arrivals") or []:
            leave = a["eta"] - walk * 60000
            if leave < now_ms - 20000:
                continue
            if k not in best or a["eta"] < best[k][0]["eta"]:
                best[k] = (a, r, leave)
            break
    return [(k, a, r) for k, (a, r, leave) in best.items()
            if a.get("live") and r.get("live") and not r.get("stale") and -20000 <= leave - now_ms <= 60000]


def bus_push_loop():
    while True:
        try:
            time.sleep(15)
            now = time.time()
            BUSPUSH["sent"] = {k: v for k, v in BUSPUSH["sent"].items() if now - v < 4 * 3600}
            hr = datetime.now().hour
            if hr >= 23 or hr < 7:                      # quiet hours 11 PM to 7 AM
                continue
            if PRES.get("where") != "home" or now - BUSPUSH["last_at"] < 120:
                continue
            code, body = _bus_proxy()
            hit = sorted(bus_leave_now(json.loads(body), int(now * 1000)), key=lambda x: x[1]["eta"])
            BUSPUSH["ok_at"] = now
            for k, a, r in hit:
                tid = "%s|%s" % (k, a.get("trip") or a["eta"] // 60000)
                if tid in BUSPUSH["sent"]:
                    continue
                label = "the CityLine" if k == "CITYLINE" else "the " + k
                text = "Leave now for %s at %s" % (label, r.get("stop") or "your stop")
                la_send({"title": "Mae", "message": text,
                         "data": {"push": {"interruption-level": "time-sensitive", "sound": "default"}, "url": "https://bestly.tech/admin/wall", "tag": "bestly_bus_leave"}})
                BUSPUSH["sent"][tid] = BUSPUSH["last_at"] = time.time()
                BUSPUSH["last"], BUSPUSH["err"] = {"at": time.time(), "text": text, "trip": tid}, None
                BUSPUSH["n"] += 1
                print("bus push (Mae): " + text, flush=True)
                break                                   # one push per leave-now moment
        except Exception as e:
            BUSPUSH["err"] = str(e)[:140]
            print("bus push error: %s" % e, flush=True)


# ---------- end WAVE1_20261102 ----------


