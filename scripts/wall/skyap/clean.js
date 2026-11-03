/* ===== SKYCLEAN_20261102: screen-space label placement (airport pills first, edge pills + tags yield), text never clipped, autofit ===== */
const skHit=(b,list)=>list.some(q=>b[0]<q[2]&&b[2]>q[0]&&b[1]<q[3]&&b[3]>q[1]);
function skPoly(){ const P=pjNow(); if(!P.proj) return null; const c=AF.lit||[[0,0],[AW,0],[AW,AH],[0,AH]].map(([x,y])=>P.proj(x,y)); return c.every(Boolean)?c:null; }
function skIn(poly,x,y,m){ let cx=0,cy=0; poly.forEach(p=>{ cx+=p[0]; cy+=p[1]; }); cx/=poly.length; cy/=poly.length;
  for(let i=0;i<poly.length;i++){ const a=poly[i], b=poly[(i+1)%poly.length], ex=b[0]-a[0], ey=b[1]-a[1], l=Math.hypot(ex,ey)||1, so=Math.sign(ex*(cy-a[1])-ey*(cx-a[0]))||1, d=so*(ex*(y-a[1])-ey*(x-a[0]))/l; if(d<m) return false; } return true; }
function skRectOk(r,poly,obs,m){ const pts=[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]],[(r[0]+r[2])/2,r[1]],[(r[0]+r[2])/2,r[3]],[r[0],(r[1]+r[3])/2],[r[2],(r[1]+r[3])/2]];
  return r[0]>=6&&r[1]>=6&&r[2]<=innerWidth-6&&r[3]<=innerHeight-6&&pts.every(p=>skIn(poly,p[0],p[1],m))&&!skHit(r,obs); }
function skRects(){ const out=[]; document.querySelectorAll('#airPlanes .apl .in,#airPlanes .v2e .in,#airPlanes .tag.show,#airPlanes .ac .ico').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.width) out.push([r.left-6,r.top-6,r.right+6,r.bottom+6]); }); return out; }
function skObsSig(){ try{ return '|'+skRects().map(r=>r.map(v=>Math.round(v/14)).join(',')).join(';'); }catch(e){ return ''; } }
function skStarHit(bx){ try{ return skHit(bx,skRects()); }catch(e){ return false; } }
function skSkyBox(proj,b){ const ps=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]].map(p=>proj(p[0],p[1])); if(ps.some(p=>!p)) return null;
  return [Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))]; }
function skPlaneObs(){ const out=[]; document.querySelectorAll('#airPlanes .tag.show,#airPlanes .ac .ico').forEach(e=>{ const r=e.getBoundingClientRect(); if(r.width) out.push([r.left-8,r.top-8,r.right+8,r.bottom+8]); });
  if(window.__scrHome) out.push(window.__scrHome); return out; }
apPills=function(){ const box=$('#airPlanes'); if(!box) return; const on=apOn(), keep={}; APX.place={}; APX.pillBoxes=[];
  const poly=skPoly(), P=pjNow(); if(on&&AF.ppn&&poly){ const hx=AF.hx??AF.cx, hy=AF.hy??AF.my, pobs=skPlaneObs(), placed=[]; APX.last=APX.last||{};
    Object.keys(AP).forEach(code=>{ const A=AP[code], c=airXY(A.ll[0],A.ll[1]), st=apStatus(code), dmi=apMi(airHome[0],airHome[1],A.ll[0],A.ll[1]), B=apBd(code), ends=apEnds(A);
      let rs=60; ends.forEach(e=>{ const q=airXY(e.la,e.lo); rs=Math.max(rs,Math.hypot(q[0]-c[0],q[1]-c[1])); });
      const skyF=[[c[0]-rs-30,c[1]-rs*.7-30,c[0]+rs+30,c[1]+rs*.7+30]];
      if(B&&(B.arrivals||[]).length&&B.flow_hdg!=null){ ends.filter(e=>apAd(e.h,B.flow_hdg)<=25).forEach(e=>{ for(let d=1.5;d<=10;d+=1.5){ const q=airXY(...apPt(e.la,e.lo,e.h,d,0)); skyF.push([q[0]-70,q[1]-60,q[0]+70,q[1]+60]); } }); }
      const field=skyF.map(b=>skSkyBox(P.proj,b)).filter(Boolean);
      keep[code]=1; let e=APX.els[code];
      if(!e){ e=document.createElement('div'); e.className='apl'; e.style.setProperty('--c',A.c); e.style.setProperty('--t',A.t); e.style.setProperty('--r',apRgb(A.c));
        e.innerHTML='<div class="in"><i class="cb">'+code+'</i><div class="tx"><b></b><span></span></div><div class="ch"></div></div>'; box.appendChild(e); APX.els[code]=e; }
      const inb=obHold(c[0],c[1],150,70,0)[2], b1=e.querySelector('b'), s1=e.querySelector('span'), ch=e.querySelector('.ch');
      const t1=inb?A.n:(A.n+' · '+Math.round(dmi)+NBP+'mi '+apComp(apBrg(airHome[0],airHome[1],A.ll[0],A.ll[1])));
      if(b1.textContent!==t1) b1.textContent=t1; if(s1.textContent!==st.t) s1.textContent=st.t; e.classList.toggle('q',!!st.q);
      if(inb){ if(ch.innerHTML) ch.innerHTML=''; } else { if(!ch.innerHTML) ch.innerHTML=AP_CHEV; ch.style.transform='rotate('+(Math.atan2(c[1]-hy,c[0]-hx)/apD2R).toFixed(0)+'deg)'; }
      const inn=e.firstChild, obs=field.concat(pobs,placed), tryAt=(x,y)=>{ if(obD(x,y,0)<10||obD(x,y,1)<10) return null; e.style.transform=skyPt(x,y); const r=inn.getBoundingClientRect(), rr=[r.left,r.top,r.right,r.bottom]; return skRectOk(rr,poly,obs,10)?rr:false; };
      const cands=[]; const lastP=APX.last[code]; if(lastP) cands.push(lastP);
      if(inb){ let ux=c[0]-hx, uy=c[1]-hy; const ul=Math.hypot(ux,uy)||1; ux/=ul; uy/=ul;
        for(const d of [rs+90,rs+170,rs+260,rs+370,rs+500]) for(const ang of [0,30,-30,60,-60,90,-90,130,-130,180]){ const ca=Math.cos(ang*apD2R), sa=Math.sin(ang*apD2R); cands.push([c[0]+(ux*ca-uy*sa)*d,c[1]+(ux*sa+uy*ca)*d]); } }
      else { const hv=obHold(c[0],c[1],150,70,0); for(const [dx,dy] of [[0,0],[0,-110],[0,110],[0,-220],[0,220],[-320,0],[320,0],[-320,-110],[320,110],[-320,110],[320,-110]]) cands.push([hv[0]+dx,hv[1]+dy]); for(const t of [.06,.12,.2,.3,.42,.56,.7]){ cands.push([hv[0]+(AF.cx-hv[0])*t,hv[1]+(AF.my-hv[1])*t]); cands.push([hv[0]+(AF.cx-hv[0])*t,hv[1]-110+(AF.my-hv[1])*t]); } }
      let pos=null, rect=null; for(const [x,y] of cands){ const r=tryAt(x,y); if(r){ pos=[x,y]; rect=r; break; } }
      if(!pos){ for(const [x,y] of cands){ if(obD(x,y,0)<10||obD(x,y,1)<10) continue; e.style.transform=skyPt(x,y); const r=inn.getBoundingClientRect(), rr=[r.left,r.top,r.right,r.bottom]; if(skRectOk(rr,poly,[],10)){ pos=[x,y]; rect=rr; break; } } }   /* crowded: stay inside the band even if it must touch something */
      if(!pos){ const hv=obHold(c[0],c[1],150,70,0); pos=[hv[0],hv[1]]; e.style.transform=skyPt(pos[0],pos[1]); const r=inn.getBoundingClientRect(); rect=[r.left,r.top,r.right,r.bottom]; }
      APX.last[code]=pos; e.style.transform=skyPt(pos[0],pos[1]); placed.push([rect[0]-6,rect[1]-6,rect[2]+6,rect[3]+6]); APX.pillBoxes.push(rect);
      const fp=P.proj(c[0],c[1]); if(fp){ const nx=Math.max(rect[0],Math.min(rect[2],fp[0])), ny=Math.max(rect[1],Math.min(rect[3],fp[1])), fr=skSkyBox(P.proj,[c[0]-rs,c[1]-rs*.5,c[0]+rs,c[1]+rs*.5]);
        const ex=fr?Math.max(fr[0],Math.min(fr[2],nx)):fp[0], ey=fr?Math.max(fr[1],Math.min(fr[3],ny)):fp[1]; APX.place[code]={fx:ex,fy:ey,px:nx,py:ny,gap:Math.hypot(nx-ex,ny-ey)}; } });
  }
  Object.keys(APX.els).forEach(k=>{ if(!keep[k]){ APX.els[k].remove(); delete APX.els[k]; } }); };
v2Edge=function(now){ if(now-V2.eAt<1000||!AF.ppn) return; V2.eAt=now; const box=$('#airPlanes'); if(!box) return;
  const R=RADMI(), hx=AF.hx??AF.cx, hy=AF.hy??AF.my, want=[], poly=skPoly(); if(!poly) return;
  Object.values(V2.m).forEach(v=>{ const lv=v.live; if(!lv||lv.on_ground||lv.lat==null||lv.dist_mi==null||lv.dist_mi<=R||lv.dist_mi>15.5) return;
    const ex=AIRS[String(v.hex).toLowerCase()]; if(ex&&ex.op>.2) return; const p=airXY(lv.lat,lv.lon);
    if(obD(p[0],p[1],0)>20&&obD(p[0],p[1],1)>20) return; want.push([lv.dist_mi,v,p]); });
  want.sort((a,b)=>a[0]-b[0]); const keep={}, obs=(APX.pillBoxes||[]).map(r=>[r[0]-6,r[1]-6,r[2]+6,r[3]+6]).concat(skPlaneObs()); let n=0;
  for(const [d,v,p] of want){ if(n>=3) break; const k=String(v.hex); let e=V2.els[k];
    if(!e){ e=document.createElement('div'); e.className='v2e'; e.innerHTML='<div class="in"><b></b><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="M8 4l8 8-8 8"/></svg></div>'; box.appendChild(e); V2.els[k]=e; }
    const ang=Math.atan2(p[1]-hy,p[0]-hx)*180/Math.PI, txt=(v.label||v.registration||'Aircraft')+' · '+d.toFixed(1)+NBP+'mi', b=e.firstChild.firstChild;
    if(b.textContent!==txt) b.textContent=txt; e.firstChild.lastChild.style.transform='rotate('+ang.toFixed(0)+'deg)'; e.classList.toggle('sos',!!v2em(v));
    const hv=obHold(p[0],p[1],140,60,0); let ok=null;
    for(const [dx,dy] of [[0,0],[0,100],[0,-100],[0,200],[0,-200],[300,0],[-300,0],[300,100],[-300,100],[300,-100],[-300,-100],[.06,0,1],[.12,0,1],[.2,0,1],[.3,0,1],[.42,0,1],[.56,0,1]].map(q=>q.length===3?[(AF.cx-hv[0])*q[0],(AF.my-hv[1])*q[0]]:q)){ const x=hv[0]+dx, y=hv[1]+dy; if(obD(x,y,0)<10||obD(x,y,1)<10) continue; e.style.transform=skyPt(x,y);
      const r=e.firstChild.getBoundingClientRect(), rr=[r.left,r.top,r.right,r.bottom]; if(skRectOk(rr,poly,obs,10)){ ok=[x,y,rr]; break; } }
    if(!ok){ e.remove(); delete V2.els[k]; continue; }
    keep[k]=1; n++; obs.push([ok[2][0]-6,ok[2][1]-6,ok[2][2]+6,ok[2][3]+6]); e.style.transform=skyPt(ok[0],ok[1]); }
  Object.keys(V2.els).forEach(k=>{ if(!keep[k]){ V2.els[k].remove(); delete V2.els[k]; } }); };
/* plane tags: fully inside the lit band and clear of airport / edge pills: current side, other side, drop line 2, else hide */
function skTags(){ const poly=skPoly(); if(!poly) return; const now=performance.now(), pill=(APX.pillBoxes||[]).map(r=>[r[0]-4,r[1]-4,r[2]+4,r[3]+4]);
  document.querySelectorAll('#airPlanes .v2e .in').forEach(e=>{ const r=e.getBoundingClientRect(); pill.push([r.left-4,r.top-4,r.right+4,r.bottom+4]); });
  Object.values(AIRS).forEach(o=>{ try{ const t=o.tagEl; if(!t) return; if(!o.shown){ t.classList.remove('skx'); return; } if(o._skf&&now-(o._skfT||0)>6000) o._skf=null;
    const test=()=>{ const r=t.getBoundingClientRect(); return r.width?skRectOk([r.left,r.top,r.right,r.bottom],poly,pill,6):true; };
    const setSide=l=>{ o._skf=l?'l':'r'; o._skfT=now; o._lft=l; o.el.classList.toggle('lft',l); };
    t.classList.remove('skx'); let ok=test(); if(ok) return; t.classList.remove('nol2'); const cur=!!o._lft; setSide(!cur); ok=test(); if(ok) return; setSide(cur); ok=test(); if(ok) return;
    t.classList.add('nol2'); ok=test(); if(ok) return; setSide(!cur); ok=test(); if(ok) return; t.classList.add('skx');
  }catch(e){ V2.errs++; } }); }
setInterval(()=>{ try{ skTags(); }catch(e){ V2.errs++; } },700);
{ const _t=v2Tag; v2Tag=function(o,I,txt){ const r=_t(o,I,txt); try{ const el=o.tagEl; if(el&&el.firstChild&&(o._twk!==o._v2k)){ o._twk=o._v2k; o._tw=el.offsetWidth; } if(o._tw) return 'x'.repeat(Math.max(r.length,Math.ceil((o._tw+8)/30))); }catch(e){ V2.errs++; } return r; }; }
/* ---- text is never cut: autofit (shrink to a floor, then drop trailing words); ellipsis rules are off (CSS) ---- */
const SKF='.amb-glance .v,.amb-glance .s,.amb-next .line,.hd-t,.hd-s,.wx-cond,.cw-sub,.tp-h,.tp-s,.tp-xr,.tp-g .c,.dv-n,.w2bk-t,.vc-q,#w5mot .m-chips span,.lalt .w2-2l li b,.lalt .w2-2l li span,.next .row .nm,.card .big,.hdr .app,.hdr .src,#cvCast .cc-s,#cvCast .cc-n,.cw-radio .rt b,.cw-radio .rt span,.cw-radio b,.dd .say .c';
function skAutofit(){ document.querySelectorAll(SKF).forEach(e=>{ try{ if(e.children.length||!e.clientWidth) return; const txt=e.textContent;
    if(e._skL!==txt){ e._skO=txt; e._skL=txt; e.style.fontSize=''; e._skB=0; }
    if(e.scrollWidth<=e.clientWidth+1) return; if(!e._skB) e._skB=parseFloat(getComputedStyle(e).fontSize)||20; let s=e._skB, g=0;
    while(e.scrollWidth>e.clientWidth+1&&s>e._skB*.62&&g++<14){ s-=Math.max(1,e._skB*.04); e.style.fontSize=s.toFixed(1)+'px'; }
    if(e.scrollWidth>e.clientWidth+1){ const parts=e._skO.split(' '); while(parts.length>1&&e.scrollWidth>e.clientWidth+1){ parts.pop(); e.textContent=parts.join(' '); } e._skL=e.textContent; }
  }catch(er){ V2.errs++; } }); }
setInterval(()=>{ try{ skAutofit(); }catch(e){ V2.errs++; } },1500);
/* ===== end SKYCLEAN_20261102 ===== */
