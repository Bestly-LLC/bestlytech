"""Trustpilot "new review" email parser (Maya's Review Reader). Pure functions, stdlib only, no network.

Input is what bestly_mail already holds for a message (subject, from address, plain-text body).
Output is one review (stars 1-5, title, snippet, reviewer first name) or an explicit "not a review" / "can't read it".
Built to tolerate format drift: several star formats, labelled or unlabelled title/text, name in subject or body.
Never guesses a star rating: no rating found means Unparseable, which the job reports instead of publishing.
"""
import re

SENDER_RE = re.compile(r"@([a-z0-9\-]+\.)*trustpilot\.com$", re.I)

# Mail Trustpilot sends us that is about OUR reviews of other companies, our account, or a code. Never a new review of us.
NON_REVIEW_SUBJECT = re.compile(
    r"activate your|thanks for joining|welcome|use code|set up your|didn.t make it online|taken offline|your review of|"
    r"verify|password|reset|confirm your|sign[- ]?in|log[- ]?in|receipt|invoice|weekly|monthly|digest|newsletter|"
    r"your invitation|invitation sent|invites? (?:sent|left|remaining)|plan|subscription|report is ready", re.I)

# A subject or body that says a customer reviewed us.
REVIEW_HINT = re.compile(
    r"new review|new \d[- ]star|\d[- ]star review|left (?:you |us )?a review|wrote a review|reviewed (?:you|us|bestly)|"
    r"(?:got|received|have|has) (?:a )?new review|review (?:of|for|on) bestly|gave (?:you|us|bestly)", re.I)

STAR_PATTERNS = [
    re.compile(r"rated\s+(\d)(?:\.0)?\s+out\s+of\s+5", re.I),
    re.compile(r"\b(\d)(?:\.0)?\s*[- ]?stars?\b", re.I),
    re.compile(r"\b(\d)(?:\.0)?\s+out\s+of\s+5\b", re.I),
    re.compile(r"\bstars?\s*[:=]\s*(\d)\b", re.I),
    re.compile(r"\brating\s*[:=]\s*(\d)\b", re.I),
]
GLYPH_RUN = re.compile(r"([★☆⭐]{3,5})")

NAME_STOP = {"trustpilot", "customer", "someone", "a", "an", "the", "our", "you", "your", "new", "anonymous", "reviewer",
             "bestly", "team", "user"}
NAME_PATTERNS = [
    re.compile(r"(?:reviewer|reviewed by|review (?:from|by)|name)\s*[:\-]\s*([A-Z][^\s,;:!?]*)", re.I),
    re.compile(r"\b(?:from|by)\s+([A-Z][A-Za-zÀ-ɏ'’\-]+)(?:\s+[A-Z]\.?)?(?:\s+(?:for|on|of|about)\b|[\s,.!:]|$)"),
    re.compile(r"\b([A-Z][A-Za-zÀ-ɏ'’\-]+)(?:\s+[A-Z][A-Za-zÀ-ɏ'’\-]*\.?)?\s+"
               r"(?:gave|left|wrote|rated|reviewed|posted)\b"),
]
NAME_OK = re.compile(r"^[A-Za-zÀ-ɏ'’\-]{2,30}$")

URL_REF = re.compile(r"\[\s*https?://[^\]]*\]", re.S)
BARE_URL = re.compile(r"https?://\S+")
STOP_LINE = re.compile(
    r"^(reply|respond|flag|report|view|see (?:all|the)|visit|read|manage|unsubscribe|trustpilot a/s|you.re receiving|you are receiving|"
    r"help center|this email|get the trustpilot|go to trustpilot|share|-{3,}|_{3,}|={3,}|privacy|company no)", re.I)
HEADERISH = re.compile(
    r"^(you (?:have|got|'ve got|’ve got)|new review|a new review|hi\b|hello\b|good news|great news|here.s what|"
    r"rated\s+\d|\d(?:\.0)?\s*[- ]?stars?\b|\d\s+out of 5|[★☆⭐\s]+$|reviewed\b|date of|"
    r"verified|invited|organic|location|country|[A-Z]{2}$)", re.I)
LABEL_TITLE = re.compile(r"^(?:review title|title|headline|subject)\s*[:\-]\s*(.+)$", re.I)
LABEL_TEXT = re.compile(r"^(?:review text|review|comment|comments|text|body|message|what they said)\s*[:\-]\s*(.*)$", re.I)

MAX_SNIPPET = 1500
MAX_TITLE = 140


class NotReview(Exception):
    """Not a customer review of us (account mail, our own review, a code...)."""


class Unparseable(Exception):
    """Looks like a review notification but we could not read it with certainty."""


def is_trustpilot_sender(addr):
    return bool(addr and SENDER_RE.search(addr.strip().lower()))


def clean_lines(body):
    t = (body or "").replace("\r\n", "\n").replace("\r", "\n")
    t = URL_REF.sub(" ", t)
    t = BARE_URL.sub(" ", t)
    out = []
    for raw in t.split("\n"):
        s = re.sub(r"[ \t ]+", " ", raw).strip()
        if s:
            out.append(s)
    return out


def find_stars(subject, body):
    for text in (subject or "", body or ""):
        for pat in STAR_PATTERNS:
            for m in pat.finditer(text):
                n = int(m.group(1))
                if 1 <= n <= 5:
                    return n
        m = GLYPH_RUN.search(text)
        if m and len(m.group(1)) == 5:
            filled = m.group(1).count("★") + m.group(1).count("⭐")
            if 1 <= filled <= 5:
                return filled
    return None


def find_first_name(subject, lines):
    hay = [subject or ""] + lines[:12]
    # A bare name line right before a country code or the star line ("Priya / US / 3 stars").
    for i, ln in enumerate(lines[:10]):
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if re.match(r"^[A-Z][A-Za-z\u00C0-\u024F'\u2019\-]+(?: [A-Z]\.?)?$", ln) and \
                (re.match(r"^[A-Z]{2}$", nxt) or find_stars("", nxt) is not None):
            tok = ln.split()[0]
            if tok.lower() not in NAME_STOP and NAME_OK.match(tok):
                return tok
    for text in hay:
        for pat in NAME_PATTERNS:
            for m in pat.finditer(text):
                tok = m.group(1).strip(".,;:!?’'\"")
                if tok.lower() in NAME_STOP or not NAME_OK.match(tok):
                    continue
                return tok[:1].upper() + tok[1:]
    return None


def _trim_sentence(s, limit):
    s = s.strip()
    if len(s) <= limit:
        return s
    cut = s[:limit]
    idx = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if idx >= int(limit * 0.5):
        return cut[:idx + 1].strip()
    sp = cut.rfind(" ")
    return cut[:sp].strip() if sp > 0 else cut.strip()


def extract_title_snippet(lines):
    title = None
    text_parts = []
    labelled_text = False
    for ln in lines:
        m = LABEL_TITLE.match(ln)
        if m and title is None:
            title = m.group(1).strip()
            continue
        m = LABEL_TEXT.match(ln)
        if m and not labelled_text:
            labelled_text = True
            if m.group(1).strip():
                text_parts.append(m.group(1).strip())
            continue
        if labelled_text:
            if STOP_LINE.match(ln):
                break
            text_parts.append(ln)
    if title is not None or labelled_text:
        snippet = " ".join(text_parts).strip() or None
        return (_trim_sentence(title, MAX_TITLE) if title else None,
                _trim_sentence(snippet, MAX_SNIPPET) if snippet else None)

    # Unlabelled: content starts after the last header-ish line in the leading block (stars line included).
    start = 0
    for i, ln in enumerate(lines[:10]):
        if HEADERISH.match(ln) or find_stars("", ln) is not None and len(ln) < 60:
            start = i + 1
    content = []
    for ln in lines[start:]:
        if STOP_LINE.match(ln):
            break
        content.append(ln)
    if not content:
        return None, None
    if len(content) == 1:
        return None, _trim_sentence(content[0], MAX_SNIPPET)
    first, rest = content[0], " ".join(content[1:])
    if len(first) > MAX_TITLE:
        return None, _trim_sentence(" ".join(content), MAX_SNIPPET)
    return first, _trim_sentence(rest, MAX_SNIPPET)


def parse_review(subject, from_addr, body_text):
    """Return {stars, title, snippet, reviewer_first_name}. Raises NotReview or Unparseable."""
    subject = subject or ""
    if not is_trustpilot_sender(from_addr):
        raise NotReview("sender is not trustpilot.com")
    if NON_REVIEW_SUBJECT.search(subject):
        raise NotReview("account or own-review mail")
    lines = clean_lines(body_text)
    blob = subject + "\n" + "\n".join(lines[:40])
    if not REVIEW_HINT.search(blob):
        raise NotReview("no review wording")
    stars = find_stars(subject, "\n".join(lines))
    if stars is None:
        raise Unparseable("looks like a review but no star rating found")
    title, snippet = extract_title_snippet(lines)
    if not title and not snippet:
        raise Unparseable("star rating found but no review text found")
    return {"stars": stars, "title": title, "snippet": snippet, "reviewer_first_name": find_first_name(subject, lines)}


_WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five"}


def _star_evidence(n, hay):
    """The number (digit or word) must sit within 25 characters of 'star' or 'rating'/'rated' in the email itself."""
    num = r"(?:%d|%s)" % (n, _WORDS[n])
    return bool(re.search(r"%s[^.\n]{0,25}(?:star|rating|rated)|(?:star|rating|rated)[^.\n]{0,25}\b%s\b" % (num, num), hay))


def verify_ai_extraction(obj, subject, body_text):
    """The free-AI fallback may only return text that is really in the email. Returns a clean review dict or raises Unparseable."""
    if not isinstance(obj, dict):
        raise Unparseable("AI gave no object")
    try:
        stars = int(obj.get("stars"))
    except (TypeError, ValueError):
        raise Unparseable("AI stars not a number")
    if not 1 <= stars <= 5:
        raise Unparseable("AI stars out of range")
    hay = re.sub(r"\s+", " ", (subject or "") + " " + " ".join(clean_lines(body_text))).lower()
    if not _star_evidence(stars, hay):
        raise Unparseable("AI star rating has no evidence in the email")
    out = {"stars": stars, "title": None, "snippet": None, "reviewer_first_name": None}
    for key in ("title", "snippet"):
        v = obj.get(key)
        if v:
            v = re.sub(r"\s+", " ", str(v)).strip()
            if v.lower() not in hay:
                raise Unparseable("AI %s is not verbatim from the email" % key)
            out[key] = v
    nm = obj.get("reviewer_first_name")
    if nm and NAME_OK.match(str(nm).strip()) and str(nm).strip().lower() in hay:
        out["reviewer_first_name"] = str(nm).strip()
    if not out["title"] and not out["snippet"]:
        raise Unparseable("AI found no review text")
    return out


def alert_text(review):
    """Maya's one-line note for the recap. Whole words only, no ellipsis."""
    name = review.get("reviewer_first_name") or "a customer"
    stars = review["stars"]
    quote = (review.get("title") or review.get("snippet") or "").strip()
    quote = _trim_sentence(quote, 70) if quote else ""
    line = "Maya: new %d-star Trustpilot review from %s" % (stars, name)
    return line + (" — “%s”" % quote.rstrip(".") if quote else "")
