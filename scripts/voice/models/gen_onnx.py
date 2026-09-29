"""Positives from single-speaker Piper voices (diversity beyond the LibriTTS generator), 16 kHz."""
import sys, os, glob, random, wave, io, numpy as np, torch, torchaudio
from piper import PiperVoice
from piper.config import SynthesisConfig
out, n, seed = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
random.seed(seed); os.makedirs(out, exist_ok=True)
texts = [l.strip() for l in open("/home/claude/oww/work/pos.txt") if l.strip()]
voices = [PiperVoice.load(p) for p in sorted(glob.glob("/home/claude/oww/voices/*.onnx"))]
for i in range(n):
    v = random.choice(voices)
    cfg = SynthesisConfig(length_scale=random.choice([0.8, 0.9, 1.0, 1.1, 1.25]), noise_scale=random.choice([0.5, 0.667, 0.85]),
                          noise_w_scale=random.choice([0.6, 0.8, 1.0]))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        v.synthesize_wav(random.choice(texts), w, syn_config=cfg)
    with wave.open(io.BytesIO(buf.getvalue())) as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    y = torchaudio.functional.resample(torch.from_numpy(x.astype(np.float32)), sr, 16000).numpy()
    y = np.clip(y, -32768, 32767).astype(np.int16)
    with wave.open(f"{out}/onnx{seed}_{i:05d}.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(y.tobytes())
    if i % 100 == 0: print(i, flush=True)
