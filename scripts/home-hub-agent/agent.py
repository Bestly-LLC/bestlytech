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
  "homebridge":    {"base": "http://127.0.0.1:8581",  "user": "admin", "password": "<pw>"},
  "manage":        {"heal": true, "updates": true}
}

Any section you omit simply makes those commands fail with a clear message
instead of silently doing nothing. Pi-hole needs no credentials: the agent runs
on the box and drives the `pihole` CLI, so `"pihole": {}` is enough to enable it.
"manage" is optional; DEFAULT_MANAGE below lists every knob and its default.

Since 1.1.0 the agent also:
  * pushes read-only snapshots (op "snapshot"): Home Assistant and Homebridge every
    minute, the host itself (IPs, gateway, Tailscale, containers, disk) every 5 minutes.
  * backs up its own HA token and Homebridge login into Supabase Vault (op
    "backup_secrets") whenever the config file changes. Write-only.
  * can update itself (command agent.update).

Since 1.2.0 the agent runs the Pi by itself (docs/home-hub-agent.md, "Self-managing"):
  * Health loop, every minute: Home Assistant, Homebridge, Pi-hole DNS, Docker, Tailscale,
    the SSD mount, disk space, power/heat, memory, failed systemd units. Something that is
    down gets restarted (twice at most); if that doesn't fix it, it becomes an issue.
  * Nightly maintenance, 3-5 AM: agent self-update, Home Assistant core + HACS, Homebridge
    core + plugins + image, Pi-hole, cleanup; OS packages (and a reboot when the kernel
    changed) on Sundays. Every container change is backed up first and rolled back
    automatically when the service does not come back.
  * Issues and events go to the server (op "event"). The database decides what pushes
    to ntfy: problems it could not fix, failed updates, and the all-clear afterwards.
  * A self-update that will not start is rolled back by launch.sh.

Install:  sudo bash install.sh
"""

import datetime
import hashlib
import json
import os
import random
import re
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = "1.2.0"
CONFIG_PATH = os.environ.get("HOME_HUB_AGENT_CONFIG", "/etc/bestly/home-hub-agent.json")
STATE_DIR = os.environ.get("HOME_HUB_AGENT_STATE", "/var/lib/bestly-home-hub")
STATE_PATH = os.path.join(STATE_DIR, "state.json")
UPDATE_PENDING = os.path.join(STATE_DIR, "update-pending")   # written before a self-update restart
ROLLED_BACK = os.path.join(STATE_DIR, "rolled-back")         # written by launch.sh after a rollback
BACKUP_DIR = "/mnt/ssd/backups/home-hub"
HA_DIR = "/mnt/ssd/apps/homeassistant"
HB_DIR = "/mnt/ssd/apps/homebridge"
SCRIPTS_DIR = "/home/pi/scripts"
CTX = ssl.create_default_context()

DEFAULT_MANAGE = {
    "heal": True,                    # restart things that are down
    "updates": True,                 # nightly maintenance
    "window_start_hour": 3,          # local time
    "window_end_hour": 5,
    "os_update_weekday": 6,          # Sunday (Monday is 0)
    "reboot": True,                  # reboot after OS updates when the kernel changed
    "ha_min_release_age_days": 3,    # let a Home Assistant release settle before taking it
    "backup_keep_days": 14,
    "ignore": [],                    # health checks / services to leave alone, e.g. ["homebridge"]
}


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


def manage_cfg(cfg):
    m = dict(DEFAULT_MANAGE)
    m.update(cfg.get("manage") or {})
    return m


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


def ver(v):
    return tuple(int(x) for x in re.findall(r"\d+", str(v))[:3])


# ── the control plane ────────────────────────────────────────────────────────

def call_edge(cfg, payload):
    url = cfg["supabase_url"].rstrip("/") + "/functions/v1/home-hub-agent"
    return http(url, method="POST", data=payload, headers={"x-api-key": cfg["agent_key"]})


# ── persistent state ─────────────────────────────────────────────────────────
# Heal counters, the event outbox, maintenance progress and skip lists survive restarts,
# self-updates and reboots.

STATE = {}
STATE_LOCK = threading.RLock()


def load_state():
    global STATE
    try:
        with open(STATE_PATH) as fh:
            STATE = json.load(fh)
    except (OSError, json.JSONDecodeError):
        STATE = {}


def save_state():
    with STATE_LOCK:
        try:
            os.makedirs(STATE_DIR, exist_ok=True)
            tmp = STATE_PATH + ".tmp"
            with open(tmp, "w") as fh:
                json.dump(STATE, fh, indent=1, default=str)
            os.replace(tmp, STATE_PATH)
        except Exception as exc:
            log(f"state not saved: {exc}")


# ── events → issues → ntfy ───────────────────────────────────────────────────
# kind: problem (opens/updates an issue), resolved (closes it), info (a record).
# push: ask the server to notify. The server still dedupes and holds non-urgent pushes
# until morning, so the agent can say what it means without worrying about spam.

FLUSH_LOCK = threading.Lock()


def emit(cfg, key, kind, severity, title, body=None, push=False):
    ev = {"key": key, "kind": kind, "severity": severity, "title": str(title)[:200],
          "body": (str(body) if body else "")[:2000], "push": bool(push),
          "occurred_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    log(f"event {kind}/{severity} {key}: {ev['title']}" + (" [push]" if push else ""))
    with STATE_LOCK:
        box = STATE.setdefault("outbox", [])
        box.append(ev)
        del box[:-200]
    save_state()
    flush_events(cfg)


def flush_events(cfg):
    if not FLUSH_LOCK.acquire(blocking=False):
        return
    sent = 0
    try:
        while True:
            with STATE_LOCK:
                box = STATE.setdefault("outbox", [])
                if not box:
                    break
                ev = box[0]
            try:
                call_edge(cfg, {"op": "event", "agent": cfg.get("agent_name", "home-hub"), **ev})
            except urllib.error.HTTPError as exc:
                if exc.code not in (400, 413, 422):
                    break
                log(f"event {ev.get('key')} refused by the server (HTTP {exc.code}); dropping it")
            except Exception:
                break
            with STATE_LOCK:
                if box and box[0] is ev:
                    box.pop(0)
            sent += 1
    finally:
        FLUSH_LOCK.release()
    if sent:
        save_state()


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


def sh(cmd, timeout=600, env=None):
    """Run a command (str → shell, list → exec). Returns (returncode, stdout+stderr). Never raises."""
    try:
        proc = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True,
                              timeout=timeout, stdin=subprocess.DEVNULL, env=env)
        return proc.returncode, ANSI.sub("", (proc.stdout or "") + (proc.stderr or "")).strip()
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    except Exception as exc:
        return 1, str(exc)


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
    if action == "refresh":
        ok, err, _ = push_snapshot(cfg, "homeassistant")
        if not ok:
            raise RuntimeError(err or "Home Assistant snapshot failed")
        return {"message": "Home Assistant snapshot refreshed."}
    if action != "toggle_automation":
        raise RuntimeError(f"Unknown homeassistant action: {action}")
    entity = payload.get("automation_id")
    if not entity:
        raise RuntimeError("toggle_automation requires 'automation_id'")
    service = "turn_on" if payload.get("enabled") else "turn_off"
    http(
        f"{ha['base'].rstrip('/')}/api/services/automation/{service}",
        method="POST",
        data={"entity_id": entity},
        headers={"Authorization": f"Bearer {ha['token']}"},
    )
    push_snapshot(cfg, "homeassistant")
    return {"message": f"{entity} turned {'on' if payload.get('enabled') else 'off'}."}


def _homebridge_token(hb):
    auth = http(
        f"{hb['base'].rstrip('/')}/api/auth/login",
        method="POST",
        data={"username": hb["user"], "password": hb["password"]},
    )
    tok = auth.get("access_token")
    if not tok:
        raise RuntimeError("Homebridge login did not return an access_token")
    return tok


def do_homebridge(cfg, action, payload):
    hb = cfg.get("homebridge")
    if not hb:
        raise RuntimeError("No 'homebridge' section in the agent config on this machine.")
    if action == "refresh":
        ok, err, _ = push_snapshot(cfg, "homebridge")
        if not ok:
            raise RuntimeError(err or "Homebridge snapshot failed")
        return {"message": "Homebridge snapshot refreshed."}
    if action != "restart":
        raise RuntimeError(f"Unknown homebridge action: {action}")
    tok = _homebridge_token(hb)
    http(f"{hb['base'].rstrip('/')}/api/server/restart", method="PUT",
         headers={"Authorization": f"Bearer {tok}"})
    return {"message": "Homebridge is restarting. It usually takes about a minute to come back."}


# ── read-only snapshots ──────────────────────────────────────────────────────

WATCH_DOMAINS = ("light", "switch", "climate", "lock", "cover", "fan", "media_player",
                 "camera", "person", "weather", "vacuum", "alarm_control_panel")


def _name(st):
    return (st.get("attributes") or {}).get("friendly_name") or st.get("entity_id")


def snapshot_homeassistant(cfg):
    ha = cfg.get("homeassistant")
    if not ha:
        return None
    base = ha["base"].rstrip("/")
    hdrs = {"Authorization": f"Bearer {ha['token']}"}
    conf = http(f"{base}/api/config", headers=hdrs, timeout=10)
    states = http(f"{base}/api/states", headers=hdrs, timeout=20)
    if not isinstance(states, list):
        states = []

    domains = {}
    automations, devices, unavailable, updates, batteries = [], [], [], [], []
    for st in states:
        eid = st.get("entity_id", "")
        dom = eid.split(".", 1)[0]
        domains[dom] = domains.get(dom, 0) + 1
        attrs = st.get("attributes") or {}
        state = st.get("state")
        if state in ("unavailable", "unknown") and dom not in ("automation", "script", "scene", "update", "button", "event"):
            unavailable.append({"entity_id": eid, "name": _name(st)})
        if dom == "automation":
            automations.append({"entity_id": eid, "name": _name(st), "on": state == "on",
                                "last_triggered": attrs.get("last_triggered")})
        elif dom in WATCH_DOMAINS:
            devices.append({"entity_id": eid, "name": _name(st), "state": state, "domain": dom,
                            "last_changed": st.get("last_changed"),
                            "temp": attrs.get("current_temperature"), "unit": attrs.get("unit_of_measurement")})
        elif dom == "update" and state == "on":
            updates.append({"entity_id": eid, "name": _name(st),
                            "installed": attrs.get("installed_version"), "latest": attrs.get("latest_version")})
        elif dom == "sensor" and attrs.get("device_class") == "battery":
            batteries.append({"entity_id": eid, "name": _name(st), "state": state})

    automations.sort(key=lambda a: (a["name"] or "").lower())
    devices.sort(key=lambda d: (d["domain"], (d["name"] or "").lower()))
    return {
        "version": conf.get("version"),
        "location_name": conf.get("location_name"),
        "time_zone": conf.get("time_zone"),
        "state": conf.get("state"),
        "safe_mode": conf.get("safe_mode"),
        "integrations": len(conf.get("components") or []),
        "entity_count": len(states),
        "domains": dict(sorted(domains.items(), key=lambda kv: -kv[1])),
        "automations": automations[:150],
        "devices": devices[:200],
        "unavailable": unavailable[:60],
        "unavailable_count": len(unavailable),
        "updates": updates[:30],
        "batteries": batteries[:60],
    }


def snapshot_homebridge(cfg):
    hb = cfg.get("homebridge")
    if not hb:
        return None
    base = hb["base"].rstrip("/")
    tok = _homebridge_token(hb)
    hdrs = {"Authorization": f"Bearer {tok}"}
    out, errors = {}, {}

    def grab(key, path):
        try:
            out[key] = http(f"{base}{path}", headers=hdrs, timeout=10)
        except Exception as exc:  # one endpoint failing should not sink the snapshot
            errors[key] = str(exc)[:200]

    grab("status", "/api/status/homebridge")
    grab("version", "/api/status/homebridge-version")
    grab("ui_version", "/api/status/homebridge-ui-version")
    grab("child_bridges", "/api/status/homebridge/child-bridges")
    grab("plugins", "/api/plugins")
    grab("accessories", "/api/accessories")

    plugins = out.get("plugins") if isinstance(out.get("plugins"), list) else []
    accessories = out.get("accessories") if isinstance(out.get("accessories"), list) else []
    children = out.get("child_bridges") if isinstance(out.get("child_bridges"), list) else []
    ver_ = out.get("version") if isinstance(out.get("version"), dict) else {}
    ui = out.get("ui_version") if isinstance(out.get("ui_version"), dict) else {}
    return {
        "status": (out.get("status") or {}).get("status") if isinstance(out.get("status"), dict) else None,
        "installed_version": ver_.get("installedVersion"),
        "latest_version": ver_.get("latestVersion"),
        "update_available": ver_.get("updateAvailable"),
        "ui_installed_version": ui.get("installedVersion"),
        "ui_update_available": ui.get("updateAvailable"),
        "plugins": [{"name": p.get("displayName") or p.get("name"), "package": p.get("name"),
                     "installed": p.get("installedVersion"), "latest": p.get("latestVersion"),
                     "update_available": p.get("updateAvailable"), "disabled": p.get("disabled")}
                    for p in plugins][:80],
        "child_bridges": [{"name": c.get("name"), "plugin": c.get("plugin"), "status": c.get("status"),
                           "paired": c.get("paired")} for c in children][:40],
        # /api/accessories only answers when Homebridge runs in insecure mode; None means "unknown", not zero.
        "accessory_count": None if "accessories" in errors else len(accessories),
        "accessories": [{"name": a.get("serviceName") or (a.get("accessoryInformation") or {}).get("Name"),
                         "type": a.get("humanType") or a.get("type")} for a in accessories][:200],
        "errors": errors,
    }


def _sh(cmd, timeout=15):
    try:
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return proc.stdout.strip() if proc.returncode == 0 else ""
    except Exception:
        return ""


def _private_lan_ip():
    for ip in _sh("hostname -I").split():
        if ":" in ip:
            continue
        if ip.startswith("192.168.") or ip.startswith("10."):
            return ip
        parts = ip.split(".")
        if ip.startswith("172.") and len(parts) > 1 and parts[1].isdigit() and not 16 <= int(parts[1]) <= 31:
            return ip
    # fall back to the address used for the default route
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("1.1.1.1", 53))
            ip = sock.getsockname()[0]
            return ip if ip.startswith(("192.168.", "10.")) else None
    except Exception:
        return None


def _meminfo():
    mem = {}
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                k, v = line.split(":", 1)
                if k in ("MemTotal", "MemAvailable"):
                    mem[k] = int(v.strip().split()[0]) // 1024
    except Exception:
        pass
    return mem


def _cpu_temp():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as fh:
            return round(int(fh.read().strip()) / 1000, 1)
    except Exception:
        return None


def _uptime():
    try:
        with open("/proc/uptime") as fh:
            return int(float(fh.read().split()[0]))
    except Exception:
        return None


def snapshot_host(cfg):
    route = _sh("ip route show default")
    m = re.search(r"default via (\S+) dev (\S+)", route)
    ts_status = {}
    raw = _sh("tailscale status --json --self=true --peers=false")
    if raw:
        try:
            me = json.loads(raw).get("Self") or {}
            ts_status = {"dns_name": (me.get("DNSName") or "").rstrip("."), "online": me.get("Online")}
        except json.JSONDecodeError:
            pass
    containers = []
    for line in _sh("docker ps -a --format '{{json .}}'", timeout=20).splitlines():
        try:
            c = json.loads(line)
            containers.append({"name": c.get("Names"), "image": c.get("Image"), "state": c.get("State"),
                               "status": c.get("Status"), "ports": c.get("Ports")})
        except json.JSONDecodeError:
            continue
    disks = []
    for mount in ("/", "/mnt/ssd"):
        try:
            if os.path.ismount(mount) or mount == "/":
                du = shutil.disk_usage(mount)
                disks.append({"mount": mount, "total_gb": round(du.total / 1e9, 1), "used_gb": round(du.used / 1e9, 1)})
        except Exception:
            pass
    os_name = None
    try:
        with open("/etc/os-release") as fh:
            for line in fh:
                if line.startswith("PRETTY_NAME="):
                    os_name = line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    return {
        "hostname": socket.gethostname(),
        "lan_ip": _private_lan_ip(),
        "gateway": m.group(1) if m else None,
        "interface": m.group(2) if m else None,
        "tailscale_ip": (_sh("tailscale ip -4").splitlines() or [None])[0],
        "tailscale": ts_status,
        "os": os_name,
        "kernel": os.uname().release,
        "arch": os.uname().machine,
        "python": sys.version.split()[0],
        "uptime_seconds": _uptime(),
        "load": list(os.getloadavg()),
        "memory_mb": _meminfo(),
        "cpu_temp_c": _cpu_temp(),
        "disks": disks,
        "containers": containers[:60],
        "listening": sorted({int(p) for p in re.findall(r":(\d+)\s", _sh("ss -ltnH")) if int(p) < 20000})[:80],
        "agent_version": VERSION,
    }


SNAPSHOTS = {"homeassistant": snapshot_homeassistant, "homebridge": snapshot_homebridge, "host": snapshot_host}
LAST_SNAP = {}   # source -> (ok, error, time)


def push_snapshot(cfg, source):
    """Take one snapshot and send it. Returns (ok, error, data). Skips sources not configured."""
    try:
        data = SNAPSHOTS[source](cfg)
        if data is None:
            return True, None, None
        ok, err = True, None
    except urllib.error.HTTPError as exc:
        data, ok, err = {}, False, f"HTTP {exc.code} from {source}"
    except Exception as exc:
        data, ok, err = {}, False, str(exc)[:500]
    LAST_SNAP[source] = (ok, err, time.time())
    try:
        call_edge(cfg, {"op": "snapshot", "agent": cfg.get("agent_name", "home-hub"),
                        "source": source, "ok": ok, "error": err, "data": data})
    except Exception as exc:
        log(f"snapshot {source} not delivered: {exc}")
    return ok, err, data


# ── secret backup ────────────────────────────────────────────────────────────

def backup_secrets(cfg):
    """Mirror the credentials this agent holds into Supabase Vault. Write-only."""
    secrets = {}
    ha = cfg.get("homeassistant") or {}
    hb = cfg.get("homebridge") or {}
    if ha.get("token"):
        secrets["home_hub_ha_token"] = ha["token"]
    if hb.get("password"):
        secrets["home_hub_homebridge_password"] = hb["password"]
    if hb.get("user"):
        secrets["home_hub_homebridge_user"] = hb["user"]
    if not secrets:
        return
    resp = call_edge(cfg, {"op": "backup_secrets", "agent": cfg.get("agent_name", "home-hub"), "secrets": secrets})
    log(f"secret backup: {', '.join(resp.get('stored', [])) or resp}")


# ── probes ───────────────────────────────────────────────────────────────────

def dns_answers(server="127.0.0.1", name="pi.hole", timeout=3):
    """Send one raw DNS query. Any real answer (even NXDOMAIN) means the resolver is up."""
    tid = random.randint(0, 0xFFFF)
    query = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    query += b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\x00" + struct.pack(">HH", 1, 1)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(timeout)
        s.sendto(query, (server, 53))
        data, _ = s.recvfrom(2048)
    rtid, flags = struct.unpack(">HH", data[:4])
    return rtid == tid and bool(flags & 0x8000) and (flags & 0xF) in (0, 3)


def pihole_ok():
    rc, _ = sh(["systemctl", "is-active", "--quiet", "pihole-FTL"], timeout=15)
    if rc != 0:
        return False, "The pihole-FTL service is not running, so DNS on the Pi is down."
    try:
        if dns_answers():
            return True, "DNS answering"
        return False, "Pi-hole answered DNS with an error."
    except Exception as exc:
        return False, f"Pi-hole is running but DNS on 127.0.0.1:53 is not answering ({exc})."


def internet_up():
    # Hostnames, not 1.1.1.1/8.8.8.8: from the Pi, TCP to those is refused (verified 2026-09-16).
    for host in (("ntfy.sh", 443), ("api.github.com", 443), ("www.cloudflare.com", 443)):
        try:
            with socket.create_connection(host, timeout=4):
                return True
        except OSError:
            continue
    return False


def ha_ready(cfg):
    ha = cfg["homeassistant"]
    conf = http(f"{ha['base'].rstrip('/')}/api/config", headers={"Authorization": f"Bearer {ha['token']}"}, timeout=15)
    return conf.get("state") == "RUNNING"


def hb_ready(cfg):
    hb = cfg["homebridge"]
    tok = _homebridge_token(hb)
    st = http(f"{hb['base'].rstrip('/')}/api/status/homebridge", headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    return isinstance(st, dict) and st.get("status") in ("up", "ok")


def light_probe(url, timeout=30, headers=None):
    """True if the service answers HTTP at all (auth errors count as alive)."""
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout, context=CTX):
            return True
    except urllib.error.HTTPError as exc:
        return exc.code < 500
    except Exception:
        return False


def wait_until(check, timeout, interval=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if check():
                return True
        except Exception:
            pass
        time.sleep(interval)
    return False


# ── docker ───────────────────────────────────────────────────────────────────

def docker_json(*args, timeout=30):
    rc, out = sh(["docker", *args], timeout=timeout)
    if rc != 0:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def container(name):
    data = docker_json("inspect", "--type", "container", name)
    return data[0] if isinstance(data, list) and data else None


def container_uptime(info):
    started = ((info or {}).get("State") or {}).get("StartedAt") or ""
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)", started)
    if not m or started.startswith("0001"):
        return None
    dt = datetime.datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)
    return (datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds()


def run_args(info):
    """`docker run` arguments that recreate this container on another image.

    Env vars that came from the old image are dropped, so the new image's own
    defaults win; only what was set on the container itself carries over.
    Returns (args before the image, args after the image).
    """
    hc, cc = info.get("HostConfig") or {}, info.get("Config") or {}
    img = docker_json("image", "inspect", info["Image"]) or [{}]
    icfg = img[0].get("Config") or {}
    image_env = set(icfg.get("Env") or [])
    args = ["--name", info["Name"].lstrip("/")]
    rp = hc.get("RestartPolicy") or {}
    if rp.get("Name") and rp["Name"] != "no":
        extra = f":{rp['MaximumRetryCount']}" if rp["Name"] == "on-failure" and rp.get("MaximumRetryCount") else ""
        args += ["--restart", rp["Name"] + extra]
    if hc.get("Privileged"):
        args.append("--privileged")
    net = hc.get("NetworkMode") or "default"
    if net not in ("default", "bridge"):
        args += ["--network", net]
    if net != "host":
        for cport, binds in (hc.get("PortBindings") or {}).items():
            for b in binds or []:
                host = (b["HostIp"] + ":") if b.get("HostIp") else ""
                args += ["-p", f"{host}{b.get('HostPort')}:{cport}"]
    binds = hc.get("Binds") or []
    for b in binds:
        args += ["-v", b]
    bound = {b.split(":")[1] for b in binds if b.count(":") >= 1}
    for m in info.get("Mounts") or []:
        if m.get("Type") == "volume" and m.get("Destination") not in bound:
            args += ["-v", f"{m['Name']}:{m['Destination']}" + ("" if m.get("RW", True) else ":ro")]
    for d in hc.get("Devices") or []:
        args += ["--device", f"{d['PathOnHost']}:{d['PathInContainer']}:{d.get('CgroupPermissions') or 'rwm'}"]
    for c in hc.get("CapAdd") or []:
        args += ["--cap-add", c]
    for c in hc.get("CapDrop") or []:
        args += ["--cap-drop", c]
    for h in hc.get("ExtraHosts") or []:
        args += ["--add-host", h]
    for e in cc.get("Env") or []:
        if e not in image_env:
            args += ["-e", e]
    lc = hc.get("LogConfig") or {}
    if lc.get("Type") and lc["Type"] != "json-file":
        args += ["--log-driver", lc["Type"]]
    for k, v in (lc.get("Config") or {}).items():
        args += ["--log-opt", f"{k}={v}"]
    if cc.get("Entrypoint") and cc.get("Entrypoint") != icfg.get("Entrypoint"):
        args += ["--entrypoint", cc["Entrypoint"][0]]
    tail = cc["Cmd"] if cc.get("Cmd") and cc.get("Cmd") != icfg.get("Cmd") else []
    return args, tail


def stamp():
    return time.strftime("%Y%m%d-%H%M%S")


def backup_dir(src, label, excludes=()):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dest = os.path.join(BACKUP_DIR, f"{label}-{stamp()}.tar.gz")
    cmd = ["tar", "czf", dest]
    cmd += [f"--exclude={e}" for e in excludes]
    cmd += ["-C", os.path.dirname(src), os.path.basename(src)]
    rc, out = sh(cmd, 3600)
    if rc not in (0, 1):   # 1 = "file changed as we read it", fine for a live directory
        try:
            os.remove(dest)
        except OSError:
            pass
        raise RuntimeError(f"backup of {src} failed: {out[-300:]}")
    return dest


def restore_dir(src, archive):
    """Put a directory back from a backup. The broken one is kept next to it as <dir>.failed-<stamp>."""
    if os.path.exists(src):
        os.rename(src, f"{src}.failed-{stamp()}")
    rc, out = sh(["tar", "xzf", archive, "-C", os.path.dirname(src)], 3600)
    if rc != 0:
        raise RuntimeError(f"restore of {src} from {archive} failed: {out[-300:]}")


def replace_container(cfg, name, new_ref, data_dir, ready, ready_timeout):
    """Move a container to new_ref: pull, stop, back up its data, recreate, verify.
    If it does not come back healthy, restore the data and the old image.

    Returns (status, detail, image_id) with status one of
    current | skipped | updated | rolled_back | broken.
    """
    info = container(name)
    if not info:
        return "skipped", f"no {name} container", None
    old_id = info["Image"]
    old_ref = (info.get("Config") or {}).get("Image") or ""
    rc, out = sh(["docker", "pull", new_ref], 3600)
    if rc != 0:
        raise RuntimeError(f"docker pull {new_ref} failed: {out[-300:]}")
    new = docker_json("image", "inspect", new_ref) or [{}]
    new_id = new[0].get("Id")
    if not new_id or new_id == old_id:
        return "current", "", new_id
    if new_id in STATE.get("bad_images", {}).get(name, []):
        return "skipped", "this image already failed once", new_id
    args, tail = run_args(info)
    rollback_ref = f"bestly-rollback/{name}:{stamp()}"
    sh(["docker", "tag", old_id, rollback_ref], 60)
    SUSPENDED.add(name)
    try:
        sh(["docker", "stop", "-t", "60", name], 180)
        try:
            archive = backup_dir(data_dir, name)
        except Exception:
            sh(["docker", "start", name], 120)
            raise
        sh(["docker", "rm", name], 60)
        rc, out = sh(["docker", "run", "-d", *args, new_ref, *tail], 600)
        if rc == 0 and wait_until(lambda: ready(cfg), ready_timeout, 15):
            if old_ref and old_ref != new_ref and not old_ref.startswith(("sha256:", "bestly-rollback/")):
                sh(["docker", "rmi", old_ref], 120)   # only untags; the rollback tag keeps the image
            return "updated", "", new_id
        _, logs = sh(["docker", "logs", "--tail", "25", name], 30)
        logs = (logs if rc == 0 else out)[-1500:]
        sh(["docker", "rm", "-f", name], 120)
        restore_dir(data_dir, archive)
        rc2, out2 = sh(["docker", "run", "-d", *args, rollback_ref, *tail], 600)
        with STATE_LOCK:
            STATE.setdefault("bad_images", {}).setdefault(name, []).append(new_id)
        if rc2 == 0 and wait_until(lambda: ready(cfg), ready_timeout, 15):
            return "rolled_back", logs, new_id
        return "broken", f"{logs}\nRollback start: {out2[-300:]}", new_id
    finally:
        SUSPENDED.discard(name)


# ── health loop ──────────────────────────────────────────────────────────────

SUSPENDED = set()     # services maintenance is working on; health leaves them alone
HEALTH_LAST = {}      # latest result per check, sent as the "health" snapshot


def evaluate(cfg, name, label, ok, detail, heal=None, threshold=2, heal_wait=180, max_heals=2,
             severity="error", push=True):
    """One check result → counters, automatic fixes, and issues.

    Down for `threshold` checks in a row → run `heal` (at most `max_heals` times,
    `heal_wait` seconds apart). Still down after that → open an issue that pushes.
    Coming back → close it. Three fixes in 24 hours → a separate "keeps failing" issue.
    """
    m = manage_cfg(cfg)
    now = time.time()
    with STATE_LOCK:
        h = STATE.setdefault("health", {}).setdefault(
            name, {"fails": 0, "attempts": 0, "last_heal": 0, "heals": [], "open": False})
    h["heals"] = [t for t in h.get("heals", []) if now - t < 86400]
    try:
        _evaluate(cfg, m, now, h, name, label, ok, detail, heal, threshold, heal_wait, max_heals, severity, push)
    finally:
        HEALTH_LAST[name] = {"label": label, "ok": bool(ok), "detail": None if ok else detail,
                             "fails": h["fails"], "open": h["open"], "attempts": h["attempts"],
                             "suspended": name in SUSPENDED, "ignored": name in m["ignore"]}


def _evaluate(cfg, m, now, h, name, label, ok, detail, heal, threshold, heal_wait, max_heals, severity, push):
    if name in m["ignore"]:
        return
    if h.get("flap_open") and not h["heals"]:
        h["flap_open"] = False
        emit(cfg, f"{name}.flapping", "resolved", "success", f"{label} is stable again",
             "No automatic restarts in the last 24 hours.")
    if ok:
        if h.get("open"):
            mins = (now - (h.get("since") or now)) / 60
            emit(cfg, name, "resolved", "success", f"{label} is OK again",
                 f"Back after {mins:.0f} min." + (" An automatic restart fixed it." if h.get("attempts") else ""))
        elif h.get("fails") and h.get("attempts"):
            log(f"health {name}: fixed by automatic restart")
        h.update(fails=0, since=None, attempts=0, open=False, detail=None)
        return
    if name in SUSPENDED:
        h["fails"] = 0
        return
    h["fails"] += 1
    h["since"] = h.get("since") or now
    h["detail"] = detail
    if h["fails"] < threshold:
        return
    since_heal = now - (h.get("last_heal") or 0)
    can_heal = bool(heal) and m["heal"]
    if can_heal and not h["open"] and h["attempts"] < max_heals:
        if since_heal < heal_wait:
            return
        h["attempts"] += 1
        h["last_heal"] = now
        h["heals"].append(now)
        try:
            result = heal()
        except Exception as exc:
            result = f"failed: {exc}"
        log(f"health {name}: automatic fix #{h['attempts']}: {result}")
        emit(cfg, f"{name}.autofix", "info", "info", f"{label}: automatic fix #{h['attempts']}", f"{detail}\n→ {result}")
        if len(h["heals"]) >= 3 and not h.get("flap_open"):
            h["flap_open"] = True
            emit(cfg, f"{name}.flapping", "problem", "warning", f"{label} keeps failing",
                 f"It was restarted automatically {len(h['heals'])} times in 24 hours, so something "
                 f"underneath is wrong.\nLatest: {detail}", push=True)
        return
    if not h["open"]:
        if can_heal and since_heal < heal_wait:
            return   # give the last fix time to work
        h["open"] = True
        h["last_emit"] = now
        tried = f"\nTried {h['attempts']} automatic restart(s); it is still failing." if h["attempts"] else ""
        emit(cfg, name, "problem", severity, f"{label} needs you", f"{detail}{tried}", push=push)
        return
    if now - h.get("last_emit", 0) >= 6 * 3600:   # still broken: remind (the server decides whether to push)
        h["last_emit"] = now
        mins = (now - (h.get("since") or now)) / 60
        emit(cfg, name, "problem", severity, f"{label} still needs you", f"{detail}\nDown for {mins/60:.1f} h.", push=push)
    if can_heal and since_heal >= 3600:            # and quietly try again once an hour
        h["last_heal"] = now
        try:
            result = heal()
        except Exception as exc:
            result = f"failed: {exc}"
        log(f"health {name}: hourly retry: {result}")


def heal_container(name):
    def fix():
        if not container(name):
            return f"the {name} container does not exist, so there is nothing to restart"
        rc, out = sh(["docker", "restart", "-t", "30", name], timeout=180)
        return "restarted the container" if rc == 0 else f"docker restart failed: {out[-200:]}"
    return fix


def heal_unit(unit):
    def fix():
        sh(["systemctl", "reset-failed", unit], timeout=30)
        rc, out = sh(["systemctl", "restart", unit], timeout=180)
        return f"restarted {unit}" if rc == 0 else f"systemctl restart {unit} failed: {out[-200:]}"
    return fix


def run_health(cfg):
    online = internet_up()

    docker_ok = sh(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=45)[0] == 0
    evaluate(cfg, "docker", "Docker", docker_ok,
             "Docker is not responding, so Home Assistant, Homebridge and Nextcloud are down.",
             heal=heal_unit("docker"), max_heals=1, heal_wait=300)

    services = (("homeassistant", "Home Assistant", HA_DIR, "/api/"),
                ("homebridge", "Homebridge", HB_DIR, "/"))
    for name, label, _, probe_path in services:
        if not cfg.get(name) or not docker_ok:
            continue
        info = container(name)
        if info is None:
            evaluate(cfg, name, label, False, f"The {name} container is missing. It has to be recreated by hand.")
            continue
        st = info.get("State") or {}
        running = st.get("Running") and not st.get("Restarting")
        up = container_uptime(info) or 0
        if running and up < 240:   # still booting; don't judge it yet
            HEALTH_LAST[name] = dict(HEALTH_LAST.get(name) or {"label": label}, ok=True, detail=None,
                                     booting=True, suspended=name in SUSPENDED)
            continue
        ok, err, _ = LAST_SNAP.get(name, (True, None, 0))
        if not running:
            ok, err = False, f"The container is {st.get('Status')} (exit code {st.get('ExitCode')})."
        elif not ok and err and re.search(r"HTTP 40[13]", err):
            evaluate(cfg, name, label, False,
                     f"{label} is running but rejects the agent's login ({err}). The token or password in "
                     f"/etc/bestly/home-hub-agent.json on the Pi needs updating.", severity="warning")
            continue
        elif not ok:
            # The snapshot reads a lot; make sure it is really down and not just slow.
            base = cfg[name]["base"].rstrip("/")
            hdrs = {"Authorization": f"Bearer {cfg[name]['token']}"} if name == "homeassistant" else {}
            if light_probe(base + probe_path, headers=hdrs):
                ok = True
        evaluate(cfg, name, label, ok, err or f"{label} is not responding.", heal=heal_container(name), threshold=3)

    if shutil.which("pihole"):
        ok, detail = pihole_ok()
        evaluate(cfg, "pihole", "Pi-hole", ok, detail, heal=heal_unit("pihole-FTL"))

    if online and shutil.which("tailscale"):
        raw = _sh("tailscale status --json --self=true --peers=false", timeout=20)
        try:
            ts_online = bool((json.loads(raw).get("Self") or {}).get("Online")) if raw else False
        except json.JSONDecodeError:
            ts_online = False
        evaluate(cfg, "tailscale", "Tailscale", ts_online,
                 "Tailscale is offline, so remote access to the Pi is down.",
                 heal=heal_unit("tailscaled"), threshold=3, severity="warning")

    if os.path.isdir("/mnt/ssd"):
        mounted = os.path.ismount("/mnt/ssd")
        evaluate(cfg, "ssd", "The SSD", mounted,
                 "/mnt/ssd is not mounted. Home Assistant, Homebridge, Nextcloud and the backups live there.",
                 heal=lambda: (sh(["mount", "-a"], 120)[1] or "ran mount -a"), max_heals=1, threshold=1)

    for mount, key in (("/", "disk.root"), ("/mnt/ssd", "disk.ssd")):
        if mount != "/" and not os.path.ismount(mount):
            continue
        du = shutil.disk_usage(mount)
        pct = du.used * 100 / du.total
        evaluate(cfg, key, f"Disk {mount}", pct < 90,
                 f"{mount} is {pct:.0f}% full ({du.free / 1e9:.1f} GB free).",
                 heal=lambda: cleanup(cfg), max_heals=1, heal_wait=600, threshold=1, severity="warning")

    out = _sh("vcgencmd get_throttled", timeout=10)
    mt = re.search(r"0x([0-9a-fA-F]+)", out)
    if mt:
        bits, temp = int(mt.group(1), 16), _cpu_temp()
        problems = []
        if bits & 0x1:
            problems.append("under-voltage right now (check the power supply and cable)")
        if bits & 0x4:
            problems.append("the CPU is being throttled")
        if bits & 0x8:
            problems.append("the soft temperature limit is active")
        if temp and temp >= 80:
            problems.append(f"the CPU is at {temp} °C")
        evaluate(cfg, "power", "Pi power/heat", not problems, "; ".join(problems).capitalize() + ".",
                 threshold=5, severity="warning")

    mem = _meminfo()
    if mem.get("MemTotal"):
        avail_pct = mem.get("MemAvailable", 0) * 100 / mem["MemTotal"]
        evaluate(cfg, "memory", "Pi memory", avail_pct >= 5,
                 f"Only {mem.get('MemAvailable')} MB of {mem['MemTotal']} MB RAM is available.",
                 threshold=10, severity="warning")

    failed = [ln.split()[0] for ln in _sh("systemctl --failed --plain --no-legend --no-pager", 20).splitlines() if ln.strip()]
    failed = [u for u in failed if u.lstrip("●").strip()]

    def fix_units():
        return "; ".join(heal_unit(u.lstrip("●").strip())() for u in failed)

    evaluate(cfg, "systemd", "System services", not failed,
             "Failed: " + ", ".join(failed), heal=fix_units, max_heals=1, heal_wait=900, threshold=3,
             severity="warning")


# ── housekeeping ─────────────────────────────────────────────────────────────

def cleanup(cfg):
    """Free space without touching anything a rollback might still need. Returns a summary."""
    keep = manage_cfg(cfg)["backup_keep_days"]
    notes = []
    rc, out = sh(["docker", "image", "prune", "-f"], 900)
    mm = re.search(r"Total reclaimed space:\s*(\S+)", out)
    if mm and not mm.group(1).startswith("0"):
        notes.append(f"{mm.group(1)} of unused images")

    # rollback images: keep the newest per service, drop the rest once they are old
    rc, out = sh(["docker", "images", "--filter", "reference=bestly-rollback/*", "--format", "{{.Repository}} {{.Tag}}"], 60)
    by_repo = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2:
            by_repo.setdefault(parts[0], []).append(parts[1])
    cutoff = time.strftime("%Y%m%d", time.localtime(time.time() - keep * 86400))
    for repo, tags in by_repo.items():
        for tag in sorted(tags)[:-1]:
            if tag[:8] < cutoff and sh(["docker", "rmi", f"{repo}:{tag}"], 300)[0] == 0:
                notes.append(f"old rollback image {repo.split('/')[-1]}:{tag}")

    # backups: keep at least the newest 3 per label, and anything younger than `keep` days
    if os.path.isdir(BACKUP_DIR):
        groups = {}
        for f in os.listdir(BACKUP_DIR):
            mm = re.match(r"(.+)-(\d{8}-\d{6})\.tar\.gz$", f)
            if mm:
                groups.setdefault(mm.group(1), []).append(f)
        for files in groups.values():
            for f in sorted(files)[:-3]:
                p = os.path.join(BACKUP_DIR, f)
                if time.time() - os.path.getmtime(p) > keep * 86400:
                    os.remove(p)

    # directories set aside by a rollback
    for base in (HA_DIR, HB_DIR, os.path.join(HA_DIR, "custom_components")):
        parent = os.path.dirname(base)
        if not os.path.isdir(parent):
            continue
        for d in os.listdir(parent):
            if d.startswith(os.path.basename(base) + ".failed-"):
                p = os.path.join(parent, d)
                if time.time() - os.path.getmtime(p) > keep * 86400:
                    shutil.rmtree(p, ignore_errors=True)

    sh(["journalctl", "--vacuum-size=500M"], 300)

    # script logs that ran away anyway (pihole_push.log once reached 76 MB)
    if os.path.isdir(SCRIPTS_DIR):
        for f in os.listdir(SCRIPTS_DIR):
            p = os.path.join(SCRIPTS_DIR, f)
            try:
                size = os.path.getsize(p)
                if f.endswith(".log") and size > 200_000_000:
                    with open(p, "rb") as fh:
                        fh.seek(-5_000_000, 2)
                        tail = fh.read()
                    with open(p, "r+b") as fh:
                        fh.write(tail)
                        fh.truncate()
                    notes.append(f"trimmed {f} from {size / 1e6:.0f} MB")
            except OSError:
                pass
    return "Cleaned up " + ", ".join(notes) if notes else "nothing needed cleaning"


# ── nightly maintenance ──────────────────────────────────────────────────────

def step_agent(cfg, forced=False):
    rel = call_edge(cfg, {"op": "release_latest", "agent": cfg.get("agent_name", "home-hub")})
    v, sha = str(rel.get("version") or ""), str(rel.get("sha256") or "")
    if not v or ver(v) <= ver(VERSION) or v in STATE.get("bad_agent_versions", []):
        return None
    return do_agent(cfg, "update", {"version": v, "sha256": sha})["message"]


def step_homeassistant(cfg, forced=False):
    m = manage_cfg(cfg)
    if not cfg.get("homeassistant") or "homeassistant" in m["ignore"]:
        return None
    info = container("homeassistant")
    if not info:
        return None
    notes = []
    ha = cfg["homeassistant"]
    base, hdrs = ha["base"].rstrip("/"), {"Authorization": f"Bearer {ha['token']}"}
    installed = str(http(f"{base}/api/config", headers=hdrs, timeout=20).get("version") or "")

    # 1. core: the newest stable release once it has been out a few days
    rel = http("https://api.github.com/repos/home-assistant/core/releases/latest",
               headers={"User-Agent": "bestly-home-hub-agent", "Accept": "application/vnd.github+json"}, timeout=30)
    target = str(rel.get("tag_name") or "")
    try:
        published = datetime.datetime.strptime(rel.get("published_at", ""), "%Y-%m-%dT%H:%M:%SZ")
        now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        age_days = (now_utc - published).total_seconds() / 86400
    except ValueError:
        age_days = 0
    bad = STATE.setdefault("ha_bad_versions", [])
    ref = (info.get("Config") or {}).get("Image") or ""
    repo = ref.rsplit(":", 1)[0] if ref and not ref.startswith(("sha256:", "bestly-rollback/")) else "ghcr.io/home-assistant/home-assistant"
    if (re.fullmatch(r"\d{4}\.\d+\.\d+", target) and not rel.get("prerelease") and not rel.get("draft")
            and installed and ver(target) > ver(installed) and age_days >= m["ha_min_release_age_days"]
            and target not in bad):
        log(f"maintenance: Home Assistant {installed} -> {target}")
        status, detail, _ = replace_container(cfg, "homeassistant", f"{repo}:{target}", HA_DIR, ha_ready, 900)
        if status == "updated":
            notes.append(f"Home Assistant {installed} → {target}")
            emit(cfg, "update.homeassistant", "resolved", "success", "Home Assistant updates work again", f"Now on {target}.")
        elif status == "rolled_back":
            bad.append(target)
            emit(cfg, "update.homeassistant", "problem", "warning", f"Home Assistant {target} would not start; rolled back",
                 f"Back on {installed} and working. {target} is skipped from now on; the next release will be tried "
                 f"automatically.\nLast log lines:\n{detail[-1200:]}", push=True)
        elif status == "broken":
            bad.append(target)
            emit(cfg, "update.homeassistant", "problem", "error", "Home Assistant is down after a failed update",
                 f"{target} did not start, and going back to {installed} did not bring it back either. "
                 f"Backups are in {BACKUP_DIR}.\n{detail[-1200:]}", push=True)
            return "; ".join(notes) or None

    # 2. HACS integrations (restart once for all of them)
    try:
        pending = http(f"{base}/api/template", method="POST", headers=hdrs, timeout=30, data={
            "template": "{{ integration_entities('hacs') | select('match', 'update[.]') | select('is_state', 'on') | list | tojson }}"})
    except Exception:
        pending = []
    hacs_bad = {k: v for k, v in STATE.setdefault("hacs_bad", {}).items() if time.time() - v < 7 * 86400}
    STATE["hacs_bad"] = hacs_bad
    pending = [e for e in pending if isinstance(e, str) and e not in hacs_bad] if isinstance(pending, list) else []
    if pending:
        SUSPENDED.add("homeassistant")
        try:
            archive = backup_dir(HA_DIR, "homeassistant-integrations",
                                 excludes=("home-assistant_v2.db*", "*.log*", "backups", "tts"))
            done = []
            for ent in pending[:25]:
                try:
                    http(f"{base}/api/services/update/install", method="POST", headers=hdrs,
                         data={"entity_id": ent}, timeout=900)
                    done.append(ent)
                except Exception as exc:
                    log(f"maintenance: HACS {ent} failed to install: {exc}")
            if done:
                sh(["docker", "restart", "-t", "60", "homeassistant"], 300)
                if wait_until(lambda: ha_ready(cfg), 900, 15):
                    notes.append("HACS: " + ", ".join(e.split(".", 1)[1] for e in done))
                    emit(cfg, "update.homeassistant.hacs", "resolved", "success", "HACS updates work again", "")
                else:
                    cc = os.path.join(HA_DIR, "custom_components")
                    sh(["docker", "stop", "-t", "60", "homeassistant"], 180)
                    if os.path.exists(cc):
                        os.rename(cc, f"{cc}.failed-{stamp()}")
                    sh(["tar", "xzf", archive, "-C", os.path.dirname(HA_DIR),
                        f"{os.path.basename(HA_DIR)}/custom_components"], 900)
                    sh(["docker", "start", "homeassistant"], 180)
                    back = wait_until(lambda: ha_ready(cfg), 900, 15)
                    for e in done:
                        hacs_bad[e] = time.time()
                    emit(cfg, "update.homeassistant.hacs", "problem", "warning" if back else "error",
                         "HACS updates broke Home Assistant; " + ("rolled back" if back else "rollback did not bring it back"),
                         f"Updated: {', '.join(done)}. " + ("The old versions are back and Home Assistant is running. "
                         "These are skipped for 7 days." if back else f"Backup: {archive}"), push=True)
        finally:
            SUSPENDED.discard("homeassistant")
    return "; ".join(notes) or None


def hb_exec(script, timeout=900):
    return sh(["docker", "exec", "homebridge", "bash", "-c",
               f"source /opt/homebridge/source.sh >/dev/null 2>&1; cd /homebridge && {script}"], timeout)


def step_homebridge(cfg, forced=False):
    if not cfg.get("homebridge") or "homebridge" in manage_cfg(cfg)["ignore"]:
        return None
    info = container("homebridge")
    if not info or not (info.get("State") or {}).get("Running"):
        return None
    notes = []

    # 1. Homebridge core and plugins live as npm packages in /homebridge. Same major version only.
    rc, out = hb_exec("npm outdated --json", 300)
    try:
        outdated = json.loads(out[out.find("{"):]) if "{" in out else {}
    except json.JSONDecodeError:
        outdated = {}
    minor, major = [], []
    hb_bad = STATE.setdefault("hb_bad", [])
    for pkg, d in (outdated or {}).items():
        cur, latest = str(d.get("current") or ""), str(d.get("latest") or "")
        if not cur or not latest or cur == latest or f"{pkg}@{latest}" in hb_bad:
            continue
        (minor if cur.split(".")[0] == latest.split(".")[0] else major).append((pkg, cur, latest))
    notified = STATE.setdefault("major_notified", [])
    for pkg, cur, latest in major:
        if f"{pkg}@{latest}" not in notified:
            notified.append(f"{pkg}@{latest}")
            emit(cfg, f"update.major.{pkg}", "info", "warning", f"Homebridge: {pkg} {latest} is a major update",
                 f"You have {cur}. Major versions can break plugins, so it was not installed automatically. "
                 f"Install it from the Homebridge UI when you have a minute.", push=True)
    if minor:
        spec = " ".join(f"{p}@{l}" for p, _, l in minor)
        SUSPENDED.add("homebridge")
        try:
            archive = backup_dir(HB_DIR, "homebridge")
            rc, out = hb_exec(f"npm install --save --no-audit --no-fund {spec}", 1800)
            sh(["docker", "restart", "-t", "30", "homebridge"], 180)
            if rc == 0 and wait_until(lambda: hb_ready(cfg), 420, 15):
                notes.append("Homebridge " + ", ".join(f"{p} {c} → {l}" for p, c, l in minor))
                emit(cfg, "update.homebridge", "resolved", "success", "Homebridge updates work again", "")
            else:
                sh(["docker", "stop", "-t", "30", "homebridge"], 120)
                restore_dir(HB_DIR, archive)
                sh(["docker", "start", "homebridge"], 120)
                back = wait_until(lambda: hb_ready(cfg), 420, 15)
                hb_bad.extend(f"{p}@{l}" for p, _, l in minor)
                emit(cfg, "update.homebridge", "problem", "warning" if back else "error",
                     "Homebridge plugin update failed; " + ("rolled back" if back else "rollback did not bring it back"),
                     f"Tried {spec}. " + ("The old versions are back and running; these versions are skipped from now on."
                                           if back else f"Backup: {archive}") + f"\n{out[-800:]}", push=True)
        finally:
            SUSPENDED.discard("homebridge")

    # 2. the image (Node, the Homebridge UI, the base OS)
    info = container("homebridge") or info
    ref = (info.get("Config") or {}).get("Image") or ""
    if not ref or ref.startswith(("sha256:", "bestly-rollback/")):
        ref = "homebridge/homebridge:latest"
    status, detail, _ = replace_container(cfg, "homebridge", ref, HB_DIR, hb_ready, 420)
    if status == "updated":
        notes.append("Homebridge image updated")
        emit(cfg, "update.homebridge.image", "resolved", "success", "Homebridge image updates work again", "")
    elif status in ("rolled_back", "broken"):
        emit(cfg, "update.homebridge.image", "problem", "warning" if status == "rolled_back" else "error",
             "New Homebridge image " + ("would not start; rolled back" if status == "rolled_back" else "broke Homebridge"),
             ("The previous image is back and working. This image is skipped; the next one will be tried."
              if status == "rolled_back" else f"Rollback did not bring it back. Backups are in {BACKUP_DIR}.")
             + f"\n{detail[-1000:]}", push=True)
    return "; ".join(notes) or None


def step_pihole(cfg, forced=False):
    if "pihole" in manage_cfg(cfg)["ignore"] or not shutil.which("pihole"):
        return None
    rc, out = sh(["pihole", "-v"], 180)
    stale = [(n, c, l) for n, c, l in re.findall(r"(\w+) version is (v?[\d.]+) \(Latest: (v?[\d.]+)\)", out) if c != l]
    if not stale:
        return None
    SUSPENDED.add("pihole")
    try:
        rc, out = sh(["pihole", "-up"], 3600)
        ok = wait_until(lambda: pihole_ok()[0], 180, 10)
        if not ok:
            sh(["systemctl", "restart", "pihole-FTL"], 180)
            ok = wait_until(lambda: pihole_ok()[0], 180, 10)
        if rc == 0 and ok:
            emit(cfg, "update.pihole", "resolved", "success", "Pi-hole updates work again", "")
            return "Pi-hole " + ", ".join(f"{n} {c} → {l}" for n, c, l in stale)
        emit(cfg, "update.pihole", "problem", "warning" if ok else "error",
             "Pi-hole update failed" + ("" if ok else " and DNS is down"),
             f"`pihole -up` exited {rc}. " + ("DNS still works." if ok else
             "DNS on the Pi is not answering, so devices that use it may have no internet.") + f"\n{out[-1000:]}", push=True)
        return None
    finally:
        SUSPENDED.discard("pihole")


OS_SUSPEND = {"docker", "homeassistant", "homebridge", "pihole", "tailscale", "systemd"}


def other_jobs_running():
    """The Nextcloud updater (Sun 04:00) and the nightly backup (02:00) must never overlap OS updates."""
    return sh(["pgrep", "-f", "nextcloud-update.sh|backup-server.py|home-stack-update.sh"], 15)[0] == 0


def reboot_needed():
    if os.path.exists("/run/reboot-required"):
        return True, "a package asked for a reboot"
    running = os.uname().release
    if "+" in running:
        suffix = running.split("+", 1)[1]
        try:
            kernels = [d for d in os.listdir("/lib/modules") if d.endswith("+" + suffix)]
            newest = max(kernels, key=lambda d: ver(d.split("+")[0]))
            if newest != running:
                return True, f"new kernel {newest} (running {running})"
        except (OSError, ValueError):
            pass
    return False, ""


def step_os(cfg, forced=False):
    m = manage_cfg(cfg)
    if not forced and time.localtime().tm_wday != m["os_update_weekday"]:
        return None
    deadline = time.time() + 5400
    while other_jobs_running() and time.time() < deadline:
        time.sleep(60)
    env = dict(os.environ, DEBIAN_FRONTEND="noninteractive", NEEDRESTART_MODE="a", APT_LISTCHANGES_FRONTEND="none")
    opts = ["-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold"]
    note = None
    SUSPENDED.update(OS_SUSPEND)
    try:
        sh(["apt-get", "update"], 1200, env=env)
        rc, out = sh(["apt-get", *opts, "--with-new-pkgs", "upgrade"], 7200, env=env)
        if rc != 0:
            sh(["dpkg", "--configure", "-a"], 3600, env=env)
            rc, out = sh(["apt-get", *opts, "--with-new-pkgs", "upgrade"], 7200, env=env)
        if rc != 0:
            emit(cfg, "update.os", "problem", "warning", "OS updates failed on the Pi",
                 f"apt-get upgrade exited {rc}. Everything else kept running.\n{out[-1200:]}", push=True)
            return None
        emit(cfg, "update.os", "resolved", "success", "OS updates work again", "")
        mm = re.search(r"(\d+) upgraded, (\d+) newly installed", out)
        count = int(mm.group(1)) + int(mm.group(2)) if mm else 0
        note = f"{count} OS package{'s' if count != 1 else ''}" if count else None
    finally:
        time.sleep(90)   # let docker bring everything back before the health loop judges it
        SUSPENDED.difference_update(OS_SUSPEND)
    need, why = reboot_needed()
    if need and m["reboot"]:
        STATE["reboot_requested"] = {"reason": why, "from_kernel": os.uname().release}
        note = (note + ", " if note else "") + f"rebooting: {why}"
    return note


def step_housekeeping(cfg, forced=False):
    summary = cleanup(cfg)
    return summary if summary.startswith("Cleaned") else None


MAINT_STEPS = [("agent", step_agent), ("homeassistant", step_homeassistant), ("homebridge", step_homebridge),
               ("pihole", step_pihole), ("os", step_os), ("housekeeping", step_housekeeping)]
MAINT_THREAD = None


def start_maintenance(cfg, forced=False, only=None):
    global MAINT_THREAD
    if MAINT_THREAD and MAINT_THREAD.is_alive():
        return False
    MAINT_THREAD = threading.Thread(target=run_maintenance, args=(cfg, forced, only), daemon=True, name="maintenance")
    MAINT_THREAD.start()
    return True


def maybe_start_maintenance(cfg):
    m = manage_cfg(cfg)
    mt = STATE.get("maint") or {}
    if mt.get("started") and not mt.get("finished") and time.time() - mt["started"] < 3 * 3600:
        start_maintenance(cfg)        # resume after a self-update restart
        return
    if not m["updates"] or not m["window_start_hour"] <= time.localtime().tm_hour < m["window_end_hour"]:
        return
    if mt.get("date") == time.strftime("%Y-%m-%d") and not mt.get("forced"):
        return
    start_maintenance(cfg)


def run_maintenance(cfg, forced=False, only=None):
    today = time.strftime("%Y-%m-%d")
    with STATE_LOCK:
        mt = STATE.get("maint") or {}
        resuming = mt.get("started") and not mt.get("finished") and time.time() - mt["started"] < 3 * 3600 and not forced
        if not resuming:
            mt = {"date": today, "done": [], "notes": [], "started": time.time(), "forced": bool(forced), "only": only}
            STATE["maint"] = mt
    save_state()
    log(f"maintenance: {'resuming' if resuming else 'starting'}" + (f" ({', '.join(mt['only'])})" if mt.get("only") else ""))
    for name, fn in MAINT_STEPS:
        if name in mt["done"] or (mt.get("only") and name not in mt["only"]):
            continue
        if resuming and mt.get("current") == name and name != "agent":
            # We died in the middle of this step last time. Don't loop on it.
            with STATE_LOCK:
                mt["done"].append(name)
            save_state()
            emit(cfg, f"update.{name}", "problem", "warning", f"Home Hub maintenance: the {name} step was interrupted",
                 "The agent restarted in the middle of it, so it was skipped for tonight. It will be tried again tomorrow.",
                 push=True)
            continue
        mt["current"] = name
        save_state()
        log(f"maintenance: {name}")
        try:
            note = fn(cfg, bool(mt.get("forced")))
        except Exception as exc:
            note = None
            emit(cfg, f"update.{name}", "problem", "warning", f"Home Hub maintenance: the {name} step crashed",
                 f"{type(exc).__name__}: {exc}", push=True)
        with STATE_LOCK:
            mt["done"].append(name)
            if note:
                mt["notes"].append(note)
        save_state()
        if RESTART_AFTER_RESULT:
            log("maintenance: pausing for the agent restart")
            return
    mt["finished"] = time.time()
    reboot = STATE.pop("reboot_requested", None)
    save_state()
    log("maintenance: finished" + (f" — {'; '.join(mt['notes'])}" if mt["notes"] else ", nothing to do"))
    if mt["notes"]:
        emit(cfg, "maintenance", "info", "success", "Home Hub maintenance done", "\n".join(mt["notes"]))
    if reboot:
        STATE["rebooting"] = {"at": time.time(), **reboot}
        save_state()
        flush_events(cfg)
        log(f"maintenance: rebooting ({reboot.get('reason')})")
        sh(["systemctl", "reboot"], 60)


def post_reboot_check(cfg):
    rb = STATE.get("rebooting")
    if not rb:
        return
    since = time.time() - rb["at"]
    up = _uptime() or 0
    if up > since:   # the reboot never happened
        if since > 1800:
            STATE.pop("rebooting", None)
            emit(cfg, "os.reboot", "problem", "warning", "The Pi did not reboot after updates",
                 f"Asked to reboot for: {rb.get('reason')}. It is still on {os.uname().release}.", push=True)
        return
    if up < 420:
        return
    STATE.pop("rebooting", None)
    down = [h["label"] for h in HEALTH_LAST.values() if not h["ok"]]
    emit(cfg, "os.reboot", "info", "success" if not down else "warning", "The Pi rebooted after updates",
         f"Now on kernel {os.uname().release} (was {rb.get('from_kernel')})."
         + (" Everything is back." if not down else f" Not back yet: {', '.join(down)}. The health loop is on it."))
    save_state()


# ── self update ──────────────────────────────────────────────────────────────

RESTART_AFTER_RESULT = False
VERIFY = {}


def do_agent(cfg, action, payload):
    global RESTART_AFTER_RESULT
    if action == "test_alert":
        emit(cfg, "agent.test", "info", "warning", "Home Hub test alert",
             "If this is on your phone, Home Hub alerts work. Nothing is wrong.", push=True)
        return {"message": "Test alert sent."}
    if action == "run_maintenance":
        steps = [s for s in (payload.get("steps") or []) if s in dict(MAINT_STEPS)] or None
        started = start_maintenance(cfg, forced=True, only=steps)
        return {"message": ("Maintenance started: " + ", ".join(steps or [s for s, _ in MAINT_STEPS]))
                if started else "Maintenance is already running."}
    if action != "update":
        raise RuntimeError(f"Unknown agent action: {action}")
    version, want = str(payload.get("version", "")), str(payload.get("sha256", "")).lower()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or not re.fullmatch(r"[0-9a-f]{64}", want):
        raise RuntimeError("agent.update needs version (x.y.z) and sha256")
    if version == VERSION:
        return {"message": f"Already on {VERSION}."}
    rel = call_edge(cfg, {"op": "release", "agent": cfg.get("agent_name", "home-hub"), "version": version})
    source = rel.get("source")
    if not isinstance(source, str) or not source:
        raise RuntimeError(f"Release {version} not found")
    got = hashlib.sha256(source.encode()).hexdigest()
    if got != want:
        raise RuntimeError(f"sha256 mismatch for {version}: got {got[:12]}…, expected {want[:12]}…")
    compile(source, "agent.py", "exec")  # refuse anything that would not even start
    me = os.path.abspath(__file__)
    shutil.copy2(me, me + ".prev")
    tmp = me + ".new"
    with open(tmp, "w") as fh:
        fh.write(source)
    os.chmod(tmp, 0o755)
    os.replace(tmp, me)
    # launch.sh counts starts while this marker exists and restores agent.py.prev after 3 failed ones.
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(UPDATE_PENDING, "w") as fh:
        fh.write("0")
    STATE["pending_update"] = {"from": VERSION, "to": version, "at": time.time()}
    save_state()
    RESTART_AFTER_RESULT = True
    return {"message": f"Updated {VERSION} → {version}. Restarting; the previous version is kept at {me}.prev."}


def check_update_outcome(cfg):
    """At startup: did launch.sh roll a bad update back, or are we a new version on probation?"""
    if os.path.exists(ROLLED_BACK):
        bad = None
        try:
            with open(os.path.abspath(__file__) + ".bad") as fh:
                mm = re.search(r'^VERSION = "([\d.]+)"', fh.read(), re.M)
                bad = mm.group(1) if mm else None
        except OSError:
            pass
        if bad:
            STATE.setdefault("bad_agent_versions", []).append(bad)
        STATE.pop("pending_update", None)
        try:
            os.remove(ROLLED_BACK)
        except OSError:
            pass
        save_state()
        emit(cfg, "agent.update", "problem", "warning", f"Home Hub agent {bad or 'update'} would not start; rolled back",
             f"The Pi went back to {VERSION} by itself and is working. That version is skipped until a newer one is published.",
             push=True)
    if os.path.exists(UPDATE_PENDING):
        VERIFY.update(deadline=time.time() + 300, polls=0)


def confirm_update(cfg):
    """Called after every good poll. Four in a row (about a minute) and the new version is kept."""
    if "deadline" not in VERIFY:
        return
    VERIFY["polls"] += 1
    if VERIFY["polls"] < 4:
        return
    try:
        os.remove(UPDATE_PENDING)
    except OSError:
        pass
    VERIFY.clear()
    pu = STATE.pop("pending_update", None) or {}
    save_state()
    emit(cfg, "agent.update", "resolved", "success", f"Home Hub agent {VERSION} is running", "")
    emit(cfg, "agent.updated", "info", "success", f"Home Hub agent updated to {VERSION}", f"From {pu.get('from', '?')}.")


EXECUTORS = {"pihole": do_pihole, "homeassistant": do_homeassistant, "homebridge": do_homebridge, "agent": do_agent}


def run_command(cfg, cmd):
    fn = EXECUTORS.get(cmd["target"])
    if not fn:
        raise RuntimeError(f"Unknown target: {cmd['target']}")
    return fn(cfg, cmd["action"], cmd.get("payload") or {})


# ── main loop ────────────────────────────────────────────────────────────────

LAST_TICK = time.time()


def watchdog():
    """If the main loop ever hangs, exit so systemd starts a fresh agent."""
    while True:
        time.sleep(60)
        if time.time() - LAST_TICK > 1800:
            log("watchdog: the main loop has been stuck for 30 minutes; exiting so systemd restarts the agent")
            os._exit(2)


def main():
    global LAST_TICK
    cfg = load_config()
    load_state()
    agent = cfg.get("agent_name", "home-hub")
    period = int(cfg.get("poll_seconds", 15))
    log(f"Bestly Home Hub agent {VERSION} starting as '{agent}', polling every {period}s")
    check_update_outcome(cfg)
    threading.Thread(target=watchdog, daemon=True, name="watchdog").start()

    config_mtime = None
    last_snap = {"homeassistant": 0.0, "homebridge": 0.0, "host": 0.0}
    every = {"homeassistant": 60, "homebridge": 60, "host": 300}
    last_health = 0.0
    offline_since = None

    while True:
        LAST_TICK = time.time()
        # Re-read the config when it changes, and back its secrets up again.
        try:
            mtime = os.path.getmtime(CONFIG_PATH)
            if mtime != config_mtime:
                if config_mtime is not None:
                    cfg = load_config()
                    log("config changed; reloaded")
                config_mtime = mtime
                try:
                    backup_secrets(cfg)
                except Exception as exc:
                    log(f"secret backup failed: {exc}")
        except OSError:
            pass

        polled = False
        try:
            resp = call_edge(cfg, {
                "op": "poll", "agent": agent, "max": 5, "version": VERSION,
                "info": {"host": os.uname().nodename,
                         "features": ["snapshots", "backup_secrets", "self_update", "self_managing"]},
            })
            polled = True
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
                if RESTART_AFTER_RESULT:
                    break
        except urllib.error.HTTPError as exc:
            log(f"poll HTTP {exc.code}: {exc.read().decode()[:200]}")
        except Exception as exc:
            log(f"poll error: {exc}")

        now = time.time()
        if polled:
            if offline_since and now - offline_since > 600:
                emit(cfg, "agent.connection", "info", "warning", "Home Hub lost its connection for a while",
                     f"The Pi could not reach Supabase for {(now - offline_since) / 60:.0f} minutes. It is back now.")
            offline_since = None
            confirm_update(cfg)
            flush_events(cfg)
        else:
            offline_since = offline_since or now
            if "deadline" in VERIFY and now > VERIFY["deadline"] and internet_up():
                log("this version cannot reach the server; exiting so launch.sh can roll it back")
                sys.exit(3)

        if RESTART_AFTER_RESULT:
            log("exiting so systemd restarts on the new version")
            sys.exit(0)

        for source, gap in every.items():
            if now - last_snap[source] >= gap:
                last_snap[source] = now
                push_snapshot(cfg, source)

        if now - last_health >= 60:
            last_health = now
            try:
                run_health(cfg)
                post_reboot_check(cfg)
            except Exception as exc:
                log(f"health loop error: {type(exc).__name__}: {exc}")
            save_state()
            mt = STATE.get("maint") or {}
            try:
                call_edge(cfg, {"op": "snapshot", "agent": agent, "source": "health", "ok": True, "error": None,
                                "data": {"agent_version": VERSION, "checks": HEALTH_LAST,
                                         "suspended": sorted(SUSPENDED),
                                         "maintenance": {k: mt.get(k) for k in ("date", "started", "finished", "done", "notes", "forced")},
                                         "manage": manage_cfg(cfg),
                                         "outbox": len(STATE.get("outbox", []))}})
            except Exception as exc:
                log(f"snapshot health not delivered: {exc}")

        try:
            maybe_start_maintenance(cfg)
        except Exception as exc:
            log(f"maintenance scheduler error: {exc}")

        time.sleep(period)


if __name__ == "__main__":
    main()
