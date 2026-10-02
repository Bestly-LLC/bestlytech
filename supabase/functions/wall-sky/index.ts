// wall-sky: backup plane feed for bestly.tech/admin/sky (admin only).
//
// The Sky tab normally draws the wall's own planes (the Pi pushes them to wall_air_live every 3 s while
// the tab is open). When the Pi hasn't shared for 45+ s, the tab asks this function instead: it reads the
// free ADS-B feeds (adsb.lol, then adsb.fi) around home. Browsers can't call those directly (no CORS).
// Returns the same item shape as server.py air_loop: {hex, cs, reg, t, cat, lat, lon, alt, gs, track, vr, dst, dir}.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsWith } from "../_shared/cors.ts";

const cors = corsWith({
  headers: "authorization, x-client-info, apikey, content-type",
  methods: "POST, GET, OPTIONS"
});
const HOME = { lat: 34.0835, lon: -118.3698 }; // 733 N Kings Rd (same as server.py HOME_LAT/HOME_LON)
let cache: { at: number; nm: number; body: unknown } | null = null;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function distNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(a));
}

async function feed(nm: number) {
  const urls = [
    `https://api.adsb.lol/v2/point/${HOME.lat}/${HOME.lon}/${nm}`,
    `https://opendata.adsb.fi/api/v2/lat/${HOME.lat}/lon/${HOME.lon}/dist/${nm}`,
  ];
  let last = "";
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "bestly-admin-sky/1.0" }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) { last = `${new URL(u).host} ${r.status}`; continue; }
      const d = await r.json();
      const ac = (d.ac ?? d.aircraft ?? []) as Record<string, unknown>[];
      return { src: new URL(u).host, ac };
    } catch (e) { last = `${new URL(u).host} ${String((e as Error).message ?? e).slice(0, 80)}`; }
  }
  throw new Error(last || "no feed");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "sign in" }, 401);
  const { data: ok } = await sb.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  if (!ok) return json({ error: "admin only" }, 403);

  let radiusMi = 15;
  try { const b = req.method === "POST" ? await req.json() : {}; if (typeof b?.radius_mi === "number") radiusMi = Math.min(25, Math.max(2, b.radius_mi)); } catch { /* default */ }
  const nm = Math.min(25, Math.round((radiusMi / 1.1508 + 1.5) * 10) / 10);
  if (cache && Date.now() - cache.at < 2500 && cache.nm === nm) return json(cache.body);
  try {
    const { src, ac } = await feed(nm);
    const list = ac
      .filter((a) => typeof a.lat === "number" && typeof a.lon === "number")
      .map((a) => {
        const lat = a.lat as number, lon = a.lon as number;
        const alt = typeof a.alt_baro === "number" ? a.alt_baro : a.alt_baro === "ground" ? 0 : (typeof a.alt_geom === "number" ? a.alt_geom : null);
        return {
          hex: String(a.hex ?? ""), cs: String(a.flight ?? "").trim() || null, reg: (a.r as string) || null, t: (a.t as string) || null,
          cat: (a.category as string) || null, lat, lon, alt, gs: (a.gs as number) ?? null, track: (a.track as number) ?? (a.true_heading as number) ?? null,
          vr: (a.baro_rate as number) ?? (a.geom_rate as number) ?? null, owner: (a.ownOp as string) || null,
          dst: Math.round(distNm(HOME.lat, HOME.lon, lat, lon) * 1000) / 1000, dir: Math.round(bearing(HOME.lat, HOME.lon, lat, lon) * 10) / 10,
        };
      })
      .filter((x) => x.alt !== 0)
      .sort((a, b) => a.dst - b.dst)
      .slice(0, 20);
    const body = { list, at: Date.now() / 1000, home: [HOME.lat, HOME.lon], radius_mi: radiusMi, source: src };
    cache = { at: Date.now(), nm, body };
    return json(body);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e).slice(0, 200), list: [] }, 502);
  }
});
