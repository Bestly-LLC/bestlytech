import time, shutil
P="/opt/bestly/wall/server.py"
src=open(P).read()
shutil.copy(P, P+".bak_carcard_"+time.strftime("%H%M%S"))
def sub(a,b):
    global src
    assert src.count(a)==1,(src.count(a),a[:60])
    src=src.replace(a,b)
sub('''HOME_LAT, HOME_LON = 34.08436, -118.37193      # 733 N Kings Rd, West Hollywood
''','''HOME_LAT, HOME_LON = 34.08436, -118.37193      # 733 N Kings Rd, West Hollywood

# ---------- CARCARD_20261103: Cars card feed = Mae's charge planner through the wall_car_charge_plan RPC, cached 2 min ----------
CARS_C = {"d": None, "ok_at": 0.0, "try_at": 0.0, "err": None}


def cars_api():
    now = time.time()
    if CARS_C["d"] is None or (now - CARS_C["ok_at"] > 120 and now - CARS_C["try_at"] > 30):
        CARS_C["try_at"] = now
        try:
            d = rpc("wall_car_charge_plan", {}, timeout=10)
            if isinstance(d, dict):
                CARS_C.update(d=d, ok_at=time.time(), err=None)
        except Exception as e:
            CARS_C["err"] = (type(e).__name__ + ": " + str(e))[:120]
    d = CARS_C["d"] or {}
    return {"cars": d.get("cars") or [], "station": d.get("station"), "as_of": d.get("as_of"),
            "fetched_at": CARS_C["ok_at"] or None, "error": CARS_C["err"]}
''')
sub('''        if p == "/api/w5":   # W5 r4: fresh-air takeover + DND for the page
''','''        if p == "/api/cars":   # CARCARD_20261103
            return self.send(200, json.dumps(cars_api()))
        if p == "/api/w5":   # W5 r4: fresh-air takeover + DND for the page
''')
open(P,"w").write(src); print("server patched")
