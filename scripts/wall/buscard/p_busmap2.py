#!/usr/bin/env python3
"""PREVIEW ONLY: builds wall.proto2.html = live wall.html + BUSMAP2 (busmap2_proto.js). The live wall.html is never touched.
usage: p_busmap2.py in.html out.html busmap2_proto.js"""
import re, subprocess, sys, tempfile, os
src, dst, js = sys.argv[1:4]
s = open(src).read(); blk = open(js).read()
assert 'BUSMAP2_20261103' not in s and 'WAVE1_20261102' in s
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)
# 1. radius: BMZ.t = the zoomed radius (integer) reported by RADMI(); BMZ.r = the animated value used only for the map scale (airFit)
rep("const RADMI=()=>{ const r=Math.round(+S.airRadiusMi); return r>=2&&r<=25?r:15; };",
    "var BMZ={r:0,t:0,anim:false}; /* BUSMAP2 */ const RADMI=()=>{ if(BMZ.t) return BMZ.t; const r=Math.round(+S.airRadiusMi); return r>=2&&r<=25?r:15; };")
rep("AIR_VIEW_NM=RADMI()/1.1508; const ppn0=AF.ppn;", "AIR_VIEW_NM=(BMZ.r||RADMI())/1.1508; const ppn0=AF.ppn;")
rep("setInterval(()=>{ try{ if(HOME.anim) return; const r=skyAudit();", "setInterval(()=>{ try{ if(HOME.anim||BMZ.anim) return; const r=skyAudit();")
a = "/* ===== end WAVE1_20261102 ===== */\n"
rep(a, a + blk)
h = "    try{ apDraw(c,proj,kp,now); }catch(e){ V2.errs++; }   /* SKYAP_20261102 */"
rep(h, h + "\n    try{ bmDraw(c,proj,kp,now); }catch(e){ V2.errs++; BM2.errs++; BM2.err=String(e&&e.stack||e); }   /* BUSMAP2 */")
open(dst, 'w').write(s)
for m in re.finditer(r'<script(?![^>]*src)[^>]*>(.*?)</script>', s, re.S):
    if 'BUSMAP2_20261103' in m.group(1):
        f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False); f.write(m.group(1)); f.close()
        r = subprocess.run(['node', '--check', f.name], capture_output=True, text=True); os.unlink(f.name)
        print('node --check rc', r.returncode, r.stderr[:400]); assert r.returncode == 0
print('ok')
