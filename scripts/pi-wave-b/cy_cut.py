"""cy_cut: automatic cut of approved Centering YOU takes (Spark, Hestia, 2026-10-31).

  run.sh cy_cut                  every 10 min: retry failed uploads, claim ONE approved take, cut it, file it in Studio > Drafts > To review
  run.sh cy_cut --dry            list what is waiting, change nothing
  run.sh cy_cut --only <upload id prefix> [--no-file] [--reuse]
                                 cut one named take. --no-file: render, mix music and make the cover but claim nothing and write nothing to Studio
                                 (output stays in /opt/bestly/cy-cut/out/<ask code>/). --reuse: file the finished files from an earlier --no-file run.
Flow per take: transcript (faster-whisper) -> cy_spec.py (trims, hook, name tag off her face, rotating corner, claim rules) -> render_cy.py (recut-kit v4
fresh renderer, weekly fresh-design gate) -> cy_mix.py (music bed ducked under her voice) -> cy_cover.py (splash cover from her approved headshots) ->
upload to the review bucket -> cy_cut_file() (approval item, stage internal, internal_status pending, Spark note) -> studio_take_edit_done().
Never sends to the client, never approves, never posts. Every write is signed Spark. Off switch: touch /opt/bestly/cron/state/cy_cut.OFF
Undo: remove the cron line; tables stay. Code: /opt/bestly/cy-cut/lib, kit: /opt/bestly/cy-cut/kit. Watchdog: pi_jobs cy_cut (30 min) + studio_cycut_watch() (pg_cron), alerts studio:cycut.* owned by Spark.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

import lib

BASE = "/opt/bestly/cy-cut"
VPY = BASE + "/venv/bin/python"
WPY = "/mnt/ssd/whisper-stt/venv/bin/python"
WORKER = "cy_cut@hestia"
STATE = "/opt/bestly/cron/state/cy_cut.json"
OFF = "/opt/bestly/cron/state/cy_cut.OFF"
OUT = BASE + "/out"
CACHE = BASE + "/cache"
KITART = BASE + "/kit/fresh/assets/art"
CLIENT = "centering-you"
UA = {"User-Agent": "bestly-pi-cron/1.0 (cy_cut)"}
V3_OFF = "/opt/bestly/cron/state/cy_cut_v3.OFF"      # v3 (2026-10-31): centeringyou.com end card + TikTok-only cart beat; touch this file to go back to the v2 look
ENDCARD = BASE + "/lib/cy_endcard.py"
ENDCUSTOM = BASE + "/lib/cy_endcard_custom.py"
V4_OFF = "/opt/bestly/cron/state/cy_cut_v4.OFF"      # v4 (2026-11-01): layout step + custom graphics + custom end card; touch this file to go back to the v3 look
RETIRED_ENDS = {"fan"}                               # the end-card family that shows the cards with their bottoms cut off: never picked (Jared, 2026-11-01)
OPTS = {}                                            # per-run options from the command line: shape, kinds, why
TIKTOK_BEAT_TEXT = "Get the deck: tap the orange shopping cart"


# ---------------------------------------------------------------------------------------------- small helpers
def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def state():
    try:
        return json.load(open(STATE))
    except Exception:  # noqa: BLE001
        return {}


def save_state(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(s, open(STATE, "w"), indent=1)


def run(cmd, timeout, cwd=None, env=None):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd, env=env)
    if p.returncode != 0:
        tail = ((p.stderr or "") + (p.stdout or ""))[-700:]
        raise RuntimeError(f"{os.path.basename(str(cmd[1] if len(cmd) > 1 else cmd[0]))} exit {p.returncode}: {tail}")
    return p.stdout


def sget(bucket, path, dest, tries=3):
    """private storage object -> file, 3 tries, partial file never kept"""
    last = None
    for i in range(tries):
        tmp = dest + ".part"
        try:
            h = {"apikey": lib.KEY, "Authorization": "Bearer " + lib.KEY, **UA}
            with urllib.request.urlopen(urllib.request.Request(f"{lib.URL}/storage/v1/object/{bucket}/{path}", headers=h), timeout=180) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            os.replace(tmp, dest)
            return dest
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"download {bucket}/{path[:60]} failed after {tries} tries: {last}")


def supload(path, local, ctype):
    h = {"apikey": lib.KEY, "Authorization": "Bearer " + lib.KEY, "Content-Type": ctype, "x-upsert": "true", **UA}
    with open(local, "rb") as f:
        req = urllib.request.Request(f"{lib.URL}/storage/v1/object/review/{path}", data=f, method="POST", headers={**h, "Content-Length": str(os.path.getsize(local))})
        urllib.request.urlopen(req, timeout=600).read()
    url = f"{lib.URL}/storage/v1/object/public/review/{path}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        r.read(2048)
    return url


def raise_alert(key, kind, title, body):
    try:
        lib.rpc("bestly_raise", p_key=key, p_kind=kind, p_severity="warning", p_title=title, p_body=body, p_area="studio", p_needs_jared=None, p_healed=False)
    except Exception as e:  # noqa: BLE001
        log("alert failed:", e)


# ---------------------------------------------------------------------------------------------- 1. retry failed uploads
def retry_failed(st):
    n = 0
    for u in lib.get("client_uploads", "status=eq.failed&purpose=eq.ask&select=id,error") or []:
        k = st.setdefault("retries", {}).get(u["id"], 0)
        if k >= 3:
            continue
        st["retries"][u["id"]] = k + 1
        lib._req("PATCH", f"/rest/v1/client_uploads?id=eq.{u['id']}", {"status": "ready", "error": None})
        n += 1
        log("failed upload", u["id"][:8], "set back to ready (try", k + 1, "of 3):", (u.get("error") or "")[:80])
    return n


# ---------------------------------------------------------------------------------------------- weekly design
def pick_design():
    week = lib.rpc("studio_design_iso_week")
    wk = lib.rpc("studio_design_week_check", p_client=CLIENT, p_week=week) or {}
    minted = False
    if not wk.get("ok"):
        from jobs import cy_fresh  # mint the way cy_fresh does (Monday 5:50 AM job), with ledger rows
        log("no fresh design batch for", week, "->", str(cy_fresh.make(["--client", CLIENT, "--week", week]))[:160])
        minted = True
    rows = lib.get("studio_design_ledger", f"client_slug=eq.{CLIENT}&iso_week=eq.{week}&status=in.(planned,used)&select=component,fingerprint,family,palette,params,item_codes") or []
    corners = sorted([r for r in rows if r["component"] == "corner_graphic"], key=lambda r: (len(r["item_codes"] or []), r["fingerprint"]))
    tags = sorted([r for r in rows if r["component"] == "name_tag"], key=lambda r: (len(r["item_codes"] or []), r["fingerprint"]))
    for c in corners:
        for t in tags:
            g = lib.rpc("studio_design_gate", p_client=CLIENT, p_week=week, p_corner_fp=c["fingerprint"], p_tag_fp=t["fingerprint"]) or {}
            if g.get("ok"):
                return {"client": CLIENT, "week": week, "corner": {"params": c["params"], "fingerprint": c["fingerprint"], "family": c["family"], "palette": c["palette"]},
                        "tag": {"params": t["params"], "fingerprint": t["fingerprint"], "family": t["family"], "palette": t["palette"]}, "minted": minted}
    raise RuntimeError(f"no usable design pair for {week} (gate said no)")


# ---------------------------------------------------------------------------------------------- library assets
def library_assets(seed):
    os.makedirs(CACHE + "/assets", exist_ok=True)
    sys.path.insert(0, BASE + "/lib")
    import cy_cardcheck as CC
    names = CC.usable_cards({"11": "c11c.png", "19": "c19a-flat.png", "29": "c29c.png", "36": "c36c.png"})      # v5: cards that fail the straight-edge check are never picked
    cards = {k: f"{KITART}/{n}" for k, n in names.items()}
    rows = lib.get("client_uploads", f"client_id=eq.{lib.get('approval_clients', 'slug=eq.' + CLIENT + '&select=id')[0]['id']}&purpose=eq.asset&status=eq.ready&asset_kind=eq.photo"
                   "&tags=ov.{lifestyle,corner-photo,fan,styled,deck}&select=id,path,title,tags,width,height&limit=60") or []
    bad = {"broll", "event", "people", "branded", "spanish", "portrait", "elizabeth", "bagtag", "listing", "source", "product-shot"}
    ok = [r for r in rows if not (set(r.get("tags") or []) & bad) and (r.get("width") or 0) >= 900]
    ok.sort(key=lambda r: hashlib.md5((str(seed) + r["id"]).encode()).hexdigest())
    photos = []
    for r in ok[:6]:
        dest = f"{CACHE}/assets/{r['id']}{os.path.splitext(r['path'])[1]}"
        if not os.path.exists(dest):
            sget("client-media", r["path"], dest)
        photos.append({"path": dest, "title": r["title"]})
    return cards, photos


def pick_ending(st, want=None):
    sp = bool(OPTS.get("spanish"))                      # cy_recut (2026-11-02): a Spanish-deck video keeps a Spanish end card
    rows = lib.get("client_uploads", "purpose=eq.asset&status=eq.ready&asset_kind=eq.endcard&tags=cs." + ("{animated,spanish}" if sp else "{animated,default}") + "&select=id,path,title,tags") or []
    rows = [r for r in rows if not ({"trade", "retired"} & set(r.get("tags") or [])) and (sp or "spanish" not in (r.get("tags") or []))]
    rows = [r for r in rows if not (re.search(r"(" + "|".join(RETIRED_ENDS) + r")(?:\s*·\s*centrada en ti)?\s*$", (r["title"] or "").lower()))]
    rows.sort(key=lambda r: r["title"])
    if not rows:
        return None, None
    last = st.get("last_ending")
    nxt = next((r for r in rows if r["title"] > (last or "")), rows[0])
    if want:
        nxt = next(r for r in rows if re.search(r"\b" + want + r"\b", r["title"].lower()))
    dest = f"{CACHE}/assets/{nxt['id']}.mp4"
    if not os.path.exists(dest):
        sget("client-media", nxt["path"], dest)
    st["last_ending"] = nxt["title"]
    return dest, nxt["title"]


def pick_bed(st):
    rows = lib.get("studio_music_tracks", f"brand_slug=eq.{CLIENT}&active=eq.true&select=id,name,storage_path,mood,bpm,loudness_lufs") or []
    if not rows:
        raise RuntimeError("no centering-you music beds registered")
    used = st.setdefault("beds", [])
    rows.sort(key=lambda r: (used.index(r["id"]) if r["id"] in used else -1, r["name"]))
    bed = rows[0]
    os.makedirs(CACHE + "/music", exist_ok=True)
    dest = f"{CACHE}/music/{bed['id']}.flac"
    if not os.path.exists(dest):
        sget("music", bed["storage_path"], dest)
    used[:] = [x for x in used if x != bed["id"]] + [bed["id"]]
    return bed, dest


# ---------------------------------------------------------------------------------------------- v3: end card + TikTok cart beat
def v3_on():
    return not os.path.exists(V3_OFF)


def v4_on():
    return v3_on() and not os.path.exists(V4_OFF)


def end_style(name):
    m = re.search(r"(dots|fan|shelf|stack|swell)(?:\s*·\s*centrada en ti)?\s*$", (name or "").lower())
    if not m:
        raise RuntimeError(f"end card style not recognised from title {name!r}")
    if m.group(1) in RETIRED_ENDS:
        raise RuntimeError(f"end card style {m.group(1)!r} is retired")
    return m.group(1)


def endcard_v3(ending, name):
    """library end title -> same card with a centeringyou.com pill (modern sans, safe zone) held on screen; cached per card"""
    style = end_style(name)
    out = ending[:-4] + ".cy-v3.mp4"
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(ENDCARD):
        log(run([VPY, ENDCARD, "end", ending, out + ".tmp.mp4", style], 900).strip()[-200:])
        os.replace(out + ".tmp.mp4", out)
    return out, style


def endcard_custom(plan, wd):
    """custom end card for THIS video: its palette + the motif of its graphic + the deck shot + animated title + centeringyou.com pill"""
    pj = wd + "/endcard_plan.json"
    json.dump(plan, open(pj, "w"))
    out = wd + "/endcard_custom.mp4"
    log(run([VPY, ENDCUSTOM, "build", pj, out], 900).strip()[-200:])
    return out


def cart_beat():
    out = CACHE + "/cart-beat-v3.mp4"
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(ENDCARD):
        run([VPY, ENDCARD, "beat", out + ".tmp.mp4", "3.4"], 600)
        os.replace(out + ".tmp.mp4", out)
    return out


# ---------------------------------------------------------------------------------------------- the cut
def fetch_raw(t, wd):
    raw = f"{wd}/raw.mov"
    if os.path.exists(raw):
        return raw
    parts = int(t.get("parts") or 1)
    with open(raw + ".tmp", "wb") as out:
        for i in range(parts):
            tmp = f"{wd}/p{i}.bin"
            for cand in ([f"{t['path']}.part{i}"] if parts > 1 else [t["path"], f"{t['path']}.part0"]):
                try:
                    sget(t["bucket"], cand, tmp)
                    break
                except RuntimeError:
                    if cand == ([f"{t['path']}.part{i}"] if parts > 1 else [t["path"], f"{t['path']}.part0"])[-1]:
                        raise
            with open(tmp, "rb") as f:
                shutil.copyfileobj(f, out, 1 << 20)
            os.remove(tmp)
    os.replace(raw + ".tmp", raw)
    return raw


def frames(video, od, prefix="", extra=()):
    os.makedirs(od + "/frames", exist_ok=True)
    d = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], 60).strip())
    for name, ts in (("0_5", 0.5), ("4_75", 4.75), ("mid", d / 2), ("end", d - 1.2)) + tuple(extra):
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{ts:.2f}", "-i", video, "-frames:v", "1", "-vf", "scale=360:-2", f"{od}/frames/{prefix}{name}.png"], 60)
    return d


def cut_take(t, ask, st, reuse=False):
    code = (ask["code"] or t["upload_id"][:8]).lower()
    od = f"{OUT}/{code}"
    wd = f"{BASE}/work/{code}"
    os.makedirs(od, exist_ok=True)
    os.makedirs(wd, exist_ok=True)
    meta_p = od + "/meta.json"
    if reuse and os.path.exists(meta_p):
        return json.load(open(meta_p))
    log("cutting", code, "take", t["take_no"], t["upload_id"][:8])
    raw = fetch_raw(t, wd)
    tr = wd + "/tr.json"
    trc = f"{CACHE}/tr-{t['upload_id']}.json"
    if os.path.exists(trc) and not os.path.exists(tr):
        shutil.copy(trc, tr)
    if not os.path.exists(tr):
        log(run([WPY, f"{BASE}/lib/cy_transcribe.py", raw, tr], 2400).strip())
        shutil.copy(tr, trc)
    design = pick_design()
    cards, photos = library_assets(t["upload_id"])
    v4 = v4_on()
    ending, ending_name, end_sty = None, None, None
    if not v4:
        ending, ending_name = pick_ending(st)
        if ending and v3_on():
            ending, end_sty = endcard_v3(ending, ending_name)
    seed = int(hashlib.md5(t["upload_id"].encode()).hexdigest()[:8], 16)
    job = {"work": wd, "raw": raw, "transcript": tr, "ask": {"title": ask["title"], "script": ask.get("script"), "hook_opening": ask.get("hook_opening"), "deck_tie": ask.get("deck_tie")},
           "design": design, "cards": cards, "photos": photos, "ending_file": ending, "take_no": t["take_no"], "seed": seed,
           "v4": v4, "custom": OPTS.get("custom"), "shape": OPTS.get("shape"), "kinds": OPTS.get("kinds"), "last_kinds": st.get("last_kinds"), "last_deco": st.get("last_deco")}
    job.update(OPTS.get("job_extra") or {})                  # cy_recut (2026-11-02): no_captions, block_rects, bunting_plate for Dropbox-final recuts
    json.dump(job, open(wd + "/job.json", "w"))
    log(run([VPY, f"{BASE}/lib/cy_spec.py", wd + "/job.json", wd + "/spec.json"], 900, cwd=BASE).strip()[:600])
    notes = json.load(open(wd + "/spec.json.notes.json"))
    if OPTS.get("spec_only"):                         # dry occlusion check (cy_occl_dry.py): stop at the spec, nothing rendered or filed
        return {"spec_only": True, "notes": notes, "code": code}
    if v4 and OPTS.get("end_style"):                  # a recut that keeps the end card it had (only CY40 and CY35 were asked for a new one)
        ending, ending_name = pick_ending(st, OPTS["end_style"])
        ending, end_sty = endcard_v3(ending, ending_name)
        sp = json.load(open(wd + "/spec.json")); sp["ending_file"] = ending; sp.pop("ending", None); json.dump(sp, open(wd + "/spec.json", "w"), indent=1)
    elif v4:
        try:
            ending = endcard_custom(notes["endcard_plan"], wd)
            end_sty = "custom"; ending_name = "custom end card (%s motif, palette from %s)" % (notes["endcard_plan"]["shape"], notes["palette"]["source"])
        except BaseException as e:  # noqa: BLE001  fall back to a library end card that is not retired
            log("custom end card failed, library fallback:", str(e)[:200])
            ending, ending_name = pick_ending(st)
            ending, end_sty = endcard_v3(ending, ending_name)
        sp = json.load(open(wd + "/spec.json")); sp["ending_file"] = ending; sp.pop("ending", None); json.dump(sp, open(wd + "/spec.json", "w"), indent=1)
    raw_cut = wd + "/render.mp4"
    log("rendering")
    run([VPY, f"{BASE}/kit/fresh/render_cy.py", wd + "/spec.json", raw_cut, "--work", wd + "/rwork"], 7000, cwd=BASE + "/kit/fresh")
    bed, bed_file = pick_bed(st)
    tt_info = None
    if v3_on():
        r_ = lib.rpc("claim_check", _client_slug=CLIENT, _text=TIKTOK_BEAT_TEXT, _context="cy_cut tiktok beat") or {}
        if not r_.get("ok", True):
            raise RuntimeError(f"hold: claim rule '{r_.get('reason')}' hit in the TikTok beat text")
        raw_tt = wd + "/render_tt.mp4"
        log("TikTok render: body + cart beat + end card")
        run([VPY, ENDCARD, "join", wd + "/rwork/body.mp4", cart_beat(), ending, raw_tt], 1800)
        run(["python3", f"{BASE}/lib/cy_mix.py", raw_tt, bed_file, wd + "/final_tt.mp4", wd + "/mix_tt.json"], 900)
    mixed = wd + "/final.mp4"
    rep = run(["python3", f"{BASE}/lib/cy_mix.py", raw_cut, bed_file, mixed, wd + "/mix.json"], 900).strip()
    mix = json.load(open(wd + "/mix.json"))
    cover = wd + "/cover.jpg"
    cj = {"work": wd, "name": code, "week": design["week"], "transcript": tr, "ask": job["ask"], "hook_text": (notes.get("hook") or {}).get("text", ""), "take_no": t["take_no"], "out": cover}
    json.dump(cj, open(wd + "/cover_job.json", "w"))
    cov = json.loads(run([VPY, f"{BASE}/lib/cy_cover.py", wd + "/cover_job.json"], 600, cwd=BASE).strip().splitlines()[-1])
    if cov.get("safe_problems"):
        raise RuntimeError(f"cover has safe-zone problems: {cov['safe_problems']}")
    if v3_on():
        if end_sty == "custom":
            run([VPY, ENDCUSTOM, "check", mixed, ending + ".json"], 180)
            run([VPY, ENDCUSTOM, "check", wd + "/final_tt.mp4", ending + ".json"], 180)
        else:
            run([VPY, ENDCARD, "check", mixed, end_sty], 180)
            run([VPY, ENDCARD, "check", wd + "/final_tt.mp4", end_sty], 180)
        shutil.copy(wd + "/final_tt.mp4", od + "/final_tiktok.mp4")
        ed_ = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ending], 60).strip())
        tt_d = frames(od + "/final_tiktok.mp4", od, "tt_", (("beat", 0), ))   # placeholder, replaced below
        frames_tt_t = tt_d - ed_ - 1.4
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{frames_tt_t:.2f}", "-i", od + "/final_tiktok.mp4", "-frames:v", "1", "-vf", "scale=360:-2", f"{od}/frames/tt_beat.png"], 60)
        tt_info = {"file": "final_tiktok.mp4", "duration": round(tt_d, 2), "beat_text": TIKTOK_BEAT_TEXT, "end_style": end_sty, "mix": json.load(open(wd + "/mix_tt.json"))}
    shutil.copy(mixed, od + "/final.mp4")
    shutil.copy(cover, od + "/cover.jpg")
    shutil.copy(wd + "/spec.json", od + "/spec.json")
    tg = (json.load(open(wd + "/spec.json")).get("tag") or {})
    frames(od + "/final.mp4", od, "", (("tag", float(tg.get("from", 5.0)) + 2.0),))
    meta = {"code": code, "upload_id": t["upload_id"], "take_no": t["take_no"], "design": design, "notes": notes, "mix": mix, "bed": bed, "cover": cov, "ending": ending_name,
            "duration": mix.get("duration"), "tiktok": tt_info, "end_style": end_sty, "layout": notes.get("layout"), "palette": notes.get("palette"), "made_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    json.dump(meta, open(meta_p, "w"), indent=1)
    if v4 and (notes.get("layout") or {}).get("kinds"):
        st["last_kinds"] = notes["layout"]["kinds"]; st["last_deco"] = notes["layout"].get("deco")
    shutil.rmtree(wd, ignore_errors=True)
    return meta


# ---------------------------------------------------------------------------------------------- filing
# Her help-seeking standard (client_brand.resource_when / resource_has for centering-you). Same line as cy_maker.py.
# Fix 2026-11-03: cover, hook and graphic checks skip "missing crisis resource" on purpose (on-screen text is short), and
# caption_for() also kept a failing caption as-is, so a video that names postpartum depression/anxiety etc. was filed
# with no help line anywhere. Now the caption carries it whenever the post (caption, her script, hook, cover) needs it.
# Numeric hotline on purpose: "TLC-MAMA" trips her soft "defaults to mama or mom" rule.
HELP_LINE = ("If you are struggling, call or text the National Maternal Mental Health Hotline at 1-833-852-6262, "
             "free, day or night, or 988 in a crisis.")
SIG = "\n\nElizabeth O’Brien, LPC, PMH-C · Centering YOU postpartum support cards · centeringyou.com"


def caption_for(ask, onscreen=""):
    base = (ask.get("title") or "").strip()
    body = (ask.get("brief") or "").strip()
    cap = base + ("\n\n" + body if body and body.lower() != base.lower() else "")
    r = lib.rpc("claim_check", _client_slug=CLIENT, _text=cap + SIG, _context="cy_cut caption") or {}
    if not r.get("ok", True) and r.get("reason") != "missing crisis resource":
        cap = base
    post = " ".join(x for x in (cap, ask.get("script") or "", ask.get("hook_opening") or "", onscreen or "") if x)
    if lib.rpc("claim_needs_resource", _client_slug=CLIENT, _text=post) \
            and not lib.rpc("claim_has_resource", _client_slug=CLIENT, _text=cap):
        cap += "\n\n" + HELP_LINE
    cap += SIG
    r = lib.rpc("claim_check", _client_slug=CLIENT, _text=cap, _context="cy_cut caption final") or {}
    if not r.get("ok", True):
        log("caption still trips her rule:", r.get("reason"), "(Studio's stage gate will hold it)")
    return cap


def occl_text(n):
    sys.path.insert(0, BASE + "/lib")
    import cy_occlusion as OC
    return OC.report_text((n or {}).get("occlusion"))


def layout_line(meta, n):
    lay = meta["layout"]; pal = meta.get("palette") or {}
    if lay.get("custom_line"):
        return lay["custom_line"]
    if (n.get("occlusion") or {}).get("none_left"):
        return ("Graphics (read from the take: face/body position every 0.5 s, empty-space map, colours): no graphic in this video, because she covers every graphic the layout step could place (see the occlusion check). ")
    if not lay.get("rect"):
        return ("Graphics (read from the take: face/body position every 0.5 s, empty-space map, colours): she fills the frame, no empty area is big enough for a panel, so the corner graphic stays small and sits behind her (she is cut out in front of it); rotation: " + " > ".join(n.get("corner_rotation") or []) + ". ")
    shape = {"panel_v": "tall panel on the empty wall", "banner_top": "banner in the empty top band", "block": "big block in the empty corner"}.get(lay.get("shape"), lay.get("shape"))
    return (f"Graphics (read from the take: face/body position every 0.5 s, empty-space map, colours): {shape}, {lay.get('size', [0, 0])[0]} x {lay.get('size', [0, 0])[1]} px at {lay.get('rect')}, "
            f"fills the empty area, inside the TikTok/Instagram safe zones; rotation: {' > '.join(n.get('corner_rotation') or [])}; palette from {pal.get('source')} plus house colours. ")


def file_take(t, ask, meta):
    code = meta["code"]
    od = f"{OUT}/{code}"
    sha = hashlib.sha256(open(od + "/final.mp4", "rb").read()).hexdigest()
    csha = hashlib.sha256(open(od + "/cover.jpg", "rb").read()).hexdigest()
    vpath = f"video/{CLIENT}/{code}-cut.{sha[:10]}.mp4"
    cpath = f"video/{CLIENT}/{code}-thumb.{csha[:10]}.jpg"
    vurl = supload(vpath, od + "/final.mp4", "video/mp4")
    curl = supload(cpath, od + "/cover.jpg", "image/jpeg")
    n, mx, cov = meta["notes"], meta["mix"], meta["cover"]
    ask_code = ask["code"]
    src_line = f"Made by Spark · Pi cut worker (cy_cut) · from Elizabeth's take {t['take_no']} on {ask_code}"
    trims = "; ".join(n.get("trims") or []) or "no dead air or restarts to remove beyond jump-cut pauses"
    note = (f"{src_line}. What was done: trims: {trims} (raw {n.get('raw_s')} s, kept {round(n.get('t_out', 0) - n.get('t_in', 0), 1)} s before pause shrinking). "
            f"Hook: \"{(n.get('hook') or {}).get('text')}\" (from {(n.get('hook') or {}).get('from')}). "
            f"Name tag: {n.get('tag')}. " + (layout_line(meta, n) if meta.get("layout") else f"Corner (design {meta['design']['week']}, fingerprint {meta['design']['corner']['fingerprint']}): {' > '.join(n.get('corner_rotation') or [])}. ") +
            occl_text(n) + f"Music bed: {meta['bed']['name']}, about {mx.get('bed_under_voice_db_median')} dB under her voice while she speaks, fades in and out. "
            f"End card: {meta.get('ending')}. Cover: \"{cov.get('headline', '').replace('|', ' / ')}\" on {cov.get('headshot')} (smile score {cov.get('smile', {}).get('smile')}). "
            + (n.get("help_strip") + ". " if n.get("help_strip") else "") +
            (("Heads up: " + n["burned_in_captions"] + ". ") if n.get("burned_in_captions") else "") +
            (f"End card ends on centeringyou.com (modern sans pill, held about 2.5 s). " if meta.get("end_style") else "") +
            (f"TikTok has its own render (media for the TikTok post only): after her last line a {3.4:.1f} s beat, \"{meta['tiktok']['beat_text']}\" with an orange cart icon, then the same end card; Instagram and the rest use the main video. " if meta.get("tiktok") else "") +
            "Every word on screen went through the claim rules. Nothing was sent to Elizabeth. Approve, ask for changes or kill it like any draft.")
    prov = {"source_line": src_line, "made_in": "Pi cut worker (cy_cut)", "render": {"kit": "recut-kit v4 fresh renderer via cy_cut", "hook": (n.get("hook") or {}).get("text"), "tag_y": n.get("tag_y"),
            "ending": meta.get("ending"), "corner": n.get("corner_rotation"), "spec": f"{OUT}/{code}/spec.json"},
            "music": {"name": meta["bed"]["name"], "track_id": meta["bed"]["id"], "bed_under_voice_db": mx.get("bed_under_voice_db_median"), "ducked": True},
            "design": {"week": meta["design"]["week"], "corner_fp": meta["design"]["corner"]["fingerprint"], "tag_fp": meta["design"]["tag"]["fingerprint"]},
            "claim_type": "client_recording", "media_sha256": sha, "sources": [f"client-media {t['path']}"], "edited": {"trims": n.get("trims"), "duration_s": mx.get("duration")}}
    if n.get("occlusion"):
        prov["render"]["occlusion"] = n["occlusion"]
    tt = meta.get("tiktok")
    if tt and os.path.exists(od + "/final_tiktok.mp4"):
        tsha = hashlib.sha256(open(od + "/final_tiktok.mp4", "rb").read()).hexdigest()
        tpath = f"video/{CLIENT}/{code}-tiktok.{tsha[:10]}.mp4"
        prov["tiktok_media_url"] = supload(tpath, od + "/final_tiktok.mp4", "video/mp4")   # social_enqueue_item prefers this for TikTok
        prov["tiktok_cut"] = {"made_in": "cy_cut v4", "duration_s": tt.get("duration"), "beat_text": tt.get("beat_text"), "end_style": tt.get("end_style"), "media_sha256": tsha}
        prov["render"]["endcard"] = meta.get("end_style")
    if OPTS.get("why"):
        note = "RECUT (v4 layout): " + OPTS["why"] + " " + note
    r = lib.rpc("cy_cut_file", p={"upload_id": t["upload_id"], "caption": caption_for(ask, f"{(n.get('hook') or {}).get('text') or ''} {(cov.get('headline') or '').replace('|', ' ')}"), "media_url": vurl, "thumb_url": curl, "provenance": prov, "note": note,
                                  "render_path": vpath, "duration_s": mx.get("duration"), "name": code.upper()})
    item_code = r["code"]
    try:
        lib.rpc("studio_design_use", p_client=CLIENT, p_week=meta["design"]["week"], p_corner_fp=meta["design"]["corner"]["fingerprint"], p_tag_fp=meta["design"]["tag"]["fingerprint"], p_item_code=item_code)
    except Exception as e:  # noqa: BLE001
        log("design use not recorded:", str(e)[:160])
    try:
        lib.rpc("studio_design_record", p_client=CLIENT, p_component="thumbnail", p_fingerprint=cov["fingerprint"], p_family=cov["family"], p_palette=cov["palette"],
                p_params=cov["params"], p_week=meta["design"]["week"], p_preview_path=cpath)
        lib._req("PATCH", f"/rest/v1/studio_design_ledger?client_slug=eq.{CLIENT}&component=eq.thumbnail&fingerprint=eq.{cov['fingerprint']}&iso_week=eq.{meta['design']['week']}",
                 {"status": "used", "item_codes": [item_code]})
    except Exception as e:  # noqa: BLE001
        log("thumbnail ledger not recorded:", str(e)[:160])
    d = lib.rpc("studio_take_edit_done", p_upload=t["upload_id"], p_render=r["render_upload_id"])
    return item_code, d


# ---------------------------------------------------------------------------------------------- main
def main(argv):
    if os.path.exists(OFF):
        return "skip: cy_cut is switched off (" + OFF + ")"
    for d in (OUT, BASE + "/work", CACHE):
        os.makedirs(d, exist_ok=True)
    st = state()
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    for k_ in ("shape", "why", "end_style", "custom"):
        if "--" + k_.replace("_", "-") in argv:
            OPTS[k_] = argv[argv.index("--" + k_.replace("_", "-")) + 1]
    if "--kinds" in argv:
        OPTS["kinds"] = argv[argv.index("--kinds") + 1].split(",")
    nofile, reuse = "--no-file" in argv, "--reuse" in argv
    retried = retry_failed(st) if not only else 0
    takes = [x for x in (lib.rpc("studio_takes_for_edit") or []) if x.get("client_slug") == CLIENT]
    if only:
        takes = [x for x in takes if x["upload_id"].startswith(only)]
        if not takes:
            raise RuntimeError(f"take {only} is not in studio_takes_for_edit (approved, unclaimed)")
    if "--dry" in argv:
        return f"ok (dry): {len(takes)} approved take(s) waiting; retried {retried}"
    held = st.setdefault("hold", {})
    for x in list(held):
        if time.time() - held[x]["ts"] > 86400:
            held.pop(x)
    todo = [x for x in takes if x["upload_id"] not in held or only]
    if not todo:
        save_state(st)
        return f"0 takes to cut ({len(takes)} waiting, {len(held)} on hold); retried {retried} failed upload(s)"
    t = todo[0]
    ask = lib.get("client_asks", f"id=eq.{t['ask_id']}&select=id,code,title,brief,script,hook_opening,deck_tie")[0]
    if not nofile:
        c = lib.rpc("studio_take_edit_claim", p_upload=t["upload_id"], p_worker=WORKER) or {}
        if not c.get("claimed"):
            return f"skip: {ask['code']} was claimed by someone else"
    att = st.setdefault("attempts", {})
    try:
        meta = cut_take(t, ask, st, reuse=reuse)
        if nofile:
            save_state(st)
            return f"ok (no-file): {ask['code']} cut to {OUT}/{ask['code'].lower()}/final.mp4"
        item_code, d = file_take(t, ask, meta)
        att.pop(t["upload_id"], None)
        save_state(st)
        raise_alert("studio:cycut.hold." + ask["code"], "resolved", "Spark: cut worker hold cleared for " + ask["code"], "cut")
        return f"ok: {ask['code']} take {t['take_no']} -> {item_code} in Drafts > To review (music {meta['bed']['name']}, {meta['duration']} s); {len(takes) - 1} more waiting"
    except BaseException as e:  # noqa: BLE001
        msg = f"{type(e).__name__}: {str(e)[:500]}"
        att[t["upload_id"]] = att.get(t["upload_id"], 0) + 1
        if "hold:" in msg or att[t["upload_id"]] >= 3:
            held[t["upload_id"]] = {"ts": time.time(), "reason": msg[:300]}
            raise_alert("studio:cycut.hold." + ask["code"], "problem", f"Spark: the cut worker is holding {ask['code']} for a look",
                        f"cy_cut stopped on purpose or after 3 tries: {msg[:350]}. It will try again in 24 hours. Nothing was filed.")
        save_state(st)
        raise
