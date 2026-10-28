#!/usr/bin/env python3
"""Skill Inbox 9:00 AM push gate (owner: Radar). Deploys to /opt/bestly/cron/jobs/skill_inbox_push.py; cron runs it at minute 0 of every hour
(so it is correct whatever timezone the Pi is in); it only acts when it is 9 AM in Los Angeles, and the database sends at most one push a day.
Thin wrapper: all logic is in skill_inbox.py (mode 'push')."""
import sys

sys.path.insert(0, "/opt/bestly/cron/jobs")
import skill_inbox  # noqa: E402

def main(argv):
    return skill_inbox.main(["push"] + list(argv))


if __name__ == "__main__":
    sys.exit(skill_inbox.main(["push"] + sys.argv[1:]))
