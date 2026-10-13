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
import variety  # noqa: E402  (2026-10-12: unique-content system)
from jobs import brand_maker as bm  # noqa: E402
from jobs import hoku_maker as hm  # noqa: E402

COMPOSITION = "HokuShort"
MOOD = "warm"      # music bed when the script has no mood (music.py); HOKU writes its own script, so this is its mood
THEMES = ["paper", "forest", "sage", "gold", "brown"]
END = {"title": "A face mist in a sealed can.", "cta": "Join the waitlist. Link in bio.",
       "say": "HOKU. A face mist in a sealed can. Join the waitlist."}

# The variety engine's view of HOKU (variety.py). HOKU stays calm: no question openings, only plain counts as a bold-count opening; accents are
# earthy and picked per ground so the line always reads. The comment question is the one question allowed (it is in the caption, not the video).
VCFG = {"slug": "hoku", "name": "HOKU", "hooks": ("problem", "story", "myth", "stat"), "tail": hm.TAIL, "allow_numbers": False, "end_layouts": ("claim", "list"),
        "stat_hint": 'for example "One can." or "Three ingredients."; only plain counts the about block supports',
        "accents": {"paper": ["#8A6A34", "#4A5742", "#7A4B2E"], "forest": ["#CBA76C", "#A9C4A0", "#E0B79A"],
                    "sage": ["#33463A", "#5A3E2A", "#3E4A2A"], "gold": ["#4A3A18", "#2F3A2A", "#5A2E22"], "brown": ["#D9B683", "#BFD0B5", "#F0CFB0"]}}

SYS = """You write the script for one short vertical video (an Instagram Reel) for HOKU. {about}

The video is a few calm text cards. Each card shows one line on screen while a narrator reads a sentence. A fixed
closing card follows (you do not write it).

Brief from the team: {brief}
{variety}
Write 4 or 5 scenes. Each scene has:
- "kicker": 1 to 3 words shown small above the line on the FIRST scene only (use "" on the others)
- "line": 2 to 9 words shown large on screen. A flat statement that ends with a period.
- "say": 5 to 18 words the narrator reads (scene 1 may use up to 24). Plain spoken English, said once. It can repeat or extend the line.{shot_rule}
All "say" together: 35 to 76 words. One idea, told in order, quietly. No list of features.
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


def _check(p, broll=False, plan=None):
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
        if not 5 <= _wc(say) <= (24 if i == 1 and plan else 18):
            e.append(f"scene {i} say is {_wc(say)} words (want 5-{24 if i == 1 and plan else 18})")
        if i == 1 and not 1 <= _wc(s.get("kicker")) <= 3:
            e.append("scene 1 needs a kicker of 1-3 words")
        if broll and not 15 <= _wc(s.get("shot")) <= 45:
            e.append(f"scene {i} shot is {_wc(s.get('shot'))} words (want 15-45)")
        if broll and re.search(r"\b(can|bottle|spray|logo|brand|label|text|sign|face)s?\b", s.get("shot") or "", re.I):
            e.append(f"scene {i} shot mentions something the footage must not show (cans, bottles, sprays, logos, text, signs, faces)")
        total += _wc(say)
    if scenes and not 35 <= total <= (76 if plan else 70):
        e.append(f"all narration together is {total} words (want 35-{76 if plan else 70})")
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
    if plan:
        e += variety.check(VCFG, plan, p, len(scenes))
    if e:
        return e
    pieces = [("caption", cap)] + [(f"scene {i}", f"{s.get('kicker') or ''}. {s['line']} {s['say']}") for i, s in enumerate(scenes, 1)]
    if plan:
        pieces += variety.extra_pieces(plan, p)
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
    """-> script dict: title, topic, theme, scenes[{kicker,line,say,shot?,layout,big?,items?}], end{...}, caption, look{...}, provider, score.
    2026-10-12 (unique content): a look is planned (variety.make_plan), the script is written under it and must pass the duplicate gate; two
    re-rolls, then variety.VarietyHold (the worker holds the job and Spark alerts, info, no push)."""
    job = dict(job)
    forced = variety.parse_look(job.get("brief"), job.get("revise_note"))
    job["brief"], job["revise_note"] = variety.strip_look(job.get("brief")), variety.strip_look(job.get("revise_note"))
    parent = _parent_script(job)
    recent = _recent()
    used_themes = [r.get("theme") for r in recent[:2]]
    theme = parent["theme"] if parent else random.choice([t for t in THEMES if t not in used_themes] or THEMES)
    claims = lambda pieces: _claims(pieces)  # noqa: E731
    series = variety.series_for(VCFG, job, parent, log)
    tease = variety.tease_for(VCFG, series, claims, log)
    if series and series.get("planned_left", 9) < 2:
        variety._series_alert("hoku", f"HOKU has {series.get('planned_left')} planned topic(s) left after '{series.get('label')} {series.get('ep')}'. "
                              "Add more rows to studio_series_topics so the Next: tease stays real.")
    tried, why = [], ""
    for roll in range(3):
        plan = variety.make_plan(VCFG, job, theme, (parent or {}).get("look"), forced if roll == 0 else {}, tried)
        out, p, core = _write_once(job, log, parent, theme, plan, series, recent)
        ok, why, opening, fp = variety.gate(VCFG, job, plan, out)
        log(f"look: layout {plan['layout']}, hook {plan['hook']}, end {plan['end']}, accent {plan['accent']}, segment "
            f"{(plan.get('segment') or {}).get('key')}; gate {'ok' if ok else 'MISS: ' + why[:160]}")
        if ok:
            variety.decorate(VCFG, out, plan, series, tease, p, core)
            if (out["look"].get("series") or {}).get("ep") and p.get("topic"):
                try:
                    lib.rpc("studio_series_topic_set", p_job=job["id"], p_topic=str(p.get("topic"))[:80])
                except Exception as e:  # noqa: BLE001
                    log(f"series topic skipped: {str(e)[:100]}")
            variety.record(VCFG, job, plan, fp, opening, series)
            return out
        tried.append(plan["key"])
    raise variety.VarietyHold(f"HOKU: still too close to recent videos after 2 re-rolls ({why[:300]})")


def _claims(pieces):
    """HOKU claim rules on extra text (tease topic, comment question, big words, steps, recap): -> list of problems."""
    e = []
    for where, t in pieces:
        r = lib.rpc("claim_check", _client_slug="hoku", _text=t, _context="montage") or {}
        if r.get("ok") is False or r.get("severity") == "soft":
            e.append(f"{where} broke the claim rule '{r.get('reason')}'")
        v = lib.rpc("hoku_soft_claim_violation", _text=t)
        if v:
            e.append(f"{where} uses a banned word ({v})")
    return e


def _write_once(job, log, parent, theme, plan, series, recent):
    broll = bool(job.get("broll")) or bool(parent and any(sc.get("shot") for sc in parent.get("scenes", [])))
    lessons = bm._lessons("hoku")
    user = ("Earlier HOKU videos (do not repeat their ideas or lines):\n"
            + "\n".join(f"- {r.get('title')}: {' / '.join(s.get('line', '') for s in r.get('scenes', []))}" for r in recent)
            + ("\n\nWhat we have learned from HOKU posts:\n" + "\n".join(f"- {l}" for l in lessons[:5]) if lessons else ""))
    system = SYS.format(about=hm.ABOUT, brief=job["brief"], shot_rule=SHOT_RULE if broll else "",
                        shot_key=', "shot": "..."' if broll else "", variety=variety.prompt_block(VCFG, plan, series))
    if parent:
        keep = {"title": parent.get("title"), "topic": parent.get("topic"),
                "caption": (parent.get("caption_core") or (parent.get("caption") or "").replace("\n\n" + hm.TAIL, "")),
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
            errs, score = _check(p, broll, plan), 0.0
            if not errs:
                errs, score = hm._review({"scenes": p.get("scenes"), "caption": p.get("caption")}, deadline)
                if errs and all(x.startswith("editor") for x in errs) and score >= 7 and (not near or score > near[1]):
                    near = (p, score, prov)
        except (ValueError, TypeError, KeyError, AttributeError) as ex:
            p, errs, score = None, [f"reply was not the JSON asked for ({ex})"], 0.0
        tries.append(f"try {attempt} ({prov}): {'; '.join(errs)[:300] or 'ok'}")
        log(f"script try {attempt} via {prov}: {'ok' if not errs else '; '.join(errs)[:200]}")
        if not errs:
            return _finish(p, theme, prov, score, broll), p, (p["caption"] or "").strip()
        msgs += [{"role": "assistant", "content": (msg.get("content") or "")[:4000]},
                 {"role": "user", "content": "Fix these and reply with the JSON only: " + "; ".join(errs)}]
    if near:
        return _finish(near[0], theme, near[2], near[1], broll), near[0], (near[0]["caption"] or "").strip()
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
VOICE = {"model": "en_US-hfc_female-medium", "length_scale": 1.08}  # Piper: the automatic backup
VOICE_11 = {"voice_id": "pFZP5JQG7iQjIQuC4Bku", "name": "Lily", "stability": 0.6, "similarity_boost": 0.75, "style": 0.0, "speed": 0.95}  # ElevenLabs Lily: velvety, calm, warm (premade)
# added to every LTX shot so the clips feel like one film
SHOT_STYLE = ("Vertical 9:16 documentary b-roll, natural light, soft background, gentle handheld camera, calm, "
              "warm muted colors, no text, no logos, no people facing the camera.")
