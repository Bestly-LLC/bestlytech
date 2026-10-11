"""Nickel digest lock-screen "Yes, file all" listener (bestly-pi). Owner: Nickel (settlements). Tool card: settle-actions.

The 9:05 AM digest is an actionable Home Assistant notification. Tapping "Yes, file all" makes the iPhone fire the HA event
mobile_app_notification_action {action: "SETTLE_YES_<digest uuid>"}. This service subscribes to that event on the HA websocket
(the same event the wall alarm buttons use in /opt/bestly/wall/server.py) and calls settlement_digest_action_t, which approves
ONLY the claims named in that digest and are still Ready (see migration 20261011003000_settlements_digest_push.sql).

It never approves anything on its own: the only trigger is a SETTLE_YES_ action id that came from a tap.

Credentials (all already on the Pi, nothing new was created, nothing is ever printed):
  HA token       HA_TOKEN= line in /home/pi/scripts/.env  (same file the wall server and hapush.py read)
  Supabase token /home/pi/.bestly/db_watchdog_token       (mode 600; db_watchdog_ok token, same as the finder)
  Heartbeat      /opt/bestly/cron/lib.py rpc("pi_job_report") using the service key in /home/pi/scripts/.env, like every Pi job
Watchdog: every 10 minutes it reports job "settle-actions" to pi_jobs (ok only while the HA websocket is connected);
pi_jobs.max_gap_min = 30, so a silent or disconnected listener alerts Scout.
Needs: python3-websockets (apt, already installed for the wall server). Stdlib otherwise.
"""
import asyncio
import json
import os
import re
import sys
import time
import urllib.request

import websockets

HA_URL = os.environ.get("HA_URL", "http://127.0.0.1:8123")
HA_ENV_FILE = os.environ.get("HA_ENV_FILE", "/home/pi/scripts/.env")
DB_TOKEN_FILE = os.environ.get("SETTLEMENT_TOKEN_FILE", "/home/pi/.bestly/db_watchdog_token")
SUPABASE = "https://rcqfqhguwpmaarseifqg.supabase.co"
PUBLISHABLE = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw")  # public by design
JOB = "settle-actions"
BEAT_EVERY = 600  # seconds
ACTION = re.compile(r"^SETTLE_YES_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")

STATE = {"connected": False, "since": 0.0, "taps": 0, "last": "none yet", "err": ""}
DONE = set()  # digest ids already answered successfully (the RPC is idempotent too)


def log(msg):
    print(time.strftime("%Y-%m-%d %I:%M:%S %p"), msg, flush=True)


def read(path):
    with open(path) as f:
        return f.read().strip()


def ha_token():
    with open(HA_ENV_FILE) as f:
        for line in f:
            if line.startswith("HA_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("HA_TOKEN not found in " + HA_ENV_FILE)


def approve(digest):
    body = json.dumps({"p_token": read(DB_TOKEN_FILE), "p_digest": digest, "p_action": "yes"}).encode()
    req = urllib.request.Request(f"{SUPABASE}/rest/v1/rpc/settlement_digest_action_t", data=body, method="POST",
                                 headers={"apikey": PUBLISHABLE, "Authorization": f"Bearer {PUBLISHABLE}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def beat():
    """Heartbeat to pi_jobs (Scout alerts if it goes quiet for 30 min). Blocking; run in a thread."""
    try:
        sys.path.insert(0, "/opt/bestly/cron")
        import lib  # noqa: PLC0415
        up = int((time.time() - STATE["since"]) / 60) if STATE["connected"] else 0
        summary = (f"listening, up {up} min, {STATE['taps']} taps, last: {STATE['last']}" if STATE["connected"]
                   else f"NOT connected to Home Assistant: {STATE['err'] or 'starting'}")[:300]
        lib.rpc("pi_job_report", p_job=JOB, p_ok=bool(STATE["connected"]), p_summary=summary, p_duration_ms=None)
    except Exception as e:  # noqa: BLE001
        log(f"heartbeat failed: {e}")


async def beat_loop():
    for _ in range(30):  # let the first connect finish so the first beat is honest, not a false "starting" failure
        if STATE["connected"]:
            break
        await asyncio.sleep(1)
    while True:
        await asyncio.to_thread(beat)
        await asyncio.sleep(BEAT_EVERY)


async def handle_tap(digest):
    if digest in DONE:
        log(f"tap {digest} ignored (already answered)")
        return
    STATE["taps"] += 1
    for attempt in range(3):  # a tap must not be lost to a blip
        try:
            res = await asyncio.to_thread(approve, digest)
            DONE.add(digest)
            STATE["last"] = f"{time.strftime('%I:%M %p')} {res.get('state', res)}"
            log(f"tap {digest} -> {res}")
            return
        except Exception as e:  # noqa: BLE001
            log(f"approve failed ({e}); retry {attempt + 1}")
            await asyncio.sleep(5 * (attempt + 1))
    STATE["last"] = f"{time.strftime('%I:%M %p')} approve FAILED"


async def listen():
    delay = 5
    while True:  # self-heal: reconnect forever with backoff
        try:
            async with websockets.connect(HA_URL.replace("http", "ws", 1) + "/api/websocket", ping_interval=30,
                                          ping_timeout=20, open_timeout=10, close_timeout=2) as ws:
                await ws.recv()  # auth_required
                await ws.send(json.dumps({"type": "auth", "access_token": ha_token()}))
                if json.loads(await ws.recv()).get("type") != "auth_ok":
                    raise RuntimeError("Home Assistant refused the token")
                await ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "mobile_app_notification_action"}))
                STATE.update(connected=True, since=time.time(), err="")
                delay = 5
                log("listening for SETTLE_YES_ taps")
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("type") != "event":
                        continue
                    m = ACTION.match(str(((msg.get("event") or {}).get("data") or {}).get("action", "")))
                    if m:
                        asyncio.create_task(handle_tap(m.group(1)))
        except Exception as e:  # noqa: BLE001
            STATE.update(connected=False, err=str(e)[:120])
            log(f"listener dropped: {e}")
        STATE["connected"] = False
        await asyncio.sleep(delay)
        delay = min(delay * 2, 60)


async def main():
    await asyncio.gather(listen(), beat_loop())


if __name__ == "__main__":
    asyncio.run(main())
