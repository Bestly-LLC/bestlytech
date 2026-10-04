"""Bestly's own Instagram + Facebook posts (moved from two Claude scheduled tasks, 2026-10-03).

  bestly_social daily      every day but Tuesday: one image from bestly.tech/social/MANIFEST.json `assets`
  bestly_social carousel   Tuesdays: one 5-slide carousel from `carousels` (IG carousel + FB multi-photo post)
  add --dry to write the caption and rehearse Instagram (dryrun builds the container, never publishes)

Rotation lives in public.bestly_social_history (the old tasks kept it in their prompt, which never updated,
so the same three images went out over and over). Daily: never an image from the last 5 posts, prefer a
different layout letter than the last one, least-recently-used first. Carousel: never one from the last 8 weeks.
Pool used up -> no post, one Scout alert saying new assets are needed.

Caption: free AI ladder, then hard rule checks in code (no emoji, no bait openers, no hashtags, no statistics,
Bestly only in the last paragraph). Three tries, else no post + Scout alert.
Publishing goes through invoke_edge_function (bestly-ig-poster / bestly-fb-photo read the credentials
server-side); the Pi never holds a Meta token. Each channel is called ONCE (a retry would double-post).
"""
import calendar
import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import freellm  # noqa: E402
import lib  # noqa: E402

MANIFEST = "https://bestly.tech/social/MANIFEST.json"
HEALTH = "https://bestly.tech/cloud"
UA = {"User-Agent": "bestly-pi-cron/1.0 (+https://bestly.tech)"}

PRODUCT = ("Bestly Cloud is a private cloud for small businesses: files, calendar, contacts, chat, a password vault and notes "
           "in one box, run for them as a managed appliance or kept on-site. No per-seat pricing, no lock-in. Voice: "
           "privacy-first, plain-spoken, \"we run it, so you don't have to\". Never claim unlimited anything, speed, HIPAA or "
           "SOC 2, or any price.")

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

BAIT = re.compile(r"\b(did you know|here'?s the thing|let'?s dive in|swipe|link in bio|comment below|tag a friend)\b", re.I)
EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️]")
STATS = re.compile(r"\d+(\.\d+)?\s*(%|percent)|\b\d[\d,]*\+?\s*(customers|clients|businesses|users|companies)\b", re.I)


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


def _caption(system, brief, deadline):
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": brief}]
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


def _http_ok(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def _manifest():
    with urllib.request.urlopen(urllib.request.Request(MANIFEST, headers=UA), timeout=30) as r:
        return json.load(r)


def _history(kind, n=40):
    return lib.get("bestly_social_history", f"select=at,asset,layout&kind=eq.{kind}&order=at.desc&limit={n}") or []


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


def _invoke_raw_recent():
    """Timestamps of Bestly's 5 newest Instagram posts. The token stays in the database (pi_bestly_ig_recent),
    and pi_http_result strips anything carrying a credential (Graph paging links) down to the timestamps."""
    rid = lib.rpc("pi_bestly_ig_recent")
    for _ in range(6):
        time.sleep(4)
        r = lib.rpc("pi_http_result", p_id=rid)
        if r and r.get("status_code") is not None:
            try:
                return r["status_code"], json.loads(r.get("content") or "{}")
            except ValueError:
                return r["status_code"], {}
    return None, {"error": "no answer"}


def _record(kind, asset, layout, theme, caption, ig, fb):
    lib._req("POST", "/rest/v1/bestly_social_history", {
        "kind": kind, "asset": asset, "layout": layout, "theme": theme, "caption": caption,
        "ig_ok": ig[0], "ig_permalink": ig[1], "fb_ok": fb[0], "fb_post_id": fb[1],
        "error": (ig[2] or fb[2] or None), "source": "pi"})


DRY = False


def _alert(title, body, warn=True):
    if DRY:
        print("(dry, no alert) " + title + ": " + body[:300])
        return
    lib.notify(title, body[:1500], severity="warning" if warn else "info", push=warn,
               url="https://www.instagram.com/bestly_llc/", dedupe="bestly-social-" + time.strftime("%Y%m%d") + "-" + title[:20])


def _daily(m, dry, deadline):
    assets = m.get("assets") or []
    hist = _history("daily")
    recent = [h["asset"] for h in hist[:5]]
    last_layout = hist[0]["layout"] if hist else None
    pool = [a for a in assets if a["file"] not in recent]
    if not pool:
        _alert("Bestly post skipped: image pool used up",
               f"All {len(assets)} images in bestly.tech/social ran in the last 5 posts. Add new assets to MANIFEST.json.")
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
        return f"dry: {a['file']} via {prov}; IG rehearsal {code} {json.dumps(body)[:200]}\n---\n{cap}"
    ic, ib = _invoke("bestly-ig-poster", {"action": "post", "brand": "bestly", "mediaUrl": url, "caption": cap}, 120000, 6, 20)
    fc, fb = _invoke("bestly-fb-photo", {"action": "post", "brand": "bestly", "imageUrl": url, "message": cap}, 60000, 5, 15)
    ig = (bool(ib.get("ok")), ib.get("permalink"), None if ib.get("ok") else f"IG {ic}: {json.dumps(ib)[:400]}")
    fbr = (bool(fb.get("ok")), fb.get("postId"), None if fb.get("ok") else f"FB {fc}: {json.dumps(fb)[:400]}")
    _record("daily", a["file"], a.get("layout"), a.get("theme"), cap, ig, fbr)
    return _report("daily post", a["file"], ig, fbr)


def _carousel(m, dry, deadline):
    cars = m.get("carousels") or []
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 56 * 86400))
    hist = [h for h in _history("carousel") if h["at"] >= since]
    used = {h["asset"] for h in hist}
    pool = [c for c in cars if c["id"] not in used]
    if not pool:
        _alert("Bestly carousel skipped: none fresh",
               f"All {len(cars)} carousels ran in the last 8 weeks. Add a new set to MANIFEST.json `carousels`.", warn=False)
        return "skip: carousel pool exhausted - needs a new set"
    c = pool[0]
    base = (m.get("base_url") or "https://bestly.tech/social/").rstrip("/") + "/"
    urls = [s if s.startswith("http") else base + s.lstrip("/") for s in c["slides"]]
    cap, prov = _caption(CAROUSEL_SYS, f"Hook: {c.get('hook')}\nTheme: {c.get('theme')}"
                         + ("\nWhat the slides say, in order (stay on exactly this idea; claim nothing beyond it):\n- " + "\n- ".join(c["copy"]) if c.get("copy") else ""), deadline)
    if dry:
        code, body = _invoke("bestly-ig-poster", {"action": "dryrun", "brand": "bestly", "mediaUrls": urls, "caption": cap}, 180000, 6, 20)
        return f"dry: {c['id']} via {prov}; IG rehearsal {code} {json.dumps(body)[:200]}\n---\n{cap}"
    ic, ib = _invoke("bestly-ig-poster", {"action": "post", "brand": "bestly", "mediaUrls": urls, "caption": cap}, 180000, 8, 25)
    fc, fb = _invoke("bestly-fb-photo", {"action": "album", "brand": "bestly", "imageUrls": urls, "message": cap}, 120000, 6, 20)
    ig = (bool(ib.get("ok")), ib.get("permalink"), None if ib.get("ok") else f"IG {ic}: {json.dumps(ib)[:400]}")
    fbr = (bool(fb.get("ok")), fb.get("postId"), None if fb.get("ok") else f"FB {fc}: {json.dumps(fb)[:400]}")
    _record("carousel", c["id"], None, c.get("theme"), cap, ig, fbr)
    return _report("carousel", c["id"], ig, fbr)


def _report(what, asset, ig, fb):
    line = (f"{what} {asset}: Instagram {'posted ' + (ig[1] or '') if ig[0] else 'FAILED - ' + (ig[2] or '')}; "
            f"Facebook {'posted ' + (fb[1] or '') if fb[0] else 'FAILED - ' + (fb[2] or '')}")
    if not (ig[0] and fb[0]):
        _alert("Bestly " + what + (" half posted" if (ig[0] or fb[0]) else " failed"), line)
        if not (ig[0] or fb[0]):
            raise RuntimeError(line)
    return "ok " + line


def main(argv):
    mode = next((a for a in argv if a in ("daily", "carousel")), "daily")
    dry = "--dry" in argv
    global DRY
    DRY = dry
    tue = time.localtime().tm_wday == 1
    if not dry and mode == "daily" and tue:
        return "skip: Tuesday is carousel day"
    if not dry and mode == "carousel" and not tue:
        return "skip: carousels go out on Tuesdays"
    if not _http_ok(HEALTH):
        _alert("Bestly post held: bestly.tech/cloud is down", "Nothing was published today. It will try again tomorrow.")
        return "skip: staged only - bestly.tech/cloud is down"
    if not dry:
        # Guard against double posts (the old Claude tasks, or a manual post): one Bestly post a day, max.
        code, body = _invoke_raw_recent()
        stamps = body.get("timestamps") if isinstance(body, dict) else None
        if code != 200 or stamps is None:
            _alert("Bestly post held: could not read the Instagram feed", f"{code} {json.dumps(body)[:300]}. Nothing was published.")
            return "skip: could not check the Instagram feed for today's post"
        newest = max((calendar.timegm(time.strptime(t[:19], "%Y-%m-%dT%H:%M:%S")) for t in stamps), default=0)
        if time.time() - newest < 20 * 3600:
            return "skip: Instagram already has a post from the last 20 hours (" + max(stamps) + " UTC)"
    m = _manifest()
    deadline = time.time() + 300
    return _carousel(m, dry, deadline) if mode == "carousel" else _daily(m, dry, deadline)
