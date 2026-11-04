import sys, os, ast
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patchlib import patch
P = os.path.expanduser("~/.bestly/ask/ask_answerer.py")
patch(P, [
 ('(re.compile(r"\\bnext bus\\b|when.{0,12}\\bbus\\b|\\bbus\\b.{0,15}(coming|next|when)"), fp_bus),',
  '(re.compile(r"\\bnext bus\\b|when.{0,12}\\bbus\\b|\\bbus\\b.{0,15}(coming|next|when)|\\b105\\b"), fp_bus),   # PLACEFIT_20261103: any question naming the 105 or "next bus" takes the bus fast path'),
 ('mm = re.search(r"\\bmetro\\s+(\\d+)|\\bthe\\s+(\\d{1,3})\\b|\\bline\\s+(\\d+)", q)',
  'mm = re.search(r"\\bmetro\\s+(\\d+)|\\bthe\\s+(\\d{1,3})\\b|\\bline\\s+(\\d+)|\\bnext\\s+(\\d{1,3})\\b|\\b(\\d{2,3})\\s+bus\\b|\\b(105)\\b", q)   # PLACEFIT_20261103'),
])
ast.parse(open(P, encoding="utf-8").read())
print("ast ok")
