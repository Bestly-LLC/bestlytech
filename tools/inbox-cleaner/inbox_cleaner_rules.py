"""Classification rules for the iCloud inbox cleaner.

Ported verbatim from the Claude scheduled task "Daily iCloud Inbox Cleanup"
(trig_01KsEa7kVMR2ERcvJQaNsmnR), retired 2026-10-14.

Nothing here deletes anything. These are lists and predicates only.
Edit this file to change behaviour -- the worker never guesses.
"""

# --------------------------------------------------------------------------
# PROTECTED -- never touched, left in INBOX regardless of age.
# --------------------------------------------------------------------------

PROTECTED_ADDRESSES = {
    "elizabethobrienlpc@gmail.com",
    "eli.cooper@bdcuniversal.com",
    "spencer@sdprovost.com",
    "theblakela@essex.com",
    "ppaez@kemper.com",
    "jermaine.johnson@roamly.com",
    "nick@parkmyshare.com",
    "info@parkmyshare.com",
    "info@parkmycarshare.com",
    "info@renewcollisioncenter.com",
    "support@lotus.ai",
    "erik@tm4smallbiz.com",
    "info@gerbenlaw.com",
    "deployment_support@apple.com",
}

PROTECTED_DOMAINS = {
    "bdcuniversal.com",
    "essex.com",
    "kemper.com",
    "roamly.com",
    "parkmyshare.com",
    "parkmycarshare.com",
    "gerbenlaw.com",
    "sdprovost.com",
    # Added 2026-10-14 from a real scan of the inbox: these senders mix
    # account/transactional mail with promos, so the whole domain is kept.
    # Losing a little cleaning volume beats trashing a service notice.
    "tesla.com",              # vehicle app access, service, recalls
    "chase.com",              # security alerts, autopay notices
    "apple.com",              # Apple Business, Apple ID, developer
    "email.apple.com",        # App Store Connect build mail
    "tezlabapp.com",          # EV authorization for the Turo car
    "vercel.com",             # deployment failures
    "github.com",             # Bestly repo notifications
    "mercury.com",
    "coinbase.com",
    "robinhood.com",
    "doordash.com",
    "the-blake-la.residentservice.com",
    "email.informeddelivery.usps.com",
}

# Jared's own addresses -- self-sent notes.
OWN_ADDRESSES = {
    "jaredbest@icloud.com",
    "jarhead2000@me.com",
    "jared@bestly.tech",
    "jard@bestly.tech",
    "jareds.mac@gmail.com",
}

# Subject/sender keywords that protect a single message even when the sender
# is otherwise unknown. Matched case-insensitively against "from + subject".
PROTECTED_KEYWORDS = (
    # Turo / carshare
    "turo", "carshare", "car share", "guest trip", "trip request", "host payout",
    # Tesla account / service (marketing is handled separately below)
    "tesla service", "tesla insurance", "tesla account", "service appointment",
    "vehicle registration", "registration renewal",
    # insurance + claims
    "kemper", "progressive", "national general", "claim", "adjuster", "collision",
    "deductible", "policy renewal",
    # Apple developer
    "app store connect", "testflight", "app review", "developer program",
    "inventoryproof", "cookie yeti",
    # security
    "passkey", "new device", "new sign-in", "new sign in", "sign-in attempt",
    "password reset", "two-factor", "2fa", "verification code", "security alert",
    "suspicious activity",
    # financial
    "capital one", "mercury", "robinhood", "stripe", "paypal", "statement",
    "invoice", "receipt", "tax", "1099", "refund", "payment due", "autopay",
    "chase", "coinbase", "automatic payment", "failed to charge", "overdraft",
    # legal / government
    "trademark", "llc", "secretary of state", "court", "irs", "dmv", "cdtfa",
    "franchise tax", "summons", "subpoena",
    # housing
    "essex", "the blake", "rent", "lease", "parking permit", "renewal offer",
    "resident", "garage", "formal notice",
    # Bestly ops / infrastructure
    "bestly", "roofguard", "lbmc", "legacy building", "deployment failed",
    "run failed", "build failed", "pull request", "incident",
    # transactional
    "order confirmation", "your order", "has shipped", "shipping", "tracking",
    "delivery", "appointment", "confirmed", "ticket", "boarding", "itinerary",
    "undeliverable", "delivery status notification", "mail delivery",
    # job hunt -- Jared is actively applying from this address
    "application", "applied", "interview", "recruiter", "hiring", "candidate",
    "your resume", "thank you for applying", "position", "offer letter",
)

# Marketing wins over a protected keyword only for these sender/subject pairs.
MARKETING_OVERRIDE_KEYWORDS = (
    "tesla shop", "tesla gear", "referral program", "demo drive",
    "now available to order", "new in the shop",
)

# Generic job-alert blasts. The task protects real applications, interviews and
# recruiters, but these senders only ever send "jobs you may like" lists, and
# their subjects are job titles that would otherwise trip the hiring keywords.
JOB_ALERT_SENDERS = (
    "match.indeed.com", "alert.indeed.com", "noreply@glassdoor.com",
    "ziprecruiter.com", "jobalerts-noreply@linkedin.com", "jobs-listings@linkedin.com",
    "talent.com", "lensa.com", "jobcase.com",
)

# --------------------------------------------------------------------------
# MARKETING -- confirmed senders. Matched on address or display name.
# --------------------------------------------------------------------------

MARKETING_SENDERS = (
    "allbirds", "hawkinsnewyork", "hawkins new york", "dailyjocks",
    "sessiongoods", "session goods", "almondcow", "almond cow", "artifox",
    "trysparrow", "sparrow", "twelvesouth", "twelve south",
    "innovatingwithai.com", "rob howard", "vice party", "dtla proud",
    "category party", "glassdoor", "lucid motors", "merchantmastery.io",
    "coffeedose.cafe", "coffee dose", "cornell lab", "justyn.ca",
    "substack.com", "johnreed", "john reed fitness", "going.com",
    "gomatch.tinder.com", "tinder", "joinsuperhuman.ai", "superhuman",
    "nomadgoods", "nomad goods", "craftd", "craftdlondon", "couchsurfing",
    "kajabimail", "kajabi", "cloud.google.com marketing", "ifttt.com",
    "sitdeck", "demandprogress", "demand progress", "notateslaapp",
    "not a tesla app", "insideapple", "apple news",
    # added 2026-10-14 from a real scan of the inbox
    "lucidmotors", "tailopez", "squaremktg", "backerclub", "orbitkey",
    "friendsnyc", "publicgoods", "paulnpresents", "samuelgegen",
    "digital.metamail.com",
)

# Phrases that mark a message as a promotional blast when the sender is unknown.
MARKETING_SUBJECT_HINTS = (
    "% off", "sale", "last chance", "ends tonight", "ends today", "flash sale",
    "black friday", "cyber monday", "new arrivals", "just dropped", "shop now",
    "we miss you", "come back", "don't miss", "limited time", "free shipping",
    "unsubscribe", "newsletter", "weekly digest", "this week in", "webinar",
    "register now", "rsvp", "early access", "exclusive offer", "save big",
    "deal", "promo", "coupon", "bogo", "clearance", "sign the petition",
    "petition", "jobs you may", "new jobs", "recommended for you",
)

# --------------------------------------------------------------------------
# Predicates
# --------------------------------------------------------------------------


import re  # noqa: E402

RELAY_DOMAINS = ("icloud.com", "privaterelay.appleid.com")

# Hide My Email rewrites the sender, e.g.
#   hello_at_craftdlondon_com_zkpff5e7vxn694_canc4288@icloud.com
#   hello_at_marketing_going_com_bbmjkr2b76_f5bacf91@privaterelay.appleid.com
# The real sender is recoverable: <local>_at_<domain with dots as underscores>
# followed by one or two random id chunks.
_RELAY_RE = re.compile(
    r"^(?P<local>.+?)_at_(?P<domain>[a-z0-9_+-]+?_(?:com|org|net|io|ai|co|us|app|dev|me|tv|shop))"
    r"(?:_[a-z0-9]{6,})+$"
)

_TLDS = ("com", "org", "net", "io", "ai", "co", "us", "app", "dev", "me", "tv", "shop")


def _norm(value):
    return (value or "").strip().lower()


_WORD_CACHE = {}


def _word_re(words):
    """Whole-word matcher. Without this, 'different' matches 'rent'."""
    cached = _WORD_CACHE.get(words)
    if cached is None:
        pattern = "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))
        cached = re.compile(r"(?<![a-z0-9])(?:%s)(?![a-z0-9])" % pattern)
        _WORD_CACHE[words] = cached
    return cached


def contains_word(haystack, words):
    return bool(_word_re(words).search(haystack))


def count_words(haystack, words):
    return len(set(_word_re(words).findall(haystack)))


def unmask_relay(address):
    """Return the real sender behind a Hide My Email relay address.

    Falls back to the address unchanged when it is not a relay address.
    """
    address = _norm(address)
    if "@" not in address:
        return address
    local, _, domain = address.partition("@")
    if domain not in RELAY_DOMAINS or "_at_" not in local:
        return address
    match = _RELAY_RE.match(local)
    if not match:
        return address
    parts = match.group("domain").split("_")
    if len(parts) < 2 or parts[-1] not in _TLDS:
        return address
    return "%s@%s" % (match.group("local"), ".".join(parts))


def is_relay_alias(address):
    """True when this sender arrives through a per-sender Hide My Email alias."""
    address = _norm(address)
    if "@" not in address:
        return False
    local, _, domain = address.partition("@")
    if domain not in RELAY_DOMAINS:
        return False
    if address in OWN_ADDRESSES:
        return False
    return "_at_" in local or (domain == "privaterelay.appleid.com")


def domain_of(address):
    address = _norm(address)
    return address.split("@")[-1] if "@" in address else ""


def is_job_alert(sender, display_name=""):
    real = unmask_relay(sender)
    haystack = " ".join((_norm(sender), real, _norm(display_name)))
    return any(token in haystack for token in JOB_ALERT_SENDERS)


def is_protected_sender(address, display_name="", extra_protected=()):
    """True when this sender must never be touched."""
    address = _norm(address)
    real = unmask_relay(address)
    if not address:
        return True  # unparseable sender -> leave it alone
    extra = {_norm(a) for a in extra_protected}
    for candidate in (address, real):
        if candidate in PROTECTED_ADDRESSES or candidate in OWN_ADDRESSES:
            return True
        if candidate in extra:
            return True
        domain = domain_of(candidate)
        if not domain:
            continue
        if domain in PROTECTED_DOMAINS or domain in extra:
            return True
        # a protected domain also covers its subdomains
        if any(domain.endswith("." + d) for d in PROTECTED_DOMAINS):
            return True
    return False


def is_protected_message(sender, display_name, subject, extra_protected=()):
    """Per-message protection: topic keywords beat an unknown sender."""
    if is_known_marketing(sender, display_name) or is_job_alert(sender, display_name):
        return False
    if is_protected_sender(sender, display_name, extra_protected):
        return True
    haystack = " ".join((_norm(display_name), _norm(sender),
                         unmask_relay(sender), _norm(subject)))
    if contains_word(haystack, MARKETING_OVERRIDE_KEYWORDS):
        return False
    return contains_word(haystack, PROTECTED_KEYWORDS)


def is_known_marketing(sender, display_name=""):
    real = unmask_relay(sender)
    if domain_of(real) in PROTECTED_DOMAINS:
        return False
    haystack = " ".join((_norm(sender), real, _norm(display_name)))
    return any(token in haystack for token in MARKETING_SENDERS)


def marketing_score(subjects, has_list_unsubscribe, message_count):
    """Heuristic score for an unknown sender. 0.0 - 1.0, higher = more likely junk.

    Deliberately conservative: a wrongly kept email costs nothing, a wrongly
    trashed one costs trust.
    """
    score = 0.0
    if has_list_unsubscribe:
        score += 0.45
    if message_count >= 5:
        score += 0.15
    if message_count >= 20:
        score += 0.10
    blob = " ".join(_norm(s) for s in subjects)
    score += min(count_words(blob, MARKETING_SUBJECT_HINTS), 4) * 0.10
    return min(score, 1.0)


# Senders at or above this score are trashed without asking the AI.
AUTO_KILL_SCORE = 0.80
# Below this, the sender is left alone and never sent to the AI.
IGNORE_BELOW_SCORE = 0.45
