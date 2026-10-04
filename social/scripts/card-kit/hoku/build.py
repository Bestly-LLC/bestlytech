"""Inline the icon set (gfx.json, exported from hoku-clean/social/graphics.mjs) into card.html."""
import json, os
d = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(d, "card.src.html")).read()
gfx = json.load(open(os.path.join(d, "gfx.json")))
open(os.path.join(d, "card.html"), "w").write(src.replace("__GFX__", json.dumps(gfx)))
print("card.html written,", len(gfx), "icons")
