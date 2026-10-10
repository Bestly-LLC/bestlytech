#!/mnt/ssd/whisper-stt/venv/bin/python
"""Transcribe one audio/video file with faster-whisper (CPU, int8) and write the result as JSON.

  transcribe.py <audio-file> <out.json> [--language en] [--model small]

Runs inside the venv at /mnt/ssd/whisper-stt/venv (the system python has no faster-whisper). The model is cached in
/mnt/ssd/whisper-stt/models so the SD card stays free. Output keys: text, language, language_probability, duration_s,
avg_logprob (duration-weighted mean of the segments' avg_logprob; closer to 0 = more confident, below about -0.8 is shaky),
segments [{start, end, text, avg_logprob, no_speech_prob}], model, compute_type, elapsed_s.
"""
import json
import os
import sys
import time

MODELS = os.environ.get("WHISPER_MODELS", "/mnt/ssd/whisper-stt/models")


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    audio, out = argv[0], argv[1]
    lang = argv[argv.index("--language") + 1] if "--language" in argv else None
    model_name = argv[argv.index("--model") + 1] if "--model" in argv else "small"
    from faster_whisper import WhisperModel      # imported late so --help / idle checks stay instant
    t0 = time.time()
    model = WhisperModel(model_name, device="cpu", compute_type="int8", download_root=MODELS,
                         cpu_threads=int(os.environ.get("WHISPER_THREADS", "3")), num_workers=1)
    segs_iter, info = model.transcribe(audio, language=lang or None, beam_size=2, vad_filter=True,
                                       condition_on_previous_text=False)
    segs, w_sum, w_tot = [], 0.0, 0.0
    for s in segs_iter:
        d = max(s.end - s.start, 0.01)
        w_sum += s.avg_logprob * d
        w_tot += d
        segs.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(),
                     "avg_logprob": round(s.avg_logprob, 3), "no_speech_prob": round(s.no_speech_prob, 3)})
    res = {"text": " ".join(x["text"] for x in segs).strip(), "language": info.language,
           "language_probability": round(info.language_probability, 3), "duration_s": round(info.duration, 1),
           "avg_logprob": round(w_sum / w_tot, 3) if w_tot else None, "segments": segs, "model": model_name,
           "compute_type": "int8", "elapsed_s": round(time.time() - t0, 1)}
    with open(out, "w") as f:
        json.dump(res, f)
    print(json.dumps({k: res[k] for k in ("language", "duration_s", "avg_logprob", "elapsed_s")}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
