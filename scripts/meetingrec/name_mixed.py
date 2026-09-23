"""Name the speakers on a ONE-track recording (a meeting recorded on a phone, the Soundcore, or
anything uploaded / AirDropped) - the counterpart of name_speakers.py for calls recorded here.

Calls recorded on this Mac have two tracks, so JARED is always his own mic. An uploaded meeting is
everyone mixed together, so here every voice, Jared's included, is told apart by voice:
  - diarization (sherpa-onnx, same models as speakerid.py) only cuts the audio into bits: on one
    room mic it over-splits (100 "speakers" in a 74-minute two-person meeting)
  - each bit is scored against the saved voiceprints (voices/<name>.npy: jared, eli, ...) and is
    that person when the best score is high enough AND clearly beats the next one
  - bits too short to score take their diarization cluster's clear majority
  - bits that match nobody are grouped by voice; a group with a minute of speech is a person
    ("SPEAKER-2"...; or, when the roster names exactly one person with no voiceprint, them - and
    their voiceprint is saved for next time)
  - each transcript line goes to whoever is speaking at that moment

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
MATCH = 0.40          # a bit is that person when their voiceprint scores this high...
MARGIN = 0.04         # ...and beats the next voiceprint by this much (Jared and Eli are close)
ROOM_MATCH = 0.45     # against a voice as it sounds in this recording (built from confident bits)
ROOM_MARGIN = 0.03
GROUP = 0.50          # unknown bits this alike are one voice
NEW_VOICE_S = 60      # an unknown voice needs a minute of speech to count as a person
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

# 1. voices. Diarization on one room mic over-splits badly (a 74-minute meeting came back as 100
#    clusters), so it is used only for timing. Who is who comes from each bit's own voiceprint score.
data, segs = segments(wav, nclust=-1)
profs = load_profiles()
pnames = list(profs)
P = np.array([profs[n] for n in pnames]) if pnames else np.zeros((0, 1))
bits = []                                    # [start, end, diar cluster, embedding|None, label|None]
for s, e, c in segs:
    v = embed(data[int(s * 16000):int(e * 16000)]) if e - s >= 1.0 else None
    bits.append([s, e, c, v, None])

# 2. a bit is someone when their voiceprint clearly wins (score and margin over the next best)
for b in bits:
    if b[3] is None or not pnames:
        continue
    sc = P @ b[3]
    order = np.argsort(sc)[::-1]
    best, second = sc[order[0]], (sc[order[1]] if len(order) > 1 else -1.0)
    if best >= MATCH and best - second >= MARGIN:
        b[4] = pnames[order[0]]

# 2b. the saved voiceprints come from a close mic; a room mic sounds different. So build each
#     person's voice as it sounds IN THIS RECORDING from their confident bits, and use that to
#     place the unsure bits (two passes, so the room voices firm up).
for _ in range(2):
    room_v = {}
    for nm in {b[4] for b in bits if b[4]}:
        vs = [(b[3], b[1] - b[0]) for b in bits if b[4] == nm and b[3] is not None]
        if sum(w for _, w in vs) >= 30:
            m = np.sum([v * w for v, w in vs], axis=0)
            room_v[nm] = m / np.linalg.norm(m)
    if not room_v:
        break
    rn = list(room_v)
    R_ = np.array([room_v[k] for k in rn])
    for b in bits:
        if b[4] is None and b[3] is not None:
            sc = R_ @ b[3]
            order = np.argsort(sc)[::-1]
            best, second = sc[order[0]], (sc[order[1]] if len(order) > 1 else -1.0)
            if best >= ROOM_MATCH and best - second >= ROOM_MARGIN:
                b[4] = rn[order[0]]

# 3. bits too short to score take the clear majority of their diarization cluster
votes = {}
for b in bits:
    if b[4]:
        votes.setdefault(b[2], {}).setdefault(b[4], 0.0)
        votes[b[2]][b[4]] += b[1] - b[0]
for b in bits:
    if b[4] is None and b[3] is None and b[2] in votes:
        who_, w = max(votes[b[2]].items(), key=lambda x: x[1])
        if w >= 0.6 * sum(votes[b[2]].values()):
            b[4] = who_

# 4. voices that match nobody: group them (average-link on the voiceprint), a group with a minute
#    or more of speech is a person (SPEAKER-n, or a roster name by elimination); crumbs are left for
#    the nearest named bit in time
unk = [b for b in bits if b[4] is None and b[3] is not None]
groups = [[b] for b in unk]
cents = [b[3].copy() for b in unk]
wts = [b[1] - b[0] for b in unk]
while len(groups) > 1:
    M = np.array(cents)
    M = M / np.linalg.norm(M, axis=1, keepdims=True)
    sim = M @ M.T
    np.fill_diagonal(sim, -1)
    i, j = np.unravel_index(int(sim.argmax()), sim.shape)
    if sim[i, j] < GROUP:
        break
    a, z = min(i, j), max(i, j)
    cents[a] = (cents[a] * wts[a] + cents[z] * wts[z]) / (wts[a] + wts[z])
    wts[a] += wts[z]
    groups[a] += groups[z]
    del cents[z], wts[z], groups[z]
big = sorted([k for k in range(len(groups)) if wts[k] >= NEW_VOICE_S], key=lambda k: min(b[0] for b in groups[k]))
missing = [r for r in roster if r not in pnames and r != "jared"]
learned = []
n = 1
room_known = room_v  # the voices as they sound in this recording (step 2b)
for k in big:
    c = cents[k] / np.linalg.norm(cents[k])
    near = max(((nm, float(v @ c)) for nm, v in room_known.items()), key=lambda x: x[1], default=(None, 0.0))
    if near[1] >= ROOM_MATCH:
        # a whole group that sounds like someone already here is them, not a new person
        for b in groups[k]:
            b[4] = near[0]
        continue
    if len(big) == 1 and len(missing) == 1:
        nm = missing[0]
        if wts[k] >= ENROLL_MIN_S:
            np.save(f"{V}/{nm}.npy", c)
            learned.append(nm)
    else:
        n += 1
        nm = f"speaker-{n}"
    for b in groups[k]:
        b[4] = nm

named_bits = sorted((b for b in bits if b[4]), key=lambda b: b[0])
spans = [(b[0], b[1], b[4]) for b in named_bits]

stats = {}
for s_, e_, nm in spans:
    st = stats.setdefault(nm, {"min": 0.0, "first": s_})
    st["min"] += (e_ - s_) / 60
label = {nm: {"name": nm, "how": ("voice" if nm in pnames else "only one left" if nm in learned else "unknown"),
              "score": None} for nm in stats}


def who(t):
    best = None
    for s_, e_, nm in spans:
        if s_ <= t <= e_:
            return nm
        d = s_ - t if t < s_ else t - e_
        if best is None or d < best[0]:
            best = (d, nm)
        if s_ > t + 8:
            break
    return best[1] if best and best[0] < 6 else None


def tag(nm):
    return nm.upper() if nm else "SPEAKER?"


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
hdr = ["# One-track recording (uploaded or AirDropped): every voice, Jared's too, is told apart by voice.",
       "# Quick back-and-forth on one mic can land on the wrong name; read those from context."]
for nm in sorted(stats, key=lambda k: stats[k]["first"]):
    hdr.append(f"# {nm.upper()}: {HOW[label[nm]['how']]}, {round(stats[nm]['min'], 1)} min")
if any(l["how"] == "unknown" for l in label.values()):
    hdr.append("# SPEAKER-n = a voice with no saved voiceprint; rename it from context.")
if learned:
    hdr.append(f"# Learned new voice{'s' if len(learned) > 1 else ''}: {', '.join(learned)} (recognised by voice next time)")

# named first: the agent's sweep picks a meeting up as soon as -transcript.txt exists
open(f"{R}/{name}-transcript-named.txt", "w").write("\n".join(hdr) + "\n" + "\n".join(named) + "\n")
people = sorted({l["name"] for l in label.values() if not l["name"].startswith("speaker-") and l["name"] != "jared"})
json.dump({"roster": people, "source": "upload", "learned": learned,
           "voices": [{**label[nm], "minutes": round(stats[nm]["min"], 1)} for nm in sorted(stats, key=lambda k: stats[k]["first"])]},
          open(f"/tmp/{name}-speakers.json", "w"))
open(f"{R}/{name}-transcript.txt.tmp", "w").write("\n".join(plain) + "\n")
os.replace(f"{R}/{name}-transcript.txt.tmp", f"{R}/{name}-transcript.txt")
try:
    os.remove(wav)
except OSError:
    pass
print("\n".join(hdr))
print(f"wrote {R}/{name}-transcript-named.txt ({len(named)} lines)")
