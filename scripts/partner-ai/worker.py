#!/usr/bin/env python3
"""Partner assistant worker (Mac mini, launchd tech.bestly.partner-ai).

Answers questions from the /partner "Ask" tab with the local model in Ollama, so the chat costs
nothing: no paid API. Polls partner_ai_claim every 2s (Postgres RPC, not an edge function, so
polling is free), streams the answer back with partner_ai_write, and the portal shows it live.

Standard library only. Key in ~/PartnerAI/.key (also in Supabase Vault as partner_ai_worker_key).
"""
import json, os, re, time, traceback, urllib.error, urllib.request
from datetime import datetime

VERSION = "1.0.0"
HOME = os.path.expanduser("~/PartnerAI")
SB = "https://rcqfqhguwpmaarseifqg.supabase.co/rest/v1/rpc/"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcWZxaGd1d3BtYWFyc2VpZnFnIiwicm9sZSI6"
        "ImFub24iLCJpYXQiOjE3NzUzNTc1OTUsImV4cCI6MjA5MDkzMzU5NX0.MHwsTd3CmaTViv3HoFRbeF1t6hmlf5W-p_4eHFBQP9k")
KEY = open(f"{HOME}/.key").read().strip()
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("PARTNER_AI_MODEL", "qwen3:8b")
LOG = f"{HOME}/worker.log"
POLL_S = 2
STAGE = {3: "Discovery", 4: "SOW + deposit", 5: "Tech intake", 6: "Provisioning", 7: "Install", 8: "Live"}

ABOUT = """Bestly LLC is Jared Best's product studio (bestly.tech), privacy-first and plain-spoken. What it makes:
- In-House Cloud: a private cloud server (Nextcloud: files, calendar, Talk video calls, office docs) installed at a business, sold as a project (discovery call, SOW + deposit, tech intake, provisioning, install, live).
- Cookie Yeti: a browser extension and Apple app that handles cookie banners for you.
- InventoryProof: a home-inventory app for insurance claims (live on the App Store).
- Other products in the studio: SchoolPilot, ParentIQ, HOAscope, HOKU, El Dora, and Vesta (a women-only social + well-being app with Eli and Rohit).
Bestly runs its own tools on cloud.bestly.tech: Deck (Bestly Ops board), Talk, Files, Calendar, and Studio (studio.bestly.tech, the review queue)."""


def log(*a):
    with open(LOG, "a") as f:
        f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a) + "\n")


def rpc(name, body, timeout=20):
    req = urllib.request.Request(SB + name, data=json.dumps(body).encode(), method="POST", headers={
        "apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode() or "null"
    return json.loads(raw)


def write(reply_id, text, done=False, error=None):
    rpc("partner_ai_write", {"p_key": KEY, "p_reply_id": reply_id, "p_content": text, "p_done": done, "p_error": error})


def context(job):
    name = job.get("name") or "Partner"
    lines = [f"You are the Bestly partner assistant, chatting with {name}. Today is {datetime.now():%A, %B %-d, %Y}.", "", ABOUT, ""]
    calls = job.get("calls") or []
    if calls:
        lines.append(f"Recent calls {name} was on (newest first):")
        for c in calls:
            s = c.get("summary") or {}
            when = (c.get("date") or "")[:10]
            lines.append(f"- {when} with Jared" + (f" and {', '.join(p.title() for p in c.get('people') or [] if p.lower() != name.lower())}" if c.get("people") else ""))
            if s.get("summary"): lines.append(f"  Summary: {s['summary']}")
            for d in (s.get("decisions") or [])[:6]: lines.append(f"  Decided: {d}")
            for q in (s.get("questions") or [])[:4]: lines.append(f"  Still open: {q}")
        lines.append("")
    todos = job.get("todos") or []
    if todos:
        lines.append("Open to-dos from those calls:")
        for t in todos:
            lines.append(f"- [{(t.get('owner') or '?').title()}] {t.get('title')}" + (f" (due {t['due']})" if t.get("due") else ""))
        lines.append("")
    p = job.get("pipeline") or {}
    if p.get("deals") or p.get("leads"):
        lines.append("In-House Cloud pipeline:")
        for d in p.get("deals") or []: lines.append(f"- {d.get('company')}: {STAGE.get(d.get('stage'), 'stage ' + str(d.get('stage')))}")
        for l in p.get("leads") or []: lines.append(f"- {l.get('company')}: new lead ({l.get('size') or 'size unknown'})")
        lines.append("")
    lines.append(
        "How to answer: short, clear and friendly, like a sharp colleague texting back. Lead with the answer. "
        "Use the calls, to-dos and pipeline above when they're relevant and say which call a fact came from. "
        "If something isn't in them, say you don't know rather than guessing, and suggest asking Jared. "
        "Never invent numbers, prices, dates or commitments. You can't send messages, change anything or see "
        "anything beyond what's above; you can draft emails, messages, outlines and ideas for them to use. "
        "Plain text, no markdown tables.")
    return "\n".join(lines)


def answer(job):
    reply_id = job["reply_id"]
    msgs = [{"role": "system", "content": context(job)}]
    msgs += [{"role": h["role"], "content": h["content"]} for h in job.get("history") or []]
    msgs.append({"role": "user", "content": job["question"]})
    body = json.dumps({"model": MODEL, "messages": msgs, "stream": True, "think": False,
                       "options": {"temperature": 0.5, "num_ctx": 8192}}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/chat", data=body, headers={"Content-Type": "application/json"})
    text, last, started = "", 0.0, time.time()
    with urllib.request.urlopen(req, timeout=240) as r:
        for raw in r:
            if not raw.strip(): continue
            chunk = json.loads(raw)
            text += (chunk.get("message") or {}).get("content", "")
            if time.time() - started > 230: break
            shown = clean(text)
            if shown and time.time() - last > 0.7:
                write(reply_id, shown); last = time.time()
            if chunk.get("done"): break
    final = clean(text) or "Sorry, I came up empty on that one. Try asking another way?"
    write(reply_id, final, done=True)
    log("answered", reply_id, f"{len(final)} chars in {time.time() - started:.1f}s")


def clean(t):
    t = re.sub(r"<think>.*?(</think>|$)", "", t, flags=re.S)
    return t.strip()


def main():
    log(f"partner-ai worker {VERSION} starting, model {MODEL}")
    backoff = POLL_S
    while True:
        try:
            job = rpc("partner_ai_claim", {"p_key": KEY, "p_model": MODEL})
            backoff = POLL_S
            if job:
                try:
                    answer(job)
                except Exception as e:  # model down, timeout: tell the asker, don't hang
                    log("answer failed", repr(e), traceback.format_exc()[-800:])
                    try: write(job["reply_id"], "", error="The assistant hit a snag on this one. Try again in a minute.")
                    except Exception: pass
                continue
        except urllib.error.HTTPError as e:
            log("rpc http", e.code, e.read()[:300]); backoff = min(60, backoff * 2)
        except Exception as e:
            log("rpc error", repr(e)); backoff = min(60, backoff * 2)
        time.sleep(backoff)


if __name__ == "__main__":
    main()
