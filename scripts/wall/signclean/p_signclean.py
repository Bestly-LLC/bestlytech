#!/usr/bin/env python3
"""SIGNCLEAN_20261102 patcher. usage: p_signclean.py in.html out.html (refuses an already patched file)."""
import sys, os
src, dst = sys.argv[1], sys.argv[2]
d = os.path.dirname(os.path.abspath(__file__))
h = open(src, encoding='utf-8').read()
assert 'SIGNCLEAN_20261102' not in h, 'already patched'
css = open(os.path.join(d, 'sign.css'), encoding='utf-8').read()
js = open(os.path.join(d, 'sign.js'), encoding='utf-8').read()

def rep(a, b, n=1):
    global h
    assert h.count(a) == n, (a[:60], h.count(a))
    h = h.replace(a, b)

# airport chips on the sky: code only (ONT edge chip keeps "44 mi" + chevron)
rep("const t1=inb?A.n:(A.n+' · '+Math.round(dmi)+NBP+'mi '+apComp(apBrg(airHome[0],airHome[1],A.ll[0],A.ll[1])));",
    "const t1=inb?'':(Math.round(dmi)+NBP+'mi');", 2)
# signatures start below the card band
rep("const WING_BAND=330;", "const WING_BAND=500;")
# css before </head>, js after the SKYCLEAN2 block
rep("</head>", "<style id=\"signclean\">\n" + css + "\n</style>\n</head>")
anchor = "/* ===== end SKYCLEAN2_20261102 ===== */"
rep(anchor, anchor + "\n" + js)
open(dst, 'w', encoding='utf-8').write(h)
print('ok', len(h))
