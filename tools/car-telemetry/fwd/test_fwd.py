#!/usr/bin/env python3
"""Local end-to-end test of the forwarder: fake receiver (zmq PUB) -> fwd.py -> car_telemetry_ingest.
Run inside the fwd image, never touching the real receiver:
  docker run --rm --env-file /opt/bestly/telemetry/.env -e ZMQ_ADDR=tcp://127.0.0.1:5999 -v $PWD/test_fwd.py:/t/test_fwd.py:ro \
    car-telemetry-fwd:1.0.1 python /t/test_fwd.py LAT LON
It publishes one decoded 'V' record in the receiver's JSON shape and lets fwd post it once (no beat is sent).
"""
import json, sys, threading, time
from datetime import datetime, timezone

import zmq

sys.path.insert(0, "/app")
import fwd  # noqa: E402

lat, lon = float(sys.argv[1]), float(sys.argv[2])
ctx = zmq.Context.instance()
pub = ctx.socket(zmq.PUB)
pub.bind("tcp://127.0.0.1:5999")
threading.Thread(target=fwd.zmq_loop, daemon=True).start()
time.sleep(2)   # let the SUB socket join
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.123456789Z")
rec = {"data": [
    {"key": "Location", "value": {"locationValue": {"latitude": lat, "longitude": lon}}},
    {"key": "VehicleSpeed", "value": {"doubleValue": 0.0}},
    {"key": "GpsHeading", "value": {"doubleValue": 90.0}},
    {"key": "Gear", "value": {"shiftStateValue": "ShiftStateP"}},
], "createdAt": now, "vin": "TEST", "isResend": False}
for _ in range(3):   # PUB drops messages sent before the SUB joined; repeat is harmless (same values)
    pub.send_multipart([b"tesla_telemetry_V", json.dumps(rec).encode()])
    time.sleep(0.5)
time.sleep(1)
print("fwd state:", fwd.S, "dirty:", fwd.dirty)
fwd.post_rows()
print("meta ok/fail:", fwd.meta["ok"], fwd.meta["fail"])
