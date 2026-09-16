"""Publish scripts/home-hub-agent/agent.py as a home_hub_agent_releases row (run on the Pi)."""
import hashlib, json, re, sys, urllib.request

env = {}
for line in open("/home/pi/scripts/.env"):
    if "=" in line and not line.startswith("#"):
        k, v = line.strip().split("=", 1)
        env[k] = v.strip().strip('"').strip("'")
src = open(sys.argv[1], encoding="utf-8").read()
version = re.search(r'^VERSION = "([\d.]+)"', src, re.M).group(1)
notes = sys.argv[2] if len(sys.argv) > 2 else ""
sha = hashlib.sha256(src.encode()).hexdigest()
key = env["SUPABASE_SERVICE_ROLE_KEY"]
req = urllib.request.Request(
    env["SUPABASE_URL"].rstrip("/") + "/rest/v1/home_hub_agent_releases?on_conflict=version",
    data=json.dumps({"version": version, "sha256": sha, "source": src, "notes": notes}).encode(),
    method="POST",
    headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
             "Prefer": "resolution=merge-duplicates,return=minimal"})
with urllib.request.urlopen(req, timeout=30) as r:
    print("published", version, sha[:12], "HTTP", r.status)
