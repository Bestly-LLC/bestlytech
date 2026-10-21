#!/usr/bin/env python3
"""In-place patch: Home Hub agent 1.6.0 -> 1.6.1 (Automation Maker / Tinker). Run on bestly-pi as root.

Adds homeassistant.catalog / automation_get|put|delete / package_get|put|delete (docs/ha-automator-opusplan.md).
Additive only: one new block before do_homeassistant, one dispatch line inside it, the version string.
Backup first, py_compile before writing, restart, health check, automatic rollback if the agent does not come back.
"""
import os, py_compile, shutil, subprocess, sys, time, hashlib, json, re, urllib.request

AGENT = "/opt/bestly/home-hub-agent/agent.py"
UNIT = "bestly-home-hub-agent"
STAMP = time.strftime("%Y%m%d-%H%M%S")
BACKUP = f"{AGENT}.bak_automator_{STAMP}"

NEW_BLOCK = r'''
# ── Automation Maker (agent 1.6.1): Tinker installs only what Tinker made ────────────────────────────
# docs/ha-automator-opusplan.md. Automations go through Home Assistant's own config API (they show up in
# the HA editor); packages are files named bestly_auto_*.yaml in packages/, guarded by check_config.
AUTOMATOR_ACTIONS = {"catalog", "automation_get", "automation_put", "automation_delete",
                     "package_get", "package_put", "package_delete"}
AUTO_ID_RE = re.compile(r"^bestly_[a-z0-9_]{3,60}$")
AUTO_PKG_RE = re.compile(r"^bestly_auto_[a-z0-9_]{3,50}$")
AUTO_PKG_KEYS = {"automation", "script", "scene", "template", "input_boolean", "input_number", "input_select",
                 "input_text", "input_datetime", "input_button", "timer", "counter", "schedule", "group"}
AUTO_DENY = ("!secret", "!include", "!env_var", "shell_command", "command_line", "rest_command", "python_script",
             "pyscript", "hassio.", "homeassistant.stop", "homeassistant.restart", "recorder.purge")
AUTO_PKG_DIR = os.path.join(HA_DIR, "packages")


def _auto_deny(text):
    low = str(text).lower()
    for d in AUTO_DENY:
        if d in low:
            raise RuntimeError(f"Refused: '{d}' is not allowed in automations Tinker installs.")


def _ha_req(ha, path, method="GET", data=None, timeout=30):
    """(status, body) without raising on 4xx, so Home Assistant's own words come back to the admin."""
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ha["base"].rstrip("/") + path, data=body, method=method,
                                 headers={"Authorization": f"Bearer {ha['token']}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode(errors="replace")
            status = r.status
    except urllib.error.HTTPError as exc:
        raw, status = exc.read().decode(errors="replace"), exc.code
    s = raw.strip()
    if s[:1] in ("{", "["):
        try:
            return status, json.loads(s)
        except json.JSONDecodeError:
            pass
    return status, {"message": s[:800]}


def _auto_entity(ha, auto_id, wait=12):
    deadline = time.time() + wait
    while True:
        st, states = _ha_req(ha, "/api/states")
        for s in states if isinstance(states, list) else []:
            if s.get("entity_id", "").startswith("automation.") and (s.get("attributes") or {}).get("id") == auto_id:
                return s["entity_id"], s.get("state")
        if time.time() > deadline:
            return None, None
        time.sleep(1.5)


def _pkg_check(text):
    if len(text) > 40000:
        raise RuntimeError("The package is over 40,000 characters.")
    _auto_deny(text)
    try:
        import yaml  # noqa: PLC0415
        doc = yaml.safe_load(text)
        if not isinstance(doc, dict) or not doc:
            raise RuntimeError("The package must be a YAML mapping (automation:, script:, template: ...).")
        keys = set(doc.keys())
    except ImportError:
        keys = set(re.findall(r"^([A-Za-z_][A-Za-z0-9_]*):", text, re.M))
    except Exception as exc:  # yaml.YAMLError
        raise RuntimeError(f"The package is not valid YAML: {str(exc)[:300]}")
    bad = sorted(k for k in keys if k not in AUTO_PKG_KEYS)
    if bad:
        raise RuntimeError("Not allowed at the top of a package: " + ", ".join(bad))
    return keys


def _pkg_reload(ha, keys):
    done = []
    for dom in sorted(keys & AUTO_PKG_KEYS):
        st, body = _ha_req(ha, f"/api/services/{dom}/reload", "POST", {}, timeout=60)
        if st >= 400:
            raise RuntimeError(f"{dom}.reload failed: {str(body)[:200]}")
        done.append(f"{dom}.reload")
    return done


def _check_config(ha):
    st, body = _ha_req(ha, "/api/config/core/check_config", "POST", {}, timeout=120)
    if st >= 400:
        return False, str(body)[:800]
    return (body.get("result") == "valid"), (body.get("errors") or "")


def do_ha_automator(ha, action, payload):
    if action == "catalog":
        st, states = _ha_req(ha, "/api/states", timeout=40)
        states = states if isinstance(states, list) else []
        tpl = ("{% set ns = namespace(o=[]) %}{% for s in states %}{% set a = area_name(s.entity_id) %}"
               "{% if a %}{% set ns.o = ns.o + [[s.entity_id, a]] %}{% endif %}{% endfor %}{{ ns.o | tojson }}")
        _, pairs = _ha_req(ha, "/api/template", "POST", {"template": tpl}, timeout=60)
        areas = {p[0]: p[1] for p in pairs if isinstance(p, list) and len(p) == 2} if isinstance(pairs, list) else {}
        ents = []
        for s in states:
            eid = s.get("entity_id", "")
            name = (s.get("attributes") or {}).get("friendly_name") or ""
            ents.append([eid, str(name)[:80], str(s.get("state"))[:40], areas.get(eid, "")])
        _, svcs = _ha_req(ha, "/api/services", timeout=40)
        services = {d.get("domain"): sorted((d.get("services") or {}).keys())
                    for d in (svcs if isinstance(svcs, list) else []) if d.get("domain")}
        _, conf = _ha_req(ha, "/api/config")
        return {"entities": ents, "services": services, "ha_version": (conf or {}).get("version"),
                "message": f"{len(ents)} entities, {len(services)} service domains."}

    if action.startswith("automation_"):
        auto_id = str(payload.get("id") or "")
        if not AUTO_ID_RE.match(auto_id):
            raise RuntimeError("Tinker only manages automations whose id starts with bestly_.")
        path = f"/api/config/automation/config/{auto_id}"
        st, prev = _ha_req(ha, path)
        prev = prev if st == 200 and isinstance(prev, dict) and "message" not in prev else None
        if action == "automation_get":
            return {"id": auto_id, "config": prev}
        if action == "automation_delete":
            if prev is None:
                return {"id": auto_id, "deleted": False, "prev_config": None, "message": "It was already gone."}
            st, body = _ha_req(ha, path, "DELETE")
            if st >= 400:
                raise RuntimeError(f"Home Assistant would not delete it: {str(body)[:300]}")
            return {"id": auto_id, "deleted": True, "prev_config": prev, "message": "Automation removed."}
        cfg = payload.get("config")
        if not isinstance(cfg, dict) or not cfg:
            raise RuntimeError("automation_put needs config (the automation as an object).")
        _auto_deny(json.dumps(cfg))
        cfg = dict(cfg, id=auto_id)
        st, body = _ha_req(ha, path, "POST", cfg, timeout=60)
        if st >= 400:
            raise RuntimeError(f"Home Assistant said no: {str(body.get('message') if isinstance(body, dict) else body)[:500]}")
        entity, state = _auto_entity(ha, auto_id)
        return {"id": auto_id, "entity_id": entity, "state": state, "prev_config": prev,
                "message": f"Installed as {entity or auto_id}."}

    name = str(payload.get("name") or "")
    if not AUTO_PKG_RE.match(name):
        raise RuntimeError("Tinker only manages packages named bestly_auto_*.")
    fpath = os.path.join(AUTO_PKG_DIR, name + ".yaml")
    prev = open(fpath, encoding="utf-8").read() if os.path.exists(fpath) else None
    if action == "package_get":
        return {"name": name, "yaml": prev}
    if action == "package_delete":
        if prev is None:
            return {"name": name, "deleted": False, "prev_yaml": None, "message": "It was already gone."}
        try:
            keys = _pkg_check(prev)
        except RuntimeError:
            keys = set(AUTO_PKG_KEYS)
        os.remove(fpath)
        ok, errs = _check_config(ha)
        if not ok:
            with open(fpath, "w", encoding="utf-8") as fh:
                fh.write(prev)
            raise RuntimeError(f"Removing it broke the config check, so it was put back: {errs[:400]}")
        return {"name": name, "deleted": True, "prev_yaml": prev, "reloaded": _pkg_reload(ha, keys),
                "message": "Package removed."}
    text = str(payload.get("yaml") or "")
    keys = _pkg_check(text)
    os.makedirs(AUTO_PKG_DIR, exist_ok=True)
    tmp = fpath + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, fpath)

    def put_back():
        if prev is None:
            os.remove(fpath)
        else:
            with open(fpath, "w", encoding="utf-8") as fh:
                fh.write(prev)

    ok, errs = _check_config(ha)
    if not ok:
        put_back()
        raise RuntimeError(f"Home Assistant's config check failed, nothing was changed: {errs[:600]}")
    try:
        reloaded = _pkg_reload(ha, keys)
    except Exception as exc:
        put_back()
        try:
            _pkg_reload(ha, keys)
        except Exception:
            pass
        raise RuntimeError(f"Reload failed, the old version is back: {exc}")
    return {"name": name, "prev_yaml": prev, "check": "valid", "reloaded": reloaded,
            "message": f"Package {name} installed."}


'''

DISPATCH_ANCHOR = '    if action == "states":\n        return do_ha_states(ha, payload)\n'
DISPATCH_NEW = '    if action in AUTOMATOR_ACTIONS:\n        return do_ha_automator(ha, action, payload)\n' + DISPATCH_ANCHOR
DEF_ANCHOR = "def do_homeassistant(cfg, action, payload):\n"


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def main():
    src = open(AGENT, encoding="utf-8").read()
    if "AUTOMATOR_ACTIONS" in src:
        print("already patched:", re.search(r'^VERSION = "([^"]+)"', src, re.M).group(1))
        return 0
    m = re.search(r'^VERSION = "([^"]+)"', src, re.M)
    if not m or m.group(1) != "1.6.0":
        print("refusing: expected VERSION 1.6.0, found", m.group(1) if m else None)
        return 2
    for a in (DISPATCH_ANCHOR, DEF_ANCHOR, "HA_DIR = "):
        if src.count(a) != 1:
            print("refusing: anchor count", repr(a[:40]), src.count(a))
            return 2
    new = src.replace(DEF_ANCHOR, NEW_BLOCK.lstrip("\n") + DEF_ANCHOR, 1)
    new = new.replace(DISPATCH_ANCHOR, DISPATCH_NEW, 1)
    new = re.sub(r'^VERSION = "1\.6\.0"', 'VERSION = "1.6.1"', new, count=1, flags=re.M)
    tmp = AGENT + ".automator.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(new)
    py_compile.compile(tmp, doraise=True)
    shutil.copy2(AGENT, BACKUP)
    shutil.copymode(AGENT, tmp)
    os.replace(tmp, AGENT)
    print("backup", BACKUP)
    print("patched sha256", hashlib.sha256(new.encode()).hexdigest()[:12])
    sh(f"systemctl restart {UNIT}")
    time.sleep(25)
    active = sh(f"systemctl is-active {UNIT}").stdout.strip()
    logs = sh(f"journalctl -u {UNIT} --since '-40s' --no-pager -n 40").stdout
    if active != "active" or "Traceback" in logs:
        print("agent did not come back cleanly; rolling back\n", logs[-1500:])
        shutil.copy2(BACKUP, AGENT)
        sh(f"systemctl restart {UNIT}")
        time.sleep(10)
        print("after rollback:", sh(f"systemctl is-active {UNIT}").stdout.strip())
        return 1
    print("agent active on 1.6.1")
    print(logs[-800:])
    # Keep a copy of the live source as a release row (version + hash only matter to self-update; 1.6.1 == local, so no-op).
    try:
        env = {}
        for line in open("/home/pi/scripts/.env"):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k] = v.strip().strip('"').strip("'")
        key = env["SUPABASE_SERVICE_ROLE_KEY"]
        body = json.dumps({"version": "1.6.1", "sha256": hashlib.sha256(new.encode()).hexdigest(), "source": new,
                           "notes": "Automation Maker (Tinker): homeassistant.catalog, automation_get/put/delete, package_get/put/delete. In-place patch over the live 1.6.0."}).encode()
        req = urllib.request.Request(env["SUPABASE_URL"].rstrip("/") + "/rest/v1/home_hub_agent_releases?on_conflict=version",
                                     data=body, method="POST",
                                     headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                              "Prefer": "resolution=merge-duplicates,return=minimal"})
        with urllib.request.urlopen(req, timeout=30) as r:
            print("release row saved, HTTP", r.status)
    except Exception as exc:
        print("release row not saved (fine):", type(exc).__name__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
