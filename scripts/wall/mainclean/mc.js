/* ===== MAINCLEAN_20261102: main-mode clean-up (fit, pinned Airports + Local alerts, one shared slot, logo/icon photo slot) ===== */
const MN={errs:0,held:null};
/* ---- text is never cut: shrink to a floor, then drop trailing whole words. lines = how many lines it may use. ---- */
function mnFit(el,floor,lines){ try{ if(!el||!el.isConnected||!el.clientWidth) return;
  el.classList.add('mcf'); el.style.setProperty('--mcl',lines);
  const T=el.querySelector('.wmq-in')||el, tn=[...T.childNodes].find(n=>n.nodeType===3&&n.textContent.trim()); if(!tn) return;
  if(el._mnL!==tn.textContent){ el._mnO=tn.textContent; el._mnL=tn.textContent; el.style.fontSize=''; el._mnB=0; }
  const ov=()=>el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1;
  if(!ov()) return;
  if(!el._mnB) el._mnB=parseFloat(getComputedStyle(el).fontSize)||20;
  let s=el._mnB, g=0; while(ov()&&s>floor&&g++<40){ s-=1; el.style.fontSize=s+'px'; }
  if(ov()){ const parts=el._mnO.trim().split(/\s+/); while(parts.length>1&&ov()){ parts.pop(); tn.textContent=parts.join(' '); } el._mnL=tn.textContent; }
}catch(e){ MN.errs++; V2.errs++; } }
/* ---- pins: Local alerts (left wing column) and Airports (bottom wing strip), 1:1 with the wing ---- */
function mnPin(){ if(!S||!S.wing||S.wing.length!==4) return; const g=homo(WW,WH,S.wing);
  const f=(x,y)=>{ const d=g[6]*x+g[7]*y+1; return [(g[0]*x+g[1]*y+g[2])/d/innerWidth,(g[3]*x+g[4]*y+g[5])/d/innerHeight]; };
  const al=document.getElementById('wingAlerts'); if(al) pinEl(al,390,268,[f(20,512),f(410,512),f(410,780),f(20,780)]);
  const ap=document.getElementById('wingAp'); if(ap) pinEl(ap,670,185,[f(20,790),f(690,790),f(690,975),f(20,975)]); }
pinAlerts=function(force){ mnPin(); };
pinFlight=function(){ scPin(); mnPin(); };
(function(){ const A=WING_AVOID; for(let i=A.length-1;i>=0;i--){ if(A[i][0]===20&&(A[i][1]===790||A[i][1]===495)) A.splice(i,1); } A.push([20,510,415,782],[20,788,692,978]); })();
if(!document.getElementById('wingAp')){ const e=document.createElement('div'); e.id='wingAp'; e.setAttribute('aria-hidden','true'); document.body.appendChild(e); }
mnPin();
/* ---- Local alerts: always there ("All quiet" when nothing is near), rows that do not fit are dropped, never clipped ---- */
function mnAlQuiet(el){ if(AL.sig==='Q') return; AL.sig='Q'; el.innerHTML='<div class="al"><div class="al-hd"><span>Local alerts</span><span>Within&nbsp;1&nbsp;mi</span></div><div class="al-q">All quiet near home</div></div>'; }
function mnAlFit(){ const el=document.getElementById('wingAlerts'); if(!el) return; const box=el.querySelector('.al'); if(!box) return; box.style.transform='';
  const rows=[...box.querySelectorAll('.al-r')]; if(!rows.length) return;
  rows.forEach(r=>{ const t=r.querySelector('.al-t'), s=r.querySelector('.al-s'); mnFit(t,26,2); mnFit(s,20,2); });
  let more=box.querySelector('.al-more'), total=rows.length+(more?(parseInt((more.textContent.match(/\d+/)||[0])[0],10)||0):0);
  const key=rows.map(r=>r.textContent).join('|')+'|'+total; if(box._mnK===key&&box._mnD) { return; }
  rows.forEach(r=>{ r.style.display=''; }); let vis=rows.length;
  const h=()=>box.scrollHeight;
  const setMore=()=>{ const left=total-vis; let m=box.querySelector('.al-more'); if(left>0){ if(!m){ m=document.createElement('div'); m.className='al-more'; box.appendChild(m); } m.textContent='+'+left+' more near home'; } else if(m) m.remove(); };
  setMore(); while(vis>1&&h()>268){ vis--; rows[vis].style.display='none'; setMore(); }
  box._mnK=key; box._mnD=1; }
/* ---- Airports card (always visible): LAX / BUR / ONT status + next arrival over home ---- */
function mnApHtml(){ const rows=['LAX','BUR','ONT'].map(c=>{ const A=AP[c], B=apBd(c); let st='No arrivals now', q=1, n='';
    if(B){ if(B.night){ st='Landing east · Over the ocean'; q=0; } else if((B.arrivals||[]).length){ st='Landing'+(B.flow?' '+B.flow:'')+' · next'+NBP+apT12(B.next_eta); q=0; if(B.count15>0) n=B.count15+NBP+'in'+NBP+'15'+NBP+'min'; } }
    if(q&&c==='ONT'){ const d=Math.round(apMi(airHome[0],airHome[1],A.ll[0],A.ll[1])); st='Too far to track · '+d+NBP+'mi '+apComp(apBrg(airHome[0],airHome[1],A.ll[0],A.ll[1])); }
    return `<div class="ar${q?' q':''}" style="--c:${A.c};--t:${A.t}"><i class="cb">${c}</i><b>${esc(st)}</b><em>${esc(n)}</em></div>`; });
  return `<div class="apc">${rows.join('')}</div>`; }
function mnApFit(el){ el.querySelectorAll('.ar').forEach(r=>{ const b=r.querySelector('b'), e=r.querySelector('em'); b.style.fontSize=''; if(e){ e.style.fontSize=''; e.style.display=''; }
    const ov=()=>b.scrollWidth>b.clientWidth+1; let s=30, g=0; while(ov()&&s>24&&g++<10){ s-=1; b.style.fontSize=s+'px'; if(e) e.style.fontSize=Math.max(20,s-5)+'px'; }
    if(ov()&&e&&e.textContent){ e.style.display='none'; }
    if(ov()){ b.style.fontSize='24px'; const parts=b.textContent.split(' '); while(parts.length>1&&ov()){ parts.pop(); b.textContent=parts.join(' '); } } }); }
function mnAp(){ const el=document.getElementById('wingAp'); if(!el) return; const ok=scApOK(); const h=ok?mnApHtml():''; if(el._mnH!==h){ el._mnH=h; el.innerHTML=h; if(h) mnApFit(el); } }
/* ---- key = a small one-row legend (Q18) ---- */
scKeyHtml=function(p){ const L={airline:'Airline',heli:'Heli',cargo:'Cargo',rescue:'Police',bizjet:'Jet',military:'Military',small:'Small',unknown:'Other'};
  const rows=[['airline','jet'],['heli','heli'],['cargo','jet'],['rescue','heli'],['bizjet','biz'],['military','jet'],['small','small'],['unknown','jet']];
  return `<div class="sck lgd">${rows.map(([k,pp])=>`<div class="k"><svg viewBox="0 0 48 48" style="color:${KINDS[k][1]}"><path d="${TD[pp]}"/></svg>${L[k]}</div>`).join('')}</div>`; };
function mnKeyFit(){ const c=document.querySelector('#wingKey .sck.lgd'); if(!c||!c.clientWidth) return; const ks=[...c.querySelectorAll('.k')]; if(c._mnW===c.clientWidth&&c._mnD) return; c._mnW=c.clientWidth; c._mnD=1;
  let s=26; ks.forEach(k=>{ k.style.fontSize=''; }); while(c.scrollWidth>c.clientWidth+1&&s>22){ s-=1; ks.forEach(k=>{ k.style.fontSize=s+'px'; }); } }
/* ---- one shared slot (plane card / bus / key legend): changes only when something changes, most urgent first ---- */
function mnSlot(){ try{ if(window.__mnOff) return; const cl=document.body.classList, fl=scFlReal(), bus=cl.contains('bus-on'), key=cl.contains('key-on');
  const want=fl?'flight':bus?'bus':key?'key':'none'; if(!SC.hold||SC.hold.s!==want||SC.hold.mn!==1) SC.hold={s:want,p:0,mn:1}; }catch(e){ MN.errs++; V2.errs++; } }
setInterval(mnSlot,300);
/* ---- plane card photo slot: airline logo (large) or a type icon on a dark tile, never an empty gray box ---- */
{ const _pdm=passData; passData=function(o){ const d=_pdm(o); try{ const v=vc(o), a=o.a, I=o.info||acInfo(a); d.mnK=I.kind; d.mnAl=((v&&v.al)||(a&&a.v2&&a.v2.al)||''); }catch(e){ MN.errs++; V2.errs++; } return d; };
  const _phm=passHtml; passHtml=function(d){ let h=_phm(d); try{ if(d.v2&&!(d.ph&&d.ph.src)){ const ic=/^[A-Z]{3}$/.test(d.mnAl||'')?d.mnAl:'', shp=tdShape(d.mnK||'airline'),
      inner=(ic?`<img class="mclg" src="/logos/${ic}.png" alt="" onerror="this.parentNode.classList.remove('lgo');this.remove()">`:'')+`<svg viewBox="0 0 24 24"><path d="${(d.mnK==='heli'||d.mnK==='rescue')?HELI_SIDE:PLANE_SIDE}"/></svg>`;
      h=h.replace(/<div class="v2ph">[\s\S]*?<\/div>/,`<div class="v2ph nop${ic?' lgo':''}">${inner}</div>`); } }catch(e){ MN.errs++; V2.errs++; } return h; }; }
/* ---- Turo calendar names: shrink to what fits (full name, first name, initials); never a cut letter ---- */
function mnTcFit(){ const grid=document.getElementById('tcGrid'); if(!grid||!grid.offsetWidth) return; const colW=grid.offsetWidth/7, wk=document.getElementById('tcWk');
  if(wk&&wk.offsetWidth&&Math.abs(wk.offsetWidth-grid.offsetWidth)>1){ wk.style.width=grid.offsetWidth+'px'; wk.style.maxWidth=grid.offsetWidth+'px'; }
  grid.querySelectorAll('.tc-g[data-c]').forEach(g=>{ const av=Math.floor(+g.dataset.run*colW-(+g.dataset.l)-8), sig=g.dataset.c+'|'+av; if(g._mnD===sig) return; const c=g.dataset.c.split('|');
    let tn=[...g.childNodes].find(n=>n.nodeType===3); if(!tn){ tn=document.createTextNode(''); g.appendChild(tn); } let k=0; tn.textContent=c[0];
    while(g.offsetWidth>av+.5&&k<c.length-1){ k++; tn.textContent=c[k]; } g._mnD=sig; }); }
/* ---- the loop ---- */
setInterval(()=>{ try{ document.querySelectorAll('.pick .why').forEach(e=>mnFit(e,18,2)); document.querySelectorAll('#wingFlight .v2ph small').forEach(e=>{ const t=e.textContent, c=t.replace(/\s*[\/·,\-–|]+\s*$/,''); if(c!==t) e.textContent=c; }); mnFit(document.getElementById('nextName'),22,3);
  if(!document.body.classList.contains('al-on')) document.body.classList.add('al-on'); const al=document.getElementById('wingAlerts'); if(al&&!AL.on) mnAlQuiet(al); mnAlFit(); mnAp(); mnKeyFit(); mnTcFit(); }catch(e){ MN.errs++; V2.errs++; } },1000);
window.__mn=()=>({errs:MN.errs,scn:document.body.dataset.scn,hold:SC.hold&&SC.hold.s});
/* ===== end MAINCLEAN_20261102 ===== */
