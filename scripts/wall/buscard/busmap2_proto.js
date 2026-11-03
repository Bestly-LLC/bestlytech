/* ===== BUSMAP2_20261103: buses on the sky map during leave-by (PREVIEW ONLY, never shipped to wall.html) =====
   Shown only while a bus on his lines (10, 4, 105 toward LAX) is inside the leave-by window (leave-by within 5 min, or Leave now) and has a live position.
   Draws: line-color pill (number + arrow turned to the real travel bearing) with minutes to HIS stop under it, his stop as a small transit-stop marker,
   the bus -> stop piece of the route (55%, feathered ends) and the real OSM walk path Home -> stop (gold, soft glow). Zooms the sky in (about 3 mi) while active.
   Needs (same closure): V2, S, AF, AP/APX, airXY, airHome, skyPt, pjNow, skPoly, skRectOk, skPlaneObs, skSkyBox, skRects, apPills, apOn, w1Rows, w1Snap, w1Home, effMode, NBP,
   plus BMZ / RADMI / airFit hooks from p_busmap2.py. Hooked into drawTrails (bmDraw) and apPills (bmPlace). */
const BM2={els:{},sel:null,lastSel:null,errs:0,a:0,t:0,off:{},pr:{},gi:{}};
const BML2={'10':'225,103,16','4':'225,103,16','105':'225,103,16'};   /* Metro orange = the bus card badge #E16710 */
(function(){ const css=document.createElement('style'); css.id='bm2css'; css.textContent=`
#airPlanes .bm2{position:absolute;left:0;top:0;width:0;height:0;will-change:transform;opacity:0;transition:opacity .3s ease-out;pointer-events:none}
#airPlanes .bm2.on{opacity:1}
#airPlanes .bm2 .col{position:absolute;left:0;top:-27px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px}
#airPlanes .bm2 .pl{box-sizing:border-box;height:54px;display:flex;align-items:center;gap:8px;padding:0 16px 0 24px;border-radius:27px;white-space:nowrap;color:#fff;font:800 36px/1 var(--sf);
 background:linear-gradient(180deg,color-mix(in srgb,var(--c) 90%,#fff),var(--c));box-shadow:inset 0 0 12px rgba(255,255,255,.16),0 4px 18px rgba(0,0,0,.5),0 0 34px 6px rgba(var(--r),.34)}
#airPlanes .bm2 .pl b{font:inherit;font-style:normal}
#airPlanes .bm2 .pl svg{width:28px;height:28px;flex:none}
#airPlanes .bm2 .mn{font:800 34px/1 var(--sf);color:#fff;white-space:nowrap;text-shadow:0 0 14px rgba(0,0,0,.95),0 0 5px rgba(0,0,0,.9)}
@media (prefers-reduced-motion:reduce){ #air,#airScrP,#airScrR,#airScrS,#airScrTr,#airScrL,#airTerr,#airRad,#airLand,#airCel{transition:opacity .22s ease} #airPlanes .bm2{transition:none} }
body.bmcf #air,body.bmcf #airScrP,body.bmcf #airScrR,body.bmcf #airScrS,body.bmcf #airScrTr,body.bmcf #airScrL,body.bmcf #airTerr,body.bmcf #airRad,body.bmcf #airLand,body.bmcf #airCel{opacity:0!important}`;
  document.head.appendChild(css); })();
/* ---- geometry: bus and stop on the route shape (GTFS shape from the collector, in travel direction) ---- */
const BMC=new WeakMap();
function bmFt(a,b){ return Math.hypot((a[0]-b[0])*364000,(a[1]-b[1])*364000*Math.cos(a[0]*Math.PI/180)); }
function bmCum(rt){ let c=BMC.get(rt); if(!c){ c=[0]; for(let i=1;i<rt.length;i++) c.push(c[i-1]+bmFt(rt[i-1],rt[i])); BMC.set(rt,c); } return c; }
function bmProj(rt,cum,p){ const kx=364000*Math.cos(p[0]*Math.PI/180), ky=364000; let best=null;
  for(let i=0;i<rt.length-1;i++){ const ax=(rt[i][1]-p[1])*kx, ay=(rt[i][0]-p[0])*ky, bx=(rt[i+1][1]-p[1])*kx, by=(rt[i+1][0]-p[0])*ky, dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy||1e-9;
    let t=-(ax*dx+ay*dy)/L; t=Math.max(0,Math.min(1,t)); const d=Math.hypot(ax+dx*t,ay+dy*t); if(!best||d<best.d) best={d:d,i:i,s:cum[i]+t*Math.sqrt(L)}; }
  return best; }
function bmAt(rt,cum,s){ let i=0; while(i<rt.length-2&&cum[i+1]<s) i++; const L=(cum[i+1]-cum[i])||1, t=Math.max(0,Math.min(1,(s-cum[i])/L));
  return [rt[i][0]+(rt[i+1][0]-rt[i][0])*t,rt[i][1]+(rt[i+1][1]-rt[i][1])*t,i]; }
/* bus position (advanced along the shape by speed x age of the report), the piece of route from the bus to his stop, seconds-free: null when the bus is off its route or already at / past his stop */
function bmGeo(it,now){ const x=it.x, v=it.v, rt=(it.b.routes||{})[x.k+':'+x.r.dir_id]; if(!rt||rt.length<2) return null; const cum=bmCum(rt);
  const sp=bmProj(rt,cum,[x.r.stop_lat,x.r.stop_lon]), bp=bmProj(rt,cum,[v.lat,v.lng]); if(!sp||!bp||bp.d>400||bp.s>sp.s-25) return null;
  let s=bp.s; if(v.at&&v.mph) s+=Math.min(45,Math.max(0,(now-v.at)/1000))*v.mph*1.4667; s=Math.min(s,sp.s-30);
  const pos=bmAt(rt,cum,s), pts=[[pos[0],pos[1]]]; for(let j=pos[2]+1;j<rt.length&&cum[j]<sp.s;j++) pts.push(rt[j]); const e=bmAt(rt,cum,sp.s); pts.push([e[0],e[1]]);
  return {bus:[pos[0],pos[1]],pts:pts,stop:[x.r.stop_lat,x.r.stop_lon]}; }
/* ---- selection: his lines only, next bus per line (w1Rows), inside the leave-by window, with a live position; max 2 ---- */
function bmSel(){ try{ const now=Date.now(), b=w1Snap(); let out=[];
    if(b&&b.lines&&w1Home()&&effMode()!=='off'){ const veh=b.vehicles||[];
      w1Rows(now).forEach(x=>{ if(x.k!=='10'&&x.k!=='4'&&x.k!=='105') return; if(x.leave-now>5*60000||x.eta<now-15000||!x.a.trip) return;
        const v=veh.find(q=>q.trip_id===x.a.trip&&q.lat!=null); if(!v) return; const it={x:x,v:v,b:b,k:x.k,id:x.k+'|'+x.a.trip}; it.g=bmGeo(it,now); if(it.g) out.push(it); }); }
    out.sort((p,q)=>p.x.leave-q.x.leave); out=out.slice(0,2);
    BM2.sel=out.length?{items:out,b:b}:null; if(BM2.sel) BM2.lastSel=BM2.sel;
    bmZoomCtl(); bmEls(); }catch(e){ BM2.errs++; V2.errs++; BM2.err=String(e&&e.stack||e); } }
setInterval(bmSel,250);
const bmDeg=t=>{ const b=AF.brg||0, e=Math.sin((t||0)*Math.PI/180), n=Math.cos((t||0)*Math.PI/180); return Math.atan2(e*Math.sin(b)+n*Math.cos(b),e*Math.cos(b)-n*Math.sin(b))*180/Math.PI; };
function bmEls(){ const box=$('#airPlanes'); if(!box||!AF.ppn) return; const S=BM2.sel, keep={}, now=Date.now(); let made=false;
  if(S) S.items.forEach(it=>{ keep[it.id]=1; let e=BM2.els[it.id];
    if(!e){ e=document.createElement('div'); e.className='bm2'; e.style.setProperty('--c','rgb('+BML2[it.k]+')'); e.style.setProperty('--r',BML2[it.k]);
      e.innerHTML='<div class="col"><div class="pl"><b></b><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" d="M8 4l8 8-8 8"/></svg></div><div class="mn"></div></div>'; box.appendChild(e); BM2.els[it.id]=e; made=true; }
    clearTimeout(e._rm); const mn=e.querySelector('.mn'), tx=Math.max(0,Math.round((it.x.eta-now)/60000))+NBP+'min', bb=e.querySelector('b'); if(mn.textContent!==tx) mn.textContent=tx; if(bb.textContent!==it.k) bb.textContent=it.k;
    e.querySelector('svg').style.transform='rotate('+bmDeg(it.v.bearing).toFixed(0)+'deg)'; });
  Object.keys(BM2.els).forEach(k=>{ if(!keep[k]){ const e=BM2.els[k]; e.classList.remove('on'); delete BM2.els[k]; delete BM2.off[k]; delete BM2.gi[k]; e._rm=setTimeout(()=>e.remove(),400); } });
  if(made) bmPlace(); }
/* ---- label collision: pills sit on the bus; they move (leader line back to the bus) only to clear Home, map labels, plane tags / icons, airport and edge chips, the other pill and the stops ---- */
/* candidates in SCREEN units (pill width W / height H, measured), nearest first; converted to sky offsets with the local frame so a pill never jumps far from its bus */
const BMGRID=(()=>{ const o=[]; [0,.25,-.25,.5,-.5,.75,-.75,1,-1,1.25,-1.25,1.5,-1.5,2,-2].forEach(x=>[0,-.6,.6,-1.2,1.2,-1.8,1.8,-2.4,2.4].forEach(y=>o.push([x,y]))); return o.sort((p,q)=>Math.hypot(p[0]*.7,p[1])-Math.hypot(q[0]*.7,q[1])); })();
function bmPlace(){ try{ const S=BM2.sel; if(!S) return; const P=pjNow(), poly=skPoly(); if(!P.proj||!poly) return; const pad=(r,m)=>[r[0]-(m||6),r[1]-(m||6),r[2]+(m||6),r[3]+(m||6)];
    const soft=skPlaneObs().concat((APX.pillBoxes||[]).filter(r=>!r.bm).map(r=>pad(r))); document.querySelectorAll('#airPlanes .v2e .in').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.width) soft.push(pad([r.left,r.top,r.right,r.bottom])); });
    const hard=skHard().slice(); S.items.forEach(it=>{ const q=airXY(it.g.stop[0],it.g.stop[1]), s=P.proj(q[0],q[1]); if(s) hard.push([s[0]-22,s[1]-22,s[0]+22,s[1]+22]); });
    const placed=[]; APX.pillBoxes=(APX.pillBoxes||[]).filter(r=>!r.bm);
    S.items.forEach(it=>{ const e=BM2.els[it.id]; if(!e) return; const col=e.firstChild, g=bmGeo(it,Date.now())||it.g, a=airXY(g.bus[0],g.bus[1]);
      const rect=()=>{ const r=col.getBoundingClientRect(); return [r.left,r.top,r.right,r.bottom]; };
      e.style.transform=skyPt(a[0],a[1]); const r0=rect(), W=r0[2]-r0[0], H=r0[3]-r0[1], p0=P.proj(a[0],a[1]), px=P.proj(a[0]+10,a[1]), py=P.proj(a[0],a[1]+10); if(!p0||!px||!py) return;
      const m11=(px[0]-p0[0])/10, m21=(px[1]-p0[1])/10, m12=(py[0]-p0[0])/10, m22=(py[1]-p0[1])/10, det=m11*m22-m12*m21||1e-9;
      const toSky=(sx,sy)=>[(m22*sx-m12*sy)/det,(-m21*sx+m11*sy)/det];
      const mine=hard.concat(S.items.filter(q=>q!==it&&(q.gf||q.g)).map(q=>{ const gg=q.gf||q.g, z=airXY(gg.bus[0],gg.bus[1]), d=P.proj(z[0],z[1]); return d?[d[0]-16,d[1]-16,d[0]+16,d[1]+16]:[0,0,0,0]; }));
      const test=(o,ob)=>{ e.style.transform=skyPt(a[0]+o[0],a[1]+o[1]); const rr=rect(); return skRectOk(pad(rr,4),poly,ob,8)?rr:null; };
      const cand=BMGRID.map(c=>toSky(c[0]*W,c[1]*H)), hs=mine.concat(placed), all=hs.concat(soft), cost=i=>Math.hypot(BMGRID[i][0]*.7,BMGRID[i][1]); let pos=null, rr=null, bi=-1;
      for(let i=0;i<cand.length;i++){ const r=test(cand[i],all); if(r){ pos=cand[i]; rr=r; bi=i; break; } }
      const pg=BM2.gi[it.id]; if(pg!=null&&pg!==bi){ const r=test(cand[pg],all); if(r&&(bi<0||cost(pg)<=cost(bi)+.5)){ pos=cand[pg]; rr=r; bi=pg; } }   /* keep last spot unless a clearly closer one is free */
      if(!pos){ for(let i=0;i<cand.length;i++){ const r=test(cand[i],hs); if(r){ pos=cand[i]; rr=r; bi=i; break; } } }
      if(!pos){ pos=[0,0]; bi=0; e.style.transform=skyPt(a[0],a[1]); rr=rect(); }
      BM2.gi[it.id]=bi;
      e.style.transform=skyPt(a[0]+pos[0],a[1]+pos[1]); BM2.off[it.id]=pos; const pr=e.querySelector('.pl').getBoundingClientRect(); BM2.pr[it.id]=[pr.left,pr.top,pr.right,pr.bottom];
      placed.push(pad(rr)); const bx=rr.slice(); bx.bm=1; APX.pillBoxes.push(bx); e.classList.add('on'); });
  }catch(e){ BM2.errs++; V2.errs++; BM2.err=String(e&&e.stack||e); } }
{ const _ap=apPills; apPills=function(){ _ap.apply(this,arguments); bmPlace(); }; }
v2BusMarkers=function(){ document.querySelectorAll('#airPlanes .v2b').forEach(e=>e.remove()); V2.bels={}; };   /* the always-on vehicle markers are replaced by this leave-by layer */
/* ---- canvas (from drawTrails): walk path, route piece, stop markers, leaders. Screen-space strokes like the runways; stop marker is a true round 18 px circle ---- */
function bmDraw(c,proj,kp,now){ const pn=performance.now(), dt=BM2.t?Math.min(.1,(pn-BM2.t)/1000):0; BM2.t=pn;
  BM2.a=Math.max(0,Math.min(1,BM2.a+(BM2.sel?1:-1)*dt/.3)); const S=BM2.sel||(BM2.a>0?BM2.lastSel:null); if(!S||BM2.a<=0) return;
  const ea=BM2.a*BM2.a*(3-2*BM2.a), wall=Date.now(), P=(la,lo)=>{ const q=airXY(la,lo); return proj(q[0],q[1]); };
  S.items.forEach(it=>{ const g=bmGeo(it,wall)||it.g; it.gf=g; const e=BM2.els[it.id], o=BM2.off[it.id]; if(e&&o&&g){ const q=airXY(g.bus[0],g.bus[1]); e.style.transform=skyPt(q[0]+o[0],q[1]+o[1]); } });
  c.save(); c.globalAlpha=ea; c.lineCap='round'; c.lineJoin='round';
  const path=pts=>{ c.beginPath(); pts.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])); };
  /* 1. walk path Home -> the soonest stop, real OSM foot route, gold with a soft feathered glow */
  { const it=S.items[0], w=it.b.walks&&it.b.walks[(it.x.r.agency||'metro')+':'+it.x.r.stop_id];
    if(w&&w.geom&&w.geom.length>1&&it.gf){ let pts=[P(airHome[0],airHome[1])].concat(w.geom.map(p=>P(p[0],p[1])),[P(it.gf.stop[0],it.gf.stop[1])]);
      if(pts.every(Boolean)){ { const q=pts[1], h=pts[0], d=Math.hypot(q[0]-h[0],q[1]-h[1]); if(d>34){ const k=15/d; pts[0]=[h[0]+(q[0]-h[0])*k,h[1]+(q[1]-h[1])*k]; } } pts=pts.filter((p,i)=>!i||Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1])>1.5); c.save(); c.shadowOffsetX=0; c.shadowOffsetY=0;
        c.shadowColor='rgba(255,196,64,.55)'; c.shadowBlur=18; c.strokeStyle='rgba(255,196,64,.45)'; c.lineWidth=5; path(pts); c.stroke();
        c.shadowColor='rgba(255,196,64,.7)'; c.shadowBlur=7; c.strokeStyle='#FFC440'; c.lineWidth=5; path(pts); c.stroke(); c.restore(); } } }
  /* 2. route: only bus -> his stop, line color 55%, 4 px, both ends feathered (about 26 px) */
  S.items.forEach(it=>{ const g=it.gf; if(!g) return; const pts=g.pts.map(p=>P(p[0],p[1])); if(pts.some(q=>!q)) return; const a=pts[0], z=pts[pts.length-1], len=Math.hypot(z[0]-a[0],z[1]-a[1]); if(len<8) return;
    const col=BML2[it.k], f=Math.min(.3,26/len), gr=c.createLinearGradient(a[0],a[1],z[0],z[1]);
    gr.addColorStop(0,`rgba(${col},0)`); gr.addColorStop(f,`rgba(${col},.55)`); gr.addColorStop(1-f,`rgba(${col},.55)`); gr.addColorStop(1,`rgba(${col},0)`);
    c.strokeStyle=gr; c.lineWidth=4; path(pts); c.stroke(); });
  /* 3. his stop(s): feathered glow, white 3 px ring, dark fill, line-color dot (18 px across) */
  S.items.forEach(it=>{ const g=it.gf; if(!g) return; const s=P(g.stop[0],g.stop[1]); if(!s) return; const col=BML2[it.k], rg=c.createRadialGradient(s[0],s[1],0,s[0],s[1],34);
    rg.addColorStop(0,`rgba(${col},.4)`); rg.addColorStop(.5,`rgba(${col},.14)`); rg.addColorStop(1,`rgba(${col},0)`); c.fillStyle=rg; c.beginPath(); c.arc(s[0],s[1],34,0,6.2832); c.fill();
    c.beginPath(); c.arc(s[0],s[1],7.5,0,6.2832); c.fillStyle='#10141c'; c.fill(); c.lineWidth=3; c.strokeStyle='#fff'; c.stroke();
    c.beginPath(); c.arc(s[0],s[1],3.4,0,6.2832); c.fillStyle=`rgb(${col})`; c.fill(); });
  /* 4. leader from the true bus spot to a pill that had to move off it (only when the pill no longer covers the bus) */
  S.items.forEach(it=>{ const g=it.gf, r=BM2.pr[it.id]; if(!g||!r) return; const q=airXY(g.bus[0],g.bus[1]), a=proj(q[0],q[1]); if(!a) return;
    const bx=Math.max(r[0],Math.min(r[2],a[0])), by=Math.max(r[1],Math.min(r[3],a[1])); if(Math.hypot(bx-a[0],by-a[1])<14) return; const col=BML2[it.k];
    c.strokeStyle=`rgba(${col},.85)`; c.lineWidth=2; c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(bx,by); c.stroke();
    c.beginPath(); c.arc(a[0],a[1],5,0,6.2832); c.fillStyle=`rgb(${col})`; c.fill(); c.lineWidth=2; c.strokeStyle='#fff'; c.stroke(); });
  c.restore(); }
/* ---- zoom: critically damped (about 0.7 s), interruptible, no overshoot, drives the sky's own radius machinery (BMZ.r feeds airFit's AIR_VIEW_NM; BMZ.t is what RADMI() reports) ---- */
const BMZC={x:0,v:0,tx:0,s:1,last:0,geo:0,pl:0,rm:false};
const bmNorm=()=>{ const r=Math.round(+S.airRadiusMi); return r>=2&&r<=25?r:15; };
const bmRedu=()=>{ try{ return matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; } };
function bmNeedR(S){ const hx=AF.hx??AF.cx, hy=AF.hy??AF.my, rc=AF.ppn?((AF.a-30)/AF.ppn)*1.1508:(BMZ.r||BMZ.t||bmNorm()), pts=[];
  S.items.forEach(it=>{ pts.push(airXY(it.g.stop[0],it.g.stop[1])); pts.push(airXY(it.g.bus[0],it.g.bus[1])); });
  for(const R of [2,3,4,5,6,8]){ const k=rc/R; if(pts.every(p=>{ const x=hx+(p[0]-hx)*k, y=hy+(p[1]-hy)*k; return obD(x,y,0)>110&&obD(x,y,1)>70; })) return R; } return 8; }
function bmZoomCtl(){ const S=BM2.sel, want=S?bmNeedR(S):0, cur=BMZ.t||0; if(want&&(!cur||want>cur)) bmZoomTo(want); else if(!want&&cur) bmZoomTo(0); }
function bmZoomTo(R){ const norm=bmNorm(), cur=BMZ.r||BMZ.t||norm, tgt=R||norm; BMZ.t=R;
  if(bmRedu()){ document.body.classList.add('bmcf'); setTimeout(()=>{ BMZ.r=0; try{ airFit(); geoLand(); geoRoads(); geoTraffic(); bmPlace(); }catch(e){ BM2.errs++; } document.body.classList.remove('bmcf'); },260); return; }
  if(!BMZ.anim){ BMZC.x=Math.log(cur); BMZC.v=0; BMZC.last=0; BMZC.geo=performance.now(); BMZ.anim=true; BMZ.r=cur; requestAnimationFrame(bmZStep); }
  BMZC.tx=Math.log(tgt); BMZC.s=Math.sign(BMZC.x-BMZC.tx)||1; }
function bmZStep(ts){ try{ if(!BMZ.anim) return; const dt=Math.min(.05,BMZC.last?(ts-BMZC.last)/1000:.016); BMZC.last=ts; const w=10.5, n=Math.max(1,Math.ceil(dt/.004)), h=dt/n;
    for(let i=0;i<n;i++){ const a=-2*w*BMZC.v-w*w*(BMZC.x-BMZC.tx); BMZC.v+=a*h; BMZC.x+=BMZC.v*h; }
    if((BMZC.x-BMZC.tx)*BMZC.s<0){ BMZC.x=BMZC.tx; BMZC.v=0; }
    const done=Math.abs(BMZC.x-BMZC.tx)<.004&&Math.abs(BMZC.v)<.03;
    if(done){ BMZ.r=0; BMZ.anim=false; airFit(); requestAnimationFrame(()=>{ try{ geoLand(); geoRoads(); }catch(e){ BM2.errs++; } requestAnimationFrame(()=>{ try{ geoTraffic(); bmPlace(); }catch(e){ BM2.errs++; } }); }); return; }
    BMZ.r=Math.exp(BMZC.x); geoFast=true; try{ airFit(); }finally{ geoFast=false; }
    if(ts-BMZC.geo>50){ BMZC.geo=ts; geoLand(); geoRoads(); geoTraffic(); } if(ts-BMZC.pl>120){ BMZC.pl=ts; bmPlace(); }
    requestAnimationFrame(bmZStep); }catch(e){ geoFast=false; BMZ.anim=false; BMZ.r=0; BM2.errs++; V2.errs++; BM2.err=String(e&&e.stack||e); } }
window.__bmz=()=>({r:BMZ.r,t:BMZ.t,anim:BMZ.anim,ppn:AF.ppn});
window.__bm2=()=>({pos:BM2.sel&&BM2.sel.items.map(i=>{ const q=airXY((i.gf||i.g).bus[0],(i.gf||i.g).bus[1]), P=pjNow(), d=P.proj(q[0],q[1]), e=BM2.els[i.id], r=e&&e.querySelector('.pl').getBoundingClientRect(); return {dot:d&&d.map(Math.round),pl:r&&[Math.round((r.left+r.right)/2),Math.round((r.top+r.bottom)/2),Math.round(r.width),Math.round(r.height)],tr:e&&e.style.transform}; }),errs:BM2.errs,err:BM2.err||null,sel:BM2.sel?BM2.sel.items.map(i=>({id:i.id,min:Math.round((i.x.eta-Date.now())/60000),leaveIn:Math.round((i.x.leave-Date.now())/1000),off:BM2.off[i.id]||null})):null,els:Object.keys(BM2.els),zt:BMZ.t,zr:BMZ.r,anim:!!BMZ.anim,R:RADMI(),ppn:AF.ppn,alpha:BM2.a,v2errs:V2.errs});
/* ===== end BUSMAP2_20261103 ===== */
