# -*- coding: utf-8 -*-
import json, os, subprocess, sys

BUILD = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
manifest = json.load(open(BUILD + "/manifest.json"))

plats = sys.argv[1].split(",") if len(sys.argv) > 1 else None

def sips_dims(p):
    out = subprocess.check_output(["sips","-g","pixelWidth","-g","pixelHeight",p]).decode()
    w = h = None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("pixelWidth:"):  w = int(line.split(":")[1])
        if line.startswith("pixelHeight:"): h = int(line.split(":")[1])
    return w, h

for m in manifest:
    if plats and m["plat"] not in plats:
        continue
    cmd = [CHROME, "--headless=new", "--hide-scrollbars", "--no-sandbox",
           "--disable-gpu", "--force-device-scale-factor=1",
           "--default-background-color=00000000",
           "--run-all-compositor-stages-before-draw",
           "--virtual-time-budget=2000",
           "--window-size=%d,%d" % (m["W"], m["H"]),
           "--screenshot=%s" % m["png"],
           "file://" + m["html"]]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = os.path.exists(m["png"])
    dims = sips_dims(m["png"]) if ok else (None, None)
    exp = (m["W"], m["H"])
    flag = "OK" if dims == exp else "MISMATCH"
    sz = os.path.getsize(m["png"]) if ok else 0
    print("%-7s %-22s %s  got=%sx%s want=%sx%s  %dKB" %
          (m["plat"], m["name"], flag, dims[0], dims[1], exp[0], exp[1], sz//1024))
print("done")
