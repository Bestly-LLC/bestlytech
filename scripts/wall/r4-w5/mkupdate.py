#!/usr/bin/env python3
"""Update spec: the live files already hold an older version of the W5 pieces (inserted verbatim by mkspec.py). For each piece
that changed, replace the old text (from PREV_DIR, the sources at the deployed commit) with the new one (this folder).
usage: mkupdate.py PREV_DIR -> w5update.json"""
import json, os, sys
D = os.path.dirname(os.path.abspath(__file__)); P = sys.argv[1]
rd = lambda d, n: open(os.path.join(d, n), encoding="utf-8").read()
E = []
pairs = [("www/wall.html", rd(P, "block.js") + rd(P, "skit.js"), rd(D, "block.js") + rd(D, "skit.js")),
         ("www/wall.html", rd(P, "w5.css"), rd(D, "w5.css")),
         ("server.py", rd(P, "server_w5.py").lstrip("\n"), rd(D, "server_w5.py").lstrip("\n")),
         ("watchdog.py", rd(P, "wd_w5.py"), rd(D, "wd_w5.py"))]
for f, old, new in pairs:
    if old != new:
        E.append({"file": f, "old": old, "new": new})
json.dump(E, open(os.path.join(D, "w5update.json"), "w"))
print(len(E), "changed pieces")
