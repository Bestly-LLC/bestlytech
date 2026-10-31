"""mtd_site_watch: is https://minutetechdaily.com up, serving the page, and signed correctly?  (Anchor, 2026-10-20)

Plain HTTP, no AI, no Claude. Every 15 minutes (cron, /opt/bestly/cron/run.sh mtd_site_watch):
  1. GET https://minutetechdaily.com/  -> must answer 200 and carry <title>Minute Tech Daily</title>
     (the HTTPS handshake itself proves the certificate is valid; a bad cert is a failed check)
  2. GET /og.png -> 200 and an image
Two bad checks in a row (30 minutes) raise the alert mnd.mtd_site through bestly_raise. Its key starts with "mnd" and p_area is "mnd", so the
same owner as the Minute News Daily watcher (Anchor, notification_owners prefix "mnd") signs it. The next good check clears it.
Self-heal: when a check is bad, the Vercel API (read-only token pi:vercel:api_token via pi_secret_get) is asked for the latest production
deployment. ONLY if that deployment ERRORED and a deploy token exists in Vault (pi:vercel:deploy_token) the last READY production
deployment is re-deployed (at most once an hour). Otherwise it only alerts, and says why.
Not armed until the site has answered well once (so the days between "domain bought" and "DNS live" stay quiet); if it has still never
come up three hours after the first look, that is raised once.
  Off switch : touch /opt/bestly/cron/state/mtd_site.OFF
  --dry      : look and say, no state, no alert, no redeploy
  --test-alert : raise and clear a quiet test alert to prove the alert path
Undo: crontab /opt/bestly/cron/crontab.bak-20261020-mtdsite, then delete jobs/mtd_site_watch.py. Sister of mnd_site_watch.
"""
import json
import os
import time
import urllib.error
import urllib.request

import lib

SITE = "https://minutetechdaily.com"
TITLE = "<title>Minute Tech Daily</title>"
STATE = "/opt/bestly/cron/state/mtd_site.json"
OFF = "/opt/bestly/cron/state/mtd_site.OFF"
KEY = "mnd.mtd_site"
TEAM, PROJECT = "team_Kwxz5PIgolwApAnbC131PCDd", "prj_kNPl5XKx6wCbZjqLs2mhPgYzc1MW"
UA = {"User-Agent": "bestly-pi-watchdog/1.0 (mtd_site_watch)"}


def _get(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read(400_000)
    except urllib.error.HTTPError as e:
        try:
            body = e.read(400_000)
        except Exception:  # noqa: BLE001
            body = b""
        return e.code, "", body


def _challenged(st, body):
    """Vercel's own DDoS mitigation answers 403 with its 'Security Checkpoint' page to a client it distrusts (the Pi's home
    address after a burst of checks, 2026-10-31). Real browsers solve the challenge and load the site, so this is not the
    site being down; it is Vercel vetting this address. Treated as pass-with-note, never as an outage."""
    return st == 403 and b"Vercel Security Checkpoint" in (body or b"")


def check():
    """-> (ok, reason)"""
    last = ""
    for attempt in (1, 2):
        try:
            st, _, body = _get(SITE + "/")
            if _challenged(st, body):
                return True, "ok (Vercel is challenging this Pi's address with its Security Checkpoint; browsers load the site)"
            if st != 200:
                last = f"the home page answered HTTP {st}"
            elif TITLE not in body.decode("utf-8", "replace"):
                last = "the home page loads but the Minute Tech Daily title is missing"
            else:
                st2, ct, _ = _get(SITE + "/og.png")
                if st2 != 200 or "image" not in ct:
                    last = f"the share image /og.png answered HTTP {st2}"
                else:
                    return True, "ok"
        except Exception as e:  # noqa: BLE001
            last = f"could not load the site ({type(e).__name__}: {str(e)[:120]})"
        if attempt == 1:
            time.sleep(6)
    return False, last


def _vercel(path, token, method="GET", body=None):
    sep = "&" if "?" in path else "?"
    req = urllib.request.Request(f"https://api.vercel.com{path}{sep}teamId={TEAM}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", **UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode() or "{}")


def _secret(name):
    try:
        v = lib.rpc("pi_secret_get", p_name=name)
        return (v if isinstance(v, str) else (v or {}).get("value") or "") or ""
    except Exception:  # noqa: BLE001
        return ""


def deployment_facts(st, dry):
    """Ask Vercel (read-only) what the latest production deployment looks like; redeploy only when it ERRORED and a deploy token exists."""
    ro = _secret("pi:vercel:api_token")
    if not ro:
        return "Vercel could not be asked (no read token on this Pi)."
    try:
        d = _vercel(f"/v6/deployments?projectId={PROJECT}&target=production&limit=5", ro).get("deployments", [])
    except Exception as e:  # noqa: BLE001
        return f"Vercel could not be asked ({type(e).__name__})."
    if not d:
        return "Vercel shows no production deployment for the project."
    latest = d[0]
    state = latest.get("state") or latest.get("readyState")
    msg = f"Latest Vercel production deployment is {state}."
    if state != "ERROR":
        return msg + (" So the site files are fine; look at DNS or the domain." if state == "READY" else "")
    good = next((x for x in d if (x.get("state") or x.get("readyState")) == "READY"), None)
    tok = _secret("pi:vercel:deploy_token")
    if not tok:
        return msg + " It needs a redeploy, but this Pi only has a read-only Vercel token (add a deploy token to Vault as pi:vercel:deploy_token to let it self-heal)."
    if not good:
        return msg + " No earlier good deployment exists to redeploy."
    if time.time() - st.get("last_redeploy", 0) < 3600:
        return msg + " A redeploy was already tried in the last hour."
    if dry:
        return msg + f" [dry] would redeploy {good['uid']}."
    try:
        _vercel("/v13/deployments?forceNew=1", tok, "POST", {"name": "minutetechdaily", "deploymentId": good["uid"], "target": "production"})
        st["last_redeploy"] = time.time()
        return msg + " Re-deployed the last good production deployment automatically."
    except Exception as e:  # noqa: BLE001
        return msg + f" Tried to redeploy the last good one and it failed ({type(e).__name__})."


def _load():
    try:
        with open(STATE) as f:
            s = json.load(f)
    except Exception:  # noqa: BLE001
        s = {}
    return {"bad_runs": 0, "armed": False, "raised": False, "first_seen": time.time(), "never_raised": False, "last_redeploy": 0, **s}


def _test_alert():
    k = KEY + ".test"
    a = lib.rpc("bestly_raise", p_key=k, p_kind="problem", p_severity="info", p_title="Test of the Minute Tech Daily site check (no action needed)",
                p_body="Test of the alert path from the new 15 minute site check. Nothing is wrong. Raised quietly and cleared right away.", p_area="mnd", p_healed=True)
    b = lib.rpc("bestly_raise", p_key=k, p_kind="resolved", p_severity="info", p_title="Test of the Minute Tech Daily site check cleared", p_body="Test finished.", p_area="mnd")
    return f"ok: test alert raised quietly and cleared (raise {a}, clear {b})"



# ---- ADS (added 2026-10-26, advertise build) ----------------------------------------------------------------------------------
# Every run also checks the advertising pages: /advertise answer 200 with their page markers and load /ads.js, /rates.json is valid JSON with
# sane prices, the public ad_audience() RPC answers, and the inquiry RPC answers (probed with the hidden honeypot field, so no row is
# written and nobody is notified). Quiet until the pages have passed once; then 2 bad runs in a row (30 minutes) raise mnd.mtd_site.ads.
# Off switch: touch /opt/bestly/cron/state/mtd_ads.OFF
ADS_KEY = KEY + ".ads"
ADS_OFF = "/opt/bestly/cron/state/mtd_ads.OFF"
ADS_PAGES = [("/advertise", "<title>Advertise | Minute Tech Daily</title>", ["/ads.js", 'id="ad-ladder"', 'id="ad-form"']),]
ADS_SCOPE = "mtd"
ADS_SB = "https://rcqfqhguwpmaarseifqg.supabase.co/rest/v1/rpc/"
ADS_ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"  # the public key already in the site code; not a secret


def _ads_rpc(fn, payload):
    req = urllib.request.Request(ADS_SB + fn, method="POST", data=json.dumps(payload).encode(),
                                 headers={"apikey": ADS_ANON, "Content-Type": "application/json", **UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, None


def check_ads():
    """-> (ok, reason)"""
    last = ""
    for attempt in (1, 2):
        try:
            last = _check_ads_once()
        except Exception as e:  # noqa: BLE001
            last = f"could not run the advertising check ({type(e).__name__}: {str(e)[:120]})"
        if not last:
            return True, "ok"
        if attempt == 1:
            time.sleep(6)
    return False, last


def _check_ads_once():
    """-> "" when everything is fine, else a plain-words reason."""
    for path, marker, need in ADS_PAGES:
        st, _, body = _get(SITE + path)
        txt = body.decode("utf-8", "replace")
        if st != 200:
            if _challenged(st, body):
                return ""   # Vercel Security Checkpoint for this address: the pages are up for browsers; nothing to raise
            return f"{path} answered HTTP {st}"
        if marker not in txt:
            return f"{path} loads but its page marker is missing"
        for n in need:
            if n not in txt:
                return f"{path} loads but is missing {n}"
    st, _, body = _get(SITE + "/rates.json?_=" + str(int(time.time())))
    if st != 200:
        return f"/rates.json answered HTTP {st}"
    try:
        r = json.loads(body.decode("utf-8", "replace"))
        ts = r["tiers"]
        prices = [float(t["price"]) for t in ts]
        unlocks = [float(t["unlockAt"]) for t in ts]
    except Exception:  # noqa: BLE001
        return "/rates.json is not valid (it must have tiers with a price and an unlockAt)"
    if len(ts) < 2 or min(prices) <= 0 or prices != sorted(prices) or unlocks != sorted(unlocks):
        return "/rates.json has prices that do not step up in order, so the rate card would show wrong numbers"
    st, _, body = _get(SITE + "/ads.js")
    js = body.decode("utf-8", "replace")
    if st != 200 or "ad_audience" not in js or "ad_inquiry_submit" not in js:
        return f"/ads.js answered HTTP {st} or is not the media-kit script"
    # Jared's 2026-10-27 decision: audience numbers stay hidden until the kit passes min_followers (ad_audience_gate), then
    # switch on by themselves. ad_audience_status is the page contract: show_numbers false (hidden, by design) is a PASS;
    # show_numbers true must carry totals. The old check wanted totals from ad_audience(), which returns NULL while hidden,
    # and raised a false alarm every 15 minutes from Oct 28 to Oct 31.
    st, j = _ads_rpc("ad_audience_status", {"p_scope": ADS_SCOPE})
    if st != 200 or not isinstance(j, dict) or "show_numbers" not in j:
        return f"the audience numbers (ad_audience_status) answered HTTP {st} without a show_numbers answer"
    if j.get("show_numbers") is True and "totals" not in j:
        return "the audience numbers (ad_audience_status) say the kit is past the follower gate but carry no totals"
    st, j = _ads_rpc("ad_inquiry_submit", {"p_site": "mtd", "p_name": "watchdog", "p_business": "watchdog", "p_email": "watchdog@example.com",
                                          "p_website": "", "p_sell": "watchdog probe", "p_budget": "", "p_brands": [], "p_hp": "probe"})
    if st != 200 or not (isinstance(j, dict) and j.get("ok") is True):
        return f"the inquiry form (ad_inquiry_submit) answered HTTP {st} and not ok"
    return ""


def ads_step(argv):
    dry = "--dry" in argv
    if os.path.exists(ADS_OFF):
        return "ads skip: off switch is on"
    ok, why = check_ads()
    st = _load()
    msg = None
    if ok:
        st["ads_bad"] = 0
        st["ads_armed"] = True
        if st.get("ads_raised"):
            msg = ("resolved", "Minute Tech Daily advertising pages are working again", "The advertise page, its prices and the inquiry form all answer normally again.")
            st["ads_raised"] = False
    else:
        st["ads_bad"] = st.get("ads_bad", 0) + 1
        if st.get("ads_armed") and st["ads_bad"] >= 2 and not st.get("ads_raised"):
            msg = ("problem", "Minute Tech Daily advertising page has a problem",
                   f"Twice in a row (30 minutes) the check failed: {why}. Advertisers may be seeing a broken page or a form that does not send. "
                   "Off switch: /opt/bestly/cron/state/mtd_ads.OFF.")
            st["ads_raised"] = True
    if not dry:
        with open(STATE, "w") as f:
            json.dump(st, f)
        if msg:
            lib.rpc("bestly_raise", p_key=ADS_KEY, p_kind=msg[0], p_severity="warning" if msg[0] == "problem" else "info",
                    p_title=msg[1], p_body=msg[2], p_area="mnd")
    if ok:
        return "ads ok" + (" [dry]" if dry else "")
    if not st.get("ads_armed"):
        return f"ads skip: not live yet ({why}); quiet until the pages pass once" + (" [dry]" if dry else "")
    return f"ads BAD (run {st['ads_bad']}): {why}"


# ---- ICONS (added 2026-10-27, brand icons sync) ------------------------------------------------------------------------------------
# The Minute brand icons live in ONE place: the public Supabase bucket brand-icons, listed in the table brand_icons (slug, url, thumb_url,
# sha256, thumb_sha256). The Mac mini job icon-sync keeps the bucket, the list and the sites in step with the real icon files. Every run:
#   1. each icon URL in the list answers 200 (a 404 is a problem)
#   2. each file's sha256 matches the list (a mismatch is a problem)
#   3. each LIVE page shows the real icon (an <img> from the bucket), has not fallen back to a letter badge, and shows the current version
# Self-heal: the first bad run asks the Mac job for ONE re-run (it sets the flag in brand_icons_sync_request; the job then re-uploads and
# rebuilds everything within 5 minutes). Only if it is still bad on the next run (15 minutes later) is the alert mnd.mtd_site.icons raised,
# signed by Anchor. Pages that are not live yet are skipped; the bucket and list checks run now. Quiet until everything has passed once.
# Off switch: touch /opt/bestly/cron/state/mtd_icons.OFF   (Mac side: touch ~/TrendLedger/icon-sync/OFF)
import re as _re
import hashlib as _hashlib

ICONS_KEY = KEY + ".icons"
ICONS_OFF = "/opt/bestly/cron/state/mtd_icons.OFF"
ICONS_NEED = ["mtd"]
ICONS_PAGES = {"/": ("data-icon=\"mtd\"", ["mtd", "mnd"]), "/advertise": ("data-icon=\"mtd\"", ["mtd", "mnd"])}
ICONS_REST = "https://rcqfqhguwpmaarseifqg.supabase.co/rest/v1/"
ICONS_ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"  # the public key already in the site code; not a secret


def _icons_get(url, timeout=25):
    """-> (status, all bytes up to 3 MB)"""
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(3_000_000)
    except urllib.error.HTTPError as e:
        return e.code, b""


def _icons_manifest():
    req = urllib.request.Request(ICONS_REST + "brand_icons?select=*", headers={"apikey": ICONS_ANON, **UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return {x["slug"]: x for x in json.loads(r.read().decode("utf-8"))}


def _icons_check_once():
    """-> list of plain-words problems (empty list = fine)"""
    problems = []
    man = _icons_manifest()
    for s in ICONS_NEED:
        row = man.get(s)
        if not row:
            problems.append(f"the {s} icon is missing from the icon list")
            continue
        for label, url, want in (("icon", row.get("url"), row.get("sha256")), ("small icon", row.get("thumb_url"), row.get("thumb_sha256"))):
            if not url:
                if label == "icon":
                    problems.append(f"the {s} icon has no web address in the icon list")
                continue
            st, body = _icons_get(url + "?_=" + str(int(time.time())))
            if st != 200:
                problems.append(f"the {s} {label} answers HTTP {st} (a 404 means the file is gone from the bucket)")
            elif _hashlib.sha256(body).hexdigest() != want:
                problems.append(f"the {s} {label} file does not match the icon list (hash differs)")
    live = 0
    for path, (marker, slugs) in ICONS_PAGES.items():
        st, _, body = _get(SITE + path)
        if st != 200:
            continue  # not live yet: only the bucket and the list are checked until the page is up
        txt = body.decode("utf-8", "replace")
        if marker not in txt:
            continue  # the live page is still the old design (no icon strip yet); it is checked as soon as the new design goes live
        live += 1
        if _re.search(r'class="badge[^"]*\bfb\b', txt):
            problems.append(f"{path} shows a letter badge instead of the real icon")
        for s in slugs:
            row = man.get(s)
            m = _re.search(r'src="([^"]*/brand-icons/' + _re.escape(s) + r'[^"]*)"', txt)
            if not m:
                problems.append(f"{path} falls back to a letter badge for {s} (no icon image on the page)")
                continue
            if not row:
                continue
            want = (row.get("thumb_url") or row.get("url")) + "?v=" + ((row.get("thumb_sha256") or row.get("sha256") or "")[:8])
            if m.group(1).replace("&amp;", "&") != want:
                problems.append(f"{path} still shows an old {s} icon (the page has not been rebuilt with the new one)")
    return problems


def _icons_request_sync(why):
    lib._req("POST", "/rest/v1/brand_icons_sync_request?on_conflict=id",
             [{"id": 1, "reason": ("anchor watch: " + why)[:200], "requested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "handled_at": None}],
             headers={"Prefer": "resolution=merge-duplicates,return=minimal"})


def icons_step(argv):
    dry = "--dry" in argv
    if os.path.exists(ICONS_OFF):
        return "icons skip: off switch is on"
    problems = []
    for attempt in (1, 2):
        try:
            problems = _icons_check_once()
        except Exception as e:  # noqa: BLE001
            problems = [f"could not run the icon check ({type(e).__name__}: {str(e)[:120]})"]
        if not problems:
            break
        if attempt == 1:
            time.sleep(6)
    ok = not problems
    why = "; ".join(problems[:3]) + (f" (and {len(problems) - 3} more)" if len(problems) > 3 else "")
    st = _load()
    msg = None
    healed = False
    if ok:
        st["icons_bad"] = 0
        st["icons_armed"] = True
        if st.get("icons_raised"):
            msg = ("resolved", "Minute Tech Daily icons are back", "Every brand icon loads, matches its file, and the pages show the real icons again.")
            st["icons_raised"] = False
    else:
        st["icons_bad"] = st.get("icons_bad", 0) + 1
        if st["icons_bad"] == 1:
            healed = True  # self-heal: ask the Mac job for one re-run before alerting anyone
        if st.get("icons_armed") and st["icons_bad"] >= 2 and not st.get("icons_raised"):
            msg = ("problem", "Minute Tech Daily brand icons have a problem",
                   f"Twice in a row (30 minutes) the icon check failed, even after the sync job was asked to re-run once: {why}. "
                   "Visitors may see letter badges or missing icons. The job lives on the Mac mini (~/TrendLedger/icon-sync); its log is state/icon_sync.log. "
                   "Off switches: /opt/bestly/cron/state/mtd_icons.OFF here, ~/TrendLedger/icon-sync/OFF on the Mac.")
            st["icons_raised"] = True
    if not dry:
        with open(STATE, "w") as f:
            json.dump(st, f)
        if healed:
            try:
                _icons_request_sync(why)
            except Exception:  # noqa: BLE001
                pass
        if msg:
            lib.rpc("bestly_raise", p_key=ICONS_KEY, p_kind=msg[0], p_severity="warning" if msg[0] == "problem" else "info",
                    p_title=msg[1], p_body=msg[2], p_area="mnd")
    if ok:
        return "icons ok" + (" [dry]" if dry else "")
    if not st.get("icons_armed"):
        return f"icons skip: not passed yet ({why}); quiet until everything passes once" + (" [dry]" if dry else "")
    return f"icons BAD (run {st['icons_bad']}{', re-run requested' if healed else ''}): {why}"



def main(argv):
    out = _main_site(argv)
    try:
        out = f"{out} | {ads_step(argv)}"
    except Exception as e:  # noqa: BLE001
        out = f"{out} | ads check error {type(e).__name__}: {str(e)[:120]}"
    try:
        out = f"{out} | {icons_step(argv)}"
    except Exception as e:  # noqa: BLE001
        out = f"{out} | icons check error {type(e).__name__}: {str(e)[:120]}"
    return out


def _main_site(argv):
    dry = "--dry" in argv
    if "--test-alert" in argv:
        return _test_alert()
    if os.path.exists(OFF):
        return "skip: off switch is on (" + OFF + ")"
    ok, why = check()
    st = _load()
    msg = None
    if ok:
        st["bad_runs"] = 0
        st["armed"] = True
        if st["raised"]:
            msg = ("resolved", "minutetechdaily.com is back", "The Minute Tech Daily site loads again with the right title and share image.")
            st["raised"] = False
    else:
        st["bad_runs"] += 1
        if st["armed"] and st["bad_runs"] >= 2:
            extra = deployment_facts(st, dry)
            msg = ("problem", "minutetechdaily.com is not loading",
                   f"Twice in a row (30 minutes) the check failed: {why}. {extra} Off switch: /opt/bestly/cron/state/mtd_site.OFF.")
            st["raised"] = True
        elif (not st["armed"]) and (time.time() - st["first_seen"] > 3 * 3600) and not st["never_raised"]:
            msg = ("problem", "minutetechdaily.com has not come online yet",
                   f"Three hours after the site check started it still has not loaded: {why}. Most likely the DNS records at Namecheap are not set or not live yet. {deployment_facts(st, dry)}")
            st["never_raised"] = True
            st["raised"] = True
    if not dry:
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        with open(STATE, "w") as f:
            json.dump(st, f)
        if msg:
            lib.rpc("bestly_raise", p_key=KEY, p_kind=msg[0], p_severity="warning" if msg[0] == "problem" else "info",
                    p_title=msg[1], p_body=msg[2], p_area="mnd")
    if ok:
        return "ok: minutetechdaily.com loads, title and og.png fine" + (" [dry]" if dry else "")
    if not st["armed"]:
        return f"skip: not live yet ({why}); alerts arm after the first good check" + (" [dry]" if dry else "")
    return f"BAD (run {st['bad_runs']}{', alert raised' if msg and msg[0] == 'problem' else ', not raised yet'}): {why}"
