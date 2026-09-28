#!/usr/bin/env python3
"""W5 r4 anchored patcher. usage: sudo flock /opt/bestly/wall/.edit.lock python3 w5apply.py SPEC [--dry]
SPEC = JSON list of {file (relative to /opt/bestly/wall), old, new, mark}. Each `old` must occur exactly once in the LIVE file
(re-read now); skipped when `mark` is already present. Backs up to <file>.bak_r4w5_<HHMMSS>, checks the page script with
node --check and Python with py_compile BEFORE writing. Exit 1 = nothing written."""
import json, os, re, shutil, subprocess, sys, time, py_compile
ROOT = "/opt/bestly/wall"
spec = json.load(open(sys.argv[1]))
dry = "--dry" in sys.argv
files, bad = {}, []
for i, e in enumerate(spec):
    f = e["file"]
    if f not in files:
        files[f] = open(os.path.join(ROOT, f), encoding="utf-8").read()
    s = files[f]
    if e.get("mark") and e["mark"] in s:
        print(f"skip {i} (already there) {f}")
        continue
    n = s.count(e["old"])
    if n != 1:
        bad.append((i, f, n, e["old"][:100]))
        continue
    files[f] = s.replace(e["old"], e["new"], 1)
    print(f"ok   {i} {f}")
if bad:
    for b in bad:
        print("ANCHOR", b)
    sys.exit(1)
for f, s in files.items():
    p = os.path.join(ROOT, f)
    if f.endswith(".html") and shutil.which("node"):   # the Pi has no node: deploy.sh checks the page script on the Mac
        js = "\n".join(re.findall(r"<script>(.*?)</script>", s, re.S))
        open("/tmp/r4w5_check.js", "w").write(js)
        r = subprocess.run(["node", "--check", "/tmp/r4w5_check.js"], capture_output=True, text=True)
        if r.returncode != 0:
            print("JSBAD", r.stderr[-800:])
            sys.exit(1)
        print("JSOK", f)
    if f.endswith(".py"):
        tmp = "/tmp/r4w5_check_" + os.path.basename(f)
        open(tmp, "w").write(s)
        py_compile.compile(tmp, doraise=True)
        print("PYOK", f)
if dry:
    print("dry run: nothing written")
    sys.exit(0)
tag = time.strftime("%H%M%S")
for f, s in files.items():
    p = os.path.join(ROOT, f)
    if open(p, encoding="utf-8").read() == s:
        continue
    shutil.copy2(p, p + ".bak_r4w5_" + tag)
    with open(p, "w", encoding="utf-8") as fh:   # in place: keeps owner + mode
        fh.write(s)
    print("wrote", p, "backup", p + ".bak_r4w5_" + tag)
