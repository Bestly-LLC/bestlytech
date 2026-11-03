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
    if(ts-BMZC.geo>90){ BMZC.geo=ts; geoLand(); geoRoads(); geoTraffic(); } if(ts-BMZC.pl>120){ BMZC.pl=ts; bmPlace(); }
    requestAnimationFrame(bmZStep); }catch(e){ geoFast=false; BMZ.anim=false; BMZ.r=0; BM2.errs++; V2.errs++; BM2.err=String(e&&e.stack||e); } }
window.__bmz=()=>({r:BMZ.r,t:BMZ.t,anim:BMZ.anim,ppn:AF.ppn});
window.__bm2=()=>({pos:BM2.sel&&BM2.sel.items.map(i=>{ const q=airXY((i.gf||i.g).bus[0],(i.gf||i.g).bus[1]), P=pjNow(), d=P.proj(q[0],q[1]), e=BM2.els[i.id], r=e&&e.querySelector('.pl').getBoundingClientRect(); return {dot:d&&d.map(Math.round),pl:r&&[Math.round((r.left+r.right)/2),Math.round((r.top+r.bottom)/2),Math.round(r.width),Math.round(r.height)],tr:e&&e.style.transform}; }),errs:BM2.errs,err:BM2.err||null,sel:BM2.sel?BM2.sel.items.map(i=>({id:i.id,min:Math.round((i.x.eta-Date.now())/60000),leaveIn:Math.round((i.x.leave-Date.now())/1000),off:BM2.off[i.id]||null})):null,els:Object.keys(BM2.els),zt:BMZ.t,zr:BMZ.r,anim:!!BMZ.anim,R:RADMI(),ppn:AF.ppn,alpha:BM2.a,v2errs:V2.errs});
window.__bmwp=()=>BM2.wp;
window.__bmarrow=()=>{ const S=BM2.sel; if(!S) return null; const P=pjNow(); return S.items.map(it=>{ const g=it.gf||it.g, b0=airXY(g.bus[0],g.bus[1]), brg=(it.v.bearing||0)*Math.PI/180, L=.0012, q=airXY(g.bus[0]+Math.cos(brg)*L,g.bus[1]+Math.sin(brg)*L/Math.cos(g.bus[0]*Math.PI/180)), p0=P.proj(b0[0],b0[1]), p1=P.proj(q[0],q[1]), o=BM2.off[it.id]||[0,0], at=[b0[0]+o[0],b0[1]+o[1]], fr=scrFrame(P.proj,at[0],at[1]), th=bmArrow(it,g,at), r=th*Math.PI/180;
  const sx=fr.f[0]*Math.cos(r)+fr.f[2]*Math.sin(r), sy=fr.f[1]*Math.cos(r)+fr.f[3]*Math.sin(r), n=Math.hypot(sx,sy), m=Math.hypot(p1[0]-p0[0],p1[1]-p0[1]);
  return {k:it.k,brg:it.v.bearing,rot:Math.round(th),want:[(p1[0]-p0[0])/m,(p1[1]-p0[1])/m].map(v=>+v.toFixed(2)),got:[sx/n,sy/n].map(v=>+v.toFixed(2)),svg:e2(it)}; }); function e2(it){ const e=BM2.els[it.id]; return e&&e.querySelector('svg').style.transform; } };
