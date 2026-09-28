#!/usr/bin/env python3
"""W5 r4: add the "Close Encounters of the Kings Road Kind" lines + the UFO voice to /opt/bestly/skit/build.py (anchored,
backup build.py.bak_r4w5_<time>). Then run build.py to render every line (the page falls back to the classic skit until the
k-lines exist in manifest.json)."""
import shutil, sys, time
P = "/opt/bestly/skit/build.py"
s = open(P).read()
if '"k01n"' in s:
    print("already patched"); sys.exit(0)
NEW = '''    # W5 r4 (2026-09-28): "Close Encounters of the Kings Road Kind" - a UFO beams Jared up from his desk (the sky's home label)
    ("k01n", "scout", "Good evening, West Hollywood. Night shift on Kings Road. All quiet on the ceiling.", None),
    ("k01d", "scout", "Hello, West Hollywood. Day shift on Kings Road. All quiet on the ceiling.", None),
    ("k02", "nimbus", "Quiet? Melrose is lit up like a runway. Somebody's buying a $40 candle right now.", "Quiet? Melrose is lit up like a runway. Somebody's buying a forty dollar candle right now."),
    ("k03c", "scout", "Clear skies over the hills. You're not even on the forecast.", None),
    ("k03k", "scout", "Clouds over the hills. For once, you're on the forecast.", None),
    ("k03r", "scout", "It's actually raining in LA. Are you doing that?", "It's actually raining in L A. Are you doing that?"),
    ("k04", "pip", "Mayday! Small plane, big dreams! Is that the Sunset Strip, or just a lot of headlights?", None),
    ("k05", "scout", "Both. Follow the 10 west and you can't miss LAX.", "Both. Follow the ten west and you can't miss L A X."),
    ("k06", "pip", "Got it! Hey... why is the sky humming?", "Got it! Hey, why is the sky humming?"),
    ("k07", "unit7", "This is Air Unit Seven. Unidentified object over Kings Road. Everybody stay cool.", None),
    ("k08", "nimbus", "Don't look at me. I'm fully identified. I'm a cloud.", None),
    ("k09", "ufo", "Greetings, West Hollywood. We come in peace. We heard about the tacos on Melrose.", None),
    ("k10", "unit7", "State your business, saucer.", None),
    ("k11", "ufo", "We are here for the human at the glowing desk. Coordinates: right... there.", "We are here for the human at the glowing desk. Coordinates. Right, there."),
    ("k12n", "scout", "That's Jared's desk! He's still up working!", None),
    ("k12d", "scout", "That's Jared's desk! He's in the middle of something!", None),
    ("k13", "scout", "Jared! Save your work!", None),
    ("k14", "ufo", "Thank you, Kings Road. Your human will be returned shortly. Five stars.", None),
    ("k15", "unit7", "Copy that. Unit Seven is not filing this paperwork.", None),
    ("k16", "nimbus", "Well. That's the most excitement West Hollywood has had since... Tuesday.", "Well. That's the most excitement West Hollywood has had since, Tuesday."),
    ("k17", "ufo", "Returning your human. He was very polite. He tipped.", None),
    ("k18", "scout", "Welcome back, Jared. Did you at least get the tacos?", None),
    ("k19n", "scout", "Scout, signing off. Goodnight, Kings Road.", None),
    ("k19d", "scout", "Scout, signing off. Stay golden, West Hollywood.", None),
]
'''
edits = [
    ('    "unit7":  ("en/en_US/joe/medium/en_US-joe-medium", 1.0),\n}',
     '    "unit7":  ("en/en_US/joe/medium/en_US-joe-medium", 1.0),\n    "ufo":    ("en/en_US/lessac/medium/en_US-lessac-medium", 1.0),   # W5 r4: the visitor (alien filter below)\n}'),
    ('''    ("s10", "scout", "Scout, signing off. The wall's got it from here.", None),\n]\n''',
     '''    ("s10", "scout", "Scout, signing off. The wall's got it from here.", None),\n''' + NEW),
    ('''        ok = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-ac", "1", "-b:a", "64k", mp3]).returncode == 0''',
     '''        fx = ["-af", "asetrate=22050*1.14,aresample=22050,flanger=delay=1:depth=3:speed=0.6,aecho=0.8:0.55:28:0.3"] if who == "ufo" else []   # W5 r4: alien voice
        if who == "ufo":
            dur = dur / 1.14
        ok = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, *fx, "-ac", "1", "-b:a", "64k", mp3]).returncode == 0'''),
]
for a, b in edits:
    if s.count(a) != 1:
        print("ANCHOR", a[:80]); sys.exit(1)
    s = s.replace(a, b, 1)
compile(s, P, "exec")
shutil.copy2(P, P + ".bak_r4w5_" + time.strftime("%H%M%S"))
open(P, "w").write(s)
print("patched build.py")
