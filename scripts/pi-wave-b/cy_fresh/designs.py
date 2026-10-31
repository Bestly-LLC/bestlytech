#!/usr/bin/env python3
"""designs.py - weekly fresh design space for Centering YOU corner graphics and name cards.

Free, local, deterministic (stdlib + numpy + pillow). No Claude, no paid AI.
  pick_batch(week, client, n, history)  -> new parameter sets for the week (seeded by ISO week)
  fingerprint(component, params)        -> hash of NORMALISED parameters (never pixels); mirrors SQL studio_design_fingerprint
  render_corner(params, side)           -> (RGBA, x, y, meta) placed so it touches the top and side edge, nothing below y 353
  render_tag(params)                    -> (RGBA name card, meta) all spacing through px(), above y 1480
  corner_xf / tag_xf                    -> motion and entrance used by render.py
Rules baked in: the Centering YOU deck is ALWAYS in the corner; feathered soft edges; no emoji; numbers stay with units.
"""
import os, math, random, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

W, H = 1080, 1920
HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIRS = [d for d in (os.environ.get('FRESH_FONTS'), os.path.join(HERE, 'assets', 'fonts'), os.path.join(HERE, 'fonts'),
             '/opt/bestly/cy-kit/fonts', os.path.join(os.environ.get('RENDER_KIT', ''), 'assets', 'fonts')) if d]
ART_DIRS = [d for d in (os.environ.get('FRESH_ART'), os.path.join(HERE, 'assets'), '/opt/bestly/cy-kit/art') if d]

# ---- brand palette (client_brand.theme.palette, the documented eight) ----
PAL = {'ink': '#2A6566', 'gold': '#F4C459', 'coral': '#D44934', 'cream': '#EFE4D6',
       'shell': '#EFCAB6', 'teal2': '#489597', 'orange': '#EF8F55', 'sun': '#EDD65B'}
def rgb(n): h = PAL[n].lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def lum(c):
    f = lambda v: (v / 255 / 12.92) if v / 255 <= 0.03928 else ((v / 255 + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
def contrast(a, b):
    la, lb = sorted((lum(rgb(a)), lum(rgb(b))), reverse=True); return (la + 0.05) / (lb + 0.05)

FP_KEYS = ('family', 'palette', 'shape', 'motion', 'layout', 'type')
def norm(v): return str(v or '').strip().lower()
def fingerprint(component, params):
    s = '|'.join([norm(component)] + [norm(params.get(k)) for k in FP_KEYS])
    return hashlib.sha256(s.encode('utf-8')).hexdigest()[:16]

# ------------------------------------------------------------------ design space
CORNER_SHAPES = {'circle': 'disc', 'scallop': 'disc', 'arch': 'arch', 'pill_v': 'arch',
                 'rounded_square': 'block', 'hex': 'block', 'leaf': 'organic', 'blob': 'organic'}
CORNER_PALETTES = ['ink-sun', 'ink-gold', 'ink-orange', 'ink-shell', 'teal2-cream', 'teal2-gold', 'teal2-shell',
                   'coral-cream', 'coral-shell', 'coral-sun', 'gold-ink', 'gold-coral', 'gold-teal2', 'orange-cream',
                   'orange-ink', 'shell-coral', 'shell-ink', 'shell-teal2', 'sun-ink', 'sun-coral']
CORNER_MOTIONS = ['float', 'drift', 'fade', 'none']
CORNER_LAYOUTS = ['tilted', 'straight']
CORNER_DECOS = ['ring', 'dots', 'speckle', 'none']

TAG_FAMILY_SHAPES = {'pill': ['pill'], 'strip': ['bar', 'bar-notch'], 'tab': ['tab', 'tab-slant'],
                     'stacked': ['rounded', 'arch-top'], 'ribbon': ['notch', 'flag'],
                     'underline': ['scrim'], 'badge': ['circle', 'hex']}
TAG_ARRANGE = {'pill': ['one-line'], 'strip': ['split', 'one-line'], 'tab': ['one-line', 'split'],
               'stacked': ['stacked'], 'ribbon': ['one-line', 'split'], 'underline': ['stacked', 'one-line'],
               'badge': ['one-line']}
TAG_ACCENTS = ['dots', 'bar', 'rule', 'dash', 'none']
TAG_TYPES = {'lg-lora': ('LeagueGothic-Regular.ttf', 'Lora-400.ttf'), 'lg-clearsans': ('LeagueGothic-Regular.ttf', 'ClearSans-Medium.ttf'),
             'bodoni-clearsans': ('BodoniModa-400.ttf', 'ClearSans-Medium.ttf'), 'lora-clearsans': ('Lora-400.ttf', 'ClearSans-Medium.ttf'),
             'clearsansbold-lora': ('ClearSans-Bold.ttf', 'Lora-400.ttf'), 'garamond-clearsans': ('EBGaramond-600.ttf', 'ClearSans-Medium.ttf')}
NAME_SIZE = {'LeagueGothic-Regular.ttf': 60, 'BodoniModa-400.ttf': 50, 'Lora-400.ttf': 46, 'ClearSans-Bold.ttf': 44, 'EBGaramond-600.ttf': 56}
TAG_MOTIONS = ['fade', 'slide-up', 'slide-left', 'slide-right', 'wipe', 'drop']
# palette name -> (plate, name ink, sub ink, accent)
TAG_PALETTES = {
    'cream-teal': ('cream', 'ink', 'coral', 'gold'), 'cream-coral': ('cream', 'coral', 'ink', 'teal2'),
    'cream-gold': ('cream', 'ink', 'ink', 'gold'), 'ink-cream': ('ink', 'cream', 'gold', 'coral'),
    'ink-gold': ('ink', 'gold', 'shell', 'orange'), 'ink-shell': ('ink', 'shell', 'sun', 'teal2'),
    'coral-cream': ('coral', 'cream', 'cream', 'gold'), 'gold-ink': ('gold', 'ink', 'ink', 'coral'),
    'shell-ink': ('shell', 'ink', 'ink', 'teal2'), 'shell-coral': ('shell', 'ink', 'ink', 'coral'),
    'sun-ink': ('sun', 'ink', 'ink', 'coral'), 'cream-orange': ('cream', 'ink', 'coral', 'orange')}
for _n, (_p, _a, _b, _c) in TAG_PALETTES.items():       # every colourway must stay legible (large-text 3:1)
    assert contrast(_p, _a) >= 3.0 and contrast(_p, _b) >= 3.0, _n

NAME, CRED, URL = 'Elizabeth O’Brien', 'LPC, PMH-C', 'centeringyou.com'

def font(name, size):
    for d in FONT_DIRS:
        p = os.path.join(d, name)
        if os.path.exists(p): return ImageFont.truetype(p, int(size))
    raise FileNotFoundError(name)

def draw_corner_params(r):
    shape = r.choice(sorted(CORNER_SHAPES))
    return {'family': CORNER_SHAPES[shape], 'shape': shape, 'palette': r.choice(CORNER_PALETTES), 'motion': r.choice(CORNER_MOTIONS),
            'layout': r.choice(CORNER_LAYOUTS), 'type': r.choice(CORNER_DECOS),
            'side': r.choice('LR'), 'tilt': round(r.choice((-1, 1)) * r.uniform(4.0, 9.0), 1), 'seed': r.randrange(1 << 30)}

def draw_tag_params(r):
    fam = r.choice(sorted(TAG_FAMILY_SHAPES))
    pal = r.choice(sorted(TAG_PALETTES)); arr = r.choice(TAG_ARRANGE[fam]); acc = r.choice(TAG_ACCENTS)
    return {'family': fam, 'shape': r.choice(TAG_FAMILY_SHAPES[fam]), 'palette': pal, 'motion': r.choice(TAG_MOTIONS),
            'layout': arr + '+' + acc, 'type': r.choice(sorted(TAG_TYPES))}

def stale_local(history, component, p, week_idx, cooldown, family_cooldown=2):
    """history: (component, fingerprint, family, palette, week_index); same rules as SQL studio_design_stale_reason:
    1 family first (2026-10-12): a style family rests family_cooldown weeks before ANY design of it is drawn again
    2 the same fingerprint inside cooldown; 3 same family + palette inside cooldown.
    (2026-10-31: rule 1 was missing here, so the Pi drew a family the database then refused with P0001.)"""
    fp = fingerprint(component, p)
    for c, f, fam, pal, wi in history:
        if c != component: continue
        if fam == p['family'] and (week_idx - family_cooldown <= wi < week_idx): return True
        if not (week_idx - cooldown <= wi < week_idx): continue
        if f == fp or (fam == p['family'] and pal == p['palette']): return True
    return False

def week_index(week):  # '2026-W42' -> ISO-week counter
    import datetime
    y, w = int(week[:4]), int(week[6:8])
    return (datetime.date.fromisocalendar(y, w, 1) - datetime.date(2000, 1, 3)).days // 7

def pick_batch(week, client, n=4, history=(), cooldown=6, family_cooldown=2):
    """Per week: n new corner graphics and n new name cards. Seeded by (client, ISO week): a rerun is identical."""
    out = {}; wi = week_index(week)
    for comp, draw in (('corner_graphic', draw_corner_params), ('name_tag', draw_tag_params)):
        r = random.Random(int(hashlib.sha256(f'{client}|{week}|{comp}'.encode()).hexdigest()[:12], 16))
        # families this component can still use this week (the family rest leaves few when the space is small:
        # corner graphics have 4 families, so the in-batch "3 distinct families" rule bends to what is free)
        space = sorted(set(CORNER_SHAPES.values())) if comp == 'corner_graphic' else sorted(TAG_FAMILY_SHAPES)
        resting = {fam for c, f, fam, pal, w in history if c == comp and wi - family_cooldown <= w < wi}
        free_fams = [f for f in space if f not in resting]
        want_distinct = min(3, len(free_fams))
        got, tries = [], 0
        while len(got) < n and tries < 4000:
            tries += 1
            p = draw(r)
            if stale_local(history, comp, p, wi, cooldown, family_cooldown): continue
            # inside the batch: distinct palette, spread of families and motions
            if any((q['family'], q['palette']) == (p['family'], p['palette']) or q['palette'] == p['palette'] for q in got): continue
            if len(got) < want_distinct and any(q['family'] == p['family'] for q in got): continue
            if len(got) < 3 and any(q['motion'] == p['motion'] for q in got): continue
            if comp == 'name_tag' and len(got) < 3 and any(q['type'] == p['type'] for q in got): continue
            got.append(p)
        if len(got) < n: raise RuntimeError(f'{comp}: could only draw {len(got)} of {n} fresh designs')
        out[comp] = [dict(p, fingerprint=fingerprint(comp, p)) for p in got]
    return out

# ------------------------------------------------------------------ the deck on its own
_DECK = None
def deck_cutout(card_png=None):
    """the Centering YOU deck photo with its cream backdrop removed (flood from the border, feathered matte)"""
    global _DECK
    if _DECK is not None and not card_png: return _DECK.copy()
    src = None
    for d in ART_DIRS:
        for nme in ('deck-shot.png', 'deck-shot-centering-you.png'):
            if os.path.exists(os.path.join(d, nme)): src = os.path.join(d, nme)
    if not src: raise FileNotFoundError('deck-shot.png (deck photo) not found in ' + ', '.join(ART_DIRS))
    im = Image.open(src).convert('RGB'); a = np.asarray(im).astype(np.float32)
    bg = np.median(np.concatenate([a[0:6, :, :].reshape(-1, 3), a[:, 0:6, :].reshape(-1, 3), a[:, -6:, :].reshape(-1, 3)]), axis=0)
    cand = np.sqrt(((a - bg) ** 2).sum(2)) < 26
    from collections import deque
    h, w = cand.shape; seen = np.zeros_like(cand); q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < h and 0 <= xx < w and cand[yy, xx] and not seen[yy, xx]: seen[yy, xx] = True; q.append((yy, xx))
    m = Image.fromarray(np.where(seen, 0, 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.1))
    out = im.convert('RGBA'); out.putalpha(m)
    if not card_png: _DECK = out.copy()
    return out

# ------------------------------------------------------------------ corner drawing
SS = 3
def _poly_round_rect(x0, y0, x1, y1, radii, steps=14):
    tl, tr, br, bl = radii; pts = []
    for cx, cy, r, a0 in ((x0 + tl, y0 + tl, tl, 180), (x1 - tr, y0 + tr, tr, 270), (x1 - br, y1 - br, br, 0), (x0 + bl, y1 - bl, bl, 90)):
        if r <= 0.5:
            pts.append((cx, cy)); continue
        for i in range(steps + 1):
            a = math.radians(a0 + 90 * i / steps); pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def _polar(cx, cy, rx, ry, f, n=240):
    return [(cx + rx * f(t) * math.cos(t), cy + ry * f(t) * math.sin(t)) for t in (2 * math.pi * i / n for i in range(n))]

M = 44                    # bleed kept beyond the top and side edge so motion never opens a gap
VIS_W, VIS_H = 352, 312   # visible frame box; shadow adds ~18 px, so nothing passes y 353 even at the lowest motion point

def frame_polygon(shape, r):
    x0, y0, x1, y1 = -M, -M, VIS_W, VIS_H
    cx, cy = (x0 + x1) / 2 + 20, (y0 + y1) / 2 + 12
    if shape == 'circle': return _polar(cx, cy, (x1 - x0) / 2, (y1 - y0) / 2, lambda t: 1.0)
    if shape == 'scallop': return _polar(cx, cy, (x1 - x0) / 2 * 0.97, (y1 - y0) / 2 * 0.97, lambda t: 1 + 0.035 * math.cos(14 * t))
    if shape == 'blob':
        a, b = r.uniform(0, 6.28), r.uniform(0, 6.28)
        return _polar(cx, cy, (x1 - x0) / 2 * 0.95, (y1 - y0) / 2 * 0.95, lambda t: 1 + 0.07 * math.sin(3 * t + a) + 0.04 * math.sin(5 * t + b))
    if shape == 'hex': return [(cx + (x1 - x0) / 2 * math.cos(math.radians(60 * i + 30)), cy + (y1 - y0) / 2 * math.sin(math.radians(60 * i + 30))) for i in range(6)]
    if shape == 'arch': return _poly_round_rect(x0, y0, x1 - 26, y1, (0, 0, 190, 0))
    if shape == 'pill_v': return _poly_round_rect(x0, y0, x1 * 0.78, y1, (0, 0, 160, 160))
    if shape == 'rounded_square': return _poly_round_rect(x0, y0, x1 - 18, y1 - 6, (0, 0, 54, 0))
    if shape == 'leaf': return _poly_round_rect(x0, y0, x1 - 10, y1, (0, 150, 8, 150))
    raise ValueError(shape)

def _mask(poly, size, feather=1.2):
    im = Image.new('L', (size[0] * SS, size[1] * SS), 0)
    ImageDraw.Draw(im).polygon([((x + M) * SS, (y + M) * SS) for x, y in poly], fill=255)
    return im.resize(size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(feather))   # soft edge, never a hard cut

def render_corner(p, side=None, card_png=None):
    side = side or p.get('side', 'L'); r = random.Random(p.get('seed', 1))
    g, acc = p['palette'].split('-'); gc, ac = rgb(g), rgb(acc)
    cw, ch = VIS_W + M + 40, VIS_H + M + 30            # canvas incl. bleed, room for the shadow
    fm = _mask(frame_polygon(p['shape'], r), (cw, ch))
    layer = Image.new('RGBA', (cw, ch), gc + (0,)); layer.putalpha(fm)
    deco = p['type']
    if deco in ('ring', 'dots', 'speckle'):
        dec = Image.new('RGBA', (cw * SS, ch * SS), (0, 0, 0, 0)); dd = ImageDraw.Draw(dec)
        if deco == 'ring':
            poly = frame_polygon(p['shape'], random.Random(p.get('seed', 1)))
            cxp = sum(x for x, _ in poly) / len(poly); cyp = sum(y for _, y in poly) / len(poly)
            for k, wd in ((22, 7), (40, 3)):
                pts = [((cxp + (x - cxp) * (1 - k / 220.0) + M) * SS, (cyp + (y - cyp) * (1 - k / 200.0) + M) * SS) for x, y in poly]
                dd.line(pts + [pts[0]], fill=ac + (255,), width=wd * SS, joint='curve')
        elif deco == 'dots':
            for i in range(4):
                for j in range(5):
                    cx, cy = 250 + 26 * i + (13 if j % 2 else 0), 18 + 26 * j
                    dd.ellipse([(cx + M - 5) * SS, (cy + M - 5) * SS, (cx + M + 5) * SS, (cy + M + 5) * SS], fill=ac + (235,))
        else:
            for _ in range(70):
                cx, cy, rad = r.uniform(-M, VIS_W), r.uniform(-M, VIS_H), r.uniform(2, 6)
                dd.ellipse([(cx + M - rad) * SS, (cy + M - rad) * SS, (cx + M + rad) * SS, (cy + M + rad) * SS], fill=ac + (r.randrange(120, 220),))
        dec = dec.resize((cw, ch), Image.LANCZOS)
        dec.putalpha(ImageChops.multiply(dec.getchannel('A'), fm))      # decoration stays inside the frame
        layer = Image.alpha_composite(layer, dec)
    sh = Image.new('RGBA', (cw, ch), (20, 40, 42, 0))                   # soft shadow, feathered outward
    sa = ImageChops.offset(fm.point(lambda v: int(v * 0.26)).filter(ImageFilter.GaussianBlur(11)), 0, 7); sh.putalpha(sa)
    plate = Image.alpha_composite(sh, layer)
    if side == 'R': plate = plate.transpose(Image.FLIP_LEFT_RIGHT)      # right side mirrors the plate, never the product
    # ---- the deck: ALWAYS in the corner
    base = deck_cutout(card_png)
    tw = int(VIS_W * 0.74); deck = base.resize((tw, int(base.height * tw / base.width)), Image.LANCZOS)
    tilt = p['tilt'] if p['layout'] == 'tilted' else 0.0
    if tilt: deck = deck.rotate(tilt if side == 'L' else -tilt, resample=Image.BICUBIC, expand=True)
    dsh = Image.new('RGBA', deck.size, (30, 30, 30, 0)); dsh.putalpha(deck.getchannel('A').point(lambda v: int(v * 0.30)).filter(ImageFilter.GaussianBlur(7)))
    px_ = int(M + VIS_W * 0.50 - deck.width / 2 + 6); py_ = int(M + VIS_H - deck.height - 12)
    if side == 'R': px_ = cw - (px_ + deck.width)
    plate.alpha_composite(dsh, (px_, py_ + 8)); plate.alpha_composite(deck, (px_, py_))
    meta = {'deck_box': (px_, py_, px_ + deck.width, py_ + deck.height)}
    x = -M if side == 'L' else W - cw + M
    return plate, x, -M, meta

def corner_extent(img, x, y):
    """visible alpha extent in frame coordinates (after clipping at the canvas edge)"""
    ys, xs = np.where(np.asarray(img.getchannel('A')) > 8)
    return max(int(xs.min()) + x, 0), max(int(ys.min()) + y, 0), min(int(xs.max()) + 1 + x, W), int(ys.max()) + 1 + y

def corner_xf(motion, t, t_in):
    """(dx, dy, alpha): dy never goes below 0 (up only), dx stays inside the bleed, so nothing passes y 353 and no gap opens"""
    u = max(0.0, t - t_in)
    if motion == 'float': return 0.0, -6 - 6 * math.sin(2 * math.pi * u / 5.0), min(1.0, u / 0.5)
    if motion == 'drift': return 10 * math.sin(2 * math.pi * u / 14.0), -5 - 5 * math.sin(2 * math.pi * u / 18.0 + 1.3), min(1.0, u / 0.5)
    if motion == 'fade': return 0.0, 0.0, min(1.0, u / 1.4) * (0.92 + 0.08 * math.sin(2 * math.pi * u / 7.0))
    return 0.0, 0.0, min(1.0, u / 0.45)

# ------------------------------------------------------------------ name card
def _plate_poly(shape, w, h, px):
    r = h / 2
    if shape == 'pill': return _poly_round_rect(0, 0, w, h, (r, r, r, r))
    if shape == 'bar-notch': n = px(18); return [(0, 0), (w, 0), (w - n, h / 2), (w, h), (0, h)]
    if shape == 'tab': return _poly_round_rect(0, 0, w, h, (0, r, r, 0))
    if shape == 'tab-slant': n = px(26); return [(0, 0), (w, 0), (w - n, h), (0, h)]
    if shape == 'rounded': return _poly_round_rect(0, 0, w, h, (px(26),) * 4)
    if shape == 'arch-top': return _poly_round_rect(0, 0, w, h, (px(60), px(60), px(14), px(14)))
    if shape == 'notch': n = px(30); return [(0, 0), (w, 0), (w - n, h / 2), (w, h), (0, h)]
    if shape == 'flag': n = px(34); return [(0, 0), (w, 0), (w, h - n), (w - n * 0.5, h - n * 0.45), (w - n, h - n), (w - n, h), (0, h)]
    if shape == 'hex': n = px(30); return [(n, 0), (w - n, 0), (w, h / 2), (w - n, h), (n, h), (0, h / 2)]
    return [(0, 0), (w, 0), (w, h), (0, h)]          # bar, circle, scrim

def build_tag(p, S):
    px = lambda v: int(round(v * S))                 # EVERY scale-dependent distance goes through px() (the pill dot bug)
    plate_c, ink_c, sub_c, acc_c = [rgb(c) for c in TAG_PALETTES[p['palette']]]
    fam, shape = p['family'], p['shape']; arr, acc = p['layout'].split('+')
    use_url = not p.get('nourl')
    if not use_url and arr == 'split': arr = 'one-line'
    nf, sf = TAG_TYPES[p['type']]
    fn = font(nf, px(NAME_SIZE[nf])); fs = font(sf, px(34)); fu = font(sf, px(26))
    padx = px(36); pady = px(22)
    nb = fn.getbbox(NAME); n_w, n_h = fn.getlength(NAME), nb[3] - nb[1]
    sb = fs.getbbox('LPC, PMH-C'); s_w, s_h = fs.getlength(CRED), sb[3] - sb[1]
    ub = fu.getbbox('centeringyou'); u_w, u_h = fu.getlength(URL), ub[3] - ub[1]
    acc_w = 2 * px(22) + 2 * px(7) if acc == 'dots' else (px(9) if acc == 'bar' else 0)
    lead = (acc_w + px(24)) if acc_w else 0
    if fam == 'badge': lead = px(92) + px(18)
    if arr == 'stacked':
        row2 = s_w + (px(24) + u_w if use_url else 0)
        content_h = n_h + px(14) + max(s_h, u_h)
        w = padx * 2 + lead + max(n_w, row2); h = pady * 2 + content_h
        nx = padx + lead; y2 = pady + n_h + px(14); ux = nx + s_w + px(24)
        boxes = {'name': (nx, pady, nx + n_w, pady + n_h), 'cred': (nx, y2, nx + s_w, y2 + s_h)}
        if use_url: boxes['url'] = (ux, y2, ux + u_w, y2 + u_h)
    else:
        split = (arr == 'split') and use_url
        content_h = max(n_h, s_h, u_h)
        w = padx * 2 + lead + n_w + px(18) + s_w + ((px(40) + u_w) if split else 0)
        h = pady * 2 + content_h
        nx = padx + lead; cx = nx + n_w + px(18); ux = w - padx - u_w
        boxes = {'name': (nx, (h - n_h) / 2, nx + n_w, (h + n_h) / 2), 'cred': (cx, (h - s_h) / 2, cx + s_w, (h + s_h) / 2)}
        if split: boxes['url'] = (ux, (h - u_h) / 2, ux + u_w, (h + u_h) / 2)
    if fam == 'underline': h += px(14)
    w, h = int(math.ceil(w)), int(math.ceil(h))
    ks = list(boxes)                                 # no two text boxes, and no accent, may overlap at ANY scale
    for i in range(len(ks)):
        for j in range(i + 1, len(ks)):
            a, b = boxes[ks[i]], boxes[ks[j]]
            assert a[2] <= b[0] + 0.5 or b[2] <= a[0] + 0.5 or a[3] <= b[1] + 0.5 or b[3] <= a[1] + 0.5, f'overlap {ks[i]}/{ks[j]} at S={S}'
    if acc_w: assert padx + acc_w <= boxes['name'][0] - px(10) + 0.5, f'accent touches the name at S={S}'
    pad = px(34)                                     # room for shadow and feather
    img = Image.new('RGBA', (w + pad * 2, h + pad * 2 + px(8)), (0, 0, 0, 0))
    pm = Image.new('L', (img.width * SS, img.height * SS), 0)
    ImageDraw.Draw(pm).polygon([((x + pad) * SS, (y + pad) * SS) for x, y in _plate_poly(shape, w, h, px)], fill=255)
    pm = pm.resize(img.size, Image.LANCZOS)
    if fam == 'underline':                           # no hard plate: a feathered scrim behind the type
        sc = Image.new('L', img.size, 0)
        ImageDraw.Draw(sc).rounded_rectangle([pad - px(8), pad, pad + w + px(8), pad + h - px(6)], radius=px(28), fill=int(255 * 0.80))
        pm = sc.filter(ImageFilter.GaussianBlur(px(18)))
    else:
        pm = pm.filter(ImageFilter.GaussianBlur(0.7))
        sh = Image.new('RGBA', img.size, (18, 36, 38, 0)); sa = pm.point(lambda v: int(v * 0.24)).filter(ImageFilter.GaussianBlur(px(9)))
        sh.putalpha(ImageChops.offset(sa, 0, px(5))); img = Image.alpha_composite(img, sh)
    plate = Image.new('RGBA', img.size, plate_c + (0,)); plate.putalpha(pm); img = Image.alpha_composite(img, plate)
    d = ImageDraw.Draw(img); ox, oy = pad, pad
    cyc = oy + h / 2 - (px(7) if fam == 'underline' else 0)
    if acc == 'dots':
        for i in range(3):
            c0 = ox + padx + px(7) + i * px(22); d.ellipse([c0 - px(7), cyc - px(7), c0 + px(7), cyc + px(7)], fill=acc_c + (255,))
    elif acc == 'bar':
        d.rounded_rectangle([ox + padx, cyc - content_h / 2 - px(6), ox + padx + px(9), cyc + content_h / 2 + px(6)], radius=px(4), fill=acc_c + (255,))
    elif acc == 'rule':
        yy = oy + h - pady + px(4) if arr != 'stacked' else oy + h - px(10)
        d.rounded_rectangle([ox + boxes['name'][0], yy, ox + boxes['name'][0] + n_w, yy + px(5)], radius=px(2), fill=acc_c + (255,))
    elif acc == 'dash' and arr != 'stacked':
        mx = ox + boxes['name'][2] + px(9); d.rounded_rectangle([mx - px(2), cyc - px(2), mx, cyc + px(2)], radius=1, fill=acc_c + (255,))
    if fam == 'badge':
        r0 = px(46); bx, by = ox + padx - px(4) + r0, oy + h / 2
        d.ellipse([bx - r0, by - r0, bx + r0, by + r0], fill=acc_c + (255,))
        mb = fn.getbbox('EO'); d.text((bx - fn.getlength('EO') / 2, by - (mb[1] + mb[3]) / 2), 'EO', font=fn, fill=ink_c)
    def put(t, f, xy, col): d.text((ox + xy[0], oy + xy[1]), t, font=f, fill=col + (255,))
    put(NAME, fn, (boxes['name'][0], boxes['name'][1] - nb[1]), ink_c)
    put(CRED, fs, (boxes['cred'][0], boxes['cred'][1] - sb[1]), sub_c)
    if 'url' in boxes: put(URL, fu, (boxes['url'][0], boxes['url'][1] - ub[1]), sub_c)
    return img, {'w': w, 'h': h, 'pad': pad, 'S': S, 'boxes': boxes}

def render_tag(p, max_w=880, max_h=150):
    """largest scale that fits; a shrunk card scales ALL its parts together. No room for the web address: it is dropped."""
    S = 1.42
    while S >= 0.84:
        try:
            img, meta = build_tag(p, S)
            if meta['w'] <= max_w and meta['h'] <= max_h: return img, meta
        except AssertionError:
            pass
        S -= 0.04
    if not p.get('nourl'): return render_tag(dict(p, nourl=True), max_w, max_h)
    raise RuntimeError('name card does not fit: ' + p['family'] + '/' + p['layout'])

def tag_xf(motion, t, a, b):
    """(dx, dy, alpha, wipe): 0.5 s entrance, feathered wipe, 0.35 s fade-out"""
    u = (t - a) / 0.5; k_out = max(0.0, min(1.0, (b - t) / 0.35))
    e = 1 - (1 - max(0.0, min(1.0, u))) ** 3
    al = min(1.0, max(0.0, u * 1.6)) * k_out
    dx = dy = 0.0; wipe = None
    if motion == 'slide-up': dy = (1 - e) * 46
    elif motion == 'drop': dy = -(1 - e) * 46
    elif motion == 'slide-left': dx = (1 - e) * 120
    elif motion == 'slide-right': dx = -(1 - e) * 120
    elif motion == 'wipe': wipe = e; al = k_out if u > 0 else 0.0
    return dx, dy, al, wipe

# ------------------------------------------------------------------ preview sheet (staff only)
def _bg(w, h):
    yy = np.linspace(0, 1, h)[:, None, None]
    return Image.fromarray(((np.array([158, 138, 120]) * (1 - yy) + np.array([104, 88, 76]) * yy) * np.ones((h, w, 3))).astype(np.uint8)).convert('RGBA')

def _paste(base, img, x, y):
    base.alpha_composite(img.crop((max(0, -x), max(0, -y), img.width, img.height)), (max(0, x), max(0, y)))

def preview_sheet(week, client, batch, out_path):
    n = max(len(batch['corner_graphic']), len(batch['name_tag'])); TW = 372; gap = 16
    sheet = Image.new('RGB', (gap + (TW + gap) * n, 1000), (244, 238, 228)); d = ImageDraw.Draw(sheet)
    ft = font('ClearSans-Bold.ttf', 26); fl = font('ClearSans-Medium.ttf', 15); fb = font('ClearSans-Bold.ttf', 15)
    d.text((gap, 22), f'Centering YOU  |  new designs for {week}  |  staff preview, not on her board', font=ft, fill=rgb('ink'))
    d.text((gap, 60), 'Corner graphics always show the deck. Every design is new inside the cooldown window.', font=fl, fill=rgb('ink'))
    y0 = 96
    d.text((gap, y0), 'Corner graphics (top corner of the video, shown at 80 percent)', font=fb, fill=rgb('ink')); y0 += 26
    for i, cp in enumerate(batch['corner_graphic']):
        f = _bg(W, H); img, x, y, _ = render_corner(cp, cp['side']); _paste(f, img, x, y)
        box = (0, 0, 465, 465) if cp['side'] == 'L' else (W - 465, 0, W, 465)
        X = gap + i * (TW + gap); sheet.paste(f.crop(box).convert('RGB').resize((TW, TW), Image.LANCZOS), (X, y0))
        d.text((X, y0 + TW + 6), f'corner {i + 1}: {cp["shape"]} / {cp["palette"]}', font=fb, fill=rgb('ink'))
        d.text((X, y0 + TW + 25), f'{cp["layout"]}, {cp["type"]}, motion {cp["motion"]}, side {cp["side"]}', font=fl, fill=rgb('ink'))
        d.text((X, y0 + TW + 43), 'id ' + cp['fingerprint'], font=fl, fill=(120, 110, 100))
    y0 += TW + 74
    d.text((gap, y0), 'Name cards: Elizabeth O’Brien, LPC, PMH-C (scaled to fit the tile)', font=fb, fill=rgb('ink')); y0 += 26
    for i, tp in enumerate(batch['name_tag']):
        card, meta = render_tag(tp); X = gap + i * (TW + gap)
        k = min(1.0, (TW - 8) / card.width); mini = card.resize((max(1, int(card.width * k)), max(1, int(card.height * k))), Image.LANCZOS)
        tile = _bg(TW, 150); tile.alpha_composite(mini, ((TW - mini.width) // 2, (150 - mini.height) // 2)); sheet.paste(tile.convert('RGB'), (X, y0))
        d.text((X, y0 + 156), f'card {i + 1}: {tp["family"]} / {tp["shape"]} / {tp["palette"]}', font=fb, fill=rgb('ink'))
        d.text((X, y0 + 175), f'{tp["layout"]}, {tp["type"]}, entrance {tp["motion"]}', font=fl, fill=rgb('ink'))
        d.text((X, y0 + 193), 'id ' + tp['fingerprint'], font=fl, fill=(120, 110, 100))
    sheet.crop((0, 0, sheet.width, y0 + 222)).save(out_path); return out_path
