"""Variety engine for Montage (Jared 2026-10-12 10:32 PM: "no duplicate-looking content ... brand-consistent, but every piece unique,
engaging, and it brings viewers back"). Plan: docs/studio-unique-content-opusplan.md.

What it does, in order, for every video a brand module writes (brands/_common.write, brands/hoku.write):
  prepare   series number ("Tip 3 of 8") + the real "Next:" tease (studio_series / studio_series_topics) and this video's named segment
            ("Quick fix", "Myth or fact", ... studio_segments, rotated).
  plan      a LOOK: layout set (the order of scene templates), hook style (question / stat / problem / story / myth), accent colour, end-card
            layout, icon style. Chosen so it differs from the brand's last 8 videos on at least 4 dimensions (the gate demands 3), and from the last
            few videos of the other brands that share the same composition.
  prompt    the writer is told the hook, the segment, which scenes need extra data (a huge word, 2-3 steps), and to add a comment question.
  gate      a finished script must (a) differ from each of the brand's last 8 videos on >= 3 of the look dimensions and (b) open with a line that is
            not near-identical to any of the last 20 openings. A miss re-rolls the plan and the writer (twice), then the job is HELD and Spark
            alerts (montage.variety, info, no push).
  record    studio_look_ledger keeps the fingerprint per job; the music track is added after the picker ran; the DB trigger marks it filed.
Nothing here spends money. Everything is free-AI text and DB reads.
2026-10-14: a brand with CFG["unit_moments"] (Bestly Cloud) gets a seventh look dimension, "unit": which moment of the 3D unit this video shows
(reveal / turn / glimpse / hero, see unit_moment.py). make_plan rotates them (never the last video's, then the one used longest ago), the gate
refuses a repeat of the last video's moment, and decorate puts the moment on a scene or the closing card.
"""
import difflib
import random
import re
import sys

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402
import unit_moment  # noqa: E402  (2026-10-14: the Bestly Cloud 3D unit moments, rotated like the other look dimensions)

LAYOUT_SETS = {          # scene templates in order (the video uses the first 4 or 5)
    "L1": ["stack", "center", "split", "stat", "steps"],
    "L2": ["center", "stat", "stack", "steps", "split"],
    "L3": ["split", "steps", "center", "stack", "stat"],
    "L4": ["stat", "split", "steps", "center", "stack"],
    "L5": ["stack", "steps", "stat", "split", "center"],
    "L6": ["steps", "center", "split", "stack", "stat"],
}
TEMPLATES = ("stack", "center", "split", "stat", "steps")
FALLBACK = {"stat": "center", "steps": "split"}       # when a scene has no data for its template (hand-written ads, a failed field)
ICON_STYLES = ("orbit", "badge", "rings")
END_LAYOUTS = ("list", "claim", "qa")
HOOKS = ("question", "stat", "problem", "story", "myth")
DIMS = ("layout", "hook", "accent", "track", "end", "icon")
MIN_DIFF, MIN_DIFF_PLAN, LAST_VIDEOS, LAST_OPENINGS = 3, 4, 8, 20
OPENING_LIMIT = 0.72

HOOK_LABEL = {"question": "a question", "stat": "a bold count", "problem": "the problem", "story": "a quick imagined story", "myth": "myth versus fact"}
HOOK_RULES = {
    "question": ('OPEN WITH A QUESTION. Scene 1 "line" is ONE short question to the viewer that ends with "?" (4 to 9 words) about a moment they know. '
                 'Its "say" repeats the question, then adds one plain sentence saying what the product is and who it is for. Later scenes answer it.'),
    "stat": ('OPEN WITH A BOLD COUNT. Scene 1 "line" starts with a short count written as a word ({stat_hint}). It is a plain count of things, never a '
             'statistic, percentage, survey, saving or claim about how many people. Its "say" repeats it and adds one plain sentence saying what the product is.'),
    "problem": ('OPEN WITH THE PROBLEM. Scene 1 "line" is the everyday problem in one concrete sentence, as it happens at work or at home, no question. '
                'Its "say" adds one plain sentence saying what the product is and who it is for.'),
    "story": ('OPEN WITH A QUICK IMAGINED STORY. Scene 1 "line" starts with "Picture" and sets one small scene in one sentence (clearly imagined: no real '
              'customer, no result). Its "say" adds one plain sentence saying what the product is and who it is for.'),
    "myth": ('OPEN WITH A MYTH. Scene 1 "line" starts with "Myth:" and states one common wrong belief plainly. Scene 2 "line" starts with "Fact:" and '
             'corrects it. Scene 1 "say" also says in one plain sentence what the product is and who it is for.'),
}
STAT_HINT_DEFAULT = 'for example "One box." or "Two minutes."; only counts the facts support'

_NUMW = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen").split()
_TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
COUNTWORD = re.compile(r"^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand)\b", re.I)
BAIT_Q = re.compile(r"comment below|tag a friend|let me know in the comments|drop a|smash|link in bio|swipe", re.I)


def house_feed(brand):
    """2026-10-26 (house gate): the same picture the image makers read, from house_gate_history: what is already posted or queued for the brand
    (images and videos), what got the most response, and why the gate sent recent posts back. {} when the function is missing (old behavior)."""
    try:
        h = lib.rpc("house_gate_history", p_slug=brand, p_n=60)
        return h if isinstance(h, dict) and not h.get("error") else {}
    except Exception:  # noqa: BLE001
        return {}


def house_probe(brand, text):
    """The gate's own caption/opening duplicate check against the last 60 posts plus everything queued. -> (ok, reason)."""
    try:
        r = lib.rpc("house_gate_dup_probe", p_slug=brand, p_caption=text)
    except Exception:  # noqa: BLE001
        return True, ""
    if not isinstance(r, dict) or r.get("ok", True):
        return True, ""
    if (r.get("open_best") or 0) >= 0.6:
        return False, f"opening is {round(100 * r['open_best'])}% the same as {r.get('open_code')} in the house queue"
    return False, f"script is {round(100 * (r.get('best') or 0))}% the same as {r.get('code')} in the house queue"


class VarietyHold(RuntimeError):
    """The script could not be made different enough after 2 re-rolls. The worker holds the job and Spark alerts (montage.variety)."""


def words(n):
    n = int(n)
    if n < 20:
        return _NUMW[n]
    t, o = divmod(n, 10)
    return _TENS[t] + (("-" + _NUMW[o]) if o else "")


def _norm(t):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", (t or "").lower())).strip()


def similarity(a, b):
    """0..1: the larger of the character-sequence ratio and the word-set overlap of two normalized texts (simple, free, good enough for openings)."""
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return 0.0
    wa, wb = set(a.split()), set(b.split())
    return max(difflib.SequenceMatcher(None, a, b).ratio(), len(wa & wb) / max(1, len(wa | wb)))


# ---------------------------------------------------------------------------------------------------------------- forced looks (tests, Spark)
_LOOK_TAG = re.compile(r"\[look:([^\]]*)\]", re.I)


def parse_look(*texts):
    """A job's brief or note may carry [look:layout=L2,hook=myth,end=qa,icon=badge,accent=1,segment=myth-or-fact] to pin dimensions (tests, Spark)."""
    out = {}
    for t in texts:
        for m in _LOOK_TAG.finditer(t or ""):
            for kv in m.group(1).split(","):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    out[k.strip().lower()] = v.strip()
    return out


def strip_look(text):
    return _LOOK_TAG.sub("", text or "").strip()


# ---------------------------------------------------------------------------------------------------------------- ledger / series reads
def _recent(brand, n, exclude_item=None):
    rows = lib.get("studio_look_ledger", "select=job_id,item_id,fingerprint,opening,hook,segment,ep,item_code,created_at"
                   f"&brand_slug=eq.{brand}&state=eq.filed&superseded=eq.false&order=created_at.desc&limit={n + 3}") or []
    rows = [r for r in rows if not (exclude_item and r.get("item_id") == exclude_item)]
    return rows[:n]


def _recent_other(brand, n=6):
    rows = lib.get("studio_look_ledger", "select=brand_slug,fingerprint,created_at&state=in.(filed,planned)&superseded=eq.false"
                   f"&order=created_at.desc&limit={n * 3}") or []
    rows = [r for r in rows if r["brand_slug"] != brand and (r.get("fingerprint") or {}).get("layout") not in (None, "legacy")]
    return rows[:n]


def segments(brand):
    return lib.get("studio_segments", f"select=key,kicker,blurb,hooks&brand_slug=eq.{brand}&active=is.true&order=sort") or []


def dims_for(cfg, brand=None):
    d = ["layout", "hook", "accent", "track", "end"]
    if cfg.get("icons") or cfg.get("icon_styles"):
        d.append("icon")
    if cfg.get("unit_moments"):
        d.append("unit")
    return d


def accent_options(cfg, theme):
    """[(hex, accent2 or None)] approved for this brand (and ground). A bare string list or a {theme: list} dict in the brand's CFG['accents']."""
    a = cfg.get("accents")
    if isinstance(a, dict):
        a = a.get(theme) or a.get("*") or []
    out = []
    for x in a or []:
        out.append((x, None) if isinstance(x, str) else (x[0], x[1] if len(x) > 1 else None))
    return out


def _accent_value(theme, hexv):
    return f"{theme}/{hexv}"


# ---------------------------------------------------------------------------------------------------------------- the plan
def _diff(fp, row_fp, dims):
    n = 0
    for d in dims:
        a, b = fp.get(d), (row_fp or {}).get(d)
        if a in (None, "", "unknown", "legacy") or b in (None, "", "unknown", "legacy") or a != b:
            n += 1
    return n


def pick_unit(cfg, recent, forced=None):
    """Which unit moment this video shows. Only moments whose frames are on disk; never the one the last video used; then the one used longest
    ago (a moment not seen in the last 8 videos comes first). forced pins it (tests, Spark: [look:unit=turn])."""
    kit = cfg.get("unit_kit") or unit_moment.KIT
    have = [m for m in cfg["unit_moments"] if m in unit_moment.available(kit)]
    if not have:
        raise RuntimeError(f"{cfg['name']} needs the 3D unit but no frames are installed in {kit} (python3 tools/montage/unit3d: see README)")
    if forced in have:
        return forced
    seen = [(r.get("fingerprint") or {}).get("unit") for r in recent]
    last = seen[0] if seen else None
    pool = [m for m in have if m != last] or have

    def rank(m):          # 0 = used by the last video, 99 = not used in the last 8
        return seen.index(m) if m in seen else 99
    top = max(rank(m) for m in pool)
    return random.choice([m for m in pool if rank(m) == top])


def make_plan(cfg, job, theme, parent_look=None, forced=None, tried=None):
    """Pick the look + the segment for one video. forced pins dimensions (tests). tried = look keys that already failed the gate (not picked again)."""
    brand, forced, tried = cfg["slug"], forced or {}, set(tried or [])
    has_icon = bool(cfg.get("icons"))
    dims = [d for d in dims_for(cfg) if d != "track"]
    recent = _recent(brand, LAST_VIDEOS, exclude_item=job.get("parent_item_id"))
    other = _recent_other(brand)
    segs = segments(brand)
    seg_use = [r.get("segment") for r in recent]
    seg = None
    if forced.get("segment"):
        seg = next((s for s in segs if s["key"] == forced["segment"]), None)
    if not seg and segs:
        pool = [s for s in segs if forced.get("hook") not in HOOKS or not s.get("hooks") or forced["hook"] in s["hooks"]] or segs

        def rank(s):          # 0 = used by the last video, 99 = not used in the last 8: pick from the least recently used
            return seg_use.index(s["key"]) if s["key"] in seg_use else 99
        top = max(rank(s) for s in pool)
        seg = random.choice([s for s in pool if rank(s) == top])
    hooks_ok = [h for h in cfg.get("hooks", HOOKS)]
    if forced.get("hook") in HOOKS:
        hook_pool = [forced["hook"]]
    else:
        hook_pool = [h for h in hooks_ok if not seg or not seg.get("hooks") or h in seg["hooks"]] or hooks_ok
    layouts = [forced["layout"]] if forced.get("layout") in LAYOUT_SETS else list(LAYOUT_SETS)
    ends = [forced["end"]] if forced.get("end") in END_LAYOUTS else list(cfg.get("end_layouts", END_LAYOUTS))
    icons = ([forced["icon"]] if forced.get("icon") in ICON_STYLES else list(ICON_STYLES)) if has_icon else ["none"]
    unit = pick_unit(cfg, recent, forced.get("unit")) if cfg.get("unit_moments") else None
    acc = accent_options(cfg, theme) or [(None, None)]
    if forced.get("accent", "").isdigit() and int(forced["accent"]) < len(acc):
        acc = [acc[int(forced["accent"])]]
    best, best_score = [], None
    for _ in range(260):
        c = {"layout": random.choice(layouts), "hook": random.choice(hook_pool), "end": random.choice(ends), "icon": random.choice(icons)}
        if unit:
            c["unit"] = unit
        a = random.choice(acc)
        c["accent"] = _accent_value(theme, a[0]) if a[0] else theme
        key = "|".join(str(c[d]) for d in dims if d in c)
        if key in tried:
            continue
        diffs = [_diff(c, r.get("fingerprint"), dims) for r in recent] or [len(dims)]
        collide = sum(1 for r in other[:6] if (r["fingerprint"] or {}).get("layout") == c["layout"]) * 2 + \
            sum(1 for r in other[:4] if (r["fingerprint"] or {}).get("end") == c["end"] and (r["fingerprint"] or {}).get("icon") == c["icon"])
        score = (min(min(diffs), MIN_DIFF_PLAN + 1), -collide, sum(diffs))
        if best_score is None or score > best_score:
            best, best_score = [(c, a)], score
        elif score == best_score:
            best.append((c, a))
    if not best:
        raise VarietyHold("no look left to try")
    c, a = random.choice(best)
    plan = {"layout": c["layout"], "templates": list(LAYOUT_SETS[c["layout"]]), "hook": c["hook"], "end": c["end"], "icon": c["icon"],
            "accent": c["accent"], "accent_hex": a[0], "accent2": a[1], "segment": seg, "key": "|".join(str(c[d]) for d in dims if d in c),
            **({"unit": unit} if unit else {})}
    plan["min_diff_planned"] = min(_diff(c, r.get("fingerprint"), dims) for r in recent) if recent else None
    return plan


def fingerprint(plan, theme=None):
    fp = {"layout": plan["layout"], "hook": plan["hook"], "accent": plan["accent"], "end": plan["end"], "icon": plan["icon"], "track": None}
    if plan.get("unit"):
        fp["unit"] = plan["unit"]
    return fp


# ---------------------------------------------------------------------------------------------------------------- series
def series_for(cfg, job, parent_script, log=None):
    """{ep,total,label,name,tease:{ep,topic}|None} for this video; a re-cut keeps its parent's number. None when the brand has no series."""
    brand = cfg["slug"]
    try:
        pl = (parent_script or {}).get("look") or {}
        pep = (pl.get("series") or {}).get("ep")
        if parent_script and pep:
            return lib.rpc("studio_series_info", p_brand=brand, p_ep=int(pep))
        return lib.rpc("studio_series_take", p_brand=brand, p_job=job["id"])
    except Exception as e:  # noqa: BLE001  (a series problem must never stop a video)
        if log:
            log(f"series skipped: {str(e)[:120]}")
        return None


def series_label(s):
    """'Tip 3 of 8' (or 'Tip 9' once past the planned total)."""
    if not s:
        return ""
    return f"{s['label']} {s['ep']} of {s['total']}" if s["ep"] <= s["total"] else f"{s['label']} {s['ep']}"


def tease_for(cfg, s, claims, log=None):
    """The next planned topic of the series, checked against the brand's claim rules; None (and a Spark note) when there is none or it fails."""
    t = (s or {}).get("tease") or {}
    topic = (t.get("topic") or "").strip()
    if not topic:
        return None
    errs = claims([("tease topic", topic)]) if claims else []
    if errs:
        if log:
            log(f"tease dropped: {errs[0][:120]}")
        _series_alert(cfg["slug"], f"The next planned topic for {cfg['name']} ('{topic}') failed the claim rules ({errs[0][:200]}). Fix it in studio_series_topics.")
        return None
    return topic


def _series_alert(brand, why):
    try:
        lib.notify(f"Spark: {brand} video series needs a look", why[:600], severity="info", push=False, url="/admin/team",
                   dedupe=f"montage.series-{brand}-{__import__('time').strftime('%Y-%m-%d')}")
    except Exception as e:  # noqa: BLE001
        print("series alert failed:", e, flush=True)


# ---------------------------------------------------------------------------------------------------------------- prompt + checks
def prompt_block(cfg, plan, series, n_scenes=5):
    seg = plan.get("segment")
    tpl = plan["templates"][:n_scenes]
    lines = ["", "VARIETY (this video must not look or sound like the last ones; all of this is required):"]
    if series:
        lines.append(f'- This is {series_label(series)} of the series "{series["name"]}".')
    if seg:
        lines.append(f'- Segment "{seg["kicker"]}": {seg["blurb"]}. Everything in the video serves that segment.')
    lines.append("- " + HOOK_RULES[plan["hook"]].format(stat_hint=cfg.get("stat_hint") or STAT_HINT_DEFAULT))
    lines.append("- Scene layouts, in order: " + ", ".join(f"scene {i + 1} = {t}" for i, t in enumerate(tpl)) + ".")
    lines.append('  A "stat" scene also needs "big": 1 to 3 words shown huge on screen (a count word or the key word of the line, no digits, no full stop), '
                 'and its "line" explains it in one sentence.')
    lines.append('  A "steps" scene also needs "items": a list of 2 or 3 short steps, 1 to 5 words each, no end punctuation; its "line" introduces them.')
    lines.append('- Add the key "question" (top level): ONE easy question viewers can answer in a few words in the comments, 4 to 12 words, ends with "?", '
                 'about their own work or home (never about buying). No "comment below", no "tag a friend".')
    feed = house_feed(cfg["slug"])
    seen = [x for x in (feed.get("recent") or []) if x.get("opening")][:20]
    if seen:
        lines.append("- Already posted or queued for this brand (images and videos): do not repeat an idea, a first line or a phrase from these:\n  "
                     + "\n  ".join("* " + x["opening"][:90] for x in seen))
    top = feed.get("top") or []
    if top:
        lines.append("- What got the most response so far (small numbers, a hint and not a law): "
                     + "; ".join(f"\"{(t.get('opening') or '')[:70]}\" ({t.get('likes') or 0} likes, {t.get('comments') or 0} comments)" for t in top[:3]))
    rej = feed.get("rejects") or []
    if rej:
        lines.append("- Recent posts of this brand were sent back for: " + "; ".join(f"{x.get('k')} x{x.get('n')}" for x in rej[:4])
                     + ". Keep every line short, inside the middle of the screen, and never put words on a face.")
    if plan["end"] == "qa":
        lines.append('- Add the key "recap" (top level): {"q": "<the question this video answers, 3 to 10 words, ends with ?>", "a": "<the plain answer, '
                     '4 to 12 words, ends with a full stop>"}; they appear together on the closing card.')
    return "\n".join(lines) + "\n"


def _wc(t):
    return len((t or "").split())


def check(cfg, plan, p, scene_count):
    """Errors for the variety fields of a script (hook followed, big/items present for their templates, question, recap)."""
    e = []
    scenes = p.get("scenes") or []
    allow_num = bool(cfg.get("allow_numbers"))
    hook = plan["hook"]
    if scenes:
        l1 = (scenes[0].get("line") or "").strip()
        if hook == "question" and not l1.endswith("?"):
            e.append('hook is a question: scene 1 line must be one short question ending with "?"')
        if hook != "question" and "?" in l1:
            e.append("scene 1 line must not be a question for this opening style")
        if hook == "myth":
            if not re.match(r"^myth\s*:", l1, re.I):
                e.append('hook is myth versus fact: scene 1 line must start with "Myth:"')
            if len(scenes) > 1 and not re.match(r"^fact\s*:", (scenes[1].get("line") or "").strip(), re.I):
                e.append('hook is myth versus fact: scene 2 line must start with "Fact:"')
        if hook == "story" and not re.match(r"^picture\b", l1, re.I):
            e.append('hook is a quick story: scene 1 line must start with "Picture"')
        if hook == "stat" and not (COUNTWORD.match(l1) or (allow_num and re.match(r"^(\$|\d)", l1))):
            e.append("hook is a bold count: scene 1 line must start with a count word like One, Two or Three" + (" or a number from the facts" if allow_num else ""))
    for i, s in enumerate(scenes[:scene_count]):
        t = plan["templates"][i]
        if t == "stat":
            b = (s.get("big") or "").strip()
            if not 1 <= _wc(b) <= 3 or len(b) > 20 or b.endswith((".", "!", "?")) or (re.search(r"\d", b) and not allow_num):
                e.append(f'scene {i + 1} is a "stat" scene: add "big" of 1 to 3 words (at most 20 letters, no digits, no end punctuation)')
        if t == "steps":
            it = s.get("items")
            if not isinstance(it, list) or not 2 <= len(it) <= 3 or any(not isinstance(x, str) or not 1 <= _wc(x) <= 5 or len(x) > 32 or x.strip().endswith((".", "!", "?"))
                                                                          or (re.search(r"\d", x) and not allow_num) for x in it):
                e.append(f'scene {i + 1} is a "steps" scene: add "items", a list of 2 or 3 steps of 1 to 5 words each (no end punctuation, no digits)')
    q = (p.get("question") or "").strip()
    if not q.endswith("?") or q.count("?") != 1 or not 4 <= _wc(q) <= 14 or BAIT_Q.search(q) or (re.search(r"\d", q) and not allow_num):
        e.append('"question" must be ONE easy comment question of 4 to 12 words ending with "?" (no digits, no "comment below")')
    if plan["end"] == "qa":
        r = p.get("recap") if isinstance(p.get("recap"), dict) else {}
        rq, ra = (r.get("q") or "").strip(), (r.get("a") or "").strip()
        if not rq.endswith("?") or not 3 <= _wc(rq) <= 11 or rq.count("?") != 1:
            e.append('"recap.q" must be 3 to 10 words ending with "?"')
        if not 4 <= _wc(ra) <= 13 or not ra.endswith(".") or "?" in ra:
            e.append('"recap.a" must be 4 to 12 words ending with a full stop')
    return e


def extra_pieces(plan, p):
    """(label, text) pairs the claim rules must also read."""
    out = [("comment question", p.get("question") or "")]
    for i, s in enumerate(p.get("scenes") or [], 1):
        if s.get("big"):
            out.append((f"scene {i} big word", s["big"]))
        if s.get("items"):
            out.append((f"scene {i} steps", ". ".join(s["items"])))
    if plan["end"] == "qa" and isinstance(p.get("recap"), dict):
        out += [("closing card question", p["recap"].get("q") or ""), ("closing card answer", p["recap"].get("a") or "")]
    return [(w, t) for w, t in out if t.strip()]


# ---------------------------------------------------------------------------------------------------------------- gate + record
def _lead(t):
    """The first sentence of an opening."""
    return re.split(r"(?<=[.?!])\s", (t or "").strip(), maxsplit=1)[0]


def gate(cfg, job, plan, out, opening_check=True):
    """-> (ok, why). Dimensions: >= 3 of the brand's look dimensions must differ from each of its last 8 videos; the opening must not be
    near-identical to any of the last 20 openings. (The music track is added later; the picker keeps it off the last two.)"""
    brand = cfg["slug"]
    dims = [d for d in dims_for(cfg) if d != "track"]
    fp = fingerprint(plan)
    recent = _recent(brand, LAST_OPENINGS, exclude_item=job.get("parent_item_id"))
    why = []
    if cfg.get("unit_moments"):        # the unit moment is counted: it must be one of the brand's moments and not a repeat of the last video's
        last = ((recent[0].get("fingerprint") or {}).get("unit") if recent else None)
        if plan.get("unit") not in cfg["unit_moments"]:
            why.append(f"no valid 3D unit moment in the plan ({plan.get('unit')})")
        elif plan.get("unit") == last and len(cfg["unit_moments"]) > 1:
            why.append(f"3D unit moment '{plan.get('unit')}' repeats the last video's")
    for r in recent[:LAST_VIDEOS]:
        d = _diff(fp, r.get("fingerprint"), dims)
        if d < MIN_DIFF:
            why.append(f"looks too much like {r.get('item_code') or str(r['job_id'])[:8]} (only {d} of {len(dims)} look choices differ)")
    first = (out["scenes"][0] if out.get("scenes") else {})
    opening = f"{first.get('line', '')} {first.get('say', '')}".strip()
    lead = _lead(first.get("line") or opening)          # the hook sentence only: every say carries the same "what it is" sentence, which is not the hook
    for r in (recent if opening_check else []):
        sim = similarity(lead, _lead(r.get("opening")))
        if sim >= OPENING_LIMIT:
            why.append(f"opening is {sim:.0%} the same as {r.get('item_code') or str(r['job_id'])[:8]}'s ('{(r.get('opening') or '')[:60]}')")
            break
    if opening_check and not why:
        ok, hw = house_probe(brand, "\n\n".join(x for x in (first.get("line"), first.get("say")) if x))
        if not ok:
            why.append(hw)
    return (not why), "; ".join(why), opening, fp


def record(cfg, job, plan, fp, opening, series, state="planned"):
    try:
        lib.rpc("studio_look_record", p_job=job["id"], p={
            "brand": cfg["slug"], "fingerprint": fp, "opening": opening, "hook": plan["hook"],
            "segment": (plan.get("segment") or {}).get("key"), "ep": (series or {}).get("ep"), "state": state})
    except Exception as e:  # noqa: BLE001
        print("look record failed:", e, flush=True)


def set_track(job_id, track_id):
    try:
        lib.rpc("studio_look_set", p_job=job_id, p_key="track", p_val=str(track_id))
    except Exception as e:  # noqa: BLE001
        print("look track failed:", e, flush=True)


def set_state(job_id, state):
    try:
        lib.rpc("studio_look_state", p_job=job_id, p_state=state)
    except Exception as e:  # noqa: BLE001
        print("look state failed:", e, flush=True)


# ---------------------------------------------------------------------------------------------------------------- decorate a finished script
def decorate(cfg, out, plan, series, tease, p, caption_core, scene_count=None):
    """Put the look on a finished script: per-scene layout/big/items, end-card layout + recap + tease + follow, the series tag, the segment
    kicker, the spoken tease, and the caption (series line, body, Next, comment question, hashtags last)."""
    seg = plan.get("segment")
    n = len(out["scenes"])
    for i, s in enumerate(out["scenes"]):
        t = plan["templates"][i % len(plan["templates"])]
        src = (p.get("scenes") or [{}] * n)[i] if i < len(p.get("scenes") or []) else {}
        if t == "stat" and not (src.get("big") or "").strip():
            t = FALLBACK["stat"]
        if t == "steps" and not (isinstance(src.get("items"), list) and len(src["items"]) >= 2):
            t = FALLBACK["steps"]
        if s.get("card"):
            t = "card"
        s["layout"] = t
        if t == "stat":
            b = src["big"].strip()
            s["big"] = b[:1].upper() + b[1:]
        if t == "steps":
            s["items"] = [x.strip() for x in src["items"][:3]]
    if seg and out["scenes"]:
        out["scenes"][0]["kicker"] = seg["kicker"]
    e = out["end"]
    e["layout"] = plan["end"]
    if plan["end"] == "qa" and isinstance(p.get("recap"), dict):
        e["recap"] = {"q": p["recap"]["q"].strip(), "a": p["recap"]["a"].strip()}
    elif plan["end"] == "qa":
        e["layout"] = "claim"
    follow = ""
    if series and series["ep"] < 99:
        follow = f"Follow for {series['label'].lower()} {words(series['ep'] + 1)}." if series["ep"] < series["total"] else "Follow for more."
    elif series is None:
        follow = "Follow for more."
    if tease:
        e["tease"] = tease
    e["follow"] = f"Follow for {series['label']} {series['ep'] + 1}" if series and series["ep"] < series["total"] else "Follow for more"
    if tease or follow:
        e["say"] = (e.get("say") or "").rstrip() + (f" Next: {tease}." if tease else "") + (f" {follow}" if follow else "")
    q = (p.get("question") or "").strip()
    # caption: series line, body (writer's), non-hashtag tail, Next, comment question, hashtag tail last
    tail = (cfg.get("tail") or "").strip()
    parts = []
    if series:
        parts.append(f"{series_label(series)}" + (f": {seg['kicker']}" if seg else ""))
    parts.append(caption_core.strip())
    if tail and not tail.startswith("#"):
        parts.append(tail)
    if tease:
        parts.append(f"Next: {tease}.")
    if q:
        parts.append(q)
    if tail and tail.startswith("#"):
        parts.append(tail)
    out["caption"] = "\n\n".join(x for x in parts if x)
    out["caption_core"] = caption_core.strip()
    out["look"] = {"layout": plan["layout"], "hook": plan["hook"], "accent": plan["accent"], "accent_hex": plan.get("accent_hex"), "accent2": plan.get("accent2"),
                   "end": e["layout"], "icon": plan["icon"], "segment": (seg or {}).get("key"), "question": q,
                   "series": ({"ep": series["ep"], "total": series["total"], "label": series["label"], "name": series["name"]} if series else None),
                   "tease": tease, "templates": [s["layout"] for s in out["scenes"]]}
    if plan.get("unit"):       # the Bestly Cloud 3D unit moment (unit_moment.py): on a scene or the closing card
        where = unit_moment.assign(out, plan["unit"], cfg.get("unit_kit") or unit_moment.KIT)
        out["look"]["unit"] = where
        out["look"]["templates"] = [s["layout"] for s in out["scenes"]]
    return out
