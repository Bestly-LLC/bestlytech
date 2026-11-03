#!/usr/bin/env python3
"""SKYCLEAN_20261102 wall.html patcher on top of SKYAP_20261102. usage: p_clean.py wall.html clean.js"""
import sys
path, js = sys.argv[1:3]
src = open(path, encoding="utf-8").read()
assert "SKYAP_20261102" in src and "SKYCLEAN_20261102" not in src
J = open(js, encoding="utf-8").read()
CSS = """/* SKYCLEAN_20261102 */
*{text-overflow:clip!important}
.ac .apr{border-width:1.5px!important;box-shadow:none!important}
.ac.apph .apr{opacity:.35!important}
.ac .tag.v2.nol2 .tx span{display:none}
.ac .tag.skx{opacity:0!important}
"""
edits = [
    # 3: halve glow + corridor + runway halo
    ("gg.addColorStop(0,`rgba(${rgb},${busy?.38:.22})`); gg.addColorStop(.5,`rgba(${rgb},${busy?.16:.08})`);",
     "gg.addColorStop(0,`rgba(${rgb},${busy?.19:.11})`); gg.addColorStop(.5,`rgba(${rgb},${busy?.08:.04})`);"),
    ("c.strokeStyle=`rgba(${rgb},.28)`; c.lineWidth=13;", "c.strokeStyle=`rgba(${rgb},.12)`; c.lineWidth=10;"),
    ("g2.addColorStop(0,`rgba(${rgb},${(.34*al).toFixed(2)})`);", "g2.addColorStop(0,`rgba(${rgb},${(.17*al).toFixed(2)})`);"),
    # 2: runway end label: small, only the first active end, hidden on collision
    ("const lq=Q(...apPt(e.la,e.lo,e.h,.55,0)), lf=scrFrame(proj,lq[0],lq[1]); if(lf){",
     "const lq=Q(...apPt(e.la,e.lo,e.h,.55,0)), lqs=proj(lq[0],lq[1]), lf=(e===pick[0]&&lqs&&!skHit([lqs[0]-30,lqs[1]-14,lqs[0]+30,lqs[1]+14],SKR))?scrFrame(proj,lq[0],lq[1]):null; if(lf){"),
    ("c.font='800 22px '+", "c.font='800 12px '+"),
    ("c.lineWidth=6; c.strokeStyle='rgba(0,0,0,.75)'; c.strokeText(e.nm,0,0);", "c.lineWidth=3.5; c.strokeStyle='rgba(0,0,0,.75)'; c.strokeText(e.nm,0,0);"),
    # 1: leader line from the field to its pill (screen space) + obstacle list for the end label
    ("    /* runway strips */",
     "    { const pl=APX.place&&APX.place[code]; if(pl&&pl.gap>24){ c.save(); c.strokeStyle=`rgba(${rgb},.7)`; c.lineWidth=2; c.lineCap='round'; c.beginPath(); c.moveTo(pl.fx,pl.fy); c.lineTo(pl.px,pl.py); c.stroke(); c.restore(); } }\n    /* runway strips */"),
    ("function apDraw(c,proj,kp,now){ if(!apOn()||!AF.ppn) return; let n=0;", "function apDraw(c,proj,kp,now){ if(!apOn()||!AF.ppn) return; let n=0; const SKR=skRects();"),
    # 4: tag flip with margin + prefer the roomier side, drop line 2 when neither fits
    ("const lw=Math.max(140,txt.length*30)+r+26, lft=o._lft?obD(x+lw,y,0)<60:obD(x+lw,y,0)<0; if(o._lft!==lft){",
     "const lw=Math.max(140,txt.length*30)+r+26, rm=obD(x+lw,y,0), lm=obD(x-lw,y,0), lft=o._skf?o._skf==='l':((o._lft?rm<90:rm<30)&&lm>rm); if(o._lft!==lft){"),
    # 5: star labels
    ("items.push({t:land?t.toUpperCase():t, land, fill:land?'':getComputedStyle(el).fill, o:+o.toFixed(2), fr}); }",
     "items.push({t:land?t.toUpperCase():t, land, star:!land, fill:land?'':getComputedStyle(el).fill, o:+(land?o:o*.45).toFixed(2), fr}); }"),
    ("for(const it of items){ if(it.home) continue; g.font=(it.land?'700 17px ':'700 14px ')+ff;",
     "for(const it of items){ if(it.home) continue; g.font=(it.land?'700 17px ':it.star?'700 9px ':'700 14px ')+ff;"),
    ("bx=frBox(it.fr,w+8,(it.land?17:14)*1.3,0,4);\n        if(taken.some(q=>ov(bx,q))) it.skip=1;",
     "bx=frBox(it.fr,w+8,(it.land?17:it.star?9:14)*1.3,0,4);\n        if(taken.some(q=>ov(bx,q))||(it.star&&skStarHit(bx))) it.skip=1;"),
    ("} else { g.font=(it.land?'700 17px ':'700 14px ')+ff;", "} else { g.font=(it.land?'700 17px ':it.star?'700 9px ':'700 14px ')+ff;"),
    ("g.strokeStyle='rgba(0,0,0,.9)'; g.lineWidth=4; g.strokeText(it.t,0,0);", "g.strokeStyle='rgba(0,0,0,.9)'; g.lineWidth=(it.star?2.5:4); g.strokeText(it.t,0,0);"),
    ("(typeof scrObs==='function'?scrObs():[]).map(r=>r.map(v=>Math.round(v/8))));\n    if(sig===SCRL.sig)",
     "(typeof scrObs==='function'?scrObs():[]).map(r=>r.map(v=>Math.round(v/8))))+skObsSig();\n    if(sig===SCRL.sig)"),
    (".ac .tag.v2 .tx{min-width:0}\n", ".ac .tag.v2 .tx{min-width:0}\n" + CSS),
    ("/* ===== end SKYAP_20261102 ===== */", "/* ===== end SKYAP_20261102 ===== */\n" + J),
]
for old, new in edits:
    assert src.count(old) == 1, ("anchor", src.count(old), old[:70])
    src = src.replace(old, new)
open(path, "w", encoding="utf-8").write(src)
print("ok", len(src))
