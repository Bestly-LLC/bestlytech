// tire-next-steps: the Flat Tire Desk engine (Car Guard + Ava, 2026-10-29). Lesson from Craig's trip (62784054): Turo Roadside
// asked "if you know a place to get a tire it can get towed there" and Jared had to find one by hand. Turo's flat tire policy:
// the host chooses where the car is towed, and a replacement tire needs the host's OK (equal or better quality).
//
//   {op:"step", id}   service (cron tire-desk, every minute, and tire_desk_open): moves one tire_incidents row forward
//     finding    -> shops near the car with TomTom Search (Vault tomtom_api_key) plus the nearest Tesla Service. No OpenStreetMap:
//                   through pg_net one Overpass lookup held every other pg_net request in the database for about 2 minutes
//                   (measured 2026-10-29), and near the test spot it had 4 shops, 2 with a phone number. If TomTom refuses,
//                   Jared is told plainly instead of getting a guess.
//     calling    -> Ava calls up to 3 shops with a phone number (ava-assistant action "call"): 235/45R18 in stock? price
//                   installed? can they take a tow-in now? Claimed first (tire_desk_claim) so a shop is never called twice.
//     collecting -> each finished call (ava_calls) is read by free AI into a short answer; when all are in (or 12 minutes
//                   pass) the shops are ranked and Jared gets the shortlist push -> /admin/tires, where he taps one.
//   {op:"find", lat, lon}   service / admin: the shop lookup alone, nothing saved (testing).
// The guest only ever gets a tow plan Jared picked (tire_desk_pick). Free AI only for reading calls; never paid AI.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm } from "../_shared/free-llm.ts";

const SECRETS: string[] = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const SB = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB, SECRETS[0] ?? "", { auth: { persistSession: false } });
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const MAX_CALLS = 3, COLLECT_MIN = 12;

type Result = { reached: boolean; in_stock: "yes" | "no" | "unknown"; brand?: string; price_each?: number | null; tow_in_now: "yes" | "no" | "unknown"; ready_in?: string; notes?: string };
type Place = { name: string; phone?: string; address?: string; hours?: string; open_now?: boolean | null; mi: number; src: string; call_id?: string | null; call_error?: string; result?: Result; score?: number };
type Incident = { id: string; reservation_id: number; guest_first: string | null; reason: string | null; status: string; lat: number | null; lon: number | null;
  shops: Place[]; tesla: Place | null; src: string | null; calls_at: string | null; opened_at: string };

function miles(a: number, b: number, c: number, d: number) {
  const r = (x: number) => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return Math.round(3958.8 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}
function phoneFmt(p?: string) {
  if (!p) return undefined;
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : undefined;
}
const save = (id: string, patch: Record<string, unknown>, log?: string) => db.rpc("tire_desk_save", { p_id: id, p_patch: patch, p_log: log ?? null });
const minsSince = (iso: string | null) => iso ? (Date.now() - Date.parse(iso)) / 60000 : 0;

// ---------------- finding ----------------
const tesla = (q: string) => /tesla/i.test(q);
async function tomtom(key: string, lat: number, lon: number, q: string, radius: number, cats?: string): Promise<Place[] | null> {
  const u = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${key}&lat=${lat}&lon=${lon}&radius=${radius}` +
    `&limit=10&idxSet=POI&openingHours=nextSevenDays&countrySet=US${cats ? `&categorySet=${cats}` : ""}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(12_000) });
  if (r.status === 403 || r.status === 401) return null;            // key not allowed to search: fall back to OpenStreetMap
  if (!r.ok) throw new Error(`tomtom ${r.status}`);
  const j = await r.json();
  const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  // deno-lint-ignore no-explicit-any
  const stamp = (t: any) => `${t.date} ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
  // deno-lint-ignore no-explicit-any
  // Only repair shops and shops: "tire shop" also matches restaurants named after one ("Tire Shop Taqueria", 2026-10-29 test).
  const okKind = (x: any) => (x.poi?.classifications ?? []).some((c: any) => ["REPAIR_FACILITY", "SHOP", "CAR_DEALER"].includes(c.code))
    && !/taquer|restaurant|grill|caf[eé]|kitchen|food|bakery|\bbar\b/i.test(x.poi?.name ?? "");
  return (j.results ?? []).filter((x: any) => x.poi?.name && (tesla(q) || okKind(x))).map((x: any) => {
    const ranges = x.poi?.openingHours?.timeRanges ?? [];
    let open: boolean | null = ranges.length ? false : null;
    for (const t of ranges) if (t.startTime && t.endTime && now >= stamp(t.startTime) && now <= stamp(t.endTime)) open = true;
    return { name: x.poi.name, phone: phoneFmt(x.poi.phone), address: x.address?.freeformAddress, open_now: open,
      mi: miles(lat, lon, x.position.lat, x.position.lon), src: "tomtom" } as Place;
  });
}

function dedupe(xs: Place[]) {
  const seen = new Set<string>();
  return xs.filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })   // closed ones stay, ranked lower
    .sort((a, b) => (Number(!!b.phone) - Number(!!a.phone)) || (Number(b.open_now === true) - Number(a.open_now === true)) || a.mi - b.mi)
    .slice(0, 8);
}

async function finding(i: Incident) {
  if (i.lat == null || i.lon == null) return ready(i, [], null, "The car's location wasn't known, so I couldn't look up shops.");
  const lat = i.lat, lon = i.lon;
  let tt: Place[] | null = null, err = "";
  try {
    const { data: key } = await db.rpc("sky_tomtom_key");
    tt = key ? await tomtom(String(key), lat, lon, "tire shop", 12000) : null;
    if (tt === null) err = "TomTom search isn't switched on for the Bestly TomTom key";
    else tt = tt.concat((await tomtom(String(key), lat, lon, "tires", 12000, "7310").catch(() => null)) ?? []);   // repair shops that sell tires
    if (tt && tt.length) {
      const ts = ((await tomtom(String(key), lat, lon, "Tesla Service Center", 40000)) ?? []).filter((p) => /tesla/i.test(p.name)).sort((a, b) => a.mi - b.mi)[0] ?? null;
      await save(i.id, { shops: dedupe(tt), tesla: ts, src: "tomtom", status: "calling" }, `Found ${tt.length} tire shops with TomTom`);
      return step(i.id);
    }
  } catch (e) { err = (e as Error).message; }
  const { data: set } = await db.from("car_tire_settings").select("tesla_fallback").eq("id", 1).single();
  const ts = set?.tesla_fallback ? { name: set.tesla_fallback, mi: NaN, src: "settings" } as Place : null;
  return ready(i, [], ts, `I couldn't look up tire shops near the car${err ? ` (${err})` : ""}.`);
}

// ---------------- calling ----------------
async function calling(i: Incident) {
  if (!(await db.rpc("tire_desk_claim", { p_id: i.id, p_from: "calling", p_to: "collecting" })).data) return { ok: true, skip: "another step is calling" };
  const { data: set } = await db.from("car_tire_settings").select("tire_size").eq("id", 1).single();
  const size = set?.tire_size ?? "235/45R18";
  const shops = [...i.shops];
  let placed = 0;
  const test = /^\[test\]/i.test(i.reason ?? "");   // a test incident: the real lookup and ranking, no calls, no push
  for (const p of shops) {
    if (placed >= MAX_CALLS) break;
    if (!p.phone || p.call_id) continue;
    if (p.open_now === false) { p.call_error = "closed now"; continue; }   // nobody would answer
    if (test) { p.call_error = "test run: Ava did not call"; continue; }
    const purpose = `You're calling ${p.name}, a tire shop, for Jared. His rental Tesla Model 3 has a flat and may be towed to a shop. ` +
      `Ask three things: 1) do they have a ${size} tire in stock today, and which brand; 2) the price per tire, installed; ` +
      `3) can they take the car if it's towed in now, and how long until it's done. Don't book, commit, or give any payment or personal details. ` +
      `If they're closed or can't help, thank them and end the call. Keep it short.`;
    try {
      const r = await fetch(`${SB}/functions/v1/ava-assistant`, { method: "POST",
        headers: { authorization: `Bearer ${SECRETS[0]}`, apikey: SECRETS[0], "content-type": "application/json" },
        body: JSON.stringify({ action: "call", phone: p.phone, name: p.name, purpose,
          first_line: `Hi, it's Ava, Jared's AI assistant, on a recorded line. Quick question about a tire for a Tesla Model 3.` }),
        signal: AbortSignal.timeout(30_000) });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) { p.call_id = j.call_id ?? null; placed++; } else p.call_error = String(j?.error ?? `HTTP ${r.status}`).slice(0, 160);
    } catch (e) { p.call_error = (e as Error).message.slice(0, 160); }
  }
  if (!placed) {
    const allClosed = shops.length > 0 && shops.every((p) => p.open_now === false);
    return ready({ ...i, shops }, shops, i.tesla, allClosed
      ? "Every tire shop near the car is closed right now, so Ava didn't call. The car can be towed to one for the morning, or to Tesla Service."
      : "Ava couldn't reach any shop by phone, so here's the list to call yourself.");
  }
  await save(i.id, { shops, calls_at: new Date().toISOString() }, `Ava is calling ${placed} shop${placed > 1 ? "s" : ""}`);
  return { ok: true, calling: placed };
}

// ---------------- collecting ----------------
const READ = `You read the transcript of a short phone call where an AI assistant asked a tire shop about a tire for a Tesla Model 3.
Return JSON only: {"reached": true|false (a person at the shop answered the questions), "in_stock": "yes"|"no"|"unknown",
"brand": "brand they named or empty", "price_each": number in US dollars per tire installed or null, "tow_in_now": "yes"|"no"|"unknown",
"ready_in": "how soon it would be done, in their words, or empty", "notes": "anything else that matters, one short sentence or empty"}.
Only use what the shop said. Never guess a price.`;

async function readCall(callId: string): Promise<Result | null> {
  const { data: c } = await db.from("ava_calls").select("status, summary, transcript, created_at").eq("id", callId).maybeSingle();
  if (!c) return { reached: false, in_stock: "unknown", tow_in_now: "unknown", notes: "call record not found" };
  if (c.status === "failed") return { reached: false, in_stock: "unknown", tow_in_now: "unknown", notes: "the call didn't connect" };
  if (c.status !== "completed") return null;
  // deno-lint-ignore no-explicit-any
  const text = (Array.isArray(c.transcript) ? c.transcript : []).map((t: any) => `${t.role === "agent" ? "Ava" : "Shop"}: ${t.message ?? ""}`)
    .join("\n").slice(0, 5000);
  if (!text.trim()) return { reached: false, in_stock: "unknown", tow_in_now: "unknown", notes: c.summary ?? "no answer" };
  const j = await llm({ task: "judge", system: READ, json: true, maxTokens: 300, job: "tire-desk-read", ref: callId, fn: "tire-next-steps",
    scope: "background", paid: "never", privacy: "private", user: `Call summary: ${c.summary ?? ""}\n\nTranscript:\n${text}`,
    validate: (o) => ["yes", "no", "unknown"].includes(o?.in_stock) ? null : "in_stock must be yes, no or unknown" });
  const o = j.json ?? {};
  const price = Number(o.price_each);
  return { reached: !!o.reached, in_stock: o.in_stock, brand: String(o.brand ?? "").slice(0, 40), price_each: Number.isFinite(price) && price > 0 ? price : null,
    tow_in_now: ["yes", "no"].includes(o.tow_in_now) ? o.tow_in_now : "unknown", ready_in: String(o.ready_in ?? "").slice(0, 60), notes: String(o.notes ?? "").slice(0, 160) };
}

async function collecting(i: Incident) {
  const shops = [...i.shops];
  let pending = 0, changed = false;
  for (const p of shops) {
    if (!p.call_id || p.result) continue;
    try {
      const r = await readCall(p.call_id);
      if (r) { p.result = r; changed = true; } else pending++;
    } catch (_) { pending++; }
  }
  if (pending && minsSince(i.calls_at) < COLLECT_MIN) { if (changed) await save(i.id, { shops }); return { ok: true, waiting: pending }; }
  return ready(i, shops, i.tesla, null);
}

// ---------------- ready: rank + push Jared ----------------
function score(p: Place) {
  const r = p.result;
  let s = -p.mi;
  if (r?.in_stock === "yes") s += 40; if (r?.in_stock === "no") s -= 40;
  if (r?.tow_in_now === "yes") s += 20; if (r?.tow_in_now === "no") s -= 20;
  if (r?.reached) s += 5; if (p.phone) s += 2;
  if (p.open_now === false) s -= 15; if (p.open_now === true) s += 3;
  if (r?.price_each) s -= r.price_each / 50;
  return Math.round(s * 10) / 10;
}
function short(p: Place, n: number) {
  const r = p.result;
  const said = p.open_now === false ? "closed now" : !r ? "not called" : !r.reached ? "no answer" :
    [r.in_stock === "yes" ? `in stock${r.brand ? ` (${r.brand})` : ""}` : r.in_stock === "no" ? "no tire in stock" : "stock unclear",
      r.price_each ? `$${Math.round(r.price_each)} installed` : null, r.tow_in_now === "yes" ? "can take it now" : r.tow_in_now === "no" ? "can't take it now" : null,
      r.ready_in || null].filter(Boolean).join(", ");
  return `${n}) ${p.name}, ${p.mi} mi: ${said}`;
}
async function ready(i: Incident, shops: Place[], tesla: Place | null, why: string | null) {
  const ranked = shops.map((p) => ({ ...p, score: score(p) })).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  await save(i.id, { shops: ranked, tesla, status: "ready" }, why ?? `Shortlist ready (${ranked.filter((p) => p.result).length} called)`);
  const who = i.guest_first ?? "the guest";
  const body = ranked.length
    ? `${why ? why + " " : ""}${ranked.slice(0, 3).map((p, n) => short(p, n + 1)).join(". ")}. Tap one on the Tire Desk and I'll send ${who} the tow plan in the Turo chat.`
    : `${why ?? "No shops found near the car."} Message ${who} in the Turo chat where to tow it${tesla ? `, or use ${tesla.name}` : ""}.`;
  if (/^\[test\]/i.test(i.reason ?? "")) return { ok: true, ready: ranked.length, test: true, body };
  await db.rpc("scout_notify", { p_title: `Car Guard: pick a tire shop for ${who}`, p_body: body.slice(0, 900), p_severity: "warning",
    p_push: true, p_url: "/admin/tires", p_dedupe: `tire-ready-${i.id}` });
  return { ok: true, ready: ranked.length };
}

async function step(id: string): Promise<Record<string, unknown>> {
  const { data: i } = await db.from("tire_incidents").select("*").eq("id", id).maybeSingle();
  if (!i) return { ok: false, error: "no such incident" };
  if (i.status === "finding") return await finding(i as Incident);
  if (i.status === "calling") return await calling(i as Incident);
  if (i.status === "collecting") return await collecting(i as Incident);
  return { ok: true, status: i.status };
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
  try {
    if (b.op === "step") return J(await step(String(b.id ?? "")));
    if (b.op === "find") {   // lookup only, nothing saved
      const { data: key } = await db.rpc("sky_tomtom_key");
      const tt = key ? await tomtom(String(key), Number(b.lat), Number(b.lon), "tire shop", 12000) : null;
      return J({ ok: true, tomtom: tt === null ? "key not allowed to search" : dedupe(tt) });
    }
    return J({ ok: false, error: "unknown op" }, 400);
  } catch (e) {
    return J({ ok: false, error: (e as Error).message.slice(0, 300) }, 500);
  }
});
