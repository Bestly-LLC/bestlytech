#!/usr/bin/env python3
# Demo run of the Turo return Live Activity against Jared's phone (fake guest "Demo"). Run on the Pi. Prints status codes only.
import json, time, sys, urllib.request, urllib.error
cfg = json.load(open("/opt/bestly/wall/.report.json"))
NB = " "

def call(body):
    req = urllib.request.Request(cfg["supabase_url"].rstrip("/") + "/functions/v1/wall-live-activity", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "x-api-key": cfg["agent_key"]})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}") | {"http": e.code}

def summarize(r):
    return {"ok": r.get("ok"), "sent": r.get("sent"), "delivered": r.get("delivered"),
            "codes": [f"{x.get('kind')}:{x.get('status')} {x.get('reason') or ''}".strip() for x in r.get("results") or []], "err": r.get("error")}

now = time.time()
eta = now + 20 * 60
def st(stage, **kw):
    base = {"tripId": "demo", "who": "Demo · Blue Steel", "status": "Heading home", "big": f"Home ~{time.strftime('%-I:%M', time.localtime(eta))}{NB}PM",
            "place": f"20{NB}min · 11{NB}mi away", "pin": False, "charge": "71% charge", "sc": f"4{NB}Supercharger{NB}stops · $36{NB}to{NB}bill{NB}back",
            "stage": 1, "low": False, "issue": False, "icon": "ret", "tint": "#0A84FF", "trail": time.strftime('%-I:%M', time.localtime(eta)),
            "trailSmall": "PM", "etaAt": eta, "etaStart": now - 10 * 60, "url": None, "at": time.time()}
    base.update(kw)
    return base

mode = sys.argv[1] if len(sys.argv) > 1 else "all"
if mode in ("start", "all"):
    print("start", summarize(call({"op": "push", "attr": "turo", "event": "start", "state": st(1), "priority": 10, "stale_s": 600,
                                   "alert": {"title": "Turo return", "body": "Demo trip (test)"}})))
if mode == "all":
    time.sleep(40)
    print("health", call({"op": "health", "attr": "turo"}))
    print("update", summarize(call({"op": "push", "attr": "turo", "event": "update", "priority": 10, "stale_s": 600,
                                    "state": st(2, status="Back home", big="Back 11:05" + NB + "PM", place="Kings Rd · 300" + NB + "ft north", pin=True,
                                                 low=True, icon="low", tint="#FF9F0A", trail="33%", trailSmall=None, charge="Low 33% · was 82%",
                                                 etaAt=None, etaStart=None)})))
    time.sleep(40)
    print("end", summarize(call({"op": "push", "attr": "turo", "event": "end", "state": st(2), "priority": 10, "dismiss_s": 0})))
if mode == "end":
    print("end", summarize(call({"op": "push", "attr": "turo", "event": "end", "state": st(1), "priority": 10, "dismiss_s": 0})))
