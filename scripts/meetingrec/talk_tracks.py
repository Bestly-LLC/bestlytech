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
JARED_NAMES = {"jared", "jared best"}  # display names that are Jared himself (his mic covers him)

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

def chat_joins(token):
    """Who joined the call when, from Talk's own chat log ("X joined the call").
    Used when the page stopped showing names (a Talk update moved them)."""
    import base64, urllib.request
    pw = subprocess.run(["security", "find-generic-password", "-s", "nextcloud-meetingrec", "-a", "jared", "-w"],
                        capture_output=True, text=True).stdout.strip()
    req = urllib.request.Request(
        f"https://cloud.bestly.tech/ocs/v2.php/apps/spreed/api/v1/chat/{token}?lookIntoFuture=0&limit=200&includeLastKnown=0",
        headers={"OCS-APIRequest": "true", "Accept": "application/json",
                 "Authorization": "Basic " + base64.b64encode(f"jared:{pw}".encode()).decode()})
    with urllib.request.urlopen(req, timeout=20) as r:
        msgs = json.loads(r.read().decode())["ocs"]["data"]
    out = []
    for m in msgs:
        if m.get("systemMessage") == "call_joined" and m.get("actorId") != "scout-notetaker":
            out.append((m["timestamp"], m.get("actorDisplayName") or m.get("actorId")))
    return sorted(out)


unnamed = [t for t in manifest.get("tracks", []) if not t.get("name") and os.path.exists(f"{tdir}/{t['file']}")]
fallback_used = 0
if unnamed and manifest.get("token"):
    try:
        joins = chat_joins(manifest["token"])
        used = set()
        for t in sorted(unnamed, key=lambda t: t["t0"]):
            # a track starts a few seconds after that person joined the call
            best = min(((abs(t["t0"] / 1000.0 - ts), i, nm) for i, (ts, nm) in enumerate(joins) if i not in used),
                       default=None)
            if best and best[0] < 45:
                used.add(best[1])
                t["name"] = best[2]
                fallback_used += 1
    except Exception as e:  # noqa: BLE001
        print("chat fallback failed:", e, file=sys.stderr)

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
if fallback_used:
    hdr.append(f"# {fallback_used} name(s) taken from Talk's 'joined the call' log (the page didn't show them).")
for who, info in people.items():
    hdr.append(f"# {label(who)}: {info['lines']} lines")
open(f"{R}/{name}-transcript-named.txt", "w").write("\n".join(hdr) + "\n" + "\n".join(out) + "\n")

roster = [re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", w.lower())) for w in people]
json.dump({"roster": roster, "source": "talk", "names_from_chat": fallback_used, "voices": [{"name": w, "how": "talk", **i} for w, i in people.items()]},
          open(f"/tmp/{name}-speakers.json", "w"))
print("\n".join(hdr))
print(f"wrote {R}/{name}-transcript-named.txt")
