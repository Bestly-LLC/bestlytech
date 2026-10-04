// roofguard-enrich: finds the main business phone line for RoofGuard leads (Spark, 2026-10-03).
//
// No paid APIs. Per lead:
//   1. Wikidata: search the company, pick the organization entity, read P1329 (phone) + P856 (website)
//   2. Website: fetch the homepage and a contact page, pull US numbers from tel: links and text
//   3. No website on Wikidata: Bing search for the official site, then a domain guess; either must
//      pass verifySite (name in host or title, and a state mention for local orgs) before it is scraped
//   4. Nothing solid on the site: numbers Bing shows next to the company name (source 'search')
// Every candidate is scored (source, tel: link, "main/phone" context, in-state area code, fax penalty)
// and the best one lands on rg_leads.phone with its source and a 0-100 confidence.
//
// line_type stays 'unverified': a scraped number can be a mobile, and the dialer never calls
// unverified numbers. A line-type lookup (Phase 2) flips it to landline / voip / mobile.
//
// Callers: pg_cron (every 10 min) and the rg_watch watchdog via invoke_edge_function, and the
// admin "Find now" button via rg_kick(). Auth: Vault edge_proxy_key (x-proxy-key) or the service key.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { AREA_STATE, TOLL_FREE } from "./areacodes.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const UA = "BestlyRoofGuardBot/1.0 (+https://bestly.tech; ops@bestly.tech)";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const BATCH = 12;
const CONCURRENCY = 4;
const BUDGET_MS = 120_000;

const STATE_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const BAD_HOSTS = /(wikipedia|wikidata|linkedin|facebook|twitter|x\.com|instagram|youtube|bloomberg|crunchbase|zoominfo|indeed|glassdoor|yelp|mapquest|bbb\.org|dnb\.com|manta|yellowpages|opencorporates|duckduckgo|google|bing|apple\.com\/maps|tiktok|reddit|wsj|forbes|reuters|cnbc|usnews|niche\.com)/i;

type Lead = { id: string; company: string; state: string; category: string; site_model?: string | null; enrich_attempts: number };
type Cand = { e164: string; display: string; source: string; url: string; score: number; context: string };

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

async function get(url: string, opts: { json?: boolean; browser?: boolean; ms?: number } = {}): Promise<{ ok: boolean; body: string; url: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.ms ?? 8000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": opts.browser ? BROWSER_UA : UA, accept: opts.json ? "application/json" : "text/html,*/*" },
    });
    const body = r.ok ? (await r.text()).slice(0, 1_500_000) : "";
    return { ok: r.ok, body, url: r.url || url };
  } catch {
    return { ok: false, body: "", url };
  } finally {
    clearTimeout(t);
  }
}

// Wikidata rate-limits bursts (429), so its calls go through one gate, spaced about a second apart,
// with one polite retry that honors Retry-After.
let wdGate: Promise<void> = Promise.resolve();
async function wdGet(url: string, ms = 12000) {
  const turn = wdGate.then(() => new Promise<void>((r) => setTimeout(r, 1100)));
  wdGate = turn;
  await turn;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: "application/json" } });
      if (r.status === 429 && attempt === 0) {
        const wait = Math.min(15, Number(r.headers.get("retry-after")) || 5) * 1000;
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      return { ok: r.ok, body: r.ok ? await r.text() : "", url };
    } catch {
      if (attempt === 1) return { ok: false, body: "", url };
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, body: "", url };
}

function cleanName(name: string): { q: string; hint: string } {
  const hint = (name.match(/\(([^)]*)\)/)?.[1] ?? "").replace(/verify employer/i, "").trim();
  const q = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+\/\s+|\s+-\s+/)[0]
    .replace(/,?\s+(Inc\.?|LLC|Co\.|Corporation|Company|Ltd\.?)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return { q, hint };
}

// An entity can list several sites (regional mirrors, old domains): prefer a US-style TLD whose host carries the name.
function pickWebsite(webs: string[], q: string): string | undefined {
  const { keys, initials } = nameTokens(q);
  const rank = (w: string) => {
    try {
      const h = new URL(w).hostname.toLowerCase();
      let r = /\.(com|org|edu|gov|us|net)$/.test(h) ? 2 : -2;
      if (keys.some((k) => k.length >= 4 && h.includes(k)) || (initials.length >= 3 && h.includes(initials))) r += 3;
      if (w.startsWith("https")) r += 0.5;
      return r;
    } catch { return -9; }
  };
  return webs.sort((a, b) => rank(b) - rank(a))[0];
}
const local = (lead: Lead) => /single site|in-state/i.test(lead.site_model ?? "");

// ---------- Wikidata ----------
// Search gives labels + descriptions; one small SPARQL call gives phone / website / is-human for the hits.
// (wbgetentities returns every claim of every hit, megabytes for big orgs, so it is not used.)
type WD = { qid: string; phone?: string; website?: string; score: number };
async function wikidata(lead: Lead): Promise<WD | null> {
  const { q, hint } = cleanName(lead.company);
  const s = await wdGet(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=6&search=${encodeURIComponent(q)}`);
  if (!s.ok) throw new Error("wikidata search failed");
  const hits: Array<{ id: string; label?: string; description?: string }> = JSON.parse(s.body).search ?? [];
  if (!hits.length) return null;
  // phone, website, is-human, country, and the US state it sits in (located-in or HQ, walked up to a state)
  const sparql = `SELECT ?item ?phone ?web ?human ?country ?stLabel WHERE { VALUES ?item { ${hits.map((h) => "wd:" + h.id).join(" ")} }
    OPTIONAL { ?item wdt:P1329 ?phone } OPTIONAL { ?item wdt:P856 ?web } OPTIONAL { ?item wdt:P17 ?country }
    OPTIONAL { ?item (wdt:P131|wdt:P159)/wdt:P131* ?st . ?st wdt:P31 wd:Q35657 . }
    BIND(EXISTS { ?item wdt:P31 wd:Q5 } AS ?human)
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const e = await wdGet(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`);
  if (!e.ok) throw new Error("wikidata sparql failed");
  type F = { phone?: string; webs: Set<string>; human: boolean; countries: Set<string>; states: Set<string> };
  const facts = new Map<string, F>();
  for (const b of JSON.parse(e.body).results?.bindings ?? []) {
    const id = String(b.item.value).split("/").pop()!;
    const f = facts.get(id) ?? { human: b.human?.value === "true", webs: new Set<string>(), countries: new Set<string>(), states: new Set<string>() };
    f.phone ??= b.phone?.value;
    if (b.web?.value) f.webs.add(String(b.web.value));
    if (b.country?.value) f.countries.add(String(b.country.value).split("/").pop()!);
    if (b.stLabel?.value) f.states.add(String(b.stLabel.value));
    facts.set(id, f);
  }
  const stName = STATE_NAME[lead.state] ?? "";
  let best: WD | null = null;
  for (const [i, h] of hits.entries()) {
    const f = facts.get(h.id);
    if (!f || f.human) continue;
    // wrong country, or a local org whose Wikidata entity sits in another state: not our lead
    if (f.countries.size && !f.countries.has("Q30")) continue;
    if (local(lead) && f.states.size && stName && !f.states.has(stName)) continue;
    const desc = (h.description ?? "").toLowerCase();
    let score = 10 - i * 2;
    if ((h.label ?? "").toLowerCase() === q.toLowerCase()) score += 6;
    if (stName && desc.includes(stName.toLowerCase())) score += 6;
    if (hint && desc.includes(hint.toLowerCase())) score += 6;
    if (/(company|corporation|manufacturer|hospital|health|university|college|school|district|county|city|casino|resort|hotel|airport|bank|insurer|retailer|chain|utility|laboratory|government|organization|nonprofit|brand|business|network|system)/.test(desc)) score += 4;
    if (/(film|album|song|novel|species|footballer|politician|disambiguation|human settlement|street|cemetery|heliport|press|publisher|law school|business school|school of medicine)/.test(desc)) score -= 12;
    if (/\((denmark|australia|india|ireland|switzerland|germany|china|japan|canada|uk|france|brazil|mexico)\)/i.test(h.label ?? "")) score -= 12;
    if (stName && f.states.has(stName)) score += 6;
    const web = pickWebsite([...f.webs], q);
    if (web) score += 3;
    if (f.phone) score += 3;
    if (score >= 10 && (!best || score > best.score)) best = { qid: h.id, phone: f.phone?.replace(/^tel:/, ""), website: web, score };
  }
  return best;
}

// ---------- phone parsing ----------
const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?([2-9]\d{2})[\s.\-]?(\d{4})(?!\d)/g;
function normalize(raw: string): { e164: string; display: string; area: string } | null {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (d.length !== 10 || !/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  if (/^(\d)\1{9}$/.test(d) || d.slice(3, 6) === "555") return null;
  return { e164: `+1${d}`, display: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, area: d.slice(0, 3) };
}
function scoreNumber(n: { area: string }, lead: Lead, base: number, context: string): number {
  let s = base;
  if (AREA_STATE.get(n.area) === lead.state) s += 12;
  else if (TOLL_FREE.has(n.area)) s += 4;
  else if (!AREA_STATE.has(n.area)) s -= 25; // not a US geographic code
  else s -= local(lead) ? 18 : 4;
  const c = context.toLowerCase();
  if (/\bfax\b/.test(c)) s -= 45;
  if (/(main|switchboard|general|headquarters|corporate office|phone|call us|tel)/.test(c)) s += 8;
  if (/(career|jobs|recruit|media|press|billing|patient account|tty|tdd|crisis|emergency|hotline|nurse line|investor|shareholder|ethics|openline)/.test(c)) s -= 10;
  if (/(incident id|tracking|order #|zip|isbn)/.test(c)) s -= 40;
  if (/(shareowner|transfer agent|trust company|stock transfer|computershare|equiniti|dividend)/.test(c)) s -= 30;
  return s;
}
function textOf(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
function extract(html: string, url: string, lead: Lead, footerBias: boolean): Cand[] {
  const out: Cand[] = [];
  for (const m of html.matchAll(/href=["']tel:([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const n = normalize(decodeURIComponent(m[1]));
    if (!n) continue;
    const before = textOf(html.slice(Math.max(0, m.index! - 300), m.index!)).slice(-80);
    const ctx = `${before} ${textOf(m[2])}`;
    out.push({ e164: n.e164, display: n.display, source: "website", url, context: ctx.trim().slice(-120), score: scoreNumber(n, lead, 62, ctx) });
  }
  // schema.org JSON-LD / microdata "telephone": sites put the main line here even when the page renders it with JS
  for (const m of html.matchAll(/["']telephone["']\s*:\s*["']([^"']{7,30})["']|itemprop=["']telephone["'][^>]*>([^<]{7,30})</gi)) {
    const n = normalize(m[1] ?? m[2] ?? "");
    if (!n) continue;
    out.push({ e164: n.e164, display: n.display, source: "website", url, context: "schema.org telephone", score: scoreNumber(n, lead, 64, "main phone") });
  }
  const text = textOf(html);
  for (const m of text.matchAll(PHONE_RE)) {
    const pre = text.slice(Math.max(0, m.index! - 7), m.index!);
    if (/\+\d{1,3}[\s.\-]?\(?$/.test(pre) && !m[0].startsWith("+1")) continue; // tail of an international number (a zip code before it is fine)
    const n = normalize(m[0]);
    if (!n) continue;
    const ctx = text.slice(Math.max(0, m.index! - 70), m.index! + m[0].length);
    const pos = m.index! / Math.max(1, text.length);
    out.push({ e164: n.e164, display: n.display, source: "website", url, context: ctx.trim(), score: scoreNumber(n, lead, footerBias && pos > 0.75 ? 56 : 52, ctx) });
  }
  return out;
}
function contactLinks(html: string, base: string): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const label = textOf(m[2]).toLowerCase();
    const href = m[1];
    if (/contact|locations?\b|about us/.test(label) || /\/contact/i.test(href)) {
      try {
        const u = new URL(href, base);
        if (u.hostname.replace(/^www\./, "") === new URL(base).hostname.replace(/^www\./, "")) links.add(u.toString());
      } catch { /* bad href */ }
    }
  }
  return [...links].slice(0, 2);
}

async function scrapeSite(site: string, lead: Lead, prefetched?: string): Promise<{ cands: Cand[]; final: string }> {
  let home = prefetched ? { ok: true, body: prefetched, url: site } : await get(site, { browser: true });
  if (!home.ok && site.startsWith("http://")) home = await get(site.replace("http://", "https://"), { browser: true });
  if (!home.ok || isBotWall(home.body)) return { cands: [], final: site };
  const cands = extract(home.body, home.url, lead, true);
  const origin = new URL(home.url).origin;
  // a deep link (a campus page, a /zh-tw/ locale) can hide the main line that the site root shows
  if (new URL(home.url).pathname.length > 1) {
    const root = await get(origin + "/", { browser: true });
    if (root.ok && !isBotWall(root.body)) cands.push(...extract(root.body, root.url, lead, true));
  }
  const pages = contactLinks(home.body, home.url);
  for (const fallback of ["/contact", "/contact-us", "/about", "/about-us", "/locations"]) {
    if (pages.length >= 4) break;
    const u = origin + fallback;
    if (!pages.includes(u)) pages.push(u);
  }
  for (const p of pages.slice(0, 4)) {
    if (cands.some((c) => c.score >= 75)) break;
    const r = await get(p, { browser: true });
    if (r.ok) cands.push(...extract(r.body, r.url, lead, false).map((c) => ({ ...c, score: c.score + 3 })));
  }
  return { cands, final: home.url };
}

function firstGoodHost(html: string, hrefRe: RegExp): string | null {
  for (const m of html.matchAll(hrefRe)) {
    let href = m[1].replace(/&amp;/g, "&");
    const ud = href.match(/[?&]uddg=([^&]+)/);
    if (ud) href = decodeURIComponent(ud[1]);
    const bu = href.match(/bing\.com\/ck\/a\?[^"]*?[?&]u=a1([A-Za-z0-9_\-]+)/);
    if (bu) { try { href = atob(bu[1].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (bu[1].length % 4)) % 4)); } catch { /* keep */ } }
    if (href.startsWith("//")) href = "https:" + href;
    try {
      const u = new URL(href);
      if (/^https?:$/.test(u.protocol) && !BAD_HOSTS.test(u.hostname)) return `${u.protocol}//${u.hostname}/`;
    } catch { /* skip */ }
  }
  return null;
}

// Official-site candidates from a Bing search (DuckDuckGo serves the edge runtime a bot wall).
async function searchSites(lead: Lead): Promise<string[]> {
  const { q } = cleanName(lead.company);
  const query = encodeURIComponent(`${q} ${STATE_NAME[lead.state] ?? ""} official site`);
  const r = await get(`https://www.bing.com/search?q=${query}&setlang=en-US&cc=US`, { browser: true });
  if (!r.ok) return [];
  const hosts: string[] = [];
  for (const m of r.body.matchAll(/<li class="b_algo"[\s\S]*?<a[^>]*href="(https?:[^"]+)"/g)) {
    const h = firstGoodHost(`<a href="${m[1]}">`, /href="([^"]+)"/g);
    if (h && !hosts.includes(h)) hosts.push(h);
    if (hosts.length >= 5) break;
  }
  return hosts;
}

const NAME_STOP = new Set(["the", "of", "and", "at", "for", "inc", "co", "company", "corporation", "corp", "group", "system", "systems",
  "services", "health", "healthcare", "medical", "center", "centre", "university", "college", "county", "city", "state", "school",
  "schools", "district", "public", "hospital", "hospitals", "regional", "international", "national", "american", "usa", "unified",
  "community", "general", "memorial", "saint", "st", "north", "south", "east", "west", "new", "global", "holdings", "industries"]);
const DESCRIPTORS = new Set(["health", "healthcare", "medical", "center", "centre", "university", "college", "county", "city", "school",
  "schools", "district", "hospital", "hospitals", "regional", "memorial", "community", "clinic", "casino", "resort", "airport", "bank"]);
function nameTokens(q: string) {
  const words = q.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const keys = words.filter((w) => !NAME_STOP.has(w) && w.length >= 3);
  const descriptors = words.filter((w) => DESCRIPTORS.has(w));
  const initials = words.filter((w) => !["of", "the", "and", "at", "for"].includes(w)).map((w) => w[0]).join("");
  return { words, keys: keys.length ? keys : words.filter((w) => w.length >= 4), descriptors, initials };
}
// A searched or guessed site counts only if it is plausibly this organization: the host carries a name
// word or the initials, or the page title carries the name; local orgs must also mention their state.
async function verifySite(url: string, lead: Lead): Promise<{ url: string; html: string } | null> {
  const { q } = cleanName(lead.company);
  const { keys, descriptors, initials } = nameTokens(q);
  const home = await get(url, { browser: true, ms: 7000 });
  if (!home.ok || isBotWall(home.body)) return null;
  const host = new URL(home.url).hostname.replace(/^www\./, "").toLowerCase();
  const label = host.split(".").slice(0, -1).join(".");
  const title = (home.body.match(/<title[^>]*>([\s\S]{0,250}?)<\/title>/i)?.[1] ?? "").toLowerCase();
  const hostHit = keys.some((k) => k.length >= 4 && label.includes(k)) || (initials.length >= 3 && label.startsWith(initials));
  const initialsHit = initials.length >= 3 && label.split(/[.\-]/).includes(initials);
  // every distinctive name word (up to 2) must be in the title, plus one descriptor (Medical, University...) if the name has one
  const titleHits = keys.filter((k) => title.includes(k)).length;
  const descOk = !descriptors.length || descriptors.some((d) => title.includes(d) || label.includes(d));
  const titleOk = titleHits >= Math.min(2, keys.length) && descOk;
  if (!titleOk && !(initialsHit && titleHits >= 1)) return null;
  if (!hostHit && titleHits < keys.length) return null;
  if (local(lead)) {
    const text = textOf(home.body).toLowerCase();
    const st = (STATE_NAME[lead.state] ?? "").toLowerCase();
    if (!(st && text.includes(st)) && !new RegExp(`[ ,]${lead.state.toLowerCase()},? \\d{5}`).test(text)) return null;
  }
  return { url: home.url, html: home.body };
}
function isBotWall(html: string): boolean {
  return /incapsula incident id|request unsuccessful|attention required! \| cloudflare|access denied|captcha/i.test(html.slice(0, 20000)) && html.length < 60000;
}

// Numbers Bing shows for "<company> <state> main phone number" (knowledge panel + snippets).
// Used when the site itself has no readable number (JS-rendered pages, bot walls).
async function searchPhones(lead: Lead): Promise<Cand[]> {
  const { q } = cleanName(lead.company);
  const url = `https://www.bing.com/search?q=${encodeURIComponent(`"${q}" ${STATE_NAME[lead.state] ?? ""} main phone number`)}&setlang=en-US&cc=US`;
  const r = await get(url, { browser: true });
  if (!r.ok) return [];
  const text = textOf(r.body);
  const first = q.toLowerCase().split(/\s+/).find((w) => w.length > 3) ?? q.toLowerCase();
  const out: Cand[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    const n = normalize(m[0]);
    if (!n) continue;
    const ctx = text.slice(Math.max(0, m.index! - 120), m.index! + m[0].length);
    if (!ctx.toLowerCase().includes(first)) continue;
    out.push({ e164: n.e164, display: n.display, source: "search", url, context: ctx.trim().slice(-140), score: scoreNumber(n, lead, 46, ctx) });
  }
  return out;
}

// Last resort: guess the domain from the name (verified like a searched site before use).
function guessSites(lead: Lead): string[] {
  const { q } = cleanName(lead.company);
  const { words, keys, initials } = nameTokens(q);
  const lq = q.toLowerCase();
  const tlds = /university|college|school|institute/.test(lq) ? [".edu", ".org"]
    : /health|hospital|medical|clinic/.test(lq) ? [".org", ".com"]
    : /county|city|town|state of|district/.test(lq) ? [".gov", ".org"] : [".com", ".org"];
  const names = [...new Set([words.join(""), keys.join(""), initials.length >= 3 ? initials : ""].filter((x) => x && x.length >= 3))].slice(0, 2);
  return names.flatMap((n) => tlds.map((t) => `https://www.${n}${t}/`)).slice(0, 4);
}

// ---------- one lead ----------
async function enrich(lead: Lead) {
  const cands: Cand[] = [];
  let website: string | null = null;
  let qid: string | null = null;
  let wdError = false;
  try {
    const wd = await wikidata(lead);
    if (wd) {
      qid = wd.qid;
      website = wd.website ?? null;
      if (wd.phone) {
        const n = normalize(wd.phone);
        if (n) cands.push({ e164: n.e164, display: n.display, source: "wikidata", url: `https://www.wikidata.org/wiki/${wd.qid}`, context: "Wikidata P1329", score: scoreNumber(n, lead, 70, "main phone") });
      }
    }
  } catch { wdError = true; }
  // Wikidata unreachable or rate-limited: retry this lead later rather than guess from search alone
  // (after the 3rd try, go ahead with search + verification only).
  if (wdError && lead.enrich_attempts < 3) {
    const { error } = await db.from("rg_leads").update({ enrich_status: "error", enrich_error: "wikidata unavailable, will retry", claimed_at: null, enriched_at: new Date().toISOString() }).eq("id", lead.id);
    if (error) throw error;
    return "error";
  }

  if (website) {
    const s = await scrapeSite(website, lead);
    website = s.final;
    cands.push(...s.cands);
  } else {
    for (const cand of [...(await searchSites(lead)), ...guessSites(lead)]) {
      const v = await verifySite(cand, lead);
      if (!v) continue;
      website = v.url;
      const s = await scrapeSite(v.url, lead, v.html);
      cands.push(...s.cands);
      break;
    }
  }
  if (!cands.some((c) => c.score >= 60)) cands.push(...(await searchPhones(lead)));

  // merge duplicates: the same number from several places is stronger
  const byNum = new Map<string, Cand & { hits: number }>();
  for (const c of cands) {
    const prev = byNum.get(c.e164);
    if (!prev) byNum.set(c.e164, { ...c, hits: 1 });
    else {
      prev.hits += 1;
      if (c.score > prev.score) Object.assign(prev, { ...c, hits: prev.hits });
    }
  }
  const ranked = [...byNum.values()]
    .map((c) => ({ ...c, score: c.score + Math.min(3, c.hits - 1) * 5 }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] && ranked[0].score >= 50 ? ranked[0] : null;

  const patch: Record<string, unknown> = {
    website, wikidata_id: qid,
    phone_candidates: ranked.slice(0, 6).map(({ e164, display, source, url, score, context, hits }) => ({ e164, display, source, url, score, hits, context })),
    enriched_at: new Date().toISOString(), claimed_at: null,
  };
  if (best) {
    Object.assign(patch, {
      phone: best.e164, phone_source: best.source, phone_source_url: best.url,
      phone_confidence: Math.max(0, Math.min(95, Math.round(best.score))),
      enrich_status: "found", enrich_error: null,
    });
  } else {
    Object.assign(patch, { enrich_status: "not_found", enrich_error: website ? "no usable number on site" : "no website found" });
  }
  const { error } = await db.from("rg_leads").update(patch).eq("id", lead.id);
  if (error) throw error;
  return patch.enrich_status as string;
}

Deno.serve(async (req) => {
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });
  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(30, Number(body.limit) || BATCH));

  // Diagnostics for the operator: what does the edge runtime actually get back from these URLs?
  if (body.action === "probe" && Array.isArray(body.urls)) {
    const out = [];
    for (const u of body.urls.slice(0, 6)) {
      if (typeof u !== "string" || !/^https:\/\//.test(u) || /supabase\.co|localhost|127\.0\.0\.1|169\.254\./.test(u)) continue;
      const r = await get(u, { browser: true });
      out.push({ url: u, ok: r.ok, final: r.url, bytes: r.body.length, title: r.body.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i)?.[1] ?? null });
    }
    return Response.json({ ok: true, probe: out });
  }

  const { data: run } = await db.from("rg_enrich_runs").insert({ note: String(body.source ?? "cron") }).select("id").single();
  const { data: leads, error } = await db.rpc("rg_claim_batch", { p_limit: limit });
  if (error) {
    await db.from("rg_enrich_runs").update({ finished_at: new Date().toISOString(), note: `claim failed: ${error.message}` }).eq("id", run?.id);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  const queue: Lead[] = [...(leads ?? [])];
  const tally = { claimed: queue.length, found: 0, not_found: 0, errors: 0 };

  const worker = async () => {
    while (queue.length) {
      const lead = queue.shift()!;
      if (Date.now() - started > BUDGET_MS) {
        await db.from("rg_leads").update({ enrich_status: "pending", claimed_at: null }).eq("id", lead.id);
        continue;
      }
      try {
        const st = await enrich(lead);
        if (st === "found") tally.found++; else if (st === "not_found") tally.not_found++; else tally.errors++;
      } catch (e) {
        tally.errors++;
        await db.from("rg_leads").update({ enrich_status: "error", enrich_error: String((e as Error)?.message ?? e).slice(0, 300), claimed_at: null, enriched_at: new Date().toISOString() }).eq("id", lead.id);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await db.from("rg_enrich_runs").update({ finished_at: new Date().toISOString(), ...tally }).eq("id", run?.id);
  return Response.json({ ok: true, ...tally, ms: Date.now() - started });
});
