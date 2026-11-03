#!/usr/bin/env python3
"""SKYAP_20261102 wall.html patcher. Anchored (count==1), refuses an already patched file. usage: p_wall.py <wall.html> <sky.js> <sky.css>"""
import sys, shutil, time
path, js, css = sys.argv[1:4]
src = open(path, encoding="utf-8").read()
assert "SKYAP_20261102" not in src, "already patched"
J, C = open(js, encoding="utf-8").read(), open(css, encoding="utf-8").read()
shutil.copy(path, path + ".bak_skyap_" + time.strftime("%Y%m%d-%H%M"))
edits = [
    ("if(S.skyTiles!==true){ const pts=LAX_RWY", "if(false/*SKYAP_20261102 old LAX glyph off*/&&S.skyTiles!==true){ const pts=LAX_RWY"),
    ("    try{ v2Pred(c,proj,kp,now); }catch(e){ SKY.errs++; }",
     "    try{ apDraw(c,proj,kp,now); }catch(e){ V2.errs++; }   /* SKYAP_20261102 */\n    try{ v2Pred(c,proj,kp,now); }catch(e){ SKY.errs++; }"),
    ("/* FLIGHTV2_P2 20261102 */\n", C + "/* FLIGHTV2_P2 20261102 */\n"),
    ("/* ===== end FLIGHTV2_P2 ===== */", J + "/* ===== end FLIGHTV2_P2 ===== */"),
]
for old, new in edits:
    assert src.count(old) == 1, ("anchor", src.count(old), old[:60])
    src = src.replace(old, new)
open(path, "w", encoding="utf-8").write(src)
print("patched", path, len(src))
