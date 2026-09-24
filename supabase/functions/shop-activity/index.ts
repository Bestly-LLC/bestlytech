// shop-activity — the feed behind the admin's notification bell.
//
// Deliberately its own function rather than another action on shop-admin.
// shop-admin is the door to money: orders, refunds, stock. A read-only feed
// has no business being redeployed alongside it, and keeping them apart means
// a change here can never put a refund path at risk.
//
// Everything it knows lives in the view v_shop_activity, which is revoked from
// anon and authenticated — this function reads it as service role, behind the
// same shop key every other admin call uses.
//
// There is no per-user "read" state stored here on purpose. The panel keeps a
// last-seen timestamp in the browser; the server stays stateless, so a second
// admin device never marks the first one's notifications as read.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

// Inbound key (2026-09-24): no key literal in this file. Vault holds only sha256
// fingerprints (shop_key_sha256, plus shop_key_prev_sha256 while callers move
// over); edge_key_ok() (service-role only) checks them.
const __keyDb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
async function keyOk(k: string | null | undefined): Promise<boolean> {
  if (!k) return false;
  for (const n of ["shop_key_sha256", "shop_key_prev_sha256"]) {
    const { data } = await __keyDb.rpc("edge_key_ok", { p_name: n, p_key: k });
    if (data === true) return true;
  }
  return false;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shop-key",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const svcKey = SB_SECRET;
  const auth = req.headers.get("Authorization") || "";
  const ok = isSvc(req) || await keyOk(req.headers.get("x-shop-key"));
  if (!ok) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty ok */ }

  // The brand is pinned by the Vercel proxy, never chosen by the browser.
  const brand = String(body.brand ?? "hoku");
  const limit = Math.min(Math.max(Number(body.limit ?? 60), 1), 200);

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, svcKey);
    const { data, error } = await db.from("v_shop_activity")
      .select("at,kind,severity,title,detail,tab,ref")
      .eq("brand", brand)
      .order("at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    // `now` is the server's clock. The panel stores it as the last-seen mark
    // after the owner opens the bell, so a slow browser clock cannot cause an
    // event to be counted as read before it was ever shown.
    return json({ ok: true, rows: data ?? [], now: new Date().toISOString() });
  } catch (err) {
    return json({ error: (err as Error).message ?? String(err) }, 500);
  }
});
