// sky-area: the admin Sky map anywhere (bestly.tech/admin/sky), admin only. Jared 2026-10-05: "same features as the
// wall (roads, traffic) plus a current-location button that re-centers the map and shows that area's conditions".
//
//   GET  ?op=tile&layer=roads|traffic&z=&x=&y=   256 px PNG. roads = TomTom "hybrid/night" (transparent roads + labels
//                                                 over the dark sky), traffic = TomTom flow "relative0-dark". The key
//                                                 stays here (Vault tomtom_api_key, copied from the Pi on 2026-10-05).
//   POST {op:"planes", lat, lon, radius_mi}        aircraft around that point (adsb.lol, then adsb.fi), same shape as wall-sky.
//   POST {op:"conditions", lat, lon}               weather in °F / mph (Open-Meteo, free) + a place name (Nominatim).
//
// Watchdog: a TomTom failure raises wall.skymap.tiles (owner Wall Watchdog, held from his phone unless it is down an
// hour); the next good tile resolves it.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";
import { SECRET_KEY } from "../_shared/keys.ts";

const cors = corsWith({ headers: "authorization, x-client-info, apikey, content-type", methods: "POST, GET, OPTIONS" });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, SECRET_KEY, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

let tomtomKey: { v: string; at: number } | null = null;
async function key(): Promise<string> {
  if (tomtomKey && Date.now() - tomtomKey.at < 10 * 60_000) return tomtomKey.v;
  const { data, error } = await admin.rpc("sky_tomtom_key");
  if (error || !data) throw new Error("No TomTom key in Vault");
  tomtomKey = { v: String(data), at: Date.now() };
  return tomtomKey.v;
}

let tilesFailing = false;
async function tileHealth(ok: boolean, why = "") {
  if (ok === !tilesFailing) return;
  tilesFailing = !ok;
  try {
    await admin.rpc("bestly_raise", ok
      ? { p_key: "wall.skymap.tiles", p_kind: "resolved", p_severity: "info", p_title: "Admin sky map roads and traffic are back" }
      : { p_key: "wall.skymap.tiles", p_kind: "problem", p_severity: "warning", p_title: "Admin sky map can't load roads or traffic",
          p_body: `TomTom answered: ${why}. The map still shows planes and weather.`, p_area: "wall" });
  } catch { /* the map still works */ }
}

async function isAdmin(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt || jwt.split(".").length !== 3) return false;
  const { data } = await admin.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: ok } = await admin.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return !!ok;
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const okLatLon = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180;

function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function distNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(a));
}

async function planes(lat: number, lon: number, radiusMi: number) {
  const nm = Math.min(25, Math.round((radiusMi / 1.1508 + 1.5) * 10) / 10);
  const urls = [`https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`, `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`];
  let last = "";
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "bestly-admin-sky/1.0" }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) { last = `${new URL(u).host} ${r.status}`; continue; }
      const d = await r.json();
      const ac = (d.ac ?? d.aircraft ?? []) as Record<string, unknown>[];
      const list = ac.filter((a) => typeof a.lat === "number" && typeof a.lon === "number").map((a) => {
        const la = a.lat as number, lo = a.lon as number;
        const alt = typeof a.alt_baro === "number" ? a.alt_baro : a.alt_baro === "ground" ? 0 : (typeof a.alt_geom === "number" ? a.alt_geom : null);
        return {
          hex: String(a.hex ?? ""), cs: String(a.flight ?? "").trim() || null, reg: (a.r as string) || null, t: (a.t as string) || null,
          cat: (a.category as string) || null, lat: la, lon: lo, alt, gs: (a.gs as number) ?? null, track: (a.track as number) ?? (a.true_heading as number) ?? null,
          vr: (a.baro_rate as number) ?? (a.geom_rate as number) ?? null, owner: (a.ownOp as string) || null,
          dst: Math.round(distNm(lat, lon, la, lo) * 1000) / 1000, dir: Math.round(bearing(lat, lon, la, lo) * 10) / 10,
        };
      }).filter((x) => x.alt !== 0).sort((a, b) => a.dst - b.dst).slice(0, 25);
      return { list, at: Date.now() / 1000, home: [lat, lon], radius_mi: radiusMi, source: new URL(u).host };
    } catch (e) { last = `${new URL(u).host} ${String((e as Error).message ?? e).slice(0, 80)}`; }
  }
  throw new Error(last || "no plane feed");
}

const WMO: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Fog", 51: "Light drizzle", 53: "Drizzle", 55: "Drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Showers", 81: "Showers", 82: "Heavy showers",
  95: "Thunderstorms", 96: "Thunderstorms", 99: "Thunderstorms",
};
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

async function conditions(lat: number, lon: number) {
  const w = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day&hourly=precipitation_probability&forecast_hours=3&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`,
    { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const p = fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`,
    { headers: { "User-Agent": "bestly-admin-sky/1.0 (jared@bestly.tech)", "Accept-Language": "en-US" }, signal: AbortSignal.timeout(6000) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [wd, pd] = await Promise.all([w, p]);
  const c = wd?.current;
  const rain = Array.isArray(wd?.hourly?.precipitation_probability) ? Math.max(...wd.hourly.precipitation_probability.filter((x: unknown) => typeof x === "number"), 0) : null;
  const a = pd?.address ?? {};
  const place = [a.neighbourhood || a.suburb || a.quarter || a.hamlet || a.village, a.city || a.town || a.village || a.county].filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i).join(", ") || null;
  return {
    place,
    weather: c ? {
      temp_f: Math.round(c.temperature_2m), feels_f: Math.round(c.apparent_temperature),
      wind_mph: Math.round(c.wind_speed_10m), wind_from: COMPASS[Math.round(((c.wind_direction_10m ?? 0) % 360) / 45) % 8],
      sky: WMO[c.weather_code as number] ?? "", is_day: c.is_day === 1, rain_pct: rain,
    } : null,
  };
}

async function tile(layer: string, z: number, x: number, y: number) {
  const k = await key();
  const u = layer === "traffic"
    ? `https://api.tomtom.com/traffic/map/4/tile/flow/relative0-dark/${z}/${x}/${y}.png?key=${k}&thickness=8&tileSize=256`
    : `https://api.tomtom.com/map/1/tile/hybrid/night/${z}/${x}/${y}.png?key=${k}&tileSize=256&view=Unified&language=en-US`;
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) { await tileHealth(false, `${r.status} for ${layer}`); return new Response(null, { status: 502, headers: cors }); }
  await tileHealth(true);
  return new Response(r.body, { headers: { ...cors, "Content-Type": "image/png",
    "Cache-Control": layer === "traffic" ? "private, max-age=120" : "private, max-age=86400" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await isAdmin(req))) return json({ error: "admin only" }, 401);
  const q = new URL(req.url).searchParams;
  try {
    if (req.method === "GET" && q.get("op") === "tile") {
      const layer = q.get("layer") === "traffic" ? "traffic" : "roads";
      const z = num(q.get("z")), x = num(q.get("x")), y = num(q.get("y"));
      if (![z, x, y].every(Number.isInteger) || z < 3 || z > 18 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return json({ error: "bad tile" }, 400);
      return await tile(layer, z, x, y);
    }
    const b = req.method === "POST" ? await req.json().catch(() => ({})) : Object.fromEntries(q);
    const lat = num(b.lat), lon = num(b.lon);
    if (!okLatLon(lat, lon)) return json({ error: "lat and lon required" }, 400);
    if (b.op === "planes") {
      const r = num(b.radius_mi);
      return json(await planes(Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, Number.isFinite(r) ? Math.min(25, Math.max(2, r)) : 15));
    }
    if (b.op === "conditions") return json(await conditions(Math.round(lat * 1e3) / 1e3, Math.round(lon * 1e3) / 1e3));
    return json({ error: "unknown op" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e).slice(0, 200) }, 502);
  }
});

