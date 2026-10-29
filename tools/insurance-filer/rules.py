"""Answer rules for insurance claim forms. Pure Python (no browser) so tests can run them anywhere. Python 3.9 compatible.

The one rule above all: NEVER INVENT. A question gets an answer only when a rule below ties it to a fact in the packet (the packet is
built in Postgres by ins_build_packet from Turo's own records and the guest's own words). No rule, or the fact is missing -> None, and
the walker leaves the field blank and lists it for Jared.

packet values (keys): reporter.name/phone/email/address/role, insurer.name, policy.number/holder/claim_no, driver.name/phone,
guest.name/phone, vehicle.year/make/model/plate/plate_state/vin/color/drivable/location, loss.date/time/address/city/state/zip/type/
description/damage/parts/injuries/police/airbags/other_party, turo.claim_no, turo.disclosure, estimate.amount.
"""
import re

STATES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut",
          "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
          "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
          "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
          "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
          "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
          "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
          "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("’", "'")).strip().lower()


def yes_no(v):
    """'Yes' / 'No' / None. 'Not sure' and 'None known' are not an answer."""
    s = norm(v)
    if re.match(r"^(yes|y|true)\b", s):
        return "Yes"
    if re.match(r"^(no|n|false)\b", s):
        return "No"
    return None


def digits(s):
    return re.sub(r"\D", "", s or "")


def phone_fmt(v):
    d = digits(v)
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return "(%s) %s-%s" % (d[:3], d[3:6], d[6:]) if len(d) == 10 else (v or None)


def state_forms(v):
    """-> list of ways a state may be written, best first"""
    v = (v or "").strip()
    if not v:
        return []
    if v.upper() in STATES:
        return [v.upper(), STATES[v.upper()]]
    for k, n in STATES.items():
        if n.lower() == v.lower():
            return [n, k]
    return [v]


def pick_option(options, wanted):
    """options: list of strings (or {value,text}); wanted: string or list of strings. -> the option text/value to choose, or None."""
    if wanted is None:
        return None
    wants = wanted if isinstance(wanted, (list, tuple)) else [wanted]
    opts = [(o.get("text") or o.get("value") or "", o.get("value") or o.get("text") or "") if isinstance(o, dict) else (o, o) for o in options]
    for w in wants:
        for text, val in opts:
            if norm(text) == norm(w) or norm(val) == norm(w):
                return text or val
    for w in wants:
        hits = [(t, v) for t, v in opts if norm(w) and (norm(w) in norm(t))]
        if len(hits) == 1:
            return hits[0][0] or hits[0][1]
    return None


# ----------------------------------------------------------------------------------------------- text fields
ADDRESS_OF_REPORTER = re.compile(r"your (mailing |home |current )?address|mailing address|home address|where do you (live|reside)|your street")

TEXT_RULES = [
    # more specific first
    (r"driver.*phone|phone.*driver", "driver.phone"),
    (r"driver.*name|name.*driver", "driver.name"),
    (r"(policy ?holder|insured|named insured).*(name)|name of the (policy ?holder|insured)|insured.?s name", "policy.holder"),
    (r"policy (number|no\b|#|id)|policy num", "policy.number"),
    (r"claim (number|no\b|#|id)", "policy.claim_no"),
    (r"\bvin\b|vehicle identification", "vehicle.vin"),
    (r"licen[cs]e plate|plate (number|no\b|#)|tag number", "vehicle.plate"),
    (r"plate state|state of (registration|plate|license)|registration state", "vehicle.plate_state"),
    (r"vehicle year|year of (the )?(vehicle|car)|model year|^year$", "vehicle.year"),
    (r"vehicle make|^make$|\bmake of\b", "vehicle.make"),
    (r"vehicle model|^model$|\bmodel of\b", "vehicle.model"),
    (r"colou?r", "vehicle.color"),
    (r"date of (the )?(loss|accident|incident|collision)|when did (it|the (accident|incident|loss|damage)) (happen|occur)|accident date|date it happened|loss date|date of damage", "loss.date"),
    (r"time of (the )?(loss|accident|incident|collision)|what time", "loss.time"),
    (r"first name", "reporter.first"),
    (r"last name|surname", "reporter.last"),
    (r"^(your |the )?(full |legal )?name( \(.*\))?$|your (full )?name|^full name|first and last name", "reporter.name"),
    (r"phone|mobile|cell", "reporter.phone"),
    (r"e-?mail", "reporter.email"),
    (r"\bzip\b|postal", "@zip"),
    (r"\bcity\b|\btown\b", "@city"),
    (r"\bstate\b|province", "@state"),
    (r"street|address", "@address"),
    (r"describe (the )?(damage)|damage (description|to the)|what (is|was) damaged", "loss.damage"),
    (r"(describe|explain|tell us).*(what happened|how|the (accident|incident|loss))|what happened|how did (it|the (accident|incident|loss|damage)) (happen|occur)|in your own words", "loss.description"),
    (r"additional (information|details|comments|notes)|anything else|other details|any other|comments", "@extra"),
]


def key_for_text(label, title=""):
    """-> packet key for a text field, or None. @address/@city/@state/@zip pick loss.* or reporter.* from the page's own words."""
    both = norm((label or "") + " | " + (title or ""))
    lab = norm(label)
    for pat, key in TEXT_RULES:
        if re.search(pat, lab):
            break
    else:
        for pat, key in TEXT_RULES:
            if key in ("@extra",) and re.search(pat, both):
                break
        else:
            return None
    if key.startswith("@") and key != "@extra":
        if ADDRESS_OF_REPORTER.search(both):
            return "reporter." + key[1:] if key != "@address" else "reporter.address"
        return "loss." + key[1:]
    return key


def text_value(key, values, title=""):
    """-> the string to type, or None."""
    if key is None:
        return None
    v = values or {}
    if key == "@extra":
        parts = []
        if v.get("driver.name"):
            parts.append("The driver was %s%s." % (v["driver.name"], (", phone " + phone_fmt(v["driver.phone"])) if v.get("driver.phone") else ""))
        if v.get("turo.disclosure"):
            parts.append(v["turo.disclosure"])
        return " ".join(parts) or None
    if key == "reporter.first":
        n = (v.get("reporter.name") or "").split()
        return n[0] if n else None
    if key == "reporter.last":
        n = (v.get("reporter.name") or "").split()
        return " ".join(n[1:]) if len(n) > 1 else None
    if key in ("reporter.phone", "driver.phone", "guest.phone"):
        return phone_fmt(v.get(key))
    if key == "loss.description":
        base = v.get(key)
        if not base:
            return None
        # the Turo claim is disclosed wherever the loss is described, so the insurer never learns of it by surprise
        return base.rstrip(".") + ". " + v["turo.disclosure"] if v.get("turo.disclosure") else base
    return v.get(key) or None


# ----------------------------------------------------------------------------------------------- yes/no and choice questions
def _safe(values):
    """'Is everyone currently safe?' -> Yes only when the report says nobody was injured."""
    inj = yes_no((values or {}).get("loss.injuries"))
    return {"No": "Yes", "Yes": "No"}.get(inj)


def choose(question, options, values):
    """question: the screen's question text; options: list of strings. -> (option, key, note) or (None, None, why)."""
    q = norm(question)
    v = values or {}
    labels = [o if isinstance(o, str) else (o.get("text") or o.get("value") or "") for o in options]

    def yn(ans, key, note=None):
        if ans is None:
            return None, None, "The packet has no answer for: " + question[:120]
        pick = pick_option(labels, ans)
        return (pick, key, note) if pick else (None, None, "Could not match '%s' to the choices" % ans)

    # "Who are you insured by?" = Jared's OWN policy on the car: Tesla Insurance (Jared 2026-10-29) -> "Another insurer"
    if re.search(r"who are you insured (by|with)|who is your (insurer|insurance)|your (own )?(auto )?insurance (company|carrier|provider)", q):
        pick = [l for l in labels if re.search(r"another|other (insurer|company)|different", norm(l))]
        if len(pick) == 1:
            return pick[0], "reporter.insurer", "Jared's own policy is with Tesla Insurance"
        return None, None, "No 'another insurer' choice in: " + ", ".join(labels)[:120]
    # "We can't find a record of that Progressive policy. Please try again." -> Try again (then the policy screen is skipped if Jared said so)
    if re.search(r"(can.?t|cannot|could not|unable to) find (a record of )?(that|the|this|your)? ?.{0,20}policy", q):
        pick = [l for l in labels if re.search(r"try again|go back|edit", norm(l))]
        if len(pick) == 1 and v.get("policy.skip_lookup"):
            return pick[0], "policy.skip_lookup", "Back to the policy screen, then Skip (Jared)"
        return None, None, "The insurer found no policy with that number and name"
    if re.search(r"everyone.*(safe|okay|ok|fine)|is anyone (safe)", q):
        return yn(_safe(v), "loss.injuries", "Safe means nobody was injured (guest damage report)")
    if re.search(r"(anyone|anybody|any one|someone|were there any).*(injur|hurt)|any injuries|injuries", q):
        return yn(yes_no(v.get("loss.injuries")), "loss.injuries")
    if re.search(r"police", q):
        return yn(yes_no(v.get("loss.police")), "loss.police")
    if re.search(r"airbag", q):
        return yn(yes_no(v.get("loss.airbags")), "loss.airbags")
    if re.search(r"driv(e|ea)ble|can (it|the (car|vehicle)) be driven", q):
        return yn(yes_no(v.get("vehicle.drivable")), "vehicle.drivable")
    if re.search(r"(another|other) (vehicle|car|person|party|driver)|anyone else (involved|in)|involve", q):
        return yn(yes_no(v.get("loss.other_party")), "loss.other_party")
    if re.search(r"(are|were) you (the )?(policy ?holder|insured|named insured)", q):
        return yn("No", "reporter.role", "The reporter owns the car; the renter's policy is not his")
    if re.search(r"(are|were|do) you (the )?(own|owner)|you own", q):
        return yn("Yes", "reporter.role", "Owner of the car (Turo host)")
    if re.search(r"were you (driving|in the (car|vehicle)|present|a passenger)|were you there", q):
        return yn("No", "reporter.role", "The renter was driving; the owner was not in the car")
    # "Are you filing on behalf of yourself, or someone else?" Jared files for his OWN car (he owns it), so: Myself. (fix 2026-10-29)
    if re.search(r"on behalf of (yourself|you)\b|yourself,? or someone else|for yourself or", q):
        pick = [l for l in labels if re.search(r"\b(myself|yourself)\b", norm(l))]
        if len(pick) == 1:
            return pick[0], "reporter.role", "He is filing for his own car (the owner), not for someone else"
        return None, None, "Could not find 'Myself' in: " + ", ".join(labels)[:120]
    # "What is the best way for us to get in touch with you?" -> Email (jared@bestly.tech; Claims Closer reads insurer mail there)
    if re.search(r"best way .*(get in touch|contact|reach)|(preferred|best) (contact|method of contact|way to contact)|how (should|would you like) (we|us to) (contact|reach)", q):
        pick = [l for l in labels if re.search(r"\be-?mail\b", norm(l))]
        if len(pick) == 1:
            return pick[0], "reporter.contact_pref", "Email, so Claims Closer sees every reply"
        return None, None, "No Email choice in: " + ", ".join(labels)[:120]
    if re.search(r"(relationship|who are you|your role|are you (a|the)|you are|filing as|on behalf)", q):
        pick = [l for l in labels if re.search(r"(third|claimant|other party|owner of|vehicle owner|not (the )?insured|someone else|property owner)", norm(l))]
        if len(pick) == 1:
            return pick[0], "reporter.role", "Owner of the damaged car, not the policyholder"
        return None, None, "Could not tell which role fits: " + question[:120]
    if re.search(r"(type|kind) of (loss|accident|incident|claim|damage)|what (happened|best describes)|how was .*(caused|damaged)|cause of", q):
        loss = norm(v.get("loss.type"))
        if loss:
            pick = pick_option(labels, [v.get("loss.type"), "Collision" if "collision" in loss else ""])
            if pick:
                return pick, "loss.type", None
        return None, None, "The report's loss type does not match a choice: " + question[:120]
    if re.search(r"(which|what) state|state of", q):
        pick = pick_option(labels, state_forms(v.get("loss.state")))
        return (pick, "loss.state", None) if pick else (None, None, "No state to choose")
    return None, None, "No rule for: " + question[:140]


# ----------------------------------------------------------------------------------------------- buttons
FINAL_RE = re.compile(r"^(submit|submit claim|submit my claim|file (my |the )?claim|send (my |the )?claim|finish|complete (my )?claim|finalize|confirm and submit|report claim)\b", re.I)
CONSENT_RE = re.compile(r"(i agree|agree and continue|i accept|accept and continue|agree & continue)", re.I)
ADVANCE_RE = re.compile(r"^(continue|next|save and continue|save & continue|done|go on|proceed|looks good|confirm|ok|okay)\b", re.I)
SKIP_RE = re.compile(r"^(navigate back|back|cancel|close|help|chat|log ?in|sign ?in|menu|skip)\b", re.I)


def classify_button(label):
    """-> 'final' | 'consent' | 'advance' | 'skip' | 'other'"""
    t = (label or "").strip()
    if SKIP_RE.search(t):
        return "skip"
    if CONSENT_RE.search(t):
        return "consent"
    if FINAL_RE.search(t):
        return "final"
    if ADVANCE_RE.search(t):
        return "advance"
    return "other"


CLAIM_NO_RE = re.compile(r"(?i)claim\s*(?:number|no\.?|#|id)?\s*(?:is|:)?\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{5,16})")
CONFIRM_NO_RE = re.compile(r"(?i)(?:confirmation|reference)\s*(?:number|no\.?|#|code)?\s*(?:is|:)?\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{5,16})")


def claim_no_from(text, turo_claim_no=None):
    """The insurer's own claim number from a confirmation page. Turo's number is never returned."""
    t = re.sub(r"(?i)turo\s+claim\s*(?:no\.?|number|#|id)?\s*:?\s*#?\s*\d+", " ", text or "")
    for rx in (CLAIM_NO_RE, CONFIRM_NO_RE):
        for m in rx.finditer(t):
            c = m.group(1).strip("-")
            if turo_claim_no and c == str(turo_claim_no):
                continue
            return c
    return None


BOT_RE = re.compile(r"(captcha|verify (that )?you are (a )?human|are you a robot|unusual (traffic|activity)|access denied|request blocked|automated (access|requests)|press (&|and) hold)", re.I)
