#!/usr/bin/env python3
"""PNG frame folders -> the unit kit: transparent WebP sequences + manifest.json.
usage: python3 frames.py <png_root> <out_kit_dir>     (png_root has hero/ turn/ reveal/ glimpse/ with f000.png ...)
WebP: quality 90, alpha_quality 100, method 4 (lossy colour, near-lossless alpha: soft silhouette edges stay soft)."""
import json
import os
import sys
import hashlib
from PIL import Image, ImageChops

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "public", "models", "device-web-split.glb")


FEATHER = 70      # px: the alpha fades to nothing over the outer 70 px of the 1200 px frame, so even an object that wanders to the edge never shows a hard cut


def edge_mask(n, f=FEATHER):
    ramp = []
    for i in range(n):
        t = min(1.0, min(i, n - 1 - i) / f)
        ramp.append(int(255 * t * t * (3 - 2 * t)))          # smoothstep
    row = Image.new("L", (n, 1))
    row.putdata(ramp)
    mx = row.resize((n, n), Image.NEAREST)
    my = mx.transpose(Image.TRANSPOSE)
    return ImageChops.multiply(mx, my)


def main(root, out):
    mask = None
    man = {}
    for mom in ("reveal", "turn", "glimpse", "hero"):
        d = os.path.join(root, mom)
        if not os.path.isdir(d):
            continue
        fs = sorted(f for f in os.listdir(d) if f.endswith(".png"))
        if not fs:
            continue
        os.makedirs(os.path.join(out, mom), exist_ok=True)
        for i, f in enumerate(fs):
            im = Image.open(os.path.join(d, f)).convert("RGBA")
            mask = mask or edge_mask(im.size[0])
            im.putalpha(ImageChops.multiply(im.getchannel("A"), mask))
            im.save(os.path.join(out, mom, f"f{i:03d}.webp"), "WEBP", quality=90, alpha_quality=100, method=4)
        man[mom] = {"count": len(fs), "fps": 30, "size": 1200}
    try:
        man["_source"] = {"glb": "public/models/device-web-split.glb", "sha1": hashlib.sha1(open(SRC, "rb").read()).hexdigest()[:12], "three": "0.160.1"}
    except OSError:
        pass
    json.dump(man, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print(man)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
