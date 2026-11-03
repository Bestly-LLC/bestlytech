import sys, time
p = sys.argv[1]
s = open(p).read()
assert 'TAGBULB_20261103' not in s
a = 'DEFAULT_STATE.update({"busPush": True})'
assert s.count(a) == 1
line_end = s.index('\n', s.index(a))
add = '\nDEFAULT_STATE.update({"avoid": [], "calNums": False})   # TAGBULB_20261103: avoid = up to 6 keep-clear circles {x,y,r} (0..1 of the screen frame, r = fraction of width); calNums = 10x6 numbered calibration grid (auto-hides after 5 min). NOT calGrid: that key is the old mapping grid.'
s = s[:line_end] + add + s[line_end:]
b = '            if k in ("airKey", "calGrid") and not isinstance(v, bool):\n                continue\n'
assert s.count(b) == 1
c = b + '''            if k == "calNums" and not isinstance(v, bool):   # TAGBULB_20261103
                continue
            if k == "avoid" and not (isinstance(v, list) and len(v) <= 6 and all(isinstance(z, dict) and all(isinstance(z.get(q), (int, float)) and not isinstance(z.get(q), bool) for q in ("x", "y", "r")) and 0 <= z["x"] <= 1 and 0 <= z["y"] <= 1 and 0.005 <= z["r"] <= 0.25 for z in v)):   # TAGBULB_20261103
                continue
'''
s = s.replace(b, c)
open(p, 'w').write(s)
print('ok')
