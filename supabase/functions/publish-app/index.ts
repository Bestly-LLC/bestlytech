// publish-app - copy a static file from Nextcloud into a public Storage bucket.
//
// Why this exists: edge functions cannot host a real web page. The Supabase
// gateway rewrites the content type to text/plain and attaches
// 'content-security-policy: default-src none; sandbox', which kills scripts,
// fonts and fetch. Storage has neither problem and serves the correct type.
//
// So Nextcloud stays the source of truth and this promotes a file to the CDN.
// Re-run it after editing the file on Nextcloud; nothing needs redeploying.
//
// Guarded by the same proxy key as bestly-files. Writes only, and only into the
// bucket named in the request, which must be one of ALLOWED.

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
const ALLOWED = new Set(["review"]);

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
};

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

Deno.serve(async (req) => {
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o, null, 2), {
      status: s,
      headers: { "Content-Type": "application/json" },
    });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* handled below */ }

  const k = req.headers.get("x-proxy-key") ?? String(body.proxyKey ?? "");
  if (!k || !(await keyOk(k))) return J({ error: "unauthorized" }, 401);

  const src = String(body.source ?? "");
  const bucket = String(body.bucket ?? "review");
  const dest = String(body.dest ?? "index.html");
  if (!src) return J({ error: "source required" }, 400);
  if (!ALLOWED.has(bucket)) return J({ error: `bucket ${bucket} not allowed` }, 400);

  // Pull the file out of Nextcloud with the vault credentials.
  const { data, error } = await db.rpc("get_nextcloud_credentials");
  if (error) return J({ error: `vault: ${error.message}` }, 500);
  const row = Array.isArray(data) ? data[0] : data;
  const base = String(row?.base_url ?? "").replace(/\/+$/, "");
  const user = String(row?.username ?? "");
  const pass = String(row?.app_password ?? "");
  if (!base || !user || !pass) return J({ error: "nextcloud credentials incomplete" }, 500);

  const encoded = src.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const url = `${base}/remote.php/dav/files/${encodeURIComponent(user)}/${encoded}`;
  const r = await fetch(url, { headers: { Authorization: "Basic " + btoa(`${user}:${pass}`) } });
  if (!r.ok) return J({ error: `webdav ${r.status}`, source: src }, r.status);

  const bytes = new Uint8Array(await r.arrayBuffer());
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(dest)?.[1] ?? "bin").toLowerCase();
  const contentType = TYPES[ext] ?? "application/octet-stream";

  const up = await db.storage.from(bucket).upload(dest, bytes, {
    contentType,
    upsert: true,
    cacheControl: "60",
  });
  if (up.error) return J({ error: up.error.message }, 500);

  return J({
    ok: true,
    source: src,
    bucket,
    dest,
    bytes: bytes.length,
    contentType,
    url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${bucket}/${dest}`,
  });
});
