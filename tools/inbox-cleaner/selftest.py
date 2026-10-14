#!/usr/bin/env python3
"""Rules self-test. No mailbox, no network. Run before going live."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inbox_cleaner_rules as R  # noqa: E402

# (sender, display name, subject, must_be_protected)
CASES = [
    ("eli.cooper@bdcuniversal.com", "Eli Cooper", "call tomorrow?", True),
    ("someone@essex.com", "The Blake LA", "Rent reminder", True),
    ("jaredbest@icloud.com", "Jared", "note to self", True),
    ("noreply@turo.com", "Turo", "Your trip starts soon", True),
    ("no-reply@appstoreconnect.apple.com", "App Store Connect",
     "InventoryProof is Ready for Review", True),
    ("alerts@capitalone.com", "Capital One", "Your statement is ready", True),
    ("jobs@greenhouse.io", "Acme", "Thank you for applying", True),
    ("x@randomshop.com", "Random Shop", "Your order has shipped", True),
    ("security@apple.com", "Apple", "New sign-in to your Apple Account", True),
    ("hello@allbirds.com", "Allbirds", "40% off everything", False),
    ("news@dailyjocks.com", "DailyJocks", "Last chance: flash sale", False),
    ("alerts@glassdoor.com", "Glassdoor Jobs", "New jobs you may like", False),
    ("digest@substack.com", "Substack", "This week in tech", False),
]

failures = []
for sender, name, subject, expect_protected in CASES:
    got = R.is_protected_message(sender, name, subject)
    if got != expect_protected:
        failures.append("%s / %s -> protected=%s, expected %s"
                        % (sender, subject, got, expect_protected))

# known marketing senders must be recognised
for sender, name in (("hello@allbirds.com", "Allbirds"),
                     ("x@notateslaapp.com", "Not a Tesla App"),
                     ("hi@craftdlondon.com", "CRAFTD London")):
    if not R.is_known_marketing(sender, name):
        failures.append("%s not recognised as known marketing" % sender)

# scoring: a promo blast scores high, a quiet unknown sender does not
promo = R.marketing_score(["50% off ends tonight", "Shop now", "New arrivals"],
                          True, 30)
quiet = R.marketing_score(["Re: Thursday"], False, 1)
if promo < R.AUTO_KILL_SCORE:
    failures.append("promo blast scored %.2f, below auto-kill" % promo)
if quiet >= R.IGNORE_BELOW_SCORE:
    failures.append("quiet sender scored %.2f, would be considered" % quiet)

if failures:
    print("SELF-TEST FAILED (%d):" % len(failures))
    for line in failures:
        print("  -", line)
    sys.exit(1)
print("self-test passed: %d cases, scoring sane (promo %.2f, quiet %.2f)"
      % (len(CASES), promo, quiet))
