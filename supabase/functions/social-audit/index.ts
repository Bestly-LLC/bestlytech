// social-audit - read-only. Lists what a brand has actually published.
//
// The card renderers were written from a description of each account's look.
// That is how Cookie Yeti and InventoryProof ended up near-identical: both got
// "dark gradient, white bold headline, one accent word", because that is what
// the description said and nobody went back to the pixels. This exists so a
// brand guide can be written from the grid instead of from memory.
//
// It publishes nothing and changes nothing. The only Graph call is
// GET /{ig-user-id}/media.
//
// verify_jwt is off and an x-audit-key header gates it instead, so the review
// can pull the list straight into the workspace rather than paging thirty signed
// CDN URLs through a conversation. Retire it when the guides are written.
// v5 (2026-09-23): the key is no longer in this file. Vault holds its sha256 as
// social_audit_key_sha256 and edge_key_ok() (service-role only) does the check.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

async function keyOk(k: string): Promise<boolean> {
  if (!k) return false;
  const { data } = await db.rpc("edge_key_ok", { p_name: "social_audit_key_sha256", p_key: k });
  return data === true;
}

const isFacebookToken = (t: string) => t.startsWith("EA");

Deno.serve(async (req) => {
  const J = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  if (!(await keyOk(req.headers.get("x-audit-key") ?? ""))) {
    return J({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty ok */ }

  const brand = String(body.brand ?? "");
  const limit = Math.min(Number(body.limit) || 30, 50);
  if (!brand) return J({ error: "brand required" }, 400);

  const { data: acct, error } = await db.from("social_accounts")
    .select("brand, handle, remote_user_id, access_token")
    .eq("brand", brand).eq("active", true).maybeSingle();
  if (error || !acct) return J({ error: "no active account for " + brand }, 404);

  const base = isFacebookToken(acct.access_token)
    ? "https://graph.facebook.com/v21.0"
    : "https://graph.instagram.com/v21.0";

  const fields = [
    "id", "caption", "media_type", "media_url", "thumbnail_url",
    "permalink", "timestamp",
    "children{id,media_type,media_url,thumbnail_url}",
  ].join(",");

  const url = `${base}/${acct.remote_user_id}/media`
    + `?fields=${encodeURIComponent(fields)}&limit=${limit}`
    + `&access_token=${encodeURIComponent(acct.access_token)}`;

  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) return J({ error: "graph", detail: json }, 502);

  const items = (json.data ?? []).map((m: Record<string, unknown>) => ({
    id: m.id,
    type: m.media_type,
    at: m.timestamp,
    permalink: m.permalink,
    url: m.media_url ?? m.thumbnail_url ?? null,
    slides: ((m.children as Record<string, unknown> | undefined)?.data as
      Record<string, unknown>[] | undefined)?.map((c) => c.media_url ?? c.thumbnail_url) ?? null,
    caption: typeof m.caption === "string" ? m.caption : null,
  }));

  return J({ brand, handle: acct.handle, count: items.length, items });
});
