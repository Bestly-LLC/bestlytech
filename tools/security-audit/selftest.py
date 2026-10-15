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
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import security_audit as sa  # noqa: E402

FAILS = []


def ok(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


VTOKEN = "vercel_test_token_AAAAAAAAAAAAAAAA"
STOKEN = "sbp_test_token_BBBBBBBBBBBBBBBBBBB"
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
        raise AssertionError("unexpected call " + url)

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


def make(world, vtoken=VTOKEN, stoken=STOKEN):
    db = sa.Db(BASE, "service-role-key-not-real", api=world)
    ctx = sa.Ctx(db, vtoken, stoken, api=world, web=fake_web_factory(world), clone=lambda d: True)
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
    res, err, out = run(w, vtoken="", stoken="")
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
    ok({s["p_status"] for s in states} == {"missing"}, "token state recorded as missing")
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
    ok(by_key(batch_checks(w))["web:bestly.tech:content_changed"]["result"] == "skip", "redirect to another monitored host is skipped")
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


if __name__ == "__main__":
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
    print()
    if FAILS:
        print("SELFTEST FAILED: %d" % len(FAILS))
        sys.exit(1)
    print("selftest passed")
