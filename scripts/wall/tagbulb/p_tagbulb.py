import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
assert 'TAGBULB_20261103' not in s

def rep(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:60])
    s = s.replace(old, new)

CSS = r'''
/* TAGBULB_20261103: sky plane tags + edge pills at about 60% size; calibration number grid; keep-clear hiding */
.ac .tag.v2{top:-34px;padding:7px 17px 9px 16px;border-radius:28px;font:800 26.4px/1.1 var(--sf);margin-top:var(--tgdy,0px);
 box-shadow:inset 0 0 9px rgba(255,255,255,.10),0 4px 14px rgba(0,0,0,.5),0 0 calc(10px + 20px*var(--hz,.5)) rgba(120,170,255,calc(.12 + .28*var(--hz,.5)))}
.ac .tag.v2.nt{box-shadow:inset 0 0 9px rgba(255,214,102,.2),0 0 0 2.5px rgba(255,200,80,.92),0 0 16px 4px rgba(255,200,80,.4),0 4px 14px rgba(0,0,0,.5)}
.ac .tag.v2 span{margin-top:1px}
.ac .tag.v2 em{padding:2px 9px;margin-left:10px;box-shadow:0 0 10px rgba(255,196,64,.7)}
.ac .tag.v2.lgo{gap:11px}
.ac .tag.v2 .lg{font-size:13px}
.ac .tag.v2 .lgw[style*="width:56px"],.ac .tag.v2 .lgw[style*="width:56px"] .lg,.ac .tag.v2 .lgw[style*="width:56px"] .lg img{width:34px!important;height:34px!important}
.ac .tag.v2 .lgw[style*="width:50px"],.ac .tag.v2 .lgw[style*="width:50px"] .lg,.ac .tag.v2 .lgw[style*="width:50px"] .lg img{width:30px!important;height:30px!important}
.ac .tag.v2 .pb{right:-6px;bottom:-6px;width:18px;height:18px;box-shadow:0 0 0 1.5px #0e1320}
.ac .tag.v2 .pb svg{width:11px;height:11px}
.v2e .in{gap:8px;padding:6px 13px 6px 14px;border-radius:26px;font:800 22px/1 var(--sf);box-shadow:inset 0 0 8px rgba(255,255,255,.1),0 3px 11px rgba(0,0,0,.5),0 0 17px rgba(120,170,255,.3)}
.v2e svg{width:23px;height:23px;flex:none}
.ac .tag:not(.v2){top:-19px;font-size:30px;margin-top:var(--tgdy,0px)}
.tgbh{visibility:hidden!important}
#tgbGrid{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:3000;display:grid;grid-template-columns:repeat(10,1fr);grid-template-rows:repeat(6,1fr);pointer-events:none;background:transparent}
#tgbGrid[hidden]{display:none}
#tgbGrid i{display:flex;align-items:center;justify-content:center;box-sizing:border-box;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.55);font:800 60px/1 var(--sf);font-style:normal;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 0 12px rgba(0,0,0,.9);white-space:nowrap}
#tgbGrid b{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);padding:5px 22px;border-radius:30px;background:rgba(0,0,0,.78);font:700 24px/1.2 var(--sf);color:#fff;white-space:nowrap;box-shadow:0 0 18px 6px rgba(0,0,0,.6)}
'''

JS = r'''
/* ===== TAGBULB_20261103: keep-clear zones (state.avoid) + numbered calibration grid (state.calNums) ===== */
var TGB={z:[],gOn:false,gT:0,errs:0,wing:[],hid:0,moved:0};
function tgbZones(){ const W=innerWidth,H=innerHeight; return ((TGB&&TGB.z)||[]).map(c=>[c.x*W,c.y*H,c.r*W]); }
function tgbRects(){ return tgbZones().map(([x,y,r])=>[x-r,y-r,x+r,y+r]); }
function tgbCirc(r,m){ m=m||0; return tgbZones().some(([x,y,rr])=>{ const nx=Math.max(r[0],Math.min(x,r[2])), ny=Math.max(r[1],Math.min(y,r[3])); return Math.hypot(nx-x,ny-y)<rr+m; }); }
function tgbRead(){ const a=S.avoid, z=[]; if(Array.isArray(a)) a.slice(0,6).forEach(c=>{ if(c&&isFinite(c.x)&&isFinite(c.y)&&isFinite(c.r)&&c.r>=.005&&c.r<=.25) z.push({x:+c.x,y:+c.y,r:+c.r}); });
  const k=JSON.stringify(z); if(k!==TGB.k){ TGB.k=k; TGB.z=z; try{ SCRL.sig=''; }catch(e){} } }
{ const _h=skHard; skHard=function(){ return _h().concat(tgbRects()); }; }
{ const _s=skStarHit; skStarHit=function(bx){ return _s(bx)||tgbCirc(bx,4); }; }
function tgbTags(){ const poly=skPoly(); if(!poly) return; const zs=tgbZones(), now=performance.now();
  const pill=(APX.pillBoxes||[]).map(r=>[r[0]-4,r[1]-4,r[2]+4,r[3]+4]);
  document.querySelectorAll('#airPlanes .v2e .in').forEach(e=>{ const r=e.getBoundingClientRect(); pill.push([r.left-4,r.top-4,r.right+4,r.bottom+4]); });
  Object.values(AIRS).forEach(o=>{ try{ const t=o.tagEl; if(!t) return;
    if(!zs.length||!o.shown){ if(o._tgdy){ o._tgdy=0; t.style.removeProperty('--tgdy'); } o._tgf=0; return; }
    const test=()=>{ const r=t.getBoundingClientRect(); if(!r.width) return true; const rr=[r.left,r.top,r.right,r.bottom]; return !tgbCirc(rr,10)&&skRectOk(rr,poly,pill,6); };
    const setDy=d=>{ o._tgdy=d; t.style.setProperty('--tgdy',d+'px'); };
    const side=l=>{ o._skf=l?'l':'r'; o._skfT=now; o._lft=l; o.el.classList.toggle('lft',l); };
    t.classList.remove('skx'); const cur=!!o._lft; setDy(0);
    if(test()){ if(o._tgf) o._skfT=now; return; }
    const dys=[0,-24,24,-48,48,-76,76,-110,110,-150,150,-200,200];
    for(const dy of dys) for(const l of [cur,!cur]){ if(dy===0&&l===cur) continue; side(l); setDy(dy); if(test()){ o._tgf=1; TGB.moved++; return; } }
    side(cur); setDy(0); t.classList.add('skx'); o._tgf=0;
  }catch(e){ TGB.errs++; V2.errs++; } }); }
{ const _sk=skTags; skTags=function(){ _sk(); tgbTags(); }; }
setInterval(()=>{ try{ tgbRead(); tgbTags(); }catch(e){ TGB.errs++; V2.errs++; } },300);
function tgbSweep(){ const zs=tgbZones(); let n=0;
  document.querySelectorAll('#airPlanes .apl .in,#airPlanes .v2e .in,#airPlanes .v2b .bd,#airPlanes .v2b .lb').forEach(e=>{ const h=e.closest('.apl,.v2e,.v2b')||e; let hit=false; if(zs.length){ const r=e.getBoundingClientRect(); hit=r.width>0&&tgbCirc([r.left,r.top,r.right,r.bottom],4); } if(hit) n++; h.classList.toggle('tgbh',hit); });
  TGB.hid=n; const wl=[];
  document.querySelectorAll('#wing .slot-sig').forEach(e=>{ let hit=false; if(zs.length){ const r=e.getBoundingClientRect(); hit=r.width>0&&tgbCirc([r.left,r.top,r.right,r.bottom],0); } e.classList.toggle('tgbh',hit); });
  ['wingFlight','wingKey','wingBus','wingAlerts','wingAp'].forEach(id=>{ const e=document.getElementById(id); if(!e||!zs.length) return; const r=e.getBoundingClientRect(); if(r.width>0&&+getComputedStyle(e).opacity>.05&&tgbCirc([r.left,r.top,r.right,r.bottom],0)) wl.push(id); }); TGB.wing=wl; }
setInterval(()=>{ try{ tgbSweep(); }catch(e){ TGB.errs++; V2.errs++; } },500);
function tgbGrid(){ let el=document.getElementById('tgbGrid'); const on=!!S.calNums;
  if(on&&!TGB.gOn){ TGB.gOn=true; TGB.gT=Date.now(); } if(!on) TGB.gOn=false;
  const show=on&&Date.now()-TGB.gT<300000;
  if(!show){ if(el&&!el.hidden) el.hidden=true; return; }
  if(!el){ el=document.createElement('div'); el.id='tgbGrid'; let h=''; for(let i=1;i<=60;i++) h+='<i>'+i+'</i>'; el.innerHTML=h+'<b>Which numbers does the light cover? Tell Claude.</b>'; document.body.appendChild(el); }
  if(el.hidden) el.hidden=false; }
setInterval(()=>{ try{ tgbGrid(); }catch(e){ TGB.errs++; } },500);
window.__tgb=()=>({zones:TGB.z,grid:!!(document.getElementById('tgbGrid')&&!document.getElementById('tgbGrid').hidden),errs:TGB.errs,hidden:TGB.hid,moved:TGB.moved,wingHit:TGB.wing});
/* ===== end TAGBULB_20261103 ===== */
'''

rep('.v2e svg{width:38px;height:38px;flex:none}\n', '.v2e svg{width:38px;height:38px;flex:none}\n' + CSS)
rep('hh=o._v2?60:34', 'hh=o._v2?38:22')
rep('function scrObs(){ const out=[]; try{', 'function scrObs(){ const out=(typeof tgbRects===\'function\'?tgbRects():[]); try{')
rep('/* ===== end SKYCLEAN2_20261102 ===== */\n', '/* ===== end SKYCLEAN2_20261102 ===== */\n' + JS)
open(dst, 'w').write(s)
print('ok')
