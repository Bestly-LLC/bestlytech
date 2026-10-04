"""Cut each mascot out of the captured frames and save a looping GIF to public/mascots/<icon>.gif."""
import json, sys, os
from PIL import Image

frames_dir, out_dir = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(frames_dir, "boxes.json")))
s, n, fps = meta["scale"], meta["frames"], meta["fps"]
frames = [Image.open(os.path.join(frames_dir, f"f{i:03d}.png")).convert("RGB") for i in range(n)]
os.makedirs(out_dir, exist_ok=True)
total = 0
for b in meta["boxes"]:
    box = tuple(round(v * s) for v in (b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]))
    crops = [f.crop(box) for f in frames]
    # one shared palette for the whole loop so colors don't flicker between frames
    strip = Image.new("RGB", (crops[0].width, crops[0].height * len(crops)))
    for i, c in enumerate(crops):
        strip.paste(c, (0, i * c.height))
    pal = strip.quantize(colors=48, method=Image.Quantize.MEDIANCUT)
    q = [c.quantize(palette=pal, dither=Image.Dither.NONE) for c in crops]
    path = os.path.join(out_dir, f"{b['icon']}.gif")
    q[0].save(path, save_all=True, append_images=q[1:], duration=round(1000 / fps), loop=0, optimize=True, disposal=1)
    total += os.path.getsize(path)
print(f"wrote {len(meta['boxes'])} gifs, {total / 1e6:.1f} MB total")
