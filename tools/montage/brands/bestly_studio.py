"""Bestly Studio promo video writer for Montage (Track S, 2026-10-06). Facts are bestly_social.PRODUCT_STUDIO (its 'ONLY things
you may say' list; docs/studio-promo/claims.md is the human version); claim_check('bestly-studio') runs on every line (the
rules start unapproved: Jared reviews them in Studio > Settings > Claim rules); the shared writer and checks are in _common.py.
Same look as Bestly Cloud: comp/brand (BrandShort) in the Bestly card kit's colors and type, real pill logo. Text only
(broll false): the videos are one useful posting tip each, with Studio named only in the closing card and the caption's last
paragraph. The closing card shows bestly.tech/studio, the same line the Studio cards carry in their footer. Finished videos
land in Drafts > To review; nothing posts."""
import sys

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, "/opt/bestly/montage")
from brands import _common  # noqa: E402
from jobs import bestly_social as bs  # noqa: E402
if not hasattr(bs, "PRODUCT_STUDIO"):   # the worker may have imported an older bestly_social (via bestly_cloud) before it was updated
    import importlib
    bs = importlib.reload(bs)

KIT = "/opt/bestly/social-kit"
NAME = "Bestly Studio"
COMPOSITION, COMP_DIR = "BrandShort", "brand"
THEMES = ["night"]
ICONS = ["image", "video", "phone", "calendar", "chat", "check", "pencil", "star"]
CFG = {
    "slug": "bestly-studio", "name": NAME, "claim": "bestly-studio", "about": bs.PRODUCT_STUDIO, "lessons_brand": None,
    "mood": "upbeat",   # music bed fallback when the writer gives none (music.py)
    "themes": THEMES, "tail": "bestly.tech/studio", "name_patterns": [r"\bbestly\b"], "icons": ICONS,
    # 2026-10-12 unique content
    "accents": ["#8b9bf0", "#f2a07b", "#6fd3c4"],
    "explain_example": "a service that makes social media posts for small businesses and lets them approve each one on their phone",
    "stat_hint": 'for example "One idea." or "One post."',
    "shot_brand": ("A small business at work, seen from behind or in close-up: a workshop bench, a shop counter, a studio desk, "
                   "a shelf with one small box with a softly glowing light, cables tidied. Never a readable screen or label."),
    "end": {"title": "Bestly Studio", "sub": "We make your social posts.", "cta": "bestly.tech/studio",
            "say": "Bestly Studio. We make your social posts. You approve them from your phone. Learn more at Bestly dot tech slash studio."},
}
END = CFG["end"]
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
    "end": {},
    "ambient": True,
}
ASSETS = {"fonts/serif700.woff2": f"{KIT}/serif700.woff2", "fonts/serif600.woff2": f"{KIT}/serif600.woff2",
          "fonts/inter400.woff2": f"{KIT}/inter400.woff2", "fonts/inter800.woff2": f"{KIT}/inter800.woff2", "fonts/inter600.woff2": f"{KIT}/inter600.woff2",
          "pill.png": f"{KIT}/pill.png"}
VOICE = {"model": "en_US-lessac-medium", "length_scale": 1.05}  # Piper: the automatic backup
VOICE_11 = {"voice_id": "iP95p4xoKVk53GoZ742B", "name": "Chris", "stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "speed": 1.0}  # ElevenLabs Chris: charming, down-to-earth, conversational (premade; Eric is Bestly Cloud's)
SHOT_STYLE = ("Vertical 9:16 documentary b-roll, soft natural light, dark moody backgrounds with deep blue shadows, slow gentle "
              "camera, calm, no text, no logos, no people facing the camera, any phone or laptop only a dark silhouette.")


def write(job, log):
    return _common.write(job, log, CFG)
