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
The closing card is fixed in code, like the product card on the daily carousels (a re-cut whose note mentions the end card may
propose its sub line and benefit chips; they pass the same claim rules or the brand default stays).
2026-10-12 (re-cut fix): a re-cut now applies the note fully (a note about the copy rewrites every line), a re-cut that comes back
(nearly) unchanged is retried once and then stopped (RecutUnchanged) instead of being filed, scenes carry an `icon` for the free
motion graphics in comp/brand, and scene 1 says plainly what the product is for brands that set explain_first.
"""
import copy
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
- "say": 5 to 18 words the narrator reads. Plain spoken English, said once. It can repeat or extend the line.{icon_rule}{shot_rule}
All "say" together: 35 to 70 words. One idea, told in order, quietly. Useful to someone who never installs or buys anything.
{speak_rule}
Write for the least-informed viewer there is: everyday words, short sentences, no jargon or tech terms.
In the caption's last paragraph say only what the facts above say {name} does; invent no feature, promise or result. No statistics, prices, percentages or numerals (write any number as a word).
Write only what is true and verifiable; if unsure, say less. American English spelling.
"caption": 25 to 70 words of prose for the post, two or three short paragraphs. {name} appears only in the LAST paragraph,
once, answering the idea the video told. No hashtags, emoji, questions or "link in bio".
"title": 3 to 8 words naming the video for the team (not shown to viewers).
Reply with ONE JSON object only:
{{"title": "...", "topic": "<1 to 4 words, lowercase>", "scenes": [{{"kicker": "...", "line": "...", "say": "..."{icon_key}{shot_key}}}], "caption": "..."}}"""

SHOT_RULE = """
- "shot": 15 to 45 words describing the moving footage behind this card, for an AI video model: a real place,
  the light, the camera move, hands or the back of a person at most. Vertical framing. {shot_brand} No faces looking
  at the camera, no text, signs, logos or brands, no invented app screens, websites or user interfaces; a phone or laptop
  may only appear as a dark silhouette with a blank screen. Calm and natural, like quiet documentary b-roll."""

SPEAK_DEFAULT = 'Speak to the viewer ("you"); never say "we" and never describe what {name} does inside the scenes. Do not name {name} in any scene.'
SPEAK_EXPLAIN = ('Speak to the viewer ("you"); never say "we". Do not name {name} in any scene, but SCENE 1 MUST say plainly what the product is and '
                 'who it is for, in everyday words (its category, for example "a private cloud for small businesses: one box that holds your '
                 'files, calendar, chat and passwords"), so a stranger gets it in the first five seconds. Later scenes show why it matters. '
                 'Never describe anything the facts above do not list.')
ICON_RULE = """
- "icon": the picture drawn above the line, ONE of these words (a different one on every card, the one that matches what the card says):
  {icon_help}"""
ICON_HELP = {"files": "a folder of documents (files, documents, storage)", "lock": "a padlock (private, secure)",
             "box": "a small server box the business owns", "people": "a team of people (accounts, staff, support)",
             "calendar": "a calendar (scheduling)", "chat": "a chat bubble (team messages)", "key": "a key (passwords, the password vault)",
             "check": "a check mark (handled, done, it works)", "tag": "a price tag with a slash (no per-seat fees)",
             "eyeslash": "a crossed-out eye (nobody is watching your data)"}

REVISE = """

This is a RE-CUT of an existing video. The reviewer left this change note (their exact words):
"{note}"
The current script is below.
{mode}
House rules for every re-cut (they override anything above): scene 1 says plainly what the product is and who it is for, in everyday words a
stranger understands in five seconds (describe it by what it is, without naming {name}: only the closing card and the caption's last paragraph
name it); no jargon; short sentences; use only the facts above, invent nothing. Where the note asks for a change, the new script must read
clearly different from the current one.{end_ask}
Reply with the whole script in the same JSON shape.
Current script:
{script}"""
MODE_BROAD = ("The note criticizes the writing itself, so do not patch it. Throw the current wording away and rewrite EVERY scene (kicker, line, say) "
              "and the caption from scratch: same facts, same length limits, same number of scenes (4 or 5), same JSON shape. Do not reuse any "
              "current line, say or caption sentence.")
MODE_NARROW = ("Apply the note and change only what it asks for: keep the number of scenes and every kicker, line, say, icon and shot the note "
               "does not touch, word for word.")
END_ASK = (' The note mentions the closing card, so also add an "end" object to the JSON: {{"sub": "one plain sentence of 6 to 14 words saying what '
           '{name} is and does, for a stranger", "chips": [{{"icon": "<icon word>", "text": "1 to 5 words, at most 25 letters"}}, '
           '...exactly three chips, each a different plain benefit taken from the facts]}}. The closing card title stays "{name}".')
STRONGER = ("Not good enough: {pct}% of your lines are still the same as the current script, and the reviewer asked for a different one. Start from a "
            "blank page. Write every kicker, line and say in new words, with a new opening and a new caption (different sentences, not the old ones "
            "rearranged). Scene 1 must say plainly what the product is and who it is for. Reply with the JSON only.")
# a note that is about the writing / clarity as a whole (rewrite everything) and one that wants any copy change at all
_BROAD = (r"copy|writing|wording|script|hook|headline|bland|boring|generic|vague|jargon|unclear|not clear|confus\w*|obvious|"
          r"understand\w*|dumb\w*|sucks?|bad|weak|rewrite|rewrit\w*|exciting|clearest|what you do|what it does")
BROAD_NOTE = re.compile(rf"\b({_BROAD})\b", re.I)
COPY_NOTE = re.compile(rf"\b({_BROAD}|words?|text|lines?|captions?|messag\w*|clear\w*|simpl\w*|explain\w*|say|said|tone|voice)\b", re.I)
END_NOTE = re.compile(r"\b(end card|end screen|closing card|closing screen|outro|last card|final card|ending card|end slate|cta|call to action)\b", re.I)
SAME_LIMIT = 0.70


class RecutUnchanged(RuntimeError):
    """A re-cut whose note asked for different copy came back (nearly) the same twice. Montage stops the job instead of filing it."""


def _clean_note(note):
    """The trigger stores "[changes: notes] Jared: <text>"; the writer needs only what the reviewer said."""
    return re.sub(r"^\s*\[[^\]]*\]\s*(?:[A-Za-z][\w .'-]{0,30}:\s*)?", "", note or "").strip()


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
        if cfg.get("icons") and s.get("icon") not in cfg["icons"]:
            e.append(f"scene {i} needs an \"icon\" that is exactly one of: {', '.join(cfg['icons'])}")
        if broll and not 15 <= _wc(s.get("shot")) <= 45:
            e.append(f"scene {i} shot is {_wc(s.get('shot'))} words (want 15-45)")
        if broll and re.search(r"\b(logo|brand|label|text|sign|face|screenshot|interface|website|ui|app screen)s?\b", s.get("shot") or "", re.I):
            e.append(f"scene {i} shot mentions something the footage must not show (logos, text, signs, faces, screens, interfaces)")
        total += _wc(say)
    icons = [x.get("icon") for x in scenes if x.get("icon")]
    if cfg.get("icons") and len(icons) != len(set(icons)):
        e.append("use a different icon on every scene")
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


def check_end(cfg, p):
    """Errors (all start with 'end card') for the closing-card sub line + chips the writer proposed on a re-cut. [] when fine or none proposed."""
    end = p.get("end")
    if end is None:
        return []
    e = []
    if not isinstance(end, dict):
        return ["end card must be an object with sub and chips"]
    sub = (end.get("sub") or "").strip()
    chips = end.get("chips") or []
    if not 4 <= _wc(sub) <= 16:
        e.append(f"end card sub is {_wc(sub)} words (want 6-14)")
    if not isinstance(chips, list) or not 2 <= len(chips) <= 3:
        return e + ["end card needs 3 chips (a list of {icon, text})"]
    texts = []
    for i, c in enumerate(chips, 1):
        c = c if isinstance(c, dict) else {}
        t = (c.get("text") or "").strip()
        texts.append(t)
        if c.get("icon") not in (cfg.get("icons") or []):
            e.append(f"end card chip {i} needs an icon that is exactly one of: {', '.join(cfg.get('icons') or [])}")
        if not 1 <= _wc(t) <= 5 or len(t) > 25:
            e.append(f"end card chip {i} text '{t}' must be 1-5 words and at most 25 letters")
    if len(set(x.lower() for x in texts)) != len(texts):
        e.append("end card chips must say different things")
    blob = " ".join([sub] + texts)
    if "?" in blob or "#" in blob or EMOJI.search(blob) or re.search(r"\d", blob):
        e.append("end card text: no questions, hashtags, emoji or numerals")
    if STATS.search(blob) or PRICE.search(blob) or BAIT.search(blob) or re.search(r"https?://|www\.|\.com\b|\.tech\b", blob, re.I):
        e.append("end card text: no statistics, prices, bait phrases or links")
    if e:
        return e
    return [f"end card: {x}" if not x.startswith("end card") else x
            for x in _claims(cfg, [("end card sub", sub)] + [(f"end card chip {i}", t) for i, t in enumerate(texts, 1)])]


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


def _norm(t):
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def _items(script, tail=""):
    """Every piece of copy a viewer reads or hears: kickers, lines, says and the caption paragraphs (without the fixed tail)."""
    out = []
    for sc in script.get("scenes") or []:
        out += [sc.get("kicker"), sc.get("line"), sc.get("say")]
    for para in re.split(r"\n\s*\n", script.get("caption") or ""):
        if para.strip() and para.strip() != (tail or "").strip():
            out.append(para)
    return [n for n in (_norm(x) for x in out) if n]


def same_share(old, new, tail=""):
    """Share (0..1) of the new script's copy pieces that already appear word for word (ignoring case and punctuation) in the old one."""
    before, after = set(_items(old, tail)), _items(new, tail)
    return sum(1 for x in after if x in before) / len(after) if after else 1.0


def _loop(cfg, msgs, broll, deadline, log, label=""):
    """Ask, check, fix: up to 4 tries. -> (p, prov, score). Raises RuntimeError with the tries when nothing passes."""
    msgs = list(msgs)
    near, tries = None, []
    for attempt in range(1, 5):
        msg, prov = freellm.chat(msgs, None, max_tokens=3000, deadline=deadline, json_mode=True)
        try:
            p = tidy(bm._json(msg.get("content")))
            errs, score = check(cfg, p, broll), 0.0
            if not errs:
                errs = check_end(cfg, p)
                if errs and attempt >= 3:      # the closing card is a bonus: after two tries drop the proposal and keep the brand default
                    log(f"{label}end card proposal dropped: {'; '.join(errs)[:160]}")
                    p.pop("end", None)
                    errs = []
            if not errs:
                errs, score = review(cfg, p, deadline)
                if errs and all(x.startswith("editor") for x in errs) and score >= 7 and (not near or score > near[1]):
                    near = (p, score, prov)
        except (ValueError, TypeError, KeyError, AttributeError) as ex:
            p, errs, score = None, [f"reply was not the JSON asked for ({ex})"], 0.0
        tries.append(f"try {attempt} ({prov}): {'; '.join(errs)[:300] or 'ok'}")
        log(f"{label}script try {attempt} via {prov}: {'ok' if not errs else '; '.join(errs)[:200]}")
        if not errs:
            return p, prov, score
        msgs += [{"role": "assistant", "content": (msg.get("content") or "")[:4000]},
                 {"role": "user", "content": "Fix these and reply with the JSON only: " + "; ".join(errs)}]
    if near:
        return near
    raise RuntimeError(f"script failed the {cfg['name']} rules 4 times: " + " || ".join(tries)[:900])


def write(job, log, cfg):
    """-> script dict: title, topic, theme, scenes[{kicker,line,say,icon?,shot?}], end{...}, caption, provider, score."""
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
    icons = cfg.get("icons")
    explain = bool(parent) or cfg.get("explain_first")
    system = SYS.format(name=cfg["name"], about=cfg["about"], brief=job["brief"],
                        speak_rule=(SPEAK_EXPLAIN if explain else SPEAK_DEFAULT).format(name=cfg["name"]),
                        icon_rule=ICON_RULE.format(icon_help="; ".join(f"{k} = {ICON_HELP[k]}" for k in icons)) if icons else "",
                        icon_key=', "icon": "..."' if icons else "",
                        shot_rule=SHOT_RULE.format(shot_brand=cfg["shot_brand"]) if broll else "",
                        shot_key=', "shot": "..."' if broll else "")
    note = _clean_note(job.get("revise_note"))
    wants_copy = bool(parent) and bool(COPY_NOTE.search(note))
    if parent:
        tail = cfg.get("tail") or ""
        cap = parent.get("caption") or ""
        keep = {"title": parent.get("title"), "topic": parent.get("topic"),
                "caption": cap.replace("\n\n" + tail, "") if tail else cap,
                "scenes": [{k: sc.get(k, "") for k in (("kicker", "line", "say") + (("icon",) if icons else ()) + (("shot",) if broll else ()))}
                           for sc in parent.get("scenes", [])]}
        end_ask = END_ASK.format(name=cfg["name"]) if (icons and cfg.get("end_cta_say") and END_NOTE.search(note)) else ""
        system += REVISE.format(note=note, name=cfg["name"], end_ask=end_ask, script=json.dumps(keep, indent=1, ensure_ascii=False),
                                mode=MODE_BROAD if BROAD_NOTE.search(note) else MODE_NARROW)
        user = "Re-cut it now."
    msgs = [{"role": "system", "content": playbook.add(system)},
            {"role": "user", "content": user or f"This is the first {cfg['name']} video."}]
    deadline = time.time() + 1200
    p, prov, score = _loop(cfg, msgs, broll, deadline, log)
    out = finish(cfg, p, theme, prov, score, broll)
    if wants_copy:
        share = same_share(parent, out, cfg.get("tail") or "")
        log(f"re-cut copy check: {share:.0%} of the lines are unchanged (note asks for copy changes)")
        if share >= SAME_LIMIT:
            msgs2 = msgs + [{"role": "assistant", "content": json.dumps({k: out[k] for k in ("title", "topic", "scenes", "caption")}, ensure_ascii=False)[:4000]},
                            {"role": "user", "content": STRONGER.format(pct=round(share * 100))}]
            p, prov, score = _loop(cfg, msgs2, broll, deadline, log, label="retry: ")
            out = finish(cfg, p, theme, prov, score, broll)
            share2 = same_share(parent, out, cfg.get("tail") or "")
            log(f"re-cut retry: {share2:.0%} of the lines are unchanged")
            if share2 >= SAME_LIMIT:
                raise RecutUnchanged(f"the reviewer's note asks for new copy but the writer returned {share2:.0%} of the old lines twice "
                                     f"({share:.0%} then {share2:.0%} unchanged). Nothing was filed so the old video is not replaced by a copy of itself")
        out["recut_changed"] = round(1 - same_share(parent, out, cfg.get("tail") or ""), 2)
    return out


def finish(cfg, p, theme, prov, score, broll=False):
    icons = cfg.get("icons") or []
    scenes = [{"kicker": glue((s.get("kicker") or "").strip()) if i == 0 else "",
               "line": glue(s["line"].strip()),
               "say": s["say"].strip(),
               **({"icon": s["icon"]} if icons and s.get("icon") in icons else {}),
               **({"shot": (s.get("shot") or "").strip()} if broll else {})} for i, s in enumerate(p["scenes"])]
    tail = cfg.get("tail") or ""
    end = copy.deepcopy(cfg["end"])
    for k, v in end.items():
        if isinstance(v, str) and k != "say":
            end[k] = glue(v)
    prop = p.get("end") if isinstance(p.get("end"), dict) else None
    if prop and cfg.get("end_cta_say") and not check_end(cfg, p):          # a proposal that passed the claim rules replaces the brand default
        sub = tidy({"title": prop["sub"]})["title"].strip()
        end["sub"] = glue(sub)
        end["chips"] = [{"icon": c["icon"], "text": glue(tidy({"title": c["text"]})["title"].strip())} for c in prop["chips"]]
        end["say"] = f"{end['title']}. {sub} {cfg['end_cta_say']}"
        end["proposed"] = True
    return {"title": p.get("title") or scenes[0]["line"], "topic": p.get("topic"), "theme": theme, "scenes": scenes,
            "end": end, "caption": p["caption"].strip() + (("\n\n" + tail) if tail else ""), "provider": prov, "score": score}
