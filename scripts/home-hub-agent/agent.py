#!/usr/bin/env python3
"""
Bestly Home Hub on-prem agent.

Runs on the LAN (the Pi). Polls the home-hub-agent edge function for queued
commands, executes them against the local Pi-hole / Home Assistant / Homebridge
APIs, and posts the result back. Nothing inbound is ever opened to this machine.

Config: /etc/bestly/home-hub-agent.json (or $HOME_HUB_AGENT_CONFIG), e.g.

{
  "supabase_url":  "https://rcqfqhguwpmaarseifqg.supabase.co",
  "agent_key":     "<the home_hub_agent_key from Supabase Vault>",
  "agent_name":    "home-hub",
  "poll_seconds":  15,
  "pihole":        {},
  "homeassistant": {"base": "http://127.0.0.1:8123",  "token": "<HA long-lived token>"},
  "homebridge":    {"base": "http://127.0.0.1:8581",  "user": "admin", "password": "<pw>"}
}

Any section you omit simply makes those commands fail with a clear message
instead of silently doing nothing. Pi-hole needs no credentials: the agent runs
on the box and drives the `pihole` CLI, so `"pihole": {}` is enough to enable it.

Install:  sudo ./install.sh
"""

import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = "1.0.0"
CONFIG_PATH = os.environ.get("HOME_HUB_AGENT_CONFIG", "/etc/bestly/home-hub-agent.json")
CTX = ssl.create_default_context()


def log(msg):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def load_config():
    try:
        with open(CONFIG_PATH) as fh:
            cfg = json.load(fh)
    except FileNotFoundError:
        sys.exit(f"No config at {CONFIG_PATH}. See the docstring for the shape.")
    except json.JSONDecodeError as exc:
        sys.exit(f"Config at {CONFIG_PATH} is not valid JSON: {exc}")
    for key in ("supabase_url", "agent_key"):
        if not cfg.get(key):
            sys.exit(f"Config is missing required key: {key}")
    return cfg


def http(url, *, method="GET", data=None, headers=None, timeout=20):
    body = None
    hdrs = dict(headers or {})
    if data is not None:
        body = json.dumps(data).encode()
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
        raw = resp.read().decode() or "{}"
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}


# ── the control plane ────────────────────────────────────────────────────────

def call_edge(cfg, payload):
    url = cfg["supabase_url"].rstrip("/") + "/functions/v1/home-hub-agent"
    return http(url, method="POST", data=payload, headers={"x-api-key": cfg["agent_key"]})


# ── local executors ──────────────────────────────────────────────────────────

ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")


def _run(cmd, timeout=600):
    """Run a local command, returning its output. Raises on non-zero exit."""
    proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    # The pihole CLI writes ANSI colour and erase-line codes even when not on a
    # tty; they would show up as mojibake in the admin's result panel.
    out = ANSI.sub("", proc.stdout + proc.stderr).strip()
    if proc.returncode != 0:
        raise RuntimeError(f"`{cmd}` exited {proc.returncode}: {out[-400:]}")
    return out


def do_pihole(cfg, action, payload):
    """
    Pi-hole v6 gates every write behind an authenticated session, so the agent
    drives the CLI instead of the HTTP API — it already runs on the box, and this
    keeps the web password out of the agent config entirely.
    """
    sudo = "sudo -n " if os.geteuid() != 0 else ""
    if action == "enable":
        return {"output": _run(f"{sudo}pihole enable", timeout=60)}
    if action == "disable":
        secs = int(payload.get("seconds", 0) or 0)
        arg = f" {secs}s" if secs else ""
        return {"output": _run(f"{sudo}pihole disable{arg}", timeout=60)}
    if action == "update_gravity":
        out = _run(f"{sudo}pihole -g", timeout=900)
        return {"output": out[-1500:]}
    raise RuntimeError(f"Unknown pihole action: {action}")


def do_homeassistant(cfg, action, payload):
    ha = cfg.get("homeassistant")
    if not ha:
        raise RuntimeError("No 'homeassistant' section in the agent config on this machine.")
    if action != "toggle_automation":
        raise RuntimeError(f"Unknown homeassistant action: {action}")
    entity = payload.get("automation_id")
    if not entity:
        raise RuntimeError("toggle_automation requires 'automation_id'")
    service = "turn_on" if payload.get("enabled") else "turn_off"
    return {
        "result": http(
            f"{ha['base'].rstrip('/')}/api/services/automation/{service}",
            method="POST",
            data={"entity_id": entity},
            headers={"Authorization": f"Bearer {ha['token']}"},
        )
    }


def do_homebridge(cfg, action, payload):
    hb = cfg.get("homebridge")
    if not hb:
        raise RuntimeError("No 'homebridge' section in the agent config on this machine.")
    if action != "restart":
        raise RuntimeError(f"Unknown homebridge action: {action}")
    base = hb["base"].rstrip("/")
    auth = http(
        f"{base}/api/auth/login",
        method="POST",
        data={"username": hb["user"], "password": hb["password"]},
    )
    tok = auth.get("access_token")
    if not tok:
        raise RuntimeError("Homebridge login did not return an access_token")
    return {"result": http(f"{base}/api/server/restart", method="PUT",
                           headers={"Authorization": f"Bearer {tok}"})}


EXECUTORS = {"pihole": do_pihole, "homeassistant": do_homeassistant, "homebridge": do_homebridge}


def run_command(cfg, cmd):
    fn = EXECUTORS.get(cmd["target"])
    if not fn:
        raise RuntimeError(f"Unknown target: {cmd['target']}")
    return fn(cfg, cmd["action"], cmd.get("payload") or {})


def main():
    cfg = load_config()
    agent = cfg.get("agent_name", "home-hub")
    period = int(cfg.get("poll_seconds", 15))
    log(f"Bestly Home Hub agent {VERSION} starting as '{agent}', polling every {period}s")

    while True:
        try:
            resp = call_edge(cfg, {
                "op": "poll", "agent": agent, "max": 5, "version": VERSION,
                "info": {"host": os.uname().nodename},
            })
            for cmd in resp.get("commands", []):
                label = f"{cmd['target']}.{cmd['action']}"
                log(f"running {label} ({cmd['id']})")
                try:
                    result = run_command(cfg, cmd)
                    call_edge(cfg, {"op": "result", "agent": agent,
                                    "id": cmd["id"], "status": "done", "result": result})
                    log(f"  done {label}")
                except Exception as exc:  # report, never crash the loop
                    call_edge(cfg, {"op": "result", "agent": agent,
                                    "id": cmd["id"], "status": "failed", "error": str(exc)})
                    log(f"  FAILED {label}: {exc}")
        except urllib.error.HTTPError as exc:
            log(f"poll HTTP {exc.code}: {exc.read().decode()[:200]}")
        except Exception as exc:
            log(f"poll error: {exc}")
        time.sleep(period)


if __name__ == "__main__":
    main()
