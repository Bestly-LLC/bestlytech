/* ===== FLIGHTV2_P2 20261102: enriched plane tags, height cue, predicted path, off-map pills, plane card v2, LAX/BUR board, key v2, buses ===== */
const V2={m:{},at:0,board:null,bus:null,busAt:0,errs:0,eAt:0,els:{},bels:{},bKey:'',kKey:'',cKey:''};
const NBP=' ', CITY_LOGO='data:image/png;base64,@@CITYLOGO@@';
const v2t12=ms=>new Date(ms).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).replace(/[   ]/g,NBP);
const v2hex=o=>String((o&&o.a&&o.a.hex)||'').toLowerCase().replace('~','');
const vc=o=>V2.m[v2hex(o)]||null;
const v2em=v=>{ const e=v&&v.emergency; if(!e) return ''; const s=typeof e==='string'?e:(e.squawk||e.code||''); return /^\d{4}$/.test(String(s))?String(s):'EMERGENCY'; };
const v2nt=v=>!!(v&&((v.notable&&v.notable.length)||v.military||v.interesting));
async function v2Pull(){ try{ const r=await (await fetch('/api/aircraft/live',{cache:'no-store'})).json(); const m={}; (r.aircraft||[]).forEach(x=>{ if(x&&x.hex) m[String(x.hex).toLowerCase()]=x; }); V2.m=m; V2.at=Date.now(); }catch(e){ V2.errs++; } }
async function v2BoardPull(){ try{ V2.board=await (await fetch('/api/sky-board',{cache:'no-store'})).json(); }catch(e){ V2.errs++; } }
async function v2BusPull(){ try{ const r=await (await fetch('/api/bus',{cache:'no-store'})).json(); V2.bus=(r&&r.lines&&r.lines.length)?r:null; V2.busAt=Date.now(); }catch(e){ V2.bus=null; } }
// ----- 1 + 2: tag pill (line 1 label, line 2 type + altitude), notable ring, emergency pill; height curve 0-45,000 ft -----
function v2Tag(o,I,txt){ const v=vc(o), el=o.tagEl;
  if(!v||!v.label){ if(o._v2){ o._v2=0; o._v2k=''; el.classList.remove('v2','nt','sos'); el.textContent=''; } if(el.textContent!==txt) el.textContent=txt; return txt; }
  const em=v2em(v), nt=!em&&v2nt(v);
  const alt=o.a.alt!=null?(Math.round(o.a.alt/100)*100).toLocaleString('en-US')+NBP+'ft':'';
  const ty=v.tier==='airline'?(v.type_code||v.type_name||''):(v.type_name||v.type_code||'');
  const l2=em?((/^\d{4}$/.test(em)?'SQUAWK '+em:'EMERGENCY')+(alt?' · '+alt:'')):[ty,alt].filter(Boolean).join(' · ');
  const k=v.label+'|'+l2+'|'+(nt?1:0)+(em?1:0);
  if(o._v2k!==k){ o._v2k=k; o._v2=1; el.classList.add('v2'); el.classList.toggle('sos',!!em); el.classList.toggle('nt',!!nt);
    el.innerHTML='<b>'+esc(v.label)+(nt?'<em>NOTABLE</em>':'')+'</b><span>'+esc(l2)+'</span>'; }
  return 'x'.repeat(Math.max(v.label.length+(nt?8:0),Math.ceil(l2.length*.72))); }
function v2Sc(alt){ const h=Math.min(1,Math.max(0,(alt||0)/45000)); return 1.42-.9*Math.pow(h,.62); }
function v2Hz(o,alt){ const h=Math.min(1,Math.max(0,(alt||0)/45000)), q=Math.round((1-Math.pow(h,.62))*20)/20;
  if(o._hz!==q){ o._hz=q; o.el.style.setProperty('--hz',q); o.ico.style.opacity=(.5+.5*q).toFixed(2); } }
// ----- 3: dotted path about 2 minutes ahead (the fading trail behind each plane is the existing drawTrails ribbon) -----
function v2Pred(c,proj,kp,now){ c.save(); c.lineCap='round';
  Object.values(AIRS).forEach(o=>{ const a=o.a; if(!a||!o.disp||o.gone||o.entering||!o.col||!(o.op>.3)||!(a.gs>40)||a.track==null) return;
    const tr=a.track*Math.PI/180, cl=Math.cos(a.lat*Math.PI/180), pt=dt=>airXY(a.lat+a.gs*Math.cos(tr)*dt/3600/60, a.lon+a.gs*Math.sin(tr)*dt/3600/(60*cl)), p0=pt(0), rgb=hexRgb(o.col).join(','), N=9;
    for(let i=1;i<=N;i++){ const q=pt(120*i/N), P=proj(o.disp[0]+q[0]-p0[0], o.disp[1]+q[1]-p0[1]); if(!P) continue; const f=1-(i-1)/N;
      c.fillStyle=`rgba(${rgb},${(.7*f*o.op).toFixed(3)})`; c.beginPath(); c.arc(P[0],P[1],Math.max(1.8,5.2*(o.sc||1)*kp*(.45+f*.55)),0,6.2832); c.fill(); } });
  c.restore(); }
// ----- 4: off-map edge pills for planes the 15 mi poller sees beyond the drawn radius -----
function v2Edge(now){ if(now-V2.eAt<1000||!AF.ppn) return; V2.eAt=now; const box=$('#airPlanes'); if(!box) return;
  const R=RADMI(), hx=AF.hx??AF.cx, hy=AF.hy??AF.my, want=[];
  Object.values(V2.m).forEach(v=>{ const lv=v.live; if(!lv||lv.on_ground||lv.lat==null||lv.dist_mi==null||lv.dist_mi<=R||lv.dist_mi>15.5) return;
    const ex=AIRS[String(v.hex).toLowerCase()]; if(ex&&ex.op>.2) return; const p=airXY(lv.lat,lv.lon);
    if(obD(p[0],p[1],0)>20&&obD(p[0],p[1],1)>20) return; want.push([lv.dist_mi,v,p]); });
  want.sort((a,b)=>a[0]-b[0]); const keep={};
  want.slice(0,4).forEach(([d,v,p])=>{ const hv=obHold(p[0],p[1],140,60,0), k=String(v.hex); keep[k]=1; let e=V2.els[k];
    if(!e){ e=document.createElement('div'); e.className='v2e'; e.innerHTML='<div class="in"><b></b><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="M8 4l8 8-8 8"/></svg></div>'; box.appendChild(e); V2.els[k]=e; }
    const ang=Math.atan2(p[1]-hy,p[0]-hx)*180/Math.PI, txt=(v.label||v.registration||'Aircraft')+' · '+d.toFixed(1)+NBP+'mi', b=e.firstChild.firstChild;
    if(b.textContent!==txt) b.textContent=txt; e.firstChild.lastChild.style.transform='rotate('+ang.toFixed(0)+'deg)';
    e.style.transform=skyPt(hv[0],hv[1]); e.classList.toggle('sos',!!v2em(v)); });
  Object.keys(V2.els).forEach(k=>{ if(!keep[k]){ V2.els[k].remove(); delete V2.els[k]; } }); }
// ----- 5: plane card v2 (photo, route, lands time, stats; notable + emergency variants signed Sky Sync) -----
function v2Card(d,o,v){ const a=o.a, t=d.t, rt=v.route||{}, em=v2em(v), nt=!em&&v2nt(v);
  d.v2=1; d.v2v=em?'sos':nt?'nt':'';
  t.chip=em?(/^\d{4}$/.test(em)?'EMERGENCY '+em:'EMERGENCY'):nt?('NOTABLE'+((v.notable&&v.notable[0])?' · '+String(v.notable[0]).toUpperCase():'')):'';
  t.sign=(em||nt)?'Sky Sync':'';
  t.fl2=v.label;
  t.meta=[v.type_name||v.type_code,v.registration,(v.age_years!=null?Math.round(v.age_years)+NBP+'yrs':'')].filter(Boolean).join(' · ');
  if(v.photo&&v.photo.thumb) d.ph={src:v.photo.thumb,cap:/^photo/i.test(v.photo.credit||'')?v.photo.credit:'Photo: '+(v.photo.credit||'planespotters.net')};
  if(!(d.shape==='route')&&rt.from&&rt.to){ d.shape='route'; t.from=rt.from; t.to=rt.to; t.fromN=rt.from_city||''; t.toN=rt.to_city||''; d.p=.5; }
  else if(d.shape==='route'){ t.fromN=t.fromN||rt.from_city||''; t.toN=t.toN||rt.to_city||''; }
  let lands='';
  if(d.shape==='route'){ const to=t.to; if(a.to_ll&&a.gs>60&&a.lat!=null){ const d2=gcNm([a.lat,a.lon],a.to_ll);
      if(d2<3||((a.alt||0)<1500&&(a.vr||0)<0)) lands='Landing '+to+' now'; else { const mins=d2/a.gs*60+((a.alt||0)>8000&&d2<40?6:0); lands='Lands '+to+' '+v2t12(Date.now()+mins*60000); } } }
  t.lands=lands;
  t.sub2=d.shape==='route'?'':[v.operator&&v.tier!=='airline'?v.operator:'',a.area?'Over '+a.area:''].filter(Boolean).join(' · ');
  const cp=String(compass(a.dir)||''); t.far=a.dst!=null?((a.dst*1.1508).toFixed(1)+NBP+'mi'+(cp?' '+cp.charAt(0).toUpperCase()+cp.slice(1):'')):'—'; }
const _pd=passData, _ph=passHtml, _ps=passSet, _pe=passEmpty, _pp=passPick;
passData=function(o){ const d=_pd(o); try{ const v=vc(o); if(v&&v.label) v2Card(d,o,v); }catch(e){ V2.errs++; } return d; };
passHtml=function(d){ if(!d.v2) return _ph(d);
  const ph=d.ph, photo=ph&&ph.src?`<div class="v2ph"><img src="${esc(ph.src)}" alt=""><small data-k="cap"></small></div>`:`<div class="v2ph"><svg viewBox="0 0 48 48"><path d="${TD.jet}"/></svg></div>`;
  const rt=d.shape==='route'?`<div class="ft-rt"><span class="ft-c" data-k="from"></span><span class="ft-mid"><i></i><svg viewBox="0 0 48 48"><path d="${TD.jet}"/></svg><i></i></span><span class="ft-c" data-k="to"></span></div><div class="ft-ct"><span class="fit" data-k="fromN"></span><span class="fit" data-k="toN"></span></div><div class="ft-pg"><i class="ln"></i><i class="fill"></i><i class="pt"></i></div><div class="v2lands fit" data-k="lands"></div>`:'';
  return `<div class="ft v2c ${d.v2v}" style="--acc:${d.acc}"><div class="v2chip" data-k="chip"></div><div class="v2top">${photo}<div class="v2id"><div class="v2fl fit" data-k="fl2"></div><div class="v2mt fit" data-k="meta"></div><div class="v2sub fit" data-k="sub2"></div></div></div>${rt}<div class="ft-st"><div><b data-k="alt"></b><span>Altitude</span></div><div><b data-k="mph"></b><span>Speed</span></div><div><b data-k="far"></b><span>Distance</span></div></div><div class="v2sign" data-k="sign"></div></div>`; };
passSet=function(wf,d){ _ps(wf,d); try{ if(d.v2){ if(d.ph&&d.ph.src){ const im=wf.querySelector('.v2ph img'); if(im&&im.getAttribute('src')!==d.ph.src) im.setAttribute('src',d.ph.src); const cp=wf.querySelector('.v2ph small'); if(cp) cp.textContent=d.ph.cap; } v2Fit(wf); } }catch(e){ V2.errs++; } };
function v2Fit(wf){ wf.querySelectorAll('.fit').forEach(e=>{ e.style.fontSize=''; if(!e.clientWidth) return; const base=parseFloat(getComputedStyle(e).fontSize)||20; let s=base;
    while(e.scrollWidth>e.clientWidth+1&&s>base*.55){ s-=2; e.style.fontSize=s+'px'; }
    if(e.scrollWidth>e.clientWidth+1&&e.dataset.k==='meta'){ let parts=e.textContent.split(' · '); while(parts.length>1&&e.scrollWidth>e.clientWidth+1){ parts.pop(); e.textContent=parts.join(' · '); } } }); }
// ----- 6: LAX / BUR "Landing next over you" board, rotating into the plane-card slot -----
function v2BoardOn(){ const b=V2.board; if(!b||!b.airports) return false; if(!Object.values(b.airports).some(a=>(a.arrivals||[]).length)) return false; return Date.now()%80000<12000; }
function v2BoardHtml(){ const b=V2.board.airports, ph=Math.floor((Date.now()%80000)/6000)%2, order=ph?['BUR','LAX']:['LAX','BUR'], ap=(b[order[0]].arrivals||[]).length?order[0]:order[1], rows=(b[ap].arrivals||[]).slice(0,4);
  return `<div class="ft v2c v2brd" data-ap="${ap}"><div class="bhd"><span>Landing next over you</span><b class="${ap==='BUR'?'bur':''}">${ap}</b></div>${rows.map(r=>`<div class="rw"><div><b>${esc(r.flight)}</b><span>${esc(r.type||'')}</span></div><div><b>${esc(r.from||'')}</b><span>${esc(r.from_city||'')}</span></div><em>${esc(r.eta)}<small>${r.minutes<=0?'Landing now':r.minutes+NBP+'min'}</small></em></div>`).join('')}<div class="ft-ft">From live radar · no delay data</div><div class="v2sign">Sky Sync</div></div>`; }
passEmpty=function(){ return v2BoardOn()?v2BoardHtml():_pe(); };
passPick=function(){ if(v2BoardOn()){ TAG.hex=null; TAG.since=0; return 'empty'; } return _pp(); };
setInterval(()=>{ try{ const wf=$('#wingFlight'); if(wf&&TAG.shown==='empty'&&v2BoardOn()){ const h=v2BoardHtml(), k=h.length+h.slice(0,200)+(wf.firstElementChild?wf.firstElementChild.dataset.ap:''); if(V2.cKey!==k){ V2.cKey=k; wf.innerHTML=h; } } }catch(e){ V2.errs++; } },1000);
// ----- 7: key v2 (two pages: planes + height cue, alerts + extras) -----
const V2IC={fire:'<path fill="currentColor" d="M12 2.5c.6 3 4.6 5 4.6 10a4.6 4.6 0 0 1-9.2 0c0-1.8.8-3 1.7-4 .3 1.2.9 1.8 1.7 1.8C10.4 7.4 10.7 5 12 2.5z"/>',police:'<path fill="currentColor" d="M12 2.5l7.5 3v5.8c0 4.6-3.1 8.2-7.5 10.2-4.4-2-7.5-5.6-7.5-10.2V5.5z"/>',star:'<path fill="currentColor" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/>',quake:'<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M2.5 12.5h4l2.5-7 4.5 14 3-9 1.5 2h4"/>',smoke:'<path fill="currentColor" d="M7.2 19a4.4 4.4 0 0 1-.6-8.7A6 6 0 0 1 18 9.4a4.8 4.8 0 0 1 .3 9.6z"/>',bolt:'<path fill="currentColor" d="M13.5 2L5 13.4h5.6L9.6 22 19 10.4h-5.8z"/>',closed:'<g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.2"/><path d="M6.2 17.8L17.8 6.2"/></g>',bus:'<path fill="currentColor" fill-rule="evenodd" d="M7 3h10a3 3 0 0 1 3 3v9.5a2 2 0 0 1-1.2 1.8V20a1 1 0 0 1-1 1h-1.6a1 1 0 0 1-1-1v-1.5H8.8V20a1 1 0 0 1-1 1H6.2a1 1 0 0 1-1-1v-2.7A2 2 0 0 1 4 15.5V6a3 3 0 0 1 3-3zM6.5 6.5V11h11V6.5zM7.6 13.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm8.8 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/>',drop:'<path fill="currentColor" d="M12 2.5c3.6 4.6 6.2 7.4 6.2 10.9a6.2 6.2 0 0 1-12.4 0C5.8 9.9 8.4 7.1 12 2.5z"/>',traffic:'<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M7.5 19V6M7.5 6l-3.3 3.6M7.5 6l3.3 3.6M16.5 5v13M16.5 18l-3.3-3.6M16.5 18l3.3-3.6"/>'};
const V2AL=[['Fire or medical','fire','#ff453a'],['Police','police','#0a84ff'],['Sheriff or city','star','#6e6bf2'],['Earthquake','quake','#b8844f'],['Wildfire or smoke','smoke','#f28a00'],['Power','bolt','#f2b705'],['Closures or events','closed','#bf5af2'],['Transit','bus','#2cb94a'],['Weather','drop','#29a8e0'],['Traffic','traffic','#ff5fae']];
function v2Key(){ const kEl=$('#wingKey'); if(!kEl) return; const ph=Math.floor(Date.now()/9000)%2, rk='v2'+ph+'r'+RADMI(); if(V2.kKey===rk&&kEl.dataset.v2===rk) return; V2.kKey=rk; kEl.dataset.v2=rk;
  let h;
  if(!ph){ const rows=[['airline','jet'],['heli','heli'],['cargo','jet'],['rescue','heli'],['bizjet','biz'],['military','jet'],['small','small'],['unknown','jet']];
    h=`<div class="v2key"><h4><span>Sky key</span><span>Within ${RADMI()}${NBP}mi</span></h4><div class="rows">${rows.map(([k,p])=>`<div class="k"><svg viewBox="0 0 48 48" style="color:${KINDS[k][1]}"><path d="${TD[p]}"/></svg>${KINDS[k][0]}</div>`).join('')}</div>`+
      `<div class="hc"><div><svg viewBox="0 0 48 48" width="62" height="62" style="opacity:1"><path d="${TD.jet}"/></svg><b>Low</b>under 2,000${NBP}ft</div><div><svg viewBox="0 0 48 48" width="42" height="42" style="opacity:.78"><path d="${TD.jet}"/></svg><b>Mid</b>up to 20,000${NBP}ft</div><div><svg viewBox="0 0 48 48" width="28" height="28" style="opacity:.5"><path d="${TD.jet}"/></svg><b>High</b>over 20,000${NBP}ft</div></div><div class="hn">Low is big and bright. High is small and faint.</div></div>`; }
  else h=`<div class="v2key"><h4><span>Alerts</span><span>Color + symbol</span></h4><div class="al">${V2AL.map(([n,i,c])=>`<div class="k"><span class="dc" style="--c:${c}"><svg viewBox="0 0 24 24">${V2IC[i]}</svg></span>${n}</div>`).join('')}</div><div class="ex"><i style="background:rgba(255,200,80,.35);box-shadow:inset 0 0 0 3px #ffc43d">NOTABLE</i><i style="background:#d62b21">7700 Emergency</i><i style="background:rgba(120,170,255,.35)">Off the map ›</i></div></div>`;
  kEl.innerHTML=h; }
const _rk=renderKey; renderKey=function(){ const on=_rk(); try{ if(on) v2Key(); }catch(e){ V2.errs++; } return on; };
// ----- 8: buses (Metro 10, 4, 210, DASH Fairfax, WeHo CityLine) -----
const V2BL=[['10','Metro 10'],['4','Metro 4'],['105','Metro 105'],['FAIRFAX','DASH Fairfax'],['CITYLINE','WeHo CityLine']];
function v2LineKey(r){ const s=(String(r.line||'')+' '+String(r.name||'')).toUpperCase(); if(/CITY/.test(s)) return 'CITYLINE'; if(/DASH|FAIRFAX/.test(s)) return 'FAIRFAX'; const m=String(r.line||r.name||'').match(/\b(105|10|4)\b/); return m?m[1]:null; }
function v2BusRows(){ const b=V2.bus; if(!b||!b.lines) return []; const now=Date.now(), by={};
  b.lines.forEach(r=>{ const k=v2LineKey(r); if(!k) return; if(k==='105'&&!/LAX/i.test((r.toward||'')+' '+(r.direction||'')+' '+(r.headsign||''))) return;
    const arr=(r.arrivals||[]).filter(a=>a.eta>now-30000); const first=arr.length?arr[0].eta:Infinity; if(!by[k]||first<by[k].first) by[k]={r,k,arr,first}; });
  return Object.values(by).sort((a,b)=>a.first-b.first); }
function v2BusHtml(){ const rows=v2BusRows(), now=Date.now(); if(!rows.length) return '';
  const full=rows.filter(x=>x.first-now<30*60000), quiet=rows.filter(x=>!(x.first-now<30*60000)), out=[];
  const badge=x=>x.k==='CITYLINE'?`<div class="rb" style="--c:#E63540"><img src="${CITY_LOGO}" alt=""></div>`:`<div class="rb" style="--c:${x.k==='FAIRFAX'?'#8A2528':'#E16710'}">${x.k==='FAIRFAX'?'DASH':x.k}</div>`;
  full.slice(0,4).forEach(x=>{ const r=x.r, m0=Math.max(0,Math.round((x.arr[0].eta-now)/60000)), m1=x.arr[1]?Math.max(0,Math.round((x.arr[1].eta-now)/60000)):null, live=!!x.arr[0].live;
    let lv=''; if(r.walk_min!=null&&r.walk_min<=20){ const c=x.arr.find(a=>a.eta-r.walk_min*60000>now-30000); lv=c?(c.eta-r.walk_min*60000<=now+30000?'Leave now':'Leave by '+v2t12(c.eta-r.walk_min*60000)):''; } else if(r.walk_min!=null) lv=r.walk_min+NBP+'min away';
    out.push(`<div class="br">${badge(x)}<div class="st"><b>${esc(r.stop||'')}</b><span>${esc(x.k==='105'?(r.toward||r.direction||'Toward LAX'):(r.direction||''))}${x.k==='CITYLINE'?' · Schedule':''}</span></div><div class="et"><b>${m0<1?'Now':m0+NBP+'min'}</b><span>${m1!=null?'then '+m1+NBP+'min':(live?'Live':'Schedule')}</span></div><div class="lv"><i class="${live?'':'s'}"></i>${esc(lv)}</div></div>`); });
  quiet.slice(0,Math.max(0,5-out.length)).forEach(x=>{ out.push(`<div class="br q">${badge(x)}<div class="st"><b>${esc(x.r.name||'')}</b></div><div class="et">${x.arr[0]?'Next '+v2t12(x.arr[0].eta):'No bus soon'}</div></div>`); });
  return `<div class="v2bus"><div class="bh"><span>Buses near you</span><small>${V2.bus.metro_live?'Live':'Schedule'}</small></div>${out.join('')}<div class="v2sign">Sky Sync</div></div>`; }
function pinBus(){ const el=$('#wingBus'); if(!el||!S.wing||S.wing.length!==4) return; const g=homo(WW,WH,S.wing);
  const f=(x,y)=>{ const d=g[6]*x+g[7]*y+1; return [(g[0]*x+g[1]*y+g[2])/d/innerWidth,(g[3]*x+g[4]*y+g[5])/d/innerHeight]; };
  pinEl(el,940,360,[f(30,304),f(490,304),f(490,484),f(30,484)]); }
const _pk=pinKey; pinKey=function(){ _pk(); try{ pinBus(); }catch(e){} };
function v2BusPaint(){ let el=$('#wingBus'); if(!el){ el=document.createElement('div'); el.id='wingBus'; document.body.appendChild(el); try{ WING_AVOID.push([30,304,490,484]); }catch(e){} pinBus(); }
  const h=v2BusHtml(); const k=h.replace(/\d+/g,'#'); if(h!==V2.bKey){ V2.bKey=h; el.innerHTML=h; } document.body.classList.toggle('bus-on',!!h&&effMode()!=='off'); }
function v2BusMarkers(now){ const box=$('#airPlanes'); if(!box||!AF.ppn) return; const keep={}, b=V2.bus;
  if(b&&b.vehicles&&effMode()!=='off') b.vehicles.slice(0,24).forEach(v=>{ const k=v2LineKey({line:v.line}); if(!k||v.lat==null) return; const p=airXY(v.lat,v.lng); if(!(obD(p[0],p[1],0)>30&&obD(p[0],p[1],1)>30)) return;
    const id='b'+v.id; keep[id]=1; let e=V2.bels[id]; if(!e){ e=document.createElement('div'); e.className='v2b'; e.style.setProperty('--c','#E16710'); e.innerHTML='<div class="bd"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" d="M6 14l6-6 6 6"/></svg></div><div class="lb">'+esc(k)+'</div>'; box.appendChild(e); V2.bels[id]=e; }
    e.style.transform=skyPt(p[0],p[1]); e.firstChild.style.transform='rotate('+(trackRot(v.bearing||0)+180).toFixed(0)+'deg)'; });
  Object.keys(V2.bels).forEach(k=>{ if(!keep[k]){ V2.bels[k].remove(); delete V2.bels[k]; } }); }
setInterval(()=>{ try{ v2BusPaint(); }catch(e){ V2.errs++; } },1000); setInterval(()=>{ try{ v2BusMarkers(performance.now()); v2Edge(performance.now()); }catch(e){ V2.errs++; } },1000);
setInterval(()=>{ try{ pinBus(); }catch(e){} },6000);
v2Pull(); v2BoardPull(); v2BusPull(); setInterval(v2Pull,6000); setInterval(v2BoardPull,20000); setInterval(v2BusPull,15000);
window.__v2=()=>({errs:V2.errs,planes:Object.keys(V2.m).length,age:V2.at?Date.now()-V2.at:null,board:!!V2.board,bus:!!V2.bus,edge:Object.keys(V2.els).length,bveh:Object.keys(V2.bels).length,v2tags:Object.values(AIRS).filter(o=>o._v2).length});
SKY.v2=()=>V2.errs;
/* ===== end FLIGHTV2_P2 ===== */
