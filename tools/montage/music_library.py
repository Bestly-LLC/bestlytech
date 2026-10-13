#!/usr/bin/env python3
"""Montage music library: the starter beds (ElevenLabs Music, instrumental, 35 s each). Owner: Spark. Written 2026-10-12.

    music_library.py quote   read the live ElevenLabs balance, price the starter library, check the 30% voice reserve, save the quote to
                             montage_settings 'music_library' and print it. Spends NOTHING (only GET /v1/user/subscription).
    music_library.py run     does NOTHING unless montage_settings 'music_library'.approved is true, i.e. after Jared said yes to Spark's
                             dollar quote and Spark ran  select montage_music_approve(<credits>, <usd>);
                             then it generates every missing bed, normalizes it to -18 LUFS, uploads it to the private 'music' bucket and registers
                             the row. Stops before any generation that would pass the approved credits or break the voice reserve.
                             The approval is single use: it is switched off when the run ends.
    music_library.py list    what is registered.

Jared's rules: Spark quotes a dollar estimate and waits for his yes before EVERY ElevenLabs generation (music included); spend stays inside
the plan's credits; the last reserve_pct (30%) of the plan is Ava's calls and is never touched. The key comes from Vault through pi_secret
('elevenlabs_api_key') and is never printed.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, "/opt/bestly/montage")
import lib  # noqa: E402

EL = "https://api.elevenlabs.io"
LENGTH_S = 35                      # long enough for a 20 to 30 s video; longer videos loop with a crossfade
CREDITS_PER_MIN_LOW, CREDITS_PER_MIN_HIGH = 900, 1250      # public figures (900 per minute; the highest plan-implied rate is about 1,250)
PLAN_USD, PLAN_CREDITS = 99.0, 600_008                     # the live plan: Pro, $99 a month, 600,008 credits (read from the subscription below)
LICENSE = ("Generated with ElevenLabs Music on Bestly's paid plan (Pro). ElevenLabs clears Eleven Music for broad commercial use on paid plans "
           "(posting on the brands' own social accounts, no attribution needed). Instrumental, no vocals.")
COMMON = ("Instrumental background music for a 30 second vertical social video. No vocals, no spoken words, no sound effects. Steady and "
          "loop-friendly: no big drops, no long builds, no sudden silence. Mixed to sit quietly under a narrator. Clean, finished ending.")

# (brand slug, mood, target bpm, what it should sound like). Three per house brand.
PLAN = [
    ("bestly-cloud", "confident", 96, "Confident, modern and steady: a soft electronic pulse, warm synth pads, a light tight kick. Trustworthy tech, not corporate."),
    ("bestly-cloud", "calm", 80, "Calm, spacious and trustworthy: slow ambient piano, soft pads, gentle texture. Quiet confidence."),
    ("bestly-cloud", "warm", 100, "Warm, friendly and optimistic: acoustic guitar and soft keys with brushed percussion. A small business that feels looked after."),
    ("inventoryproof", "calm", 78, "Calm and reassuring: soft piano and gentle strings, slow and safe. The feeling of everything being in order."),
    ("inventoryproof", "warm", 96, "Warm and homey: acoustic guitar, light hand claps, soft bass. Cozy and friendly."),
    ("inventoryproof", "upbeat", 110, "Bright, light and upbeat: plucked synth, soft drums, a hopeful feel-good groove."),
    ("cookie-yeti", "playful", 108, "Playful and quirky: pizzicato strings, marimba, light claps and a bouncy bass. A bit cheeky."),
    ("cookie-yeti", "upbeat", 112, "Bouncy indie-pop: ukulele, hand claps, bright bells and a happy steady beat."),
    ("cookie-yeti", "warm", 86, "Cozy and mellow lo-fi: dusty drums, soft electric piano, a relaxed late-night feel."),
    ("hoku", "warm", 84, "Soft, airy and sunlit: gentle acoustic guitar, light harp, warm pads. Fresh skincare ritual."),
    ("hoku", "calm", 70, "Spa-like calm: slow soft pads, light chimes, lots of air. Gentle and clean."),
    ("hoku", "playful", 104, "Fresh and light: bright plucks, a gentle shaker, a breezy summery groove."),
    ("bestly-studio", "confident", 104, "Sleek and confident: modern electronic pop, tight drums, a clean bass line. A creative studio at work."),
    ("bestly-studio", "upbeat", 118, "Energetic and creative: bright electronic pop, bouncy synth, driving but light drums."),
    ("bestly-studio", "calm", 82, "Minimal, calm lo-fi: soft keys, quiet beat, relaxed focus."),
]


def _slug(brand, mood):
    return f"{brand}/{brand}-{mood}-{LENGTH_S}s"


def _key():
    k = lib.rpc("pi_secret", p_name="elevenlabs_api_key") or ""
    if not k:
        sys.exit("no ElevenLabs key readable from Vault (pi_secret elevenlabs_api_key)")
    return k


def _sub(key):
    req = urllib.request.Request(EL + "/v1/user/subscription", headers={"xi-api-key": key})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def _settings(k):
    rows = lib.get("montage_settings", f"select=value&key=eq.{k}") or []
    return rows[0]["value"] if rows else {}


def _set_settings(k, value):
    h = {"apikey": lib.KEY, "Content-Type": "application/json", "Prefer": "return=minimal"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    req = urllib.request.Request(f"{lib.URL}/rest/v1/montage_settings?key=eq.{k}", method="PATCH", headers=h,
                                 data=json.dumps({"value": value, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}).encode())
    urllib.request.urlopen(req, timeout=20).read()


def todo():
    have = {r["storage_path"] for r in (lib.get("studio_music_tracks", "select=storage_path&active=eq.true") or [])}
    return [p for p in PLAN if _slug(p[0], p[1]) + ".flac" not in have]


def make_quote(key):
    sub = _sub(key)
    limit, used = int(sub["character_limit"]), int(sub["character_count"])
    reserve_pct = float((_settings("voice") or {}).get("reserve_pct", 30))
    items = todo()
    minutes = len(items) * LENGTH_S / 60
    lo, hi = round(minutes * CREDITS_PER_MIN_LOW), round(minutes * CREDITS_PER_MIN_HIGH)
    usd_per_credit = PLAN_USD / PLAN_CREDITS
    left = limit - used
    reserve = limit * reserve_pct / 100
    q = {"tracks": len(items), "seconds_each": LENGTH_S, "minutes_total": round(minutes, 2),
         "credits_low": lo, "credits_high": hi, "usd_low": round(lo * usd_per_credit, 2), "usd_high": round(hi * usd_per_credit, 2),
         "tier": sub.get("tier"), "plan_credits": limit, "used": used, "left": left,
         "pct_of_left_low": round(100 * lo / left, 2), "pct_of_left_high": round(100 * hi / left, 2),
         "pct_of_plan_high": round(100 * hi / limit, 2),
         "reserve_pct": reserve_pct, "reserve_credits": round(reserve), "left_after_high": left - hi,
         "reserve_ok": (left - hi) >= reserve,
         "reset_unix": sub.get("next_character_count_reset_unix"), "quoted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    return q, sub


def cmd_quote():
    key = _key()
    q, _ = make_quote(key)
    cur = _settings("music_library")
    cur.update({"quote": q})
    _set_settings("music_library", cur)
    print(json.dumps(q, indent=1))
    print(f"\nQuote: {q['tracks']} beds x {LENGTH_S}s = {q['minutes_total']} min of music = {q['credits_low']:,} to {q['credits_high']:,} credits "
          f"(${q['usd_low']:.2f} to ${q['usd_high']:.2f} of the plan), {q['pct_of_left_low']}% to {q['pct_of_left_high']}% of the {q['left']:,} credits left. "
          f"Voice reserve ({q['reserve_credits']:,}) {'kept' if q['reserve_ok'] else 'WOULD BE BROKEN'}.")


def _generate(key, prompt):
    body = {"prompt": prompt, "music_length_ms": LENGTH_S * 1000, "force_instrumental": True}
    req = urllib.request.Request(EL + "/v1/music?output_format=mp3_44100_128", method="POST", data=json.dumps(body).encode(),
                                 headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            ct, data = r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {e.read().decode('utf-8', 'replace')[:200].replace(key, '***')}")
    if not ct.startswith("audio") or len(data) < 50_000:
        raise RuntimeError(f"unexpected answer ({ct}, {len(data)} bytes)")
    return data


def _ff(args, **kw):
    return subprocess.run(["ffmpeg", "-y", "-v", "error"] + args, check=True, timeout=300, **kw)


def _lufs(path):
    r = subprocess.run(["ffmpeg", "-v", "info", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True, timeout=180).stderr
    return float(r.rsplit("Integrated loudness:", 1)[1].split("I:")[1].split("LUFS")[0])


def _dur(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                capture_output=True, text=True, check=True).stdout.strip())


def normalize(mp3, flac, target=-18.0):
    """-18 LUFS integrated with one static gain, peaks held under -1 dBFS, stereo 44.1 kHz FLAC."""
    gain = max(-12.0, min(12.0, target - _lufs(mp3)))
    _ff(["-i", mp3, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=disabled", "-ar", "44100", "-ac", "2", "-c:a", "flac", flac])
    return _lufs(flac), _dur(flac)


def _upload(path, name):
    h = {"apikey": lib.KEY, "Content-Type": "audio/flac", "x-upsert": "true"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    urllib.request.urlopen(urllib.request.Request(f"{lib.URL}/storage/v1/object/music/{name}", data=open(path, "rb").read(), method="POST", headers=h),
                           timeout=180).read()


def _notify(title, body, severity="info"):
    try:
        lib.notify(title, body, severity=severity, push=False, url="/admin/team", dedupe=f"montage.music-library-{time.strftime('%Y-%m-%d-%H%M')}")
    except Exception as e:  # noqa: BLE001
        print("notify failed:", e, flush=True)


def cmd_run():
    st = _settings("music_library")
    if not st.get("approved"):
        print("Not approved: nothing generated. Spark quotes first (music_library.py quote), Jared says yes, then Spark runs "
              "select montage_music_approve(<credits>, <usd>);")
        return 0
    key = _key()
    q, sub = make_quote(key)
    approved = int(st.get("approved_max_credits") or 0)
    if approved < q["credits_high"] and approved < 1:
        sys.exit("approval has no credit amount")
    if not q["tracks"]:
        print("The library already has every starter bed.")
        _set_settings("music_library", {**st, "approved": False})
        return 0
    limit, reserve = q["plan_credits"], q["reserve_credits"]
    start_used = q["used"]
    per_track_high = round(LENGTH_S / 60 * CREDITS_PER_MIN_HIGH)
    done, failed, spent = [], [], 0
    work = tempfile.mkdtemp(prefix="music-lib-")
    for brand, mood, bpm, desc in todo():
        used_now = int(_sub(key)["character_count"])
        if used_now - start_used + per_track_high > approved:
            failed.append(f"{brand}/{mood}: stopped, the next bed could pass the approved {approved:,} credits")
            break
        if limit - used_now - per_track_high < reserve:
            failed.append(f"{brand}/{mood}: stopped, the next bed could dip into the {reserve:,}-credit voice reserve")
            break
        name = _slug(brand, mood)
        prompt = f"{COMMON} {desc} Around {bpm} BPM."
        try:
            data = _generate(key, prompt)           # ONE call per bed, never retried (a retry would charge twice)
        except Exception as e:  # noqa: BLE001
            failed.append(f"{brand}/{mood}: {str(e)[:160]}")
            break                                   # stop on the first failure; Spark looks before anything else is spent
        mp3, flac = f"{work}/{brand}-{mood}.mp3", f"{work}/{brand}-{mood}.flac"
        open(mp3, "wb").write(data)
        try:
            lufs, dur = normalize(mp3, flac)
            _upload(flac, name + ".flac")
            lib.rpc("montage_music_register", p={"name": f"{brand} {mood} {LENGTH_S}s", "brand_slug": brand, "mood": mood, "bpm": bpm,
                                                 "duration_s": round(dur, 2), "storage_path": name + ".flac", "source": "elevenlabs-music",
                                                 "license": LICENSE, "loudness_lufs": round(lufs, 1), "prompt": prompt})
            done.append(f"{brand}/{mood}")
        except Exception as e:  # noqa: BLE001
            failed.append(f"{brand}/{mood}: made but not filed ({str(e)[:140]}); the mp3 is in {work}")
            break
        spent = int(_sub(key)["character_count"]) - start_used
        print(f"{brand}/{mood}: ok {lufs:.1f} LUFS {dur:.1f}s (credits used so far {spent:,})", flush=True)
    spent = int(_sub(key)["character_count"]) - start_used
    st = _settings("music_library")
    st.update({"approved": False, "last_run": {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "made": done, "failed": failed,
                                              "credits_used": spent, "usd": round(spent * PLAN_USD / PLAN_CREDITS, 2)}})
    _set_settings("music_library", st)
    ok = not failed
    _notify(f"Spark: the music library {'is ready' if ok else 'stopped early'}: {len(done)} bed(s) made",
            f"{len(done)} of {len(done) + len(failed) if failed else len(done)} beds made, {spent:,} credits (about ${spent * PLAN_USD / PLAN_CREDITS:.2f}). "
            + ("; ".join(failed)[:300] if failed else "Held videos pick up by themselves."), "success" if ok else "warning")
    print(json.dumps(st["last_run"], indent=1))
    return 0 if ok else 1


def cmd_list():
    for r in lib.get("studio_music_tracks", "select=name,brand_slug,mood,bpm,duration_s,loudness_lufs,source,active&order=brand_slug,mood") or []:
        print(r)


if __name__ == "__main__":
    {"quote": cmd_quote, "run": cmd_run, "list": cmd_list}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
