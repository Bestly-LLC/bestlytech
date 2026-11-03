/* ===== SIGNCLEAN_20261102: one big legible sign-wall card at a time (flight / key pages / airports / bus), airport chips on the sky ===== */
const SC={cur:null,idx:-1,until:0,lastFl:0,p:0,kT:0,errs:0};
function scPin(){ if(!S||!S.wing||S.wing.length!==4) return; const g=homo(WW,WH,S.wing);
  const f=(x,y)=>{ const d=g[6]*x+g[7]*y+1; return [(g[0]*x+g[1]*y+g[2])/d/innerWidth,(g[3]*x+g[4]*y+g[5])/d/innerHeight]; };
  ['wingFlight','wingKey','wingBus'].forEach(id=>{ const el=document.getElementById(id); if(el) pinEl(el,960,468,[f(20,20),f(980,20),f(980,488),f(20,488)]); }); }
pinFlight=scPin; pinKey=scPin; pinBus=scPin;
pinAlerts=function(force){ const el=document.getElementById('wingAlerts'); if(!el||!S.wing||S.wing.length!==4) return; if(!force&&el._pinned===2) return; el._pinned=2;
  const g=homo(WW,WH,S.wing), f=(x,y)=>{ const d=g[6]*x+g[7]*y+1; return [(g[0]*x+g[1]*y+g[2])/d/innerWidth,(g[3]*x+g[4]*y+g[5])/d/innerHeight]; };
  pinEl(el,940,360,[f(20,790),f(490,790),f(490,970),f(20,970)]); };
/* the bus card element exists now so v2BusPaint does not register its old rectangle; the band is registered instead */
if(!document.getElementById('wingBus')){ const e=document.createElement('div'); e.id='wingBus'; document.body.appendChild(e); }
(function(){ const A=WING_AVOID, band=[20,20,980,488]; const i=A.findIndex(k=>k[0]===30&&k[1]===304&&k[2]===490&&k[3]===484);
  if(i>=0) A[i]=band; else if(!A.some(k=>k[0]===20&&k[1]===20&&k[3]===488)) A.push(band);
  if(!A.some(k=>k[0]===20&&k[1]===790)) A.push([20,790,490,975]); })();
scPin();
/* ---- the old LAX/BUR "Landing next over you" board in the plane-card slot is retired: the Airports page of the key replaces it ---- */
v2BoardOn=function(){ return false; };
function scApOK(){ const b=V2.board; return !!(b&&b.airports&&['LAX','BUR','ONT'].some(c=>b.airports[c])); }
function scApHtml(){ const rows=['LAX','BUR','ONT'].map(c=>{ const A=AP[c], B=apBd(c); let st='No arrivals now', q=1, n='';
    if(B){ if(B.night){ st='Landing east · Over the ocean'; q=0; } else if((B.arrivals||[]).length){ st='Landing'+(B.flow?' '+B.flow:'')+' · next '+apT12(B.next_eta); q=0; if(B.count15>0) n=B.count15+NBP+'in'+NBP+'15'+NBP+'min'; } }
    return `<div class="ap${q?' q':''}" style="--c:${A.c};--t:${A.t}"><i class="cb">${c}</i><b>${esc(A.n)}</b><em class="n">${esc(n)}</em><span>${esc(st)}</span></div>`; });
  return `<div class="sck"><h4><span>Airports</span><em>Live radar</em></h4>${rows.join('')}</div>`; }
function scKeyHtml(p){
  if(p===2) return scApHtml();
  if(!p){ const rows=[['airline','jet'],['heli','heli'],['cargo','jet'],['rescue','heli'],['bizjet','biz'],['military','jet'],['small','small'],['unknown','jet']];
    return `<div class="sck"><h4><span>Sky key</span><em>Within ${RADMI()}${NBP}mi</em></h4><div class="g2">${rows.map(([k,pp])=>`<div class="k"><svg viewBox="0 0 48 48" style="color:${KINDS[k][1]}"><path d="${TD[pp]}"/></svg>${esc(KINDS[k][0])}</div>`).join('')}</div>`+
      `<div class="hc"><div><svg viewBox="0 0 48 48" width="30" height="30" style="opacity:1"><path d="${TD.jet}"/></svg><span><b>Low</b>under 2,000${NBP}ft</span></div><div><svg viewBox="0 0 48 48" width="24" height="24" style="opacity:.78"><path d="${TD.jet}"/></svg><span><b>Mid</b>to 20,000${NBP}ft</span></div><div><svg viewBox="0 0 48 48" width="18" height="18" style="opacity:.5"><path d="${TD.jet}"/></svg><span><b>High</b>over 20,000${NBP}ft</span></div></div></div>`; }
  return `<div class="sck"><h4><span>Alerts</span><em>Color + symbol</em></h4><div class="g2">${V2AL.map(([n,i,c])=>`<div class="k"><span class="dc" style="--c:${c}"><svg viewBox="0 0 24 24">${V2IC[i]}</svg></span>${esc(n)}</div>`).join('')}</div><div class="ex"><i style="background:rgba(255,200,80,.35);box-shadow:inset 0 0 0 3px #ffc43d">NOTABLE</i><i style="background:#d62b21">7700 Emergency</i><i style="background:rgba(120,170,255,.35)">Off the map ›</i></div></div>`; }
v2Key=function(){ const kEl=document.getElementById('wingKey'); if(!kEl) return; const now=Date.now(), has=kEl.firstElementChild&&kEl.firstElementChild.classList.contains('sck');
  if(has&&now-SC.kT<300&&kEl._p===SC.p) return; SC.kT=now; const h=scKeyHtml(SC.p); if(!has||kEl._h!==h){ kEl._h=h; kEl._p=SC.p; kEl.innerHTML=h; } kEl._p=SC.p; };
/* ---- bus card: soonest 3 lines, clean grid ---- */
v2BusHtml=function(){ const rows=v2BusRows(), now=Date.now(); if(!rows.length) return '';
  const full=rows.filter(x=>x.first-now<30*60000), quiet=rows.filter(x=>!(x.first-now<30*60000)), out=[];
  const badge=x=>x.k==='CITYLINE'?`<div class="rb" style="--c:#E63540"><img src="${CITY_LOGO}" alt=""></div>`:`<div class="rb${x.k==='FAIRFAX'?' d':''}" style="--c:${x.k==='FAIRFAX'?'#8A2528':'#E16710'}">${x.k==='FAIRFAX'?'DASH':x.k}</div>`;
  full.slice(0,3).forEach(x=>{ const r=x.r, m0=Math.max(0,Math.round((x.arr[0].eta-now)/60000)), m1=x.arr[1]?Math.max(0,Math.round((x.arr[1].eta-now)/60000)):null, live=!!x.arr[0].live;
    let lv=''; if(r.walk_min!=null&&r.walk_min<=20){ const c=x.arr.find(a=>a.eta-r.walk_min*60000>now-30000); if(c) lv=(c.eta-r.walk_min*60000<=now+30000)?'<b>Leave now</b>':'Leave by<b>'+v2t12(c.eta-r.walk_min*60000)+'</b>'; } else if(r.walk_min!=null) lv='<b>'+r.walk_min+NBP+'min</b>away';
    out.push(`<div class="br">${badge(x)}<div class="st"><b>${esc(r.stop||'').replace(/ \/ /g,'\u00a0/ ')}</b><span>${esc(x.k==='105'?(r.toward||r.direction||'Toward LAX'):(r.direction||''))}${x.k==='CITYLINE'?' · Schedule':''}</span></div><div class="et"><b>${m0<1?'Now':m0+NBP+'min'}</b><span>${m1!=null?'then '+m1+NBP+'min':(live?'Live':'Schedule')}</span></div><div class="lv">${lv}</div></div>`); });
  quiet.slice(0,Math.max(0,3-out.length)).forEach(x=>{ out.push(`<div class="br q">${badge(x)}<div class="st"><b>${esc(x.r.name||'')}</b></div><div class="et">${x.arr[0]?'Next '+v2t12(x.arr[0].eta):'No bus soon'}</div></div>`); });
  return `<div class="v2bus"><div class="bh"><span>Buses near you</span><small>${V2.bus.metro_live?'Live':'Schedule'}<span class="sg">Sky Sync</span></small></div>${out.join('')}</div>`; };
skBusCard=function(){};
function scBusFit(){ const el=document.getElementById('wingBus'); if(!el) return; const card=el.querySelector('.v2bus'); if(!card) return; const rows=[...card.querySelectorAll('.br')]; rows.forEach(r=>{ r.style.display=''; });
  for(let i=rows.length-1;i>0;i--){ if(card.scrollHeight<=card.clientHeight+1) break; rows[i].style.display='none'; } }
/* ---- flight card: autofit with floors (label 50, others 34-36 css px), never clipped ---- */
function scFitEl(e,floor,dropWords){ e.style.fontSize=''; if(!e.clientWidth) return; const base=parseFloat(getComputedStyle(e).fontSize)||20; let s=base; if(e._sc0!==e.textContent&&e._sc1===undefined) e._sc0=e.textContent;
  while(e.scrollWidth>e.clientWidth+1&&s>floor){ s=Math.max(floor,s-2); e.style.fontSize=s+'px'; }
  if(dropWords&&e.scrollWidth>e.clientWidth+1){ const sep=e.dataset.k==='meta'||e.dataset.k==='sub2'?' · ':' '; let parts=e.textContent.split(sep); while(parts.length>1&&e.scrollWidth>e.clientWidth+1){ parts.pop(); e.textContent=parts.join(sep); } } }
v2Fit=function(wf){ wf.querySelectorAll('.fit').forEach(e=>{ const k=e.dataset.k; scFitEl(e,k==='fl2'?52:40,true); }); };
const CMP={north:'N',northeast:'NE',east:'E',southeast:'SE',south:'S',southwest:'SW',west:'W',northwest:'NW'};
function scStats(wf){ wf.querySelectorAll('[data-k=far]').forEach(e=>{ const t=e.textContent.replace(/(mi\s)(North|Northeast|East|Southeast|South|Southwest|West|Northwest)\b/i,(m,a,b)=>a+CMP[b.toLowerCase()]); if(t!==e.textContent) e.textContent=t; });
  wf.querySelectorAll('.ft-st').forEach(st=>{ const bs=[...st.querySelectorAll('b')]; bs.forEach(b=>{ b.style.fontSize=''; }); let s=parseFloat(getComputedStyle(bs[0]||st).fontSize)||52; while(st.scrollWidth>st.clientWidth+1&&s>44){ s-=2; bs.forEach(b=>{ b.style.fontSize=s+'px'; }); } }); }
{ const _ps2=passSet; passSet=function(wf,d){ _ps2(wf,d); try{ scStats(wf); const sm=wf.querySelector('.v2ph small'); if(sm){ if(/^Photo:/i.test(sm.textContent)) sm.textContent=sm.textContent.replace(/^Photo:\s*/i,''); if(sm.offsetHeight>84){ const w=sm.textContent.split(' '); while(w.length>1&&sm.offsetHeight>84){ w.pop(); sm.textContent=w.join(' '); } } } wf.querySelectorAll('.ft-fl,.ft-ty,.ft-ct span,.ft-tt,.ft-sb,.ft-lb span,.ft-lb b').forEach(e=>{ if(e.classList.contains('fit')) return; scFitEl(e,e.matches('.ft-tt')?52:40,true); }); scVFit(wf); }catch(e){ V2.errs++; } }; }
function scVFit(wf){ const c=wf.firstElementChild; if(!c) return; const L=['.v2sub','.ft-pg','.ft-lb']; L.forEach(s=>{ const e=c.querySelector(s); if(e) e.style.visibility=''; }); for(const s of L){ if(c.scrollHeight<=c.clientHeight+1) break; const e=c.querySelector(s); if(e) e.style.visibility='hidden'; } }
/* ---- scene scheduler: flight (when a real plane is up) -> key planes -> key alerts -> airports -> bus ---- */
function scFlReal(){ const wf=document.getElementById('wingFlight'); return document.body.classList.contains('fl-on')&&!!wf&&!!wf.querySelector('.ft')&&!/Quiet skies/.test(wf.textContent)&&!wf.querySelector('.v2brd'); }
function scTick(){ try{ const cl=document.body.classList, now=Date.now(), fl=scFlReal(), key=cl.contains('key-on'), bus=cl.contains('bus-on'), apok=scApOK(), base=[];
  if(key){ base.push({s:'key',p:0,d:7000},{s:'key',p:1,d:7000}); if(apok) base.push({s:'key',p:2,d:9500}); } if(bus) base.push({s:'bus',p:0,d:10000});
  if(SC.hold){ SC.cur=SC.hold; if(document.body.dataset.scn!==SC.hold.s) document.body.dataset.scn=SC.hold.s; if(SC.hold.s==='key'){ SC.p=SC.hold.p; v2Key(); } if(SC.hold.s==='bus') scBusFit(); return; }
  let c=SC.cur; const valid=x=>!!x&&((x.s==='flight'&&fl)||(x.s==='key'&&key&&(x.p!==2||apok))||(x.s==='bus'&&bus));
  if(c&&c.s==='flight'&&(!valid(c)||(base.length&&now>=SC.until))){ SC.lastFl=now; c=null; }
  if(c&&c.s!=='flight'&&(!valid(c)||now>=SC.until)) c=null;
  if(c&&c.s!=='flight'&&fl&&now-SC.lastFl>24000) c=null;
  if(!c){ if(fl&&(now-SC.lastFl>24000||!base.length)){ c={s:'flight',p:0}; SC.until=now+20000; } else if(base.length){ SC.idx=(SC.idx+1)%base.length; c=base[SC.idx]; SC.until=now+c.d; } }
  SC.cur=c; const nm=c?c.s:'none'; if(document.body.dataset.scn!==nm) document.body.dataset.scn=nm;
  if(c&&c.s==='key'){ if(SC.p!==c.p){ SC.p=c.p; } v2Key(); }
  if(c&&c.s==='bus') scBusFit(); }catch(e){ SC.errs++; V2.errs++; } }
setInterval(scTick,400);
setInterval(()=>{ try{ if(document.body.dataset.scn==='key') v2Key(); }catch(e){ V2.errs++; } },1000);
window.__scHold=(s,p)=>{ SC.hold=s?{s:s,p:p||0}:null; if(!s) SC.until=0; };
window.__scFit=wf=>{ scStats(wf); v2Fit(wf); wf.querySelectorAll('.ft-fl,.ft-ty,.ft-ct span,.ft-tt,.ft-sb,.ft-lb span,.ft-lb b').forEach(e=>{ if(!e.classList.contains('fit')) scFitEl(e,e.matches('.ft-tt')?52:40,true); }); };
window.__sc=()=>({scn:document.body.dataset.scn,p:SC.p,errs:SC.errs,until:SC.until-Date.now()});
/* ===== end SIGNCLEAN_20261102 ===== */
