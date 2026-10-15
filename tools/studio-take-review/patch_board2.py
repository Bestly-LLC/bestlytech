"""YouTube name on her board (board.html). Exact-once patch on the live file.
Usage: python3 patch_board2.py board.live.html board.new.html
Platform names fell back to the raw key ("youtube"): added YouTube to ACCT_WORDS (connect card, settings,
"Connect YouTube" button, "signed you out" line), PWORD (platform pills, "Posted on ...") and PLATNAME (caption blocks).
Pinterest was missing from PWORD the same way, added. Keys, ids and URLs are untouched.
(Spark, 2026-10-15)"""
import sys
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:90]!r}"
    src = src.replace(old, new)

rep("""const PWORD = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn" };""",
    """const PWORD = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn", pinterest: "Pinterest", youtube: "YouTube" };""")
rep("""const PLATNAME = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook" };""",
    """const PLATNAME = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn", pinterest: "Pinterest", youtube: "YouTube" };""")
rep("""  pinterest: { name: "Pinterest", why: "Your posts also show up as Pins, so people searching Pinterest can find you.", soon: "Coming soon. We'll let you know here when it's ready." },
};""", """  pinterest: { name: "Pinterest", why: "Your posts also show up as Pins, so people searching Pinterest can find you.", soon: "Coming soon. We'll let you know here when it's ready." },
  youtube:   { name: "YouTube", why: "Your approved videos also post to your YouTube channel as Shorts, so people searching YouTube can find you.", soon: "Coming soon. We'll let you know here when it's ready." },
};""")
open(sys.argv[2], "w", encoding="utf-8").write(src)
print("board patched", len(src))
