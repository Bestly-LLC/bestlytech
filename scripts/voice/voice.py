#!/usr/bin/env python3
"""Bestly Voice - "Hey Scout" on bestly-pi (W7, wall round 4, 2026-09-28).

  NZXT MINI USB MIC (ALSA alias "scoutmic" -> card name MIC, stable across reboots)
    -> openWakeWord (local, ~3% of one core): custom "hey_scout" model, stock "hey_jarvis" until it exists
    -> wall: listening chime + glow (POST 127.0.0.1:8099/api/voice -> SSE 'voice' -> wall.html)
    -> record until silence (Silero VAD, max 12 s)
    -> voice-ask edge function (Home Hub agent key): Groq Whisper speech-to-text + Scout on the free LLM ladder
    -> Piper TTS on the Pi -> MP3 -> Desk HomePod through Home Assistant (projector speaker if that fails)
    -> reply card on the wall for ~10 s.

Privacy: the spoken request is sent once for transcription and never written to disk. Only the ~2 s around each
wake word is kept (clips/, last 10, deleted after 24 h) so the wake word can be retuned.
Gates: admin switch state.voice.on, Do Not Disturb (same rules as the page and watchdog), away from home.
Health: status.json every 10 s; /opt/bestly/wall/watchdog.py (voice_watch) restarts the service and tells Scout.
"""
import base64, collections, glob, io, json, os, random, re, string, subprocess, threading, time, urllib.request, wave
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from scipy.signal import firwin, lfilter

ROOT = "/opt/bestly/voice"
WALL = "/opt/bestly/wall"
CLIPS, MEDIA = ROOT + "/clips", ROOT + "/media"
STATUS, WAKES, TUNING = ROOT + "/status.json", ROOT + "/wakes.jsonl", ROOT + "/tuning.json"
MIC = os.environ.get("VOICE_MIC", "scoutmic")
PORT = 8097
HA_URL = "http://127.0.0.1:8123"
SPEAKER = "media_player.desk"
PI_LAN = "192.168.1.211"
SR, RATE_IN = 16000, 48000
CHUNK = 1280                                   # 80 ms at 16 kHz (openWakeWord frame)
PRE_S, MAX_S, START_S, SIL_S = 2.0, 12.0, 5.0, 0.9
# threshold per sensitivity; tuning.json can override per model ({"hey_scout": {"normal": 0.55}})
SENS = {"hey_scout": {"low": 0.85, "normal": 0.7, "high": 0.5}, "hey_jarvis": {"low": 0.7, "normal": 0.5, "high": 0.35}}
# consecutive 80 ms frames over the threshold before it counts. hey_scout v2 on 10.7 h of openWakeWord's validation
# audio: 0.47 false wakes/h at 0.7 (1 frame), 0 with 2 frames; 93% recall on held-out synthetic clips (85% with 2).
# One frame + the cloud check (Whisper must hear "hey scout" in the pre-roll) keeps recall up without spoken false replies.
PATIENCE = {"hey_scout": 1, "hey_jarvis": 1}
FALSE_PER_HOUR_RETUNE = 6

os.makedirs(CLIPS, exist_ok=True)
os.makedirs(MEDIA, exist_ok=True)


def log(*a):
    print(datetime.now().strftime("%-I:%M:%S %p"), *a, flush=True)


def jload(p, d):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return d


def jsave(p, d):
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, p)


def cfg():
    return jload(WALL + "/.report.json", {})


def ha_token():
    try:
        for line in open("/home/pi/scripts/.env"):
            if line.startswith("HA_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        return ""
    return ""


def http_json(url, data=None, headers=None, timeout=10, method=None):
    req = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(),
                                 headers={"Content-Type": "application/json", **(headers or {})}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


# ---------------------------------------------------------------- settings + gates
def dnd_eval(d):
    """Same rules as server.py dnd_now(), watchdog.py dnd_eval() and wall.html dndNow()."""
    try:
        d = d if isinstance(d, dict) else {"on": True, "from": "22:30", "to": "07:00"}
        o = d.get("override")
        if isinstance(o, dict) and o.get("mode") in ("on", "off") and isinstance(o.get("until"), (int, float)) and o["until"] > time.time() * 1000:
            return o["mode"] == "on", "override"
        if d.get("on") is False:
            return False, "off"

        def hm(s, dflt):
            m = re.match(r"^([01][0-9]|2[0-3]):([0-5][0-9])$", str(s or ""))
            return int(m.group(1)) * 60 + int(m.group(2)) if m else dflt
        f, t = hm(d.get("from"), 1350), hm(d.get("to"), 420)
        n = datetime.now()
        cur = n.hour * 60 + n.minute
        return (False if f == t else (f <= cur < t) if f < t else (cur >= f or cur < t)), "schedule"
    except Exception:
        return False, "error"


def settings():
    st = jload(WALL + "/state.json", {})
    st = st.get("state", st) if isinstance(st, dict) else {}
    v = st.get("voice") if isinstance(st.get("voice"), dict) else {}
    sens = v.get("sensitivity") if v.get("sensitivity") in ("low", "normal", "high") else "normal"
    dnd_on, dnd_why = dnd_eval(st.get("dnd"))
    pres = jload(WALL + "/presence.json", {})
    return {"on": v.get("on") is not False, "sensitivity": sens, "dnd": dnd_on, "dnd_why": dnd_why,
            "away": pres.get("where") == "away", "sound": st.get("sound") is not False}


# ---------------------------------------------------------------- status shared with the watchdog + admin
S = {"started": time.time(), "mic_ok": False, "mic_err": None, "model": None, "threshold": None, "busy": False,
     "last_wake": None, "last_heard": None, "errors": {"stt": [], "llm": [], "tts": [], "play": [], "mic": []},
     "events": [], "lat": None, "near": [], "retuned": None, "frames": 0}


def ev_add(kind):
    S["events"].append((time.time(), kind))
    S["events"] = [e for e in S["events"] if time.time() - e[0] < 3600]


def err_add(kind, msg):
    S["errors"][kind] = [e for e in S["errors"][kind] if time.time() - e[0] < 3600] + [(time.time(), str(msg)[:160])]
    log(f"error {kind}: {msg}")


def status_write(extra=None):
    se = settings()
    cnt = collections.Counter(k for t, k in S["events"] if time.time() - t < 3600)
    d = {"at": time.time(), "pid": os.getpid(), "mic_ok": S["mic_ok"], "mic_err": S["mic_err"], "model": S["model"],
         "threshold": S["threshold"], "sensitivity": se["sensitivity"], "on": se["on"], "dnd": se["dnd"], "away": se["away"],
         "busy": S["busy"], "last_wake": S["last_wake"], "last_heard": S["last_heard"], "lat": S["lat"], "retuned": S["retuned"],
         "frames": S["frames"],
         "errors": {k: [e for e in v if time.time() - e[0] < 3600][-5:] for k, v in S["errors"].items()},
         "hour": {"wakes": cnt["wake"], "commands": cnt["command"], "false": cnt["empty"] + cnt["junk"],
                  "ignored": cnt["ignored"], "near": len([n for n in S["near"] if time.time() - n[0] < 3600])}}
    if extra:
        d.update(extra)
    try:
        jsave(STATUS, d)
    except Exception as e:
        log("status write failed", e)
    return d


def status_loop():
    n = 0
    while True:
        try:
            d = status_write()
            n += 1
            if n % 30 == 3:                     # 30 s after start (mic + model up), then every ~5 min: tell the admin card
                threading.Thread(target=edge, args=({"op": "status", "status": slim_status(d)},), daemon=True).start()
            prune_clips()
        except Exception as e:
            log("status loop", e)
        time.sleep(10)


def slim_status(d):
    return {k: d.get(k) for k in ("mic_ok", "mic_err", "model", "threshold", "sensitivity", "on", "dnd", "away", "hour", "lat", "retuned")} | \
           {"errors": {k: len(v) for k, v in (d.get("errors") or {}).items()}}


def prune_clips():
    fs = sorted(glob.glob(CLIPS + "/*.wav"))
    for i, f in enumerate(fs):
        if i < len(fs) - 10 or time.time() - os.path.getmtime(f) > 24 * 3600:
            try:
                os.remove(f)
            except Exception:
                pass
    for f in glob.glob(MEDIA + "/*.wav"):
        if time.time() - os.path.getmtime(f) > 600:
            try:
                os.remove(f)
            except Exception:
                pass


def wake_log(rec):
    try:
        with open(WAKES, "a") as f:
            f.write(json.dumps(rec) + "\n")
        if os.path.getsize(WAKES) > 400_000:
            lines = open(WAKES).read().splitlines()[-1500:]
            open(WAKES, "w").write("\n".join(lines) + "\n")
    except Exception as e:
        log("wake log", e)


# ---------------------------------------------------------------- cloud + wall + speaker
def edge(body, timeout=12):
    c = cfg()
    if not c.get("supabase_url") or not c.get("agent_key"):
        raise RuntimeError("no .report.json")
    return http_json(c["supabase_url"].rstrip("/") + "/functions/v1/voice-ask", body, {"x-api-key": c["agent_key"]}, timeout=timeout)


def wall(phase, **kw):
    try:
        http_json("http://127.0.0.1:8099/api/voice", {"phase": phase, **kw}, timeout=3)
    except Exception as e:
        log("wall event failed", phase, str(e)[:80])


def ctx():
    """A small live snapshot for Scout: what the wall already knows (weather, next events, planes, now playing)."""
    out = {"now": datetime.now().strftime("%A %B %-d, %-I:%M %p"), "where": "733 N Kings Rd, West Hollywood (home)"}
    try:
        d = http_json("http://127.0.0.1:8099/api/data", timeout=4) or {}
        w = d.get("weather") or {}
        if w:
            hrs = []
            for h in (w.get("hourly") or [])[:14:2]:
                try:
                    t = datetime.fromisoformat(h["t"].replace("Z", "+00:00")).astimezone().strftime("%-I %p")
                except Exception:
                    t = h.get("t")
                hrs.append(f"{t} {h.get('temp_f')}F {h.get('code')}{' rain ' + str(h.get('pop')) + '%' if h.get('pop') else ''}")
            out["weather"] = {"now": f"{w.get('temp_f')}F, feels {w.get('feels_f')}F, {w.get('condition')}", "next_hours": hrs,
                              **{k: w[k] for k in ("daily", "high_f", "low_f", "uv", "aqi", "sunset", "sunrise") if w.get(k) is not None}}
            if isinstance(out["weather"].get("daily"), list):
                out["weather"]["daily"] = out["weather"]["daily"][:3]
        cal = d.get("calendar")
        if isinstance(cal, dict):
            cal = cal.get("events") or cal.get("items")
        if isinstance(cal, list):
            out["calendar_next"] = [{k: e.get(k) for k in ("title", "start", "end", "where", "location") if e.get(k)} for e in cal[:5] if isinstance(e, dict)]
        for k in ("trip", "media", "scout_items"):
            if d.get(k):
                out[k] = d[k]
        if d.get("home"):
            h = d["home"]
            out["home"] = {k: h[k] for k in list(h)[:12]} if isinstance(h, dict) else h
    except Exception as e:
        out["wall_data_error"] = str(e)[:80]
    try:
        a = http_json("http://127.0.0.1:8099/api/air", timeout=3) or {}
        ac = a.get("list") or a.get("aircraft") or []
        if isinstance(ac, list) and ac:
            def dist(p):
                return p.get("dst") if isinstance(p.get("dst"), (int, float)) else 99
            near = sorted([p for p in ac if isinstance(p, dict)], key=dist)[:3]
            out["planes_overhead"] = {"count": len(ac), "closest": [
                {**{k: p.get(k) for k in ("cs", "airline", "model", "owner", "alt", "gs", "from", "to", "area", "news", "police") if p.get(k) not in (None, "")},
                 "miles_away": round(p["dst"] * 1.15, 1) if isinstance(p.get("dst"), (int, float)) else None, "alt_unit": "ft", "gs_unit": "knots"}
                for p in near]}
    except Exception:
        pass
    s = json.dumps(out, default=str)
    if len(s) > 6000:
        for k in ("home", "media", "scout_items", "trip"):
            out.pop(k, None)
            if len(json.dumps(out, default=str)) <= 6000:
                break
    return out


_voice = None
_voice_lock = threading.Lock()


def say_clean(t):
    """Symbols Piper reads badly -> words."""
    t = re.sub(r"\s*°\s*F\b", " degrees", t)
    t = t.replace("°", " degrees").replace("%", " percent").replace("&", " and ")
    t = re.sub(r"\bmph\b", "miles per hour", t)
    t = re.sub(r"\b(\d{1,2}):00\s*(AM|PM)\b", r"\1 \2", t)
    return re.sub(r"\s+", " ", t).strip()


def piper_voice():
    global _voice
    from piper import PiperVoice
    with _voice_lock:
        if _voice is None:
            _voice = PiperVoice.load(ROOT + "/tts/en_US-lessac-medium.onnx")
    return _voice


def tts(text):
    """Piper (en_US-lessac-medium, loaded once at start) -> WAV with 0.3 s of silence around it (AirPlay clips the start)."""
    v = piper_voice()
    buf = io.BytesIO()
    with _voice_lock:
        with wave.open(buf, "wb") as w:
            v.synthesize_wav(say_clean(text), w)
    with wave.open(io.BytesIO(buf.getvalue())) as w:
        sr, ch, sw, frames = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.readframes(w.getnframes())
    pad = b"\x00" * int(sr * 0.3) * ch * sw
    # server.py's relay holds ~4 s of MP3 back before the first byte and (as of 4:25 PM Sep 28) drops a clip that ends
    # sooner, so a short reply is padded with silence to 5 s. A file converts faster than real time: no added delay.
    speech = len(frames) / (sr * ch * sw)
    tail = pad + b"\x00" * max(0, int(sr * (5.0 - speech - 0.6))) * ch * sw
    name = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(12))
    path = f"{MEDIA}/{name}.wav"
    with wave.open(path, "wb") as w:
        w.setnchannels(ch); w.setsampwidth(sw); w.setframerate(sr)
        w.writeframes(pad + frames + tail)
    return name, speech + 0.6


def ha(domain, service, data, timeout=8):
    req = urllib.request.Request(f"{HA_URL}/api/services/{domain}/{service}", data=json.dumps(data).encode(),
                                 headers={"Authorization": "Bearer " + ha_token(), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def ha_state(eid):
    req = urllib.request.Request(f"{HA_URL}/api/states/{eid}", headers={"Authorization": "Bearer " + ha_token()})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def speak(name, dur):
    """Desk HomePod through W3's helper (server.py homepod_play: relay -> plain MP3, pauses + resumes the radio/ATC,
    restores the volume). Returns seconds until the HomePod reports 'playing'; raises if it never does."""
    t0 = time.time()
    vol = None
    try:
        lvl = (ha_state(SPEAKER).get("attributes") or {}).get("volume_level")
        if isinstance(lvl, (int, float)) and lvl < 0.15:
            vol = 0.3                                      # nearly muted: make the reply audible, restored after
    except Exception:
        pass
    r = http_json("http://127.0.0.1:8099/api/homepod", {"src": f"{MEDIA}/{name}.wav", "name": "scout", "seconds": max(dur, 5.0) + 0.5,
                                                           **({"volume": vol} if vol else {})}, timeout=12)
    if not (r or {}).get("ok"):
        raise RuntimeError(f"homepod helper: {(r or {}).get('msg')}")
    for _ in range(40):                                    # confirm it started
        try:
            if ha_state(SPEAKER).get("state") == "playing":
                return time.time() - t0
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError("HomePod never started playing")


class Media(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        m = re.match(r"^/v/([a-z0-9]{12})\.(wav)$", self.path)
        ip = self.client_address[0]
        if not m or not (ip.startswith("127.") or ip.startswith("192.168.")):
            self.send_response(404)
            self.end_headers()
            return
        p = f"{MEDIA}/{m.group(1)}.{m.group(2)}"
        if not os.path.isfile(p):
            self.send_response(404)
            self.end_headers()
            return
        data = open(p, "rb").read()
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


# ---------------------------------------------------------------- one conversation turn
JUNK = re.compile(r"^\W*(thank you\.?|thanks for watching!?|you|bye\.?|\.+|okay\.?)?\W*$", re.I)


def handle(pcm, wake):
    """pcm: int16 16 kHz mono of the request (after the wake word). Runs in a worker thread."""
    t_end = time.time()
    lat = {}
    outcome, heard, reply = "command", "", ""
    try:
        wall("thinking")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        t0 = time.time()
        # a slow answer (Scout looking something up) gets a short "one sec" on the speaker after 7 s
        filler = threading.Timer(7.0, lambda: _filler())
        filler.daemon = True
        filler.start()
        try:
            r = edge({"op": "ask", "audio_b64": base64.b64encode(buf.getvalue()).decode(), "ctx": ctx(), "wake": wake}, timeout=60)
        except Exception as e:
            err_add("llm", e)
            r = None
        filler.cancel()
        lat["cloud"] = round(time.time() - t0, 2)
        if not r or not r.get("ok"):
            kind = (r or {}).get("stage") or "llm"
            if r:
                err_add(kind if kind in S["errors"] else "llm", r.get("error") or "no answer")
            outcome = "error"
            reply = "Sorry, I couldn't reach Scout just now."
        else:
            lat.update({k: round(v / 1000, 2) for k, v in (r.get("ms") or {}).items() if isinstance(v, (int, float))})
            heard = (r.get("text") or "").strip()
            reply = (r.get("reply") or "").strip()
            if not heard or JUNK.match(heard):
                outcome = "junk" if heard or r.get("rejected") else "empty"
        if outcome in ("empty", "junk"):
            wall("idle")
            return outcome, heard
        t1 = time.time()
        try:
            name, dur = tts(reply[:600])
        except Exception as e:
            err_add("tts", e)
            wall("reply", heard=heard, reply=reply, hold=12)
            return outcome, heard
        lat["tts"] = round(time.time() - t1, 2)
        wall("reply", heard=heard, reply=reply, hold=max(10, min(30, dur + 4)))
        try:
            lat["play_start"] = round(speak(name, dur), 2)
            where = "homepod"
        except Exception as e:
            err_add("play", e)
            where = "wall"                       # projector speaker fallback: the page plays the WAV
            wall("reply", heard=heard, reply=reply, hold=max(10, min(30, dur + 4)), audio=f"http://{PI_LAN}:{PORT}/v/{name}.wav")
        lat["total_to_audio"] = round(time.time() - t_end, 2)
        lat["speaker"] = where
        time.sleep(min(dur + 1.0, 30))           # don't hear ourselves: stay busy while the reply plays
        return outcome, heard
    finally:
        S["lat"] = lat
        if heard or reply:
            S["last_heard"] = {"text": heard, "reply": reply, "at": time.time(), "outcome": outcome}
        ev_add(outcome)
        log(f"turn: {outcome} heard={heard!r} reply={reply[:80]!r} lat={lat}")
        rec = {"at": time.time(), "kind": "turn", "outcome": outcome, "score": wake.get("score"), "model": wake.get("model"), "lat": lat}
        wake_log(rec)


def _filler():
    try:
        name, dur = tts(random.choice(["One sec, checking.", "Let me look.", "Checking now."]))
        speak(name, dur)
    except Exception as e:
        log("filler failed", str(e)[:80])


# ---------------------------------------------------------------- audio + wake loop
def mic_present():
    try:
        return "NZXT" in open("/proc/asound/cards").read()
    except Exception:
        return False


def load_model():
    """The custom "hey_scout" model when it's installed; the stock "hey_jarvis" stays on next to it as a backup wake word
    until tuning.json says {"also_jarvis": false} (both share one feature extractor: ~1% CPU more)."""
    from openwakeword.model import Model
    custom = ROOT + "/models/hey_scout.onnx"
    jarvis = os.path.join(os.path.dirname(__import__("openwakeword").__file__), "resources", "models", "hey_jarvis_v0.1.onnx")
    paths = ([custom] if os.path.isfile(custom) else []) + ([jarvis] if not os.path.isfile(custom) or jload(TUNING, {}).get("also_jarvis", True) else [])
    m = Model(wakeword_models=paths, inference_framework="onnx")
    keys = {k: ("hey_scout" if "scout" in k else "hey_jarvis") for k in m.models}
    return m, keys, "+".join(sorted(set(keys.values()), reverse=True)), (os.path.getmtime(custom) if os.path.isfile(custom) else 0)


def threshold_for(fam, sens):
    t = jload(TUNING, {}).get(fam, {})
    return float(t.get(sens, SENS[fam][sens]))


def retune_if_noisy(fam, sens):
    """Self-heal: too many false wakes in the last hour -> raise the threshold a notch (cap 0.85), tell the watchdog."""
    false_n = len([1 for t, k in S["events"] if time.time() - t < 3600 and k in ("empty", "junk")])
    if false_n < FALSE_PER_HOUR_RETUNE:
        return
    last = (S.get("retuned") or {}).get("at", 0)
    if time.time() - last < 3600:
        return
    tun = jload(TUNING, {})
    cur = threshold_for(fam, sens)
    new = round(min(0.85, cur + 0.05), 2)
    if new <= cur:
        return
    tun.setdefault(fam, {})[sens] = new
    jsave(TUNING, tun)
    S["retuned"] = {"at": time.time(), "from": cur, "to": new, "false_1h": false_n, "sens": sens, "model": fam}
    log(f"retuned {fam}/{sens}: {cur} -> {new} after {false_n} false wakes in an hour")


def main():
    from openwakeword import VAD
    threading.Thread(target=lambda: ThreadingHTTPServer(("0.0.0.0", PORT), Media).serve_forever(), daemon=True).start()
    threading.Thread(target=status_loop, daemon=True).start()
    threading.Thread(target=piper_voice, daemon=True).start()     # load the TTS voice now, not on the first reply
    model, keys, fams, mtime = load_model()
    fam = "hey_scout" if "hey_scout" in fams else "hey_jarvis"
    vad = VAD()
    S["model"] = fams
    log(f"models {list(keys)} ({fams}); mic {MIC}")
    taps = firwin(95, 7200, fs=RATE_IN)        # anti-alias before 48k -> 16k
    zi = np.zeros(len(taps) - 1)
    pre = collections.deque(maxlen=int(PRE_S * SR / CHUNK))
    worker = {"t": None, "until": 0.0}
    last_fire, peak = 0.0, (0.0, 0.0)
    while True:
        if not mic_present():
            S["mic_ok"], S["mic_err"] = False, "NZXT mic not plugged in"
            status_write()
            time.sleep(5)
            continue
        proc = subprocess.Popen(["arecord", "-q", "-D", MIC, "-f", "S16_LE", "-r", str(RATE_IN), "-c", "1", "-t", "raw"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        S["mic_ok"], S["mic_err"] = True, None
        log("mic open")
        rec, rec_t0, speech_at, heard_speech, rec_wake, vad_max, hits = None, 0.0, 0.0, False, {}, 0.0, 0
        rec_lead = np.zeros(0, dtype=np.int16)
        need = CHUNK * 3 * 2
        try:
            while True:
                raw = b""
                while len(raw) < need:
                    b = proc.stdout.read(need - len(raw))
                    if not b:
                        raise IOError((proc.stderr.read() or b"arecord stopped").decode(errors="ignore")[:160])
                    raw += b
                x48 = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
                y, zi = lfilter(taps, 1.0, x48, zi=zi)
                x = np.clip(y[::3], -32768, 32767).astype(np.int16)
                S["frames"] += 1
                now = time.time()
                if S["frames"] % 750 == 0:              # every minute: pick up a newly trained model
                    try:
                        custom = ROOT + "/models/hey_scout.onnx"
                        want_j = jload(TUNING, {}).get("also_jarvis", True)
                        if os.path.isfile(custom) and ("hey_scout" not in fams or os.path.getmtime(custom) != mtime
                                                       or want_j != ("hey_jarvis" in fams)):
                            model, keys, fams, mtime = load_model()
                            S["model"] = fams
                            log(f"switched to {list(keys)} ({fams})")
                    except Exception as e:
                        log("model reload failed", e)
                # --- recording a request
                if rec is not None:
                    rec.append(x)
                    vs = float(vad.predict(x, frame_size=640))
                    vad_max = max(vad_max, vs)
                    if vs > 0.4:
                        speech_at, heard_speech = now, True
                    el = now - rec_t0
                    done = (el > MAX_S) or (not heard_speech and el > START_S) or (heard_speech and now - speech_at > SIL_S and el > 1.2)
                    if done:
                        pcm = np.concatenate([rec_lead] + rec) if rec_wake.get("verify") else np.concatenate(rec)
                        wk = rec_wake
                        rec = None
                        S["busy"] = True
                        if not heard_speech:
                            wall("idle")
                            ev_add("empty")
                            wake_log({"at": now, "kind": "turn", "outcome": "empty", "score": wk.get("score"), "model": wk.get("model"), "vad_max": round(vad_max, 2)})
                            log(f"no speech after the wake word (vad max {vad_max:.2f})")
                            threading.Thread(target=edge, args=({"op": "log", "event": {"kind": "empty", "score": wk.get("score"), "model": wk.get("model")}},), daemon=True).start()
                            S["busy"] = False
                            model.reset()
                            retune_if_noisy(wk.get("model") or fam, settings()["sensitivity"])
                        else:
                            def run(p=pcm, w=wk):
                                try:
                                    handle(p, w)
                                finally:
                                    S["busy"] = False
                                    model.reset()
                                    retune_if_noisy(w.get("model") or fam, settings()["sensitivity"])
                            worker["t"] = threading.Thread(target=run, daemon=True)
                            worker["t"].start()
                    continue
                if S["busy"]:
                    continue
                pre.append(x)
                pr = model.predict(x)
                sc, fam = max((float(pr.get(k_, 0.0)), f_) for k_, f_ in keys.items())
                se = None
                if sc > 0.15:
                    se = settings()
                    thr = threshold_for(fam, se["sensitivity"])
                    S["threshold"] = thr
                    if sc < thr:
                        hits = 0
                        if sc > peak[1]:
                            peak = (now, sc)
                        continue
                    hits += 1
                    if hits < PATIENCE.get(fam, 1):
                        continue
                    hits = 0
                    if now - last_fire < 2.0:
                        continue
                    last_fire = now
                    # verify: the cloud checks Whisper heard "hey scout" in the ~1.6 s before the wake (custom model only)
                    wake = {"score": round(sc, 3), "model": fam, "threshold": thr, "at": now, "verify": fam == "hey_scout"}
                    lead = np.concatenate(list(pre)[-20:]) if pre else np.zeros(0, dtype=np.int16)
                    clip = f"{CLIPS}/{datetime.now().strftime('%Y%m%d-%H%M%S')}_{int(sc * 100)}.wav"
                    try:
                        with wave.open(clip, "wb") as w:
                            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
                            w.writeframes(np.concatenate(list(pre)).tobytes())
                    except Exception:
                        pass
                    why = None if se["on"] else "muted"
                    why = why or ("dnd" if se["dnd"] else None) or ("away" if se["away"] else None)
                    S["last_wake"] = {"at": now, "score": round(sc, 3), "ignored": why}
                    ev_add("wake")
                    if why:
                        ev_add("ignored")
                        wake_log({"at": now, "kind": "wake", "outcome": "ignored", "why": why, "score": round(sc, 3), "model": fam, "threshold": thr})
                        threading.Thread(target=edge, args=({"op": "log", "event": {"kind": "ignored", "why": why, "score": round(sc, 3), "model": fam}},), daemon=True).start()
                        log(f"wake {sc:.2f} ignored ({why})")
                        model.reset()
                        continue
                    log(f"wake {sc:.2f} (thr {thr})")
                    wake_log({"at": now, "kind": "wake", "outcome": "listen", "score": round(sc, 3), "model": fam, "threshold": thr})
                    wall("listening", chime=se["sound"])
                    rec, rec_t0, speech_at, heard_speech, rec_wake, vad_max, rec_lead = [], now, 0.0, False, wake, 0.0, lead
                    vad.reset_states()
                else:
                    hits = 0
                if sc <= 0.15 and peak[1] >= 0.3 and now - peak[0] > 1.5:
                    S["near"] = [n for n in S["near"] if now - n[0] < 3600] + [peak]    # near misses, for tuning
                    wake_log({"at": peak[0], "kind": "near", "score": round(peak[1], 3), "model": fam})
                    peak = (0.0, 0.0)
        except Exception as e:
            err_add("mic", e)
            S["mic_ok"], S["mic_err"] = False, str(e)[:160]
            try:
                proc.kill()
            except Exception:
                pass
            wall("idle")
            time.sleep(3)


if __name__ == "__main__":
    main()
