#!/usr/bin/env python3
"""Local alerts v3 (beige wall): swap the v2 CSS block of wall.html for v3_css.txt and make 3 small JS edits.
Re-runnable. usage: patch_wall_v3.py wall.html v3_css.txt   (prints 'patched <bytes>' or raises)"""
import sys

p, css_p = sys.argv[1:3]
s = open(p).read()
css = open(css_p).read()
assert "window.__citView" in s, "v2 local alerts not found in this wall.html"

c0 = s.find("/* Local alerts on the sky (Sky Sync, v3")
if c0 < 0:
    c0 = s.index("/* Local alerts on the sky (Sky Sync, v2")
c1 = s.index("body.scrtr #airCv", c0)
s = s[:c0] + css + s[c1:]

# 1) ink color helper (white icon, dark ink on very light colors like traffic white)
INK = "  const citInk=(h)=>{ const v=citRGB(h).split(',').map(Number); const L=(0.2126*v[0]+0.7152*v[1]+0.0722*v[2])/255; return L>0.8?'#3A3A3C':'#FFFFFF'; };\n"
anchor = "  const citSvg=(c)=>"
if "const citInk=" not in s:
    assert anchor in s
    s = s.replace(anchor, INK + anchor, 1)
# 2) dots carry --ink
a = "e.style.setProperty('--r',citRGB(c&&c.color));"
if a in s and "setProperty('--ink'" not in s:
    s = s.replace(a, a + " e.style.setProperty('--ink',citInk(c&&c.color));", 1)
# 3) notes rows and legend chips carry --ink
s = s.replace("'<div class=\"ct-nr\" style=\"--r:'+citRGB(c&&c.color)+'\">'",
              "'<div class=\"ct-nr\" style=\"--r:'+citRGB(c&&c.color)+';--ink:'+citInk(c&&c.color)+'\">'")
s = s.replace("'<div class=\"ct-lc\" style=\"--r:'+citRGB(c.color)+'\">'",
              "'<div class=\"ct-lc\" style=\"--r:'+citRGB(c.color)+';--ink:'+citInk(c.color)+'\">'")
# 4) label the nearest 3 (was 4), same as the admin Sky map
s = s.replace("lab=isNew||(nl<4&&!clash)", "lab=isNew||(nl<3&&!clash)")

for need in ("Sky Sync, v3", "const citInk=", "setProperty('--ink'", "--ink:'+citInk(c&&c.color)", "--ink:'+citInk(c.color)", "nl<3&&!clash"):
    assert need in s, "missing after patch: " + need
open(p, "w").write(s)
print("patched", len(s))
