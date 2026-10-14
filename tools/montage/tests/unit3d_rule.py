#!/usr/bin/env python3
"""Test for the Bestly Cloud 3D unit rule (2026-10-14). Run on the Pi: [MONTAGE_DIR=/dev/copy] python3 /opt/bestly/montage/tests/unit3d_rule.py [props_dir]
Spends nothing, files nothing, writes nothing to the database (reads the look ledger only).
  1. rotation: pick_unit never repeats the last video's moment and shows all four within eight videos
  2. assign: one carrier per moment, in the right place (reveal = scene 2 forced to split, turn/glimpse = a scene with room, hero = closing card)
  3. gate: a plan that repeats the last moment is a miss
  4. check: unit_moment.problems() fails a video with no unit, with missing frames, with two units; passes a good one
  5. writes props_unit_<moment>.json (+ stages frames in <props_dir>/public) so stills can be rendered in the dev harness
"""
import copy
import json
import os
import shutil
import sys

MD = os.environ.get("MONTAGE_DIR", "/opt/bestly/montage")      # a dev copy of the code can be tested before it is deployed
sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, MD)
import variety  # noqa: E402
import unit_moment  # noqa: E402
from brands import bestly_cloud as bc  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "/mnt/ssd/montage/dev/pub_unit"
fails = []


def ok(cond, what):
    print(("PASS " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)


SCENES = [
    {"kicker": "Private cloud", "line": "One box holds your files and tools.", "start": 0, "end": 6, "icon": "box", "layout": "stack"},
    {"line": "Your data stays on your own hardware.", "start": 6, "end": 12, "icon": "files", "layout": "stat", "big": "One box"},
    {"line": "No per-seat fees, one account each.", "start": 12, "end": 18, "icon": "tag", "layout": "steps", "items": ["Files", "Calendar", "Chat"]},
    {"line": "You can export your files.", "start": 18, "end": 24, "icon": "check", "layout": "center"},
    {"line": "Built for small teams.", "start": 24, "end": 30, "icon": "people", "layout": "split"},
]


def script():
    e = copy.deepcopy(bc.END)
    e.update({"start": 30.0, "end": 38.0, "layout": "list"})
    e.pop("say", None)
    return {"theme": "night", "scenes": copy.deepcopy(SCENES), "end": e, "title": "t", "caption": "c"}


# 1. rotation (the ledger is stubbed: each new video is "filed" at the top)
hist, seq = [], []
variety._recent = lambda brand, n, exclude_item=None: [{"fingerprint": {"unit": u}} for u in hist[:n]]
for _ in range(16):
    u = variety.pick_unit(bc.CFG, variety._recent("bestly-cloud", 8))
    seq.append(u)
    hist.insert(0, u)
ok(all(a != b for a, b in zip(seq, seq[1:])), f"never the same moment twice in a row: {' '.join(seq)}")
ok(all(len(set(seq[i:i + 4])) == 4 for i in range(0, 13)), "every window of four videos shows all four moments")
ok(variety.pick_unit(bc.CFG, [], "turn") == "turn", "a forced moment ([look:unit=turn]) is honoured")

# 2. assign
for mom in unit_moment.MOMENTS:
    s = script()
    w = unit_moment.assign(s, mom, bc.UNIT_KIT)
    carriers = [i for i, x in enumerate(s["scenes"]) if x.get("unit")] + (["end"] if s["end"].get("unit") else [])
    ok(len(carriers) == 1 and carriers == [w["scene"]], f"{mom}: one carrier {carriers}")
    if mom == "reveal":
        ok(carriers == [1] and s["scenes"][1]["layout"] == "split", "reveal: scene 2, forced to the split layout")
    if mom in ("turn", "glimpse"):
        ok(s["scenes"][carriers[0]]["layout"] not in unit_moment.SKIP_LAYOUTS, f"{mom}: not on a steps/card scene (scene {carriers[0] + 1})")
    if mom == "hero":
        ok(carriers == ["end"], "hero: closing card")

# 3. gate: a repeat of the last video's moment is a miss
plan = {"layout": "L1", "hook": "problem", "accent": "night/#8b9bf0", "end": "list", "icon": "orbit", "unit": "turn"}
variety._recent = lambda brand, n, exclude_item=None: [{"job_id": "x", "item_code": "BC99", "fingerprint": {"unit": "turn", "layout": "L2", "hook": "story", "accent": "night/#f2a07b", "end": "qa", "icon": "badge"}, "opening": "x"}]
good, why, _, _ = variety.gate(bc.CFG, {}, plan, {"scenes": [{"line": "Something totally different here.", "say": "x"}]}, opening_check=False)
ok(not good and "repeats" in why, f"gate refuses a repeated moment ({why[:80]})")
plan["unit"] = "hero"
good, why, _, _ = variety.gate(bc.CFG, {}, plan, {"scenes": [{"line": "Something totally different here.", "say": "x"}]}, opening_check=False)
ok(good, f"gate passes a different moment ({why[:80]})")

# 4. check
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(f"{OUT}/public", exist_ok=True)
s = script()
ok(bool(unit_moment.problems(s, f"{OUT}/public")), "a Bestly Cloud video with NO unit moment fails the check")
unit_moment.assign(s, "glimpse", bc.UNIT_KIT)
ok(bool(unit_moment.problems(s, f"{OUT}/public")), "unit moment but frames not staged fails the check")
n = unit_moment.stage(f"{OUT}/public", s, bc.UNIT_KIT)
ok(n >= 30 and not unit_moment.problems(s, f"{OUT}/public"), f"staged {n} frames: check passes")
s2 = copy.deepcopy(s)
s2["end"]["unit"] = unit_moment.spec("hero", bc.UNIT_KIT)
ok(any("more than one" in x for x in unit_moment.problems(s2, f"{OUT}/public")), "two unit moments in one video fail the check")
ok(unit_moment.problems(script(), f"{OUT}/public", required=False) == [], "a brand that does not need the unit is never failed")

# 5. props for stills
for mom in unit_moment.MOMENTS:
    s = script()
    unit_moment.assign(s, mom, bc.UNIT_KIT)
    unit_moment.stage(f"{OUT}/public", s, bc.UNIT_KIT)
    for rel, src in bc.ASSETS.items():
        os.makedirs(os.path.dirname(f"{OUT}/public/{rel}"), exist_ok=True)
        shutil.copy(src, f"{OUT}/public/{rel}")
    props = {"theme": "night", "scenes": [{k: x[k] for k in ("kicker", "line", "start", "end", "icon", "layout", "big", "items", "unit") if x.get(k)} for x in s["scenes"]],
             "end": {k: v for k, v in s["end"].items() if k != "say"}, "audio": {}, "brand": bc.BRAND, "look": {"iconStyle": "orbit"}}
    json.dump(props, open(f"{OUT}/props_unit_{mom}.json", "w"))
    print("wrote", f"{OUT}/props_unit_{mom}.json", s["unit"])
print("FAILED: " + "; ".join(fails) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
