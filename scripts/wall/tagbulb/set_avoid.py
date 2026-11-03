#!/usr/bin/env python3
"""TAGBULB_20261103: turn calibration-grid cell numbers (1-60, row-major, 10 columns x 6 rows) into keep-clear circles.
usage: set_avoid.py 14 15 24 25 [--aspect 0.517] [--off] [--grid on|off] [--clear]
  Cells that touch (8-neighbours) form one cluster = one circle (max 6). Circle = center of the cluster's box, radius = half its diagonal (+3%).
  r is a fraction of the screen WIDTH, y is a fraction of the screen height. --aspect = screen height / width (live page 1920 x 993 = 0.517).
  Prints the exact SQL; run it with the Supabase MCP execute_sql (project rcqfqhguwpmaarseifqg) or any SQL console. No secrets involved.
  --clear prints SQL that removes all zones, --grid on|off prints the SQL that shows / hides the numbered grid."""
import sys, json, math
a = sys.argv[1:]
asp = 993 / 1920
if '--aspect' in a:
    i = a.index('--aspect'); asp = float(a[i + 1]); del a[i:i + 2]
if '--grid' in a:
    i = a.index('--grid'); v = a[i + 1] == 'on'
    print("select public.wall_apply_patch('%s'::jsonb);" % json.dumps({"calNums": v})); sys.exit()
if '--clear' in a or '--off' in a:
    print("select public.wall_apply_patch('{\"avoid\":[]}'::jsonb);"); sys.exit()
cells = sorted({int(x) for x in a if x.isdigit() and 1 <= int(x) <= 60})
if not cells:
    sys.exit(__doc__)
rc = {n: ((n - 1) // 10, (n - 1) % 10) for n in cells}
left, clusters = set(cells), []
while left:
    st = [left.pop()]; grp = [st[0]]
    while st:
        r, c = rc[st.pop()]
        for n in list(left):
            r2, c2 = rc[n]
            if abs(r - r2) <= 1 and abs(c - c2) <= 1:
                left.remove(n); st.append(n); grp.append(n)
    clusters.append(grp)
if len(clusters) > 6:
    sys.exit('more than 6 separate clusters; list fewer cells')
out = []
for g in clusters:
    rs = [rc[n][0] for n in g]; cs = [rc[n][1] for n in g]
    x0, x1 = min(cs) / 10, (max(cs) + 1) / 10
    y0, y1 = min(rs) / 6, (max(rs) + 1) / 6
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = math.hypot((x1 - x0) / 2, (y1 - y0) / 2 * asp) * 1.03
    out.append({"x": round(cx, 4), "y": round(cy, 4), "r": round(min(0.25, max(0.005, r)), 4)})
print("select public.wall_apply_patch('%s'::jsonb);" % json.dumps({"avoid": out}))
