#!/usr/bin/env python3
"""Local alerts v4: alerts card on the sign wall + sky declutter. Needs v3 already applied. Re-runnable.
usage: patch_wall_v4.py wall.html v4_css.txt v4_js.txt"""
import sys

p, css_p, js_p = sys.argv[1:4]
s = open(p, encoding="utf-8", newline="").read()
css, js = open(css_p, encoding="utf-8").read(), open(js_p, encoding="utf-8").read()
assert "Sky Sync, v3" in s, "v3 not applied yet"

def put_block(s, start_marker, end_marker, block, anchor, before=True):
    i = s.find(start_marker)
    if i >= 0:                                   # re-run: replace the old v4 block
        j = s.index(end_marker, i) + len(end_marker)
        return s[:i] + block + s[j:]
    k = s.index(anchor)
    if not before:
        k += len(anchor)
    return s[:k] + block + s[k:]

# CSS right after the v3 alerts CSS block
s = put_block(s, "/* Local alerts v4 (Oct 29", "#airScrP .ac .tag.decl{opacity:0!important;}\n", css.rstrip("\n") + "\n",
              "body.skit #airCit,body.sheep #airCit,body.pf-noyou #airCit,body.mapping #airCit{display:none!important;}\n", before=False)
# JS right before the sky key code (same scope as citPaint / pinKey)
s = put_block(s, "  /* Local alerts v4 (Oct 29): sign-wall card", "  setInterval(tagDeclutter,400);\n", js.rstrip("\n") + "\n",
              "  // Sky key lives on the sign wall now")

# sign-wall band: signatures start lower while the alerts card sits under the flight card
a = "function sigTop(){ return wingBand?WING_BAND:160; }"
if a in s:
    s = s.replace(a, "var ALB=false; function sigTop(){ return wingBand?(ALB?500:WING_BAND):160; }", 1)
a = "const b=document.body.classList.contains('fl-on')||document.body.classList.contains('key-on'); if(b===wingBand) return;"
if a in s:
    s = s.replace(a, "const cl=document.body.classList, b=cl.contains('fl-on')||cl.contains('key-on')||cl.contains('al-on'), ab=cl.contains('al-on')&&cl.contains('fl-on'); if(b===wingBand&&ab===ALB) return; ALB=ab;", 1)
# re-pin the card whenever the sign wall geometry is pinned
a = "pinEl($('#wing'),WW,WH,S.wing); try{ pinFlight(); pinKey(); }catch(e){}"
if a in s:
    s = s.replace(a, "pinEl($('#wing'),WW,WH,S.wing); try{ pinFlight(); pinKey(); if(typeof pinAlerts==='function') pinAlerts(true); }catch(e){}", 1)

# sky dots: a dot that would land on Home is pushed out to a small ring around it (same direction), so Home always reads
a = "let any=false, nl=0, ring=0;"
if a in s and "nudge=0" not in s:
    s = s.replace(a, "let any=false, nl=0, ring=0, nudge=0;", 1)
a = "const [x,y]=airXY(la,lo), ins=obD(x,y,0)>m&&obD(x,y,1)>m*.6;"
if a in s:
    s = s.replace(a, "let [x,y]=airXY(la,lo); { const hh=airXY(CIT_HOME[0],CIT_HOME[1]), dx=x-hh[0], dy=y-hh[1], dd=Math.hypot(dx,dy), R0=140;"
                     " if(dd<R0){ const an=dd>2?Math.atan2(dy,dx):(Math.PI*.75+(nudge++)*1.15); x=hh[0]+Math.cos(an)*R0; y=hh[1]+Math.sin(an)*R0; } }"
                     " const ins=obD(x,y,0)>m&&obD(x,y,1)>m*.6;", 1)

# scrLabels: place names that would cover Home, a plane tag, an alert dot or another kept name are skipped
a = "    const sig=JSON.stringify(items.map(i=>[i.t,i.o,i.fr.p.map(v=>Math.round(v)),i.fr.f.map(v=>v.toFixed(3)),i.fr.s.toFixed(3)]))+innerWidth+'x'+innerHeight;"
if a in s:
    s = s.replace(a, a[:-1] + "+'|'+JSON.stringify((typeof scrObs==='function'?scrObs():[]).map(r=>r.map(v=>Math.round(v/8))));", 1)
a = "    for(const it of items){ g.save(); g.globalAlpha=it.o; frIn(g,it.fr);"
if a in s:
    s = s.replace(a, "    { const taken=(typeof scrObs==='function'?scrObs():[]), ov=(p,q)=>p[0]<q[2]&&q[0]<p[2]&&p[1]<q[3]&&q[1]<p[3];\n"
                     "      for(const it of items) if(it.home){ const hb=frBox(it.fr,70,64,0,6); window.__scrHome=hb; taken.unshift(hb); }\n"
                     "      for(const it of items){ if(it.home) continue; g.font=(it.land?'700 17px ':'700 14px ')+ff; try{ g.letterSpacing=it.land?'1.2px':'0px'; }catch(_){}\n"
                     "        const w=g.measureText(it.t).width+(it.land?it.t.length*1.2:0), bx=frBox(it.fr,w+8,(it.land?17:14)*1.3,0,4);\n"
                     "        if(taken.some(q=>ov(bx,q))) it.skip=1; else taken.push(bx); } }\n"
                     "    for(const it of items){ if(it.skip) continue; g.save(); g.globalAlpha=it.o; frIn(g,it.fr);", 1)

for need in ("Local alerts v4", "function citCard", "#wingAlerts{", "var ALB=false", "ab=cl.contains('al-on')", "pinAlerts(true); }catch(e){}", "if(it.skip) continue;", "scrObs():[]).map", "nudge=0", "R0=140"):
    assert need in s, "missing after patch: " + need
open(p, "w", encoding="utf-8", newline="").write(s)
print("patched", len(s))
