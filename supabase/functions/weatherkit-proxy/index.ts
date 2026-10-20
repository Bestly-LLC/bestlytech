// weatherkit-proxy — current conditions from Apple WeatherKit, signed server-side.
//
// The .p8 signing key never leaves this function: it is read from the Supabase vault
// through get_weatherkit_credentials() (service_role only), used to mint a short-lived
// ES256 token, and never returned to the caller.
//
//   GET /weatherkit-proxy?lat=34.09&lon=-118.36[&dataSets=currentWeather][&lang=en]
//   -> Apple's JSON, plus X-Bestly-Weather-Cache: hit|miss
//
//   &air=1 (admin Command Center, 2026-10-20) also merges `airQuality` into the JSON: US AQI, PM2.5 and ozone
//   from Open-Meteo (free, no account, no key), fetched HERE so the browser never talks to a third party.
//   Cached 30 min per rounded coordinate. If Open-Meteo is down, airQuality is null and the weather still returns.
//
// Three things WeatherKit rejects tokens for, all of them silent 401s:
//   1. `sub` must be the SERVICES ID, not an app/bundle ID.
//   2. The header needs `id: "<TEAM>.<SERVICE>"` alongside `kid`.
//   3. The signature must be raw r‖s (what Web Crypto returns). DER-encoding it,
//      which most JWT libraries do, produces a token Apple refuses.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, {
  auth: { persistSession: false },
});

const CORS = corsWith({
  headers: "authorization, content-type, apikey, x-client-info",
  methods: "GET, POST, OPTIONS"
});
const J = (b: unknown, s = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS, ...extra } });

const b64url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

/** PKCS#8 PEM -> a P-256 signing key. */
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("weatherkit_private_key is empty");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function mintToken(teamId: string, serviceId: string, keyId: string, pem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, id: `${teamId}.${serviceId}`, typ: "JWT" };
  const payload = { iss: teamId, sub: serviceId, iat: now, exp: now + 30 * 60 };
  const signingInput = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`;
  const key = await importKey(pem);
  // Web Crypto returns raw r‖s, which IS the JWS format. Do not DER-encode.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${b64url(sig)}`;
}

// A dashboard tile polls; Apple's quota is finite. One shared cache entry per
// rounded coordinate, for ten minutes - weather does not move faster than that.
const cache = new Map<string, { at: number; body: string; status: number }>();
const TTL_MS = 10 * 60_000;

// Air quality: Open-Meteo, server side only. One entry per rounded coordinate for 30 minutes.
type Air = { aqi: number | null; pm25: number | null; ozone: number | null; hourly: { time: string; aqi: number }[]; at: string; source: string };
const airCache = new Map<string, { at: number; v: Air | null }>();
async function airFor(lat: number, lon: number): Promise<Air | null> {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = airCache.get(k);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.v;
  let v: Air | null = null;
  try {
    const u = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    u.searchParams.set("latitude", String(lat));
    u.searchParams.set("longitude", String(lon));
    u.searchParams.set("current", "us_aqi,pm2_5,ozone");
    u.searchParams.set("hourly", "us_aqi");
    u.searchParams.set("forecast_hours", "24");
    u.searchParams.set("timezone", "UTC");
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const j = await r.json();
      const t: string[] = j?.hourly?.time ?? [];
      const a: (number | null)[] = j?.hourly?.us_aqi ?? [];
      v = {
        aqi: j?.current?.us_aqi ?? null, pm25: j?.current?.pm2_5 ?? null, ozone: j?.current?.ozone ?? null,
        hourly: t.map((x, i) => ({ time: x.length === 16 ? x + ":00Z" : x, aqi: a[i] as number })).filter((h) => Number.isFinite(h.aqi)),
        at: new Date().toISOString(), source: "open-meteo",
      };
    }
  } catch { /* leave null: weather still returns */ }
  // Do not cache a failure for the full 30 minutes: retry after 2.
  airCache.set(k, { at: v ? Date.now() : Date.now() - 28 * 60_000, v });
  if (airCache.size > 50) airCache.delete(airCache.keys().next().value as string);
  return v;
}
async function withAir(body: string, want: boolean, lat: number, lon: number): Promise<string> {
  if (!want) return body;
  try {
    const j = JSON.parse(body);
    j.airQuality = await airFor(lat, lon);
    j.fetchedAt = new Date().toISOString();
    return JSON.stringify(j);
  } catch { return body; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  let lat = url.searchParams.get("lat");
  let lon = url.searchParams.get("lon");
  let dataSets = url.searchParams.get("dataSets") ?? "currentWeather";
  let lang = url.searchParams.get("lang") ?? "en";
  let country = url.searchParams.get("country") ?? "";
  let air = url.searchParams.get("air") === "1";

  // Accept a JSON body too, so supabase.functions.invoke() works unchanged.
  if (req.method === "POST") {
    try {
      const b = await req.json();
      lat = b.lat != null ? String(b.lat) : lat;
      lon = b.lon != null ? String(b.lon) : lon;
      if (b.dataSets) dataSets = String(b.dataSets);
      if (b.lang) lang = String(b.lang);
      if (b.country) country = String(b.country);
      if (b.air) air = true;
    } catch { /* query params only, fine */ }
  }

  const nLat = Number(lat), nLon = Number(lon);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLon) || Math.abs(nLat) > 90 || Math.abs(nLon) > 180) {
    return J({ ok: false, error: "lat and lon are required, and must be a real coordinate" }, 400);
  }
  if (!/^[a-zA-Z,]+$/.test(dataSets)) return J({ ok: false, error: "bad dataSets" }, 400);
  if (!/^[a-zA-Z-]{2,10}$/.test(lang)) return J({ ok: false, error: "bad lang" }, 400);

  const key = `${nLat.toFixed(2)},${nLon.toFixed(2)}|${dataSets}|${lang}|${country}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return new Response(await withAir(hit.body, air, nLat, nLon), {
      status: hit.status,
      headers: { "Content-Type": "application/json", ...CORS, "X-Bestly-Weather-Cache": "hit" },
    });
  }

  const { data, error } = await db.rpc("get_weatherkit_credentials");
  if (error) return J({ ok: false, error: `vault read failed: ${error.message}` }, 500);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { team_id: string | null; service_id: string | null; key_id: string | null; private_key: string | null }
    | null;

  const missing = [
    ["weatherkit_team_id", row?.team_id],
    ["weatherkit_service_id", row?.service_id],
    ["weatherkit_key_id", row?.key_id],
    ["weatherkit_private_key", row?.private_key],
  ].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) {
    return J({ ok: false, error: `not configured yet - missing from the vault: ${missing.join(", ")}` }, 503);
  }

  let token: string;
  try {
    token = await mintToken(row!.team_id!, row!.service_id!, row!.key_id!, row!.private_key!);
  } catch (e) {
    // Almost always the .p8 stored in some form other than a PKCS#8 PEM.
    return J({ ok: false, error: `could not sign: ${(e as Error).message}` }, 500);
  }

  const api = new URL(`https://weatherkit.apple.com/api/v1/weather/${lang}/${nLat}/${nLon}`);
  api.searchParams.set("dataSets", dataSets);
  if (country) api.searchParams.set("country", country);

  const res = await fetch(api, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();

  if (!res.ok) {
    const help = res.status === 401
      ? " - Apple rejected the token. Check that weatherkit_service_id is the Services ID (not an app/bundle ID) and that the key has WeatherKit enabled."
      : res.status === 404
        ? " - no data for that coordinate."
        : "";
    return J({ ok: false, status: res.status, error: `WeatherKit ${res.status}${help}`, body: body.slice(0, 500) }, 502);
  }

  cache.set(key, { at: Date.now(), body, status: res.status });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);

  return new Response(await withAir(body, air, nLat, nLon), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS, "X-Bestly-Weather-Cache": "miss" },
  });
});
