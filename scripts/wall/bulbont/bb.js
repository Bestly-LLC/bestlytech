/* ===== BULBONT_20261103: sign-wall cards keep clear of state.avoid zones; ONT only while an ONT plane is on the drawn sky map ===== */
var BB={errs:0,hit:[],ontOn:false,n:0};
function bbApList(){ return (typeof BB!=='undefined'&&BB&&BB.ontOn)?['LAX','BUR','ONT']:['LAX','BUR']; }
function bbOntPlanes(){ let arr=0, dep=0; try{ Object.values(AIRS).forEach(o=>{ if(!o||!o.disp||o.gone||o.entering||!(o.op>.3)) return; const v=(o.a&&o.a.v2&&o.a.v2.fz)?o.a.v2:vc(o); if(v&&v.fz&&v.fa==='ONT'){ if(v.fz==='arr') arr++; else dep++; } }); }catch(e){ BB.errs++; } return {arr:arr,dep:dep}; }
function bbOntLine(){ const p=bbOntPlanes(), n=p.arr||p.dep, z=p.arr?'landing':'departing'; return n?(n+NBP+(n===1?'plane':'planes')+NBP+z):'On the map'; }
function bbOnt(){ try{ const p=bbOntPlanes(), w=(p.arr+p.dep)>0; BB.ontOn=w; const d=Object.getOwnPropertyDescriptor(AP,'ONT');
    if(d&&d.enumerable!==w) Object.defineProperty(AP,'ONT',{enumerable:w,configurable:true,writable:true,value:AP.ONT});
    if(!w&&APX.els&&APX.els.ONT){ APX.els.ONT.remove(); delete APX.els.ONT; } }catch(e){ BB.errs++; V2.errs++; } }
bbOnt(); setInterval(bbOnt,250);
/* ---- keep-clear: content rects (text lines, images, icons, badge tiles) of a card, in screen px ---- */
function bbLeaves(root){ const out=[]; const rr=root.getBoundingClientRect(), area=rr.width*rr.height; const w=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT); let n;
  while((n=w.nextNode())){ try{ const sv=n.closest('svg'); if(sv&&sv!==n) continue; const cs=getComputedStyle(n); if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0') continue;
    const tg=n.tagName.toLowerCase(); if(tg==='img'||tg==='svg'||tg==='canvas'){ const r=n.getBoundingClientRect(); if(r.width>1&&r.height>1) out.push([r.left,r.top,r.right,r.bottom]); continue; }
    for(const c of n.childNodes){ if(c.nodeType===3&&c.textContent.trim()){ const g=document.createRange(); g.selectNodeContents(c); const r=g.getBoundingClientRect(); if(r.width>1&&r.height>1) out.push([r.left,r.top,r.right,r.bottom]); } }
    const bg=cs.backgroundColor, hb=(bg&&!/^rgba\(\d+, \d+, \d+, 0\)$|transparent/.test(bg))||(cs.backgroundImage&&cs.backgroundImage!=='none');
    if(hb){ const r=n.getBoundingClientRect(); if(r.width>1&&r.height>1&&r.width*r.height<area*.4) out.push([r.left,r.top,r.right,r.bottom]); }
  }catch(e){} } return out; }
function bbHit(root){ return bbLeaves(root).some(r=>tgbCirc(r,6)); }
function bbVFit(el){ const c=el.firstElementChild; if(!c||!el.classList.contains('bbn')) return; const e=c.querySelector('.v2lands'); if(e) e.style.visibility='';
  try{ scVFit(el); }catch(x){} if(e&&c.scrollHeight>c.clientHeight+1) e.style.visibility='hidden'; }
function bbFitEl(e,floor){ e.style.fontSize=''; if(!e.clientWidth) return; let s=parseFloat(getComputedStyle(e).fontSize)||40; const ov=()=>e.scrollWidth>e.clientWidth+1;
  while(ov()&&s>floor){ s=Math.max(floor,s-2); e.style.fontSize=s+'px'; }
  if(ov()){ const sep=/ · /.test(e.textContent)?' · ':' '; const p=e.textContent.split(sep); while(p.length>1&&ov()){ p.pop(); e.textContent=p.join(sep); } } }
function bbFitText(wf){ try{ if(!wf.classList.contains('bbn')) return; wf.querySelectorAll('.v2fl').forEach(e=>bbFitEl(e,50)); wf.querySelectorAll('.v2mt,.v2sub,.v2lands,.ft-ct span').forEach(e=>bbFitEl(e,34)); bbVFit(wf); }catch(e){ BB.errs++; V2.errs++; } }
{ const _p=passSet; passSet=function(wf,d){ _p(wf,d); bbFitText(wf); }; }
function bbRefit(id,el){ try{ if(id==='wingFlight'){ window.__scFit(el); bbFitText(el); } else if(id==='wingKey'){ mnKeyFit(); } }catch(e){ BB.errs++; V2.errs++; } }
function bbSolve(id,sel){ const el=document.getElementById(id); if(!el) return; const root=el.querySelector(sel)||el.firstElementChild; if(!root||!root.clientWidth) return;
  const zs=tgbZones(), apply=L=>{ el.style.setProperty('--bbl',L+'px'); el.classList.toggle('bbn',L>0); el._bbL=L; bbRefit(id,el); };
  if(!zs.length){ if(el._bbL){ apply(0); } el._bbRoot=root; return; }
  const same=root===el._bbRoot&&el._bbZ===TGB.k; el._bbRoot=root; el._bbZ=TGB.k;
  if(same&&!bbHit(root)){ if(el._bbL) bbVFit(el); return; }
  let L=same?(el._bbL||0):0; for(;L<=440;L+=12){ apply(L); if(!bbHit(root)) break; } if(L>0&&L<=440){ apply(L+12); if(bbHit(root)) apply(L); } BB.n++; }
function bbSolveAl(){ const el=document.getElementById('wingAlerts'), box=el&&el.querySelector('.al'); if(!box) return; const zs=tgbZones();
  if(!zs.length){ if(el._bbT){ el._bbT=0; el.style.removeProperty('--bbt'); box._mnD=0; try{ mnAlFit(); }catch(e){} } el._bbRoot=box; return; }
  const same=box===el._bbRoot&&el._bbZ===TGB.k; el._bbRoot=box; el._bbZ=TGB.k; if(same&&!bbHit(box)) return;
  let T=same?(el._bbT||0):0; for(;T<=80;T+=4){ el._bbT=T; el.style.setProperty('--bbt',T+'px'); box._mnD=0; try{ mnAlFit(); }catch(e){} if(!bbHit(box)) break; } BB.n++; }
function bbTick(){ try{ bbSolve('wingFlight','.ft'); bbSolve('wingKey','.sck'); bbSolve('wingBus','.w1'); bbSolveAl();
    const hits=[]; ['wingFlight','wingKey','wingBus','wingAlerts','wingAp'].forEach(id=>{ const e=document.getElementById(id); if(!e||!tgbZones().length) return; const r=e.getBoundingClientRect(); if(!(r.width>0)||+getComputedStyle(e).opacity<=.05) return; const c=e.firstElementChild; if(c&&bbHit(c)) hits.push(id); }); BB.hit=hits;
  }catch(e){ BB.errs++; V2.errs++; } }
setInterval(bbTick,400);
{ const _t=window.__tgb; window.__tgb=()=>Object.assign(_t(),{wingHit:BB.hit.slice(),bbErrs:BB.errs}); }
window.__bb=()=>({errs:BB.errs,ont:BB.ontOn,hit:BB.hit,L:['wingFlight','wingKey','wingBus'].map(i=>{ const e=document.getElementById(i); return e?(e._bbL||0):0; }),T:(document.getElementById('wingAlerts')||{})._bbT||0});
{ const st=document.createElement('style'); st.id='bulbont'; st.textContent=`
/* BULBONT_20261103 keep-clear reflow: card shifts right of the zone (margin-left var(--bbl)) and narrows; content re-flows */
#wingAlerts .al{padding-top:calc(24px + var(--bbt,0px))!important}
#wingAp .apc.r2{height:128px}
body #wingFlight.bbn .ft{margin-left:var(--bbl,0px)!important;width:calc(960px - var(--bbl,0px))!important}
body #wingFlight.bbn .ft.v2c{padding-left:26px!important;padding-right:26px!important}
body #wingFlight.bbn .ft-pg .pt{transform:translateX(calc(var(--p,0) * (892px - var(--bbl,0px))))}
body #wingFlight.bbn .ft.v2c{display:flex;flex-direction:column}
body #wingFlight.bbn .v2c .v2top{display:grid;grid-template-columns:minmax(0,1fr) 176px;grid-template-rows:auto auto auto;column-gap:16px;row-gap:0;align-items:start;min-height:0;height:auto}
body #wingFlight.bbn .v2c .v2id{display:contents}
body #wingFlight.bbn .v2c .v2fl,body #wingFlight.bbn .v2c .v2mt,body #wingFlight.bbn .v2c .v2sub{min-width:0;overflow:hidden;white-space:nowrap}
body #wingFlight.bbn .v2c .v2fl{grid-column:1;grid-row:1}
body #wingFlight.bbn .v2c .v2mt{grid-column:1;grid-row:2}
body #wingFlight.bbn .v2c .v2sub{grid-column:1/3;grid-row:3}
body #wingFlight.bbn .v2c .v2ph{grid-column:2;grid-row:1/3;width:176px;height:92px;align-self:start}
body #wingFlight.bbn .v2c .v2sign,body #wingFlight.bbn .v2c.nt .v2sign,body #wingFlight.bbn .v2c.sos .v2sign{top:auto!important;bottom:8px!important;right:26px!important;font-size:34px!important}
body #wingFlight.bbn .v2c .ft-st{display:grid!important;grid-template-columns:minmax(0,1fr)!important;row-gap:0;margin-top:auto!important;padding-top:4px!important}
body #wingFlight.bbn .v2c .ft-st>div{display:flex;flex-direction:row;align-items:baseline!important;justify-content:flex-start!important;gap:14px;white-space:nowrap}
body #wingFlight.bbn .v2c .ft-st b{font-size:44px!important;line-height:1.06!important}
body #wingFlight.bbn .v2c .ft-st span{font-size:36px!important}
body #wingKey.bbn .sck{margin-left:var(--bbl,0px)!important;width:calc(960px - var(--bbl,0px))!important}
body #wingKey.bbn .sck.lgd{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 10px;justify-content:stretch;padding:12px 18px}
body #wingBus.bbn .w1{margin-left:var(--bbl,0px)!important;width:calc(960px - var(--bbl,0px))!important;padding-left:14px;padding-right:14px}
body #wingBus.bbn .w1-r{grid-template-columns:64px minmax(0,1fr) 190px;column-gap:14px}
body #wingBus.bbn .w1-r+.w1-r::after{left:78px}
`; document.head.appendChild(st); }
/* ===== end BULBONT_20261103 ===== */
