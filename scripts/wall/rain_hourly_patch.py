#!/usr/bin/env python3
"""Wall: add the 10-day's blue rain hill to the hourly weather chart (add-only; Jared 2026-10-21).
Usage: rain_patch.py <wall.html in> <wall.html out>. Refuses unless every anchor is found exactly once."""
import sys

SRC, DST = sys.argv[1], sys.argv[2]
s = open(SRC, encoding="utf-8").read()

FN_ANCHOR = "  function buildHourly(){\n"
CALL_ANCHOR = "    try{ wxEvHourly(svg,items,pts,line); }catch(e){ window.__wxErr=String((e&&e.message)||e); }   // calendar events (add-only, own try/catch)\n"

FN = r"""  /* ===== Hourly rain hill (add-only; Jared 2026-10-21): the same blue hill the 10-day draws, right under the hourly temperature curve.
     Nothing above it moves. It sits behind the calendar band and fades into the TV shadow over 40 px (never a hard cut). ===== */
  function wxRainHourly(svg,items,pts){
    const n=items.length; if(n<2||svg.querySelector('#pgH')) return;
    const has=x=>x&&x.pop!=null&&isFinite(+x.pop);
    const pop=items.map((it,i)=>{ if(has(it)) return +it.pop; const a=items.slice(0,i).reverse().find(has), b=items.slice(i+1).find(has);   // sunrise/sunset points: between their neighbours
      return a&&b?Math.round((+a.pop + +b.pop)/2):a?+a.pop:b?+b.pop:0; });
    const base=226, ph=v=>base-Math.max(0,Math.min(100,v))/100*28,   /* just under the temperature curve, above the calendar band (y 224-296); higher = less of it under the TV shadow */ xa=Math.max(0,pts[0][0]-30), xb=Math.min(730,pts[n-1][0]+30);
    const defs=svg.querySelector('defs');
    const pg=el('linearGradient',{id:'pgH',x1:0,x2:0,y1:0,y2:1},defs); el('stop',{offset:0,'stop-color':thColor('precip','#0A84FF'),'stop-opacity':.95},pg); el('stop',{offset:1,'stop-color':thColor('precip','#0A84FF'),'stop-opacity':.25},pg);
    let lm=730; try{ const pb=stageBox(svg.parentElement), sbx=pb.x+(parseFloat(svg.style.left)||0), sby=pb.y+(parseFloat(svg.style.top)||0), m=maskLeftX(sby+base-32,sby+base+2);
      if(isFinite(m)) lm=Math.max(0,Math.min(730,m-sbx-6)); }catch(e){}
    const g=el('g',{},null), edge=Math.min(lm,xb), soft=40;    // soft ends: fades in at the left when it is already raining, and out at the right edge / TV shadow
    const fg=el('linearGradient',{id:'pgHf',gradientUnits:'userSpaceOnUse',x1:xa,x2:edge,y1:0,y2:0},defs), W=Math.max(1,edge-xa), f=v=>Math.max(0,Math.min(1,v/W));
    [[0,pop[0]>0?0:1],[f(30),1],[f(W-soft),1],[1,0]].forEach(([o,a])=>el('stop',{offset:o,'stop-color':'#fff','stop-opacity':a},fg));
    const mk=el('mask',{id:'pgHm',maskUnits:'userSpaceOnUse',x:0,y:base-40,width:730,height:50},defs); el('rect',{x:xa,y:base-40,width:W,height:50,fill:'url(#pgHf)'},mk); g.setAttribute('mask','url(#pgHm)');
    const pp=pts.map((p,i)=>[p[0],ph(pop[i])]); pp.unshift([xa,pop[0]>0?ph(pop[0]):base]); pp.push([xb,ph(pop[n-1])]);   // ends carry the edge value on (the rain does not stop at the chart edge)
    el('path',{d:smooth(pp)+` L${xb} ${base} L${xa} ${base} Z`,fill:'url(#pgH)',class:'rise-area'},g);
    el('line',{x1:xa,x2:xb,y1:base,y2:base,stroke:'rgba(235,235,245,.14)','stroke-width':1},g);
    svg.insertBefore(g,defs.nextSibling);
    window.__wxRain={max:Math.max(...pop),edgeX:Math.round(lm)};
  }
"""
CALL = "    try{ wxRainHourly(svg,items,pts); }catch(e){ window.__wxErr=String((e&&e.message)||e); }   // rain hill like the 10-day (add-only, own try/catch)\n"

if "function wxRainHourly(" in s:
    print("already patched"); open(DST, "w", encoding="utf-8").write(s); sys.exit(0)
for a in (FN_ANCHOR, CALL_ANCHOR):
    if s.count(a) != 1:
        print("refusing: anchor count", s.count(a), repr(a[:50])); sys.exit(2)
s = s.replace(FN_ANCHOR, FN + FN_ANCHOR, 1).replace(CALL_ANCHOR, CALL + CALL_ANCHOR, 1)
open(DST, "w", encoding="utf-8").write(s)
print("patched")
