#!/usr/bin/env python3
# LEFTOVER_20261102: (1) Focus body line fit runs right when a pick shows / its text is rewritten by the marquee code,
# (2) plane card "Lands" line says tomorrow / weekday and "LA time" for far zones.
import sys, time
P = '/opt/bestly/wall/www/wall.html'
s = open(P, encoding='utf-8').read()
if 'LEFTOVER_20261102' in s:
    print('already patched'); sys.exit(0)
open(P + '.bak_leftover_' + time.strftime('%H%M%S'), 'w', encoding='utf-8').write(s)

A1 = "lands='Lands '+to+' '+v2t12(Date.now()+mins*60000); }"
B1 = "lands=lfoLands(to,Date.now()+mins*60000,a.to_ll); }"
assert s.count(A1) == 1, s.count(A1)
s = s.replace(A1, B1)

A2 = "/* ===== end MAINCLEAN_20261102 ===== */"
assert s.count(A2) == 1
BLOCK = r'''
/* ===== LEFTOVER_20261102 ===== */
const LFO={errs:0};
/* plane card: when the arrival is not today say tomorrow / the weekday (LA calendar); far time zones get "LA time" */
function lfoDay(ms){ try{ const f=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(d), n=Date.now();
  const a=f(new Date(ms)); if(a===f(new Date(n))) return ''; if(a===f(new Date(n+864e5))) return 'tomorrow';
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',weekday:'long'}).format(new Date(ms)); }catch(e){ LFO.errs++; return ''; } }
function lfoFar(ll){ if(!ll||ll.length<2) return false; const la=+ll[0], lo=+ll[1]; return !(la>=32&&la<=49.5&&lo>=-125&&lo<=-114); }
function lfoLands(to,ms,ll){ const d=lfoDay(ms); return 'Lands '+to+(d?' '+d:'')+' '+v2t12(ms)+(lfoFar(ll)?' LA'+NBP+'time':''); }
/* Focus body line: fit the moment a pick shows or its text is rewritten (the sliding-line code can wrap it in a one-line marquee for up to 1 s) */
function lfoWhy(el){ try{ if(!el||!el.isConnected||!el.clientWidth) return; mnFit(el,18,2);
  const T=el.querySelector('.wmq-in')||el, tn=[...T.childNodes].find(n=>n.nodeType===3&&n.textContent.trim()); if(!tn) return;
  const lines=()=>{ const rg=document.createRange(); rg.selectNodeContents(el); const t=new Set([...rg.getClientRects()].map(r=>Math.round(r.top/6))); return t.size; };
  const bad=()=>el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1||lines()>2;
  if(bad()){ const parts=tn.textContent.trim().split(/\s+/); while(parts.length>1&&bad()){ parts.pop(); tn.textContent=parts.join(' '); } el._mnL=tn.textContent; } }catch(e){ LFO.errs++; V2.errs++; } }
let lfoQ=0; function lfoAll(){ lfoQ=0; document.querySelectorAll('.pick.on .why').forEach(lfoWhy); }
function lfoSched(){ if(!lfoQ){ lfoQ=1; requestAnimationFrame(lfoAll); } }
document.querySelectorAll('.pick').forEach(p=>{ try{ new MutationObserver(lfoSched).observe(p,{attributes:true,attributeFilter:['class'],childList:true,subtree:true,characterData:true}); }catch(e){ LFO.errs++; } });
setInterval(lfoAll,250);
window.__lfo=()=>({errs:LFO.errs});
window.__lfoLands=lfoLands;
/* ===== end LEFTOVER_20261102 ===== */
'''
s = s.replace(A2, A2 + BLOCK)
open(P, 'w', encoding='utf-8').write(s)
print('patched')
