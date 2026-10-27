#!/usr/bin/env python3
"""Skill Inbox, Add to Claude: Mac installer (owner: Radar). Runs every 15 minutes from launchd (tech.bestly.skill-inbox-claude).

What one run does
  1. Asks Supabase (token-gated RPC, the same pattern as docksync-watch.py: publishable key plus a per-Mac token file) for skills Jared sent with
     "Add to Claude" that Radar wrote and Ares cleared, and that this Mac has not installed yet.
  2. For each, re-checks the text, then writes ~/.claude/skills/<name>/SKILL.md ONLY if that folder name is free. It never overwrites or edits an
     existing skill. If the name is taken by something else it uses <name>-from-reel (then -2, -3) and tells the database the new name.
  3. Reports installed or failed per skill, then sends a heartbeat (agent_beats) so Radar's watchdog knows this Mac is alive.
Alerts: a Mac that cannot reach the database 3 runs in a row (45 minutes) reports the problem, signed Radar. A written skill that no Mac installs
for 90 minutes raises an alert from the database itself (skill_inbox_claude_watch).
Files: ~/.bestly/skill_inbox_mac.json (host name, project URL, publishable key; not secret) and ~/.bestly/skill_inbox_mac_token (0600, never printed).
Off switch: touch ~/.bestly/skill_inbox_claude.OFF.   Flags: --dry (write nothing, report nothing).
Python 3.9 compatible (macOS system python). Standard library only. Installs nothing third-party and runs nothing from a skill.
"""
import json
import os
import re
import sys
import tempfile
import time
import urllib.request

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, ".bestly")
CONF = os.path.join(BASE, "skill_inbox_mac.json")
TOKEN = os.path.join(BASE, "skill_inbox_mac_token")
STATE = os.path.join(BASE, "skill_inbox_mac_state.json")
OFF = os.path.join(BASE, "skill_inbox_claude.OFF")
LOG = os.path.join(BASE, "skill-inbox-claude.log")
SKILLS = os.path.join(HOME, ".claude", "skills")

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MARK = "bestly-skill-inbox"
MAX_BYTES = 20000
# second line of defense: the Pi already strips these, so a hit here means something is wrong and the skill is refused
BAD = re.compile(r"(https?://|www\.|\bcurl\b|\bwget\b|\bpip3? install\b|\bnpm (i|install|exec)\b|\bnpx\b|\bbrew install\b|\bgit clone\b|\bsudo\b|\bchmod\b|"
                 r"\.dmg\b|\.exe\b|\.apk\b|\.pkg\b|`)", re.I)


def log(msg):
    print(time.strftime("%Y-%m-%d %I:%M:%S %p"), msg, flush=True)


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def trim_log():
    try:
        if os.path.getsize(LOG) > 500_000:
            with open(LOG, "rb") as f:
                f.seek(-100_000, os.SEEK_END)
                tail = f.read()
            with open(LOG, "wb") as f:
                f.write(tail[tail.find(b"\n") + 1:])
    except Exception:  # noqa: BLE001
        pass


def rpc(conf, token, fn, args, timeout=25):
    body = json.dumps(dict(args, p_token=token)).encode()
    req = urllib.request.Request(conf["url"].rstrip("/") + "/rest/v1/rpc/" + fn, data=body, method="POST",
                                 headers={"apikey": conf["apikey"], "Authorization": "Bearer " + conf["apikey"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def check_skill(item):
    """Returns (id, name, md) or raises ValueError. Never trusts what came back from the database."""
    sid, name, md = item.get("id"), item.get("name"), item.get("skill_md")
    if not (isinstance(sid, str) and ID_RE.match(sid)):
        raise ValueError("bad id")
    if not (isinstance(name, str) and NAME_RE.match(name)):
        raise ValueError("bad name")
    if not isinstance(md, str) or len(md.encode("utf-8")) > MAX_BYTES:
        raise ValueError("bad size")
    if not md.startswith("---\nname: " + name + "\n"):
        raise ValueError("frontmatter does not match the name")
    head, sep, body = md[4:].partition("\n---\n")
    if not sep or not re.search(r"^description: \".{8,}\"$", head, re.M):
        raise ValueError("no one-line description")
    if ("<!-- %s:%s -->" % (MARK, sid)) not in body:
        raise ValueError("origin marker missing")
    if BAD.search(md):
        raise ValueError("contains a link or command")
    if any(ord(c) < 32 and c not in "\n\t" for c in md):
        raise ValueError("control characters")
    return sid, name, md


def renamed(md, old, new):
    return md.replace("name: " + old + "\n", "name: " + new + "\n", 1)


def install(sid, name, md, skills=SKILLS):
    """Write <skills>/<name>/SKILL.md if the folder is free. Returns (final_name, md_written, outcome). Never overwrites anything."""
    os.makedirs(skills, exist_ok=True)
    mark = "<!-- %s:%s -->" % (MARK, sid)
    candidates = [name] + [(name + "-from-reel" + ("" if i == 1 else "-%d" % i))[:64] for i in (1, 2, 3)]
    for cand in candidates:
        target = os.path.join(skills, cand)
        existing = os.path.join(target, "SKILL.md")
        if os.path.exists(existing):
            try:
                if mark in open(existing, encoding="utf-8").read():
                    return cand, None, "already there"            # this very skill, installed earlier
            except Exception:  # noqa: BLE001
                pass
            continue                                              # another skill owns the name: leave it alone
        if os.path.exists(target) or os.path.islink(target):
            continue                                              # folder exists for some other reason: leave it alone
        text = md if cand == name else renamed(md, name, cand)
        try:
            os.makedirs(target, exist_ok=False)                   # fails if anyone created it a moment ago
        except FileExistsError:
            continue
        fd, tmp = tempfile.mkstemp(dir=target, prefix=".tmp-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
            os.chmod(tmp, 0o644)
            os.replace(tmp, existing)
        except Exception:
            try:
                os.remove(tmp)
                os.rmdir(target)
            except Exception:  # noqa: BLE001
                pass
            raise
        return cand, (text if cand != name else None), "installed"
    raise RuntimeError("the folder name and its alternatives are all taken")


def beat(conf, token, ok, summary):
    try:
        rpc(conf, token, "skill_inbox_mac_beat_t", {"p_host": conf["host"], "p_ok": ok, "p_summary": summary[:300]})
    except Exception as e:  # noqa: BLE001
        log("beat failed: %s" % str(e)[:80])


def main(argv):
    dry = "--dry" in argv
    trim_log()
    if os.path.exists(OFF):
        log("skip: skill_inbox_claude.OFF exists")
        return 0
    conf = load_json(CONF, {})
    try:
        token = open(TOKEN).read().strip()
    except Exception:  # noqa: BLE001
        token = ""
    if not (conf.get("url") and conf.get("apikey") and conf.get("host") and token):
        log("error: missing ~/.bestly/skill_inbox_mac.json or skill_inbox_mac_token")
        return 1
    state = load_json(STATE, {"fails": 0})
    try:
        queue = rpc(conf, token, "skill_inbox_mac_queue_t", {"p_host": conf["host"]}) or []
    except Exception as e:  # noqa: BLE001
        state["fails"] = int(state.get("fails", 0)) + 1
        log("could not reach the database (%d in a row): %s" % (state["fails"], str(e)[:80]))
        if state["fails"] >= 3 and not dry:
            beat(conf, token, False, "%s cannot reach the database for %d minutes." % (conf["host"], state["fails"] * 15))
        json.dump(state, open(STATE, "w"))
        return 1
    state["fails"] = 0
    done = failed = 0
    for item in queue:
        sid = str(item.get("id", ""))[:40] if isinstance(item, dict) else ""
        try:
            sid, name, md = check_skill(item)
            if dry:
                log("dry: would install %s" % name)
                continue
            final, new_md, outcome = install(sid, name, md)
            args = {"p_host": conf["host"], "p_id": sid, "p_status": "installed", "p_note": outcome}
            if new_md is not None:
                args.update(p_name=final, p_skill_md=new_md)
            rpc(conf, token, "skill_inbox_mac_done_t", args)
            done += 1
            log("%s: %s as %s" % (sid[:8], outcome, final))
        except Exception as e:  # noqa: BLE001
            failed += 1
            log("%s: failed (%s)" % (sid[:8], str(e)[:100]))
            if not dry and ID_RE.match(sid):
                try:
                    rpc(conf, token, "skill_inbox_mac_done_t", {"p_host": conf["host"], "p_id": sid, "p_status": "failed", "p_note": str(e)[:150]})
                except Exception as e2:  # noqa: BLE001
                    log("could not report the failure: %s" % str(e2)[:80])
    if not dry:
        beat(conf, token, failed == 0, "%s: checked, %d installed, %d failed." % (conf["host"], done, failed) if (done or failed) else "%s: checked, nothing waiting." % conf["host"])
        json.dump(state, open(STATE, "w"))
    log("ok: %d waiting, %d installed, %d failed" % (len(queue), done, failed))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
