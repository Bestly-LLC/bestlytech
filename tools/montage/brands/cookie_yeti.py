"""Cookie Yeti video writer for Montage. Facts and claim rules are the daily poster's (jobs/brand_maker.py BRANDS['cookieyeti'],
claim slug 'cookie-yeti'); the shared writer and checks are in _common.py. Design: comp/brand (BrandShort)."""
import sys

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, "/opt/bestly/montage")
from brands import _common  # noqa: E402
from jobs import brand_maker as bm  # noqa: E402

KIT = "/opt/bestly/montage-kit/cookie-yeti"   # fetched by tools/montage/fetch-assets.sh (the files social-render's cards use)
NAME = "Cookie Yeti"
COMPOSITION, COMP_DIR = "BrandShort", "brand"
_B = bm.BRANDS["cookieyeti"]
GROUNDS = {"plum": ("#250F37", "#3A1F5C"), "wine": ("#300D19", "#4A1A2C"), "forest": ("#07211B", "#12382D"),
           "indigo": ("#0D142C", "#182450"), "ink": ("#151221", "#221C33"), "teal": ("#061F26", "#0F3A46")}
THEMES = list(GROUNDS)
CFG = {
    "slug": "cookie-yeti", "name": NAME, "claim": _B["claim"], "about": _B["about"], "lessons_brand": "cookieyeti",
    "themes": THEMES, "tail": _B["hashtags"], "name_patterns": [r"cookie\s*yeti", r"\byeti\b"],
    "shot_brand": ("Real-world stand-ins only: a quiet desk and a closed laptop, a hand closing a door, a window at dusk, "
                   "fog over a hillside, a mailbox. Never a browser, banner, cookie, button or anything on a screen."),
    "end": {"title": "Cookie Yeti", "sub": "Answers cookie banners for you.", "cta": "On the App Store.",
            "say": "Cookie Yeti. It answers cookie banners for you. On the App Store."},
}
END = CFG["end"]
BRAND = {
    "fonts": [{"family": "InterTight", "file": f"fonts/InterTight-{w}.ttf", "weight": str(w)} for w in (500, 600, 700, 800)],
    "head": {"family": "InterTight", "weight": 800, "sizes": [104, 92, 80], "spacing": "-0.02em"},
    "label": {"family": "InterTight", "weight": 600},
    "themes": {n: {"bg": f"linear-gradient(180deg, {a} 0%, {c} 100%)", "veil": a, "ink": "#FFFFFF", "dim": "#B9B4C8",
                   "accent": "#4FE0C4", "head": "#FFFFFF"} for n, (a, c) in GROUNDS.items()},
    "logo": {"wordmark": {"parts": [{"text": "Cookie Yeti"}], "family": "InterTight", "weight": 600, "size": 44,
                          "tagline": "PRIVACY · AUTOMATIC"}},
    "end": {"image": "art/cookieyeti-icon.png", "imageHeight": 420, "imageRadius": 94, "handle": "@cookie_yeti_privacy"},
}
ASSETS = {**{f"fonts/InterTight-{w}.ttf": f"{KIT}/fonts/InterTight-{w}.ttf" for w in (500, 600, 700, 800)},
          "art/cookieyeti-icon.png": f"{KIT}/art/cookieyeti-icon.png"}
VOICE = {"model": "en_US-lessac-medium", "length_scale": 1.05}
SHOT_STYLE = ("Vertical 9:16 documentary b-roll, cool dusk light, deep teal and plum shadows, soft background, slow gentle "
              "camera, calm, no text, no logos, no people facing the camera, any phone or laptop only a dark silhouette.")


def write(job, log):
    return _common.write(job, log, CFG)
