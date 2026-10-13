"""Bestly Cloud video writer for Montage. Facts are bestly_social.PRODUCT (its 'ONLY things you may say' list); claim_check
('bestly-cloud') runs when rules exist (no rules yet comes back as 'setup' and is treated as house rules only); the shared
writer and checks are in _common.py. Design: comp/brand (BrandShort) in the Bestly card kit's colors and type, real pill logo.
The closing card shows bestly.tech, the same line every Bestly card carries in its footer.
2026-10-12: scenes carry one of ICONS (drawn as motion graphics by comp/brand), scene 1 says plainly what the product is (explain_first),
and the closing card is a rich one: hero logo, one plain line, three benefit chips with icons, glowing bestly.tech button. A re-cut whose note
mentions the end card may propose the sub line and chips (claim-checked); this default is the fallback."""
import sys

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, "/opt/bestly/montage")
from brands import _common  # noqa: E402
from jobs import bestly_social as bs  # noqa: E402

KIT = "/opt/bestly/social-kit"
NAME = "Bestly Cloud"
COMPOSITION, COMP_DIR = "BrandShort", "brand"
THEMES = ["night"]
ICONS = ["files", "lock", "box", "people", "calendar", "chat", "key", "check", "tag", "eyeslash"]
CFG = {
    "slug": "bestly-cloud", "name": NAME, "claim": "bestly-cloud", "about": bs.PRODUCT, "lessons_brand": None,
    "themes": THEMES, "tail": "", "name_patterns": [r"\bbestly\b"], "icons": ICONS, "explain_first": True, "no_absolutes": True,
    "shot_brand": ("A small business at work, seen from behind or in close-up: a workshop bench, a shop counter, a studio desk, "
                   "a shelf with one small box with a softly glowing light, cables tidied. Never a readable screen or label."),
    "end_cta_say": "Learn more at Bestly dot tech.",
    "end": {"title": "Bestly Cloud", "sub": "Files, calendar, chat and passwords on one box your business owns.", "cta": "bestly.tech",
            "say": "Bestly Cloud. Files, calendar, chat and passwords on one box your business owns. Learn more at Bestly dot tech.",
            "chips": [{"icon": "box", "text": "You own the box"}, {"icon": "tag", "text": "No per-seat fees"},
                      {"icon": "people", "text": "We can run it for you"}]},
}
END = CFG["end"]
BRAND = {
    "fonts": [{"family": "BestlySerif", "file": "fonts/serif700.woff2", "weight": "700"},
              {"family": "BestlySerif", "file": "fonts/serif600.woff2", "weight": "600"},
              {"family": "BestlySans", "file": "fonts/inter400.woff2", "weight": "400"},
              {"family": "BestlySans", "file": "fonts/inter600.woff2", "weight": "600"}],
    "head": {"family": "BestlySerif", "weight": 700, "sizes": [108, 96, 84], "spacing": "-0.01em"},
    "label": {"family": "BestlySans", "weight": 600},
    "themes": {"night": {"bg": "radial-gradient(circle at 92% 62%, #232b5c 0%, #151a38 30%, #0b0c18 62%, #08080c 100%)",
                         "veil": "#0b0c18", "ink": "#FFFFFF", "dim": "#9ea6bc", "accent": "#8b9bf0", "head": "#FFFFFF"}},
    "logo": {"image": "pill.png", "height": 92, "blend": "lighten"},
    "end": {"heroLogo": True},
    "ambient": True,
}
ASSETS = {"fonts/serif700.woff2": f"{KIT}/serif700.woff2", "fonts/serif600.woff2": f"{KIT}/serif600.woff2",
          "fonts/inter400.woff2": f"{KIT}/inter400.woff2", "fonts/inter600.woff2": f"{KIT}/inter600.woff2",
          "pill.png": f"{KIT}/pill.png"}
VOICE = {"model": "en_US-lessac-medium", "length_scale": 1.05}  # Piper: the automatic backup
VOICE_11 = {"voice_id": "cjVigY5qzO86Huf0OWal", "name": "Eric", "stability": 0.55, "similarity_boost": 0.75, "style": 0.0, "speed": 1.0}  # ElevenLabs Eric: smooth, trustworthy, plain-spoken (premade)
SHOT_STYLE = ("Vertical 9:16 documentary b-roll, soft natural light, dark moody backgrounds with deep blue shadows, slow gentle "
              "camera, calm, no text, no logos, no people facing the camera, any phone or laptop only a dark silhouette.")


def write(job, log):
    return _common.write(job, log, CFG)
