"""Mail bridge (was Mac launchd tech.bestly.mailbridge, every 5 min). Moved to the Pi 2026-10-03."""
from jobs import macmoved

D = "/opt/bestly/mac-moved/mail"


def main(argv):
    return macmoved.run(["/usr/bin/python3", f"{D}/mail_sync.py", "--quiet"], D, timeout=270, dry="--dry" in argv)
