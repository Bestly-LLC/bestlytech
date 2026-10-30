#!/usr/bin/env python3
"""car-telemetry-fwd: Fleet Telemetry receiver -> Supabase (Blue Steel live location).

Reads the decoded JSON records the fleet-telemetry receiver publishes on zmq (topics <namespace>_V and
<namespace>_connectivity), keeps the latest Location / VehicleSpeed (mph) / Gear / GpsHeading, and
  - posts them to the car_telemetry_ingest RPC at most every 30 s, only when something changed
    (parked, the car sends nothing, so nothing is posted);
  - 1.1.0 (2026-10-29): tires. Keeps the four TpmsPressure* values (sent in bar; stored as psi) and Tesla's own
    TpmsSoftWarnings / TpmsHardWarnings, and posts them to car_tire_ingest: at once when a warning appears or changes,
    otherwise at most every 60 s when a pressure moves. The database decides what to tell the guest and Jared.
  - sends a car_telemetry_beat every 60 s: receiver reachable, last record time, certificate days left.
Auth: Supabase publishable key (public) + an ingest token (secret, root 0600 on the Pi; only its sha256 is in the database).
"""
import json, os, socket, ssl, sys, threading, time
from datetime import datetime, timezone

import requests
import zmq

VERSION = "1.1.0"
SB = os.environ.get("SUPABASE_URL", "https://rcqfqhguwpmaarseifqg.supabase.co")
ANON = os.environ["SUPABASE_ANON_KEY"]
TOKEN = os.environ["CAR_TELEMETRY_TOKEN"]
ZMQ_ADDR = os.environ.get("ZMQ_ADDR", "tcp://fleet-telemetry:5284")
NS = os.environ.get("NAMESPACE", "tesla_telemetry")
RECV_HOST = os.environ.get("RECEIVER_HOST", "fleet-telemetry")
RECV_PORT = int(os.environ.get("RECEIVER_PORT", "8443"))
CERT_FILE = os.environ.get("CERT_FILE", "/pub/server.crt")
POST_EVERY = float(os.environ.get("POST_EVERY", "30"))
TIRE_EVERY = float(os.environ.get("TIRE_EVERY", "60"))
BAR_TO_PSI = 14.5038   # Tesla's TPMS values are bar (same signal the Fleet API vehicle_data returns as tpms_pressure_*)
TIRE_KEYS = {"TpmsPressureFl": "fl", "TpmsPressureFr": "fr", "TpmsPressureRl": "rl", "TpmsPressureRr": "rr"}
WARN_KEYS = {"TpmsHardWarnings": "hard", "TpmsSoftWarnings": "soft"}
BEAT_EVERY = float(os.environ.get("BEAT_EVERY", "60"))

lock = threading.Lock()
S = {"lat": None, "lon": None, "loc_at": None, "speed_mph": None, "gear": None, "heading": None}
T = {"loc": 0.0, "speed": 0.0, "gear": 0.0, "heading": 0.0}   # per-field reading time (epoch s); older records never win
dirty = {"loc": False, "any": False}
TI = {"fl": None, "fr": None, "rl": None, "rr": None, "hard": None, "soft": None, "at": 0.0}
tire_dirty = {"any": False, "warn": False, "last_post": 0.0}
meta = {"sig": 0, "last_at": 0.0, "last_msg": 0.0, "last_post": 0.0, "last_conn": None, "sig_total": 0, "ok": 0, "fail": 0, "last_ok": 0.0}
headers = {"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"}


def log(msg):
    print(datetime.now().strftime("%Y-%m-%d %I:%M:%S %p ") + msg, flush=True)


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def parse_ts(s):
    if not s:
        return None
    try:
        s = s.replace("Z", "+00:00")
        if "." in s:  # protojson can emit up to 9 fractional digits; Python takes 6
            head, rest = s.split(".", 1)
            frac, tz = rest[:-6], rest[-6:]
            s = head + "." + frac[:6] + tz
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


def num(v):
    if not isinstance(v, dict) or v.get("invalid"):
        return None
    for k in ("doubleValue", "floatValue", "intValue", "longValue", "stringValue"):
        if k in v:
            try:
                return float(v[k])
            except (TypeError, ValueError):
                return None
    return None


def warn_text(v):
    """Tesla sends the warnings as an enum / bitmask. Keep its raw text; the database reads 'none' / 0 / false as no warning."""
    if not isinstance(v, dict):
        return None
    if v.get("invalid"):
        return "invalid"
    for k, x in v.items():
        if k.endswith("Value") or k == "value":
            return str(x)[:120]
    return json.dumps(v)[:120]


def handle_tire(k, v, created):
    """Called with the lock held."""
    if k in TIRE_KEYS:
        x = num(v)
        if x is not None and 0 <= x < 10:                 # bar (0 = fully flat); anything else is not a tire reading
            psi = round(x * BAR_TO_PSI, 1)
            if TI[TIRE_KEYS[k]] != psi:
                TI[TIRE_KEYS[k]] = psi
                tire_dirty["any"] = True
            TI["at"] = max(TI["at"], created)
    elif k in WARN_KEYS:
        w = warn_text(v)
        if TI[WARN_KEYS[k]] != w:
            TI[WARN_KEYS[k]] = w
            tire_dirty["any"] = tire_dirty["warn"] = True  # a warning change goes out at once
        TI["at"] = max(TI["at"], created)


def handle_v(p):
    created = parse_ts(p.get("createdAt")) or time.time()
    created = min(created, time.time())
    data = p.get("data") or []
    with lock:
        meta["sig"] += len(data)
        meta["sig_total"] += len(data)
        meta["last_msg"] = time.time()
        for d in data:
            k, v = d.get("key"), d.get("value") or {}
            if k == "Location":
                lv = v.get("locationValue")
                if isinstance(lv, dict) and "latitude" in lv and "longitude" in lv and created >= T["loc"]:
                    S["lat"], S["lon"], S["loc_at"], T["loc"] = float(lv["latitude"]), float(lv["longitude"]), created, created
                    dirty["loc"] = dirty["any"] = True
            elif k == "VehicleSpeed" and created >= T["speed"]:
                x = num(v)
                if x is not None:       # Tesla documents VehicleSpeed in mph
                    S["speed_mph"], T["speed"] = round(x, 1), created
                    dirty["any"] = True
            elif k == "GpsHeading" and created >= T["heading"]:
                x = num(v)
                if x is not None:
                    S["heading"], T["heading"] = round(x % 360, 1), created
                    dirty["any"] = True
            elif k in TIRE_KEYS or k in WARN_KEYS:
                handle_tire(k, v, created)
            elif k == "Gear" and created >= T["gear"]:
                g = str(v.get("shiftStateValue") or v.get("stringValue") or "").replace("ShiftState", "")   # typed or plain, either way
                S["gear"], T["gear"] = (g if g in ("P", "R", "N", "D") else None), created
                dirty["any"] = True
        meta["last_at"] = max(meta["last_at"], created)


def zmq_loop():
    ctx = zmq.Context.instance()
    while True:
        sock = ctx.socket(zmq.SUB)
        sock.setsockopt(zmq.SUBSCRIBE, b"")
        sock.setsockopt(zmq.RECONNECT_IVL, 1000)
        sock.setsockopt(zmq.RECONNECT_IVL_MAX, 10000)
        sock.connect(ZMQ_ADDR)
        log(f"zmq connected to {ZMQ_ADDR}")
        try:
            while True:
                if not sock.poll(5000):
                    continue
                parts = sock.recv_multipart()
                if len(parts) < 2:
                    continue
                topic = parts[0].decode("utf-8", "replace")
                try:
                    p = json.loads(parts[1])
                except Exception as e:
                    log(f"bad payload on {topic}: {e}")
                    continue
                if topic.endswith("_V"):
                    handle_v(p)
                elif topic.endswith("_connectivity"):
                    with lock:
                        meta["last_conn"] = {"status": p.get("status"), "at": p.get("createdAt")}
                        meta["last_msg"] = time.time()
                    log(f"car connectivity: {p.get('status')}")
        except Exception as e:
            log(f"zmq loop error: {e}")
        finally:
            sock.close(0)
        time.sleep(2)


def rpc(fn, body):
    r = requests.post(f"{SB}/rest/v1/rpc/{fn}", headers=headers, data=json.dumps(body), timeout=12)
    if r.status_code >= 400:
        raise RuntimeError(f"{fn} HTTP {r.status_code}: {r.text[:160]}")
    return r.json() if r.text else None


def post_rows():
    with lock:
        if not dirty["any"]:
            return
        row = {"at": iso(meta["last_at"] or time.time()), "speed_mph": S["speed_mph"], "gear": S["gear"],
               "heading": S["heading"], "signals": meta["sig"]}
        had_loc = dirty["loc"]
        if had_loc and S["lat"] is not None:
            row.update({"lat": S["lat"], "lon": S["lon"], "loc_at": iso(S["loc_at"])})
        sig = meta["sig"]
        snapshot = (dict(dirty),)
        dirty["loc"] = dirty["any"] = False
        meta["sig"] = 0
    try:
        res = rpc("car_telemetry_ingest", {"p_token": TOKEN, "p_rows": [row]})
        with lock:
            meta["ok"] += 1
            meta["last_ok"] = time.time()
            meta["last_post"] = time.time()
        log(f"posted {res}")
    except Exception as e:
        with lock:        # keep it dirty; try again next window
            dirty["any"] = True
            dirty["loc"] = dirty["loc"] or had_loc
            meta["sig"] += sig
            meta["fail"] += 1
            meta["last_post"] = time.time()
        log(f"post failed: {e}")


def post_tires(force=False):
    with lock:
        if not tire_dirty["any"]:
            return
        if not (force or tire_dirty["warn"] or time.time() - tire_dirty["last_post"] >= TIRE_EVERY):
            return
        row = {"at": iso(TI["at"] or time.time()), "fl": TI["fl"], "fr": TI["fr"], "rl": TI["rl"], "rr": TI["rr"],
               "hard": TI["hard"], "soft": TI["soft"]}
        was_warn = tire_dirty["warn"]
        tire_dirty["any"] = tire_dirty["warn"] = False
        tire_dirty["last_post"] = time.time()
    try:
        res = rpc("car_tire_ingest", {"p_token": TOKEN, "p_row": row})
        log(f"tires posted {row} -> {res}")
    except Exception as e:
        with lock:      # try again next second
            tire_dirty["any"] = True
            tire_dirty["warn"] = tire_dirty["warn"] or was_warn
            tire_dirty["last_post"] = 0.0
        log(f"tire post failed: {e}")


def cert_days_left():
    try:
        info = ssl._ssl._test_decode_cert(CERT_FILE)
        return round((ssl.cert_time_to_seconds(info["notAfter"]) - time.time()) / 86400, 1)
    except Exception:
        return None


def receiver_up():
    try:
        with socket.create_connection((RECV_HOST, RECV_PORT), timeout=3):
            return True
    except OSError:
        return False


def beat():
    with lock:
        b = {"up": receiver_up(), "fwd_version": VERSION, "cert_days_left": cert_days_left(),
             "last_msg_at": iso(meta["last_msg"]) if meta["last_msg"] else None,
             "last_record_at": iso(meta["last_ok"]) if meta["last_ok"] else None,
             "car_connection": meta["last_conn"], "signals_total": meta["sig_total"],
             "posts_ok": meta["ok"], "posts_failed": meta["fail"],
             "tires": {k: TI[k] for k in ("fl", "fr", "rl", "rr", "hard", "soft")},
             "tires_at": iso(TI["at"]) if TI["at"] else None}
    rpc("car_telemetry_beat", {"p_token": TOKEN, "p_beat": b})


def main():
    log(f"car-telemetry-fwd {VERSION} up")
    threading.Thread(target=zmq_loop, daemon=True).start()
    next_beat = 0.0
    while True:
        now = time.time()
        if now >= next_beat:
            try:
                beat()
            except Exception as e:
                log(f"beat failed: {e}")
            next_beat = now + BEAT_EVERY
        if now - meta["last_post"] >= POST_EVERY:
            post_rows()
        post_tires()
        time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
