#!/usr/bin/env python3
"""Build the named transcript from the notetaker's per-person Talk tracks.

The notetaker (notetaker.js) sits in the Talk call and records each person's
audio on its own track, labelled with the name Talk shows for them. So there is
nothing to guess: every track is one person. Transcribe each and shift it onto
the recording's clock.

Jared's lines (1.10.2): his own Talk track is the source, the same audio everyone
else on the call heard, from whatever device he joined on. The Mac mini's mic is
only a fallback, for a Talk track that is missing or empty AND a call he was in.
On a call he was not in (the rehearsal room, Eli without him) the mic is never
used: it only hears the room (music, the TV). Whether he was in the call comes
from jared_in_call() below; agent.py (jared_in_call, ingest) applies the same rule.

usage: talk_tracks.py <meeting-name>
reads:  recordings/<name>-talk/manifest.json + track-*.webm
        .meta/<name>.json       (what the agent noted: auto, jared_seen)
        /tmp/<name>.jared.tsv   (the Mac's mic, already transcribed by stop.sh)
        .started                (epoch seconds when recording began)
writes: recordings/<name>-transcript-named.txt, /tmp/<name>-speakers.json
        recordings/<name>-transcript.txt loses its JARED (mic) lines when Jared was not in the call
exit 3 if there is nothing usable (stop.sh then falls back to voice matching)
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = f"{HERE}/recordings"
FFMPEG = f"{HERE}/bin/ffmpeg"
SCRIBE = f"{HERE}/bin/talkscribe"
# Display names that are Jared himself: "Jared", "Jared Best", and the same with a note after it ("Jared (Studio)", "Jared - phone").
JARED_RE = re.compile(r"^jared(\s+best)?(\s*[(\[\-\u2013\u2014].*)?$", re.I)


MIN_TALK_WORDS = 6      # a Jared Talk track with fewer words than this is "empty" (a muted seat, a stray "thank you")


def is_jared(n):
    return bool(JARED_RE.match((n or "").strip()))


name = sys.argv[1]
tdir = f"{R}/{name}-talk"
try:
    meta = json.load(open(f"{HERE}/.meta/{name}.json"))
except (OSError, ValueError):
    meta = {}
try:
    manifest = json.load(open(f"{tdir}/manifest.json"))
except (OSError, ValueError):
    manifest = None


def jared_in_call():
    """Was Jared in this call? Yes when he started the recording by hand (or nothing is known: older recordings), when Scout saw
    him in the call's participants while it recorded (meta jared_seen), or when the notetaker recorded a track under his name.
    A recording Scout started by itself in a room he never joined (the rehearsal room, Eli on his own) says no. agent.py has
    the same rule (jared_in_call); keep them the same."""
    if not meta.get("auto") or meta.get("jared_seen"):
        return True
    return any(is_jared(t.get("name")) for t in (manifest or {}).get("tracks", []))


def words(rs):
    return sum(len(r[2].split()) for r in rs)


def read_mic():
    """The Mac mini's mic as transcribed by stop.sh: [(seconds, "JARED", text)]."""
    got = []
    try:
        for line in open(f"/tmp/{name}.jared.tsv"):
            p = line.rstrip("\n").split("\t")
            if len(p) >= 3 and p[2].strip():
                got.append((float(p[0]), "JARED", p[2].strip()))
    except OSError:
        pass
    return got


def drop_mic_from_plain():
    """The plain transcript (stop.sh's merge.py) has the mic's lines as JARED. Take them out, so neither the voice-matching fallback
    (name_speakers.py) nor the ingest can pick them up. Keeps the file's time. Returns how many lines went."""
    plain = f"{R}/{name}-transcript.txt"
    try:
        lines = open(plain).read().split("\n")
        st = os.stat(plain)
    except OSError:
        return 0
    keep = [ln for ln in lines if not re.match(r"\[\d+:\d+\] JARED: ", ln)]
    if len(keep) == len(lines):
        return 0
    tmp = plain + ".tmp"
    with open(tmp, "w") as f:
        f.write("\n".join(keep))
    os.replace(tmp, plain)
    os.utime(plain, (st.st_atime, st.st_mtime))
    return len(lines) - len(keep)


in_call = jared_in_call()
mic_rows = read_mic()
mic_left_out = 0
if not in_call:
    # The Mac's mic only hears this Mac's room. Jared was not on the call, so nothing it picked up is his.
    mic_left_out = words(mic_rows)
    mic_rows = []
    drop_mic_from_plain()
if manifest is None:
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
others = [t for t in tracks if not is_jared(t["name"])]
if not others:
    sys.exit(3)
if started is None:
    started = min(t["t0"] for t in tracks) / 1000.0


def label(n):
    return re.sub(r"\s+", "-", n.strip()).upper()


def track_rows(t, lab):
    """Transcribe one Talk track; rows are (seconds on the recording's clock, label, text)."""
    src = f"{tdir}/{t['file']}"
    m4a = src[:-5] + ".m4a"
    if not os.path.exists(m4a):
        subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-c:a", "aac", "-b:a", "64k", m4a], check=False)
    if not os.path.exists(m4a) or os.path.getsize(m4a) < 2000:
        return None
    offset = t["t0"] / 1000.0 - started
    out = subprocess.run([SCRIBE, m4a, lab], capture_output=True, text=True).stdout
    got = []
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) >= 3 and p[2].strip():
            got.append((float(p[0]) + offset, lab, p[2].strip()))
    return got


rows = []
people = {}
for t in others:
    lab = label(t["name"])
    got = track_rows(t, lab)
    if got is None:
        continue
    rows += got
    n = len(got)
    people.setdefault(t["name"].strip(), {"lines": 0, "minutes": 0.0})
    people[t["name"].strip()]["lines"] += n
    if t.get("t1"):
        people[t["name"].strip()]["minutes"] += round((t["t1"] - t["t0"]) / 60000.0, 1)

if not rows:
    sys.exit(3)

# Jared's lines: his own Talk track first. The Mac's mic stands in only when that track is missing or empty (and, because mic_rows
# is empty for a call he was not in, only for a call he was in).
jared_tracks = [t for t in tracks if is_jared(t["name"])]
talk_rows = []
for t in jared_tracks:
    talk_rows += track_rows(t, "JARED") or []
if talk_rows and (words(talk_rows) >= MIN_TALK_WORDS or not mic_rows):
    jared_rows, jared_src = talk_rows, "talk"
elif mic_rows:
    jared_rows, jared_src = mic_rows, "mic"
else:
    jared_rows, jared_src = [], "none"
rows += jared_rows

rows.sort(key=lambda r: r[0])
out = []
for t, lab, txt in rows:
    t = max(0, int(t))
    out.append(f"[{t // 60:02d}:{t % 60:02d}] {lab}: {txt}")

hdr = ["# Names come straight from Nextcloud Talk: the notetaker recorded each person on their own track."]
if jared_src == "talk":
    hdr.append("# JARED = your Talk audio (what everyone else heard).")
elif jared_src == "mic":
    why = "was empty" if jared_tracks else "was missing"
    hdr.append(f"# JARED = your own mic: your Talk audio {why}, so the Mac mini's mic stands in for it.")
elif not in_call:
    hdr.append(f"# Jared was not in this call, so the Mac mini's mic ({mic_left_out} words) was left out." if mic_left_out
               else "# Jared was not in this call; the Mac mini's mic is not used.")
else:
    hdr.append("# No lines from you: your Talk audio and the Mac mini's mic had nothing.")
if fallback_used:
    hdr.append(f"# {fallback_used} name(s) taken from Talk's 'joined the call' log (the page didn't show them).")
for who, info in people.items():
    hdr.append(f"# {label(who)}: {info['lines']} lines")
open(f"{R}/{name}-transcript-named.txt", "w").write("\n".join(hdr) + "\n" + "\n".join(out) + "\n")

roster = [re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", w.lower())) for w in people]
json.dump({"roster": roster, "source": "talk", "names_from_chat": fallback_used, "jared": {"in_call": in_call, "source": jared_src},
           "voices": [{"name": w, "how": "talk", **i} for w, i in people.items()]},
          open(f"/tmp/{name}-speakers.json", "w"))
print("\n".join(hdr))
print(f"wrote {R}/{name}-transcript-named.txt")
