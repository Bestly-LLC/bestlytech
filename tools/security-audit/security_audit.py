#!/usr/bin/env python3
"""Nightly security audit -- Bestly Pi cron job.

Replaces the Claude scheduled task "Bestly - nightly security audit (1 AM PT)"
(trig_01HYfnxG2mTTdjo6hrZZKZaJ, ~18 minutes of Opus a night on mechanical checks).
Runs on bestly-pi, stdlib only, no AI at all.

Owner: Ares (Head of Security, slug security-auditor). security_run_finish() already
raises the alerts through the monitor pipeline under Ares's `security` prefix.

  run:      /opt/bestly/cron/run.sh security-audit
  by hand:  python3 /opt/bestly/cron/jobs/security_audit.py --dry
            python3 /opt/bestly/cron/jobs/security_audit.py --live --force

Order, exactly as the Claude task did it:
  1. inventory (Vercel + Supabase APIs; last night's inventory when a token is missing)
  2. security_run_start
  3. scripts/security-audit/web_checks.py (reused unchanged, run as a subprocess)
  4. platform checks
  5. ONE batched write of every check, passes included (security_checks_record, falling
     back to one security_check call per check if that RPC is not installed yet)
  6. fingerprints saved onto the run's inventory
  7. security_run_finish  (ok=false if anything above broke, so the admin shows
     "Last run failed" instead of silence)

Safety rails, in order of importance:
  * READ-ONLY toward everything it audits. Only GETs go to Vercel / Supabase Management / the
    sites. Env var VALUES are discarded the moment they arrive and are never requested decrypted.
  * A check that did not run is recorded as `skip`, never `pass` (a pass would close a real finding).
    A missing or rejected token skips the checks that need it and still lets the run succeed.
  * No credential is printed, logged, or written to disk. Tokens live in Vault.
  * web_checks.py runs with a scrubbed environment (no Supabase key, no tokens).
  * Default mode is DRY until state.json says {"mode": "live"}: dry runs everything, writes nothing.
  * A second scheduled run inside 6 hours is refused (nights_open would double count).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

JOB = "security-audit"
OWNER = "Ares (security)"

TEAM_ID = "team_Kwxz5PIgolwApAnbC131PCDd"
VERCEL_API = "https://api.vercel.com"
SUPABASE_API = "https://api.supabase.com"
BESTLY_REF = "rcqfqhguwpmaarseifqg"
REPO_URL = "https://github.com/Bestly-LLC/bestlytech.git"
REPO_NAME = "bestlytech"

VERCEL_SERVICE, VERCEL_ACCOUNT = "vercel", "api_token"                 # Vault pi:vercel:api_token
SUPABASE_SERVICE, SUPABASE_ACCOUNT = "supabase", "management_token"    # Vault pi:supabase:management_token
VERCEL_VAULT_NAME = "pi:vercel:api_token"
SUPABASE_VAULT_NAME = "pi:supabase:management_token"

EXTRA_HOSTS = ["cloud.bestly.tech"]          # not on Vercel, still audited
NON_VERCEL_HOSTS = {"cloud.bestly.tech"}     # no defacement/deploy comparison for these
MAIL_DOMAINS = ["bestly.tech", "hoku-clean.com"]
FALLBACK_HOSTS = ["bestly.tech", "www.bestly.tech", "studio.bestly.tech", "cloud.bestly.tech"]
EXPECTED_SUPABASE = ["Bestly", "schoolpilot", "Vesta"]
BLANKET_LINTS = {"anon_security_definer_function_executable",
                 "authenticated_security_definer_function_executable"}

STATE_PATH = "/opt/bestly/cron/state/security_audit.json"
WEB_CHECKS = os.environ.get("SECURITY_AUDIT_WEB_CHECKS",
                            "/opt/bestly/cron/jobs/security_audit_web_checks.py")
ENV_FILE = "/home/pi/scripts/.env"
WEB_TIMEOUT_S = 25 * 60
DUP_GUARD_HOURS = 6
DEPLOY_WINDOW_HOURS = 26

DEFAULT_STATE = {"mode": "dry", "last_run": None, "last_summary": None, "log": []}

CLIENT_ENV_PREFIXES = ("VITE_", "NEXT_PUBLIC_")
SECRETISH = re.compile(r"SERVICE|SECRET|PRIVATE|PASSWORD")


class ApiError(Exception):
    """A network or HTTP failure. Message never contains a credential."""


class TokenProblem(Exception):
    """The token was refused (401/403 on the first call)."""


# ---------------------------------------------------------------- utilities

def log(msg):
    print("[%s] %s" % (datetime.now().strftime("%Y-%m-%d %I:%M:%S %p"), msg), flush=True)


def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        state = {}
    merged = dict(DEFAULT_STATE)
    merged.update(state)
    return merged


def save_state(state):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    state["log"] = state.get("log", [])[-30:]
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, sort_keys=True)
    os.replace(tmp, STATE_PATH)


def _env_file_value(name):
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("export "):
                    line = line[7:]
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def env(name):
    return (os.environ.get(name) or _env_file_value(name) or "").strip()


def plural(n, one, many=None):
    return "%d %s" % (n, one if n == 1 else (many or one + "s"))


# ---------------------------------------------------------------------- http

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: it would carry our Authorization header along."""

    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def http_json(method, url, headers=None, body=None, timeout=60, tries=1):
    """Returns (status, parsed json or None). HTTP errors are returned, not raised.
    Network failures raise ApiError. GETs retry on 429 / 5xx / network errors."""
    last = "network error"
    for attempt in range(tries):
        if attempt:
            time.sleep(3 * attempt)
        req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        try:
            with _OPENER.open(req, timeout=timeout) as resp:
                status, raw = resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            try:
                raw = exc.read() or b""
            except Exception:  # noqa: BLE001
                raw = b""
            status = exc.code
        except (urllib.error.URLError, OSError) as exc:
            last = "network error (%s)" % type(exc).__name__
            continue
        if status == 429 or status >= 500:
            last = "HTTP %d" % status
            if attempt + 1 < tries:
                continue
        try:
            return status, (json.loads(raw.decode("utf-8")) if raw else None)
        except ValueError:
            return status, None
    raise ApiError("%s %s: %s" % (method, urllib.parse.urlsplit(url).netloc, last))


# ------------------------------------------------------------------ database

class Db:
    """Supabase PostgREST as the service role. Never logs the key."""

    def __init__(self, url, key, api=http_json):
        self.url, self.key, self.api = url.rstrip("/"), key, api

    def _headers(self, extra=None):
        # New-style keys (sb_secret_...) go on `apikey` alone; legacy JWTs also go as Bearer.
        h = {"apikey": self.key, "Content-Type": "application/json"}
        if not self.key.startswith("sb_"):
            h["Authorization"] = "Bearer " + self.key
        h.update(extra or {})
        return h

    def rpc(self, fn, payload=None):
        status, data = self.api("POST", "%s/rest/v1/rpc/%s" % (self.url, fn), self._headers(),
                                json.dumps(payload or {}).encode(), 120, 1)
        if status not in (200, 201, 204):
            raise ApiError("rpc %s: HTTP %d %s" % (fn, status, _brief(data)))
        return data

    def get(self, path):
        status, data = self.api("GET", "%s/rest/v1/%s" % (self.url, path), self._headers(),
                                None, 60, 3)
        if status != 200:
            raise ApiError("GET %s: HTTP %d %s" % (path.split("?")[0], status, _brief(data)))
        return data

    def patch(self, path, body):
        status, data = self.api("PATCH", "%s/rest/v1/%s" % (self.url, path),
                                self._headers({"Prefer": "return=minimal"}),
                                json.dumps(body).encode(), 60, 1)
        if status not in (200, 204):
            raise ApiError("PATCH %s: HTTP %d %s" % (path.split("?")[0], status, _brief(data)))


def _brief(data):
    if isinstance(data, dict):
        return str(data.get("message") or data.get("error") or data.get("code") or "")[:160]
    return ""


# ------------------------------------------------------------------- secrets

def vault_shim(service, account):
    """/opt/bestly/bin/security reads Vault `pi:<service>:<account>` (never printed)."""
    try:
        out = subprocess.run(
            ["/opt/bestly/bin/security", "find-generic-password", "-a", account, "-s", service, "-w"],
            capture_output=True, text=True, timeout=30)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return ""


def vault_rpc(db, name):
    """Fallback: service-role RPC pi_secret_get (Vault names starting `pi:`)."""
    try:
        value = db.rpc("pi_secret_get", {"p_name": name})
    except ApiError:
        return ""
    return value.strip() if isinstance(value, str) and value.strip() else ""


def get_token(db, service, account, vault_name):
    return vault_shim(service, account) or (vault_rpc(db, vault_name) if db else "")


# ----------------------------------------------------------- check collector

class Checks:
    def __init__(self):
        self.items = []

    def add(self, key, result, layer, asset, check, title=None, detail=None, fix=None, evidence=None):
        assert result in ("pass", "red", "yellow", "skip"), result
        self.items.append(dict(key=key, result=result, layer=layer, asset=asset, check=check,
                               title=title, detail=detail, fix=fix, evidence=evidence or {}))

    def extend(self, items):
        for it in items:
            self.add(it["key"], it["result"], it["layer"], it["asset"], it["check"],
                     it.get("title"), it.get("detail"), it.get("fix"), it.get("evidence"))

    def count(self, result):
        return sum(1 for c in self.items if c["result"] == result)


def skip_missing_token(checks, which, key, layer, asset, check, not_run):
    """One skip per missing token, not one per check: security_check turns every skip into a yellow
    `<key>:unreachable` finding, and a dozen of those would page Ares's Auto-Fixer for nothing.
    The key is a real key, so it closes by itself the first night the check runs for real."""
    token = {"vercel": ("the Vercel API token", VERCEL_VAULT_NAME),
             "supabase": ("the Supabase Management API token", SUPABASE_VAULT_NAME)}[which]
    checks.add(key, "skip", layer, asset, check,
               "Not checked: %s is missing" % token[0],
               "These checks did not run tonight because %s is not saved. Not run: %s. "
               "No finding was closed or changed by this." % (token[0], "; ".join(not_run)),
               "Paste it on bestly.tech/admin/security (Audit tokens card). It is stored in Vault as %s." % token[1],
               {"reason": "token_missing", "token": token[1], "not_run": not_run})


# ----------------------------------------------------------------- Vercel

class Vercel:
    def __init__(self, token, api=http_json):
        self.token, self.api = token, api

    def get(self, path, **params):
        params.setdefault("teamId", TEAM_ID)
        url = "%s%s?%s" % (VERCEL_API, path, urllib.parse.urlencode(params))
        time.sleep(0.05)
        return self.api("GET", url, {"Authorization": "Bearer " + self.token}, None, 60, 3)

    def paged(self, path, key, limit=100, max_pages=10, **params):
        """Collect `key` (or a bare list) across pages; pagination.next is the `until` timestamp."""
        out, until = [], None
        for _ in range(max_pages):
            q = dict(params, limit=limit)
            if until:
                q["until"] = until
            status, data = self.get(path, **q)
            if status in (401, 403):
                raise TokenProblem("HTTP %d" % status)
            if status != 200:
                raise ApiError("Vercel %s: HTTP %d" % (path, status))
            rows = data if isinstance(data, list) else (data or {}).get(key, [])
            out.extend(rows)
            nxt = ((data or {}).get("pagination") or {}).get("next") if isinstance(data, dict) else None
            if not nxt or not rows:
                break
            until = nxt
        return out


def apex_of(host):
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def is_vercel_app(host):
    return host.endswith(".vercel.app")


def pick_hosts(domains, has_prod):
    """Claude's rule: custom domains; the production *.vercel.app URL only for projects with no custom
    domain that have a production deployment."""
    custom = [d for d in domains if not is_vercel_app(d)]
    if custom:
        return custom
    return [d for d in domains if is_vercel_app(d)][:1] if has_prod else []


def project_has_prod(p):
    targets = p.get("targets") or {}
    if isinstance(targets, dict) and targets.get("production"):
        return True
    return any((d or {}).get("target") == "production" for d in (p.get("latestDeployments") or []))


def gather_vercel(vc):
    """Returns inventory dict. Raises TokenProblem / ApiError."""
    projects = vc.paged("/v10/projects", "projects")
    inv_projects, hosts, apexes = [], [], []
    for p in projects:
        domains, apex_map = [], {}
        status, data = vc.get("/v9/projects/%s/domains" % urllib.parse.quote(p["id"]), limit=100)
        if status == 200:
            for d in (data or {}).get("domains", []):
                if d.get("name"):
                    domains.append(d["name"])
                    apex_map[d["name"]] = d.get("apexName") or apex_of(d["name"])
        elif status in (401, 403):
            raise TokenProblem("HTTP %d" % status)
        has_prod = project_has_prod(p)
        chosen = pick_hosts(domains, has_prod)
        for h in chosen:
            if h not in hosts:
                hosts.append(h)
            if not is_vercel_app(h) and apex_map.get(h, apex_of(h)) not in apexes:
                apexes.append(apex_map.get(h, apex_of(h)))
        inv_projects.append({"name": p["name"], "id": p["id"], "sso": bool(p.get("ssoProtection")),
                             "domains": chosen, "has_prod": has_prod})
    members = None
    status, data = vc.get("/v3/teams/%s/members" % TEAM_ID, limit=100)
    if status == 200:
        members = len((data or {}).get("members", []))
    elif status in (401, 403):
        members = None
    return {"projects": inv_projects, "hosts": hosts, "apexes": apexes, "members": members,
            "members_status": status}


def vercel_preview_check(p):
    key = "vercel:%s:preview_protection" % p["name"]
    if p["sso"]:
        return dict(key=key, result="pass", layer="Vercel", asset="Vercel %s" % p["name"], check="deployment_protection")
    return dict(key=key, result="yellow", layer="Vercel", asset="Vercel %s" % p["name"],
                check="deployment_protection",
                title="%s: preview deployments are open to anyone with the URL" % p["name"],
                detail="ssoProtection is not set on this project.",
                fix="Vercel > %s > Settings > Deployment Protection: Vercel Authentication, All except custom domains" % p["name"],
                evidence={"ssoProtection": "disabled"})


def vercel_members_check(n):
    base = dict(key="vercel:team:members", layer="Hosting (Vercel)", asset="Bestly team", check="team_members")
    if n == 1:
        return dict(base, result="pass")
    return dict(base, result="red", title="The Vercel team has %d members (expected exactly 1)" % n,
                detail="Someone was added to the Bestly Vercel team. They can deploy and read project settings.",
                fix="Vercel > Team Settings > Members: remove anyone who should not be there, then rotate tokens they could have seen.",
                evidence={"members": n})


def flagged_env_names(keys):
    return sorted({k for k in keys if k.startswith(CLIENT_ENV_PREFIXES) and SECRETISH.search(k)})


def vercel_env_check(project, keys):
    key = "vercel:%s:client_secret_env" % project
    bad = flagged_env_names(keys)
    base = dict(key=key, layer="Hosting (Vercel)", asset="Vercel %s" % project, check="client_secret_env")
    if not bad:
        return dict(base, result="pass")
    return dict(base, result="red",
                title="%s: a browser-exposed env var looks like a secret (%s)" % (project, ", ".join(bad)),
                detail="Names starting VITE_ or NEXT_PUBLIC_ are shipped to every visitor's browser. Values were never requested or read.",
                fix="Remove %s from the project's Environment Variables, rotate the credential, and read it server-side instead." % ", ".join(bad),
                evidence={"names": bad})


FP_ALGO = 2     # must match scripts/security-audit/web_checks.py; older hashes are re-baselined silently


def fingerprint_step(host, prev, cur, monitored):
    """Decide what tonight's homepage fingerprint means. Returns (stored_fp, status).

    stored_fp is what goes into inventory.fingerprints (baseline in text_sha256, a not-yet-confirmed
    change in pending_sha256). status is one of:
      None        host not fetched tonight (fetch error): keep last baseline, no verdict
      unchecked   non-200 / empty body: keep last baseline, no verdict, no hash update
      redirect    host redirects to another monitored host: no baseline of its own, no verdict
      baseline    nothing to compare against yet (first run, or hash algorithm changed)
      same        unchanged (any pending change is dropped)
      pending     changed once; needs the same new hash on the next run before it counts
      changed     the same new hash on 2 consecutive runs: a real change
    """
    prev = prev or {}
    keep = {k: prev[k] for k in ("title", "status", "text_sha256", "algo", "pending_sha256", "final_host") if k in prev}
    if cur is None:
        return keep, None
    final = (cur.get("final_host") or "").lower()
    if final and final != host and final in monitored:
        return {"title": cur.get("title", ""), "status": cur.get("status"), "text_sha256": None,
                "algo": FP_ALGO, "final_host": final, "redirect_to": final}, "redirect"
    sha = cur.get("text_sha256")
    if sha is None or cur.get("status") != 200:
        keep["last_unchecked"] = cur.get("unchecked") or "http %s" % cur.get("status")
        return keep, "unchecked"
    new = {"title": cur.get("title", ""), "status": 200, "text_sha256": sha, "algo": FP_ALGO, "final_host": final}
    base = prev.get("text_sha256") if prev.get("algo") == FP_ALGO else None
    if base is None:
        return new, "baseline"
    if sha == base:
        return new, "same"
    if prev.get("pending_sha256") == sha:
        return new, "changed"                       # baseline moves to the confirmed hash
    new["text_sha256"] = base                       # hold the old baseline until confirmed
    new["pending_sha256"] = sha
    new["title"] = prev.get("title", new["title"])
    return new, "pending"


def content_check(host, cur_sha, prev_sha, deployed):
    """deployed: True / False / None (unknown). Returns a check dict or None (nothing to compare)."""
    key = "web:%s:content_changed" % host
    base = dict(key=key, layer="Websites", asset=host, check="content_changed")
    if deployed is None:
        return dict(base, result="skip", detail="Could not tell whether a production deployment happened.")
    if prev_sha is None or cur_sha == prev_sha:
        return dict(base, result="pass")
    if deployed:
        return dict(base, result="pass", evidence={"changed": True, "explained_by": "production deployment"})
    return dict(base, result="yellow", title="%s: homepage text changed with no deploy" % host,
                detail="The visible text of the homepage is different from last night and no production deployment happened in the last %d hours. "
                       "An instant rollback also looks like this." % DEPLOY_WINDOW_HOURS,
                fix="Open %s and read the page. If you did not change it, check Vercel > project > Deployments and the DNS records for the host." % host,
                evidence={"previous_sha256": prev_sha, "current_sha256": cur_sha})


# --------------------------------------------------------- Supabase advisors

def supa_name(ref, name):
    return "Bestly" if ref == BESTLY_REF else name


def advisor_checks(project, lints, prior_open_keys):
    """Pure. Maps one project's security lints onto the audit's keys."""
    p = project
    out = []
    asset = p
    errors = {}
    for l in lints:
        name = l.get("name")
        if str(l.get("level", "")).upper() != "ERROR" or name in BLANKET_LINTS:
            continue
        md = l.get("metadata") or {}
        obj = ".".join(x for x in (md.get("schema"), md.get("name")) if x) or md.get("name") or ""
        errors.setdefault(name, {"title": l.get("title") or name, "remediation": l.get("remediation"),
                                 "objects": [], "schemas": []})
        if obj:
            errors[name]["objects"].append(obj)
    for name, e in sorted(errors.items()):
        objs = sorted(set(e["objects"]))
        shown = ", ".join(objs[:5]) + (" +%d more" % (len(objs) - 5) if len(objs) > 5 else "")
        if name == "security_definer_view" and objs:
            fix = "\n".join("alter view %s set (security_invoker = true);" % o for o in objs[:10])
        else:
            fix = "See %s" % e["remediation"] if e["remediation"] else "See the Supabase advisor for lint %s." % name
        out.append(dict(key="supa:%s:advisor:%s" % (p, name), result="red", layer="Database (Supabase)", asset=asset,
                        check="advisor", title="%s: %s%s" % (p, e["title"], " (%s)" % shown if shown else ""),
                        detail="Supabase security advisor, level ERROR, lint %s." % name, fix=fix,
                        evidence={"lint": name, "level": "ERROR", "objects": objs[:50]}))
    # pass, so a finding recorded before closes once its lint is gone
    named = {"leaked_password_protection", "function_search_path", "scan"}
    for key in sorted(prior_open_keys):
        lint = key.rsplit(":", 1)[-1]
        if key.startswith("supa:%s:advisor:" % p) and lint not in errors and lint not in named \
                and not key.endswith(":unreachable"):
            out.append(dict(key=key, result="pass", layer="Database (Supabase)", asset=asset, check="advisor"))

    leaked = [l for l in lints if l.get("name") == "auth_leaked_password_protection"]
    k = "supa:%s:advisor:leaked_password_protection" % p
    if leaked:
        out.append(dict(key=k, result="yellow", layer="Database (Supabase)", asset=asset, check="advisor",
                        title="%s: leaked password protection is off" % p,
                        detail="Supabase advisor lint auth_leaked_password_protection.",
                        fix='Supabase > %s > Authentication > Policies: turn on "Leaked password protection".' % p,
                        evidence={"lint": "auth_leaked_password_protection", "level": leaked[0].get("level")}))
    else:
        out.append(dict(key=k, result="pass", layer="Database (Supabase)", asset=asset, check="advisor"))

    sp = [l for l in lints if l.get("name") == "function_search_path_mutable"]
    k = "supa:%s:advisor:function_search_path" % p
    if sp:
        names = sorted({(l.get("metadata") or {}).get("name") or "?" for l in sp})
        out.append(dict(key=k, result="yellow", layer="Database (Supabase)", asset=asset, check="advisor",
                        title="%d functions on %s have a role-mutable search_path" % (len(names), p),
                        detail="Supabase advisor lint function_search_path_mutable.",
                        fix="For each: alter function public.<name>(...) set search_path = public, pg_temp;",
                        evidence={"count": len(names), "functions": names[:50]}))
    else:
        out.append(dict(key=k, result="pass", layer="Database (Supabase)", asset=asset, check="advisor"))
    out.append(dict(key="supa:%s:advisor:scan" % p, result="pass", layer="Database (Supabase)", asset=asset, check="advisor",
                    evidence={"lints": len(lints)}))
    return out


# ------------------------------------------------------- database-side checks

def admin_check(n):
    base = dict(key="supa:Bestly:staff:admins", layer="Database (Supabase)", asset="Bestly", check="staff_admins")
    if n == 1:
        return dict(base, result="pass")
    if n > 1:
        return dict(base, result="red", title="%d admin accounts (expected 1)" % n,
                    detail="user_roles has more than one admin. A new admin nobody logged can read and change everything in the admin.",
                    fix="select user_id, created_at from user_roles where role = 'admin'; then remove the one you do not recognise.",
                    evidence={"admins": n})
    return dict(base, result="yellow", title="No admin account found in user_roles",
                detail="Expected exactly 1 admin and found none.", evidence={"admins": n})


def writer_checks(writers, prior_open_keys):
    """writers: [{function, args}] from security_audit_facts(). bestly_mail_* roll into one key."""
    out, flagged = [], set()
    mail = [w for w in writers if w["function"].startswith("bestly_mail_")]
    other = [w for w in writers if not w["function"].startswith("bestly_mail_")]
    mk = "supa:Bestly:rpc:mail_functions_anon"
    if mail:
        names = sorted(w["function"] for w in mail)
        out.append(dict(key=mk, result="yellow", layer="Database (Supabase)", asset="Bestly", check="anon_rpc",
                        title="%s mailbox functions can be called without logging in" % len(names),
                        detail="SECURITY DEFINER writers with no auth check that anon can execute: %s." % ", ".join(names),
                        fix="revoke execute on function %s from public, anon;" % ", ".join(
                            "public.%s(%s)" % (w["function"], w.get("args", "")) for w in mail),
                        evidence={"functions": names}))
    else:
        out.append(dict(key=mk, result="pass", layer="Database (Supabase)", asset="Bestly", check="anon_rpc"))
    for w in other:
        fn = w["function"]
        flagged.add(fn)
        out.append(dict(key="supa:Bestly:rpc:anon_writer:%s" % fn, result="yellow", layer="Database (Supabase)",
                        asset="Bestly", check="anon_rpc",
                        title="%s() is a SECURITY DEFINER writer callable by anon" % fn,
                        detail="Callable with the public key, writes to a table, and its body has no auth check "
                               "(auth.uid, auth.role, has_role, team_is_admin, is_admin, token, key, staff, current_setting).",
                        fix="revoke execute on function public.%s(%s) from public, anon; -- PUBLIC too: revoking anon alone leaves it callable. "
                            "Or add a token / auth.uid() check inside the function." % (fn, w.get("args", "")),
                        evidence={"function": fn, "args": w.get("args", ""), "anon_execute": True,
                                  "security_definer": True, "writes": True, "auth_check": False}))
    for key in sorted(prior_open_keys):
        if key.startswith("supa:Bestly:rpc:anon_writer:") and key.rsplit(":", 1)[-1] not in flagged \
                and not key.endswith(":unreachable"):
            out.append(dict(key=key, result="pass", layer="Database (Supabase)", asset="Bestly", check="anon_rpc"))
    return out


def cron_health_check(h):
    key = "ops:supabase:cron_startup"
    base = dict(key=key, layer="Database (Supabase)", asset="Bestly", check="cron_health")
    pct = float(h.get("pct_failed") or 0)
    ev = {k: h.get(k) for k in ("runs", "failed", "pct_failed", "worst_hour", "worst_jobs", "window_hours")}
    if pct == 0:
        return dict(base, result="pass", evidence=ev)
    wh = h.get("worst_hour") or {}
    jobs = ", ".join("%s (%s)" % (j.get("jobname"), j.get("failed")) for j in (h.get("worst_jobs") or [])[:5])
    detail = ("%s of %s scheduled runs failed to start in the last %sh. Worst hour %s at %s%% (%s of %s). Hardest hit: %s. "
              "Work that silently did not happen: outbound email, monitors and watchdogs that run as database schedules."
              % (h.get("failed"), h.get("runs"), h.get("window_hours", 24), wh.get("hour"), wh.get("pct"),
                 wh.get("failed"), wh.get("runs"), jobs or "n/a"))
    fix = ("Jobs run 13-30x slower under load and hold their worker; max_worker_processes is only 6, so the next wave "
           "cannot start. Spread the schedule further, slow the chattiest jobs, or raise compute.")
    if pct > 2:
        return dict(base, result="red", title="%s%% of scheduled jobs did not start in the last %sh" % (pct, h.get("window_hours", 24)),
                    detail=detail, fix=fix, evidence=ev)
    return dict(base, result="yellow", title="Some scheduled jobs did not start", detail=detail, fix=fix, evidence=ev)


RESOLVED_RE = re.compile(r"^\s*(?:status\s*:\s*)?resolved\b", re.I | re.M)


def eldora_check(body, title):
    key = "dns:eldoraluxe.com:ownership"
    base = dict(key=key, layer="DNS / email", asset="eldoraluxe.com", check="ownership")
    if RESOLVED_RE.search(body or "") or re.search(r"\bresolved\b", title or "", re.I):
        return dict(base, result="pass")
    return dict(base, result="yellow",
                title="El Dora domain sits in Rohit's GoDaddy account, no auto-renew",
                detail="eldoraluxe.com is registered in a third party's registrar account and expires July 2027 without auto-renew. "
                       "Bestly only has delegated access, which can be revoked.",
                fix="Get the domain transferred to Bestly (preferred), or at minimum turn on auto-renew. Route is Jared to Eli to Rohit. "
                    "To close this, add a line starting with RESOLVED to bestly_memory eldora/domain-risk once it has moved.")


# ---------------------------------------------------------------- web checks

def run_web_checks(hosts, apexes, mail_domains, repo_path, timeout=WEB_TIMEOUT_S):
    """Runs the existing scripts/security-audit/web_checks.py UNCHANGED. Returns (items, error)."""
    if not os.path.exists(WEB_CHECKS):
        return [], "web_checks.py is not installed at %s (run install.sh)" % WEB_CHECKS
    cmd = [sys.executable, WEB_CHECKS, "--hosts"] + hosts + ["--apex"] + apexes + \
          ["--mail-domains"] + mail_domains + ["--repo", "%s=%s" % (repo_path, REPO_NAME)]
    # Scrubbed environment: this child talks to the public internet and never needs a key.
    clean = {k: v for k, v in os.environ.items()
             if k in ("PATH", "HOME", "LANG", "LC_ALL", "TZ", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
                      "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE")}
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=clean)
    except subprocess.TimeoutExpired:
        return [], "web_checks.py timed out after %d minutes" % (timeout // 60)
    except OSError as exc:
        return [], "web_checks.py could not start (%s)" % type(exc).__name__
    if res.returncode != 0:
        last = (res.stderr.strip().splitlines() or ["no error text"])[-1][:200]
        return [], "web_checks.py exited %d: %s" % (res.returncode, last)
    try:
        items = json.loads(res.stdout)
    except ValueError:
        return [], "web_checks.py printed output that is not JSON"
    if not isinstance(items, list):
        return [], "web_checks.py output was not a list"
    return items, None


def split_web_items(items):
    """-> (checks, fingerprints). `info` items are not checks; fingerprint:<host> feeds the inventory."""
    checks, fps = [], {}
    for it in items:
        if it.get("result") == "info":
            if str(it.get("key", "")).startswith("fingerprint:"):
                ev = it.get("evidence") or {}
                fps[it["key"].split(":", 1)[1]] = {"title": ev.get("title", ""), "status": ev.get("status"),
                                                   "text_sha256": ev.get("text_sha256"), "algo": ev.get("algo"),
                                                   "final_host": ev.get("final_host"), "unchecked": ev.get("unchecked")}
            continue
        if it.get("result") in ("pass", "red", "yellow", "skip"):
            checks.append(it)
    return checks, fps


def clone_repo(dest):
    try:
        res = subprocess.run(["git", "clone", "--depth", "1", "--quiet", REPO_URL, dest],
                             capture_output=True, text=True, timeout=300,
                             env={"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", ""),
                                  "GIT_TERMINAL_PROMPT": "0"})
        return res.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


# ------------------------------------------------------------------- the run

class Ctx:
    """Everything the run touches from outside, so selftest can swap it for fakes."""

    def __init__(self, db, vercel_token="", supa_token="", api=http_json, web=run_web_checks,
                 clone=clone_repo, now=None):
        self.db, self.vercel_token, self.supa_token = db, vercel_token, supa_token
        self.api, self.web, self.clone = api, web, clone
        self.now = now or datetime.now(timezone.utc)


def record_checks(db, run, items):
    """ONE batched write. Returns {'opened': n, 'fixed': n, ...}. Falls back to one security_check
    call per check when security_checks_record is not installed (migration not applied yet)."""
    payload = [{k: c.get(k) for k in ("key", "result", "layer", "asset", "check", "title", "detail", "fix")}
               | {"evidence": c.get("evidence") or {}} for c in items]
    try:
        res = db.rpc("security_checks_record", {"p_run": run, "p_checks": payload})
        if isinstance(res, dict) and "outcomes" in res:
            if res.get("errors"):
                log("batch write: %d checks raised and were not recorded: %s"
                    % (len(res["errors"]), "; ".join(res["errors"][:3])))
            return res["outcomes"], res.get("errors") or []
    except ApiError as exc:
        log("security_checks_record unavailable (%s); writing one check at a time" % exc)
    outcomes, errors = {}, []
    for c in payload:
        try:
            out = db.rpc("security_check", {
                "p_run": run, "p_key": c["key"], "p_result": c["result"], "p_layer": c["layer"],
                "p_asset": c["asset"], "p_check": c["check"], "p_title": c["title"], "p_detail": c["detail"],
                "p_fix": c["fix"], "p_evidence": c["evidence"]})
            outcomes[str(out)] = outcomes.get(str(out), 0) + 1
        except ApiError as exc:
            errors.append("%s: %s" % (c["key"], exc))
    return outcomes, errors


def previous_inventory(db):
    """Newest run that has an inventory with hosts (carried forward when a token is missing)."""
    try:
        rows = db.get("security_audit_runs?select=started_at,inventory&order=started_at.desc&limit=6")
    except ApiError:
        return {}, {}
    inv, fps = {}, {}
    for r in rows:
        i = r.get("inventory") or {}
        if not inv and i.get("hosts"):
            inv = i
        if not fps and i.get("fingerprints"):
            fps = i["fingerprints"]
    return inv, fps


def open_keys(db, prefix):
    try:
        rows = db.get("security_findings?select=key&status=eq.open&key=like.%s" % urllib.parse.quote(prefix + "*"))
        return [r["key"] for r in rows]
    except ApiError:
        return []


def duplicate_run(db, now):
    try:
        rows = db.get("security_audit_runs?select=started_at,status,trigger&trigger=eq.scheduled&order=started_at.desc&limit=3")
    except ApiError:
        return None
    for r in rows:
        if r.get("status") == "failed":
            continue
        try:
            t = datetime.fromisoformat(r["started_at"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if now - t < timedelta(hours=DUP_GUARD_HOURS):
            return t
    return None


def token_state(db, which, status, note=""):
    try:
        db.rpc("security_token_state_put", {"p_which": which, "p_status": status, "p_note": note[:200]})
    except ApiError:
        pass  # migration not applied yet; the card just shows "unknown"


def build_summary(checks, outcomes, red_titles, open_yellow, unverified, web_error):
    new = outcomes.get("opened", 0) + outcomes.get("reopened", 0)
    fixed = outcomes.get("fixed", 0)
    if red_titles:
        head = "%s open: %s" % (plural(len(red_titles), "red problem"), "; ".join(t[:70] for t in red_titles[:3]))
    else:
        head = "No red findings"
    s = "%s, %s open." % (head, plural(open_yellow, "yellow finding"))
    s += " Since last night: %d new, %d fixed." % (new, fixed)
    if unverified:
        s += " Not checked: %s." % ", ".join(unverified)
    if web_error:
        s += " Website checks did not run: %s." % web_error
    return s[:900]


def run_audit(ctx, args, live, state):
    db = ctx.db
    now = ctx.now
    checks = Checks()
    unverified, problems = [], []

    if live and not args.force:
        t = duplicate_run(db, now)
        if t:
            return "skip: a scheduled audit already started at %s (use --force to run again)" % \
                   t.astimezone().strftime("%I:%M %p").lstrip("0")

    prev_inv, prev_fps = previous_inventory(db)

    # ---- STEP 1: inventory ------------------------------------------------
    vinv = None
    vercel_ok = False
    if ctx.vercel_token:
        try:
            vinv = gather_vercel(Vercel(ctx.vercel_token, ctx.api))
            vercel_ok = True
            token_state(db, "vercel", "ok") if live else None
        except TokenProblem as exc:
            token_state(db, "vercel", "rejected", "Vercel refused the token (%s)" % exc) if live else None
            unverified.append("Vercel (token rejected)")
        except ApiError as exc:
            problems.append("Vercel inventory: %s" % exc)
            unverified.append("Vercel (API error)")
    else:
        token_state(db, "vercel", "missing") if live else None
        unverified.append("Vercel (token missing)")

    sinv = None
    if ctx.supa_token:
        try:
            status, data = ctx.api("GET", SUPABASE_API + "/v1/projects",
                                   {"Authorization": "Bearer " + ctx.supa_token}, None, 60, 3)
            if status in (401, 403):
                raise TokenProblem("HTTP %d" % status)
            if status != 200 or not isinstance(data, list):
                raise ApiError("Supabase project list: HTTP %d" % status)
            sinv = [{"ref": p["ref"], "name": supa_name(p["ref"], p["name"])} for p in data
                    if p.get("status") != "INACTIVE" or p["ref"] == BESTLY_REF]
            token_state(db, "supabase", "ok") if live else None
        except TokenProblem as exc:
            token_state(db, "supabase", "rejected", "Supabase refused the token (%s)" % exc) if live else None
            unverified.append("Supabase advisors (token rejected)")
        except ApiError as exc:
            problems.append("Supabase inventory: %s" % exc)
            unverified.append("Supabase advisors (API error)")
    else:
        token_state(db, "supabase", "missing") if live else None
        unverified.append("Supabase advisors (token missing)")

    if vercel_ok:
        hosts = list(vinv["hosts"])
        apexes = list(vinv["apexes"])
    else:
        hosts = [h for h in (prev_inv.get("hosts") or FALLBACK_HOSTS) if h not in EXTRA_HOSTS]
        apexes = sorted({apex_of(h) for h in hosts if not is_vercel_app(h)})
    for h in EXTRA_HOSTS:
        if h not in hosts:
            hosts.append(h)
    if "bestly.tech" not in apexes:
        apexes.insert(0, "bestly.tech")

    inventory = {
        "runner": "pi",
        "hosts": hosts,
        "repos": ["Bestly-LLC/%s" % REPO_NAME],
        "vercel_projects": [{"name": p["name"], "sso": p["sso"], "domains": p["domains"]} for p in vinv["projects"]]
                           if vercel_ok else prev_inv.get("vercel_projects", []),
        "supabase_projects": [p["name"] for p in sinv] if sinv else prev_inv.get("supabase_projects", EXPECTED_SUPABASE),
        "vercel_team_members": (vinv or {}).get("members") if vercel_ok else prev_inv.get("vercel_team_members"),
        "unverified": unverified,
    }
    if not vercel_ok:
        inventory["vercel_carried_forward"] = True
    if sinv is not None:
        extra = sorted(set(p["name"] for p in sinv) - set(EXPECTED_SUPABASE))
        if extra:
            inventory["unexpected_supabase_projects"] = extra

    # ---- STEP 2: start the run ----------------------------------------------
    run = None
    finished = False
    if live:
        run = db.rpc("security_run_start", {"p_trigger": "scheduled", "p_inventory": inventory})
        if not isinstance(run, str):
            raise RuntimeError("security_run_start did not return a run id")
        log("run %s started" % run)
    else:
        log("DRY: no run row is created and nothing is written")

    try:
        # ---- STEP 3: web checks -------------------------------------------------
        fps, fp_status, web_error = {}, {}, None
        if args.no_web:
            web_error = "skipped by --no-web"
        else:
            tmp = tempfile.mkdtemp(prefix="security-audit-")
            try:
                repo = os.path.join(tmp, REPO_NAME)
                if not ctx.clone(repo):
                    log("git clone failed; the code checks will record skip")
                items, web_error = ctx.web(hosts, apexes, MAIL_DOMAINS, repo)
                if not web_error:
                    web_checks, fetched = split_web_items(items)
                    checks.extend(web_checks)
                    monitored = set(hosts)
                    fps, fp_status = {}, {}
                    for h in sorted(monitored | set(prev_fps) | set(fetched)):
                        fps[h], fp_status[h] = fingerprint_step(h, prev_fps.get(h), fetched.get(h), monitored)
                    fps = {h: v for h, v in fps.items() if v}
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        if web_error:
            problems.append("website checks: " + web_error)
            log("web checks failed: " + web_error)

        # ---- STEP 4: platform checks ---------------------------------------------
        # 4a. Supabase advisors (Management API)
        if sinv:
            prior = open_keys(db, "supa:")
            for proj in sinv:
                try:
                    status, data = ctx.api("GET", "%s/v1/projects/%s/advisors/security" % (SUPABASE_API, proj["ref"]),
                                           {"Authorization": "Bearer " + ctx.supa_token}, None, 120, 3)
                    if status != 200 or not isinstance(data, dict) or "lints" not in data:
                        raise ApiError("HTTP %d" % status)
                    checks.extend(advisor_checks(proj["name"], data["lints"], prior))
                except ApiError as exc:
                    checks.add("supa:%s:advisor:scan" % proj["name"], "skip", "Database (Supabase)", proj["name"], "advisor",
                               "Not checked: Supabase advisors for %s did not answer" % proj["name"],
                               "The Management API call failed (%s). No finding was closed by this." % exc)
        elif not ctx.supa_token:
            skip_missing_token(checks, "supabase", "supa:Bestly:advisor:scan", "Database (Supabase)", "Bestly", "advisor",
                               ["security advisors for %s (ERROR lints, leaked password protection, function search path)"
                                % ", ".join(EXPECTED_SUPABASE)])

        # 4b. Bestly database facts (service role): admins, anon writers
        facts = None
        try:
            facts = db.rpc("security_audit_facts", {})
        except ApiError as exc:
            log("security_audit_facts unavailable: %s" % exc)
        admins = facts.get("admins") if isinstance(facts, dict) else None
        if admins is None:
            try:
                rows = db.get("user_roles?select=user_id&role=eq.admin")
                admins = len(rows)
            except ApiError as exc:
                checks.add("supa:Bestly:staff:admins", "skip", "Database (Supabase)", "Bestly", "staff_admins",
                           "Not checked: could not count admin accounts", str(exc)[:200])
        if admins is not None:
            checks.add(**{k: v for k, v in admin_check(admins).items()})
        if isinstance(facts, dict) and isinstance(facts.get("anon_writers"), list):
            checks.extend(writer_checks(facts["anon_writers"], open_keys(db, "supa:Bestly:rpc:anon_writer:")))
        else:
            checks.add("supa:Bestly:rpc:mail_functions_anon", "skip", "Database (Supabase)", "Bestly", "anon_rpc",
                       "Not checked: anonymous-callable writer functions",
                       "The database function security_audit_facts() is not installed, so the anon writer scan could not run. "
                       "Apply migration 20261014210000_security_audit_pi_rpcs.sql.",
                       "Apply supabase/migrations/20261014210000_security_audit_pi_rpcs.sql.",
                       {"reason": "migration_not_applied"})
            unverified.append("anon writer functions (migration not applied)")

        # 4c. cron health (memory: house/security-audit, 2026-09-23 procedure update)
        try:
            checks.add(**cron_health_check(db.rpc("cron_health", {"p_hours": 24})))
        except ApiError as exc:
            checks.add("ops:supabase:cron_startup", "skip", "Database (Supabase)", "Bestly", "cron_health",
                       "Not checked: scheduled-job health", str(exc)[:200])

        # 4d. Vercel
        if vercel_ok:
            vc = Vercel(ctx.vercel_token, ctx.api)
            for p in vinv["projects"]:
                checks.add(**vercel_preview_check(p))
            if vinv["members"] is not None:
                checks.add(**vercel_members_check(vinv["members"]))
            else:
                checks.add("vercel:team:members", "skip", "Hosting (Vercel)", "Bestly team", "team_members",
                           "Not checked: Vercel team members",
                           "The members call answered HTTP %s." % vinv.get("members_status"))
            denied = []
            for p in vinv["projects"]:
                status, data = vc.get("/v10/projects/%s/env" % urllib.parse.quote(p["id"]))
                if status == 200:
                    envs = data.get("envs") if isinstance(data, dict) and "envs" in data else \
                        ([data] if isinstance(data, dict) and "key" in data else (data or []))
                    names = [e.get("key", "") for e in envs if isinstance(e, dict)]
                    del envs, data  # values are never kept
                    checks.add(**vercel_env_check(p["name"], names))
                elif status in (401, 403):
                    denied.append(p["name"])
                else:
                    checks.add("vercel:%s:client_secret_env" % p["name"], "skip", "Hosting (Vercel)", "Vercel %s" % p["name"],
                               "client_secret_env", "Not checked: env var names for %s" % p["name"], "HTTP %d" % status)
            if denied:
                checks.add("vercel:team:client_secret_env", "skip", "Hosting (Vercel)", "Bestly team", "client_secret_env",
                           "Could not check env var names: the Vercel token cannot list them",
                           "Vercel answered 401/403 for %s of %s projects. Values were never requested." % (len(denied), len(vinv["projects"])),
                           "Create the Vercel token with read access to project environment variables, then paste it again on /admin/security.",
                           {"http_denied": denied})
            else:
                checks.add("vercel:team:client_secret_env", "pass", "Hosting (Vercel)", "Bestly team", "client_secret_env")
            # defacement: fingerprint changed AND no production deployment in the window
            by_host = {}
            for p in vinv["projects"]:
                for h in p["domains"]:
                    by_host[h] = p
            since_ms = int((now - timedelta(hours=DEPLOY_WINDOW_HOURS)).timestamp() * 1000)
            deployed_cache = {}
            for host, fp in sorted(fps.items()):
                if host in NON_VERCEL_HOSTS or host not in by_host:
                    continue
                st = fp_status.get(host)
                if st in (None, "unchecked", "redirect"):
                    why = {None: "the homepage was not fetched tonight", "unchecked": "the homepage fetch did not return a normal page (%s)" % fp.get("last_unchecked"),
                           "redirect": "the host redirects to %s, which has its own check" % fp.get("redirect_to")}[st]
                    checks.add("web:%s:content_changed" % host, "skip", "Websites", host, "content_changed",
                               "Not checked: %s" % host, why.capitalize() + ". The old baseline is kept and nothing is raised.")
                    continue
                if st == "pending":
                    continue    # first sighting of a change: no verdict either way until tomorrow
                if st == "changed":
                    pid = by_host[host]["id"]
                    if pid not in deployed_cache:
                        since_st, dd = vc.get("/v7/deployments", projectId=pid, target="production", state="READY",
                                              since=since_ms, limit=1)
                        deployed_cache[pid] = (len((dd or {}).get("deployments", [])) > 0) if since_st == 200 else None
                    deployed = deployed_cache[pid]
                    prev = (prev_fps.get(host) or {}).get("text_sha256")
                else:
                    deployed, prev = False, fp.get("text_sha256")
                c = content_check(host, fp.get("text_sha256"), prev, deployed)
                if c:
                    checks.add(**c)
        else:
            if not ctx.vercel_token:
                skip_missing_token(checks, "vercel", "vercel:team:members", "Hosting (Vercel)", "Bestly team", "team_members",
                                   ["preview protection per project", "team member count",
                                    "browser-exposed env var names", "homepage changed with no deploy"])
            else:
                checks.add("vercel:team:members", "skip", "Hosting (Vercel)", "Bestly team", "team_members",
                           "Not checked: Vercel did not answer",
                           "The Vercel token was refused or the API failed tonight. Not run: preview protection, team members, "
                           "env var names, homepage changed with no deploy.",
                           "Paste a working Vercel token on /admin/security (Audit tokens card).", {"reason": "vercel_unavailable"})

        # 4e. El Dora ownership (bestly_memory eldora/domain-risk)
        try:
            rows = db.get("bestly_memory?select=title,body&area=eq.eldora&key=eq.domain-risk&limit=1")
            if rows:
                checks.add(**eldora_check(rows[0].get("body"), rows[0].get("title")))
            else:
                checks.add("dns:eldoraluxe.com:ownership", "skip", "DNS / email", "eldoraluxe.com", "ownership",
                           "Not checked: bestly_memory eldora/domain-risk was not found")
        except ApiError as exc:
            checks.add("dns:eldoraluxe.com:ownership", "skip", "DNS / email", "eldoraluxe.com", "ownership",
                       "Not checked: could not read bestly_memory", str(exc)[:200])

        # ---- STEP 5: record everything, ONE batch ----------------------------------
        for c in checks.items:
            if c["result"] == "skip" and not c.get("detail"):
                c["detail"] = "The check did not run."
        outcomes, errors = {}, []
        if live:
            outcomes, errors = record_checks(db, run, checks.items)
            # Pi scan reads home_hub_snapshots (memory: replaces the old internal_scan skip)
            try:
                db.rpc("security_scan_pi", {"p_run": run})
            except ApiError as exc:
                one, _ = record_checks(db, run, [dict(
                    key="pi:bestly-pi:agent_reporting", result="skip", layer="Server (Pi)", asset="bestly-pi",
                    check="pi:agent_reporting", title="Not checked: the Pi scan failed to run",
                    detail=str(exc)[:200], fix=None, evidence={})])
            # ---- STEP 6: fingerprints onto the run's inventory -----------------------
            if fps:
                inventory["fingerprints"] = fps
                db.patch("security_audit_runs?id=eq.%s" % run, {"inventory": inventory})
            if errors:
                problems.append("%d checks could not be recorded" % len(errors))

        # ---- STEP 7: finish ------------------------------------------------------
        if live:
            try:
                red_rows = db.get("security_findings?select=title&status=eq.open&severity=eq.red&limit=20")
                yellow_rows = db.get("security_findings?select=id&status=eq.open&severity=eq.yellow&limit=500")
                red_titles, open_yellow = [r["title"] for r in red_rows], len(yellow_rows)
            except ApiError:
                red_titles, open_yellow = [c["title"] or c["key"] for c in checks.items if c["result"] == "red"], \
                    checks.count("yellow")
            summary = build_summary(checks, outcomes, red_titles, open_yellow, unverified, web_error)
            failed = bool(web_error) or bool(errors)
            res = db.rpc("security_run_finish", {"p_run": run,
                                                 "p_summary": ("Run failed: %s. " % "; ".join(problems) + summary) if failed else summary,
                                                 "p_failed": failed})
            finished = True
            line = "%s: %d checks (%d pass, %d red, %d yellow, %d skipped). %s" % (
                (res or {}).get("status", "?").upper() if isinstance(res, dict) else "?",
                len(checks.items), checks.count("pass"), checks.count("red"), checks.count("yellow"),
                checks.count("skip"), summary)
            if failed:
                raise RuntimeError("; ".join(problems) or "run failed")
            return line
        reds = [c["title"] or c["key"] for c in checks.items if c["result"] == "red"]
        return "DRY %d checks (%d pass, %d red, %d yellow, %d skipped)%s%s" % (
            len(checks.items), checks.count("pass"), checks.count("red"), checks.count("yellow"), checks.count("skip"),
            ("; red: " + "; ".join(reds[:3])) if reds else "",
            ("; not checked: " + ", ".join(unverified)) if unverified else "")
    except Exception as exc:  # noqa: BLE001 -- the run row must never be left "running"
        if live and run and not finished:
            try:
                db.rpc("security_run_finish", {"p_run": run, "p_summary": "Run failed: %s" % str(exc)[:300], "p_failed": True})
            except ApiError:
                pass
        raise


def scout_notify(db, title, body, severity, dedupe):
    """Signed by Ares. Real parameter names (verified with pg_get_function_arguments): p_severity, p_url."""
    try:
        db.rpc("scout_notify", {"p_title": title, "p_body": body, "p_severity": severity, "p_push": False,
                                "p_url": "/admin/security", "p_dedupe": dedupe})
    except ApiError:
        pass


def main(argv=None):
    parser = argparse.ArgumentParser(description="Nightly security audit")
    parser.add_argument("--dry", action="store_true", help="run every check, write nothing")
    parser.add_argument("--live", action="store_true", help="write, ignoring state mode")
    parser.add_argument("--force", action="store_true", help="run even if a scheduled audit started in the last 6 hours")
    parser.add_argument("--no-web", action="store_true", help="skip web_checks.py (testing)")
    parser.add_argument("--quiet", action="store_true", help="no Scout notice")
    args = parser.parse_args(argv or [])

    state = load_state()
    live = False
    if args.live:
        live = True
    elif not args.dry and state.get("mode") == "live":
        live = True

    url, key = env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        raise RuntimeError("no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on the Pi (env or %s)" % ENV_FILE)
    db = Db(url, key)
    ctx = Ctx(db,
              get_token(db, VERCEL_SERVICE, VERCEL_ACCOUNT, VERCEL_VAULT_NAME),
              get_token(db, SUPABASE_SERVICE, SUPABASE_ACCOUNT, SUPABASE_VAULT_NAME))
    stamp = datetime.now().strftime("%Y%m%d")
    try:
        summary = run_audit(ctx, args, live, state)
    except Exception as exc:  # noqa: BLE001
        state["last_run"] = datetime.now().isoformat(timespec="seconds")
        state.setdefault("log", []).append({"at": state["last_run"], "mode": "live" if live else "dry", "error": str(exc)[:200]})
        save_state(state)
        raise
    state["last_run"] = datetime.now().isoformat(timespec="seconds")
    state["last_summary"] = summary
    state.setdefault("log", []).append({"at": state["last_run"], "mode": "live" if live else "dry", "summary": summary[:300]})
    save_state(state)
    log(summary)
    if live and not args.quiet and "token rejected" in summary:
        scout_notify(db, "%s: an audit token was refused" % OWNER,
                     "Vercel or Supabase refused the saved token, so those checks were skipped tonight. Paste a new one on the Security page.",
                     "warning", "security-audit.token.%s" % stamp)
    return summary


if __name__ == "__main__":
    try:
        print(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001
        print("security-audit failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
