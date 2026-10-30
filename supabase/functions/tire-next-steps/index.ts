// tire-next-steps (Car Guard, 2026-10-29). Lesson from Craig's trip (62784054): Turo Roadside asked "if you know a place to
// get a tire it can get towed there", and nobody had an answer ready. Turo's flat tire policy: if the tire can't be fixed on
// the spot the car is towed to a garage chosen by the HOST, and a replacement tire needs the host's OK (equal or better quality).
//
// What it does, for one reservation:
//   1. Finds where the car is (turo_vehicle_state).
//   2. Finds tire shops near it: TomTom Search when the key allows it, else OpenStreetMap (free, sparse in places), plus the
//      nearest Tesla Service for a damaged wheel or suspension.
//   3. Posts one "where to tow" message in the Turo chat (turo_out_msgs 'tire_next', sent by turo-reader on bestly-pi) and sends
//      Jared the same list (Car Guard, car.tire.next.*), so he can change the pick by messaging the guest.
// Called by: car_tire_evaluate (Tesla hard warning) and the turo_inbox trigger (guest writes about a flat / tire), both through
// invoke_edge_function with the service key; or by Jared (admin sign-in) to refresh the list. Once per trip unless force.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRETS: string[] = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRETS[0] ?? "", { auth: { persistSession: false } });
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

type Place = { name: string; phone?: string; address?: string; hours?: string; open_now?: boolean | null; mi: number; mobile?: boolean; src: string };

function miles(a: number, b: number, c: number, d: number) {
  const r = (x: number) => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
function phoneFmt(p?: string) {
  if (!p) return undefined;
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p.trim();
}

// ---- TomTom (needs the Search API enabled on Vault tomtom_api_key; 403 otherwise)
async function tomtom(key: string, lat: number, lon: number, q: string, radius: number): Promise<Place[] | null> {
  const u = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${key}&lat=${lat}&lon=${lon}&radius=${radius}` +
    `&limit=10&idxSet=POI&openingHours=nextSevenDays&countrySet=US`;
  const r = await fetch(u, { signal: AbortSignal.timeout(12_000) });
  if (r.status === 403 || r.status === 401) return null;            // key not allowed to search: caller falls back
  if (!r.ok) throw new Error(`tomtom ${r.status}`);
  const j = await r.json();
  // TomTom's opening hours are local wall-clock times: compare as "YYYY-MM-DD HH:MM" strings in Los Angeles time.
  const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const stamp = (t: any) => `${t.date} ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
  return (j.results ?? []).filter((x: any) => x.poi?.name).map((x: any) => {
    const ranges = x.poi?.openingHours?.timeRanges ?? [];
    let open: boolean | null = ranges.length ? false : null;
    for (const t of ranges) {
      if (t.startTime && t.endTime && now >= stamp(t.startTime) && now <= stamp(t.endTime)) open = true;
    }
    return { name: x.poi.name, phone: phoneFmt(x.poi.phone), address: x.address?.freeformAddress, open_now: open,
      mi: Math.round(miles(lat, lon, x.position.lat, x.position.lon) * 10) / 10, mobile: /mobile/i.test(x.poi.name), src: "tomtom" } as Place;
  });
}

// ---- OpenStreetMap (free; overpass-api.de is the only mirror that answers reliably, see hunter-run)
async function osm(lat: number, lon: number, tesla: boolean): Promise<Place[]> {
  const q = tesla
    ? `[out:json][timeout:40];(nwr(around:40000,${lat},${lon})["name"~"Tesla",i]["shop"~"car|car_repair"];nwr(around:40000,${lat},${lon})["brand"="Tesla"]["service:vehicle:repair"="yes"];);out center tags;`
    : `[out:json][timeout:40];(nwr(around:12000,${lat},${lon})["shop"="tyres"];nwr(around:12000,${lat},${lon})["service:vehicle:tyres"="yes"];nwr(around:12000,${lat},${lon})["craft"="tyres"];);out center tags;`;
  // Overpass answers 406 to every edge-runtime request (hunter-osm finding, 2026-10-11), so ask through pg_net like hunter-run does:
  // hunter_net_get queues the GET from the database, hunter_net_result is polled until the answer lands.
  const { data: id, error } = await db.rpc("hunter_net_get", { p_url: "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q), p_timeout_ms: 90000 });
  if (error || id == null) throw new Error("overpass: could not queue (" + (error?.message ?? "no id") + ")");
  let ans: { status?: number; body?: string; error?: string } | null = null;
  for (let i = 0; i < 45 && !ans; i++) {
    await new Promise((ok) => setTimeout(ok, 2000));
    const { data } = await db.rpc("hunter_net_result", { p_id: Number(id) });
    if (data && (data.status != null || data.error)) ans = data;
  }
  if (!ans) throw new Error("overpass: no answer in 90 s");
  if (ans.status !== 200) throw new Error(`overpass ${ans.status ?? ans.error}`);
  const j = JSON.parse(ans.body ?? "{}");
  return (j.elements ?? []).filter((e: any) => e.tags?.name).map((e: any) => {
    const t = e.tags, la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
    const addr = [t["addr:housenumber"], t["addr:street"], t["addr:city"]].filter(Boolean).join(" ") || undefined;
    return { name: t.name, phone: phoneFmt(t.phone ?? t["contact:phone"]), address: addr, hours: t.opening_hours, open_now: null,
      mi: Math.round(miles(lat, lon, la, lo) * 10) / 10, mobile: /mobile/i.test(t.name), src: "osm" } as Place;
  });
}

function rank(xs: Place[]) {
  const seen = new Set<string>();
  return xs.filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return p.open_now !== false; })
    .sort((a, b) => (Number(!!b.phone) - Number(!!a.phone)) || (Number(b.open_now === true) - Number(a.open_now === true)) || a.mi - b.mi);
}
function line(p: Place, i?: number) {
  const bits = [p.name, p.address, `${p.mi} mi away`, p.phone, p.open_now === true ? "open now" : p.hours ? `hours ${p.hours}` : null].filter(Boolean);
  return (i != null ? `${i}) ` : "") + bits.join(", ");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let allowed = SECRETS.includes(bearer) || SECRETS.includes(req.headers.get("apikey") ?? "");
  if (!allowed && bearer) {
    const { data } = await db.auth.getUser(bearer);
    if (data?.user) allowed = !!(await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" })).data;
  }
  if (!allowed) return J({ ok: false, error: "unauthorized" }, 401);
  const b = await req.json().catch(() => ({}));
  const res = Number(b.reservation_id);
  if (!Number.isFinite(res) || res <= 0) return J({ ok: false, error: "bad reservation_id" }, 400);

  const { data: ctx, error: ce } = await db.rpc("car_tire_next_context", { p_res: res });
  if (ce) return J({ ok: false, error: ce.message }, 500);
  if (!ctx?.ok) return J(ctx ?? { ok: false });
  if (ctx.already && !b.force && !b.dry) return J({ ok: true, skip: "already sent for this trip" });
  // dry: build the message for a given spot (or the car's) and return it; nothing is queued or sent.
  const lat = Number(b.dry && b.lat != null ? b.lat : ctx.lat), lon = Number(b.dry && b.lon != null ? b.lon : ctx.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return J({ ok: false, error: "no car location" });

  let shops: Place[] = [], tesla: Place[] = [], src = "tomtom";
  const tried: string[] = [];
  try {
    const { data: key } = await db.rpc("sky_tomtom_key");
    const tt = key ? await tomtom(String(key), lat, lon, "tire shop", 12000) : null;
    if (tt) {
      shops = tt;
      tesla = (await tomtom(String(key), lat, lon, "Tesla Service Center", 40000)) ?? [];
    } else tried.push("tomtom: key not allowed to search");
  } catch (e) { tried.push(`tomtom: ${(e as Error).message}`); }
  // OpenStreetMap: both lookups at once (each can take 30-60 s through pg_net)
  const [os, ot] = await Promise.all([
    shops.length ? Promise.resolve(null) : osm(lat, lon, false).catch((e) => { tried.push(`osm: ${(e as Error).message}`); return null; }),
    tesla.length ? Promise.resolve(null) : osm(lat, lon, true).catch((e) => { tried.push(`osm tesla: ${(e as Error).message}`); return null; }),
  ]);
  if (os) { shops = os; src = "osm"; }
  if (ot) tesla = ot;
  const top = rank(shops).slice(0, 3);
  const ts = rank(tesla.filter((p) => /tesla/i.test(p.name))).sort((a, b) => a.mi - b.mi)[0]
    ?? (ctx.tesla_fallback ? { name: ctx.tesla_fallback, mi: NaN, src: "settings" } as Place : undefined);

  const size = ctx.tire_size ? `Tire size: ${ctx.tire_size}. ` : "";
  const shopsText = top.length
    ? `please have them tow the car to one of these tire shops near you, and tell me here which one: ${top.map((p, i) => line(p, i + 1)).join(". ")}. Please call ahead to check they have the tire in stock. `
    : `please message me here before they tow it, and I'll tell you where it should go. `;
  const call = ctx.hard_sent ? "" : `If you haven't yet, call Turo Roadside Assistance, 24/7: ${ctx.roadside ?? "(415) 965-4525"}. `;
  const body = `${call}Next steps if Turo Roadside can't fix the tire where the car is: ${shopsText}${size}` +
    `Before a new tire goes on, have the shop send me the brand and price here so I can approve it, per Turo's flat tire policy. ` +
    (ts ? `If the wheel or suspension looks damaged, not just the tire, the car shouldn't be driven; have it towed to ${ts.name}${ts.address ? ", " + ts.address : ""} instead.` : "");

  if (b.dry) return J({ ok: true, dry: true, src, tried, shops: top, tesla: ts ?? null, body, chars: body.length });
  const { data: put, error: pe } = await db.rpc("car_tire_next_put", { p_res: res, p_body: body, p_force: !!b.force,
    p_detail: { src, tried, shops: top, tesla: ts ?? null, car: { lat, lon, at: ctx.at }, reason: b.reason ?? null } });
  if (pe) return J({ ok: false, error: pe.message }, 500);
  return J({ ok: true, src, shops: top.length, tesla: ts?.name ?? null, put });
});
