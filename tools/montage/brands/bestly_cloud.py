"""Bestly Cloud video writer for Montage. Facts are bestly_social.PRODUCT (its 'ONLY things you may say' list); claim_check
('bestly-cloud') runs when rules exist (no rules yet comes back as 'setup' and is treated as house rules only); the shared
writer and checks are in _common.py. Design: comp/brand (BrandShort) in the Bestly card kit's colors and type, real pill logo.
The closing card shows bestly.tech, the same line every Bestly card carries in its footer.
2026-10-12: scenes carry one of ICONS (drawn as motion graphics by comp/brand), scene 1 says plainly what the product is (explain_first),
and the closing card is a rich one: hero logo, one plain line, three benefit chips with icons, glowing bestly.tech button. A re-cut whose note
mentions the end card may propose the sub line and chips (claim-checked); this default is the fallback. Chips must pass _common.chip_problems (concrete, icon matches meaning).
2026-10-14 (Jared, 12:53 AM, standing note on client bestly-cloud): EVERY Bestly Cloud video shows the 3D unit (the box), "or teased a little". CFG["unit_moments"]
turns it on: variety.py picks one moment per video (reveal / turn / glimpse / hero, rotating, never the last video's), decorate puts it on a scene or the
closing card, REQUIRE_UNIT makes worker.check fail a video without it. Frames: UNIT_KIT (rendered once from the site's GLB, see unit_moment.py + unit3d/)."""
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
    "mood": "confident",   # music bed fallback when the writer gives none (music.py)
    "unit_moments": ["reveal", "turn", "glimpse", "hero"], "unit_kit": "/opt/bestly/social-kit/unit3d",   # the 3D unit rule (unit_moment.py)
    "themes": THEMES, "tail": "", "name_patterns": [r"\bbestly\b"], "icons": ICONS, "explain_first": True, "no_absolutes": True,
    "shot_brand": ("A small business at work, seen from behind or in close-up: a workshop bench, a shop counter, a studio desk, "
                   "a shelf with one small box with a softly glowing light, cables tidied. Never a readable screen or label."),
    "end_cta_say": "Learn more at Bestly dot tech.",
    # 2026-10-12 unique content: approved accents (all readable on the night ground), plain-words example for scene 1, a safe bold-count example
    "accents": ["#8b9bf0", "#f2a07b", "#6fd3c4"],
    "explain_example": "a private cloud for small businesses: one box that holds your files, calendar, chat and passwords",
    "stat_hint": 'for example "One box." or "One login."',
    "end": {"title": "Bestly Cloud", "sub": "Files, calendar, chat and passwords on one box your business owns.", "cta": "bestly.tech",
            "say": "Bestly Cloud. Files, calendar, chat and passwords on one box your business owns. Learn more at Bestly dot tech.",
            # plain, concrete, 2-4 words, each icon says what the chip says (checked by _common.chip_problems; facts: bestly_social.PRODUCT)
            "chips": [{"icon": "files", "text": "Files, calendar, chat"}, {"icon": "tag", "text": "No per-person fees"},
                      {"icon": "box", "text": "A box you own"}]},
}
END = CFG["end"]
REQUIRE_UNIT = True                                  # worker.check fails a Bestly Cloud video that has no 3D unit moment
UNIT_KIT = CFG["unit_kit"]
BRAND = {
    "fonts": [{"family": "BestlySerif", "file": "fonts/serif700.woff2", "weight": "700"},
              {"family": "BestlySerif", "file": "fonts/serif600.woff2", "weight": "600"},
              {"family": "BestlySans", "file": "fonts/inter400.woff2", "weight": "400"},
              {"family": "BestlySans", "file": "fonts/inter800.woff2", "weight": "800"},
              {"family": "BestlySans", "file": "fonts/inter600.woff2", "weight": "600"}],
    "head": {"family": "BestlySerif", "weight": 700, "sizes": [108, 96, 84], "spacing": "-0.01em"},
    # closing-card product name: modern heavy sans (Inter 800), not the serif the scene headlines use (Jared 2026-10-12)
    "end_title": {"family": "BestlySans", "weight": 800, "spacing": "-0.02em"},
    "label": {"family": "BestlySans", "weight": 600},
    "themes": {"night": {"bg": "radial-gradient(circle at 92% 62%, #232b5c 0%, #151a38 30%, #0b0c18 62%, #08080c 100%)",
                         "veil": "#0b0c18", "ink": "#FFFFFF", "dim": "#9ea6bc", "accent": "#8b9bf0", "head": "#FFFFFF"}},
    "logo": {"image": "pill.png", "height": 92, "blend": "lighten"},
    "end": {"heroLogo": True},
    "ambient": True,
}
ASSETS = {"fonts/serif700.woff2": f"{KIT}/serif700.woff2", "fonts/serif600.woff2": f"{KIT}/serif600.woff2",
          "fonts/inter400.woff2": f"{KIT}/inter400.woff2", "fonts/inter800.woff2": f"{KIT}/inter800.woff2", "fonts/inter600.woff2": f"{KIT}/inter600.woff2",
          "pill.png": f"{KIT}/pill.png"}
VOICE = {"model": "en_US-lessac-medium", "length_scale": 1.05}  # Piper: the automatic backup
VOICE_11 = {"voice_id": "cjVigY5qzO86Huf0OWal", "name": "Eric", "stability": 0.55, "similarity_boost": 0.75, "style": 0.0, "speed": 1.0}  # ElevenLabs Eric: smooth, trustworthy, plain-spoken (premade)
SHOT_STYLE = ("Vertical 9:16 documentary b-roll, soft natural light, dark moody backgrounds with deep blue shadows, slow gentle "
              "camera, calm, no text, no logos, no people facing the camera, any phone or laptop only a dark silhouette.")


def write(job, log):
    return _common.write(job, log, CFG)
