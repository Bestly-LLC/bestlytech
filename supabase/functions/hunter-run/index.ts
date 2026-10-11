// hunter-run: Hunter, Bestly's lead-generation employee (Phase 1 engine, 2026-10-11).
//
// Finds local service businesses for Maya's cold-calling campaigns, cleans and dedupes them, reads each website, scores
// how well the Bestly Agent (AI receptionist) fits with the free AI ladder, checks the phone line type, and hands the
// best landline leads to Maya's queue. No Claude tokens: free sources, free AI (paid: "never"), Telnyx lookups only.
//
//   {op:"find",    sources?:["openstreetmap","la_open_data"], limit?:200, fire?:true, backlog?:120}
//                  two-phase discovery: reads the map answer asked for last call, inserts leads (status new), then asks for the next tile
//   {op:"read",    limit?:25, budget_ms?:100000}                           homepage read + fit score (free AI)
//   {op:"check",   limit?:40, max_lookups?:N}                              Telnyx line type (only fit leads, daily cap)
//   {op:"handoff"}                                                         top each campaign's queue up to its daily target
//   {op:"tick"}                                                            nightly worker: read, check, hand off when drained
//   {op:"watch",   dry?:true}                                              watchdog: self-heal once, then alert "Hunter: ..." (also judges scoring and Jev, see hunter-score)
//
// Callers: pg_cron (hunter-find nightly, hunter-tick every 3 min overnight, hunter-handoff, hunter-watch).
// Auth: Vault edge_proxy_key (x-proxy-key) or the service key, same as roofguard-enrich.
//
// RoofGuard stays separable: this function reads rg_leads (by phone) and rg_dnc only through hunter_insert_leads, and
// never writes to them.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
// deno-lint-ignore no-explicit-any
const db: any = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const UA = "BestlyHunter/1.0 (jared@bestly.tech)";

// The free AI ladder (FreeLLM, then Groq/Gemini/Cloudflare; never paid) lives in _shared/free-llm.ts and is reached through
// the deployed `free-llm` function's `run` op, so Hunter reuses it without a second copy of the 1,100-line helper.
async function askFreeAi(system: string, user: string, valid: (j: any) => boolean): Promise<any> {
  let last = "no answer";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/free-llm`, {
        method: "POST", signal: AbortSignal.timeout(60_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET },
        body: JSON.stringify({ op: "run", task: "classify", system, user, json: true, privacy: "private", paid: "never", maxTokens: 300 }),
      });
      const j = await r.json();
      if (j?.ok && valid(j.json)) return j.json;
      last = j?.error ?? "unusable answer";
    } catch (e) { last = String(e).slice(0, 100); }
  }
  throw new Error("free AI unavailable: " + last);
}
const PT = "America/Los_Angeles";

type Counts = { found: number; deduped: number; checked: number; rejected: number; queued: number };
const zero = (): Counts => ({ found: 0, deduped: 0, checked: 0, rejected: 0, queued: 0 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function authorized(req: Request): Promise<boolean> {
  const k = req.headers.get("x-proxy-key");
  if (k) {
    for (const n of ["edge_proxy_key_sha256", "edge_proxy_key_prev_sha256"]) {
      const { data } = await db.rpc("edge_key_ok", { p_name: n, p_key: k });
      if (data === true) return true;
    }
  }
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  return [bearer, apikey].some((t) => t && SERVICE_KEYS.has(t));
}

/* ───────── what each business type means in the two data sources ───────── */

const TYPES: Record<string, { label: string; naics: string[]; base: number }> = {
  auto_repair: { label: "auto repair shop", naics: ["811111", "811112", "811113", "811114", "811118", "811121", "811198"], base: 55 },
  salon: { label: "salon", naics: ["812112", "812113", "812111"], base: 58 },
  home_services: { label: "home-service contractor", naics: ["238220", "238210", "238160"], base: 55 },
  clinic: { label: "small clinic", naics: ["621111", "621210", "621310", "621320"], base: 50 },
};

// 2026-10-11: home services ran 1 to 2 of 7 a day because OSM only tagged four trades were searched. Same free source, wider list of trades.
const HOME_CRAFTS = ["plumber", "hvac", "electrician", "roofer", "carpenter", "painter", "plasterer", "tiler", "glaziery", "gardener", "locksmith", "handyman", "floorer", "insulation", "window_construction", "garage_door"];

function osmType(t: Record<string, string>): string | null {
  if (t.shop === "car_repair") return "auto_repair";
  if (t.shop === "hairdresser" || t.shop === "beauty") return "salon";
  if (HOME_CRAFTS.includes(t.craft)) return "home_services";
  if (["clinic", "dentist", "doctors"].includes(t.amenity)) return "clinic";
  if (["doctor", "dentist", "clinic", "chiropractor", "physiotherapist", "optometrist", "alternative"].includes(t.healthcare)) return "clinic";
  return null;
}

// Chains and big institutions are not local-owner prospects.
const CHAIN = /\b(jiffy lube|midas|meineke|pep boys|firestone|valvoline|monro|les schwab|aamco|maaco|caliber|great clips|supercuts|sport clips|fantastic sams|regis|cost cutters|ulta|sally beauty|massage envy|kaiser|ucla|cedars|providence|dignity health|sutter|davita|concentra|one medical|minuteclinic|cvs|walgreens|rite aid|aspen dental|western dental|coast dental|heartland dental|brightnow|roto-rooter|mr\.? rooter|one hour|rescue rooter|aire serv|service experts|home depot|lowe'?s|sears|walmart|costco|target|autozone|o'?reilly|advance auto|napa auto|discount tire|goodyear|pacific dental|smile brands|hospital|medical center|medical group|health system|health center|institute|foundation|children'?s|university)\b/i;
const BAD_HOSTS = /(wikipedia|wikidata|linkedin|facebook|fb\.com|twitter|x\.com|instagram|youtube|yelp|mapquest|bbb\.org|yellowpages|google|bing|tiktok|linktr\.ee|booksy\.com|vagaro\.com|fresha\.com|squareup\.com|square\.site|zocdoc|healthgrades|angi|thumbtack|homeadvisor|nextdoor|apple\.com)/i;

/* ───────── small helpers ───────── */

function e164(raw: unknown): string | null {
  const first = String(raw ?? "").split(/[;,\/]| or /i)[0];
  const d = first.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  if (/^(\d)\1{9}$/.test(d) || d.slice(3, 6) === "555") return null;
  return `+1${d}`;
}

function cleanSite(raw: unknown): string | null {
  let s = String(raw ?? "").trim().split(/[;\s]/)[0];
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".") || BAD_HOSTS.test(u.hostname)) return null;
    return `${u.protocol}//${u.hostname}${u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")}`;
  } catch { return null; }
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);
const cleanName = (s: string) => titleCase(s.replace(/\s*\/[A-Z]{1,2}\s*$/, "").replace(/\s+/g, " ").trim());
const normName = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/\b(inc|llc|co|corp|the|and|of|center|centre|shop|service|services)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1);

function nameMatch(a: string, b: string): boolean {
  const x = normName(a), y = normName(b);
  if (!x.length || !y.length) return false;
  const sx = new Set(x), common = y.filter((w) => sx.has(w)).length;
  return common / Math.min(x.length, y.length) >= 0.6;
}

function ptDayStart(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: PT, timeZoneName: "shortOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT-8";
  const h = Number(off.replace("GMT", "").split(":")[0] || -8);
  return new Date(`${parts}T00:00:00${h < 0 ? "-" : "+"}${String(Math.abs(h)).padStart(2, "0")}:00`).toISOString();
}

// "closes by 6 PM" / "closed weekends" from OpenStreetMap-style or plain-text hours
function hoursSignal(text: string): { early: boolean; weekendClosed: boolean } {
  const t = text.toLowerCase();
  const closes = [...t.matchAll(/(?:-|to|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g)].map((m) => {
    let h = Number(m[1]); const ap = m[3];
    if (ap === "pm" && h < 12) h += 12;
    if (!ap && h <= 12 && h < 8) h += 12;
    return h;
  }).filter((h) => h >= 8 && h <= 24);
  const early = closes.length > 0 && Math.max(...closes) <= 18;
  const weekendClosed = /\b(su|sun|sunday)\b[^;,.]{0,12}\b(off|closed)\b/.test(t) || (/\b(mo|mon)/.test(t) && !/\b(sa|sat|su|sun)/.test(t) && /\d/.test(t));
  return { early, weekendClosed };
}

async function logRuns(step: string, source: string | null, stats: Record<string, Counts>, started: string, error: string | null, detail?: unknown) {
  const keys = Object.keys(stats);
  const rows = (keys.length ? keys : [""]).map((k) => ({
    started_at: started, finished_at: new Date().toISOString(), step, source, campaign_slug: k || null,
    ...(stats[k] ?? zero()), error: error ? error.slice(0, 500) : null, detail: detail ?? null,
  }));
  await db.from("hunter_runs").insert(rows);
}

async function markSource(slug: string, ok: boolean, error?: string) {
  const { data: s } = await db.from("hunter_sources").select("fail_streak").eq("slug", slug).maybeSingle();
  const now = new Date().toISOString();
  await db.from("hunter_sources").update(ok
    ? { last_run_at: now, last_ok_at: now, fail_streak: 0, last_error: null }
    : { last_run_at: now, fail_streak: (s?.fail_streak ?? 0) + 1, last_error: (error ?? "failed").slice(0, 300) }).eq("slug", slug);
}

async function getSources(): Promise<Record<string, { enabled: boolean; cursor: Record<string, unknown>; fail_streak: number; last_error: string | null }>> {
  const { data } = await db.from("hunter_sources").select("slug, enabled, cursor, fail_streak, last_error");
  return Object.fromEntries((data ?? []).map((s: { slug: string; enabled: boolean; cursor: Record<string, unknown>; fail_streak: number; last_error: string | null }) => [s.slug, s]));
}

async function settings(): Promise<{ enabled: boolean; min_fit: number; telnyx_daily_cap: number }> {
  const { data } = await db.from("hunter_settings").select("enabled, min_fit, telnyx_daily_cap").eq("id", true).maybeSingle();
  return data ?? { enabled: true, min_fit: 50, telnyx_daily_cap: 120 };
}

/* ───────── Overpass (OpenStreetMap), asked through pg_net, one query at a time ───────── */

// The public Overpass mirrors turn away requests that come from the edge runtime (406, whatever the headers), but serve the same
// GET made by pg_net. So a find run is two-phase: one call fires the request with hunter_net_get and remembers its id in the
// source's cursor, the next call reads the answer with hunter_net_result (no call ever waits on pg_net, which would stall it).
// Checked from Supabase on 2026-10-11: lz4.overpass-api.de never completes a TLS handshake, overpass.kumi.systems and
// overpass.private.coffee answer 500 to every query, maps.mail.ru times out. Only overpass-api.de works (it answers about half of
// the requests and 504s the rest while it is busy), so a failed tile is simply asked again on the next call.
const OVERPASS = ["https://overpass-api.de/api/interpreter"];
type OsmEl = { type: string; id: number; tags?: Record<string, string>; center?: { lat: number; lon: number }; lat?: number; lon?: number };
type Pending = { id: number; at: number; m: number; per?: number };
type NetAnswer = { status: number | null; body: string | null; error: string | null };

async function netFire(q: string, m: number): Promise<number> {
  const url = OVERPASS[m % OVERPASS.length] + "?data=" + encodeURIComponent(q);
  const { data, error } = await db.rpc("hunter_net_get", { p_url: url, p_timeout_ms: 90000 });
  if (error || data == null) throw new Error("could not queue the request: " + (error?.message ?? "no id"));
  return Number(data);
}

async function netRead(id: number): Promise<NetAnswer | null> {
  const { data } = await db.rpc("hunter_net_result", { p_id: id });
  if (!data || (data.status == null && !data.error)) return null;
  return data as NetAnswer;
}


// LA County, 0.05 degree tiles (about 3.4 mi), nearest to downtown first
const STEP = 0.05;
const TILES: Array<[number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let r = 0; r < 24; r++) for (let c = 0; c < 28; c++) {
    const s = 33.70 + r * STEP, w = -118.95 + c * STEP;
    out.push([s, w, Math.hypot(s + STEP / 2 - 34.05, (w + STEP / 2 + 118.25) * 0.83)]);
  }
  return out.sort((a, b) => a[2] - b[2]).map(([s, w]) => [s, w] as [number, number]);
})();

type Cand = {
  company: string; category: string; address: string | null; city: string | null; zip: string | null; lat: number | null; lon: number | null;
  phone: string | null; phone_source: string | null; website: string | null; email: string | null; business_hours: string | null;
  campaign_slug: string; source: string; source_ref: string;
};

type Campaign = { slug: string; business_types: string[]; daily_target: number };

function pickCampaign(camps: Campaign[], type: string): string | null {
  return camps.find((c) => c.business_types.includes(type))?.slug ?? null;
}

function fromOsm(el: OsmEl, camps: Campaign[]): Cand | null {
  const t = el.tags ?? {};
  const name = (t.name ?? "").trim();
  if (!name || CHAIN.test(name) || CHAIN.test(t.operator ?? "") || CHAIN.test(t.brand ?? "")) return null;
  const type = osmType(t);
  if (!type) return null;
  const slug = pickCampaign(camps, type);
  if (!slug) return null;
  const phone = e164(t.phone ?? t["contact:phone"]);
  const website = cleanSite(t.website ?? t["contact:website"] ?? t.url);
  if (!phone && !website) return null;
  const lat = el.center?.lat ?? el.lat ?? null, lon = el.center?.lon ?? el.lon ?? null;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return {
    company: cleanName(name), category: type, address: street || null, city: t["addr:city"] ?? null, zip: (t["addr:postcode"] ?? "").slice(0, 5) || null,
    lat, lon, phone, phone_source: phone ? "osm" : null, website, email: (t.email ?? t["contact:email"] ?? "").toLowerCase() || null,
    business_hours: t.opening_hours ?? null, campaign_slug: slug, source: "openstreetmap", source_ref: `${el.type}/${el.id}`,
  };
}

// round-robin across business types so a small batch still touches every campaign
function interleave(list: Cand[], limit: number): Cand[] {
  const by = new Map<string, Cand[]>();
  for (const c of list) { if (!by.has(c.category)) by.set(c.category, []); by.get(c.category)!.push(c); }
  for (const arr of by.values()) arr.sort((a, b) => Number(!!b.phone) - Number(!!a.phone) || Number(!!b.website) - Number(!!a.website));
  const out: Cand[] = [];
  while (out.length < limit && [...by.values()].some((a) => a.length)) {
    for (const arr of by.values()) { const x = arr.shift(); if (x && out.length < limit) out.push(x); }
  }
  return out;
}

async function insertCands(cands: Cand[], stats: Record<string, Counts>): Promise<void> {
  const by = new Map<string, Cand[]>();
  for (const c of cands) { if (!by.has(c.campaign_slug)) by.set(c.campaign_slug, []); by.get(c.campaign_slug)!.push(c); }
  for (const [slug, list] of by) {
    const s = (stats[slug] ??= zero());
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const { data, error } = await db.rpc("hunter_insert_leads", { p: chunk });
      if (error) throw new Error("insert failed: " + error.message);
      s.found += chunk.length;
      s.deduped += Number(data?.deduped ?? 0) + Number(data?.optout ?? 0);
    }
  }
}


/* ───────── FIND ───────── */

async function osmQuery(tile: number): Promise<string> {
  const [s, w] = TILES[tile % TILES.length];
  const bb = `${s.toFixed(2)},${w.toFixed(2)},${(s + STEP).toFixed(2)},${(w + STEP).toFixed(2)}`;
  // four regex-value clauses on an indexed key are far cheaper for Overpass than sixteen exact ones (those timed out with 504)
  const sel = ['"shop"~"^(car_repair|hairdresser|beauty)$"', `"craft"~"^(${HOME_CRAFTS.join("|")})$"`, '"amenity"~"^(clinic|dentist|doctors)$"',
    '"healthcare"~"^(doctor|dentist|clinic|chiropractor|physiotherapist|optometrist)$"'];
  return `[out:json][timeout:50];(${sel.map((x) => `nwr[${x}]["name"](${bb});`).join("")});out tags center 600;`;
}

type LaPlan = { pts: Array<{ type: string; r: Record<string, string>; lat: number; lon: number }>; next: Record<string, number>; raw: number; q: string; error?: string };

// City of LA "Listing of Active Businesses" (data.lacity.org). Rows have no phone numbers, so a second step asks OpenStreetMap for
// mapped phones within 70 m of each address and keeps only name matches.
async function laPlan(camps: Campaign[], off0: Record<string, number>, perType: number): Promise<LaPlan> {
  const rows: Array<{ type: string; r: Record<string, string> }> = [];
  const next = { ...off0 };
  for (const [type, def] of Object.entries(TYPES)) {
    if (!pickCampaign(camps, type)) continue;
    const off = Number(off0[type] ?? 0);
    const where = `naics in (${def.naics.map((n) => `'${n}'`).join(",")}) AND street_address is not null`;
    const url = `https://data.lacity.org/resource/6rrh-rzua.json?$select=location_account,business_name,dba_name,street_address,city,zip_code,naics,location_1&$where=${encodeURIComponent(where)}&$order=location_account&$limit=${perType}&$offset=${off}`;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25_000);
      const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: "application/json" } });
      clearTimeout(t);
      if (!r.ok) return { pts: [], next: off0, raw: 0, q: "", error: `data.lacity.org answered ${r.status}` };
      const j = await r.json();
      for (const x of j) rows.push({ type, r: x });
      next[type] = j.length ? off + j.length : 0; // 0 = wrapped around
    } catch (e) { return { pts: [], next: off0, raw: 0, q: "", error: "data.lacity.org: " + String(e).slice(0, 120) }; }
    await sleep(400);
  }
  const pts = rows.map((x) => {
    const l = (x.r.location_1 as unknown as { latitude?: string; longitude?: string }) ?? {};
    return { ...x, lat: Number(l.latitude), lon: Number(l.longitude) };
  }).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  // a tiny box per address is a selective Overpass filter (around-queries with a tag filter scan every phone tag and time out with 504)
  const box = (p: { lat: number; lon: number }) => `${(p.lat - 0.0007).toFixed(5)},${(p.lon - 0.0009).toFixed(5)},${(p.lat + 0.0007).toFixed(5)},${(p.lon + 0.0009).toFixed(5)}`;
  const q = `[out:json][timeout:50];(${pts.map((p) => `nwr["phone"](${box(p)});nwr["contact:phone"](${box(p)});`).join("")});out tags center 800;`;
  return { pts, next, raw: rows.length, q };
}

function laMatch(camps: Campaign[], pts: LaPlan["pts"], els: OsmEl[]): Cand[] {
  const out: Cand[] = [];
  for (const p of pts) {
    const nm = cleanName(p.r.dba_name || p.r.business_name || "");
    if (!nm || CHAIN.test(nm)) continue;
    const hit = els.find((el) => {
      const c = el.center ?? (el.lat != null ? { lat: el.lat, lon: el.lon! } : null);
      return c && Math.abs(c.lat - p.lat) < 0.0009 && Math.abs(c.lon - p.lon) < 0.0012 && nameMatch(nm, el.tags?.name ?? "");
    });
    if (!hit) continue;
    const phone = e164(hit.tags?.phone ?? hit.tags?.["contact:phone"]);
    if (!phone) continue;
    out.push({
      company: nm, category: p.type, address: p.r.street_address ?? null, city: titleCase(p.r.city ?? "Los Angeles"), zip: (p.r.zip_code ?? "").slice(0, 5) || null,
      lat: p.lat, lon: p.lon, phone, phone_source: "osm", website: cleanSite(hit.tags?.website ?? hit.tags?.["contact:website"]),
      email: (hit.tags?.email ?? hit.tags?.["contact:email"] ?? "").toLowerCase() || null, business_hours: hit.tags?.opening_hours ?? null,
      campaign_slug: pickCampaign(camps, p.type)!, source: "la_open_data", source_ref: p.r.location_account,
    });
  }
  return out;
}

// candidates already stored (same source + ref) are dropped first, so a revisited tile moves on to new businesses
async function dropKnown(cands: Cand[]): Promise<{ fresh: Cand[]; known: number }> {
  const known = new Set<string>();
  const refs = [...new Set(cands.map((c) => c.source_ref))];
  for (let i = 0; i < refs.length; i += 80) {
    const { data } = await db.from("maya_leads").select("source_ref").in("source_ref", refs.slice(i, i + 80));
    for (const r of data ?? []) known.add(r.source_ref);
  }
  const fresh = cands.filter((c) => !known.has(c.source_ref));
  return { fresh, known: cands.length - fresh.length };
}

// A failure counts once per Pacific day, so "failing 2 nights" in the watchdog means two nights, not two retries.
async function markFail(slug: string, cur: Record<string, unknown>, error: string): Promise<Record<string, unknown>> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(new Date());
  const { data: s } = await db.from("hunter_sources").select("fail_streak").eq("slug", slug).maybeSingle();
  const first = cur.fail_day !== today;
  await db.from("hunter_sources").update({ last_run_at: new Date().toISOString(), last_error: error.slice(0, 300), ...(first ? { fail_streak: (s?.fail_streak ?? 0) + 1 } : {}) }).eq("slug", slug);
  return { ...cur, fail_day: today };
}

async function opFind(body: { sources?: string[]; limit?: number; fire?: boolean; backlog?: number }) {
  const started = new Date().toISOString();
  const limit = Math.max(1, Math.min(Number(body.limit ?? 200), 400));
  const { data: camps } = await db.from("hunter_campaigns").select("slug, business_types, daily_target").eq("enabled", true).eq("owner", "maya");
  const sources = await getSources();
  const want = (body.sources ?? ["openstreetmap", "la_open_data"]).filter((s) => sources[s]?.enabled);
  const results: Record<string, unknown> = {};
  if (!camps?.length) return { ok: true, note: "no enabled Maya campaigns", results };
  const cur: Record<string, Record<string, unknown>> = {};

  // phase 1: read the answer to whatever request is out, turn it into leads
  for (const slug of want) {
    const c = { ...(sources[slug].cursor ?? {}) } as Record<string, unknown>;
    cur[slug] = c;
    const p = c.pending as Pending | undefined;
    if (!p) continue;
    const stats: Record<string, Counts> = {};
    const ans = await netRead(p.id);
    if (!ans && Date.now() - p.at < 5 * 60_000) { results[slug] = { state: "waiting for the map answer" }; continue; }
    let error: string | null = null, raw = 0, knownN = 0, picked = 0, found = 0;
    try {
      if (!ans) error = "no answer from the map server within 5 minutes";
      else if (ans.status !== 200 || !ans.body) error = ans.status ? `${new URL(OVERPASS[p.m % OVERPASS.length]).hostname} answered ${ans.status}` : String(ans.error ?? "no answer").slice(0, 120);
      else {
        const els = (JSON.parse(ans.body).elements ?? []) as OsmEl[];
        raw = els.length;
        let cands: Cand[];
        const nextCur: Record<string, unknown> = { ...c };
        if (slug === "openstreetmap") {
          cands = els.map((el) => fromOsm(el, camps)).filter(Boolean) as Cand[];
          nextCur.tile = Number(c.tile ?? 0) + 1;
        } else {
          const plan = await laPlan(camps, (c.off ?? {}) as Record<string, number>, p.per ?? 6);
          if (plan.error) throw new Error(plan.error);
          cands = laMatch(camps, plan.pts, els);
          nextCur.off = plan.next;
        }
        const dk = await dropKnown(cands);
        knownN = dk.known;
        const take = interleave(dk.fresh, limit);
        picked = take.length;
        await insertCands(take, stats);
        found = Object.values(stats).reduce((a, s) => a + s.found, 0);
        // a tile cut short by the limit is revisited next time (what was inserted dedupes), so only move on when it was taken whole
        if (slug === "openstreetmap" && take.length < dk.fresh.length) nextCur.tile = Number(c.tile ?? 0);
        cur[slug] = nextCur;
      }
    } catch (e) { error = String(e).slice(0, 200); }
    delete cur[slug].pending;
    if (error) { cur[slug].m = (p.m + 1) % OVERPASS.length; cur[slug] = await markFail(slug, cur[slug], error); }
    else { cur[slug].m = p.m; await markSource(slug, true); }
    await db.from("hunter_sources").update({ cursor: cur[slug] }).eq("slug", slug);
    await logRuns("find", slug, stats, started, error, { raw, known: knownN, picked, mirror: OVERPASS[p.m % OVERPASS.length], cursor: { tile: cur[slug].tile, off: cur[slug].off } });
    const t = Object.values(stats).reduce((a, s) => ({ found: a.found + s.found, deduped: a.deduped + s.deduped }), { found: 0, deduped: 0 });
    results[slug] = { raw, picked, found, deduped: t.deduped, known: knownN, error };
  }

  // phase 2: fire the next request, one source per call (alternating), only while the backlog of unchecked leads is small
  if (body.fire !== false) {
    const { count: backlog } = await db.from("maya_leads").select("id", { count: "exact", head: true }).eq("status", "new");
    const cap = Number(body.backlog ?? 120);
    const idle = want.filter((s) => !(cur[s].pending as Pending | undefined));
    idle.sort((a, b) => Number(cur[a].last_fire ?? 0) - Number(cur[b].last_fire ?? 0));
    const slug = idle[0];
    if (!slug) results._fire = "a request is already out";
    else if ((backlog ?? 0) >= cap) results._fire = `backlog of ${backlog} unchecked leads is full`;
    else {
      try {
        const c = cur[slug];
        const m = Number(c.m ?? 0);
        let q = "", per: number | undefined;
        if (slug === "openstreetmap") q = await osmQuery(Number(c.tile ?? 0));
        else {
          per = 4;
          const plan = await laPlan(camps, (c.off ?? {}) as Record<string, number>, per);
          if (plan.error) throw new Error(plan.error);
          if (plan.pts.length) q = plan.q;
        }
        if (q) {
          const id = await netFire(q, m);
          cur[slug] = { ...c, pending: { id, at: Date.now(), m, per } satisfies Pending, last_fire: Date.now() };
          await db.from("hunter_sources").update({ cursor: cur[slug] }).eq("slug", slug);
          results._fire = `asked the map server for ${slug}`;
        }
      } catch (e) {
        const msg = String(e).slice(0, 200);
        cur[slug] = await markFail(slug, cur[slug], msg);
        await db.from("hunter_sources").update({ cursor: cur[slug] }).eq("slug", slug);
        await logRuns("find", slug, {}, started, msg, { phase: "fire" });
        results._fire = msg;
      }
    }
  }
  return { ok: true, results };
}

/* ───────── READ: homepage + fit score ───────── */

let lastFetch = 0;
let gate: Promise<void> = Promise.resolve();
const robotsCache = new Map<string, boolean>();
async function politeFetch(url: string, ms = 10_000): Promise<{ ok: boolean; status: number; body: string }> {
  // at most one request a second, even with several leads in flight
  const turn = gate.then(() => sleep(Math.max(0, 1100 - (Date.now() - lastFetch)))).then(() => { lastFetch = Date.now(); });
  gate = turn;
  await turn;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,*/*;q=0.5" } });
    const body = r.ok ? (await r.text()).slice(0, 600_000) : "";
    return { ok: r.ok, status: r.status, body };
  } catch { return { ok: false, status: 0, body: "" }; } finally { clearTimeout(t); }
}

async function robotsAllows(origin: string): Promise<boolean> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  const r = await politeFetch(origin + "/robots.txt", 6_000);
  let allowed = true;
  if (r.ok && /user-agent/i.test(r.body)) {
    let applies = false, any = false;
    const dis: string[] = [], allow: string[] = [];
    for (const raw of r.body.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === "user-agent") { if (any && !applies) { /* new group */ } applies = v === "*" || /bestlyhunter/i.test(v); any = true; }
      else if (applies && k === "disallow") dis.push(v);
      else if (applies && k === "allow") allow.push(v);
    }
    if (dis.some((d) => d === "/" || d === "/*") && !allow.some((a) => a === "/" || a === "/$")) allowed = false;
  }
  robotsCache.set(origin, allowed);
  return allowed;
}

type Site = { status: "ok" | "blocked" | "error"; title: string; desc: string; text: string; phones: string[]; emails: string[]; hours: string | null;
  booking: boolean; chat: boolean; ai: boolean };

function parseSite(html: string): Omit<Site, "status"> {
  const lower = html.toLowerCase();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? "").trim().slice(0, 240);
  const text = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&#\d+;/g, " ").replace(/\s+/g, " ").trim();
  const phones = [...new Set([...html.matchAll(/href=["']tel:([^"']+)/gi)].map((m) => e164(decodeURIComponent(m[1]))).filter(Boolean) as string[])];
  const emails = [...new Set([...html.matchAll(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()))]
    .filter((e) => !/(example|sentry|wixpress|godaddy|domain\.com)/.test(e));
  const ld = html.match(/"openingHours"\s*:\s*(\[[^\]]*\]|"[^"]*")/i)?.[1]?.replace(/[\[\]"]/g, "").trim();
  const hrs = ld || text.match(/\b(?:mon(?:day)?|tue(?:s(?:day)?)?)\b[^.]{0,90}?\d{1,2}(?::\d{2})?\s*(?:am|pm)[^.]{0,60}?\d{1,2}(?::\d{2})?\s*(?:am|pm)/i)?.[0];
  return {
    title, desc, text: text.slice(0, 1800), phones, emails, hours: hrs ? hrs.slice(0, 200) : null,
    booking: /(book (an? )?(appointment|online|now)|schedule (an? )?(appointment|online|service|visit)|calendly|acuityscheduling|squareup\.com\/appointments|vagaro|booksy|fresha|mindbody|schedulicity|zocdoc|setmore|simplybook|jobber|housecall ?pro|servicetitan|online booking|request (an? )?(appointment|quote|estimate)|patient portal)/i.test(lower),
    chat: /(livechat|tawk\.to|intercom|drift\.com|crisp\.chat|tidio|olark|chat with us|chat now|zendesk.*chat)/i.test(lower),
    ai: /(ai receptionist|virtual receptionist|answering service|smith\.ai|ruby receptionist|goodcall|24\/7 (answering|phone)|after.hours (answering|calls))/i.test(lower),
  };
}

type Lead = { id: string; company: string; category: string | null; city: string | null; website: string | null; phone: string | null; email: string | null;
  business_hours: string | null; campaign_slug: string | null };

const FIT_SYSTEM = `You score how well a local business fits the Bestly Agent, an AI receptionist that answers every call 24/7 and books appointments for small businesses.
Strong fit signals: appointment-driven (customers book visits or quotes), small staff (owner-operated or a handful of people, so nobody is free to answer the phone), closes by about 6 PM or is closed on weekends, no online booking and no live chat, no existing AI receptionist or answering service.
Weak fit: big or multi-location, hospital or chain, already has online booking AND chat or an answering service, walk-in only with no phone-driven work.
Reply with JSON only: {"fit_score": 0-100 integer, "fit_reason": "one plain sentence a phone caller can say, 140 characters max, using only facts given", "owner_name": "string or null"}.
Score 70 or more only when at least three strong signals are present. Never invent facts. If the information is thin, stay between 40 and 60.`;

function fallbackScore(l: Lead, why: string): { score: number; reason: string } {
  const def = TYPES[l.category ?? ""] ?? { label: "business", base: 50 };
  const sig = hoursSignal(l.business_hours ?? "");
  let s = def.base;
  if (sig.early) s += 10;
  if (sig.weekendClosed) s += 8;
  const facts = [why, sig.early ? "it closes by 6 PM" : "", sig.weekendClosed ? "it is closed some weekend days" : ""].filter(Boolean);
  const reason = `${def.label[0].toUpperCase() + def.label.slice(1)}: ${facts.join("; ")}. Calls after hours likely go unanswered.`.slice(0, 180);
  return { score: Math.min(s, 70), reason };
}

async function scoreLead(l: Lead, minFit: number): Promise<{ upd: Record<string, unknown>; c: Counts; ai: boolean }> {
  const c = zero();
  const upd: Record<string, unknown> = { fit_checked_at: new Date().toISOString(), site_read_at: new Date().toISOString() };
  let site: Site | null = null;
  let siteNote = "no website listed";

  if (l.website) {
    try {
      const u = new URL(l.website);
      if (!(await robotsAllows(u.origin))) { site = { status: "blocked", title: "", desc: "", text: "", phones: [], emails: [], hours: null, booking: false, chat: false, ai: false }; siteNote = "site asks robots not to read it"; }
      else {
        const r = await politeFetch(l.website);
        if (r.ok && r.body) { site = { status: "ok", ...parseSite(r.body) }; siteNote = "site read"; }
        else { site = { status: "error", title: "", desc: "", text: "", phones: [], emails: [], hours: null, booking: false, chat: false, ai: false }; siteNote = `site did not load (${r.status || "timeout"})`; }
      }
    } catch { siteNote = "site address was unusable"; }
  }
  upd.site_status = site?.status ?? "none";

  if (site?.status === "ok") {
    if (!l.phone && site.phones[0]) upd.phone = site.phones[0], upd.phone_source = "website";
    if (!l.email && site.emails[0]) upd.email = site.emails[0];
    if (!l.business_hours && site.hours) upd.business_hours = site.hours;
  }

  let score: number, reason: string, usedAi = false;
  if (site?.status === "ok") {
    const hours = (site.hours ?? l.business_hours ?? "not listed");
    const user = `Business: ${l.company} (${TYPES[l.category ?? ""]?.label ?? "local business"}${l.city ? ", " + l.city : ""})
Website title: ${site.title}
Description: ${site.desc}
Hours: ${hours}
Online booking tools or request-a-quote on the site: ${site.booking ? "yes" : "no"}
Live chat on the site: ${site.chat ? "yes" : "no"}
Mentions an AI receptionist or answering service: ${site.ai ? "yes" : "no"}
Homepage text (truncated): ${site.text}`;
    try {
      const j = await askFreeAi(FIT_SYSTEM, user, (x) => Number.isInteger(Number(x?.fit_score)) && Number(x.fit_score) >= 0 && Number(x.fit_score) <= 100 && typeof x?.fit_reason === "string" && x.fit_reason.trim().length > 5);
      const r = { json: j };
      score = Math.round(Number(r.json.fit_score));
      reason = String(r.json.fit_reason).trim().replace(/\s+/g, " ").slice(0, 180);
      if (typeof r.json.owner_name === "string" && r.json.owner_name.trim() && r.json.owner_name.toLowerCase() !== "null") upd.owner_name = r.json.owner_name.trim().slice(0, 80);
      usedAi = true;
    } catch {
      return { upd: {}, c, ai: false }; // free AI is down for now: leave the lead unscored, the next tick retries
    }
  } else {
    const f = fallbackScore(l, siteNote === "no website listed" ? "no website, so customers reach it by phone" : siteNote);
    score = f.score; reason = f.reason;
  }

  upd.fit_score = score;
  upd.fit_reason = reason;
  const phone = (upd.phone as string | undefined) ?? l.phone;
  if (!phone) { upd.status = "rejected"; upd.reject_reason = "no phone found"; c.rejected++; }
  else if (score < minFit) { upd.status = "rejected"; upd.reject_reason = `low fit (${score})`; c.rejected++; }
  return { upd, c, ai: usedAi };
}

async function opRead(body: { limit?: number; budget_ms?: number }) {
  const started = new Date().toISOString();
  const t0 = Date.now(), budget = Math.max(20_000, Math.min(Number(body.budget_ms ?? 100_000), 120_000));
  const limit = Math.max(1, Math.min(Number(body.limit ?? 25), 60));
  const st = await settings();
  const src = await getSources();
  if (!st.enabled || src.website_reader?.enabled === false) return { ok: true, skipped: "paused" };
  const { data: rows } = await db.from("maya_leads")
    .select("id, company, category, city, website, phone, email, business_hours, campaign_slug")
    .eq("status", "new").is("fit_checked_at", null).order("created_at").limit(limit * 3);
  // leads with a website cost a request each, so take them in found order but keep the batch size
  const batch = ((rows ?? []) as Lead[]).slice(0, limit);
  const stats: Record<string, Counts> = {};
  let done = 0, aiFail = 0, dupPhone = 0;
  const inflight = new Set<Promise<void>>();
  for (const l of batch) {
    if (Date.now() - t0 > budget) break;
    const job = (async () => { try {
      const r = await scoreLead(l, st.min_fit);
      if (!Object.keys(r.upd).length) { aiFail++; return; }
      let { error } = await db.from("maya_leads").update(r.upd).eq("id", l.id);
      if (error && String(error.code) === "23505") { // phone/site collision with another lead
        dupPhone++;
        ({ error } = await db.from("maya_leads").update({ ...r.upd, phone: undefined, phone_source: undefined, status: "rejected", reject_reason: "duplicate of an existing lead" }).eq("id", l.id));
        r.c.rejected = 1;
      }
      const s = (stats[l.campaign_slug ?? ""] ??= zero());
      s.found += 1; s.rejected += r.c.rejected; done++;
    } catch { aiFail++; } })();
    inflight.add(job);
    job.finally(() => inflight.delete(job));
    if (inflight.size >= 3) await Promise.race(inflight);
  }
  await Promise.all(inflight);
  const failedAll = batch.length > 0 && done === 0 && aiFail > 0;
  if (batch.length) await markSource("website_reader", !failedAll, failedAll ? "free AI unavailable" : undefined);
  await logRuns("read", "website_reader", stats, started, failedAll ? "free AI unavailable" : null, { scored: done, ai_unavailable: aiFail, dup: dupPhone });
  return { ok: !failedAll, scored: done, ai_unavailable: aiFail, duplicates: dupPhone, queued_for_read: (rows ?? []).length };
}

/* ───────── CHECK: Telnyx line type ───────── */

const MAP: Record<string, string> = { "fixed line": "landline", voip: "voip", "toll free": "voip", uan: "voip", "shared cost": "voip", mobile: "mobile",
  "fixed line or mobile": "mobile", "personal number": "mobile", pager: "unknown", voicemail: "unknown", "premium rate": "unknown", unknown: "unknown" };

async function opCheck(body: { limit?: number; max_lookups?: number }) {
  const started = new Date().toISOString();
  const st = await settings();
  if (!st.enabled) return { ok: true, skipped: "paused" };
  const { data: tk } = await db.rpc("rg_secret", { p_name: "telnyx_api_key" });
  if (!tk || typeof tk !== "string") return { ok: false, error: "telnyx_api_key missing from Vault" };
  const { data: used } = await db.from("hunter_runs").select("checked").eq("step", "check").gte("started_at", ptDayStart());
  const usedToday = (used ?? []).reduce((a: number, r: { checked: number }) => a + (r.checked ?? 0), 0);
  const room = Math.max(0, st.telnyx_daily_cap - usedToday);
  const n = Math.min(room, Math.max(0, Number(body.max_lookups ?? 1000)), Math.max(1, Math.min(Number(body.limit ?? 40), 100)));
  if (n <= 0) return { ok: true, skipped: "daily lookup cap reached", used_today: usedToday, cap: st.telnyx_daily_cap };
  const { data: rows } = await db.from("maya_leads").select("id, phone, campaign_slug")
    .eq("status", "new").eq("line_type", "unverified").not("fit_checked_at", "is", null).gte("fit_score", st.min_fit)
    .not("phone", "is", null).order("fit_score", { ascending: false }).limit(n);
  const queue = [...(rows ?? [])] as Array<{ id: string; phone: string; campaign_slug: string | null }>;
  const stats: Record<string, Counts> = {};
  const tally: Record<string, number> = {};
  let fatal: string | null = null;
  const t0 = Date.now();
  const worker = async () => {
    while (queue.length && !fatal && Date.now() - t0 < 100_000) {
      const r = queue.shift()!;
      const res = await fetch(`https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(r.phone)}?type=carrier`, { headers: { authorization: `Bearer ${tk}` } });
      if (res.status === 401 || res.status === 403) { fatal = `Telnyx rejected the key (${res.status})`; return; }
      if (!res.ok) { tally.error = (tally.error ?? 0) + 1; continue; }
      const j = await res.json();
      const type = MAP[String(j.data?.carrier?.type ?? "unknown").toLowerCase()] ?? "unknown";
      tally[type] = (tally[type] ?? 0) + 1;
      const reason = type === "landline" ? null : type === "mobile" ? "mobile (email only)" : type === "voip" ? "voip (not queued)" : "line type unknown";
      await db.from("maya_leads").update({ line_type: type, line_type_checked_at: new Date().toISOString(), status: "checked", reject_reason: reason }).eq("id", r.id);
      const s = (stats[r.campaign_slug ?? ""] ??= zero());
      s.checked += 1; if (reason) s.rejected += 1;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  await logRuns("check", "telnyx", stats, started, fatal, { tally });
  return { ok: !fatal, error: fatal, tally, lookups: Object.values(tally).reduce((a, b) => a + b, 0) - (tally.error ?? 0), used_today_before: usedToday, cap: st.telnyx_daily_cap };
}

/* ───────── HANDOFF ───────── */

async function opHandoff() {
  const started = new Date().toISOString();
  const { data, error } = await db.rpc("hunter_handoff");
  if (error) { await logRuns("handoff", null, {}, started, error.message); return { ok: false, error: error.message }; }
  const stats: Record<string, Counts> = {};
  for (const c of data?.campaigns ?? []) { const s = zero(); s.queued = Number(c.moved ?? 0); stats[c.campaign] = s; }
  await logRuns("handoff", null, stats, started, null, data);
  return { ok: true, ...data };
}

/* ───────── TICK: nightly worker ───────── */

async function opTick() {
  const out: Record<string, unknown> = {};
  const t0 = Date.now();
  out.read = await opRead({ limit: 25, budget_ms: 80_000 });
  if (Date.now() - t0 < 110_000) out.check = await opCheck({ limit: 40 });
  const { count: unread } = await db.from("maya_leads").select("id", { count: "exact", head: true }).eq("status", "new").is("fit_checked_at", null);
  if (!unread) out.handoff = await opHandoff();
  return { ok: true, ...out, unread: unread ?? 0 };
}

/* ───────── WATCH: self-heal once, then alert as Hunter ───────── */

async function raise(key: string, problem: boolean, title: string, body?: string, healed = false) {
  await db.rpc("bestly_raise", { p_key: key, p_kind: problem ? "problem" : "resolved", p_severity: problem ? "warning" : "info",
    p_title: title, p_body: body ?? null, p_area: "hunter", p_healed: healed });
}

async function queueState() {
  const { data: camps } = await db.from("hunter_campaigns").select("slug, name, daily_target").eq("enabled", true).eq("owner", "maya");
  const { data: q } = await db.from("maya_leads").select("campaign_slug").eq("status", "queued");
  const have = new Map<string, number>();
  for (const r of q ?? []) have.set(r.campaign_slug, (have.get(r.campaign_slug) ?? 0) + 1);
  return (camps ?? []).map((c: { slug: string; name: string; daily_target: number }) => ({ ...c, queued: have.get(c.slug) ?? 0 }));
}

async function callScore(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string } | null> {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/hunter-score`, {
      method: "POST", signal: AbortSignal.timeout(120_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET }, body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e).slice(0, 100) }; }
}

async function opWatch(body: { dry?: boolean }) {
  const dry = !!body.dry;
  const problems: string[] = [], fixed: string[] = [];
  const st = await settings();
  if (!st.enabled) return { ok: true, paused: true };

  // 1. a source failing 2 nights: retry it once
  const sources = await getSources();
  for (const [slug, s] of Object.entries(sources)) {
    if (!s.enabled || slug === "apollo" || slug === "lead_scorer" || slug === "jev" || s.fail_streak < 2) continue;
    if (slug === "website_reader") { const r = await opRead({ limit: 10, budget_ms: 40_000 }); if (r.ok) fixed.push("Retried the website reader and it worked."); else problems.push("The website reader has failed 2 nights in a row (free AI unavailable)."); continue; }
    // the map server can only be asked through pg_net, which this call is itself running on, so the retry is a fresh request;
    // its answer is read by the next find run. A source that failed two nights is reported either way.
    if (!dry) await opFind({ sources: [slug], limit: 40 });
    problems.push(`${slug} has failed ${s.fail_streak} nights in a row (last error: ${String(s.last_error ?? "see Hunter runs").slice(0, 80)}). I sent one more request.`);
  }

  // 1b. scoring (Phase 1.5). Scoring never blocks the night: the scorer falls back to the free AI per lead on its own.
  //     Here the watchdog only judges the streaks. Lead scoring failing 2 nights: run one pass. Jev key saved but failing: one test call;
  //     if Jev still fails the free AI keeps scoring and I say so (a rejected key needs a fresh one pasted on the Jev card).
  const scoreProblems: string[] = [], scoreFixed: string[] = [];
  const scorer = sources.lead_scorer, jevSrc = sources.jev;
  if (scorer?.enabled && scorer.fail_streak >= 2) {
    const r = dry ? { ok: false } : await callScore({ op: "run", limit: 30 });
    if (r?.ok) scoreFixed.push("Scoring had failed 2 nights; I ran a pass and it worked.");
    else scoreProblems.push(`Scoring has failed ${scorer.fail_streak} nights in a row (${String(scorer.last_error ?? "see Hunter runs").slice(0, 80)}). New leads are not getting odds, so the queue is ordered by fit score.`);
  }
  let jevKeySaved = false;
  { const { data: k } = await db.rpc("hunter_secret", { p_name: "jev_api_key" }); jevKeySaved = typeof k === "string" && k.length > 8; }
  if (jevKeySaved && jevSrc?.enabled && jevSrc.fail_streak >= 2) {
    const r = dry ? { ok: false } : await callScore({ op: "test" });
    if (r?.ok) scoreFixed.push("Jev had failed 2 nights; a test call worked, so it is back.");
    else scoreProblems.push(`Jev has failed ${jevSrc.fail_streak} nights in a row (${String(r?.error ?? jevSrc.last_error ?? "no answer").slice(0, 90)}). Scoring continues with free AI estimates.`);
  }
  problems.push(...scoreProblems); fixed.push(...scoreFixed);

  // 2. queue depth under 50% of target: run one more pass, then judge
  let state = await queueState();
  const short = () => state.filter((c: { queued: number; daily_target: number }) => c.daily_target > 0 && c.queued < c.daily_target * 0.5);
  if (short().length && !dry) {
    await opRead({ limit: 25, budget_ms: 50_000 });
    await opCheck({ limit: 30 });
    await opHandoff();
    state = await queueState();
    if (!short().length) fixed.push("The queue was short, so I ran an extra pass and it filled.");
  }
  const totalQueued = state.reduce((a: number, c: { queued: number }) => a + c.queued, 0);
  for (const c of short()) problems.push(`${c.name}: ${c.queued} of ${c.daily_target} queued.`);
  const empty = state.length > 0 && totalQueued === 0;

  const ok = problems.length === 0 && !empty;
  if (!dry) {
    const now = new Date().toISOString();
    const { error: hErr } = await db.from("hunter_health").upsert({ source: "hunter", ok, problems: [...problems, ...fixed], healed: fixed.length > 0, checked_at: now, ...(ok ? { last_ok_at: now } : {}) }, { onConflict: "source" });
    if (hErr) problems.push("Could not save my health row: " + String(hErr.message).slice(0, 80));
    if (empty) await raise("hunter.queue", true, "Hunter: nothing is queued for Maya", "Zero leads queued after an extra pass. " + problems.join(" "));
    else if (short().length) await raise("hunter.queue", true, `Hunter: Maya's queue is under half full`, problems.join(" "));
    else await raise("hunter.queue", false, fixed.length ? "Hunter: I refilled Maya's queue" : "Hunter: Maya's queue is OK", fixed.join(" "), fixed.length > 0);
    if (scoreProblems.some((p) => p.startsWith("Scoring"))) await raise("hunter.scoring", true, "Hunter: scoring failed 2 nights", scoreProblems.find((p) => p.startsWith("Scoring")));
    else if (scorer?.enabled) await raise("hunter.scoring", false, scoreFixed.some((p) => p.startsWith("Scoring")) ? "Hunter: scoring is working again" : "Hunter: scoring OK", scoreFixed.join(" "), scoreFixed.length > 0);
    if (scoreProblems.some((p) => p.startsWith("Jev"))) await raise("hunter.jev", true, "Hunter: Jev is failing, using free AI estimates", scoreProblems.find((p) => p.startsWith("Jev")), true);
    else if (jevKeySaved) await raise("hunter.jev", false, "Hunter: Jev OK", scoreFixed.join(" "), scoreFixed.some((p) => p.startsWith("Jev")));
    for (const [slug, s] of Object.entries(sources)) {
      if (!s.enabled || slug === "apollo" || slug === "lead_scorer" || slug === "jev") continue;
      const bad = problems.find((p) => p.startsWith(slug));
      if (bad) await raise(`hunter.source.${slug}`, true, `Hunter: ${slug} keeps failing`, bad);
      else await raise(`hunter.source.${slug}`, false, `Hunter: ${slug} OK`);
    }
  }
  return { ok, dry, problems, fixed, queue: state };
}

/* ───────── serve ───────── */

Deno.serve(async (req) => {
  if (!(await authorized(req))) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "find": return Response.json(await opFind(body));
      case "read": return Response.json(await opRead(body));
      case "check": return Response.json(await opCheck(body));
      case "handoff": return Response.json(await opHandoff());
      case "tick": return Response.json(await opTick());
      case "watch": return Response.json(await opWatch(body));
      default: return Response.json({ ok: false, error: "unknown op" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 300) }, { status: 500 });
  }
});
