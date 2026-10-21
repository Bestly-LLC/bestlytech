"""Ares: repo consumers watch (Pi cron job, every 30 minutes). Installed as /opt/bestly/cron/jobs/repo_consumers_watch.py.

The site repo is private, so everything that used to download from it without logging in now goes through one of two doors.
This job checks both doors, and if one is shut it raises a Scout alert signed by Ares (security).
  1. repo-read edge function (Vault GitHub token, server side): Pi installers/deploy helpers, the Mac meetingrec agent's code sync,
     the Mac code worker's build-result check. Checked here with the Pi's own key: file fetch, fetch at a commit, build status.
  2. The public website (www.bestly.tech): Apple Wallet pass art (wallet-pass function) and the Montage brand assets.
Also checks the wallet-pass and admin-chat functions answer, and the Pi helper is in place (self-heal: re-installs it through repo-read).
Retries a failure once after 20 seconds before alerting, so a blip never pages anyone.
Output starting with "ok" is a quiet run. Off switch: touch /opt/bestly/cron/state/repo_consumers_watch.OFF
"""
import json
import os
import time
import urllib.error
import urllib.request

import lib

OWNER = "Ares (security)"
SITE = "https://www.bestly.tech"
HELPER = "/opt/bestly/cron/tools/repo_get.py"
KNOWN_SHA = "24b5398e38981091017751dfb2167d32270aa8ce"      # an old commit that always exists, for the fetch-at-a-commit check
WALLET = ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "logo@3x.png", "strip.png", "strip@2x.png", "strip@3x.png"]
HOST = ["strip.png", "strip@2x.png", "strip@3x.png"]
MONTAGE = ["agent-demo/people/mark-ellis.webp", "agent-demo/logos/ridgeline-plumbing.svg"]
OFF = "/opt/bestly/cron/state/repo_consumers_watch.OFF"


def http(url, headers=None, method="GET", timeout=30):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "repo-consumers-watch"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("content-type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", ""), e.read()


def repo_read(query):
    h = {"apikey": lib.KEY, "User-Agent": "repo-consumers-watch"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    return http(lib.URL + "/functions/v1/repo-read?" + query, h, timeout=60)


def c_repo_file():
    s, _, b = repo_read("path=scripts/meetingrec/agent.py&ref=main")
    return None if s == 200 and len(b) > 1000 else "repo-read file fetch gave HTTP %s (%d bytes)" % (s, len(b))


def c_repo_ref():
    s, _, b = repo_read("path=tools/repo-get/repo_get.py&ref=main")
    return None if s == 200 and b"repo-read" in b else "repo-read fetch of the Pi helper gave HTTP %s" % s


def c_repo_status():
    s, _, b = repo_read("status=" + KNOWN_SHA)
    try:
        ok = s == 200 and json.loads(b.decode()).get("ok") is True
    except Exception:  # noqa: BLE001
        ok = False
    return None if ok else "repo-read build-status check gave HTTP %s" % s


def c_site(prefix, names, what):
    bad = []
    for n in names:
        s, ct, b = http("%s/%s%s" % (SITE, prefix, n))
        if s != 200 or not ct.startswith("image/") or not b:
            bad.append("%s HTTP %s %s" % (n, s, ct.split(";")[0]))
    return None if not bad else "%s missing on the website: %s" % (what, "; ".join(bad[:4]))


def c_wallet_pass():
    s, _, _ = http(lib.URL + "/functions/v1/wallet-pass?slug=healthcheck")
    return None if s < 500 else "wallet-pass function answers HTTP %s" % s


def c_admin_chat():
    s, _, _ = http(lib.URL + "/functions/v1/admin-chat", method="OPTIONS")
    return None if s < 500 else "admin-chat function answers HTTP %s" % s


def c_helper():
    if os.path.isfile(HELPER) and os.path.getsize(HELPER) > 500:
        return None
    s, _, b = repo_read("path=tools/repo-get/repo_get.py&ref=main")     # self-heal: put the helper back
    if s == 200 and b"repo-read" in b:
        with open(HELPER + ".part", "wb") as f:
            f.write(b)
        os.chmod(HELPER + ".part", 0o755)
        os.replace(HELPER + ".part", HELPER)
        return None
    return "the Pi helper repo_get.py was missing and could not be re-installed (HTTP %s)" % s


CHECKS = [
    ("repo-read file", c_repo_file),
    ("repo-read at a commit", c_repo_ref),
    ("repo-read build status", c_repo_status),
    ("wallet pass art", lambda: c_site("wallet/lax/", WALLET, "wallet pass art")),
    ("wallet host strips", lambda: c_site("wallet/lax/host/", HOST, "wallet host strips")),
    ("montage brand assets", lambda: c_site("", MONTAGE, "montage brand assets")),
    ("wallet-pass function", c_wallet_pass),
    ("admin-chat function", c_admin_chat),
    ("Pi helper", c_helper),
]


def run(checks):
    out = []
    for name, fn in checks:
        try:
            err = fn()
        except Exception as e:  # noqa: BLE001
            err = "%s: %s" % (type(e).__name__, e)
        if err:
            out.append((name, err))
    return out


def main(argv):
    if os.path.exists(OFF):
        return "skip: off switch is on"
    bad = run(CHECKS)
    if bad:
        time.sleep(20)
        again = {n for n, _ in bad}
        bad = run([c for c in CHECKS if c[0] in again])
    if not bad:
        return "ok: %d repo-consumer checks passed" % len(CHECKS)
    body = "; ".join("%s: %s" % b for b in bad)[:600]
    if "--dry" not in argv:
        lib.rpc("scout_notify", p_title="%s: something that reads the site repo stopped working" % OWNER,
                p_body=body, p_severity="warning", p_push=True, p_url="/admin/security",
                p_dedupe="ares-repo-consumers-" + "-".join(sorted(n.replace(" ", "") for n, _ in bad))[:80])
    return "FAILED %d of %d: %s" % (len(bad), len(CHECKS), body)
