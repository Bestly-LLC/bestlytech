#!/usr/bin/env python3
"""Wall server: read + drive the Dyson through Home Assistant when Homebridge doesn't list it. Re-runnable.
usage: patch_dyson_ha.py server.py ha_block.py"""
import sys
p, blk_p = sys.argv[1:3]
s = open(p, encoding="utf-8").read()
blk = open(blk_p, encoding="utf-8").read()
START, END = "\n# ---------- Dyson via Home Assistant (Claude 2026-10-29)", "# ---------- end Dyson via Home Assistant ----------\n"
assert "def w5_dyson_read():" in s and "def w5_purifier_on(rd):" in s, "W5 purifier code not found"
i = s.find(START)
if i >= 0:
    j = s.index(END, i) + len(END)
    s = s[:i] + blk.rstrip("\n") + "\n" + s[j:]
else:
    k = s.index("\ndef w5_take(kind")
    s = s[:k] + blk.rstrip("\n") + "\n" + s[k:]
# the error text the wall shows when nothing has the Dyson
s = s.replace('a["error"] = "Dyson not in Homebridge yet (the plugin is installed but not signed in)"',
              'a["error"] = "Dyson is offline in Home Assistant and not in Homebridge"', 1)
assert s.count("def w5_dyson_read_ha") == 1 and "_w5_dyson_read_hb = w5_dyson_read" in s
assert s.index("_w5_dyson_read_hb = w5_dyson_read") > s.index("def w5_purifier_on(rd):")
open(p, "w", encoding="utf-8").write(s)
print("patched", len(s))
