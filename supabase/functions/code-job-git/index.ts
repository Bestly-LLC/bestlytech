// code-job-git — the Code Worker's only door to GitHub (docs/scout-chief-of-staff-opusplan.md section 6).
// The Mac holds no GitHub token. It proves itself with the Mac watchdog token (Keychain bestly-db-watchdog), names a
// RUNNING code job, and this function does the GitHub work with the Vault token:
//   op archive      -> a short-lived tarball URL of main for the job's repo (to clone without credentials)
//   op create_repo  -> a new PRIVATE Bestly-LLC/<slug> repo, only for a job that asks for a new site
//   op commit       -> ONE fast-forward commit to main (no force push, ever) after a secret scan
// Bestly-LLC repos only. verify_jwt = false: the watchdog token and the job check are the auth.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";

const keys = (() => { try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[]; } catch { return [] as string[]; } })();
const SB_SECRET = keys[0] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors = corsWith({ headers: "authorization, x-client-info, apikey, content-type, x-worker-token", methods: "POST, OPTIONS" });
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const REPO_OK = /^Bestly-LLC\/[A-Za-z0-9._-]{1,100}$/;
const SECRET_RE = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /sk-ant-[A-Za-z0-9_-]{20,}/, /\bsk-[A-Za-z0-9]{32,}/, /\bghp_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bsb_secret_[A-Za-z0-9_-]{20,}/, /\bxox[bp]-[A-Za-z0-9-]{20,}/, /\bsk_live_[A-Za-z0-9]{20,}/,
];
const BAD_PATH = /(^|\/)(\.git|node_modules|\.env[^/]*|\.secrets|\.vercel|\.opencode)(\/|$)|(^|\/)\.\.(\/|$)|^\//;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const tok = req.headers.get("x-worker-token") ?? "";
  const { data: good } = await db.rpc("db_watchdog_ok", { p_token: tok });
  if (good !== true) return J({ ok: false, error: "unauthorized" }, 401);

  let b: any = {};
  try { b = await req.json(); } catch { /* empty */ }
  const { data: job } = await db.from("code_jobs").select("id, repo, new_site, status").eq("id", String(b.job_id ?? "")).maybeSingle();
  if (!job || job.status !== "running") return J({ ok: false, error: "no running job with that id" }, 403);

  const { data: token } = await db.rpc("get_github_token");
  if (!token) return J({ ok: false, error: "github token not available" }, 500);
  const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com${path}`, {
    ...init, redirect: "manual",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "code-job-git", "Content-Type": "application/json" },
  });

  const repo = String(job.repo);
  if (!REPO_OK.test(repo)) return J({ ok: false, error: "repo must be Bestly-LLC/<name>" }, 400);

  try {
    if (b.op === "create_repo") {
      if (!job.new_site) return J({ ok: false, error: "this job is not a new site" }, 403);
      const name = repo.split("/")[1];
      const r = await gh("/orgs/Bestly-LLC/repos", { method: "POST", body: JSON.stringify({ name, private: true, auto_init: true, description: String(job.new_site?.description ?? "Built by Scout Code Worker").slice(0, 200) }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 422) return J({ ok: true, existed: true, repo });
      if (!r.ok) return J({ ok: false, status: r.status, error: j?.message ?? "create failed" }, 502);
      return J({ ok: true, repo, url: j.html_url });
    }
    if (b.op === "archive") {
      const r = await gh(`/repos/${repo}/tarball/main`);
      const loc = r.headers.get("location");
      if (!loc) return J({ ok: false, status: r.status, error: "no archive location" }, 502);
      return J({ ok: true, url: loc });
    }
    if (b.op === "commit") {
      const files = Array.isArray(b.files) ? b.files : [];
      if (!files.length || files.length > 80) return J({ ok: false, error: "1 to 80 files per commit" }, 400);
      let bytes = 0;
      for (const f of files) {
        const p = String(f.path ?? "");
        if (!p || BAD_PATH.test(p)) return J({ ok: false, error: `path not allowed: ${p}` }, 400);
        if (f.delete) continue;
        const c = String(f.content ?? ""); bytes += c.length;
        if (f.encoding !== "base64") for (const re of SECRET_RE) if (re.test(c)) return J({ ok: false, error: `secret pattern in ${p}; remove it and try again` }, 422);
        if (f.encoding === "base64") { try { const t = atob(c.slice(0, 400_000)); for (const re of SECRET_RE) if (re.test(t)) return J({ ok: false, error: `secret pattern in ${p}` }, 422); } catch { /* binary */ } }
      }
      if (bytes > 14_000_000) return J({ ok: false, error: "too large for one commit" }, 413);
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bestly-git`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET },
        body: JSON.stringify({ action: "commit", repo, branch: "main", message: String(b.message ?? "Scout code job").slice(0, 300), files }),
      });
      const j = await r.json().catch(() => ({}));
      return J(j, r.ok ? 200 : 502);
    }
    return J({ ok: false, error: "op must be archive, create_repo or commit" }, 400);
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});
