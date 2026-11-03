/* ===== BUSMAP_PROTO_20261102: bus markers, route, his stop and walk path on the sky map (PREVIEW ONLY, never shipped to wall.html) =====
   Jared's picks: only his lines coming his way (Q2); line-number pill + direction arrow with minutes to his stop under it (Q9);
   route + his stop + walk path from home drawn only during leave-by (Q10, Q93); the walk line lights gold at leave-by and the bus is highlighted (Q94).
   Inserted into the wall page closure by p_busmap.py (needs V2, w1Rows, airXY, skyPt, trackRot, AF, airHome) and hooked into drawTrails after apDraw. */
const BM={els:{},sel:null,errs:0};
(function(){ const css=document.createElement('style'); css.id='bmcss'; css.textContent=`
#airPlanes .bm{position:absolute;left:0;top:0;width:0;height:0;will-change:transform}
#airPlanes .bm .bmp{position:absolute;left:-44px;top:-21px;width:88px;height:42px;box-sizing:border-box;border-radius:21px;background:var(--c);display:flex;align-items:center;justify-content:center;gap:6px;color:#fff;font:800 27px/1 var(--sf);white-space:nowrap;box-shadow:0 0 26px 4px color-mix(in srgb,var(--c) 50%,transparent),inset 0 0 8px rgba(255,255,255,.28)}
#airPlanes .bm .bmp svg{width:22px;height:22px;flex:none}
#airPlanes .bm .bmt{position:absolute;left:-60px;top:25px;width:120px;text-align:center;font:700 23px/1.1 var(--sf);color:#fff;white-space:nowrap;text-shadow:0 0 10px rgba(0,0,0,.95),0 0 4px rgba(0,0,0,.9)}
#airPlanes .bm.hl .bmp{box-shadow:0 0 0 3px rgba(255,196,64,.96),0 0 34px 10px rgba(255,196,64,.45),inset 0 0 8px rgba(255,255,255,.28)}
#airPlanes .bm.hl .bmt{color:#FFC440}`; document.head.appendChild(css); })();
const BML={'10':'225,103,16','4':'225,103,16','105':'225,103,16'};
/* selection: his lines only; a bus counts when its trip still has a stop time at his stop (it is coming his way); 105 southbound only (toward LAX) */
function bmSel(){ try{ const now=Date.now(), b=window.__bmMock||V2.bus; if(!b){ BM.sel=null; return; }
    const ok=k=>k==='10'||k==='4'||k==='105', rows=w1Rows(now).filter(x=>ok(x.k)), veh=[];
    (b.vehicles||[]).forEach(v=>{ const k=String(v.line); if(!ok(k)||v.lat==null||!v.stop_eta||v.stop_eta<now-20000||v.stop_eta-now>45*60000) return; if(k==='105'&&!/south/i.test(v.direction||'')) return;
      veh.push({v:v,k:k,min:Math.max(0,Math.round((v.stop_eta-now)/60000))}); });
    const win=rows.filter(x=>x.leave-now<=6*60000).sort((p,q)=>p.leave-q.leave);          /* leave-by window: from 6 min before leave-by until the bus is here */
    BM.sel={b:b,rows:rows,veh:veh,win:win,tgt:win[0]||null,go:!!(win[0]&&win[0].leave-now<=60000)}; }catch(e){ BM.errs++; V2.errs++; } }
setInterval(bmSel,250);
window.__bmZoom=r=>{ clearInterval(window.__bmZi); S.airRadiusMi=r; window.__bmZi=setInterval(()=>{ S.airRadiusMi=r; },150); };   /* preview only: the proposed local view during leave-by (default sky radius is 15 mi, where a 0.5 mi walk is about 30 px) */
function bmMarkers(){ try{ const box=document.getElementById('airPlanes'); if(!box||!AF.ppn) return; document.querySelectorAll('#airPlanes .v2b').forEach(e=>e.remove());
    const S=BM.sel, keep={}, hx=AF.hx!=null?AF.hx:AF.cx, hy=AF.hy!=null?AF.hy:AF.my;
    if(S&&effMode()!=='off') S.veh.forEach(o=>{ const v=o.v, p=airXY(v.lat,v.lng), id='m'+v.id; if(p[0]>hx-70&&p[0]<hx+70&&p[1]>hy-34&&p[1]<hy+50) return; keep[id]=1; let e=BM.els[id];
      if(!e){ e=document.createElement('div'); e.className='bm'; e.style.setProperty('--c','rgb('+BML[o.k]+')'); e.innerHTML='<div class="bmp"><b></b><svg viewBox="0 0 24 24"><path fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" d="M6 15l6-7 6 7"/></svg></div><div class="bmt"></div>'; box.appendChild(e); BM.els[id]=e; }
      const t=e.querySelector('.bmt'), tx=o.min+' min'; if(t.textContent!==tx) t.textContent=tx; const bb=e.querySelector('b'); if(bb.textContent!==o.k) bb.textContent=o.k;
      { const PJ=pjNow(), q=PJ&&PJ.proj?PJ.proj(p[0],p[1]):null; if(!q){ e.style.visibility='hidden'; return; } e.style.visibility=''; e.style.transform='translate('+q[0].toFixed(1)+'px,'+q[1].toFixed(1)+'px)'; } e.querySelector('svg').style.transform='rotate('+(trackRot(v.bearing||0)+180).toFixed(0)+'deg)';
      e.classList.toggle('hl',!!(S.tgt&&S.tgt.a&&S.tgt.a.trip&&S.tgt.a.trip===v.trip_id&&S.win.length)); });
    Object.keys(BM.els).forEach(k=>{ if(!keep[k]){ BM.els[k].remove(); delete BM.els[k]; } }); }catch(e){ BM.errs++; V2.errs++; } }
v2BusMarkers=function(){ bmMarkers(); };
/* canvas: drawn from drawTrails, only during leave-by */
function bmDraw(c,proj,kp,now){ const S=BM.sel; if(!S||!S.win.length||effMode()==='off') return; const P=(la,lo)=>{ const q=airXY(la,lo); return proj(q[0],q[1]); };
  c.save(); c.lineCap='round'; c.lineJoin='round';
  S.win.forEach(x=>{ const col=BML[x.k]||'225,103,16', rt=(S.b.routes||{})[x.k+':'+x.r.dir_id];
    if(rt&&rt.length>1){ const pts=rt.map(p=>P(p[0],p[1])); if(pts.every(Boolean)){ const a=pts[0], z=pts[pts.length-1], g=c.createLinearGradient(a[0],a[1],z[0],z[1]);
        g.addColorStop(0,`rgba(${col},0)`); g.addColorStop(.18,`rgba(${col},.7)`); g.addColorStop(.82,`rgba(${col},.7)`); g.addColorStop(1,`rgba(${col},0)`);
        const gg=c.createLinearGradient(a[0],a[1],z[0],z[1]); gg.addColorStop(0,`rgba(${col},0)`); gg.addColorStop(.18,`rgba(${col},.13)`); gg.addColorStop(.82,`rgba(${col},.13)`); gg.addColorStop(1,`rgba(${col},0)`);
        [[gg,11],[g,3]].forEach(([s,w])=>{ c.strokeStyle=s; c.lineWidth=w; c.beginPath(); pts.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])); c.stroke(); }); } }
    { const q=airXY(x.r.stop_lat,x.r.stop_lon), fr=scrFrame(proj,q[0],q[1]); if(fr){ c.save(); frIn(c,fr); const rg=c.createRadialGradient(0,0,0,0,0,46); rg.addColorStop(0,`rgba(${col},.55)`); rg.addColorStop(1,`rgba(${col},0)`); c.fillStyle=rg; c.beginPath(); c.arc(0,0,46,0,6.2832); c.fill();
        c.fillStyle=`rgb(${col})`; c.strokeStyle='rgba(255,255,255,.97)'; c.lineWidth=4; c.beginPath(); c.arc(0,0,11,0,6.2832); c.fill(); c.stroke(); c.restore(); } } });
  const t=S.tgt, w=t&&S.b.walks&&S.b.walks[(t.r.agency||'metro')+':'+t.r.stop_id];
  if(t&&w&&w.geom&&w.geom.length>1){ const pts=[P(airHome[0],airHome[1])].concat(w.geom.map(p=>P(p[0],p[1]))); if(pts.every(Boolean)){ const path=()=>{ c.beginPath(); pts.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])); };
      if(S.go){ c.strokeStyle='rgba(255,196,64,.12)'; c.lineWidth=26; path(); c.stroke(); c.strokeStyle='rgba(255,196,64,.24)'; c.lineWidth=14; path(); c.stroke(); c.strokeStyle='rgba(255,196,64,.96)'; c.lineWidth=6; path(); c.stroke(); }
      else { c.strokeStyle='rgba(255,255,255,.12)'; c.lineWidth=14; path(); c.stroke(); c.setLineDash([1,11]); c.strokeStyle='rgba(255,255,255,.85)'; c.lineWidth=5.5; path(); c.stroke(); c.setLineDash([]); } } }
  c.restore(); }
/* ===== end BUSMAP_PROTO_20261102 ===== */
