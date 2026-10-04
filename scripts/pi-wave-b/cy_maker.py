"""Centering YOU weekly carousel draft (2026-10-04).

Jared 2026-10-04: "Centering You should run once a week." She is a client, so this job never posts and never reaches
her board on its own: it writes ONE carousel a week into Studio as an internal draft (Drafts > To review). A person
reviews it there, sends it to her board, and she signs off, exactly like every other post.

  cy_maker make     weekly (Monday 6:20 AM): plan, write, check, render and file one draft
  --dry             everything except filing it (slides go to carousel/_dry/), prints the draft

How it learns: before writing, it reads every note Jared, Eli and Elizabeth left on Centering YOU carousels in the
last 45 days (cy_maker_feedback), plus how the maker's own earlier drafts were decided, and writes against them.
Topics it has already drafted are not repeated; titles are checked against every post she has.
Safety: her claim rules (hard AND soft) on every slide and caption; the "every post sells the deck" rule
(cy_maker_sells = the stage gate's own regex) on the caption, each platform caption and the last slide; no statistics;
a separate editor pass in her voice must score it 8+ (a factually clean 7 is kept as the fallback).
It skips the week if two of its drafts are still waiting in To review, so unreviewed work never piles up.
Rendering: /opt/bestly/cy-kit/card.html (repo social/scripts/card-kit/centering-you; her fonts and art are fetched
from Studio storage at install and never committed). Watchdog: pi_jobs (job cy_maker, weekly + a day).
"""
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

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import freellm  # noqa: E402
import lib  # noqa: E402
from jobs import brand_maker as bm  # noqa: E402  (shared _json)

KIT = "/opt/bestly/cy-kit"
BUCKET = "review"
UA = {"User-Agent": "bestly-pi-cron/1.0 (+https://bestly.tech)"}

TOPICS = ["the first weeks home", "asking for help out loud", "the 3am mind", "who you are after birth",
          "talking to your partner about the hard parts", "visitors and boundaries", "rest without guilt",
          "worry that will not switch off", "the six-week checkup is not the finish line", "feeding pressure",
          "the invisible to-do list", "a two-minute reset", "naming what you feel", "self-compassion on a hard day",
          "planning postpartum support before birth", "the fourth trimester", "when advice comes from everywhere",
          "the body after birth, without judgment", "loneliness in a full house", "how to use the deck",
          "a gift that is for her, not the baby", "partners and support people", "going back to work",
          "small rituals that hold a day together", "the difference between worry and anxiety"]

DECK = """Centering YOU is a postpartum card deck made by Elizabeth O'Brien, LPC, PMH-C (a perinatal mental health
therapist) and Dr. Marianela Rodriguez. 48 cards: an intention or prompt on the front, a skill on the back, and a wooden
stand. How it works: pull a card, place it on the stand where you can see it, practice the skill on the back, share it.
There is an English edition and a Spanish edition (Centrada en ti). Web address: centeringyou.com.
It is a therapeutic, educational resource; it is not a replacement for therapy, medical care or crisis support."""

VOICE = """Her voice and her rules (from her Field Guide and her own notes; these are not negotiable):
- Speak to the reader as "you". Do not default to "mama", "mamas", "mom" or "moms"; say "mother", "new parent" or
  "birthing person" only when it is intentional.
- Warm, clear, clinically careful. Full sentences that connect to each other: reviewers rejected slides that read
  "like half sentences". Avoid globalizing statements ("you were never...", "every mother..."); say "might", "can",
  "for many people".
- Never: cure, prevent, treat, guarantee or fix anything; "clinically proven"; first/only/best; endorsements; naming a
  medication; telling anyone to start or stop treatment; using crisis, loss, trauma or fear as a hook or a bridge to a
  sale; manufactured urgency ("don't wait", "act now"); platitudes ("journey", "you've got this", "just breathe",
  "bounce back"); "burnout" as a stand-in for a clinical term; her family or any client story; "subpar"; "strangely".
- No statistics or numbers on the slides or in the captions (they must be sourced, and you cannot source them here).
- Do not write about suicide, psychosis, pregnancy loss or infertility in this weekly post.
- The last slide is the bridge: it must name Centering YOU or the deck and say how a card is used, so a reader sees
  why the deck belongs to this idea. The captions must make that connection clear too, and end with centeringyou.com.
American English spelling."""

SYS = """You write one Instagram/TikTok carousel for Centering YOU. {deck}

{voice}

Slides: a cover, then {mid} content slides, then the closing slide.
- cover: "kicker" (2 to 5 words, a small label), "head" (5 to 14 words, a full sentence or a clear statement).
- content slides: "head" (4 to 14 words) and "body" (8 to 30 words). Each says something new, and together they build
  one idea from recognition to something she can do.
- closing: "head" (4 to 12 words) and "body" (10 to 30 words) naming Centering YOU or the deck and how a card is used.
Captions:
- "caption_instagram": 50 to 140 words, 2 or 3 short paragraphs, complete thoughts; the last paragraph names
  Centering YOU and ends with centeringyou.com. No hashtags in the text.
- "hashtags_instagram": exactly 3 relevant lowercase hashtags. "caption_tiktok": 25 to 70 words, names the deck and
  ends with centeringyou.com. "hashtags_tiktok": exactly 4.
- "alt_text": one sentence describing the slides for screen readers.
Reply with ONE JSON object only:
{{"topic": "...", "title": "<short post title, 3 to 9 words>", "cover": {{"kicker": "...", "head": "..."}},
  "slides": [{{"head": "...", "body": "..."}}, ...], "closing": {{"head": "...", "body": "..."}},
  "caption_instagram": "...", "hashtags_instagram": ["#..."], "caption_tiktok": "...", "hashtags_tiktok": ["#..."],
  "alt_text": "..."}}"""

REVIEW = """You are Elizabeth O'Brien's careful editor and fact checker for her Centering YOU posts. {deck}

{voice}

Check every slide and both captions against those rules and for anything clinically inaccurate or overstated. Then
score it 1-10 as a post she would approve without changes: warm, specific, clinically careful, slides that read as full
connected sentences, and a last slide that clearly bridges to the deck.
Reply with ONE JSON object only: {{"ok": true|false, "score": <1-10>, "problems": ["<where>: <what>"],
  "improve": "<the one or two edits that would most raise the score>"}}"""

DIGITS = re.compile(r"\d")


def _wc(t):
    return len((t or "").split())


def _http_ok(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def _texts(p):
    out = [("cover", f"{p['cover'].get('kicker', '')}. {p['cover'].get('head', '')}")]
    out += [(f"slide {i}", f"{s.get('head', '')} {s.get('body', '')}") for i, s in enumerate(p.get("slides") or [], 2)]
    out += [("closing", f"{p['closing'].get('head', '')} {p['closing'].get('body', '')}"),
            ("instagram caption", p.get("caption_instagram") or ""), ("tiktok caption", p.get("caption_tiktok") or "")]
    return out


def _check(p, mid, titles):
    e = []
    def rng(name, t, lo, hi):
        w = _wc(t)
        if not lo <= w <= hi:
            e.append(f"{name} is {w} words (want {lo}-{hi})")
    if not isinstance(p.get("cover"), dict) or not isinstance(p.get("closing"), dict):
        return ["cover and closing must be objects"]
    rng("title", p.get("title"), 3, 10)
    rng("cover kicker", p["cover"].get("kicker"), 2, 5)
    rng("cover head", p["cover"].get("head"), 5, 15)
    slides = p.get("slides") or []
    if len(slides) != mid:
        e.append(f"slides must have exactly {mid} content slides")
    for i, s in enumerate(slides, 2):
        rng(f"slide {i} head", s.get("head"), 4, 15)
        rng(f"slide {i} body", s.get("body"), 8, 32)
    rng("closing head", p["closing"].get("head"), 4, 13)
    rng("closing body", p["closing"].get("body"), 10, 32)
    rng("instagram caption", p.get("caption_instagram"), 45, 150)
    rng("tiktok caption", p.get("caption_tiktok"), 22, 75)
    for k, n in (("hashtags_instagram", 3), ("hashtags_tiktok", 4)):
        h = p.get(k) or []
        if len(h) != n or not all(isinstance(x, str) and re.fullmatch(r"#[a-z0-9]{3,40}", x) for x in h):
            e.append(f"{k} must be exactly {n} lowercase hashtags like #postpartum")
    texts = _texts(p)
    for where, t in texts:
        if DIGITS.search(t) and where != "instagram caption" or (where == "instagram caption" and re.search(r"\d+\s*%|\b\d+ (in|out of) \d+", t)):
            e.append(f"{where}: no numbers or statistics")
        if "#" in t:
            e.append(f"{where}: no hashtags in the text")
    for k in ("caption_instagram", "caption_tiktok"):
        if not (p.get(k) or "").rstrip().rstrip(".").lower().endswith("centeringyou.com"):
            e.append(f"{k} must end with centeringyou.com")
    heads = [(s.get("body") or "").lower() for s in slides]
    for a in range(len(heads)):
        for b in range(a + 1, len(heads)):
            if difflib.SequenceMatcher(None, heads[a], heads[b]).ratio() > 0.65:
                e.append("two slides repeat each other; every slide must add something")
    for old in titles:
        if difflib.SequenceMatcher(None, (p.get("title") or "").lower(), (old or "").lower()).ratio() > 0.6:
            e.append(f"title too close to an existing post ('{old}'); choose a different angle")
            break
    if e:
        return e
    for where, t in texts:
        r = lib.rpc("claim_check", _client_slug="centering-you", _text=t, _context="cy_maker") or {}
        if r.get("ok") is False or r.get("severity") == "soft":
            e.append(f"{where} breaks her rule '{r.get('reason')}'" + (f" ({r['hint'][:160]})" if r.get("hint") else ""))
    for where, t in [("instagram caption", p.get("caption_instagram")), ("tiktok caption", p.get("caption_tiktok")),
                     ("closing", f"{p['closing'].get('head')} {p['closing'].get('body')}")]:
        if not lib.rpc("cy_maker_sells", p_text=t):
            e.append(f"{where} must name Centering YOU or the deck (every post sells the deck)")
    return e


def _review(p, deadline):
    msgs = [{"role": "system", "content": REVIEW.format(deck=DECK, voice=VOICE)},
            {"role": "user", "content": json.dumps({k: p.get(k) for k in ("cover", "slides", "closing", "caption_instagram", "caption_tiktok")})[:6000]}]
    msg, _ = freellm.chat(msgs, None, max_tokens=2500, deadline=deadline, json_mode=True)
    try:
        r = bm._json(msg.get("content"))
    except ValueError:
        return [], 8.0
    try:
        score = float(r.get("score") or 0)
    except (TypeError, ValueError):
        score = 0.0
    probs = [f"editor: {x}" for x in (r.get("problems") or [])][:6]
    if probs or not r.get("ok"):
        return probs or ["editor: not ok; follow her rules strictly"], score
    if score >= 8:
        return [], score
    return [f"editor (score {score:g}/10): {str(r.get('improve') or 'more specific and warmer')[:300]}"], score


def _write(topic, mid, fb, deadline):
    notes = "\n".join(f"- [{n.get('who')}{', on a draft this job made' if n.get('by_maker') else ''}] on '{n.get('post')}': {n.get('note')}"
                      for n in (fb.get("notes") or [])[:18])
    mine = "\n".join(f"- '{m.get('title')}' ({m.get('topic')}): internal {m.get('internal')}, client {m.get('client')}"
                     for m in (fb.get("mine") or [])[:8])
    user = (f"Topic: {topic}\n\nWhat Jared, Eli and Elizabeth have said about recent carousels (write against this):\n{notes}\n"
            + (f"\nHow earlier weekly drafts were decided:\n{mine}\n" if mine else "")
            + "\nExisting post titles (do not repeat their ideas): " + "; ".join((fb.get("titles") or [])[:40]))
    msgs = [{"role": "system", "content": SYS.format(deck=DECK, voice=VOICE, mid=mid)}, {"role": "user", "content": user}]
    titles = fb.get("titles") or []
    errs, plan, prov, tries, near = [], None, None, [], None
    for _ in range(4):
        msg, prov = freellm.chat(msgs, None, max_tokens=4000, deadline=deadline, json_mode=True)
        try:
            plan = bm._json(msg.get("content"))
            errs, score = _check(plan, mid, titles), 0.0
            if not errs:
                errs, score = _review(plan, deadline)
                if errs and all(x.startswith("editor (score") for x in errs) and score >= 7 and (not near or score > near[1]):
                    near = (plan, score, prov)
            tries.append(f"{prov}: '{plan.get('title')}' -> {'; '.join(errs)[:240] or 'ok'}")
        except (ValueError, TypeError, KeyError, AttributeError) as ex:
            plan, errs = None, [f"reply was not the JSON asked for ({ex})"]
            tries.append(f"{prov}: unreadable")
            continue
        if not errs:
            return plan, prov, score
        msgs += [{"role": "assistant", "content": (msg.get("content") or "")[:5000]},
                 {"role": "user", "content": "Fix these and reply with the JSON only: " + "; ".join(errs)}]
    if near:
        return near[0], near[2], near[1]
    raise RuntimeError("draft failed her rules 4 times: " + " || ".join(tries)[:1200])


def _render(spec, out):
    url = "file://" + KIT + "/card.html#" + urllib.parse.quote(json.dumps(spec))
    base = ["chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
            "--allow-file-access-from-files", "--window-size=1080,1400", "--virtual-time-budget=8000"]
    dom = subprocess.run(base + ["--dump-dom", url], capture_output=True, text=True, timeout=120).stdout
    m = re.search(r'data-fit="([^"]*)"', dom)
    fit = json.loads(m.group(1).replace("&quot;", '"')) if m else None
    subprocess.run(base + ["--screenshot=" + out + ".png", url], capture_output=True, timeout=120)
    from PIL import Image  # python3-pil
    Image.open(out + ".png").convert("RGB").crop((0, 0, 1080, 1350)).save(out, quality=92, optimize=True)
    os.remove(out + ".png")
    if not fit or not fit.get("ok"):
        raise RuntimeError(f"slide did not fit: {fit}")
    return fit


def _upload(path, name):
    with open(path, "rb") as f:
        data = f.read()
    h = {"apikey": lib.KEY, "Content-Type": "image/jpeg", "x-upsert": "false"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    req = urllib.request.Request(f"{lib.URL}/storage/v1/object/{BUCKET}/{name}", data=data, method="POST", headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()
    url = f"{lib.URL}/storage/v1/object/public/{BUCKET}/{name}"
    if not _http_ok(url):
        raise RuntimeError("uploaded slide is not readable")
    return url


def _make(dry):
    fb = lib.rpc("cy_maker_feedback", p_days=45) or {}
    waiting = [m for m in fb.get("mine") or [] if m.get("stage") == "internal" and m.get("internal") == "pending"]
    if len(waiting) >= 2 and not dry:
        return f"skip: {len(waiting)} weekly drafts still waiting in To review (" + "; ".join(m["title"] for m in waiting[:3]) + ")"
    done = {(m.get("topic") or "").lower() for m in fb.get("mine") or []}
    pool = [t for t in TOPICS if t not in done] or TOPICS
    topic = random.choice(pool)
    last_tpl = ((fb.get("mine") or [{}])[0] or {}).get("template")
    template = "deck" if last_tpl == "tile" else ("tile" if last_tpl == "deck" else random.choice(["tile", "deck"]))
    mid = random.choice([3, 4])
    deadline = time.time() + 1500
    plan, prov, score = _write(topic, mid, fb, deadline)

    n = mid + 2
    slug = re.sub(r"[^a-z0-9]+", "-", plan["title"].lower()).strip("-")[:48]
    folder = f"carousel/{'_dry/' if dry else ''}cy-weekly-{slug}-{time.strftime('%y%m%d')}/v1"
    faces = ["teal", "red", "teal", "red", "teal", "red"]
    pat = random.choice(["pat-a", "pat-b"])
    specs = [{"template": template, "pat": pat, "px": random.randint(0, 1100), "py": random.randint(0, 1100), "face": "red",
              "slide": {"type": "cover", "kicker": plan["cover"]["kicker"].strip(), "head": plan["cover"]["head"].strip(), "n": 1, "of": n},
              "copy": {"kicker": plan["cover"]["kicker"].strip(), "headline": plan["cover"]["head"].strip()}}]
    for i, s in enumerate(plan["slides"], 2):
        specs.append({"template": template, "pat": random.choice(["pat-a", "pat-b"]), "px": random.randint(0, 1100),
                      "py": random.randint(0, 1100), "face": faces[i % len(faces)],
                      "slide": {"type": "text", "head": s["head"].strip(), "body": s["body"].strip(), "n": i, "of": n},
                      "copy": {"headline": s["head"].strip(), "body": s["body"].strip()}})
    # The closing card prints centeringyou.com itself, in red, under the body; drop it from the body so it is not said twice.
    close_body = re.sub(r"\s*(?:(?:visit|explore|find|see|learn more|more)\b[^.]*?\s+)?(?:at\s+)?centeringyou\.com\.?", "",
                        plan["closing"]["body"].strip(), flags=re.I).strip() or plan["closing"]["body"].strip()
    specs.append({"template": template, "pat": pat, "px": random.randint(0, 1100), "py": random.randint(0, 1100),
                  "slide": {"type": "cta", "head": plan["closing"]["head"].strip(), "body": close_body, "n": n, "of": n},
                  "copy": {"kicker": "Centering YOU", "headline": plan["closing"]["head"].strip(),
                           "body": close_body + " centeringyou.com"}})
    slides = []
    for i, sp in enumerate(specs, 1):
        out = f"/tmp/cy-{os.getpid()}-{i:02d}.jpg"
        _render({k: v for k, v in sp.items() if k != "copy"}, out)
        slides.append({"media_url": _upload(out, f"{folder}/{i:02d}.jpg"), "copy": sp["copy"]})
        os.remove(out)

    ig = plan["caption_instagram"].strip()
    tt = plan["caption_tiktok"].strip()
    why = (f"Made by the weekly maker (Spark, on the Pi). Topic: {topic}. Template: {template}, {n} slides. "
           f"Written by {prov}; her editor pass scored it {score:g}/10 and every slide and caption passed her claim rules "
           f"and the sells-the-deck rule. It read {len(fb.get('notes') or [])} recent review notes before writing. "
           "Approve, ask for changes, or kill it like any draft; the notes you leave are what next week's draft learns from.")
    payload = {"client": "centering-you", "title": plan["title"].strip(), "caption": ig, "audience": "parents",
               "provenance": {"topic": topic, "template": template, "writer": prov, "editor_score": score},
               "slides": slides, "note": why,
               "variants": [{"platform": "instagram", "caption": ig, "hashtags": plan["hashtags_instagram"], "alt_text": plan.get("alt_text")},
                            {"platform": "tiktok", "caption": tt, "hashtags": plan["hashtags_tiktok"], "alt_text": plan.get("alt_text")}]}
    if dry:
        return ("dry: " + json.dumps({k: payload[k] for k in ("title", "caption", "provenance")}) + "\n"
                + "\n".join(s["media_url"] for s in slides) + "\n" + json.dumps(plan)[:3000])
    r = lib.rpc("cy_maker_insert", p=payload) or {}
    return f"ok filed #{r.get('code')} '{payload['title']}' ({topic}, {template}, {n} slides, editor {score:g}) in Studio > To review"


def main(argv):
    try:
        return _make("--dry" in argv)
    except Exception as e:  # noqa: BLE001
        if "--dry" not in argv:
            lib.notify("Centering YOU weekly draft failed", f"{type(e).__name__}: {str(e)[:900]}", severity="warning",
                       push=False, url="/admin", dedupe="cy-maker-" + time.strftime("%Y%m%d"))
        raise
