#!/usr/bin/env python3
"""Skill Inbox "Add to Claude" drafting job (owner: Radar). Deploys to /opt/bestly/cron/jobs/skill_inbox_claude.py; cron runs it every 20 minutes.
Thin wrapper: all logic is in skill_inbox.py (mode 'claude'). Free AI only, never Claude."""
import sys

sys.path.insert(0, "/opt/bestly/cron/jobs")
import skill_inbox  # noqa: E402

if __name__ == "__main__":
    sys.exit(skill_inbox.main(["claude"] + sys.argv[1:]))
