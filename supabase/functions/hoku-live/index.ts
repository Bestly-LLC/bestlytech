// hoku-live — one call returns everything the admin Live tab renders, for any
// window the panel asks for.
//
// v3: the six now/today/24h views are replaced by live_snapshot(brand, from, to).
// The window is resolved in Postgres by live_range(), so "today" means the same
// Pacific day everywhere and only one place has to know the store's timezone.
//
// Reads aggregates only. No session hashes, paths, or user agents ever leave
// this function, so widening the window cannot turn the admin panel into a way
// to follow one visitor around.
//
// KEY ROTATION (complete): the previous key shipped as a literal fallback in the
// hoku-clean repo and was therefore readable by anyone with repo or history
// access. It has been replaced and is no longer accepted.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const OWN_KEY = "4tkL1O5mLwkbvmKOQSSAnVpx2TP4tU6hRcFh9va0SF8pguzV";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-live-key",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const RANGES = new Set(["today", "yesterday", "7d", "30d", "90d", "custom"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const ok = (req.headers.get("x-live-key") || "") === OWN_KEY || isSvc(req);
  if (!ok) return json({ error: "Unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);

  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* empty ok */ }
  const brand = String(input.brand ?? "hoku");
  const action = String(input.action ?? "snapshot");

  if (action === "health") return json({ ok: true, fn: "hoku-live", version: 5 });
  if (action !== "snapshot") return json({ error: `unknown action "${action}"` }, 400);

  const range = String(input.range ?? "today").toLowerCase();
  if (!RANGES.has(range)) return json({ error: `unknown range "${range}"` }, 400);
  if (range === "custom" && (!input.from || !input.to)) {
    return json({ error: "a custom range needs both from and to" }, 400);
  }

  try {
    const { data: rangeRows, error: rErr } = await db.rpc("live_range", {
      _range: range,
      _from: input.from ?? null,
      _to: input.to ?? null,
    });
    if (rErr) return json({ error: rErr.message }, 400);
    const r = (Array.isArray(rangeRows) ? rangeRows[0] : rangeRows) as Record<string, unknown>;
    if (!r) return json({ error: "could not resolve that range" }, 400);

    const [snapRes, nowRes, firstRes] = await Promise.all([
      db.rpc("live_snapshot", { _brand: brand, _from: r.r_from, _to: r.r_to }),
      // Visitors right now is always right now. It deliberately ignores the
      // selected window -- a "live" number that moved when you picked last month
      // would be a lie about what it measures.
      db.from("v_live_now").select("*").eq("brand", brand).maybeSingle(),
      // When collection actually started, so an empty older window can say
      // "nothing was recorded yet" instead of implying nobody visited.
      db.from("web_events").select("ts").eq("brand", brand)
        .order("ts", { ascending: true }).limit(1).maybeSingle(),
    ]);

    if (snapRes.error) return json({ error: snapRes.error.message }, 500);
    const snap = (snapRes.data ?? {}) as Record<string, unknown>;

    return json({
      ok: true,
      server_time: new Date().toISOString(),
      range: {
        ...(snap.range as Record<string, unknown> ?? {}),
        key: range,
        label: r.r_label,
        clamped: r.r_clamped === true,
        retention_days: 90,
        is_live: range === "today",
      },
      collecting_since: firstRes.data?.ts ?? null,
      now: nowRes.data ?? { visitors_now: 0, visitors_30m: 0 },
      totals: snap.totals ?? {},
      funnel: snap.funnel ?? {},
      coverage: snap.coverage ?? { located: 0, unknown: 0, total: 0 },
      locations: snap.locations ?? [],
      referrers: snap.referrers ?? [],
      series: snap.series ?? [],
      recent: snap.recent ?? [],
    });
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
