#!/usr/bin/env python3
# BULBONT_20261103 patch: python3 p_bulbont.py wall.live.html wall.new.html bb.js
import sys
src, dst, blk = sys.argv[1:4]
h = open(src, encoding='utf-8').read()
b = open(blk, encoding='utf-8').read()
assert 'BULBONT_20261103' not in h, 'already patched'

def rep(h, old, new):
    assert h.count(old) == 1, ('anchor count', h.count(old), old[:70])
    return h.replace(old, new)

# 1) ONT rows: Airports card (pinned) and key page 3 list only the airports that are on the map
h = rep(h, "function scApHtml(){ const rows=['LAX','BUR','ONT'].map(", "function scApHtml(){ const rows=bbApList().map(")
h = rep(h, "function mnApHtml(){ const rows=['LAX','BUR','ONT'].map(", "function mnApHtml(){ const rows=bbApList().map(")
h = rep(h, "if(q&&c==='ONT'){ const d=Math.round(apMi(airHome[0],airHome[1],A.ll[0],A.ll[1])); st='Too far to track · '+d+NBP+'mi '+apComp(apBrg(airHome[0],airHome[1],A.ll[0],A.ll[1])); }",
          "if(q&&c==='ONT'){ st=bbOntLine(); }")
h = rep(h, "return `<div class=\"apc\">${rows.join('')}</div>`; }", "return `<div class=\"apc r${rows.length}\">${rows.join('')}</div>`; }")
# 2) block (after WAVE1 so every earlier function exists)
h = rep(h, "/* ===== end WAVE1_20261102 ===== */\n", "/* ===== end WAVE1_20261102 ===== */\n" + b)
open(dst, 'w', encoding='utf-8').write(h)
print('ok', len(h))
