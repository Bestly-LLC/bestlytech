#!/usr/bin/env python3
"""Sweep - the Mac mini's janitor (Bestly AI employee, hired 2026-10-05).

Job: keep the Mac mini's disk healthy so it never locks up again (Jared has had to erase it 3 times).
Every 10 min (LaunchAgent tech.bestly.sweep; heavy steps are spaced out inside):
  1. measure free space, catch runaway growth (a script spraying files) and say who is doing it
  2. clean what is safe to clean (tool caches, old temp files, build caches, giant logs, old installers)
  3. move old files that are not needed here to Nextcloud on the Pi (LAN, checksummed, then delete)
  4. check in with Scout (agent_beat) and raise / clear disk alerts signed "Sweep"
Never touches: Photos, iCloud, Documents, Desktop, Developer code, Claude app data, Ollama models, Keychains.
Every delete or move is written to ledger.jsonl next to this file.

Deployed copy: ~/Bestly/sweep/sweep.py on the Mac mini (this file is the repo copy).
"""
import fcntl, hashlib, json, os, shutil, subprocess, sys, time, urllib.request

HOME = os.path.expanduser("~")
DIR = os.path.join(HOME, "Bestly", "sweep")
STATE = os.path.join(DIR, "state.json")
LEDGER = os.path.join(DIR, "ledger.jsonl")
LOG = os.path.join(DIR, "sweep.log")
DATA_VOL = "/System/Volumes/Data"
SLUG, NAME = "mac-sweep", "Sweep"
PI = "bestly-pi-lan"
NC_DATA = "/mnt/ssd/apps/nextcloud/html/data/jared/files"   # Nextcloud user files on the Pi SSD
PI_STAGE = "/mnt/ssd/staging-mac"                           # no spaces: macOS rsync splits remote paths
RCLONE = os.path.join(HOME, "bin", "rclone")
WARN_GB, CRIT_GB, CLEAR_GB = 25, 12, 35                     # free-space alert levels
RUNAWAY_GB = 3                                              # free space dropping this much between runs (10 min) = runaway
DAY = 86400
DRY = "--dry-run" in sys.argv
FORCE = "--force" in sys.argv

INSTALLER_EXT = (".dmg", ".pkg", ".xip", ".iso")
TMP_EXT = (".png", ".jpg", ".jpeg", ".mp4", ".mov", ".webm", ".log", ".json", ".html", ".zip", ".tar", ".gz",
           ".pbf", ".wav", ".m4a", ".mp3", ".txt", ".csv", ".pdf", ".apk", ".b64")
AUDIO_EXT = (".m4a", ".wav", ".mp3")


def log(msg):
    line = time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg
    print(line)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def ledger(action, path, size, note=""):
    with open(LEDGER, "a") as f:
        f.write(json.dumps({"at": int(time.time()), "action": action, "path": path, "bytes": size, "note": note}) + "\n")


def load(p, d):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return d


def save(p, obj):
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, p)


def free_gb():
    return shutil.disk_usage(DATA_VOL).free / 1e9


def gb(n):
    return "%.1f GB" % (n / 1e9)


def run(cmd, timeout=600):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return 1, str(e)


def dir_bytes(path, timeout=300):
    rc, out = run(["du", "-xsk", path], timeout)
    try:
        return int(out.split()[0]) * 1024
    except Exception:
        return 0


def remove(path, why):
    """Delete a file or folder (logged). Returns bytes freed."""
    try:
        size = os.path.getsize(path) if os.path.isfile(path) else dir_bytes(path, 120)
    except OSError:
        return 0
    if DRY:
        log("  [dry] would delete %s (%s, %s)" % (path, gb(size), why))
        return size
    try:
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        ledger("delete", path, size, why)
        return size
    except OSError as e:
        log("  could not delete %s: %s" % (path, e))
        return 0


def age_days(path):
    try:
        return (time.time() - os.lstat(path).st_mtime) / DAY
    except OSError:
        return 0


# ----------------------------------------------------------------- Scout
def _secret():
    rc, out = run(["security", "find-generic-password", "-s", "bestly-home-hub-agent", "-w"], 20)
    return out.strip() if rc == 0 else ""


def _post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers=dict({"Content-Type": "application/json"}, **headers))
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def beat(ok, summary):
    cfg, key = load(os.path.join(DIR, "config.json"), {}), _secret()
    if DRY or not cfg or not key:
        return
    try:
        _post(cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/agent_beat",
              {"p_slug": SLUG, "p_ok": ok, "p_summary": summary[:480], "p_token": key},
              {"apikey": cfg["publishable"], "Authorization": "Bearer " + cfg["publishable"]})
    except Exception as e:
        log("beat failed: %s" % e)


def event(st, key, kind, severity, title, body, push=False):
    """Raise or clear a Scout issue. Titles are signed by Sweep (Jared's rule: every alert has an owner)."""
    sent = st.setdefault("sent", {})
    if kind == "resolved" and sent.get(key) != "problem":
        return
    if kind == "problem" and sent.get(key) == "problem" and time.time() - st.get("sent_at", {}).get(key, 0) < 3 * 3600:
        return
    cfg, secret = load(os.path.join(DIR, "config.json"), {}), _secret()
    if DRY or not cfg or not secret:
        log("  [event] %s %s: %s" % (key, kind, title))
        return
    try:
        _post(cfg["supabase_url"].rstrip("/") + "/functions/v1/home-hub-agent",
              {"op": "event", "key": key, "kind": kind, "severity": severity, "title": "Sweep: " + title,
               "body": body + "\n\n- Sweep, Mac mini janitor", "push": push},
              {"x-api-key": secret})
        sent[key] = kind
        st.setdefault("sent_at", {})[key] = time.time()
    except Exception as e:
        log("event failed %s: %s" % (key, e))


# ----------------------------------------------------------------- safe cleanup
def clean_tmp():
    """Old files Claude and scripts leave in /tmp (screenshots, renders, logs, downloads)."""
    freed, me = 0, os.getuid()
    for root in ("/private/tmp",):
        try:
            names = os.listdir(root)
        except OSError:
            continue
        for n in names:
            p = os.path.join(root, n)
            try:
                s = os.lstat(p)
            except OSError:
                continue
            if s.st_uid != me or not os.path.isfile(p) or os.path.islink(p):
                continue
            if n.lower().endswith(TMP_EXT) and s.st_size > 512 * 1024 and age_days(p) > 2:
                freed += remove(p, "temp file older than 2 days")
    return freed


def truncate_logs():
    """Any log over 200 MB keeps only its last 20 MB."""
    freed = 0
    for root in (os.path.join(HOME, "Bestly"), os.path.join(HOME, ".bestly"), os.path.join(HOME, "MeetingRec"),
                 os.path.join(HOME, "Library", "Logs"), "/private/tmp"):
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if not d.startswith(".git") and d != "node_modules"]
            for fn in fns:
                if not (fn.endswith(".log") or fn.endswith(".out") or fn.endswith(".err")):
                    continue
                p = os.path.join(dp, fn)
                try:
                    size = os.path.getsize(p)
                except OSError:
                    continue
                if size > 200 * 1024 * 1024:
                    if DRY:
                        log("  [dry] would trim %s (%s)" % (p, gb(size)))
                        continue
                    try:
                        with open(p, "rb") as f:
                            f.seek(-20 * 1024 * 1024, 2)
                            tail = f.read()
                        with open(p, "wb") as f:
                            f.write(tail)
                        freed += size - len(tail)
                        ledger("trim", p, size - len(tail), "log over 200 MB")
                    except OSError as e:
                        log("  trim failed %s: %s" % (p, e))
    return freed


def clean_caches(st, emergency):
    """Tool caches that rebuild themselves. Daily, or right away when space is tight."""
    if not emergency and time.time() - st.get("caches_at", 0) < DAY:
        return 0
    before = free_gb()
    uv = os.path.join(HOME, ".local", "bin", "uv")
    if os.path.exists(uv) and not DRY:
        run([uv, "cache", "clean" if emergency else "prune", "--force"], 1800)
    brew = shutil.which("brew") or "/opt/homebrew/bin/brew"
    if os.path.exists(brew) and not DRY:
        run([brew, "cleanup", "-s", "--prune=7"], 900)
    npm_cache = os.path.join(HOME, ".npm", "_cacache")
    if os.path.isdir(npm_cache) and (emergency or dir_bytes(npm_cache) > 2e9) and not DRY:
        run(["npm", "cache", "clean", "--force"], 600)
    pip_cache = os.path.join(HOME, "Library", "Caches", "pip")
    if os.path.isdir(pip_cache) and (emergency or dir_bytes(pip_cache) > 1e9):
        remove(pip_cache, "pip download cache")
    dd = os.path.join(HOME, "Library", "Developer", "Xcode", "DerivedData")
    if os.path.isdir(dd):
        for n in os.listdir(dd):
            p = os.path.join(dd, n)
            if age_days(p) > (1 if emergency else 7):
                remove(p, "Xcode build cache")
    if time.time() - st.get("sims_at", 0) > 7 * DAY and not DRY:
        run(["xcrun", "simctl", "delete", "unavailable"], 600)
        st["sims_at"] = time.time()
    if emergency:
        for p in (os.path.join(HOME, "Library", "Caches", "ms-playwright"),
                  os.path.join(HOME, "Library", "Caches", "Google", "Chrome", "Default", "Cache"),
                  os.path.join(HOME, "Library", "Caches", "com.openai.codex")):
            if os.path.isdir(p):
                remove(p, "emergency: rebuildable cache")
    st["caches_at"] = time.time()
    return max(0, (free_gb() - before) * 1e9)


# ----------------------------------------------------------------- Nextcloud (Pi, over the LAN)
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def q(s):
    return "'" + s.replace("'", "'\\''") + "'"


def ssh(cmd, timeout=600):
    return run(["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", PI, cmd], timeout)


def nc_names(rel_dir):
    """{name: size} of files already in a Nextcloud folder (recursive)."""
    rc, out = ssh("sudo find %s -type f -printf '%%s %%f\\n' 2>/dev/null" % q(NC_DATA + "/" + rel_dir), 120)
    have = {}
    for ln in out.splitlines():
        parts = ln.split(" ", 1)
        if len(parts) == 2 and parts[0].isdigit():
            have.setdefault(parts[1], set()).add(int(parts[0]))
    return have


def nc_move(files, rel_dir, why):
    """Copy files to Nextcloud/<rel_dir> on the Pi, prove each copy by SHA-256, then delete the Mac copy."""
    files = [f for f in files if os.path.isfile(f)]
    if not files:
        return 0, 0
    if DRY:
        for f in files:
            log("  [dry] would move %s -> Nextcloud/%s" % (f, rel_dir))
        return len(files), sum(os.path.getsize(f) for f in files)
    batch = "%s/b%d" % (PI_STAGE, int(time.time()))
    rc, out = ssh("sudo mkdir -p %s && sudo chown pi:pi %s %s" % (q(batch), q(PI_STAGE), q(batch)), 60)
    if rc:
        log("  stage failed: %s" % out[-200:]); return 0, 0
    rc, out = run(["rsync", "-a"] + files + ["%s:%s/" % (PI, batch)], 7200)
    if rc:
        log("  rsync failed: %s" % out[-300:]); ssh("sudo rm -rf %s" % q(batch)); return 0, 0
    rc, out = ssh("cd %s && sha256sum -- *" % q(batch), 1800)
    remote = {}
    for ln in out.splitlines():
        parts = ln.split(None, 1)
        if len(parts) == 2:
            remote[parts[1].lstrip("*")] = parts[0]
    good = [f for f in files if remote.get(os.path.basename(f)) == sha256(f)]
    dest = NC_DATA + "/" + rel_dir
    names = " ".join(q(batch + "/" + os.path.basename(f)) for f in good)
    if good:
        rc, out = ssh("sudo mkdir -p %s && sudo mv -n %s %s/ && sudo chown -R 33:33 %s && "
                      "docker exec -u www-data nextcloud-nextcloud-1 php occ files:scan --path=%s >/dev/null"
                      % (q(dest), names, q(dest), q(dest), q("jared/files/" + rel_dir)), 900)
        if rc:
            log("  Nextcloud add failed: %s" % out[-300:]); good = []
    ssh("sudo rm -rf %s" % q(batch), 120)
    have = nc_names(rel_dir) if good else {}
    moved = freed = 0
    for f in good:
        size = os.path.getsize(f)
        if size in have.get(os.path.basename(f), ()):
            os.remove(f); ledger("move", f, size, "Nextcloud/%s (%s)" % (rel_dir, why))
            moved += 1; freed += size
        else:
            log("  kept %s (not confirmed in Nextcloud)" % f)
    return moved, freed


def offload_recordings():
    """MeetingRec audio older than 7 days: already in Nextcloud -> delete here; not there yet -> send it over the LAN.
    (The recorder's own uploader goes through Cloudflare and times out on big files: HTTP 524.)"""
    rec = os.path.join(HOME, "MeetingRec", "recordings")
    if not os.path.isdir(rec):
        return 0, 0
    old = [os.path.join(rec, n) for n in sorted(os.listdir(rec))
           if n.lower().endswith(AUDIO_EXT) and age_days(os.path.join(rec, n)) > 7]
    if not old:
        return 0, 0
    have, moved, freed, todo = nc_names("Meeting Recordings"), 0, 0, {}
    for f in old:
        size = os.path.getsize(f)
        if size in have.get(os.path.basename(f), ()):
            freed += remove(f, "already in Nextcloud/Meeting Recordings"); moved += 1
        else:
            n = os.path.basename(f)
            day = "%s-%s-%s" % (n[8:12], n[12:14], n[14:16]) if n.startswith("meeting-") and n[8:16].isdigit() else "older"
            todo.setdefault(day, []).append(f)
    for day, fs in todo.items():
        m, b = nc_move(fs, "Meeting Recordings/" + day, "meeting audio older than 7 days")
        moved += m; freed += b
    return moved, freed


def offload_downloads():
    """Downloads older than 14 days: installers are deleted (they can be downloaded again), anything else over
    20 MB goes to Nextcloud. Small files stay."""
    dl = os.path.join(HOME, "Downloads")
    moved = freed = 0
    batch = []
    for n in os.listdir(dl) if os.path.isdir(dl) else []:
        p = os.path.join(dl, n)
        if n.startswith(".") or age_days(p) <= 14 or not os.path.isfile(p):
            continue
        if n.lower().endswith(INSTALLER_EXT):
            freed += remove(p, "installer older than 14 days"); moved += 1
        elif os.path.getsize(p) > 20 * 1024 * 1024:
            batch.append(p)
    if batch:
        m, b = nc_move(batch, "Mac Mini Archive/Downloads/" + time.strftime("%Y-%m"), "download older than 14 days")
        moved += m; freed += b
    return moved, freed


def offload_meeting_wavs():
    d = os.path.join(HOME, "meetings")
    if not os.path.isdir(d):
        return 0, 0
    old = [os.path.join(d, n) for n in os.listdir(d) if n.lower().endswith(AUDIO_EXT) and age_days(os.path.join(d, n)) > 30]
    return nc_move(old, "Mac Mini Archive/meetings-wav", "meeting audio older than 30 days") if old else (0, 0)


# ----------------------------------------------------------------- who is filling the disk
WATCH_GLOBS = (HOME, os.path.join(HOME, "Library"), os.path.join(HOME, "Library", "Caches"),
               os.path.join(HOME, "Library", "Application Support"), os.path.join(HOME, ".cache"), "/private/tmp")


def size_map():
    """Top-level folder sizes (the places a runaway script would fill)."""
    out = {}
    for root in WATCH_GLOBS:
        try:
            kids = [os.path.join(root, n) for n in os.listdir(root)]
        except OSError:
            continue
        for p in kids:
            if os.path.islink(p) or not os.path.isdir(p) or p in WATCH_GLOBS:
                continue
            out[p] = dir_bytes(p, 600)
    return out


def growth(st, now_map):
    prev = st.get("sizes") or {}
    diffs = sorted(((now_map[p] - prev.get(p, now_map[p]), p) for p in now_map), reverse=True)
    return [(d, p) for d, p in diffs[:5] if d > 200e6]


def tip_text(rows):
    return "; ".join("%s grew %s" % (p.replace(HOME, "~"), gb(d)) for d, p in rows) or "no single folder stands out"


# ----------------------------------------------------------------- main
def main():
    os.makedirs(DIR, exist_ok=True)
    lockf = open(os.path.join(DIR, ".lock"), "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("another Sweep run is going"); return
    st = load(STATE, {})
    t0, free0 = time.time(), free_gb()
    last_free, last_at = st.get("free"), st.get("at", 0)
    emergency = free0 < CRIT_GB or FORCE
    log("run: %.1f GB free%s" % (free0, " (EMERGENCY)" if emergency else ""))
    notes, freed, moved, ok = [], 0, 0, True

    # 1. runaway: free space fell fast since the last run (about 10 min ago)
    runaway = last_free is not None and t0 - last_at < 3 * 3600 and last_free - free0 > RUNAWAY_GB
    if runaway or time.time() - st.get("sizes_at", 0) > 6 * 3600:
        smap = size_map()
        rows = growth(st, smap)
        if runaway:
            event(st, "mac.disk.runaway", "problem", "error",
                  "Mac mini lost %.0f GB in %d min" % (last_free - free0, (t0 - last_at) / 60),
                  "Something is filling the disk fast. Biggest growth: %s. Cleaning what is safe now." % tip_text(rows),
                  push=True)
            emergency = True
        st["sizes"], st["sizes_at"] = smap, time.time()
    elif last_free is not None and free0 - last_free > -1:
        event(st, "mac.disk.runaway", "resolved", "success", "Mac mini disk growth is back to normal", "")

    # 2. safe cleanup, then Nextcloud moves
    for name, fn in (("temp", clean_tmp), ("logs", truncate_logs)):
        try:
            b = fn(); freed += b
            if b > 50e6: notes.append("%s %s" % (name, gb(b)))
        except Exception as e:
            ok = False; log("%s failed: %s" % (name, e))
    try:
        b = clean_caches(st, emergency); freed += b
        if b > 50e6: notes.append("caches %s" % gb(b))
    except Exception as e:
        ok = False; log("caches failed: %s" % e)
    if emergency or time.time() - st.get("moves_at", 0) > 6 * 3600:
        for name, fn in (("recordings", offload_recordings), ("downloads", offload_downloads),
                         ("meeting wavs", offload_meeting_wavs)):
            try:
                m, b = fn(); moved += m; freed += b
                if m: notes.append("%s: %d files, %s" % (name, m, gb(b)))
            except Exception as e:
                ok = False; log("%s failed: %s" % (name, e))
        st["moves_at"] = time.time()

    # 3. free-space alerts
    free1 = free_gb()
    if free1 < CRIT_GB:
        event(st, "mac.disk.low", "problem", "error", "Mac mini is almost full (%.0f GB free)" % free1,
              "I cleaned what is safe and it is still tight. Biggest folders: %s." %
              ", ".join("%s %s" % (p.replace(HOME, "~"), gb(b)) for p, b in
                        sorted((st.get("sizes") or {}).items(), key=lambda x: -x[1])[:5]), push=True)
    elif free1 < WARN_GB:
        event(st, "mac.disk.low", "problem", "warning", "Mac mini space is getting low (%.0f GB free)" % free1,
              "Cleaning daily. Not urgent yet.", push=False)
    elif free1 > CLEAR_GB:
        event(st, "mac.disk.low", "resolved", "success", "Mac mini has room again (%.0f GB free)" % free1, "")

    summary = "%.0f GB free" % free1 + (" · freed %s" % gb(freed) if freed > 50e6 else "") + \
              (" · %d files moved/removed" % moved if moved else "") + (" · " + "; ".join(notes) if notes else "")
    log("done in %ds: %s" % (time.time() - t0, summary))
    if not ok:
        event(st, "mac.sweep.error", "problem", "warning", "A cleanup step failed", "See ~/Bestly/sweep/sweep.log.")
    else:
        event(st, "mac.sweep.error", "resolved", "success", "Cleanup steps are working again", "")
    beat(ok, summary)
    st["free"], st["at"] = free1, time.time()
    if not DRY:
        save(STATE, st)
    # keep our own log small
    try:
        if os.path.getsize(LOG) > 5e6:
            with open(LOG) as f:
                tail = f.readlines()[-2000:]
            with open(LOG, "w") as f:
                f.writelines(tail)
    except OSError:
        pass


if __name__ == "__main__":
    main()
