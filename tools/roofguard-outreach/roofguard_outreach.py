"""RoofGuard Outreach on the Pi: weekdays 9:00 AM PT. DRAFT-ONLY: this job never sends an email, to anyone, ever.

Installed as /opt/bestly/cron/jobs/roofguard_outreach.py; run by /opt/bestly/cron/run.sh roofguard_outreach (heartbeat via runjob.py).
Replaces the Claude scheduled task "RoofGuard Daily Outreach" (trig_01VAw9GEZHXnWp2SSb6Rn9ZD, left disabled as the fallback).

Everything it produces is a row Jared reads on /admin/roofguard-outreach: a draft email (To, Cc, Bcc, subject, body), a reply that needs a human
look, or a call-sheet entry. He sends the ones he likes from his own mail and taps "I sent it"; only then does the ledger move the contact to
the next touch. The old Claude task sent through the Mac mini mail bridge; that path is deliberately not used here.

What it does each run, in this order (same order as the old prompt: replies first, they are "the whole job"):
  1. Read replies, bounces and opt-outs about people in the ledger (bestly_mail) and act: STOP / unsubscribe / not interested = permanent
     suppression; a bounce = never retry; any reply halts further touches; an interested reply drafts the warm intro to Eli Cooper (or the
     plain program summary when they ask "send me something") and is pushed to Jared, because a real person is waiting.
  2. Draft due follow-ups (Touch 2 at day 4, Touch 3 at day 9, then rest, Loop 2 at about day 75, Loop 3 at about day 150).
  3. Research new leads (web search + the company's own site; free AI reads the pages) and draft first touches up to the daily cap.
  4. Keep the call sheet current (phone numbers off their own sites; the six phone-only companies are on it and are never drafted).

Hard rules, kept from the old prompt and enforced in code here AND in database constraints:
  never the word "replacement" (always roof renewal); no existing partners named or implied (we have none); no invented deadline or expiring
  offer; no income promise; never call it insurance; never mention or attach the internal partner packet; compliance footer with the postal
  address and the STOP line on every email; BCC jared@bestly.tech on every email; never invent or pattern-guess an email, phone, name or fact
  (an address is used only if it appears on the company's own site); one ask per email; phone-only companies are never emailed.

Flags: --dry (do everything but write: nothing queued, no notification, no ledger change), --no-research (replies and follow-ups only).
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

import lib  # noqa: E402  (/opt/bestly/cron/lib.py)

try:
    import freellm  # noqa: E402
except Exception:  # noqa: BLE001
    freellm = None

JOB = "roofguard_outreach"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
ELI = "eli.cooper@bdcuniversal.com"
BCC = "jared@bestly.tech"
ADMIN_URL = "/admin/roofguard-outreach"

# ---------------------------------------------------------------------------------------------- the words (from the old prompt, verbatim)
FOOTER = ("—\nThis is a business partnership solicitation.\nBestly · 733 N Kings Rd #205, Los Angeles, CA 90069\n"
          "Don't want these? Reply \"STOP\" and I'll remove you immediately.")
SIGN = "Jared Best\nBestly"

SUBJECT = {
    ("first", "A"): "worth knowing about your clients' roofs",
    ("first", "B"): "recurring revenue on buildings you already bid",
    ("loop", "A"): "a second look at your clients' roofs",
    ("loop", "B"): "recurring revenue on buildings you're already quoting",
}

TRACK_A = """{greet}

{hook}

I'm reaching out to building-services companies specifically, because you're the ones already inside these buildings every month.

Here's something most building owners don't know: almost every commercial roof in the country is out of warranty. The fine print requires ongoing maintenance nobody actually performs, so coverage lapsed years ago and they have no idea. Most warranties also cut off around 55-70 mph winds, which an ordinary bad storm clears.

There's a program that covers all of it — inspections, 24/7 repairs, and full roof renewal — as a flat monthly cost instead of a capital project. You'd introduce a client who owns their building, and it pays you 2% residual every month that contract stays on the books.

They're only bringing on a limited number of partners per region, so I wanted you to at least know it exists.

Want me to have Eli, who runs it, give you a call?

If it's not a fit, no hard feelings at all.

{sign}

{footer}"""

TRACK_B = """{greet}

{hook}

Straight to it. You bid a roof, you win it, you do the work, and the revenue stops the day the job ends. Then you go find the next one.

There's a service-maintenance program that flips that on buildings you're already quoting — $0.20/sq ft per month, typically a 10-year agreement covering inspections, 24/7 response, repairs and roof renewal. The owner gets an operating expense instead of a capital project, and the partner who brings the account earns 2% residual every month it stays on the books.

They're only taking a limited number of partners per region.

Want me to connect you with Eli, who runs it?

If it's not for you, no hard feelings.

{sign}

{footer}"""

TOUCH2 = """{greet}

Following up with the part that usually lands.

Over any ten-year stretch your client will have to renew part or all of that roof — a capital project nobody wants to budget for, and one that needs an approval they'd rather not go ask for. This turns it into a monthly operating cost, keeps the roof continuously renewed, and covers catastrophic loss without an insurance claim.

You're not selling roofing. You're telling a client you already take care of that this exists.

Happy to introduce you to Eli if it's worth a look. If not, no problem at all.

{sign}

{footer}"""

TOUCH3 = """{greet}

Last note from me — I don't want to clutter your inbox.

If a recurring revenue line on accounts you already have is worth ten minutes, say the word and I'll connect you with Eli. If not, I'll leave it here and wish you well.

{sign}

{footer}"""

# Loop 2 / Loop 3 first touches. The old prompt gave only the opening line for Loop 2 ("Circling back — I wrote you a couple months ago about
# your clients' roofs.") and "final pass" for Loop 3; the rest of these two bodies is new wording that stays inside the same rules.
LOOP2 = """{greet}

Circling back — I wrote you a couple months ago about your clients' roofs.

One thing I didn't spell out: this turns a roof your clients will have to renew anyway into a flat monthly operating cost, and you earn 2% residual for as long as that contract stays on the books.

Still happy to have Eli, who runs it, give you a call. If the timing is wrong, no hard feelings at all.

{sign}

{footer}"""

LOOP3 = """{greet}

Final pass from me — I wrote you a while back about your clients' roofs.

If a recurring revenue line on accounts you already have is worth ten minutes, I'll connect you with Eli. If not, I'll leave it here and wish you well.

{sign}

{footer}"""

INTRO = """Hi {first} — great hearing back from you.

Connecting you with Eli Cooper, who runs the RoofGuard program. Eli can walk you through how the partnership works and answer anything specific to your accounts.

Eli — {who} in {city}, {state}. {fit} They're interested in hearing more.

I'll let you two take it from here.

Jared

{footer}"""

SUMMARY = """Hi {first} — thanks for writing back.

Here's the short version of RoofGuard. Almost every commercial roof is out of warranty because the fine print requires ongoing maintenance that nobody performs, and most warranties stop covering wind above roughly 55-70 mph. The program covers inspections, 24/7 repairs, and full roof renewal as a flat monthly cost — $0.20/sq ft per month, usually a 10-year agreement that can be cancelled at any time — instead of a capital project. It works alongside property insurance; it is not insurance.

The partner who introduces a building owner earns 2% residual every month that contract stays on the books.

The next step is a short call with Eli Cooper, who runs the program. Want me to introduce you?

{sign}

{footer}"""

# ---------------------------------------------------------------------------------------------- the rules, as code
_BAD = [
    (r"replacement", "uses the word replacement (always roof renewal)"),
    (r"(existing|current|our|other)\s+partners", "names or implies existing partners"),
    (r"(have|has)\s+(already\s+)?(signed|joined|partnered)|already\s+(signed|joined|partnered)", "claims others have signed"),
    (r"\b(deadline|expires?|expiring|act now|last chance|limited time|offer ends)\b", "invents a deadline or expiring offer"),
    (r"\b(you could|you can|you'?ll)\s+(earn|make)\b|guarantee|projected|projection|earnings", "makes an income promise"),
    (r"\b(is|as|like|a form of|called|essentially)\s+(an\s+)?insurance\b(?!\s+claim)|\bit'?s\s+insurance\b", "describes RoofGuard as insurance"),
    (r"partner\s+packet|\.pdf\b|attach(ed|ment)", "mentions or attaches the internal partner packet"),
    (r"lbmc'?s\s+(cut|split|share)|jared'?s\s+(cut|split|residual)", "discloses internal splits"),
]


def violations(subject, body):
    """List of broken hard rules in an outgoing email (empty = clean)."""
    out = []
    text = (subject or "") + "\n" + (body or "")
    for pat, why in _BAD:
        if re.search(pat, text, re.I):
            out.append(why)
    if "733 N Kings Rd #205, Los Angeles, CA 90069" not in (body or "") or 'Reply "STOP"' not in (body or ""):
        out.append("missing the compliance footer")
    return out


def greeting(contact_name):
    first = first_name(contact_name)
    return ("Hi %s," % first) if first else "Hello,"


_TITLES = {"mr", "mrs", "ms", "dr", "sr", "jr"}


def first_name(full):
    for tok in re.split(r"\s+", (full or "").strip()):
        t = tok.strip(".,")
        if t.lower() in _TITLES:
            continue
        if re.fullmatch(r"[A-Za-z][A-Za-z'\-]{1,19}", t):
            return t[0].upper() + t[1:]
        return ""
    return ""


def render(template, **kw):
    kw.setdefault("sign", SIGN)
    kw.setdefault("footer", FOOTER)
    return template.format(**kw)


def first_touch(track, contact_name, hook, loop=1):
    if loop == 1:
        subject = SUBJECT[("first", track)]
        body = render(TRACK_A if track == "A" else TRACK_B, greet=greeting(contact_name), hook=hook)
    else:
        subject = SUBJECT[("loop", track)]
        body = render(LOOP2 if loop == 2 else LOOP3, greet=greeting(contact_name))
    return subject, body


def follow_up(kind, thread_subject, contact_name):
    base = re.sub(r"^(re:\s*)+", "", thread_subject or "your clients' roofs", flags=re.I)
    tpl = TOUCH2 if kind == "touch2" else TOUCH3
    return "re: " + base, render(tpl, greet=greeting(contact_name))


def intro_email(row, to_first, who_runs):
    who = ("%s runs %s" % (to_first, row["company"])) if (to_first and who_runs) else (("%s is at %s" % (to_first, row["company"])) if to_first else "The team at %s wrote back" % row["company"])
    fit = (row.get("fit_note") or "They run a commercial building-services business.").strip()
    if not fit.endswith((".", "!", "?")):
        fit += "."
    body = render(INTRO, first=to_first or "there", who=who, city=row.get("city") or "their city", state=row.get("state") or "", fit=fit)
    return "Intro: %s <> Eli Cooper (RoofGuard)" % row["company"], body.replace(" in their city, ", " ").replace(" in , ", " ")


def summary_email(row, to_first, thread_subject):
    base = re.sub(r"^(re:\s*)+", "", thread_subject or "your clients' roofs", flags=re.I)
    return "re: " + base, render(SUMMARY, first=to_first or "there")


# ---------------------------------------------------------------------------------------------- reading replies
_QUOTE_START = re.compile(r"(?im)^(\s*>.*|on .{4,200}wrote:\s*|-{2,}\s*original message.*|from:\s.+|sent from my .+|\s*—\s*$)")
OPTOUT = re.compile(r"\b(stop|unsubscribe|remove (me|us|this|my)|take (me|us) off|do not (contact|email|call)|don'?t (contact|email|call)|"
                    r"not interested|no thanks|no thank you|please remove|opt[\s-]?out|cease|spam)\b", re.I)
AUTOREPLY = re.compile(r"(out of (the )?office|automatic reply|auto[\s-]?reply|autoreply|on vacation|away from (my )?(desk|email)|will respond when i return)", re.I)
POSITIVE = re.compile(r"\b(interested|sounds (good|great|interesting)|tell me more|more (info|information|details)|send (me|over)|call me|give me a call|"
                      r"let'?s (talk|chat|connect)|connect (me|us)|please do|yes|sure|go ahead|happy to|love to|worth a (look|call))\b", re.I)
SEND_ME = re.compile(r"(send (me|over)|email me (the|some|more)|more (info|information|details)|any (info|information|details)|something in writing|one[\s-]?pager)", re.I)


def own_words(text):
    """Only what the person newly wrote: quoted history and our own footer are cut off (the footer itself contains the word STOP)."""
    keep = []
    for line in (text or "").splitlines():
        if _QUOTE_START.match(line):
            break
        keep.append(line)
    t = "\n".join(keep)
    t = t.split("This is a business partnership solicitation")[0]
    return t.strip()


def scrub(text, n=300):
    """A reply snippet safe to store: no addresses, no phone numbers."""
    t = re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", "[address]", text or "")
    t = re.sub(r"\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b", "[number]", t)
    return re.sub(r"\s+", " ", t).strip()[:n]


def classify(hint, subject, text, from_addr=""):
    """-> (kind, send_me). kind: bounce | opt_out | auto | interested | not_interested | review."""
    if hint == "bounce":
        return "bounce", False
    mine = own_words(text)
    if AUTOREPLY.search((subject or "") + " " + mine[:300]):
        return "auto", False
    if OPTOUT.search(mine[:800]):
        return "opt_out", False
    if POSITIVE.search(mine[:800]):
        return "interested", bool(SEND_ME.search(mine[:800]))
    ai = ai_json("Classify this reply to a cold partnership email. Answer JSON {\"intent\": one of interested, question, not_interested, auto_reply, other}. "
                 "interested = wants to hear more or asks for information; question = asks something about the program; not_interested = declines.",
                 mine[:900])
    intent = str((ai or {}).get("intent", "")).lower()
    if intent in ("interested", "question"):
        return "interested", bool(SEND_ME.search(mine[:800]))
    if intent == "not_interested":
        return "opt_out", False
    if intent == "auto_reply":
        return "auto", False
    return "review", False


# ---------------------------------------------------------------------------------------------- free AI
def ai_json(system, user, max_tokens=500, deadline=None):
    if freellm is None:
        return None
    try:
        msg, _label = freellm.chat([{"role": "system", "content": system + " Answer with one JSON object and nothing else."},
                                    {"role": "user", "content": user}], max_tokens=max_tokens, deadline=deadline, json_mode=True)
        raw = (msg.get("content") or "").strip()
        m = re.search(r"\{.*\}", raw, re.S)
        return json.loads(m.group(0)) if m else None
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------------------------- web (polite, one request at a time)
_last = {}


def fetch(url, timeout=25, gap=2.0, max_bytes=400000):
    host = urllib.parse.urlparse(url).netloc
    wait = gap - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        ctype = r.headers.get("Content-Type", "")
        if "html" not in ctype and "text" not in ctype:
            raise ValueError("not a web page")
        return r.read(max_bytes).decode("utf-8", "replace")


def plain(h):
    h = re.sub(r"(?is)<(script|style|noscript|svg).*?</\1>", " ", h or "")
    h = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h\d|tr)>", "\n", h)
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\n\s*\n+", "\n", html.unescape(re.sub(r"<[^>]+>", " ", h)))).strip()


def ddg(query):
    """DuckDuckGo's plain-HTML results -> [url]."""
    h = fetch("https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query}), gap=3.0)
    out = []
    for m in re.finditer(r'class="result__a"[^>]*href="([^"]+)"', h):
        u = html.unescape(m.group(1))
        if "uddg=" in u:
            u = urllib.parse.unquote(u.split("uddg=")[1].split("&")[0])
        if u.startswith("//"):
            u = "https:" + u
        if u.startswith("http"):
            out.append(u)
    return out


DIRECTORIES = ("yelp.", "facebook.", "linkedin.", "bbb.org", "yellowpages.", "mapquest.", "angi.", "angieslist.", "thumbtack.", "indeed.", "glassdoor.",
               "zoominfo.", "dnb.com", "manta.", "chamberofcommerce.", "buildzoom.", "houzz.", "homeadvisor.", "google.", "wikipedia.", "youtube.",
               "instagram.", "twitter.", "x.com", "cylex", "superpages.", "bizapedia.", "opencorporates.", "roofing.", "porch.", "nextdoor.", "reddit.",
               "pinterest.", "tiktok.", "ziprecruiter.", "simplyhired.", "craigslist.", "amazon.", "gov", ".edu", "bing.", "duckduckgo.", "apple.")
NATIONALS = ("abm", "aramark", "sodexo", "sbm", "4m building", "gdi", "cintas", "tecta", "centimark", "jani-king", "janiking", "city wide", "citywide",
             "office pride", "officepride", "coverall", "anago", "vanguard cleaning", "servicemaster", "servpro", "stanley steemer", "chem-dry", "merry maids",
             "molly maid", "jan-pro", "janpro", "beacon", "abc supply", "srs ", "gaf", "carlisle", "firestone", "sherwin", "home depot", "lowe", "bluelinx",
             "american building", "isolatek", "mccarthy", "jll", "cbre", "cushman", "colliers", "emcor", "comfort systems", "trane", "carrier", "johnson controls",
             "siemens", "honeywell", "bfs ", "ferguson", "united site", "unifirst")

CORE_STATES = {"MO", "KS", "IL", "AR", "OK", "IA", "TN"}
EXPAND_STATES = {"TX", "IN", "OH", "KY", "NE", "CO", "GA", "NC", "SC"}
METROS_CORE = ["Springfield, MO", "Kansas City, MO", "St. Louis, MO", "Columbia, MO", "Joplin, MO", "Wichita, KS", "Topeka, KS", "Overland Park, KS",
               "Little Rock, AR", "Fayetteville, AR", "Fort Smith, AR", "Tulsa, OK", "Oklahoma City, OK", "Des Moines, IA", "Cedar Rapids, IA",
               "Davenport, IA", "Memphis, TN", "Nashville, TN", "Knoxville, TN", "Chattanooga, TN", "Peoria, IL", "Springfield, IL", "Champaign, IL", "Rockford, IL"]
METROS_EXPAND = ["Dallas, TX", "Houston, TX", "Indianapolis, IN", "Columbus, OH", "Louisville, KY", "Omaha, NE", "Denver, CO", "Atlanta, GA", "Charlotte, NC", "Greenville, SC"]
QUERIES_A = ["commercial janitorial company {m}", "commercial facility maintenance services {m}", "commercial building maintenance HVAC service {m}",
             "commercial grounds and property services {m}"]
QUERIES_B = ["commercial roofing contractor {m}", "commercial roof coatings restoration {m}"]
TZ = {"MO": "Central", "KS": "Central", "IL": "Central", "AR": "Central", "OK": "Central", "IA": "Central", "TN": "Central", "TX": "Central", "NE": "Central",
      "IN": "Eastern", "OH": "Eastern", "KY": "Eastern", "GA": "Eastern", "NC": "Eastern", "SC": "Eastern", "CO": "Mountain"}


def metros_for(today, n=3):
    d = today.toordinal()
    out = [METROS_CORE[(d * n + i) % len(METROS_CORE)] for i in range(n)]
    if d % 4 == 0:  # core states thin out over time: every fourth day one metro comes from the wider list
        out[-1] = METROS_EXPAND[(d // 4) % len(METROS_EXPAND)]
    return out


def host_of(url):
    h = urllib.parse.urlparse(url).netloc.lower().split(":")[0]
    return h[4:] if h.startswith("www.") else h


def skippable_url(url):
    h = host_of(url)
    return (not h) or any(d in h for d in DIRECTORIES) or any(n in h.replace("-", "").replace(".", " ") for n in ("abm", "aramark", "sodexo", "cintas")) \
        or any(n.strip() in h for n in ("tecta", "centimark", "jani-king", "servpro", "servicemaster", "homedepot", "lowes"))


def is_national(text):
    t = (text or "").lower()
    return any(re.search(r"(?<![a-z])" + re.escape(n.strip()) + r"(?![a-z])", t) for n in NATIONALS if len(n.strip()) >= 3)


_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
_JUNK_LOCAL = ("noreply", "no-reply", "donotreply", "do-not-reply", "privacy", "abuse", "webmaster", "postmaster", "sentry", "example", "yourname", "name", "user", "email")
_PHONE = re.compile(r"(?<!\d)\(?([2-9]\d{2})\)?[\s.\-]+(\d{3})[\s.\-]+(\d{4})(?!\d)")


def emails_on_page(raw, domain):
    """Addresses that literally appear on the company's own page and belong to its own domain. Never guessed."""
    found = []
    for e in _EMAIL.findall(html.unescape(raw or "")):
        e = e.lower().rstrip(".")
        local, _, dom = e.partition("@")
        if dom != domain and not dom.endswith("." + domain):
            continue
        if any(local.startswith(j) for j in _JUNK_LOCAL) or e.endswith((".png", ".jpg", ".gif", ".webp")):
            continue
        if e not in found:
            found.append(e)
    return found


def phones_on_page(raw):
    found = []
    for m in _PHONE.finditer(html.unescape(raw or "")):
        p = "(%s) %s-%s" % m.groups()
        if p not in found:
            found.append(p)
    return found


def pick_email(emails, contact_name):
    first = (first_name(contact_name) or "").lower()
    for e in emails:
        if first and e.split("@")[0].startswith(first[0]) and first in e.split("@")[0]:
            return e
    personal = [e for e in emails if not re.match(r"(info|contact|sales|office|hello|admin|support|service|services|team|mail|help|customerservice|estimates?|bids?)@", e)]
    return (personal or emails or [None])[0]


_HOOK_FILLER = {"noticed", "website", "company", "across", "about", "their", "which", "there", "while", "other", "these", "those", "where", "being"}


def hook_ok(hook, quote, page_text):
    """The first-line hook must be a short plain sentence whose proper nouns and numbers all appear on their page, anchored by a verbatim quote."""
    if not hook or not quote or len(hook) > 220 or len(quote) < 12 or quote not in page_text:
        return False
    if violations("", hook + "\n" + FOOTER):
        return False
    for tok in re.findall(r"\b[A-Z][a-zA-Z&']{2,}\b|\b\d[\d,.\-]*\b", hook)[1:]:
        if tok.lower() in ("i", "saw", "noticed", "your", "you", "the", "and") or tok in ("I",):
            continue
        if tok not in page_text and tok.lower() not in page_text.lower():
            return False
    low = page_text.lower()
    for w in re.findall(r"[a-z]{5,}", hook.lower()):  # every substantive word must come from their page (first five letters: tolerates plurals)
        if w not in _HOOK_FILLER and w[:5] not in low:
            return False
    return True


def evaluate_site(domain, home_raw, extra_pages, deadline=None):
    """-> lead dict or None. Needs the free AI; every fact it returns is re-checked against the page text."""
    text = plain(home_raw) + "\n" + "\n".join(plain(p) for p in extra_pages)
    text = text[:7000]
    if is_national(text[:1500]):
        return None
    ai = ai_json(
        "You read the website text of one US company and extract facts. Use only the text. Never guess. JSON keys: company (string), city, state (2 letters), "
        "track (\"A\" if it is a commercial janitorial, facility maintenance, building engineering, commercial HVAC or grounds company; \"B\" if it is a commercial "
        "roofing, coatings or restoration contractor; else \"none\"), commercial_only (true if it serves commercial or industrial buildings and not homes), "
        "independent (true if it looks locally owned and is not a national chain or franchise), contact_name (an owner, president or manager named in the text, "
        "else empty), contact_title, name_quote (exact words from the text that show that name and title, else empty), services (at most 8 words), "
        "hook (one sentence of at most 22 words starting with \"I saw\" or \"I noticed\" about something specific on their site), hook_quote (exact words "
        "from the text that the hook is based on).", text, max_tokens=700, deadline=deadline)
    if not ai or ai.get("track") not in ("A", "B") or not ai.get("commercial_only") or not ai.get("independent"):
        return None
    st = str(ai.get("state", "")).upper()[:2]
    if st not in CORE_STATES | EXPAND_STATES:
        return None
    flat = re.sub(r"\s+", " ", text)
    name, title, nq = str(ai.get("contact_name") or "").strip(), str(ai.get("contact_title") or "").strip(), re.sub(r"\s+", " ", str(ai.get("name_quote") or ""))
    if not (name and nq and nq in flat and name.split()[0] in nq):
        name = title = ""  # an unverified name is dropped: the greeting becomes "Hello,"
    hook, hq = str(ai.get("hook") or "").strip(), re.sub(r"\s+", " ", str(ai.get("hook_quote") or "")).strip()
    if not hook_ok(hook, hq, flat):
        hook = ('On your site you say: "%s"' % hq[:160]) if (hq and hq in flat and len(hq) >= 12) else ""
        if hook and violations("", hook + "\n" + FOOTER):
            hook = ""
    if not hook:
        return None
    raw_all = home_raw + "\n" + "\n".join(extra_pages)
    emails = emails_on_page(raw_all, domain)
    phones = phones_on_page(raw_all)
    return {"company": str(ai.get("company") or "").strip()[:120], "domain": domain, "city": str(ai.get("city") or "").strip()[:60], "state": st,
            "track": ai["track"], "services": str(ai.get("services") or "")[:80], "contact_name": name[:80], "contact_title": title[:80], "hook": hook,
            "hook_quote": hq[:300], "emails": emails, "email": pick_email(emails, name), "phone": phones[0] if phones else None, "tz": TZ.get(st, "")}


def call_score(lead):
    s = 0
    if lead.get("contact_name") and re.search(r"owner|president|ceo|founder|principal|general manager", lead.get("contact_title", ""), re.I):
        s += 3
    if re.search(r"warehouse|manufactur|retail|school|industrial|distribution", (lead.get("services", "") + " " + lead.get("hook", "")), re.I):
        s += 2
    if re.search(r"clients?|customers?|portfolio|roster", lead.get("hook_quote", ""), re.I):
        s += 1
    return s


def find_leads(today, want, known_domains, known_names, mail_seen, deadline, log):
    """-> (leads, stats). Stops as soon as `want` emailable leads are found (plus a few phone-only ones)."""
    stats = {"searches": 0, "search_fail": 0, "pages": 0, "checked": 0, "skipped_known": 0, "no_fit": 0, "no_email": 0}
    leads, phone_only, seen_dom = [], [], set()
    for metro in metros_for(today):
        for track, queries in (("A", QUERIES_A[(today.toordinal()) % len(QUERIES_A):][:2] or QUERIES_A[:2]), ("B", QUERIES_B[:1])):
            for q in queries:
                if len(leads) >= want or time.time() > deadline:
                    break
                stats["searches"] += 1
                try:
                    urls = ddg(q.format(m=metro))
                except Exception:  # noqa: BLE001
                    stats["search_fail"] += 1
                    continue
                for u in urls[:8]:
                    dom = host_of(u)
                    if skippable_url(u) or dom in seen_dom:
                        continue
                    seen_dom.add(dom)
                    if len(leads) >= want or time.time() > deadline or stats["checked"] >= 30:
                        break
                    if dom in known_domains:
                        stats["skipped_known"] += 1
                        continue
                    try:
                        home = fetch("https://%s/" % dom)
                        stats["pages"] += 1
                    except Exception:  # noqa: BLE001
                        continue
                    stats["checked"] += 1
                    extra = []
                    for link in re.findall(r'href="([^"#?]*(?:contact|about)[^"#?]*)"', home, re.I)[:2]:
                        try:
                            extra.append(fetch(urllib.parse.urljoin("https://%s/" % dom, link)))
                            stats["pages"] += 1
                        except Exception:  # noqa: BLE001
                            pass
                    lead = evaluate_site(dom, home, extra, deadline)
                    if not lead:
                        stats["no_fit"] += 1
                        continue
                    key = re.sub(r"[^a-z0-9]", "", lead["company"].lower())
                    if not key or key in known_names or dom in known_domains:
                        stats["skipped_known"] += 1
                        continue
                    # earlier contact whose ledger record was lost: any mail to or from this domain at all means "do not start a new loop"
                    if mail_seen(dom):
                        stats["skipped_known"] += 1
                        log("skip %s: mail history exists" % dom)
                        continue
                    lead["website"] = "https://%s/" % dom
                    lead["call_score"] = call_score(lead)
                    if lead["email"]:
                        leads.append(lead)
                    elif lead["phone"] and len(phone_only) < 5:
                        stats["no_email"] += 1
                        phone_only.append(lead)
    return leads, phone_only, stats


# ---------------------------------------------------------------------------------------------- queue (never sends)
def queue(dry, ledger_id, kind, to_email, subject, body, cc=None, hook_quote=None, hook_url=None):
    bad = violations(subject, body)
    if bad:
        raise ValueError("draft refused: " + "; ".join(bad))
    if dry:
        return "dry"
    return lib.rpc("rg_outreach_draft_add", p={"ledger_id": ledger_id, "kind": kind, "to_email": to_email, "cc": cc, "subject": subject, "body": body,
                                              "hook_quote": hook_quote, "hook_url": hook_url})


def today_pt():
    # the Pi's clock is America/Los_Angeles; the database says the same day in its state()
    return date.today()


def main(argv):
    dry = "--dry" in argv
    state = lib.rpc("rg_outreach_state") or {}
    cfg = state.get("settings") or {"enabled": True, "daily_first_touch_cap": 10, "pending_cap": 40}
    if not cfg.get("enabled", True):
        return "skip: RoofGuard Outreach drafting is switched off"
    try:
        today = date.fromisoformat(state.get("today") or "") if state.get("today") else today_pt()
    except ValueError:
        today = today_pt()
    ledger = state.get("ledger") or []
    by_id = {r["id"]: r for r in ledger}
    pending_ids = set(state.get("pending_ledger_ids") or [])
    deadline = time.time() + 1500
    notes, errors = [], []
    counts = {"replies": 0, "interested": 0, "optouts": 0, "bounces": 0, "review": 0, "followups": 0, "firsts": 0, "refused": 0, "phone_added": 0}

    def log(msg):
        print("  " + msg, flush=True)

    # ---- 1. replies, bounces, opt-outs
    try:
        mails = lib.rpc("rg_outreach_mail_scan", p_days=30) or []
    except Exception as e:  # noqa: BLE001
        mails, _ = [], errors.append("mail scan: %s" % type(e).__name__)
    for m in mails:
        row = by_id.get(m.get("ledger_id"))
        if not row or row["status"] in ("opted_out", "bounced", "phone_only"):
            continue
        if not dry and not lib.rpc("rg_outreach_event_add", p_mail_id=str(m["mail_id"]), p_ledger_id=row["id"], p_kind=m.get("hint") or "reply"):
            continue  # already handled on an earlier run
        kind, send_me = classify(m.get("hint"), m.get("subject"), m.get("text"), m.get("from_addr"))
        company = row["company"]
        try:
            if kind == "auto":
                continue
            if kind == "bounce":
                counts["bounces"] += 1
                if not dry:
                    lib.rpc("rg_outreach_ledger_status", p_id=row["id"], p_status="bounced", p_note="Hard bounce")
            elif kind == "opt_out":
                counts["optouts"] += 1
                if not dry:
                    lib.rpc("rg_outreach_ledger_status", p_id=row["id"], p_status="opted_out", p_note=scrub(own_words(m.get("text")), 120))
            elif kind == "review":
                counts["review"] += 1
                counts["replies"] += 1
                if not dry:
                    lib.rpc("rg_outreach_ledger_status", p_id=row["id"], p_status="needs_review", p_note=scrub(own_words(m.get("text"))))
            else:  # interested
                counts["replies"] += 1
                counts["interested"] += 1
                if not dry:
                    lib.rpc("rg_outreach_ledger_status", p_id=row["id"], p_status="interested", p_note=scrub(own_words(m.get("text"))))
                from_addr = (m.get("from_addr") or "").lower()
                to = from_addr if host_of("http://" + from_addr.split("@")[-1]) == row["domain"] else (row.get("email") or from_addr)
                first = first_name(row.get("contact_name")) or ""
                ok = False
                try:
                    if send_me:
                        subject, body = summary_email(row, first, row.get("thread_subject"))
                        queue(dry, row["id"], "summary_reply", to, subject, body)
                    else:
                        subject, body = intro_email(row, first, bool(re.search(r"owner|president|ceo|founder|principal|general manager", row.get("contact_title") or "", re.I)))
                        queue(dry, row["id"], "intro", to, subject, body, cc=ELI)
                    ok = True
                except Exception as e:  # noqa: BLE001
                    errors.append("draft for a reply: %s" % str(e)[:80])
                if not dry:
                    lib.notify("RoofGuard Outreach: %s wrote back, interested" % company,
                               ("Draft %s is queued at %s. Nothing has been sent." % ("reply with the program summary" if send_me else "intro to Eli Cooper", ADMIN_URL)) if ok
                               else "Their reply is in your inbox, but the draft could not be made. Open %s." % ADMIN_URL,
                               severity="warning", push=True, url=ADMIN_URL, dedupe="rgreply.%s" % str(m["mail_id"])[:60])
        except Exception as e:  # noqa: BLE001
            errors.append("reply from %s: %s" % (company, str(e)[:80]))

    # ---- 2. follow-ups that are due (uncapped; each one waits for Jared like everything else)
    state2 = lib.rpc("rg_outreach_state") if not dry else state
    ledger = (state2 or state).get("ledger") or ledger
    pending_ids = set((state2 or state).get("pending_ledger_ids") or [])
    for row in ledger:
        if counts["followups"] >= 40 or row["id"] in pending_ids or not row.get("email") or not row.get("next_due"):
            continue
        try:
            due = date.fromisoformat(row["next_due"]) <= today
        except ValueError:
            continue
        if not due:
            continue
        try:
            if row["status"] == "active" and row["touches"] in (1, 2):
                kind = "touch2" if row["touches"] == 1 else "touch3"
                subject, body = follow_up(kind, row.get("thread_subject"), row.get("contact_name"))
            elif row["status"] == "resting" and row["loop_no"] in (1, 2):
                kind = "loop2" if row["loop_no"] == 1 else "loop3"
                subject, body = first_touch(row.get("track") or "A", row.get("contact_name"), "", loop=2 if kind == "loop2" else 3)
            else:
                continue
            queue(dry, row["id"], kind, row["email"], subject, body)
            pending_ids.add(row["id"])
            counts["followups"] += 1
        except Exception as e:  # noqa: BLE001
            counts["refused"] += 1
            errors.append("follow-up for %s: %s" % (row["company"], str(e)[:80]))

    # ---- 3. new leads -> first touches (capped), phone-only leads -> call sheet
    pending_now = len(pending_ids)
    want = min(int(cfg.get("daily_first_touch_cap", 10)) - int(state.get("first_today", 0)), int(cfg.get("pending_cap", 40)) - pending_now)
    research = "off (--no-research)" if "--no-research" in argv else None
    if research is None and want <= 0:
        research = "skipped: %s" % ("today's cap is used" if int(cfg.get("daily_first_touch_cap", 10)) - int(state.get("first_today", 0)) <= 0 else "%d drafts are already waiting for Jared" % pending_now)
    if research is None and freellm is None:
        research = "skipped: free AI not available"
    stats = {}
    if research is None:
        known_domains = {r["domain"] for r in ledger}
        known_names = {r["name_key"] for r in ledger}

        def mail_seen(domain):
            try:
                return bool(lib.rpc("rg_outreach_mail_seen", p_domain=domain))
            except Exception:  # noqa: BLE001
                return True  # cannot check: do not risk a repeat contact

        try:
            leads, phones, stats = find_leads(today, want, known_domains, known_names, mail_seen, deadline, log)
        except Exception as e:  # noqa: BLE001
            leads, phones, stats = [], [], {}
            errors.append("research: %s" % str(e)[:80])
        for lead in leads:
            try:
                subject, body = first_touch(lead["track"], lead["contact_name"], lead["hook"])
                if dry:
                    queue(True, None, "first", lead["email"], subject, body)
                    counts["firsts"] += 1
                    continue
                lid = lib.rpc("rg_outreach_ledger_upsert", p={k: lead.get(k) for k in (
                    "company", "domain", "website", "email", "phone", "contact_name", "contact_title", "city", "state", "tz", "track", "services",
                    "hook_quote", "call_score")} | {"fit_note": ("%s in %s, %s." % (lead["services"].capitalize(), lead["city"], lead["state"])) if lead["services"] else None,
                                                      "hook_url": lead["website"], "source": "research"})
                queue(False, lid, "first", lead["email"], subject, body, hook_quote=lead["hook_quote"], hook_url=lead["website"])
                counts["firsts"] += 1
            except Exception as e:  # noqa: BLE001
                counts["refused"] += 1
                errors.append("lead %s: %s" % (lead.get("domain"), str(e)[:80]))
        for lead in phones:
            if dry:
                continue
            try:
                lib.rpc("rg_outreach_ledger_upsert", p={k: lead.get(k) for k in (
                    "company", "domain", "website", "phone", "contact_name", "contact_title", "city", "state", "tz", "track", "services", "hook_quote",
                    "call_score")} | {"email": None, "note": "Phone only: no verified address on their site. Call sheet, never email.", "source": "research"})
                counts["phone_added"] += 1
            except Exception as e:  # noqa: BLE001
                errors.append("phone lead %s: %s" % (lead.get("domain"), str(e)[:80]))

    # ---- 4. report
    if (counts["firsts"] or counts["followups"]) and not dry:
        lib.notify("RoofGuard Outreach: %d draft%s queued" % (counts["firsts"] + counts["followups"], "" if counts["firsts"] + counts["followups"] == 1 else "s"),
                   "%d first touch%s and %d follow-up%s for review at %s. Nothing was sent." % (
                       counts["firsts"], "" if counts["firsts"] == 1 else "es", counts["followups"], "" if counts["followups"] == 1 else "s", ADMIN_URL),
                   severity="success", push=False, url=ADMIN_URL, dedupe="rgdrafts.%s" % today.isoformat())
    if (counts["optouts"] or counts["bounces"]) and not dry:
        lib.notify("RoofGuard Outreach: %d opt-out%s, %d bounce%s recorded" % (counts["optouts"], "" if counts["optouts"] == 1 else "s", counts["bounces"], "" if counts["bounces"] == 1 else "s"),
                   "Those companies are suppressed for good. Deliverability watch: two or more opt-outs in one run, or bounces over 5 percent, means pause outreach.",
                   severity="info", push=False, url=ADMIN_URL, dedupe="rgsupp.%s" % today.isoformat())
    summary = ("%s: nothing sent (draft-only) | drafts queued: first touches %d, follow-ups %d | replies read %d (interested %d, need a look %d, opt-outs %d, bounces %d) | "
               "phone-only added %d | research %s%s | ledger %d companies%s") % (
        "dry" if dry else ("partial" if errors else "ok"), counts["firsts"], counts["followups"], counts["replies"] + counts["optouts"] + counts["bounces"],
        counts["interested"], counts["review"], counts["optouts"], counts["bounces"], counts["phone_added"],
        research or ("searched %(searches)d, sites %(checked)d, no fit %(no_fit)d, already known %(skipped_known)d" % stats if stats else "ran"),
        (" (search failed %d)" % stats["search_fail"]) if stats.get("search_fail") else "", len(ledger),
        (" | trouble: " + "; ".join(errors[:4])) if errors else "")
    return summary


if __name__ == "__main__":
    print(main(sys.argv[1:]))
