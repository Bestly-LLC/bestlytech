"""Vera, Compliance Officer: weekly job. Runs on the Pi on Mondays at about 6:40 AM PT (bestly-cron). Free AI only (freellm ladder).

1. Runs the weekly checks (domain expiry, App Store listing changes).
2. Law watch: reads each active row of law_watch_sources (FTC, FCC, CPPA, CDTFA, Apple, Chrome Web Store ...), diffs it against last week,
   and has the free AI say what a change means for Bestly, using compliance_context. High = one alert signed Vera (held for the 7 PM recap
   unless it is money/security), the rest wait in law_watch_items for the Security > Compliance tab.
First sight of a source = quiet baseline. A page that cannot be read 4 weeks in a row raises one alert.

Flags: --dry (print, write nothing), --only <source id>, --skip-checks, --force-judge (judge the current text once, for testing)
Off switch: touch /opt/bestly/cron/state/compliance_weekly.OFF   (or compliance.OFF to stop both jobs)
"""
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import time

import freellm
import lib
import compliance_common as cc

LAW_STATE = "/opt/bestly/cron/state/compliance_law"
BROWSER_JSON = ["/opt/bestly/turo-watch/.venv/bin/python", "/opt/bestly/cron/compliance_browser.py"]
MAX_JUDGE = 8
MIN_ADDED = 200
BLOCK = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "br", "tr", "section", "article", "td", "dd", "dt"}


def lines_of(html_):
    html_ = re.sub(r"(?is)<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>", " ", html_)
    html_ = re.sub(r"(?i)</?(%s)\b[^>]*>" % "|".join(BLOCK), "\n", html_)
    html_ = re.sub(r"(?s)<[^>]+>", " ", html_)
    import html as _h
    out = []
    for ln in _h.unescape(html_).splitlines():
        ln = re.sub(r"\s+", " ", ln).strip()
        if len(ln) >= 3:
            out.append(ln)
    return out


def read_source(src):
    if src.get("browser"):
        out = subprocess.run(BROWSER_JSON + [json.dumps([{"url": src["url"]}])], capture_output=True, text=True, timeout=180)
        if out.returncode != 0:
            raise RuntimeError("browser: " + (out.stderr or out.stdout)[-200:])
        pg = json.loads(out.stdout)["pages"][0]
        if pg.get("error") and not pg.get("text"):
            raise RuntimeError(pg["error"])
        return [re.sub(r"\s+", " ", x).strip() for x in pg["text"].splitlines() if len(x.strip()) >= 3]
    st, body = cc.fetch_plain(src["url"], 40)
    if st >= 400:
        raise RuntimeError(f"HTTP {st}")
    return lines_of(body)


def _sp(sid):
    return os.path.join(LAW_STATE, re.sub(r"[^a-z0-9-]", "_", sid) + ".json")


def load_state(sid):
    try:
        with open(_sp(sid)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save_state(sid, lines, dry):
    if dry:
        return
    os.makedirs(LAW_STATE, exist_ok=True)
    with open(_sp(sid) + ".tmp", "w") as f:
        json.dump({"lines": lines[:3000], "at": time.time()}, f)
    os.replace(_sp(sid) + ".tmp", _sp(sid))


def fp(sid, text):
    return sid + ":" + hashlib.sha1(re.sub(r"\W+", "", text.lower()).encode()).hexdigest()[:16]


def judge(ctx, src, text, deadline):
    today = datetime.date.today().strftime("%B %-d, %Y")
    system = (
        "You are Vera, the Compliance Officer at Bestly. You read new text from a regulator or platform and decide what it means for THIS business. "
        "Be concrete and plain: short sentences, US dates like Oct 8, money in dollars. Today is " + today + ". Use only facts in the new text and the business context. "
        "Never invent penalties, thresholds or dates. You are not a lawyer: say what to check, not what the law is.\n"
        "Impact: high = a new or changed rule, deadline or enforcement that clearly applies to what Bestly does (AI voice agents and calls, recording, "
        "texts, a privacy policy, apps in the App Store or Chrome Web Store, California sales tax or filings) AND needs action within 90 days; "
        "medium = likely applies, worth planning this quarter; low = good to know; none = does not touch us (other industries, other countries, "
        "press about a company we do not use, page chrome, dates, counters). When unsure between high and medium, choose medium.\n"
        "Return JSON only: {\"impact\":\"high|medium|low|none\",\"headline\":\"max 60 characters\",\"what_changed\":\"1-2 sentences\","
        "\"what_it_means\":\"1-3 sentences specific to Bestly\",\"effective_date\":\"YYYY-MM-DD or null\","
        "\"actions\":[{\"title\":\"short imperative\",\"owner\":\"team slug\"}]}. Max 3 actions, none if impact is none.\n\n"
        "BUSINESS CONTEXT:\n" + ctx)
    user = f"Source: {src['platform']} ({src['name']})\nURL: {src['url']}\n\nNEW TEXT SINCE LAST WEEK:\n{text[:7000]}"
    msg, prov = freellm.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                             None, max_tokens=1000, deadline=deadline, json_mode=True)
    raw = re.sub(r"^```(?:json)?|```$", "", (msg.get("content") or "").strip()).strip()
    j = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    imp = str(j.get("impact", "none")).lower()
    if imp not in ("high", "medium", "low", "none"):
        imp = "low"
    acts = [{"title": str(a.get("title", ""))[:120], "owner": str(a.get("owner", ""))[:40]}
            for a in (j.get("actions") or [])[:3] if isinstance(a, dict) and a.get("title")]
    return {"impact": imp, "headline": str(j.get("headline", ""))[:90], "what_changed": str(j.get("what_changed", "")),
            "what_it_means": str(j.get("what_it_means", "")), "effective_date": j.get("effective_date"), "actions": acts, "model": prov}


def law_watch(dry, only, force, notes):
    srcs = lib.get("law_watch_sources", "select=*&active=is.true&order=platform")
    ctx = (lib.get("compliance_context", "select=body&id=eq.1") or [{}])[0].get("body", "")
    deadline = time.time() + 20 * 60
    rep, items, todo = [], [], []
    for src in srcs:
        if only and src["id"] != only:
            continue
        sid = src["id"]
        try:
            lines = read_source(src)
            if len(lines) < 8:
                raise RuntimeError(f"page came back nearly empty ({len(lines)} lines)")
            st = load_state(sid)
            changed = False
            if st is None:
                if force:
                    todo.append((src, "\n".join(lines)[:7000]))
            else:
                seen = set(st.get("lines", []))
                added = "\n".join(x for x in lines if x not in seen and len(x) > 25)
                if len(added) >= MIN_ADDED:
                    changed = True
                    todo.append((src, added))
                elif force:
                    todo.append((src, "\n".join(lines)[:7000]))
            save_state(sid, lines, dry)
            rep.append({"id": sid, "ok": True, "changed": changed})
        except Exception as e:  # noqa: BLE001
            rep.append({"id": sid, "ok": False, "changed": False, "error": f"{type(e).__name__}: {e}"[:300]})
            notes.append(f"{sid}: {str(e)[:120]}")
    judged = 0
    for src, text in todo:
        if judged >= MAX_JUDGE or time.time() > deadline:
            notes.append(f"left {len(todo) - judged} change(s) for next week")
            break
        try:
            j = judge(ctx, src, text, deadline)
        except Exception as e:  # noqa: BLE001
            notes.append(f"judge {src['id']}: {str(e)[:120]}")
            j = {"impact": "low", "headline": (src["name"] + " changed")[:60], "what_changed": "Vera could not judge this change (free AI busy).",
                 "what_it_means": "Open the page and check.", "effective_date": None, "actions": [], "model": None}
        judged += 1
        items.append({"source_id": src["id"], "platform": src["platform"], "url": src["url"], "title": src["name"] + " changed",
                      "fingerprint": fp(src["id"], text), "excerpt": text[:4000], **j})
    if dry:
        for i in items:
            print(json.dumps({k: i[k] for k in ("source_id", "impact", "headline", "what_it_means", "actions", "model")})[:700])
        res = {"dry": True}
    else:
        res = lib.rpc("compliance_law_report", p={"sources": rep, "items": items})
    return rep, items, res


def main(argv):
    dry = "--dry" in argv
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    off = cc.off_switch("compliance_weekly")
    if off:
        return f"skip: {off}"
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    parts, notes = [], []
    if "--skip-checks" not in argv and not only:
        checks = lib.get("compliance_checks", "select=*&active=is.true&every=eq.weekly&order=id")
        results = cc.run_checks(checks, dry=dry)
        ok, bad, err = cc.summarize(results)
        if dry:
            for r in results:
                print({True: "PASS", False: "FAIL", None: "ERR "}[r["ok"]], r["id"], r["detail"][:160])
            parts.append(f"dry: {len(results)} weekly checks, {ok} pass, {len(bad)} fail, {len(err)} could not run")
        else:
            rep = lib.rpc("compliance_check_report", p={"kind": "weekly", "started_at": started,
                                                         "results": [{"id": r["id"], "ok": r["ok"], "detail": r["detail"]} for r in results]})
            parts.append(rep.get("summary") if isinstance(rep, dict) else str(rep))
            if results and len(err) * 2 > len(results):
                raise RuntimeError(f"{len(err)} of {len(results)} weekly checks could not run")
    rep, items, res = law_watch(dry, only, "--force-judge" in argv, notes)
    bad_src = [s["id"] for s in rep if not s["ok"]]
    hi = [i["headline"] for i in items if i["impact"] == "high"]
    parts.append(f"law watch: {len(rep) - len(bad_src)}/{len(rep)} sources read, {len(items)} change(s) judged"
                 + (f", {len(hi)} high: " + " | ".join(hi) if hi else "")
                 + (f"; unreadable: {', '.join(bad_src)}" if bad_src else ""))
    if rep and len(bad_src) * 2 > len(rep):
        raise RuntimeError("law watch: more than half the sources could not be read: " + ", ".join(bad_src[:8]))
    return ("ok: " if not dry else "dry: ") + " | ".join(parts) + ("; " + " ; ".join(notes)[:300] if notes else "")


if __name__ == "__main__":
    print(main(sys.argv[1:]))
