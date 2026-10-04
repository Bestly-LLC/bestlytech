"""HOKU daily post maker (2026-10-04).

Jared 2026-10-04: HOKU posts daily, made fresh as needed, straight to Instagram (no review step), and the content
learns from how it does.

  hoku_maker make    nightly: for today's and tomorrow's 11:00 AM (18:00 UTC) slots that have no post yet, plan,
                     write, check, render, upload and queue one. The existing drain (bestly-ig-poster, every 5 min)
                     publishes it at the slot; hoku_prepost (9:30 AM) still guards the day's media.
  hoku_maker stats   nightly: likes + comments for every HOKU post -> social_posts
  hoku_maker learn   weekly: up to 5 lessons with sample sizes -> social_lessons (read by `make`)
  --dry              plan + write + render + upload to hoku/dry/ + Instagram rehearsal; queues nothing

Two formats, matching the September/October hand-made set (hoku-clean/social, template slide_v3):
- "moment"  3-slide carousel: a moment you would reach for it (icon card), three short beats, then the fixed
            product card. The product card's words are fixed in code, so its claims never drift.
- "single"  one card in one of six layouts (text, bar, bold, center, list, duo): the plain, honest "show our work"
            posts about the can, the label and what we will not say.
Code picks the format, layout, color theme and topic (explore/exploit on likes + 2x comments, never repeating the
last two themes/layouts). The free AI writes only words and picks an icon from a fixed list.

Safety, because nobody reviews these before they post:
- facts are limited to the ABOUT block; rule checks in code (lengths, no digits except 4 fl oz, no emoji/hashtags/
  links/questions, novelty against every earlier HOKU post)
- every piece of copy goes through claim_check('hoku'), hard AND soft rules (20261004180000_hoku_claim_rules.sql)
- then a separate fact-check pass must pass it with a quality score of 8+
- four tries; else the slot gets a re-run of the best-liked post from 4+ weeks ago (v6+ designs only), else Scout
- only fills empty slots, so a stuck renderer cannot pile up content
Rendering: /opt/bestly/hoku-kit/card.html in headless Chromium (repo social/scripts/card-kit/hoku).
Watchdog: pi_jobs (job hoku_maker) + hoku_prepost (no post queued for today -> push alert).
"""
import calendar
import difflib
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import freellm  # noqa: E402
import lib  # noqa: E402
from jobs import brand_maker as bm  # noqa: E402  (shared: _json, _stats, _learn, _lessons)

KIT = "/opt/bestly/hoku-kit"
BUCKET = "social-media"
SLOT_UTC = 18                # 11:00 AM Pacific in summer time, 10:00 AM in winter (same slot as the hand-made queue)
AHEAD = 2                    # today + tomorrow
UA = {"User-Agent": "bestly-pi-cron/1.0 (+https://bestly.tech)"}
TAIL = "Join the waitlist. Link in bio."

THEMES = ["gold", "forest", "sage", "brown", "paper"]
SINGLE_LAYOUTS = ["text", "bar", "bold", "center", "list", "duo"]
ICONS_MOMENT = ["mist", "face", "hand", "clock", "calendar", "weather", "gym", "steps", "leaf", "drop", "save", "air", "chat"]
ICONS_SINGLE = ["pump", "bag", "canbag", "mist", "air", "cycle", "drop", "leaf", "recipe", "flask", "label", "strike",
                "claim", "scale", "search", "shield", "list", "hand", "face", "clock", "save", "question", "hokucan"]

PRODUCT_CARD = {"layout": "product", "kicker": "HOKU Facial Mist", "title": "A face mist in a sealed can.",
                "items": [["Three ingredients.", "Water, salt, and a current. Nothing added after."],
                          ["No fragrance, alcohol or oils.", "The three things most likely to set skin off."],
                          ["Air never gets back in.", "So the last spray works like the first."]],
                "cta": TAIL, "page": "3 / 3"}

MOMENTS = ["after a flight", "afternoon at the desk", "last thing at night", "where it lives", "walking in from the heat",
           "before walking in somewhere", "in the bag", "under a helmet or hat", "before a video call", "morning kettle",
           "end of a hike", "after the gym", "a long drive", "beach day", "after a run", "school pickup line",
           "after gardening", "after yoga", "commute home", "the dog walk", "after a long shift", "hotel room",
           "camping morning", "bike commute", "between meetings", "road trip stop", "after the farmers market",
           "waiting room", "sunset walk", "after cooking dinner"]
LESSONS_EDU = ["the sealed can", "three ingredients", "what we leave out", "reading a label", "how to use it",
               "what hocl is", "the word natural", "saying less", "spraying at any angle", "a fine mist",
               "one product, not a routine", "fragrance-free", "short lists are harder", "why it is taking time",
               "the questions we get", "what the can costs us", "what is on the label", "the molecule your body makes",
               "why air matters", "the last spray"]

ABOUT = """HOKU Facial Mist is a face mist that is not on sale yet; people join a waitlist (link in bio, hoku-clean.com).
Facts you may use, and NOTHING beyond them:
- It comes in a 4 fl oz sealed can: the liquid sits in a sealed bag inside the can, and the air that
  pushes it out stays outside the bag, so air never gets back in to the liquid. It sprays at any angle, upside down
  included, as a fine mist, and empties almost completely. There is no pump and no straw.
- Three ingredients: water, salt, and an electric current run through them, which makes hypochlorous acid (HOCl).
  Nothing is added after. No fragrance, no alcohol, no oils. Never print the abbreviation HOCl or the words
  "bag-on-valve" or "electrolysis": say "a sealed bag inside the can" and "salt water with a current run through it".
- How people use it: mist it on the face, don't rub it in, let it dry on its own, carry on. It is one product, not a
  routine, and it does not replace a cleanser.
- White blood cells make the same molecule. That is a fact about the molecule, not a promise about the spray.
- The brand's stance: say less, and be able to back all of it.
Voice: plain, honest, a little dry, calm. Short sentences. "We" for the brand, "you" for the reader. American spelling.
NEVER say what it does for skin or how skin will look or feel (no results, benefits, conditions, germs, "hydrating",
"soothing", "refreshing your skin"), never compare it to chlorine or bleach, never give a strength number, never
mention surfaces or cleaning, never call it first, only, natural, organic, pure, clinical, or safe for anyone in
particular, never mention prices, a launch date or a sale. Never use: effective, powerful, potent, proven, results,
restore, renew, refresh your skin, pores, immune, eco, sustainable, recyclable, ppm."""

SYS = """You write one Instagram post for HOKU. {about}

{format_rules}

Reply with ONE JSON object only, exactly these keys:
{schema}"""

MOMENT_RULES = """Format: a 3-slide carousel about one ordinary moment when someone would reach for a face mist.
Slide 1: "kicker" (1 to 3 words naming the moment, e.g. "After a flight"), "title" (2 to 7 words, a flat statement,
  ends with a period), "body" (6 to 16 words, one concrete sentence that sets the scene).
Slide 2: "lines" = exactly 3 short beats, each 1 to 4 words ending with a period (like "Boots off." "Water." "Mist."),
  and "lead" (3 to 8 words, the line under them).
Slide 3 is a fixed product card (you do not write it).
"caption": 15 to 60 words of prose, 1 or 2 short paragraphs, that tells the moment once in fresh words (do not just
  repeat the slides). It may say "mist it, let it dry". No hashtags, no emoji, no questions, no "link in bio" (added
  after), no claims about what it does for skin.
"graphic": one icon for slide 1, chosen from: {icons}."""

SINGLE_RULES = {
    "text": 'One card: "kicker" (1 to 3 words), "title" (3 to 11 words, a flat statement), "body" (5 to 16 words).',
    "bar": 'One card: "kicker" (1 to 3 words), "title" (3 to 11 words, a flat statement), "body" (5 to 16 words).',
    "bold": 'One card: "title" (4 to 11 words, a flat statement of the brand\'s stance), "body" (5 to 16 words). "kicker" = "".',
    "center": 'One centered card: "kicker" (1 to 3 words), "title" (3 to 9 words), "body" (3 to 10 words).',
    "list": ('One card with a list: "kicker" (1 to 3 words), "title" (2 to 6 words), "items" = exactly 3 pairs '
             '[head, detail]: head 2 to 5 words, detail 4 to 12 words.'),
    "duo": ('One card that contrasts two readings: "kicker" (1 to 3 words), "title" (3 to 8 words), "aLabel" (2 to 4 '
            'words, e.g. "The marketing version"), "a" (4 to 18 words), "bLabel" (2 to 4 words, e.g. "The honest '
            'version"), "b" (6 to 24 words).'),
}
SINGLE_TAIL = """
"caption": 15 to 70 words: the title (or a close variant) as the first line, then 1 or 2 short paragraphs that say
  the idea once in plain prose. No hashtags, no emoji, no questions, no "link in bio" (added after).
"graphic": one icon chosen from: {icons} (use "" for none).
This kind of post shows our work: the can, the label, the ingredients, what we will and will not say."""

# Beats already used on the hand-made October carousels (their words live only in the images); new posts add theirs
# to hoku_post_render.subhead, and _past_beats() reads both.
SEED_BEATS = ["After a flight. Before a call. End of a hike.", "Bag down. Mist. Let it dry.", "Boots off. Water. Mist.",
              "By your keys. On the desk. Not in a cabinet.", "Eyes off the screen. Mist. Back to it.", "Kettle on. Mist. Pour.",
              "Mist. Dry. Join.", "Mist. Let it dry. Keep walking.", "Park. Mist. Mirror, then go.", "Tote. Backpack. Gym bag.",
              "Unclip. Mist. Let it dry.", "Wash. Mist. Bed."]

EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️]")
DIGITS_OK = re.compile(r"\b4\s*(fl\.?\s*)?oz\b", re.I)


def _wc(t):
    return len((t or "").split())


def _http_ok(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------- data
def _posts(n=80):
    rows = lib.get("social_posts", "select=id,scheduled_at,caption,status,likes,comments,media_urls,media_type"
                   f"&brand=eq.hoku&platform=eq.instagram&status=in.(queued,posted,posting)&order=scheduled_at.desc&limit={n}") or []
    ids = ",".join(r["id"] for r in rows)
    dims = {d["post_id"]: d for d in (lib.get("social_post_dims", f"select=*&post_id=in.({ids})") or [])} if ids else {}
    for r in rows:
        r["dims"] = dims.get(r["id"], {})
    return rows


def _score(r):
    return (r.get("likes") or 0) + 2 * (r.get("comments") or 0)


def _past_beats():
    rows = lib.get("hoku_post_render", "select=subhead&layout=eq.moment&order=created_at.desc&limit=60") or []
    return SEED_BEATS + [r["subhead"] for r in rows if r.get("subhead")]


def _empty_slots(posts):
    """Today's (if it is still 45+ minutes away) and tomorrow's 18:00 UTC slots with no live post on them."""
    now = time.time()
    taken = {(r.get("scheduled_at") or "")[:10] for r in posts}
    out = []
    for d in range(AHEAD):
        day = time.strftime("%Y-%m-%d", time.gmtime(now + d * 86400))
        at = calendar.timegm(time.strptime(day + f" {SLOT_UTC:02d}:00", "%Y-%m-%d %H:%M"))
        if at - now < 45 * 60 or day in taken:
            continue
        out.append((day, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(at))))
    return out


_FORCE = {}


def _pick(posts):
    """Format, layout, theme and topic. Explore/exploit on engagement (N>=3), never the last 2 themes/layouts."""
    scored = [r for r in posts if r.get("likes") is not None and r["dims"]]
    def best(key, options, min_n=3):
        g = {}
        for r in scored:
            v = r["dims"].get(key)
            if v in options:
                g.setdefault(v, []).append(_score(r))
        proven = {k: sum(v) / len(v) for k, v in g.items() if len(v) >= min_n}
        return (max(proven, key=proven.get), len(g[max(proven, key=proven.get)])) if proven else (None, 0)

    last_fmt = "moment" if (posts and len(posts[0].get("media_urls") or []) == 3) else "single"
    fmt_best, n = best("pose", ["moment", "single"])
    if _FORCE.get("fmt"):
        fmt, why = _FORCE["fmt"], "forced"
    elif fmt_best and random.random() > 0.3:
        fmt, why = fmt_best, f"format exploit (N={n})"
    else:
        fmt, why = ("single" if last_fmt == "moment" else "moment"), "format alternates"
    recent_themes = [r["dims"].get("ground") for r in posts[:2]]
    theme = random.choice([t for t in THEMES if t not in recent_themes] or THEMES)
    layout = "moment"
    if fmt == "single":
        recent_layouts = [r["dims"].get("composition") for r in posts[:3]]
        layout = random.choice([l for l in SINGLE_LAYOUTS if l not in recent_layouts] or SINGLE_LAYOUTS)
    pool_all = MOMENTS if fmt == "moment" else LESSONS_EDU
    ever = {r["dims"].get("topic") for r in posts}
    recent = [r["dims"].get("topic") for r in posts[:10]]
    pool = [t for t in pool_all if t not in ever] or [t for t in pool_all if t not in recent] or pool_all
    top, n = best("topic", pool, 2)
    if top and random.random() > 0.3:
        topic, why2 = top, f"topic exploit (N={n})"
    else:
        topic, why2 = random.choice(pool), "topic explore"
    return fmt, layout, theme, topic, why + ", " + why2


# ---------------------------------------------------------------- writing + checks
def _check(fmt, layout, p, past):
    e = []
    def rng(name, t, lo, hi):
        w = _wc(t)
        if not lo <= w <= hi:
            e.append(f"{name} is {w} words (want {lo}-{hi})")
    title = (p.get("title") or "").strip()
    cap = (p.get("caption") or "").strip()
    if fmt == "moment":
        rng("kicker", p.get("kicker"), 1, 3)
        rng("title", title, 2, 8)
        rng("body", p.get("body"), 5, 17)
        lines = p.get("lines") or []
        if len(lines) != 3:
            e.append("lines must have exactly 3 beats")
        for i, l in enumerate(lines, 1):
            if not 1 <= _wc(l) <= 4 or not str(l).strip().endswith("."):
                e.append(f"beat {i} must be 1-4 words ending with a period")
        rng("lead", p.get("lead"), 3, 9)
        beats = " ".join(str(l).strip() for l in lines)
        for old in _PAST_BEATS:
            if difflib.SequenceMatcher(None, beats.lower(), old.lower()).ratio() > 0.55:
                e.append(f"the 3 beats are too close to an earlier post ('{old}'); find beats that belong to THIS moment only")
                break
        rng("caption", cap, 12, 65)
        if p.get("graphic") not in ICONS_MOMENT:
            e.append(f"graphic must be one of {ICONS_MOMENT}")
    else:
        lim = {"text": (3, 11), "bar": (3, 11), "bold": (4, 11), "center": (3, 9), "list": (2, 6), "duo": (3, 8)}[layout]
        rng("title", title, *lim)
        if layout in ("text", "bar", "bold"):
            rng("body", p.get("body"), 5, 17)
        if layout == "center":
            rng("body", p.get("body"), 3, 11)
        if layout != "bold":
            rng("kicker", p.get("kicker"), 1, 3)
        if layout == "list":
            items = p.get("items") or []
            if len(items) != 3 or not all(isinstance(x, (list, tuple)) and len(x) == 2 for x in items):
                e.append("items must be exactly 3 [head, detail] pairs")
            else:
                for i, (h, d) in enumerate(items, 1):
                    rng(f"item {i} head", h, 2, 5)
                    rng(f"item {i} detail", d, 4, 13)
        if layout == "duo":
            rng("aLabel", p.get("aLabel"), 2, 4)
            rng("bLabel", p.get("bLabel"), 2, 4)
            rng("a", p.get("a"), 4, 18)
            rng("b", p.get("b"), 6, 25)
        rng("caption", cap, 12, 75)
        if (p.get("graphic") or "") not in ICONS_SINGLE + [""]:
            e.append(f"graphic must be one of {ICONS_SINGLE} or empty")
    if "?" in title:
        e.append("the title asks a question")
    elif not title.endswith("."):
        e.append("the title must end with a period (house style)")
    paras = [x for x in re.split(r"\n\s*\n", cap) if x.strip()]
    if len(paras) > 3:
        e.append("caption has more than 3 paragraphs")
    blob = " ".join(str(v) for k, v in p.items() if k not in ("graphic", "topic")) if isinstance(p, dict) else ""
    if EMOJI.search(blob) or "#" in blob:
        e.append("no emoji or hashtags anywhere")
    if re.search(r"\d", DIGITS_OK.sub("", blob)):
        e.append("no numbers anywhere (write numbers as words only if you must; never statistics or strengths)")
    if re.search(r"link in bio|https?://|www\.|\.com\b", blob, re.I):
        e.append("no links or 'link in bio' (it is added after)")
    if "?" in cap:
        e.append("no questions in the caption")
    for old in past:
        if difflib.SequenceMatcher(None, title.lower(), old.lower()).ratio() > 0.62:
            e.append(f"too close to an earlier post ('{old}'); pick a different idea")
            break
    if not e:
        pieces = [("caption", cap), ("title", f"{p.get('kicker') or ''}. {title}. {p.get('body') or ''}")]
        if fmt == "moment":
            pieces.append(("beats", " ".join(p.get("lines") or []) + " " + (p.get("lead") or "")))
        if layout == "list":
            pieces.append(("list", " ".join(f"{h}. {d}" for h, d in p.get("items") or [])))
        if layout == "duo":
            pieces.append(("duo", f"{p.get('aLabel')}: {p.get('a')} {p.get('bLabel')}: {p.get('b')}"))
        for where, t in pieces:
            r = lib.rpc("claim_check", _client_slug="hoku", _text=t, _context="hoku_maker") or {}
            if r.get("ok") is False or r.get("severity") == "soft":
                e.append(f"{where} broke the claim rule '{r.get('reason')}' - say it without that")
            v = lib.rpc("hoku_soft_claim_violation", _text=t)   # the database gate social_posts_hoku_gate runs at insert
            if v:
                e.append(f"{where} uses a banned word ({v}) - say it without that")
    return e


REVIEW = """You are a strict fact checker and editor for HOKU Instagram posts that go live with no human review. {about}
Check every line for: any claim about what the mist does for skin, health, germs or how skin looks or feels; anything
beyond the facts above; anything misleading about the can, the ingredients or HOCl; anything a careful regulator would
flag. Then score it 1-10 as a post a thoughtful reader would stop on: specific, concrete, calm, quietly surprising,
not generic or repetitive. HOKU's voice is deliberately understated; do not ask for hype.
Reply with ONE JSON object only:
{{"ok": true|false, "score": <1-10>, "problems": ["<where>: <what is wrong>", ...],
  "improve": "<one or two concrete edits that would raise the score, naming the line>"}}"""


def _review(plan, deadline):
    """-> (problems, score). problems is empty only when the post is factually fine AND scores 8+."""
    msgs = [{"role": "system", "content": REVIEW.format(about=ABOUT)},
            {"role": "user", "content": json.dumps({k: v for k, v in plan.items() if k not in ("graphic", "topic")})[:5000]}]
    msg, _ = freellm.chat(msgs, None, max_tokens=2500, deadline=deadline, json_mode=True)
    try:
        r = bm._json(msg.get("content"))
    except ValueError:
        return [], 8.0          # an unreadable review is not a rejection; every rule check already passed
    try:
        score = float(r.get("score") or 0)
    except (TypeError, ValueError):
        score = 0.0
    probs = [f"fact check: {x}" for x in (r.get("problems") or [])][:6]
    if not r.get("ok") and not probs:
        probs = ["fact check: not ok (no reason given); stay strictly inside the facts"]
    if probs:
        return probs, score
    if score >= 8:
        return [], score
    return [f"editor (score {score:g}/10): {str(r.get('improve') or 'make it more specific and concrete')[:300]}"], score


_PAST_BEATS = []


def _write(fmt, layout, topic, posts, past, deadline):
    if fmt == "moment":
        rules = MOMENT_RULES.format(icons=", ".join(ICONS_MOMENT))
        schema = '{"topic": "<the moment, lowercase>", "kicker": "...", "title": "...", "body": "...", "lines": ["...", "...", "..."], "lead": "...", "caption": "...", "graphic": "..."}'
    else:
        rules = SINGLE_RULES[layout] + SINGLE_TAIL.format(icons=", ".join(ICONS_SINGLE))
        keys = {"list": '"items": [["head", "detail"], ["head", "detail"], ["head", "detail"]], ',
                "duo": '"aLabel": "...", "a": "...", "bLabel": "...", "b": "...", '}.get(layout, '"body": "...", ')
        schema = '{"topic": "<lowercase, 1 to 4 words>", "kicker": "...", "title": "...", ' + keys + '"caption": "...", "graphic": "..."}'
    lessons = bm._lessons("hoku")
    recent = "\n".join(f"- {(r.get('caption') or '').splitlines()[0][:90]} (likes {r.get('likes')}, comments {r.get('comments')})"
                       for r in posts[:14])
    if fmt == "moment":
        _PAST_BEATS[:] = _past_beats()
    user = (f"Topic: {topic}\n\n"
            + (f"Beats already used (do not reuse their words or rhythm): {' | '.join(_PAST_BEATS[-20:])}\n\n" if fmt == "moment" else "")
            + f"Recent HOKU posts (match the voice; do not repeat their ideas or lines):\n{recent}\n"
            + ("\nWhat we have learned (observations with sample sizes):\n" + "\n".join(f"- {l}" for l in lessons[:5]) if lessons else ""))
    msgs = [{"role": "system", "content": SYS.format(about=ABOUT, format_rules=rules, schema=schema)},
            {"role": "user", "content": user}]
    errs, plan, prov, tries, near = [], None, None, [], None
    for _ in range(4):
        msg, prov = freellm.chat(msgs, None, max_tokens=3000, deadline=deadline, json_mode=True)
        try:
            plan = bm._json(msg.get("content"))
            errs, score = _check(fmt, layout, plan, past), 0.0
            if not errs:
                errs, score = _review(plan, deadline)
                # Factually clean and a 7: keep it as the fallback; a 7 in HOKU's quiet voice beats a re-run.
                if errs and all(e.startswith("editor") for e in errs) and score >= 7 and (not near or score > near[1]):
                    near = (plan, score, prov)
            tries.append(f"{prov}: {json.dumps(plan)[:260]} -> {'; '.join(errs)[:220] or 'ok'}")
        except (ValueError, TypeError, KeyError, AttributeError) as e:
            plan, errs = None, [f"reply was not the JSON asked for ({e}; {prov})"]
            continue
        if not errs:
            return plan, prov
        msgs += [{"role": "assistant", "content": (msg.get("content") or "")[:4000]},
                 {"role": "user", "content": "Fix these and reply with the JSON only: " + "; ".join(errs)}]
    if near:
        return near[0], f"{near[2]} (editor score {near[1]:g})"
    raise RuntimeError(f"[{fmt}/{layout}, {topic}] post failed the rules 4 times: " + " || ".join(tries)[:900])


# ---------------------------------------------------------------- render + upload
def _specs(fmt, layout, theme, p):
    if fmt == "moment":
        return [{"theme": theme, "layout": "text", "graphic": p["graphic"], "kicker": p["kicker"].strip(),
                 "title": p["title"].strip(), "body": p["body"].strip(), "page": "1 / 3", "swipe": True},
                {"theme": theme, "layout": "stack", "lines": [l.strip() for l in p["lines"]], "title": p["lead"].strip(),
                 "page": "2 / 3", "swipe": True},
                dict(PRODUCT_CARD, theme=theme)]
    s = {"theme": theme, "layout": layout, "kicker": (p.get("kicker") or "").strip(), "title": p["title"].strip()}
    if layout in ("text", "bar", "bold", "center"):
        s["body"] = (p.get("body") or "").strip()
    if layout == "list":
        s["items"] = [[h.strip(), d.strip()] for h, d in p["items"]]
    if layout == "duo":
        s.update({k: (p.get(k) or "").strip() for k in ("aLabel", "a", "bLabel", "b")})
    g = (p.get("graphic") or "").strip()
    if g and layout != "bold":
        s["graphic"] = g
        if g == "hokucan":
            s["gSize"] = 300 if layout in ("list", "duo") else 420
    return [s]


def _render(spec, out):
    url = "file://" + KIT + "/card.html#" + urllib.parse.quote(json.dumps(spec))
    base = ["chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
            "--allow-file-access-from-files", "--window-size=1080,1400", "--virtual-time-budget=8000"]
    dom = subprocess.run(base + ["--dump-dom", url], capture_output=True, text=True, timeout=120).stdout
    m = re.search(r'data-fit="([^"]*)"', dom)
    fit = json.loads(m.group(1).replace("&quot;", '"')) if m else None
    subprocess.run(base + ["--screenshot=" + out + ".png", url], capture_output=True, timeout=120)
    from PIL import Image  # python3-pil
    im = Image.open(out + ".png").convert("RGB").crop((0, 0, 1080, 1350))
    lo, hi = zip(*im.getextrema())
    if max(hi) - min(lo) < 40:
        raise RuntimeError("render came out blank")
    im.save(out, quality=88, optimize=True)
    os.remove(out + ".png")
    if not fit or not fit.get("ok"):
        raise RuntimeError(f"card did not fit: {fit}")
    return fit


def _upload(path, name):
    with open(path, "rb") as f:
        data = f.read()
    h = {"apikey": lib.KEY, "Content-Type": "image/jpeg", "x-upsert": "true"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    req = urllib.request.Request(f"{lib.URL}/storage/v1/object/{BUCKET}/{name}", data=data, method="POST", headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()
    url = f"{lib.URL}/storage/v1/object/public/{BUCKET}/{name}"
    if not _http_ok(url):
        raise RuntimeError("uploaded image is not publicly readable")
    return url


def _invoke(fn, payload, timeout_ms, polls, wait):
    rid = lib.rpc("invoke_edge_function", function_slug=fn, payload=payload, timeout_ms=timeout_ms)
    time.sleep(wait)
    for _ in range(polls):
        r = lib.rpc("pi_http_result", p_id=rid)
        if r and r.get("status_code") is not None:
            try:
                return r["status_code"], json.loads(r.get("content") or "{}")
            except ValueError:
                return r["status_code"], {"raw": (r.get("content") or "")[:300]}
        time.sleep(wait)
    return None, {"error": "no answer yet"}


# ---------------------------------------------------------------- make
def _make_one(day, at, posts, past, deadline, dry):
    fmt, layout, theme, topic, why = _pick(posts)
    plan, prov = _write(fmt, layout, topic, posts, past, deadline)
    specs = _specs(fmt, layout, theme, plan)
    stamp = day.replace("-", "")[2:]
    folder = "hoku/dry" if dry else "hoku/daily"
    urls = []
    for i, s in enumerate(specs, 1):
        out = f"/tmp/hk-{stamp}-{os.getpid()}-{i:02d}.jpg"
        _render(s, out)
        urls.append(_upload(out, f"{folder}/hk-{stamp}-{int(time.time())}-{i:02d}.jpg"))
    cap = plan["caption"].strip()
    if fmt == "single":
        first = plan["title"].strip().rstrip(".").lower()
        if not cap.lower().startswith(first[: max(12, len(first) // 2)]):
            cap = plan["title"].strip() + "\n\n" + cap
    cap = cap + "\n\n" + TAIL
    label = f"[{fmt}/{layout}/{theme}] '{plan['title']}' ({topic}; {why}; via {prov})"
    if dry:
        code, body = _invoke("bestly-ig-poster", {"action": "dryrun", "brand": "hoku",
                             **({"mediaUrls": urls} if len(urls) > 1 else {"mediaUrl": urls[0]}), "caption": cap}, 180000, 6, 20)
        return (f"dry {day}: {label}; IG rehearsal {code} {json.dumps(body)[:160]}\n" + "\n".join(urls) + "\n---\n" + cap), plan, {"fmt": fmt, "layout": layout, "theme": theme}
    pid = str(uuid.uuid4())
    row = {"id": pid, "brand": "hoku", "platform": "instagram", "media_url": urls[0], "media_urls": urls,
           "media_type": "carousel" if len(urls) > 1 else "image", "caption": cap, "scheduled_at": at,
           "status": "queued", "max_attempts": 3}
    lib._req("POST", "/rest/v1/social_posts", row)
    lib._req("POST", "/rest/v1/social_post_dims", {"post_id": pid, "brand": "hoku", "topic": (plan.get("topic") or topic)[:60].lower(),
                                                    "ground": theme, "composition": layout, "pose": fmt, "display_word": None})
    lib._req("POST", "/rest/v1/hoku_post_render", {
        "post_id": pid, "eyebrow": (plan.get("kicker") or "")[:80], "headline": plan["title"][:200], "layout": layout,
        "subhead": " ".join(l.strip() for l in plan.get("lines") or []) if fmt == "moment" else (plan.get("body") or "")[:300],
        "og_url": urls[0]})
    return f"{day}: queued {label}", plan, {"fmt": fmt, "layout": layout, "theme": theme}


def _rerun(day, at, posts, dry):
    """Fallback: the best-liked post from 4+ weeks ago on a current design (v6, v7 or daily), as a new row."""
    cutoff = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 28 * 86400))
    recent_caps = {(r.get("caption") or "")[:80] for r in posts if (r.get("scheduled_at") or "9") >= cutoff}
    cands = [r for r in posts if r.get("status") == "posted" and (r.get("scheduled_at") or "") < cutoff
             and all(re.search(r"/hoku/(v6|v7|daily)/", u) for u in (r.get("media_urls") or ["x"]))]
    cands.sort(key=lambda r: -_score(r))
    for r in cands:
        if (r.get("caption") or "")[:80] in recent_caps:   # already re-run within the last 4 weeks
            continue
        if dry:
            return f"{day}: would re-run '{(r.get('caption') or '').splitlines()[0][:60]}'"
        pid = str(uuid.uuid4())
        lib._req("POST", "/rest/v1/social_posts", {
            "id": pid, "brand": "hoku", "platform": "instagram", "media_url": r["media_urls"][0], "media_urls": r["media_urls"],
            "media_type": r.get("media_type") or "image", "caption": r["caption"], "scheduled_at": at, "status": "queued",
            "max_attempts": 3})
        d = r.get("dims") or {}
        lib._req("POST", "/rest/v1/social_post_dims", {"post_id": pid, "brand": "hoku", "topic": d.get("topic") or "rerun",
                                                        "ground": d.get("ground"), "composition": d.get("composition") or "rerun",
                                                        "pose": "rerun", "display_word": None})
        return f"{day}: re-running '{(r.get('caption') or '').splitlines()[0][:60]}' (best older post)"
    return None


def _make(dry):
    posts = _posts()
    slots = _empty_slots(posts)
    if dry and not slots:   # rehearse against tomorrow's slot even when it is taken
        day = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 86400))
        slots = [(day, day + f"T{SLOT_UTC:02d}:00:00Z")]
    if not slots:
        return f"ok nothing to make: today and tomorrow already have posts ({sum(1 for r in posts if r['status'] == 'queued')} queued)"
    past = [(r.get("caption") or "").splitlines()[0][:120] for r in posts if r.get("caption")]
    deadline, out = time.time() + 1500, []
    for day, at in slots:
        try:
            line, plan, meta = _make_one(day, at, posts, past, deadline, dry)
            past.append(plan["title"])
            posts.insert(0, {"media_urls": [1, 2, 3] if meta["fmt"] == "moment" else [1], "caption": plan["title"],
                             "dims": {"ground": meta["theme"], "composition": meta["layout"], "pose": meta["fmt"],
                                      "topic": (plan.get("topic") or "").lower()}})
            out.append(line)
        except Exception as e:  # noqa: BLE001
            out.append(f"{day}: FAILED {type(e).__name__}: {str(e)[:300]}")
            rr = _rerun(day, at, posts, dry)
            if rr:
                out.append(rr)
    failed = [l for l in out if "FAILED" in l]
    stranded = [l for l in failed if not any(l[:10] in x and "re-run" in x for x in out)]
    if failed and not dry:
        lib.notify("HOKU post maker had trouble", "\n".join(out)[:1200], severity="warning" if stranded else "info",
                   push=bool(stranded), url="/admin", dedupe="hoku-maker-" + time.strftime("%Y%m%d"))
    if stranded and not dry:
        raise RuntimeError(" | ".join(out)[:1500])
    return ("dry:\n" if dry else "ok ") + ("\n" if dry else " | ").join(out)[:3500]


def main(argv):
    mode = next((a for a in argv if a in ("make", "stats", "learn")), "make")
    if mode == "stats":
        return bm._stats(["hoku"])
    if mode == "learn":
        return bm._learn(["hoku"])
    if "--single" in argv or "--moment" in argv:   # rehearsal aid: force a format
        _FORCE["fmt"] = "single" if "--single" in argv else "moment"
    return _make("--dry" in argv)
