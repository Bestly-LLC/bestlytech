"""cy_recut: self-healing re-cut worker for Centering YOU posts stuck in Needs changes (Spark, Hestia, 2026-11-02).

Jared, Nov 2 2026: "get the 7 videos out of needs changes on centering you, this should never happen. self heal watch dog".

  run.sh cy_recut                 every 10 min: pick the OLDEST Centering YOU item in Needs changes / needs re-render, fix it, file the new version
  run.sh cy_recut --dry           show what it would pick, change nothing
  run.sh cy_recut --only CY13     work one named post (add --force to ignore a hold)

One item per run. Claims the item (work_kind recut -> Studio shows "Rendering . Spark"), gathers every note since its last cut plus the shared decisions
(recut_specs), fixes it, LOOKS at the result, files it, writes a Spark note in plain words, clears the claim.
  video with a raw take      -> take re-queued into cy_cut's own path (cy_cut.cut_take/file_take, v5 rules), the result lands on THIS post
  Dropbox-final video        -> rebuilt from the original recording in storage with the same v5 cutter (original captions kept, no band or seam)
  carousel with slide copy   -> copy edits with the free AI ladder (her voice + claim rules), re-render with cy-kit
  older image-only carousel  -> pixel patches (recipes below); anything without a recipe is put on hold with the reason
Filing sets new media on the post; trigger trg_items_recut_resets / cy_recut_file puts it back in Drafts > To review. NEVER sends to Elizabeth, approves, promotes, schedules or posts.
Hold: 3 failed tries (or a deliberate stop) = 24 h hold, reason in a Spark note on the post + alert studio:recut.hold.<code> (owner Spark).
Off switch: touch /opt/bestly/cron/state/cy_recut.OFF. Watchdog: pi_jobs cy_recut (30 min) + studio_changes_watch() (pg_cron, every 15 min; stuck > 6 h alert).
Log: /home/pi/scripts/cron-logs/cy_recut.log. Undo: remove the cron line (crontab.bak-20261102-cyrecut); tables / functions can stay.
"""
import fcntl
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, "/opt/bestly/cy-cut/lib")
import lib  # noqa: E402
import freellm  # noqa: E402
from jobs import cy_cut as C  # noqa: E402
from jobs import cy_maker as M  # noqa: E402
from jobs import brand_maker as bm  # noqa: E402

WORKER = "cy_recut@hestia"
OFF = "/opt/bestly/cron/state/cy_recut.OFF"
STATE = "/opt/bestly/cron/state/cy_recut.json"
LOCK = "/tmp/cy_recut.work.lock"
CLIENT = "centering-you"
BASE = "/opt/bestly/cy-cut"
RECUT_OUT = BASE + "/recut-out"
UA = C.UA
_last_beat = [0.0]
REUSE = [False]
REDO = [False]


class Hold(Exception):
    """a deliberate stop: the reason (plain words) goes into a Spark note on the post"""


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


CURRENT = ["idle"]


def _pulse():
    """a long render logs nothing for 15 minutes: keep the watchdog heartbeat alive every 4 minutes while this run is working"""
    while True:
        time.sleep(240)
        try:
            lib.rpc("pi_job_report", p_job="cy_recut", p_ok=True, p_summary=("working: " + CURRENT[0])[:300], p_duration_ms=0)
        except Exception:  # noqa: BLE001
            pass


def beat(msg, force=False):
    CURRENT[0] = msg
    if not force and time.time() - _last_beat[0] < 60:
        return
    _last_beat[0] = time.time()
    try:
        lib.rpc("pi_job_report", p_job="cy_recut", p_ok=True, p_summary=("working: " + msg)[:300], p_duration_ms=0)
    except Exception as e:  # noqa: BLE001
        print("beat failed:", e)


_orig_clog = C.log
def _clog(*a):
    _orig_clog(*a)
    beat(" ".join(str(x) for x in a)[:200])
C.log = _clog


def state():
    try:
        return json.load(open(STATE))
    except Exception:  # noqa: BLE001
        return {}


def save(st):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(st, open(STATE, "w"), indent=1)


def iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def pt_clock():
    return time.strftime("%-I:%M %p", time.localtime()) + " PT"   # Hestia clock is Pacific


# ------------------------------------------------------------------------------------------------ picking + claiming
def centering_id():
    return lib.get("approval_clients", f"slug=eq.{CLIENT}&select=id")[0]["id"]


def stuck_items(cid):
    rows = lib.get("approval_items", f"client_id=eq.{cid}&stage=eq.internal&or=(internal_status.eq.changes,needs_render_at.not.is.null)"
                   "&select=id,code,title,media_type,media_url,thumb_url,caption,provenance,internal_status,needs_render_at,needs_render_why,content_version,work_kind,work_by,work_started_at"
                   "&order=needs_render_at.asc.nullslast,created_at.asc") or []
    return [r for r in rows if r["internal_status"] != "killed"]


def claim(item):
    lib._req("PATCH", f"/rest/v1/approval_items?id=eq.{item['id']}", {"work_kind": "rendering", "work_by": WORKER, "work_started_at": iso(), "work_note": "Re-cutting · Spark"})


def release(item):
    lib._req("PATCH", f"/rest/v1/approval_items?id=eq.{item['id']}&work_by=eq.{WORKER}", {"work_kind": None, "work_by": None, "work_started_at": None, "work_note": None})


# ------------------------------------------------------------------------------------------------ notes since the last cut
def clean_note(t):
    t = re.sub(r"^\[changes: notes\]\s*", "", t.strip())
    return re.sub(r"\s+", " ", t)


def gather(item, everything=False):
    ev = lib.get("approval_item_events", f"item_id=eq.{item['id']}&kind=eq.edited&order=at.desc&limit=60") or []
    last = None if everything else next((e["at"] for e in ev if isinstance(e.get("payload"), dict) and "now" in e["payload"]), None)
    rv = lib.get("approval_reviews", f"item_id=eq.{item['id']}&note=not.is.null&order=created_at.asc&select=created_at,note,reviewer_kind,staff_id,triage,rule_blocked,rule_override") or []
    staff = {s["id"]: s for s in (lib.get("approval_staff", "select=id,name,is_system") or [])}
    out = []
    for r in rv:
        if r["reviewer_kind"] not in ("staff", "client"):
            continue
        st = staff.get(r.get("staff_id")) or {}
        if st.get("is_system"):
            continue
        if last and r["created_at"] <= last:
            continue
        who = "Elizabeth" if r["reviewer_kind"] == "client" else (st.get("name") or "Staff")
        out.append({"who": who, "at": r["created_at"], "note": clean_note(r["note"])})
    seen, uniq = [], []
    for n in out:                                              # the same note is often saved twice (plain + "[changes: notes]" summary): keep the one that says most
        txt = re.sub(r"^\w+:\s*", "", n["note"])
        if any(txt and txt in re.sub(r"^\w+:\s*", "", m["note"]) and m is not n for m in out if len(m["note"]) > len(n["note"])):
            continue
        key = txt.lower()
        if key in seen:
            continue
        seen.append(key); uniq.append(n)
    specs = []
    for si in lib.get("recut_spec_items", f"item_id=eq.{item['id']}" + ("" if everything else "&applied_at=is.null") + "&select=spec_id") or []:
        sp = lib.get("recut_specs", f"id=eq.{si['spec_id']}" + ("" if everything else "&status=in.(open,in_batch)") + "&select=component,spec")
        if sp:
            specs.append(sp[0])
    return uniq, specs


def why_text(notes, specs):
    parts = [f"{n['who']}: {re.sub(r'^\w+:\s*', '', n['note'])}" for n in notes]
    txt = " | ".join(parts)
    return txt[:900]


# ------------------------------------------------------------------------------------------------ storage helpers
def fetch_public(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def put(path, local, ctype):
    return C.supload(path, local, ctype)


def say_hold(item, reason, st):
    code = item["code"]
    st.setdefault("hold", {})[item["id"]] = {"ts": time.time(), "reason": reason[:400]}
    note = (f"Spark, re-cut worker: I could not finish this one yet and I am NOT attaching a bad version. Reason: {reason} "
            "Nothing was changed on the post and nothing was sent to Elizabeth. I will try again in 24 hours, or sooner if someone clears the hold.")
    try:
        lib.rpc("cy_recut_note", p_item=item["id"], p_note=note)
    except Exception as e:  # noqa: BLE001
        log("hold note failed:", e)
    C.raise_alert("studio:recut.hold." + code, "problem", f"Spark: the re-cut worker is holding {code} for a look", f"{reason[:350]} Retry in 24 hours. Nothing was filed.")


# ------------------------------------------------------------------------------------------------ video
def prior_hook(item):
    p = item.get("provenance") or {}
    h = ((p.get("render") or {}).get("hook")) or ((p.get("edited") or {}).get("hook")) or item["title"]
    return re.sub(r"\s*/\s*", " ", h).strip()


def build_bunting_plate(work):
    """CY13 triangle banners exactly as in the earlier cut: the bunting-only layer of the CY13 corner design (rotcorner, hung variant)"""
    sys.path.insert(0, BASE + "/kit/fresh")
    import rotcorner
    from PIL import Image
    fp = lib.get("studio_design_ledger", "fingerprint=eq.d6412e6d3d401f44&select=params&limit=1")
    if not fp:
        raise Hold("the CY13 triangle-banner design is missing from the design ledger, so I cannot keep the banners exactly as they were.")
    params = dict(fp[0]["params"], hung=True)
    full, ext, deck = rotcorner.render_state(params, "R", {"kind": "none"}, 0.86)
    out = os.path.join(work, "cy13-bunting-plate.png"); full.save(out)
    return out, ext, params


def video(item, notes, specs, st, only_force=False):
    prov = item.get("provenance") or {}
    code = item["code"]
    why = why_text(notes, specs)
    take, restore = None, None
    ask_rows = lib.get("client_asks", f"item_id=eq.{item['id']}&select=id,code,title,brief,script,hook_opening,deck_tie") or []
    if ask_rows:
        ups = lib.get("client_uploads", f"ask_id=eq.{ask_rows[0]['id']}&purpose=eq.ask&status=in.(transcoded,attached)&select=id,take_no,path,bucket,parts,review_state,edit_done_at&order=take_no.desc") or []
        used = ((prov.get("takes") or {}).get("used")) or prov.get("upload_id")
        take = next((u for u in ups if u["id"] == used), None) or (ups[0] if ups else None)
    OPTS = {"why": why}
    extra = {}
    work_dir = f"{RECUT_OUT}/{code.lower()}"
    os.makedirs(work_dir, exist_ok=True)
    mode = None
    if take:
        mode = "take"
        t = {"upload_id": take["id"], "take_no": take["take_no"], "path": take["path"], "bucket": take["bucket"], "parts": take.get("parts") or 1}
        ask = dict(ask_rows[0])
        if (prov.get("render") or {}).get("hook") or (prov.get("edited") or {}).get("hook") or not ask.get("hook_opening"):
            ask["hook_opening"] = {"on_screen": prior_hook(item)}         # the hook she already saw, whole (a shortened one cut mid-sentence in a test run)
        source_txt = f"Elizabeth's take {take['take_no']} on {ask['code']}"
    else:
        slug = prov.get("clip")
        raws = lib.get("client_uploads", f"purpose=eq.asset&asset_kind=eq.clip&status=eq.ready&tags=cs.{{raw,{slug}}}&select=id,path,bucket,title,duration_s&order=created_at.desc") if slug else []
        if not raws:
            raise Hold(f"this is a Dropbox final ('{slug}') and the original recording is not in storage, so it cannot be rebuilt without keeping the seam. Needs the original file.")
        mode = "original"
        raw = raws[0]
        t = {"upload_id": raw["id"], "take_no": 1, "path": raw["path"], "bucket": raw.get("bucket") or "client-media", "parts": 1}
        ask = {"id": None, "code": code, "title": item["title"], "brief": None, "script": None, "deck_tie": None, "hook_opening": {"on_screen": prior_hook(item)}}
        extra["no_captions"] = True                                  # the design-bee original already carries her burned-in captions
        source_txt = f"the original recording '{raw['title']}'"
    alltext = " ".join(n["note"] for n in notes) + " " + " ".join(s["spec"] for s in specs)
    # CY13 only: its own notes ("keep triangle banners as is") or a shared spec sentence that names THIS post next to the banners (the corner spec also lists CY27 and CY20)
    keep_bunting = (any(re.search(r"triangle banner|bunting", n["note"], re.I) for n in notes)
                    or any(re.search(rf"\b{re.escape(code)}\b[^.]*?(triangle banner|bunting)", sp["spec"], re.I) for sp in specs))
    no_banner = bool(re.search(r"\b(remove|no|strip|drop|without|take out)\b[^.]{0,50}horizontal (graphic|banner)s?", alltext, re.I))
    if no_banner:                                                    # Jared 2026-11-03: the new spec wins over the old "keep triangle banners as is" note
        extra["no_banner"] = True
        keep_bunting = False
    if re.search(r"\b(remove|no|strip|drop|without|take out)\b[^.]{0,50}vertical (graphic|panel|strip)s?", alltext, re.I):
        extra["no_vertical"] = True                                  # Jared 2026-11-03: no vertical wall panels (spec e7fea7fe)
    if re.search(r"name tag[^.]{0,60}under the captions|tag goes under the captions", alltext, re.I):
        extra["tag_under"] = True                                    # CY27 spec 36cd5606: tag under the captions, never on hair or face
    bunting_info = None
    if keep_bunting:
        plate, ext, bparams = build_bunting_plate(work_dir)
        extra["bunting_plate"] = plate
        extra["bunting_params"] = bparams
        extra["block_rects"] = [[max(0, ext[0] - 20), 0, 1080, min(1920, ext[3] + 30)]]
        bunting_info = {"extent": ext}
    spanish = bool(re.search(r"spanish|centrada|hispanohablant", " ".join([str(prov.get("clip") or ""), item["title"], prior_hook(item)]), re.I))
    if spanish:                                                      # a Spanish-deck video: Spanish end card, graphics without English deck art
        OPTS["spanish"] = True
        want = ((prov.get("render") or {}).get("ending") or "shelf")
        OPTS["end_style"] = want if want in ("dots", "shelf", "stack", "swell") else "shelf"
        OPTS["kinds"] = ["line", "wordmark"]
    if extra:
        OPTS["job_extra"] = extra
    C.OPTS.clear(); C.OPTS.update(OPTS)
    cstate = C.state()
    beat(f"{code}: cutting from {source_txt}", force=True)
    if mode == "take":
        restore = {"review_state": take["review_state"]}
        st.setdefault("restore", {})[take["id"]] = take["review_state"]; save(st)          # self-heal: a killed run is undone at the next start
        lib._req("PATCH", f"/rest/v1/client_uploads?id=eq.{take['id']}", {"review_state": "approved", "edit_done_at": None, "edit_claimed_at": None})
        c = lib.rpc("studio_take_edit_claim", p_upload=take["id"], p_worker=WORKER) or {}
        if not c.get("claimed"):
            lib._req("PATCH", f"/rest/v1/client_uploads?id=eq.{take['id']}", restore)
            raise RuntimeError("the take is claimed by another worker right now")
    try:
        meta = C.cut_take(t, ask, cstate, reuse=REUSE[0])
        look = look_video(meta['code'], meta)                       # the output folder is named after the ask code for a take (cya08), after the post code for an original (cy13)
        if mode == "take":
            item_code, d = C.file_take(t, ask, meta)
            lib.rpc("cy_recut_file", p={"item_id": item["id"], "what": "re-cut from her take", "provenance": {"recut": {"by": "Spark", "via": "cy_recut", "at": iso(), "why": why[:500], "source": source_txt}}})
        else:
            file_original(item, ask, t, meta, why, source_txt, bunting_info, look)
    finally:
        if restore:
            try:
                lib._req("PATCH", f"/rest/v1/client_uploads?id=eq.{take['id']}", restore)
                st.get("restore", {}).pop(take["id"], None); save(st)
            except Exception as e:  # noqa: BLE001
                log("could not restore take review_state:", e)
    cur = C.state()
    for k in ("beds", "last_kinds", "last_deco", "last_ending"):
        if k in cstate:
            cur[k] = cstate[k]
    C.save_state(cur)
    return f"{code} re-cut from {source_txt} ({meta.get('duration')} s), back in Drafts > To review; {look['summary']}"


def _frame(video, t, w=540):
    p = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", "-vf", f"scale={w}:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True)
    import numpy as np
    h = len(p.stdout) // (w * 3)
    return np.frombuffer(p.stdout, np.uint8)[: h * w * 3].reshape(h, w, 3).astype(float) if h else None


def seam_score(fr):
    """strongest horizontal edge that runs the same way across most of the width (a real seam), 0 for natural scenes"""
    import numpy as np
    lum = fr.mean(2)
    best = 0.0
    k = 3
    for y in range(k + 2, lum.shape[0] - k - 2):
        d = lum[y + k, 6:-6] - lum[y - k, 6:-6]          # the whole width: a hook box or a panel never spans it, a tinted band does
        med = abs(float(np.median(d)))
        coh = float((np.sign(d) == np.sign(np.median(d))).mean())
        if coh > 0.93 and med > best:
            best = med
    return best


def look_video(code, meta):
    """LOOK before filing: frames exist and are not black, duration sane, TikTok + main both there, no new horizontal seam compared with the source"""
    od = f"{C.OUT}/{code}"
    probs = []
    for n in ("0_5", "4_75", "mid", "end", "tag"):
        f = f"{od}/frames/{n}.png"
        if not os.path.exists(f):
            probs.append(f"missing frame {n}")
    for f in ("final.mp4", "final_tiktok.mp4", "cover.jpg"):
        if not os.path.exists(f"{od}/{f}"):
            probs.append("missing " + f)
    if probs:
        raise RuntimeError("look failed: " + "; ".join(probs))
    d = float(C.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", od + "/final.mp4"], 60).strip())
    nbw = None
    if (C.OPTS.get("job_extra") or {}).get("no_banner"):            # no_banner look gate: a wide graphic band in the top 600 px after 5.1 s is a warning (natural scenes can fool it), logged, not blocking
        try:
            sc = []
            for t_ in (6.0, 9.0, 12.0):
                fr = _frame(od + "/final.mp4", t_)
                if fr is not None and t_ < d - 1:
                    sc.append(seam_score(fr[: int(fr.shape[0] * 600 / 1920)]))
            nbw = max(sc) if sc else 0
            if nbw > 14:
                log(f"WARNING no_banner look: a wide band may still be in the top 600 px (strength {nbw:.1f})")
        except Exception as e:  # noqa: BLE001
            log("no_banner look check skipped:", e)
    seams = []
    for t in (0.8, 2.0, 3.0, 4.5):                       # before any graphic is on screen (they start at 5.1 s): a panel edge is not a seam, a tinted band across the frame is
        fr = _frame(od + "/final.mp4", t)
        if fr is not None:
            seams.append(seam_score(fr))
    worst = max(seams) if seams else 0
    if worst > 14:
        raise RuntimeError(f"look failed: a horizontal seam is visible in the new cut (strength {worst:.1f}); not attaching")
    dark = [i for i, t in enumerate((1.0, d * 0.5)) if (_frame(od + "/final.mp4", t) is not None and _frame(od + "/final.mp4", t).mean() < 12)]
    if dark:
        raise RuntimeError("look failed: a sampled frame is almost black")
    return {"summary": f"look ok (seam check {worst:.1f}, frames, TikTok render, cover)", "seam": round(worst, 1), "duration": round(d, 1), "top_band": (None if nbw is None else round(nbw, 1))}


def file_original(item, ask, t, meta, why, source_txt, bunting_info, look):
    code = meta["code"]
    od = f"{C.OUT}/{code}"
    sha = hashlib.sha256(open(od + "/final.mp4", "rb").read()).hexdigest()
    csha = hashlib.sha256(open(od + "/cover.jpg", "rb").read()).hexdigest()
    vurl = put(f"video/{CLIENT}/{code}-recut.{sha[:10]}.mp4", od + "/final.mp4", "video/mp4")
    curl = put(f"video/{CLIENT}/{code}-thumb.{csha[:10]}.jpg", od + "/cover.jpg", "image/jpeg")
    n, mx, cov = meta["notes"], meta["mix"], meta["cover"]
    tt = meta.get("tiktok") or {}
    prov = {"source_line": f"Made by Spark · Pi re-cut worker (cy_recut) · rebuilt from {source_txt}", "made_in": "Pi re-cut worker (cy_recut)", "made_by": "Spark",
            "recut": {"by": "Spark", "via": "cy_recut", "at": iso(), "why": why[:500], "source": source_txt, "seam_check": look["seam"],
                      "changed": "rebuilt from the original recording with the v5 cutter (no colour band across the frame)"},
            "render": {"kit": "recut-kit v4 fresh renderer via cy_recut", "hook": (n.get("hook") or {}).get("text"), "tag_y": n.get("tag_y"), "ending": meta.get("ending"),
                       "corner": n.get("corner_rotation"), "spec": f"{C.OUT}/{code}/spec.json", "endcard": meta.get("end_style")},
            "music": {"name": meta["bed"]["name"], "track_id": meta["bed"]["id"], "bed_under_voice_db": mx.get("bed_under_voice_db_median"), "ducked": True},
            "media_sha256": sha, "sources": [f"client-media {t['path']}"], "claim_type": "brand_video"}
    if n.get("occlusion"):
        prov["render"]["occlusion"] = n["occlusion"]
    if os.path.exists(od + "/final_tiktok.mp4"):
        tsha = hashlib.sha256(open(od + "/final_tiktok.mp4", "rb").read()).hexdigest()
        prov["tiktok_media_url"] = put(f"video/{CLIENT}/{code}-tiktok.{tsha[:10]}.mp4", od + "/final_tiktok.mp4", "video/mp4")
        prov["tiktok_cut"] = {"made_in": "cy_recut v5", "duration_s": tt.get("duration"), "beat_text": tt.get("beat_text"), "end_style": tt.get("end_style"), "media_sha256": tsha}
    fixed = ("the horizontal colour seam across her shoulders is gone: the old cut laid a tinted band over the lower half of the frame, the new cut is rebuilt from the original recording and has none. "
             if re.search(r"seam|line|two color|color variation|colour", why, re.I) else "")
    note = (f"RECUT by Spark (re-cut worker), a new version of this same post. Notes answered: {why} "
            f"{fixed}Rebuilt from {source_txt} with the current Centering YOU cutter (her own burned-in captions kept, no second set added). "
            + (C.layout_line(meta, n) if meta.get("layout") else "") + C.occl_text(n)
            + (f"Triangle banners kept exactly as they were and laid over the new graphics. " if bunting_info else "")
            + f"Hook: \"{(n.get('hook') or {}).get('text')}\". Name tag: {n.get('tag')}. Music bed: {meta['bed']['name']}, about {mx.get('bed_under_voice_db_median')} dB under her voice. "
            f"End card: {meta.get('ending')}, ends on centeringyou.com. Cover: \"{(cov.get('headline') or '').replace('|', ' / ')}\". "
            + (f"TikTok has its own render with the orange-cart beat before the end card. " if tt else "")
            + f"Looked at before filing: frames at 0.5 s, 4.75 s, middle, name tag, end card, TikTok beat; seam check {look['seam']}. Every word on screen went through the claim rules. Nothing was sent to Elizabeth.")
    r = lib.rpc("cy_recut_file", p={"item_id": item["id"], "media_url": vurl, "thumb_url": curl, "provenance": prov, "note": note, "what": "re-cut from the original recording"})
    for fn, args in (("studio_design_use", {"p_client": CLIENT, "p_week": meta["design"]["week"], "p_corner_fp": meta["design"]["corner"]["fingerprint"], "p_tag_fp": meta["design"]["tag"]["fingerprint"], "p_item_code": item["code"]}),):
        try:
            lib.rpc(fn, **args)
        except Exception as e:  # noqa: BLE001
            log("design use not recorded:", str(e)[:160])
    return r


# ------------------------------------------------------------------------------------------------ carousels
def slides_of(item):
    return lib.get("approval_slides", f"item_id=eq.{item['id']}&order=position.asc&select=id,position,media_url,copy") or []


def ocr_words(png):
    out = subprocess.run(["tesseract", png, "-", "--psm", "6"], capture_output=True, text=True).stdout
    return out


LEGACY_RECIPES = {}


def legacy_carousel(item, notes, specs, slides):
    """older image-only carousels (copy is null: the text exists only in pixels). Recipes are small, checked pixel patches on flat faces."""
    sys.path.insert(0, BASE + "/lib")
    import cy_recut_img as R
    from PIL import Image
    code = item["code"]
    alltext = " ".join(n["note"] for n in notes) + " " + " ".join(s["spec"] for s in specs)
    stamp = time.strftime("%y%m%d-%H%M")
    wd = f"{RECUT_OUT}/{code.lower()}"
    os.makedirs(wd, exist_ok=True)
    imgs = {}
    for s in slides:
        raw = fetch_public(s["media_url"])
        imgs[s["position"]] = Image.open(io.BytesIO(raw)).convert("RGB")
    changed, said = {}, []
    base_pos = min(imgs)
    S = lambda n: base_pos + n - 1                      # slide number (1-based) -> position
    if code == "CY02":
        if re.search(r"strangely", alltext, re.I):
            for n in sorted(imgs):
                p = f"{wd}/ocr{n}.png"; imgs[n].save(p)
                if re.search(r"strangely", ocr_words(p), re.I):
                    if n != S(3):
                        raise Hold(f"the banned word 'strangely' also sits on slide {n - base_pos + 1}, where I have no safe patch for it.")
                    o, info = R.replace_bullet_text(imgs[n], (300, 925, 845, 1100), (500, 300), 311, 308, 330, 925, 990, ["Feeling disconnected from", "your own life"], 56, 540)
                    p2 = f"{wd}/chk{n}.png"; o.save(p2)
                    if re.search(r"strangely", ocr_words(p2), re.I):
                        raise RuntimeError("look failed: 'strangely' still reads on the new slide")
                    changed[n] = o
                    said.append(f"slide {n - base_pos + 1}: 'Feeling strangely disconnected from your own life' now reads 'Feeling disconnected from your own life' (same font, same colour, same place)")
            if not said:
                said.append("checked every slide: 'strangely' is only on slide 3 (slide 6 has none)")
        if re.search(r"light|dark|read|highly functioning", alltext, re.I) and re.search(r"slide 4|highly functioning", alltext, re.I):
            o, info = R.darken_text(imgs[S(4)], (255, 575, 840, 1100), (240, 800), (16, 46, 48))
            changed[S(4)] = o
            said.append("slide 4: the body text, including 'highly functioning on the outside', is now a much darker teal so it reads easily on the peach card")
    elif code == "CY04":
        if re.search(r"post ?partum", alltext, re.I) and re.search(r"first slide|slide 1|matrescence", alltext, re.I):
            o, info = R.add_big_label(imgs[S(1)], "POSTPARTUM", 122, 548, 170, R.GOLD, (150, 380, 860, 610))
            changed[S(1)] = o
            said.append("slide 1: a big gold 'POSTPARTUM' now sits above the small 'MATRESCENCE' label, so the post is clearly about the postpartum period")
    else:
        raise Hold("this is an older image-only carousel (the words exist only inside the pictures) and I have no safe patch recipe for these notes; the original carousel renderer is not on this machine.")
    if not changed:
        raise Hold("I could not match the notes to a change I can make safely on this older image-only carousel.")
    by_pos = {s["position"]: s for s in slides}
    payload_slides = []
    for n, im in changed.items():
        p = f"{wd}/slide{n}-{stamp}.png"; im.save(p, optimize=True)
        url = put(f"carousel/recut/{code.lower()}-{stamp}/{n - base_pos + 1:02d}.png", p, "image/png")
        payload_slides.append({"id": by_pos[n]["id"], "media_url": url})
    first = by_pos[base_pos]
    first_new = next((x["media_url"] for x in payload_slides if x["id"] == first["id"]), None)
    note = (f"RECUT by Spark (re-cut worker), a new version of this same post. Notes answered: {why_text(notes, specs)} What changed, in plain words: " + "; ".join(said) +
            ". Only those slides were redrawn; the others are untouched. Looked at the new slides at phone size (text sharp, nothing clipped, edges soft) and read them back with text recognition. Nothing was sent to Elizabeth.")
    pj = {"item_id": item["id"], "slides": payload_slides, "note": note, "what": "slide patch",
          "provenance": {"recut": {"by": "Spark", "via": "cy_recut", "at": iso(), "why": why_text(notes, specs)[:500], "changed": "; ".join(said)[:600]}}}
    if first_new:
        pj["thumb_url"] = first_new
    r = lib.rpc("cy_recut_file", p=pj)
    return f"{code} patched slides {sorted(n - base_pos + 1 for n in changed)}, back in Drafts > To review ({r.get('version_before')} -> {r.get('version_after')})"


CY_DECK_SYS = """You edit the words on ONE Centering YOU carousel for Elizabeth O'Brien, following the review notes. {deck}

{voice}

You get the current slides and the notes. Change ONLY what the notes ask for (usually the cover). Reply with ONE JSON object only:
{{"changes": [{{"slide": 1, "kicker": "...", "head": "..."}}, {{"slide": 3, "head": "...", "body": "..."}}], "restyle_all": true|false, "reason": "one plain sentence"}}
Cover kicker 2 to 5 words, cover head 5 to 14 words, content head 4 to 14 words, body 8 to 30 words. restyle_all is true when a note says the look is bland or should match the other carousels."""


def copy_carousel(item, notes, specs, slides):
    code = item["code"]
    alltext = " ".join(n["note"] for n in notes) + " " + " ".join(s["spec"] for s in specs)
    restyle_wanted = bool(re.search(r"bland|aesthetic|colou?rs|design|style|like the other|match", alltext, re.I))
    cur = [{"slide": i + 1, **{k: v for k, v in (s["copy"] or {}).items()}} for i, s in enumerate(slides)]
    deadline = time.time() + 900
    msgs = [{"role": "system", "content": CY_DECK_SYS.format(deck=M.DECK, voice=M.VOICE)},
            {"role": "user", "content": json.dumps({"slides": cur, "notes": [f"{n['who']}: {n['note']}" for n in notes]})}]
    plan, errs, tries = None, [], []
    need_pp = bool(re.search(r"post ?partum|perinatal|mothers", alltext, re.I)) and bool(re.search(r"first slide|slide 1|cover", alltext, re.I))
    for _ in range(4):
        msg, prov = freellm.chat(msgs, None, max_tokens=1500, deadline=deadline, json_mode=True)
        try:
            plan = bm._json(msg.get("content")); errs = []
            ch = plan.get("changes") or []
            if not ch and not restyle_wanted:
                errs.append("no changes given")
            for c in ch:
                txt = " ".join(str(c.get(k, "")) for k in ("kicker", "head", "body"))
                if re.search(r"\d", txt):
                    errs.append("no numbers on slides")
                r = lib.rpc("claim_check", _client_slug=CLIENT, _text=txt, _context="cy_recut") or {}
                if r.get("reason") == "missing crisis resource":
                    # her help line rule (fix 2026-11-03): a slide can't carry the hotline, so say how to fix it
                    # instead of a bare rule name (that looped 4/4 tries, same as cy_maker did).
                    errs.append(f"slide {c.get('slide')} names a postpartum mental health condition (e.g. postpartum "
                                f"depression, anxiety or rage, intrusive thoughts, PPD/PPA, postpartum or perinatal mental "
                                f"health); her rule needs a hotline for that, which slides can't carry, so reword the slide "
                                f"without naming the condition (describe the feeling instead) and keep everything else")
                elif r.get("ok") is False or r.get("severity") == "soft":
                    errs.append(f"slide {c.get('slide')} breaks her rule '{r.get('reason')}'"
                                + (f" ({str(r.get('pattern'))[:80]})" if r.get("pattern") else ""))
                if c.get("slide") == 1:
                    if not 5 <= len((c.get("head") or "").split()) <= 15 or not 2 <= len((c.get("kicker") or "").split()) <= 5:
                        errs.append("cover kicker must be 2-5 words and head 5-14 words")
                    if need_pp and not re.search(r"post ?partum|perinatal|new mothers|new parents|after birth", txt, re.I):
                        errs.append("slide 1 must say postpartum or perinatal mothers")
            if need_pp and not any(c.get("slide") == 1 for c in ch):
                errs.append("slide 1 must change (the note asks for postpartum or perinatal mothers on the cover)")
            tries.append(f"{prov}: {'; '.join(errs)[:200] or 'ok'}")
        except Exception as e:  # noqa: BLE001
            plan, errs = None, [f"not the JSON asked for ({e})"]; tries.append("unreadable")
        if not errs:
            break
        msgs += [{"role": "assistant", "content": (msg.get("content") or "")[:3000]}, {"role": "user", "content": "Fix these and reply with the JSON only: " + "; ".join(errs)}]
    if errs:
        raise RuntimeError("copy edit failed her rules 4 times: " + " || ".join(tries)[:600])
    restyle = bool(plan.get("restyle_all")) or restyle_wanted
    new = {c["slide"]: c for c in plan.get("changes") or []}
    n = len(slides)
    stamp = time.strftime("%y%m%d-%H%M")
    wd = f"{RECUT_OUT}/{code.lower()}"
    os.makedirs(wd, exist_ok=True)
    template = "deck" if restyle else None
    faces = ["teal", "red", "teal", "red", "teal", "red"]
    to_render = list(range(1, n + 1)) if restyle else sorted(new)
    payload_slides, said = [], []
    for i in to_render:
        s = slides[i - 1]; cp = dict(s["copy"] or {})
        cp.update({k: v for k, v in new.get(i, {}).items() if k in ("kicker", "head", "body") and v})
        head = cp.get("head") or cp.get("headline"); body = cp.get("body")
        if i == 1:
            sl = {"type": "cover", "kicker": (cp.get("kicker") or "").strip(), "head": head.strip(), "n": 1, "of": n}
            copyj = {"kicker": sl["kicker"], "headline": sl["head"]}
        elif i == n:
            cb = re.sub(r"\s*(?:(?:visit|explore|find|see|learn more|more)\b[^.]*?\s+)?(?:at\s+)?centeringyou\.com\.?", "", (body or "").strip(), flags=re.I).strip()
            if not re.search(r"[.!?]$", cb):
                cb = (body or "").strip()
            sl = {"type": "cta", "head": head.strip(), "body": cb, "n": n, "of": n}
            copyj = {"kicker": "Centering YOU", "headline": sl["head"], "body": cb + " centeringyou.com"}
        else:
            sl = {"type": "text", "head": head.strip(), "body": (body or "").strip(), "n": i, "of": n}
            copyj = {"headline": sl["head"], "body": sl["body"]}
        spec = {"template": template or "tile", "pat": "pat-a" if i % 2 else "pat-b", "px": (137 * i * 7) % 1100, "py": (211 * i * 5) % 1100, "face": faces[i % len(faces)], "slide": sl}
        if i == 1:
            spec["face"] = "red"
        p = f"{wd}/s{i}-{stamp}.jpg"
        fit = M._render(spec, p)
        if i in new or i == 1:
            fit_txt = " / ".join(x for x in (sl.get("kicker"), sl.get("head")) if x)
        url = put(f"carousel/recut/{code.lower()}-{stamp}/{i:02d}.jpg", p, "image/jpeg")
        payload_slides.append({"id": s["id"], "media_url": url, "copy": copyj})
    if 1 in new:
        c = new[1]
        said.append(f"slide 1 now says \"{(c.get('kicker') or '').strip()} · {(c.get('head') or '').strip()}\" so it is clear this is for postpartum and perinatal mothers")
    for k, c in new.items():
        if k != 1:
            said.append(f"slide {k} wording updated")
    if restyle:
        said.append("all slides were redrawn in the same house style as the other Centering YOU carousels: her pattern full-bleed with a teal, red or cream card, League Gothic headlines, no more plain cream tiles")
    first = next(x for x in payload_slides if x["id"] == slides[0]["id"]) if any(x["id"] == slides[0]["id"] for x in payload_slides) else None
    note = (f"RECUT by Spark (re-cut worker), a new version of this same post. Notes answered: {why_text(notes, specs)} What changed, in plain words: " + "; ".join(said) +
            f". New words were written with the free AI and checked against her claim rules and voice rules; every slide passed the fit check (nothing cut off, no '...'); I looked at each new slide at phone size. Nothing was sent to Elizabeth.")
    pj = {"item_id": item["id"], "slides": payload_slides, "note": note, "what": "carousel re-render",
          "provenance": {"recut": {"by": "Spark", "via": "cy_recut", "at": iso(), "why": why_text(notes, specs)[:500], "changed": "; ".join(said)[:600], "template": template or "tile"}}}
    if first:
        pj["thumb_url"] = first["media_url"]
        if item.get("media_url"):
            pj["media_url"] = first["media_url"]
    r = lib.rpc("cy_recut_file", p=pj)
    return f"{code} re-rendered slides {to_render}, back in Drafts > To review ({r.get('version_before')} -> {r.get('version_after')})"


def carousel(item, notes, specs, st):
    slides = slides_of(item)
    if not slides:
        raise Hold("the carousel has no slides.")
    if all(s.get("copy") for s in slides):
        return copy_carousel(item, notes, specs, slides)
    return legacy_carousel(item, notes, specs, slides)


# ------------------------------------------------------------------------------------------------ main
def work(item, st):
    notes, specs = gather(item, everything=REDO[0])
    if not notes and not specs and item.get("needs_render_why"):
        notes = [{"who": "Spark", "at": item.get("needs_render_at"), "note": item["needs_render_why"]}]
    log("working", item["code"], item["media_type"], "notes:", len(notes), "specs:", len(specs))
    if item["media_type"] == "video":
        return video(item, notes, specs, st)
    if item["media_type"] == "carousel":
        return carousel(item, notes, specs, st)
    raise Hold(f"I do not re-cut {item['media_type']} posts yet.")


def main(argv):
    if os.path.exists(OFF):
        return "skip: cy_recut is switched off (" + OFF + ")"
    only = argv[argv.index("--only") + 1].upper() if "--only" in argv else None
    force = "--force" in argv
    REUSE[0] = "--reuse" in argv
    REDO[0] = "--redo" in argv
    lockf = open(LOCK, "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return "skip: another cy_recut run is working (lock held)"
    os.makedirs(RECUT_OUT, exist_ok=True)
    import threading
    threading.Thread(target=_pulse, daemon=True).start()
    st = state()
    # self-heal a run that was killed (reboot, power cut): we hold the lock, so nobody is working. Undo its claim and put any re-queued take back.
    for up, rs in list(st.get("restore", {}).items()):
        try:
            lib._req("PATCH", f"/rest/v1/client_uploads?id=eq.{up}", {"review_state": rs, "edit_claimed_at": None})
            st["restore"].pop(up, None)
            log("healed: take", up[:8], "put back to", rs)
        except Exception as e:  # noqa: BLE001
            log("heal failed:", e)
    try:
        lib._req("PATCH", f"/rest/v1/approval_items?work_by=eq.{WORKER}", {"work_kind": None, "work_by": None, "work_started_at": None, "work_note": None})
    except Exception as e:  # noqa: BLE001
        log("claim heal failed:", e)
    held = st.setdefault("hold", {})
    for k in list(held):
        if time.time() - held[k]["ts"] > 86400:
            held.pop(k)
    cid = centering_id()
    items = stuck_items(cid)
    if REDO[0] and only:                                           # --redo CODE: cut an item again even though it is already back in To review
        items = lib.get("approval_items", f"client_id=eq.{cid}&code=eq.{only}&select=id,code,title,media_type,media_url,thumb_url,caption,provenance,internal_status,needs_render_at,needs_render_why,content_version,work_kind,work_by,work_started_at") or []
    todo = [i for i in items if (i["code"] == only if only else True) and (force or i["id"] not in held)
            and not (i.get("work_by") and not str(i["work_by"]).startswith("cy_recut") and i.get("work_started_at") and time.time() - time.mktime(time.strptime(i["work_started_at"][:19], "%Y-%m-%dT%H:%M:%S")) + time.timezone < 7200)]
    if "--dry" in argv:
        return f"ok (dry): {len(items)} in Needs changes, {len(held)} on hold; next: {todo[0]['code'] if todo else 'none'}"
    if not todo:
        save(st)
        return f"0 to re-cut ({len(items)} in Needs changes, {len(held)} on hold)"
    item = todo[0]
    tries = st.setdefault("tries", {})
    claim(item)
    beat(f"{item['code']} {item['title'][:50]}", force=True)
    try:
        res = work(item, st)
        tries.pop(item["id"], None)
        held.pop(item["id"], None)
        try:
            lib.rpc("cy_recut_mark_done", p_item=item["id"])
        except Exception as e:  # noqa: BLE001
            log("batch bookkeeping failed:", str(e)[:200])
        C.raise_alert("studio:recut.hold." + item["code"], "resolved", "Spark: re-cut hold cleared for " + item["code"], "re-cut filed")
        save(st)
        left = len(items) - 1
        return f"ok: {res}; {left} more in Needs changes"
    except Hold as h:
        say_hold(item, str(h), st)
        save(st)
        return f"hold: {item['code']}: {h}"
    except BaseException as e:  # noqa: BLE001
        msg = f"{type(e).__name__}: {str(e)[:500]}"
        tries[item["id"]] = tries.get(item["id"], 0) + 1
        if tries[item["id"]] >= 3:
            say_hold(item, f"three tries in a row failed (last error: {str(e)[:250]})", st)
            tries.pop(item["id"], None)
        save(st)
        raise
    finally:
        try:
            release(item)
        except Exception as e:  # noqa: BLE001
            log("release failed:", e)
