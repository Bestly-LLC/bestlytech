import sys, re
# usage: python3 p_wall.py <in.html> <out.html> <block.js>
src = open(sys.argv[1]).read()
blk = open(sys.argv[3]).read().replace("#cCar .hdr .meta{margin-left:auto;", "#cCar .hdr .meta{")
assert "CARCARD_20261103" not in src, "already patched"
for n in ("id=\"cCar\"", "carccss", "ccList", "ccFt", "ccMeta", "ccdOrder", "__ccd", "CCD="):
    assert src.count(n) == 0, ("name already used", n, src.count(n))
def sub(a, b):
    global src
    assert src.count(a) == 1, (src.count(a), a[:70])
    src = src.replace(a, b)
# 1. rotation order: Cars page right after the Blue Steel / Turo card (devOrder keeps working)
sub("return (typeof devOrder==='function')?devOrder(o2):o2;   // R4 devices: Devices card after Batteries",
    "const o3=(typeof devOrder==='function')?devOrder(o2):o2; return (typeof ccdOrder==='function')?ccdOrder(o3):o3;   // R4 devices: Devices card after Batteries; CARCARD_20261103: Cars card after Turo")
# 2. the block, appended at the end of the page closure (after everything else)
tail = "})();\n</script>\n<script type=\"text/plain\" id=\"skyTileWorker\">"
sub(tail, blk + tail)
open(sys.argv[2], "w").write(src)
print("ok", len(src))
