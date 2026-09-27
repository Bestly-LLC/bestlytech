"""One way to reach Jared's iPhone: Home Assistant (ntfy retired 2026-09-27).

send(title, message, priority, source) queues the push in Supabase (ha_push -> Home Hub agent ->
HA companion app), which falls back to a web push by itself if the Pi or HA can't deliver.
If Supabase can't be reached, it goes straight to Home Assistant on this Pi. Never raises.
"""
import json
import os
import re
import sys
import urllib.request

ENV_PATH = "/home/pi/scripts/.env"
PHONE_SERVICE = "notify/mobile_app_jareds_iphone"


def _env():
    env = {}
    try:
        with open(ENV_PATH) as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


_ENV = _env()

_LEVELS = {
    "urgent": "time-sensitive", "max": "time-sensitive", "5": "time-sensitive",
    "high": "time-sensitive", "4": "time-sensitive",
    "default": "active", "3": "active", "": "active",
    "low": "passive", "min": "passive", "2": "passive", "1": "passive",
    "passive": "passive", "active": "active", "time-sensitive": "time-sensitive", "critical": "critical",
}
_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]+")


def level_for(priority):
    return _LEVELS.get(str(priority if priority is not None else "").strip().lower(), "active")


def tidy_title(title):
    """Apple style: no emoji, no [TAG] prefixes, short."""
    t = _EMOJI.sub("", str(title or "")).strip()
    m = re.match(r"^\[(NEW|STILL|OK)\]\s*", t, re.I)
    if m:
        t = t[m.end():]
        if m.group(1).upper() == "STILL":
            t = "Still down: " + t
    return (t or "Bestly")[:120]


def _post(url, body, headers, timeout=10):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status < 300


def _via_supabase(payload):
    base = _ENV.get("SUPABASE_URL", "").rstrip("/")
    key = _ENV.get("SUPABASE_SECRET_KEY") or _ENV.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        return False
    h = {"apikey": key} if key.startswith("sb_") else {"apikey": key, "Authorization": f"Bearer {key}"}
    return _post(f"{base}/rest/v1/rpc/ha_push", payload, h)


def _via_home_assistant(payload):
    base = (_ENV.get("HA_URL") or "http://127.0.0.1:8123").rstrip("/")
    token = _ENV.get("HA_TOKEN")
    if not token:
        return False
    level = payload["p_level"]
    data = {"push": {"interruption-level": level}, "url": payload["p_url"], "group": payload["p_group"]}
    if payload.get("p_tag"):
        data["tag"] = payload["p_tag"]
    body = {"title": payload["p_title"], "message": payload["p_body"], "data": data}
    if payload.get("p_source"):
        data["subtitle"] = payload["p_source"]
    return _post(f"{base}/api/services/{PHONE_SERVICE}", body, {"Authorization": f"Bearer {token}"})


def send(title, message="", priority="default", source="Pi", url="https://bestly.tech/admin/home-hub",
         tag=None, group=None):
    """Returns True when the push was handed off. Never raises."""
    title = tidy_title(title)
    message = _EMOJI.sub("", str(message or "")).strip() or title
    payload = {
        "p_title": title, "p_body": message[:1200], "p_level": level_for(priority),
        "p_source": source, "p_url": url,
        "p_group": group or re.sub(r"\W+", "-", source.lower()).strip("-") or "pi",
        "p_tag": tag,
    }
    for route in (_via_supabase, _via_home_assistant):
        try:
            if route(payload):
                print(f"push ({route.__name__[5:]}, {payload['p_level']}): [{title}] {message[:100]}")
                return True
        except Exception as exc:  # noqa: BLE001 - a push must never crash the caller
            print(f"push via {route.__name__[5:]} failed: {exc}", file=sys.stderr)
    return False


if __name__ == "__main__":
    a = sys.argv[1:]
    ok = send(a[0] if a else "Test", a[1] if len(a) > 1 else "", a[2] if len(a) > 2 else "low",
              a[3] if len(a) > 3 else "Pi")
    sys.exit(0 if ok else 1)
