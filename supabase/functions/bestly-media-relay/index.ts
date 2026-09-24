// bestly-media-relay — drain media_relay into Storage.
//
// Exists because the rendering sandbox sometimes cannot open a connection to
// Storage but can always run SQL. Rows land in media_relay over SQL; this
// function (called from SQL via invoke_edge_function, or directly) uploads
// each pending row to its bucket/path and writes the public URL back.
//
// Auth: Authorization: Bearer <service_role_key> only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const svc = SB_SECRET;
  if (!isSvc(req)) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, svc);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const limit = Math.min(Number(body.limit ?? 40), 100);

  const { data: rows, error } = await db.from("media_relay")
    .select("id,bucket,path,content_type,data_b64").eq("status", "pending").order("id").limit(limit);
  if (error) return json({ error: error.message }, 500);

  const out: Record<string, unknown>[] = [];
  for (const r of rows ?? []) {
    try {
      const bin = Uint8Array.from(atob(String(r.data_b64).replace(/\s+/g, "")), (c) => c.charCodeAt(0));
      const { error: upErr } = await db.storage.from(r.bucket).upload(r.path, bin, {
        contentType: r.content_type, upsert: true, cacheControl: "31536000",
      });
      if (upErr) throw upErr;
      const pub = `${url}/storage/v1/object/public/${r.bucket}/${r.path}`;
      await db.from("media_relay").update({ status: "done", url: pub, error: null, done_at: new Date().toISOString(), data_b64: "" }).eq("id", r.id);
      out.push({ id: r.id, path: r.path, ok: true, url: pub, bytes: bin.length });
    } catch (e) {
      await db.from("media_relay").update({ status: "failed", error: String((e as Error).message ?? e).slice(0, 400) }).eq("id", r.id);
      out.push({ id: r.id, path: r.path, ok: false, error: String((e as Error).message ?? e) });
    }
  }
  return json({ ok: true, processed: out.length, results: out });
});
