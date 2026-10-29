#!/usr/bin/env python3
"""Wall v5: left panel fit, soft-edged scrolling lines, dimmer roads, white plane names, nearest 4 freeway shields,
city names capped at 1.5x stretch. Needs v4 applied. Re-runnable. usage: patch_wall_v5.py wall.html v5_css.txt v5_js.txt"""
import sys

p, css_p, js_p = sys.argv[1:4]
s = open(p, encoding="utf-8", newline="").read()
css, js = open(css_p, encoding="utf-8").read(), open(js_p, encoding="utf-8").read()
assert "function citCard" in s, "v4 not applied yet"

def put_block(s, start_marker, end_marker, block, anchor, before=True):
    i = s.find(start_marker)
    if i >= 0:
        j = s.index(end_marker, i) + len(end_marker)
        return s[:i] + block + s[j:]
    k = s.index(anchor)
    if not before:
        k += len(anchor)
    return s[:k] + block + s[k:]

s = put_block(s, "/* Wall v5 (Oct 29", "#airScrP .ac .tag,#air .ac .tag{color:#fff!important;font-weight:800;}\n", css.rstrip("\n") + "\n",
              "#airScrP .ac .tag.decl{opacity:0!important;}\n", before=False)
s = put_block(s, "  /* Wall v5 (Oct 29): left panel", "  setInterval(leftFit,500);\n", js.rstrip("\n") + "\n",
              "  // Sky key lives on the sign wall now")

# scrolling lines: the travel distance covers the wider right fade
a = "const d=Math.ceil(sp.offsetWidth-el.clientWidth)+30, t=Math.max(6,3+d/45);"
if a in s:
    s = s.replace(a, "const d=Math.ceil(sp.offsetWidth-el.clientWidth)+52, t=Math.max(6,3+d/45);", 1)

# freeway shields: only the 4 nearest to Home (was 10-14 scattered across the sky)
a = "cap=[R>=18?10:14,18,16,22]"
if a in s:
    s = s.replace(a, "cap=[4,18,16,22]", 1)
a = "    for(const [c,kind,text,la,lo,dla,dlo] of ROADS.lab){"
if a in s:
    s = s.replace(a, "    const labS=(ROADS._labK===airHome.join()&&ROADS._labS)?ROADS._labS:(ROADS._labK=airHome.join(),ROADS._labS=[...ROADS.lab].sort((p,q)=>(p[0]-q[0])||(Math.hypot(p[3]-airHome[0],(p[4]-airHome[1])*.83)-Math.hypot(q[3]-airHome[0],(q[4]-airHome[1])*.83))));\n"
                     "    for(const [c,kind,text,la,lo,dla,dlo] of labS){", 1)

# freeway shields also steer around plane name tags and alert dots (Home and place names were already obstacles)
a = "    document.querySelectorAll('#airLand text, #airSpots b, #airCel text').forEach(el=>{ const r=el.getBoundingClientRect(); if(r.width) boxes.push([r.left-6,r.top-4,r.right+6,r.bottom+4]); });"
if a in s and "scrObs().forEach(b=>boxes.push(b))" not in s:
    s = s.replace(a, a + "\n    try{ if(typeof scrObs==='function') scrObs().forEach(b=>boxes.push(b)); }catch(_){}", 1)

# city names: the far-edge stretch is capped at 1.5x (was up to 3x, so TORRANCE / LONG BEACH ran huge)
a = "const ii=inner(r.left+r.width/2,r.top+r.height/2); if(!ii) continue; const fr=scrFrame(proj,ii[0],ii[1]); if(!fr) continue;"
if a in s and "fr.r>1.5" not in s:
    s = s.replace(a, a + " if(el.closest('#airLand')&&fr.r>1.5){ const k=1.5/fr.r; fr.f=[fr.f[0]*k,fr.f[1]*k,fr.f[2],fr.f[3]]; fr.r=1.5; }", 1)

for need in ("Wall v5 (Oct 29", "function leftFit", "+52, t=Math.max", "cap=[4,18,16,22]", "const labS=", "fr.r>1.5", "scrObs().forEach(b=>boxes.push(b))"):
    assert need in s, "missing after patch: " + need
open(p, "w", encoding="utf-8", newline="").write(s)
print("patched", len(s))
