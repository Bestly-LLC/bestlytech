"""HOKU script writer for Montage (vertical short).

Reuses HOKU Maker's guardrails so a video can never say more than a post can:
- the ABOUT block (the only facts allowed) and the fact-check/editor pass (hoku_maker._review, needs 8/10, 7 as fallback)
- claim_check('hoku') hard + soft rules and hoku_soft_claim_violation on every line, spoken or shown
- code checks: lengths, no questions, no emoji/hashtags/links, no numbers except 4 fl oz
The closing card is fixed in code, like the product card on the carousels.
"""
import json
import random
import re
import sys
import time

sys.path.insert(0, "/opt/bestly/cron")
import freellm  # noqa: E402
import lib  # noqa: E402
import playbook  # noqa: E402  (2026-10-06: content playbook, see playbook.py)
from jobs import brand_maker as bm  # noqa: E402
from jobs import hoku_maker as hm  # noqa: E402

COMPOSITION = "HokuShort"
THEMES = ["paper", "forest", "sage", "gold", "brown"]
END = {"title": "A face mist in a sealed can.", "cta": "Join the waitlist. Link in bio.",
       "say": "HOKU. A face mist in a sealed can. Join the waitlist."}

SYS = """You write the script for one short vertical video (an Instagram Reel) for HOKU. {about}

The video is a few calm text cards. Each card shows one line on screen while a narrator reads a sentence. A fixed
closing card follows (you do not write it).

Brief from the team: {brief}

Write 4 or 5 scenes. Each scene has:
- "kicker": 1 to 3 words shown small above the line on the FIRST scene only (use "" on the others)
- "line": 2 to 9 words shown large on screen. A flat statement that ends with a period.
- "say": 5 to 18 words the narrator reads. Plain spoken English, said once. It can repeat or extend the line.{shot_rule}
All "say" together: 35 to 70 words. One idea, told in order, quietly. No list of features.
"caption": 15 to 60 words of prose for the post. No hashtags, emoji, questions or "link in bio" (added after).
"title": 3 to 8 words naming the video for the team (not shown to viewers).
Reply with ONE JSON object only:
{{"title": "...", "topic": "<1 to 4 words, lowercase>", "scenes": [{{"kicker": "...", "line": "...", "say": "..."{shot_key}}}], "caption": "..."}}"""

SHOT_RULE = """
- "shot": 15 to 45 words describing the moving footage behind this card, for an AI video model: a real place,
  the light, the weather, the camera move, hands or the back of a person at most. Vertical framing. No faces
  looking at the camera, no text, signs, logos or brands, no products, cans, bottles or sprays (the can is only
  ever shown on the closing card). Calm and natural, like quiet documentary b-roll."""

REVISE = """

This is a RE-CUT of an existing video. The reviewer left this change note:
"{note}"
The current script is below. Apply the note and change nothing else: keep the same number of scenes, keep every
line, say and shot that the note does not touch, word for word. Reply with the whole script in the same JSON shape.
Current script:
{script}"""


def _wc(t):
    return len((t or "").split())


def _check(p, broll=False):
    e = []
    scenes = p.get("scenes") or []
    if not 4 <= len(scenes) <= 5:
        e.append(f"write 4 or 5 scenes (got {len(scenes)})")
    total = 0
    for i, s in enumerate(scenes, 1):
        line, say = (s.get("line") or "").strip(), (s.get("say") or "").strip()
        if not 2 <= _wc(line) <= 9:
            e.append(f"scene {i} line is {_wc(line)} words (want 2-9)")
        if not line.endswith("."):
            e.append(f"scene {i} line must end with a period")
        if not 5 <= _wc(say) <= 18:
            e.append(f"scene {i} say is {_wc(say)} words (want 5-18)")
        if i == 1 and not 1 <= _wc(s.get("kicker")) <= 3:
            e.append("scene 1 needs a kicker of 1-3 words")
        if broll and not 15 <= _wc(s.get("shot")) <= 45:
            e.append(f"scene {i} shot is {_wc(s.get('shot'))} words (want 15-45)")
        if broll and re.search(r"\b(can|bottle|spray|logo|brand|label|text|sign|face)s?\b", s.get("shot") or "", re.I):
            e.append(f"scene {i} shot mentions something the footage must not show (cans, bottles, sprays, logos, text, signs, faces)")
        total += _wc(say)
    if scenes and not 35 <= total <= 70:
        e.append(f"all narration together is {total} words (want 35-70)")
    cap = (p.get("caption") or "").strip()
    if not 15 <= _wc(cap) <= 60:
        e.append(f"caption is {_wc(cap)} words (want 15-60)")
    blob = " ".join([cap] + [f"{s.get('kicker') or ''} {s.get('line') or ''} {s.get('say') or ''}" for s in scenes])
    if "?" in blob:
        e.append("no questions anywhere")
    if hm.EMOJI.search(blob) or "#" in blob:
        e.append("no emoji or hashtags anywhere")
    if re.search(r"\d", hm.DIGITS_OK.sub("", blob)):
        e.append("no numbers anywhere (the only number allowed is 4 fl oz)")
    if re.search(r"link in bio|https?://|www\.|\.com\b", blob, re.I):
        e.append("no links or 'link in bio' (it is added after)")
    if e:
        return e
    pieces = [("caption", cap)] + [(f"scene {i}", f"{s.get('kicker') or ''}. {s['line']} {s['say']}") for i, s in enumerate(scenes, 1)]
    for where, t in pieces:
        r = lib.rpc("claim_check", _client_slug="hoku", _text=t, _context="montage") or {}
        if r.get("ok") is False or r.get("severity") == "soft":
            e.append(f"{where} broke the claim rule '{r.get('reason')}' - say it without that")
        v = lib.rpc("hoku_soft_claim_violation", _text=t)
        if v:
            e.append(f"{where} uses a banned word ({v}) - say it without that")
    return e


def _recent():
    rows = lib.get("studio_video_jobs", "select=script&client_slug=eq.hoku&status=eq.done&order=created_at.desc&limit=8") or []
    return [r["script"] for r in rows if r.get("script")]


def _parent_script(job):
    if not job.get("parent_job_id"):
        return None
    rows = lib.get("studio_video_jobs", f"select=script&id=eq.{job['parent_job_id']}") or []
    return rows[0].get("script") if rows else None


def write(job, log):
    """-> script dict: title, topic, theme, scenes[{kicker,line,say,shot?}], end{...}, caption, provider, score."""
    parent = _parent_script(job)
    broll = bool(job.get("broll")) or bool(parent and any(sc.get("shot") for sc in parent.get("scenes", [])))
    recent = _recent()
    used_themes = [r.get("theme") for r in recent[:2]]
    theme = parent["theme"] if parent else random.choice([t for t in THEMES if t not in used_themes] or THEMES)
    lessons = bm._lessons("hoku")
    user = ("Earlier HOKU videos (do not repeat their ideas or lines):\n"
            + "\n".join(f"- {r.get('title')}: {' / '.join(s.get('line', '') for s in r.get('scenes', []))}" for r in recent)
            + ("\n\nWhat we have learned from HOKU posts:\n" + "\n".join(f"- {l}" for l in lessons[:5]) if lessons else ""))
    system = SYS.format(about=hm.ABOUT, brief=job["brief"], shot_rule=SHOT_RULE if broll else "",
                        shot_key=', "shot": "..."' if broll else "")
    if parent:
        keep = {"title": parent.get("title"), "topic": parent.get("topic"),
                "caption": (parent.get("caption") or "").replace("\n\n" + hm.TAIL, ""),
                "scenes": [{k: sc.get(k, "") for k in (("kicker", "line", "say", "shot") if broll else ("kicker", "line", "say"))}
                           for sc in parent.get("scenes", [])]}
        system += REVISE.format(note=job.get("revise_note") or "", script=json.dumps(keep, indent=1, ensure_ascii=False))
        user = "Re-cut it now."
    msgs = [{"role": "system", "content": playbook.add(system)},
            {"role": "user", "content": user or "This is the first HOKU video."}]
    deadline = time.time() + 900
    near, tries = None, []
    for attempt in range(1, 5):
        msg, prov = freellm.chat(msgs, None, max_tokens=3000, deadline=deadline, json_mode=True)
        try:
            p = bm._json(msg.get("content"))
            errs, score = _check(p, broll), 0.0
            if not errs:
                errs, score = hm._review({"scenes": p.get("scenes"), "caption": p.get("caption")}, deadline)
                if errs and all(x.startswith("editor") for x in errs) and score >= 7 and (not near or score > near[1]):
                    near = (p, score, prov)
        except (ValueError, TypeError, KeyError, AttributeError) as ex:
            p, errs, score = None, [f"reply was not the JSON asked for ({ex})"], 0.0
        tries.append(f"try {attempt} ({prov}): {'; '.join(errs)[:300] or 'ok'}")
        log(f"script try {attempt} via {prov}: {'ok' if not errs else '; '.join(errs)[:200]}")
        if not errs:
            return _finish(p, theme, prov, score, broll)
        msgs += [{"role": "assistant", "content": (msg.get("content") or "")[:4000]},
                 {"role": "user", "content": "Fix these and reply with the JSON only: " + "; ".join(errs)}]
    if near:
        return _finish(near[0], theme, near[2], near[1], broll)
    raise RuntimeError("script failed the HOKU rules 4 times: " + " || ".join(tries)[:900])


def _finish(p, theme, prov, score, broll=False):
    scenes = [{"kicker": (s.get("kicker") or "").strip() if i == 0 else "",
               "line": s["line"].strip().replace("4 fl oz", "4 fl oz"),
               "say": s["say"].strip(),
               **({"shot": (s.get("shot") or "").strip()} if broll else {})} for i, s in enumerate(p["scenes"])]
    return {"title": p.get("title") or scenes[0]["line"], "topic": p.get("topic"), "theme": theme, "scenes": scenes,
            "end": dict(END), "caption": p["caption"].strip() + "\n\n" + hm.TAIL, "provider": prov, "score": score}


ASSETS = {  # files copied into each job's public/ folder
    "fonts/newsreader.woff2": "/opt/bestly/hoku-kit/fonts/newsreader.woff2",
    "fonts/inter-400.woff2": "/opt/bestly/hoku-kit/fonts/inter-400.woff2",
    "fonts/inter-600.woff2": "/opt/bestly/hoku-kit/fonts/inter-600.woff2",
    "lockup.webp": "/opt/bestly/hoku-kit/lockup.webp",
    "lockup_w.webp": "/opt/bestly/hoku-kit/lockup_w.webp",
    **{f"art/hoku-can-{t}.png": f"/opt/bestly/hoku-kit/art/hoku-can-{t}.png" for t in THEMES},
}
VOICE = {"model": "en_US-hfc_female-medium", "length_scale": 1.08}
# added to every LTX shot so the clips feel like one film
SHOT_STYLE = ("Vertical 9:16 documentary b-roll, natural light, soft background, gentle handheld camera, calm, "
              "warm muted colors, no text, no logos, no people facing the camera.")
