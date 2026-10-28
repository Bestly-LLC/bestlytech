#!/usr/bin/env python3
"""Local alerts v2: replace the v1 CSS + JS blocks of wall.html with v2_css.txt / v2_js.txt. usage: patch_wall_v2.py wall.html v2_css.txt v2_js.txt"""
import sys

p, css_p, js_p = sys.argv[1:4]
s = open(p).read()
css, js = open(css_p).read(), open(js_p).read()

if "window.__citView" in s:
    # re-run: swap v2 blocks in place
    c0 = s.index("/* Local alerts on the sky (Sky Sync, v2")
    j0 = s.index("/* Local alerts v2 (Oct 28")
else:
    c0 = s.index("/* Local alerts on the sky (Sky Sync, Oct 28)")
    j0 = s.index("/* Local alerts (Oct 28, Sky Sync;")
c1 = s.index("body.scrtr #airCv", c0)
j1 = s.index("  // Sky key lives on the sign wall now", j0)
assert c0 < c1 < j0 < j1
s = s[:c0] + css + s[c1:j0] + "  " + js.lstrip() + s[j1:]
open(p, "w").write(s)
print("patched", len(s))
