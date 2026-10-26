"""House gate: the media half (Spark, 2026-10-26).

Jared: "Bestly, HOKU, Cookie Yeti and IP should be autoposting, I shouldn't be approving anything."
The database half is house_gate_check()/house_gate_run() (supabase/migrations/20261026170000_house_autopost_gate.sql).
This job looks at the actual pictures and videos, because only the Pi can open them, and writes what it found to
house_gate_media. No AI, no paid calls: ffmpeg + tesseract + PIL + numpy only.

For each pending house item that has no media row for its current content_version:
  - the file opens and is a real image/video (a dead link is a fail)
  - video: has a music bed (mean volume above -38 dB), is not dark or blank, text sits inside the app-safe box
    (x 60-900, y 250-1440 on 1080x1920: studio/rule-safe-zones-2026-10-18)
  - stills and carousel slides: body text is big enough to read on a phone
  - perceptual hashes (64-bit dHash): 3 keyframes of a video, every slide of a carousel, plus the end card
Also hashes the brand's last posted pictures, a few per run, so "same picture as an earlier post" can see them.

Face overlap (studio/rule-no-text-on-faces-2026-10-19) is NOT checked here: the Pi has no face detector.
Montage's own render check owns it, so the facts say face_check "renderer".

Usage: house_gate_media [--dry] [--probe URL] [--limit N]
  --dry   print what it would write, change nothing
  --probe analyze one image/video URL and print the numbers (used to calibrate thresholds)
Cron: every 5 minutes, offset ahead of the database run (pg_cron house-gate-run at minute 2 of every 5).
Off switch: touch /opt/bestly/cron/state/house_gate_media.OFF   (the gate then waits; nothing is approved without it)
"""
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lib  # noqa: E402

STATE = "/opt/bestly/cron/state"
SAFE = (60, 250, 900, 1440)          # x0, y0, x1, y1 on 1080x1920
TOL = 8                              # px of slack on the safe box
MIN_MUSIC_DB = -38.0                 # a real bed; the old synthesized pad sat far below this
MIN_TEXT_PX = 30                     # 25th-percentile word height, on a 1080-wide image (calibrated 2026-10-26)
DEADLINE_S = 240
UA = {"User-Agent": "Mozilla/5.0 (bestly-house-gate)"}


def _run(cmd, timeout=60):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def fetch(url, dest, limit=120 * 1024 * 1024):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r, open(dest, "wb") as f:
        n = 0
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            n += len(b)
            if n > limit:
                raise RuntimeError("file too large")
            f.write(b)
    return n


def dhash(img):
    g = img.convert("L").resize((9, 8), Image.LANCZOS)
    a = np.asarray(g, dtype=np.int16)
    bits = (a[:, 1:] > a[:, :-1]).flatten()
    n = 0
    for b in bits:
        n = (n << 1) | int(b)
    return f"{n:016x}"


def luma(img):
    a = np.asarray(img.convert("L").resize((96, 96)), dtype=np.float32)
    return float(a.mean()), float(a.std())


def ocr(path):
    """Words tesseract is confident about: [{t, conf, x, y, w, h}] in the image's own pixels."""
    r = _run(["tesseract", path, "stdout", "--psm", "11", "-l", "eng", "tsv"], timeout=60)
    if r.returncode != 0:
        raise RuntimeError("tesseract failed: " + r.stderr[-200:])
    out = []
    for line in r.stdout.splitlines()[1:]:
        p = line.split("\t")
        if len(p) < 12 or not p[11].strip():
            continue
        try:
            conf = float(p[10])
        except ValueError:
            continue
        t = p[11].strip()
        if conf < 65 or len(re.sub(r"[^A-Za-z0-9]", "", t)) < 3:
            continue
        out.append({"t": t, "conf": conf, "x": int(p[6]), "y": int(p[7]), "w": int(p[8]), "h": int(p[9])})
    return out


def text_px(words, width):
    """25th percentile word height, scaled to a 1080-wide image. None when there is too little text to judge."""
    hs = [w["h"] * 1080.0 / width for w in words]
    if len(hs) < 6:
        return None
    hs.sort()
    return round(hs[len(hs) // 4], 1)


def frame_at(video, t, dest):
    r = _run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", dest], timeout=40)
    return r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 0


def video_checks(path, work):
    reasons, facts = [], {}
    pr = _run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path])
    info = json.loads(pr.stdout or "{}")
    vs = [s for s in info.get("streams", []) if s.get("codec_type") == "video"]
    au = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if not vs:
        return [{"k": "media", "t": "The video file has no picture"}], {}, [], None
    w, h = int(vs[0].get("width", 0)), int(vs[0].get("height", 0))
    dur = float(info.get("format", {}).get("duration") or vs[0].get("duration") or 0)
    facts.update({"w": w, "h": h, "dur": round(dur, 1), "has_audio": bool(au), "face_check": "renderer"})
    if dur < 3:
        reasons.append({"k": "media", "t": f"The video is only {dur:.1f} seconds long"})
        return reasons, facts, [], None
    # music bed
    if not au:
        reasons.append({"k": "audio", "t": "The video has no music bed (no audio track)"})
    else:
        vd = _run(["ffmpeg", "-v", "info", "-i", path, "-af", "volumedetect", "-vn", "-f", "null", "-"], timeout=90)
        m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", vd.stderr)
        mx = re.search(r"max_volume:\s*(-?[\d.]+) dB", vd.stderr)
        if m:
            facts["mean_db"] = float(m.group(1))
            facts["max_db"] = float(mx.group(1)) if mx else None
            if facts["mean_db"] < MIN_MUSIC_DB:
                reasons.append({"k": "audio", "t": f"The music bed is near silent ({facts['mean_db']:.0f} dB)"})
    # frames
    fr = {}
    for name, t in (("a", dur * 0.12), ("b", dur * 0.30), ("c", dur * 0.50), ("d", dur * 0.70), ("e", dur * 0.88), ("end", max(0.0, dur - 0.35))):
        dest = os.path.join(work, f"f_{name}.png")
        if frame_at(path, t, dest):
            fr[name] = (t, dest)
    if len(fr) < 4:
        reasons.append({"k": "media", "t": "Could not read frames from the video"})
        return reasons, facts, [], None
    imgs = {k: Image.open(v[1]).convert("RGB") for k, v in fr.items()}
    dark = sum(1 for k in ("b", "c", "d") if k in imgs and luma(imgs[k])[0] < 10)
    facts["dark_frames"] = dark
    if dark >= 2:
        reasons.append({"k": "blank", "t": "The video is dark or blank for most of its length"})
    hashes = [dhash(imgs[k]) for k in ("b", "c", "d") if k in imgs]
    endcard = dhash(imgs["end"]) if "end" in imgs else None
    # text inside the safe box
    sx, sy = w / 1080.0, h / 1920.0
    viol_frames, sizes, per = 0, [], []
    for k in ("b", "c", "d", "e", "end"):
        if k not in fr:
            continue
        try:
            words = ocr(fr[k][1])
        except Exception as e:  # noqa: BLE001  fail open: a broken OCR must not kill good posts
            facts["ocr_error"] = str(e)[:120]
            continue
        bad = []
        for wd in words:
            x0, y0, x1, y1 = wd["x"], wd["y"], wd["x"] + wd["w"], wd["y"] + wd["h"]
            if x0 < (SAFE[0] - TOL) * sx or x1 > (SAFE[2] + TOL) * sx or y0 < (SAFE[1] - TOL) * sy or y1 > (SAFE[3] + TOL) * sy:
                bad.append(wd["t"])
        sz = text_px(words, w)
        if sz:
            sizes.append(sz)
        per.append({"f": k, "words": len(words), "outside": bad[:6]})
        if len(bad) >= 2:
            viol_frames += 1
    facts["ocr"] = per
    if sizes:
        facts["text_px_p25"] = round(statistics.median(sizes), 1)
    if viol_frames:
        ex = next((p["outside"] for p in per if len(p["outside"]) >= 2), [])
        reasons.append({"k": "safe_zone", "t": "Text sits under the Instagram/TikTok buttons or tabs (outside the safe box): " + ", ".join(ex[:4])})
    return reasons, facts, hashes, endcard


def still_checks(paths, work):
    """paths: local image files, slide order."""
    reasons, facts, hashes, sizes, per = [], {}, [], [], []
    for i, p in enumerate(paths[:8]):
        try:
            im = Image.open(p)
            im.load()
        except Exception:  # noqa: BLE001
            reasons.append({"k": "media", "t": f"Slide {i + 1} is missing or is not a real image" if len(paths) > 1 else "The image is missing or is not a real image"})
            continue
        im = im.convert("RGB")
        if im.width < 600:
            reasons.append({"k": "media", "t": f"Image is only {im.width}px wide"})
        hashes.append(dhash(im))
        try:
            words = ocr(p)
        except Exception as e:  # noqa: BLE001
            facts["ocr_error"] = str(e)[:120]
            continue
        sz = text_px(words, im.width)
        per.append({"slide": i + 1, "words": len(words), "text_px_p25": sz})
        if sz:
            sizes.append(sz)
    facts["slides"] = per
    if sizes:
        facts["text_px_p25"] = round(min(sizes), 1)
        if min(sizes) < MIN_TEXT_PX:
            small = [d["slide"] for d in per if d["text_px_p25"] and d["text_px_p25"] < MIN_TEXT_PX]
            reasons.append({"k": "text_size", "t": f"Body text is too small to read on a phone (about {min(sizes):.0f}px, needs {MIN_TEXT_PX}+)"
                            + (f" on slide {', '.join(map(str, small[:4]))}" if len(paths) > 1 else "")})
    return reasons, facts, hashes, None


def analyze(it, work):
    """-> (ok, reasons, hashes, endcard, facts)"""
    mt = it.get("media_type")
    urls = [u for u in (it.get("slides") or []) if u] if mt == "carousel" else [it.get("media_url")]
    if not urls or not urls[0]:
        return False, [{"k": "media", "t": "No media on the post"}], [], None, {}
    paths = []
    for i, u in enumerate(urls):
        dest = os.path.join(work, f"m{i}")
        try:
            n = fetch(u, dest)
            if n < 2000:
                raise RuntimeError("tiny file")
            paths.append(dest)
        except Exception as e:  # noqa: BLE001
            return False, [{"k": "media", "t": f"The media file is missing or will not download ({str(e)[:60]})"}], [], None, {}
    if mt == "video":
        reasons, facts, hashes, endcard = video_checks(paths[0], work)
    else:
        reasons, facts, hashes, endcard = still_checks(paths, work)
    return (not reasons), reasons, hashes, endcard, facts


def hash_post(p, work):
    dest = os.path.join(work, "p")
    fetch(p["url"], dest)
    try:
        im = Image.open(dest)
        im.load()
    except Exception:  # noqa: BLE001
        fr = os.path.join(work, "p.png")
        if not frame_at(dest, 1.0, fr):
            return []
        im = Image.open(fr)
    return [dhash(im.convert("RGB"))]


def main(argv):
    dry = "--dry" in argv
    if os.path.exists(f"{STATE}/house_gate_media.OFF"):
        return "skip: house_gate_media.OFF is set (the gate waits; nothing is approved without media checks)"
    limit = 6
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])
    t0 = time.time()
    if "--probe" in argv:
        url = argv[argv.index("--probe") + 1]
        work = tempfile.mkdtemp(prefix="hgm-")
        try:
            kind = "video" if re.search(r"\.(mp4|mov|webm)(\?|$)", url, re.I) else "image"
            ok, reasons, hashes, endcard, facts = analyze({"media_type": kind, "media_url": url}, work)
            print(json.dumps({"ok": ok, "reasons": reasons, "hashes": hashes, "facts": facts}, indent=1))
        finally:
            shutil.rmtree(work, ignore_errors=True)
        return "ok probe done"

    todo = lib.rpc("house_gate_todo", p_limit=limit) or {}
    items, posts = todo.get("items") or [], todo.get("posts") or []
    done, fails, lines = 0, 0, []
    for it in items:
        if time.time() - t0 > DEADLINE_S:
            break
        work = tempfile.mkdtemp(prefix="hgm-")
        try:
            ok, reasons, hashes, endcard, facts = analyze(it, work)
        except Exception as e:  # noqa: BLE001  one bad file must not stop the rest
            lines.append(f"{it['code']}: error {type(e).__name__}: {str(e)[:100]}")
            continue
        finally:
            shutil.rmtree(work, ignore_errors=True)
        lines.append(f"{it['code']}: {'ok' if ok else 'FAIL ' + '; '.join(r['t'] for r in reasons)[:160]}")
        if dry:
            print(json.dumps({"code": it["code"], "ok": ok, "reasons": reasons, "facts": facts, "hashes": hashes}))
            continue
        lib.rpc("house_gate_media_put", p_item=it["id"], p_version=it["content_version"], p_ok=ok, p_reasons=reasons,
                p_hashes=hashes, p_endcard=endcard, p_facts=facts)
        done += 1
        fails += 0 if ok else 1
    hp = 0
    for p in posts:
        if time.time() - t0 > DEADLINE_S:
            break
        work = tempfile.mkdtemp(prefix="hgp-")
        try:
            h = hash_post(p, work)
        except Exception:  # noqa: BLE001
            h = []
        finally:
            shutil.rmtree(work, ignore_errors=True)
        if not dry:
            lib.rpc("house_gate_post_hash_put", p_post=p["id"], p_brand=p["brand"], p_hashes=h)
        hp += 1
    if not items and not posts:
        return "nothing waiting for a media check"
    return f"ok {done} item(s) checked ({fails} failed a media rule), {hp} past post(s) hashed :: " + " | ".join(lines)[:900]
