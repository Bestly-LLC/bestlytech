"""Bestly's own Instagram + Facebook posts, made fresh the day they go out (v2, 2026-10-04).

  bestly_social daily      every day but Tuesday: plan, write, render and post one new card
  bestly_social carousel   Tuesdays: plan, write, render and post one new 5-slide carousel
  bestly_social stats      nightly: likes + comments for every Bestly post -> bestly_social_history
  bestly_social learn      weekly: what is working, with sample sizes -> social_lessons (read by the planner)
  --dry                    plan + render + upload to a dry/ folder + Instagram rehearsal; publishes nothing
  --render-only            plan + render to /tmp only (no upload, no Instagram)

Jared 2026-10-04: content is made day by day as needed, and learns from how it does.
How it learns:
- Every post is recorded with its theme, layout, headline, device angle and caption (bestly_social_history).
- `stats` pulls likes and comments nightly (the Meta app has no insights permission, so reach and saves
  are not available; with only a handful of followers the signal is small and is always reported with N).
- Topic choice is explore/exploit: 30% of days try the least-used theme (or a new one the planner proposes),
  otherwise the theme with the best average engagement (N >= 2), never one used in the last 4 posts.
- `learn` writes up to 5 lessons as observations with N attached (never a "winner" below N=10); the planner
  reads the latest lessons before writing.
Safety: rule checks in code on every line of copy; product named only in the caption's last paragraph /
the carousel's last slide; one post a day max (Instagram feed check); each channel called once. If the
maker fails, the day falls back to the ready-made pool in bestly.tech/social/MANIFEST.json, and Scout is told.
Rendering: /opt/bestly/social-kit/card.html in headless Chromium (repo social/scripts/card-kit/pi).
"""
import calendar
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
import playbook  # noqa: E402  (2026-10-06: content playbook, see playbook.py)

MANIFEST = "https://bestly.tech/social/MANIFEST.json"
HEALTH = "https://bestly.tech/cloud"
UA = {"User-Agent": "bestly-pi-cron/1.0 (+https://bestly.tech)"}
KIT = "/opt/bestly/social-kit"
BUCKET = "social-media"
DEVICES = [f"dev{i:02d}.png" for i in range(1, 13)]


def _wide_devices():
    """Renders wider than tall sit well in the corner layouts (A, C, slide 1); tall ones only in B / slide 5."""
    try:
        from PIL import Image
        return [d for d in DEVICES if (lambda s: s[0] >= s[1])(Image.open(f"{KIT}/devices/{d}").size)] or DEVICES
    except Exception:  # noqa: BLE001
        return DEVICES

PRODUCT = ("Bestly Cloud is a private cloud for small businesses: files, calendar, contacts, chat, a password vault and notes "
           "in one box, run for them as a managed appliance or kept on-site. No per-seat pricing, no lock-in. Voice: "
           "privacy-first, plain-spoken, \"we run it, so you don't have to\". Never claim unlimited anything, speed, HIPAA or "
           "SOC 2, or any price. What Bestly Cloud does, and the ONLY things you may say it does: runs those apps on one box "
           "the business owns; on the managed plan Bestly handles monitoring, updates, backups and support; each person gets "
           "one account; data stays in open formats the owner can export. Never invent any other feature (no automated "
           "restore tests, no AI, no alerts, no compliance features).")

# Seed themes (the planner may add new ones). Each is a real small-business IT problem.
THEMES = {
    "backups": "untested backups and restores",
    "downtime": "how long it takes to get back up after an outage",
    "software-spend": "per-seat software bills nobody adds up",
    "ownership": "data you cannot export is not yours",
    "access": "who holds the keys: domain, email admin, registrar, bank logins",
    "offboarding": "logins that stay live after someone leaves",
    "domains": "the business domain registered in someone else's name",
    "contracts": "auto-renewals and notice periods",
    "privacy": "free tools that pay for themselves with your data",
    "risk": "small businesses are scanned and attacked too",
    "infrastructure": "too many separate services for one small team",
    "passwords": "shared passwords and the password vault",
    "lock-in": "how switching costs keep you paying",
    "files": "files scattered across personal accounts and drives",
}

DAILY_SYS = "You write one Instagram/Facebook caption for Bestly. Readers are small-business owners. " + PRODUCT + """

The image headline is the anchor. Three beats, in this order:
1. The tip, stated plainly. Genuinely useful even to someone who never buys from Bestly. Concrete and actionable. First line is a short flat statement (no question).
2. Why it is actually hard: one or two lines naming the real constraint (cost, lock-in, time, or who holds the keys).
3. The quiet landing: ONE final sentence, in its own last paragraph, where Bestly answers that constraint. The word Bestly appears only there, once.

Hard rules: no emoji; no hashtags; no "Did you know", "Here's the thing", "Let's dive in" or any question opener; short declarative sentences; never a statistic, percentage, customer count or saving figure; no link; 60 to 160 words; plain text only. Reply with the caption only."""

CAROUSEL_SYS = ("You write one caption for a Bestly carousel post. The slides carry the argument; the caption is the same idea "
                "told once in prose for people who read captions instead of swiping. ") + PRODUCT + """

Shape: open with the hook (or a close variant) as a flat statement, no question. Then two or three lines expanding the practical tip. Then ONE closing sentence, in its own last paragraph, where Bestly answers the constraint the carousel raised. The word Bestly appears only there, once.

Hard rules: no emoji; no hashtags; no "swipe" or engagement bait; no numbered list; never a statistic, percentage or customer count; no link; 50 to 140 words; plain text only. Reply with the caption only."""

PLAN_SINGLE_SYS = "You plan one Instagram card for Bestly. Readers are small-business owners. " + PRODUCT + """

Write a card about the theme you are given. It must be useful to someone who never buys anything: one concrete thing to do.
Reply with ONE JSON object only:
{"headline": "<flat statement, 4 to 9 words, ends with a period, no question>",
 "accent": "<1 to 3 consecutive words copied exactly from the headline, the words to color>",
 "subline": "<one practical instruction, 5 to 14 words, ends with a period>",
 "category": "<1 or 2 words, the topic label shown in the corner>",
 "angle": "<one sentence: why this works for the reader>"}
Rules: no emoji, no hashtags, no numbers used as statistics, no prices; do NOT mention Bestly in the headline or subline;
plain American English; do not reuse a recent headline."""

PLAN_CAROUSEL_SYS = "You plan one 5-slide Instagram carousel for Bestly. Readers are small-business owners. " + PRODUCT + """

Slides: 1 CLAIM (the problem stated flat, no question; the feed thumbnail), 2 WHY IT HIDES (the mechanism that keeps it
invisible), 3 DO THIS (one concrete action this week), 4 THE CATCH (honestly what makes it hard), 5 THE LANDING (the only
slide that names Bestly Cloud, once, answering the catch). Slides 1-4 must be useful to someone who never buys anything.
Reply with ONE JSON object only:
{"hook": "<slide 1, 5 to 9 words, ends with a period>",
 "accent": "<1 to 3 consecutive words copied exactly from the hook>",
 "category": "<1 or 2 words>",
 "slides": [{"h": "<slide 2 headline, 3 to 8 words>", "p": "<1 or 2 sentences, max 30 words>"},
            {"h": "<slide 3 headline>", "p": "<...>"},
            {"h": "<slide 4 headline>", "p": "<...>"},
            {"h": "<slide 5 headline, no product name>", "p": "<names Bestly Cloud exactly once>"}]}
Rules: no emoji, no hashtags, no statistics or prices, Bestly only in slide 5's p; plain American English."""

BAIT = re.compile(r"\b(did you know|here'?s the thing|let'?s dive in|swipe|link in bio|comment below|tag a friend)\b", re.I)
EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️]")
STATS = re.compile(r"\d+(\.\d+)?\s*(%|percent)|\b\d[\d,]*\+?\s*(customers|clients|businesses|users|companies)\b", re.I)
PRICE = re.compile(r"\$\s*\d|\b\d+\s*(dollars|bucks)\b", re.I)

DRY = False


# ---------------------------------------------------------------- copy checks
def _problems(cap):
    p = []
    if EMOJI.search(cap):
        p.append("contains an emoji")
    if "#" in cap:
        p.append("contains a hashtag")
    if BAIT.search(cap):
        p.append("uses an engagement-bait phrase: " + BAIT.search(cap).group(0))
    if STATS.search(cap):
        p.append("states a statistic: " + STATS.search(cap).group(0))
    if PRICE.search(cap):
        p.append("mentions a price")
    if re.search(r"https?://|www\.", cap):
        p.append("contains a link")
    paras = [x for x in re.split(r"\n\s*\n", cap.strip()) if x.strip()]
    first = cap.strip().splitlines()[0] if cap.strip() else ""
    if first.rstrip().endswith("?"):
        p.append("opens with a question")
    n = len(re.findall(r"\bBestly\b", cap))
    if n != 1:
        p.append(f"Bestly appears {n} times (must be exactly once)")
    elif len(paras) < 2 or "Bestly" not in paras[-1]:
        p.append("Bestly must be in the final paragraph only")
    lines = [l for l in cap.strip().splitlines() if l.strip()]
    if any("Bestly" in l for l in lines[:2]) and len(lines) > 2:
        p.append("Bestly is in the first two lines")
    words = len(cap.split())
    if words < 35 or words > 200:
        p.append(f"{words} words (aim 60-160)")
    if re.search(r"^\s*\d+[.)]\s", cap, re.M):
        p.append("contains a numbered list")
    return p


def _line_problems(text, where, lo, hi, product_ok=False):
    p, t = [], (text or "").strip()
    n = len(t.split())
    if not t:
        return [f"{where} is empty"]
    if n < lo or n > hi:
        p.append(f"{where} is {n} words (want {lo}-{hi})")
    if "?" in t:
        p.append(f"{where} asks a question")
    if EMOJI.search(t) or "#" in t:
        p.append(f"{where} has an emoji or hashtag")
    if STATS.search(t) or PRICE.search(t):
        p.append(f"{where} states a statistic or price")
    if not product_ok and re.search(r"\bbestly\b", t, re.I):
        p.append(f"{where} names Bestly (only the caption / last slide may)")
    return p


def _json(text):
    m = re.search(r"\{.*\}", (text or "").strip(), re.S)
    if not m:
        raise ValueError("no JSON in reply")
    return json.loads(m.group(0))


def _ask_json(system, user, check, deadline, tries=3):
    msgs = [{"role": "system", "content": playbook.add(system)}, {"role": "user", "content": user}]
    last = []
    for _ in range(tries):
        msg, provider = freellm.chat(msgs, None, max_tokens=2500, deadline=deadline)
        try:
            plan = _json(msg.get("content"))
            last = check(plan)
        except (ValueError, KeyError, TypeError) as e:
            plan, last = None, [f"reply was not the JSON asked for ({e})"]
        if plan is not None and not last:
            return plan, provider
        msgs += [{"role": "assistant", "content": (msg.get("content") or "")[:3000]},
                 {"role": "user", "content": "Fix these and reply with the JSON only: " + "; ".join(last)}]
    raise RuntimeError("plan failed the rules 3 times: " + "; ".join(last))


def _caption(system, brief, deadline):
    msgs = [{"role": "system", "content": playbook.add(system)}, {"role": "user", "content": brief}]
    last, cap = [], ""
    for _ in range(3):
        # 2500 tokens: Gemini's thinking counts against max_tokens; 700 cut captions off mid-sentence.
        msg, provider = freellm.chat(msgs, None, max_tokens=2500, deadline=deadline)
        cap = (msg.get("content") or "").strip().strip('"').strip()
        cap = re.sub(r"^(caption|here is the caption)\s*:\s*", "", cap, flags=re.I).strip()
        last = _problems(cap)
        if not last:
            return cap, provider
        msgs += [{"role": "assistant", "content": cap},
                 {"role": "user", "content": "Fix these and reply with the caption only: " + "; ".join(last)}]
    raise RuntimeError("caption failed the rules 3 times: " + "; ".join(last) + " | last try: " + cap[:300])


# ---------------------------------------------------------------- data
def _http_ok(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def _manifest():
    with urllib.request.urlopen(urllib.request.Request(MANIFEST, headers=UA), timeout=30) as r:
        return json.load(r)


def _history(kind, n=60):
    return lib.get("bestly_social_history",
                   f"select=id,at,asset,layout,theme,headline,likes,comments,details&kind=eq.{kind}&order=at.desc&limit={n}") or []


def _lessons():
    r = lib.get("social_lessons", "select=lessons,made_at&brand=eq.bestly&order=made_at.desc&limit=1") or []
    return r[0]["lessons"] if r else []


def _invoke(fn, payload, timeout_ms, polls, wait):
    """invoke_edge_function returns a pg_net request id at once; the answer lands in net._http_response."""
    rid = lib.rpc("invoke_edge_function", function_slug=fn, payload=payload, timeout_ms=timeout_ms)
    time.sleep(wait)
    for _ in range(polls):
        r = lib.rpc("pi_http_result", p_id=rid)
        if r and r.get("status_code") is not None:
            try:
                body = json.loads(r.get("content") or "{}")
            except ValueError:
                body = {"raw": (r.get("content") or "")[:500]}
            return r["status_code"], body
        if r and (r.get("timed_out") or r.get("error_msg")):
            return None, {"error": r.get("error_msg") or "timed out"}
        time.sleep(wait)
    return None, {"error": "no answer yet (still in flight?) - not retried, to avoid a double post"}


def _graph(rpc_name, wait=4, polls=6):
    """Start a Graph read inside the database (token never leaves it) and return the sanitized JSON."""
    rid = lib.rpc(rpc_name)
    for _ in range(polls):
        time.sleep(wait)
        r = lib.rpc("pi_http_result", p_id=rid)
        if r and r.get("status_code") is not None:
            try:
                return r["status_code"], json.loads(r.get("content") or "{}")
            except ValueError:
                return r["status_code"], {}
    return None, {"error": "no answer"}


def _record(kind, asset, layout, theme, caption, ig, fb, headline=None, made_by="daily-maker", details=None, media_id=None):
    lib._req("POST", "/rest/v1/bestly_social_history", {
        "kind": kind, "asset": asset, "layout": layout, "theme": theme, "caption": caption,
        "ig_ok": ig[0], "ig_permalink": ig[1], "fb_ok": fb[0], "fb_post_id": fb[1],
        "error": (ig[2] or fb[2] or None), "source": "pi", "headline": headline, "made_by": made_by,
        "details": details or {}, "ig_media_id": media_id})


def _alert(title, body, warn=True):
    if DRY:
        print("(dry, no alert) " + title + ": " + body[:300])
        return
    lib.notify(title, body[:1500], severity="warning" if warn else "info", push=warn,
               url="https://www.instagram.com/bestly_llc/", dedupe="bestly-social-" + time.strftime("%Y%m%d") + "-" + title[:20])


# ---------------------------------------------------------------- learning: what to make today
def _theme_scores(rows):
    s = {}
    for r in rows:
        if r.get("likes") is None and r.get("comments") is None:
            continue
        v = (r.get("likes") or 0) + 2 * (r.get("comments") or 0)
        s.setdefault(r.get("theme") or "?", []).append(v)
    return {t: (sum(v) / len(v), len(v)) for t, v in s.items()}


def _pick_theme(hist, avoid_n, explore=0.3):
    recent = [h.get("theme") for h in hist[:avoid_n]]
    used = {}
    for h in hist:
        used[h.get("theme")] = used.get(h.get("theme"), 0) + 1
    pool = [t for t in THEMES if t not in recent] or list(THEMES)
    scores = _theme_scores(hist)
    proven = [t for t in pool if scores.get(t, (0, 0))[1] >= 2]
    if proven and random.random() > explore:
        t = max(proven, key=lambda t: scores[t][0])
        return t, f"exploit: best average engagement {scores[t][0]:.1f} (N={scores[t][1]})"
    least = min(used.get(t, 0) for t in pool)
    t = random.choice([t for t in pool if used.get(t, 0) == least])
    return t, f"explore: used {least} time(s) before"


def _learning_brief(hist):
    lessons = _lessons()
    recent = "\n".join(f"- {h.get('at','')[:10]} [{h.get('theme')}] {h.get('headline') or h.get('asset')} "
                       f"(likes {h.get('likes') if h.get('likes') is not None else '?'}, comments {h.get('comments') if h.get('comments') is not None else '?'})"
                       for h in hist[:12])
    out = "Recent posts (do not repeat their headlines or angles):\n" + (recent or "(none)")
    if lessons:
        out += "\n\nWhat we have learned so far (observations with sample sizes):\n" + "\n".join(f"- {l}" for l in lessons[:5])
    return out


def _last(hist, key, n):
    return [((h.get("details") or {}).get(key)) for h in hist[:n]]


# ---------------------------------------------------------------- render + upload
def _render(spec, out):
    """Headless Chromium on the card kit. The page fits itself and reports in <body data-fit>."""
    url = "file://" + KIT + "/card.html#" + urllib.parse.quote(json.dumps(spec))
    base = ["chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
            "--allow-file-access-from-files", "--window-size=1080,1400", "--virtual-time-budget=6000"]
    dom = subprocess.run(base + ["--dump-dom", url], capture_output=True, text=True, timeout=90).stdout
    m = re.search(r'data-fit="([^"]*)"', dom)
    fit = json.loads(m.group(1).replace("&quot;", '"')) if m else None
    subprocess.run(base + ["--screenshot=" + out, url], capture_output=True, timeout=90)
    from PIL import Image  # python3-pil
    im = Image.open(out).convert("RGB")
    im = im.crop((0, 0, 1080, 1080))
    if max(im.getextrema()[0][1], im.getextrema()[1][1], im.getextrema()[2][1]) < 40:
        raise RuntimeError("render came out blank")
    im.save(out, optimize=True)
    if not fit or not fit.get("ok"):
        raise RuntimeError(f"card did not fit: {fit}")
    return fit


def _upload(path, name):
    with open(path, "rb") as f:
        data = f.read()
    h = {"apikey": lib.KEY, "Content-Type": "image/png", "x-upsert": "true"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    req = urllib.request.Request(f"{lib.URL}/storage/v1/object/{BUCKET}/{name}", data=data, method="POST", headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()
    url = f"{lib.URL}/storage/v1/object/public/{BUCKET}/{name}"
    if not _http_ok(url):
        raise RuntimeError("uploaded image is not publicly readable")
    return url


# ---------------------------------------------------------------- daily: one fresh card
def _make_single(hist, deadline):
    theme, why = _pick_theme(hist, avoid_n=4)
    def check(p):
        e = _line_problems(p.get("headline"), "headline", 4, 10) + _line_problems(p.get("subline"), "subline", 5, 16)
        if p.get("accent") and p["accent"] not in (p.get("headline") or ""):
            e.append("accent must be copied exactly from the headline")
        if not p.get("category"):
            e.append("category missing")
        return e
    user = (f"Theme: {theme} - {THEMES[theme]}\n\n{_learning_brief(hist)}")
    plan, prov = _ask_json(PLAN_SINGLE_SYS, user, check, deadline)
    last_layouts = [h.get("layout") for h in hist[:1]]
    layout = random.choice([l for l in "ABC" if l not in last_layouts])
    fits = _wide_devices() if layout in "AC" else DEVICES
    devs = [d for d in fits if d not in _last(hist, "device", 4)]
    dev = random.choice(devs or fits)
    spec = {"layout": layout, "cat": plan["category"][:24], "h": plan["headline"].strip(),
            "accent": (plan.get("accent") or "").strip(), "p": plan["subline"].strip(), "dev": dev}
    out = f"/tmp/bestly-card-{uuid.uuid4().hex[:8]}.png"
    fit = _render(spec, out)
    return {"theme": theme, "why": why, "plan": plan, "planner": prov, "spec": spec, "fit": fit, "file": out}


def _daily_fresh(dry, render_only, deadline):
    hist = _history("daily")
    made = _make_single(hist, deadline)
    p = made["plan"]
    if render_only:
        return f"render-only: {made['file']} [{made['theme']}: {made['why']}] {json.dumps(p)[:400]}"
    name = f"bestly/{'dry/' if dry else ''}daily/{time.strftime('%Y-%m-%d')}-{uuid.uuid4().hex[:6]}.png"
    url = _upload(made["file"], name)
    cap, cprov = _caption(DAILY_SYS, f"Image headline: {p['headline']}\nImage subline: {p['subline']}\nTheme: {made['theme']} - {THEMES[made['theme']]}", deadline)
    details = {"device": made["spec"]["dev"], "accent": made["spec"]["accent"], "subline": p["subline"], "category": p["category"],
               "angle": p.get("angle"), "why": made["why"], "planner": made["planner"], "writer": cprov, "fit": made["fit"], "url": url}
    if dry:
        code, body = _invoke("bestly-ig-poster", {"action": "dryrun", "brand": "bestly", "mediaUrl": url, "caption": cap}, 120000, 5, 15)
        return f"dry: made [{made['theme']}] '{p['headline']}' ({made['why']}); IG rehearsal {code} {json.dumps(body)[:160]}\n{url}\n---\n{cap}"
    ic, ib = _invoke("bestly-ig-poster", {"action": "post", "brand": "bestly", "mediaUrl": url, "caption": cap}, 120000, 6, 20)
    fc, fb = _invoke("bestly-fb-photo", {"action": "post", "brand": "bestly", "imageUrl": url, "message": cap}, 60000, 5, 15)
    ig = (bool(ib.get("ok")), ib.get("permalink"), None if ib.get("ok") else f"IG {ic}: {json.dumps(ib)[:400]}")
    fbr = (bool(fb.get("ok")), fb.get("postId"), None if fb.get("ok") else f"FB {fc}: {json.dumps(fb)[:400]}")
    _record("daily", name, made["spec"]["layout"], made["theme"], cap, ig, fbr, headline=p["headline"],
            details=details, media_id=ib.get("remoteId"))
    return _report("daily post", f"'{p['headline']}'", ig, fbr)


# ---------------------------------------------------------------- carousel: five fresh slides
def _carousel_fresh(dry, render_only, deadline):
    hist = _history("carousel")
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 56 * 86400))
    recent_themes = {h.get("theme") for h in hist if h["at"] >= since}
    pseudo = [{"theme": t} for t in recent_themes] + hist
    theme, why = _pick_theme(pseudo, avoid_n=len(recent_themes))
    def check(p):
        e = _line_problems(p.get("hook"), "hook", 4, 10)
        if p.get("accent") and p["accent"] not in (p.get("hook") or ""):
            e.append("accent must be copied exactly from the hook")
        s = p.get("slides") or []
        if len(s) != 4:
            return e + ["slides must have exactly 4 entries (slides 2 to 5)"]
        for i, sl in enumerate(s, start=2):
            e += _line_problems(sl.get("h"), f"slide {i} headline", 3, 9)
            e += _line_problems(sl.get("p"), f"slide {i} text", 8, 34, product_ok=(i == 5))
        if s and len(re.findall(r"\bBestly\b", s[3].get("p") or "")) != 1:
            e.append("slide 5 text must name Bestly Cloud exactly once")
        return e
    plan, prov = _ask_json(PLAN_CAROUSEL_SYS, f"Theme: {theme} - {THEMES[theme]}\n\n{_learning_brief(hist)}", check, deadline)
    devs = [random.choice(_wide_devices()), random.choice(DEVICES)]
    kicks = ["Why it hides", "Do this", "The catch"]
    specs = [{"layout": "S1", "cat": "1 / 5", "h": plan["hook"], "accent": plan.get("accent") or "", "dev": devs[0]}]
    for i, sl in enumerate(plan["slides"][:3]):
        specs.append({"layout": "MID", "cat": f"{i + 2} / 5", "kick": kicks[i], "num": str(i + 2), "h": sl["h"], "p": sl["p"]})
    specs.append({"layout": "S5", "cat": "5 / 5", "h": plan["slides"][3]["h"], "p": plan["slides"][3]["p"], "dev": devs[1]})
    tag = uuid.uuid4().hex[:6]
    files, fits = [], []
    for i, s in enumerate(specs, start=1):
        out = f"/tmp/bestly-car-{tag}-{i}.png"
        fits.append(_render(s, out))
        files.append(out)
    if render_only:
        return f"render-only: {files} [{theme}: {why}] {json.dumps(plan)[:500]}"
    base = f"bestly/{'dry/' if dry else ''}carousel/{time.strftime('%Y-%m-%d')}-{tag}"
    urls = [_upload(f, f"{base}/0{i}.png") for i, f in enumerate(files, start=1)]
    copy = [plan["hook"]] + [f"{s['h']} {s['p']}" for s in plan["slides"]]
    cap, cprov = _caption(CAROUSEL_SYS, f"Hook: {plan['hook']}\nTheme: {theme}\nWhat the slides say, in order (stay on exactly this idea; claim nothing beyond it):\n- "
                          + "\n- ".join(copy), deadline)
    details = {"devices": devs, "accent": plan.get("accent"), "slides": plan["slides"], "category": plan.get("category"),
               "why": why, "planner": prov, "writer": cprov, "fits": fits, "urls": urls}
    if dry:
        code, body = _invoke("bestly-ig-poster", {"action": "dryrun", "brand": "bestly", "mediaUrls": urls, "caption": cap}, 180000, 6, 20)
        return f"dry: made carousel [{theme}] '{plan['hook']}' ({why}); IG rehearsal {code} {json.dumps(body)[:160]}\n{urls[0]}\n---\n{cap}"
    ic, ib = _invoke("bestly-ig-poster", {"action": "post", "brand": "bestly", "mediaUrls": urls, "caption": cap}, 180000, 8, 25)
    fc, fb = _invoke("bestly-fb-photo", {"action": "album", "brand": "bestly", "imageUrls": urls, "message": cap}, 120000, 6, 20)
    ig = (bool(ib.get("ok")), ib.get("permalink"), None if ib.get("ok") else f"IG {ic}: {json.dumps(ib)[:400]}")
    fbr = (bool(fb.get("ok")), fb.get("postId"), None if fb.get("ok") else f"FB {fc}: {json.dumps(fb)[:400]}")
    _record("carousel", base, None, theme, cap, ig, fbr, headline=plan["hook"], details=details, media_id=ib.get("remoteId"))
    return _report("carousel", f"'{plan['hook']}'", ig, fbr)


# ---------------------------------------------------------------- fallback: the ready-made pool
def _daily_pool(m, dry, deadline):
    assets = m.get("assets") or []
    hist = _history("daily")
    recent = [h["asset"] for h in hist[:5]]
    last_layout = hist[0]["layout"] if hist else None
    pool = [a for a in assets if a["file"] not in recent]
    if not pool:
        _alert("Bestly post skipped: image pool used up",
               f"All {len(assets)} images in bestly.tech/social ran in the last 5 posts and the daily maker failed too.")
        return "skip: image pool exhausted - needs new assets"
    last_used = {}
    for h in hist:
        last_used.setdefault(h["asset"], h["at"])
    pool.sort(key=lambda a: (a.get("layout") == last_layout, last_used.get(a["file"], "")))
    a = pool[0]
    url = m["base_url"].rstrip("/") + "/" + a["file"]
    cap, prov = _caption(DAILY_SYS, f"Image headline: {a['headline']}\nTheme: {a['theme']}", deadline)
    if dry:
        code, body = _invoke("bestly-ig-poster", {"action": "dryrun", "brand": "bestly", "mediaUrl": url, "caption": cap}, 120000, 5, 15)
        return f"dry (pool): {a['file']} via {prov}; IG rehearsal {code} {json.dumps(body)[:200]}\n---\n{cap}"
    ic, ib = _invoke("bestly-ig-poster", {"action": "post", "brand": "bestly", "mediaUrl": url, "caption": cap}, 120000, 6, 20)
    fc, fb = _invoke("bestly-fb-photo", {"action": "post", "brand": "bestly", "imageUrl": url, "message": cap}, 60000, 5, 15)
    ig = (bool(ib.get("ok")), ib.get("permalink"), None if ib.get("ok") else f"IG {ic}: {json.dumps(ib)[:400]}")
    fbr = (bool(fb.get("ok")), fb.get("postId"), None if fb.get("ok") else f"FB {fc}: {json.dumps(fb)[:400]}")
    _record("daily", a["file"], a.get("layout"), a.get("theme"), cap, ig, fbr, headline=a.get("headline"),
            made_by="pool", media_id=ib.get("remoteId"))
    return _report("daily post (pool)", a["file"], ig, fbr)


def _carousel_pool(m, dry, deadline):
    cars = m.get("carousels") or []
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 56 * 86400))
    used = {h["asset"] for h in _history("carousel") if h["at"] >= since}
    pool = [c for c in cars if c["id"] not in used]
    if not pool:
        _alert("Bestly carousel skipped", "The carousel maker failed and every ready-made carousel ran in the last 8 weeks.", warn=False)
        return "skip: carousel pool exhausted"
    c = pool[0]
    base = (m.get("base_url") or "https://bestly.tech/social/").rstrip("/") + "/"
    urls = [s if s.startswith("http") else base + s.lstrip("/") for s in c["slides"]]
    cap, prov = _caption(CAROUSEL_SYS, f"Hook: {c.get('hook')}\nTheme: {c.get('theme')}"
                         + ("\nWhat the slides say, in order (stay on exactly this idea; claim nothing beyond it):\n- " + "\n- ".join(c["copy"]) if c.get("copy") else ""), deadline)
    if dry:
        code, body = _invoke("bestly-ig-poster", {"action": "dryrun", "brand": "bestly", "mediaUrls": urls, "caption": cap}, 180000, 6, 20)
        return f"dry (pool): {c['id']} via {prov}; IG rehearsal {code} {json.dumps(body)[:200]}\n---\n{cap}"
    ic, ib = _invoke("bestly-ig-poster", {"action": "post", "brand": "bestly", "mediaUrls": urls, "caption": cap}, 180000, 8, 25)
    fc, fb = _invoke("bestly-fb-photo", {"action": "album", "brand": "bestly", "imageUrls": urls, "message": cap}, 120000, 6, 20)
    ig = (bool(ib.get("ok")), ib.get("permalink"), None if ib.get("ok") else f"IG {ic}: {json.dumps(ib)[:400]}")
    fbr = (bool(fb.get("ok")), fb.get("postId"), None if fb.get("ok") else f"FB {fc}: {json.dumps(fb)[:400]}")
    _record("carousel", c["id"], None, c.get("theme"), cap, ig, fbr, headline=c.get("hook"), made_by="pool", media_id=ib.get("remoteId"))
    return _report("carousel (pool)", c["id"], ig, fbr)


def _report(what, asset, ig, fb):
    line = (f"{what} {asset}: Instagram {'posted ' + (ig[1] or '') if ig[0] else 'FAILED - ' + (ig[2] or '')}; "
            f"Facebook {'posted ' + (fb[1] or '') if fb[0] else 'FAILED - ' + (fb[2] or '')}")
    if not (ig[0] and fb[0]):
        _alert("Bestly " + what + (" half posted" if (ig[0] or fb[0]) else " failed"), line)
        if not (ig[0] or fb[0]):
            raise RuntimeError(line)
    return "ok " + line


# ---------------------------------------------------------------- stats + learn
def _stats():
    code, body = _graph("pi_bestly_ig_media")
    media = body.get("data") if isinstance(body, dict) else None
    if code != 200 or media is None:
        raise RuntimeError(f"could not read Instagram posts: {code} {json.dumps(body)[:200]}")
    rows = lib.get("bestly_social_history", "select=id,at,ig_media_id,ig_permalink&order=at.desc&limit=200") or []
    def ts(s):
        return calendar.timegm(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S"))
    n = 0
    for r in rows:
        hit = next((m for m in media if r.get("ig_media_id") and m["id"] == r["ig_media_id"]), None) \
            or next((m for m in media if r.get("ig_permalink") and m.get("permalink") == r["ig_permalink"]), None) \
            or next((m for m in media if abs(ts(m["timestamp"]) - ts(r["at"])) < 900), None)
        if not hit:
            continue
        lib._req("PATCH", f"/rest/v1/bestly_social_history?id=eq.{r['id']}",
                 {"likes": hit.get("like_count"), "comments": hit.get("comments_count"),
                  "metrics_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ig_media_id": hit["id"]})
        n += 1
    return f"ok results updated for {n} post(s) ({len(media)} on Instagram)"


def _learn(deadline):
    rows = lib.get("bestly_social_history", "select=at,kind,theme,layout,headline,likes,comments,made_by&order=at.desc&limit=120") or []
    scored = [r for r in rows if r.get("likes") is not None]
    if len(scored) < 4:
        return f"skip: only {len(scored)} post(s) with results so far"
    def agg(key):
        g = {}
        for r in scored:
            g.setdefault(r.get(key) or "?", []).append((r.get("likes") or 0) + 2 * (r.get("comments") or 0))
        return {k: {"avg": round(sum(v) / len(v), 2), "n": len(v)} for k, v in g.items()}
    stats = {"posts": len(scored), "by_theme": agg("theme"), "by_layout": agg("layout"), "by_kind": agg("kind"),
             "top": sorted(scored, key=lambda r: -((r.get("likes") or 0) + 2 * (r.get("comments") or 0)))[:5],
             "bottom": sorted(scored, key=lambda r: ((r.get("likes") or 0) + 2 * (r.get("comments") or 0)))[:5]}
    msgs = [{"role": "system", "content": "You review a small brand's Instagram results and write lessons for the person who plans tomorrow's post. "
             "Engagement = likes + 2 x comments. The account is small, so most differences are noise. Write at most 5 lessons, "
             "each one line, each ending with the sample size like (N=6). Never call anything a winner or proven unless N >= 10; "
             "below that it is an observation. Include at least one idea worth testing. Reply with a JSON array of strings only."},
            {"role": "user", "content": json.dumps(stats, default=str)[:12000]}]
    lessons = []
    for _ in range(2):
        msg, _ = freellm.chat(msgs, None, max_tokens=4000, deadline=deadline)
        text = msg.get("content") or ""
        m = re.search(r"\[.*\]", text, re.S)
        try:
            lessons = [str(x)[:240] for x in json.loads(m.group(0))][:5] if m else []
        except ValueError:
            lessons = []
        if not lessons:   # a plain list instead of JSON is fine too
            lessons = [re.sub(r"^\s*(?:[-*\d.)]+)\s*", "", l).strip()[:240] for l in text.splitlines() if "(N=" in l][:5]
        if lessons:
            break
    if not lessons:
        raise RuntimeError("no lessons came back")
    lib._req("POST", "/rest/v1/social_lessons", {"brand": "bestly", "lessons": lessons, "stats": stats})
    lib.notify("Bestly posts: this week's lessons", "\n".join(lessons)[:1400], severity="info", push=False,
               url="/admin", dedupe="bestly-lessons-" + time.strftime("%Y%W"))
    return "ok " + " | ".join(lessons)[:600]


# ---------------------------------------------------------------- main
def main(argv):
    mode = next((a for a in argv if a in ("daily", "carousel", "stats", "learn")), "daily")
    dry, render_only = "--dry" in argv, "--render-only" in argv
    global DRY
    DRY = dry or render_only
    deadline = time.time() + 420
    if mode == "stats":
        return _stats()
    if mode == "learn":
        return _learn(deadline)
    tue = time.localtime().tm_wday == 1
    if not DRY and mode == "daily" and tue:
        return "skip: Tuesday is carousel day"
    if not DRY and mode == "carousel" and not tue:
        return "skip: carousels go out on Tuesdays"
    if not render_only and not _http_ok(HEALTH):
        _alert("Bestly post held: bestly.tech/cloud is down", "Nothing was published today. It will try again tomorrow.")
        return "skip: staged only - bestly.tech/cloud is down"
    if not DRY:
        # Guard against double posts (a manual post, or a retry): one Bestly post a day, max.
        code, body = _graph("pi_bestly_ig_recent")
        stamps = body.get("timestamps") if isinstance(body, dict) else None
        if code != 200 or stamps is None:
            _alert("Bestly post held: could not read the Instagram feed", f"{code} {json.dumps(body)[:300]}. Nothing was published.")
            return "skip: could not check the Instagram feed for today's post"
        newest = max((calendar.timegm(time.strptime(t[:19], "%Y-%m-%dT%H:%M:%S")) for t in stamps), default=0)
        if time.time() - newest < 20 * 3600:
            return "skip: Instagram already has a post from the last 20 hours (" + max(stamps) + " UTC)"
    fresh = _carousel_fresh if mode == "carousel" else _daily_fresh
    try:
        return fresh(dry, render_only, deadline)
    except Exception as e:  # noqa: BLE001  the maker failed: fall back to the ready-made pool, and say so
        if render_only:
            raise
        _alert("Bestly post: the daily maker failed, using a ready-made one",
               f"{type(e).__name__}: {str(e)[:400]}", warn=False)
        m = _manifest()
        res = _carousel_pool(m, dry, time.time() + 300) if mode == "carousel" else _daily_pool(m, dry, time.time() + 300)
        return res + f" (maker failed: {str(e)[:160]})"
