#!/usr/bin/env python3
# WINGSWAP_20261103 patch: python3 p_wingswap.py wall.live.html wall.new.html ws.js
import sys
src, dst, blk = sys.argv[1:4]
h = open(src, encoding='utf-8').read()
b = open(blk, encoding='utf-8').read()
assert 'WINGSWAP_20261103' not in h, 'already patched'

def rep(h, old, new):
    assert h.count(old) == 1, ('anchor count', h.count(old), old[:70])
    return h.replace(old, new)

# alert titles: allow a break after the slash (HOLLYWOOD/ WESTERN) instead of clipping
h = rep(h, "<div class=\"al-t\">'+esc(i.short||i.title||'Alert')+(isNew(i)", "<div class=\"al-t\">'+wsSl(esc(i.short||i.title||'Alert'))+(isNew(i)")
h = rep(h, "/* ===== end BULBONT_20261103 ===== */\n", "/* ===== end BULBONT_20261103 ===== */\n" + b)
open(dst, 'w', encoding='utf-8').write(h)
print('ok', len(h))
