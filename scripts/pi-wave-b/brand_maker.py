"""Daily post maker for Cookie Yeti and InventoryProof (2026-10-04).

Jared 2026-10-04: these brands post daily, made fresh as needed, straight to Instagram (no review step),
and the content learns from how it does.

  brand_maker make  [brand]   when the brand has fewer than 2 approved, unused posts in its bank, write new ones
  brand_maker stats [brand]   nightly: likes + comments for each brand's posts -> social_posts
  brand_maker learn [brand]   weekly: up to 5 lessons with sample sizes -> social_lessons (read by `make`)
  --dry                       write and check, print, insert nothing

The rest of the line already exists and is unchanged: social_bank_tick (1:30 AM) -> edge fn social-render
queue_next renders the cards in the September card system and queues them -> bestly-ig-poster drain posts at
the brand's slot. This job only writes the bank rows that feed it.

Safety, because nobody reviews these before they post:
- the free AI writes only words; kinds, grounds, accents and mascot poses are chosen in code from the
  renderer's own lists, and the combination is pre-checked with social_plan_check (no repeats next to each other)
- every line goes through claim_check for the brand, hard AND soft rules; one rewrite, then the post is dropped
- no emoji, no statistics or prices, product named only in the caption's last paragraph and the closing card
- runs only as needed (bank below 2), so a stuck renderer can't pile up content
Watchdog: pi_jobs (job brand_maker), and social_engine_watch already alerts when a brand's queue runs dry.
"""
import json
import os
import random
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import freellm  # noqa: E402
import lib  # noqa: E402

KEEP_READY = 2

POSES_IP = ["arms-out-welcome", "bar-chart-stats", "cloud-upload-pointing", "coins-and-card-value", "envelope-and-bell",
            "gear-and-wrench", "glasses-and-coffee", "handing-over-important-document", "holding-little-proofy",
            "inspector-monocle-and-badge", "magnifier-over-photo", "magnifier-small-smiling", "passport-and-plane",
            "question-mark-worried", "reading-manual", "reading-manual-front", "worried-with-card",
            "lock-and-shield-smiling", "magnifier-large-inspecting", "pro-star-badge", "shopping-cart-happy"]

BRANDS = {
    "cookieyeti": {
        "name": "Cookie Yeti", "claim": "cookie-yeti", "hashtags": "#cookieyeti #privacy #cookies #consent",
        "about": ("Cookie Yeti is a browser extension (and Safari app) that answers cookie-consent banners for you: it finds "
                  "the reject or object path and presses it before you see the box; if it does not recognize a banner it "
                  "leaves it alone and tells you. Readers: everyday people tired of cookie banners. Voice: calm, dry, "
                  "matter-of-fact, short sentences, explains how the web actually works. Never claim it blocks everything, "
                  "makes you anonymous, or stops all tracking."),
        "topics": ["dark patterns", "pre-ticked boxes", "what reject removes", "consent fatigue", "the second screen",
                   "legitimate interest", "cookie lifetimes", "fingerprinting", "log in with buttons", "tracking pixels",
                   "first vs third party", "why banners exist", "browser privacy settings", "data brokers"],
        "grounds": ["plum", "wine", "forest", "indigo", "ink", "teal"],
        "comps": {"cover": ["cover", "body", "body", "body", "closing"], "serif": ["serif"], "word": ["word"]},
    },
    "inventoryproof": {
        "name": "InventoryProof", "claim": "inventoryproof", "hashtags": "#inventoryproof #homeinventory",
        "about": ("InventoryProof is an iPhone app for making a home inventory: photograph and list what you own, with "
                  "serial numbers, receipts and values, so you have proof for insurance claims, moves, estates and "
                  "warranties. Readers: homeowners and renters. Voice: calm, practical, short sentences, the list you make "
                  "in calm weather. Never give legal or insurance advice, never promise a payout or claim outcome."),
        "topics": ["insurance", "proof", "after a loss", "moving", "downsize", "legacy planning", "renters",
                   "receipts", "serial numbers", "warranties", "valuables", "home office", "disaster prep", "garage"],
        "grounds": ["navy", "green", "purple", "wine", "slate", "ocean"],
        "accents": ["orange", "blue", "green", "lilac", "gold"],
        "comps": {"lead": ["lead", "lead", "lead", "closing"], "quote": ["quote", "lead", "lead", "closing"],
                  "bar": ["bar"], "word": ["word"]},
    },
}

EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️]")
STATS = re.compile(r"\d+(\.\d+)?\s*(%|percent)|\b\d[\d,]*\+?\s*(customers|people|users|homes|households|sites)\b", re.I)
PRICE = re.compile(r"\$\s*\d|\b\d+\s*(dollars|bucks)\b", re.I)

SYS = """You write one Instagram post for {name}. {about}

You are given the card layout: a list of card kinds in order. Write the words for each card and the caption.
Card rules:
- "head": 4 to 12 words, a flat statement (no question). In a head you may wrap 1 to 4 words in *asterisks* to color them.
- "body": 8 to 30 words, plain and concrete. Not on the closing card.
- "eyebrow": 1 to 4 lowercase words, a small label above the head (first card always has one).
- "big": only on a "word" card: ONE striking word or very short phrase (max 2 words, or a short number like "400 days").
- The "closing" card has only a head, 5 to 14 words, and it is the only card that names {name}.
- Cards before the closing card never name {name}; they must be useful to someone who never installs anything.
Caption rules: first line = the cover head without asterisks. Then 2 to 4 short paragraphs that tell the idea once
in prose. {name} appears only in the LAST paragraph, once or twice. 35 to 140 words. No emoji, no hashtags (they
are added separately), no questions to the reader, no "link in bio", no statistics or prices you cannot source.
American English spelling.

Reply with ONE JSON object only:
{{"title": "<the cover head without asterisks>", "topic": "<the topic, lowercase, 1 to 4 words>",
  "caption": "<the caption>", "cards": [{{"eyebrow": "...", "head": "...", "body": "...", "big": "..."}}, ...]}}
The cards array must have exactly {n} entries in the order given."""


def _json(text):
    m = re.search(r"\{.*\}", (text or "").strip(), re.S)
    if not m:
        raise ValueError("no JSON in reply")
    return json.loads(m.group(0))


def _plain(t):
    return (t or "").replace("*", "")


def _check(brand, cfg, kinds, p):
    e, name = [], cfg["name"]
    cards = p.get("cards") or []
    if len(cards) != len(kinds):
        return [f"cards must have exactly {len(kinds)} entries"]
    cap = (p.get("caption") or "").strip()
    paras = [x for x in re.split(r"\n\s*\n", cap) if x.strip()]
    w = len(cap.split())
    if w < 30 or w > 160:
        e.append(f"caption is {w} words (want 35-140)")
    if name.lower() not in (paras[-1].lower() if paras else ""):
        e.append(f"caption must name {name} in its last paragraph")
    if any(name.lower() in x.lower() for x in paras[:-1]):
        e.append(f"caption names {name} before the last paragraph")
    for i, (k, c) in enumerate(zip(kinds, cards), start=1):
        head = _plain(c.get("head"))
        hw = len(head.split())
        if k == "closing":
            if not 4 <= hw <= 15:
                e.append(f"card {i} (closing) head is {hw} words")
            if name.lower() not in head.lower():
                e.append(f"card {i} (closing) must name {name}")
        else:
            if not 3 <= hw <= 13:
                e.append(f"card {i} head is {hw} words")
            if name.lower() in (head + " " + (c.get("body") or "")).lower():
                e.append(f"card {i} names {name} (only the closing card may)")
            bw = len((c.get("body") or "").split())
            if not 6 <= bw <= 34:
                e.append(f"card {i} body is {bw} words")
        if i == 1 and not (c.get("eyebrow") or "").strip():
            e.append("card 1 needs an eyebrow")
        if k == "word" and not 1 <= len((c.get("big") or "").split()) <= 2:
            e.append(f"card {i} (word) needs a 'big' of 1-2 words")
        if "?" in head:
            e.append(f"card {i} head asks a question")
    blob = cap + " " + " ".join(f"{c.get('eyebrow','')} {c.get('head','')} {c.get('body','')} {c.get('big','')}" for c in cards)
    if EMOJI.search(blob) or "#" in blob:
        e.append("no emoji or hashtags anywhere")
    if STATS.search(blob) or PRICE.search(blob):
        e.append("no statistics or prices")
    if re.search(r"link in bio|https?://|www\.", blob, re.I):
        e.append("no links or 'link in bio'")
    if not e:
        for where, t in [("caption", cap)] + [(f"card {i}", f"{_plain(c.get('head'))}. {c.get('body') or ''}")
                                              for i, c in enumerate(cards, start=1)]:
            r = lib.rpc("claim_check", _client_slug=cfg["claim"], _text=t, _context="brand_maker") or {}
            if r.get("ok") is False:   # hard OR soft: nobody reviews these before they post
                e.append(f"{where} broke the claim rule '{r.get('reason')}' - rephrase without it")
    return e


def _recent(brand, n=14):
    rows = lib.get("social_posts", f"select=id,scheduled_at,caption,status,likes,comments&brand=eq.{brand}"
                   f"&platform=eq.instagram&status=in.(queued,posted,posting)&order=scheduled_at.desc&limit={n}") or []
    ids = ",".join(r["id"] for r in rows)
    dims = {d["post_id"]: d for d in (lib.get("social_post_dims", f"select=*&post_id=in.({ids})") or [])} if ids else {}
    for r in rows:
        r["dims"] = dims.get(r["id"], {})
    return rows


def _lessons(brand):
    r = lib.get("social_lessons", f"select=lessons&brand=eq.{brand}&order=made_at.desc&limit=1") or []
    return r[0]["lessons"] if r else []


def _pick(brand, cfg, recent, bank_open):
    """Topic (explore/exploit on likes + 2x comments), composition, ground, accent, poses; pre-checked for clashes."""
    used_topics = [r["dims"].get("topic") for r in recent[:6]] + [b.get("topic") for b in bank_open]
    scores = {}
    for r in recent:
        t = (r["dims"] or {}).get("topic")
        if t and r.get("likes") is not None:
            scores.setdefault(t, []).append((r.get("likes") or 0) + 2 * (r.get("comments") or 0))
    pool = [t for t in cfg["topics"] if t not in used_topics] or cfg["topics"]
    proven = [t for t in pool if len(scores.get(t, [])) >= 2]
    if proven and random.random() > 0.3:
        topic = max(proven, key=lambda t: sum(scores[t]) / len(scores[t]))
        why = f"exploit: best average engagement (N={len(scores[topic])})"
    else:
        topic, why = random.choice(pool), "explore"
    for _ in range(30):
        comp = random.choice(list(cfg["comps"]))
        ground = random.choice(cfg["grounds"])
        pose = random.choice(POSES_IP) if brand == "inventoryproof" else None
        chk = lib.rpc("social_plan_check", p_brand=brand, p_ground=ground, p_composition=comp, p_topic=topic,
                      p_pose=pose, p_word=None) or {}
        if chk.get("ok") and not any(b.get("composition") == comp and b.get("ground") == ground for b in bank_open):
            return topic, why, comp, ground, pose
    raise RuntimeError("no layout combination passes the no-repeat check")


def _make_one(brand, cfg, recent, bank_open, deadline, dry):
    topic, why, comp, ground, pose = _pick(brand, cfg, recent, bank_open)
    kinds = cfg["comps"][comp]
    ex = lib.get("social_content_bank", f"select=title,caption,cards&brand=eq.{brand}&composition=eq.{comp}"
                 "&order=created_at.desc&limit=2") or []
    lessons = _lessons(brand)
    recent_titles = "\n".join(f"- {(r.get('caption') or '').splitlines()[0][:90]} (likes {r.get('likes')}, comments {r.get('comments')})"
                              for r in recent[:12])
    user = (f"Topic: {topic}\nCard layout (kinds in order): {kinds}\n\n"
            f"Two earlier posts with this layout, for voice and length (do not reuse their ideas):\n{json.dumps(ex)[:3500]}\n\n"
            f"Recent posts (do not repeat their ideas):\n{recent_titles}\n"
            + ("\nWhat we have learned (observations with sample sizes):\n" + "\n".join(f"- {l}" for l in lessons[:5]) if lessons else ""))
    msgs = [{"role": "system", "content": SYS.format(name=cfg["name"], about=cfg["about"], n=len(kinds))},
            {"role": "user", "content": user}]
    errs, plan, prov = [], None, None
    for _ in range(3):
        msg, prov = freellm.chat(msgs, None, max_tokens=3000, deadline=deadline)
        try:
            plan = _json(msg.get("content"))
            errs = _check(brand, cfg, kinds, plan)
        except (ValueError, TypeError, KeyError) as e:
            plan, errs = None, [f"reply was not the JSON asked for ({e})"]
        if plan and not errs:
            break
        msgs += [{"role": "assistant", "content": (msg.get("content") or "")[:4000]},
                 {"role": "user", "content": "Fix these and reply with the JSON only: " + "; ".join(errs)}]
    if not plan or errs:
        raise RuntimeError(f"{brand}: post failed the rules 3 times: " + "; ".join(errs)[:400])
    accent = random.choice(cfg.get("accents") or [None])
    cards = []
    for i, (k, c) in enumerate(zip(kinds, plan["cards"])):
        card = {"kind": k, "ground": ground, "head": c.get("head", "").strip()}
        if k != "closing" and c.get("body"):
            card["body"] = c["body"].strip()
        if c.get("eyebrow") and k != "closing":
            card["eyebrow"] = c["eyebrow"].strip().lower()[:40]
        if k == "word":
            card["big"] = c.get("big", "").strip()
        if brand == "inventoryproof":
            card["accent"] = accent
            if i == 0 or k in ("bar", "word"):
                card["pose"] = pose
            elif k == "closing":
                card["pose"] = "cheering-arms-up"
            elif i == len(kinds) - 2 and random.random() < 0.5:
                card["pose"] = random.choice([p for p in POSES_IP if p != pose])
        cards.append(card)
    word = cards[0].get("big", "").lower() or None if comp == "word" else None
    slug = (("cy-" if brand == "cookieyeti" else "ip-") + re.sub(r"[^a-z0-9]+", "-", _plain(plan["title"]).lower()).strip("-")[:40]
            + "-" + time.strftime("%m%d"))
    row = {"brand": brand, "slug": slug, "title": _plain(plan["title"])[:200], "caption": plan["caption"].strip(),
           "hashtags": cfg["hashtags"], "cards": cards, "topic": (plan.get("topic") or topic)[:60].lower(),
           "ground": ground, "composition": comp, "pose": pose, "display_word": word, "priority": 100,
           "approved": True, "approved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "daily-maker"}
    if not dry:
        lib._req("POST", "/rest/v1/social_content_bank", row)
    return f"{brand}: '{row['title']}' [{comp}/{ground}{'/' + pose if pose else ''}, {topic}: {why}, via {prov}]", row


def _make(brands, dry):
    out, deadline = [], time.time() + 480
    for brand in brands:
        cfg = BRANDS[brand]
        bank_open = lib.get("social_content_bank", f"select=id,topic,composition,ground&brand=eq.{brand}"
                            "&approved=is.true&rejected=is.false&queued_at=is.null") or []
        need = KEEP_READY - len(bank_open)
        if need <= 0 and not dry:
            out.append(f"{brand}: {len(bank_open)} ready, nothing to make")
            continue
        recent = _recent(brand)
        for _ in range(max(need, 1)):
            try:
                line, row = _make_one(brand, cfg, recent, bank_open, deadline, dry)
                bank_open.append(row)
                out.append(line + ("\n" + json.dumps(row)[:1500] if dry else ""))
            except Exception as e:  # noqa: BLE001  one brand failing must not stop the other
                out.append(f"{brand}: FAILED {type(e).__name__}: {str(e)[:300]}")
    failed = [l for l in out if "FAILED" in l]
    if failed and not dry:
        lib.notify("Daily post maker had trouble", "\n".join(failed)[:1200], severity="warning", push=False,
                   url="/admin", dedupe="brand-maker-" + time.strftime("%Y%m%d"))
    if failed and len(failed) == len([l for l in out if "nothing to make" not in l]):
        raise RuntimeError(" | ".join(failed)[:1500])
    return "ok " + " | ".join(out)[:3000] if not dry else "dry:\n" + "\n".join(out)


def _graph(brand):
    rid = lib.rpc("pi_brand_ig_media", p_brand=brand)
    for _ in range(6):
        time.sleep(4)
        r = lib.rpc("pi_http_result", p_id=rid)
        if r and r.get("status_code") is not None:
            return r["status_code"], json.loads(r.get("content") or "{}")
    return None, {}


def _stats(brands):
    out = []
    for brand in brands:
        code, body = _graph(brand)
        media = body.get("data") if isinstance(body, dict) else None
        if code != 200 or media is None:
            out.append(f"{brand}: could not read Instagram ({code})")
            continue
        n = 0
        for m in media:
            rows = lib.get("social_posts", f"select=id&brand=eq.{brand}&remote_id=eq.{m['id']}") or []
            for r in rows:
                lib._req("PATCH", f"/rest/v1/social_posts?id=eq.{r['id']}", {
                    "likes": m.get("like_count"), "comments": m.get("comments_count"),
                    "metrics_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
                n += 1
        out.append(f"{brand}: {n} post(s) updated")
    if all("could not" in l for l in out):
        raise RuntimeError(" | ".join(out))
    return "ok " + " | ".join(out)


def _learn(brands):
    out, deadline = [], time.time() + 300
    for brand in brands:
        rows = [r for r in _recent(brand, 60) if r.get("likes") is not None]
        if len(rows) < 6:
            out.append(f"{brand}: only {len(rows)} post(s) with results")
            continue
        def agg(key):
            g = {}
            for r in rows:
                g.setdefault((r["dims"] or {}).get(key) or "?", []).append((r.get("likes") or 0) + 2 * (r.get("comments") or 0))
            return {k: {"avg": round(sum(v) / len(v), 2), "n": len(v)} for k, v in g.items()}
        score = lambda r: (r.get("likes") or 0) + 2 * (r.get("comments") or 0)  # noqa: E731
        stats = {"posts": len(rows), "by_topic": agg("topic"), "by_composition": agg("composition"), "by_ground": agg("ground"),
                 "top": [((r.get("caption") or "").splitlines()[0][:90], score(r)) for r in sorted(rows, key=lambda r: -score(r))[:5]],
                 "bottom": [((r.get("caption") or "").splitlines()[0][:90], score(r)) for r in sorted(rows, key=score)[:5]]}
        msgs = [{"role": "system", "content": "You review a brand's Instagram results and write lessons for whoever writes tomorrow's post. "
                 "Engagement = likes + 2 x comments. Small samples are noise. At most 5 lessons, one line each, each ending with "
                 "its sample size like (N=6). Never call anything a winner or proven unless N >= 10. Include one idea to test. "
                 "Reply with a JSON array of strings only."},
                {"role": "user", "content": json.dumps(stats)[:12000]}]
        lessons = []
        for _ in range(2):
            msg, _ = freellm.chat(msgs, None, max_tokens=4000, deadline=deadline)
            text = msg.get("content") or ""
            m = re.search(r"\[.*\]", text, re.S)
            try:
                lessons = [str(x)[:240] for x in json.loads(m.group(0))][:5] if m else []
            except ValueError:
                lessons = []
            if not lessons:
                lessons = [re.sub(r"^\s*(?:[-*\d.)]+)\s*", "", l).strip()[:240] for l in text.splitlines() if "(N=" in l][:5]
            if lessons:
                break
        if lessons:
            lib._req("POST", "/rest/v1/social_lessons", {"brand": brand, "lessons": lessons, "stats": stats})
            out.append(f"{brand}: " + " / ".join(lessons)[:400])
        else:
            out.append(f"{brand}: no lessons came back")
    return "ok " + " | ".join(out)[:2000]


def main(argv):
    mode = next((a for a in argv if a in ("make", "stats", "learn")), "make")
    brands = [a for a in argv if a in BRANDS] or list(BRANDS)
    dry = "--dry" in argv
    if mode == "stats":
        return _stats(brands)
    if mode == "learn":
        return _learn(brands)
    return _make(brands, dry)
