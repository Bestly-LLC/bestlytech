#!/usr/bin/env python3
"""Local alerts v2: wall server.py patch (idempotent). usage: patch_server_v2.py /path/to/server.py"""
import re, sys

p = sys.argv[1]
s = open(p).read()
if "alertCats" in s:
    print("already patched")
    sys.exit(0)

a = 'DEFAULT_STATE.update({"skyAlerts": True})'
assert a in s
s = s.replace(a, 'DEFAULT_STATE.update({"skyAlerts": True, "alertCats": {}})', 1)

b = '            if k == "sleepShow" and not (v is None'
assert b in s
add = '''            if k == "alertCats":     # Local alerts v2: per-category switches from admin ({"police": false}); missing = the category default
                if not isinstance(v, dict):
                    continue
                v = {a: b for a, b in v.items() if isinstance(a, str) and re.fullmatch(r"[a-z_]{2,24}", a) and isinstance(b, bool)}
'''
s = s.replace(b, add + b, 1)
if not re.search(r"^import .*\bre\b|^import re\b", s, re.M):
    s = s.replace("\nimport ", "\nimport re\nimport ", 1)
open(p, "w").write(s)
print("patched")
