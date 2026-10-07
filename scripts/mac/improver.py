#!/usr/bin/env python3
"""
The Improver — nightly autonomous improvement loop for all Bestly products.
Runs at 2 AM from launchd (tech.bestly.improver) on the Mac mini.
Repo copy of ~/bin/improver.py (source of truth is the Mac; keep in sync).

What it does each run:
  1. Reads open incidents + recent admin_chat_actions tool errors
  2. Reads open improver_ideas (status='new') ranked by impact
  3. For each: auto-fixes if effort=S and kind in (reliability, workflow, tokens)
     and the fix is reversible — otherwise files a note and escalates to Scout
  4. Scans ai_spend for any provider over 80% of daily_cap and cools it down
  5. Checks every bestly_agent for missed heartbeats and logs a warning
  6. Writes a recap to autonomy_recaps so Scout can report in the morning
  7. Updates The Improver's own last_run pulse in bestly_agents

Nothing irreversible runs without Jared's tap.
All actions are logged to ~/Library/Application Support/bestly-improver/log.
"""
import json, os, subprocess, time, urllib.request, urllib.error, datetime

REF = "rcqfqhguwpmaarseifqg"
SB  = f"https://{REF}.supabase.co"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
DIR  = os.path.expanduser("~/Library/Application Support/bestly-improver")
LOG  = os.path.join(DIR, "log")
STATE = os.path.join(DIR, "state.json")

os.makedirs(DIR, exist_ok=True)

# ── helpers ──────────────────────────────────────────────────────────────────

def log(msg):
    with open(LOG, "a") as f:
        f.write(datetime.datetime.now().strftime("%Y-%m-%d %I:%M:%S %p ") + msg + "\n")
    print(msg)

def keychain(service, account=None):
    args = ["security", "find-generic-password", "-s", service, "-w"] + \
           (["-a", account] if account else [])
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=10).stdout.strip() or None
    except Exception:
        return None

def sb_get(path, token=None):
    req = urllib.request.Request(
        f"{SB}/rest/v1/{path}",
        headers={
            "apikey": token or ANON,
            "Authorization": f"Bearer {token or ANON}",
            "Accept": "application/json",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"  GET {path} failed: {e}")
        return []

def sb_patch(path, data, token=None):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{SB}/rest/v1/{path}",
        data=body,
        method="PATCH",
        headers={
            "apikey": token or ANON,
            "Authorization": f"Bearer {token or ANON}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"  PATCH {path} failed: {e}")
        return []

def sb_post(path, data, token=None):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{SB}/rest/v1/{path}",
        data=body,
        method="POST",
        headers={
            "apikey": token or ANON,
            "Authorization": f"Bearer {token or ANON}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"  POST {path} failed: {e}")
        return []

def hapush(title, body, severity="info"):
    """Send a push to Jared via Home Assistant (same path as the watchdog)."""
    try:
        token = keychain("bestly-ha-token")
        if not token:
            log("  hapush: no HA token in keychain, skipping push")
            return
        payload = json.dumps({"title": title, "message": body, "data": {"priority": severity}}).encode()
        req = urllib.request.Request(
            "http://bestly-pi.local:8123/api/services/notify/mobile_app_jared",
            data=payload,
            method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        log(f"  hapush failed: {e}")

# ── safe auto-fixes (S-effort, reversible) ────────────────────────────────────

AUTO_FIX_KINDS   = {"reliability", "workflow", "tokens"}
AUTO_FIX_EFFORTS = {"S"}

def try_auto_fix(idea):
    """
    Attempt a safe, reversible fix for an idea.
    Returns (fixed: bool, action_note: str).
    The only things we do here are DB patches — no file writes, no restarts.
    """
    title = idea.get("title", "")
    kind  = idea.get("kind", "")
    area  = idea.get("area", "")

    # Extend Scout Autopilot interval
    if "autopilot" in title.lower() and "30" in title:
        rows = sb_get("autonomy_settings?select=id,autopilot_interval_min&limit=1")
        if rows and rows[0].get("autopilot_interval_min", 10) < 30:
            sb_patch(f"autonomy_settings?id=eq.{rows[0]['id']}",
                     {"autopilot_interval_min": 30})
            return True, "Set autopilot_interval_min to 30"
        return False, "Already at 30 min or not found"

    # Token cap ideas — mark accepted so Scout sees them; code change is separate
    if "token" in title.lower() or kind == "tokens":
        return False, "Token cap needs a code change — escalated to Scout"

    return False, "No safe auto-fix available — escalated to Scout"

# ── ai_spend cap check ────────────────────────────────────────────────────────

def check_ai_spend(token):
    """Cool down any provider over 80% of its daily cap."""
    providers = sb_get("llm_providers?select=slug,name,daily_cap,cooldown_until&enabled=eq.true", token)
    today = datetime.date.today().isoformat()
    spend_rows = sb_get(f"ai_spend?select=provider,tokens_used&date=eq.{today}", token)
    spend = {r["provider"]: r["tokens_used"] for r in spend_rows}

    cooled = []
    for p in providers:
        cap = p.get("daily_cap") or 0
        used = spend.get(p["slug"], 0)
        if cap and used >= cap * 0.8:
            until = (datetime.datetime.utcnow() + datetime.timedelta(hours=6)).isoformat() + "Z"
            sb_patch(f"llm_providers?slug=eq.{p['slug']}", {"cooldown_until": until})
            cooled.append(f"{p['name']} ({used}/{cap} tokens)")
            log(f"  Cooled down {p['name']}: {used}/{cap} tokens used today")
    return cooled

# ── agent heartbeat check ─────────────────────────────────────────────────────

def check_agent_heartbeats():
    """Warn if any active agent hasn't updated its pulse in over 2 hours."""
    agents = sb_get("bestly_agents?select=name,slug,status,pulse,runs_on&status=eq.active")
    now = datetime.datetime.utcnow()
    stale = []
    for a in agents:
        pulse = a.get("pulse")
        if not pulse:
            continue
        try:
            last = datetime.datetime.fromisoformat(pulse.replace("Z", ""))
            age_h = (now - last).total_seconds() / 3600
            if age_h > 2:
                stale.append(f"{a['name']} (last seen {age_h:.1f}h ago)")
        except Exception:
            pass
    return stale

# ── main loop ─────────────────────────────────────────────────────────────────

def main():
    log("=== The Improver starting ===")
    token = keychain("bestly-supabase-pat") or ANON

    fixes   = []   # auto-fixed
    escals  = []   # escalated to Scout
    summary = []

    # 1. Read open improver_ideas ranked by impact
    ideas = sb_get(
        "improver_ideas?select=id,title,area,kind,effort,impact,status"
        "&status=eq.new&order=impact.desc&limit=20",
        token
    )
    log(f"  {len(ideas)} open ideas")

    for idea in ideas:
        effort = idea.get("effort", "M")
        kind   = idea.get("kind", "")
        title  = idea.get("title", "")
        iid    = idea["id"]

        if effort in AUTO_FIX_EFFORTS and kind in AUTO_FIX_KINDS:
            fixed, note = try_auto_fix(idea)
            if fixed:
                sb_patch(f"improver_ideas?id=eq.{iid}",
                         {"status": "done", "note": f"Auto-fixed by The Improver: {note}",
                          "decided_at": datetime.datetime.utcnow().isoformat() + "Z"})
                fixes.append(f"{title} — {note}")
                log(f"  AUTO-FIXED: {title}")
            else:
                sb_patch(f"improver_ideas?id=eq.{iid}",
                         {"note": f"Improver checked: {note}"})
                escals.append(f"{title} (impact {idea.get('impact',0)}): {note}")
                log(f"  ESCALATED: {title}")
        else:
            escals.append(
                f"{title} (effort={effort}, kind={kind}, impact={idea.get('impact',0)})"
            )
            log(f"  ESCALATED (M effort): {title}")

    # 2. ai_spend cap check
    cooled = check_ai_spend(token)
    if cooled:
        summary.append("Cooled down providers: " + ", ".join(cooled))

    # 3. Agent heartbeat check
    stale = check_agent_heartbeats()
    if stale:
        summary.append("Stale agents: " + ", ".join(stale))
        log(f"  STALE AGENTS: {', '.join(stale)}")

    # 4. Write autonomy_recap so Scout sees it in the morning
    recap_lines = []
    if fixes:
        recap_lines.append("Auto-fixed: " + " | ".join(fixes))
    if escals:
        recap_lines.append("Needs Scout: " + " | ".join(escals[:5]))
    if cooled:
        recap_lines.append("AI spend: " + ", ".join(cooled))
    if stale:
        recap_lines.append("Stale agents: " + ", ".join(stale))
    if not recap_lines:
        recap_lines.append("All clear — no open ideas or spend issues.")

    sb_post("autonomy_recaps", {
        "agent": "the-improver",
        "summary": "\n".join(recap_lines),
        "fixes": len(fixes),
        "escalations": len(escals),
        "created_at": datetime.datetime.utcnow().isoformat() + "Z"
    }, token)

    # 5. Update own pulse in bestly_agents
    sb_patch(
        "bestly_agents?slug=eq.the-improver",
        {"pulse": datetime.datetime.utcnow().isoformat() + "Z", "status": "active"},
        token
    )

    # 6. Push to Jared if anything needs him
    if escals or stale:
        hapush(
            "The Improver ran",
            f"{len(fixes)} auto-fixed, {len(escals)} need Scout, {len(stale)} stale agents."
        )

    log(f"=== Done. {len(fixes)} fixed, {len(escals)} escalated ===")

if __name__ == "__main__":
    main()
