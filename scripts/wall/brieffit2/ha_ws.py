#!/usr/bin/env python3
"""tiny HA websocket client (token read from the env file the wall server already reads; never printed).
usage: ha_ws.py '<json command without id>' ..."""
import asyncio, json, sys, os
import websockets
ENV = "/home/pi/scripts/.env"
tok = None
for line in open(ENV):
    if line.startswith("HA_TOKEN="):
        tok = line.split("=", 1)[1].strip().strip('"').strip("'")
async def main():
    async with websockets.connect("ws://127.0.0.1:8123/api/websocket", max_size=None) as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "auth", "access_token": tok}))
        r = json.loads(await ws.recv())
        assert r["type"] == "auth_ok", r
        i = 0
        for c in sys.argv[1:]:
            i += 1
            m = json.loads(c); m["id"] = i
            await ws.send(json.dumps(m))
            while True:
                r = json.loads(await asyncio.wait_for(ws.recv(), 20))
                if r.get("id") == i:
                    print(json.dumps(r)[:int(os.environ.get("MAXC", "1500"))])
                    break
asyncio.run(main())
