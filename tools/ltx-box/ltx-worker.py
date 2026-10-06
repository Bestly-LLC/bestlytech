#!/opt/ltx/venv/bin/python
"""ltx-worker: takes video jobs from Bestly (edge fn ltx-box), renders them, uploads, reports back.
Runs as systemd ltx-worker (Restart=always). /opt/ltx/BUSY keeps the idle auto-stop away while it works."""
import json, os, subprocess, time, urllib.request
EDGE = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/ltx-box"
KEY = open("/etc/bestly/ltx-box.key").read().strip()
BUSY = "/opt/ltx/BUSY"

def post(d):
    req = urllib.request.Request(EDGE, json.dumps(d).encode(), {"Content-Type": "application/json", "x-ltx-key": KEY})
    return json.load(urllib.request.urlopen(req, timeout=60))

def comfy_up():
    try:
        urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=5)
        return True
    except Exception:
        return False

def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)

while True:
    if not comfy_up():
        time.sleep(10); continue
    try:
        r = post({"op": "claim"})
    except Exception as e:
        log("claim failed:", e); time.sleep(20); continue
    job = r.get("job")
    if not job:
        if os.path.exists(BUSY): os.remove(BUSY)
        time.sleep(15); continue
    open(BUSY, "w").write(job["id"])
    log("job", job["code"], job["seconds"], "s", f'{job.get("width") or 1280}x{job.get("height") or 720}:', job["prompt"][:80])
    try:
        p = subprocess.run(["/opt/ltx/make-video.py", job["prompt"], f"video/ltx_{job['code']}", str(job["seconds"]),
                            str(job.get("width") or 1280), str(job.get("height") or 720)],
                           capture_output=True, text=True, timeout=2700)
        last = [l for l in p.stdout.strip().splitlines() if l.startswith("{")]
        out = json.loads(last[-1]) if last else {}
        if out.get("status") != "success" or not out.get("files"):
            raise RuntimeError(out.get("error") or (p.stderr.strip().splitlines() or ["render failed"])[-1][:300])
        f = [x for x in out["files"] if x.endswith(".mp4")][0]
        req = urllib.request.Request(job["upload_url"], open(f, "rb").read(), {"Content-Type": "video/mp4", "x-upsert": "true"}, method="PUT")
        urllib.request.urlopen(req, timeout=300).read()
        res = post({"op": "finish", "job": job["id"], "ok": True, "render_s": out["seconds"], "path": job["path"]})
        log("done", job["code"], res.get("text", "")[:200].replace("\n", " | "))
    except Exception as e:
        log("failed", job["code"], e)
        try:
            post({"op": "finish", "job": job["id"], "ok": False, "error": str(e)[:300]})
        except Exception as e2:
            log("finish report failed:", e2)
