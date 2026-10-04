#!/usr/bin/env python3
"""2026-10-03: one wall card for every Turo event (booking, guest message, trip changed/extended, cancelled).
Adds kind/eye/title/text to the booking card and a 'turo_notice' realtime event. Backs up both files first."""
import shutil, time, sys

W = "/opt/bestly/wall"
stamp = time.strftime("%Y%m%d%H%M")

srv = open(f"{W}/server.py").read()
html = open(f"{W}/www/wall.html").read()

a_old = '''          "earnings": earn if isinstance(earn, (int, float)) else None, "at": time.time(), "demo": bool(demo)}
    with lock:
        W2BK["cur"] = bk'''
a_new = '''          "earnings": earn if isinstance(earn, (int, float)) else None, "at": time.time(), "demo": bool(demo)}
    for k in ("kind", "eye", "title", "text"):      # 2026-10-03: generic Turo event card (message / changed / cancelled)
        bk[k] = g(k, 240 if k == "text" else 120)
    with lock:
        W2BK["cur"] = bk'''
b_old = '''                                elif p.get("event") == "turo_booking":      # W2 round 3: new Turo booking pop-up
                                    w2_booking(p.get("payload") or {})'''
b_new = '''                                elif p.get("event") == "turo_booking":      # W2 round 3: new Turo booking pop-up
                                    w2_booking(p.get("payload") or {})
                                elif p.get("event") == "turo_notice":       # 2026-10-03: guest message, trip changed/extended, cancelled
                                    w2_booking(p.get("payload") or {})'''
c_old = '''<div class="w2bk-eye">New Turo booking${b.demo?' · Sample':''}</div><div class="w2bk-t">${esc(b.guest||'A guest')} booked ${esc(b.car||'your car')}</div>'''
c_new = '''<div class="w2bk-eye">${b.eye?esc(b.eye):`New Turo booking${b.demo?' · Sample':''}`}</div><div class="w2bk-t">${b.title?esc(b.title):`${esc(b.guest||'A guest')} booked ${esc(b.car||'your car')}`}</div>${b.text?`<div class="w2bk-when"><div>${esc(b.text)}</div></div>`:''}'''
d_old = '''    try{ play('celebrate'); }catch(x){} }
  function w2Take(j){'''
d_new = '''    try{ play(b.kind==='cancel'?'alert':(b.kind&&b.kind!=='booking')?'sign':'celebrate'); }catch(x){} }
  function w2Take(j){'''

for name, s, pairs in (("server.py", srv, [(a_old, a_new), (b_old, b_new)]), ("wall.html", html, [(c_old, c_new), (d_old, d_new)])):
    for o, n in pairs:
        if n in s:
            continue
        if s.count(o) != 1:
            sys.exit(f"{name}: anchor not found exactly once: {o[:60]!r}")
srv2 = srv
for o, n in ((a_old, a_new), (b_old, b_new)):
    if n not in srv2:
        srv2 = srv2.replace(o, n, 1)
html2 = html
for o, n in ((c_old, c_new), (d_old, d_new)):
    if n not in html2:
        html2 = html2.replace(o, n, 1)
shutil.copy2(f"{W}/server.py", f"{W}/server.py.bak-turo-notice-{stamp}")
shutil.copy2(f"{W}/www/wall.html", f"{W}/www/wall.html.bak-turo-notice-{stamp}")
open(f"{W}/server.py", "w").write(srv2)
open(f"{W}/www/wall.html", "w").write(html2)
print("patched", stamp)
