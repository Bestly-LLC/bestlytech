#!/usr/bin/env python3
"""SHIP3_20261103: Local alerts rotation + bus map on the sky + narrow plane card. Anchored patches, each asserts count == 1.
usage: p_ship3.py in.html out.html"""
import re, subprocess, sys, tempfile, os
here = os.path.dirname(os.path.abspath(__file__))
src, dst = sys.argv[1:3]
s = open(src).read()
assert 'SHIP3_20261103' not in s and 'WINGSWAP_20261103' in s
def rd(n): return open(os.path.join(here, n)).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, ('anchor count', s.count(old), old[:70])
    s = s.replace(old, new)
# bus map hooks: BMZ.t = zoomed radius reported by RADMI(); BMZ.r = animated radius used by airFit; skyAudit paused while animating; drawTrails hook
rep("const RADMI=()=>{ const r=Math.round(+S.airRadiusMi); return r>=2&&r<=25?r:15; };",
    "var BMZ={r:0,t:0,anim:false}; /* SHIP3 */ const RADMI=()=>{ if(BMZ.t) return BMZ.t; const r=Math.round(+S.airRadiusMi); return r>=2&&r<=25?r:15; };")
rep("AIR_VIEW_NM=RADMI()/1.1508; const ppn0=AF.ppn;", "AIR_VIEW_NM=(BMZ.r||RADMI())/1.1508; const ppn0=AF.ppn;")
rep("setInterval(()=>{ try{ if(HOME.anim) return; const r=skyAudit();", "setInterval(()=>{ try{ if(HOME.anim||BMZ.anim) return; const r=skyAudit();")
h = "    try{ apDraw(c,proj,kp,now); }catch(e){ V2.errs++; }   /* SKYAP_20261102 */"
rep(h, h + "\n    try{ bmDraw(c,proj,kp,now); }catch(e){ V2.errs++; BM2.errs++; BM2.err=String(e&&e.stack||e); }   /* SHIP3 bus map */")
# Local alerts: hand the list to the rotating renderer (falls back to the old 2-row card if it throws)
rep("    const rows=list.slice(0,2).map(i=>{ const c=CIT.reg[i.cat];",
    "    try{ s3AlSet(el,list,isNew); return; }catch(e){ window.__citCardErr='s3al: '+String((e&&e.message)||e); }   /* SHIP3 */\n    const rows=list.slice(0,2).map(i=>{ const c=CIT.reg[i.cat];")
# plane card: keep the original label / operator text so the narrow fit can start from the full title every time
rep("{ const _p=passSet; passSet=function(wf,d){ _p(wf,d); bbFitText(wf); }; }",
    "{ const _p=passSet; passSet=function(wf,d){ _p(wf,d); try{ wf._s3=(d&&d.v2&&d.t)?{fl:d.t.fl2,sub:d.t.sub2}:null; }catch(e){} bbFitText(wf); }; }   /* SHIP3 */")
# wsSig: the signature's own text rect can be a few px taller than its box (skewed pin), so it counted itself as an obstacle and climbed to the top; widen the "this is me" tolerance
rep("r[0]>=sr.left-2&&r[2]<=sr.right+2&&r[1]>=sr.top-2&&r[3]<=sr.bottom+2", "r[0]>=sr.left-8&&r[2]<=sr.right+8&&r[1]>=sr.top-8&&r[3]<=sr.bottom+8")
blk = ("\n/* ===== SHIP3_20261103: (1) Local alerts rotate through all alerts, (2) bus map + zoom during leave-by, (3) narrow plane card title + layout ===== */\n"
       "const S3={errs:0};\n" + rd('s3_alerts.js') + "\n" + rd('s3_bus1.js') + rd('s3_bus2.js') + rd('s3_bus3.js') + "\n" + rd('s3_plane.js') +
       "\nwindow.__s3=()=>({errs:S3.errs,al:window.__s3al(),bm:window.__bm2(),pl:window.__s3pl()});\n/* ===== end SHIP3_20261103 ===== */\n")
a = "/* ===== end WINGSWAP_20261103 ===== */\n"
rep(a, a + blk)
open(dst, 'w').write(s)
for m in re.finditer(r'<script(?![^>]*src)[^>]*>(.*?)</script>', s, re.S):
    if 'SHIP3_20261103' in m.group(1):
        f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False); f.write(m.group(1)); f.close()
        r = subprocess.run(['node', '--check', f.name], capture_output=True, text=True); os.unlink(f.name)
        print('node --check rc', r.returncode, r.stderr[:600]); assert r.returncode == 0
print('ok', s.count('SHIP3_20261103'))
