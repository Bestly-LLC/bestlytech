#!/usr/bin/env python3
"""Eli agenda tick -- runs every 15 min from launchd (tech.bestly.eli-agenda) on the Mac mini.
Repo copy of ~/bin/eli-agenda.py (source of truth is the Mac; keep in sync).

Dumb on purpose: all the real work (the nightly ~9:47 PM PT pass, the pre-call check, reading
bestly_memory, free AI, writing "Your prep") lives in the eli-agenda-run edge function, which
decides on every tick whether anything actually needs to happen. This script just kicks it via
the publishable key -- no secrets live here at all -- and leaves the heartbeat (pi_jobs, Scout's
watchdog) to the edge function, which knows whether the pass actually ran or was a no-op.

Plan: bestly_memory area=eli key=plan/eli-auto-agenda-2026-11-02.
"""
import json
import os
import time
import urllib.error
import urllib.request

REF = "rcqfqhguwpmaarseifqg"
SB = f"https://{REF}.supabase.co"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"  # publishable key (key switch 2026-09-24)
DIR = os.path.expanduser("~/Library/Application Support/bestly-eli-agenda")
LOG = os.path.join(DIR, "log")


def log(msg):
    os.makedirs(DIR, exist_ok=True)
    with open(LOG, "a") as f:
        f.write(time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg + "\n")
    try:
        if os.path.getsize(LOG) > 1_000_000:
            os.replace(LOG, LOG + ".1")
    except Exception:
        pass


def rpc(fn, args, timeout=65):
    data = json.dumps(args).encode()
    req = urllib.request.Request(f"{SB}/rest/v1/rpc/{fn}", data=data, method="POST",
                                  headers={"Content-Type": "application/json", "apikey": ANON, "Authorization": f"Bearer {ANON}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return 0, str(e)[:300]


def main():
    code, body = rpc("eli_agenda_tick", {})
    if code != 200:
        log(f"tick failed: {code} {body}")
    else:
        log(f"tick ok: {body}")


if __name__ == "__main__":
    main()
