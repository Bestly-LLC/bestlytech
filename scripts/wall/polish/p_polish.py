#!/usr/bin/env python3
# POLISH_20261103: patch wall.cur.html -> wall.polish.html (anchored, every anchor asserted)
import sys
src = open('/Users/jaredbest/tmp/polish/wall.cur.html', encoding='utf-8').read()
s = src
def rep1(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f'{label}: count {n}'
    s = s.replace(old, new)
    print('ok', label)

# 0. no existing names
for nm in ['polScFit', 'bmPt', 'POLISH_20261103', 'polcss', '__pol']:
    assert nm not in s, 'name in use: ' + nm

# A1. Scout list: no ellipsis in the short form (drop whole words), real fit is done by polScFit
rep1("return s.length>70?s.slice(0,68)+'…':s; };",
     "if(s.length<=70) return s; const w=s.split(' '); while(w.length>1&&w.join(' ').length>70) w.pop(); return w.join(' ').replace(/[\\s,;:\\u2014\\u00b7(-]+$/,''); };   /* POLISH_20261103 */", 'w2Short')
# A2. Scout rows: static fit (shrink a touch, then drop trailing whole words) instead of the sliding marquee
rep1("c.querySelectorAll('#w2Sl li > span:not(.wmq-in)').forEach(s=>mqSet(s,.92));",
     "c.querySelectorAll('#w2Sl li > span:not(.wmq-in)').forEach(s=>{ if(window.polScFit) window.polScFit(s); else mqSet(s,.92); });   /* POLISH_20261103 */", 'scout-interval')

# C1. bus pill: true screen-space point (translate only, no frame matrix, no scale)
anchor = "/* ---- geometry: bus and stop on the route shape (GTFS shape from the collector, in travel direction) ---- */"
rep1(anchor, """/* POLISH_20261103: bus pills and stop badges are placed in true screen space (translate only: unscaled, unskewed), like a plain DOM overlay */
function bmPt(x,y){ try{ const P=pjNow(); if(P.proj){ const q=P.proj(x,y); if(q) return 'translate('+q[0].toFixed(1)+'px,'+q[1].toFixed(1)+'px)'; } }catch(e){} return skyPt(x,y); }
""" + anchor, 'bmPt-def')
i0 = s.index('function bmEls(){'); i1 = s.index('/* ---- zoom: critically damped')
seg = s[i0:i1]; n = seg.count('skyPt('); print('skyPt in bus layer:', n); assert n >= 5
s = s[:i0] + seg.replace('skyPt(', 'bmPt(') + s[i1:]
# C2. arrow: angle in true screen space
rep1("const dx=p1[0]-p0[0], dy=p1[1]-p0[1], a=fr.f[0], b=fr.f[1], c=fr.f[2], d=fr.f[3], det=a*d-b*c||1e-9; return Math.atan2((-b*dx+a*dy)/det,(d*dx-c*dy)/det)*180/Math.PI; }",
     "return Math.atan2(p1[1]-p0[1],p1[0]-p0[0])*180/Math.PI; }   /* POLISH_20261103: pill is unskewed, so the arrow is the screen angle */", 'bmArrow')
# C3. no end-dots on route segments (the leader line stays, it ends where the bus really is)
rep1("c.strokeStyle=`rgba(${col},.8)`; c.lineWidth=1.6; c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(bx,by); c.stroke();\n    c.beginPath(); c.arc(a[0],a[1],4,0,6.2832); c.fillStyle=`rgb(${col})`; c.fill(); c.lineWidth=1.5; c.strokeStyle='rgba(16,20,28,.9)'; c.stroke(); });",
     "{ const lg=c.createLinearGradient(bx,by,a[0],a[1]); lg.addColorStop(0,`rgba(${col},.8)`); lg.addColorStop(1,`rgba(${col},0)`); c.strokeStyle=lg; c.lineWidth=1.6; c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(bx,by); c.stroke(); } });   /* POLISH_20261103: no dot */", 'no-dots')
# C4. stop ring line-number badge (line color, right next to the ring)
rep1("BM2.sb[it.id]=[s[0]-16,s[1]-16,s[0]+16,s[1]+16];", "BM2.sb[it.id]=[s[0]-16,s[1]-16,s[0]+40,s[1]+16];", 'sb-box')
rep1("c.beginPath(); c.arc(s[0],s[1],3.4,0,6.2832); c.fillStyle=`rgb(${col})`; c.fill(); });",
     """c.beginPath(); c.arc(s[0],s[1],3.4,0,6.2832); c.fillStyle=`rgb(${col})`; c.fill();
    /* POLISH_20261103: tiny line-number badge right next to the ring, same color as its bus */
    { c.save(); c.font='800 15px -apple-system,"SF Pro Display",system-ui,sans-serif'; const tw=c.measureText(it.k).width, bw=Math.max(22,Math.round(tw+12)), bh=20, bx=s[0]+14, by=s[1]-bh/2;
      c.shadowColor=`rgba(${col},.55)`; c.shadowBlur=8; c.fillStyle=`rgb(${col})`; c.beginPath(); if(c.roundRect) c.roundRect(bx,by,bw,bh,10); else c.rect(bx,by,bw,bh); c.fill();
      c.shadowBlur=0; c.lineWidth=1.5; c.strokeStyle='rgba(16,20,28,.9)'; c.stroke();
      c.fillStyle='#fff'; c.textAlign='center'; c.textBaseline='middle'; c.fillText(it.k,bx+bw/2,by+bh/2+.5); c.restore(); } });""", 'stop-badge')

# C5. pills live in their own layer above the map's black edge fade (airFade, z 5), so they never read grey at the far edge
rep1("box.appendChild(e); BM2.els[it.id]=e; made=true; }", "(window.polBusBox?window.polBusBox():box).appendChild(e); BM2.els[it.id]=e; made=true; }   /* POLISH_20261103 */", 'pill-layer')

# B + A + C css/js block, appended right after the SHIP3 block
endm = "/* ===== end SHIP3_20261103 ===== */"
block = r"""/* ===== POLISH_20261103: Scout rows fit (no marquee, no clip), Focus cross-fade is sequential, bus pills in true screen space ===== */
(function(){ const POL={errs:0};
  const css=document.createElement('style'); css.id='polcss'; css.textContent=`
#cScout .w2-sl li span{text-overflow:clip!important}
#cScout .w2-sl li span.pol2{white-space:normal!important;line-height:1.12;text-wrap:balance}
.pick{transition:opacity .34s ease,transform .5s var(--ease),filter .34s ease,visibility 0s linear .34s!important}
.pick.on{transition:opacity .46s ease .3s,transform .7s var(--ease) .3s,filter .46s ease .3s,visibility 0s linear 0s!important}
.pick .why.wmq{margin-left:0!important;-webkit-mask-image:none!important;mask-image:none!important}
.pick .why .wmq-in{padding-left:0!important}
#polBusL{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:6;overflow:hidden}
body.mapping #polBusL{display:none!important}
#polBusP{position:absolute;left:0;top:0;width:0;height:0}
#polBusP .bm2{position:absolute;left:0;top:0;width:0;height:0;will-change:transform;opacity:0;transition:opacity .3s ease-out;pointer-events:none}
#polBusP .bm2.on{opacity:1}
#polBusP .bm2 .col{position:absolute;left:0;top:-18px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:3px}
#polBusP .bm2 .pl{box-sizing:border-box;height:36px;display:flex;align-items:center;gap:6px;padding:0 12px 0 14px;border-radius:18px;white-space:nowrap;color:#fff;font:800 24px/1 var(--sf);
 background:linear-gradient(180deg,color-mix(in srgb,var(--c) 90%,#fff),var(--c));box-shadow:inset 0 0 8px rgba(255,255,255,.16),0 3px 12px rgba(0,0,0,.5),0 0 24px 4px rgba(var(--r),.34)}
#polBusP .bm2 .pl b{font:inherit;font-style:normal}
#polBusP .bm2 .pl svg{width:18px;height:18px;flex:none}
#polBusP .bm2 .mn{font:800 22px/1 var(--sf);color:#fff;white-space:nowrap;text-shadow:0 0 10px rgba(0,0,0,.95),0 0 4px rgba(0,0,0,.9)}
@media (prefers-reduced-motion:reduce){ #polBusP .bm2{transition:none} }`;
  document.head.appendChild(css);
  /* Scout rows: one line first (shrink a touch, then drop trailing whole words); the lower right of the card sits in the avoid wedge, so rows never wrap. Never clipped, never slid. */
  const STOP=/(\s+(in|the|a|an|of|to|and|with|for|on|at|by|or|from|is|are|be|been|that|it|its|was|were|has|have|had|not|into|than|as))+$/i, TRIM=/[\s,;:—·(-]+$/;
  const full=s=>(s._pt!=null)?s._pt:(s._pt=s.textContent);
  const lines=s=>Math.round(s.offsetHeight/(parseFloat(getComputedStyle(s).lineHeight)||25));
  const drop=(s,t,bad)=>{ const lab=t.match(/^[A-Z][\w-]{1,12}:\s+/); let src=t; if(lab){ src=t.slice(lab[0].length); s.textContent=src; } const w=src.split(' ');
    const set=()=>{ s.textContent=w.join(' ').replace(TRIM,'').replace(STOP,'').replace(TRIM,''); };
    while(bad()&&w.length>1){ w.pop(); set(); }
    const nx=src.slice(src.indexOf(s.textContent)+s.textContent.length).trim().split(' ')[0]; if(w.length>1&&/^[\d.]+$/.test(nx)){ w.pop(); set(); } };
  const one=s=>{ const t=full(s); s.classList.remove('pol2'); s.style.fontSize=''; s.textContent=t; s._cut=false; const ov=()=>s.scrollWidth>s.clientWidth+1;
    if(ov()){ const z0=parseFloat(getComputedStyle(s).fontSize)||21; let z=z0; while(ov()&&z>z0*.84){ z-=.5; s.style.fontSize=z+'px'; } }
    if(ov()){ s._cut=true; drop(s,t,ov); } };
  const two=s=>{ const t=full(s); s.classList.add('pol2'); s.style.fontSize=''; s.textContent=t; const bad=()=>lines(s)>2||s.scrollWidth>s.clientWidth+1;
    if(bad()){ const z0=parseFloat(getComputedStyle(s).fontSize)||21; let z=z0; while(bad()&&z>z0*.9){ z-=.5; s.style.fontSize=z+'px'; } } if(bad()) drop(s,t,bad); };
  window.polScFit=function(){ try{ const spans=[...document.querySelectorAll('#cScout #w2Sl li > span')]; if(!spans.length||!spans[0].clientWidth) return; const ul=spans[0].closest('ul'), pg=document.querySelector('.pager');
    const sig=spans.map(full).join('|')+'|'+spans[0].clientWidth+'|'+(pg?Math.round(pg.getBoundingClientRect().top):0); if(ul._pf===sig) return;
    spans.forEach(one);
    ul._pf=sig; }catch(e){ POL.errs++; } };
  const sc=document.getElementById('cScout'); let q=0; const run=()=>window.polScFit();
  const sched=()=>{ if(q) return; q=1; requestAnimationFrame(()=>{ q=0; run(); }); };
  if(sc){ try{ new MutationObserver(sched).observe(sc,{childList:true,subtree:true,attributes:true,attributeFilter:['class']}); }catch(e){ POL.errs++; } }
  setInterval(run,1000);
  /* Focus: only the shown pick may ever be visible at rest. A pick that is not .on and has no running fade is pinned to opacity 0 (self-heal). */
  POL.healed=0;
  setInterval(()=>{ try{ document.querySelectorAll('.pick').forEach(p=>{ if(p.classList.contains('on')){ if(p.style.getPropertyValue('opacity')){ p.style.removeProperty('opacity'); p.style.removeProperty('visibility'); } return; }
      let run=false; try{ run=p.getAnimations().some(a=>a.playState==='running'); }catch(e){} if(run) return;
      if(+getComputedStyle(p).opacity>.02&&!p.style.getPropertyValue('opacity')){ p.style.setProperty('opacity','0','important'); p.style.setProperty('visibility','hidden','important'); POL.healed++; } }); }catch(e){ POL.errs++; } },100);
  /* bus pills layer: same clip + opacity as the sky's screen layer, but above the black edge fade */
  window.polBusBox=function(){ let L=document.getElementById('polBusL'); if(!L){ L=document.createElement('div'); L.id='polBusL'; L.setAttribute('aria-hidden','true'); const p=document.createElement('div'); p.id='polBusP'; L.appendChild(p); document.body.appendChild(L); } return document.getElementById('polBusP'); };
  setInterval(()=>{ try{ const L=document.getElementById('polBusL'), b=document.getElementById('airScrP'); if(!L||!b) return; const cp=b.style.clipPath||''; if(L.style.clipPath!==cp) L.style.clipPath=cp; const o=getComputedStyle(b); if(L.style.opacity!==o.opacity) L.style.opacity=o.opacity; const d=o.display==='none'?'none':''; if(L.style.display!==d) L.style.display=d; }catch(e){ POL.errs++; } },100);
  window.__pol=()=>{ const vis=[...document.querySelectorAll('.pick')].filter(p=>+getComputedStyle(p).opacity>.02).length;
    return {errs:POL.errs,healed:POL.healed,picksOn:document.querySelectorAll('.pick.on').length,picksVisible:vis,scoutRows:[...document.querySelectorAll('#cScout #w2Sl li > span')].map(s=>({t:s.textContent,ov:s.scrollWidth>s.clientWidth+1,wmq:s.classList.contains('wmq')}))}; };
})();
"""
rep1(endm, endm + "\n" + block + "/* ===== end POLISH_20261103 ===== */", 'block')
open('/Users/jaredbest/tmp/polish/wall.polish.html', 'w', encoding='utf-8').write(s)
print('written', len(src), '->', len(s))
