#!/usr/bin/env python3
"""Build the named transcript from the notetaker's per-person Talk tracks.

The notetaker (notetaker.js) sits in the Talk call and records each person's
audio on its own track, labelled with the name Talk shows for them. So there is
nothing to guess: every track is one person. Transcribe each, shift it onto the
recording's clock, and merge with Jared's own mic.

usage: talk_tracks.py <meeting-name>
reads:  recordings/<name>-talk/manifest.json + track-*.webm
        /tmp/<name>.jared.tsv   (Jared's mic, already transcribed by stop.sh)
        .started                (epoch seconds when recording began)
writes: recordings/<name>-transcript-named.txt, /tmp/<name>-speakers.json
exit 3 if there is nothing usable (stop.sh then falls back to voice matching)
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = f"{HERE}/recordings"
FFMPEG = f"{HERE}/bin/ffmpeg"
SCRIBE = f"{HERE}/bin/talkscribe"
JARED_NAMES = {"jared", "jared best"}

name = sys.argv[1]
tdir = f"{R}/{name}-talk"
try:
    manifest = json.load(open(f"{tdir}/manifest.json"))
except (OSError, ValueError):
    sys.exit(3)

started = None
try:
    started = int(open(f"{HERE}/.started").read().strip())
except (OSError, ValueError):
    pass

tracks = [t for t in manifest.get("tracks", []) if t.get("name") and os.path.exists(f"{tdir}/{t['file']}")]
others = [t for t in tracks if t["name"].strip().lower() not in JARED_NAMES]
if not others:
    sys.exit(3)
if started is None:
    started = min(t["t0"] for t in tracks) / 1000.0


def label(n):
    return re.sub(r"\s+", "-", n.strip()).upper()


rows = []
people = {}
for t in others:
    src = f"{tdir}/{t['file']}"
    m4a = src[:-5] + ".m4a"
    if not os.path.exists(m4a):
        subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-c:a", "aac", "-b:a", "64k", m4a], check=False)
    if not os.path.exists(m4a) or os.path.getsize(m4a) < 2000:
        continue
    lab = label(t["name"])
    offset = t["t0"] / 1000.0 - started
    out = subprocess.run([SCRIBE, m4a, lab], capture_output=True, text=True).stdout
    n = 0
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) >= 3 and p[2].strip():
            rows.append((float(p[0]) + offset, lab, p[2].strip()))
            n += 1
    people.setdefault(t["name"].strip(), {"lines": 0, "minutes": 0.0})
    people[t["name"].strip()]["lines"] += n
    if t.get("t1"):
        people[t["name"].strip()]["minutes"] += round((t["t1"] - t["t0"]) / 60000.0, 1)

if not rows:
    sys.exit(3)

# Jared: his own mic track, transcribed by stop.sh
try:
    for line in open(f"/tmp/{name}.jared.tsv"):
        p = line.rstrip("\n").split("\t")
        if len(p) >= 3 and p[2].strip():
            rows.append((float(p[0]), "JARED", p[2].strip()))
except OSError:
    pass

rows.sort(key=lambda r: r[0])
out = []
for t, lab, txt in rows:
    t = max(0, int(t))
    out.append(f"[{t // 60:02d}:{t % 60:02d}] {lab}: {txt}")

hdr = ["# Names come straight from Nextcloud Talk: the notetaker recorded each person on their own track.",
       "# JARED = your own mic."]
for who, info in people.items():
    hdr.append(f"# {label(who)}: {info['lines']} lines")
open(f"{R}/{name}-transcript-named.txt", "w").write("\n".join(hdr) + "\n" + "\n".join(out) + "\n")

roster = [re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", w.lower())) for w in people]
json.dump({"roster": roster, "source": "talk", "voices": [{"name": w, "how": "talk", **i} for w, i in people.items()]},
          open(f"/tmp/{name}-speakers.json", "w"))
print("\n".join(hdr))
print(f"wrote {R}/{name}-transcript-named.txt")
