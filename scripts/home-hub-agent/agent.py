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

Since 1.1.0 the agent also:
  * pushes read-only snapshots (op "snapshot"): Home Assistant and Homebridge every
    minute, the host itself (IPs, gateway, Tailscale, containers, disk) every 5 minutes.
    The server keeps the admin's access backup (home_hub_inventory) current from these.
  * backs up its own HA token and Homebridge login into Supabase Vault (op
    "backup_secrets") whenever the config file changes. Write-only: nothing reads them back.
  * can update itself (command agent.update): it downloads the release from the edge
    function, checks the sha256 the admin queued, swaps the file and exits so systemd
    restarts it on the new version. No SSH needed for future upgrades.

Install:  sudo ./install.sh
"""

import hashlib
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = "1.1.0"
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
    ver = out.get("version") if isinstance(out.get("version"), dict) else {}
    ui = out.get("ui_version") if isinstance(out.get("ui_version"), dict) else {}
    return {
        "status": (out.get("status") or {}).get("status") if isinstance(out.get("status"), dict) else None,
        "installed_version": ver.get("installedVersion"),
        "latest_version": ver.get("latestVersion"),
        "update_available": ver.get("updateAvailable"),
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
    mem = {}
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                k, v = line.split(":", 1)
                if k in ("MemTotal", "MemAvailable"):
                    mem[k] = int(v.strip().split()[0]) // 1024
    except Exception:
        pass
    temp = None
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as fh:
            temp = round(int(fh.read().strip()) / 1000, 1)
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
    try:
        with open("/proc/uptime") as fh:
            uptime = int(float(fh.read().split()[0]))
    except Exception:
        uptime = None
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
        "uptime_seconds": uptime,
        "load": list(os.getloadavg()),
        "memory_mb": mem,
        "cpu_temp_c": temp,
        "disks": disks,
        "containers": containers[:60],
        "listening": sorted({int(p) for p in re.findall(r":(\d+)\s", _sh("ss -ltnH")) if int(p) < 20000})[:80],
        "agent_version": VERSION,
    }


SNAPSHOTS = {"homeassistant": snapshot_homeassistant, "homebridge": snapshot_homebridge, "host": snapshot_host}


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


# ── self update ──────────────────────────────────────────────────────────────

RESTART_AFTER_RESULT = False


def do_agent(cfg, action, payload):
    global RESTART_AFTER_RESULT
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
    RESTART_AFTER_RESULT = True
    return {"message": f"Updated {VERSION} → {version}. Restarting; the previous version is kept at {me}.prev."}


EXECUTORS = {"pihole": do_pihole, "homeassistant": do_homeassistant, "homebridge": do_homebridge, "agent": do_agent}


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

    config_mtime = None
    last_snap = {"homeassistant": 0.0, "homebridge": 0.0, "host": 0.0}
    every = {"homeassistant": 60, "homebridge": 60, "host": 300}

    while True:
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

        try:
            resp = call_edge(cfg, {
                "op": "poll", "agent": agent, "max": 5, "version": VERSION,
                "info": {"host": os.uname().nodename,
                         "features": ["snapshots", "backup_secrets", "self_update"]},
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
                if RESTART_AFTER_RESULT:
                    log("exiting so systemd restarts on the new version")
                    sys.exit(0)
        except urllib.error.HTTPError as exc:
            log(f"poll HTTP {exc.code}: {exc.read().decode()[:200]}")
        except Exception as exc:
            log(f"poll error: {exc}")

        now = time.time()
        for source, gap in every.items():
            if now - last_snap[source] >= gap:
                last_snap[source] = now
                push_snapshot(cfg, source)

        time.sleep(period)


if __name__ == "__main__":
    main()
