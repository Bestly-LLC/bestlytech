// slide-put — TEMPORARY uploader for carousel JPEGs into review/carousel/. Key checked by sha256; dead after UNTIL.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SHA = "7d986d666c06583a4014b3371ea3cf3be595629257c527c8a421af19fb44196d";
const UNTIL = Date.parse("2026-09-21T23:04:41Z");
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
async function sha(s: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (Date.now() > UNTIL) return J({ ok: false, error: "expired" }, 410);
  if ((await sha(req.headers.get("x-put-key") ?? "")) !== SHA) return J({ ok: false, error: "unauthorized" }, 401);
  const dest = new URL(req.url).searchParams.get("dest") ?? "";
  if (!/^carousel\/[a-z0-9-]+\/v[0-9]+\/[0-9]{2}\.jpg$/.test(dest)) return J({ ok: false, error: "bad dest" }, 400);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > 8_000_000) return J({ ok: false, error: "size" }, 400);
  const { error } = await db.storage.from("review").upload(dest, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
  if (error) return J({ ok: false, error: error.message }, 500);
  return J({ ok: true, url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/review/${dest}` });
});
