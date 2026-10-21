// repo-read: authenticated, read-only door to the site repo (Bestly-LLC/bestlytech) for machines that hold no GitHub token
// (the Pi, the Mac mini). It reads with the Vault GitHub token on the server; the token never leaves this function.
//   GET/POST ?path=<file in the repo>&ref=<main or a commit hash>   -> the file's bytes (streamed, up to 100 MB)
//   GET/POST ?status=<commit hash>                                   -> { state, statuses: [{ context, state }] } (the build result)
// Auth: x-worker-token (the same Mac watchdog token code-job-git takes), or a service key in apikey / Authorization.
// Paths are limited to the folders machines pull from; .env files and parent-folder tricks are refused.
import { createClient } from "jsr:@supabase/supabase-js@2";

const REPO = "Bestly-LLC/bestlytech";
const keys = (() => { try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[]; } catch { return [] as string[]; } })();
const SB_SECRET = keys[0] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const svc = new Set([...keys, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const OK_PATH = /^(scripts|tools|social\/scripts|public|supabase\/functions|docs)\/[A-Za-z0-9._@ \/-]{1,280}$/;
const OK_REF = /^(main|[0-9a-f]{7,40})$/;
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  let ok = svc.has(bearer) || svc.has(apikey);
  if (!ok) {
    const tok = req.headers.get("x-worker-token") ?? "";
    if (tok) { const { data } = await db.rpc("db_watchdog_ok", { p_token: tok }); ok = data === true; }
  }
  if (!ok) return J({ ok: false, error: "unauthorized" }, 401);

  const u = new URL(req.url);
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { /* empty */ } }
  const q = (k: string) => String(b[k] ?? u.searchParams.get(k) ?? "").trim();

  const { data: token } = await db.rpc("get_github_token");
  if (!token) return J({ ok: false, error: "github token not available" }, 500);
  const gh = (path: string, accept: string) => fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "repo-read" },
  });

  const status = q("status");
  if (status) {
    if (!OK_REF.test(status) || status === "main") return J({ ok: false, error: "status needs a commit hash" }, 400);
    const r = await gh(`/repos/${REPO}/commits/${status}/status`, "application/vnd.github+json");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return J({ ok: false, status: r.status, error: j?.message ?? "github refused" }, 502);
    return J({ ok: true, state: j.state, statuses: (j.statuses ?? []).map((s: any) => ({ context: s.context, state: s.state })) });
  }

  const path = q("path"), ref = q("ref") || "main";
  if (!path || !OK_PATH.test(path) || path.includes("..") || /(^|\/)\.env/.test(path)) return J({ ok: false, error: "path not allowed" }, 400);
  if (!OK_REF.test(ref)) return J({ ok: false, error: "ref must be main or a commit hash" }, 400);
  const enc = path.split("/").map(encodeURIComponent).join("/");
  const r = await gh(`/repos/${REPO}/contents/${enc}?ref=${ref}`, "application/vnd.github.raw+json");
  if (!r.ok) { await r.body?.cancel(); return J({ ok: false, status: r.status, error: r.status === 404 ? "not found" : "github refused" }, r.status === 404 ? 404 : 502); }
  return new Response(r.body, { status: 200, headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
});
