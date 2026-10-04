"""Partner mail sync (was Mac launchd tech.bestly.partner-mail, every 10 min). Moved to the Pi 2026-10-03."""
from jobs import macmoved

D = "/opt/bestly/mac-moved/partner"


def main(argv):
    return macmoved.run(["/usr/bin/python3", f"{D}/partner_mail.py"], D, timeout=540, dry="--dry" in argv)
