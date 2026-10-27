"""house_variety: what is NEW today, for every house-brand maker (Spark, 2026-10-26).

Why this exists. The image makers (brand_maker, hoku_maker, bestly_social) each picked a topic, a layout and a color
at random from a small list, compared the new title only against old titles, never saw what was already queued, and
never saw how posts did. Forty posts later the pool of ideas, grounds and layouts had run out and everything looked alike.
This module gives all of them the same three things:

  1. the brand's last 60 posts plus everything queued, what did best, and why the gate rejected recent ones
     (database function house_gate_history), so a new post is written against the real picture;
  2. a rotation: the format, angle, series segment, accent and ground that was used LONGEST AGO comes next, never a
     coin flip (state file, survives restarts);
  3. a duplicate probe that runs the gate's own caption/opening check before anything is filed (house_gate_dup_probe),
     so a duplicate is caught in the maker, with the reason, instead of being rejected an hour later.

Every call is wrapped: if the database functions are missing the makers fall back to their old behavior.
The writer prompt gets a short recipe block (series name and number, angle, hook style, a real "Next" tease of the
topic that will actually come next, one comment question). The recipe is built in code; the free AI only writes words.
"""
import json
import os
import random
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lib  # noqa: E402

STATE_FILE = os.path.join(os.environ.get("BESTLY_STATE", "/opt/bestly/cron/state"), "house-variety.json")

# One angle is one way of telling an idea. Rotated, so the same topic never reads the same way twice.
ANGLES = {
    "myth": "a myth people believe, then the plain fact",
    "mistake": "one mistake people make and the one-line fix",
    "howto": "a thirty-second how-to with 3 short steps",
    "question": "a question people actually ask, answered straight",
    "contrast": "what people assume next to what actually happens",
    "definition": "one term explained in plain words, no jargon",
    "habit": "one tiny habit that takes under a minute",
    "scene": "a real everyday moment, told in two or three concrete details",
    "checklist": "a short checklist of three things",
    "why": "why something works the way it does, in one idea",
}

# Hook styles are about how the FIRST card (or first line) grabs, which is what the scroll decides on.
HOOKS = {
    "headline": "a bold flat headline of 4 to 9 words that states one surprising, true thing",
    "number": "open with one concrete number from the advice itself (a count of steps, items or minutes), never a statistic",
    "quote": "open with a short sentence a real person would say out loud, in quotation marks",
    "contrast": "open with 'Not X. Y.' where both are short and concrete",
}

SEGMENTS = {
    "cookie-yeti": ["Yeti Explains", "Banner Watch", "Reject Report", "Myth Check"],
    "inventoryproof": ["Proof Tip", "Room by Room", "Claim Day", "Myth Check"],
    "hoku": ["Moments", "Say Less", "Read the Label", "Ask Us"],
    "bestly-cloud": ["Own Your Cloud", "Private by Default", "Cloud Notes"],
    "bestly-studio": ["Studio Tips", "Posting Notes", "Behind the Post"],
    "bestly-agent": ["Maya Answers", "Missed Call", "Front Desk Notes"],
}

# the comment question: one short, specific, answerable line. Never bait ("comment below", "tag a friend", "like if").
BAIT = re.compile(r"comment (below|your)|tag (a|your)|like (if|this)|share (this|with)|double.?tap|follow (us|for)|link in bio", re.I)


# ---------------------------------------------------------------- state
def _load():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def _save(st):
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        tmp = STATE_FILE + ".part"
        with open(tmp, "w") as f:
            json.dump(st, f)
        os.replace(tmp, STATE_FILE)
    except Exception:  # noqa: BLE001  a read-only state dir must never stop a post
        pass


def lru(slug, dim, options, avoid=()):
    """The option used longest ago (never-used first); `avoid` values are skipped unless they are all that is left."""
    used = (_load().get(slug, {}).get("used", {}).get(dim, {}))
    pool = [o for o in options if o not in avoid] or list(options)
    random.shuffle(pool)
    return min(pool, key=lambda o: used.get(o, 0))


def lru_order(slug, dim, options):
    """All options, longest-unused first (ties shuffled)."""
    used = (_load().get(slug, {}).get("used", {}).get(dim, {}))
    pool = list(options)
    random.shuffle(pool)
    return sorted(pool, key=lambda o: used.get(o, 0))


def mark(slug, **dims):
    st = _load()
    u = st.setdefault(slug, {}).setdefault("used", {})
    now = time.time()
    for dim, val in dims.items():
        if val:
            u.setdefault(dim, {})[str(val)] = now
    _save(st)


# ---------------------------------------------------------------- database picture
def hist(slug, n=60):
    try:
        r = lib.rpc("house_gate_history", p_slug=slug, p_n=n)
        return r if isinstance(r, dict) and not r.get("error") else {}
    except Exception:  # noqa: BLE001
        return {}


def probe(slug, caption):
    """The gate's own duplicate check, before filing. -> (ok, reason)."""
    try:
        r = lib.rpc("house_gate_dup_probe", p_slug=slug, p_caption=caption)
    except Exception:  # noqa: BLE001
        return True, ""
    if not isinstance(r, dict) or r.get("ok", True):
        return True, ""
    if (r.get("open_best") or 0) >= 0.6:
        return False, f"opening line is {round(100 * r['open_best'])}% the same as {r.get('open_code')}; open differently"
    return False, f"caption is {round(100 * (r.get('best') or 0))}% the same as {r.get('code')}; tell a different idea"


def need(slug):
    """How many more finished posts this brand needs now (weekly cap minus finished, scheduled and waiting). None = unknown."""
    try:
        h = lib.rpc("house_gate_need", p_slug=slug)
        return int(h) if h is not None else None
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------- recipe
def recipe(slug, topics=None, hooks=None, series=True):
    """-> dict: segment, series_no, angle, hook, next_topic (a real promise), question (bool). Marks nothing until commit()."""
    segs = SEGMENTS.get(slug) or ["Notes"]
    st = _load().get(slug, {})
    segment = lru(slug, "segment", segs)
    angle = lru(slug, "angle", list(ANGLES))
    hook = lru(slug, "hook", list(hooks or HOOKS))
    n = int(st.get("series", {}).get(segment, 0)) + 1
    r = {"series": series, "segment": segment, "series_no": n, "angle": angle, "angle_desc": ANGLES[angle],
         "hook": hook, "hook_desc": HOOKS.get(hook, hook), "next_topic": None, "question": True}
    if topics:
        r["next_topic"] = lru(slug, "topic_next", topics, avoid=[st.get("promised")] if st.get("promised") else [])
    return r


def promised(slug):
    """The topic the previous post promised in its 'Next' line; the maker must honor it."""
    return _load().get(slug, {}).get("promised") or None


def commit(slug, r, **extra):
    """Call once the post is filed: marks the rotation, bumps the series number, records the promise."""
    st = _load()
    s = st.setdefault(slug, {})
    if r.get("series"):
        s.setdefault("series", {})[r["segment"]] = r["series_no"]
    if r.get("next_topic"):
        s["promised"] = r["next_topic"]
    _save(st)
    mark(slug, segment=r["segment"] if r.get("series") else None, angle=r["angle"], hook=r["hook"], **extra)


def prompt_block(r, h, name):
    """The recipe as plain instructions, plus what the brand's own results say."""
    lines = [
        "TODAY'S RECIPE (follow it; it exists so this post does not look or sound like the last ones):",
        f"- Angle: {r['angle_desc']}.",
        f"- Hook: {r['hook_desc']}.",
    ]
    if r.get("series"):
        lines.insert(1, f"- Series: {r['segment']} #{r['series_no']}. The first card's eyebrow is exactly \"{r['segment']} #{r['series_no']}\" (digits and # are allowed there only).")
    if r.get("next_topic"):
        lines.append(f"- Tease: after the {name} paragraph, one short paragraph that says only: \"Next in {r['segment']}: {r['next_topic']}.\" (use those words, it is a real promise)")
    if r.get("question"):
        lines.append("- Ask: the very last line of the caption is ONE short question a reader can answer from their own life in a few words, "
                     "specific to this post (not 'what do you think'), no 'comment below', no 'tag a friend'.")
    recent = [x for x in (h.get("recent") or []) if x.get("opening")][:20]
    if recent:
        lines.append("- Already posted or queued (do not repeat an idea, a first line, or a phrase from these):\n  "
                     + "\n  ".join("• " + x["opening"][:90] for x in recent))
    top = h.get("top") or []
    if top:
        lines.append("- What got the most response so far (small numbers, a hint and not a law): "
                     + "; ".join(f"\"{(t.get('opening') or '')[:70]}\" ({t.get('likes') or 0} likes, {t.get('comments') or 0} comments)" for t in top[:3]))
    rej = h.get("rejects") or []
    if rej:
        lines.append("- Posts of this brand were recently sent back for: " + "; ".join(f"{x.get('k')} x{x.get('n')}" for x in rej[:4]) + ". Do not do those.")
    return "\n".join(lines)


def tail_split(caption):
    """-> (core paragraphs, tease paragraph or None, question or None) for a caption built with prompt_block."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", (caption or "").strip()) if p.strip()]
    q = tease = None
    if paras and paras[-1].rstrip().endswith("?") and len(paras[-1].split()) <= 18:
        q = paras.pop()
    if paras and re.match(r"next in\b", paras[-1], re.I):
        tease = paras.pop()
    return paras, tease, q


def question_ok(q):
    return bool(q) and not BAIT.search(q) and 3 <= len(q.split()) <= 18 and q.count("?") == 1
