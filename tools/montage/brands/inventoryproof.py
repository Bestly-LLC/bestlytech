"""InventoryProof video writer for Montage. Facts and claim rules are the daily poster's (jobs/brand_maker.py BRANDS['inventoryproof'],
claim slug 'inventoryproof'); the shared writer and checks are in _common.py. Design: comp/brand (BrandShort).
Closing card uses Proofy (the real 'cheering-arms-up' pose file the cards use)."""
import sys

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, "/opt/bestly/montage")
from brands import _common  # noqa: E402
from jobs import brand_maker as bm  # noqa: E402

KIT = "/opt/bestly/montage-kit/inventoryproof"
NAME = "InventoryProof"
COMPOSITION, COMP_DIR = "BrandShort", "brand"
_B = bm.BRANDS["inventoryproof"]
# ground colors and accent colors are the card system's (social-render layout.ts); each ground gets one accent
GROUNDS = {"navy": (("#0D1424", "#16213E"), "#6F9BFF"), "green": (("#061F16", "#10382A"), "#4FDC94"),
           "purple": (("#1F0E2D", "#33204E"), "#CDA6FF"), "wine": (("#300B10", "#4A1A1E"), "#F2A33A"),
           "slate": (("#161E2E", "#202B40"), "#6F9BFF"), "ocean": (("#121D49", "#1C2E6E"), "#F2A33A")}
THEMES = list(GROUNDS)
CFG = {
    "slug": "inventoryproof", "name": NAME, "claim": _B["claim"], "about": _B["about"], "lessons_brand": "inventoryproof",
    "themes": THEMES, "tail": _B["hashtags"], "name_patterns": [r"inventory\s*proof", r"\bproofy\b"],
    "shot_brand": ("Real homes and things people own: a hand opening a drawer, a shelf of books, a closet, a kitchen counter, "
                   "a box being taped shut, a living room at golden hour. Never a legible receipt, document or label."),
    "end": {"title": "InventoryProof", "sub": "A home inventory app for iPhone.", "cta": "On the App Store.",
            "say": "InventoryProof. A home inventory app for iPhone. On the App Store."},
}
END = CFG["end"]
BRAND = {
    "fonts": [{"family": "Manrope", "file": f"fonts/Manrope-{w}.ttf", "weight": str(w)} for w in (500, 600, 700, 800)],
    "head": {"family": "Manrope", "weight": 700, "sizes": [112, 98, 84], "spacing": "-0.02em"},
    "label": {"family": "Manrope", "weight": 700},
    "themes": {n: {"bg": f"linear-gradient(180deg, {a} 0%, {c} 100%)", "veil": a, "ink": "#FFFFFF", "dim": "#AEB6C8",
                   "accent": acc, "head": acc} for n, ((a, c), acc) in GROUNDS.items()},
    "logo": {"wordmark": {"parts": [{"text": "Inventory"}, {"text": "Proof", "color": "#F2A33A"},
                                    {"text": "°", "color": "#F2A33A", "size": 22, "dy": -10}],
                          "family": "Manrope", "weight": 700, "size": 52}},
    "end": {"image": "art/proofy-cheering-arms-up.png", "imageHeight": 520, "handle": "@inventoryproof"},
}
ASSETS = {**{f"fonts/Manrope-{w}.ttf": f"{KIT}/fonts/Manrope-{w}.ttf" for w in (500, 600, 700, 800)},
          "art/proofy-cheering-arms-up.png": f"{KIT}/art/proofy-cheering-arms-up.png"}
VOICE = {"model": "en_US-hfc_female-medium", "length_scale": 1.05}  # Piper: the automatic backup
VOICE_11 = {"voice_id": "XrExE9yKIg1WjnnlVkGX", "name": "Matilda", "stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "speed": 1.0}  # ElevenLabs Matilda: clear, upbeat, professional (premade)
SHOT_STYLE = ("Vertical 9:16 documentary b-roll, warm natural light, soft background, gentle handheld camera, calm, "
              "muted colors, no text, no logos, no people facing the camera, any phone only a dark silhouette.")


def write(job, log):
    return _common.write(job, log, CFG)
