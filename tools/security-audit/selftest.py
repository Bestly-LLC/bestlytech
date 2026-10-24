#!/usr/bin/env python3
"""Offline selftest for the security audit: no network, no database, no secrets.

Drives the real run_audit() against a fake Supabase / Vercel / Supabase-Management API and checks the
things that matter for a security tool: the exact check keys, skip-never-pass, one batched write, the
fingerprints update, security_run_finish(failed) on a mid-run failure, and that no secret value ever
reaches a database payload or the log.
"""
import io
import json
import os
import sys
import contextlib
import math
import urllib.parse
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import security_audit as sa  # noqa: E402

sa.CF_PAUSE_S = 0

FAILS = []


def ok(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


VTOKEN = "vercel_test_token_AAAAAAAAAAAAAAAA"
STOKEN = "sbp_test_token_BBBBBBBBBBBBBBBBBBB"
CTOKEN = "cf_test_token_CCCCCCCCCCCCCCCCCCCC"
CF_EMAIL = "owner-secret@example.com"
CF_ACCOUNT_NAME = "Secret Name's Account"
OWNED = ["bestly-site-outage-splash", "bestly-cloud-maintenance-splash", "bestly-studio-mail"]
FAR = "2099-01-01T00:00:00Z"
SECRET_ENV_VALUE = "ENV_VALUE_MUST_NEVER_BE_KEPT_12345"
RUN = "11111111-2222-3333-4444-555555555555"
BASE = "https://fake.supabase.co"


class FakeWorld:
    """Routes every http call the audit makes."""

    def __init__(self, batch_rpc=True, facts_rpc=True, prev_sha="old", deployed=False, web_ok=True,
                 started_recently=False, env_status=200):
        self.calls = []            # (method, url)
        self.rpc = []              # (name, payload)
        self.patches = []
        self.batch_rpc, self.facts_rpc = batch_rpc, facts_rpc
        self.prev_sha, self.deployed, self.web_ok = prev_sha, deployed, web_ok
        self.pending_sha, self.cur_ev = None, {}
        self.started_recently = started_recently
        self.env_status = env_status
        # ---- fake Cloudflare (healthy account by default)
        self.cf_calls = []         # (method, path)
        self.cf_reject = False
        self.cf_deny = set()       # path fragments answered 403
        self.cf_page_size = 0      # 0 = honour per_page; N = force N rows a page (pagination test)
        self.cf_accounts = [{"id": "acct1", "name": CF_ACCOUNT_NAME}]
        self.cf_zones = [{"id": "z1", "name": "bestly.tech"}, {"id": "z2", "name": "hoku-clean.com"}]
        self.cf_routes = {"z1": [], "z2": []}
        self.cf_workers = list(OWNED)
        self.cf_crons = {}
        self.cf_usage_day = {"bestly-studio-mail": 40, "bestly-site-outage-splash": 12}
        self.cf_usage_week = {"bestly-studio-mail": 280}
        self.cf_graphql_denied = False
        self.cf_cnames = {"z1": [{"name": "cloud.bestly.tech", "content": "abc123.cfargotunnel.com"},
                                 {"name": "www.bestly.tech", "content": "cname.vercel-dns.com"}], "z2": []}
        self.cf_tunnels = [{"id": "abc123", "name": "pi"}]
        self.cf_ssl = {"z1": "strict", "z2": "strict"}
        self.cf_tls = {"z1": "1.2", "z2": "1.3"}
        self.cf_members = [{"status": "accepted", "user": {"email": CF_EMAIL}}]
        self.cf_verify = {"id": "tok-audit", "status": "active", "expires_on": FAR}
        self.cf_tokens = [cf_tok("tok-audit", "Bestly audit (read only)", ["Zone Read", "DNS Read", "Workers Scripts Read"], ip=True)]
        self.edge_log = []
        self.dns = {}              # target -> ok | nxdomain | temp (default ok)
        self.dns_canary = "ok"

    def __call__(self, method, url, headers=None, body=None, timeout=60, tries=1):
        self.calls.append((method, url))
        payload = json.loads(body) if body else None
        if url.startswith(BASE + "/rest/v1/rpc/"):
            name = url.rsplit("/", 1)[1]
            self.rpc.append((name, payload))
            return self.db_rpc(name, payload)
        if url.startswith(BASE + "/rest/v1/"):
            path = url[len(BASE + "/rest/v1/"):]
            if method == "PATCH":
                self.patches.append((path, payload))
                return 204, None
            return self.db_get(path)
        if url.startswith(sa.VERCEL_API):
            return self.vercel(url)
        if url.startswith(sa.SUPABASE_API):
            return self.supabase(url, headers)
        if url.startswith(sa.CF_API):
            return self.cloudflare(method, url, headers, payload)
        raise AssertionError("unexpected call " + url)

    def resolve(self, target):
        return self.dns_canary if target == "cloudflare.com" else self.dns.get(target, "ok")

    # ---- cloudflare
    def _cf_list(self, rows, q):
        size = self.cf_page_size or int(q.get("per_page", 50))
        page = int(q.get("page", 1))
        return 200, {"success": True, "result": rows[(page - 1) * size: page * size],
                     "result_info": {"page": page, "per_page": size, "total_pages": max(1, math.ceil(len(rows) / size))}}

    def cloudflare(self, method, url, headers, payload):
        assert headers["Authorization"] == "Bearer " + CTOKEN
        sp = urllib.parse.urlsplit(url)
        path = sp.path[len("/client/v4"):]
        q = {k: v[0] for k, v in urllib.parse.parse_qs(sp.query).items()}
        self.cf_calls.append((method, path))
        if self.cf_reject or any(f in path for f in self.cf_deny):
            return 403, {"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]}
        ok = lambda r: (200, {"success": True, "result": r})  # noqa: E731
        if method == "POST":
            assert path == "/graphql", path
            assert payload["query"].lstrip().startswith("query") and "mutation" not in payload["query"]
            if self.cf_graphql_denied:
                return 200, {"data": None, "errors": [{"message": "not authorized to access this resource"}]}
            since = datetime.fromisoformat(payload["variables"]["since"].replace("Z", "+00:00"))
            until = datetime.fromisoformat(payload["variables"]["until"].replace("Z", "+00:00"))
            usage = self.cf_usage_day if (until - since) <= timedelta(days=1) else self.cf_usage_week
            return 200, {"data": {"viewer": {"accounts": [{"workersInvocationsAdaptive": [
                {"sum": {"requests": n}, "dimensions": {"scriptName": name}} for name, n in usage.items()]}]}}, "errors": None}
        assert method == "GET", method
        if path == "/accounts":
            return self._cf_list(self.cf_accounts, q)
        if path == "/zones":
            return self._cf_list(self.cf_zones, q)
        if path == "/accounts/acct1/workers/scripts":
            return ok([{"id": n, "etag": "x"} for n in self.cf_workers])
        if path.startswith("/accounts/acct1/workers/scripts/") and path.endswith("/schedules"):
            name = path.split("/")[-2]
            return ok({"schedules": [{"cron": c} for c in self.cf_crons.get(name, [])]})
        if path.startswith("/zones/") and path.endswith("/workers/routes"):
            return ok(self.cf_routes[path.split("/")[2]])
        if path.startswith("/zones/") and path.endswith("/dns_records"):
            assert q["type"] == "CNAME"
            return self._cf_list(self.cf_cnames[path.split("/")[2]], q)
        if path == "/accounts/acct1/cfd_tunnel":
            assert q["is_deleted"] == "false"
            return self._cf_list(self.cf_tunnels, q)
        if path.startswith("/zones/") and path.endswith("/settings/ssl"):
            return ok({"id": "ssl", "value": self.cf_ssl[path.split("/")[2]]})
        if path.startswith("/zones/") and path.endswith("/settings/min_tls_version"):
            return ok({"id": "min_tls_version", "value": self.cf_tls[path.split("/")[2]]})
        if path == "/accounts/acct1/members":
            return self._cf_list(self.cf_members, q)
        if path == "/user/tokens/verify":
            return ok(self.cf_verify)
        if path == "/user/tokens":
            return self._cf_list(self.cf_tokens, q)
        raise AssertionError("unexpected cloudflare " + url)

    # ---- database
    def db_rpc(self, name, p):
        if name == "security_run_start":
            return 200, RUN
        if name == "security_checks_record":
            if not self.batch_rpc:
                return 404, {"message": "Could not find the function"}
            return 200, {"outcomes": {"opened": 2, "pass": len(p["p_checks"]) - 2}, "errors": []}
        if name == "security_check":
            return 200, "pass"
        if name == "security_audit_facts":
            if not self.facts_rpc:
                return 404, {"message": "Could not find the function"}
            return 200, {"admins": 1, "anon_writers": [{"function": "bestly_mail_send", "args": "p text"},
                                                        {"function": "ltx_report", "args": "x jsonb"}]}
        if name == "cron_health":
            return 200, {"window_hours": 24, "runs": 1000, "failed": 0, "pct_failed": 0, "worst_hour": None, "worst_jobs": []}
        if name == "security_scan_pi":
            return 200, None
        if name == "security_run_finish":
            return 200, {"status": "yellow"}
        if name in ("security_token_state_put", "scout_notify"):
            return 200, None
        if name == "pi_secret_get":
            return 200, None
        raise AssertionError("unexpected rpc " + name)

    def db_get(self, path):
        if path.startswith("security_audit_runs"):
            rows = []
            if self.started_recently:
                rows.append({"started_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
                             "status": "yellow", "trigger": "scheduled", "inventory": {}})
            rows.append({"started_at": "2026-10-13T08:00:00+00:00", "status": "yellow", "trigger": "scheduled",
                         "inventory": {"hosts": ["bestly.tech", "www.bestly.tech"],
                                       "fingerprints": {"bestly.tech": {"title": "t", "status": 200, "text_sha256": self.prev_sha, "algo": 2,
                                                                         "pending_sha256": self.pending_sha}},
                                       "vercel_projects": [], "supabase_projects": ["Bestly"], "vercel_team_members": 1}})
            return 200, rows
        if path.startswith("security_findings") and "severity=eq.red" in path:
            return 200, []
        if path.startswith("security_findings") and "severity=eq.yellow" in path:
            return 200, [{"id": 1}, {"id": 2}]
        if path.startswith("security_findings"):
            return 200, [{"key": "supa:Bestly:rpc:anon_writer:old_fn"}, {"key": "supa:Bestly:advisor:rls_disabled_in_public"}]
        if path.startswith("bestly_memory"):
            return 200, [{"title": "El Dora domain is in Rohit's GoDaddy account", "body": "Opened 2026-08-31, still open."}]
        if path.startswith("edge_guard_log"):
            assert "order=at.desc" in path and "at=gte." in path
            return 200, self.edge_log
        if path.startswith("user_roles"):
            return 200, [{"user_id": "u"}]
        raise AssertionError("unexpected get " + path)

    # ---- vercel
    def vercel(self, url):
        if "/v10/projects?" in url:
            return 200, {"projects": [
                {"id": "prj_1", "name": "bestlytech", "ssoProtection": {"deploymentType": "all_except_custom_domains"},
                 "targets": {"production": {"id": "d"}}},
                {"id": "prj_2", "name": "leaky", "ssoProtection": None, "targets": {"production": {"id": "d"}}},
                {"id": "prj_3", "name": "nodeploy", "ssoProtection": {"deploymentType": "all"}, "targets": {}},
            ], "pagination": {"count": 3, "next": None}}
        if "/v9/projects/prj_1/domains" in url:
            return 200, {"domains": [{"name": "bestly.tech", "apexName": "bestly.tech"}, {"name": "bestlytech.vercel.app", "apexName": "vercel.app"}]}
        if "/v9/projects/prj_2/domains" in url:
            return 200, {"domains": [{"name": "leaky.vercel.app", "apexName": "vercel.app"}]}
        if "/v9/projects/prj_3/domains" in url:
            return 200, {"domains": [{"name": "nodeploy.vercel.app", "apexName": "vercel.app"}]}
        if "/v3/teams/" in url and "/members" in url:
            return 200, {"members": [{"uid": "a", "role": "OWNER", "email": "someone@example.com"}]}
        if "/env?" in url:
            if self.env_status != 200:
                return self.env_status, {"error": {"code": "forbidden"}}
            assert "decrypt" not in url, "must never ask Vercel to decrypt"
            names = {"prj_1": ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"],
                     "prj_2": ["VITE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_APP_PASSWORD", "DATABASE_URL"],
                     "prj_3": []}
            pid = url.split("/v10/projects/")[1].split("/")[0]
            return 200, {"envs": [{"key": k, "type": "encrypted", "value": SECRET_ENV_VALUE} for k in names[pid]]}
        if "/v7/deployments?" in url:
            assert "target=production" in url
            return 200, {"deployments": [{"uid": "d1"}] if self.deployed else []}
        raise AssertionError("unexpected vercel " + url)

    # ---- supabase management
    def supabase(self, url, headers):
        assert headers["Authorization"] == "Bearer " + STOKEN
        if url.endswith("/v1/projects"):
            return 200, [{"ref": sa.BESTLY_REF, "name": "bestlytech", "status": "ACTIVE_HEALTHY"},
                         {"ref": "ref2", "name": "schoolpilot", "status": "ACTIVE_HEALTHY"}]
        if url.endswith("/advisors/security"):
            if sa.BESTLY_REF in url:
                return 200, {"lints": [
                    {"name": "rls_disabled_in_public", "title": "RLS disabled", "level": "ERROR", "metadata": {"schema": "public", "name": "t1"}, "remediation": "https://x"},
                    {"name": "auth_leaked_password_protection", "level": "WARN"},
                    {"name": "function_search_path_mutable", "level": "WARN", "metadata": {"name": "f1"}},
                    {"name": "anon_security_definer_function_executable", "level": "ERROR", "metadata": {"name": "f"}},
                    {"name": "unindexed_foreign_keys", "level": "INFO"}]}
            return 200, {"lints": []}
        raise AssertionError("unexpected supabase " + url)


def fake_web_factory(world):
    def web(hosts, apexes, mail_domains, repo, timeout=0):
        if not world.web_ok:
            return [], "web_checks.py exited 1: ModuleNotFoundError"
        return [
            {"key": "web:bestly.tech:tls", "result": "pass", "layer": "Websites", "asset": "bestly.tech", "check": "tls"},
            {"key": "web:www.bestly.tech:headers", "result": "yellow", "layer": "Websites", "asset": "www.bestly.tech",
             "check": "headers", "title": "missing HSTS", "detail": "d", "fix": "f", "evidence": {}},
            {"key": "fingerprint:bestly.tech", "result": "info", "layer": "Websites", "asset": "bestly.tech", "check": "fp",
             "evidence": dict({"title": "Bestly", "status": 200, "text_sha256": "new", "algo": 2,
                               "final_host": "bestly.tech"}, **world.cur_ev)},
            {"key": "dns:bestly.tech:expiry", "result": "info", "layer": "DNS / email", "asset": "bestly.tech", "check": "e"},
        ], None
    return web


def cf_tok(tid, name, perms, ip=False, expires=FAR, status="active"):
    return {"id": tid, "name": name, "status": status, "expires_on": expires,
            "policies": [{"effect": "allow", "permission_groups": [{"id": "pg-" + p, "name": p} for p in perms]}],
            "condition": {"request_ip": {"in": ["203.0.113.7/32"]}} if ip else {}}


def make(world, vtoken=VTOKEN, stoken=STOKEN, ctoken=CTOKEN):
    db = sa.Db(BASE, "service-role-key-not-real", api=world)
    ctx = sa.Ctx(db, vtoken, stoken, api=world, web=fake_web_factory(world), clone=lambda d: True,
                 cf_token=ctoken, resolve=world.resolve)
    return ctx


class Args:
    force, no_web, quiet = False, False, True


def run(world, live=True, args=None, **kw):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            res = sa.run_audit(make(world, **kw), args or Args(), live, {})
            err = None
        except Exception as exc:  # noqa: BLE001
            res, err = None, exc
    return res, err, out.getvalue()


def batch_checks(world):
    calls = [p for n, p in world.rpc if n == "security_checks_record"]
    return calls[0]["p_checks"] if calls else []


def by_key(checks):
    return {c["key"]: c for c in checks}


def names(world):
    return [n for n, _ in world.rpc]


# ----------------------------------------------------------------- pure checks
def test_pure():
    print("pure functions")
    ok(sa.flagged_env_names(["VITE_X", "VITE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_APP_PASSWORD", "DATABASE_SECRET", "NEXT_PUBLIC_PRIVATE_X"])
       == ["NEXT_PUBLIC_APP_PASSWORD", "NEXT_PUBLIC_PRIVATE_X", "VITE_SERVICE_ROLE_KEY"], "client_secret_env flags only VITE_/NEXT_PUBLIC_ secrets")
    ok(sa.vercel_env_check("p", ["VITE_A"])["result"] == "pass" and sa.vercel_env_check("p", ["VITE_SECRET"])["result"] == "red", "env check pass/red")
    ok(sa.vercel_env_check("p", ["VITE_SECRET"])["key"] == "vercel:p:client_secret_env", "env key")
    ok(sa.vercel_members_check(1)["result"] == "pass" and sa.vercel_members_check(2)["result"] == "red", "members 1 pass, 2 red")
    ok(sa.admin_check(1)["result"] == "pass" and sa.admin_check(2)["result"] == "red", "admins 1 pass, 2 red")
    ok(sa.cron_health_check({"pct_failed": 0})["result"] == "pass", "cron 0 pass")
    ok(sa.cron_health_check({"pct_failed": 1.5, "failed": 1, "runs": 9})["result"] == "yellow", "cron 1.5 yellow")
    ok(sa.cron_health_check({"pct_failed": 2.1, "failed": 1, "runs": 9})["result"] == "red", "cron 2.1 red")
    ok(sa.cron_health_check({"pct_failed": 5})["key"] == "ops:supabase:cron_startup", "cron key")
    ok(sa.eldora_check("still open", "t")["result"] == "yellow", "eldora open is yellow")
    ok(sa.eldora_check("RESOLVED transferred 2026-11-01", "t")["result"] == "pass", "eldora resolved is pass")
    ok(sa.content_check("h", "b", "a", False)["result"] == "yellow", "changed + no deploy is yellow")
    ok(sa.content_check("h", "b", "a", True)["result"] == "pass", "changed + deploy is pass")
    ok(sa.content_check("h", "a", "a", False)["result"] == "pass", "unchanged is pass")
    ok(sa.content_check("h", "b", "a", None)["result"] == "skip", "unknown deploy state is skip, not pass")
    ok(sa.pick_hosts(["a.vercel.app", "x.com"], True) == ["x.com"], "custom domain wins")
    ok(sa.pick_hosts(["a.vercel.app"], False) == [], "vercel.app only when it has a production deploy")
    ok(sa.pick_hosts(["a.vercel.app"], True) == ["a.vercel.app"], "vercel.app fallback")

    lints = [{"name": "rls_disabled_in_public", "title": "RLS", "level": "ERROR", "metadata": {"schema": "public", "name": "t"}},
             {"name": "anon_security_definer_function_executable", "level": "ERROR", "metadata": {"name": "f"}},
             {"name": "auth_leaked_password_protection", "level": "WARN"},
             {"name": "function_search_path_mutable", "level": "WARN", "metadata": {"name": "f"}},
             {"name": "x", "level": "INFO"}]
    got = by_key(sa.advisor_checks("Bestly", lints, []))
    ok(got["supa:Bestly:advisor:rls_disabled_in_public"]["result"] == "red", "ERROR lint is red")
    ok(not any("anon_security_definer" in k for k in got), "blanket anon lint ignored")
    ok(got["supa:Bestly:advisor:leaked_password_protection"]["result"] == "yellow", "leaked password yellow")
    ok(got["supa:Bestly:advisor:function_search_path"]["result"] == "yellow", "search_path yellow")
    clean = by_key(sa.advisor_checks("Bestly", [], ["supa:Bestly:advisor:rls_disabled_in_public"]))
    ok(clean["supa:Bestly:advisor:rls_disabled_in_public"]["result"] == "pass", "a lint that went away closes by pass")
    ok(clean["supa:Bestly:advisor:leaked_password_protection"]["result"] == "pass", "leaked ok is pass")

    w = by_key(sa.writer_checks([{"function": "bestly_mail_a", "args": ""}, {"function": "bestly_mail_b", "args": ""},
                                 {"function": "ltx_report", "args": "x jsonb"}],
                                ["supa:Bestly:rpc:anon_writer:gone_fn"]))
    ok(w["supa:Bestly:rpc:mail_functions_anon"]["result"] == "yellow", "mail functions roll into one key")
    a = w["supa:Bestly:rpc:anon_writer:ltx_report"]
    ok(a["check"] == "anon_rpc" and a["evidence"]["function"] == "ltx_report", "anon_writer evidence.function present (Ares auto-fixer reads it)")
    ok(set(a["evidence"]) >= {"function", "args", "writes", "auth_check", "anon_execute", "security_definer"}, "anon_writer evidence complete")
    ok(w["supa:Bestly:rpc:anon_writer:gone_fn"]["result"] == "pass", "fixed writer closes by pass")
    ok(by_key(sa.writer_checks([], []))["supa:Bestly:rpc:mail_functions_anon"]["result"] == "pass", "no mail writers is pass")


# ------------------------------------------------------------------ whole runs
def test_no_tokens():
    print("missing tokens (live)")
    w = FakeWorld()
    res, err, out = run(w, vtoken="", stoken="", ctoken="")
    ok(err is None, "run succeeds without tokens (%s)" % err)
    cs = by_key(batch_checks(w))
    ok(cs["vercel:team:members"]["result"] == "skip", "vercel checks recorded as skip")
    ok(cs["supa:Bestly:advisor:scan"]["result"] == "skip", "supabase advisors recorded as skip")
    ok("pi:vercel:api_token" in cs["vercel:team:members"]["fix"], "skip names the missing token")
    ok(not any(k.startswith("vercel:") and v["result"] == "pass" for k, v in cs.items()), "no vercel check passes without a token")
    ok(not any("advisor" in k and v["result"] == "pass" for k, v in cs.items()), "no advisor check passes without a token")
    fin = [p for n, p in w.rpc if n == "security_run_finish"]
    ok(len(fin) == 1 and fin[0]["p_failed"] is False, "run finishes ok=true (missing token is not a failure)")
    ok("Not checked" in fin[0]["p_summary"], "summary says what was not checked")
    states = [p for n, p in w.rpc if n == "security_token_state_put"]
    ok({s["p_status"] for s in states} == {"missing"} and {s["p_which"] for s in states} == {"vercel", "supabase", "cloudflare"},
       "token state recorded as missing for all three")
    ok(not any("fingerprint" in k for k in cs), "fingerprints are not checks")


def test_order_and_batch():
    print("order, one batch, fingerprints (live, both tokens)")
    w = FakeWorld()
    w.pending_sha = "new"
    res, err, out = run(w)
    ok(err is None, "run succeeds (%s)" % err)
    n = names(w)
    ok(n.count("security_checks_record") == 1, "exactly one batched write")
    ok(n.index("security_run_start") < n.index("security_checks_record") < n.index("security_run_finish"), "start, then batch, then finish")
    ok("security_check" not in n, "no per-check calls when the batch RPC exists")
    ok(n.index("security_scan_pi") > n.index("security_checks_record"), "Pi scan after the batch")
    ok(w.patches and w.patches[0][1]["inventory"]["fingerprints"]["bestly.tech"]["text_sha256"] == "new", "fingerprints saved on the run inventory")
    ok(n.index("security_run_finish") > n.index("security_scan_pi"), "finish last")
    cs = by_key(batch_checks(w))
    ok(cs["vercel:leaky:preview_protection"]["result"] == "yellow", "open previews are yellow")
    ok(cs["vercel:bestlytech:preview_protection"]["result"] == "pass", "protected project passes")
    ok(cs["vercel:leaky:client_secret_env"]["result"] == "red", "client secret env is red")
    ok(cs["vercel:bestlytech:client_secret_env"]["result"] == "pass", "clean env passes")
    ok(cs["vercel:team:members"]["result"] == "pass", "one member passes")
    ok(cs["web:bestly.tech:content_changed"]["result"] == "yellow", "changed homepage with no deploy is yellow")
    ok(cs["supa:Bestly:advisor:rls_disabled_in_public"]["result"] == "red", "advisor ERROR is red")
    ok(cs["supa:schoolpilot:advisor:leaked_password_protection"]["result"] == "pass", "clean project advisors pass")
    ok(cs["supa:Bestly:rpc:anon_writer:ltx_report"]["result"] == "yellow", "anon writer finding")
    ok(cs["supa:Bestly:rpc:mail_functions_anon"]["result"] == "yellow", "mail functions finding")
    ok(cs["supa:Bestly:staff:admins"]["result"] == "pass", "one admin passes")
    ok(cs["ops:supabase:cron_startup"]["result"] == "pass", "cron health passes")
    ok(cs["dns:eldoraluxe.com:ownership"]["result"] == "yellow", "El Dora ownership still yellow")
    ok(not any(k.startswith("pi:bestly-pi:internal_scan") for k in cs), "internal_scan is never recorded")
    ok("web:www.bestly.tech:headers" in cs, "web_checks results are merged")
    ok(not any(k.startswith("fingerprint:") or k.endswith(":expiry") for k in cs), "info items are not recorded")
    inv = [p for n_, p in w.rpc if n_ == "security_run_start"][0]["p_inventory"]
    ok("cloud.bestly.tech" in inv["hosts"] and "bestly.tech" in inv["hosts"], "inventory has hosts incl. cloud.bestly.tech")
    ok(inv["vercel_team_members"] == 1 and len(inv["vercel_projects"]) == 3, "inventory has projects and member count")


def test_deployed_explains_change():
    print("defacement rule")
    w = FakeWorld(deployed=True)
    w.pending_sha = "new"
    run(w)
    ok(by_key(batch_checks(w))["web:bestly.tech:content_changed"]["result"] == "pass", "a production deploy explains the change")
    w = FakeWorld(prev_sha="new")
    run(w)
    ok(by_key(batch_checks(w))["web:bestly.tech:content_changed"]["result"] == "pass", "unchanged text passes")
    w = FakeWorld()
    w.pending_sha = "new"
    run(w, vtoken="")
    ok("web:bestly.tech:content_changed" not in by_key(batch_checks(w)), "no vercel token: no verdict on content_changed (not a fake pass)")


def test_no_false_alarms():
    print("content check: no false alarms")
    w = FakeWorld()          # changed once, never seen before
    run(w)
    cs = by_key(batch_checks(w))
    ok("web:bestly.tech:content_changed" not in cs, "first sighting of a change raises nothing")
    fp = w.patches[0][1]["inventory"]["fingerprints"]["bestly.tech"]
    ok(fp["text_sha256"] == "old" and fp["pending_sha256"] == "new", "pending hash stored, baseline held")
    w = FakeWorld()
    w.pending_sha = "other"  # a different pending hash does not confirm
    run(w)
    ok("web:bestly.tech:content_changed" not in by_key(batch_checks(w)), "a different pending hash does not confirm")
    w = FakeWorld()
    w.pending_sha = "new"
    run(w)
    ok(by_key(batch_checks(w))["web:bestly.tech:content_changed"]["result"] == "yellow", "same change on 2 runs raises")
    ok(w.patches[0][1]["inventory"]["fingerprints"]["bestly.tech"]["text_sha256"] == "new", "baseline moves once confirmed")
    for ev, label in (({"status": 503, "text_sha256": None, "unchecked": "http 503"}, "non-200"),
                      ({"text_sha256": None, "unchecked": "empty body"}, "empty body")):
        w = FakeWorld()
        w.pending_sha = "new"
        w.cur_ev = ev
        run(w)
        c = by_key(batch_checks(w))["web:bestly.tech:content_changed"]
        ok(c["result"] == "skip", "%s is 'could not check', not a finding" % label)
        f = w.patches[0][1]["inventory"]["fingerprints"]["bestly.tech"]
        ok(f["text_sha256"] == "old" and f["pending_sha256"] == "new", "%s: baseline and pending untouched" % label)
    w = FakeWorld()
    w.pending_sha = "new"
    w.cur_ev = {"final_host": "cloud.bestly.tech"}
    run(w)
    # Since 2026-10-20 (Command Center v2) a redirect-only host has no page of its own to deface: pass, never a nightly yellow.
    ok(by_key(batch_checks(w))["web:bestly.tech:content_changed"]["result"] == "pass", "redirect to another monitored host passes (it has no page of its own)")
    w = FakeWorld()
    run(w)
    w2 = FakeWorld()
    w2.prev_sha = "new"
    run(w2)
    ok(by_key(batch_checks(w2))["web:bestly.tech:content_changed"]["result"] == "pass", "unchanged still passes")


def test_no_secret_leaks():
    print("secrets")
    w = FakeWorld()
    res, err, out = run(w)
    blob = json.dumps(w.rpc) + json.dumps(w.patches) + out + (res or "")
    ok(SECRET_ENV_VALUE not in blob, "env var VALUES never reach the database, the log or the summary")
    ok(VTOKEN not in blob and STOKEN not in blob, "API tokens never reach the database, the log or the summary")
    ok("someone@example.com" not in blob, "Vercel member emails are not stored")
    ok(not any("decrypt" in u for _, u in w.calls), "env var values are never requested decrypted")
    ok(all(m == "GET" for m, u in w.calls if "vercel" in u or "api.supabase.com" in u), "only GETs go to Vercel / Supabase Management")
    ok(CTOKEN not in blob and CF_EMAIL not in blob and CF_ACCOUNT_NAME not in blob,
       "Cloudflare token, member emails and account name never reach the database, the log or the summary")


def test_rejected_token():
    print("rejected env access")
    w = FakeWorld(env_status=403)
    run(w)
    cs = by_key(batch_checks(w))
    ok(cs["vercel:team:client_secret_env"]["result"] == "skip", "403 on env names is skip, not pass")
    ok(not any(k.endswith(":client_secret_env") and v["result"] == "pass" for k, v in cs.items()), "no env check passes when env names could not be read")


def test_failures():
    print("failure handling")
    w = FakeWorld(web_ok=False)
    res, err, out = run(w)
    fin = [p for n, p in w.rpc if n == "security_run_finish"]
    ok(err is not None, "a broken web_checks makes the job fail")
    ok(len(fin) == 1 and fin[0]["p_failed"] is True, "security_run_finish called with p_failed=true")
    cs = by_key(batch_checks(w))
    ok(not any(k.startswith("web:") and v["result"] == "pass" for k, v in cs.items()), "no website check is passed when web_checks did not run")

    w = FakeWorld()
    orig = w.db_rpc

    def boom(name, p):
        if name == "security_scan_pi":
            raise sa.ApiError("network down")
        return orig(name, p)
    w.db_rpc = boom
    res, err, out = run(w)
    ok(err is None and any(n == "security_run_finish" for n, _ in w.rpc), "Pi scan failure is recorded as skip, run still finishes")

    # an exception after run_start still finishes the run
    w = FakeWorld()

    def boom2(name, p):
        if name == "security_checks_record":
            raise RuntimeError("kaboom")
        return orig2(name, p)
    orig2 = w.db_rpc
    w.db_rpc = boom2
    res, err, out = run(w)
    fin = [p for n, p in w.rpc if n == "security_run_finish"]
    ok(err is not None and len(fin) == 1 and fin[0]["p_failed"] is True, "unexpected exception: run finished with p_failed=true")


def test_fallbacks():
    print("migration not applied yet")
    w = FakeWorld(batch_rpc=False, facts_rpc=False)
    res, err, out = run(w)
    n = names(w)
    ok(err is None, "run still succeeds (%s)" % err)
    ok(n.count("security_check") > 10, "falls back to one security_check per check")
    cs = {p["p_key"]: p for nme, p in w.rpc if nme == "security_check"}
    ok(cs["supa:Bestly:rpc:mail_functions_anon"]["p_result"] == "skip", "anon writer scan is skip when facts RPC is missing")
    ok("supa:Bestly:staff:admins" in cs and cs["supa:Bestly:staff:admins"]["p_result"] == "pass", "admin count falls back to a plain table read")


def test_dry_and_guard():
    print("dry run and duplicate guard")
    w = FakeWorld()
    res, err, out = run(w, live=False)
    ok(err is None and res.startswith("DRY"), "dry summary: %s" % (res or err))
    writes = {"security_run_start", "security_checks_record", "security_check", "security_run_finish", "security_scan_pi", "security_token_state_put"}
    ok(not (writes & set(names(w))) and not w.patches, "dry run writes nothing")
    w = FakeWorld(started_recently=True)
    res, err, out = run(w)
    ok(err is None and res.startswith("skip") and "security_run_start" not in names(w), "a second run inside 6 hours is refused")
    a = Args()
    a.force = True
    w = FakeWorld(started_recently=True)
    res, err, out = run(w, args=a)
    ok(err is None and "security_run_start" in names(w), "--force overrides the guard")


def test_web_checks_contract():
    print("web_checks.py contract")
    here = os.path.dirname(os.path.abspath(__file__))
    cand = os.path.join(here, "..", "..", "scripts", "security-audit", "web_checks.py")
    if os.path.exists(cand):
        import subprocess
        r = subprocess.run([sys.executable, "-m", "py_compile", cand], capture_output=True)
        ok(r.returncode == 0, "web_checks.py compiles")
        src = open(cand, encoding="utf-8").read()
        for flag in ("--hosts", "--apex", "--mail-domains", "--repo"):
            ok(flag in src, "web_checks.py accepts " + flag)
    else:
        print("  skip web_checks.py not found next to the repo layout")
    items, err = sa.run_web_checks(["x"], ["x"], ["x"], "/nonexistent", timeout=5) if not os.path.exists(sa.WEB_CHECKS) else ([], None)
    ok(items == [] and (err is None or "not installed" in err), "missing web_checks.py is an error, never an empty pass")


# ------------------------------------------------------------------ cloudflare
def cf_keys(w):
    return {k: v for k, v in by_key(batch_checks(w)).items() if k.startswith("cf:")}


def cf_run(**attrs):
    w = FakeWorld()
    for k, v in attrs.items():
        setattr(w, k, v)
    res, err, out = run(w)
    assert err is None, err
    return w, cf_keys(w)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def test_cf_no_token():
    print("cloudflare: no token")
    w = FakeWorld()
    res, err, out = run(w, ctoken="")
    cs = cf_keys(w)
    ok(err is None, "run succeeds without a Cloudflare token (%s)" % err)
    ok(list(cs) == ["cf:account:members"] and cs["cf:account:members"]["result"] == "skip", "exactly one skip and nothing else under cf:")
    ok("pi:cloudflare:api_token" in cs["cf:account:members"]["fix"], "skip names the Vault secret")
    ok(all(w_ in cs["cf:account:members"]["detail"] for w_ in ("Worker routes", "SSL mode", "account members")), "skip lists every check that did not run")
    ok(not any(sa.CF_API in u for _, u in w.calls), "no Cloudflare call without a token")
    ok(("cloudflare", "missing") in [(p["p_which"], p["p_status"]) for n, p in w.rpc if n == "security_token_state_put"], "token state missing")
    ok("Cloudflare (token missing)" in res, "summary says Cloudflare was not checked")


def test_cf_rejected():
    print("cloudflare: token rejected")
    w = FakeWorld()
    w.cf_reject = True
    res, err, out = run(w)
    cs = cf_keys(w)
    ok(err is None, "a rejected token is not a failed run")
    ok(list(cs) == ["cf:account:members"] and cs["cf:account:members"]["result"] == "skip", "one unverified entry, nothing passes")
    ok(cs["cf:account:members"]["evidence"]["reason"] == "cloudflare_unavailable", "reason recorded")
    ok(("cloudflare", "rejected") in [(p["p_which"], p["p_status"]) for n, p in w.rpc if n == "security_token_state_put"], "token state rejected")
    ok("token rejected" in res and "Cloudflare" in res, "summary carries 'token rejected' (the Scout notice trigger)")
    ok(len(w.cf_calls) == 1, "stops at the first refused call")
    inv = [p for n, p in w.rpc if n == "security_run_start"][0]["p_inventory"]
    ok(inv["cloudflare"] == {}, "no previous inventory to carry forward")


def test_cf_healthy():
    print("cloudflare: healthy account")
    w, cs = cf_run()
    want = {"cf:account:count", "cf:account:zones", "cf:account:workers_usage", "cf:account:workers_list", "cf:account:members",
            "cf:token:scope", "cf:bestly.tech:worker_routes", "cf:hoku-clean.com:worker_routes", "cf:bestly.tech:dangling_cname",
            "cf:hoku-clean.com:dangling_cname", "cf:bestly.tech:ssl_mode", "cf:hoku-clean.com:ssl_mode"} | \
           {"cf:worker:%s:orphan" % n for n in OWNED}
    ok(set(cs) == want, "exact key set: %s" % sorted(set(cs) ^ want))
    ok(all(c["layer"] == "Edge (Cloudflare)" for c in cs.values()), "layer is Edge (Cloudflare)")
    ok(all(c["result"] == "pass" for c in cs.values()), "all pass: %s" % {k: v["result"] for k, v in cs.items() if v["result"] != "pass"})
    ok(cs["cf:account:workers_usage"]["evidence"]["requests"] == 52, "usage evidence has the total")
    ok(("cloudflare", "ok") in [(p["p_which"], p["p_status"]) for n, p in w.rpc if n == "security_token_state_put"], "token state ok")
    inv = [p for n, p in w.rpc if n == "security_run_start"][0]["p_inventory"]["cloudflare"]
    ok(inv == {"account": "acct1", "zones": ["bestly.tech", "hoku-clean.com"], "workers": sorted(OWNED)}, "inventory has account, zones, workers")
    non_get = [(m, p) for m, p in w.cf_calls if m != "GET"]
    ok(non_get == [("POST", "/graphql")] or set(non_get) == {("POST", "/graphql")}, "the only non-GET is the read-only GraphQL POST")
    ok(not any(p.startswith("/zones/") and p.endswith("/schedules") or "/schedules" in p for _, p in w.cf_calls), "owned Workers: no schedule lookups")


def test_cf_routes():
    print("cloudflare: worker routes")
    route = {"pattern": "bestly.tech/*", "script": "bestly-site-outage-splash", "request_limit_fail_open": True}
    w, cs = cf_run(cf_routes={"z1": [route], "z2": []})
    c = cs["cf:bestly.tech:worker_routes"]
    ok(c["result"] == "red", "a route with no outage is red")
    ok(c["evidence"]["routes"][0] == {"pattern": "bestly.tech/*", "script": "bestly-site-outage-splash", "request_limit_fail_open": True}, "evidence: pattern, script, fail_open")
    ok(cs["cf:hoku-clean.com:worker_routes"]["result"] == "pass", "other zone unaffected")
    down = [{"site": "bestly.tech", "state": "down", "at": now_iso()}]
    w, cs = cf_run(cf_routes={"z1": [route], "z2": []}, edge_log=down)
    ok(cs["cf:bestly.tech:worker_routes"]["result"] == "yellow" and "Splash route on during an outage" in cs["cf:bestly.tech:worker_routes"]["title"],
       "a route during an Edge Guard outage is yellow")
    w, cs = cf_run(cf_routes={"z1": [route], "z2": []}, edge_log=[{"site": "bestly.tech", "state": "recovered", "at": now_iso()},
                                                                  {"site": "bestly.tech", "state": "down", "at": now_iso()}])
    ok(cs["cf:bestly.tech:worker_routes"]["result"] == "red", "newest row says recovered: red again")
    closed = dict(route, request_limit_fail_open=False)
    w, cs = cf_run(cf_routes={"z1": [closed], "z2": []}, edge_log=down)
    ok(cs["cf:bestly.tech:worker_routes"]["result"] == "red", "a fail-closed route is red even during an outage")
    other = dict(route, pattern="cloud.bestly.tech/*")
    w, cs = cf_run(cf_routes={"z1": [other], "z2": []}, edge_log=down)
    ok(cs["cf:bestly.tech:worker_routes"]["result"] == "red", "outage on bestly.tech does not excuse a cloud.bestly.tech route")
    www = dict(route, pattern="www.bestly.tech/*")
    w, cs = cf_run(cf_routes={"z1": [route, www], "z2": []}, edge_log=down)
    ok(cs["cf:bestly.tech:worker_routes"]["result"] == "yellow", "bestly.tech outage covers www too")
    w, cs = cf_run(cf_deny={"/workers/routes"})
    ok(cs["cf:bestly.tech:worker_routes"]["result"] == "skip" and "Workers Routes Read" in cs["cf:bestly.tech:worker_routes"]["detail"], "403 on routes is skip naming the permission")
    ok(sa.cf_down_sites([{"site": "a", "state": "down"}, {"site": "a", "state": "ok"}, {"site": "b", "state": "quota"}]) == {"a"}, "down_sites uses the newest row per site")


def test_cf_usage():
    print("cloudflare: Workers usage")
    for total, want in ((49999, "pass"), (50000, "yellow"), (60000, "yellow"), (79999, "yellow"), (80000, "red"), (85000, "red")):
        c = sa.cf_usage_check(total, {"a": total}, "2026-10-14")
        ok(c["result"] == want, "%d requests is %s" % (total, want))
    w, cs = cf_run(cf_usage_day={"a": 30000, "b": 20000, "c": 7000, "d": 3000})
    c = cs["cf:account:workers_usage"]
    ok(c["result"] == "yellow" and [t["script"] for t in c["evidence"]["top_scripts"]] == ["a", "b", "c"], "60k is yellow with the top 3 scripts")
    w, cs = cf_run(cf_usage_day={"a": 85000})
    ok(cs["cf:account:workers_usage"]["result"] == "red", "85k is red")
    w, cs = cf_run(cf_graphql_denied=True)
    c = cs["cf:account:workers_usage"]
    ok(c["result"] == "skip" and "Account Analytics Read" in c["detail"], "GraphQL denied is skip naming Account Analytics Read")
    ok(c["evidence"]["permission"] == "Account Analytics Read", "permission in evidence")
    try:
        sa.Cloudflare("t", api=lambda *a, **k: (200, {})).graphql("mutation { x }", {})
        ok(False, "graphql refuses a mutation")
    except ValueError:
        ok(True, "graphql refuses a mutation")


def test_cf_workers():
    print("cloudflare: Worker owners")
    w, cs = cf_run(cf_workers=OWNED + ["stitch-proxy"], cf_usage_week={"stitch-proxy": 123}, cf_crons={"stitch-proxy": ["0 * * * *"]})
    c = cs["cf:worker:stitch-proxy:orphan"]
    ok(c["result"] == "yellow" and c["title"] == "Worker with no owner: stitch-proxy", "an unowned Worker is yellow")
    ok("123" in c["detail"] and "cron schedule: yes" in c["detail"], "detail has 7-day requests and the cron flag")
    ok(all(cs["cf:worker:%s:orphan" % n]["result"] == "pass" for n in OWNED), "owned Workers record pass under the same key")
    ok(any(p.endswith("/stitch-proxy/schedules") for _, p in w.cf_calls), "schedules looked up for the unowned Worker")
    w, cs = cf_run(cf_workers=OWNED + ["a", "b", "c", "d"])
    ok(sorted(k for k, v in cs.items() if k.endswith(":orphan") and v["result"] == "yellow") == ["cf:worker:%s:orphan" % n for n in "abcd"],
       "expected first run shape: only the unowned Workers are yellow")
    w, cs = cf_run(cf_workers=OWNED + ["x"], cf_graphql_denied=True)
    ok("unknown" in cs["cf:worker:x:orphan"]["detail"], "analytics denied: 7-day count is 'unknown', not 0")
    w, cs = cf_run(cf_deny={"/workers/scripts"})
    ok(cs["cf:account:workers_list"]["result"] == "skip" and "Workers Scripts Read" in cs["cf:account:workers_list"]["detail"], "Worker list denied is skip")
    ok(not any(k.endswith(":orphan") for k in cs), "no owner verdicts without the Worker list")
    gone = sa.cf_gone_worker_passes({"here"}, ["cf:worker:here:orphan", "cf:worker:gone:orphan", "supa:x"])
    ok([g["key"] for g in gone] == ["cf:worker:gone:orphan"] and gone[0]["result"] == "pass", "a deleted Worker closes its finding")


def test_cf_cnames():
    print("cloudflare: dangling CNAMEs")
    vercel = {"name": "old.bestly.tech", "content": "cname.vercel-dns.com"}
    cn = lambda extra: {"z1": extra, "z2": []}  # noqa: E731
    w, cs = cf_run(cf_cnames=cn([vercel]), dns={"cname.vercel-dns.com": "nxdomain"})
    c = cs["cf:bestly.tech:dangling_cname"]
    ok(c["result"] == "red" and c["evidence"]["bad"][0]["name"] == "old.bestly.tech", "NXDOMAIN on a takeover-prone host is red")
    ok(set(c["evidence"]["bad"][0]) == {"name", "target", "why"}, "evidence lists name, target, why")
    w, cs = cf_run(cf_cnames=cn([{"name": "t.bestly.tech", "content": "dead999.cfargotunnel.com"}]))
    ok(cs["cf:bestly.tech:dangling_cname"]["result"] == "red", "a deleted tunnel is red")
    w, cs = cf_run(cf_cnames=cn([{"name": "t.bestly.tech", "content": "abc123.cfargotunnel.com"}]))
    ok(cs["cf:bestly.tech:dangling_cname"]["result"] == "pass", "a live tunnel passes")
    ok(any(p == "/accounts/acct1/cfd_tunnel" for _, p in w.cf_calls), "tunnel list read")
    w, cs = cf_run(cf_cnames=cn([vercel]), dns={"cname.vercel-dns.com": "temp"})
    ok(cs["cf:bestly.tech:dangling_cname"]["result"] == "skip", "a DNS timeout is skip, never pass")
    w, cs = cf_run(cf_cnames=cn([{"name": "m.bestly.tech", "content": "mail.example.org"}]), dns={"mail.example.org": "nxdomain"})
    ok(cs["cf:bestly.tech:dangling_cname"]["result"] == "yellow", "NXDOMAIN on another host is yellow")
    w, cs = cf_run(cf_cnames=cn([vercel]), dns={"cname.vercel-dns.com": "nxdomain"}, dns_canary="temp")
    ok(cs["cf:bestly.tech:dangling_cname"]["result"] == "skip", "a broken local resolver cannot raise a red")
    w, cs = cf_run(cf_cnames=cn([{"name": "t.bestly.tech", "content": "dead999.cfargotunnel.com"}]), cf_deny={"cfd_tunnel"})
    ok(cs["cf:bestly.tech:dangling_cname"]["result"] == "skip", "tunnel list denied: skip, not a verdict")
    ok(all(sa.cf_takeover_prone(t) for t in ("x.vercel-dns.com", "a.vercel.app", "u.github.io", "a.herokuapp.com", "a.azurewebsites.net",
                                            "d1.cloudfront.net", "b.s3.amazonaws.com", "b.s3-website-us-east-1.amazonaws.com",
                                            "a.netlify.app", "a.pages.dev", "a.workers.dev")), "takeover-prone list")
    ok(not sa.cf_takeover_prone("mail.example.org") and not sa.cf_takeover_prone("ec2.amazonaws.com"), "other hosts are not takeover-prone")


def test_cf_ssl_members_tokens():
    print("cloudflare: SSL, members, tokens")
    w, cs = cf_run(cf_ssl={"z1": "flexible", "z2": "full"})
    ok(cs["cf:bestly.tech:ssl_mode"]["result"] == "red" and cs["cf:hoku-clean.com:ssl_mode"]["result"] == "yellow", "flexible red, full yellow")
    w, cs = cf_run(cf_ssl={"z1": "off", "z2": "strict"})
    ok(cs["cf:bestly.tech:ssl_mode"]["result"] == "red", "off is red")
    w, cs = cf_run(cf_tls={"z1": "1.0", "z2": "1.2"})
    c = cs["cf:bestly.tech:ssl_mode"]
    ok(c["result"] == "yellow" and c["evidence"] == {"ssl": "strict", "min_tls_version": "1.0"}, "min TLS below 1.2 is yellow, both values in evidence")
    w, cs = cf_run(cf_ssl={"z1": "flexible", "z2": "strict"}, cf_tls={"z1": "1.0", "z2": "1.2"})
    ok(cs["cf:bestly.tech:ssl_mode"]["result"] == "red" and cs["cf:bestly.tech:ssl_mode"]["evidence"]["min_tls_version"] == "1.0", "worst wins, both in evidence")
    w, cs = cf_run(cf_deny={"settings/min_tls_version"})
    ok(cs["cf:bestly.tech:ssl_mode"]["result"] == "skip", "half-read settings are skip, not pass")

    w, cs = cf_run(cf_members=[{"status": "accepted", "user": {"email": CF_EMAIL}}, {"status": "accepted", "user": {"email": "b@example.com"}}])
    ok(cs["cf:account:members"]["result"] == "red", "2 members is red")
    w, cs = cf_run(cf_members=[{"status": "accepted"}, {"status": "accepted"}, {"status": "accepted"}], cf_page_size=1)
    ok(cs["cf:account:members"]["result"] == "red" and cs["cf:account:members"]["evidence"]["members"] == 3, "pagination: all pages counted")
    ok(sum(1 for _, p in w.cf_calls if p == "/accounts/acct1/members") == 3, "three member pages fetched")
    w, cs = cf_run(cf_members=[{"status": "accepted"}, {"status": "pending"}])
    ok(cs["cf:account:members"]["result"] == "yellow", "a pending invite is yellow")
    w, cs = cf_run(cf_zones=[{"id": "z%d" % i, "name": "z%d.com" % i} for i in range(1, 4)], cf_page_size=1,
                   cf_routes={"z1": [], "z2": [], "z3": []}, cf_cnames={"z1": [], "z2": [], "z3": []},
                   cf_ssl={"z1": "strict", "z2": "strict", "z3": "strict"}, cf_tls={"z1": "1.2", "z2": "1.2", "z3": "1.2"})
    ok({"cf:z1.com:ssl_mode", "cf:z2.com:ssl_mode", "cf:z3.com:ssl_mode"} <= set(cs), "zones list paginates")
    w, cs = cf_run(cf_accounts=[{"id": "acct1"}, {"id": "acct2"}])
    ok(cs["cf:account:count"]["result"] == "yellow", "two accounts is yellow")

    risky = cf_tok("tok-b", "ci deploy", ["Workers Scripts Write"])
    w, cs = cf_run(cf_tokens=[w.cf_tokens[0], risky])
    c = cs["cf:token:scope"]
    ok(c["result"] == "yellow" and c["evidence"]["flagged_tokens"] == ["ci deploy"], "a write token with no IP restriction is yellow, by name")
    ok("tok-b" not in json.dumps(c) and "tok-audit" not in json.dumps(c), "token ids never appear in the check")
    noexp = cf_tok("tok-c", "dns bot", ["DNS Edit"], ip=True, expires=None)
    w, cs = cf_run(cf_tokens=[w.cf_tokens[0], noexp])
    ok(cs["cf:token:scope"]["result"] == "yellow", "a write token with no expiry is yellow")
    safe = cf_tok("tok-d", "locked", ["DNS Edit"], ip=True)
    w, cs = cf_run(cf_tokens=[w.cf_tokens[0], safe])
    ok(cs["cf:token:scope"]["result"] == "pass", "a write token with IP restriction and expiry passes")
    w, cs = cf_run(cf_tokens=[cf_tok("tok-audit", "Bestly audit", ["Zone Read", "DNS Edit"], ip=True)])
    ok(cs["cf:token:scope"]["result"] == "red", "the audit's own token with a write permission is red")
    soon = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    w, cs = cf_run(cf_verify={"id": "tok-audit", "status": "active", "expires_on": soon})
    ok(cs["cf:token:scope"]["result"] == "yellow", "own token expiring within 14 days is yellow")
    w, cs = cf_run(cf_deny={"/user/tokens"} )
    ok(cs["cf:token:scope"]["result"] == "skip", "tokens endpoints denied is skip")
    w = FakeWorld()
    orig = w.cloudflare
    w.cloudflare = lambda m, u, h, p: (403, {"success": False}) if "/user/tokens?" in u else orig(m, u, h, p)
    res, err, out = run(w)
    c = cf_keys(w)["cf:token:scope"]
    ok(c["result"] == "skip" and "API Tokens Read" in c["detail"], "list denied (verify ok) is skip naming API Tokens Read")
    w, cs = cf_run(cf_verify={"id": "tok-audit", "status": "expired"})
    ok(cs["cf:token:scope"]["result"] == "yellow", "an inactive audit token is flagged")


def test_cf_secrets():
    print("cloudflare: secrets")
    w, cs = cf_run(cf_workers=OWNED + ["x"], cf_tokens=[cf_tok("tok-audit", "a", ["DNS Edit"]), cf_tok("tok-b", "b", ["DNS Edit"])],
                   cf_routes={"z1": [{"pattern": "bestly.tech/*", "script": "s", "request_limit_fail_open": False}], "z2": []})
    res, err, out = run(w)
    blob = json.dumps(w.rpc) + json.dumps(w.patches) + out + (res or "")
    ok(CTOKEN not in blob, "the Cloudflare token is never in a db payload, the log or the summary")
    ok(CF_EMAIL not in blob and CF_ACCOUNT_NAME not in blob, "member emails and the account name are dropped")
    ok("tok-b" not in blob and "tok-audit" not in blob, "token ids are never stored")
    pure = json.dumps([sa.cf_token_check({"id": "i", "status": "active"}, [sa.cf_token_row(cf_tok("i", "n", ["DNS Edit"]))], datetime.now(timezone.utc))])
    ok(CTOKEN not in pure, "token check output is names only")
    ok(all(m == "GET" or p == "/graphql" for m, p in w.cf_calls), "GET only, except the read-only GraphQL POST")
    ok(sum(1 for m, _ in w.cf_calls if m == "POST") >= 1, "the GraphQL POST was used")


def test_cf_missing_perm_for_discovery():
    print("cloudflare: partial permissions")
    w, cs = cf_run(cf_deny={"/zones"})
    ok(cs["cf:account:zones"]["result"] == "skip" and "Zone Read" in cs["cf:account:zones"]["detail"], "zone list denied: one skip naming Zone Read")
    ok(not any(":ssl_mode" in k or ":worker_routes" in k for k in cs), "no per-zone verdicts without the zone list")
    ok(cs["cf:account:members"]["result"] == "pass", "account-level checks still run")
    w, cs = cf_run(cf_deny={"/members"})
    ok(cs["cf:account:members"]["result"] == "skip" and "Account Settings Read" in cs["cf:account:members"]["detail"], "members denied is skip")



# =========================================================================================================
# Ares 2.0 regression tests (2026-10-21). Each LESSON test reproduces a miss from the post-mortem
# (bestly_memory house/security/ares-miss-2026-10-21). They use REAL temporary git repos, and every fake secret is
# assembled at run time from fragments, so this file itself holds nothing that looks like a credential.
# =========================================================================================================
import base64  # noqa: E402
import re  # noqa: E402
import importlib.util  # noqa: E402
import shutil  # noqa: E402
import stat  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402

import atexit  # noqa: E402
import security_audit_ares2 as a2  # noqa: E402
import security_audit_cve as cv  # noqa: E402

LESSON_RESULTS = {}
GIT_ENV = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com", GIT_COMMITTER_NAME="t",
               GIT_COMMITTER_EMAIL="t@example.com", GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null")


def _b64(d):
    return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")


def fake_jwt(role, ref=None, tag="a"):
    return ".".join(["eyJ" + _b64({"alg": "HS256", "typ": "JWT"})[3:], _b64({"role": role, "ref": ref or sa.BESTLY_REF, "iat": 1700000000, "t": tag}),
                     "sigAB12cd_-" * 4])


def fake_github_pat():
    return "github_" + "pat_" + "A1b2C3d4E5" * 5


def fake_stripe():
    return "sk_" + "live_" + "9aZ8bY7cX6dW5eV4fU3gT2hS"


def fake_sb_secret():
    return "sb_" + "secret_" + "Qw3rTy9uIo2pAs5dFg8hJk1lZx4cVb7n"


def fake_generic():
    return "k7Q2mX9vB4nL8sD3" + "fG6hJ1pR5tY0wZ2c"


def git(cwd, *args):
    subprocess.run(["git", "-C", cwd] + list(args), check=True, capture_output=True, env=GIT_ENV)


def build_repo(root, steps):
    """steps: a list of {path: text or None (delete)}; one commit each. -> root"""
    os.makedirs(root)
    git(root, "init", "-q", "-b", "main")
    for i, step in enumerate(steps):
        for path, text in step.items():
            p = os.path.join(root, path)
            if text is None:
                os.remove(p)
            else:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "w") as fh:
                    fh.write(text)
        git(root, "add", "-A")
        git(root, "commit", "-q", "-m", "c%d" % i)
    return root


def head_only_scan(path):
    """What web_checks.check_repo used to do: look at files in HEAD only."""
    files = subprocess.run(["git", "-C", path, "ls-files"], capture_output=True, text=True, check=True, env=GIT_ENV).stdout.split("\n")
    found = {}
    for f in files:
        if f:
            for ln in open(os.path.join(path, f), errors="ignore").read().split("\n"):
                a2.scan_line(ln, f, "HEAD", "x", found)
    return found


class AresWorld(FakeWorld):
    """FakeWorld plus the GitHub API, Supabase auth probes, edge-function gates and the Ares 2.0 RPCs."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.gh_repos = [{"name": "bestlytech", "private": False, "size": 1000, "visibility": "public"}]
        self.gh_token = "ghtoken-for-tests-" + "Z" * 20
        self.gh_list_status = 200
        self.admin_status, self.settings_status = 200, 200      # int, or "error" for a network failure
        self.fp_live = {}                                       # fingerprint -> source; None = RPC not installed
        self.memory = {a2.ALLOWLIST_KEY: "Bestly-LLC/nextcloud-talk-transcripts is an open-source plugin with 0 secrets",
                       a2.LESSONS_KEY: a2.lessons_body()}
        self.gates = {}                                         # function -> (baseline status, status when a candidate key is sent)
        self.prior_findings = []
        self.liveness_rows, self.liveness_states, self.alerts, self.probe_log = [], [], [], []

    def _status(self, v):
        if v == "error":
            raise sa.ApiError("GET fake: network error (URLError)")
        return v

    def __call__(self, method, url, headers=None, body=None, timeout=60, tries=1):
        if url.startswith("https://api.github.com/"):
            self.calls.append((method, url))
            auth = (headers or {}).get("Authorization", "")
            if "/orgs/Bestly-LLC/repos" in url:
                if self.gh_list_status != 200:
                    return self.gh_list_status, {"message": "x"}
                rows = [r for r in self.gh_repos if (auth == "Bearer " + self.gh_token) or not r["private"]]
                return 200, [dict(r, archived=False, fork=False) for r in rows]
            if url.endswith("/user"):
                return (200, {"login": "bot"}) if auth == "Bearer " + self.gh_token else (401, {"message": "Bad credentials"})
            raise AssertionError("unexpected github call " + url)
        if ".supabase.co/auth/v1/admin/users" in url:
            self.calls.append((method, url))
            assert method == "GET", "liveness probes are read-only"
            self.probe_log.append(("admin_users", dict((headers or {}))))
            return self._status(self.admin_status), None
        if ".supabase.co/auth/v1/settings" in url:
            self.calls.append((method, url))
            self.probe_log.append(("settings", dict((headers or {}))))
            return self._status(self.settings_status), None
        if ".supabase.co/functions/v1/" in url:
            self.calls.append((method, url))
            fn = url.rsplit("/", 1)[1]
            base, with_key = self.gates.get(fn, (404, 404))
            assert body in (b"", None), "gate probes send an EMPTY body"
            hs = dict((headers or {}))
            sent_key = any(k.lower() != "content-type" for k in hs)
            self.probe_log.append(("gate:" + fn, hs))
            return (with_key if sent_key else base), None
        if url.startswith(sa.SUPABASE_API) and "/analytics/" in url:
            self.calls.append((method, url))
            return 404, None
        return super().__call__(method, url, headers, body, timeout, tries)

    def db_rpc(self, name, p):
        if name == "security_fp_live":
            return (200, self.fp_live) if self.fp_live is not None else (404, {"message": "Could not find the function"})
        if name == "security_secret_liveness_put":
            self.liveness_rows += p["p_rows"]
            self.liveness_states += p["p_states"]
            return 200, {"rows": len(p["p_rows"])}
        if name == "bestly_raise":
            self.alerts.append(p)
            return 200, {"ok": True}
        if name in ("security_github_token", "get_github_token"):
            return 200, self.gh_token
        return super().db_rpc(name, p)

    def db_get(self, path):
        if path.startswith("bestly_memory") and "area=eq.house" in path:
            key = urllib.parse.unquote(path.split("key=eq.")[1].split("&")[0])
            return 200, ([{"body": self.memory[key]}] if key in self.memory else [])
        if path.startswith("security_findings?select=key,severity"):
            return 200, self.prior_findings
        return super().db_get(path)


_QUIET_DIR = []


def quiet_cve(world, db):
    """A CveWatch for the L1-L6 tests: a Pi whose docker answers with no containers and whose other commands do not exist,
    so nothing reaches the network, the real docker, or /opt/bestly. L7-L9 build their own, with real fakes."""
    if not _QUIET_DIR:
        _QUIET_DIR.append(tempfile.mkdtemp(prefix="ares-cve-"))
        atexit.register(shutil.rmtree, _QUIET_DIR[0], True)

    def runner(cmd, timeout):
        return (0, "", "") if cmd[:2] == ["docker", "ps"] else (127, "", "no such command")
    return cv.CveWatch(world, runner, db, state_dir=_QUIET_DIR[0], now=lambda: datetime.now(timezone.utc), logf=lambda m: None,
                       sleep=lambda s: None, exists=lambda p: False)


def ares_make(world, repo_src, extra_repos=None, token=None, gl="/nonexistent/gitleaks", web_extra=None, selftest_path="/nonexistent", cve=None):
    """A Ctx wired to fakes: ctx.clone / ares.clone copy prepared repos instead of calling GitHub."""
    db = sa.Db(BASE, "service-role-key-not-real", api=world)
    repos = dict(extra_repos or {})
    repos["bestlytech"] = repo_src

    def clone_one(name, dest, tok):
        shutil.copytree(repos[name], dest)
        return True

    def fake_web(hosts, apexes, mail_domains, repo, timeout=0):
        items, err = fake_web_factory(world)(hosts, apexes, mail_domains, repo)
        return items + (web_extra or []), err
    ares = a2.Ares(db, world, world.gh_token if token is None else token, STOKEN, clone=clone_one, gitleaks=gl,
                   logf=lambda m: None, selftest_path=selftest_path, cve=cve if cve is not None else quiet_cve(world, db))
    return sa.Ctx(db, VTOKEN, STOKEN, api=world, web=fake_web, clone=lambda d: clone_one("bestlytech", d, None), cf_token=CTOKEN,
                  resolve=world.resolve, ares=ares), ares


def ares_run(world, repo_src, live=True, **kw):
    ctx, ares = ares_make(world, repo_src, **kw)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            res = sa.run_audit(ctx, Args(), live, {})
            err = None
        except Exception as exc:  # noqa: BLE001
            res, err = None, exc
    return res, err, out.getvalue(), ares


def leak_repo(tmp, jwt=None, name="r1"):
    """THE ORIGINAL MISS: a service_role key is committed, then the file is deleted. HEAD is clean; history is not."""
    jwt = jwt or fake_jwt("service_role")
    return build_repo(os.path.join(tmp, name), [
        {"README.md": "hello\n", "scripts/.env.pi": "SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=%s\n" % jwt},
        {"scripts/.env.pi": None},
    ]), jwt


def key_check(world, key):
    return by_key(batch_checks(world)).get(key)


def lesson(lid, passed):
    LESSON_RESULTS[lid] = "ok" if passed else "FAIL"
    print("LESSON %s %s" % (lid, "ok" if passed else "FAIL"))


# --------------------------------------------------------------------------------------- L1: fixed means dead
def test_L1_fixed_means_dead():
    print("L1 fixed means dead (the 2026-10-21 miss, reproduced)")
    before = len(FAILS)
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        repo, jwt = leak_repo(tmp)
        key = "code:bestlytech:secret:supabase_service_role_key"
        ok(not head_only_scan(repo), "reproduction: a HEAD-only scan sees NOTHING (the file is gone), which is how it was auto-closed")
        # the old scan's `pass` for that key must never reach the database
        old_pass = [{"key": key, "result": "pass", "layer": "Code", "asset": "github:bestlytech", "check": "secret_scan"}]
        # (a) still works -> red (and a finding marked fixed reopens: red on an existing key is 'reopened' by security_check)
        w = AresWorld()
        res, err, out, _ = ares_run(w, repo, web_extra=old_pass)
        ok(err is None, "run succeeds (%s)" % err)
        c = key_check(w, key)
        ok(c and c["result"] == "red", "still-live key found in HISTORY is RED although it is not in HEAD")
        ok(sum(1 for x in batch_checks(w) if x["key"] == key) == 1, "the old HEAD-only `pass` for that key is dropped, one verdict only")
        ok(c["evidence"]["live"][0]["masked"] == a2.mask(jwt) and jwt not in json.dumps(c), "evidence is masked: first 4 chars plus length, never the value")
        blob = json.dumps(w.rpc) + json.dumps(w.patches) + out + (res or "")
        ok(jwt not in blob and jwt.split(".")[1] not in blob and jwt.split(".")[2] not in blob, "no part of the secret reaches a db payload, the log or the summary")
        ok(any(n == "admin_users" and h.get("apikey") == jwt for n, h in w.probe_log), "probe is GET /auth/v1/admin/users with the key itself")
        ok(w.liveness_rows and w.liveness_rows[0]["live"] is True and set(w.liveness_rows[0]) == {"fingerprint", "type", "live"}
           and len(w.liveness_rows[0]["fingerprint"]) == 64, "liveness row is {fingerprint, type, live} only")
        st = [s for s in w.liveness_states if s["key"] == key][0]
        ok(st["live_count"] == 1, "per-finding state says 1 live (this is what lets a close be refused)")
        # (b) provably dead -> pass
        w = AresWorld()
        w.admin_status = 401
        res, err, out, _ = ares_run(w, repo)
        c = key_check(w, key)
        ok(err is None and c["result"] == "pass", "401 from the probe: dead, so pass (the ONLY way to close)")
        ok([s for s in w.liveness_rows if s["type"] == "supabase_jwt"][0]["live"] is False, "dead is recorded as live=false")
        # (c) cannot tell -> skip, never pass
        w = AresWorld()
        w.admin_status = "error"
        res, err, out, _ = ares_run(w, repo)
        c = key_check(w, key)
        ok(err is None and c["result"] == "skip", "probe unreachable: skip, NEVER pass (a pass closes the finding)")
        w = AresWorld()
        w.admin_status = 500
        res, err, out, _ = ares_run(w, repo)
        ok(key_check(w, key)["result"] == "skip", "HTTP 500 from the probe: skip, not pass")
        # (d) absence is not proof: no hits but an open red finding -> skip
        cs, states = a2.history_checks("bestlytech", [], {key: {"key": key, "severity": "red"}}, "regex", "public")
        gone = [c for c in cs if c["key"] == key][0]
        ok(gone["result"] == "skip", "history rewritten, key no longer found, finding still open red: skip, not pass")
        cs, _ = a2.history_checks("bestlytech", [], {}, "regex", "public")
        ok([c for c in cs if c["key"] == key][0]["result"] == "pass", "nothing found and nothing open is a pass")
        # (e) kinds with no probe: matches something live -> red; matches nothing -> dead; cannot ask -> skip
        gen = fake_generic()
        repo2 = build_repo(os.path.join(tmp, "r2"), [
            {"supabase/functions/gate/index.ts": 'const INTAKE_TOKEN = "%s";\n' % gen}, {"supabase/functions/gate/index.ts": "// moved to vault\n"}])
        gk = "code:bestlytech:secret:hardcoded_function_key"
        w = AresWorld()
        w.fp_live = {a2.sha256(gen): "vault"}
        ares_run(w, repo2)
        ok(key_check(w, gk)["result"] == "red", "gate token whose sha256 matches a live Vault secret is RED (INTAKE_TOKEN, the one that slipped through)")
        w = AresWorld()
        w.fp_live = {}
        ares_run(w, repo2)
        ok(key_check(w, gk)["result"] == "pass", "matches nothing live and no gate accepts it: dead, pass")
        w = AresWorld()
        w.fp_live = {}
        w.gates = {"gate": (401, 422)}
        ares_run(w, repo2)
        ok(key_check(w, gk)["result"] == "red", "edge-function gate answers past the 401 with an empty body: accepted, RED")
        w = AresWorld()
        w.fp_live = {}
        w.gates = {"gate": (401, 401)}
        ares_run(w, repo2)
        ok(key_check(w, gk)["result"] == "pass", "edge-function gate keeps answering 401: dead")
        w = AresWorld()
        w.fp_live = None
        ares_run(w, repo2)
        ok(key_check(w, gk)["result"] == "skip", "server-side hash check unavailable: skip, never pass")
        r = a2.Secret(gen, "assignment", "generic_secret_assignment")
        ok(r.fp == a2.sha256(gen) and a2.mask(gen) == gen[:4] + "[%d]" % len(gen), "fingerprint is sha256, mask is 4 chars plus length")
        ok(all(v["result"] != "pass" for k, v in by_key(batch_checks(w)).items()
               if re.match(r"^code:[^:]+:secret:", k) and v["evidence"].get("unknown")), "no secret finding with an unprovable credential is a pass")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lesson("L1", len(FAILS) == before)


# ------------------------------------------------------------------------ L2: full history, broad patterns
def test_L2_history_and_names():
    print("L2 full history and name/format based patterns")
    before = len(FAILS)
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        sec = {"pat": fake_github_pat(), "stripe": fake_stripe(), "sbs": fake_sb_secret(), "gen": fake_generic(), "pw": "Zx9!kQ2mLp7vR4t"}
        files = {
            "app/widget.py": 'MYAPP_WIDGET_TOKEN = "%s"\n' % sec["gen"],
            "ops/run.sh": "curl -u deploy:%s https://example.com/api\n" % sec["pw"],
            "cfg/keys.json": json.dumps({"stripe": sec["stripe"], "gh": sec["pat"], "sb": sec["sbs"]}) + "\n",
            "x/.env": 'API_KEY="your-api-key-here-12345"\nSECRET_KEY=process.env.SOMETHING_ELSE_ENTIRELY\nSUPABASE_SERVICE_ROLE_KEY="SUPABASE_SERVICE_ROLE_KEY"\n',
            "x/hash.ts": 'const KEY_SHA256 = "%s";\n' % ("ab" * 32),
        }
        repo = build_repo(os.path.join(tmp, "h"), [files, {p: None for p in ("app/widget.py", "ops/run.sh", "cfg/keys.json")}])
        ok(not [r for r in head_only_scan(repo).values()], "reproduction: HEAD holds none of the deleted secrets and no false positives")
        found, commits, err = a2.scan_history(repo, "h")
        vals = set(r.fp for r in found.values())
        for nm, v in sec.items():
            ok(a2.sha256(v) in vals, "history scan finds the deleted %s" % nm)
        by_fp = dict((r.fp, r) for r in found.values())
        ok(by_fp[a2.sha256(sec["gen"])].label == "generic_secret_assignment", "MYAPP_WIDGET_TOKEN (a name no fixed list knew) is caught by the name rule")
        ok(by_fp[a2.sha256(sec["stripe"])].label == "stripe_live_secret_key" and by_fp[a2.sha256(sec["pat"])].label == "github_token"
           and by_fp[a2.sha256(sec["sbs"])].label == "supabase_secret_key", "format rules label stripe, github_pat and sb_secret")
        ok(by_fp[a2.sha256(sec["pw"])].label == "basic_auth_in_command", "curl -u user:pass is caught")
        ok(len(found) == 5, "placeholders, env references, names-as-values and sha256 hashes are not secrets (%d found)" % len(found))
        ok(err is None and commits == 2, "both commits read, all refs (%s, %s)" % (commits, err))
        repo2 = build_repo(os.path.join(tmp, "d"), [{"a.py": 'WIDGET_KEY = "%s"\n' % sec["gen"]}, {"b.py": 'OTHER_SECRET = "%s"\n' % sec["gen"]}])
        f2, _, _ = a2.scan_history(repo2, "d")
        ok(len(f2) == 1 and list(f2.values())[0].commits == 2 and list(f2.values())[0].files == {"a.py", "b.py"}, "the same secret in two commits is one fingerprint")
        repo3 = build_repo(os.path.join(tmp, "j"), [{"k.txt": "a=%s\nb=%s\n" % (fake_jwt("anon", tag="x"), fake_jwt("service_role", tag="y"))}])
        f3, _, _ = a2.scan_history(repo3, "j")
        ok(sorted(r.label for r in f3.values()) == ["supabase_anon_key", "supabase_service_role_key"], "JWT role decoded: anon and service_role told apart")
        gl = os.path.join(tmp, "gitleaks")
        with open(gl, "w") as fh:
            fh.write('#!/bin/sh\nif [ "$1" = "version" ]; then echo 8.21.0; exit 0; fi\n'
                     'printf \'[{"RuleID":"generic-api-key","Secret":"%s","File":"z/app.py","Commit":"abcdef0123456789","StartLine":3}]\'\n' % ("gl" + sec["gen"][2:]))
        os.chmod(gl, os.stat(gl).st_mode | stat.S_IEXEC)
        f4 = {}
        n, gerr = a2.run_gitleaks(repo, "h", f4, binpath=gl)
        ok(gerr is None and n == 1 and list(f4.values())[0].engine == "gitleaks", "gitleaks output is merged (parsed in memory, never written to disk)")
        n, gerr = a2.run_gitleaks(repo, "h", {}, binpath=os.path.join(tmp, "missing"))
        ok(n == 0 and gerr and "not installed" in gerr, "a missing gitleaks is an error string, never silence")
        w = AresWorld()
        w.admin_status = 401
        ares_run(w, repo)
        ok(key_check(w, "ares:gitleaks:available")["result"] == "yellow", "no gitleaks on the box is a yellow finding (regex fallback ran)")
        w = AresWorld()
        w.admin_status = 401
        ares_run(w, repo, gl=gl)
        ok(key_check(w, "ares:gitleaks:available")["result"] == "pass", "with gitleaks installed the engine check passes")
        ok(key_check(w, "code:bestlytech:secret:github_token")["evidence"]["engine"] == "gitleaks+regex", "evidence says which engine ran")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lesson("L2", len(FAILS) == before)



# ----------------------------------------------------------------------------- L3: public repo is red
def test_L3_public_repo_red():
    print("L3 repo visibility (a public repo is red unless allowlisted)")
    before = len(FAILS)
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        allow = a2.parse_allowlist("Bestly-LLC/nextcloud-talk-transcripts is an open-source plugin")
        repos = [{"name": "bestlytech", "private": False, "archived": False, "fork": False},
                 {"name": "nextcloud-talk-transcripts", "private": False, "archived": False, "fork": False},
                 {"name": "internal", "private": True, "archived": False, "fork": False}]
        cs = by_key(a2.visibility_checks(repos, allow))
        ok(cs["repo:bestlytech:visibility"]["result"] == "red", "a public repo that is not allowlisted is RED (this is what Ares never checked)")
        ok(cs["repo:nextcloud-talk-transcripts:visibility"]["result"] == "pass" and cs["repo:nextcloud-talk-transcripts:visibility"]["evidence"]["allowlisted"],
           "an allowlisted public repo passes")
        ok(cs["repo:internal:visibility"]["result"] == "pass", "a private repo passes")
        ok(a2.parse_allowlist("Bestly-LLC/x_y.z, bestly-llc/B") == {"bestly-llc/x_y.z", "bestly-llc/b"}, "allowlist parse is case-insensitive")
        repo, _ = leak_repo(tmp)
        w = AresWorld()
        w.gh_repos = [{"name": "bestlytech", "private": False, "size": 10}, {"name": "nextcloud-talk-transcripts", "private": False, "size": 10},
                      {"name": "secret-tool", "private": True, "size": 10}]
        other = build_repo(os.path.join(tmp, "o1"), [{"README.md": "x\n"}])
        other2 = build_repo(os.path.join(tmp, "o2"), [{"README.md": "x\n"}])
        res, err, out, _ = ares_run(w, repo, extra_repos={"nextcloud-talk-transcripts": other, "secret-tool": other2})
        ok(err is None, "run succeeds (%s)" % err)
        ok(key_check(w, "repo:bestlytech:visibility")["result"] == "red", "full run: bestlytech public is RED")
        ok(key_check(w, "repo:nextcloud-talk-transcripts:visibility")["result"] == "pass", "full run: allowlisted plugin repo passes")
        ok(key_check(w, "code:secret-tool:secret:github_token")["result"] == "pass", "every org repo gets its own history scan (private one included)")
        ok(key_check(w, "code:nextcloud-talk-transcripts:secret:github_token")["result"] == "pass", "the plugin repo is scanned too")
        ok(any(c[1].startswith("https://api.github.com/orgs/Bestly-LLC/repos") for c in w.calls), "the org repo list is read")
        # allowlist note missing: the seed (nextcloud-talk-transcripts) still applies, bestlytech is still red
        w = AresWorld()
        del w.memory[a2.ALLOWLIST_KEY]
        ares_run(w, repo)
        ok(key_check(w, "repo:bestlytech:visibility")["result"] == "red", "no allowlist note: still red")
        # org list unreachable: one skip, the main repo is still scanned
        w = AresWorld()
        w.gh_list_status = 503
        res, err, out, _ = ares_run(w, repo)
        ok(key_check(w, "repo:org:inventory")["result"] == "skip", "org list failure is a skip, never a pass")
        ok(key_check(w, "code:bestlytech:secret:supabase_service_role_key")["result"] == "red", "the main repo is still scanned when the list fails")
        # no token: anonymous listing still reports public repos, and the blind spot is named
        w = AresWorld()
        w.gh_repos.append({"name": "hidden", "private": True, "size": 1})
        res, err, out, _ = ares_run(w, repo, token="")
        ok(key_check(w, "repo:bestlytech:visibility")["result"] == "red", "no GitHub token: the public repo is still caught")
        ok("private repos (token missing)" in json.dumps(w.patches), "no GitHub token is listed as unverified")
        ok(all("hidden" not in json.dumps(c) for c in batch_checks(w)), "private repos are not invented when the token is missing")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lesson("L3", len(FAILS) == before)


# ------------------------------------------------------------------------------------- L4: legacy keys
def test_L4_legacy_keys():
    print("L4 legacy Supabase keys")
    before = len(FAILS)
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        mk = lambda role, live: _mk_secret(fake_jwt(role, tag=role + str(live)), role, live)  # noqa: E731
        svc, anon = mk("service_role", True), mk("anon", True)
        c = a2.legacy_check([svc], True, {"total": 1000, "legacy": 10})
        ok(c["result"] == "red" and "1.0%" in c["detail"], "accepted and a legacy key in history: RED, with the legacy traffic share")
        ok(a2.legacy_check([], True, None)["result"] == "yellow", "accepted but not seen anywhere: yellow")
        ok(a2.legacy_check([svc], False, None)["result"] == "pass", "rejected by the project: pass")
        ok(a2.legacy_check([], None, None)["result"] == "skip", "could not test: skip, not pass")
        ok(a2.legacy_check([anon], True, None)["result"] == "red", "a legacy anon key in a repo while accepted is red too")
        repo, jwt = leak_repo(tmp)
        w = AresWorld()
        res, err, out, _ = ares_run(w, repo)
        c = key_check(w, "supa:Bestly:legacy_keys")
        ok(c["result"] == "red" and c["layer"] == "Database (Supabase)", "full run: legacy keys accepted + service_role in public history is RED")
        w = AresWorld()
        w.admin_status = 401
        res, err, out, _ = ares_run(w, repo)
        ok(key_check(w, "supa:Bestly:legacy_keys")["result"] == "pass", "full run: once the project rejects legacy keys it passes")
        anon_repo = build_repo(os.path.join(tmp, "a"), [{"site.js": 'const A = "%s";\n' % fake_jwt("anon", tag="s")}, {"site.js": None}])
        w = AresWorld()
        ares_run(w, anon_repo)
        ok(key_check(w, "supa:Bestly:legacy_keys")["result"] == "red", "anon key probed through /auth/v1/settings counts as accepted")
        ok(not [k for k in by_key(batch_checks(w)) if k.endswith("supabase_anon_key") and by_key(batch_checks(w))[k]["result"] == "red"],
           "an anon key alone is never a secret finding")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lesson("L4", len(FAILS) == before)


def _mk_secret(value, role, live):
    s = a2.Secret(value, "supabase_jwt", "supabase_service_role_key" if role == "service_role" else a2.ANON_LABEL)
    s.role, s.ref, s.live = role, sa.BESTLY_REF, live
    s.repos.add("bestlytech")
    s.release()
    return s


# ------------------------------------------------------------------------- L5: coverage escalation
def test_L5_coverage_escalation():
    print("L5 coverage escalation")
    before = len(FAILS)
    now = datetime(2026, 10, 21, 19, 40, tzinfo=timezone.utc)

    def run_row(day, unv):
        return {"started_at": "2026-10-%02dT08:02:00+00:00" % day, "status": "yellow", "inventory": {"unverified": unv}}
    cf = ["Cloudflare (token missing)"]
    runs3 = [run_row(21, cf), run_row(20, cf), run_row(19, cf), run_row(18, cf)]
    items = a2.coverage_escalation(None, cf, now, runs=runs3, needs_person=[])
    ok(len(items) == 1 and "Cloudflare" in items[0] and "4 nights" in items[0], "Cloudflare unverified 3 nights running escalates (it sat quiet for 4)")
    ok(a2.coverage_escalation(None, cf, now, runs=[run_row(20, cf), run_row(19, [])], needs_person=[]) == [], "only 2 nights: not yet")
    ok(a2.coverage_escalation(None, cf, now, runs=[run_row(20, cf), run_row(19, ["Vercel (token missing)"]), run_row(18, cf)], needs_person=[]) == [],
       "the streak must be unbroken")
    ok(a2.coverage_escalation(None, [], now, runs=runs3, needs_person=[]) == [], "nothing unverified tonight: nothing to escalate")
    items = a2.coverage_escalation(None, [], now, runs=[], needs_person=[{"key": "dns:x:dmarc", "title": "x.com: no DMARC record", "nights_open": 3}])
    ok(len(items) == 1 and "x.com: no DMARC record" in items[0], "a needs_person finding older than 2 nights escalates")
    ok(a2.coverage_escalation(None, [], now, runs=[], needs_person=[]) == [], "fresh needs_person findings do not")
    # the DB query shape (3+ nights, needs_person only)
    w = AresWorld()
    w.db_get_orig = w.db_get
    w.db_get = lambda p: (200, [{"key": "a", "title": "A", "nights_open": 5, "autofix": {"state": "needs_person"}},
                                {"key": "b", "title": "B", "nights_open": 5, "autofix": {"state": "handled"}}]) \
        if p.startswith("security_findings?select=key,title,nights_open") and "nights_open=gte.3" in p else w.db_get_orig(p)
    db = sa.Db(BASE, "service-role-key-not-real", api=w)
    items = a2.coverage_escalation(db, [], now, runs=[])
    ok(items == ["A has waited on you for 5 nights."], "only needs_person findings count")
    # one push, signed by Ares (security.* is owned by security-auditor), resolves itself
    w = AresWorld()
    db = sa.Db(BASE, "service-role-key-not-real", api=w)
    ok(a2.push_escalation(db, ["Cloudflare has not been checked for 4 nights running.", "B has waited on you for 4 nights."], True) is True, "push sent")
    ok(len(w.alerts) == 1 and w.alerts[0]["p_key"].startswith("security.") and w.alerts[0]["p_area"] == "security" and w.alerts[0]["p_kind"] == "problem",
       "exactly ONE alert under the security. prefix (Ares's), not one per gap")
    ok("..." not in w.alerts[0]["p_body"] + w.alerts[0]["p_title"], "no text is cut off with ...")
    w.alerts = []
    a2.push_escalation(db, [], True)
    ok(w.alerts and w.alerts[0]["p_kind"] == "resolved", "nothing left: the alert resolves itself")
    w.alerts = []
    ok(a2.push_escalation(db, ["x"], False) is False and not w.alerts, "dry run sends nothing")
    # inside a whole run: unverified layer in tonight's run + history in the database -> a push
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        repo, _ = leak_repo(tmp)
        w = AresWorld()
        orig = w.db_get
        w.db_get = lambda p: (200, runs3[1:]) if p.startswith("security_audit_runs?select=started_at,status,inventory") else orig(p)
        res, err, out, _ = ares_run(w, repo)   # no Cloudflare token in this run? make() passes one; force the layer via a rejected token below
        w2 = AresWorld()
        orig2 = w2.db_get
        w2.db_get = lambda p: (200, runs3[1:]) if p.startswith("security_audit_runs?select=started_at,status,inventory") else orig2(p)
        ctx, ares = ares_make(w2, repo)
        ctx.cf_token = ""
        out2 = io.StringIO()
        with contextlib.redirect_stdout(out2):
            res = sa.run_audit(ctx, Args(), True, {})
        pushes = [a for a in w2.alerts if a["p_key"] == "security.coverage" and a["p_kind"] == "problem"]
        ok(len(pushes) == 1 and "Cloudflare" in pushes[0]["p_body"], "full run: Cloudflare token missing 3 nights running becomes ONE Ares push")
        ok("Escalated to Jared: 1" in res, "the run summary says it escalated")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lesson("L5", len(FAILS) == before)


# -------------------------------------------------------------------------------------------- lessons
def test_lessons_loop():
    print("learning loop: lessons are rules, loaded at the start, logged when enforced")
    ls = a2.parse_lessons(a2.lessons_body())
    ok([l[0] for l in ls] == ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9"], "the seeded lessons parse (L1 is the fixed-means-dead lesson from the post-mortem)")
    ok(ls[0][1] == "fixed_means_dead" and "still worked" in ls[0][3], "lesson 1 is seeded from the post-mortem")
    ok(all(l[1] in a2.ENFORCED_RULES for l in ls), "every seeded lesson names a rule the code enforces")
    ok(all(hasattr(sys.modules[__name__], l[2]) for l in ls), "every seeded lesson names a selftest that exists")
    cs, lines = a2.lessons_checks(ls + [("L99", "made_up_rule", "test_x", "text")], {"tests": {x[0]: "ok" for x in ls}})
    k = by_key(cs)
    ok(k["ares:lesson:L99"]["result"] == "yellow" and k["ares:lesson:L1"]["result"] == "pass", "a lesson with no enforcement is a yellow finding")
    cs, _ = a2.lessons_checks(ls, {"tests": {"L1": "FAIL"}})
    ok(by_key(cs)["ares:lesson:L1"]["result"] == "yellow", "a lesson whose selftest failed is yellow")
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        repo, _ = leak_repo(tmp)
        w = AresWorld()
        w.memory[a2.LESSONS_KEY] = a2.lessons_body() + "\nL99 | future_rule | test_future | a lesson added after a later miss"
        res, err, out, ares = ares_run(w, repo)
        ok("L1" in " ".join(ares.enforced) and "L6" in " ".join(ares.enforced), "the run records which rules it enforced")
        ok("Rules enforced: L1, L2, L3, L4, L5, L6, L7, L8, L9." in res, "...and the run summary lists them")
        ok(key_check(w, "ares:lesson:L99")["result"] == "yellow", "a lesson added to bestly_memory without code behind it is flagged")
        w = AresWorld()
        del w.memory[a2.LESSONS_KEY]
        res, err, out, ares = ares_run(w, repo)
        ok(err is None and len(ares.enforced) == 9, "bestly_memory unreachable or empty: the built-in rules still run")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------------------ authenticated clone
def test_authenticated_clone():
    print("the audit's own clone is authenticated and leaks nothing")
    tok = "ghp_" + "Test9z8y7x6w5v4u3t2s1r0q" * 2
    env = a2.git_env(tok)
    ok(env["GIT_CONFIG_VALUE_0"].startswith("Authorization: Basic ") and tok not in json.dumps(env) and
       base64.b64decode(env["GIT_CONFIG_VALUE_0"].split(" ")[-1]).decode() == "x-access-token:" + tok,
       "token travels only as an env-scoped HTTP header (base64), scoped to github.com")
    ok("GIT_CONFIG_VALUE_0" not in a2.git_env(""), "no token, no header (anonymous clone while the repo is public)")
    seen = {}
    real = subprocess.run

    def fake_run(cmd, **kw):
        seen["cmd"], seen["env"] = cmd, kw.get("env") or {}
        return subprocess.CompletedProcess(cmd, 0, "", "")
    sa.subprocess.run = fake_run
    try:
        sa.GITHUB_TOKEN[0] = tok
        ok(sa.clone_repo("/x/y") is True, "clone_repo works")
    finally:
        sa.subprocess.run = real
        sa.GITHUB_TOKEN[0] = ""
    ok(tok not in " ".join(seen["cmd"]), "the token is never in argv (visible in ps)")
    ok("--depth" not in seen["cmd"] and seen["cmd"][-2] == sa.REPO_URL, "full history, and the URL is unchanged (credential-free)")
    ok("GIT_CONFIG_VALUE_0" in seen["env"], "...it is passed in the environment")
    # the token is read server-side and validated; the value never reaches a log
    w = AresWorld()
    db = sa.Db(BASE, "service-role-key-not-real", api=w)
    ok(a2.get_github_token(db, w) == w.gh_token, "token read through the Vault RPC, validated against GitHub")
    w.gh_token_invalid = True
    db2 = sa.Db(BASE, "service-role-key-not-real", api=w)
    orig = w.db_rpc
    w.db_rpc = lambda n, p: (200, "stale-token") if n in ("security_github_token", "get_github_token") else orig(n, p)
    ok(a2.get_github_token(db2, w) == "", "a token GitHub rejects is not used")


# --------------------------------------------------------------------- unauthenticated repo consumers
def test_unauth_consumers():
    print("code that fetches a private-intended repo anonymously")
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        files = {
            "scripts/agent.py": 'URL = "https://raw.githubusercontent.com/Bestly-LLC/bestlytech/main/scripts/x.py"\nurllib.request.urlopen(URL)\n',
            "tools/install.sh": "git clone https://github.com/Bestly-LLC/bestlytech.git /opt/x\n",
            "supabase/functions/admin-chat/index.ts": 'const r = await fetch("https://raw.githubusercontent.com/Bestly-LLC/bestlytech/main/a.ts", { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });\n',
            "tools/ok.py": 'curl("https://raw.githubusercontent.com/Bestly-LLC/nextcloud-talk-transcripts/main/x")\n',
            "src/Link.tsx": '<a href="https://github.com/Bestly-LLC/bestlytech">source</a>\n',
            "docs/readme.md": "git clone https://github.com/Bestly-LLC/bestlytech.git\n",
        }
        repo = build_repo(os.path.join(tmp, "c"), [files])
        hits = a2.scan_consumers(repo, lambda name: name != "nextcloud-talk-transcripts")
        got = sorted(set(h["file"] for h in hits))
        ok(got == ["scripts/agent.py", "tools/install.sh"], "anonymous raw/clone consumers flagged; authenticated, allowlisted, plain links and docs are not (%s)" % got)
        c = a2.consumers_check("bestlytech", hits, False)
        ok(c["result"] == "yellow" and c["evidence"]["count"] == 2, "public repo: yellow, blocks going private")
        ok(a2.consumers_check("bestlytech", hits, True)["result"] == "red", "already private: red, they are failing now")
        ok(a2.consumers_check("bestlytech", [], False)["result"] == "pass", "none: pass")
        w = AresWorld()
        res, err, out, _ = ares_run(w, repo)
        ok(key_check(w, "code:bestlytech:unauth_consumers")["result"] == "yellow", "full run records the consumers check")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)



# --------------------------------------------------------------------------- L6: the selftest gate + watchdog
def load_wrapper():
    here = os.path.dirname(os.path.abspath(__file__))
    for name in ("security-audit.py",):
        p = os.path.join(here, name)
        if os.path.exists(p):
            spec = importlib.util.spec_from_file_location("security_audit_wrapper", p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise AssertionError("security-audit.py wrapper not found next to selftest")


def test_L6_selftest_gate():
    print("L6 selftest gate, retry once, Ares-signed alerts")
    before = len(FAILS)
    wr = load_wrapper()
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        state = os.path.join(tmp, "state.json")
        w = AresWorld()
        db = sa.Db(BASE, "service-role-key-not-real", api=w)
        sleeps = []
        calls = []

        def audit_fail_n(n):
            left = [n]

            def audit(argv):
                calls.append(list(argv))
                if left[0] > 0:
                    left[0] -= 1
                    raise RuntimeError("boom")
                return "YELLOW: ok"
            return audit

        def gate(argv, audit, selftest):
            calls[:] = []
            sleeps[:] = []
            w.alerts[:] = []
            return wr.run_gate(argv, audit=audit, make_db=lambda: db, selftest=selftest, sleep=sleeps.append, retry_delay=600, state_path=state)

        bad = lambda: (False, {"L1": "FAIL", "L2": "ok"}, "FAIL ...")  # noqa: E731
        good = lambda: (True, {"L1": "ok", "L2": "ok"}, "selftest passed")  # noqa: E731
        err = None
        try:
            gate([], audit_fail_n(0), bad)
        except RuntimeError as exc:
            err = exc
        ok(err is not None and "selftest" in str(err) and not calls, "a failing regression test FAILS the run and the audit does not start")
        al = [a for a in w.alerts if a["p_key"] == "security.selftest"]
        ok(len(al) == 1 and al[0]["p_kind"] == "problem" and al[0]["p_severity"] == "error" and al[0]["p_area"] == "security" and "L1" in al[0]["p_body"],
           "Ares-signed alert (security.* is owned by security-auditor) naming the failing lesson")
        ok(json.load(open(state))["passed"] is False and json.load(open(state))["tests"]["L1"] == "FAIL", "selftest result is saved for the audit to read")
        res = gate([], audit_fail_n(0), good)
        ok(res == "YELLOW: ok" and len(calls) == 1 and not sleeps, "selftest ok: the audit runs once")
        ok(any(a["p_key"] == "security.selftest" and a["p_kind"] == "resolved" for a in w.alerts), "...and the selftest alert resolves")
        ok(json.load(open(state))["passed"] is True, "state says passed")
        res = gate([], audit_fail_n(1), good)
        ok(len(calls) == 2 and sleeps == [600] and "retry" in res, "audit fails once: waits, retries ONCE, and recovers")
        ok("--force" in calls[1], "the retry is not blocked by the 6-hour duplicate guard")
        rf = [a for a in w.alerts if a["p_key"] == "security.run-failed"]
        ok(rf and rf[0]["p_kind"] == "problem" and rf[-1]["p_kind"] == "resolved", "first failure alerts Scout (Ares-signed); recovery resolves it")
        err = None
        try:
            gate([], audit_fail_n(2), good)
        except RuntimeError as exc:
            err = exc
        ok(err is not None and len(calls) == 2 and sleeps == [600], "fails twice: raised (the runner reports FAIL), never a third try")
        rf = [a for a in w.alerts if a["p_key"] == "security.run-failed" and a["p_kind"] == "problem"]
        ok(len(rf) == 2 and rf[-1]["p_severity"] == "error", "second failure escalates to error")
        err = None
        try:
            gate(["--dry"], audit_fail_n(1), good)
        except RuntimeError as exc:
            err = exc
        ok(err is not None and len(calls) == 1 and not w.alerts, "--dry: no retry, no alerts")
        # the real subprocess runner parses LESSON lines and the exit code
        script = os.path.join(tmp, "st.py")
        with open(script, "w") as fh:
            fh.write("print('LESSON L1 ok')\nprint('LESSON L2 FAIL')\nraise SystemExit(1)\n")
        okk, tests, tail = wr.run_selftest(script)
        ok(okk is False and tests == {"L1": "ok", "L2": "FAIL"}, "run_selftest reads the exit code and the LESSON lines")
        # every lesson in the seeded list has a test in this file, and the file is installed next to the audit by install.sh
        ls = a2.parse_lessons(a2.lessons_body())
        ok(all(callable(globals().get(l[2])) for l in ls), "each seeded lesson maps to a real selftest function")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lesson("L6", len(FAILS) == before)


def test_ares_failure_is_loud():
    print("an Ares 2.0 crash fails the run; it never quietly falls back to HEAD-only")
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        repo, _ = leak_repo(tmp)
        w = AresWorld()
        ctx, ares = ares_make(w, repo)

        def boom(*a, **k):
            raise ValueError("kaboom")
        ares.run = boom
        old_pass = [{"key": "code:bestlytech:secret:supabase_service_role_key", "result": "pass", "layer": "Code", "asset": "a", "check": "secret_scan"}]
        ctx.web = lambda hosts, apexes, md, repo_, timeout=0: (fake_web_factory(w)(hosts, apexes, md, repo_)[0] + old_pass, None)
        out = io.StringIO()
        err = None
        with contextlib.redirect_stdout(out):
            try:
                sa.run_audit(ctx, Args(), True, {})
            except RuntimeError as exc:
                err = exc
        fin = [p for n, p in w.rpc if n == "security_run_finish"]
        ok(err is not None and fin and fin[-1]["p_failed"] is True and "Ares 2.0 scan failed" in fin[-1]["p_summary"], "run finishes failed with a plain reason")
        ok(not any(c["key"] == "code:bestlytech:secret:supabase_service_role_key" and c["result"] == "pass" for c in batch_checks(w)),
           "and the HEAD-only scan can still not produce a pass for a secret")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_old_head_scan_never_passes():
    print("web_checks.check_repo can no longer emit a pass for a secret")
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "web_checks.py")).read() if os.path.exists(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "web_checks.py")) else None
    if src is None:
        for cand in ("../../scripts/security-audit/web_checks.py", "security_audit_web_checks.py"):
            p = os.path.join(os.path.dirname(os.path.abspath(__file__)), cand)
            if os.path.exists(p):
                src = open(p).read()
                break
    ok(src is not None, "web_checks.py found")
    body = src.split("def check_repo", 1)[1].split("# dependency audit", 1)[0]
    ok('"pass"' not in body and "'pass'" not in body, "check_repo's secret loop has no pass branch")


# =========================================================================================================
# Ares 2.1 (2026-10-24, the PHP2Shell miss): L7 stack + CVE watch, L8 dependency gate, L9 patch-lag push + self-heal.
# Everything is fake: no network, no docker, no sleeping. CveWorld answers the feeds, OSV, Nextcloud's status page
# AND plays the Pi (the runner), including a Nextcloud image that can be "pulled" and rolled back.
# =========================================================================================================
NOW = datetime(2026, 10, 24, 8, 0, tzinfo=timezone.utc)


def _sha(ch):
    return "sha256:" + ch * 64


def _eol_row(cycle, latest, released, eol, lts=False):
    return {"cycle": cycle, "latest": latest, "latestReleaseDate": released, "eol": eol, "support": False, "lts": lts}


def default_eol(php_released="2026-10-21"):
    return {
        "php": [_eol_row("8.4", "8.4.27", php_released, "2028-12-31"), _eol_row("8.3", "8.3.30", "2026-10-21", "2027-12-31")],
        "nodejs": [_eol_row("26", "26.12.1", "2026-10-20", False), _eol_row("24", "24.22.1", "2026-10-20", "2028-04-30", True),
                   _eol_row("22", "22.23.4", "2026-10-20", "2027-04-30", True), _eol_row("20", "20.20.2", "2026-03-01", "2026-04-30")],
        "nextcloud": [_eol_row("33", "33.0.1", "2026-10-01", "2027-06-01"), _eol_row("32", "32.0.6", "2026-09-01", "2026-12-01")],
        "debian": [_eol_row("13", "13.1", "2026-09-01", "2030-08-09")],
        "python": [_eol_row("3.13", "3.13.5", "2026-06-01", "2029-10-31")],
        "postgresql": [_eol_row("16", "16.10", "2026-08-14", "2028-11-09")],
        "redis": [_eol_row("7.4", "7.4.6", "2026-08-01", "2027-11-30"), _eol_row("7.2", "7.2.10", "2026-08-01", "2026-02-28")],
        "nginx": [_eol_row("1.27", "1.27.5", "2026-07-01", False)],
        "home-assistant": [_eol_row("2026.10", "2026.10.2", "2026-10-15", False)],
    }


def nvd_cve(cid, desc, published="2026-10-21T14:15:00.000", score=9.8, cpe=None):
    c = {"id": cid, "published": published, "descriptions": [{"lang": "es", "value": "x"}, {"lang": "en", "value": desc}],
         "metrics": {"cvssMetricV31": [{"cvssData": {"baseScore": score}}]}}
    if cpe:
        c["configurations"] = [{"nodes": [{"cpeMatch": [{"criteria": "cpe:2.3:a:%s:*:*:*:*:*:*:*:*:*" % cpe}]}]}]
    return c


PHP2SHELL = nvd_cve("CVE-2026-109618", "In PHP versions 8.4.0 through 8.4.26 a pre-auth heap overflow allows remote code execution (PHP2Shell).")
PHP_NOISE = [nvd_cve("CVE-2026-777", "The Foo plugin for WordPress is vulnerable to PHP Object Injection via the data parameter in all versions up to 1.2."),
             nvd_cve("CVE-2026-778", "SQL injection in Bar CMS.", cpe="barcms:bar_cms")]
NODE_BROTLI = nvd_cve("CVE-2026-2200", "A Brotli decompression flaw in Node.js allows remote code execution; fixed in 22.23.4, 24.22.1 and 26.12.1.")
KEV_NOISE = [{"cveID": "CVE-2026-1", "vendorProject": "PHPMailer", "product": "PHPMailer", "dateAdded": "2026-10-22", "vulnerabilityName": "x"},
             {"cveID": "CVE-2012-1823", "vendorProject": "PHP Group", "product": "PHP", "dateAdded": "2022-03-25", "vulnerabilityName": "old"}]
NC_LABELS = ("com.docker.compose.project=nextcloud,com.docker.compose.service=%s,com.docker.compose.project.working_dir=/mnt/ssd/apps/nextcloud,"
             "com.docker.compose.project.config_files=%s")
MAC_ROWS = [{"host": "jareds-mac-mini", "component": "node", "version": "22.23.4", "cycle": "22", "internet_facing": False,
             "source": "manual", "verified_at": "2026-10-24"},
            {"host": "jareds-mac-mini", "component": "node-system", "version": "22.14.0", "cycle": "22", "internet_facing": False,
             "source": "manual", "verified_at": "2026-10-24", "note": "/usr/local/bin/node, root-owned; needs an admin password to replace"}]


class CveWorld(object):
    """The outside world of the CVE watch. Callable like http_json (the api); .runner plays the Pi; .exists plays the filesystem."""

    def __init__(self):
        self.down = set()                  # endoflife kev nvd osv osvvuln status
        self.http, self.cmds, self.mutations, self.unexpected, self.osv_posts = [], [], [], [], []
        self.pi_node = "22.23.4"
        self.eol = default_eol()
        self.kev_extra = []
        self.nvd = {}                      # product -> raw NVD cve dicts
        self.cfg = cv.NEXTCLOUD_COMPOSE    # compose file the nextcloud container says it came from
        self.compose_exists = True
        self.local, self.running = "old", "old"
        self.remote_same = False
        self.pull_rc, self.pull_brings_new = 0, True
        self.new_breaks_status, self.new_php_same = False, False
        self.osv_vulns, self.osv_detail = {}, {}
        self.apt = ""                      # what `apt-get -s upgrade` prints on the Pi (Inst lines)
        self.gh_latest = None              # GitHub releases/latest tag for products endoflife.date lacks; None = 404

    # ---- the Pi
    def exists(self, path):
        return self.compose_exists and path == cv.NEXTCLOUD_COMPOSE

    def versions(self, which):
        php = "8.4.26" if (which == "old" or self.new_php_same) else "8.4.27"
        return {"php": php, "nc": "33.0.1" if which == "old" else "33.0.2"}

    def ps(self):
        rows = [
            {"ID": "c1", "Image": "nextcloud:33", "Names": "nextcloud", "Labels": NC_LABELS % ("nextcloud", self.cfg)},
            {"ID": "c2", "Image": "postgres:16-alpine", "Names": "nc-db", "Labels": ""},
            {"ID": "c3", "Image": "redis:7-alpine", "Names": "nc-redis", "Labels": ""},
            {"ID": "c4", "Image": "nginx:1.27-alpine", "Names": "proxy", "Labels": ""},
            {"ID": "c5", "Image": "ghcr.io/home-assistant/home-assistant:2026.10.2", "Names": "homeassistant", "Labels": ""},
            {"ID": "c6", "Image": "ghcr.io/strukturag/nextcloud-spreed-signaling:2.0.4", "Names": "signaling", "Labels": ""},
        ]
        return "\n".join(json.dumps(r) for r in rows) + "\n"

    def runner(self, cmd, timeout):
        self.cmds.append(list(cmd))
        c = list(cmd)
        out = {
            ("cat", "/etc/os-release"): 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nVERSION_ID="13"\n',
            ("cat", "/etc/debian_version"): "13.1\n", ("uname", "-r"): "6.12.47+rpt-rpi-v8\n", ("uname", "-m"): "aarch64\n",
            ("python3", "--version"): "Python 3.13.5\n", ("node", "-v"): "v%s\n" % self.pi_node, ("npm", "-v"): "10.8.2\n",
        }.get(tuple(c))
        if out is not None:
            return 0, out, ""
        if c == cv.APT_SIMULATE:
            return 0, self.apt, ""
        if c[:2] == ["docker", "ps"]:
            return 0, self.ps(), ""
        if c[:2] == ["docker", "exec"] or c[:4] == ["docker", "exec", "-u", "www-data"]:
            tail = c[-2:] if c[-1] != "--output=json" else ["occ-status"]
            name = c[4] if c[2] == "-u" else c[2]
            if name == "nextcloud" and tail == ["php", "-v"]:
                return 0, "PHP %s (cli) (built: Oct  9 2026 10:00:00) (NTS)\nCopyright (c) The PHP Group\n" % self.versions(self.running)["php"], ""
            if name == "nextcloud" and tail == ["occ-status"]:
                return 0, json.dumps({"installed": True, "version": self.versions(self.running)["nc"] + ".2",
                                      "versionstring": self.versions(self.running)["nc"], "edition": ""}), ""
            return 127, "", "executable file not found in $PATH"
        if c[:3] == ["docker", "image", "inspect"]:
            ids = (_sha("a"), _sha("b")) if self.local == "old" else (_sha("e"), _sha("f"))
            return 0, "%s [\"nextcloud@%s\"]\n" % ids, ""
        if c[:3] == ["docker", "inspect", "--format"]:
            return 0, (_sha("a") if self.running == "old" else _sha("e")) + "\n", ""
        if c[:3] == ["docker", "manifest", "inspect"]:
            ref = c[3]
            if "@" not in ref:
                return 0, json.dumps({"schemaVersion": 2, "manifests": [
                    {"digest": _sha("1"), "platform": {"architecture": "amd64", "os": "linux"}},
                    {"digest": _sha("c"), "platform": {"architecture": "arm64", "os": "linux"}}]}), ""
            cfg = (_sha("a") if self.local == "old" else _sha("e")) if self.remote_same else _sha("e")
            return 0, json.dumps({"schemaVersion": 2, "config": {"digest": cfg}}), ""
        if c[:2] == ["docker", "tag"]:
            self.mutations.append(c)
            if "-pre-ares-" in c[2]:                 # rollback: the undo tag goes back onto the tag
                self.local = "old"
            return 0, "", ""
        if c[:2] == ["docker", "compose"] and "pull" in c:
            self.mutations.append(c)
            if self.pull_rc:
                return self.pull_rc, "", "pull access denied"
            if self.pull_brings_new:
                self.local = "new"
            return 0, "", ""
        if c[:2] == ["docker", "compose"] and "up" in c:
            self.mutations.append(c)
            self.running = self.local
            return 0, "", ""
        self.unexpected.append(c)
        return 127, "", "unexpected"

    # ---- the network
    def __call__(self, method, url, headers=None, body=None, timeout=60, tries=1):
        self.http.append((method, url))
        if url.startswith("https://endoflife.date/api/"):
            if "endoflife" in self.down:
                raise sa.ApiError("GET endoflife.date: network error (URLError)")
            rows = self.eol.get(url.rsplit("/", 1)[1][:-5])
            return (200, rows) if rows is not None else (404, None)
        if url == cv.KEV_URL:
            if "kev" in self.down:
                raise sa.ApiError("GET cisa.gov: network error (URLError)")
            return 200, {"vulnerabilities": KEV_NOISE + self.kev_extra}
        if url.startswith(cv.NVD_URL):
            if "nvd" in self.down:
                return 503, None
            q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).items()}
            assert q["cvssV3Severity"] == "CRITICAL" and q["resultsPerPage"] == "50", q
            assert q["lastModStartDate"] < q["lastModEndDate"], q
            prod = [p for p, kw in cv.NVD_KEYWORD.items() if kw == q["keywordSearch"]][0]
            return 200, {"vulnerabilities": [{"cve": x} for x in self.nvd.get(prod, [])]}
        if url == cv.OSV_BATCH_URL:
            assert method == "POST" and headers["Content-Type"] == "application/json"
            if "osv" in self.down:
                raise sa.ApiError("POST osv.dev: network error (URLError)")
            qs = json.loads(body)["queries"]
            self.osv_posts.append(qs)
            return 200, {"results": [({"vulns": [{"id": i, "modified": "2026-10-01T00:00:00Z"} for i in self.osv_vulns[k]]}
                                      if k in self.osv_vulns else {}) for k in
                                     [(q["package"]["ecosystem"], q["package"]["name"], q["version"]) for q in qs]]}
        if url.startswith("https://api.osv.dev/v1/vulns/"):
            if "osvvuln" in self.down:
                raise sa.ApiError("GET osv.dev: network error (URLError)")
            vid = url.rsplit("/", 1)[1]
            return (200, self.osv_detail[vid]) if vid in self.osv_detail else (404, None)
        if url.startswith("https://api.github.com/repos/") and url.endswith("/releases/latest"):
            return (200, {"tag_name": self.gh_latest, "published_at": "2026-10-22T00:00:00Z"}) if self.gh_latest else (404, None)
        if url == cv.NEXTCLOUD_STATUS_URL:
            if "status" in self.down or (self.running == "new" and self.new_breaks_status):
                return 503, None
            return 200, {"installed": True, "maintenance": False, "version": self.versions(self.running)["nc"] + ".2"}
        raise AssertionError("unexpected call " + url)


def cve_run(cw, tmp, live=False, dry=None, state=None, paths=None, now=NOW, aw=None, mac=None):
    """One CveWatch pass against `cw`. -> (result, checks by key, unverified, inventory, alerts world, sleeps, watch)."""
    aw = aw or AresWorld()
    if mac is not None:
        with open(os.path.join(tmp, cv.EXTRA_FILE), "w") as fh:
            json.dump(mac, fh)
    sleeps = []
    watch = cv.CveWatch(cw, cw.runner, sa.Db(BASE, "service-role-key-not-real", api=aw), state_dir=tmp, now=now, logf=lambda m: None,
                        sleep=sleeps.append, exists=cw.exists)
    checks, unverified, inventory = sa.Checks(), [], {}
    res = watch.run(checks, unverified, inventory, live, paths or {}, dry=dry, state=state)
    return res, by_key(checks.items), unverified, inventory, aw, sleeps, watch


def cve_alerts(aw, kind="problem"):
    return [a for a in aw.alerts if a["p_kind"] == kind]


PHP_KEY = "stack:bestly-pi:nextcloud/php:cve"
PHP_ALERT = "security.cve.bestly-pi.nextcloud/php"


# --------------------------------------------------------------------------- L7: stack inventory + CVE watch
def test_L7_stack_cve_watch():
    print("L7 stack inventory and CVE watch (PHP2Shell went three nights unseen)")
    before = len(FAILS)
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        ok(cv.vtuple("v20.20.2") == (20, 20, 2) and cv.vtuple("8.4.26-1+deb13u1") == (8, 4, 26) and cv.vtuple("stable") is None,
           "version parse tolerates a v prefix and -suffixes")
        ok(cv.vcmp("8.4.26", "8.4.27") == -1 and cv.vcmp("v22.23.4", "22.23.4") == 0 and cv.vcmp("22.23.10", "22.23.4") == 1 and cv.vcmp("8.4", "8.4.0") == 0,
           "version compare is numeric, not text (22.23.10 > 22.23.4)")
        # ---- php 8.4.26 in the nextcloud container, fix 8.4.27 out since 10-21, an NVD critical for PHP: RED with the fix command
        cw = CveWorld()
        cw.nvd["php"] = [PHP2SHELL] + PHP_NOISE
        res, cs, unv, inv, aw, sleeps, _ = cve_run(cw, tmp)
        c = cs[PHP_KEY]
        ok(c["result"] == "red" and c["layer"] == "Stack" and c["asset"] == "bestly-pi:nextcloud/php" and c["check"] == "cve_watch",
           "php 8.4.26 behind 8.4.27 with an NVD critical: RED, key stack:<host>:<component>:cve, layer Stack")
        ok("critical CVE" in c["title"] and "8.4.27" in c["title"] and "2026-10-21" in c["title"] and "nextcloud/php 8.4.26" in c["title"],
           "the title says what is wrong and which fix is not installed")
        ok(c["evidence"]["cves"] == ["CVE-2026-109618"] and c["evidence"]["latest"] == "8.4.27" and c["evidence"]["released"] == "2026-10-21",
           "evidence is {cves, latest, released}; the WordPress 'PHP Object Injection' and the non-PHP CPE records are not PHP's")
        ok(c["fix"] == "cd /mnt/ssd/apps/nextcloud && docker compose pull nextcloud push && docker compose up -d nextcloud push",
           "the fix is the exact Nextcloud upgrade command")
        ok(cs["stack:bestly-pi:nextcloud:cve"]["result"] == "pass", "the nextcloud app itself is on latest: pass")
        ok(res["stack"]["critical"] == 1 and res["stack"]["behind"] == 1 and res["stack"]["eol"] == 0 and res["stack"]["healed"] == 0,
           "counters: 1 critical, 1 behind, 0 EOL, 0 healed (%s)" % res["stack"])
        ok(sleeps and set(sleeps) == {7} and len(sleeps) == len([1 for m, u in cw.http if u.startswith(cv.NVD_URL)]) - 1,
           "NVD calls are 7 seconds apart")
        ok(not cw.mutations and not cw.unexpected, "a dry run reads docker but never changes it (%s)" % cw.unexpected)
        # ---- the same, but from CISA KEV only
        cw = CveWorld()
        cw.kev_extra = [{"cveID": "CVE-2026-109619", "vendorProject": "PHP Group", "product": "PHP", "dateAdded": "2026-10-22", "vulnerabilityName": "PHP2Shell"}]
        res, cs, *_ = cve_run(cw, tmp)
        ok(cs[PHP_KEY]["result"] == "red" and cs[PHP_KEY]["evidence"]["cves"] == ["CVE-2026-109619"],
           "a CISA KEV entry alone is enough; PHPMailer and a 2022 PHP entry are not")
        # ---- behind, nothing critical: yellow. On latest: pass.
        cw = CveWorld()
        res, cs, *_ = cve_run(cw, tmp)
        ok(cs[PHP_KEY]["result"] == "yellow" and "behind by 1 patch release" in cs[PHP_KEY]["title"], "behind with no critical CVE: yellow, 'behind by 1 patch release'")
        cw = CveWorld()
        cw.nvd["php"] = [PHP2SHELL]
        cw.eol["php"][0]["latest"] = "8.4.26"
        res, cs, *_ = cve_run(cw, tmp)
        ok(cs[PHP_KEY]["result"] == "pass" and cs[PHP_KEY]["evidence"]["latest"] == "8.4.26" and cs[PHP_KEY]["evidence"]["cves_seen"] == ["CVE-2026-109618"],
           "the same CVE at the fixed version: pass, with {latest, cves_seen}")
        # ---- Debian-packaged python3: judged by apt, never by the upstream version (3.13.5 stays 3.13.5 with the fix backported)
        PY_KEY = "stack:bestly-pi:python3:cve"
        cw = CveWorld()
        cw.eol["python"][0]["latest"] = "3.13.17"
        cw.nvd["python"] = [{"id": "CVE-2026-99001", "published": "2026-10-21T00:00:00.000", "descriptions": [{"lang": "en", "value": "CPython 3.13 before 3.13.17 allows remote code execution"}],
                             "metrics": {"cvssMetricV31": [{"cvssData": {"baseScore": 9.8, "baseSeverity": "CRITICAL"}}]}, "configurations": []}]
        res, cs, unv, *_ = cve_run(cw, tmp)
        ok(cs[PY_KEY]["result"] == "pass" and cs[PY_KEY]["evidence"].get("packaged_by") == "Debian" and cs[PY_KEY]["evidence"].get("cves_seen") == ["CVE-2026-99001"],
           "python3 3.13.5 from Debian with nothing pending in apt: pass, even though upstream is at 3.13.17 with a critical (%s)" % cs[PY_KEY].get("title"))
        cw.apt = "Inst libpython3.13-minimal [3.13.5-2] (3.13.5-2+deb13u1 Debian-Security:13/stable-security [arm64])\nInst python3.13 [3.13.5-2] (3.13.5-2+deb13u1 Debian-Security:13/stable-security [arm64])\nInst curl [8.14.1-2] (8.14.1-2+deb13u1 Debian:13.1/stable [arm64])\n"
        res, cs, *_ = cve_run(cw, tmp)
        ok(cs[PY_KEY]["result"] == "red" and "security update waiting" in cs[PY_KEY]["title"] and "install --only-upgrade" in cs[PY_KEY]["fix"] and "python3.13" in cs[PY_KEY]["fix"] and "curl" not in cs[PY_KEY]["fix"],
           "a pending Debian-Security upgrade for python3: RED with the exact apt command (curl is not python3's)")
        cw.apt = "Inst python3.13 [3.13.5-2] (3.13.5-3 Debian:13.1/stable [arm64])\n"
        res, cs, *_ = cve_run(cw, tmp)
        ok(cs[PY_KEY]["result"] == "yellow" and "update waiting" in cs[PY_KEY]["title"], "a pending non-security Debian upgrade: yellow")
        # ---- home-assistant is not on endoflife.date (404): GitHub's latest release stands in, and the feed is not "unreachable"
        HA_KEY = "stack:bestly-pi:home-assistant:cve"
        cw = CveWorld()
        del cw.eol["home-assistant"]
        cw.gh_latest = "2026.10.3"
        res, cs, unv, *_ = cve_run(cw, tmp)
        ok(cs[HA_KEY]["result"] == "yellow" and "behind" in cs[HA_KEY]["title"] and cs[HA_KEY]["evidence"].get("source") == "github releases",
           "home-assistant 2026.10.2 vs GitHub latest 2026.10.3: yellow, behind (%s)" % cs[HA_KEY].get("title"))
        ok(not any("endoflife" in u for u in unv) and "stack:feed:endoflife" not in cs or cs["stack:feed:endoflife"]["result"] == "pass",
           "a 404 for one product is not an endoflife.date outage (%s)" % unv)
        cw.gh_latest = "2026.10.2"
        res, cs, *_ = cve_run(cw, tmp)
        ok(cs[HA_KEY]["result"] == "pass", "on GitHub's latest: pass")
        cw.gh_latest = None
        res, cs, unv, *_ = cve_run(cw, tempfile.mkdtemp(prefix="ares-t-"))     # fresh state dir: no cached GitHub answer to fall back on
        ok(HA_KEY not in cs and not any("endoflife" in u for u in unv), "a product in neither place gets no verdict and no pass, and nothing is marked unreachable")
        # ---- Node 20 on the Pi: EOL since 2026-04-30
        cw = CveWorld()
        cw.pi_node = "20.20.2"
        res, cs, *_ = cve_run(cw, tmp)
        c = cs["stack:bestly-pi:node:cve"]
        ok(c["result"] == "red" and "node 20.20.2 is end-of-life, no security fixes ship" == c["title"] and res["stack"]["eol"] == 1,
           "node 20.20.2 (cycle EOL 2026-04-30) is RED: end-of-life")
        ok("setup_24.x" in c["fix"] and "nodesource" in c["fix"], "the fix is a NodeSource line for the newest supported LTS")
        # ---- Mac mini rows (the hook for the Mac reporter): fresh row judged, stale row never treated as current
        cw = CveWorld()
        cw.nvd["nodejs"] = [NODE_BROTLI]
        res, cs, unv, inv, *_ = cve_run(cw, tmp, mac=MAC_ROWS)
        ok(cs["stack:jareds-mac-mini:node:cve"]["result"] == "pass", "mac mini node 22.23.4 verified today: pass")
        c = cs["stack:jareds-mac-mini:node-system:cve"]
        ok(c["result"] == "red" and "22.14.0" in c["title"] and "needs an admin password" in c["fix"],
           "mac mini /usr/local/bin/node 22.14.0 with the Brotli RCE out: RED, and its note says what it needs")
        stale = [dict(r, verified_at="2026-10-14") for r in MAC_ROWS]
        res, cs, unv, inv, *_ = cve_run(CveWorld(), tmp, mac=stale)
        ok("jareds-mac-mini runtimes (manual inventory stale)" in unv and unv.count("jareds-mac-mini runtimes (manual inventory stale)") == 1,
           "a manual row 10 days old is an unverified entry (L5 escalates it)")
        ok(cs["stack:jareds-mac-mini:node:cve"]["result"] == "skip" and cs["stack:jareds-mac-mini:node-system:cve"]["result"] == "skip",
           "...and is never treated as current: skip, not pass")
        # ---- inventory on the run: versions only
        mine = [r for r in inv["stack"] if r["host"] == "bestly-pi"]
        want = {("debian", "13.1"), ("kernel", "6.12.47+rpt-rpi-v8"), ("python3", "3.13.5"), ("node", "22.23.4"), ("npm", "10.8.2"), ("nextcloud", "33.0.1"),
                ("nextcloud/php", "8.4.26"), ("postgres", "16"), ("redis", "7"), ("nginx", "1.27"), ("home-assistant", "2026.10.2"),
                ("nextcloud-spreed-signaling", "2.0.4")}
        ok({(r["component"], r["version"]) for r in mine} == want, "inventory has the host runtimes and every container (%s)" % sorted({(r["component"], r["version"]) for r in mine} ^ want))
        ok(all(set(r) <= set(cv.PUBLIC_FIELDS) for r in inv["stack"]), "inventory[stack] carries versions only (no labels, commands or ids)")
        byc = {r["component"]: r for r in mine}
        ok(byc["nextcloud"]["internet_facing"] and byc["nginx"]["internet_facing"] and byc["nextcloud-spreed-signaling"]["internet_facing"]
           and byc["nextcloud/php"]["internet_facing"] and not byc["postgres"]["internet_facing"] and not byc["node"]["internet_facing"],
           "internet_facing: nextcloud, nginx and the signaling container yes; db and host runtimes no")
        ok(byc["nextcloud/php"]["cycle"] == "8.4" and byc["node"]["cycle"] == "22" and byc["nextcloud"]["source"] == "docker-exec",
           "cycle and source are filled in")
        # ---- a floating tag hides the patch level: pass, never a false 'behind'
        ok(cs["stack:bestly-pi:postgres:cve"]["result"] == "pass" and cs["stack:bestly-pi:redis:cve"]["result"] == "pass",
           "postgres:16 and redis:7 (tag shows no patch level) are not reported as behind")
        ok("stack:bestly-pi:kernel:cve" not in cs and "stack:bestly-pi:nextcloud-spreed-signaling:cve" not in cs,
           "a component no feed covers gets no verdict at all (no pass for something unchecked)")
        # ---- feeds down, nothing cached: skip + unverified, and NO CVE verdict is a pass
        tmp2 = tempfile.mkdtemp(prefix="ares-t-")
        cw = CveWorld()
        cw.down = {"endoflife", "kev", "nvd"}
        cw.nvd["php"] = [PHP2SHELL]
        res, cs, unv, inv, *_ = cve_run(cw, tmp2, mac=MAC_ROWS)
        verdicts = {k: v for k, v in cs.items() if v["check"] == "cve_watch"}
        ok(verdicts and all(v["result"] in ("skip",) for v in verdicts.values()), "feeds down and no cache: every CVE verdict is skip (%s)" % sorted(set(v["result"] for v in verdicts.values())))
        ok(not any(v["result"] == "pass" for k, v in cs.items() if k.startswith("stack:") and v["check"] in ("cve_watch", "feed_fresh")),
           "no stack verdict and no feed check is a pass")
        ok(all(cs["stack:feed:%s" % f]["result"] == "skip" for f in ("endoflife", "kev", "nvd")), "each dead feed is its own skip")
        ok({"stack CVE feed endoflife.date (unreachable)", "stack CVE feed CISA KEV (unreachable)", "stack CVE feed NVD (unreachable)"} <= set(unv),
           "each dead feed is an unverified entry")
        ok(res["stack"]["critical"] == 0 and res["stack"]["behind"] == 0, "nothing is counted as fine or as a finding")
        # ---- a cache 2 days old stands in for a dead feed, with a yellow 'feed stale'
        tmp3 = tempfile.mkdtemp(prefix="ares-t-")
        cw = CveWorld()
        cw.nvd["php"] = [PHP2SHELL]
        cve_run(cw, tmp3, now=NOW - timedelta(days=2))
        ok(all(os.path.exists(os.path.join(tmp3, "cve_feeds", n)) for n in ("endoflife-php.json", "kev.json", "nvd-php.json")),
           "every feed response is cached under state/cve_feeds/<name>.json")
        cw2 = CveWorld()
        cw2.down = {"endoflife", "kev", "nvd"}
        res, cs, unv, *_ = cve_run(cw2, tmp3)
        ok(cs[PHP_KEY]["result"] == "red", "a 2-day-old cache is used when the feed is down: the PHP verdict is still red")
        ok(all(cs["stack:feed:%s" % f]["result"] == "yellow" and "stale" in cs["stack:feed:%s" % f]["title"] for f in ("endoflife", "kev", "nvd")),
           "...with a yellow 'feed stale' for each feed")
        ok(not [u for u in unv if u.startswith("stack CVE feed")], "...and no unverified entry while the cache is usable")
        tmp4 = tempfile.mkdtemp(prefix="ares-t-")
        cve_run(CveWorld(), tmp4, now=NOW - timedelta(days=4))
        res, cs, unv, *_ = cve_run(cw2, tmp4)
        ok(cs[PHP_KEY]["result"] == "skip" and cs["stack:feed:endoflife"]["result"] == "skip" and "stack CVE feed endoflife.date (unreachable)" in unv,
           "a 4-day-old cache is too old: skip + unverified, never a pass")
        for d in (tmp2, tmp3, tmp4):
            shutil.rmtree(d, ignore_errors=True)
        # ---- docker itself cannot be listed: a blind spot, said out loud
        cw = CveWorld()
        orig = cw.runner
        cw.runner = lambda cmd, t: (127, "", "docker: not found") if cmd[:2] == ["docker", "ps"] else orig(cmd, t)
        res, cs, unv, *_ = cve_run(cw, tmp)
        ok(cs["stack:bestly-pi:inventory"]["result"] == "skip" and "bestly-pi container inventory (docker unreachable)" in unv,
           "docker unreachable: the inventory check is skip + unverified, not an empty pass")
        # ---- an unreadable version inside a container
        cw = CveWorld()
        orig = cw.runner
        cw.runner = lambda cmd, t: (1, "", "boom") if cmd[-2:] == ["php", "-v"] else orig(cmd, t)
        res, cs, *_ = cve_run(cw, tmp)
        ok(cs[PHP_KEY]["result"] == "yellow" and "inside nextcloud" in cs[PHP_KEY]["title"], "php -v failing inside the container is yellow 'could not read the version inside nextcloud'")
        # ---- wired into a whole audit run
        repo, _ = leak_repo(tmp)
        w = AresWorld()
        cw = CveWorld()
        cw.nvd["php"] = [PHP2SHELL]
        ctx, ares = ares_make(w, repo, cve=cv.CveWatch(cw, cw.runner, sa.Db(BASE, "service-role-key-not-real", api=w), state_dir=tmp, now=NOW,
                                                      logf=lambda m: None, sleep=lambda s: None, exists=cw.exists))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            res = sa.run_audit(ctx, Args(), True, {"heal_nextcloud": False})
        ok(key_check(w, PHP_KEY)["result"] == "red", "run_audit records the stack verdict in the one batched write")
        m = re.search(r"Stack: (\d+) components, (\d+) behind, (\d+) critical, (\d+) EOL\. Deps: (\d+) packages in (\d+) repos, (\d+) red\.", res)
        ok(m and int(m.group(1)) >= 12 and int(m.group(3)) == 1 and res.index("Stack:") < res.index("Rules enforced"),
           "the summary says 'Stack: n components, n behind, n critical, n EOL. Deps: ...' before 'Rules enforced'")
        inv_patch = [p for path, p in w.patches if path.startswith("security_audit_runs")][-1]["inventory"]
        ok(len(inv_patch["stack"]) >= 12, "the run's inventory carries the stack")
        w = AresWorld()
        ctx, ares = ares_make(w, repo, cve=cv.CveWatch(cw, cw.runner, sa.Db(BASE, "service-role-key-not-real", api=w), state_dir=tmp, now=NOW,
                                                      logf=lambda m: None, sleep=lambda s: None, exists=cw.exists))

        def boom(*a, **k):
            raise ValueError("cve kaboom")
        ares.cve.run = boom
        err = None
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                sa.run_audit(ctx, Args(), True, {})
            except RuntimeError as exc:
                err = exc
        fin = [p for n, p in w.rpc if n == "security_run_finish"]
        ok(err is not None and fin and fin[-1]["p_failed"] is True and "Ares 2.0 scan failed" in fin[-1]["p_summary"] and "cve kaboom" in fin[-1]["p_summary"],
           "an exception from the CVE watch fails the run loudly (never a quiet pass)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lesson("L7", len(FAILS) == before)


# ------------------------------------------------------------------------------------- L8: dependency gate
def _lock(*pairs):
    pk = {"": {"name": "app", "version": "1.0.0"}}
    for n, v in pairs:
        pk["node_modules/" + n] = {"version": v}
    return json.dumps({"name": "app", "lockfileVersion": 3, "packages": pk})


def _write(root, rel, text):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(text)


def dep_run(cw, paths, tmp):
    res, cs, unv, inv, aw, sleeps, watch = cve_run(cw, tmp, paths=paths)
    return res["deps"], cs, unv


def test_L8_dependency_gate():
    print("L8 dependency gate (OSV.dev for lockfiles, .npmrc for npm repos)")
    before = len(FAILS)
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    try:
        state = os.path.join(tmp, "state")
        os.makedirs(state)
        evil = _lock(("tanstack-evil", "1.0.0"), ("left-pad", "1.3.0"), ("@scope/pkg", "2.0.0"))
        r1 = os.path.join(tmp, "r1")
        _write(r1, "package-lock.json", evil.replace('"node_modules/@scope/pkg": {"version": "2.0.0"}', '"node_modules/a/node_modules/b": {"version": "3.1.0"}'))
        _write(r1, "package.json", '{"name":"app"}')
        _write(r1, "node_modules/junk/package-lock.json", _lock(("ignored", "9.9.9")))
        _write(r1, "a/b/c/d/e/package-lock.json", _lock(("toodeep", "9.9.9")))
        cw = CveWorld()
        cw.osv_vulns = {("npm", "tanstack-evil", "1.0.0"): ["MAL-2026-1"]}
        deps, cs, unv = dep_run(cw, {"r1": r1}, state)
        c = cs["dep:r1:osv"]
        ok(c["result"] == "red" and c["layer"] == "Dependencies" and c["asset"] == "github:Bestly-LLC/r1",
           "a lockfile package OSV calls malicious (MAL-2026-1): RED")
        ok(c["title"] == "r1 installs a known-malicious or critical package: tanstack-evil@1.0.0 (MAL-2026-1)", "the title names repo, package, version and advisory (%s)" % c["title"])
        ok(deps == {"repos": 1, "packages": 3, "red": 1}, "counters (node_modules and depth>4 lockfiles skipped; b read from a nested key): %s" % deps)
        sent = sorted((q["package"]["name"], q["package"]["ecosystem"]) for qs in cw.osv_posts for q in qs)
        ok(sent == [("b", "npm"), ("left-pad", "npm"), ("tanstack-evil", "npm")] and len(cw.osv_posts) == 1, "one querybatch with every package, ecosystem npm (%s)" % sent)
        n = cs["dep:r1:npmrc"]
        ok(n["result"] == "yellow" and "ignore-scripts=true" in n["fix"] and "min-release-age=7" in n["fix"] and n["evidence"]["autofix"] == "add .npmrc",
           "no .npmrc: yellow, both lines in fix, evidence.autofix = 'add .npmrc' for Scout's Code Worker")
        # ---- clean OSV: pass with counts
        cw = CveWorld()
        deps, cs, unv = dep_run(cw, {"r1": r1}, state)
        ok(cs["dep:r1:osv"]["result"] == "pass" and cs["dep:r1:osv"]["evidence"] == {"packages": 3, "vulns": 0} and deps["red"] == 0,
           "clean OSV: pass with {packages, vulns}")
        ok(cs["dep:r1:npmrc"]["result"] == "yellow", "clean OSV and still no .npmrc: yellow")
        # ---- proper .npmrc: pass
        _write(r1, ".npmrc", "# gate\nignore-scripts=true\nmin-release-age=7\n")
        deps, cs, unv = dep_run(CveWorld(), {"r1": r1}, state)
        ok(cs["dep:r1:npmrc"]["result"] == "pass", "a .npmrc with ignore-scripts=true and min-release-age=7: pass")
        _write(r1, ".npmrc", "ignore-scripts=true\nmin-release-age=3\n")
        ok(dep_run(CveWorld(), {"r1": r1}, state)[1]["dep:r1:npmrc"]["evidence"]["missing"] == ["min-release-age=7"], "a release age under 7 days does not count")
        os.remove(os.path.join(r1, ".npmrc"))
        _write(r1, "pnpm-workspace.yaml", "packages:\n  - 'x'\nminimumReleaseAge: 7\n")
        ok(dep_run(CveWorld(), {"r1": r1}, state)[1]["dep:r1:npmrc"]["result"] == "pass", "pnpm-workspace.yaml with minimumReleaseAge counts")
        os.remove(os.path.join(r1, "pnpm-workspace.yaml"))
        # ---- OSV unreachable: skip + unverified, never a pass; the local .npmrc check still runs
        cw = CveWorld()
        cw.down = {"osv"}
        deps, cs, unv = dep_run(cw, {"r1": r1}, state)
        ok(cs["dep:r1:osv"]["result"] == "skip" and "dependency gate (OSV unreachable)" in unv, "OSV unreachable: skip + unverified 'dependency gate (OSV unreachable)'")
        ok(not any(v["result"] == "pass" for k, v in cs.items() if k.startswith("dep:") and k.endswith(":osv")), "...and nothing in the dependency gate passes")
        ok(cs["dep:r1:npmrc"]["result"] == "yellow", "the .npmrc check does not need the network")
        # ---- requirements.txt is queried as PyPI
        r2 = os.path.join(tmp, "r2")
        _write(r2, "requirements.txt", "# pins\nrequests==2.19.0  # old\nFlask[async]==3.0.0 ; python_version > '3.8'\n-r other.txt\nnumpy>=1.0\nPyYAML==6.0.1 \\\n    --hash=sha256:abc\n")
        _write(r2, "svc/requirements-dev.txt", "pytest==8.0.0\n")
        cw = CveWorld()
        cw.osv_vulns = {("PyPI", "requests", "2.19.0"): ["GHSA-high-1"]}
        cw.osv_detail = {"GHSA-high-1": {"id": "GHSA-high-1", "database_specific": {"severity": "HIGH"}}}
        deps, cs, unv = dep_run(cw, {"r2": r2}, state)
        sent = sorted((q["package"]["name"], q["package"]["ecosystem"], q["version"]) for qs in cw.osv_posts for q in qs)
        ok(sent == [("Flask", "PyPI", "3.0.0"), ("PyYAML", "PyPI", "6.0.1"), ("pytest", "PyPI", "8.0.0"), ("requests", "PyPI", "2.19.0")],
           "requirements*.txt pins are queried under ecosystem PyPI (%s)" % sent)
        ok(cs["dep:r2:osv"]["result"] == "yellow" and "requests@2.19.0 (GHSA-high-1)" in cs["dep:r2:osv"]["detail"], "a HIGH advisory is yellow with the list")
        ok("dep:r2:npmrc" not in cs, "no package.json, no .npmrc requirement")
        # ---- CRITICAL by CVSS vector (severity[].score), via the advisory lookup
        cw = CveWorld()
        cw.osv_vulns = {("PyPI", "requests", "2.19.0"): ["GHSA-crit-1"]}
        cw.osv_detail = {"GHSA-crit-1": {"id": "GHSA-crit-1", "severity": [{"type": "CVSS_V3", "score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}]}}
        deps, cs, unv = dep_run(cw, {"r2": r2}, state)
        ok(cs["dep:r2:osv"]["result"] == "red" and "GHSA-crit-1" in cs["dep:r2:osv"]["title"], "a CVSS 9.8 vector is CRITICAL: red")
        ok(cv.cvss3_score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H") == 9.8 and cv.cvss3_score("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H") == 9.9,
           "the CVSS v3 calculator matches the spec's reference scores")
        cw = CveWorld()
        cw.osv_vulns = {("PyPI", "requests", "2.19.0"): ["GHSA-unk-1"]}
        cw.down = {"osvvuln"}
        ok(dep_run(cw, {"r2": r2}, state)[1]["dep:r2:osv"]["result"] == "yellow", "an advisory whose severity cannot be looked up is yellow, never a quiet pass")
        cw = CveWorld()
        cw.osv_vulns = {("PyPI", "requests", "2.19.0"): ["GHSA-v4-1"]}
        cw.osv_detail = {"GHSA-v4-1": {"id": "GHSA-v4-1", "severity": [{"type": "CVSS_V4", "score": "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"}]}}
        c = dep_run(cw, {"r2": r2}, state)[1]["dep:r2:osv"]
        ok(c["result"] == "yellow" and c["evidence"]["unrated"] == 1, "a CVSS v4 vector Ares cannot score is yellow 'could not rate', never a quiet pass")
        cw = CveWorld()
        cw.osv_vulns = {("PyPI", "requests", "2.19.0"): ["GHSA-low-1"]}
        cw.osv_detail = {"GHSA-low-1": {"id": "GHSA-low-1", "database_specific": {"severity": "LOW"}}}
        ok(dep_run(cw, {"r2": r2}, state)[1]["dep:r2:osv"]["result"] == "pass", "a LOW advisory is not a finding (counted in evidence.vulns)")
        # ---- chunks of 500
        r3 = os.path.join(tmp, "r3")
        _write(r3, "package-lock.json", _lock(*[("pkg%d" % i, "1.0.%d" % i) for i in range(1200)]))
        cw = CveWorld()
        deps, cs, unv = dep_run(cw, {"r3": r3}, state)
        ok([len(q) for q in cw.osv_posts] == [500, 500, 200] and deps["packages"] == 1200, "1200 packages go in chunks of 500 (%s)" % [len(q) for q in cw.osv_posts])
        # ---- pnpm and yarn lockfile parsing
        pnpm = ("lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n      lodash:\n        specifier: ^4\n        version: 4.17.21\n\n"
                "packages:\n\n  '@babel/core@7.24.0':\n    resolution: {integrity: sha512-x}\n\n  lodash@4.17.21:\n    resolution: {integrity: sha512-y}\n\n"
                "  react-dom@18.2.0(react@18.2.0):\n    x: 1\n\nsnapshots:\n\n  lodash@4.17.21: {}\n")
        ok(cv.parse_pnpm_lock(pnpm) == {("@babel/core", "7.24.0"), ("lodash", "4.17.21"), ("react-dom", "18.2.0")}, "pnpm-lock.yaml packages: name@version keys")
        ok(cv.parse_pnpm_lock("lockfileVersion: 5.4\npackages:\n  /lodash/4.17.21:\n    dev: false\n  /@babel/core/7.0.0_x:\n    dev: true\n")
           == {("lodash", "4.17.21"), ("@babel/core", "7.0.0")}, "pnpm v5 /name/version keys")
        yarn = ('# yarn lockfile v1\n\n"@scope/a@^1.0.0", "@scope/a@^1.1.0":\n  version "1.2.3"\n  resolved "x"\n\nleft-pad@^1.0.0:\n  version "1.3.0"\n')
        ok(cv.parse_yarn_lock(yarn) == {("@scope/a", "1.2.3"), ("left-pad", "1.3.0")}, "yarn.lock v1 blocks")
        ok(cv.parse_package_lock(json.dumps({"lockfileVersion": 1, "dependencies": {"a": {"version": "1.0.0", "dependencies": {"b": {"version": "2.0.0"}}}}}))
           == {("a", "1.0.0"), ("b", "2.0.0")}, "npm lockfile v1 nested dependencies")
        # ---- a repo with nothing to check makes no verdict
        r4 = os.path.join(tmp, "r4")
        _write(r4, "README.md", "x\n")
        deps, cs, unv = dep_run(CveWorld(), {"r4": r4}, state)
        ok(not [k for k in cs if k.startswith("dep:")] and deps == {"repos": 0, "packages": 0, "red": 0}, "a repo with no lockfile and no package.json gets no dependency verdict")
        # ---- wired into a whole audit run, with the repos Ares cloned
        repo = build_repo(os.path.join(tmp, "bestlytech"), [{"package-lock.json": evil, "package.json": '{"name":"app"}'}])
        w = AresWorld()
        cw = CveWorld()
        cw.osv_vulns = {("npm", "tanstack-evil", "1.0.0"): ["MAL-2026-1"]}
        ctx, ares = ares_make(w, repo, cve=cv.CveWatch(cw, cw.runner, sa.Db(BASE, "service-role-key-not-real", api=w), state_dir=state, now=NOW,
                                                      logf=lambda m: None, sleep=lambda s: None, exists=cw.exists))
        with contextlib.redirect_stdout(io.StringIO()):
            res = sa.run_audit(ctx, Args(), True, {"heal_nextcloud": False})
        ok(key_check(w, "dep:bestlytech:osv")["result"] == "red" and key_check(w, "dep:bestlytech:npmrc")["result"] == "yellow",
           "run_audit scans the repos Ares cloned: the malicious package is red in the batch")
        ok("Deps: 3 packages in 1 repos, 1 red." in res, "the summary says 'Deps: 3 packages in 1 repos, 1 red.' (%s)" % res[res.find("Stack:"):res.find("Rules")])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lesson("L8", len(FAILS) == before)


# ------------------------------------------------------------------ L9: patch-lag push and Nextcloud self-heal
def test_L9_patch_lag_push():
    print("L9 patch-lag push and the guarded Nextcloud self-heal")
    before = len(FAILS)
    tmp = tempfile.mkdtemp(prefix="ares-t-")
    no_heal = {"heal_nextcloud": False}
    try:
        def world(released="2026-10-22"):
            cw = CveWorld()
            cw.eol = default_eol(php_released=released)
            cw.nvd["php"] = [PHP2SHELL]
            return cw
        # ---- fix released 48 hours ago on an internet-facing component: ONE Ares push, right away
        now48 = datetime(2026, 10, 24, 0, 0, tzinfo=timezone.utc)
        cw = world("2026-10-22")
        res, cs, unv, inv, aw, sleeps, _ = cve_run(cw, tmp, live=True, state=no_heal, now=now48)
        al = [a for a in cve_alerts(aw) if a["p_key"] == PHP_ALERT]
        ok(len(cve_alerts(aw)) == 1 and len(al) == 1, "red on internet-facing nextcloud/php, fix 48 h old: exactly one push (%s)" % [a["p_key"] for a in cve_alerts(aw)])
        a = al[0]
        ok(a["p_severity"] == "error" and a["p_needs_jared"] and a["p_area"] == "security" and a["p_key"] == "security.cve.bestly-pi.nextcloud/php",
           "key security.cve.<host>.<component>, severity error, needs Jared, under the security. prefix (Ares's)")
        ok("nextcloud/php 8.4.26" in a["p_title"] and "8.4.27" in a["p_title"] and "docker compose pull nextcloud push" in a["p_body"] and "CVE-2026-109618" in a["p_body"],
           "the push says what, which fix, and the command")
        ok("..." not in a["p_title"] + a["p_body"], "no text is cut off with ...")
        ok(not cw.mutations, "heal switched off in state: docker is not touched")
        res, cs, unv, inv, aw2, *_ = cve_run(cw, tmp, live=False, state=no_heal, now=now48)
        ok(not aw2.alerts, "a dry run pushes nothing")
        # ---- fix released 6 hours ago: no push yet
        cw = world("2026-10-24")
        res, cs, unv, inv, aw, *_ = cve_run(cw, tmp, live=True, state=no_heal, now=datetime(2026, 10, 24, 6, 0, tzinfo=timezone.utc))
        ok(cs[PHP_KEY]["result"] == "red" and not cve_alerts(aw), "fix released 6 h ago: still red on the Security page, but no push")
        # ---- on latest again: the push resolves itself
        cw = world("2026-10-22")
        cw.running = cw.local = "new"
        cw.eol["php"][0]["latest"] = "8.4.27"
        res, cs, unv, inv, aw, *_ = cve_run(cw, tmp, live=True, state=no_heal, now=now48)
        ok(cs[PHP_KEY]["result"] == "pass" and any(a["p_key"] == PHP_ALERT and a["p_kind"] == "resolved" for a in aw.alerts) and not cve_alerts(aw),
           "once the component is on latest the alert is resolved through ares2.resolve")
        # ---- self-heal: new digest for the same tag, verification passes
        cw = world("2026-10-22")
        res, cs, unv, inv, aw, sleeps, _ = cve_run(cw, tmp, live=True, state={}, now=now48)
        undo = "nextcloud:33-pre-ares-20261024"
        compose = ["docker", "compose", "-f", cv.NEXTCLOUD_COMPOSE]
        ok(cw.mutations == [["docker", "tag", _sha("a"), undo], compose + ["pull", "nextcloud", "push"], compose + ["up", "-d", "nextcloud", "push"]],
           "heal: undo tag first, then pull and up -d for `nextcloud push` only (%s)" % cw.mutations)
        ok(25 in sleeps, "...with a 25 second wait before verifying")
        c = cs[PHP_KEY]
        ok(c["result"] == "pass" and c["evidence"]["healed"] == {"from": "8.4.26", "to": "8.4.27", "undo_tag": undo},
           "verified (php moved forward, status.php 200 installed:true): the check is re-evaluated and carries evidence.healed {from, to, undo_tag}")
        ok(res["stack"]["healed"] == 1 and "healed" not in cs["stack:bestly-pi:nextcloud:cve"]["evidence"], "healed counter is 1; the app check was not behind so it carries no healed record")
        ok(not [a for a in aw.alerts if a["p_severity"] == "error"], "success pushes no error")
        heal_a = [a for a in aw.alerts if a["p_kind"] == "problem" and a.get("p_healed") is True]
        res_a = [a for a in aw.alerts if a["p_kind"] == "resolved"]
        ok(len(heal_a) == 1 and heal_a[0]["p_severity"] == "info" and any(undo in (a["p_title"] or "") for a in res_a),
           "Jared is told after: a self-healed issue recorded by Ares, resolved with the undo tag named")
        ok(all(m[:3] == ["docker", "compose", "-f"] or m[:2] == ["docker", "tag"] for m in cw.mutations)
           and all(set(m[m.index("pull") + 1:]) <= {"nextcloud", "push"} for m in cw.mutations if "pull" in m)
           and all(m[-2:] == ["nextcloud", "push"] for m in cw.mutations if "up" in m) and not cw.unexpected,
           "only the nextcloud and push services are ever touched; nothing else ran")
        # ---- self-heal: the update breaks Nextcloud -> rollback, error alert, check stays red
        cw = world("2026-10-22")
        cw.new_breaks_status = True
        res, cs, unv, inv, aw, *_ = cve_run(cw, tmp, live=True, state={}, now=now48)
        ok(cw.mutations[-2:] == [["docker", "tag", undo, "nextcloud:33"], compose + ["up", "-d", "nextcloud", "push"]] and cw.mutations.count(compose + ["up", "-d", "nextcloud", "push"]) == 2,
           "verify fails (status.php 503): the undo tag goes back onto the tag and `up -d nextcloud push` runs again (%s)" % cw.mutations[-2:])
        errs = [a for a in aw.alerts if a["p_kind"] == "problem" and a["p_severity"] == "error"]
        ok(len(errs) == 1 and errs[0]["p_needs_jared"] and "rolled back" in errs[0]["p_title"] and undo in errs[0]["p_body"] and "answers on cloud.bestly.tech again" in errs[0]["p_body"],
           "...and ONE error alert says it was rolled back, that Nextcloud answers again, and where the undo is")
        ok(cs[PHP_KEY]["result"] == "red" and "healed" not in cs[PHP_KEY]["evidence"] and res["stack"]["healed"] == 0, "a failed heal records no healed evidence and the check stays red")
        cw = world("2026-10-22")
        cw.new_php_same = True
        res, cs, unv, inv, aw, *_ = cve_run(cw, tmp, live=True, state={}, now=now48)
        ok(cw.mutations[-2][:2] == ["docker", "tag"] and len([a for a in aw.alerts if a["p_severity"] == "error"]) == 1,
           "an update where PHP did not move forward is not a fix: rolled back, error alert")
        cw = world("2026-10-22")
        cw.pull_rc = 1
        res, cs, unv, inv, aw, *_ = cve_run(cw, tmp, live=True, state={}, now=now48)
        ok(not any(m[-3:-2] == ["up"] or "up" in m for m in cw.mutations) and any("nothing was changed" in a["p_title"] for a in aw.alerts),
           "a failed pull never reaches `up -d`; the alert says nothing was changed")
        # ---- guards: no docker change at all
        for label, setup, st in (("--dry", lambda c: None, "dry"), ("state heal_nextcloud false", lambda c: None, no_heal),
                                 ("compose file somewhere else", lambda c: setattr(c, "cfg", "/srv/other/docker-compose.yml"), {}),
                                 ("compose file missing", lambda c: setattr(c, "compose_exists", False), {}),
                                 ("registry digest equals the running one", lambda c: setattr(c, "remote_same", True), {})):
            cw = world("2026-10-22")
            setup(cw)
            res, cs, unv, inv, aw, *_ = cve_run(cw, tmp, live=(st != "dry"), dry=(True if st == "dry" else None), state=({} if st == "dry" else st), now=now48)
            ok(not cw.mutations, "no heal: %s" % label)
            if st == "dry":
                ok(not [c for c in cw.cmds if c[:2] in (["docker", "manifest"], ["docker", "tag"], ["docker", "compose"])] and not aw.alerts,
                   "--dry: no manifest, tag or compose command, no alert (docker is only read for the inventory)")
            else:
                ok(len([a for a in cve_alerts(aw) if a["p_key"] == PHP_ALERT]) == 1, "...and the patch-lag push still goes out (%s)" % label)
        cw = world("2026-10-22")
        cw.pull_brings_new = False
        res, cs, unv, inv, aw, *_ = cve_run(cw, tmp, live=True, state={}, now=now48)
        ok(not [m for m in cw.mutations if "up" in m] and not [a for a in aw.alerts if a["p_severity"] == "error" and "failed" in a["p_title"]],
           "a pull that brings nothing new never recreates anything and raises no failure")
        ok(not cw.unexpected, "the fake saw no command the code should not run (%s)" % cw.unexpected)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lesson("L9", len(FAILS) == before)


NEW_TESTS = [
    test_L1_fixed_means_dead, test_L2_history_and_names, test_L3_public_repo_red, test_L4_legacy_keys,
    test_L5_coverage_escalation, test_lessons_loop, test_authenticated_clone, test_unauth_consumers,
    test_ares_failure_is_loud, test_old_head_scan_never_passes, test_L7_stack_cve_watch, test_L8_dependency_gate,
    test_L9_patch_lag_push, test_L6_selftest_gate,
]


def run_all():
    test_pure()
    test_no_tokens()
    test_order_and_batch()
    test_deployed_explains_change()
    test_no_secret_leaks()
    test_rejected_token()
    test_failures()
    test_fallbacks()
    test_dry_and_guard()
    test_web_checks_contract()
    test_no_false_alarms()
    test_cf_no_token()
    test_cf_rejected()
    test_cf_healthy()
    test_cf_routes()
    test_cf_usage()
    test_cf_workers()
    test_cf_cnames()
    test_cf_ssl_members_tokens()
    test_cf_secrets()
    test_cf_missing_perm_for_discovery()
    for t in NEW_TESTS:
        try:
            t()
        except Exception as exc:  # noqa: BLE001
            ok(False, "%s crashed: %s: %s" % (t.__name__, type(exc).__name__, str(exc)[:200]))
            for lid, rule, name, _txt in a2.BUILTIN_LESSONS:
                if name == t.__name__:
                    LESSON_RESULTS[lid] = "FAIL"
                    print("LESSON %s FAIL" % lid)


if __name__ == "__main__":
    run_all()
    # a lesson whose test did not report ok is a failure even if no assertion fired
    for lid, rule, name, _txt in a2.BUILTIN_LESSONS:
        if LESSON_RESULTS.get(lid) != "ok" and name != "test_L6_selftest_gate":
            ok(False, "lesson %s (%s) did not report ok" % (lid, name))
    print()
    if FAILS:
        print("SELFTEST FAILED: %d" % len(FAILS))
        sys.exit(1)
    print("selftest passed")
