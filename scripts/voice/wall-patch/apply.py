#!/usr/bin/env python3
"""Anchored edits for the shared wall files (round-4 Pi editing rule). Usage (on the Pi, under the edit lock):
  sudo flock /opt/bestly/wall/.edit.lock python3 apply.py spec.json /opt/bestly/wall [--dry]
spec: [{"file": "server.py"|"watchdog.py"|"www/wall.html", "anchor": str, "where": "before"|"after"|"replace", "text": str, "marker": str}]
Re-reads the live files, skips an edit whose marker is already present, asserts every other anchor matches exactly once
(nothing is written if any fails), backs up to *.bak_r4w7_<time>, writes, py_compiles Python files (restores on failure)."""
import json, os, shutil, subprocess, sys, time
spec, root = json.load(open(sys.argv[1])), sys.argv[2]
dry = "--dry" in sys.argv
files = {}
for e in spec:
    p = os.path.join(root, e["file"])
    if p not in files:
        files[p] = open(p).read()
bad = []
for e in spec:
    p = os.path.join(root, e["file"]); s = files[p]
    if e.get("marker") and e["marker"] in s:
        print("skip (already there):", e["file"], e["marker"]); e["_skip"] = True; continue
    n = s.count(e["anchor"])
    if n != 1:
        bad.append((e["file"], n, e["anchor"][:70]))
if bad:
    for b in bad: print("ANCHOR FAIL", b)
    sys.exit(2)
new = dict(files)
for e in spec:
    if e.get("_skip"): continue
    p = os.path.join(root, e["file"]); s = new[p]; a = e["anchor"]
    rep = {"before": e["text"] + a, "after": a + e["text"], "replace": e["text"]}[e["where"]]
    new[p] = s.replace(a, rep, 1)
stamp = time.strftime("%H%M%S")
for p, s in new.items():
    if s == files[p]: continue
    if dry:
        open(p, "w").write(s); print("dry wrote", p); continue
    b = f"{p}.bak_r4w7_{stamp}"; shutil.copy2(p, b); print("backup", b)
    open(p + ".tmp_r4w7", "w").write(s)
    if p.endswith(".py"):
        r = subprocess.run([sys.executable, "-m", "py_compile", p + ".tmp_r4w7"], capture_output=True, text=True)
        if r.returncode: print("PY FAIL", p, r.stderr[-400:]); os.remove(p + ".tmp_r4w7"); sys.exit(3)
    st = os.stat(p); os.replace(p + ".tmp_r4w7", p)
    try: os.chown(p, st.st_uid, st.st_gid)
    except Exception: pass
    print("wrote", p)
print("PYOK")
