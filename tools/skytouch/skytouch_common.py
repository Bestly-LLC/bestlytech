"""SkyTouch shared code for the two Pi jobs (skytouch_triage, skytouch_morning). Stdlib only, no AI.

Installed on the Pi as /opt/bestly/cron/jobs/skytouch_common.py. The repo copy is tools/skytouch/.

Everything that decides what a text means is plain rules in this file, so nothing a client typed is ever sent to a model.
The classifier is deliberately cautious: when it is unsure it sends nothing and makes a card for Jared.

The only things this code can ever send:
  * send_first_intake(): the fixed first hello to a brand-new inquiry (setting auto_first_reply, off by default)
  * send_availability_ask(): the fixed morning question, to Jared's own cell only (setting morning_text_jared, off by default)
Both refuse to run unless the destination is a Google Voice forwarding address, and the intake sender refuses Jared's number.
"""
import imaplib
import re
import smtplib
from datetime import datetime, timedelta
from email import message_from_bytes
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import parseaddr, parsedate_to_datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Los_Angeles")
GMAIL_USER = "jareds.mac@gmail.com"
JARED = "18165007236"        # Jared's own cell, digits with country code: instructions, never a client
SKYLER = "14242349256"       # the Google Voice line clients text
GV_DOMAIN = "txt.voice.google.com"
LABEL_HANDLED = "SkyTouch/Handled"
LABEL_FLAGGED = "SkyTouch/Flagged"

RATES = {  # fixed, never negotiated
    "therapeutic": {60: 90, 90: 120},
    "deep tissue": {60: 150, 90: 180},
    "sensual": {60: 250, 90: 300},
}

INTAKE_TEXT = ("Hey{name}, thanks for reaching out! Which service are you looking for — Therapeutic, Deep Tissue, "
               "or Sensual — and 60 or 90? Send me a day and time that works and I'll check my schedule.")
ASK_TEXT = "Morning! What's your availability today? Reply with your open hours (or \"none\") and I'll book around it."


# ---------------------------------------------------------------- switches and heartbeat

def gate(lib, job):
    return lib.rpc("skytouch_gate", p_job=job)


def beat(lib, slug, ok, summary):
    """Team page heartbeat. Counts only: never a name, number or message."""
    lib.rpc("agent_beat", p_slug=slug, p_ok=bool(ok), p_summary=summary[:400])


def secret(lib, name):
    try:
        return lib.rpc("pi_secret_get", p_name=name) or ""
    except Exception:  # noqa: BLE001
        return ""


# ---------------------------------------------------------------- text understanding (rules, no AI)

_SEXUAL = re.compile(
    r"\b(sex|sexual(?!ly\s+transmitted)|happy\s*ending|hj|handjob|hand\s*job|blow\s*job|bj|bbbj|oral|anal|nuru|erotic|nude|naked|"
    r"fuck\w*|cock|dick|pussy|horny|extras?|full\s*service|gfe|escort|finish(ing)?\s+(me|off)|release|cum|cumm?ing|"
    r"body\s*slide|prostate|tantric|nsa|dtf|hook\s*up|hookup)\b", re.I)
_ADDRESS = re.compile(
    r"\b(address|where\s+(are\s+you|r\s+u|do\s+you|is\s+it|exactly|at)|what\s+(area|part|neighborhood|city|street)|which\s+(area|part)|"
    r"location|cross\s*street|directions?|zip(\s*code)?|come\s+(over|to\s+you)|your\s+place|send\s+(me\s+)?(the\s+)?(address|location))\b", re.I)
_NEGOTIATE = re.compile(
    r"\b(discount|cheaper|deal|negotiat\w*|best\s+price|can\s+you\s+do|would\s+you\s+do|do\s+it\s+for|"
    r"i('ll|\s+will)\s+pay|pay\s+you|\d+\s*(bucks|dollars))\b|\$\s*\d+", re.I)
_DETAILS = re.compile(
    r"\b(what('s|\s+is|\s+are)\s+(included|involved|the\s+difference|in\s+the)|included|includes?|what\s+do\s+you\s+(offer|do)|"
    r"what\s+happens|what\s+does\s+.{0,20}\s+(mean|include|involve)|difference\s+between|tell\s+me\s+(more|about)|menu|"
    r"describe|explain|services\s+offered|what\s+kind)\b", re.I)
_ROOF = re.compile(
    r"\b(roof\w*|shingles?|gutters?|inspection|contractor|property|tenant|landlord|hoa|lbmc|referral|commercial|solar|"
    r"building\s+(manager|owner)|leak\w*)\b", re.I)
_SERVICE = re.compile(r"\b(therapeutic|deep\s*tissue|deep|sensual|swedish|couples?)\b", re.I)
_DURATION = re.compile(r"\b(60|90)\s*(min(ute)?s?|m)?\b|\b(1|one)\s*(hour|hr)\b|\b1\.5\b|\b(an?|one)\s+hour\b|\bhour\s+and\s+a\s+half\b", re.I)
_DAYS = r"(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?)"
_TIME = re.compile(
    r"\b(\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)|noon|midnight|tonight|today|tomorrow|tmrw|this\s+(morning|afternoon|evening|weekend)|"
    r"later|asap|right\s+now|now|in\s+(an?\s+)?(hour|\d+\s*(min|hour)s?)|" + _DAYS + r"|at\s+\d{1,2}(:\d{2})?|\d{1,2}:\d{2})\b", re.I)
_OUTCALL = re.compile(r"\b(outcall|out\s*call|hotel|my\s+(place|house|home|apartment|airbnb)|come\s+to\s+me|travel)\b", re.I)
_INQUIRY = re.compile(
    r"\b(massage|massages|book(ing)?|appointment|appt|avail\w*|session|openings?|slots?|looking\s+for|interested|how\s+much|"
    r"rates?|prices?|pricing|cost|body\s*work|rub|therapist|masseur|skyler)\b", re.I)


def is_gv_address(addr):
    return bool(addr) and addr.lower().endswith("@" + GV_DOMAIN)


def sender_number(addr):
    """Google Voice forward address: 1{skyler}.1{sender}.{token}@txt.voice.google.com -> digits of the sender (with leading 1)."""
    local = (addr or "").split("@")[0]
    parts = local.split(".")
    return re.sub(r"\D", "", parts[1]) if len(parts) >= 3 else ""


def is_jared(number):
    d = re.sub(r"\D", "", number or "")
    return d == JARED or d == JARED[1:]


def first_name(display):
    """From 'Geoff Smith (SMS)' -> 'Geoff'. A bare number or nothing -> ''."""
    d = re.sub(r"\(\s*sms\s*\)", "", display or "", flags=re.I).strip().strip('"')
    if not d or re.search(r"\d{3}", d):
        return ""
    w = re.split(r"\s+", d)[0]
    return w[:20] if re.fullmatch(r"[A-Za-z][A-Za-z'\-]{0,19}", w) else ""


def service_of(text):
    m = _SERVICE.search(text or "")
    if not m:
        return None
    w = m.group(1).lower().replace(" ", "")
    return "deep tissue" if w.startswith("deep") else "therapeutic" if w == "therapeutic" else "sensual" if w == "sensual" else None


def duration_of(text):
    m = _DURATION.search(text or "")
    if not m:
        return None
    s = m.group(0).lower()
    return 90 if ("90" in s or "1.5" in s or "half" in s) else 60


def classify(inbound, has_outbound, name=""):
    """inbound: list of the client's texts in the thread (oldest first). has_outbound: we or Jared already replied.

    Returns dict(kind, why, ask, suggested_reply, fits_hours=None, service, duration, when).
    kind is one of: intake (the one thing the bot may send), needs_approval, flagged. Silence is always safe, so anything
    unclear is 'flagged'.
    """
    text = " \n".join(inbound).strip()
    last = (inbound[-1] if inbound else "").strip()
    ask = text[-300:]
    out = {"kind": "flagged", "why": "", "ask": ask, "suggested_reply": None, "service": None, "duration": None, "when": None}
    if not text:
        out["why"] = "Empty or unreadable text. Nothing sent."
        return out
    if _SEXUAL.search(text):
        out["why"] = "Asks for something off limits. Nothing sent, no reply of any kind."
        return out
    if _ROOF.search(text):
        out["why"] = "Looks like roofing or property, which belongs to RoofGuard. Nothing sent."
        return out
    if _ADDRESS.search(text):
        out["why"] = "Asks for the address or where you are. The address is always yours to send. Nothing sent."
        return out
    if _NEGOTIATE.search(text):
        out["why"] = "Talks about price or a deal. Rates are fixed and never negotiated by the bot. Nothing sent."
        return out
    if _DETAILS.search(text):
        out["why"] = "Asks what a service includes. That answer is yours. Nothing sent."
        return out

    svc, dur = service_of(text), duration_of(text)
    named = bool(_SERVICE.search(text))
    tm = _TIME.search(text)
    when = tm.group(0).strip() if tm else None
    out.update(service=svc, duration=dur, when=when)

    if svc or named or dur or tm:
        out["kind"] = "needs_approval"
        out["why"] = "They named a service, length or time. Nothing is sent until you approve."
        out["suggested_reply"] = suggest_reply(name, svc, dur, when, bool(_OUTCALL.search(text)))
        return out
    if has_outbound:
        out["why"] = "A reply has already gone out on this thread. It stays with you."
        return out
    if len(inbound) <= 2 and len(text) <= 400 and _INQUIRY.search(text):
        out["kind"] = "intake"
        out["why"] = "Brand-new inquiry with no service or time named."
        out["suggested_reply"] = INTAKE_TEXT.format(name=(" " + name) if name else "")
        return out
    out["why"] = "Not clearly a booking inquiry (wrong number, delivery, a friend, or unclear). Nothing sent."
    return out


def suggest_reply(name, svc, dur, when, outcall):
    hey = "Hey" + ((" " + name) if name else "")
    if svc and dur and svc in RATES:
        price = "${} for {} minutes".format(RATES[svc][dur], dur)
        s = "{}, {} is {}.".format(hey, svc.title(), price)
    elif svc and svc in RATES:
        s = "{}, {} is ${} for 60 or ${} for 90.".format(hey, svc.title(), RATES[svc][60], RATES[svc][90])
    else:
        s = "{}, thanks for reaching out! Which service are you looking for — Therapeutic, Deep Tissue, or Sensual — and 60 or 90?".format(hey)
    if when:
        s += " I can look at {}. Want me to lock it in?".format(when)
    else:
        s += " Send me a day and time that works and I'll check my schedule."
    if outcall:
        s += " Incall is my default; I can come to you if you cover the Ubers round trip."
    return s


# ---------------------------------------------------------------- Jared's availability text ("2-6pm", "none")

def _clock(h, m, ap):
    h = int(h)
    m = int(m or 0)
    if ap:
        ap = ap.lower().replace(".", "")
        if ap == "pm" and h < 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
    return h * 60 + m


_RANGE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|to|until|till|thru)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)", re.I)


def parse_hours(text):
    """-> 'none', a list of (start_min, end_min), or None when it can't be told."""
    t = (text or "").strip().lower()
    if re.fullmatch(r"(none|closed|no|nope|nothing|not today|off|unavailable)[.! ]*", t) or re.search(r"\b(none|closed|not available|unavailable|booked up|off today)\b", t):
        return "none"
    out = []
    for m in _RANGE.finditer(t):
        a_h, a_m, a_ap, b_h, b_m, b_ap = m.groups()
        a_ap = a_ap or b_ap
        s, e = _clock(a_h, a_m, a_ap), _clock(b_h, b_m, b_ap)
        if s >= e and not m.group(3) and s >= 12 * 60:
            s -= 12 * 60   # "10-2pm" means 10 AM to 2 PM
        if e <= s:
            e += 12 * 60
        out.append((s, e))
    return out or None


def minutes_of(when):
    m = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)", when or "", re.I)
    if m:
        return _clock(m.group(1), m.group(2), m.group(3))
    if re.search(r"noon", when or "", re.I):
        return 12 * 60
    return None


def fits(avail, when):
    """True/False/None (None = could not tell)."""
    hrs = parse_hours(avail) if isinstance(avail, str) else avail
    if hrs == "none":
        return False
    if not hrs:
        return None
    mm = minutes_of(when)
    if mm is None:
        return None
    return any(s <= mm < e for s, e in hrs)


_APPROVAL = re.compile(r"^\s*(yes|yep|yeah|ok|okay|sure|approve[d]?|no|nope|decline|tell|send|confirm|do it)\b|\b(works|sounds good|go ahead|tell (him|her|them)|say yes|say no)\b", re.I)


def looks_like_approval(text):
    return bool(_APPROVAL.search(text or ""))


# ---------------------------------------------------------------- Gmail (IMAP read / SMTP send, app password)

def _dec(v):
    try:
        return str(make_header(decode_header(v or "")))
    except Exception:  # noqa: BLE001
        return v or ""


def _body_text(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                return _payload(part)
        return ""
    return _payload(msg) if msg.get_content_type() == "text/plain" else ""


def _payload(part):
    raw = part.get_payload(decode=True) or b""
    return raw.decode(part.get_content_charset() or "utf-8", "replace")


_FOOTER = re.compile(r"\n?\s*(YOUR ACCOUNT|To respond to this text message|--\s*\n\s*Sent using SMS-to-email|<https://voice\.google\.com).*", re.S | re.I)


def clean_text(body):
    return _FOOTER.sub("", (body or "").replace("\r", "")).strip()


class Gmail:
    """One IMAP session on All Mail. readonly=True never changes a label."""

    def __init__(self, app_password, readonly=True):
        self.readonly = readonly
        self.imap = imaplib.IMAP4_SSL("imap.gmail.com", 993, timeout=40)
        self.imap.login(GMAIL_USER, app_password)
        typ, _ = self.imap.select('"[Gmail]/All Mail"', readonly=readonly)
        if typ != "OK":
            raise RuntimeError("could not open All Mail")

    def close(self):
        try:
            self.imap.logout()
        except Exception:  # noqa: BLE001
            pass

    def search(self, raw):
        typ, data = self.imap.uid("SEARCH", "X-GM-RAW", '"' + raw.replace('"', "") + '"')
        return data[0].split() if typ == "OK" and data and data[0] else []

    def thread_uids(self, thrid):
        typ, data = self.imap.uid("SEARCH", "X-GM-THRID", str(thrid))
        return data[0].split() if typ == "OK" and data and data[0] else []

    def fetch(self, uid):
        """-> dict(uid, thrid, labels, from_addr, from_name, to, subject, date, message_id, references, text)"""
        typ, data = self.imap.uid("FETCH", uid, "(X-GM-THRID X-GM-LABELS RFC822)")
        if typ != "OK" or not data or not isinstance(data[0], tuple):
            return None
        meta = data[0][0].decode("utf-8", "replace")
        raw = data[0][1]
        thr = re.search(r"X-GM-THRID\s+(\d+)", meta)
        lab = re.search(r"X-GM-LABELS\s+\((.*?)\)\s*(UID|RFC822)", meta, re.S)
        msg = message_from_bytes(raw)
        name, addr = parseaddr(_dec(msg.get("From")))
        try:
            when = parsedate_to_datetime(msg.get("Date")).astimezone(TZ)
        except Exception:  # noqa: BLE001
            when = datetime.now(TZ)
        return {
            "uid": uid.decode() if isinstance(uid, bytes) else str(uid),
            "thrid": thr.group(1) if thr else "",
            "labels": lab.group(1) if lab else "",
            "from_addr": addr, "from_name": name, "subject": _dec(msg.get("Subject")), "date": when,
            "message_id": msg.get("Message-ID", ""), "references": msg.get("References", ""),
            "text": clean_text(_body_text(msg)),
        }

    def label(self, uids, label):
        if self.readonly:
            raise RuntimeError("read-only session")
        for u in uids:
            self.imap.uid("STORE", u, "+X-GM-LABELS", '("' + label + '")')


def _send(app_password, to_addr, subject, body, in_reply_to="", references=""):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = GMAIL_USER, to_addr, subject
    if in_reply_to:
        m["In-Reply-To"] = in_reply_to
        m["References"] = (references + " " + in_reply_to).strip()
    m.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=40) as s:
        s.login(GMAIL_USER, app_password)
        s.send_message(m)


def send_first_intake(app_password, last_msg, name=""):
    """The ONE message the bot may send to a client. Fixed text. Refuses Jared's number and any non-Google-Voice address."""
    to = last_msg["from_addr"]
    if not is_gv_address(to) or is_jared(sender_number(to)):
        raise RuntimeError("refusing to send: not a client Google Voice address")
    subj = last_msg["subject"] if last_msg["subject"].lower().startswith("re:") else "Re: " + last_msg["subject"]
    _send(app_password, to, subj, INTAKE_TEXT.format(name=(" " + name) if name else ""), last_msg["message_id"], last_msg["references"])


def send_availability_ask(app_password, last_msg_from_jared):
    """The morning question, to Jared's own cell only."""
    to = last_msg_from_jared["from_addr"]
    if not is_gv_address(to) or not is_jared(sender_number(to)):
        raise RuntimeError("refusing to send: this is not Jared's own thread")
    subj = last_msg_from_jared["subject"] if last_msg_from_jared["subject"].lower().startswith("re:") else "Re: " + last_msg_from_jared["subject"]
    _send(app_password, to, subj, ASK_TEXT, last_msg_from_jared["message_id"], last_msg_from_jared["references"])


def fmt_time(dt):
    return dt.astimezone(TZ).strftime("%I:%M %p").lstrip("0")


def today():
    return datetime.now(TZ).date()


def age_hours(dt):
    return (datetime.now(TZ) - dt).total_seconds() / 3600.0
