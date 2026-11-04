#!/usr/bin/env python3
"""Generates the wall's projector sounds locally (numpy + wave, no downloads, no paid services).
Every note starts with a raised-cosine attack (never an abrupt start), decays exponentially, and the whole file ends with a feathered fade.
Peak is held near -6 dBFS; the page adds its own gentle gain. Output: 48 kHz 16-bit stereo WAV in the folder given as argv[1]."""
import sys, wave
import numpy as np

SR = 48000


def note(f, dur, attack=0.03, tau=0.35, h=(1.0, 0.22, 0.07)):
    n = int(SR * dur)
    t = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * f * (k + 1) * t) for k, a in enumerate(h))
    env = np.exp(-t / tau)
    na = int(SR * attack)
    env[:na] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(na) / na)       # raised-cosine attack, starts at exactly 0
    return y * env


def mix(parts, total, tail=0.18):
    out = np.zeros(int(SR * total))
    for start, y in parts:
        i = int(SR * start)
        out[i:i + len(y)] += y[:len(out) - i]
    nf = int(SR * tail)
    out[-nf:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(nf) / nf)       # feathered fade-out
    out[:int(SR * 0.004)] *= np.linspace(0, 1, int(SR * 0.004))
    out *= 0.5 / max(1e-9, np.abs(out).max())                         # peak -6 dBFS
    return out


def write(path, mono):
    d = np.stack([mono, np.roll(mono, int(SR * 0.0004))], 1)           # tiny inter-channel offset = a touch of width
    pcm = (np.clip(d, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


out = sys.argv[1]
# chime: soft two-note (G5 then D6), about 1.3 s
write(out + "/chime.wav", mix([(0.0, note(784.0, 1.1, tau=0.30)), (0.20, note(1174.7, 1.1, tau=0.34))], 1.3))
# rare: gentle gold-card fanfare, rising C-E-G-C with a warm bell and a soft sustained top, about 1.6 s
rare = [(0.00, note(523.3, 1.0, tau=0.28)), (0.15, note(659.3, 1.0, tau=0.28)), (0.30, note(784.0, 1.0, tau=0.30)),
        (0.48, note(1046.5, 1.1, tau=0.50, h=(1.0, 0.30, 0.12))), (0.48, note(1318.5, 1.1, tau=0.45, h=(0.55, 0.12, 0.03)))]
write(out + "/rare.wav", mix(rare, 1.6, tail=0.25))
# alert: emergencies, clear but not harsh: A5 / E5 twice (descending pairs), slightly longer attack, about 1.8 s
al = [(0.00, note(880.0, 0.5, attack=0.04, tau=0.30, h=(1.0, 0.18, 0.05))), (0.28, note(659.3, 0.5, attack=0.04, tau=0.30, h=(1.0, 0.18, 0.05))),
      (0.80, note(880.0, 0.5, attack=0.04, tau=0.30, h=(1.0, 0.18, 0.05))), (1.08, note(659.3, 0.6, attack=0.04, tau=0.32, h=(1.0, 0.18, 0.05)))]
write(out + "/alert.wav", mix(al, 1.8, tail=0.25))
print("ok")
