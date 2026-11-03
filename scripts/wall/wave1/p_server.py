#!/usr/bin/env python3
import ast, sys
src, dst, blk = sys.argv[1:4]
s = open(src).read()
b = open(blk).read()
assert 'WAVE1_20261102' not in s
for n in ('BUSPUSH', 'bus_leave_now', 'bus_push_loop', '_bus_key'):
    assert n not in s, n
a1 = 'SKY_PRED = {"fast": False,'
assert s.count(a1) == 1
s = s.replace(a1, b + a1)
a2 = '    threading.Thread(target=presence_loop, daemon=True).start()\n'
assert s.count(a2) == 1
s = s.replace(a2, a2 + '    threading.Thread(target=bus_push_loop, daemon=True).start()   # WAVE1_20261102\n')
ast.parse(s)
open(dst, 'w').write(s)
print('ok')
