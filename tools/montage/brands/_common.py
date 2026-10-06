"""Shared script writer for the Montage brands other than HOKU (HOKU keeps its own, hoku.py).

A brand module (brands/inventoryproof.py, cookie_yeti.py, bestly_cloud.py) holds only data: the facts, the closing card,
the palettes and the b-roll look. Everything that makes a video safe lives here, so a video can never say more than the
brand's daily posts can:
- the brand's ABOUT block is the only source of facts; a fact-check/editor pass reads every line (needs 8/10, 7 as fallback)
- claim_check(<brand's claim slug>) hard + soft rules on every line, spoken or shown (a client with no rules yet comes back
  as severity 'setup': that means house rules only, not a failure)
- code checks: lengths, no questions, no emoji/hashtags/links, no numerals, no stats/prices/bait phrases, the product is
  never named in the scenes (the fixed closing card and the last caption paragraph name it)
- numbers stay glued to their unit (no-break space), so "two years" never wraps as "two / years"
The closing card is fixed in code, like the product card on the daily carousels.
"""
import json
import random
import re
import sys
import time

sys.path.insert(0, "/opt/bestly/cron")
import freellm  # noqa: E402
import lib  # noqa: E402
from jobs import brand_maker as bm  # noqa: E402

NBSP = " "
EMOJI = bm.EMOJI
STATS, PRICE = bm.STATS, bm.PRICE
BAIT = re.compile(r"\b(did you know|here'?s the thing|let'?s dive in|swipe|link in bio|comment below|tag a friend)\b", re.I)
NUMWORD = r"(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million)"

SYS = """You write the script for one short vertical video (an Instagram Reel) for {name}. {about}

The video is a few calm text cards. Each card shows one line on screen while a narrator reads a sentence. A fixed
closing card follows (you do not write it, and only it names {name}).

Brief from the team: {brief}

Write 4 or 5 scenes. Each scene has:
- "kicker": 1 to 3 words shown small above the line on the FIRST scene only (use "" on the others)
- "line": 2 to 9 words shown large on screen. A flat statement that ends with a period.
- "say": 5 to 18 words the narrator reads. Plain spoken English, said once. It can repeat or extend the line.{shot_rule}
All "say" together: 35 to 70 words. One idea, told in order, quietly. Useful to someone who never installs or buys anything.
Speak to the viewer ("you"); never say "we" and never describe what {name} does inside the scenes. Do not name {name} in any scene.
In the caption's last paragraph say only what the facts above say {name} does; invent no feature, promise or result. No statistics, prices, percentages or numerals (write any number as a word).
Write only what is true and verifiable; if unsure, say less. American English spelling.
"caption": 25 to 70 words of prose for the post, two or three short paragraphs. {name} appears only in the LAST paragraph,
once, answering the idea the video told. No hashtags, emoji, questions or "link in bio".
"title": 3 to 8 words naming the video for the team (not shown to viewers).
Reply with ONE JSON object only:
{{"title": "...", "topic": "<1 to 4 words, lowercase>", "scenes": [{{"kicker": "...", "line": "...", "say": "..."{shot_key}}}], "caption": "..."}}"""

SHOT_RULE = """
- "shot": 15 to 45 words describing the moving footage behind this card, for an AI video model: a real place,
  the light, the camera move, hands or the back of a person at most. Vertical framing. {shot_brand} No faces looking
  at the camera, no text, signs, logos or brands, no invented app screens, websites or user interfaces; a phone or laptop
  may only appear as a dark silhouette with a blank screen. Calm and natural, like quiet documentary b-roll."""

REVISE = """

This is a RE-CUT of an existing video. The reviewer left this change note:
"{note}"
The current script is below. Apply the note and change nothing else: keep the same number of scenes, keep every
line, say and shot that the note does not touch, word for word. Reply with the whole script in the same JSON shape.
Current script:
{script}"""


def glue(text):
    """Keep a number with its unit: 'two years' / '3 days' never split across lines."""
    t = re.sub(r"(\d) +(?=[A-Za-z])", r"\1" + NBSP, text or "")
    return re.sub(rf"\b({NUMWORD}) +(?=[a-z])", r"\1" + NBSP, t, flags=re.I)


def tidy(p):
    """Free models like typographic characters the card fonts may not carry: plain hyphen, apostrophe, quotes, dashes."""
    def fix(t):
        t = (t or "").replace("\u2010", "-").replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", ", ")
        t = t.replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
        return t.replace("\u00a0", " ").replace("\u202f", " ").replace("\u2026", "...")
    for s in p.get("scenes") or []:
        for k in ("kicker", "line", "say", "shot"):
            if k in s:
                s[k] = fix(s[k])
    for k in ("caption", "title", "topic"):
        if k in p:
            p[k] = fix(p[k])
    return p


def _wc(t):
    return len((t or "").split())


def _name_re(cfg):
    return re.compile("|".join(cfg["name_patterns"]), re.I)


def _claims(cfg, pieces):
    e = []
    if not cfg.get("claim"):
        return e
    for where, t in pieces:
        r = lib.rpc("claim_check", _client_slug=cfg["claim"], _text=t, _context="montage") or {}
        if r.get("severity") == "setup":      # no claim rules approved for this client yet: house rules (this file) only
            return e
        if r.get("ok") is False or r.get("severity") == "soft":
            hit = ""
            try:       # name the offending words so the model can drop them (Postgres \\m \\M word edges -> \\b)
                m = re.search((r.get("pattern") or "").replace("\\m", r"\b").replace("\\M", r"\b"), t, re.I)
                hit = f" (you wrote '{m.group(0)}')" if m and m.group(0) else ""
            except re.error:
                pass
            e.append(f"{where} broke the claim rule '{r.get('reason')}'{hit} - say it without that word or idea")
    return e


def check(cfg, p, broll=False):
    e = []
    name = _name_re(cfg)
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
        if name.search(f"{s.get('kicker') or ''} {line} {say}"):
            e.append(f"scene {i} names {cfg['name']} (only the closing card does)")
        if broll and not 15 <= _wc(s.get("shot")) <= 45:
            e.append(f"scene {i} shot is {_wc(s.get('shot'))} words (want 15-45)")
        if broll and re.search(r"\b(logo|brand|label|text|sign|face|screenshot|interface|website|ui|app screen)s?\b", s.get("shot") or "", re.I):
            e.append(f"scene {i} shot mentions something the footage must not show (logos, text, signs, faces, screens, interfaces)")
        total += _wc(say)
    if scenes and not 35 <= total <= 70:
        e.append(f"all narration together is {total} words (want 35-70)")
    cap = (p.get("caption") or "").strip()
    if not 25 <= _wc(cap) <= 75:
        e.append(f"caption is {_wc(cap)} words (want 25-70)")
    paras = [x for x in re.split(r"\n\s*\n", cap) if x.strip()]
    if len(paras) < 2:
        e.append("caption needs 2 or 3 short paragraphs separated by blank lines")
    elif not name.search(paras[-1]):
        e.append(f"caption must name {cfg['name']} in its last paragraph")
    elif any(name.search(x) for x in paras[:-1]):
        e.append(f"caption names {cfg['name']} before the last paragraph")
    blob = " ".join([cap] + [f"{s.get('kicker') or ''} {s.get('line') or ''} {s.get('say') or ''}" for s in scenes])
    if "?" in blob:
        e.append("no questions anywhere")
    if EMOJI.search(blob) or "#" in blob:
        e.append("no emoji or hashtags anywhere")
    if re.search(r"\d", blob):
        e.append("no numerals anywhere (write numbers as words; never statistics)")
    if STATS.search(blob) or PRICE.search(blob) or re.search(r"\b\d*\s*(percent|dollars|bucks)\b", blob, re.I):
        e.append("no statistics, percentages or prices")
    if BAIT.search(blob):
        e.append("no engagement-bait phrases: " + BAIT.search(blob).group(0))
    if re.search(r"https?://|www\.|\.com\b|\.tech\b", blob, re.I):
        e.append("no links")
    if e:
        return e
    pieces = [("caption", cap)] + [(f"scene {i}", f"{s.get('kicker') or ''}. {s['line']} {s['say']}") for i, s in enumerate(scenes, 1)]
    return _claims(cfg, pieces)


def review(cfg, p, deadline):
    """Fact check + editor pass (brand_maker's REVIEW prompt). -> (errors, score). Quality-only complaints start with 'editor'."""
    msgs = [{"role": "system", "content": bm.REVIEW.format(name=cfg["name"], about=cfg["about"])},
            {"role": "user", "content": json.dumps({"caption": p.get("caption"), "cards": [
                {"head": s.get("line"), "body": s.get("say")} for s in p.get("scenes") or []]})[:6000]}]
    r = None
    for _ in range(2):
        msg, _ = freellm.chat(msgs, None, max_tokens=2500, deadline=deadline, json_mode=True)
        try:
            r = bm._json(msg.get("content"))
            break
        except ValueError:
            continue
    if r is None:
        return [], 0.0                      # an unreadable review is not a rejection; the rule checks already passed
    try:
        score = float(r.get("score") or 0)
    except (TypeError, ValueError):
        score = 0.0
    probs = [f"fact check: {x}" for x in (r.get("problems") or [])][:6]
    if r.get("ok") and score >= 8 and not probs:
        return [], score
    return probs or [f"editor: quality score {score:g}/10, make it clearer, more specific and more useful"], score


def _recent(slug):
    rows = lib.get("studio_video_jobs", f"select=script&client_slug=eq.{slug}&status=eq.done&order=created_at.desc&limit=8") or []
    return [r["script"] for r in rows if r.get("script")]


def _parent_script(job):
    if not job.get("parent_job_id"):
        return None
    rows = lib.get("studio_video_jobs", f"select=script&id=eq.{job['parent_job_id']}") or []
    return rows[0].get("script") if rows else None


def write(job, log, cfg):
    """-> script dict: title, topic, theme, scenes[{kicker,line,say,shot?}], end{...}, caption, provider, score."""
    parent = _parent_script(job)
    broll = bool(job.get("broll")) or bool(parent and any(sc.get("shot") for sc in parent.get("scenes", [])))
    recent = _recent(cfg["slug"])
    used = [r.get("theme") for r in recent[:2]]
    themes = list(cfg["themes"])
    theme = parent["theme"] if parent else random.choice([t for t in themes if t not in used] or themes)
    lessons = bm._lessons(cfg["lessons_brand"]) if cfg.get("lessons_brand") else []
    user = (f"Earlier {cfg['name']} videos (do not repeat their ideas or lines):\n"
            + "\n".join(f"- {r.get('title')}: {' / '.join(s.get('line', '') for s in r.get('scenes', []))}" for r in recent)
            + (f"\n\nWhat we have learned from {cfg['name']} posts:\n" + "\n".join(f"- {l}" for l in lessons[:5]) if lessons else ""))
    system = SYS.format(name=cfg["name"], about=cfg["about"], brief=job["brief"],
                        shot_rule=SHOT_RULE.format(shot_brand=cfg["shot_brand"]) if broll else "",
                        shot_key=', "shot": "..."' if broll else "")
    if parent:
        tail = cfg.get("tail") or ""
        cap = parent.get("caption") or ""
        keep = {"title": parent.get("title"), "topic": parent.get("topic"),
                "caption": cap.replace("\n\n" + tail, "") if tail else cap,
                "scenes": [{k: sc.get(k, "") for k in (("kicker", "line", "say", "shot") if broll else ("kicker", "line", "say"))}
                           for sc in parent.get("scenes", [])]}
        system += REVISE.format(note=job.get("revise_note") or "", script=json.dumps(keep, indent=1, ensure_ascii=False))
        user = "Re-cut it now."
    msgs = [{"role": "system", "content": system},
            {"role": "user", "content": user or f"This is the first {cfg['name']} video."}]
    deadline = time.time() + 900
    near, tries = None, []
    for attempt in range(1, 5):
        msg, prov = freellm.chat(msgs, None, max_tokens=3000, deadline=deadline, json_mode=True)
        try:
            p = tidy(bm._json(msg.get("content")))
            errs, score = check(cfg, p, broll), 0.0
            if not errs:
                errs, score = review(cfg, p, deadline)
                if errs and all(x.startswith("editor") for x in errs) and score >= 7 and (not near or score > near[1]):
                    near = (p, score, prov)
        except (ValueError, TypeError, KeyError, AttributeError) as ex:
            p, errs, score = None, [f"reply was not the JSON asked for ({ex})"], 0.0
        tries.append(f"try {attempt} ({prov}): {'; '.join(errs)[:300] or 'ok'}")
        log(f"script try {attempt} via {prov}: {'ok' if not errs else '; '.join(errs)[:200]}")
        if not errs:
            return finish(cfg, p, theme, prov, score, broll)
        msgs += [{"role": "assistant", "content": (msg.get("content") or "")[:4000]},
                 {"role": "user", "content": "Fix these and reply with the JSON only: " + "; ".join(errs)}]
    if near:
        return finish(cfg, near[0], theme, near[2], near[1], broll)
    raise RuntimeError(f"script failed the {cfg['name']} rules 4 times: " + " || ".join(tries)[:900])


def finish(cfg, p, theme, prov, score, broll=False):
    scenes = [{"kicker": glue((s.get("kicker") or "").strip()) if i == 0 else "",
               "line": glue(s["line"].strip()),
               "say": s["say"].strip(),
               **({"shot": (s.get("shot") or "").strip()} if broll else {})} for i, s in enumerate(p["scenes"])]
    tail = cfg.get("tail") or ""
    return {"title": p.get("title") or scenes[0]["line"], "topic": p.get("topic"), "theme": theme, "scenes": scenes,
            "end": {k: glue(v) if k != "say" else v for k, v in cfg["end"].items()},
            "caption": p["caption"].strip() + (("\n\n" + tail) if tail else ""), "provider": prov, "score": score}
