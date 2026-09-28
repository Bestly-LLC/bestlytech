// wall-feeds — fills public.wall_feeds for the projector wall's strip widgets (plan: docs/wall-round3-2026-09-27-opusplan.md, W3).
//   op tick   (cron wall-feeds-tick, :01 and :31; also kicked by wall_feeds_watch when stale)
//             news (NPR + PBS NewsHour), air (Open-Meteo US AQI + UV), deliveries (shipping emails in bestly_mail),
//             mail wording (USPS scan text -> "DMV letter" via the free AI, then the scan text is dropped),
//             leo (one warm line a day via the free AI, curated fallback).
//   op only   {kinds:["news",...]} run just those parts.
// The Pi / Mac fill mail pieces, habits and appstore themselves (wall_pi_mail_put / wall_pi_feed_put).
// Auth: service key (apikey or Bearer) or an admin JWT. verify_jwt = false (new sb_secret keys are not JWTs).
// Free AI only (paid "never"). Ground News has no public feed, so the second source is PBS NewsHour.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm } from "../_shared/free-llm.ts";

const secretKeys = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const SECRET = secretKeys[0];
const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRET, { auth: { persistSession: false }, global: { headers: { apikey: SECRET } } });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o, null, 1), { status: s, headers: { "Content-Type": "application/json" } });
const HOME = { lat: 34.0835, lon: -118.3698 };   // 733 N Kings Rd, West Hollywood
const TZ = "America/Los_Angeles";
const UA = "Mozilla/5.0 (compatible; BestlyWall/1.0; +https://bestly.tech)";

async function authorized(req: Request) {
  const apikey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secretKeys.includes(apikey) || secretKeys.includes(bearer)) return true;
  if (!bearer || bearer.split(".").length !== 3) return false;
  const { data } = await db.auth.getUser(bearer);
  if (!data?.user) return false;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return !!ok;
}

async function put(kind: string, data: unknown, error: string | null = null, meta: unknown = null) {
  const { error: e } = await db.rpc("wall_feed_set", { p_kind: kind, p_data: data, p_error: error, p_meta: meta });
  if (e) throw new Error(`wall_feed_set ${kind}: ${e.message}`);
}

const laDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘")
  .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”").replace(/&#8212;|&mdash;/g, "—").replace(/&#8211;|&ndash;/g, "–")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const short = (s: string, n = 90) => s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…";

/* ───────── news ───────── */
async function rss(url: string, source: string, n: number) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${source} ${r.status}`);
  const x = await r.text();
  const items = [...x.matchAll(/<item\b[\s\S]*?<\/item>/g)].map((m) => m[0]);
  return items.map((it) => {
    const title = decode((it.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? "");
    const pd = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1];
    const at = pd ? new Date(decode(pd)) : null;
    return { title: short(title), source, at: at && !isNaN(+at) ? at.toISOString() : null };
  }).filter((i) => i.title && !/^(watch|listen|live updates?):/i.test(i.title)).slice(0, n);
}
async function news() {
  const feeds = [
    { url: "https://feeds.npr.org/1001/rss.xml", source: "NPR" },
    { url: "https://www.pbs.org/newshour/feeds/rss/headlines", source: "PBS NewsHour" },
    { url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", source: "BBC" },   // backup only
  ];
  const got: Record<string, any[]> = {}; const errs: string[] = [];
  await Promise.all(feeds.map(async (f) => { try { got[f.source] = await rss(f.url, f.source, 8); } catch (e) { errs.push((e as Error).message); got[f.source] = []; } }));
  // 3 NPR + 3 PBS, interleaved; fill from whatever else answered
  const a = got["NPR"], b = got["PBS NewsHour"], c = got["BBC"]; const out: any[] = []; const seen = new Set<string>();
  const add = (i: any) => { const k = i.title.toLowerCase().slice(0, 40); if (!seen.has(k) && out.length < 6) { seen.add(k); out.push(i); } };
  for (let i = 0; i < 3; i++) { if (a[i]) add(a[i]); if (b[i]) add(b[i]); }
  for (const i of [...a.slice(3), ...b.slice(3), ...c]) add(i);
  if (!out.length) throw new Error(`no headlines (${errs.join("; ")})`);
  await put("news", out, null, { errors: errs });
  return { n: out.length, errs };
}

/* ───────── air ───────── */
function aqiLabel(a: number) {
  return a <= 50 ? "Good" : a <= 100 ? "Moderate" : a <= 150 ? "Unhealthy for sensitive groups" : a <= 200 ? "Unhealthy" : a <= 300 ? "Very unhealthy" : "Hazardous";
}
async function air() {
  const u = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${HOME.lat}&longitude=${HOME.lon}&current=us_aqi,pm2_5,ozone,uv_index&timezone=${encodeURIComponent(TZ)}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const j = await r.json(); const c = j.current ?? {};
  if (typeof c.us_aqi !== "number") throw new Error("no us_aqi in reply");
  // Pollen: Open-Meteo's pollen data covers Europe only and every free US pollen API needs a key, so it stays null.
  const out = { aqi: Math.round(c.us_aqi), label: aqiLabel(c.us_aqi), pollen: null,
    uv: typeof c.uv_index === "number" ? Math.round(c.uv_index) : null, pm2_5: c.pm2_5 ?? null, ozone: c.ozone ?? null, at: c.time ?? null };
  await put("air", out);
  return out;
}

/* ───────── deliveries (shipping emails) ───────── */
const CARRIERS: [RegExp, string][] = [
  [/amazon\.com|amazon/i, "Amazon"], [/\bups\b|ups\.com/i, "UPS"], [/fedex/i, "FedEx"], [/usps\.com|\busps\b/i, "USPS"],
  [/dhl/i, "DHL"], [/ontrac/i, "OnTrac"], [/lasership/i, "LaserShip"], [/costco/i, "Costco"], [/target\.com/i, "Target"],
  [/walmart/i, "Walmart"], [/apple\.com/i, "Apple"], [/shop\.app|shopify/i, "Shop"],
  [/homechef/i, "Home Chef"], [/hellofresh/i, "HelloFresh"], [/chewy/i, "Chewy"], [/etsy/i, "Etsy"], [/bestbuy/i, "Best Buy"],
  [/wayfair/i, "Wayfair"], [/ikea/i, "IKEA"], [/nike/i, "Nike"], [/shein/i, "SHEIN"], [/temu/i, "Temu"],
];
const SHIPPERS = new Set(["UPS", "FedEx", "USPS", "DHL", "OnTrac", "LaserShip"]);
const SHIP_RE = /(shipped|out for delivery|delivered|arriving|on (its|the) way|in transit|delivery (update|scheduled|exception|attempt)|has been dispatched|shipment|package)/i;
const NOT_SHIP_RE = /(earnings|payment|invoice|quota|support case|\bcase\b|verify|password|receipt for your payment|refund|newsletter|webinar|what we.ve shipped|shipped in q\d)/i;
function statusOf(s: string) {
  if (/delivered/i.test(s) && !/(will be|to be|expected to be) delivered/i.test(s)) return "Delivered";
  if (/out for delivery/i.test(s)) return "Out for delivery";
  if (/(delay|exception|attempt|missed)/i.test(s)) return "Delayed";
  if (/arriving|on (its|the) way|in transit|shipped|dispatched/i.test(s)) return "On the way";
  return "Update";
}
function etaOf(s: string, sent: Date) {
  const m = s.match(/arriving\s+(today|tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:,?\s+[A-Z][a-z]{2,8}\.?\s+\d{1,2})?)/i)
    ?? s.match(/(?:estimated|expected|scheduled|new)\s+delivery(?:\s+date)?\s*(?:is|:|by)?\s*((?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+[A-Z][a-z]{2,8}\.?\s+\d{1,2}|[A-Z][a-z]{2,8}\.?\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i)
    ?? s.match(/(?:arrives|delivery)\s+by\s+((?:mon|tues|wednes|thurs|fri|satur|sun)day|[A-Z][a-z]{2,8}\.?\s+\d{1,2})/i);
  if (!m) return null;
  let v = m[1].replace(/\s+/g, " ").trim();
  if (/today|tomorrow/i.test(v) && laDate(sent) !== laDate()) {   // "today" in an old email
    const d = new Date(sent.getTime() + (/tomorrow/i.test(v) ? 864e5 : 0));
    v = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d);
  }
  return v.charAt(0).toUpperCase() + v.slice(1);
}
function whatOf(subject: string, carrier: string) {
  const q = subject.match(/["“]([^"”]{3,60})["”]/);
  if (q) return short(q[1], 30);
  return carrier === "Amazon" ? "Amazon package" : SHIPPERS.has(carrier) ? `${carrier} package` : `${carrier} order`;
}
async function deliveries() {
  const since = new Date(Date.now() - 10 * 864e5).toISOString();
  const { data, error } = await db.from("bestly_mail").select("from_addr, from_name, subject, sent_at, body_text")
    .gte("sent_at", since).order("sent_at", { ascending: false }).limit(400);
  if (error) throw new Error(error.message);
  const byKey = new Map<string, any>();
  for (const m of data ?? []) {
    const from = `${m.from_addr ?? ""} ${m.from_name ?? ""}`, subj = String(m.subject ?? "").replace(/\s+/g, " ");
    if (/informeddelivery|amazonaws|no-reply-aws|turo\.com/i.test(from)) continue;
    if (!SHIP_RE.test(subj) || NOT_SHIP_RE.test(subj)) continue;
    const carrier = CARRIERS.find(([re]) => re.test(from))?.[1];
    if (!carrier) continue;
    const text = `${subj} ${String(m.body_text ?? "").slice(0, 4000)}`;
    const sent = new Date(m.sent_at);
    const track = text.match(/\b(1Z[0-9A-Z]{16}|9[2-5]\d{20,24}|\d{12}(?!\d))\b/)?.[1];
    const order = text.match(/order\s*(?:#|no\.?|number)?\s*:?\s*([\w-]*\d{5,}[\w-]*)/i)?.[1];
    const key = `${carrier}:${order ?? track ?? whatOf(subj, carrier)}`;
    if (byKey.has(key)) continue;   // newest first: keep the latest email per order/package
    const status = statusOf(subj);
    if (status === "Delivered" && Date.now() - +sent > 36 * 3600e3) { byKey.set(key, null); continue; }
    if (status !== "Delivered" && Date.now() - +sent > 8 * 864e5) { byKey.set(key, null); continue; }
    byKey.set(key, { carrier, what: whatOf(subj, carrier), eta: status === "Out for delivery" && laDate(sent) === laDate() ? "Today" : etaOf(text, sent), status, at: m.sent_at });
  }
  // USPS packages from the Informed Delivery digest (posted by the Pi)
  const { data: mf } = await db.from("wall_feeds").select("meta").eq("kind", "mail").maybeSingle();
  for (const p of ((mf?.meta as any)?.usps_parcels ?? []) as any[]) {
    const key = `USPS:${p.tracking ?? p.from ?? p.eta}`;
    if (!byKey.has(key)) byKey.set(key, { carrier: "USPS", what: p.from ? `From ${short(p.from, 24)}` : "USPS package", eta: p.eta ?? null, status: p.status ?? "On the way", at: null });
  }
  const order = { "Out for delivery": 0, "Delayed": 1, "On the way": 2, "Update": 3, "Delivered": 4 } as Record<string, number>;
  const out = [...byKey.values()].filter(Boolean).sort((a, b) => (order[a.status] - order[b.status]) || String(b.at).localeCompare(String(a.at))).slice(0, 6);
  await put("deliveries", out);
  return { n: out.length };
}

/* ───────── mail wording (USPS scan text -> short summary) ───────── */
async function mailWords() {
  const { data: rows, error } = await db.rpc("wall_mail_pieces_pending");
  if (error) throw new Error(error.message);
  const list = (rows ?? []) as { key: string; day: string; ocr: string }[];
  if (!list.length) return { n: 0 };
  let done: { key: string; summary: string }[] = [];
  try {
    const r = await llm({
      task: "extract", json: true, paid: "never", job: "wall-mail", fn: "wall-feeds", deadlineMs: 60_000, maxTokens: 1200,
      system: "Each item is OCR text from a USPS scan of the OUTSIDE of one envelope or postcard. For each, say who sent it and what it " +
        "likely is, in 2 to 5 plain words, like \"DMV letter\", \"Chase statement\", \"Spectrum ad\", \"Metro ExpressLanes bill\", " +
        "\"Postcard from Mom\". Ignore the recipient (Jared Best, 733 N Kings Rd) and postage marks. Junk mail -> \"<Company> ad\". " +
        "If you cannot tell, say \"Letter\". Never include addresses, account numbers or names of private people other than the sender. " +
        "Return {\"items\":[{\"key\":\"...\",\"summary\":\"...\"}]} with every key.",
      user: JSON.stringify(list.map((p) => ({ key: p.key, text: p.ocr.slice(0, 700) }))),
      validate: (j) => Array.isArray(j?.items) ? null : "items missing",
    });
    const got = new Map<string, string>((r.json.items as any[]).map((i) => [String(i.key), String(i.summary ?? "").replace(/[\r\n]+/g, " ").slice(0, 40)]));
    done = list.map((p) => ({ key: p.key, summary: got.get(p.key) || "Letter" }));
  } catch (e) {
    // free AI down: pieces older than a day get a plain "Letter" so the scan text doesn't linger
    done = list.filter((p) => Date.now() - Date.parse(p.day) > 36 * 3600e3).map((p) => ({ key: p.key, summary: "Letter" }));
    if (!done.length) throw new Error(`free AI unavailable: ${(e as Error).message}`);
  }
  const { error: e2 } = await db.rpc("wall_mail_pieces_done", { p_rows: done });
  if (e2) throw new Error(e2.message);
  return { n: done.length };
}

/* ───────── Leo line ───────── */
const LEO_FALLBACK = [
  "Your warmth is the room's best lighting today. Lead with it and people follow.",
  "A bold idea you've been sitting on wants out. Say it before lunch.",
  "Someone is quietly rooting for you. Let them see you win.",
  "Rest counts as momentum today. Recharge the engine, lion.",
  "Your confidence opens a door you thought was locked. Walk through slowly.",
  "Generosity comes back doubled today, so pick up the tab on kindness.",
  "A small win this morning sets the tone. Celebrate it out loud.",
  "Play is productive today. The fun path gets you there faster.",
  "Your spotlight is big enough to share. Pull someone into it.",
  "Trust the gut call you made yesterday. It was the right one.",
  "Finish one thing fully before starting the next. Pride follows.",
  "Say yes to the plan that makes you grin. That's your compass today.",
];
async function leo(force = false) {
  const today = laDate();
  const { data: cur } = await db.from("wall_feeds").select("data").eq("kind", "leo").maybeSingle();
  if (!force && (cur?.data as any)?.date === today) return { skipped: "already today" };
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date());
  let line = "", source = "ai";
  try {
    const r = await llm({
      task: "summarize", json: true, paid: "never", privacy: "public", job: "wall-leo", fn: "wall-feeds", deadlineMs: 45_000, maxTokens: 400,
      system: "You write one original daily horoscope-style line for a Leo. Warm, confident, a little playful, practical. " +
        "1 or 2 short sentences, 70 to 170 characters total. No emoji, no hashtags, no quotation marks, no planet names, " +
        "no mention of any app or brand. Return {\"line\":\"...\"}.",
      user: `Today is ${day}. Write today's Leo line.`,
      validate: (j) => typeof j?.line === "string" && j.line.length >= 40 && j.line.length <= 200 ? null : "bad length",
    });
    line = String(r.json.line).replace(/^["“]|["”]$/g, "").trim();
  } catch {
    const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 864e5);
    line = LEO_FALLBACK[doy % LEO_FALLBACK.length]; source = "fallback";
  }
  await put("leo", { line, date: today, source });
  return { line, source };
}

/* ───────── main ───────── */
const PARTS: Record<string, () => Promise<unknown>> = { news, air, deliveries, mail: mailWords, leo: () => leo(false) };

Deno.serve(async (req) => {
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await authorized(req))) return J({ ok: false, error: "unauthorized" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const kinds: string[] = body.op === "only" && Array.isArray(body.kinds) ? body.kinds.filter((k: string) => k in PARTS || k === "leo_force") : Object.keys(PARTS);
  const results: Record<string, unknown> = {};
  await Promise.all(kinds.map(async (k) => {
    try { results[k] = k === "leo_force" ? await leo(true) : await PARTS[k](); }
    catch (e) {
      const msg = (e as Error).message.slice(0, 400);
      results[k] = { error: msg };
      try { await put(k === "leo_force" ? "leo" : k, null, msg); } catch { /* best effort */ }
    }
  }));
  return J({ ok: true, results });
});
