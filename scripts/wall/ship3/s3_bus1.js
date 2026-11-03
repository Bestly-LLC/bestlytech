/* ---- SHIP3 part 2: buses on the sky map while a bus is in its leave-by window (BUSMAP2 + 4 fixes) ----
   Only while a bus on his lines (10, 4, 105 toward LAX) is inside the leave-by window (leave-by within 5 min, or Leave now) with a live position, he is home, main mode. Max 2 buses.
   Pill = upright in the sky frame (skyPt, same as plane tags / edge pills): line-color pill with number + arrow turned to the real travel bearing, minutes to HIS stop under it.
   One stop marker per bus (white ring, dark fill, line-color dot) joined to its bus by that bus's route piece only. Gold OSM walk path Home -> soonest stop.
   Zoom in to about 2-3 mi (critically damped, interruptible); zoom back out when the window ends. Hooks from p_ship3.py: BMZ / RADMI / airFit / drawTrails (bmDraw). */
const BM2={els:{},sel:null,lastSel:null,errs:0,a:0,t:0,off:{},pr:{},cr:{},sb:{},gi:{}};
const BML2={'10':'225,103,16','4':'225,103,16','105':'225,103,16'};   /* Metro orange = the bus card badge #E16710 */
(function(){ const css=document.createElement('style'); css.id='bm2css'; css.textContent=`
#airPlanes .bm2{position:absolute;left:0;top:0;width:0;height:0;will-change:transform;opacity:0;transition:opacity .3s ease-out;pointer-events:none}
#airPlanes .bm2.on{opacity:1}
#airPlanes .bm2 .col{position:absolute;left:0;top:-19px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px}
#airPlanes .bm2 .pl{box-sizing:border-box;height:38px;display:flex;align-items:center;gap:6px;padding:0 12px 0 16px;border-radius:19px;white-space:nowrap;color:#fff;font:800 26px/1 var(--sf);
 background:linear-gradient(180deg,color-mix(in srgb,var(--c) 90%,#fff),var(--c));box-shadow:inset 0 0 8px rgba(255,255,255,.16),0 3px 12px rgba(0,0,0,.5),0 0 24px 4px rgba(var(--r),.34)}
#airPlanes .bm2 .pl b{font:inherit;font-style:normal}
#airPlanes .bm2 .pl svg{width:20px;height:20px;flex:none}
#airPlanes .bm2 .mn{font:800 24px/1 var(--sf);color:#fff;white-space:nowrap;text-shadow:0 0 10px rgba(0,0,0,.95),0 0 4px rgba(0,0,0,.9)}
#air,#airScrP,#airScrR,#airScrS,#airScrTr,#airScrL,#airTerr,#airRad,#airLand,#airCel,#celStars{transition:opacity .4s ease}
body.bmon #airCel,body.bmon #celStars{opacity:0!important}
@media (prefers-reduced-motion:reduce){ #air,#airScrP,#airScrR,#airScrS,#airScrTr,#airScrL,#airTerr,#airRad,#airLand,#airCel,#celStars{transition:opacity .22s ease} #airPlanes .bm2{transition:none} }
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
/* bus position (advanced along the shape by speed x age of the report), the piece of route from the bus to his stop; null when the bus is off its route or already at / past his stop */
function bmGeo(it,now){ const x=it.x, v=it.v, rt=(it.b.routes||{})[x.k+':'+x.r.dir_id]; if(!rt||rt.length<2) return null; const cum=bmCum(rt);
  const sp=bmProj(rt,cum,[x.r.stop_lat,x.r.stop_lon]), bp=bmProj(rt,cum,[v.lat,v.lng]); if(!sp||!bp||bp.d>400||bp.s>sp.s-25) return null;
  let s=bp.s; if(v.at&&v.mph) s+=Math.min(45,Math.max(0,(now-v.at)/1000))*v.mph*1.4667; s=Math.min(s,sp.s-30);
  const pos=bmAt(rt,cum,s), pts=[[pos[0],pos[1]]]; for(let j=pos[2]+1;j<rt.length&&cum[j]<sp.s;j++) pts.push(rt[j]); const e=bmAt(rt,cum,sp.s); pts.push([e[0],e[1]]);
  return {bus:[pos[0],pos[1]],pts:pts,stop:[x.r.stop_lat,x.r.stop_lon]}; }
/* ---- selection: his lines only, next bus per line (w1Rows), inside the leave-by window, with a live position; max 2 ---- */
function bmSel(){ try{ const now=Date.now(), b=w1Snap(); let out=[];
    if(b&&b.lines&&w1Home()&&effMode()==='board'){ const veh=b.vehicles||[];
      w1Rows(now).forEach(x=>{ if(x.k!=='10'&&x.k!=='4'&&x.k!=='105') return; if(x.leave-now>5*60000||x.eta<now-15000||!x.a.trip) return;
        const v=veh.find(q=>q.trip_id===x.a.trip&&q.lat!=null); if(!v) return; const it={x:x,v:v,b:b,k:x.k,id:x.k+'|'+x.a.trip}; it.g=bmGeo(it,now); if(it.g) out.push(it); }); }
    out.sort((p,q)=>p.x.leave-q.x.leave); out=out.slice(0,2);
    BM2.sel=out.length?{items:out,b:b}:null; if(BM2.sel) BM2.lastSel=BM2.sel;
    document.body.classList.toggle('bmon',!!BM2.sel);
    bmZoomCtl(); bmEls(); }catch(e){ BM2.errs++; V2.errs++; BM2.err=String(e&&e.stack||e); } }
setInterval(bmSel,250);
/* arrow: the bus's real travel bearing, projected to the screen, expressed in the pill's own (skyPt) frame so it points down the road on the wall */
function bmArrow(it,g,at){ const P=pjNow(); if(!P.proj) return 0; const b0=airXY(g.bus[0],g.bus[1]), brg=(it.v.bearing||0)*Math.PI/180, L=.0012;
  const q=airXY(g.bus[0]+Math.cos(brg)*L,g.bus[1]+Math.sin(brg)*L/Math.cos(g.bus[0]*Math.PI/180)), p0=P.proj(b0[0],b0[1]), p1=P.proj(q[0],q[1]), fr=scrFrame(P.proj,at[0],at[1]); if(!p0||!p1||!fr) return 0;
  const dx=p1[0]-p0[0], dy=p1[1]-p0[1], a=fr.f[0], b=fr.f[1], c=fr.f[2], d=fr.f[3], det=a*d-b*c||1e-9; return Math.atan2((-b*dx+a*dy)/det,(d*dx-c*dy)/det)*180/Math.PI; }
function bmEls(){ const box=$('#airPlanes'); if(!box||!AF.ppn) return; const S=BM2.sel, keep={}, now=Date.now(); let made=false;
  if(S) S.items.forEach(it=>{ keep[it.id]=1; let e=BM2.els[it.id];
    if(!e){ e=document.createElement('div'); e.className='bm2'; e.style.setProperty('--c','rgb('+BML2[it.k]+')'); e.style.setProperty('--r',BML2[it.k]);
      e.innerHTML='<div class="col"><div class="pl"><b></b><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" d="M8 4l8 8-8 8"/></svg></div><div class="mn"></div></div>'; box.appendChild(e); BM2.els[it.id]=e; made=true; }
    clearTimeout(e._rm); const mn=e.querySelector('.mn'), tx=Math.max(0,Math.round((it.x.eta-now)/60000))+NBP+'min', bb=e.querySelector('b'); if(mn.textContent!==tx) mn.textContent=tx; if(bb.textContent!==it.k) bb.textContent=it.k; });
  Object.keys(BM2.els).forEach(k=>{ if(!keep[k]){ const e=BM2.els[k]; e.classList.remove('on'); delete BM2.els[k]; delete BM2.off[k]; delete BM2.gi[k]; delete BM2.pr[k]; delete BM2.cr[k]; delete BM2.sb[k]; e._rm=setTimeout(()=>e.remove(),400); } });
  if(made) bmPlace(); }
