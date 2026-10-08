#!/usr/bin/env python3
"""Code Worker (Mac mini, launchd tech.bestly.code-worker). Does the coding jobs Scout files in public.code_jobs.
Plan: docs/scout-chief-of-staff-opusplan.md section 6.

Per job: fresh copy of the repo (or a new Vite/React site) -> opencode on free AI (FreeLLM, explicit vetted models,
never "auto") -> npm run build must pass -> 3 tries -> (Paid AI switch ON or Jared's tap: claude -p) -> secret scan ->
ONE fast-forward commit to main through the code-job-git edge function (this Mac holds no GitHub token) ->
new site: vercel deploy + short link bestly.tech/s/<slug>; bestlytech: wait for the Vercel build, revert if it fails.
Python 3.9 compatible. No secret is ever printed or written to disk by this file.
"""
import base64
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request

SB = "https://rcqfqhguwpmaarseifqg.supabase.co"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"      # publishable key, same one edge-guard uses
FREELLM = os.environ.get("FREELLM_BASE", "http://192.168.1.211:3001")   # the Pi (FreeLLMAPI moved there 2026-10-03)
HOME = os.path.expanduser("~")
LOG = os.path.join(HOME, "logs", "code-worker.log")
CODE_MODELS = ["qwen3-coder-480b", "gpt-oss-120b", "deepseek-v4-flash", "nemotron-3-super-120b", "gemini-3.8-flash", "qwen3-coder-30b-a3b-instruct"]
TRIES = 3
JOB_MAX_S = 20 * 60
AGENT_MAX_S = 7 * 60
PATH = ":".join([os.path.join(HOME, ".local/node/bin"), os.path.join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])
ENV = dict(os.environ, PATH=PATH, CI="1", NO_COLOR="1")


def log(*a):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line, flush=True)


def token():
    return subprocess.run(["security", "find-generic-password", "-s", "bestly-db-watchdog", "-w"], capture_output=True, text=True).stdout.strip()


def http(url, body=None, headers=None, timeout=60, method=None):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method or ("POST" if data is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return json.loads(raw.decode())
            except Exception:
                return raw
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s from %s: %s" % (e.code, url.split("?")[0], e.read().decode()[:300]))


def rpc(name, args):
    a = dict(args)
    a["p_token"] = token()
    return http("%s/rest/v1/rpc/%s" % (SB, name), a, {"apikey": ANON, "Authorization": "Bearer " + ANON})


def fn(name, body, timeout=140):
    return http("%s/functions/v1/%s" % (SB, name), body, {"x-worker-token": token(), "apikey": ANON}, timeout=timeout)


def run(cmd, cwd=None, timeout=300, env=None, shell=False):
    """Run a command, return (exit code, combined output tail). Kills the whole process group on timeout."""
    p = subprocess.Popen(cmd, cwd=cwd, env=env or ENV, shell=shell, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        out, _ = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, 9)
        except Exception:
            pass
        out, _ = p.communicate()
        return 124, (out or "")[-6000:] + "\n[timed out]"
    return p.returncode, (out or "")[-6000:]


# ---------------------------------------------------------------------------------------------- templates
def new_site_files(slug, title, goal):
    return {
        "package.json": json.dumps({"name": slug, "private": True, "version": "1.0.0", "type": "module",
                                    "scripts": {"dev": "vite", "build": "tsc --noEmit && vite build", "preview": "vite preview"},
                                    "dependencies": {"react": "^18.3.1", "react-dom": "^18.3.1"},
                                    "devDependencies": {"@types/react": "^18.3.3", "@types/react-dom": "^18.3.0", "@vitejs/plugin-react": "^4.3.1",
                                                        "typescript": "^5.5.4", "vite": "^5.4.2"}}, indent=2) + "\n",
        "index.html": '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>%s</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n' % title,
        "vite.config.ts": 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });\n',
        "tsconfig.json": json.dumps({"compilerOptions": {"target": "ES2020", "lib": ["ES2020", "DOM", "DOM.Iterable"], "module": "ESNext", "moduleResolution": "bundler",
                                                         "jsx": "react-jsx", "strict": True, "skipLibCheck": True, "noEmit": True, "isolatedModules": True}, "include": ["src"]}, indent=2) + "\n",
        "src/vite-env.d.ts": '/// <reference types="vite/client" />\n',
        "src/main.tsx": 'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\n\ncreateRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);\n',
        "src/App.tsx": 'export default function App() {\n  return <main><h1>%s</h1></main>;\n}\n' % title,
        "src/index.css": ':root { font-family: system-ui, sans-serif; color: #1a1a1a; background: #fff; }\nbody { margin: 0; }\nmain { max-width: 960px; margin: 0 auto; padding: 24px 16px; }\n',
        ".gitignore": "node_modules\ndist\n.vercel\n.env*\n",
    }


# ---------------------------------------------------------------------------------------------- agent
def freellm_key():
    if os.environ.get("FREELLM_KEY"):
        return os.environ["FREELLM_KEY"]
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "bestly-pi",
                        "cd /opt/bestly/cron && python3 -c 'import lib;print(lib.rpc(\"pi_secret\",p_name=\"Scout-FreeLLM\"))'"],
                       capture_output=True, text=True, timeout=30)
    k = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    if not k:
        raise RuntimeError("could not get the FreeLLM key from the Pi")
    os.environ["FREELLM_KEY"] = k
    return k


def usable_models():
    try:
        j = http(FREELLM + "/v1/models", headers={"Authorization": "Bearer " + freellm_key()}, timeout=20)
        have = set(m.get("id") for m in j.get("data", []))
    except Exception as e:
        log("models list failed:", e)
        have = set()
    out = [m for m in CODE_MODELS if m in have] or CODE_MODELS
    return out


AGENT_PORT = 13001


def ensure_tunnel():
    """opencode runs on node, and macOS Local Network privacy blocks node under launchd from reaching the Pi's LAN address
    ("Cannot connect to API", 2026-10-07). An ssh forward to localhost needs no LAN permission. Returns the base URL."""
    url = "http://127.0.0.1:%d" % AGENT_PORT
    try:
        http(url + "/v1/models", headers={"Authorization": "Bearer " + freellm_key()}, timeout=5)
        return url
    except Exception:
        pass
    subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-f", "-N",
                    "-L", "127.0.0.1:%d:127.0.0.1:3001" % AGENT_PORT, "bestly-pi"], capture_output=True, timeout=20)
    for _ in range(10):
        try:
            http(url + "/v1/models", headers={"Authorization": "Bearer " + freellm_key()}, timeout=5)
            return url
        except Exception:
            time.sleep(1)
    log("tunnel to the Pi failed; falling back to the LAN address")
    return FREELLM


def write_opencode_config(path, models):
    cfg = {
        "$schema": "https://opencode.ai/config.json",
        "autoupdate": False, "share": "disabled",
        "permission": {"edit": "allow", "bash": "allow", "webfetch": "allow"},
        "provider": {"freellmapi": {"npm": "@ai-sdk/openai-compatible", "name": "FreeLLMAPI",
                                    "options": {"baseURL": ensure_tunnel() + "/v1", "apiKey": "{env:FREELLM_KEY}"},
                                    "models": {m: {"name": m, "limit": {"context": 128000, "output": 16000}} for m in models}}},
    }
    with open(path, "w") as f:
        json.dump(cfg, f)


def agent_prompt(job, build_err, try_no):
    ns = job.get("new_site")
    parts = ["You are the Bestly Code Worker. Work only inside this folder, a fresh copy of %s." % job["repo"],
             "GOAL: %s" % job["goal"],
             "Rules: read CLAUDE.md first if there is one and follow its conventions. Keep the change small and focused. No emoji on customer-facing pages. "
             "Never write a key, token or password into any file. Do not run git commit or git push and do not touch .env files; the worker commits for you. "
             "Run `npm run build` yourself and fix every error until it passes. When done, reply with two plain sentences saying what you changed."]
    if ns:
        parts.append("This is a NEW site. A Vite + React + TypeScript starter is already here (src/App.tsx, src/index.css). Build the complete site in it: real content, "
                     "responsive from phone width, clean modern design, no external API keys. For a map use an OpenStreetMap iframe "
                     "(https://www.openstreetmap.org/export/embed.html?bbox=...&layer=mapnik&marker=lat,lon) and a link to open the map. Use plausible placeholder details and say so in a small footer note.")
    if build_err:
        parts.append("Your previous try ended with this build failure. Fix the cause (do not just retry):\n" + build_err[-2500:])
    return "\n\n".join(parts)


def run_agent(job, work, cfgpath, model, prompt):
    env = dict(ENV, OPENCODE_CONFIG=cfgpath, FREELLM_KEY=freellm_key())
    log("agent try with", model)
    return run(["opencode", "run", "--dir", work, "-m", "freellmapi/" + model, prompt], cwd=work, timeout=AGENT_MAX_S, env=env)


def run_paid(work, prompt, build_err):
    claude = os.path.join(HOME, ".local/bin/claude")
    p = prompt + ("\n\nThe free attempts ended with this build failure:\n" + build_err[-2500:] if build_err else "")
    return run([claude, "-p", p, "--dangerously-skip-permissions", "--max-turns", "40"], cwd=work, timeout=12 * 60)


def build(work):
    if os.path.exists(os.path.join(work, "package.json")):
        if not os.path.isdir(os.path.join(work, "node_modules")):
            code, out = run("npm install --no-audit --no-fund --prefer-offline", cwd=work, timeout=420, shell=True)
            if code != 0:
                return False, "npm install failed:\n" + out
        code, out = run("npm run build", cwd=work, timeout=420, shell=True)
        return code == 0, out
    return True, "no package.json; nothing to build"


# ---------------------------------------------------------------------------------------------- git (via code-job-git)
def fetch_repo(job, work):
    jid = job["id"]
    if job.get("new_site"):
        r = fn("code-job-git", {"job_id": jid, "op": "create_repo"})
        if not r.get("ok"):
            raise RuntimeError("could not create the repo: %s" % r.get("error"))
        slug = job["repo"].split("/")[1]
        for rel, text in new_site_files(slug, (job["new_site"] or {}).get("name") or slug, job["goal"]).items():
            p = os.path.join(work, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w") as f:
                f.write(text)
    else:
        r = fn("code-job-git", {"job_id": jid, "op": "archive"})
        if not r.get("ok"):
            raise RuntimeError("could not get the repo: %s" % r.get("error"))
        raw = urllib.request.urlopen(r["url"], timeout=120).read()
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as t:
            top = t.getnames()[0].split("/")[0]
            t.extractall(os.path.dirname(work))
        for name in os.listdir(os.path.join(os.path.dirname(work), top)):
            shutil.move(os.path.join(os.path.dirname(work), top, name), os.path.join(work, name))
        shutil.rmtree(os.path.join(os.path.dirname(work), top), ignore_errors=True)
    g = ["git", "-c", "user.name=Code Worker", "-c", "user.email=noreply@bestly.tech"]
    run(["git", "init", "-q"], cwd=work)
    with open(os.path.join(work, ".git", "info", "exclude"), "a") as f:
        f.write("node_modules\ndist\n.vercel\n.opencode\n.env*\n")
    run(g + ["add", "-A"], cwd=work)
    run(g + ["commit", "-q", "-m", "base", "--allow-empty"], cwd=work)


def changed_files(work):
    g = ["git", "-c", "user.name=Code Worker", "-c", "user.email=noreply@bestly.tech"]
    run(g + ["add", "-A"], cwd=work)
    _, out = run(["git", "diff", "--cached", "--name-status", "--no-renames", "HEAD"], cwd=work)
    files, base = [], []
    for line in out.splitlines():
        if "\t" not in line:
            continue
        st, path = line.split("\t", 1)
        full = os.path.join(work, path)
        if st.startswith("D"):
            files.append({"path": path, "delete": True})
            _, old = run(["git", "show", "HEAD:" + path], cwd=work)
            base.append({"path": path, "content": old})
            continue
        with open(full, "rb") as f:
            b = f.read()
        try:
            txt = b.decode("utf-8")
            files.append({"path": path, "content": txt})
        except UnicodeDecodeError:
            files.append({"path": path, "content": base64.b64encode(b).decode(), "encoding": "base64"})
        if st.startswith("M"):
            _, old = run(["git", "show", "HEAD:" + path], cwd=work)
            base.append({"path": path, "content": old})
        else:
            base.append({"path": path, "delete": True})
    return files, base


SECRET_RE = re.compile(r"(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})")


def secret_hits(files):
    """Paths whose new content matches a known key pattern. Nothing that matches is ever pushed."""
    hits = []
    for f in files:
        if f.get("delete") or f.get("encoding") == "base64":
            continue
        if SECRET_RE.search(f.get("content") or "") or re.search(r"(^|/)\.env($|\.)", f["path"]):
            hits.append(f["path"])
    return hits


def wait_for_vercel(sha):
    """bestlytech is public: Vercel posts its build result as a GitHub commit status."""
    for i in range(48):
        time.sleep(10 if i else 20)
        try:
            j = http("https://api.github.com/repos/Bestly-LLC/bestlytech/commits/%s/status" % sha, headers={"Accept": "application/vnd.github+json", "User-Agent": "code-worker"}, timeout=20)
            if j.get("state") in ("success", "failure", "error"):
                return j["state"]
        except Exception:
            pass
    return "pending"


def vercel_token():
    p = os.path.join(HOME, "Library", "Application Support", "com.vercel.cli", "auth.json")
    return json.load(open(p)).get("token")


def deploy_new_site(job, work, slug):
    env = dict(ENV, VERCEL_TOKEN=vercel_token() or "")
    code, out = run("vercel deploy --prod --yes --token \"$VERCEL_TOKEN\" 2>&1", cwd=work, timeout=420, env=env, shell=True)
    urls = re.findall(r"https://[a-z0-9.-]+\.vercel\.app", out)
    if code != 0 or not urls:
        raise RuntimeError("vercel deploy failed: " + re.sub(r"\s+", " ", out)[-300:])
    cands = ["https://%s.vercel.app" % slug] + urls[::-1]
    live = urls[-1]
    for u in cands:
        try:
            code = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "code-worker"}), timeout=20).status
            if code == 200:
                live = u
                break
        except Exception:
            continue
    short = rpc("site_link_put_t", {"p_slug": slug, "p_url": live, "p_job": job["id"]})
    return live, short


# ---------------------------------------------------------------------------------------------- one job
def do_job(job, paid_on):
    jid, t0 = job["id"], time.time()
    note = lambda n, att=None, logt=None: rpc("code_job_update_t", {"p_id": jid, "p_note": n, "p_attempts": att, "p_log": logt})
    root = tempfile.mkdtemp(prefix="codejob-")
    slug = job["repo"].split("/")[1]
    work = os.path.join(root, slug)
    os.makedirs(work)
    try:
        note("Getting a fresh copy")
        fetch_repo(job, work)
        models = usable_models()
        cfg = os.path.join(root, "opencode.json")
        write_opencode_config(cfg, models)
        err, ok, logs = "", False, []
        for n in range(1, TRIES + 1):
            if time.time() - t0 > JOB_MAX_S:
                break
            note("Free AI is writing the code (try %d of %d)" % (n, TRIES), n)
            code, out = run_agent(job, work, cfg, models[(n - 1) % len(models)], agent_prompt(job, err, n))
            logs.append("try %d agent exit %s\n%s" % (n, code, out[-1200:]))
            files, _ = changed_files(work)
            if not files:
                err = "The agent changed no files. Make the change the goal asks for."
                continue
            note("Checking the build (try %d)" % n, n)
            ok, bout = build(work)
            if ok:
                break
            err = bout
            logs.append("try %d build failed\n%s" % (n, bout[-1200:]))
        if not ok and (job.get("paid_ok") or paid_on):
            note("Paid AI is taking over", TRIES)
            code, out = run_paid(work, agent_prompt(job, err, 0), err)
            logs.append("paid exit %s\n%s" % (code, out[-800:]))
            files, _ = changed_files(work)
            ok, bout = build(work) if files else (False, "no change")
            err = "" if ok else bout
        if not ok:
            reason = "the build kept failing" if err and "agent changed no files" not in err else "the free AI made no change"
            status = "needs_yes" if not (job.get("paid_ok") or paid_on) else "failed"
            rpc("code_job_finish_t", {"p_id": jid, "p_status": status, "p_result": {"reason": reason, "build_tail": err[-600:]}, "p_log": "\n---\n".join(logs)})
            return
        files, base = changed_files(work)
        leak = secret_hits(files)
        if leak:
            rpc("code_job_finish_t", {"p_id": jid, "p_status": "failed", "p_result": {"reason": "stopped before saving: a file looks like it holds a secret (%s)" % ", ".join(leak[:3])}, "p_log": "\n---\n".join(logs)})
            return
        note("Saving to GitHub")
        msg = "Scout code job: " + re.sub(r"\s+", " ", job["goal"])[:120]
        c = fn("code-job-git", {"job_id": jid, "op": "commit", "files": files, "message": msg})
        if not c.get("ok"):
            rpc("code_job_finish_t", {"p_id": jid, "p_status": "failed", "p_result": {"reason": "GitHub refused the commit: %s" % c.get("error")}, "p_log": "\n---\n".join(logs)})
            return
        sha = c["commit"]
        result = {"commit_sha": sha, "build_ok": True, "files": [f["path"] for f in files][:30]}
        result["summary"] = "%d file%s changed on %s." % (len(files), "" if len(files) == 1 else "s", job["repo"].split("/")[1])
        # edge functions deployed from this copy
        fns = sorted(set(re.match(r"supabase/functions/([^/_][^/]*)/", f["path"]).group(1) for f in files if re.match(r"supabase/functions/([^/_][^/]*)/", f["path"])))
        for name in fns[:6]:
            note("Deploying function " + name)
            code, out = run("supabase functions deploy %s --project-ref rcqfqhguwpmaarseifqg --use-api 2>&1 | tail -2" % name, cwd=work, timeout=240, shell=True)
            log("deploy", name, code, out.strip()[-120:])
        if job.get("new_site"):
            note("Deploying the site")
            live, short = deploy_new_site(job, work, slug)
            result["live_url"] = short
            result["vercel_url"] = live
            result["summary"] = "The site is built and live. Private repo: %s." % job["repo"]
        elif job["repo"] == "Bestly-LLC/bestlytech":
            note("Waiting for the live build")
            st = wait_for_vercel(sha)
            if st in ("failure", "error"):
                rv = fn("code-job-git", {"job_id": jid, "op": "commit", "files": base, "message": "Revert: " + msg[:100]})
                rpc("code_job_finish_t", {"p_id": jid, "p_status": "failed", "p_result": {"reason": "the live build failed, so I reverted it (%s)" % (rv.get("commit", "")[:7] or "revert failed")}, "p_log": "\n---\n".join(logs)})
                return
            result["live_url"] = "https://bestly.tech/admin" if any(p.startswith("src/pages/admin") or "Admin" in p for p in result["files"]) else "https://bestly.tech"
            result["summary"] += " Vercel build %s." % ("is green" if st == "success" else "was still running when I stopped waiting")
        else:
            result["live_url"] = "https://github.com/%s/commit/%s" % (job["repo"], sha)
        rpc("code_job_finish_t", {"p_id": jid, "p_status": "done", "p_result": result, "p_log": "\n---\n".join(logs)})
        log("job done", jid, sha[:7])
    finally:
        shutil.rmtree(root, ignore_errors=True)


def heartbeat_loop(state):
    while True:
        try:
            r = rpc("code_worker_beat_t", {"p_info": {"busy": state.get("busy"), "host": os.uname().nodename}})
            state["paid"] = bool((r or {}).get("paid_ai_ok"))
        except Exception as e:
            log("beat failed:", e)
        time.sleep(30)


def main():
    state = {"busy": None, "paid": False}
    threading.Thread(target=heartbeat_loop, args=(state,), daemon=True).start()
    log("code worker started")
    while True:
        try:
            job = rpc("code_job_claim_t", {})
            if not job:
                time.sleep(15)
                continue
            state["busy"] = job["id"]
            log("claimed", job["id"], job["repo"])
            try:
                do_job(job, state.get("paid", False))
            except Exception as e:
                log("job error:", traceback.format_exc()[-800:])
                try:
                    rpc("code_job_finish_t", {"p_id": job["id"], "p_status": "failed", "p_result": {"reason": "the worker hit an error: %s" % str(e)[:160]}})
                except Exception:
                    pass
            state["busy"] = None
        except Exception as e:
            log("loop error:", e)
            time.sleep(30)


if __name__ == "__main__":
    main()
