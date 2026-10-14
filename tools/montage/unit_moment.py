"""The Bestly Cloud unit in Montage videos (Jared 2026-10-14, 12:53 AM, standing note on client bestly-cloud):
every Bestly Cloud video must show the 3D render of the Bestly Cloud unit (the box), "or teased a little".

How it is made: tools/montage/unit3d renders the real bestly.tech model (public/models/device-web-split.glb, same lights and camera as the
site's hero) ONCE into transparent WebP frame sequences. They live on the Pi in KIT (/opt/bestly/social-kit/unit3d/<moment>/fNNN.webp + manifest.json).
Every render only composites them (comp/brand: Scene.unit / EndCard.unit), so a video costs nothing extra and the unit always looks the same.

Four moments, ONE per video (variety.py rotates them: never the same as the last Bestly Cloud video):
  reveal   the lid floats off and the camera swings over the open internals (a "split" scene: text on top, the unit below)
  turn     a slow turn of the closed unit under the headline (a "split" scene like reveal: text on top, the unit below, never behind a line)
  glimpse  the closed unit in the bottom-right corner of a scene, half out of frame
  hero     the closing card: the closed unit powers on above the name and the benefit chips

Rule enforced in three places: variety.make_plan always picks a moment for a brand with CFG["unit_moments"]; variety.gate refuses a repeat of the last
video's moment (the gate counts them); worker.check fails a video whose script has no unit moment or whose frames are missing (problems() below).
"""
import json
import os
import shutil

KIT = "/opt/bestly/social-kit/unit3d"
MOMENTS = ("reveal", "turn", "glimpse", "hero")
SKIP_LAYOUTS = ("steps", "card")          # scene templates that already fill the frame


def manifest(kit=KIT):
    try:
        return json.load(open(os.path.join(kit, "manifest.json")))
    except (OSError, ValueError):
        return {}


def available(kit=KIT):
    """Moments with frames on disk (a moment with a missing frame is not offered)."""
    m = manifest(kit)
    out = []
    for k in MOMENTS:
        n = int((m.get(k) or {}).get("count") or 0)
        if n and os.path.exists(os.path.join(kit, k, "f000.webp")) and os.path.exists(os.path.join(kit, k, f"f{n - 1:03d}.webp")):
            out.append(k)
    return out


def spec(moment, kit=KIT):
    m = (manifest(kit).get(moment) or {})
    return {"moment": moment, "dir": f"unit/{moment}", "count": int(m.get("count") or 0), "fps": int(m.get("fps") or 30)}


def s_big(s):
    return bool(s.get("big") or s.get("items"))


def _scene_for(moment, scenes):
    """Index of the scene that carries the moment, or "end" for the closing card."""
    n = len(scenes)
    ok = [i for i, s in enumerate(scenes) if s.get("layout") not in SKIP_LAYOUTS and not s.get("card")]
    if moment == "hero":
        return "end"
    if moment == "reveal":
        return 1 if n > 1 else 0          # the second scene: "what it is" has been said, now show it
    if moment == "turn":
        plain = [i for i in ok if not s_big(scenes[i])]
        return (plain or ok or [0])[0]    # first scene with room (one without a big number / list, which the split layout does not draw)
    # glimpse: a later scene (the third), so the first two stay clean
    later = [i for i in ok if i >= 2] or ok or [min(1, n - 1)]
    return later[0]


def assign(out, moment, kit=KIT):
    """Put the moment on a finished script (in place). Returns {"moment", "scene"} (scene = index or "end")."""
    u = spec(moment, kit)
    if not u["count"]:
        raise RuntimeError(f"no frames for the unit moment '{moment}' in {kit}")
    where = _scene_for(moment, out["scenes"])
    if where == "end":
        out["end"]["unit"] = u
    else:
        out["scenes"][where]["unit"] = u
        if moment in ("reveal", "turn"):
            out["scenes"][where]["layout"] = "split"       # text on top, the unit under the hairline
    out["unit"] = {"moment": moment, "scene": where}
    return out["unit"]


def stage(public_dir, script, kit=KIT):
    """Copy the chosen moment's frames into the job's public folder (Remotion's staticFile). Returns the number of frames."""
    mom = (script.get("unit") or {}).get("moment")
    if not mom:
        return 0
    dst = os.path.join(public_dir, "unit", mom)
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(os.path.join(kit, mom), dst, ignore=shutil.ignore_patterns("*.png", "*.json"))
    return len([f for f in os.listdir(dst) if f.endswith(".webp")])


def problems(script, public_dir, props=None, required=True):
    """Errors for worker.check: a unit-required brand needs exactly one unit moment on a scene or the end card, with all its frames staged,
    and the props handed to the render must carry it."""
    e = []
    if not required:
        return e
    carriers = [("scene %d" % (i + 1), s.get("unit")) for i, s in enumerate(script.get("scenes") or []) if s.get("unit")]
    if (script.get("end") or {}).get("unit"):
        carriers.append(("end card", script["end"]["unit"]))
    if not carriers:
        return ["no Bestly Cloud unit moment in this video (rule of 2026-10-14: every Bestly Cloud video shows the 3D unit: reveal, turn, glimpse or hero)"]
    if len(carriers) > 1:
        e.append("more than one unit moment in one video: " + ", ".join(w for w, _ in carriers))
    where, u = carriers[0]
    if u.get("moment") not in MOMENTS:
        return e + [f"unit moment '{u.get('moment')}' is not one of {', '.join(MOMENTS)}"]
    n = int(u.get("count") or 0)
    d = os.path.join(public_dir, "unit", u["moment"])
    if n < 30 or not os.path.exists(os.path.join(d, "f000.webp")) or not os.path.exists(os.path.join(d, f"f{n - 1:03d}.webp")):
        e.append(f"unit frames for '{u['moment']}' are missing in the render folder")
    if props is not None:
        pc = [s for s in props.get("scenes") or [] if s.get("unit")] + ([props["end"]] if (props.get("end") or {}).get("unit") else [])
        if not pc:
            e.append("the render props lost the unit moment")
    return e
