"""FreeLLM Keys (Pi cron, every minute, free, no Claude). Plan: docs/scout-chief-of-staff-opusplan.md section 2.

The /admin "Free AI keys" card queues a key in Vault (freellm_key_add). This job adds it to FreeLLM on 127.0.0.1:3001
(/api/keys needs a dashboard session, and the public Funnel only exposes /v1, so only this Pi can do it), then deletes the
Vault copy. It also pushes per-provider key counts back (no key values) so the card can show them.

Session: a short-lived dashboard session is written straight into FreeLLM's own sqlite db for the owner account
(same table POST /api/auth/login writes), used, and deleted. No password is stored anywhere.
"""
import hashlib
import json
import secrets
import subprocess
import time
import urllib.error
import urllib.request

import lib

BASE = "http://127.0.0.1:3001"
DB = "/mnt/ssd/freellmapi/server/data/freeapi.db"


def _sql(q):
    return subprocess.run(["sudo", "-n", "sqlite3", DB, q], capture_output=True, text=True, timeout=20)


def _session():
    tok = secrets.token_hex(32)
    h = hashlib.sha256(tok.encode()).hexdigest()
    exp = int((time.time() + 600) * 1000)
    r = _sql(f"INSERT INTO sessions (token_hash, user_id, expires_at_ms) SELECT '{h}', id, {exp} FROM users ORDER BY id LIMIT 1;")
    if r.returncode != 0:
        raise RuntimeError("could not open a FreeLLM session: " + r.stderr[:120])
    return tok, h


def _end(h):
    _sql(f"DELETE FROM sessions WHERE token_hash = '{h}';")


def _call(method, path, tok, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:200]}")


def main(argv):
    sync_only = "sync" in argv
    pending = [] if sync_only else (lib.rpc("freellm_key_next") or [])
    stamp = lib.get("freellm_key_status", "select=synced_at&order=synced_at.desc&limit=1")
    fresh = bool(stamp) and time.time() - time.mktime(time.strptime(stamp[0]["synced_at"][:19], "%Y-%m-%dT%H:%M:%S")) + time.timezone < 280
    if not pending and fresh and not sync_only:
        return "nothing to add; status fresh"
    tok, h = _session()
    added, failed = 0, 0
    try:
        for item in pending:
            try:
                if not item.get("key"):
                    raise RuntimeError("key missing from Vault")
                _call("POST", "/api/keys", tok, {"platform": item["provider"], "key": item["key"], "label": item.get("label") or "added from /admin"})
                lib.rpc("freellm_key_done", p_id=item["id"], p_ok=True, p_error=None)
                added += 1
            except Exception as e:  # noqa: BLE001
                msg = str(e)
                if item.get("key"):
                    msg = msg.replace(item["key"], "[key]")
                lib.rpc("freellm_key_done", p_id=item["id"], p_ok=False, p_error=msg[:280])
                failed += 1
        provs = _call("GET", "/api/keys/providers", tok) or {}
        keys = _call("GET", "/api/keys", tok) or []
        if isinstance(keys, dict):
            keys = keys.get("keys", [])
        by = {}
        for k in keys:
            p = k.get("platform")
            d = by.setdefault(p, {"healthy": 0, "err": None})
            if k.get("enabled") and k.get("status") in ("healthy", "unknown"):
                d["healthy"] += 1
            elif k.get("last_health_error") or k.get("lastHealthError"):
                d["err"] = str(k.get("last_health_error") or k.get("lastHealthError"))[:150]
        rows = []
        for p in provs.get("providers", []):
            d = by.get(p["platform"], {"healthy": 0, "err": None})
            rows.append({"provider": p["platform"], "name": p.get("name") or p["platform"], "keyless": bool(p.get("keyless")),
                         "keys": p.get("keyCount", 0), "enabled_keys": p.get("enabledKeyCount", 0), "healthy_keys": d["healthy"], "last_error": d["err"]})
        if rows:
            lib.rpc("freellm_status_put", p_rows=rows)
    finally:
        _end(h)
    total = sum(r["keys"] for r in rows)
    return f"ok added {added}, failed {failed}, {total} keys on {sum(1 for r in rows if r['keys'])} providers"
