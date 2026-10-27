#!/usr/bin/env python3
"""Skill Inbox watchdog (owner: Radar). Pi cron, every 3 hours at a jittered minute, free, no AI. STAGED 2026-10-27, not installed.
Deploys to /opt/bestly/cron/jobs/skill_inbox_watch.py; runs as /opt/bestly/cron/run.sh skill_inbox_watch.

Each run:
  1. Heals first: puts rows stuck in 'processing' for 45 min back in the queue and retries errors (skill_inbox_requeue, 3 tries max).
  2. If saves have waited more than 3 hours with nobody working on them, runs the worker once (the auto-recovery).
  3. Raises or clears three alerts through bestly_raise, so each one is signed by Radar (notification_owners prefix radar-skill):
       radar-skill.no-sync   Muse has not checked in for 6 hours (counted from the deploy if it never has)
       radar-skill.backlog   saves are still waiting after the worker was run
       radar-skill.errors    saves failed 3 times and gave up
     An alert resolves itself the first green run. Alerts say what broke and what to do in plain words.
Off switch: touch /opt/bestly/cron/state/skill_inbox.OFF  (the watchdog stays quiet while it exists).
Flags: --dry  --sim=<no-sync|backlog|errors> (force that check red, to prove the alert path; the next normal run resolves it).
Last stdout line is the summary pi_jobs shows.
"""
import os
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402

OFF = "/opt/bestly/cron/state/skill_inbox.OFF"
RUN = "/opt/bestly/cron/run.sh"
NO_SYNC_HOURS = 6
BACKLOG_MIN = 180
AREA = "radar-skill"


def _age_min(iso):
    if not iso:
        return None
    t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - t).total_seconds() / 60.0


def human(mins):
    if mins is None:
        return "never"
    return f"{int(mins)} minutes" if mins < 90 else f"{mins / 60:.0f} hours"


def raise_or_clear(key, bad, title, body, needs, dry):
    if dry:
        return
    if bad:
        lib.rpc("bestly_raise", p_key=key, p_kind="problem", p_severity="warning", p_title=title, p_body=body, p_area=AREA, p_needs_jared=needs, p_healed=False)
    else:
        lib.rpc("bestly_raise", p_key=key, p_kind="resolved", p_severity="info", p_title="Fixed: " + title, p_body="Skill Inbox is working again.", p_area=AREA, p_needs_jared=None, p_healed=True)


def main(argv):
    dry = "--dry" in argv
    sim = next((a.split("=", 1)[1] for a in argv if a.startswith("--sim=")), None)
    if os.path.exists(OFF):
        print("skip: skill_inbox.OFF exists")
        return 0
    st = lib.rpc("skill_inbox_requeue", p_stuck_minutes=45, p_max_attempts=3) if not dry else {}
    st = st or {}
    healed = []
    if st.get("stuck_reset"):
        healed.append(f"{st['stuck_reset']} stuck put back")
    if st.get("retried"):
        healed.append(f"{st['retried']} retried")

    # waited too long with no worker: run it once
    waiting, oldest = st.get("waiting_new") or 0, st.get("oldest_new_min")
    if waiting and oldest is not None and oldest > BACKLOG_MIN and not dry and sim is None:
        try:
            subprocess.run([RUN, "skill_inbox"], timeout=40 * 60, capture_output=True)
            healed.append("ran the worker")
            st = lib.rpc("skill_inbox_requeue", p_stuck_minutes=45, p_max_attempts=3) or st
            waiting, oldest = st.get("waiting_new") or 0, st.get("oldest_new_min")
        except Exception as e:  # noqa: BLE001
            healed.append(f"worker run failed: {str(e)[:60]}")

    # 1. no sync
    base = _age_min(st.get("last_sync_at")) if st.get("last_sync_at") else _age_min(st.get("state_created_at"))
    no_sync = (sim == "no-sync") or (base is not None and base > NO_SYNC_HOURS * 60)
    raise_or_clear(f"{AREA}.no-sync", no_sync, "Skill Inbox has not synced from Instagram",
                   f"Muse has not checked in for {human(base)}. New Saves are not arriving. Radar.",
                   "Open Muse and check the Bestly Skill Inbox connector is still on and its schedule is running. If Muse cannot run on a schedule, share a Reel to Muse with the words send to Bestly.", dry)
    # 2. backlog
    backlog = (sim == "backlog") or (waiting > 0 and oldest is not None and oldest > BACKLOG_MIN)
    raise_or_clear(f"{AREA}.backlog", backlog, "Skill Inbox is behind",
                   f"{waiting} saves have waited {human(oldest)} and the worker did not clear them. Radar.",
                   None, dry)
    # 3. gave up
    gone = st.get("failed_for_good") or 0
    errs = (sim == "errors") or gone > 0
    raise_or_clear(f"{AREA}.errors", errs, "Skill Inbox gave up on some saves",
                   f"{gone} saves failed 3 times and Radar stopped retrying them. The reason is in the skill_inbox error column and the Pi log skill_inbox.log. Radar.", None, dry)

    bad = [n for n, b in (("no sync", no_sync), ("backlog", backlog), ("errors", errs)) if b]
    print(f"{'error' if bad else 'ok'}: {', '.join(bad) if bad else 'sync, queue and errors all fine'}"
          f"{'; healed: ' + ', '.join(healed) if healed else ''}; last Muse check {human(base)} ago")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
