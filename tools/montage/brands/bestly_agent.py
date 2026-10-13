"""Bestly Agent ads for Montage (Jared 2026-10-12, 9:38 PM: "Make an ad for our new product Bestly Agents."). Plan: docs/bestly-agent-ad-opusplan.md.

Two kinds of video come out of this brand:
  * The two launch ads (ADS below) are hand-written, because an ad needs the price and the hook exactly as Jared's facts state them. A job whose brief
    carries the tag `[ad:missed-call]` or `[ad:what-she-does]` gets that script. It still goes through the same gates as every Montage script:
    _common.check (lengths, no absolutes, no questions/emoji/hashtags, scene 1 says what the product is), the brand's claim rules in the database
    (claim_rules for 'bestly-agent', hard + soft) and extra_check below (only the real plan prices, minutes, languages, money-back window).
  * Anything else (a brief with no tag, or a re-cut whose Changes note asks for new words) is written by the free AI through _common.write with the
    facts in ABOUT; numbers are allowed (cfg allow_numbers) but extra_check and the claim rules police every one of them.
Design: comp/brand (BrandShort) in the bestly.tech/agent page palette (deep ink blue, periwinkle, orchid), Inter type, the real Bestly pill logo in the
corner, Maya's orb on the closing card, a phone call card for the missed-call hook (fictional caller + made-up business from public/agent-demo).
Voice: Maya's own ElevenLabs voice (Hope - upbeat and clear, a licensed library voice, the one on her agent), so the ad sounds like the product.
Music: this brand has no tracks of its own; the picker borrows from the other Bestly house brands (migration 20261013050000), nothing is generated."""
import copy
import re
import sys

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, "/opt/bestly/montage")
from brands import _common  # noqa: E402

KIT = "/opt/bestly/social-kit"
KIT_AGENT = "/opt/bestly/montage-kit/bestly-agent"       # fetch-assets.sh: portraits + logos from public/agent-demo (fictional people, original logos)
NAME = "Bestly Agent"
COMPOSITION, COMP_DIR = "BrandShort", "brand"
THEMES = ["agent"]
MOOD = "upbeat"
ICONS = ["phone", "missedcall", "calendar", "apps", "globe", "chat", "check", "pricetag"]
ICON_HELP = {"phone": "a phone handset (answering the phone)", "missedcall": "a phone handset with a cross (a missed call)",
             "apps": "a grid of app tiles (the apps the business already uses)", "globe": "a globe (many languages)",
             "calendar": "a calendar (booking appointments)", "chat": "a chat bubble (texts and website chat)",
             "check": "a check mark (done, handled)", "pricetag": "a price tag (the monthly price)"}

ABOUT = (
    "Bestly Agent is an AI receptionist for small businesses. Her name is Maya. She answers the business phone and does the work: she books "
    "appointments, answers customers' questions, and connects to the apps the business already uses (its calendar, customer list, help desk, payments "
    "and crew schedule). More than 120 apps work, and new connections are usually ready the same day. She handles calls, texts and website chat in more "
    "than 90 languages, and the owner can see every call she takes. Plans: Lite is $49 a month (30 minutes), Starter is $199 a month (150 minutes), "
    "Growth is $499 a month (500 minutes). No setup fee, 30 days to get your money back. Hear a demo at bestly.tech/agent. "
    "These are the ONLY things you may say: use no other fact, number, price, customer, result or feature. Do not name any app or company. "
    "No compliance claims (no HIPAA). She is openly an AI receptionist; never imply callers cannot tell. Tone: upbeat, clear, plain words, calm. "
    "The pain to name is a missed call (a busy owner cannot pick up) without scaring anyone."
)

# --- the guard on every number (the DB claim rules check the same things on the text; this runs first and names the problem) -----------------------
_PRICES = {"49", "199", "499"}
_SPELLED_OK = ("forty-nine", "forty nine", "one hundred ninety-nine", "one hundred and ninety-nine", "four hundred ninety-nine",
               "four hundred and ninety-nine")


def extra_check(blob):
    e = []
    for m in re.finditer(r"\$\s?(\d[\d,]*)", blob):
        if m.group(1).replace(",", "") not in _PRICES:
            e.append(f"${m.group(1)} is not a plan price (only $49, $199 and $499 a month exist)")
    for m in re.finditer(r"([A-Za-z]+(?:[- ][A-Za-z]+){0,3})\s+dollars", blob, re.I):
        w = m.group(1).lower()
        if not any(w.endswith(x) for x in _SPELLED_OK):
            e.append(f"'{m.group(0)}' is not a plan price (forty-nine, one hundred ninety-nine, four hundred ninety-nine)")
    for m in re.finditer(r"(\d[\d,]*)\+?\s*(?:other\s+)?languages", blob, re.I):
        if m.group(1) != "90":
            e.append(f"{m.group(1)} languages: the fact is 90+ languages")
    for m in re.finditer(r"(\d[\d,]*)\+?\s*(?:other\s+)?apps\b", blob, re.I):
        if m.group(1) != "120":
            e.append(f"{m.group(1)} apps: the fact is 120+ apps")
    for m in re.finditer(r"(\d[\d,]*)[- ]?(?:day|days)\b", blob, re.I):
        if m.group(1) != "30":
            e.append(f"{m.group(1)} days: the only day count is the 30-day money back")
    for m in re.finditer(r"(\d[\d,]*)[- ]?min(?:ute)?s?\b", blob, re.I):
        if m.group(1) not in ("30", "150", "500"):
            e.append(f"{m.group(1)} minutes is not a plan size (30, 150 or 500)")
    return e


CFG = {
    "slug": "bestly-agent", "name": NAME, "claim": "bestly-agent", "about": ABOUT, "lessons_brand": None,
    "mood": MOOD, "themes": THEMES, "tail": "", "name_patterns": [r"\bbestly\b"], "icons": ICONS, "icon_help": ICON_HELP,
    "explain_first": True, "no_absolutes": True,
    "allow_numbers": True, "allow_links": "bestly.tech/agent", "extra_check": extra_check,
    "number_rule": ("Numbers: you may state ONLY these, exactly: the plan price from $49 a month, the three plans ($49 / $199 / $499 a month for 30 / 150 / 500 minutes), "
                    "30 days money back, 90+ languages, 120+ apps. In a \"say\" write every number as words (forty-nine dollars, thirty days, ninety languages) so the narrator "
                    "reads it; in a \"line\" and the caption use digits and the $ sign. The caption may end with the address bestly.tech/agent. No other statistic."),
    "chip_topics": [("calls", r"calls?|phone|answers?|picks?|rings?", {"phone"}),
                    ("apps", r"apps?|software|tools?|connects?", {"apps"}),
                    ("languages", r"languages?|translat\w*|spanish|multilingual", {"globe"}),
                    ("price", r"months?|monthly|plans?|back", {"pricetag"})],
    "shot_brand": ("A small business at work, seen from behind or in close-up: a workshop bench, a shop counter, a phone face down on a desk. "
                   "Never a readable screen or label."),
    "end_cta_say": "Try Maya at Bestly dot tech slash agent.",
    "end": {"title": "Bestly Agent", "sub": "An AI receptionist that answers your business phone.", "cta": "bestly.tech/agent",
            "say": "Bestly Agent. An AI receptionist that answers your business phone. Try Maya at Bestly dot tech slash agent.",
            "chips": [{"icon": "phone", "text": "Answers your calls"}, {"icon": "calendar", "text": "Books on your calendar"},
                      {"icon": "pricetag", "text": "From $49 a month"}]},
}
END = CFG["end"]

NB = "\u00a0"
CARD_MISSED = {"kind": "missed", "name": "Mark Ellis", "place": "Ridgeline Plumbing",
               "photo": "agent/mark-ellis.webp", "logo": "agent/ridgeline-plumbing.svg"}
CARD_ANSWERED = dict(CARD_MISSED, kind="answered")

ADS = {
    # ~25 s. Pain, what it is, what she does, price, address.
    "missed-call": {
        "title": "Bestly Agent ad: missed call", "topic": "missed calls", "mood": "upbeat",
        "scenes": [
            {"kicker": "AI receptionist", "line": "A missed call can send a customer elsewhere.",
             "say": "Your hands are full, the phone rings, and the caller hangs up.", "icon": "missedcall", "card": CARD_MISSED},
            {"line": "Maya answers your business phone.", "say": "Maya is an AI receptionist. She picks up for you.", "icon": "phone", "card": CARD_ANSWERED},
            {"line": "She books appointments and answers questions.", "say": "She books the appointment on your calendar and answers questions.", "icon": "calendar"},
            {"line": f"From $49{NB}a{NB}month.", "say": "Plans start at forty-nine dollars a month, with thirty days to get your money back.", "icon": "pricetag"},
        ],
        "end": {"sub": "An AI receptionist that answers your business phone.",
                "chips": [{"icon": "phone", "text": "Answers your calls"}, {"icon": "calendar", "text": "Books on your calendar"},
                          {"icon": "pricetag", "text": f"From $49{NB}a{NB}month"}],
                "say": "Bestly Agent. An AI receptionist that answers your business phone. Try Maya at Bestly dot tech slash agent."},
        "caption": ("A missed call can send a customer to someone else. You can't answer when you're on a job or with a client.\n\n"
                    "Maya is an AI receptionist. She answers your business phone, books appointments on your calendar and answers customer questions.\n\n"
                    "Bestly Agent starts at $49 a month, with 30 days to get your money back. Hear Maya at bestly.tech/agent"),
    },
    # ~30 s. What it is, what she does, the apps, languages, price, address.
    "what-she-does": {
        "title": "Bestly Agent ad: what she does", "topic": "ai receptionist", "mood": "confident",
        "scenes": [
            {"kicker": "AI receptionist", "line": "Meet Maya. She answers your business phone.",
             "say": "Meet Maya, an AI receptionist who answers your business phone.", "icon": "phone", "card": CARD_ANSWERED},
            {"line": "She books appointments and answers questions.", "say": "She books appointments, answers questions, and you see every call.", "icon": "calendar"},
            {"line": "She connects to the apps you already use.", "say": "She connects to more than one hundred twenty apps.", "icon": "apps"},
            {"line": f"Calls, texts and chat in 90+{NB}languages.", "say": "Calls, texts and website chat, in more than ninety languages.", "icon": "globe"},
            {"line": f"From $49{NB}a{NB}month.", "say": "Plans start at forty-nine dollars a month. No setup fee, and thirty days to get your money back.", "icon": "pricetag"},
        ],
        "end": {"sub": "An AI receptionist that answers your business phone.",
                "chips": [{"icon": "chat", "text": "Calls, texts, chat"}, {"icon": "globe", "text": f"90+{NB}languages"},
                          {"icon": "pricetag", "text": f"From $49{NB}a{NB}month"}],
                "say": "Bestly Agent. An AI receptionist that answers your business phone. Hear a demo at Bestly dot tech slash agent."},
        "caption": ("Meet Maya, an AI receptionist for your business.\n\n"
                    "She answers your phone, books appointments and answers questions. She connects to the apps you already use, handles calls, texts and website chat in 90+ languages, "
                    "and you see every call.\n\n"
                    "Bestly Agent starts at $49 a month, with no setup fee and 30 days to get your money back. Hear a demo at bestly.tech/agent"),
    },
}

BRAND = {
    "fonts": [{"family": "BestlySans", "file": "fonts/inter400.woff2", "weight": "400"},
              {"family": "BestlySans", "file": "fonts/inter600.woff2", "weight": "600"},
              {"family": "BestlySans", "file": "fonts/inter800.woff2", "weight": "800"}],
    "head": {"family": "BestlySans", "weight": 800, "sizes": [112, 100, 88], "spacing": "-0.025em"},
    "end_title": {"family": "BestlySans", "weight": 800, "spacing": "-0.03em"},     # modern sans on the closing card, like Bestly Cloud's
    "label": {"family": "BestlySans", "weight": 600},
    # the bestly.tech/agent page palette: deep ink blue, periwinkle, orchid
    "themes": {"agent": {"bg": "radial-gradient(circle at 88% 14%, #2b3180 0%, #181c4b 32%, #0e1030 64%, #0a0b22 100%)",
                         "veil": "#0e1030", "ink": "#FFFFFF", "dim": "#c7cbea", "accent": "#8e9bff", "accent2": "#e59cff", "head": "#FFFFFF"}},
    "logo": {"image": "pill.png", "height": 92, "blend": "lighten"},
    "end": {"orb": True},
    "ambient": True,
    "hlNumbers": True,
}
ASSETS = {"fonts/inter400.woff2": f"{KIT}/inter400.woff2", "fonts/inter600.woff2": f"{KIT}/inter600.woff2", "fonts/inter800.woff2": f"{KIT}/inter800.woff2",
          "pill.png": f"{KIT}/pill.png",
          "agent/mark-ellis.webp": f"{KIT_AGENT}/mark-ellis.webp", "agent/ridgeline-plumbing.svg": f"{KIT_AGENT}/ridgeline-plumbing.svg"}
VOICE = {"model": "en_US-lessac-medium", "length_scale": 1.0}  # Piper: manual switch only
# Maya's own voice: "Hope - upbeat and clear" (ElevenLabs library voice, tnSpp4vdxKPjI9w0GnoV), the voice on her agent (agent_3701m4jbjnyef6ga4ys73xtbz37s).
VOICE_11 = {"voice_id": "tnSpp4vdxKPjI9w0GnoV", "name": "Hope (Maya)", "stability": 0.45, "similarity_boost": 0.75, "style": 0.15, "speed": 1.08}
SHOT_STYLE = ("Vertical 9:16 documentary b-roll, soft natural light, dark moody backgrounds with deep blue shadows, slow gentle camera, "
              "no text, no logos, no people facing the camera, any phone or laptop only a dark silhouette.")


def _fixed(tag, log):
    ad = copy.deepcopy(ADS[tag])
    p = {"title": ad["title"], "topic": ad["topic"], "mood": ad["mood"], "caption": ad["caption"], "end": {"sub": ad["end"]["sub"], "chips": ad["end"]["chips"]},
         "scenes": [{k: sc.get(k, "") for k in ("kicker", "line", "say", "icon")} for sc in ad["scenes"]]}
    errs = _common.check(CFG, p) or _common.check_end(CFG, p)
    if errs:
        raise RuntimeError(f"the scripted ad '{tag}' failed the Bestly Agent rules: " + "; ".join(errs)[:900])
    out = _common.finish(CFG, p, THEMES[0], "hand-written", 0.0)
    for sc, src in zip(out["scenes"], ad["scenes"]):
        if src.get("card"):
            sc["card"] = src["card"]
    out["end"]["say"] = ad["end"]["say"]
    out["ad"] = tag
    log(f"scripted ad '{tag}': {len(out['scenes'])} scenes passed the rules, claim rules and number guard")
    return out


def _carry_cards(out, job):
    """A re-cut written by the free AI keeps a call card only on a scene that still has the same icon at the same place."""
    parent = _common._parent_script(job) or {}
    old = parent.get("scenes") or []
    for i, sc in enumerate(out["scenes"]):
        if i < len(old) and old[i].get("card") and old[i].get("icon") == sc.get("icon"):
            sc["card"] = old[i]["card"]


def write(job, log):
    m = re.search(r"\[ad:([a-z-]+)\]", job.get("brief") or "")
    if not job.get("parent_job_id") and m and m.group(1) in ADS:
        return _fixed(m.group(1), log)
    out = _common.write(job, log, CFG)
    _carry_cards(out, job)
    return out
