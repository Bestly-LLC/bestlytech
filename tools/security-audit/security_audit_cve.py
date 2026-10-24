#!/usr/bin/env python3
"""Ares 2.1: stack inventory + CVE watch (L7), dependency gate (L8), patch-lag push + Nextcloud self-heal (L9).
Stdlib only, no AI. Plan: docs/ares-cve-watch-opusplan.md.

The miss this closes (2026-10-21..24): PHP2Shell (pre-auth RCE in PHP core) hit the Nextcloud container on the Pi and
the nightly audit said "0 new" three nights running, because Ares had no inventory of what Bestly runs, so no CVE could
ever match. This module builds that inventory every night, matches it against free feeds, and acts.

  L7  collect_inventory()  host runtimes + every running container (PHP, Node, Nextcloud, OS, images)
      load_feeds()         endoflife.date, CISA KEV, NVD critical CVEs (cached; a dead feed is skip, never pass)
      judge()              EOL = red; behind + critical CVE = red; behind = yellow; current = pass
  L8  dependency_gate()    lockfiles -> OSV.dev querybatch; .npmrc must pin ignore-scripts=true and min-release-age=7
  L9  patch-lag push       a critical CVE on an internet-facing component whose fix is over 24 hours old is pushed at once
      heal_nextcloud()     guarded self-heal: undo tag, pull, recreate, verify, roll back on any failure

Everything outside is injected so selftest.py can fake all of it: api(method, url, headers, body, timeout, tries) is
security_audit.http_json, runner(cmd, timeout) is run_cmd (subprocess.run with a timeout), db is security_audit.Db, and
the clock, sleep and file-exists test are arguments too. Nothing here handles a secret; nothing secret is logged or stored.
"""
import json
import math
import os
import re
import subprocess
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

HOST = "bestly-pi"
STATE_DIR = "/opt/bestly/cron/state"
FEED_DIR = "cve_feeds"
EXTRA_FILE = "stack_inventory_extra.json"
LAYER = "Stack"
DEP_LAYER = "Dependencies"
ORG = "Bestly-LLC"

# Components whose image repo contains one of these are reachable from the internet (kept a constant so it can grow).
INTERNET_FACING = ("nextcloud", "nginx", "spreed-signaling", "coturn")
# Image repos that carry a PHP runtime worth reading with `php -v`.
PHP_IMAGES = re.compile(r"nextcloud|wordpress|php", re.I)

# endoflife.date product for a component name (spec). ALIASES maps the odd image names onto those keys.
PRODUCTS = {"php": "php", "nodejs": "nodejs", "node": "nodejs", "nextcloud": "nextcloud", "debian": "debian",
            "postgres": "postgresql", "redis": "redis", "nginx": "nginx", "home-assistant": "home-assistant",
            "python": "python"}
ALIASES = {"homeassistant": "home-assistant", "postgresql": "postgres", "python3": "python"}
# How many dotted parts make a release cycle on endoflife.date ("8.4", "22", "2026.10").
CYCLE_PARTS = {"php": 2, "nodejs": 1, "nextcloud": 1, "debian": 1, "postgresql": 1, "redis": 2, "nginx": 2,
               "home-assistant": 2, "python": 2}
# Terms that name the product in the CISA KEV vendorProject / product columns (whole-word, case-insensitive).
KEV_TERMS = {"php": ("php",), "nodejs": ("node.js",), "nextcloud": ("nextcloud",), "nginx": ("nginx",),
             "debian": ("debian",), "postgresql": ("postgresql",), "redis": ("redis",),
             "home-assistant": ("home assistant",), "python": ("python",)}
# NVD keywordSearch is noisy (every WordPress plugin "written in PHP"), so a hit counts only when it is the product itself:
# a CPE product from the CVE's configurations, or (while NVD has not analysed it yet) the product named in the description.
NVD_KEYWORD = {"php": "php", "nodejs": "node.js", "nextcloud": "nextcloud", "debian": "debian", "postgresql": "postgresql",
               "redis": "redis", "nginx": "nginx", "home-assistant": "home assistant", "python": "python"}
NVD_CPE = {"php": ("php",), "nodejs": ("node.js",), "nextcloud": ("nextcloud_server", "nextcloud"), "debian": ("debian_linux",),
           "postgresql": ("postgresql",), "redis": ("redis",), "nginx": ("nginx",),
           "home-assistant": ("home-assistant", "home_assistant", "home_assistant_core"), "python": ("python",)}
NVD_TEXT = {"php": re.compile(r"\bPHP\b(?!\s+(?:object|code|file|remote|local|script)\b)", re.I),
            "nodejs": re.compile(r"\bNode\.js\b"), "nextcloud": re.compile(r"\bNextcloud\s+Server\b", re.I),
            "debian": re.compile(r"\bDebian\b"), "postgresql": re.compile(r"\bPostgreSQL\b"),
            "redis": re.compile(r"\bRedis\b"), "nginx": re.compile(r"\bnginx\b", re.I),
            "home-assistant": re.compile(r"\bHome Assistant\b"), "python": re.compile(r"\bCPython\b|\bPython\s+\d|\bin\s+Python\b")}

EOL_URL = "https://endoflife.date/api/%s.json"
KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch"
OSV_VULN_URL = "https://api.osv.dev/v1/vulns/%s"
FEED_HEADERS = {"User-Agent": "bestly-ares", "Accept": "application/json"}

CACHE_MAX_AGE = timedelta(days=3)       # a fetch failure may fall back to a cache this young (yellow "feed stale")
KEV_DAYS = 90
NVD_DAYS = 14
NVD_PAUSE_S = 7                         # unkeyed NVD limit is 5 calls per 30 seconds
MANUAL_STALE_DAYS = 7
PUSH_AFTER = timedelta(hours=24)        # a fix must be this old before Ares pushes it
OSV_CHUNK = 500
OSV_DETAIL_CAP = 300
LOCK_DEPTH = 4
MAX_FILE_BYTES = 40 * 1024 * 1024

# ---- Nextcloud self-heal (Jared's standing rule: employees fix, verify, keep an undo and tell him after)
NEXTCLOUD_DIR = "/mnt/ssd/apps/nextcloud"
NEXTCLOUD_COMPOSE = NEXTCLOUD_DIR + "/docker-compose.yml"
NEXTCLOUD_STATUS_URL = "https://cloud.bestly.tech/status.php"
HEAL_SERVICES = ("nextcloud", "push")   # the ONLY services Ares ever touches
HEAL_WAIT_S = 25
NEXTCLOUD_FIX = "cd /mnt/ssd/apps/nextcloud && docker compose pull nextcloud push && docker compose up -d nextcloud push"
NPMRC_LINES = ("ignore-scripts=true", "min-release-age=7")

PUBLIC_FIELDS = ("host", "component", "version", "cycle", "internet_facing", "source", "verified_at", "note")
SKIP_DIRS = ("node_modules", ".git")


# ------------------------------------------------------------------------------------------------ small helpers
def run_cmd(cmd, timeout):
    """The real runner: -> (returncode, stdout, stderr). A missing binary or a timeout is a non-zero code, never an exception."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, errors="replace")
        return p.returncode, p.stdout or "", p.stderr or ""
    except subprocess.TimeoutExpired:
        return 124, "", "timed out after %ss" % timeout
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, "", type(exc).__name__


def vtuple(s):
    """'v20.20.2' -> (20, 20, 2); '8.4.26-1+deb13u1' -> (8, 4, 26); anything without a leading number -> None."""
    m = re.match(r"\s*v?(\d+(?:\.\d+)*)", str(s if s is not None else ""))
    return tuple(int(x) for x in m.group(1).split(".")) if m else None


def first_version(text):
    """The first dotted number anywhere in a command's output ('Python 3.13.5' -> '3.13.5', 'v22.23.4' -> '22.23.4')."""
    m = re.search(r"(\d+(?:\.\d+)+)", text or "")
    return m.group(1) if m else None


def vcmp(a, b):
    """-1, 0, 1 for two version strings or tuples (missing parts count as 0). None when either has no number."""
    ta = a if isinstance(a, tuple) else vtuple(a)
    tb = b if isinstance(b, tuple) else vtuple(b)
    if ta is None or tb is None:
        return None
    n = max(len(ta), len(tb))
    ta, tb = ta + (0,) * (n - len(ta)), tb + (0,) * (n - len(tb))
    return (ta > tb) - (ta < tb)


def vstr(t):
    return ".".join(str(x) for x in t) if t else ""


def behind_by(v, latest):
    """-> (n, unit) describing how far v is behind latest (tuples). unit is patch, minor or major."""
    n = max(len(v), len(latest))
    v, latest = v + (0,) * (n - len(v)), latest + (0,) * (n - len(latest))
    for unit, idx in (("patch", n - 1), ("minor", n - 2), ("major", 0)):
        if idx < 0:
            continue
        if v[:idx] == latest[:idx] and latest[idx] > v[idx]:
            return latest[idx] - v[idx], unit
    return 1, "patch"


def plural(n, one, many=None):
    return "%d %s" % (n, one if n == 1 else (many or one + "s"))


def parse_date(s):
    """'2026-10-21' or an ISO timestamp -> aware UTC datetime, or None."""
    if not s or not isinstance(s, str):
        return None
    try:
        t = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    except ValueError:
        try:
            t = datetime.strptime(s.strip()[:10], "%Y-%m-%d")
        except ValueError:
            return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def iso(t):
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def split_image(image):
    """'ghcr.io/x/redis:7-alpine' -> ('ghcr.io/x/redis', '7-alpine'); a digest-pinned image has tag None."""
    image = image or ""
    if "@" in image:
        return image.split("@", 1)[0], None
    last = image.rsplit("/", 1)[-1]
    if ":" in last:
        repo, tag = image.rsplit(":", 1)
        return repo, tag
    return image, "latest"


def parse_labels(s):
    out = {}
    for part in (s or "").split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def product_of(component):
    """endoflife product for a component name ('nextcloud/php' -> php, 'node-system' -> nodejs, 'postgres' -> postgresql)."""
    name = (component or "").split("/")[-1].lower()
    name = re.sub(r"-(system|runtime|host)$", "", name)
    return PRODUCTS.get(ALIASES.get(name, name))


def word_in(term, text):
    return re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", (text or "").lower()) is not None


def cvss3_score(vector):
    """CVSS v3.x base score from a vector string, or None."""
    try:
        m = dict(p.split(":", 1) for p in vector.split("/")[1:])
        scope_changed = m["S"] == "C"
        av = {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2}[m["AV"]]
        ac = {"L": 0.77, "H": 0.44}[m["AC"]]
        pr = {"N": 0.85, "L": 0.68 if scope_changed else 0.62, "H": 0.5 if scope_changed else 0.27}[m["PR"]]
        ui = {"N": 0.85, "R": 0.62}[m["UI"]]
        cia = {"H": 0.56, "L": 0.22, "N": 0.0}
        iss = 1 - (1 - cia[m["C"]]) * (1 - cia[m["I"]]) * (1 - cia[m["A"]])
        impact = 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 if scope_changed else 6.42 * iss
        expl = 8.22 * av * ac * pr * ui
        if impact <= 0:
            return 0.0
        raw = min(1.08 * (impact + expl), 10) if scope_changed else min(impact + expl, 10)
        i = int(round(raw * 100000))
        return i / 100000.0 if i % 10000 == 0 else (math.floor(i / 10000) + 1) / 10.0
    except (KeyError, ValueError, AttributeError):
        return None


# ------------------------------------------------------------------------------------------- feed parsing
def parse_eol(data):
    """endoflife.date rows: cycle, latest, latestReleaseDate, eol, support, lts. None when the answer is not that shape."""
    if not isinstance(data, list) or not data or not all(isinstance(r, dict) and "cycle" in r for r in data):
        return None
    return [{"cycle": str(r.get("cycle")), "latest": r.get("latest"), "latestReleaseDate": r.get("latestReleaseDate"),
             "eol": r.get("eol"), "support": r.get("support"), "lts": r.get("lts")} for r in data]


def parse_kev(data):
    """Only the entries that name a product we run (the whole file is 1 MB and nobody needs it on disk)."""
    if not isinstance(data, dict) or not isinstance(data.get("vulnerabilities"), list):
        return None
    out = []
    for v in data["vulnerabilities"]:
        if not isinstance(v, dict):
            continue
        text = "%s %s" % (v.get("vendorProject") or "", v.get("product") or "")
        prods = sorted(p for p, terms in KEV_TERMS.items() if any(word_in(t, text) for t in terms))
        if prods:
            out.append({"id": v.get("cveID"), "products": prods, "added": v.get("dateAdded"),
                        "name": (v.get("vulnerabilityName") or "")[:120]})
    return out


def nvd_core(product, cve):
    """True when this NVD record is about the product itself, not a package that merely mentions it."""
    cpes = []
    for conf in cve.get("configurations") or []:
        for node in (conf or {}).get("nodes") or []:
            for m in (node or {}).get("cpeMatch") or []:
                parts = str((m or {}).get("criteria") or "").split(":")
                if len(parts) > 4:
                    cpes.append(parts[4].lower())
    if cpes:
        return any(p in NVD_CPE.get(product, ()) for p in cpes)
    desc = ""
    for d in cve.get("descriptions") or []:
        if (d or {}).get("lang") == "en":
            desc = d.get("value") or ""
            break
    rx = NVD_TEXT.get(product)
    return bool(rx and rx.search(desc[:300]))


def parse_nvd(product):
    def parse(data):
        if not isinstance(data, dict) or not isinstance(data.get("vulnerabilities"), list):
            return None
        out = []
        for row in data["vulnerabilities"]:
            cve = (row or {}).get("cve") or {}
            if not cve.get("id"):
                continue
            score = None
            for k in ("cvssMetricV31", "cvssMetricV30"):
                for m in (cve.get("metrics") or {}).get(k) or []:
                    s = ((m or {}).get("cvssData") or {}).get("baseScore")
                    if isinstance(s, (int, float)):
                        score = max(score or 0, s)
            desc = ""
            for d in cve.get("descriptions") or []:
                if (d or {}).get("lang") == "en":
                    desc = d.get("value") or ""
                    break
            out.append({"id": cve["id"], "published": cve.get("published"), "score": score, "desc": desc[:160],
                        "core": nvd_core(product, cve)})
        return out
    return parse


# ---------------------------------------------------------------------------------------------------- feeds
class Feeds(object):
    """What tonight's feeds said. eol[product] / nvd[product] are lists, or None when no usable copy exists."""

    def __init__(self):
        self.eol, self.nvd, self.kev = {}, {}, None
        self.state = {}        # feed name -> "fresh" | "stale" | "none"
        self.stale_at = {}     # feed name -> fetched-at of the cache that was used
        self.loaded = False

    def kev_hits(self, product, now):
        out = []
        for e in self.kev or []:
            if product not in e["products"]:
                continue
            added = parse_date(e.get("added"))
            if added and now - added <= timedelta(days=KEV_DAYS):
                out.append({"id": e["id"], "source": "kev", "date": e.get("added")})
        return out

    def nvd_hits(self, product):
        return [{"id": e["id"], "source": "nvd", "date": (e.get("published") or "")[:10], "score": e.get("score")}
                for e in self.nvd.get(product) or [] if e.get("core")]

    def critical(self, product, now):
        """-> (hits, usable). usable is False when neither CVE feed could be read, so 'no hits' proves nothing."""
        kev_ok, nvd_ok = self.kev is not None, self.nvd.get(product) is not None
        hits = (self.kev_hits(product, now) if kev_ok else []) + (self.nvd_hits(product) if nvd_ok else [])
        seen, uniq = set(), []
        for h in hits:
            if h["id"] not in seen:
                seen.add(h["id"])
                uniq.append(h)
        return uniq, (kev_ok or nvd_ok)


# ------------------------------------------------------------------------------------------------- lockfiles
def _read(path):
    try:
        if os.path.getsize(path) > MAX_FILE_BYTES:
            return None
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def parse_package_lock(text):
    """npm lockfile v2/v3 `packages` map (v1 `dependencies` as a fallback) -> set of (name, version)."""
    data = json.loads(text)
    out = set()
    pk = data.get("packages")
    if isinstance(pk, dict):
        for key, ent in pk.items():
            if not key or not isinstance(ent, dict) or ent.get("link"):
                continue
            name = ent.get("name") or key.rsplit("node_modules/", 1)[-1]
            ver = ent.get("version")
            if name and isinstance(ver, str) and vtuple(ver):
                out.add((name, ver))
        return out

    def walk(deps):
        for name, ent in (deps or {}).items():
            if isinstance(ent, dict):
                ver = ent.get("version")
                if isinstance(ver, str) and vtuple(ver):
                    out.add((name, ver))
                walk(ent.get("dependencies"))
    walk(data.get("dependencies"))
    return out


PNPM_V6 = re.compile(r"""^  ['"]?/?((?:@[^/@\s]+/)?[^/@\s]+)@(\d[^(\s'":]*)""")
PNPM_V5 = re.compile(r"""^  ['"]?/((?:@[^/\s]+/)?[^/\s]+)/(\d[^_(\s'":]*)""")


def parse_pnpm_lock(text):
    out, section = set(), None
    for ln in text.splitlines():
        if ln and not ln[0].isspace() and ln.rstrip().endswith(":"):
            section = ln.strip().rstrip(":")
            continue
        if section in ("packages", "snapshots"):
            m = PNPM_V6.match(ln) or PNPM_V5.match(ln)
            if m and ln.rstrip().endswith(":"):
                out.add((m.group(1), m.group(2)))
    return out


YARN_HEAD = re.compile(r"""^"?(@[^/@\s"]+/[^@\s"]+|[^@\s"]+)@""")
YARN_VER = re.compile(r"""^\s+version:?\s+"?([^"\s]+)"?\s*$""")


def parse_yarn_lock(text):
    out, name = set(), None
    for ln in text.splitlines():
        if not ln or ln.startswith("#"):
            continue
        if not ln[0].isspace() and ln.rstrip().endswith(":"):
            m = YARN_HEAD.match(ln)
            name = m.group(1) if m else None
            continue
        if name:
            m = YARN_VER.match(ln)
            if m and vtuple(m.group(1)):
                out.add((name, m.group(1)))
                name = None
    return out


REQ_LINE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._\-]*)(?:\[[^\]]*\])?\s*==\s*([A-Za-z0-9._!+\-]+)")


def parse_requirements(text):
    out = set()
    for ln in text.splitlines():
        ln = ln.split("#", 1)[0].strip()
        m = REQ_LINE.match(ln)
        if m and vtuple(m.group(2)):
            out.add((m.group(1), m.group(2)))
    return out


def find_files(root):
    """-> (lockfiles [(relpath, kind)], package_json_count). Depth <= 4, node_modules and .git skipped."""
    locks, pkgs = [], 0
    root = os.path.abspath(root)
    for dirpath, dirs, files in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        depth = 0 if rel == "." else rel.count(os.sep) + 1
        dirs[:] = [d for d in sorted(dirs) if d not in SKIP_DIRS] if depth < LOCK_DEPTH else []
        for f in sorted(files):
            p = os.path.relpath(os.path.join(dirpath, f), root)
            if f == "package-lock.json":
                locks.append((p, "npm"))
            elif f == "pnpm-lock.yaml":
                locks.append((p, "pnpm"))
            elif f == "yarn.lock":
                locks.append((p, "yarn"))
            elif re.match(r"^requirements.*\.txt$", f):
                locks.append((p, "pip"))
            elif f == "package.json":
                pkgs += 1
    return locks, pkgs


def npm_gate(root):
    """-> (ok, missing). Root .npmrc must pin both lines; pnpm-workspace.yaml with minimumReleaseAge / allowBuilds also counts."""
    rc = _read(os.path.join(root, ".npmrc")) or ""
    have = {}
    for ln in rc.splitlines():
        ln = ln.split("#", 1)[0].split(";", 1)[0].strip()
        if "=" in ln:
            k, v = ln.split("=", 1)
            have[k.strip().lower()] = v.strip().lower()
    missing = []
    if have.get("ignore-scripts") != "true":
        missing.append(NPMRC_LINES[0])
    try:
        age_ok = float(have.get("min-release-age", "0")) >= 7
    except ValueError:
        age_ok = False
    if not age_ok:
        missing.append(NPMRC_LINES[1])
    if missing:
        ws = _read(os.path.join(root, "pnpm-workspace.yaml")) or ""
        if re.search(r"^\s*minimumReleaseAge\s*:\s*[1-9]\d*", ws, re.M) or re.search(r"^\s*allowBuilds\s*:", ws, re.M):
            return True, []
    return not missing, missing


# ---------------------------------------------------------------------------------------------- the watcher
class CveWatch(object):
    """L7 + L8 + L9 for one nightly run. See the module docstring; every outside dependency is an argument."""

    def __init__(self, api, runner, db, state_dir=STATE_DIR, now=None, logf=print, sleep=time.sleep,
                 exists=os.path.isfile, alert_fn=None, resolve_fn=None, host=HOST):
        self.api, self.runner, self.db = api, runner, db
        self.state_dir, self._now_arg, self.log = state_dir, now, logf
        self.sleep, self.exists, self.host = sleep, exists, host
        self.alert_fn, self.resolve_fn = alert_fn, resolve_fn

    # ---- plumbing
    def now(self):
        n = self._now_arg() if callable(self._now_arg) else self._now_arg
        n = n or datetime.now(timezone.utc)
        return n if n.tzinfo else n.replace(tzinfo=timezone.utc)

    def _alert(self, key, title, body, severity, needs=None, healed=False):
        fn = self.alert_fn
        if fn is None:
            import security_audit_ares2 as a2
            fn = a2.alert
        kw = {"needs": needs}
        if healed:
            kw["healed"] = True
        return fn(self.db, key, title, body, severity, **kw)

    def _resolve(self, key, title=None):
        fn = self.resolve_fn
        if fn is None:
            import security_audit_ares2 as a2
            fn = a2.resolve
        return fn(self.db, key, title)

    def _run(self, cmd, timeout):
        try:
            rc, out, err = self.runner(cmd, timeout)
        except Exception as exc:  # noqa: BLE001 -- a runner that raises is a failed command, never a crash mid-inventory
            return 127, "", type(exc).__name__
        return rc, out or "", err or ""

    def _audit_state(self):
        try:
            with open(os.path.join(self.state_dir, "security_audit.json"), "r", encoding="utf-8") as fh:
                d = json.load(fh)
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    # ---- L7: inventory
    def _comp(self, host, component, version, product, source, internet, verified, **extra):
        vt = vtuple(version)
        cycle = vstr(vt[:CYCLE_PARTS.get(product, 2)]) if vt else ""
        c = {"host": host, "component": component, "version": version, "cycle": cycle, "internet_facing": bool(internet),
             "source": source, "verified_at": verified, "product": product}
        c.update(extra)
        return c

    def _host_components(self, today):
        out, h = [], self.host
        rc, txt, _ = self._run(["cat", "/etc/os-release"], 10)
        m = re.search(r'^VERSION_ID="?([^"\n]+)"?', txt, re.M) if rc == 0 else None
        ver = m.group(1).strip() if m else None
        rc, txt, _ = self._run(["cat", "/etc/debian_version"], 10)
        if rc == 0 and vtuple(txt) and (not ver or vtuple(txt)[:1] == vtuple(ver)[:1]):
            ver = txt.strip()
        if ver:
            out.append(self._comp(h, "debian", ver, "debian", "host", False, today, where=h))
        rc, txt, _ = self._run(["uname", "-r"], 10)
        if rc == 0 and txt.strip():
            out.append(self._comp(h, "kernel", txt.strip(), None, "host", False, today, where=h))
        for name, cmd, product in (("python3", ["python3", "--version"], "python"), ("node", ["node", "-v"], "nodejs"),
                                   ("npm", ["npm", "-v"], None)):
            rc, txt, err = self._run(cmd, 10)
            v = first_version((txt or err) if rc == 0 else "")
            if v:
                out.append(self._comp(h, name, v, product, "host", False, today, where=h))
        return out

    def _containers(self):
        """-> list of running containers, or None when docker could not be listed (a blind spot, reported)."""
        rc, out, _ = self._run(["docker", "ps", "--format", "{{json .}}"], 30)
        if rc != 0:
            return None
        rows = []
        for ln in out.splitlines():
            try:
                d = json.loads(ln)
            except ValueError:
                continue
            if not isinstance(d, dict) or not d.get("Image"):
                continue
            name = str(d.get("Names") or d.get("ID") or "").split(",")[0].strip()
            repo, tag = split_image(d["Image"])
            labels = parse_labels(d.get("Labels"))
            rows.append({"name": name, "id": d.get("ID"), "image": d["Image"], "repo": repo, "tag": tag,
                         "base": repo.rsplit("/", 1)[-1].lower(), "labels": labels,
                         "service": labels.get("com.docker.compose.service"),
                         "workdir": labels.get("com.docker.compose.project.working_dir"),
                         "config": labels.get("com.docker.compose.project.config_files")})
        return rows

    def _read_container(self, ci, label, today):
        """The components inside one container. `label` is the component name that identifies the container."""
        out, nc = [], ci["name"]
        internet = any(t in ci["repo"].lower() for t in INTERNET_FACING)
        extra = {"container": nc, "image": ci["image"], "where": "container %s" % nc, "service": ci["service"], "workdir": ci["workdir"]}
        base_prod = PRODUCTS.get(ALIASES.get(ci["base"], ci["base"]))
        if ci["base"] == "nextcloud":
            rc, txt, _ = self._run(["docker", "exec", "-u", "www-data", nc, "php", "occ", "status", "--output=json"], 30)
            ver = None
            if rc == 0:
                try:
                    ver = first_version(json.loads(txt).get("versionstring"))
                except (ValueError, AttributeError):
                    ver = None
            out.append(self._comp(self.host, label, ver, "nextcloud", "docker-exec", internet, today, **extra))
        elif ci["base"] != "php":
            tv = vtuple(ci["tag"]) if ci["tag"] else None
            out.append(self._comp(self.host, label, vstr(tv) if tv else None, base_prod, "docker-tag", internet, today, **extra))
        if PHP_IMAGES.search(ci["repo"]):
            rc, txt, _ = self._run(["docker", "exec", nc, "php", "-v"], 20)
            m = re.search(r"PHP\s+(\d+\.\d+\.\d+)", txt) if rc == 0 else None
            # the official PHP images must answer; a Go binary that merely has "nextcloud" in its name has no PHP and is not a finding
            if m or ci["base"] in ("nextcloud", "wordpress", "php"):
                name = "php" if ci["base"] == "php" else "%s/php" % label
                out.append(self._comp(self.host, name, m.group(1) if m else None, "php", "docker-exec", internet, today, **extra))
        rc, txt, _ = self._run(["docker", "exec", nc, "node", "-v"], 5)
        nv = first_version(txt) if rc == 0 else None
        if nv and ci["base"] != "node":
            out.append(self._comp(self.host, "%s/node" % label, nv, "nodejs", "docker-exec", internet, today, **extra))
        return out

    def _manual(self, today_dt, unverified):
        path = os.path.join(self.state_dir, EXTRA_FILE)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                rows = json.load(fh)
        except (OSError, ValueError):
            return []
        out, stale_hosts = [], set()
        for r in rows if isinstance(rows, list) else []:
            if not isinstance(r, dict) or not r.get("host") or not r.get("component"):
                continue
            product = r.get("product") or product_of(r["component"])
            c = self._comp(r["host"], str(r["component"]), r.get("version"), product, r.get("source") or "manual",
                           bool(r.get("internet_facing")), r.get("verified_at"), where=r["host"])
            if r.get("cycle"):
                c["cycle"] = str(r["cycle"])
            if r.get("note"):
                c["note"] = r["note"]
            verified = parse_date(r.get("verified_at"))
            c["stale"] = verified is None or today_dt - verified > timedelta(days=MANUAL_STALE_DAYS)
            if c["stale"]:
                stale_hosts.add(r["host"])
            out.append(c)
        for h in sorted(stale_hosts):
            unverified.append("%s runtimes (manual inventory stale)" % h)
        return out

    def collect_inventory(self, unverified):
        """-> (components, containers). A docker that cannot be listed is a blind spot: reported, never a quiet empty list."""
        now = self.now()
        today = now.date().isoformat()
        comps = self._host_components(today)
        containers = self._containers()
        if containers is None:
            unverified.append("%s container inventory (docker unreachable)" % self.host)
        used = set()
        for ci in containers or []:
            label = ci["base"] if ci["base"] not in used else ci["name"]
            used.add(label)
            ci["label"] = label
            comps.extend(self._read_container(ci, label, today))
        comps.extend(self._manual(now, unverified))
        return comps, containers

    # ---- L7: feeds (cached, a dead feed is skip + unverified, never pass)
    def _cache_path(self, name):
        return os.path.join(self.state_dir, FEED_DIR, name + ".json")

    def _write_cache(self, name, data):
        try:
            os.makedirs(os.path.join(self.state_dir, FEED_DIR), exist_ok=True)
            p = self._cache_path(name)
            with open(p + ".tmp", "w", encoding="utf-8") as fh:
                json.dump({"fetched_at": iso(self.now()), "data": data}, fh)
            os.replace(p + ".tmp", p)
        except OSError as exc:
            self.log("cve: could not write the %s feed cache (%s)" % (name, type(exc).__name__))

    def _read_cache(self, name):
        try:
            with open(self._cache_path(name), "r", encoding="utf-8") as fh:
                d = json.load(fh)
            at = parse_date(d.get("fetched_at"))
            return (d.get("data"), at) if at and d.get("data") is not None else (None, None)
        except (OSError, ValueError, AttributeError):
            return None, None

    @staticmethod
    def _mark(feeds, name, state, at=None):
        """A feed's state is the worst of its fetches: none beats stale beats fresh."""
        rank = {"fresh": 0, "stale": 1, "none": 2}
        if rank[state] >= rank.get(feeds.state.get(name, "fresh"), 0) or name not in feeds.state:
            feeds.state[name] = state
        if at is not None:
            feeds.stale_at[name] = min(at, feeds.stale_at.get(name, at))

    def _feed(self, feeds, state_name, cache_name, url, parse):
        """Fetch once, cache on success. -> parsed data, or None when neither the fetch nor a cache under 3 days old worked."""
        data = None
        try:
            status, body = self.api("GET", url, FEED_HEADERS, None, 60, 2)
            if status == 200:
                data = parse(body)
        except Exception as exc:  # noqa: BLE001 -- any transport failure means "the feed did not answer"
            self.log("cve: feed %s failed (%s)" % (cache_name, type(exc).__name__))
        if data is not None:
            self._write_cache(cache_name, data)
            self._mark(feeds, state_name, "fresh")
            return data
        cached, at = self._read_cache(cache_name)
        if cached is not None and self.now() - at <= CACHE_MAX_AGE:
            self._mark(feeds, state_name, "stale", at)
            return cached
        self._mark(feeds, state_name, "none")
        return None

    def load_feeds(self, products):
        feeds = Feeds()
        if not products:
            return feeds
        for p in sorted(products):
            feeds.eol[p] = self._feed(feeds, "endoflife", "endoflife-" + p, EOL_URL % p, parse_eol)
        feeds.kev = self._feed(feeds, "kev", "kev", KEV_URL, parse_kev)
        now, first = self.now(), True
        for p in sorted(products):
            if not first:
                self.sleep(NVD_PAUSE_S)
            first = False
            q = [("keywordSearch", NVD_KEYWORD.get(p, p)), ("cvssV3Severity", "CRITICAL"),
                 ("lastModStartDate", (now - timedelta(days=NVD_DAYS)).strftime("%Y-%m-%dT%H:%M:%S.000+00:00")),
                 ("lastModEndDate", now.strftime("%Y-%m-%dT%H:%M:%S.000+00:00")), ("resultsPerPage", "50")]
            feeds.nvd[p] = self._feed(feeds, "nvd", "nvd-" + p, NVD_URL + "?" + urllib.parse.urlencode(q, safe=":"), parse_nvd(p))
        feeds.loaded = True
        return feeds

    FEED_TITLES = {"endoflife": "endoflife.date", "kev": "CISA KEV", "nvd": "NVD"}

    def feed_checks(self, feeds, unverified):
        items = []
        for name in ("endoflife", "kev", "nvd"):
            st = feeds.state.get(name)
            if st is None:
                continue
            nice = self.FEED_TITLES[name]
            base = dict(key="stack:feed:%s" % name, layer=LAYER, asset="feed:%s" % nice, check="feed_fresh")
            if st == "none":
                unverified.append("stack CVE feed %s (unreachable)" % nice)
                items.append(dict(base, result="skip", title="Not checked: the %s feed did not answer" % nice,
                                  detail="No live answer and no saved copy under 3 days old. Every stack check that needs %s is recorded as "
                                         "not checked tonight, never as a pass." % nice))
            elif st == "stale":
                at = feeds.stale_at.get(name)
                items.append(dict(base, result="yellow", title="The %s feed is stale" % nice,
                                  detail="The live fetch failed tonight, so Ares used the saved copy from %s (under 3 days old). "
                                         "Results are only as fresh as that copy." % (at.date().isoformat() if at else "an earlier night"),
                                  evidence={"feed": nice, "cache_from": iso(at) if at else None}))
            else:
                items.append(dict(base, result="pass", evidence={"feed": nice}))
        return items

    # ---- L7: rules
    def _row_for(self, rows, vt):
        """-> (row, full). A cycle that is a prefix of the version wins (longest first); a version that is only a prefix of
        cycles ('7' in redis 7.4, 7.2) is partial: the patch level is not visible."""
        best = None
        for r in rows:
            ct = vtuple(r["cycle"])
            if ct and len(ct) <= len(vt) and vt[:len(ct)] == ct and (best is None or len(ct) > len(vtuple(best["cycle"]))):
                best = r
        if best is not None:
            return best, len(vt) > len(vtuple(best["cycle"]))
        part = [r for r in rows if vtuple(r["cycle"]) and vtuple(r["cycle"])[:len(vt)] == vt]
        if part:
            return part, False
        return None, False

    def _eol_state(self, row, now):
        eol = row.get("eol")
        if eol is True:
            return True, "now"
        d = parse_date(eol) if isinstance(eol, str) else None
        return (d is not None and d <= now), (eol if isinstance(eol, str) else None)

    def fix_for(self, c, feeds, eol=False):
        comp = c["component"]
        if c.get("source") == "manual" or c.get("host") != self.host:
            return c.get("note") or ("Upgrade %s on %s to the latest release." % (comp, c["host"]))
        if c.get("image") and split_image(c["image"])[0].rsplit("/", 1)[-1].lower() == "nextcloud":
            return NEXTCLOUD_FIX
        if comp == "node":
            cyc = c.get("cycle") or "22"
            if eol:
                sup = [r for r in (feeds.eol.get("nodejs") or []) if not self._eol_state(r, self.now())[0]]
                lts = [r for r in sup if r.get("lts")] or sup
                if lts:
                    cyc = max(lts, key=lambda r: vtuple(r["cycle"]) or (0,))["cycle"]
            return "curl -fsSL https://deb.nodesource.com/setup_%s.x | sudo -E bash - && sudo apt-get install -y nodejs" % cyc
        if c.get("source") == "host":
            return "sudo apt-get update && sudo apt-get upgrade -y"
        svc, wd = c.get("service"), c.get("workdir")
        if wd and svc:
            return "cd %s && docker compose pull %s && docker compose up -d %s" % (wd, svc, svc)
        return "docker compose pull && docker compose up -d"

    def judge(self, c, feeds):
        """One component -> a result record. check is the dict the audit records; the rest is bookkeeping for L9."""
        now = self.now()
        comp, ver, prod = c["component"], c.get("version"), c.get("product")
        base = dict(key="stack:%s:%s:cve" % (c["host"], comp), layer=LAYER, asset="%s:%s" % (c["host"], comp), check="cve_watch")
        rec = {"comp": c, "reason": None, "released": None, "latest": None, "cves": []}

        def done(result, reason, title=None, detail=None, fix=None, evidence=None):
            rec.update(result=result, reason=reason)
            rec["check"] = dict(base, result=result, title=title, detail=detail, fix=fix, evidence=evidence or {})
            return rec
        if c.get("stale"):
            return done("skip", "stale", "Not checked: %s on %s (manual inventory is stale)" % (comp, c["host"]),
                        "This row was last verified %s, more than %d days ago, so it is not treated as current. "
                        "Re-verify it and update %s." % (c.get("verified_at") or "never", MANUAL_STALE_DAYS, EXTRA_FILE))
        if not prod:
            rec.update(result=None, reason="noproduct", check=None)      # inventory only: no feed covers it, so no verdict (and no pass)
            return rec
        if ver is None:
            where = c.get("container") or c["host"]
            if c.get("source") == "docker-tag":
                title = "Could not read a version from the image tag of %s" % comp
            else:
                title = "Could not read the version inside %s (%s)" % (where, comp)
            return done("yellow", "unknown", title,
                        "Ares could not read the version of %s (%s), so it cannot tell whether it is patched." % (comp, c.get("where") or c["host"]),
                        "Check that the container is healthy and answers a version command.", {"source": c.get("source")})
        vt = vtuple(ver)
        rows = feeds.eol.get(prod)
        if rows is None:
            return done("skip", "feed", "Not checked: %s %s (endoflife.date did not answer)" % (comp, ver),
                        "No endoflife.date data for %s and no saved copy under 3 days old, so Ares cannot say whether it is end-of-life or behind." % prod)
        row, full = self._row_for(rows, vt)
        if row is None:
            return done("skip", "cycle", "Not checked: endoflife.date does not list %s %s" % (prod, c.get("cycle") or ver),
                        "The feed has no release cycle that matches %s, so Ares cannot judge it." % ver)
        cands = row if isinstance(row, list) else [row]
        past_eol = [self._eol_state(r, now) for r in cands]
        if all(p[0] for p in past_eol):
            dates = [p[1] for p in past_eol if p[1] and p[1] != "now"]
            when = max(dates) if dates else None
            return done("red", "eol", "%s %s is end-of-life, no security fixes ship" % (comp, ver),
                        "endoflife.date lists %s %s as end-of-life%s. Nothing published after that date will be patched for it."
                        % (prod, cands[0]["cycle"] if len(cands) == 1 else ver, " since %s" % when if when else ""),
                        self.fix_for(c, feeds, True),
                        {"cycle": cands[0]["cycle"], "eol": when, "installed": ver, "internet_facing": c["internet_facing"]})
        hits, usable = feeds.critical(prod, now)
        rec["cves"] = [h["id"] for h in hits]
        if not full:
            latest = max((r["latest"] for r in cands if r.get("latest")), key=lambda x: vtuple(x) or (0,), default=None)
            if hits:
                return done("yellow", "partial", "%s %s: the image tag hides the patch level and a critical CVE is out" % (comp, ver),
                            "The tag only shows %s, not the patch release. Critical CVEs for %s on record: %s. Confirm the image was pulled "
                            "after the fix (latest is %s)." % (ver, prod, ", ".join(rec["cves"][:5]), latest),
                            self.fix_for(c, feeds), {"cves": rec["cves"][:10], "latest": latest, "installed": ver})
            return done("pass", "partial", evidence={"latest": latest, "cves_seen": rec["cves"][:10],
                                                     "note": "the tag shows only %s, so the patch level is not visible" % ver})
        latest, released = row.get("latest"), row.get("latestReleaseDate")
        rec["latest"], rec["released"] = latest, released
        lt = vtuple(latest)
        if lt is None or vcmp(vt, lt) is None:
            return done("skip", "cycle", "Not checked: no latest release for %s %s" % (prod, row["cycle"]), "endoflife.date gave no usable latest version.")
        if vcmp(vt, lt) >= 0:
            return done("pass", "current", evidence={"latest": latest, "cves_seen": rec["cves"][:10]})
        n, unit = behind_by(vt, lt)
        ev = {"installed": ver, "latest": latest, "released": released, "internet_facing": c["internet_facing"]}
        if hits:
            ev["cves"] = rec["cves"][:10]
            lbl = ", ".join(rec["cves"][:5])
            return done("red", "critical", "%s %s has a critical CVE and the fix (%s, released %s) is not installed" % (comp, ver, latest, released),
                        "%s runs %s and is %s. Critical CVEs on record for %s: %s. The fix %s was released %s."
                        % (comp, ver, plural(n, unit + " release") + " behind", prod, lbl, latest, released),
                        self.fix_for(c, feeds), ev)
        if not usable:
            ev["cve_feeds"] = "unavailable"
        return done("yellow", "behind", "%s %s is behind by %s (latest %s)" % (comp, ver, plural(n, unit + " release"), latest),
                    "%s is behind the latest %s release. No critical CVE is on record%s." % (
                        comp, prod, " (but the CVE feeds could not be read tonight, so severity is unknown)" if not usable else ""),
                    self.fix_for(c, feeds), ev)

    # ---- L9: push + self-heal
    def _alert_key(self, c):
        return "security.cve.%s.%s" % (c["host"], c["component"])

    def _fix_old(self, rec):
        rel = parse_date(rec.get("released"))
        return rel is not None and self.now() - rel > PUSH_AFTER

    def push_alerts(self, recs, skip_keys, live):
        """One Ares-signed push per internet-facing component whose fix is over 24 hours old. Resolves it once on latest."""
        sent = 0
        if not live:
            return sent
        for r in recs:
            c = r["comp"]
            if r["check"] is None or not c["internet_facing"] or c["host"] != self.host:
                continue
            key = self._alert_key(c)
            if key in skip_keys:
                continue
            if r["reason"] == "critical" and self._fix_old(r):
                ev = r["check"]["evidence"]
                title = "Ares: %s %s has a critical CVE and the fix %s is out" % (c["component"], c["version"], r["latest"])
                body = ("%s on %s faces the internet and runs %s. Critical CVEs: %s. The fix %s was released %s, more than a day ago, "
                        "and it is not installed. To fix: %s"
                        % (c["component"], c["host"], c["version"], ", ".join(ev.get("cves", [])[:4]) or "see the Security page",
                           r["latest"], r["released"], r["check"]["fix"]))
                if self._alert(key, title, body, "error", needs=True):
                    sent += 1
            elif r["result"] == "pass":
                self._resolve(key, "Ares: %s is on the latest release" % c["component"])
        return sent

    def _nextcloud_container(self, containers):
        for ci in containers or []:
            if ci["base"] == "nextcloud" and (ci.get("service") in (None, "nextcloud")):
                return ci
        return None

    def _digests(self, text):
        return set(re.findall(r"sha256:[0-9a-f]{64}", text or ""))

    def _remote_digests(self, image):
        """Digests the registry holds for this host's platform: the platform manifest and its config. Empty set = cannot tell."""
        rc, out, _ = self._run(["docker", "manifest", "inspect", image], 60)
        if rc != 0:
            return set()
        try:
            d = json.loads(out)
        except ValueError:
            return set()
        found = set()
        if isinstance(d, dict) and isinstance(d.get("manifests"), list):
            rc, arch, _ = self._run(["uname", "-m"], 10)
            arch = arch.strip()
            want = "arm64" if arch in ("aarch64", "arm64") else ("amd64" if arch == "x86_64" else arch)
            for m in d["manifests"]:
                pf = (m or {}).get("platform") or {}
                if pf.get("os") == "linux" and pf.get("architecture") == want and m.get("digest"):
                    found.add(m["digest"])
                    rc, out2, _ = self._run(["docker", "manifest", "inspect", "%s@%s" % (split_image(image)[0], m["digest"])], 60)
                    try:
                        found |= self._digests(json.dumps((json.loads(out2) if rc == 0 else {}).get("config") or {}))
                    except (ValueError, AttributeError):
                        pass
        elif isinstance(d, dict):
            found |= self._digests(json.dumps(d.get("config") or {}))
        return found

    def _local_digests(self, image):
        rc, out, _ = self._run(["docker", "image", "inspect", "--format", "{{.Id}} {{json .RepoDigests}}", image], 20)
        return self._digests(out) if rc == 0 else set()

    def _status_ok(self):
        try:
            st, data = self.api("GET", NEXTCLOUD_STATUS_URL, FEED_HEADERS, None, 30, 1)
        except Exception:  # noqa: BLE001
            return False
        return st == 200 and isinstance(data, dict) and data.get("installed") is True

    def heal_nextcloud(self, ci, behind, dry, state, today):
        """Guarded self-heal for the nextcloud container. -> {"state": skipped|noop|ok|failed, ...}.
        Only the services `nextcloud` and `push` are ever touched. Never runs under --dry, when state heal_nextcloud is
        false, when the compose file is not the expected one, or when the registry's digest for the same tag is the one running."""
        if dry:
            return {"state": "skipped", "why": "dry run"}
        if (state or {}).get("heal_nextcloud") is False:
            return {"state": "skipped", "why": "state heal_nextcloud is false"}
        cfg = (ci.get("config") or "").split(",")[0].strip()
        if cfg != NEXTCLOUD_COMPOSE or (ci.get("workdir") or "").rstrip("/") != NEXTCLOUD_DIR or not self.exists(NEXTCLOUD_COMPOSE):
            return {"state": "skipped", "why": "compose file is not %s" % NEXTCLOUD_COMPOSE}
        if not ci.get("tag"):
            return {"state": "skipped", "why": "image is pinned by digest"}
        image = ci["image"]
        remote, local = self._remote_digests(image), self._local_digests(image)
        if not remote or not local or remote & local:
            return {"state": "skipped", "why": "registry digest matches the running image" if remote & local else "digest could not be compared"}
        rc, img_id, _ = self._run(["docker", "inspect", "--format", "{{.Image}}", ci["name"]], 20)
        undo = "%s:%s-pre-ares-%s" % (ci["repo"], ci["tag"], today.replace("-", ""))
        compose = ["docker", "compose", "-f", NEXTCLOUD_COMPOSE]
        res = {"state": "failed", "undo_tag": undo, "image": image, "before": behind}

        def rollback(stage):
            self._run(["docker", "tag", undo, image], 30)
            self._run(compose + ["up", "-d"] + list(HEAL_SERVICES), 600)
            self.sleep(HEAL_WAIT_S)
            res.update(stage=stage, rolled_back=True, answers=self._status_ok())
            return res
        rc, _, _ = self._run(["docker", "tag", img_id.strip() if rc == 0 and img_id.strip() else image, undo], 30)
        if rc != 0:
            res.update(stage="undo tag", rolled_back=False, answers=self._status_ok())
            return res
        rc, _, _ = self._run(compose + ["pull"] + list(HEAL_SERVICES), 1200)
        if rc != 0:
            res.update(stage="pull", rolled_back=False, answers=self._status_ok())
            return res
        if self._local_digests(image) == local:
            return {"state": "noop", "why": "the pull brought nothing new"}
        rc, _, _ = self._run(compose + ["up", "-d"] + list(HEAL_SERVICES), 600)
        if rc != 0:
            return rollback("recreate")
        self.sleep(HEAL_WAIT_S)
        after = self._read_container(ci, ci.get("label") or ci["base"], today)
        moved, back = False, False
        for old in behind:
            new = next((a for a in after if a["component"] == old["component"]), None)
            cmp_ = vcmp(new.get("version"), old.get("version")) if new else None
            if cmp_ is None:
                continue
            moved, back = moved or cmp_ > 0, back or cmp_ < 0
        if not (moved and not back and self._status_ok()):
            return rollback("verify")
        res.update(state="ok", after=after)
        return res

    # ---- the L7 + L9 pass
    def stack_pass(self, checks, unverified, inventory, live, dry, state):
        counts = {"components": 0, "behind": 0, "critical": 0, "eol": 0, "healed": 0}
        comps, containers = self.collect_inventory(unverified)
        counts["components"] = len(comps)
        inventory["stack"] = [{k: c[k] for k in PUBLIC_FIELDS if k in c and c[k] is not None} for c in comps]
        products = sorted(set(c["product"] for c in comps if c.get("product") and not c.get("stale") and c.get("version")))
        feeds = self.load_feeds(products)
        items = []
        if containers is not None:
            items.append(dict(key="stack:%s:inventory" % self.host, result="pass", layer=LAYER, asset=self.host, check="inventory",
                              evidence={"components": len(comps), "containers": len(containers)}))
        else:
            items.append(dict(key="stack:%s:inventory" % self.host, result="skip", layer=LAYER, asset=self.host, check="inventory",
                              title="Not checked: could not list the containers on %s" % self.host,
                              detail="docker ps failed, so the container half of the stack inventory is missing tonight."))
        items.extend(self.feed_checks(feeds, unverified))
        recs = [self.judge(c, feeds) for c in comps]
        # ---- L9: guarded Nextcloud self-heal, before the push so one night gives one message
        healed_keys, alerts = set(), 0
        nc = self._nextcloud_container(containers)
        if nc is not None:
            mine = [r for r in recs if r["comp"].get("container") == nc["name"]]
            behind = [r["comp"] for r in mine if r["reason"] in ("critical", "behind")]
            if behind:
                today = self.now().date().isoformat()
                h = self.heal_nextcloud(nc, behind, dry, state, today)
                primary = "security.cve.%s.%s" % (self.host, nc.get("label") or nc["base"])
                if h["state"] == "ok":
                    counts["healed"] += 1
                    fresh = {a["component"]: a for a in h["after"]}
                    for i, r in enumerate(recs):
                        c = r["comp"]
                        if c.get("container") == nc["name"] and c["component"] in fresh:
                            nr = self.judge(fresh[c["component"]], feeds)
                            if c in behind and nr["check"] is not None:
                                nr["check"]["evidence"] = dict(nr["check"]["evidence"], healed={
                                    "from": c.get("version"), "to": fresh[c["component"]].get("version"), "undo_tag": h["undo_tag"]})
                            recs[i] = nr
                    ver_txt = ", ".join("%s %s to %s" % (c["component"], c.get("version"), fresh[c["component"]].get("version"))
                                        for c in behind if c["component"] in fresh)
                    title = "Ares patched Nextcloud: %s. The undo tag %s is kept" % (ver_txt, h["undo_tag"])
                    if live:
                        self._alert(primary, title, "Ares pulled the new image, recreated the nextcloud and push services, and checked that PHP moved forward "
                                    "and status.php answers 200 with installed true.", "info", healed=True)
                        self._resolve(primary, title)
                    healed_keys.add(primary)
                    self.log("cve: nextcloud healed (%s)" % ver_txt)
                elif h["state"] == "failed":
                    self.log("cve: nextcloud heal failed at %s" % h.get("stage"))
                    for r in mine:
                        healed_keys.add(self._alert_key(r["comp"]))
                    healed_keys.add(primary)
                    if live:
                        body = ("Ares tried to patch Nextcloud (%s) and it failed at the %s step. %s Nextcloud %s. The previous image is kept as %s. "
                                "To patch by hand: %s"
                                % (h["image"], h.get("stage"), "Everything was rolled back." if h.get("rolled_back") else "Nothing was changed.",
                                   "answers on cloud.bestly.tech again" if h.get("answers") else "is NOT answering and needs a person",
                                   h["undo_tag"], NEXTCLOUD_FIX))
                        title = "Ares: the Nextcloud patch failed and was rolled back" if h.get("rolled_back") \
                            else "Ares: the Nextcloud patch failed, nothing was changed"
                        if self._alert(primary, title, body, "error", needs=True):
                            alerts += 1
                else:
                    self.log("cve: nextcloud heal not run (%s)" % h.get("why"))
        for r in recs:
            reason = r["reason"]
            if reason == "critical":
                counts["critical"] += 1
            if reason in ("critical", "behind"):
                counts["behind"] += 1
            if reason == "eol":
                counts["eol"] += 1
            if r["check"] is not None:
                items.append(r["check"])
        alerts += self.push_alerts(recs, healed_keys, live)
        counts["alerts"] = alerts
        checks.extend(items)
        return counts

    # ---- L8: dependency gate
    def _osv_batch(self, queries):
        """-> (ids_by_index, ok). One POST per chunk of 500; any chunk that fails leaves its entries None."""
        out = [None] * len(queries)
        ok = True
        for i in range(0, len(queries), OSV_CHUNK):
            chunk = queries[i:i + OSV_CHUNK]
            body = json.dumps({"queries": [{"package": {"name": n, "ecosystem": e}, "version": v} for e, n, v in chunk]}).encode()
            try:
                st, data = self.api("POST", OSV_BATCH_URL, {"Content-Type": "application/json", "User-Agent": "bestly-ares"}, body, 60, 2)
                res = data.get("results") if st == 200 and isinstance(data, dict) else None
                if not isinstance(res, list) or len(res) != len(chunk):
                    raise ValueError("bad batch answer")
            except Exception as exc:  # noqa: BLE001
                self.log("cve: OSV batch failed (%s)" % type(exc).__name__)
                ok = False
                continue
            for j, r in enumerate(res):
                out[i + j] = [v.get("id") for v in (r or {}).get("vulns") or [] if isinstance(v, dict) and v.get("id")]
        return out, ok

    def _osv_level(self, vid, cache):
        """CRITICAL | HIGH | OTHER | UNKNOWN for one advisory id (MAL- ids are critical without a lookup)."""
        if vid.startswith("MAL-"):
            return "CRITICAL"
        if vid in cache:
            return cache[vid]
        if len(cache) >= OSV_DETAIL_CAP:
            return "UNKNOWN"
        level = "UNKNOWN"
        try:
            st, d = self.api("GET", OSV_VULN_URL % urllib.parse.quote(vid, safe=""), {"User-Agent": "bestly-ares"}, None, 30, 2)
            if st == 200 and isinstance(d, dict):
                level = "OTHER"
                vals, unread = [], False
                ds = d.get("database_specific")
                if isinstance(ds, dict) and isinstance(ds.get("severity"), str):
                    vals.append(ds["severity"].upper())
                for sv in d.get("severity") or []:
                    sc = (sv or {}).get("score")
                    num = sc if isinstance(sc, (int, float)) else (cvss3_score(sc) if isinstance(sc, str) and sc.startswith("CVSS:3") else None)
                    if num is not None:
                        vals.append("CRITICAL" if num >= 9 else "HIGH" if num >= 7 else "OTHER")
                    elif isinstance(sc, str) and sc.upper() in ("CRITICAL", "HIGH"):
                        vals.append(sc.upper())
                    elif isinstance(sc, str) and sc.startswith("CVSS:"):
                        unread = True           # a vector this code cannot score (CVSS v4, or malformed): never a quiet "fine"
                for want in ("CRITICAL", "HIGH"):
                    if want in vals:
                        level = want
                        break
                if level == "OTHER" and unread and not vals:
                    level = "UNKNOWN"
        except Exception as exc:  # noqa: BLE001
            self.log("cve: OSV lookup failed (%s)" % type(exc).__name__)
        cache[vid] = level
        return level

    def dependency_gate(self, checks, unverified, paths):
        counts = {"repos": 0, "packages": 0, "red": 0}
        scans, pool = {}, {}
        for repo in sorted(paths or {}):
            root = paths[repo]
            if not root or not os.path.isdir(root):
                continue
            locks, pkg_json = find_files(root)
            pk = set()
            for rel, kind in locks:
                text = _read(os.path.join(root, rel))
                try:
                    if text is None:
                        raise ValueError("unreadable")
                    if kind == "npm":
                        got = [("npm", n, v) for n, v in parse_package_lock(text)]
                    elif kind == "pnpm":
                        got = [("npm", n, v) for n, v in parse_pnpm_lock(text)]
                    elif kind == "yarn":
                        got = [("npm", n, v) for n, v in parse_yarn_lock(text)]
                    else:
                        got = [("PyPI", n, v) for n, v in parse_requirements(text)]
                except (ValueError, AttributeError, TypeError):
                    unverified.append("dependency gate (%s %s unreadable)" % (repo, rel))
                    continue
                pk.update(got)
            scans[repo] = {"root": root, "packages": pk, "package_json": pkg_json, "locks": [r for r, _ in locks]}
            for p in pk:
                pool[p] = None
        order = sorted(pool)
        ids, osv_ok = self._osv_batch(order) if order else ([], True)
        res = dict(zip(order, ids))
        if not osv_ok:
            unverified.append("dependency gate (OSV unreachable)")
        cache, items = {}, []
        for repo, sc in sorted(scans.items()):
            asset = "github:%s/%s" % (ORG, repo)
            if sc["packages"]:
                counts["repos"] += 1
                counts["packages"] += len(sc["packages"])
                key = "dep:%s:osv" % repo
                base = dict(key=key, layer=DEP_LAYER, asset=asset, check="osv_scan")
                unknown = [p for p in sc["packages"] if res.get(p) is None]
                if unknown:
                    items.append(dict(base, result="skip", title="Not checked: OSV.dev did not answer for %s" % repo,
                                      detail="%d of %d packages in %s could not be looked up tonight. Nothing was closed." % (len(unknown), len(sc["packages"]), repo)))
                else:
                    crit, high, vulns, unrated = [], [], 0, 0
                    for p in sorted(sc["packages"]):
                        for vid in res[p]:
                            vulns += 1
                            lv = self._osv_level(vid, cache)
                            row = {"name": p[1], "version": p[2], "id": vid, "ecosystem": p[0]}
                            if lv == "CRITICAL":
                                crit.append(row)
                            elif lv == "HIGH":
                                high.append(row)
                            elif lv == "UNKNOWN":
                                unrated += 1
                    ev = {"packages": len(sc["packages"]), "vulns": vulns}
                    if crit:
                        counts["red"] += 1
                        f = crit[0]
                        items.append(dict(base, result="red", evidence=dict(ev, hits=crit[:10], critical=len(crit)),
                                          title="%s installs a known-malicious or critical package: %s@%s (%s)" % (repo, f["name"], f["version"], f["id"]),
                                          detail="%s has %s with a malicious or critical advisory. Examples: %s." % (
                                              repo, plural(len(crit), "package"), "; ".join("%s@%s (%s)" % (x["name"], x["version"], x["id"]) for x in crit[:5])),
                                          fix="Remove or upgrade the package, delete node_modules, reinstall from a clean lockfile, and rotate any secret that a "
                                              "machine or CI job that installed it could reach."))
                    elif high or unrated:
                        items.append(dict(base, result="yellow", evidence=dict(ev, hits=high[:10], high=len(high), unrated=unrated),
                                          title="%s installs %s with a HIGH advisory" % (repo, plural(len(high), "package")) if high
                                          else "%s has advisories Ares could not rate" % repo,
                                          detail=("HIGH: %s." % "; ".join("%s@%s (%s)" % (x["name"], x["version"], x["id"]) for x in high[:8]))
                                          if high else "%d advisories could not be looked up on OSV.dev, so their severity is unknown." % unrated,
                                          fix="Upgrade the listed packages to a version without the advisory."))
                    else:
                        items.append(dict(base, result="pass", evidence=ev))
            if sc["package_json"]:
                ok_, missing = npm_gate(sc["root"])
                base = dict(key="dep:%s:npmrc" % repo, layer=DEP_LAYER, asset=asset, check="npmrc_gate")
                if ok_:
                    items.append(dict(base, result="pass", evidence={"package_json": sc["package_json"]}))
                else:
                    items.append(dict(base, result="yellow", title="%s has no install-script and release-age gate for npm" % repo,
                                      detail="%s has a package.json but its root .npmrc does not pin %s. Without them a freshly published, malicious "
                                             "package can run code on install." % (repo, " and ".join(missing)),
                                      fix="Add a .npmrc at the repo root with these two lines:\n%s" % "\n".join(NPMRC_LINES),
                                      evidence={"missing": missing, "package_json": sc["package_json"], "autofix": "add .npmrc"}))
        checks.extend(items)
        return counts

    # ---- entry point
    def run(self, checks, unverified, inventory, live, paths, dry=None, state=None):
        """Adds the stack and dependency checks to `checks`. -> {"stack": {...}, "deps": {...}}. Exceptions propagate (loud)."""
        dry = (not live) if dry is None else bool(dry)
        st = state if state is not None else self._audit_state()
        stack = self.stack_pass(checks, unverified, inventory, live, dry, st)
        deps = self.dependency_gate(checks, unverified, paths)
        return {"stack": stack, "deps": deps}
