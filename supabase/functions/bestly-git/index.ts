// bestly-git — vault-backed GitHub proxy for Bestly-LLC repositories.
//
// Why this exists: every site change up to now went through browser automation of
// GitHub's web editor, which needs the Mac awake, Chrome connected, and a live
// session. This reads a fine-grained PAT out of the Supabase vault instead, so any
// future session can deploy with no browser and no memory of how it was set up.
//
// The token never leaves this function. Nothing echoes it back.
//
// v3 adds a `repo` parameter. v4: `commit` accepts { path, delete: true } entries.
// v7 (2026-09-22, security audit): the x-git-key is no longer written in this source; it lives
// in Vault (bestly_git_key) and is checked by bestly_git_key_ok(). Any Bestly-LLC repository the
// PAT can reach is allowed (the sites behind parentiq.io, hoascope.com, etc. need header fixes),
// and `repos` lists them.
//
// Actions: whoami | repos | list | get | put | delete | commit
// Auth: x-git-key header, or Authorization: Bearer <service_role_key>
//
// Binary files: pass encoding:"base64" alongside content (per-file on commit) and
// the content is treated as already-encoded bytes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const DEFAULT_REPO = "Bestly-LLC/hoku-clean";
const REPO_OK = /^Bestly-LLC\/[A-Za-z0-9._-]+$/;
const API = "https://api.github.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-git-key",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// base64 that survives non-ASCII (curly quotes, em dashes in templates)
function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
// already-base64 content passes through untouched; text gets encoded
const asB64 = (content: string, encoding?: string) =>
  encoding === "base64" ? content.replace(/\s+/g, "") : b64encode(content);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);
  const gitKey = req.headers.get("x-git-key") || "";
  let ok = isSvc(req);
  if (!ok && gitKey) {
    const { data } = await db.rpc("bestly_git_key_ok", { p_key: gitKey });
    ok = data === true;
  }
  if (!ok) return json({ error: "Unauthorized" }, 401);

  const { data: token, error: tokErr } = await db.rpc("get_github_token");
  if (tokErr || !token) {
    return json({ error: "github_token not available from vault", detail: tokErr?.message }, 500);
  }

  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* empty ok */ }
  const action = String(input.action ?? "whoami");
  const branch = String(input.branch ?? "main");

  const REPO = String(input.repo ?? DEFAULT_REPO);
  if (!REPO_OK.test(REPO)) {
    return json({ error: `repo not allowed: ${REPO} (Bestly-LLC/* only)` }, 400);
  }

  const gh = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "bestly-git",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep raw */ }
    return { status: res.status, ok: res.ok, body };
  };

  try {
    // ------------------------------------------------------------- repos
    if (action === "repos") {
      const res = await gh(`/orgs/Bestly-LLC/repos?per_page=100&type=all`);
      if (!res.ok) return json({ ok: false, status: res.status, body: res.body }, 502);
      const list = (res.body as Record<string, unknown>[]).map((r) => ({
        name: r.full_name, private: r.private, default_branch: r.default_branch, homepage: r.homepage, pushed_at: r.pushed_at,
      }));
      return json({ ok: true, repos: list });
    }

    // ------------------------------------------------------------- whoami
    if (action === "whoami") {
      const repo = await gh(`/repos/${REPO}`);
      if (!repo.ok) return json({ ok: false, step: "repo", repo: REPO, status: repo.status, body: repo.body }, 502);
      const r = repo.body as Record<string, unknown>;
      return json({
        ok: true,
        repo: r.full_name,
        private: r.private,
        default_branch: r.default_branch,
        permissions: r.permissions,
      });
    }

    // ------------------------------------------------------------- list
    if (action === "list") {
      const p = String(input.path ?? "");
      const res = await gh(`/repos/${REPO}/contents/${p}?ref=${encodeURIComponent(branch)}`);
      if (!res.ok) return json({ ok: false, status: res.status, body: res.body }, 502);
      const items = (res.body as Record<string, unknown>[]).map((f) => ({
        name: f.name, path: f.path, type: f.type, size: f.size, sha: f.sha,
      }));
      return json({ ok: true, repo: REPO, path: p, items });
    }

    // ------------------------------------------------------------- get
    if (action === "get") {
      const p = String(input.path ?? "");
      if (!p) return json({ error: "path required" }, 400);
      const res = await gh(`/repos/${REPO}/contents/${p}?ref=${encodeURIComponent(branch)}`);
      if (!res.ok) return json({ ok: false, status: res.status, body: res.body }, 502);
      const f = res.body as Record<string, unknown>;
      const raw = typeof f.content === "string" ? f.content : null;
      if (input.encoding === "base64") {
        return json({ ok: true, path: f.path, sha: f.sha, size: f.size, encoding: "base64", content: raw?.replace(/\n/g, "") ?? null });
      }
      return json({ ok: true, path: f.path, sha: f.sha, size: f.size, content: raw ? b64decode(raw) : null });
    }

    // ------------------------------------------------------------- put
    if (action === "put") {
      const p = String(input.path ?? "");
      const content = String(input.content ?? "");
      const message = String(input.message ?? `update ${p}`);
      if (!p) return json({ error: "path required" }, 400);
      let sha = input.sha as string | undefined;
      if (!sha) {
        const cur = await gh(`/repos/${REPO}/contents/${p}?ref=${encodeURIComponent(branch)}`);
        if (cur.ok) sha = (cur.body as Record<string, string>).sha;
      }
      const res = await gh(`/repos/${REPO}/contents/${p}`, {
        method: "PUT",
        body: JSON.stringify({
          message,
          content: asB64(content, input.encoding as string | undefined),
          branch,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!res.ok) return json({ ok: false, status: res.status, body: res.body }, 502);
      const b = res.body as Record<string, Record<string, string>>;
      return json({ ok: true, repo: REPO, path: p, commit: b.commit?.sha, url: b.content?.html_url });
    }

    // ------------------------------------------------------------- delete
    if (action === "delete") {
      const p = String(input.path ?? "");
      if (!p) return json({ error: "path required" }, 400);
      let sha = input.sha as string | undefined;
      if (!sha) {
        const cur = await gh(`/repos/${REPO}/contents/${p}?ref=${encodeURIComponent(branch)}`);
        if (!cur.ok) return json({ ok: false, status: cur.status, body: cur.body }, 502);
        sha = (cur.body as Record<string, string>).sha;
      }
      const res = await gh(`/repos/${REPO}/contents/${p}`, {
        method: "DELETE",
        body: JSON.stringify({ message: String(input.message ?? `delete ${p}`), sha, branch }),
      });
      if (!res.ok) return json({ ok: false, status: res.status, body: res.body }, 502);
      return json({ ok: true, deleted: p });
    }

    // ------------------------------------------------------------- commit
    // Multiple files in ONE commit via the git trees API.
    if (action === "commit") {
      const files = (input.files as { path: string; content?: string; encoding?: string; delete?: boolean }[]) ?? [];
      const message = String(input.message ?? "update");
      if (!files.length) return json({ error: "files required" }, 400);

      const ref = await gh(`/repos/${REPO}/git/ref/heads/${branch}`);
      if (!ref.ok) return json({ ok: false, step: "ref", status: ref.status, body: ref.body }, 502);
      const headSha = ((ref.body as Record<string, Record<string, string>>).object).sha;

      const head = await gh(`/repos/${REPO}/git/commits/${headSha}`);
      if (!head.ok) return json({ ok: false, step: "head", status: head.status, body: head.body }, 502);
      const baseTree = ((head.body as Record<string, Record<string, string>>).tree).sha;

      const tree: Record<string, string | null>[] = [];
      for (const f of files) {
        if (f.delete) { tree.push({ path: f.path, mode: "100644", type: "blob", sha: null }); continue; }
        const blob = await gh(`/repos/${REPO}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: asB64(String(f.content ?? ""), f.encoding), encoding: "base64" }),
        });
        if (!blob.ok) return json({ ok: false, step: `blob ${f.path}`, status: blob.status, body: blob.body }, 502);
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: (blob.body as Record<string, string>).sha });
      }

      const newTree = await gh(`/repos/${REPO}/git/trees`, {
        method: "POST",
        body: JSON.stringify({ base_tree: baseTree, tree }),
      });
      if (!newTree.ok) return json({ ok: false, step: "tree", status: newTree.status, body: newTree.body }, 502);

      const commit = await gh(`/repos/${REPO}/git/commits`, {
        method: "POST",
        body: JSON.stringify({
          message,
          tree: (newTree.body as Record<string, string>).sha,
          parents: [headSha],
        }),
      });
      if (!commit.ok) return json({ ok: false, step: "commit", status: commit.status, body: commit.body }, 502);
      const commitSha = (commit.body as Record<string, string>).sha;

      const upd = await gh(`/repos/${REPO}/git/refs/heads/${branch}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commitSha }),
      });
      if (!upd.ok) return json({ ok: false, step: "update-ref", status: upd.status, body: upd.body }, 502);

      return json({
        ok: true,
        repo: REPO,
        commit: commitSha,
        files: files.map((f) => f.path),
        url: `https://github.com/${REPO}/commit/${commitSha}`,
      });
    }

    return json({ error: `unknown action "${action}"` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message ?? String(err) }, 500);
  }
});
