#!/opt/ltx/venv/bin/python
"""Render one clip with the official ComfyUI LTX-2.5 text-to-video template (default 1280x720, 24 fps).
Usage: make-video.py "prompt" [out_prefix] [seconds] [width] [height]
2026-10-06: width/height so Montage can order vertical b-roll (704x1280; LTX wants multiples of 32).
Prints progress lines, then one JSON line: {status, seconds, files, msgs}."""
import json, random, sys, time, urllib.request, uuid
from playwright.sync_api import sync_playwright
TPL = "/opt/ltx/venv/lib/python3.12/site-packages/comfyui_workflow_templates_json/templates/video_ltx2_5_t2v.json"
BASE = "http://127.0.0.1:8188"
prompt = sys.argv[1]
prefix = sys.argv[2] if len(sys.argv) > 2 else "video/bestly"
secs = max(1, min(20, int(sys.argv[3]))) if len(sys.argv) > 3 else 5
width = int(sys.argv[4]) if len(sys.argv) > 4 else 1280
height = int(sys.argv[5]) if len(sys.argv) > 5 else 720
width, height = max(256, min(1920, width // 32 * 32)), max(256, min(1920, height // 32 * 32))
wf = json.load(open(TPL))
for n in wf["nodes"]:
    if n["type"] == "SaveVideo":
        n["widgets_values"][0] = prefix
    if n["type"] == "ResolutionSelector":  # top-level node that actually drives the subgraph's width/height (links 792/793)
        n["widgets_values"][0] = "9:16 (Portrait Widescreen)" if height > width * 1.3 else "16:9 (Widescreen)"
        n["widgets_values"][1] = round(width * height / 1e6, 1)
        n["widgets_values"][2] = 32
    if n.get("id") == 405:  # subgraph "Text to Video (LTX-2.5)": [prompt, enhance, duration, width, height, seed, fps, ...]
        n["widgets_values"][0] = prompt
        n["widgets_values"][2] = secs
        n["widgets_values"][3] = width
        n["widgets_values"][4] = height
        n["widgets_values"][5] = random.randint(1, 2**48)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(BASE)
    pg.wait_for_function("() => window.app && window.app.graph", timeout=120000)
    pg.evaluate("async (wf) => { await window.app.loadGraphData(wf); }", wf)
    api = pg.evaluate("async () => (await window.app.graphToPrompt()).output")
    b.close()
body = json.dumps({"prompt": api, "client_id": str(uuid.uuid4())}).encode()
req = urllib.request.Request(BASE + "/prompt", body, {"Content-Type": "application/json"})
pid = json.load(urllib.request.urlopen(req))["prompt_id"]
t0 = time.time()
print("queued", pid, flush=True)
while True:
    time.sleep(5)
    h = json.load(urllib.request.urlopen(f"{BASE}/history/{pid}"))
    if pid in h:
        st = h[pid].get("status", {})
        if st.get("completed") or st.get("status_str") in ("success", "error"):
            break
    if time.time() - t0 > 2400:
        print(json.dumps({"status": "timeout", "seconds": round(time.time() - t0), "files": [], "msgs": []}))
        sys.exit(1)
files = []
for out in h[pid].get("outputs", {}).values():
    for k in ("images", "videos", "gifs"):
        for f in out.get(k, []):
            files.append(f"/opt/ltx/comfy/output/{f.get('subfolder','')}/{f['filename']}".replace("//", "/"))
msgs = h[pid]["status"].get("messages", [])
err = [m[1].get("exception_message", "") for m in msgs if m[0] == "execution_error"]
print(json.dumps({"status": h[pid]["status"].get("status_str"), "seconds": round(time.time() - t0), "files": files,
                  "msgs": [m[0] for m in msgs][-6:], "error": (err[0] if err else None)}))
