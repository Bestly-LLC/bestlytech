#!/usr/bin/env python3
"""Ares 2.0: what the nightly audit learned from the 2026-10-21 public-repo miss. Stdlib only, no AI.

The miss (bestly_memory house/security/ares-miss-2026-10-21): a live Supabase service_role key sat in the git history
of a PUBLIC repo; Ares flagged it on Sep 22, then auto-closed it on Sep 23 because the file had left HEAD. Removing
a secret from the code is not fixing it.

What this module does (every item has a regression test in selftest.py, tied to a lesson in
bestly_memory house/security/ares-lessons):
  1. Scans EVERY commit of every Bestly-LLC repo (gitleaks when installed, plus our own regexes), not just HEAD.
     Broad patterns: any NAME containing TOKEN|KEY|SECRET|PASSWORD|PROXY with a long high-entropy value, curl -u,
     JWTs (role decoded), sb_secret_, github_pat_, sk_live_ ... Deduped by sha256 fingerprint.
  2. FIXED MEANS DEAD. A leaked-credential finding closes only when a liveness probe proves the credential no longer
     works, or its sha256 matches nothing live. Absence from the code never closes anything. Probes are read-only and
     keep a status code only.
  3. Repo visibility: any public org repo is red unless it is on the allowlist in bestly_memory.
  4. Legacy Supabase keys: red while still accepted AND a legacy key is in a repo or history.
  5. Code that fetches Bestly-LLC repos anonymously (so the repo can go private).
  6. The audit's own clone is authenticated (GitHub token read server-side from Vault).
  7. Coverage escalation: a layer unverified 3 nights running, or a needs_person finding older than 2 nights, is pushed.
  8. Learning loop: lessons are rules in bestly_memory; the run logs which ones it enforced.

Secret VALUES live in memory for the length of one scan and are then dropped. Only fingerprints, masked prefixes
(first 4 characters plus length) and status codes are ever stored, logged or sent anywhere.
"""
import base64
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

ORG = "Bestly-LLC"
GH_API = "https://api.github.com"
BESTLY_REF = "rcqfqhguwpmaarseifqg"
GITLEAKS_BIN = os.environ.get("GITLEAKS_BIN", "/opt/bestly/bin/gitleaks")
MEM_AREA = "house"
ALLOWLIST_KEY = "security/public-repo-allowlist"
LESSONS_KEY = "security/ares-lessons"
SEED_ALLOWLIST = ["Bestly-LLC/nextcloud-talk-transcripts"]
SELFTEST_STATE = "/opt/bestly/cron/state/security_audit_selftest.json"
MAX_REPO_KB = 600000            # a repo bigger than this is recorded as not scanned, never as clean
CLONE_TIMEOUT_S = 900
HISTORY_TIMEOUT_S = 1500
GATE_PROBE_MAX = 60
SECRET_LAYER = "Code"

# finding-key slug -> plain-English noun. Slugs for the first eight match scripts/security-audit/web_checks.py, so
# the findings that already exist keep their keys (and a "fixed" one that is still live reopens).
LABELS = {
    "supabase_service_role_key": "Supabase master key (service_role)",
    "supabase_secret_key": "Supabase secret key (sb_secret)",
    "stripe_live_secret_key": "Stripe live secret key",
    "github_token": "GitHub token",
    "aws_access_key": "AWS access key",
    "private_key": "Private key",
    "slack_token": "Slack token",
    "resend_api_key": "Resend API key",
    "hardcoded_function_key": "Hardcoded edge-function key",
    "anthropic_api_key": "Anthropic API key",
    "openai_api_key": "OpenAI API key",
    "generic_secret_assignment": "Hardcoded secret (a name containing TOKEN, KEY, SECRET, PASSWORD or PROXY)",
    "basic_auth_in_command": "Username and password in a curl command",
    "jwt_other": "Signed token (JWT)",
}
ANON_LABEL = "supabase_anon_key"      # public by design: never a finding on its own, only evidence for the legacy-keys check

SKIP_PATH = re.compile(r"(^|/)(node_modules|dist|build|vendor|\.next|Pods|DerivedData)/|"
                       r"(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Podfile\.lock|Package\.resolved)$|"
                       r"\.(png|jpe?g|webp|gif|ico|pdf|mp4|mov|woff2?|zip|svg|map|ttf|otf|heic|mp3|wav)$|\.min\.(js|css)$", re.I)
SPECIFIC = [
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}")),
    ("sb_secret", re.compile(r"sb_secret_[A-Za-z0-9_\-]{20,}")),
    ("github", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})")),
    ("stripe", re.compile(r"\b[sr]k_live_[0-9A-Za-z]{16,}")),
    ("anthropic", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{30,}")),
    ("openai", re.compile(r"\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_\-]{40,}")),
    ("aws", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("slack", re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{20,}")),
    ("resend", re.compile(r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}")),
]
TYPE_LABEL = {"sb_secret": "supabase_secret_key", "github": "github_token", "stripe": "stripe_live_secret_key",
              "anthropic": "anthropic_api_key", "openai": "openai_api_key", "aws": "aws_access_key",
              "slack": "slack_token", "resend": "resend_api_key", "private_key": "private_key",
              "basic_auth": "basic_auth_in_command"}
KEYWORD = re.compile(r"TOKEN|KEY|SECRET|PASSWORD|PASSWD|PROXY", re.I)
ASSIGN = re.compile(r"""(?P<name>[A-Za-z0-9_.\-]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PROXY)[A-Za-z0-9_.\-]*)["']?\s*(?::=|=>|:|=)\s*[bB]?["'`]?(?P<val>[A-Za-z0-9_\-+/=.~!@#$%^&*]{20,})["'`]?""", re.I)
BASIC = re.compile(r"""\bcurl\b[^\n]*?\s(?:-u|--user)[\s=]+['"]?(?P<user>[^:\s'"@$]{1,64}):(?P<pw>[^\s'"$]{6,})""")
PK_HEADER = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----")
HASHY_NAME = re.compile(r"sha|hash|digest|checksum|fingerprint|integrity|publishable|public", re.I)
PLACEHOLDER = re.compile(r"^(your|example|xxx|changeme|placeholder|dummy|sample|fake|todo|replace|insert|<|\$|\{|process\.|os\.|deno\.|import\.)", re.I)


def mask(value):
    """First 4 characters plus the length. The only form of a secret that is ever printed or stored."""
    return "%s[%d]" % ((value or "")[:4], len(value or ""))


def sha256(value):
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()


def entropy(s):
    if not s:
        return 0.0
    n = float(len(s))
    return -sum((c / n) * math.log(c / n, 2) for c in [s.count(ch) for ch in set(s)])


def jwt_payload(tok):
    try:
        p = tok.split(".")[1]
        p += "=" * (-len(p) % 4)
        d = json.loads(base64.urlsafe_b64decode(p))
        return d if isinstance(d, dict) else None
    except Exception:  # noqa: BLE001
        return None


def plausible_assignment(name, val):
    """High-entropy, not a word, not a placeholder, not a reference to an env var, not a hash of something."""
    if len(val) < 20 or val.lower().startswith("eyj") or HASHY_NAME.search(name):
        return False
    if PLACEHOLDER.match(val) or "://" in val or re.fullmatch(r"(.)\1+", val):
        return False
    if not (re.search(r"\d", val) and re.search(r"[A-Za-z]", val)):
        return False
    if val.count("/") >= 2 and entropy(val) < 4.2:
        return False
    return entropy(val) >= 3.3


class Secret(object):
    """One distinct credential. `value` is dropped by release() as soon as liveness is decided."""
    __slots__ = ("fp", "value", "type", "label", "files", "repos", "first_commit", "commits", "role", "ref",
                 "gate_fns", "live", "basis", "masked", "engine")

    def __init__(self, value, typ, label):
        self.fp, self.value, self.type, self.label = sha256(value), value, typ, label
        self.masked = mask(value)
        self.files, self.repos, self.gate_fns = set(), set(), set()
        self.first_commit, self.commits = None, 0
        self.role = self.ref = None
        self.live, self.basis, self.engine = None, "not checked", "regex"

    def release(self):
        self.value = None


def classify(value, name=None, path=None):
    """-> (type, label, role, ref) for a candidate string, or None to ignore it."""
    if value.startswith("eyJ") and value.count(".") == 2:
        pl = jwt_payload(value)
        if pl is None:
            return None
        role, ref = pl.get("role"), pl.get("ref")
        if role == "service_role":
            return "supabase_jwt", "supabase_service_role_key", role, ref
        if role in ("anon", "authenticated"):
            return "supabase_jwt", ANON_LABEL, role, ref
        return "jwt", "jwt_other", role, ref
    for typ, rx in SPECIFIC[1:]:
        if rx.fullmatch(value):
            return typ, TYPE_LABEL[typ], None, None
    if name is not None:
        if path and path.startswith("supabase/functions/"):
            return "assignment", "hardcoded_function_key", None, None
        return "assignment", "generic_secret_assignment", None, None
    return "assignment", "generic_secret_assignment", None, None


def _add(found, value, typ, label, role, ref, path, commit, repo, engine="regex"):
    fp = sha256(value)
    rec = found.get(fp)
    if rec is None:
        rec = found[fp] = Secret(value, typ, label)
        rec.role, rec.ref, rec.engine = role, ref, engine
    rec.files.add(path or "?")
    rec.repos.add(repo)
    rec.commits += 1
    rec.first_commit = commit or rec.first_commit      # history is read newest first, so this ends on the oldest
    m = re.match(r"supabase/functions/([^/_][^/]*)/", path or "")
    if m:
        rec.gate_fns.add(m.group(1))
    return rec


def scan_line(line, path, commit, repo, found):
    """Find candidate secrets on one ADDED line. Mutates `found` (fingerprint -> Secret)."""
    if len(line) > 20000 or (path and SKIP_PATH.search(path)):
        return
    for typ, rx in SPECIFIC:
        for m in rx.finditer(line):
            v = m.group(0)
            if typ == "jwt":
                c = classify(v)
                if c:
                    _add(found, v, c[0], c[1], c[2], c[3], path, commit, repo)
            else:
                _add(found, v, typ, TYPE_LABEL[typ], None, None, path, commit, repo)
    if len(line) > 4000:
        return
    m = BASIC.search(line)
    if m and not PLACEHOLDER.match(m.group("pw")):
        _add(found, m.group("pw"), "basic_auth", "basic_auth_in_command", None, None, path, commit, repo)
    if KEYWORD.search(line):
        for m in ASSIGN.finditer(line):
            name, val = m.group("name"), m.group("val")
            if plausible_assignment(name, val):
                typ, label, role, ref = classify(val, name, path) or (None, None, None, None)
                if typ:
                    _add(found, val, typ, label, role, ref, path, commit, repo)


def scan_history(path, repo, timeout=HISTORY_TIMEOUT_S, git="git", found=None):
    """Every added line of every commit on every ref. -> (found, commits_seen, error)."""
    found = {} if found is None else found
    commits, err = 0, None
    cmd = [git, "-C", path, "log", "--all", "-p", "--no-color", "--no-ext-diff", "-U0", "--no-renames",
           "--diff-filter=AM", "--format=@@COMMIT %H"]
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True,
                             errors="replace", bufsize=1 << 20)
    except OSError as exc:
        return found, 0, "git log could not start (%s)" % type(exc).__name__
    timer = threading.Timer(timeout, p.kill)
    timer.start()
    commit, cur, pk, pk_left = None, None, None, 0
    try:
        for raw in p.stdout:
            line = raw.rstrip("\n")
            if line.startswith("@@COMMIT "):
                commit, commits, cur = line[9:49], commits + 1, None
                continue
            if line.startswith("+++ "):
                cur = line[6:] if line.startswith("+++ b/") else None
                continue
            if not line.startswith("+") or cur is None:
                continue
            body = line[1:]
            if pk is not None:
                pk.append(body.strip())
                pk_left -= 1
                if pk_left <= 0:
                    _add(found, "\n".join(pk), "private_key", "private_key", None, None, cur, commit, repo)
                    pk = None
                continue
            if PK_HEADER.search(body):
                pk, pk_left = [body.strip()], 3
                continue
            scan_line(body, cur, commit, repo, found)
    finally:
        timer.cancel()
        try:
            p.stdout.close()
        except Exception:  # noqa: BLE001
            pass
        rc = p.wait()
    try:   # git log hides commits whose diff has no added file; count every commit so "all commits were read" is checkable
        total = subprocess.run([git, "-C", path, "rev-list", "--all", "--count"], capture_output=True, text=True, timeout=120)
        if total.returncode == 0 and total.stdout.strip().isdigit():
            commits = max(commits, int(total.stdout.strip()))
    except (OSError, subprocess.SubprocessError):
        pass
    if rc not in (0, None) and commits == 0:
        err = "git log exited %s" % rc
    elif rc not in (0, None):
        err = "git log was cut short (exit %s) after %d commits" % (rc, commits)
    return found, commits, err


# ----------------------------------------------------------------------------------------------- gitleaks
def gitleaks_version(binpath=GITLEAKS_BIN):
    try:
        out = subprocess.run([binpath, "version"], capture_output=True, text=True, timeout=20)
        m = re.search(r"(\d+)\.(\d+)\.(\d+)", out.stdout + out.stderr)
        return tuple(int(x) for x in m.groups()) if out.returncode == 0 and m else None
    except (OSError, subprocess.SubprocessError):
        return None


def run_gitleaks(path, repo, found, binpath=GITLEAKS_BIN, timeout=HISTORY_TIMEOUT_S):
    """Full-history scan with gitleaks, merged into `found`. Report goes to stdout (never to disk) and is parsed in
    memory. -> (n_findings, error). A missing or broken binary is an error string, never silence."""
    ver = gitleaks_version(binpath)
    if ver is None:
        return 0, "gitleaks is not installed or does not run"
    if ver >= (8, 19, 0):
        cmd = [binpath, "git", path, "--log-opts=--all"]
    else:
        cmd = [binpath, "detect", "--source", path, "--log-opts=--all"]
    cmd += ["--report-format", "json", "--report-path", "-", "--no-banner", "--log-level", "error", "--exit-code", "0"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, errors="replace")
    except subprocess.TimeoutExpired:
        return 0, "gitleaks timed out"
    except (OSError, subprocess.SubprocessError) as exc:
        return 0, "gitleaks could not run (%s)" % type(exc).__name__
    if res.returncode != 0:
        return 0, "gitleaks exited %d" % res.returncode
    try:
        rows = json.loads(res.stdout or "[]")
    except ValueError:
        return 0, "gitleaks printed output that is not JSON"
    n = 0
    for r in rows if isinstance(rows, list) else []:
        val = (r.get("Secret") or "").strip()
        if len(val) < 8 or PLACEHOLDER.match(val):
            continue
        fpath = r.get("File") or "?"
        if SKIP_PATH.search(fpath):
            continue
        c = classify(val, name=r.get("RuleID") or "x", path=fpath)
        if c:
            _add(found, val, c[0], c[1], c[2], c[3], fpath, r.get("Commit"), repo, engine="gitleaks")
            n += 1
    del rows, res
    return n, None


# --------------------------------------------------------------------------------------------- liveness
GATE_HEADER_SETS = ({"x-proxy-key": "{v}"}, {"x-worker-token": "{v}"}, {"Authorization": "Bearer {v}"}, {"x-api-key": "{v}"})


class Prober(object):
    """Read-only liveness probes. A probe keeps a status code and nothing else.
    -> state 'live' | 'dead' | 'unknown' | None (no probe exists for this kind of secret)."""

    def __init__(self, api, ref=BESTLY_REF, sleep=time.sleep):
        self.api, self.ref, self.sleep = api, ref, sleep
        self.gate_baseline, self.gate_probes = {}, 0

    def _get(self, url, headers, method="GET"):
        try:
            status, data = self.api(method, url, headers, None, 25, 1)
        except Exception:  # noqa: BLE001 -- ApiError or anything the transport raises: we simply do not know
            return None, None
        return status, data

    def probe(self, rec):
        t, v = rec.type, rec.value
        if t == "supabase_jwt":
            ref = rec.ref or self.ref
            if rec.role == "service_role":
                st, _ = self._get("https://%s.supabase.co/auth/v1/admin/users?per_page=1" % ref,
                                  {"apikey": v, "Authorization": "Bearer " + v})
            else:
                st, _ = self._get("https://%s.supabase.co/auth/v1/settings" % ref, {"apikey": v})
            return self._by_status(st, "supabase_admin_users" if rec.role == "service_role" else "supabase_settings")
        if t == "sb_secret":
            st, _ = self._get("https://%s.supabase.co/auth/v1/admin/users?per_page=1" % self.ref, {"apikey": v})
            return self._by_status(st, "supabase_admin_users")
        if t == "github":
            st, _ = self._get(GH_API + "/user", {"Authorization": "Bearer " + v, "Accept": "application/vnd.github+json",
                                                  "User-Agent": "bestly-ares"})
            return self._by_status(st, "github_user")
        if t == "stripe":
            st, _ = self._get("https://api.stripe.com/v1/balance", {"Authorization": "Bearer " + v})
            if st == 403 and v.startswith("rk_"):
                return "live", "stripe_balance_403_restricted"
            return self._by_status(st, "stripe_balance")
        if t == "anthropic":
            st, _ = self._get("https://api.anthropic.com/v1/models", {"x-api-key": v, "anthropic-version": "2023-06-01"})
            return self._by_status(st, "anthropic_models")
        if t == "openai":
            st, _ = self._get("https://api.openai.com/v1/models", {"Authorization": "Bearer " + v})
            return self._by_status(st, "openai_models")
        if t == "resend":
            st, data = self._get("https://api.resend.com/domains", {"Authorization": "Bearer " + v})
            if st == 401 and isinstance(data, dict) and data.get("name") == "restricted_api_key":
                return "live", "resend_restricted"
            return self._by_status(st, "resend_domains")
        if t == "slack":
            st, data = self._get("https://slack.com/api/auth.test", {"Authorization": "Bearer " + v})
            if st == 200 and isinstance(data, dict):
                return ("live", "slack_auth_test") if data.get("ok") else \
                       (("dead", "slack_auth_test") if data.get("error") in ("invalid_auth", "token_revoked", "account_inactive", "token_expired")
                        else ("unknown", "slack_auth_test"))
            return "unknown", "slack_auth_test"
        return None, "no_probe"

    @staticmethod
    def _by_status(st, basis):
        if st == 200:
            return "live", "%s_200" % basis
        if st in (401, 403):
            return "dead", "%s_%d" % (basis, st)
        return "unknown", "%s_%s" % (basis, st if st else "unreachable")

    def gate(self, rec, project_url_for):
        """Edge-function gates: send the candidate to the function it was found in, EMPTY body. The gate answers 401/403
        for a wrong key; any answer past the gate (400/404/405/409/415/422 or 2xx) means the key was accepted.
        -> (state, basis) or (None, ...) when there is no function gate to ask."""
        verdict = None
        for fn in sorted(rec.gate_fns):
            url = project_url_for(fn)
            base = self.gate_baseline.get(fn)
            if base is None:
                if self.gate_probes >= GATE_PROBE_MAX:
                    return "unknown", "gate_probe_budget"
                self.gate_probes += 1
                base, _ = self._post_empty(url, {})
                self.gate_baseline[fn] = base or 0
            if self.gate_baseline[fn] not in (401, 403):
                continue                      # not gated by a key, or gone: nothing to learn here
            for hs in GATE_HEADER_SETS:
                if self.gate_probes >= GATE_PROBE_MAX:
                    return "unknown", "gate_probe_budget"
                self.gate_probes += 1
                st, _ = self._post_empty(url, {k: v.replace("{v}", rec.value) for k, v in hs.items()})
                if st in (200, 201, 202, 204, 400, 404, 405, 409, 410, 415, 422):
                    return "live", "gate_accepts_%d" % st
                if st in (401, 403):
                    verdict = ("dead", "gate_rejects_%d" % st)
                else:
                    return "unknown", "gate_%s" % (st or "unreachable")
        return verdict if verdict else (None, "no_gate")

    def _post_empty(self, url, headers):
        h = {"Content-Type": "application/json"}
        h.update(headers)
        try:
            st, data = self.api("POST", url, h, b"", 20, 1)
        except Exception:  # noqa: BLE001
            return None, None
        return st, data


def assess(secrets, prober, fp_live_fn, project_url_for):
    """Decide live / dead / unknown for every secret. FIXED MEANS DEAD lives here: a credential is `False` (dead) only
    when a probe says it no longer works, or (for kinds with no probe) its fingerprint matches nothing live in Vault,
    db_watchdog_tokens, staff_sessions. Anything that cannot be decided is None and can never close a finding."""
    recs = list(secrets.values())
    fp_live = fp_live_fn([r.fp for r in recs]) if recs else {}          # None = the server-side check is unavailable
    probed = 0
    for r in recs:
        if r.label == ANON_LABEL:
            if probed < 5 and r.ref in (None, BESTLY_REF):
                st, basis = prober.probe(r)
                probed += 1
                r.live, r.basis = (True if st == "live" else False if st == "dead" else None), basis
            else:
                r.live, r.basis = None, "anon_not_probed"
            continue
        state, basis = prober.probe(r)
        if state == "live":
            r.live, r.basis = True, basis
        elif state == "dead":
            r.live, r.basis = False, basis
        elif state == "unknown":
            r.live, r.basis = None, basis
        else:
            src = (fp_live or {}).get(r.fp)
            if src:
                r.live, r.basis = True, "hash_match:" + src
            elif r.gate_fns:
                gs, gb = prober.gate(r, project_url_for)
                if gs == "live":
                    r.live, r.basis = True, gb
                elif fp_live is None:
                    r.live, r.basis = None, "hash_check_unavailable"
                elif gs == "unknown":
                    r.live, r.basis = None, gb
                else:
                    r.live, r.basis = False, "hash_nomatch+" + gb
            elif fp_live is None:
                r.live, r.basis = None, "hash_check_unavailable"
            else:
                r.live, r.basis = False, "hash_nomatch"
        r.release()
    for r in recs:
        r.release()
    return recs


# ----------------------------------------------------------------------------------------------- GitHub
def git_env(token):
    """Environment for git. The token travels as an env-scoped HTTP header: never in argv, never in .git/config,
    never in the remote URL."""
    e = {"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", ""), "GIT_TERMINAL_PROMPT": "0",
         "LANG": "C.UTF-8"}
    if token:
        b = base64.b64encode(("x-access-token:%s" % token).encode()).decode()
        e.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                  "GIT_CONFIG_VALUE_0": "Authorization: Basic " + b})
    return e


def clone_full(name, dest, token, timeout=CLONE_TIMEOUT_S):
    """Authenticated FULL clone (all history) of Bestly-LLC/<name>. The remote URL stays credential-free."""
    url = "https://github.com/%s/%s.git" % (ORG, name)
    try:
        res = subprocess.run(["git", "clone", "--quiet", url, dest], capture_output=True, text=True,
                             timeout=timeout, env=git_env(token))
        if res.returncode != 0:
            return False
        # pull requests are world-readable refs on a public repo too; best effort, never fatal
        subprocess.run(["git", "-C", dest, "fetch", "--quiet", "origin", "+refs/pull/*/head:refs/remotes/pr/*"],
                       capture_output=True, text=True, timeout=300, env=git_env(token))
        return True
    except (OSError, subprocess.SubprocessError):
        return False


class GitHub(object):
    def __init__(self, token, api):
        self.token, self.api = token, api

    def _h(self):
        h = {"Accept": "application/vnd.github+json", "User-Agent": "bestly-ares", "X-GitHub-Api-Version": "2022-11-28"}
        if self.token:
            h["Authorization"] = "Bearer " + self.token
        return h

    def get(self, path):
        return self.api("GET", GH_API + path, self._h(), None, 40, 3)

    def valid(self):
        if not self.token:
            return False
        try:
            st, _ = self.get("/user")
        except Exception:  # noqa: BLE001
            return False
        return st == 200

    def list_repos(self):
        """-> (repos, authenticated, error). Without a token GitHub only lists the PUBLIC repos, which is still enough
        to catch a public one."""
        out, page = [], 1
        while page <= 10:
            st, data = self.get("/orgs/%s/repos?type=all&per_page=100&page=%d" % (ORG, page))
            if st != 200 or not isinstance(data, list):
                return out, bool(self.token), "GitHub answered HTTP %s listing the org" % st
            for r in data:
                out.append({"name": r.get("name"), "private": bool(r.get("private")), "archived": bool(r.get("archived")),
                            "fork": bool(r.get("fork")), "size_kb": r.get("size") or 0,
                            "visibility": r.get("visibility") or ("private" if r.get("private") else "public")})
            if len(data) < 100:
                break
            page += 1
        return out, bool(self.token), None


def get_github_token(db, api, vault_shim=None):
    """Token from Vault, server-side (get_github_token, then security_github_token, then pi:github:token). Validated against GitHub, never logged. -> token or ''."""
    cands = []
    try:                                # the same service-role RPC the code-job-git edge function uses (Vault, server-side)
        v = db.rpc("get_github_token")
        if isinstance(v, str) and v.strip():
            cands.append(v.strip())
    except Exception:  # noqa: BLE001
        pass
    for nm in ("github_bestlytech_pat", "github_token"):
        try:
            v = db.rpc("security_github_token", {"p_name": nm})
            if isinstance(v, str) and v.strip():
                cands.append(v.strip())
        except Exception:  # noqa: BLE001
            break                       # RPC not installed: stop asking it
    if vault_shim:
        v = vault_shim("github", "token")
        if v:
            cands.append(v)
    for t in cands:
        if GitHub(t, api).valid():
            return t
    return ""


# ---------------------------------------------------------------------------------- repo visibility + memory
def parse_allowlist(body):
    return set(m.group(0).lower() for m in re.finditer(r"[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+", body or ""))


def visibility_checks(repos, allow):
    """One check per repo. A public repo is red unless it is explicitly allowlisted."""
    items = []
    for r in repos:
        full = "%s/%s" % (ORG, r["name"])
        base = dict(key="repo:%s:visibility" % r["name"], layer=SECRET_LAYER, asset="github:%s" % full, check="repo_visibility")
        if not r["private"] and full.lower() not in allow:
            items.append(dict(base, result="red",
                              title="%s is a PUBLIC repository" % full,
                              detail="Everyone on the internet can read every file and every past commit of %s. Nothing in it can be taken back. "
                                     "It is not on the public-repo allowlist (bestly_memory %s/%s)." % (full, MEM_AREA, ALLOWLIST_KEY),
                              fix="Make it private (GitHub > repo Settings > Danger Zone > Change visibility). If it is meant to be open source, add it "
                                  "to the allowlist note first, after a full-history scan shows it holds no secrets.",
                              evidence={"visibility": "public", "archived": r["archived"], "fork": r["fork"]}))
        else:
            items.append(dict(base, result="pass",
                              evidence={"visibility": "public" if not r["private"] else "private",
                                        "allowlisted": (not r["private"] and full.lower() in allow)}))
    return items


# ------------------------------------------------------------------------------------------ result builders
def history_checks(repo, recs, prior_open, engine_note, visibility):
    """-> (checks, states). One check per label per repo, keyed code:<repo>:secret:<label> (the keys web_checks used,
    so existing findings reopen). red = a live credential, skip = could not prove it dead, pass = every one proven dead
    (or none found). NEVER pass on mere absence when an open red finding exists: only proof of death closes."""
    checks, states = [], []
    mine = [r for r in recs if repo in r.repos]
    for label, noun in sorted(LABELS.items()):
        key = "code:%s:secret:%s" % (repo, label)
        rs = [r for r in mine if r.label == label]
        live = [r for r in rs if r.live is True]
        unk = [r for r in rs if r.live is None]
        dead = [r for r in rs if r.live is False]
        asset = "github:%s/%s" % (ORG, repo)
        states.append({"key": key, "live_count": len(live), "unknown_count": len(unk)})

        def row(r):
            return {"fp": r.fp[:16], "type": r.type, "masked": r.masked, "file": sorted(r.files)[0], "files": len(r.files),
                    "first_commit": (r.first_commit or "")[:7], "commits": r.commits, "basis": r.basis, "engine": r.engine}
        ev = {"engine": engine_note, "repo_visibility": visibility, "dead": len(dead), "unknown": len(unk)}
        if live:
            ev["live"] = [row(r) for r in live][:10]
            where = "; ".join("%s (first in commit %s, value %s)" % (e["file"], e["first_commit"], e["masked"]) for e in ev["live"][:5])
            checks.append(dict(key=key, result="red", layer=SECRET_LAYER, asset=asset, check="secret_scan",
                               title="%s is in the git history of %s/%s and still works" % (noun, ORG, repo),
                               detail="%s of this kind still work. Found in: %s. The repository is %s, and git history keeps every old copy. "
                                      "Deleting the file or rewriting history does not make the credential safe; revoking it does."
                                      % (len(live), where, visibility),
                               fix="Revoke or rotate the credential first. This finding closes only when a check proves the credential no longer works.",
                               evidence=ev))
        elif unk:
            ev["unknown_rows"] = [row(r) for r in unk][:10]
            checks.append(dict(key=key, result="skip", layer=SECRET_LAYER, asset=asset, check="secret_scan",
                               title="Not checked: could not prove %s in %s is dead" % (noun.lower(), repo),
                               detail="%d credential(s) of this kind are in the history of %s and could not be tested tonight (%s). "
                                      "Nothing was closed." % (len(unk), repo, ", ".join(sorted(set(r.basis for r in unk)))[:200]),
                               evidence=ev))
        else:
            prev = prior_open.get(key)
            if not rs and prev and prev.get("severity") == "red":
                checks.append(dict(key=key, result="skip", layer=SECRET_LAYER, asset=asset, check="secret_scan",
                                   title="Not checked: %s is no longer found, but it was last known to work" % noun.lower(),
                                   detail="The credential is no longer in what was scanned, which is not proof it is dead (a copy can still exist, "
                                          "for example in GitHub's cache of a rewritten history). Revoke it, or dismiss this finding yourself once it is.",
                                   evidence=ev))
            else:
                ev["dead_rows"] = len(dead)
                checks.append(dict(key=key, result="pass", layer=SECRET_LAYER, asset=asset, check="secret_scan", evidence=ev))
    return checks, states


def legacy_check(recs, accepted, traffic):
    """Legacy Supabase API keys: red while still accepted AND a legacy key is in a repo or its history; yellow when they
    are accepted but not seen anywhere; pass when the project rejects them."""
    legacy = [r for r in recs if r.type == "supabase_jwt" and r.label in ("supabase_service_role_key", ANON_LABEL)
              and r.ref in (None, BESTLY_REF)]
    ev = {"legacy_keys_seen": len(legacy), "roles_seen": sorted(set(r.role for r in legacy if r.role)),
          "repos": sorted(set(x for r in legacy for x in r.repos))[:10]}
    if traffic:
        ev["legacy_traffic"] = traffic
    base = dict(key="supa:Bestly:legacy_keys", layer="Database (Supabase)", asset="Bestly", check="legacy_keys")
    share = ""
    if traffic and traffic.get("total"):
        share = " Legacy keys made up %.1f%% of API calls in the last 24 hours." % (100.0 * traffic.get("legacy", 0) / traffic["total"])
    if accepted is None:
        return dict(base, result="skip", title="Not checked: could not tell whether the legacy Supabase keys still work",
                    detail="No legacy key could be tested tonight.", evidence=ev)
    if not accepted:
        return dict(base, result="pass", evidence=ev)
    if legacy:
        return dict(base, result="red", title="Legacy Supabase API keys still work, and a copy is in a repo's history",
                    detail="The old anon and service_role keys are still accepted by the project, and %d legacy key(s) are in git history. "
                           "Anyone who can read that history can use them.%s" % (len(legacy), share),
                    fix="Supabase dashboard > Settings > API Keys > disable legacy API keys (reversible; anon and service_role go together). "
                        "See bestly_memory house/security/key-switch for the moving-over steps.", evidence=ev)
    return dict(base, result="yellow", title="Legacy Supabase API keys are still accepted",
                detail="No legacy key was found in a repo or its history, but the project still accepts them.%s" % share,
                fix="Disable legacy API keys once the callers have moved (bestly_memory house/security/key-switch).", evidence=ev)


FETCH_HINT = re.compile(r"raw\.githubusercontent\.com|codeload\.github\.com|api\.github\.com/repos|clone|\.git\b|archive/|"
                        r"releases/download|curl|wget|urlopen|fetch\(|requests\.|http\.get|from\s+[\"']https|git\+https", re.I)
REPO_REF = re.compile(r"(?:raw\.githubusercontent\.com|codeload\.github\.com|github\.com|api\.github\.com/repos)/%s/([A-Za-z0-9_.\-]+)" % ORG, re.I)
AUTH_HINT = re.compile(r"Authorization|x-access-token|GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT|Bearer\s|token\s+\$", re.I)
CODE_EXT = (".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".command", ".json", ".yml", ".yaml", ".plist", ".swift",
            ".html", ".rb", ".go")


def scan_consumers(root, private_intended):
    """Code that fetches Bestly-LLC repos with no credentials, which breaks the day the repo is private.
    `private_intended(name)` says whether a repo is meant to be private. -> list of {file, line, repo}."""
    hits = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "dist", "build", "vendor", ".next")]
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir.startswith(("tools/security-audit", "docs")):
            continue
        for f in files:
            if not f.endswith(CODE_EXT):
                continue
            p = os.path.join(dirpath, f)
            try:
                if os.path.getsize(p) > 1500000:
                    continue
                lines = open(p, encoding="utf-8", errors="ignore").read().split("\n")
            except OSError:
                continue
            for i, ln in enumerate(lines):
                m = REPO_REF.search(ln)
                if not m or not FETCH_HINT.search(ln) or not private_intended(m.group(1).replace(".git", "")):
                    continue
                window = "\n".join(lines[max(0, i - 4): i + 5])
                if AUTH_HINT.search(window):
                    continue
                hits.append({"file": os.path.relpath(p, root), "line": i + 1, "repo": m.group(1).replace(".git", "")})
    return hits


def consumers_check(repo, hits, repo_private):
    base = dict(key="code:%s:unauth_consumers" % repo, layer=SECRET_LAYER, asset="github:%s/%s" % (ORG, repo), check="unauth_consumers")
    if not hits:
        return dict(base, result="pass")
    files = sorted(set(h["file"] for h in hits))
    ev = {"count": len(hits), "files": files[:30], "targets": sorted(set(h["repo"] for h in hits))}
    return dict(base, result="red" if repo_private else "yellow",
                title="%d place%s fetch a Bestly-LLC repo with no credentials" % (len(files), "" if len(files) == 1 else "s"),
                detail="These files read raw.githubusercontent.com or clone a Bestly-LLC repo anonymously: %s. They keep working only while that "
                       "repo is public, so they block making it private%s." % (", ".join(files[:6]),
                                                                            " and are already failing" if repo_private else ""),
                fix="Give each one a credential (Vault github token) or move it behind an edge function, then the repo can stay private.",
                evidence=ev)


# ------------------------------------------------------------------------------------------- lessons
# Lessons are RULES kept in bestly_memory (area house, key security/ares-lessons, kind convention), one per line:
#     L<n> | <rule id> | <selftest name> | <text>
# The audit loads them at the start and logs which it enforced. Every lesson must name a rule the code enforces and a
# selftest that reproduces the miss it came from; one that does not is itself a yellow finding (a rule with no teeth).
ENFORCED_RULES = {
    "fixed_means_dead": "a leaked-credential finding closes only on proof the credential is dead",
    "full_history_broad_patterns": "every commit of every org repo is scanned, with name-based and format-based patterns",
    "public_repo_red": "a public org repo is red unless on the allowlist",
    "legacy_keys_checked": "legacy Supabase keys are probed and reported",
    "coverage_escalates": "a blind spot of 3 nights, or a needs_person older than 2 nights, is pushed to Jared",
    "selftest_gate": "the regression suite runs before every nightly run and a failure fails the run loudly",
}
BUILTIN_LESSONS = [
    ("L1", "fixed_means_dead", "test_L1_fixed_means_dead",
     "A leaked credential is fixed only when a probe shows it no longer works or its fingerprint matches nothing live. Deleting it from the code never closes it (2026-10-21: service_role key left HEAD, was auto-closed, still worked)."),
    ("L2", "full_history_broad_patterns", "test_L2_history_and_names",
     "Scan every commit of every Bestly-LLC repo, not git ls-files. Match by variable name (TOKEN, KEY, SECRET, PASSWORD, PROXY) and by format (JWT role, Supabase secret keys, GitHub tokens, Stripe live keys, curl -u), not a fixed list of names."),
    ("L3", "public_repo_red", "test_L3_public_repo_red",
     "A public repository is red unless it is on bestly_memory house/security/public-repo-allowlist."),
    ("L4", "legacy_keys_checked", "test_L4_legacy_keys",
     "Legacy Supabase API keys are red while they still work and a copy sits in a repo or its history."),
    ("L5", "coverage_escalates", "test_L5_coverage_escalation",
     "A layer unverified 3 nights running, or a needs_person finding older than 2 nights, is pushed to Jared by Ares. A quiet blind spot is a miss."),
    ("L6", "selftest_gate", "test_L6_selftest_gate",
     "selftest.py runs before every nightly run. If any regression test fails the run fails loudly with an Ares-signed alert; a lesson without a passing test is not a lesson."),
]


def parse_lessons(body):
    out = []
    for ln in (body or "").splitlines():
        m = re.match(r"^\s*(L\d+)\s*\|\s*([a-z0-9_]+)\s*\|\s*([A-Za-z0-9_]+)\s*\|\s*(.+?)\s*$", ln)
        if m:
            out.append(m.groups())
    return out


def lessons_body():
    return "\n".join("%s | %s | %s | %s" % l for l in BUILTIN_LESSONS)


def read_selftest_state(path=SELFTEST_STATE):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def lessons_checks(lessons, selftest_state):
    """-> (checks, enforced_lines). A lesson whose rule the code does not enforce, or whose selftest did not pass, is yellow."""
    checks, lines = [], []
    tests = (selftest_state or {}).get("tests") or {}
    for lid, rule, test, text in lessons:
        enforced = rule in ENFORCED_RULES
        tested = tests.get(lid) == "ok" if tests else None
        key = "ares:lesson:%s" % lid
        base = dict(key=key, layer="Security process", asset="Ares", check="lesson")
        if not enforced:
            checks.append(dict(base, result="yellow", title="Ares lesson %s has no enforcement in the code" % lid,
                               detail="Rule %s is written down but nothing in the audit enforces it. A rule with no teeth is how the 2026-10-21 miss happened."
                                      % rule, fix="Add the check to security_audit_ares2.py and a selftest case named %s." % test,
                               evidence={"rule": rule, "selftest": test}))
        elif tested is False:
            checks.append(dict(base, result="yellow", title="Ares lesson %s has no passing selftest" % lid,
                               detail="The last selftest did not report %s as passing." % test, evidence={"rule": rule, "selftest": test}))
        else:
            checks.append(dict(base, result="pass", evidence={"rule": rule, "selftest": test, "tested": tested}))
            lines.append("%s %s%s" % (lid, rule, "" if tested else " (selftest state unknown)"))
    return checks, lines


# --------------------------------------------------------------------------------------------- alerts
def alert(db, key, title, body, severity="warning", needs=None):
    """Ares-signed push: bestly_raise under the `security.` prefix is owned by security-auditor (notification_owner).
    -> True when the database accepted it."""
    assert key.startswith("security."), key
    try:
        db.rpc("bestly_raise", {"p_key": key, "p_kind": "problem", "p_severity": severity, "p_title": title, "p_body": body,
                                "p_area": "security", "p_needs_jared": needs})
        return True
    except Exception:  # noqa: BLE001
        return False


def resolve(db, key, title=None):
    assert key.startswith("security."), key
    try:
        db.rpc("bestly_raise", {"p_key": key, "p_kind": "resolved", "p_severity": "info", "p_title": title})
        return True
    except Exception:  # noqa: BLE001
        return False


def layer_of(unverified_entry):
    return re.sub(r"\s*\(.*\)\s*$", "", unverified_entry).strip()


def pt_date(iso):
    try:
        from zoneinfo import ZoneInfo
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return t.astimezone(ZoneInfo("America/Los_Angeles")).date()
    except Exception:  # noqa: BLE001
        return None


def coverage_escalation(db, unverified, now, runs=None, needs_person=None):
    """Blind spots must not stay quiet. -> list of plain sentences to push (empty = nothing to escalate).
    A layer counts when it is unverified tonight and was in the newest run of each of the 2 nights before (3 nights running);
    a needs_person finding counts once it is more than 2 nights old (nights_open >= 3)."""
    items = []
    layers_now = sorted(set(layer_of(u) for u in unverified))
    if layers_now:
        if runs is None:
            try:
                runs = db.get("security_audit_runs?select=started_at,status,inventory&order=started_at.desc&limit=14")
            except Exception:  # noqa: BLE001
                runs = []
        today = pt_date(now.isoformat())
        per_day = {}
        for r in runs:
            d = pt_date(r.get("started_at") or "")
            if d is None or d == today or r.get("status") == "failed":
                continue
            per_day.setdefault(d, r)             # newest run of that night wins (rows come newest first)
        days = sorted(per_day, reverse=True)
        for layer in layers_now:
            streak = 1
            for d in days:
                unv = (per_day[d].get("inventory") or {}).get("unverified") or []
                if layer in [layer_of(u) for u in unv]:
                    streak += 1
                else:
                    break
            if streak >= 3:
                items.append("%s has not been checked for %d nights running." % (layer, streak))
    if needs_person is None:
        try:
            rows = db.get("security_findings?select=key,title,nights_open,autofix&status=eq.open&nights_open=gte.3&limit=100")
        except Exception:  # noqa: BLE001
            rows = []
        needs_person = [r for r in rows if (r.get("autofix") or {}).get("state") == "needs_person"]
    for r in needs_person:
        items.append("%s has waited on you for %d nights." % (r.get("title") or r.get("key"), r.get("nights_open") or 0))
    return items


def push_escalation(db, items, live):
    """One Ares-signed push for everything that has gone quiet; resolves itself when nothing is left."""
    if not live:
        return False
    if not items:
        resolve(db, "security.coverage", "Ares: no security blind spots are waiting on you")
        return False
    shown = items[:5]
    body = " ".join(shown) + ((" Plus %d more on the Security page." % (len(items) - 5)) if len(items) > 5 else "")
    return alert(db, "security.coverage", "Ares: %d security gap%s waiting on you" % (len(items), "" if len(items) == 1 else "s"),
                 body, "warning", "Open the Security page and clear or dismiss each one.")


# ----------------------------------------------------------------------------------------- orchestrator
class Ares(object):
    """Everything Ares 2.0 does in one run. All outside access (database, HTTP, git, clock) is injected so selftest can fake it."""

    def __init__(self, db, api, gh_token="", supa_token="", clone=clone_full, gitleaks=GITLEAKS_BIN, logf=print,
                 selftest_path=SELFTEST_STATE, main_repo="bestlytech", scan_gitleaks=True):
        self.db, self.api, self.token, self.supa_token, self.clone = db, api, gh_token or "", supa_token or "", clone
        self.gitleaks, self.log, self.selftest_path, self.main_repo = gitleaks, logf, selftest_path, main_repo
        self.scan_gitleaks = scan_gitleaks
        self.error = None
        self.enforced = []

    # ---- memory notes
    def memory(self, key):
        try:
            rows = self.db.get("bestly_memory?select=body&area=eq.%s&key=eq.%s&limit=1" % (MEM_AREA, urllib.parse.quote(key, safe="")))
            return rows[0].get("body") if rows else None
        except Exception:  # noqa: BLE001
            return None

    def load_lessons(self):
        body = self.memory(LESSONS_KEY)
        got = parse_lessons(body) if body else []
        have = set(l[0] for l in got)
        lessons = got + [l for l in BUILTIN_LESSONS if l[0] not in have]      # the code's own L1..L6 can never be edited away
        return lessons, bool(body)

    def traffic(self):
        """Legacy-key share of API calls over 24h from the project's edge logs, when the Management API will answer."""
        if not self.supa_token:
            return None
        end = datetime.now(timezone.utc)
        sql = ("select count(*) as total, countif(coalesce(ak.prefix,'') = '') as legacy from edge_logs el "
               "cross join unnest(el.metadata) as m cross join unnest(m.request) as r cross join unnest(r.sb) as sb "
               "cross join unnest(sb.apikey) as k cross join unnest(k.apikey) as ak")
        url = "https://api.supabase.com/v1/projects/%s/analytics/endpoints/logs.all?%s" % (
            BESTLY_REF, urllib.parse.urlencode({"sql": sql, "iso_timestamp_start": (end - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                                "iso_timestamp_end": end.strftime("%Y-%m-%dT%H:%M:%SZ")}))
        try:
            st, data = self.api("GET", url, {"Authorization": "Bearer " + self.supa_token}, None, 60, 1)
            rows = (data or {}).get("result") if isinstance(data, dict) else None
            if st == 200 and rows:
                return {"total": int(rows[0].get("total", 0)), "legacy": int(rows[0].get("legacy", 0)), "window_h": 24}
        except Exception:  # noqa: BLE001
            pass
        return None

    def fp_live(self, fps):
        try:
            res = self.db.rpc("security_fp_live", {"p_fps": list(fps)})
            return res if isinstance(res, dict) else {}
        except Exception as exc:  # noqa: BLE001
            self.log("ares: server-side fingerprint check unavailable (%s)" % str(exc)[:80])
            return None

    def persist(self, recs, states):
        rows = [{"fingerprint": r.fp, "type": r.type, "live": r.live} for r in recs if r.live is not None and r.label != ANON_LABEL]
        try:
            self.db.rpc("security_secret_liveness_put", {"p_rows": rows, "p_states": states})
            return True
        except Exception as exc:  # noqa: BLE001
            self.log("ares: liveness table not written (%s)" % str(exc)[:80])
            return False

    def run(self, checks, main_repo_path, tmp, unverified, inventory, live):
        """Adds Ares 2.0's checks to `checks`. Returns a dict of what ran (for the summary). Exceptions are the caller's to surface."""
        out = {"repos": 0, "secrets": 0, "live": 0, "persisted": False}

        def add_item(d):
            checks.extend([d])
        # ---- 8. lessons
        lessons, from_db = self.load_lessons()
        lc, lines = lessons_checks(lessons, read_selftest_state(self.selftest_path))
        checks.extend(lc)
        self.enforced = lines
        self.log("ares: rules enforced: " + "; ".join(lines))
        if not from_db:
            self.log("ares: bestly_memory %s/%s not found; using the built-in rules" % (MEM_AREA, LESSONS_KEY))
        # ---- 3. repo visibility
        gh = GitHub(self.token, self.api)
        repos, authed, err = gh.list_repos()
        body = self.memory(ALLOWLIST_KEY)
        allow = parse_allowlist(body) if body is not None else set(x.lower() for x in SEED_ALLOWLIST)
        if err and not repos:
            add_item(dict(key="repo:org:inventory", result="skip", layer=SECRET_LAYER, asset="github:%s" % ORG, check="repo_inventory",
                                 title="Not checked: could not list the %s repositories" % ORG, detail=err))
            repos = [{"name": self.main_repo, "private": None, "archived": False, "fork": False, "size_kb": 0, "visibility": "unknown"}]
            unverified.append("GitHub repo list (%s)" % ("token missing" if not self.token else "API error"))
        else:
            vis = [r for r in repos if r["private"] is not None]
            checks.extend(visibility_checks(vis, allow))
            add_item(dict(key="repo:org:inventory", result="pass", layer=SECRET_LAYER, asset="github:%s" % ORG, check="repo_inventory",
                                 evidence={"repos": len(repos), "authenticated": authed,
                                           "public": sorted(r["name"] for r in repos if not r["private"])}))
            if not authed:
                unverified.append("GitHub private repos (token missing)")
        inventory["repos"] = ["%s/%s" % (ORG, r["name"]) for r in repos]
        inventory["repos_public"] = sorted("%s/%s" % (ORG, r["name"]) for r in repos if r["private"] is False)
        out["repos"] = len(repos)
        # ---- 1. full-history scan of every repo
        found, engines, scanned, paths = {}, set(), {}, {}
        glv = gitleaks_version(self.gitleaks) if self.scan_gitleaks else None
        order = [r for r in repos if r["name"] == self.main_repo] + [r for r in repos if r["name"] != self.main_repo]
        if not any(r["name"] == self.main_repo for r in order):
            order.insert(0, {"name": self.main_repo, "private": None, "archived": False, "fork": False, "size_kb": 0})
        for r in order:
            name = r["name"]
            if r.get("size_kb", 0) > MAX_REPO_KB:
                add_item(dict(key="code:%s:secret_scan" % name, result="skip", layer=SECRET_LAYER, asset="github:%s/%s" % (ORG, name),
                                     check="secret_scan", title="Not scanned: %s/%s is too large to clone here" % (ORG, name),
                                     detail="%d MB; the limit is %d MB." % (r["size_kb"] // 1024, MAX_REPO_KB // 1024)))
                continue
            dest = main_repo_path if (name == self.main_repo and main_repo_path) else os.path.join(tmp, "ares-" + name)
            if dest != main_repo_path and not self.clone(name, dest, self.token):
                add_item(dict(key="code:%s:secret_scan" % name, result="skip", layer=SECRET_LAYER, asset="github:%s/%s" % (ORG, name),
                                     check="secret_scan", title="Not scanned: could not clone %s/%s" % (ORG, name),
                                     detail="git clone failed%s." % ("" if self.token else " (no GitHub token, so a private repo cannot be read)")))
                unverified.append("%s history (clone failed)" % name)
                continue
            _, commits, serr = scan_history(dest, name, found=found)
            engines.add("regex")
            if glv:
                n, gerr = run_gitleaks(dest, name, found, self.gitleaks)
                engines.add("gitleaks" if not gerr else "regex")
                if gerr:
                    self.log("ares: gitleaks on %s: %s" % (name, gerr))
            if serr:
                add_item(dict(key="code:%s:secret_scan" % name, result="skip", layer=SECRET_LAYER, asset="github:%s/%s" % (ORG, name),
                                     check="secret_scan", title="History scan of %s/%s was cut short" % (ORG, name), detail=serr))
            scanned[name] = {"commits": commits, "private": r.get("private")}
            paths[name] = dest
            out.setdefault("commits", 0)
            out["commits"] += commits
            self.log("ares: scanned %s: %d commits" % (name, commits))
        engine_note = "gitleaks+regex" if "gitleaks" in engines else "regex"
        add_item(dict(key="ares:gitleaks:available", layer="Security process", asset="Ares", check="gitleaks",
                             result="pass" if glv and "gitleaks" in engines else "yellow",
                             title=None if glv else "gitleaks is not installed on the Pi; the history scan is regex only",
                             detail=None if glv else "Install the static ARM64 binary (tools/security-audit/install_gitleaks.sh).",
                             evidence={"version": ".".join(str(x) for x in glv) if glv else None}))
        # ---- 2. liveness
        recs = assess(found, Prober(self.api), self.fp_live,
                      lambda fn: "https://%s.supabase.co/functions/v1/%s" % (BESTLY_REF, fn))
        out["secrets"] = len(recs)
        out["live"] = sum(1 for r in recs if r.live is True and r.label != ANON_LABEL)
        prior = {}
        try:
            for row in self.db.get("security_findings?select=key,severity&status=eq.open&key=like.code:*"):
                prior[row["key"]] = row
        except Exception:  # noqa: BLE001
            pass
        states = []
        for name, info in sorted(scanned.items()):
            vis = "public" if info["private"] is False else "private" if info["private"] else "of unknown visibility"
            cs, st = history_checks(name, recs, prior, engine_note, vis)
            checks.extend(cs)
            states.extend(st)
            if name in paths:
                names_private = dict((x["name"], x["private"]) for x in repos)

                def intended(target, names_private=names_private):
                    p = names_private.get(target)
                    return (p is True) or (p is None and ("%s/%s" % (ORG, target)).lower() not in allow) or \
                           (p is False and ("%s/%s" % (ORG, target)).lower() not in allow)
                add_item(consumers_check(name, scan_consumers(paths[name], intended), bool(info["private"])))
        out["persisted"] = self.persist(recs, states) if live else False
        # ---- 4. legacy keys
        legacy = [r for r in recs if r.type == "supabase_jwt" and r.ref in (None, BESTLY_REF) and r.label in ("supabase_service_role_key", ANON_LABEL)]
        accepted = None
        if legacy:
            tested = [r for r in legacy if r.live is not None]
            accepted = True if any(r.live for r in tested) else (False if tested else None)
        add_item(legacy_check(recs, accepted, self.traffic()))
        return out
