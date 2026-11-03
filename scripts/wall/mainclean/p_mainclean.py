#!/usr/bin/env python3
"""MAINCLEAN_20261102 wall.html patcher. usage: p_mainclean.py in.html out.html (refuses an already patched file)."""
import sys, os, re
src, dst = sys.argv[1], sys.argv[2]
d = os.path.dirname(os.path.abspath(__file__))
h = open(src, encoding='utf-8').read()
assert 'MAINCLEAN_20261102' not in h, 'already patched'
css = open(os.path.join(d, 'mc.css'), encoding='utf-8').read()
js = open(os.path.join(d, 'mc.js'), encoding='utf-8').read()

def rep(a, b, n=1):
    global h
    assert h.count(a) == n, (a[:70], h.count(a))
    h = h.replace(a, b)

# 1. unknown planes: best guess, never the word "Unknown"
rep("unknown:['Unknown','#98989D']}", "unknown:['Aircraft','#98989D']}")
rep("  function acInfo(a){\n", r"""  function mnGuess(a){ const t=a.t||'', cat=a.cat||'', alt=a.alt!=null?Math.round(a.alt/100)*100:null, reg=a.reg||''; let w='Aircraft';
    if(HELI.test(t)||cat==='A7') w='Helicopter'; else if(BIZJET.test(t)) w='Business jet';
    else if(cat==='A1'||cat==='A2'||/^(C1\d\d|C2\d\d|SR2|PA|P28|BE3|BE2|DA4|M20|PC12|C208)/.test(t)) w='Small plane';
    else if(cat==='A3'||cat==='A4'||cat==='A5') w='Jet'; else if(cat==='A6') w='Fast jet'; else if(cat==='B6') w='Drone';
    else if(alt!=null&&alt<5000&&(a.gs||0)<160) w='Small plane';
    const ft=alt!=null?alt.toLocaleString('en-US')+' ft':''; return {who:w,short:w+(ft?' · '+ft:'')+(reg?' · '+reg:'')}; }
  function acInfo(a){
""")
rep("kind='unknown'; who='Unknown aircraft'; short='Unknown'; }", "kind='unknown'; { const g=mnGuess(a); who=g.who; short=g.short; } }")
rep("else if(I.kind==='unknown'){ eb='Unknown'; head='Unknown aircraft'; line=['Not sharing who it is', ph]; }",
    "else if(I.kind==='unknown'){ eb='Best guess'; head=I.short; line=[a.reg?'':'Type not shared', ph]; }")
rep("(a.reg||a.cs||KINDS[I.kind][0])", "(a.reg||a.cs||(I.kind==='unknown'?I.who:KINDS[I.kind][0]))")
# 2. client fallback: military / police / news never get a takeoff-landing phase line
rep("    if(I.kind==='heli'||I.kind==='rescue') return (a.gs||0)<25?'Hovering':(a.gs||0)<60?'Circling slowly':'';\n",
    "    if(I.kind==='heli'||I.kind==='rescue') return (a.gs||0)<25?'Hovering':(a.gs||0)<60?'Circling slowly':'';\n    if(I.kind==='military') return a.vr>600?'Climbing':a.vr<-600?'Descending':'';\n")
# 3. corridor ticks: ~60% smaller, label hides when it would touch a chip / tag / Home / map label
rep("c.lineCap='round'; c.strokeStyle=`rgba(${rgb},.9)`; c.lineWidth=3; c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(b[0],b[1]); c.stroke(); c.restore();",
    "c.lineCap='round'; c.strokeStyle=`rgba(${rgb},.75)`; c.lineWidth=1.4; c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(b[0],b[1]); c.stroke(); c.restore();")
rep("const a=P(...apPt(e.la,e.lo,e.h,d,-.55)), b=P(...apPt(e.la,e.lo,e.h,d,.55));", "const a=P(...apPt(e.la,e.lo,e.h,d,-.22)), b=P(...apPt(e.la,e.lo,e.h,d,.22));")
rep("const tq=Q(...apPt(e.la,e.lo,e.h,d,.95)), tf=(e===pick[0])?scrFrame(proj,tq[0],tq[1]):null; if(tf){ c.save(); frIn(c,tf); c.font='800 19px '+",
    "const tq=Q(...apPt(e.la,e.lo,e.h,d,.5)), tqs=proj(tq[0],tq[1]), tf=(e===pick[0]&&tqs&&!skHit([tqs[0]-30,tqs[1]-12,tqs[0]+30,tqs[1]+12],SKR.concat(skHard())))?scrFrame(proj,tq[0],tq[1]):null; if(tf){ c.save(); frIn(c,tf); c.font='800 11px '+")
rep("c.lineWidth=5; c.strokeStyle='rgba(0,0,0,.7)'; c.strokeText(d+NBP+'mi',0,0);", "c.lineWidth=3; c.strokeStyle='rgba(0,0,0,.7)'; c.strokeText(d+NBP+'mi',0,0);")
# 4. Turo calendar: names that fit (full, first name, initials), data kept for a measured re-fit
rep("sig='v4'+t0", "sig='v5'+t0")
rep("if(nm){ const f2=Math.floor((run*56-(lsh?76:40))/9.5); lab=`<span class=\"tc-g\">${ic}${esc(nm.length<=f2?nm:nm.slice(0,1))}</span>`; } }",
    "if(nm){ const av=run*56-(lsh?50:9)-8, first=nm.split(/\\s+/)[0], ini=nm.split(/\\s+/).map(x=>x.charAt(0)).join('').slice(0,2).toUpperCase(), shown=nm.length*11.6<=av-26?nm:(first.length*11.6<=av-26?first:ini); lab=`<span class=\"tc-g\" data-run=\"${run}\" data-l=\"${lsh?50:9}\" data-c=\"${esc([nm,first,ini].join('|'))}\">${ic}${esc(shown)}</span>`; } }")
# 5. Local alerts: always on (quiet card when nothing is near), band always reserved
rep("document.body.classList.toggle('al-on',on); }", "document.body.classList.toggle('al-on',true); }")
rep("pinAlerts(false); if(!on) return;", "pinAlerts(false); if(!on){ mnAlQuiet(el); return; }")
# css + js
rep("</head>", "<style id=\"mainclean\">\n" + css + "\n</style>\n</head>")
anchor = "/* ===== end SIGNCLEAN_20261102 ===== */"
rep(anchor, anchor + "\n" + js)
open(dst, 'w', encoding='utf-8').write(h)
print('ok', len(h))
