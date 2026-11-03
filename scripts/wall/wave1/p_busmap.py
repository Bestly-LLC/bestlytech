#!/usr/bin/env python3
"""preview-only: builds wall.proto.html (wall.new.html + busmap proto). The live wall.html is never touched. usage: p_busmap.py in.html out.html busmap_proto.js"""
import re, subprocess, sys, tempfile, os
src, dst, js = sys.argv[1:4]
s = open(src).read()
blk = open(js).read()
assert 'BUSMAP_PROTO_20261102' not in s and 'WAVE1_20261102' in s
a = "/* ===== end WAVE1_20261102 ===== */\n"
assert s.count(a) == 1
s = s.replace(a, a + blk)
h = "    try{ apDraw(c,proj,kp,now); }catch(e){ V2.errs++; }   /* SKYAP_20261102 */"
assert s.count(h) == 1
s = s.replace(h, h + "\n    try{ bmDraw(c,proj,kp,now); }catch(e){ V2.errs++; }   /* BUSMAP_PROTO */")
open(dst, 'w').write(s)
for m in re.finditer(r'<script(?![^>]*src)[^>]*>(.*?)</script>', s, re.S):
    if 'BUSMAP_PROTO_20261102' in m.group(1):
        f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False); f.write(m.group(1)); f.close()
        r = subprocess.run(['node', '--check', f.name], capture_output=True, text=True); os.unlink(f.name)
        print('node --check rc', r.returncode, r.stderr[:300]); assert r.returncode == 0
print('ok')
