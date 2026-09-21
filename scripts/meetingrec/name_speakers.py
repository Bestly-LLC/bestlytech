"""Name the far-end voices on a call from the roster, and learn new voices.

Replaces the old label.py -> anchor.py -> emit.py chain, which had "elizabeth"
and "eli" hard-coded in stop.sh, so every call came out as ELIZABETH/ELI no
matter who was on it.

How it works:
  - JARED is his own mic track, so he is always right.
  - The far-end track is split into as many voices as there are people on the
    roster (the count is the one thing we know for sure).
  - Each voice is matched to a saved voiceprint (voices/<name>.npy) where one
    exists and the match is strong enough.
  - Whoever is left is named by elimination. If exactly one name and one voice
    are left, that is certain. If more are left, it is a guess and marked "?".
  - A certain new voice with enough speech is saved as a voiceprint, so next
    time that person is recognised by voice, not by elimination.

usage: name_speakers.py <meeting-name> "<roster, comma separated>"
writes: recordings/<name>-transcript-named.txt  and  /tmp/<name>-speakers.json
"""
import sys, os, re, json, glob
import numpy as np, soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from speakerid import segments, embed, cos  # noqa: E402

R = f"{HERE}/recordings"
V = f"{HERE}/voices"
MATCH = 0.35        # a voice this close to a voiceprint is that person
ENROLL_MIN_S = 30   # seconds of speech needed before we trust a new voiceprint
CLASH = 0.75        # a "new" voice this close to someone already saved is not new

name = sys.argv[1]
roster = []
for r in (sys.argv[2] if len(sys.argv) > 2 else "").split(","):
    r = re.sub(r"[^a-z0-9-]", "", r.strip().lower().replace(" ", "-"))
    if r and r != "jared" and r not in roster:
        roster.append(r)


def wav(src, dst):
    if not os.path.exists(dst):
        os.system(f'afconvert -f WAVE -d LEI16@16000 -c 1 "{src}" "{dst}" 2>/dev/null')
    return dst


sysw = wav(f"{R}/{name}-system.m4a", f"/tmp/{name}-sys.wav")
micw = wav(f"{R}/{name}-mic.m4a", f"/tmp/{name}-mic.wav")

# Where Jared is talking on his own mic, so his echo on the far-end track can be dropped.
mic, _ = sf.read(micw, dtype="float32")
w = 16000 // 4
env = np.sqrt(np.convolve(mic ** 2, np.ones(w) / w, mode="same"))
hot = env > max(np.percentile(env, 75) * 0.5, 0.01)


def jared_talking(a, b, frac=0.5):
    i, j = int(a * 16000), min(int(b * 16000), len(hot))
    return i < j and hot[i:j].mean() > frac


profs = {os.path.basename(f)[:-4]: np.load(f) for f in glob.glob(f"{V}/*.npy")}
jared = profs.pop("jared", None)

n = len(roster)
nclust = n if n >= 2 else 1
cache = f"/tmp/{name}-far-{nclust}.npz"
if os.path.exists(cache):
    z = np.load(cache)
    seg_list = [tuple(x) for x in z["segs"].tolist()]
    vecs = list(z["vecs"])
else:
    data, segs = segments(sysw, 0, -1, nclust=nclust)
    seg_list, vecs = [], []
    for s, e, c in segs:
        if e - s < 0.4:
            continue
        v = embed(data[int(s * 16000):int(e * 16000)])
        if v is None:
            continue
        seg_list.append((s, e, c))
        vecs.append(v)
    if vecs:
        np.savez(cache, segs=np.array(seg_list, dtype=float), vecs=np.array(vecs))

rows = []                      # one per usable far-end segment
by_cluster = {}                # cluster -> list of (vector, seconds)
for (s, e, c), v in zip(seg_list, vecs):
    c = int(c)
    if jared is not None and jared_talking(s, e) and cos(v, jared) > 0.55:
        continue
    rows.append({"start": round(s, 2), "end": round(e, 2), "cluster": c, "v": v})
    by_cluster.setdefault(c, []).append((v, e - s))


def centroid(items, keep_frac=1.0):
    vs = [v for v, _ in items]
    m = np.mean(vs, axis=0)
    m /= np.linalg.norm(m)
    if keep_frac < 1.0 and len(vs) > 3:
        ranked = sorted(vs, key=lambda v: -cos(v, m))
        vs = ranked[:max(3, int(len(ranked) * keep_frac))]
        m = np.mean(vs, axis=0)
        m /= np.linalg.norm(m)
    return m


SAME = 0.93   # two piles this alike are one voice to this model, not two people

cent = {c: centroid(items) for c, items in by_cluster.items()}

# On call audio this voice model tells a man from a woman easily but two
# similar voices hardly at all (Eli and Cooper score 0.99 alike). Merge piles
# it can't tell apart, and never claim to know who said what inside one.
parent = {c: c for c in cent}
def root(c):
    while parent[c] != c:
        c = parent[c]
    return c
cl = sorted(cent)
for i, a in enumerate(cl):
    for b in cl[i + 1:]:
        if cos(cent[a], cent[b]) > SAME:
            parent[root(b)] = root(a)
if any(root(c) != c for c in cl):
    for r in rows:
        r["cluster"] = root(r["cluster"])
    merged = {}
    for c, items in by_cluster.items():
        merged.setdefault(root(c), []).extend(items)
    by_cluster = merged
    cent = {c: centroid(items) for c, items in by_cluster.items()}
secs = {c: sum(d for _, d in items) for c, items in by_cluster.items()}
first = {}
for r in rows:
    first.setdefault(r["cluster"], r["start"])

label = {}     # cluster -> {"name", "how", "score"}
left_names = list(roster)
left_clusters = sorted(cent, key=lambda c: first.get(c, 0))

fewer_voices = len(cent) < n   # some people on the roster sound alike to the model

# 1) voice match against saved voiceprints of people on the roster. If there
#    are fewer voices than people, a pile may hold two people, so only trust a
#    match that clearly beats every other known voice on the roster.
pairs = sorted(
    ((cos(cent[c], profs[nm]), c, nm) for c in left_clusters for nm in left_names if nm in profs),
    reverse=True,
)
for sc, c, nm in pairs:
    if sc < MATCH or c not in left_clusters or nm not in left_names:
        continue
    if fewer_voices:
        others = [cos(cent[c], profs[o]) for o in roster if o in profs and o != nm]
        if len(others) == 0 or sc - max(others) < 0.3:
            continue
    label[c] = {"name": nm, "how": "voice", "score": round(sc, 3)}
    left_clusters.remove(c)
    left_names.remove(nm)

# 2) elimination
if len(left_names) > len(left_clusters) and left_clusters:
    # more people than voices left: say so rather than guess
    joint = "/".join(left_names)
    for c in left_clusters:
        label[c] = {"name": joint, "how": "together", "score": None}
    left_clusters = []
    left_names = []
elif len(left_names) == 1 and left_clusters:
    for c in left_clusters:
        label[c] = {"name": left_names[0], "how": "only one left", "score": None}
    left_clusters = []
    left_names = []
elif left_names and left_clusters:
    # more than one unknown: best guess by order of speaking, marked uncertain
    for c, nm in zip(list(left_clusters), list(left_names)):
        label[c] = {"name": nm, "how": "guess", "score": None}
        left_clusters.remove(c)
        left_names.remove(nm)
for i, c in enumerate(left_clusters):
    label[c] = {"name": f"guest-{chr(65 + i)}", "how": "unknown", "score": None}

# 2b) segment by segment: clustering on call audio sometimes puts a few lines of
#     one person into the other's pile, usually at turn changes. Re-score every
#     segment against the centre of each named pile (same call, same audio
#     path, so the scores are comparable) and move it only on a clear win.
refs = {}
for c, lab in label.items():
    refs.setdefault(lab["name"], cent[c])
cluster_of = {}
for c, lab in label.items():
    cluster_of.setdefault(lab["name"], c)
moved = 0
if len(refs) >= 2:
    for r in rows:
        mine = label.get(r["cluster"], {}).get("name")
        if mine not in refs:
            continue
        sc = {nm: cos(r["v"], ref) for nm, ref in refs.items()}
        best = max(sc, key=sc.get)
        if best != mine and sc[best] - sc[mine] > 0.12:
            r["cluster"] = cluster_of[best]
            moved += 1

# 3) learn new voices we are sure about
learned = []
for c, lab in label.items():
    nm = lab["name"]
    if lab["how"] != "only one left" or nm in profs or nm.startswith("guest-") or "/" in nm:
        continue
    if secs.get(c, 0) < ENROLL_MIN_S:
        continue
    prof = centroid(by_cluster[c], keep_frac=0.7)
    if any(cos(prof, p) > CLASH for k, p in profs.items() if k in roster and k != nm):
        continue
    np.save(f"{V}/{nm}.npy", prof)
    learned.append(nm)


def who(t):
    """The far-end segment a transcript line belongs to. A line's time is when
    it starts, so a segment that contains it wins; otherwise the nearest one,
    leaning to the segment that starts just after (speech-to-text stamps a line
    a little early)."""
    inside = [r for r in rows if r["start"] <= t <= r["end"]]
    if inside:
        return max(inside, key=lambda r: r["start"])
    best = None
    for r in rows:
        d = (r["start"] - t) * 0.8 if t < r["start"] else (t - r["end"])
        if best is None or d < best[0]:
            best = (d, r)
    return best[1] if best and best[0] < 3 else None


def tag(c):
    lab = label.get(c)
    if not lab:
        return "THEM?"
    mark = "?" if lab["how"] in ("guess", "unknown") else ""
    return lab["name"].upper() + mark


out = []
for line in open(f"{R}/{name}-transcript.txt"):
    m = re.match(r"\[(\d+):(\d+)\] (\w+): (.*)", line.strip())
    if not m:
        continue
    t = int(m.group(1)) * 60 + int(m.group(2))
    stamp = f"[{t // 60:02d}:{t % 60:02d}]"
    if m.group(3) == "JARED":
        out.append(f"{stamp} JARED: {m.group(4)}")
    elif n == 1:
        out.append(f"{stamp} {roster[0].upper()}: {m.group(4)}")
    elif n == 0:
        out.append(f"{stamp} THEM: {m.group(4)}")
    else:
        r = who(t)
        out.append(f"{stamp} {tag(r['cluster']) if r else 'THEM?'}: {m.group(4)}")

HOW = {"voice": "matched by voice", "only one left": "the only voice left",
       "guess": "best guess", "unknown": "not on the roster",
       "together": "too alike to tell apart by voice on this call; who said what comes from context"}
lines = ["# JARED = your own mic, always right."]
if n <= 1:
    lines.append(f"# Far end: {roster[0].upper() if n else 'THEM'} (only one other person on the call)")
    if n == 1 and roster[0] not in profs and by_cluster:
        allv = [x for items in by_cluster.values() for x in items]
        if sum(d for _, d in allv) >= ENROLL_MIN_S:
            prof = centroid(allv, keep_frac=0.7)
            if True:  # one person on the far end: nobody to confuse them with
                np.save(f"{V}/{roster[0]}.npy", prof)
                learned.append(roster[0])
else:
    for c in sorted(label, key=lambda c: first.get(c, 0)):
        lab = label[c]
        sc = f", {lab['score']:.2f}" if lab["score"] is not None else ""
        lines.append(f"# {lab['name'].upper()}: {HOW[lab['how']]}{sc}, {round(secs.get(c, 0) / 60, 1)} min")
    if moved:
        lines.append(f"# {moved} short bits re-checked line by line and moved to the other voice.")
    if any(l["how"] in ("guess", "unknown") for l in label.values()):
        lines.append("# '?' = could not tell by voice; check from context.")
if learned:
    lines.append(f"# Learned new voice{'s' if len(learned) > 1 else ''}: {', '.join(learned)} (recognised by voice next time)")

open(f"{R}/{name}-transcript-named.txt", "w").write("\n".join(lines) + "\n" + "\n".join(out) + "\n")
speakers = {
    "roster": roster,
    "learned": learned,
    "voices": [{**label[c], "minutes": round(secs.get(c, 0) / 60, 1)} for c in sorted(label, key=lambda c: first.get(c, 0))],
}
json.dump(speakers, open(f"/tmp/{name}-speakers.json", "w"))
print("\n".join(lines))
print(f"wrote {R}/{name}-transcript-named.txt")
