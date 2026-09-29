import numpy as np, glob, os, collections
from openwakeword.model import Model
m = Model(wakeword_models=["/home/claude/oww/out/hey_scout.onnx"], inference_framework="onnx"); key = list(m.models)[0]
def runs(f):
    m.reset(); p = [x[key] for x in m.predict_clip(f, padding=1)]; return np.array(p)
def hit(sc, th, pat):
    r = 0
    for a in sc > th:
        r = r + 1 if a else 0
        if r >= pat: return True
    return False
pos = sorted(glob.glob("/home/claude/oww/out/hey_scout/positive_test/*.wav"))[:300]
neg = sorted(glob.glob("/home/claude/oww/out/hey_scout/negative_test/*.wav"))[:300]
P = [runs(f) for f in pos]; Nn = [runs(f) for f in neg]
for th in (0.5, 0.6, 0.7):
    for pat in (1, 2, 3):
        print(f"th {th} p{pat}: recall {np.mean([hit(s, th, pat) for s in P]):.2f}  adversarial {np.mean([hit(s, th, pat) for s in Nn]):.3f}")
