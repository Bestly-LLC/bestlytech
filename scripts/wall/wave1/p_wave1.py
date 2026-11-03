#!/usr/bin/env python3
"""WAVE1_20261102 patcher for wall.html. usage: p_wave1.py <in.html> <out.html> <wave1.js>. Anchored replaces, each asserted once."""
import ast, re, sys
src, dst, js = sys.argv[1:4]
s = open(src).read()
blk = open(js).read()
assert 'WAVE1_20261102' not in s, 'already applied'
for name in ('W1', 'w1Rows', 'w1Want', 'w1Render', 'w1Home', 'w1Snap', 'w1Fit', 'w1Set', 'w1Ensure', 'w1Badge', 'w1T12', 'W1N'):
    assert not re.search(r'(?:const|let|var|function)\s+' + name + r'\b', s), 'name in use: ' + name
    assert not re.search(r'[^A-Za-z0-9_$.]' + name + r'\s*=[^=]', s), 'name assigned: ' + name


def rep(old, new):
    global s
    assert s.count(old) == 1, ('anchor count', s.count(old), old[:80])
    s = s.replace(old, new)


# 1. the shared slot uses the urgency rule
rep("const want=fl?'flight':bus?'bus':key?'key':'none'; if(!SC.hold||SC.hold.s!==want||SC.hold.mn!==1)",
    "const want=w1Want(fl,bus,key); if(!SC.hold||SC.hold.s!==want||SC.hold.mn!==1)")
# 2. the block goes right after LEFTOVER
rep("/* ===== end LEFTOVER_20261102 ===== */\n", "/* ===== end LEFTOVER_20261102 ===== */\n" + blk)
open(dst, 'w').write(s)
# syntax check of every inline script
import re, subprocess, tempfile, os
for i, m in enumerate(re.finditer(r'<script(?![^>]*src)[^>]*>(.*?)</script>', s, re.S)):
    code = m.group(1)
    if 'WAVE1_20261102' in code:
        f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False)
        f.write(code)
        f.close()
        r = subprocess.run(['node', '--check', f.name], capture_output=True, text=True)
        print('node --check script', i, 'rc', r.returncode, r.stderr[:400])
        os.unlink(f.name)
        assert r.returncode == 0
print('patched', len(s))
