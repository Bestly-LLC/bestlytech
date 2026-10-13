#!/usr/bin/env python3
"""Centering YOU test for the unique-content system (2026-10-12): a NEW internal draft that is a copy of CY29 with a music bed and two feathered
callout cards. CY29 itself is never touched. Centering YOU videos are recordings of Elizabeth (cy-kit), not Montage scripts, so this does what Montage
does for its own videos in three steps: pick a bed (the picker lends a track from the bestly-* brands because Centering YOU has none of its own and
keeps off the last two it used), duck it under her voice with the same gain curve music.py uses, and lay two soft cards in the free band between the
hook box and her head (inside the house safe zones: y 420..640, x 40..1040). Files the result with montage_file as an internal draft.

usage (on the Pi): python3 cy_music_graphics.py <job_id>      (the job row is made first by the caller: client centering-you, requested_by spark)
"""
import json
import os
import subprocess
import sys
import urllib.request

sys.path.insert(0, "/opt/bestly/montage")
sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402
import music  # noqa: E402
import worker  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

ITEM = "19b53018-175b-4a0c-ac29-399c9af37d3a"           # CY29
SRC = "https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review/posts/centering-you/5bbc31d3-b21d-4d59-8c7c-7b1396fc38f8.mp4"
FONTS = "/opt/bestly/cy-kit/fresh/assets/fonts/"
CREAM, INK, TEAL, GOLD = (239, 226, 212), (42, 94, 99), (72, 149, 151), (252, 192, 77)
CALLOUTS = [(7.0, "The in-between"), (22.0, "How are we filling in?")]   # words from the caption and from her own sentences
SHOW = 4.0


def card(text):
    f = ImageFont.truetype(FONTS + "EBGaramond-600.ttf", 56)
    w = int(ImageDraw.Draw(Image.new("RGB", (4, 4))).textlength(text, font=f)) + 150
    h, pad = 120, 60
    img = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 8, pad + w, pad + h + 8), 60, fill=(12, 22, 34, 120))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((pad, pad, pad + w, pad + h), 60, fill=CREAM + (240,))
    d.rounded_rectangle((pad, pad + h - 7, pad + w, pad + h), 3, fill=GOLD + (255,))           # the house gold rule, kept soft by the radius
    d.ellipse((pad + 38, pad + h // 2 - 12, pad + 62, pad + h // 2 + 12), fill=TEAL + (255,))
    d.text((pad + 88, pad + h // 2 - 4), text, font=f, fill=INK + (255,), anchor="lm")
    return img


def main(jid):
    jd = f"{worker.JOBS}/{jid}"
    os.makedirs(f"{jd}/public", exist_ok=True)
    src = f"{jd}/src.mp4"
    urllib.request.urlretrieve(SRC, src)
    total = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).decode())
    # music: speech runs through nearly the whole video, so the bed sits under it the whole way and swells in the last second
    script = {"scenes": [{"voice_at": 0.3, "voice_end": total - 1.0, "say": ""}], "end": {"voice_end": total - 1.0}}
    minfo = music.build("centering-you", "warm", script, total, jd, jid)
    print("music:", minfo["name"], minfo["track_mood"], "looped" if minfo["looped"] else "", flush=True)
    imgs = []
    for i, (t, text) in enumerate(CALLOUTS):
        p = f"{jd}/card{i}.png"
        card(text).save(p)
        imgs.append((t, p))
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", src]
    for t, p in imgs:
        cmd += ["-loop", "1", "-t", f"{SHOW}", "-i", p]
    cmd += ["-i", f"{jd}/public/music.wav"]
    fc, last = [], "[0:v]"
    for i, (t, p) in enumerate(imgs, 1):
        fc.append(f"[{i}:v]format=rgba,fade=t=in:st=0:d=0.45:alpha=1,fade=t=out:st={SHOW - 0.45}:d=0.45:alpha=1,setpts=PTS+{t}/TB[c{i}]")
        fc.append(f"{last}[c{i}]overlay=x='(W-w)/2':y='400+34*max(0,1-(t-{t})/0.55)':enable='between(t,{t},{t + SHOW})':eof_action=pass[v{i}]")
        last = f"[v{i}]"
    n = len(imgs) + 1
    fc.append(f"{last}scale=in_range=tv:out_range=tv:out_color_matrix=bt709,format=yuv420p[v]")
    fc.append(f"[0:a][{n}:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=disabled[a]")
    out = f"{jd}/out.mp4"
    cmd += ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
            "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-r", "30", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True, timeout=900)
    worker.normalize(out, jid)
    thumb = f"{jd}/thumb.jpg"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "8.5", "-i", out, "-frames:v", "1", "-q:v", "3", thumb], check=True)
    base = f"video/centering-you/montage-{jid}"
    media, turl = worker.upload(out, f"{base}.mp4", "video/mp4"), worker.upload(thumb, f"{base}.jpg", "image/jpeg")
    cap = (lib.get("approval_items", f"select=caption&id=eq.{ITEM}") or [{}])[0].get("caption") or ""
    title = "Between your visit and her ordinary life (copy of CY29 with music and graphics)"
    r = lib.rpc("montage_file", p_id=jid, p={
        "title": title, "caption": cap, "media_url": media, "thumb_url": turl, "variants": [{"platform": "instagram", "caption": cap}],
        "provenance": {"copy_of": "CY29", "internal_test": "unique-content 2026-10-12", "length_s": round(total, 1), "graphics": [c[1] for c in CALLOUTS],
                       "music": {k: minfo.get(k) for k in ("track_id", "name", "mood", "looped", "duck_db")}},
        "note": "Spark test copy of CY29 (CY29 itself is untouched): a music bed borrowed from the Bestly library, ducked under her voice, and two soft callout cards. "
                "Internal only; nothing sent to Elizabeth."})
    print("filed", r, flush=True)
    json.dump({"item": r, "music": minfo}, open(f"{jd}/cy_result.json", "w"))


if __name__ == "__main__":
    main(sys.argv[1])
