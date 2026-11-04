#!/usr/bin/env python3
"""BRIEFFIT2_20261104 patch for wall.html (anchored, exact-once).
usage: p_brieffit2.py <in.html> <out.html>
 1. weather corner stays while the brief is up (hourly/daily scenes are skipped in the rotation, corner forced to weather)
 2. Scout card rows never cut: wrap to 2 lines -> short forms -> drop words (last resort); number+unit glued
"""
import sys

src = open(sys.argv[1], encoding="utf-8").read()
MARK = "BRIEFFIT2_20261104"
if MARK in src:
    sys.exit("already patched")


def once(s, old, new):
    n = s.count(old)
    assert n == 1, (n, old[:70])
    return s.replace(old, new)


# --- 1a CSS: belt and braces for the corner while the brief is up
src = once(src, "#briefP .bn{white-space:nowrap}\n</style>",
           "#briefP .bn{white-space:nowrap}\n"
           "/* BRIEFFIT2_20261104: while the brief is up the weather corner stays on (no battery rings, no daily-wedge hide) */\n"
           "body.bf-hide.dly-wedge #corner{opacity:1!important}\n"
           "body.bf-hide:not(.casting) #corner #cvWx{opacity:1!important;transform:none!important;filter:none!important}\n"
           "body.bf-hide:not(.casting) #corner #cvBatt{opacity:0!important}\n</style>")

# --- 1b goScene refuses the hidden scenes while the brief is up
src = once(src, "  function goScene(id){\n    if(id===curScene) return;\n",
           "  function goScene(id){\n    if(id===curScene) return;\n"
           "    if(id!=='sBoard'&&document.body.classList.contains('bf-hide')) return;   /* BRIEFFIT2_20261104: hourly/daily are hidden under the brief */\n")

# --- 1c rotation skips the hidden scenes (no blank slot)
src = once(src, "pi=(pi+1)%plan.length; const [id,secs]=plan[pi];",
           "pi=(pi+1)%plan.length; if(document.body.classList.contains('bf-hide')&&plan[pi][0]!=='sBoard') pi=(pi+1)%plan.length;   /* BRIEFFIT2_20261104 skip hidden scenes */ const [id,secs]=plan[pi];")

# --- 1d hook: the brief calls this when it appears (leave hourly/daily if one is showing, put the weather back in the corner)
src = once(src, "  /* ================= live sky (weather + time of day on the wall) ================= */",
           "  /* BRIEFFIT2_20261104 */\n"
           "  window.__bf2Board=function(){ try{ if(curScene!=='sBoard'){ clearTimeout(sceneTimer); goScene('sBoard'); sceneTimer=setTimeout(stepScene,15000); } cornerView('wx'); try{ dlyScene('sBoard'); }catch(e){} }catch(e){} };\n"
           "  window.__bf2={step:()=>stepScene(),cur:()=>curScene,pi:()=>pi};\n"
           "  /* ================= live sky (weather + time of day on the wall) ================= */")

# --- 1e brief render calls the hook
src = once(src, "  document.body.classList.add('brief-on','bf-hide');                   // old cards fade out now (.35 s) ...\n",
           "  document.body.classList.add('brief-on','bf-hide');                   // old cards fade out now (.35 s) ...\n"
           "  try{ if(window.__bf2Board) window.__bf2Board(); }catch(e){}           // BRIEFFIT2_20261104: weather corner back, hourly/daily out of the rotation\n")

# --- 2 Scout rows
a = src.index("  const one=s=>{ const t=full(s); s.classList.remove('pol2');")
endm = "if(ov()){ s._cut=true; drop(s,t,ov); } };"
b = src.index(endm, a) + len(endm)
assert src.count("  const one=s=>{ const t=full(s);") == 1
NEW = r"""  /* BRIEFFIT2_20261104: never cut. Order: 1) wrap to 2 lines (if the list still clears the pager) 2) short forms 3) drop words, last resort. Number + unit glued. */
  const nbs=t=>String(t).replace(/(\d) (?=[A-Za-z%°$])/g,'$1 ');
  const shortSteps=t=>{ let x=t; const out=[];
    x=x.replace(/\b(needs?) your (?:attention|review|action|approval)\b/i,'$1 you');
    x=x.replace(/\bproblems\b/gi,'issues').replace(/\bproblem\b/gi,'issue');
    x=x.replace(/\b(needs?) to be (reconnect|renew|updat|review|approv|replac|restart|fix|check|charg)ed\b/i,(m,n,v)=>n+' '+v+'ing');
    x=x.replace(/\b(?:is|are) (failing|offline|stuck|down)\b/i,'$1'); out.push(x);
    const y=x.replace(/^(.{14,}?\b(?:needs?|failing|offline|stuck|down|failed|expired|expires|low|full)\b.*?)\s+(?:for|because|due to|so that|while)\s+.+$/i,'$1'); if(y!==x){ out.push(y); x=y; }
    const z=x.replace(/^[A-Z][a-z]+'s\s+/,''); if(z!==x&&z.length>=12) out.push(z);
    return out.map(nbs).filter((v,i,a)=>v!==t&&a.indexOf(v)===i); };
  const offTop=(e,stop)=>{ let y=0; while(e&&e!==stop){ y+=e.offsetTop; e=e.offsetParent; } return y; };   /* layout px: unaffected by the card's enter transform / perspective */
  const ulOK=s=>{ const ul=s.closest('ul'), pg=document.querySelector('.pager'); if(!ul||!pg) return true; return offTop(ul,pg.offsetParent)+ul.offsetHeight<=pg.offsetTop-10; };
  const one=s=>{ const t0=nbs(full(s)); s._cut=false;
    const reset=(txt,two)=>{ s.classList.toggle('pol2',!!two); s.style.fontSize=''; s.textContent=txt; };
    const ov1=()=>s.scrollWidth>s.clientWidth+1;
    const bad2=()=>lines(s)>2||s.scrollWidth>s.clientWidth+1||!ulOK(s);
    const shrink=bad=>{ const z0=parseFloat(getComputedStyle(s).fontSize)||21; let z=z0; while(bad()&&z>z0*.9){ z-=.5; s.style.fontSize=z+'px'; } return !bad(); };
    reset(t0,0); if(!ov1()) return;                                    // fits on one line as is
    reset(t0,1); if(!bad2()||shrink(bad2)) return;                     // 1. wrap to 2 lines
    const alt=shortSteps(t0); let tt=t0;
    for(const t1 of alt){ tt=t1; reset(t1,0); if(!ov1()) return; reset(t1,1); if(!bad2()||shrink(bad2)) return; }   // 2. sensible short forms, mildest first
    s._cut=true;                                                       // 3. last resort: drop trailing words (2 lines, else 1)
    reset(tt,1); const b=()=>lines(s)>2||s.scrollWidth>s.clientWidth+1; if(b()) drop(s,tt,b);
    if(!ulOK(s)){ reset(tt,0); drop(s,tt,ov1); } };"""
src = src[:a] + NEW + src[b:]

src = once(src, "    spans.forEach(one);\n",
           "    spans.forEach(s=>{ s.classList.remove('pol2'); s.style.fontSize=''; s.textContent=nbs(full(s)); }); spans.forEach(one);   /* BRIEFFIT2_20261104: reset all rows first so the height budget is exact */\n")
src = once(src, "/* ===== end POLISH_20261103 ===== */", "/* BRIEFFIT2_20261104: Scout row fit rewritten above (wrap, short forms, drop last) */\n/* ===== end POLISH_20261103 ===== */")

open(sys.argv[2], "w", encoding="utf-8").write(src)
print("ok", len(src))
