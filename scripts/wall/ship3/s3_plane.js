/* ---- SHIP3 part 3: narrow plane card (beside the bulb zone): title never cut mid-phrase (2 lines, then a known short form), operator line only when it adds info, stats right under the identity block ---- */
const S3PL={errs:0};
const S3SUF=/[\s,]+(inc|llc|ltd|corp|co|corporation|company|l\.l\.c\.|incorporated)\.?$/i;
function s3PlNorm(s){ return String(s||'').toLowerCase().replace(S3SUF,'').replace(S3SUF,'').replace(/[^a-z0-9]+/g,' ').trim(); }
/* short forms, mildest first; every step keeps whole words, never a fragment */
const S3SHORT=[
  s=>s.replace(S3SUF,'').replace(S3SUF,''),
  s=>s.replace(/\b(the )?(city and )?county of los angeles\b/ig,'LA County').replace(/\blos angeles county\b/ig,'LA County').replace(/\blos angeles police department\b/ig,'LAPD').replace(/\blos angeles fire department\b/ig,'LAFD').replace(/\bunited states\b/ig,'US').replace(/\bfederal aviation administration\b/ig,'FAA'),
  s=>s.replace(/\blos angeles\b/ig,'LA').replace(/\bdepartment\b/ig,'Dept').replace(/\binternational\b/ig,'Intl').replace(/\bhelicopters?\b/ig,'Heli').replace(/\bsheriff'?s\b/ig,'Sheriff').replace(/\baviation\b/ig,'Aviation')
];
/* keep known phrases together so a line break never lands inside them (Los Angeles, Santa Monica, Coast Guard ...) */
function s3PlNb(t){ return String(t).replace(/\b(Los|San|Santa|Las|New|Fort|Mount|Mt|Coast|Air|Fire|Police|Sheriff's|Sheriff)\s+(Angeles|Diego|Francisco|Jose|Monica|Barbara|Clara|Ana|Vegas|York|Guard|Force|Support|Department|Dept|Rescue|Patrol)\b/g,'$1\u00a0$2'); }
function s3PlCands(l){ const out=[l]; let cur=l; S3SHORT.forEach(f=>{ const n=f(cur).replace(/\s+/g,' ').trim(); if(n&&n!==cur){ cur=n; out.push(n); } }); return out; }
function s3PlLines(e){ const lh=parseFloat(getComputedStyle(e).lineHeight)||(1.05*parseFloat(getComputedStyle(e).fontSize)); return Math.round(e.scrollHeight/lh); }
/* operator line: drop any part that only repeats the title */
function s3PlSub(sub,label){ const nl=s3PlNorm(label); return String(sub||'').split(' · ').filter(p=>{ const np=s3PlNorm(p); if(!np) return false; return !(np===nl||(np.length>3&&(nl.indexOf(np)>=0||np.indexOf(nl)>=0))); }).join(' · '); }
function s3PlFitLabel(wf,top,e,orig){ /* returns the layout used */
  const W=()=>e.clientWidth;
  const tryOne=(txt,two)=>{ e.textContent=s3PlNb(txt); top.classList.toggle('s3b',!!two); e.style.fontSize='';
    for(let s=66;s>=50;s-=2){ e.style.fontSize=s+'px'; if(!W()) return false; const ok=e.scrollWidth<=e.clientWidth+1&&s3PlLines(e)<=(two?2:1); if(ok) return true; } return false; };
  const cands=s3PlCands(orig);
  for(const c of cands){ if(tryOne(c,false)) return 1; if(tryOne(c,true)) return 2; }
  /* nothing fits on 2 lines at 50: shortest form, then whole words from the end (last resort, still no fragment of a word) */
  let txt=cands[cands.length-1]; const p=txt.split(' '); top.classList.add('s3b'); e.style.fontSize='50px';
  while(p.length>1){ e.textContent=s3PlNb(p.join(' ')); if(e.scrollWidth<=e.clientWidth+1&&s3PlLines(e)<=2) break; p.pop(); } return 2; }
/* optional lines drop out of the layout (display none, so the room really frees up) only while the card is taller than its band: progress bar, then operator line, then lands time */
function s3PlVFit(wf){ const c=wf.firstElementChild; if(!c) return; const q=x=>c.querySelector(x), sub=q('.v2sub'); wf.classList.remove('s3t','s3g');
  ['.ft-pg','.v2sub','.v2lands','.v2mt'].forEach(x=>{ const e=q(x); if(e) e.style.display=(e===sub&&!sub.textContent)?'none':''; });
  const over=()=>c.scrollHeight>c.clientHeight+1; if(!over()) return;
  const pg=q('.ft-pg'); if(pg){ pg.style.display='none'; if(!over()) return; }
  if(sub&&sub.textContent){ sub.style.display='none'; if(!over()) return; }
  wf.classList.add('s3t'); if(!over()) return;                                   /* smaller photo / logo tile */
  wf.classList.add('s3g'); if(!over()) return;                                   /* drop the signature strip */
  const ld=q('.v2lands'); if(ld){ ld.style.display='none'; if(!over()) return; }
  const mt=q('.v2mt'); if(mt){ mt.style.display='none'; } }
const _s3bf=bbFitText;
bbFitText=function(wf){ try{ const top=wf.querySelector('.v2c .v2top'), fl=top&&top.querySelector('.v2fl');
    if(!wf.classList.contains('bbn')||!wf._s3||!fl){ if(top) top.classList.remove('s3b'); wf.classList.remove('s3n'); return _s3bf(wf); }
    const orig=String(wf._s3.fl||fl.textContent||'').trim(); if(!orig){ return _s3bf(wf); }
    wf.classList.add('s3n');
    /* operator line first (it decides how much room the identity block takes) */
    const sub=wf.querySelector('.v2sub'); if(sub){ const s2=s3PlSub(wf._s3.sub,orig); sub.textContent=s2; sub.style.display=s2?'':'none'; }
    s3PlFitLabel(wf,top,fl,orig);
    wf.querySelectorAll('.v2mt,.v2sub,.v2lands,.ft-ct span').forEach(e=>bbFitEl(e,34)); s3PlVFit(wf);
    /* still taller than the band (long title + route + stats): step the title down toward its 50 px floor, whole words only */
    { const c=wf.firstElementChild; let fs=parseFloat(fl.style.fontSize)||66; while(c&&c.scrollHeight>c.clientHeight+1&&fs>50){ fs=Math.max(50,fs-2); fl.style.fontSize=fs+'px'; if(s3PlLines(fl)>2||fl.scrollWidth>fl.clientWidth+1){ fl.style.fontSize=(fs+2)+'px'; break; } s3PlVFit(wf); } }
  }catch(e){ S3PL.errs++; V2.errs++; S3PL.err=String(e&&e.stack||e); } };
window.__s3pl=()=>({errs:S3PL.errs,err:S3PL.err||null,cands:s3PlCands('County of Los Angeles Fire'),sub:s3PlSub('Channel Islands Aviation INC','Channel Islands Aviation')});
{ const st=document.createElement('style'); st.id='ship3pl'; st.textContent=`
/* SHIP3_20261103 narrow plane card: label may take 2 lines (photo drops beside the type line), stats sit right under the identity block, card only as tall as its content */
body #wingFlight.bbn .ft.v2c{height:auto!important;min-height:0!important;max-height:468px}
body #wingFlight.bbn .v2c .ft-st{margin-top:12px!important}
body #wingFlight.bbn .ft.v2c>*{flex-shrink:0}
body #wingFlight.bbn.s3g .ft.v2c.nt,body #wingFlight.bbn.s3g .ft.v2c.sos{padding-bottom:14px!important}
body #wingFlight.bbn.s3g .v2c .v2sign{display:none!important}
body #wingFlight.bbn.s3t .v2c .v2top{grid-template-columns:minmax(0,1fr) 132px}
body #wingFlight.bbn.s3t .v2c .v2top.s3b .v2ph{width:132px;height:68px}
body #wingFlight.bbn .ft.v2c.nt,body #wingFlight.bbn .ft.v2c.sos{padding-bottom:50px!important}   /* signature gets its own strip under the stats */
body #wingFlight.bbn .v2c .v2top.s3b .v2fl{grid-column:1/3;grid-row:1;white-space:normal!important;overflow:hidden;line-height:1.04!important;overflow-wrap:normal;word-break:normal}
body #wingFlight.bbn .v2c .v2top.s3b .v2mt{grid-column:1;grid-row:2}
body #wingFlight.bbn .v2c .v2top.s3b .v2sub{grid-column:1;grid-row:3}
body #wingFlight.bbn .v2c .v2top.s3b .v2ph{grid-column:2;grid-row:2/4;align-self:start}
`; document.head.appendChild(st); }
window.__bbLeaves=bbLeaves;
