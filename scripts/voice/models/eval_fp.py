import numpy as np, onnxruntime as ort, glob, os, sys
def fpscan(path):
    s = ort.InferenceSession(path); inp = s.get_inputs()[0].name
    X = np.load("/home/claude/oww/data/validation_set_features.npy", mmap_mode="r"); N = X.shape[0]
    out = np.zeros(N - 16, dtype=np.float32)
    for st in range(0, N - 16, 20000):
        blk = np.asarray(X[st:st + 20016], dtype=np.float32)
        for i in range(st, min(st + 20000, N - 16)):
            out[i] = s.run(None, {inp: blk[i - st:i - st + 16][None]})[0].ravel()[0]
    return out, N * 0.08 / 3600
def events(sc, th, pat):
    above = sc > th; n, last, run = 0, -999, 0
    for i, a in enumerate(above):
        run = run + 1 if a else 0
        if run == pat:
            if i - last > 19: n += 1
            last = i
    return n
for path in sys.argv[1:]:
    sc, hrs = fpscan(path)
    np.save(path + ".valscores.npy", sc)
    for th in (0.5, 0.7, 0.8, 0.9):
        print(os.path.basename(path), "th", th, " ".join(f"p{p}:{events(sc, th, p)/hrs:.2f}/h" for p in (1, 2, 3, 4)))
