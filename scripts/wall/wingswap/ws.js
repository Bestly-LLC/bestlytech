
/* ===== WINGSWAP_20261103: bus stop names wrap to 2 lines at full size (never shrunk below 26, never a dropped word); Local alerts titles break at the slash instead of clipping ; narrow plane card: Sky Sync steps up clear of text ===== */
var WS={errs:0};
function wsSl(s){ return String(s).replace(/\//g,'/​'); }
function wsFit(el,floor){ if(!el||!el.clientWidth) return; const sig=(el._w1o!=null?el._w1o:el.textContent)+'|'+el.clientWidth; if(el._wsf===sig) return;
  el.style.fontSize=''; if(el._w1o!=null&&el.textContent!==el._w1o) el.textContent=el._w1o;
  const lh=()=>parseFloat(getComputedStyle(el).lineHeight)||1.1*parseFloat(getComputedStyle(el).fontSize);
  const bad=()=>Math.round(el.scrollHeight/lh())>2||el.scrollWidth>el.clientWidth+1;
  let s=parseFloat(getComputedStyle(el).fontSize)||30; while(bad()&&s>floor){ s-=1; el.style.fontSize=s+'px'; }
  el._wsf=sig; }
{ const _f=w1Fit; w1Fit=function(el,floor){ try{ if(el&&el.matches&&el.matches('.w1-n,.w1-w')) return wsFit(el,el.matches('.w1-n')?26:20); }catch(e){ WS.errs++; V2.errs++; } return _f(el,floor); }; }
{ const _m=mnFit; mnFit=function(el,floor,lines){ try{ if(el&&el.classList&&el.classList.contains('al-t')) floor=Math.min(floor,22); }catch(e){} return _m(el,floor,lines); }; }
function wsSig(){ try{ const wf=document.getElementById('wingFlight'); if(!wf) return; const sg=wf.querySelector('.v2sign'); if(!wf.classList.contains('bbn')||!sg){ if(wf._wsb){ wf._wsb=0; wf.style.removeProperty('--wsb'); } return; }
    const c=wf.firstElementChild; if(!c) return;
    const run=b=>{ wf.style.setProperty('--wsb',b+'px'); const sr=sg.getBoundingClientRect(); const o=bbLeaves(c).filter(r=>!(r[0]>=sr.left-2&&r[2]<=sr.right+2&&r[1]>=sr.top-2&&r[3]<=sr.bottom+2)); return o.some(r=>sr.left<r[2]&&sr.right>r[0]&&sr.top<r[3]&&sr.bottom>r[1]); };
    let b=8; while(run(b)&&b<220) b+=4; wf._wsb=b; wf.style.setProperty('--wsb',b+'px'); }catch(e){ WS.errs++; V2.errs++; } }
setInterval(wsSig,500);
window.__ws=()=>({errs:WS.errs});
{ const st=document.createElement('style'); st.id='wingswap'; st.textContent=`
/* WINGSWAP_20261103 */
#wingBus .w1-n,#wingBus .w1-w{white-space:normal!important;overflow:visible!important}
#wingBus .w1-n{line-height:1.08!important}
#wingBus .w1-s{min-width:0}
body #wingFlight.bbn .v2c .v2sign,body #wingFlight.bbn .v2c.nt .v2sign,body #wingFlight.bbn .v2c.sos .v2sign{bottom:var(--wsb,8px)!important}
`; document.head.appendChild(st); }
/* ===== end WINGSWAP_20261103 ===== */
