import sys, os, random, wave, json, time, argparse, itertools as it
sys.path.insert(0, "/home/claude/oww/piper-sample-generator")
import numpy as np, torch, torchaudio
from piper_sample_generator.__main__ import generate_audio, get_phonemes, audio_float_to_int16
torch.set_num_threads(int(os.environ.get("THREADS", "2")))
ap = argparse.ArgumentParser()
ap.add_argument("--texts", required=True)      # file, one phrase per line
ap.add_argument("--out", required=True)
ap.add_argument("--n", type=int, required=True)
ap.add_argument("--batch", type=int, default=16)
ap.add_argument("--seed", type=int, default=0)
a = ap.parse_args()
random.seed(a.seed); torch.manual_seed(a.seed)
M = "/home/claude/oww/piper-sample-generator/models/en_US-libritts_r-medium.pt"
model = torch.load(M, weights_only=False); model.eval()
cfg = json.load(open(M + ".json"))
voice = cfg["espeak"]["voice"]; sr = cfg["audio"]["sample_rate"]
texts = [l.strip() for l in open(a.texts) if l.strip()]
os.makedirs(a.out, exist_ok=True)
have = len([f for f in os.listdir(a.out) if f.endswith(".wav")])
idx = have; t0 = time.time()
while idx < a.n:
    B = min(a.batch, a.n - idx)
    batch_texts = [random.choice(texts) for _ in range(B)]
    ids = [get_phonemes(voice, cfg, t, False, False) for t in batch_texts]
    L = max(len(x) for x in ids); ids = [x + [1] * (L - len(x)) for x in ids]
    s1 = torch.LongTensor([random.randrange(800) for _ in range(B)])
    s2 = torch.LongTensor([random.randrange(800) for _ in range(B)])
    with torch.no_grad():
        audio, ps = generate_audio(model, s1, s2, ids, random.choice([0.2, 0.35, 0.5, 0.65, 0.8]),
                                   random.choice([0.5, 0.667, 0.8, 0.98]), random.choice([0.6, 0.8, 1.0]),
                                   random.choice([0.75, 0.85, 1.0, 1.1, 1.25, 1.4]), None)
        for i in range(audio.shape[0]):
            audio[i, 0, int(ps[i].flatten().sum().item()) + 1:] = 0
        a16 = torchaudio.functional.resample(audio, sr, 16000)
    x = audio_float_to_int16(a16.cpu().numpy())
    for i in range(x.shape[0]):
        d = np.trim_zeros(x[i].flatten())
        if len(d) < 3200: continue
        with wave.open(os.path.join(a.out, f"{a.seed}_{idx:06d}.wav"), "wb") as w:
            w.setframerate(16000); w.setsampwidth(2); w.setnchannels(1); w.writeframes(d.tobytes())
        idx += 1
    print(f"{idx}/{a.n} {time.time()-t0:.0f}s", flush=True)
