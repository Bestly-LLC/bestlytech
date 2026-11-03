#!/usr/bin/env python3
"""Reliable big-file upload to Bestly Cloud (Nextcloud WebDAV chunked upload v2). Stdlib only.

Why this exists (2026-11-03): a single 55-60 MB WebDAV PUT through the Cloudflare tunnel died every time (client "Broken pipe",
Cloudflare 524, Apache 400). One long request has to survive the whole home uplink and the tunnel without a stall, and it
cannot resume. This sends ~10 MB chunks, resumes from the chunks the server already holds, prefers the LAN address when the
Mac is on the home network (no uplink, no Cloudflare), falls back to the tunnel, and only reports success when the server
says the file has exactly the local size.

  library:  upload(local_path, "Meeting Recordings/2026-11-03/x.m4a")  -> (ok, detail)
  CLI:      python3 ncupload.py <local_path> <dest relative to the user's files> [--small]   exit 0 = verified on the server

Failures are noted in ~/MeetingRec/.upload-fails.json so the agent's watchdog can retry (smaller chunks) and then alert.
"""
import base64
import hashlib
import http.client
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.parse

HOME = os.path.expanduser("~/MeetingRec")
USER = "jared"
PUBLIC_HOST = "cloud.bestly.tech"
# (label, scheme, host, port, Host header). LAN first: the nginx proxy in front of Nextcloud on Hestia listens on 8082.
ROUTES = [("lan", "http", "192.168.1.211", 8082, PUBLIC_HOST),
          ("tunnel", "https", PUBLIC_HOST, 443, PUBLIC_HOST)]
FAILS = f"{HOME}/.upload-fails.json"
DIRECT_MAX = 8 * 1024 * 1024          # small files go in one PUT
CHUNK = {"lan": 24 * 1024 * 1024, "tunnel": 10 * 1024 * 1024}
CHUNK_SMALL = 2 * 1024 * 1024
PROPFIND_LEN = (b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/></d:prop></d:propfind>')


def _log(*a):
    try:
        with open(f"{HOME}/agent.log", "a") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + "ncupload " + " ".join(str(x) for x in a) + "\n")
    except OSError:
        pass


def password():
    return subprocess.run(["security", "find-generic-password", "-s", "nextcloud-meetingrec", "-a", USER, "-w"],
                          capture_output=True, text=True).stdout.strip()


class Route:
    def __init__(self, label, scheme, host, port, hosthdr, pw, timeout=120):
        self.label, self.scheme, self.host, self.port, self.hosthdr = label, scheme, host, port, hosthdr
        self.auth = "Basic " + base64.b64encode(f"{USER}:{pw}".encode()).decode()
        self.timeout = timeout

    def conn(self, timeout):
        if self.scheme == "https":
            return http.client.HTTPSConnection(self.host, self.port, timeout=timeout, context=ssl.create_default_context())
        return http.client.HTTPConnection(self.host, self.port, timeout=timeout)

    def req(self, method, path, body=None, headers=None, timeout=None):
        """One request on a fresh connection. Returns (status, headers dict, body bytes); status 0 = no answer."""
        h = {"Authorization": self.auth}
        h.update(headers or {})
        c = self.conn(timeout or self.timeout)
        try:
            c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            c.putheader("Host", self.hosthdr)
            for k, v in h.items():
                c.putheader(k, v)
            if body is not None and "Content-Length" not in h:
                c.putheader("Content-Length", str(len(body)))
            c.endheaders(body)
            r = c.getresponse()
            data = r.read()
            return r.status, {k.lower(): v for k, v in r.getheaders()}, data
        except Exception as e:  # noqa: BLE001
            return 0, {"error": f"{type(e).__name__}: {e}"}, b""
        finally:
            c.close()


def _q(rel):
    return urllib.parse.quote(rel.strip("/"))


def files_path(rel):
    return f"/remote.php/dav/files/{USER}/{_q(rel)}"


def public_dest(rel):
    return f"https://{PUBLIC_HOST}{files_path(rel)}"


def remote_size(rt, rel):
    """Size of a file on the server, None if it is not there / cannot be read."""
    st, _, body = rt.req("PROPFIND", files_path(rel), headers={"Depth": "0", "Content-Type": "application/xml"},
                         body=PROPFIND_LEN, timeout=30)
    if st != 207:
        return None
    m = re.search(r"getcontentlength>(\d+)<", body.decode("utf-8", "replace"))
    return int(m.group(1)) if m else None


def ensure_dirs(rt, rel):
    path = ""
    for p in rel.strip("/").split("/")[:-1]:
        path = f"{path}/{p}" if path else p
        rt.req("MKCOL", files_path(path), timeout=30)          # 201 made, 405 already there


def held_chunks(rt, up):
    """{chunk name: size} already on the server for this upload (so a retry resumes instead of starting over)."""
    st, _, body = rt.req("PROPFIND", up, headers={"Depth": "1", "Content-Type": "application/xml"}, body=PROPFIND_LEN, timeout=30)
    out = {}
    if st != 207:
        return out
    for m in re.finditer(r"<d:href>([^<]+)</d:href>.*?<d:getcontentlength>(\d+)</d:getcontentlength>",
                         body.decode("utf-8", "replace"), re.S):
        name = urllib.parse.unquote(m.group(1)).rstrip("/").rsplit("/", 1)[-1]
        if name.isdigit():
            out[name] = int(m.group(2))
    return out


def upload_via(rt, local, rel, small=False, tries=4):
    """Upload through one route. Returns (ok, detail)."""
    size = os.path.getsize(local)
    mtime = int(os.path.getmtime(local))
    ensure_dirs(rt, rel)
    t0 = time.time()
    if size <= DIRECT_MAX:
        with open(local, "rb") as f:
            data = f.read()
        st, hd, _ = rt.req("PUT", files_path(rel), body=data, headers={"X-OC-Mtime": str(mtime)}, timeout=120)
        if st in (200, 201, 204) and remote_size(rt, rel) == size:
            return True, f"{rt.label} direct {size} B in {time.time() - t0:.0f}s"
        return False, f"{rt.label} direct PUT HTTP {st} {hd.get('error', '')}"
    chunk = CHUNK_SMALL if small else CHUNK[rt.label]
    uid = "bestly-" + hashlib.sha1(f"{os.path.basename(local)}|{size}|{mtime}|{chunk}".encode()).hexdigest()[:16]
    up = f"/remote.php/dav/uploads/{USER}/{uid}"
    common = {"Destination": public_dest(rel), "OC-Total-Length": str(size)}
    st, _, _ = rt.req("MKCOL", up, headers=common, timeout=30)    # 201 new, 405 resume
    if st not in (201, 405):
        return False, f"{rt.label} MKCOL HTTP {st}"
    have = held_chunks(rt, up)
    n = (size + chunk - 1) // chunk
    sent = 0
    with open(local, "rb") as f:
        for i in range(n):
            name = "%05d" % (i + 1)
            want = min(chunk, size - i * chunk)
            if have.get(name) == want:
                continue
            f.seek(i * chunk)
            data = f.read(want)
            ok = False
            for a in range(tries):
                st, hd, _ = rt.req("PUT", f"{up}/{name}", body=data, headers=common, timeout=180)
                if st in (200, 201, 204):
                    ok = True
                    break
                _log(f"{rt.label} chunk {name}/{n} try {a + 1} HTTP {st} {hd.get('error', '')}")
                time.sleep(2 * (a + 1))
            if not ok:
                return False, f"{rt.label} chunk {name}/{n} failed after {tries} tries (HTTP {st} {hd.get('error', '')})"
            sent += want
    st, hd, _ = rt.req("MOVE", f"{up}/.file", headers=dict(common, **{"X-OC-Mtime": str(mtime)}), timeout=300)
    got = remote_size(rt, rel)
    if got == size and (st in (201, 204) or st == 0 or st >= 500):
        # st 0 / 5xx with the right size on the server means the MOVE finished but the answer was lost on the way back
        return True, f"{rt.label} chunked {n} x {chunk // 1024} KB ({sent} B sent this try) in {time.time() - t0:.0f}s"
    return False, f"{rt.label} MOVE HTTP {st} {hd.get('error', '')}; server size {got} vs local {size}"


def _fails():
    try:
        return json.load(open(FAILS))
    except (OSError, ValueError):
        return {}


def _save_fails(d):
    tmp = FAILS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, FAILS)


def note(local, rel, ok, detail):
    d = _fails()
    if ok:
        if d.pop(rel, None) is not None:
            _save_fails(d)
        return
    e = d.get(rel) or {"first": int(time.time()), "tries": 0}
    e.update(local=local, last=int(time.time()), err=detail[:300], tries=e.get("tries", 0) + 1)
    d[rel] = e
    _save_fails(d)


def size_any(rel, pw=None, routes=None):
    """Size the server reports for rel (LAN first, then the tunnel); None if it is not there or could not be asked."""
    pw = pw or password()
    for label, scheme, host, port, hosthdr in (routes or ROUTES):
        rt = Route(label, scheme, host, port, hosthdr, pw)
        if label == "lan" and rt.req("OPTIONS", "/remote.php/dav/", timeout=3)[0] not in (200, 204, 401):
            continue
        n = remote_size(rt, rel)
        if n is not None:
            return n
    return None


def upload(local, rel, small=False, pw=None, routes=None):
    """Upload local -> rel (a path under the user's files). (True, detail) only after the server reports the exact local size."""
    if not os.path.isfile(local):
        return False, "no such file"
    pw = pw or password()
    if not pw:
        return False, "no Nextcloud password in the keychain"
    errs = []
    for label, scheme, host, port, hosthdr in (routes or ROUTES):
        rt = Route(label, scheme, host, port, hosthdr, pw)
        if label == "lan":
            st, _, _ = rt.req("OPTIONS", "/remote.php/dav/", timeout=3)     # not on the home network / Hestia down: skip fast
            if st not in (200, 204, 401):
                errs.append("lan unreachable")
                continue
        ok, detail = upload_via(rt, local, rel, small=small)
        if ok:
            note(local, rel, True, detail)
            _log("OK", rel, detail)
            return True, detail
        errs.append(detail)
        _log("FAILED", rel, detail)
    detail = "; ".join(errs)
    note(local, rel, False, detail)
    return False, detail


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        sys.exit(2)
    ok, detail = upload(args[0], args[1], small="--small" in sys.argv)
    print(("OK " if ok else "FAILED ") + detail)
    sys.exit(0 if ok else 1)
