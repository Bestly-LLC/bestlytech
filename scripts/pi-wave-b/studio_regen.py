"""Studio regen pass (moved from the hourly Claude scheduled task, 2026-10-03).

Every hour: read studio_regen_queue as Spark (the system actor, never a person). Usually empty -> "nothing".
For each waiting item:
  - newest note is already Spark's  -> skip: a human owns it now (Spark cannot move it back to To review).
  - free AI decides WORDS / RENDER / MIXED from the staff and client notes.
  - RENDER: studio_needs_render(reason) + studio_regen_done.  "Needs a re-cut" banner in Studio.
  - WORDS: new title/caption (+ the platform variants), each through claim_check; one revision if it blocks;
    still blocked -> leave the item alone and report it. Then studio_item_edit, variants, studio_note (signed Spark),
    studio_decide('pending') (may be refused for Spark; the note then says a person must flip it), studio_regen_done.
Never touches stage='client'. Never promotes. AI only runs when there is an item to work on.
Scout gets one info alert per run that changed or raised something.
"""
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import freellm  # noqa: E402
import lib  # noqa: E402

MAX_ITEMS = 3          # per run; the rest wait an hour
DEADLINE_S = 600

SYSTEM = """You are Spark, the system assistant inside Bestly Studio. Staff (Jared, Eli) and sometimes the client left notes on a social post saying what is wrong with the current cut. You decide what kind of change they ask for and, when it is words, you write the new words.

Kinds:
- WORDS: caption, title, hook, hashtags in the caption. You do these.
- RENDER: anything needing the images or video remade: artwork, slide text baked into images, name tags, corner graphics, colors, timing, footage, new assets. You cannot do these.
- MIXED: some of each. Do the words; describe the render part.
A note starting "[Slide N]" or with a slide number is about the copy ON that carousel card. Slide copy is baked into the images, so it is RENDER unless the note is clearly about the caption.

Rules: American spelling. Follow the client's style memo. Never make medical, cure, prevention, guarantee or statistic claims. Do not invent facts, prices, people or numbers. Keep what already works; change what the notes ask for. Plain text, no markdown, no emoji unless the current caption already uses them.

Reply with ONE JSON object only, no prose around it:
{"kind": "WORDS|RENDER|MIXED|SKIP",
 "title": "<new title, or the current one>",
 "caption": "<new full caption, or empty if unchanged>",
 "variants": {"<variant id>": "<new caption for that platform, or empty if unchanged>"},
 "render_reason": "<one plain sentence: what needs re-cutting and why; empty unless RENDER or MIXED>",
 "answering": "<quote the note you are answering, short>",
 "summary": "<one or two sentences, first person, what you changed>",
 "skip_reason": "<only for SKIP: why you cannot do a clean job>"}"""


def _patch(table, query, body):
    return lib._req("PATCH", f"/rest/v1/{table}?{query}", body)


def _json(text):
    text = (text or "").strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no JSON in reply")
    return json.loads(m.group(0))


def _newest_note(item):
    notes = item.get("notes") or []
    return max(notes, key=lambda n: n.get("at") or "") if notes else None


def _context(slug):
    cl = lib.get("approval_clients", "select=id,name&slug=eq." + urllib.parse.quote(slug)) or []
    memo = ""
    if cl:
        m = lib.get("client_style_memo", f"select=body&client_id=eq.{cl[0]['id']}&active=eq.true&order=version.desc&limit=1") or []
        memo = m[0]["body"] if m else ""
    rules = lib.get("claim_rules", "select=label,severity&active=eq.true&or=(client_slug.is.null,client_slug.eq."
                    + urllib.parse.quote(slug) + ")") or []
    return memo, "; ".join(sorted({f"{r['label']} ({r['severity']})" for r in rules if r.get("label")}))[:1500]


def _gate(slug, texts):
    """claim_check every non-empty text. Returns list of 'where: reason' for blocks."""
    out = []
    for where, t in texts:
        if not t:
            continue
        r = lib.rpc("claim_check", _client_slug=slug, _text=t, _context="regen") or {}
        if r.get("ok") is False and r.get("severity", "hard") == "hard":
            out.append(f"{where}: {r.get('reason') or 'blocked'}")
    return out


def _ask(item, variants, memo, rules, deadline, fix=None):
    notes = "\n".join(
        f"- {n.get('at', '')[:16]} {n.get('who')} ({n.get('whose')}{', system' if n.get('system') else ''}): {n.get('note')}"
        for n in sorted(item.get("notes") or [], key=lambda n: n.get("at") or ""))
    var = "\n".join(f"[{v['id']}] {v['platform']}: {v.get('caption') or ''}" for v in variants) or "(none)"
    user = (f"Client: {item.get('client_name')} ({item.get('client_slug')})\nStyle memo:\n{memo or '(none)'}\n"
            f"Claim rules the gate enforces: {rules or '(standard)'}\n\n"
            f"Post type: {item.get('media_type')}\nTitle: {item.get('title')}\nCaption:\n{item.get('caption') or ''}\n\n"
            f"Platform variants:\n{var}\n\nNotes, oldest first:\n{notes}")
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
    if fix:
        msgs += [{"role": "assistant", "content": json.dumps(fix["prev"])},
                 {"role": "user", "content": "The claim gate blocked that: " + "; ".join(fix["blocks"])
                  + ". Rewrite so it passes, same JSON shape."}]
    msg, provider = freellm.chat(msgs, None, max_tokens=2500, deadline=deadline)
    return _json(msg.get("content")), provider


def _one(tok, item, deadline, dry):
    iid, slug = item["id"], item.get("client_slug") or ""
    newest = _newest_note(item)
    if newest and newest.get("system"):
        return "waiting", f"{item.get('title')}: Spark already answered; waiting on a person"
    variants = lib.get("approval_variants", f"select=id,platform,caption&item_id=eq.{iid}") or []
    memo, rules = _context(slug)
    plan, provider = _ask(item, variants, memo, rules, deadline)
    kind = (plan.get("kind") or "").upper()
    if kind == "SKIP":
        return "skipped", f"{item.get('title')}: skipped - {plan.get('skip_reason') or 'no clean way to do it'}"
    if kind not in ("WORDS", "RENDER", "MIXED"):
        raise ValueError(f"unknown kind {kind!r}")

    changed = []
    if kind in ("WORDS", "MIXED"):
        vids = {v["id"] for v in variants}
        texts = [("caption", plan.get("caption"))] + [(f"variant {k}", t) for k, t in (plan.get("variants") or {}).items() if k in vids]
        blocks = _gate(slug, texts)
        if blocks:
            plan, provider = _ask(item, variants, memo, rules, deadline, fix={"prev": plan, "blocks": blocks})
            texts = [("caption", plan.get("caption"))] + [(f"variant {k}", t) for k, t in (plan.get("variants") or {}).items() if k in vids]
            blocks = _gate(slug, texts)
            if blocks:
                return "blocked", f"{item.get('title')}: claim gate blocked the rewrite twice ({'; '.join(blocks)[:200]}); left as is"
        if dry:
            return "dry", f"{item.get('title')}: would {kind} via {provider}: {json.dumps(plan)[:1500]}"
        new_caption = plan.get("caption") or item.get("caption") or ""
        new_title = (plan.get("title") or item.get("title") or "").strip() or item.get("title")
        if plan.get("caption") or new_title != item.get("title"):
            r = lib.rpc("studio_item_edit", p_token=tok, p_item=iid, p_title=new_title, p_caption=new_caption) or {}
            if not r.get("ok"):
                return "skipped", f"{item.get('title')}: edit refused ({r.get('error')})"
            changed.append("caption" if plan.get("caption") else "title")
        for vid, cap in (plan.get("variants") or {}).items():
            if cap and vid in vids:
                # only variants of internal items (studio_item_edit just proved stage='internal')
                _patch("approval_variants", f"id=eq.{vid}&item_id=eq.{iid}", {"caption": cap})
                changed.append(next(v["platform"] for v in variants if v["id"] == vid))
    elif dry:
        return "dry", f"{item.get('title')}: would raise re-cut: {plan.get('render_reason')}"

    if kind in ("RENDER", "MIXED"):
        lib.rpc("studio_needs_render", p_token=tok, p_item=iid, p_why=(plan.get("render_reason") or "Needs a re-cut.")[:500])

    note = f"Spark: {plan.get('summary') or 'Updated the words.'}"
    if plan.get("answering"):
        note += f" Answering: \"{plan['answering'][:200]}\"."
    if kind in ("RENDER", "MIXED"):
        note += f" Needs a re-cut: {plan.get('render_reason')}"
    if changed:
        d = lib.rpc("studio_decide", p_token=tok, p_item=iid, p_decision="pending") or {}
        if not d.get("ok"):
            note += " I could not move this back to To review myself; one of you needs to flip it."
    lib.rpc("studio_note", p_token=tok, p_item=iid, p_note=note[:1800])
    lib.rpc("studio_regen_done", p_token=tok, p_item=iid)
    what = ("rewrote " + ", ".join(dict.fromkeys(changed))) if changed else ""
    if kind in ("RENDER", "MIXED"):
        what = (what + "; " if what else "") + "raised re-cut: " + (plan.get("render_reason") or "")
    return "done", f"{item.get('title')}: {what} (via {provider})"


def main(argv):
    dry = "--dry" in argv
    tok = lib.rpc("pi_spark_session")
    try:
        q = lib.rpc("studio_regen_queue", p_token=tok, p_client_slug=None) or {}
        if not q.get("ok"):
            raise RuntimeError(f"queue refused: {q.get('error')}")
        items = q.get("items") or []
        if not items:
            return "nothing waiting"
        deadline = time.time() + DEADLINE_S
        results, done = [], 0
        for item in items:
            if done >= MAX_ITEMS:
                results.append(("later", f"{item.get('title')}: next run"))
                continue
            try:
                kind, line = _one(tok, item, deadline, dry)
            except Exception as e:  # noqa: BLE001  one bad item must not stop the rest
                kind, line = "error", f"{item.get('title')}: {type(e).__name__}: {str(e)[:200]}"
            if kind not in ("waiting",):
                done += 1
            results.append((kind, line))
        acted = [l for k, l in results if k in ("done", "blocked", "skipped", "error")]
        if acted and not dry:
            lib.notify("Studio regen pass", "\n".join(acted)[:1500],
                       severity="warning" if any(k in ("error", "blocked") for k, _ in results) else "info",
                       push=False, url="https://studio.bestly.tech", dedupe="studio-regen-" + time.strftime("%Y%m%d%H"))
        summary = f"{len(items)} waiting: " + " | ".join(l for _, l in results)
        if all(k == "waiting" for k, _ in results):
            return "nothing new: " + summary
        if any(k == "error" for k, _ in results) and not any(k == "done" for k, _ in results):
            raise RuntimeError(summary[:1500])
        return "ok " + summary[:1500]
    finally:
        try:
            lib.rpc("pi_spark_session_end", p_token=tok)
        except Exception:  # noqa: BLE001
            pass
