#!/usr/bin/env python3
"""Bestly wall — App Store status per app (Mac mini, launchd tech.bestly.wall-appstore, every 2 h).

Uses the App Store Connect API key that already lives on this Mac (~/.appstoreconnect/private_keys/AuthKey_<id>.p8,
key id + issuer also in Vault as asc_key_id / asc_issuer_id); the key never leaves the Mac. Posts
[{app, version, status, at, live}] to wall_pi_feed_put('appstore') with the wall agent key
(~/.bestly/wall-feeds/report.json, copied from the Pi, chmod 600). Scout watchdog: wall_feeds_watch (wall.feeds.appstore).
Plan: docs/wall-round3-2026-09-27-opusplan.md (W3).
"""
import glob, json, os, sys, time, urllib.error, urllib.request
import jwt  # PyJWT (already used by ~/cy-ship scripts)

HOME = os.path.expanduser("~")
REPORT = os.path.join(HOME, ".bestly/wall-feeds/report.json")
PUB = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
STATES = {
    "READY_FOR_SALE": "Ready for Sale", "READY_FOR_DISTRIBUTION": "Ready for Sale", "WAITING_FOR_REVIEW": "Waiting for Review",
    "IN_REVIEW": "In Review", "REJECTED": "Rejected", "METADATA_REJECTED": "Metadata Rejected", "DEVELOPER_REJECTED": "Pulled by you",
    "PREPARE_FOR_SUBMISSION": "Preparing", "PENDING_DEVELOPER_RELEASE": "Ready to release", "PENDING_APPLE_RELEASE": "Releasing",
    "PROCESSING_FOR_APP_STORE": "Processing", "PROCESSING_FOR_DISTRIBUTION": "Processing", "READY_FOR_REVIEW": "Ready for Review",
    "WAITING_FOR_EXPORT_COMPLIANCE": "Needs export info", "INVALID_BINARY": "Invalid build", "REMOVED_FROM_SALE": "Removed",
    "DEVELOPER_REMOVED_FROM_SALE": "Removed", "REPLACED_WITH_NEW_VERSION": "Replaced", "ACCEPTED": "Accepted",
}


def token():
    iss = open(os.path.join(HOME, ".appstoreconnect/issuer_id")).read().strip()
    path = sorted(glob.glob(os.path.join(HOME, ".appstoreconnect/private_keys/AuthKey_*.p8")))[0]
    kid = os.path.basename(path)[8:-3]
    return jwt.encode({"iss": iss, "iat": int(time.time()), "exp": int(time.time()) + 900, "aud": "appstoreconnect-v1"},
                      open(path).read(), algorithm="ES256", headers={"kid": kid, "typ": "JWT"})


def asc(path, tok):
    r = urllib.request.Request("https://api.appstoreconnect.apple.com" + path, headers={"Authorization": "Bearer " + tok})
    with urllib.request.urlopen(r, timeout=60) as x:
        return json.loads(x.read())


def rpc(fn, args):
    cfg = json.load(open(REPORT))
    req = urllib.request.Request(cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/" + fn,
                                 data=json.dumps({**args, "p_token": cfg["agent_key"]}).encode(),
                                 headers={"Content-Type": "application/json", "apikey": PUB, "Authorization": "Bearer " + PUB})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def main():
    try:
        tok = token()
        apps = asc("/v1/apps?limit=50&fields[apps]=name,bundleId", tok)["data"]
        out = []
        for a in apps:
            vs = asc(f"/v1/apps/{a['id']}/appStoreVersions?limit=6&fields[appStoreVersions]=versionString,appStoreState,appVersionState,platform,createdDate", tok)["data"]
            if not vs:
                continue
            vs.sort(key=lambda v: v["attributes"].get("createdDate") or "", reverse=True)
            top = vs[0]["attributes"]
            st = top.get("appVersionState") or top.get("appStoreState") or ""
            live = next((v["attributes"]["versionString"] for v in vs
                         if (v["attributes"].get("appVersionState") or v["attributes"].get("appStoreState")) in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION")), None)
            name = a["attributes"]["name"].split(":")[0].strip()
            out.append({"app": name, "version": top.get("versionString"), "status": STATES.get(st, st.replace("_", " ").title()),
                        "state": st, "at": top.get("createdDate"), "live": live, "platform": top.get("platform")})
        # what needs attention first: rejected, in review, waiting, then live
        rank = {"Rejected": 0, "Metadata Rejected": 0, "Invalid build": 0, "In Review": 1, "Waiting for Review": 2, "Ready to release": 2}
        out.sort(key=lambda x: (rank.get(x["status"], 5), x["app"]))
        print(time.strftime("%F %T"), "appstore", len(out), rpc("wall_pi_feed_put", {"p_kind": "appstore", "p_data": out}), flush=True)
    except Exception as e:
        msg = f"{type(e).__name__}: {str(e)[:200]}"
        print(time.strftime("%F %T"), "appstore failed", msg, flush=True)
        try:
            rpc("wall_pi_feed_put", {"p_kind": "appstore", "p_data": None, "p_error": msg})
        except Exception:
            pass
        sys.exit(1)


if __name__ == "__main__":
    main()
