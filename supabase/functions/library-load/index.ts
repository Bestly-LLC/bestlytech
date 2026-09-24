// library-load - pull a markdown corpus out of Nextcloud into content_documents.
//
// Why a function rather than a script: the corpus is ~130KB and the container
// holds no database credential. This keeps the text off the wire between the
// workspace and the database, and it is the same shape research-harvest needs -
// read a source, normalise, upsert on url_hash, never store twice.
//
// Guarded by the same proxy key as bestly-files. Idempotent: re-running updates
// in place rather than duplicating.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Inbound key (2026-09-24): no key literal in this file. Vault holds only sha256
// fingerprints (bestly_proxy_key_sha256, plus bestly_proxy_key_prev_sha256 while callers move
// over); edge_key_ok() (service-role only) checks them.
async function keyOk(k: string | null | undefined): Promise<boolean> {
  if (!k) return false;
  for (const n of ["bestly_proxy_key_sha256", "bestly_proxy_key_prev_sha256"]) {
    const { data } = await db.rpc("edge_key_ok", { p_name: n, p_key: k });
    if (data === true) return true;
  }
  return false;
}

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Dav = { base: string; user: string; auth: string };

async function nextcloud(): Promise<Dav> {
  const { data, error } = await db.rpc("get_nextcloud_credentials");
  if (error) throw new Error(`vault: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  const base = String(row?.base_url ?? "").replace(/\/+$/, "");
  const user = String(row?.username ?? "");
  const pass = String(row?.app_password ?? "");
  if (!base || !user || !pass) throw new Error("nextcloud credentials incomplete");
  return { base, user, auth: "Basic " + btoa(`${user}:${pass}`) };
}

function davUrl(d: Dav, path: string): string {
  const enc = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${d.base}/remote.php/dav/files/${encodeURIComponent(d.user)}/${enc}`;
}

async function davList(d: Dav, path: string): Promise<string[]> {
  const r = await fetch(davUrl(d, path), {
    method: "PROPFIND",
    headers: { Authorization: d.auth, Depth: "1", "Content-Type": "application/xml" },
  });
  if (!r.ok) throw new Error(`propfind ${r.status} on ${path}`);
  const xml = await r.text();
  const hrefs = [...xml.matchAll(/<d:href>([^<]+)<\/d:href>/gi)].map((m) => decodeURIComponent(m[1]));
  return hrefs.filter((h) => h.toLowerCase().endsWith(".md"));
}

async function davRead(d: Dav, href: string): Promise<string> {
  const url = href.startsWith("http") ? href : `${d.base}${href}`;
  const r = await fetch(url, { headers: { Authorization: d.auth } });
  if (!r.ok) throw new Error(`get ${r.status} on ${href}`);
  return await r.text();
}

// The scraper wrote "# Title\n\nSource: <url>\n\n---\n\n<body>".
function parse(raw: string): { title: string | null; url: string | null; body: string } {
  const title = raw.match(/^#\s*(.+)$/m)?.[1]?.trim() ?? null;
  const url = raw.match(/^Source:\s*(\S+)$/m)?.[1]?.trim() ?? null;
  const i = raw.indexOf("---");
  const body = (i >= 0 ? raw.slice(i + 3) : raw).trim();
  return { title, url, body };
}

Deno.serve(async (req) => {
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults below */ }

  const k = req.headers.get("x-proxy-key") ?? String(body.proxyKey ?? "");
  if (!k || !(await keyOk(k))) return J({ error: "unauthorized" }, 401);

  const clientSlug = String(body.client ?? "centering-you");
  const host = String(body.host ?? "www.theshift.shop");
  const root = String(body.root ?? "Bestly/CenteringYOU/01-Source");
  const groups = (body.groups as Record<string, string>) ??
    { pages: "page", perspectives: "essay", press: "press" };

  try {
    const { data: src, error: srcErr } = await db
      .from("content_sources").select("id")
      .eq("host", host).eq("client_slug", clientSlug).maybeSingle();
    if (srcErr) throw new Error(`source lookup: ${srcErr.message}`);
    if (!src) return J({ error: `no content_sources row for ${host} / ${clientSlug}` }, 400);

    const d = await nextcloud();
    let loaded = 0, skipped = 0;
    const problems: string[] = [];

    for (const [group, kind] of Object.entries(groups)) {
      let files: string[] = [];
      try { files = await davList(d, `${root}/${group}`); }
      catch (e) { problems.push(`${group}: ${(e as Error).message}`); continue; }

      for (const href of files) {
        try {
          const { title, url, body: text } = parse(await davRead(d, href));
          if (!url) { skipped++; problems.push(`${href}: no Source: line`); continue; }

          const words = text.split(/\s+/).filter(Boolean).length;
          const row = {
            source_id: src.id,
            url,
            title,
            kind,
            word_count: words,
            excerpt: text.split(/\s+/).slice(0, 60).join(" "),
            excerpt_source: "extracted",
            body: text,
            content_hash: await sha256(text),
            fetched_at: new Date().toISOString(),
            status: "indexed",
          };

          const { error } = await db.from("content_documents")
            .upsert(row, { onConflict: "url_hash" });
          if (error) { problems.push(`${url}: ${error.message}`); skipped++; }
          else loaded++;
        } catch (e) {
          skipped++;
          problems.push(`${href}: ${(e as Error).message}`);
        }
      }
    }

    return J({ ok: true, loaded, skipped, problems: problems.slice(0, 20) });
  } catch (e) {
    return J({ error: (e as Error).message }, 500);
  }
});
