"""Sent-mail sync (was Mac launchd tech.bestly.sentsync, every 10 min). Moved to the Pi 2026-10-03."""
from jobs import macmoved

D = "/opt/bestly/mac-moved/mail"


def main(argv):
    return macmoved.run(["/usr/bin/python3", f"{D}/sent_sync.py"], D, timeout=540, dry="--dry" in argv)
