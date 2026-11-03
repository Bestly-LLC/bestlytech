#!/usr/bin/env python3
"""SKYCLEAN2_20261102 patcher on top of SKYCLEAN. usage: p_clean2.py wall.html"""
import sys
path = sys.argv[1]
src = open(path, encoding="utf-8").read()
assert "SKYCLEAN_20261102" in src and "SKYCLEAN2_20261102" not in src
JS = r"""/* ===== SKYCLEAN2_20261102: home + map labels are hard obstacles, bus markers keep off Home, bus card never overlaps ===== */
function skHard(){ const out=[], h=window.__scrHome; if(h) out.push([h[0]-84,h[1]-12,h[2]+84,h[3]+40]); (window.__scrLabBoxes||[]).forEach(b=>out.push(b)); return out; }
function skBusCard(){ const el=document.getElementById('wingBus'); if(!el) return; const card=el.querySelector('.v2bus'); if(!card) return; const rows=[...card.querySelectorAll('.br')]; rows.forEach(r=>{ r.style.display=''; });
  const lim=card.clientHeight-48; for(let i=rows.length-1;i>=0;i--){ const r=rows[i]; if(r.offsetTop+r.offsetHeight<=lim) break; r.style.display='none'; } }
setInterval(()=>{ try{ skBusCard(); }catch(e){ V2.errs++; } },1000);
function skBusMk(){ const h=window.__scrHome; document.querySelectorAll('#airPlanes .v2b').forEach(e=>{ if(!h){ e.style.visibility=''; return; } const r=e.getBoundingClientRect(); e.style.visibility=(r.left<h[2]+110&&r.right>h[0]-110&&r.top<h[3]+50&&r.bottom>h[1]-30)?'hidden':''; }); }
setInterval(()=>{ try{ skBusMk(); }catch(e){ V2.errs++; } },500);
/* ===== end SKYCLEAN2_20261102 ===== */
"""
CSS = """/* SKYCLEAN2_20261102 */
.v2bus .br{height:58px;margin-top:6px}
.v2bus .br.q{height:38px;margin-top:4px}
.v2bus .lv,.v2bus .et{min-width:0}
.apl.sm .in{gap:10px;padding:7px 18px 7px 8px}
.apl.sm .cb{font-size:24px;padding:6px 12px}
.apl.sm .tx b{font-size:23px}
.apl.sm .tx span{display:none}
.apl.xs .tx{display:none}
"""
edits = [
    ("[0,-110],[0,110],[0,-220],[0,220],[-320,0],[320,0],[-320,-110],[320,110],[-320,110],[320,-110]]) cands.push([hv[0]+dx,hv[1]+dy]); for(const t of [.06,.12,.2,.3,.42,.56,.7]){",
     "[0,-110],[0,110],[0,-220],[0,220],[0,-330],[0,330],[0,-440],[0,440]]) cands.push([hv[0]+dx,hv[1]+dy]); for(const t of [.06,.12,.2,.3,.42,.56]){"),
    ("if(skRectOk(rr,poly,[],10)){ pos=[x,y]; rect=rr; break; } } }", "if(skRectOk(rr,poly,skHard(),10)){ pos=[x,y]; rect=rr; break; } } }\n      if(!pos){ e.classList.add('sm'); for(const [x,y] of cands){ if(obD(x,y,0)<10||obD(x,y,1)<10) continue; e.style.transform=skyPt(x,y); const r=inn.getBoundingClientRect(), rr=[r.left,r.top,r.right,r.bottom]; if(skRectOk(rr,poly,skHard(),10)){ pos=[x,y]; rect=rr; break; } } }\n      if(!pos){ e.classList.add('xs'); for(const [x,y] of cands){ if(obD(x,y,0)<10||obD(x,y,1)<10) continue; e.style.transform=skyPt(x,y); const r=inn.getBoundingClientRect(), rr=[r.left,r.top,r.right,r.bottom]; if(skRectOk(rr,poly,skHard(),10)){ pos=[x,y]; rect=rr; break; } } }\n      if(!pos){ for(const [x,y] of cands){ if(obD(x,y,0)<10||obD(x,y,1)<10) continue; e.style.transform=skyPt(x,y); const r=inn.getBoundingClientRect(), rr=[r.left,r.top,r.right,r.bottom]; if(skRectOk(rr,poly,[],10)){ pos=[x,y]; rect=rr; break; } } }"),
    ("if(window.__scrHome) out.push(window.__scrHome); return out; }", "return out.concat(skHard()); }"),
    ("const tq=Q(...apPt(e.la,e.lo,e.h,d,.95)), tf=scrFrame(proj,tq[0],tq[1]); if(tf){", "const tq=Q(...apPt(e.la,e.lo,e.h,d,.95)), tf=(e===pick[0])?scrFrame(proj,tq[0],tq[1]):null; if(tf){"),
    ("const p=airXY(v.lat,v.lng); if(!(obD(p[0],p[1],0)>30&&obD(p[0],p[1],1)>30)) return;",
     "const p=airXY(v.lat,v.lng); if(!(obD(p[0],p[1],0)>30&&obD(p[0],p[1],1)>30)) return; { const hx=AF.hx??AF.cx, hy=AF.hy??AF.my; if(p[0]>hx-140&&p[0]<hx+140&&p[1]>hy-60&&p[1]<hy+120) return; }"),
    ("const cands=[]; const lastP=APX.last[code];", "e.classList.remove('sm','xs'); const cands=[]; const lastP=APX.last[code];"),
    ("{ const taken=(typeof scrObs==='function'?scrObs():[]), ov=", "{ window.__scrLabBoxes=[]; const taken=(typeof scrObs==='function'?scrObs():[]), ov="),
    ("it.skip=1; else taken.push(bx); } }", "it.skip=1; else { taken.push(bx); if(!it.star) window.__scrLabBoxes.push(bx); } } }"),
    (".ac .tag.skx{opacity:0!important}\n", ".ac .tag.skx{opacity:0!important}\n" + CSS),
    ("/* ===== end SKYCLEAN_20261102 ===== */", "/* ===== end SKYCLEAN_20261102 ===== */\n" + JS),
]
for old, new in edits:
    assert src.count(old) == 1, ("anchor", src.count(old), old[:70])
    src = src.replace(old, new)
open(path, "w", encoding="utf-8").write(src)
print("ok", len(src))
