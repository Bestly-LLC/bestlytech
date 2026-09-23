"""Name the speakers on a ONE-track recording (a meeting recorded on a phone, the Soundcore, or
anything uploaded / AirDropped) - the counterpart of name_speakers.py for calls recorded here.

Calls recorded on this Mac have two tracks, so JARED is always his own mic. An uploaded meeting is
everyone mixed together, so here every voice, Jared's included, is told apart by voice:
  - the audio is split into voices (sherpa-onnx diarization, same models as speakerid.py)
  - each voice is matched to the saved voiceprints (voices/<name>.npy: jared, eli, elizabeth, ...)
  - a voice with no match is "SPEAKER 2", "SPEAKER 3"...; if the roster names exactly one person
    with no voiceprint and exactly one big voice is left, that voice is theirs (elimination) and
    their voiceprint is saved for next time
  - each transcript line goes to the voice speaking at that moment

usage: name_mixed.py <meeting-name> "<roster, comma separated, optional>"
reads:  recordings/<name>-room.m4a   and  /tmp/<name>.room.tsv (talkscribe: start<TAB>LABEL<TAB>text)
writes: recordings/<name>-transcript.txt, recordings/<name>-transcript-named.txt,
        /tmp/<name>-speakers.json  (same files stop.sh leaves, so upload.sh and the agent's
        transcript sweep treat it exactly like a recorded call)
"""
import sys, os, re, json, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from speakerid import segments, embed, cos, load_profiles  # noqa: E402

R = f"{HERE}/recordings"
V = f"{HERE}/voices"
MATCH = 0.45          # same bar speakerid.identify uses
MIN_VOICE_S = 20      # a "voice" with less speech than this is folded into the nearest real one
ENROLL_MIN_S = 30

name = sys.argv[1]
roster = []
for r in (sys.argv[2] if len(sys.argv) > 2 else "").split(","):
    r = re.sub(r"[^a-z0-9-]", "", r.strip().lower().replace(" ", "-"))
    if r and r not in roster:
        roster.append(r)

room = f"{R}/{name}-room.m4a"
wav = f"/tmp/{name}-room.wav"
if not os.path.exists(wav):
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", room, wav], check=True)

# 1. voices
nclust = len(set(roster) | {"jared"}) if roster else -1
data, segs = segments(wav, nclust=nclust)
vecs, secs, first = {}, {}, {}
for s, e, c in segs:
    secs[c] = secs.get(c, 0.0) + (e - s)
    first.setdefault(c, s)
    if e - s >= 1.0 and len(vecs.get(c, [])) < 60:          # 60 good bits is plenty per voice
        v = embed(data[int(s * 16000):int(e * 16000)])
        if v is not None:
            vecs.setdefault(c, []).append(v)


def centroid(vs):
    m = np.mean(vs, axis=0)
    return m / np.linalg.norm(m)


cent = {c: centroid(v) for c, v in vecs.items() if v}

# 2. tiny voices fold into the nearest big one (diarization over-splits long recordings)
big = [c for c in cent if secs.get(c, 0) >= MIN_VOICE_S] or list(cent)
alias = {}
for c in cent:
    if c not in big:
        alias[c] = max(big, key=lambda b: cos(cent[c], cent[b]))

# 3. names by voiceprint
profs = load_profiles()
label = {}
for c in big:
    best = max(((n, cos(cent[c], p)) for n, p in profs.items()), key=lambda x: x[1], default=(None, 0.0))
    label[c] = {"name": best[0], "how": "voice", "score": round(best[1], 2)} if best[1] >= MATCH else None

# two voices can't both be the same person: keep the closer one
taken = {}
for c, lab in list(label.items()):
    if lab:
        o = taken.get(lab["name"])
        if o is None or label[o]["score"] < lab["score"]:
            if o is not None:
                label[o] = None
            taken[lab["name"]] = c
        else:
            label[c] = None

left = [c for c in big if not label.get(c)]
missing = [r for r in roster if r not in taken]
learned = []
if len(left) == 1 and len(missing) == 1:
    c = left[0]
    label[c] = {"name": missing[0], "how": "only one left", "score": None}
    if missing[0] not in profs and secs.get(c, 0) >= ENROLL_MIN_S and len(vecs.get(c, [])) >= 3:
        np.save(f"{V}/{missing[0]}.npy", cent[c])
        learned.append(missing[0])
n = 1
for c in sorted(left, key=lambda c: first.get(c, 0)):
    if not label.get(c):
        n += 1
        label[c] = {"name": f"speaker-{n}", "how": "unknown", "score": None}

spans = sorted(((s, e, alias.get(c, c)) for s, e, c in segs if alias.get(c, c) in label), key=lambda x: x[0])


def who(t):
    best = None
    for s, e, c in spans:
        if s <= t <= e:
            return c
        d = s - t if t < s else t - e
        if best is None or d < best[0]:
            best = (d, c)
        if s > t + 5:
            break
    return best[1] if best and best[0] < 3 else None


def tag(c):
    if c is None:
        return "SPEAKER?"
    return label[c]["name"].upper()


# 4. lines
rows = []
for line in open(f"/tmp/{name}.room.tsv"):
    p = line.rstrip("\n").split("\t")
    if len(p) < 3 or not p[-1].strip():
        continue
    try:
        rows.append((float(p[0]), p[-1].strip()))
    except ValueError:
        pass
rows.sort()
plain, named = [], []
for t, txt in rows:
    stamp = f"[{int(t) // 60:02d}:{int(t) % 60:02d}]"
    plain.append(f"{stamp} ROOM: {txt}")
    named.append(f"{stamp} {tag(who(t))}: {txt}")

HOW = {"voice": "matched by voice", "only one left": "the only voice left on the roster", "unknown": "voice not known yet"}
hdr = ["# One-track recording (uploaded or AirDropped): every voice, Jared's too, is told apart by voice."]
for c in sorted(label, key=lambda c: first.get(c, 0)):
    lab = label[c]
    sc = f", {lab['score']:.2f}" if lab["score"] is not None else ""
    hdr.append(f"# {lab['name'].upper()}: {HOW[lab['how']]}{sc}, {round(secs.get(c, 0) / 60, 1)} min")
if any(l["how"] == "unknown" for l in label.values()):
    hdr.append("# SPEAKER-n = a voice with no saved voiceprint; rename it from context.")
if learned:
    hdr.append(f"# Learned new voice{'s' if len(learned) > 1 else ''}: {', '.join(learned)} (recognised by voice next time)")

# named first: the agent's sweep picks a meeting up as soon as -transcript.txt exists
open(f"{R}/{name}-transcript-named.txt", "w").write("\n".join(hdr) + "\n" + "\n".join(named) + "\n")
people = sorted({l["name"] for l in label.values() if not l["name"].startswith("speaker-") and l["name"] != "jared"})
json.dump({"roster": people, "source": "upload", "learned": learned,
           "voices": [{**label[c], "minutes": round(secs.get(c, 0) / 60, 1)} for c in sorted(label, key=lambda c: first.get(c, 0))]},
          open(f"/tmp/{name}-speakers.json", "w"))
open(f"{R}/{name}-transcript.txt.tmp", "w").write("\n".join(plain) + "\n")
os.replace(f"{R}/{name}-transcript.txt.tmp", f"{R}/{name}-transcript.txt")
try:
    os.remove(wav)
except OSError:
    pass
print("\n".join(hdr))
print(f"wrote {R}/{name}-transcript-named.txt ({len(named)} lines)")
