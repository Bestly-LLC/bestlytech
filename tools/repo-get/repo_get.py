#!/usr/bin/env python3
"""repo_get: fetch one file of the site repo through the repo-read edge function (authenticated, stdlib only).

Runs on the Pi (uses the service key already in /home/pi/scripts/.env, same as the cron jobs).
  repo_get.py <path-in-repo> [-r <main|commit>] [-o <out file>]     file bytes to -o, or to stdout
  repo_get.py --status <commit>                                       prints the build state (success/failure/pending)
Exit 0 on success, 1 on failure (message on stderr). Writes via <out>.part then renames, so a short download never replaces a good file.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ENV_FILES = ["/home/pi/scripts/.env", "/home/pi/.config/bestly-cron.env"]


def load_env():
    for path in ENV_FILES:
        try:
            for line in open(path):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except FileNotFoundError:
            pass


def open_url(query, timeout=300):
    load_env()
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SECRET_KEY", "")
    if not base or not key:
        raise RuntimeError("no Supabase URL/key in /home/pi/scripts/.env")
    headers = {"apikey": key}
    if key.startswith("eyJ"):   # new-style sb_secret_ keys are not JWTs and must not go in Authorization
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(base + "/functions/v1/repo-read?" + query, headers=headers)
    return urllib.request.urlopen(req, timeout=timeout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?")
    ap.add_argument("-r", "--ref", default="main")
    ap.add_argument("-o", "--out")
    ap.add_argument("--status")
    a = ap.parse_args()
    try:
        if a.status:
            with open_url("status=" + a.status, 30) as r:
                print(json.loads(r.read().decode()).get("state", "pending"))
            return 0
        if not a.path:
            ap.error("path required")
        with open_url("path=" + urllib.request.quote(a.path) + "&ref=" + a.ref) as r:
            if a.out:
                part = a.out + ".part"
                n = 0
                with open(part, "wb") as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        f.write(b)
                        n += len(b)
                want = int(r.headers.get("Content-Length") or 0)
                if want and n != want:
                    os.remove(part)
                    raise RuntimeError("short download (%d of %d bytes)" % (n, want))
                os.replace(part, a.out)
            else:
                sys.stdout.buffer.write(r.read())
        return 0
    except urllib.error.HTTPError as e:
        print("repo_get: HTTP %d %s" % (e.code, e.read().decode()[:200]), file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print("repo_get: %s" % e, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
