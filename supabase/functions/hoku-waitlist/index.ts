// hoku-waitlist — the list behind the "waitlist signups" number.
//
// Its own function rather than another action bolted onto shop-admin: this is
// the only thing in the panel that reads personal data (email addresses), so it
// is worth being able to see, at a glance, exactly what touches them.
//
// Shares SHOP_KEY with the other shop endpoints so it needs no new environment
// variable to go live. (Rotated 2026-09-10 with the rest of the shop keys.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const OWN_KEY = "tLDXwk5x0KR4CPON28k7jP3eJEZLRNrF5Rqb7oLZLR4Zwaav";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shop-key",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const ok = (req.headers.get("x-shop-key") || "") === OWN_KEY ||
    isSvc(req);
  if (!ok) return json({ error: "Unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);

  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* empty ok */ }
  const brand = String(input.brand ?? "hoku");
  const action = String(input.action ?? "list");

  if (action !== "list") return json({ error: `unknown action "${action}"` }, 400);

  const { data, error } = await db.rpc("waitlist_admin", {
    _brand: brand,
    _limit: Math.min(Number(input.limit) || 500, 2000),
  });
  if (error) return json({ error: error.message }, 500);
  return json(data);
});
