# -*- coding: utf-8 -*-
import base64, os, re, urllib.request, json

ROOT   = "/Users/jared/Developer/bestlytech"
ASSETS = ROOT + "/src/assets"
OUT    = ROOT + "/marketing/store-banners"
BUILD  = OUT + "/_build"
os.makedirs(BUILD, exist_ok=True)

def b64file(p):
    with open(p, "rb") as f:
        return base64.b64encode(f.read()).decode()

IMG = {
    "icon":     "data:image/png;base64," + b64file(ASSETS + "/cookieyeti-icon.png"),
    "insights": "data:image/png;base64," + b64file(ASSETS + "/cy-panel-insights-real.png"),
    "control":  "data:image/png;base64," + b64file(ASSETS + "/cy-panel-control-real.png"),
}

# ---- Fonts: fetch Google Fonts CSS2, keep latin subset only, embed as base64 ----
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=60).read()

CSS_URL = ("https://fonts.googleapis.com/css2?"
           "family=Fredoka:wght@500;600;700&"
           "family=Nunito:wght@400;500;600;700;800&display=swap")

def build_font_css():
    css = fetch(CSS_URL).decode()
    blocks = re.split(r"(?=@font-face)", css)
    out = []
    for b in blocks:
        if "@font-face" not in b:
            continue
        ur = re.search(r"unicode-range:\s*([^;]+);", b)
        if ur and "U+0000" not in ur.group(1):
            continue  # keep latin subset only
        fam = re.search(r"font-family:\s*'([^']+)'", b).group(1)
        wgt = re.search(r"font-weight:\s*(\d+)", b).group(1)
        url = re.search(r"url\((https://[^)]+\.woff2)\)", b).group(1)
        data = base64.b64encode(fetch(url)).decode()
        out.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:%s;"
            "font-display:block;src:url(data:font/woff2;base64,%s) format('woff2');}"
            % (fam, wgt, data))
    return "\n".join(out)

print("Fetching fonts...")
FONT_CSS = build_font_css()
print("Font CSS bytes:", len(FONT_CSS))

# ---------------- Lucide-style inline SVG icons ----------------
def svg(paths, sw=2.1):
    return ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="%s" stroke-linecap="round" stroke-linejoin="round">%s</svg>'
            % (sw, paths))

ICONS = {
 "sparkles": svg('<path d="M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0L14.1 8.5A2 2 0 0 0 15.5 9.9l6.1 1.6a.5.5 0 0 1 0 1L15.5 14.1a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>'),
 "ban": svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
 "shield": svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'),
 "lock": svg('<rect width="18" height="11" x="3" y="11" rx="2.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
 "monitor": svg('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>'),
 "phone": svg('<rect width="14" height="20" x="5" y="2" rx="2.5"/><path d="M12 18h.01"/>'),
 "check": svg('<path d="M20 6 9 17l-5-5"/>'),
}

# ---------------- Banner definitions ----------------
BANNERS = [
 dict(n="01", slug="self-learning", panel="insights", icon="sparkles",
      badge="Self-learning AI", a="#12b6d6", g="#1fcbe8", g2="#15a086",
      head='The only cookie blocker that <em>teaches itself.</em>',
      sub='When a pop-up is tricky, our AI learns to beat it &mdash; and every user gets the fix. No updates. It just keeps getting smarter.'),
 dict(n="02", slug="true-reject", panel="control", icon="ban",
      badge="True reject", a="#1f9e63", g="#2bb673", g2="#15a086",
      head='It says no. <em>Not &lsquo;Accept all.&rsquo;</em>',
      sub='Other blockers just hide the box. Cookie Yeti actually rejects tracking &mdash; the most private choice, every time.'),
 dict(n="03", slug="never-breaks", panel="insights", icon="shield",
      badge="Safety brake", a="#0c7a6e", g="#15a086", g2="#2bb673",
      head='Clears cookie walls &mdash; <em>without breaking your sites.</em>',
      sub='A built-in safety brake backs off before anything breaks. The #1 complaint about other blockers, solved.'),
 dict(n="04", slug="cross-platform", panel="control", icon="devices",
      badge="Everywhere you browse", a="#0c7a6e", g="#15a086", g2="#1fcbe8",
      head='One app. <em>Chrome, iPhone &amp; iPad.</em>',
      sub='Most cookie blockers work in just one place. Cookie Yeti follows you everywhere. (Mac coming soon.)'),
 dict(n="05", slug="private-by-design", panel="insights", icon="lock",
      badge="Private by design", a="#1f9e63", g="#2bb673", g2="#15a086",
      head='Your data is <em>never sold or shared.</em>',
      sub='No ads. No profiles. We never sell you to advertisers &mdash; unlike the blockers that got bought out.'),
]

DEVICES_SVG = ('<span class="dev">%s</span><span class="dev">%s</span>'
               % (ICONS["monitor"], ICONS["phone"]))

def hexrgba(h, a):
    h = h.lstrip("#")
    r, g, b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
    return "rgba(%d,%d,%d,%s)" % (r, g, b, a)

TPL = r"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>
@@FONTS@@
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:@@W@@px;height:@@H@@px}
body{position:relative;overflow:hidden;font-family:'Nunito',sans-serif;
 -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;
 background:
  radial-gradient(60% 55% at 80% 16%, @@GLOW1@@, transparent 62%),
  radial-gradient(55% 60% at 8% 98%, @@GLOW2@@, transparent 60%),
  linear-gradient(158deg,#f4fbf8 0%,#e8f6f0 52%,#dcf1e9 100%);}
.stage{position:absolute;inset:0;overflow:hidden}
.blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55}
.b1{width:38%;aspect-ratio:1;background:@@A@@;top:-8%;right:-6%;opacity:.16}
.b2{width:34%;aspect-ratio:1;background:@@G2@@;bottom:-10%;left:-8%;opacity:.14}
.grain{position:absolute;inset:0;opacity:.5;background-image:radial-gradient(@@DOT@@ 1px,transparent 1px);background-size:26px 26px;
 -webkit-mask-image:linear-gradient(180deg,transparent,#000 40%,#000 70%,transparent)}
.brand{position:absolute;display:flex;align-items:center;gap:.5em;z-index:6}
.brand img{display:block}
.brand span{font-family:'Fredoka';font-weight:600;color:#0b1526;letter-spacing:-.01em}
.cols{position:absolute;inset:0;display:flex;z-index:4}
.badge{display:inline-flex;align-items:center;gap:.5em;background:rgba(255,255,255,.86);
 border:1px solid rgba(11,21,38,.06);color:@@A@@;font-family:'Fredoka';font-weight:600;
 border-radius:999px;box-shadow:0 8px 22px rgba(11,21,38,.07);width:fit-content}
.badge svg{width:1.15em;height:1.15em}
.head{font-family:'Fredoka';font-weight:700;color:#0b1526;line-height:1.03;letter-spacing:-.02em}
.head em{font-style:normal;color:@@A@@}
.sub{font-family:'Nunito';font-weight:600;color:#3a5763;line-height:1.42}
.avail{display:flex;flex-wrap:wrap;gap:.55em}
.pill{display:inline-flex;align-items:center;gap:.4em;background:rgba(255,255,255,.72);
 border:1px solid rgba(11,21,38,.07);color:#20424e;font-weight:700;border-radius:999px}
.pill svg{width:1.05em;height:1.05em;color:@@A@@}
.pill.soon{opacity:.62}
.visual{position:relative;display:flex;align-items:center;justify-content:center}
.glowring{position:absolute;width:78%;aspect-ratio:1;border-radius:50%;
 background:radial-gradient(circle,@@RING@@,transparent 66%);filter:blur(6px)}
.panel-card{position:relative;border-radius:6.2%/4%;overflow:hidden;background:#fff;
 border:1px solid rgba(11,21,38,.08);
 box-shadow:0 2px 6px rgba(11,21,38,.06),0 30px 70px -18px rgba(11,21,38,.34),0 60px 120px -40px @@SHAD@@}
.panel-card img{display:block;width:100%;height:100%;object-fit:cover}
.mascot{position:absolute;filter:drop-shadow(0 18px 30px rgba(11,21,38,.28));z-index:5}
.devrow{position:absolute;display:flex;gap:.55em;z-index:6}
.devrow .dev{display:grid;place-items:center;background:#fff;color:@@A@@;border-radius:24%;
 border:1px solid rgba(11,21,38,.07);box-shadow:0 12px 26px rgba(11,21,38,.14)}
.devrow .dev svg{width:58%;height:58%}

/* ================= LANDSCAPE ================= */
body.land .brand{top:5.6vh;left:5vh;gap:.55em}
body.land .brand img{width:6.4vh;height:6.4vh}
body.land .brand span{font-size:3.3vh}
body.land .cols{padding:0 5vh}
body.land .left{width:47%;height:100%;display:flex;flex-direction:column;justify-content:center;padding-right:2vh}
body.land .badge{font-size:2.35vh;padding:.55em 1.05em;margin-bottom:2.6vh}
body.land .head{font-size:6.7vh;max-width:16em}
body.land .sub{font-size:2.75vh;margin-top:2.4vh;max-width:19em}
body.land .avail{margin-top:4vh}
body.land .pill{font-size:2vh;padding:.5em 1em}
body.land .right{width:53%;height:100%}
body.land .visual{width:100%;height:100%}
body.land .glowring{width:70%}
body.land .panel-card{height:74%;aspect-ratio:840/1320}
body.land .mascot{width:20vh;bottom:6vh;left:6vh}
body.land .devrow{flex-direction:column;top:12vh;right:8vh}
body.land .devrow .dev{width:9vh;height:9vh}

/* ================= PORTRAIT ================= */
body.port .stage{display:flex;flex-direction:column;padding:7vw 7vw 5.5vw}
body.port .cols{position:static;flex-direction:column;flex:1;padding:0}
body.port .brand{position:static;margin-bottom:5.2vw;gap:.5em}
body.port .brand img{width:7.2vw;height:7.2vw}
body.port .brand span{font-size:4.3vw}
body.port .left{width:100%;display:flex;flex-direction:column}
body.port .badge{font-size:3.2vw;padding:.55em 1.15em;margin-bottom:3.6vw}
body.port .head{font-size:8vw;max-width:14em}
body.port .sub{font-size:3.55vw;margin-top:3.4vw;max-width:26em}
body.port .avail{margin-top:4.4vw}
body.port .pill{font-size:2.9vw;padding:.5em 1.05em}
body.port .right{flex:1;width:100%;min-height:0}
body.port .visual{width:100%;height:100%;padding-top:3vw}
body.port .glowring{width:96%}
body.port .panel-card{height:96%;max-width:82%;aspect-ratio:840/1320}
body.port .mascot{width:26vw;bottom:-2vw;left:4vw}
body.port .devrow{flex-direction:row;bottom:3vw;right:5vw}
body.port .devrow .dev{width:13vw;height:13vw}
</style></head>
<body class="@@ORIENT@@">
 <div class="stage">
  <div class="blob b1"></div><div class="blob b2"></div><div class="grain"></div>
  <div class="brand"><img src="@@ICONIMG@@" alt=""><span>Cookie Yeti</span></div>
  <div class="cols">
   <div class="left">
    <div class="badge">@@ICON@@<span>@@BADGE@@</span></div>
    <h1 class="head">@@HEAD@@</h1>
    <p class="sub">@@SUB@@</p>
    <div class="avail">
     <span class="pill">@@CK@@Chrome</span>
     <span class="pill">@@CK@@iPhone</span>
     <span class="pill">@@CK@@iPad</span>
     <span class="pill soon">Mac soon</span>
    </div>
   </div>
   <div class="right">
    <div class="visual">
     <div class="glowring"></div>
     <div class="panel-card"><img src="@@PANEL@@" alt="Cookie Yeti app"></div>
     @@DEVROW@@
     <img class="mascot" src="@@ICONIMG@@" alt="">
    </div>
   </div>
  </div>
 </div>
</body></html>"""

SIZES = [
 ("chrome", 1280, 800,  "land"),
 ("iphone", 1290, 2796, "port"),
 ("ipad",   2048, 2732, "port"),
 ("mac",    2880, 1800, "land"),
]

def render_html(b, W, H, orient):
    devrow = ('<div class="devrow">%s</div>' % DEVICES_SVG) if b["slug"] == "cross-platform" else ""
    s = TPL
    reps = {
     "@@FONTS@@": FONT_CSS,
     "@@W@@": str(W), "@@H@@": str(H), "@@ORIENT@@": orient,
     "@@A@@": b["a"], "@@G2@@": b["g2"],
     "@@GLOW1@@": hexrgba(b["g"], 0.30),
     "@@GLOW2@@": hexrgba(b["g2"], 0.18),
     "@@RING@@": hexrgba(b["g"], 0.34),
     "@@SHAD@@": hexrgba(b["g2"], 0.30),
     "@@DOT@@": hexrgba("#0b1526", 0.06),
     "@@ICON@@": ICONS[b["icon"]] if b["icon"] in ICONS else "",
     "@@CK@@": ICONS["check"],
     "@@BADGE@@": b["badge"], "@@HEAD@@": b["head"], "@@SUB@@": b["sub"],
     "@@ICONIMG@@": IMG["icon"], "@@PANEL@@": IMG[b["panel"]],
     "@@DEVROW@@": devrow,
    }
    for k, v in reps.items():
        s = s.replace(k, v)
    return s

manifest = []
for b in BANNERS:
    for plat, W, H, orient in SIZES:
        name = "%s-%s" % (b["n"], b["slug"])
        html_path = "%s/%s-%s.html" % (BUILD, plat, name)
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(render_html(b, W, H, orient))
        out_png = "%s/%s/%s.png" % (OUT, plat, name)
        manifest.append(dict(plat=plat, name=name, html=html_path,
                             png=out_png, W=W, H=H))

with open(BUILD + "/manifest.json", "w") as f:
    json.dump(manifest, f, indent=1)
print("Wrote", len(manifest), "HTML files + manifest.json")
