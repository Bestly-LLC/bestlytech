import json, time, sys
class _DT:
    h = 14
    @staticmethod
    def now():
        class N: hour = _DT.h
        return N()
datetime = _DT
PRES = {"where": "home"}
sent = []
def la_send(p): sent.append(p)
def mk(eta_min, walk, live=True, line="10", trip="t1"):
    return {"lines": [{"line": line, "name": "Metro " + line, "direction": "Eastbound", "toward": "LAX trips", "stop": "Melrose / Orlando", "walk_min": walk, "live": live, "stale": False,
                       "arrivals": [{"eta": int(time.time() * 1000) + int(eta_min * 60000), "live": live, "trip": trip}]}]}
CUR = {"b": mk(3.5, 3)}
def _bus_proxy(): return 200, json.dumps(CUR["b"])
exec(open(sys.argv[1]).read().split("# ---------- end WAVE1")[0])
class Stop(BaseException): pass
cnt = {"n": 0}
def fake_sleep(s):
    cnt["n"] += 1
    if cnt["n"] > 6: raise Stop()
time.sleep = fake_sleep
def run():
    cnt["n"] = 0
    try: bus_push_loop()
    except Stop: pass
# 1: leave-now live bus at home -> exactly one push, even over several loops
run(); print("1 sent", len(sent), sent[0]["message"], sent[0]["title"])
# 2: same trip again -> none (and gap)
BUSPUSH["last_at"] = 0; run(); print("2 sent still", len(sent))
# 3: scheduled (not live) -> none
CUR["b"] = mk(3.5, 3, live=False, trip="t2"); BUSPUSH["last_at"] = 0; run(); print("3 sent", len(sent))
# 4: away -> none
CUR["b"] = mk(3.5, 3, trip="t3"); PRES["where"] = "away"; run(); print("4 sent", len(sent))
# 5: quiet hours -> none
PRES["where"] = "home"; _DT.h = 23; run(); print("5 sent", len(sent)); _DT.h = 6; run(); print("5b sent", len(sent))
# 6: not yet time to leave (leave in 5 min) -> none; 105 not toward LAX -> none handled elsewhere
_DT.h = 14; CUR["b"] = mk(9, 3, trip="t4"); run(); print("6 sent", len(sent))
# 7: new trip leave-now -> push 2 (later bus)
CUR["b"] = mk(3.2, 3, trip="t5"); BUSPUSH["last_at"] = 0; run(); print("7 sent", len(sent), sent[-1]["message"])
# 8: missed (leave passed by 1 min) -> none
CUR["b"] = mk(1.9, 3, trip="t6"); BUSPUSH["last_at"] = 0; run(); print("8 sent", len(sent))
