/* ---- label collision: Home, map labels that are not street names, airport chips, edge pills, plane tags / icons, avoid zones and the other pill all WIN; street-name labels under a pill are hidden instead ---- */
const BMGRID=(()=>{ const o=[]; [0,.25,-.25,.5,-.5,.75,-.75,1,-1,1.25,-1.25,1.5,-1.5,2,-2].forEach(x=>[0,-.6,.6,-1.2,1.2,-1.8,1.8,-2.4,2.4].forEach(y=>o.push([x,y]))); return o.sort((p,q)=>Math.hypot(p[0]*.7,p[1])-Math.hypot(q[0]*.7,q[1])); })();
function bmWins(){ const lab=window.__scrLabBoxes||[]; return skPlaneObs().filter(r=>lab.indexOf(r)<0); }   /* skHard() minus the street-name label boxes (those yield to the pill) */
function bmPlace(){ try{ const S=BM2.sel; if(!S) return; const P=pjNow(), poly=skPoly(); if(!P.proj||!poly) return; const pad=(r,m)=>[r[0]-(m||6),r[1]-(m||6),r[2]+(m||6),r[3]+(m||6)];
    const soft=bmWins().concat((APX.pillBoxes||[]).map(r=>pad(r))); document.querySelectorAll('#airPlanes .v2e .in').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.width) soft.push(pad([r.left,r.top,r.right,r.bottom])); });
    const hard=[]; { const h=window.__scrHome; if(h) hard.push([h[0]-84,h[1]-12,h[2]+84,h[3]+40]); } try{ tgbRects().forEach(r=>hard.push(r)); }catch(e){}
    S.items.forEach(it=>{ const q=airXY(it.g.stop[0],it.g.stop[1]), s=P.proj(q[0],q[1]); if(s) hard.push([s[0]-22,s[1]-22,s[0]+22,s[1]+22]); });
    const placed=[];
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
      e.style.transform=skyPt(a[0]+pos[0],a[1]+pos[1]); BM2.off[it.id]=pos; const pr=e.querySelector('.pl').getBoundingClientRect(); BM2.pr[it.id]=[pr.left,pr.top,pr.right,pr.bottom]; BM2.cr[it.id]=rr;
      e.querySelector('svg').style.transform='rotate('+bmArrow(it,g,[a[0]+pos[0],a[1]+pos[1]]).toFixed(0)+'deg)';
      placed.push(pad(rr)); e.classList.add('on'); });
  }catch(e){ BM2.errs++; V2.errs++; BM2.err=String(e&&e.stack||e); } }
{ const _ap=apPills; apPills=function(){ _ap.apply(this,arguments); bmPlace(); }; }
v2BusMarkers=function(){ document.querySelectorAll('#airPlanes .v2b').forEach(e=>e.remove()); V2.bels={}; };   /* the always-on vehicle markers are replaced by this leave-by layer: nothing is drawn that is not tied to an active bus or its stop */
/* street-name labels (canvas) and anything else that checks scrObs() yield to the pills and stop markers */
{ const _so=scrObs; scrObs=function(){ const o=_so(); try{ if(BM2.sel||BM2.a>0){ for(const k in BM2.cr){ const r=BM2.cr[k]; if(r) o.push([r[0]-8,r[1]-8,r[2]+8,r[3]+8]); } for(const k in BM2.sb){ const r=BM2.sb[k]; if(r) o.push(r); } } }catch(e){} return o; }; }
/* ---- canvas (from drawTrails): walk path, route pieces, stop markers, leaders. Screen-space strokes like the runways ---- */
function bmDraw(c,proj,kp,now){ const pn=performance.now(), dt=BM2.t?Math.min(.1,(pn-BM2.t)/1000):0; BM2.t=pn;
  BM2.a=Math.max(0,Math.min(1,BM2.a+(BM2.sel?1:-1)*dt/.3)); const S=BM2.sel||(BM2.a>0?BM2.lastSel:null); if(!S||BM2.a<=0) return;
  const ea=BM2.a*BM2.a*(3-2*BM2.a), wall=Date.now(), P=(la,lo)=>{ const q=airXY(la,lo); return proj(q[0],q[1]); };
  S.items.forEach(it=>{ const g=bmGeo(it,wall)||it.g; it.gf=g; const e=BM2.els[it.id], o=BM2.off[it.id]; if(e&&o&&g){ const q=airXY(g.bus[0],g.bus[1]), at=[q[0]+o[0],q[1]+o[1]]; e.style.transform=skyPt(at[0],at[1]); const sv=e.querySelector('svg'); if(sv) sv.style.transform='rotate('+bmArrow(it,g,at).toFixed(0)+'deg)'; } });
  c.save(); c.globalAlpha=ea; c.lineCap='round'; c.lineJoin='round';
  const path=pts=>{ c.beginPath(); pts.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])); };
  /* 1. walk path Home -> the soonest stop: real OSM foot route, gold 6 px with a soft feathered glow; starts at the Home marker's own spot and ends at the stop ring */
  { const it=S.items[0], w=it.b.walks&&it.b.walks[(it.x.r.agency||'metro')+':'+it.x.r.stop_id];
    if(w&&w.geom&&w.geom.length>1&&it.gf){ const hp=proj(AF.hx??AF.cx,AF.hy??AF.my); let pts=[hp].concat(w.geom.map(p=>P(p[0],p[1])),[P(it.gf.stop[0],it.gf.stop[1])]);
      if(pts.every(Boolean)){ pts=pts.filter((p,i)=>!i||Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1])>1.2); BM2.wp=pts.map(q=>[Math.round(q[0]),Math.round(q[1])]); c.save(); c.shadowOffsetX=0; c.shadowOffsetY=0;
        c.shadowColor='rgba(255,196,64,.85)'; c.shadowBlur=24; c.strokeStyle='rgba(255,196,64,.5)'; c.lineWidth=10; path(pts); c.stroke();
        c.shadowColor='rgba(255,196,64,.9)'; c.shadowBlur=9; c.strokeStyle='#FFC440'; c.lineWidth=6; path(pts); c.stroke();
        c.shadowBlur=0; c.strokeStyle='rgba(255,240,190,.9)'; c.lineWidth=2; path(pts); c.stroke(); c.restore(); } } }
  /* 2. route: only bus -> its own stop, line color 55%, 4 px, both ends feathered (about 26 px) */
  S.items.forEach(it=>{ const g=it.gf; if(!g) return; const pts=g.pts.map(p=>P(p[0],p[1])); if(pts.some(q=>!q)) return; const a=pts[0], z=pts[pts.length-1], len=Math.hypot(z[0]-a[0],z[1]-a[1]); if(len<8) return;
    const col=BML2[it.k], f=Math.min(.3,26/len), gr=c.createLinearGradient(a[0],a[1],z[0],z[1]);
    gr.addColorStop(0,`rgba(${col},0)`); gr.addColorStop(f,`rgba(${col},.55)`); gr.addColorStop(1-f,`rgba(${col},.55)`); gr.addColorStop(1,`rgba(${col},0)`);
    c.strokeStyle=gr; c.lineWidth=4; path(pts); c.stroke(); });
  /* 3. exactly one stop marker per bus: feathered glow, white 3 px ring, dark fill, line-color dot (18 px across) */
  S.items.forEach(it=>{ const g=it.gf; if(!g) return; const s=P(g.stop[0],g.stop[1]); if(!s) return; const col=BML2[it.k], rg=c.createRadialGradient(s[0],s[1],0,s[0],s[1],34);
    BM2.sb[it.id]=[s[0]-16,s[1]-16,s[0]+16,s[1]+16];
    rg.addColorStop(0,`rgba(${col},.4)`); rg.addColorStop(.5,`rgba(${col},.14)`); rg.addColorStop(1,`rgba(${col},0)`); c.fillStyle=rg; c.beginPath(); c.arc(s[0],s[1],34,0,6.2832); c.fill();
    c.beginPath(); c.arc(s[0],s[1],7.5,0,6.2832); c.fillStyle='#10141c'; c.fill(); c.lineWidth=3; c.strokeStyle='#fff'; c.stroke();
    c.beginPath(); c.arc(s[0],s[1],3.4,0,6.2832); c.fillStyle=`rgb(${col})`; c.fill(); });
  /* 4. the bus's true spot when its pill had to move: a small solid line-color dot (no ring, so it never reads as a stop) + a thin leader to the pill */
  S.items.forEach(it=>{ const g=it.gf, r=BM2.pr[it.id]; if(!g||!r) return; const q=airXY(g.bus[0],g.bus[1]), a=proj(q[0],q[1]); if(!a) return;
    const bx=Math.max(r[0],Math.min(r[2],a[0])), by=Math.max(r[1],Math.min(r[3],a[1])); if(Math.hypot(bx-a[0],by-a[1])<14) return; const col=BML2[it.k];
    c.strokeStyle=`rgba(${col},.8)`; c.lineWidth=1.6; c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(bx,by); c.stroke();
    c.beginPath(); c.arc(a[0],a[1],4,0,6.2832); c.fillStyle=`rgb(${col})`; c.fill(); c.lineWidth=1.5; c.strokeStyle='rgba(16,20,28,.9)'; c.stroke(); });
  c.restore(); }
