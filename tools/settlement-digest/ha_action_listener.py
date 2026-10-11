"""Nickel digest lock-screen "Yes, file all" listener (bestly-pi). Owner: Nickel (settlements).

The 9:05 AM digest is an actionable Home Assistant notification. Tapping "Yes, file all" makes the iPhone fire the HA event
mobile_app_notification_action {action: "SETTLE_YES_<digest uuid>"}. This service subscribes to that event on the HA websocket
(the same event the wall alarm buttons use in /opt/bestly/wall/server.py) and calls settlement_digest_action_t, which approves
ONLY the claims named in that digest and are still Ready (see migration 20261011003000_settlements_digest_push.sql).

It never approves anything on its own: the only trigger is a SETTLE_YES_ action id that came from a tap.

Config (files, mode 600, never printed):
  HA_URL            env, default http://127.0.0.1:8123
  HA_TOKEN_FILE     env, default /home/pi/.bestly/ha_token        (HA long-lived access token)
  SETTLEMENT_TOKEN_FILE env, default /home/pi/.bestly/db_watchdog_token   (db_watchdog_ok token, same as the finder)
Needs: pip install websocket-client
"""
import json
import os
import re
import sys
import time
import urllib.request

import websocket  # websocket-client

HA_URL = os.environ.get("HA_URL", "http://127.0.0.1:8123")
HA_TOKEN_FILE = os.environ.get("HA_TOKEN_FILE", "/home/pi/.bestly/ha_token")
DB_TOKEN_FILE = os.environ.get("SETTLEMENT_TOKEN_FILE", "/home/pi/.bestly/db_watchdog_token")
SUPABASE = "https://rcqfqhguwpmaarseifqg.supabase.co"
PUBLISHABLE = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw")  # public by design
ACTION = re.compile(r"^SETTLE_YES_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")


def read(path):
    with open(path) as f:
        return f.read().strip()


def log(msg):
    print(time.strftime("%Y-%m-%d %I:%M:%S %p"), msg, flush=True)


def approve(digest):
    body = json.dumps({"p_token": read(DB_TOKEN_FILE), "p_digest": digest, "p_action": "yes"}).encode()
    req = urllib.request.Request(f"{SUPABASE}/rest/v1/rpc/settlement_digest_action_t", data=body, method="POST",
                                 headers={"apikey": PUBLISHABLE, "Authorization": f"Bearer {PUBLISHABLE}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def run_once():
    ws = websocket.create_connection(HA_URL.replace("http", "ws", 1) + "/api/websocket", timeout=60)
    ws.recv()  # auth_required
    ws.send(json.dumps({"type": "auth", "access_token": read(HA_TOKEN_FILE)}))
    if json.loads(ws.recv()).get("type") != "auth_ok":
        raise RuntimeError("HA rejected the token")
    ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "mobile_app_notification_action"}))
    log("listening for SETTLE_YES_ taps")
    ws.settimeout(None)
    while True:
        msg = json.loads(ws.recv())
        if msg.get("type") != "event":
            continue
        m = ACTION.match(str((msg.get("event", {}).get("data", {}) or {}).get("action", "")))
        if not m:
            continue
        for attempt in range(3):  # a tap must not be lost to a blip
            try:
                log(f"tap {m.group(1)} -> {approve(m.group(1))}")
                break
            except Exception as e:  # noqa: BLE001
                log(f"approve failed ({e}); retry {attempt + 1}")
                time.sleep(5 * (attempt + 1))


def main():
    while True:  # self-heal: reconnect forever
        try:
            run_once()
        except Exception as e:  # noqa: BLE001
            log(f"listener dropped: {e}")
        time.sleep(10)


if __name__ == "__main__":
    sys.exit(main())
