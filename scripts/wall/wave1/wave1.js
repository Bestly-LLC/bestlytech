/* ===== WAVE1_20261102: the real bus card (owner Mae), shared-slot urgency, missed leave-by, stale to schedule, detour line, crowding glyph, Airports count fix ===== */
const W1={errs:0,rows:[],leaveNow:false,sig:''};
const W1N=' ';
(function(){ const css=document.createElement('style'); css.id='w1css'; css.textContent=`
#wingBus .w1{box-sizing:border-box;width:960px;padding:14px 18px 12px;border-radius:36px;color:#fff;background:rgba(255,255,255,.055);box-shadow:inset 0 0 0 2px rgba(255,255,255,.15);overflow:hidden;font-family:var(--sf);text-align:left}
#wingBus .w1-hd{margin:0 0 4px;font:800 26px/26px var(--sf);letter-spacing:.04em;text-transform:uppercase;color:#fff;white-space:nowrap}
#wingBus .w1-r{position:relative;display:grid;grid-template-columns:64px minmax(0,1fr) 250px;column-gap:24px;align-items:center;padding:13px 0;white-space:nowrap}
#wingBus .w1-r+.w1-r::after{content:"";position:absolute;left:88px;right:0;top:0;height:1px;background:rgba(255,255,255,.10)}
#wingBus .w1-r>*{position:relative;z-index:1}
#wingBus .w1-b{box-sizing:border-box;width:64px;height:52px;border-radius:14px;background:var(--c);display:grid;place-items:center;color:#fff;font:700 40px/1 "Big Shoulders Display",var(--sf);box-shadow:0 0 12px 3px color-mix(in srgb,var(--c) 30%,transparent);overflow:hidden}
#wingBus .w1-b img{display:block;height:34px;width:auto;max-width:54px}
#wingBus .w1-s{min-width:0}
#wingBus .w1-n{display:block;font:600 30px/1.1 var(--sf);color:#fff;overflow:hidden;text-overflow:clip}
#wingBus .w1-w{display:block;margin-top:3px;font:500 22px/1.15 var(--sf);color:rgba(255,255,255,.85);overflow:hidden;text-overflow:clip}
#wingBus .w1-e{text-align:right}
#wingBus .w1-m{display:block;font:700 52px/1 var(--sf);font-variant-numeric:tabular-nums;color:#fff;white-space:nowrap}
#wingBus .w1-r.sch .w1-m{color:rgba(255,255,255,.85)}
#wingBus .w1-l{display:block;margin-top:5px;font:600 22px/1.15 var(--sf);color:#fff;white-space:nowrap}
#wingBus .w1-r.now .w1-l{color:#FFC440}
#wingBus .w1-r.now::before{content:"";position:absolute;left:-10px;right:-10px;top:-2px;bottom:-2px;z-index:0;pointer-events:none;background:radial-gradient(ellipse closest-side at 50% 50%,rgba(255,196,64,.30) 0,rgba(255,196,64,.16) 55%,rgba(255,196,64,0) 100%);opacity:.8;animation:w1Pulse 2.6s ease-in-out 3 forwards}
@keyframes w1Pulse{0%{opacity:.5}50%{opacity:1}100%{opacity:.8}}
@media (prefers-reduced-motion:reduce){#wingBus .w1-r.now::before{animation:none;opacity:.8}}
#wingBus .w1-oc{display:inline-block;vertical-align:middle;margin-left:10px;width:30px;height:20px;background:linear-gradient(90deg,#fff 0 7px,transparent 7px 11px,#fff 11px 18px,transparent 18px 22px,#fff 22px 30px);opacity:.9}
#wingBus .w1-oc.seats{background:linear-gradient(90deg,#fff 0 7px,transparent 7px 11px,rgba(255,255,255,.3) 11px 18px,transparent 18px 22px,rgba(255,255,255,.3) 22px 30px)}
#wingBus .w1-oc.standing{background:linear-gradient(90deg,#fff 0 7px,transparent 7px 11px,#fff 11px 18px,transparent 18px 22px,rgba(255,255,255,.3) 22px 30px)}
#wingBus .w1-ft{display:flex;justify-content:space-between;align-items:baseline;gap:18px;margin-top:6px;min-height:26px;white-space:nowrap}
#wingBus .w1-dt{min-width:0;flex:1;font:600 22px/1.2 var(--sf);color:#FF9F0A;overflow:hidden;text-overflow:clip}
#wingBus .w1-sg{flex:none;margin-left:auto;font:700 22px/1 var(--sf);letter-spacing:.03em;color:#fff}`; document.head.appendChild(css); })();
function w1T12(ms){ return new Date(ms).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).replace(/[   ]/g,W1N); }
function w1Home(){ if(typeof window.__w1Home==='boolean') return window.__w1Home; try{ return effMode()!=='off'; }catch(e){ return true; } }
function w1Snap(){ return window.__w1Mock||V2.bus; }
/* rows: per line the best reachable bus. A bus whose leave-by has passed (the walk can no longer make it) is skipped, so the row jumps to the next bus on that line
   or to a faster other line; a negative or expired leave-by never shows. Sorted by leave-by. */
function w1Rows(now){ const b=w1Snap(); if(!b||!b.lines) return [];
  const at=window.__w1Mock?now:V2.busAt, old=!at||now-at>300000, best={};
  b.lines.forEach(r=>{ const k=v2LineKey(r); if(!k) return; if(k==='105'&&!/LAX/i.test((r.toward||'')+' '+(r.direction||'')+' '+(r.headsign||''))) return;
    const walk=r.walk_min!=null?r.walk_min:5;
    for(const a of (r.arrivals||[])){ const leave=a.eta-walk*60000; if(leave<now-20000) continue;
      const x={k,r,a,eta:a.eta,leave,walk,live:!!(a.live&&r.live&&!r.stale&&!old&&k!=='FAIRFAX')}; if(!best[k]||x.eta<best[k].eta) best[k]=x; break; } });
  return Object.values(best).sort((p,q)=>p.leave-q.leave); }
function w1Fit(el,floor){ if(!el||!el.clientWidth) return; const sig=el.textContent+'|'+el.clientWidth; if(el._w1f===sig) return; el.style.fontSize=''; el._w1o=el._w1o||el.textContent; el.textContent=el._w1o;
  const ov=()=>el.scrollWidth>el.clientWidth+1; let s=parseFloat(getComputedStyle(el).fontSize);
  while(ov()&&s>floor){ s-=1; el.style.fontSize=s+'px'; }
  if(ov()){ const p=el.textContent.split(/\s+/); while(p.length>1&&ov()){ p.pop(); el.textContent=p.join(' '); } }
  el._w1f=el.textContent+'|'+el.clientWidth; }
function w1Set(el,txt){ if(el._w1t!==txt){ el._w1t=txt; el._w1o=txt; el._w1f=null; el.style.fontSize=''; el.textContent=txt; } }
function w1Ensure(el){ if(el.querySelector('.w1')) return; el.innerHTML='<div class="w1"><div class="w1-hd">Buses</div><div class="w1-rows"></div><div class="w1-ft"><span class="w1-dt"></span><span class="w1-sg">Mae</span></div></div>'; W1.sig=''; }
function w1Badge(k,b){ if(k==='CITYLINE'){ return `<div class="w1-b" style="--c:#E63540">${CITY_LOGO?`<img src="${CITY_LOGO}" alt="">`:'CL'}</div>`; }
  return `<div class="w1-b" style="--c:${k==='FAIRFAX'?'#8A2528':'#E16710'}"><span class="w1-bn">${k==='FAIRFAX'?'DASH':k}</span></div>`; }
function w1Render(el,rows,now,snap){ w1Ensure(el); const host=el.querySelector('.w1-rows'), want=rows.map(x=>x.k+'|'+(x.a.trip||x.eta)), have=[...host.children];
  have.forEach(c=>{ if(want.indexOf(c.dataset.k)<0) c.remove(); });
  const showing=document.body.dataset.scn==='bus';
  rows.forEach((x,i)=>{ const key=want[i]; let c=[...host.children].find(e=>e.dataset.k===key);
    if(!c){ c=document.createElement('div'); c.className='w1-r'; c.dataset.k=key; c.innerHTML=w1Badge(x.k)+'<div class="w1-s"><span class="w1-n"></span><span class="w1-w"></span></div><div class="w1-e"><span class="w1-m"></span><span class="w1-l"></span></div>'; host.appendChild(c); }
    if(host.children[i]!==c) host.insertBefore(c,host.children[i]||null);
    const r=x.r, m=Math.max(0,Math.round((x.eta-now)/60000)), nowGo=x.leave-now<=60000;
    const bn=c.querySelector('.w1-bn'); if(bn&&!bn._w1){ bn._w1=1; let s=40; bn.style.fontSize=s+'px'; const b=bn.parentNode; while(bn.scrollWidth>b.clientWidth-8&&s>24){ s-=1; bn.style.fontSize=s+'px'; } if(bn.textContent==='DASH') bn.style.fontSize=Math.min(s,30)+'px'; }
    w1Set(c.querySelector('.w1-n'),String(r.stop||'').replace(/ \/ /g,W1N+'/ '));
    w1Set(c.querySelector('.w1-w'),(x.live?(x.k==='105'?'Toward LAX':(r.direction||'')):'Scheduled')+' · '+x.walk+W1N+'min walk');
    const mm=c.querySelector('.w1-m'), mt=(m<1?'Now':m+W1N+'min')+'|'+(x.a.occ||''); if(mm._w1t!==mt){ mm._w1t=mt; mm.textContent=m<1?'Now':m+W1N+'min'; if(x.a.occ&&x.live){ const g=document.createElement('i'); g.className='w1-oc '+x.a.occ; mm.appendChild(g); } }
    w1Set(c.querySelector('.w1-l'),nowGo?'Leave now':'Leave'+W1N+'by'+W1N+w1T12(x.leave));
    c.classList.toggle('sch',!x.live);
    if(nowGo&&showing&&!c.classList.contains('now')) c.classList.add('now'); });
  const dt=el.querySelector('.w1-dt'); w1Set(dt,(snap&&snap.alert&&snap.alert.label)||'');
  host.querySelectorAll('.w1-n').forEach(e=>w1Fit(e,24)); host.querySelectorAll('.w1-w').forEach(e=>w1Fit(e,20)); w1Fit(dt,20); }
/* shows only when he is home and a bus on his lines is within about 20 minutes; takes the shared slot by urgency (see w1Want) */
v2BusPaint=function(){ try{ const el=document.getElementById('wingBus'); if(!el) return; const now=Date.now(), rows=w1Rows(now); W1.rows=rows;
    const on=w1Home()&&rows.some(x=>x.eta-now<=20*60000);
    W1.leaveNow=on&&rows.some(x=>x.leave-now<=60000);
    if(on){ w1Render(el,rows.filter(x=>x.eta-now<=60*60000).slice(0,3),now,w1Snap()); }
    document.body.classList.toggle('bus-on',!!on); }catch(e){ W1.errs++; V2.errs++; } };
scBusFit=function(){};
/* shared slot: a leave-now bus outranks a normal plane card; a notable or emergency plane card still preempts it; otherwise plane > bus > key */
function w1Want(fl,bus,key){ let strong=false; try{ const wf=document.getElementById('wingFlight'); strong=!!(fl&&wf&&wf.querySelector('.ft.nt,.ft.sos')); }catch(e){}
  if(bus&&W1.leaveNow&&!strong) return 'bus'; return fl?'flight':bus?'bus':key?'key':'none'; }
/* Airports card: count the phased arrivals (fz arr, fa = the airport) the sky tags use, plus the sky board arrivals, one per hex; next ETA = the sooner */
{ const _apBd=apBd; apBd=function(code){ const B=_apBd(code); try{ const now=Date.now(), seen={}, list=[];
      ((B&&B.arrivals)||[]).forEach(r=>{ const h=String(r.hex||'').toLowerCase(), ms=r.eta_ts?r.eta_ts*1000:now+(r.minutes||0)*60000; if(h) seen[h]=ms; list.push({h:h,ms:ms}); });
      Object.keys(V2.m||{}).forEach(h=>{ const v=V2.m[h]; if(!v||v.fz!=='arr'||v.fa!==code) return; const ms=now+(v.fm||0)*60000, k=String(h).toLowerCase();
        if(seen[k]!==undefined){ if(ms<seen[k]){ const e=list.find(q=>q.h===k); if(e) e.ms=ms; } } else { list.push({h:k,ms:ms}); seen[k]=ms; } });
      if(!list.length) return B; list.sort((p,q)=>p.ms-q.ms);
      const rows=list.map(q=>({hex:q.h,eta_ts:Math.round(q.ms/1000),eta:w1T12(q.ms),minutes:Math.max(0,Math.round((q.ms-now)/60000))}));
      return Object.assign({},B||{},{arrivals:rows,next_eta:rows[0].eta,count15:rows.filter(q=>q.minutes<=15).length}); }catch(e){ W1.errs++; V2.errs++; return B; } }; }
window.__w1=()=>({errs:W1.errs,leaveNow:W1.leaveNow,rows:W1.rows.map(x=>[x.k,x.r.stop,x.live,Math.round((x.eta-Date.now())/60000),Math.round((x.leave-Date.now())/60000)]),bus:document.body.classList.contains('bus-on'),scn:document.body.dataset.scn});
/* ===== end WAVE1_20261102 ===== */
