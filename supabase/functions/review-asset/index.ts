// review-asset - put a binary asset straight into the public `review` bucket.
//
// publish-app promotes a file that already lives on Nextcloud. This one takes
// bytes inline, for assets generated in a workspace that never need to live on
// Nextcloud as the source of truth (rendered carousel slides, exported frames).
//
// Same proxy key as bestly-files and publish-app. Writes only, one bucket,
// and the destination path is sanitised so a caller cannot escape the prefix.

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
const BUCKET = "review";
const MAX_BYTES = 8 * 1024 * 1024;

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  json: "application/json; charset=utf-8",
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

// Only a-z 0-9 . _ - and single slashes survive. No leading slash, no "..".
function safeDest(s: string): string {
  return s
    .split("/")
    .map((seg) => seg.replace(/[^A-Za-z0-9._-]/g, ""))
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
}

Deno.serve(async (req) => {
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* handled below */ }

  const k = req.headers.get("x-proxy-key") ?? String(body.proxyKey ?? "");
  if (!k || !(await keyOk(k))) return J({ error: "unauthorized" }, 401);

  const dest = safeDest(String(body.dest ?? ""));
  const b64 = String(body.base64 ?? "");
  if (!dest) return J({ error: "dest required" }, 400);
  if (!b64) return J({ error: "base64 required" }, 400);

  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return J({ error: "base64 did not decode" }, 400);
  }
  if (bytes.length > MAX_BYTES) return J({ error: `over ${MAX_BYTES} bytes` }, 413);

  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(dest)?.[1] ?? "bin").toLowerCase();
  const contentType = TYPES[ext] ?? "application/octet-stream";

  const up = await db.storage.from(BUCKET).upload(dest, bytes, {
    contentType,
    upsert: true,
    cacheControl: "31536000",
  });
  if (up.error) return J({ error: up.error.message }, 500);

  return J({
    ok: true,
    dest,
    bytes: bytes.length,
    contentType,
    url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${BUCKET}/${dest}`,
  });
});
