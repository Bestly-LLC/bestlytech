// Ava's calendars (2026-10-05): iCloud and Nextcloud over CalDAV, read-only free/busy, and one write path (Nextcloud).
//
// Credentials are passed in by index.ts (read from Vault through ava_secret); nothing in here stores or logs them. Event titles and
// descriptions are read only to spot Turo trips; they are never returned to the browser and never spoken to a caller. Google is not used.
//
// Turo rule (Jared chose this): a Turo reservation only blocks a window around each pickup and each return (default 60 minutes on each
// side, a setting on the Calendars card). The time in between is free. Turo events are found by "Turo" in the title or description;
// index.ts also feeds in the Turo Watch trips (turo_trips starts_at / ends_at).

export type Provider = "nextcloud" | "icloud";
export type Creds = { user: string; pass: string; base?: string };   // base: CalDAV root for Nextcloud (default cloud.bestly.tech)
export type Cal = { id: string; provider: Provider; href: string; name: string; writable: boolean };
export type Busy = { start: number; end: number };
export type Slot = { start: string; end: string };
export type Hours = { days: number[]; start: number; end: number };   // days: 0 Sunday .. 6 Saturday, Pacific; start/end are hours (9, 18)

export const NEXTCLOUD_BASE = "https://cloud.bestly.tech/remote.php/dav";
export const ICLOUD_BASE = "https://caldav.icloud.com";
export const TZ = "America/Los_Angeles";
export const TURO_WINDOW_MIN = 60;                // minutes blocked on EACH side of every Turo pickup and return (default; Jared can change it)
export const DEFAULT_HOURS: Hours = { days: [1, 2, 3, 4, 5], start: 9, end: 18 };

const nextcloudRoot = (c: Creds) => (c.base && /^https:\/\//i.test(c.base) ? `${c.base.replace(/\/+$/, "").replace(/\/remote\.php\/dav$/i, "")}/remote.php/dav` : NEXTCLOUD_BASE);
const authHeader = (c: Creds) => `Basic ${btoa(`${c.user}:${c.pass}`)}`;

async function dav(url: string, method: string, c: Creds, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; url: string }> {
  // Redirects are followed by hand: fetch() drops the Authorization header when a redirect changes the host (iCloud sends you to a
  // per-account pXX-caldav.icloud.com), and 301/302 can turn a PROPFIND into a GET. Same method, same body, same login on every hop,
  // but only to the same site, so the password never goes anywhere else.
  let cur = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(cur, { method, headers: { authorization: authHeader(c), "content-type": "application/xml; charset=utf-8", ...headers }, body, redirect: "manual" });
    const loc = res.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
      await res.text().catch(() => "");
      const next = absolute(loc, cur);
      if (new URL(next).hostname.split(".").slice(-2).join(".") !== new URL(cur).hostname.split(".").slice(-2).join(".")) throw new Error("the calendar server redirected somewhere unexpected");
      cur = next; continue;
    }
    return { status: res.status, text: await res.text().catch(() => ""), url: cur };
  }
  throw new Error("the calendar server redirected too many times");
}

// ---------- tiny XML helpers (CalDAV answers are regular; a full parser isn't worth it) ----------
const NS = "(?:[\\w-]+:)?";
const blocks = (xml: string, tag: string) => xml.match(new RegExp(`<${NS}${tag}[\\s>][\\s\\S]*?</${NS}${tag}>`, "gi")) ?? [];
const first = (xml: string, tag: string) => new RegExp(`<${NS}${tag}[^>]*>([\\s\\S]*?)</${NS}${tag}>`, "i").exec(xml)?.[1]?.trim() ?? null;
const hasEl = (xml: string, tag: string) => new RegExp(`<${NS}${tag}[\\s/>]`, "i").test(xml);
const unxml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const absolute = (href: string, base: string) => { try { return new URL(href, base).toString(); } catch { return href; } };

// ---------- discovery ----------
const CAL_PROPS = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>`;

function parseCalendars(xml: string, base: string, provider: Provider): Cal[] {
  const out: Cal[] = [];
  for (const r of blocks(xml, "response")) {
    const href = first(r, "href"); if (!href) continue;
    const rt = first(r, "resourcetype") ?? "";
    if (!hasEl(rt, "calendar") || /<[\w:-]*(schedule-inbox|schedule-outbox|deleted-calendar)/i.test(rt)) continue;
    const comps = first(r, "supported-calendar-component-set");
    if (comps && !/name="VEVENT"/i.test(comps)) continue;                 // reminders / task lists
    const url = absolute(unxml(href), base);
    const name = unxml(first(r, "displayname") ?? "").trim() || decodeURIComponent(url.split("/").filter(Boolean).pop() ?? "Calendar");
    const priv = first(r, "current-user-privilege-set");
    out.push({ id: `${provider}|${url}`, provider, href: url, name, writable: provider === "nextcloud" && (!priv || /<[\w:-]*(write|all)\s*\/>/i.test(priv)) });
  }
  return out;
}

/** What a discovery step looked like, with nothing private in it (no login, no account number): used to see why a provider lists no calendars. */
export type Trace = string[];
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^p\d+-/, "pNN-"); } catch { return "?"; } };
const tags = (xml: string) => [...new Set((xml.match(/<(?:[\w-]+:)?[\w-]+/g) ?? []).map((t) => t.replace(/^<(?:[\w-]+:)?/, "")))].slice(0, 30).join(",");

const PRINCIPAL_XML = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
const HOME_XML = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;

/** The calendars this login can see. Throws a short plain message on failure (never includes the password). `trace` collects safe step notes. */
export async function discover(provider: Provider, c: Creds, trace: Trace = []): Promise<Cal[]> {
  if (provider === "nextcloud") {
    const home = `${nextcloudRoot(c)}/calendars/${encodeURIComponent(c.user)}/`;
    const r = await dav(home, "PROPFIND", c, CAL_PROPS, { depth: "1" });
    if (r.status === 401 || r.status === 403) throw new Error("Nextcloud refused the login (check the user name and app password)");
    if (r.status >= 400) throw new Error(`Nextcloud answered ${r.status}`);
    return parseCalendars(r.text, home, provider);
  }
  // iCloud: principal -> calendar home (a per-account host, followed by hand) -> every collection that is a VEVENT calendar
  const p1 = await dav(`${ICLOUD_BASE}/`, "PROPFIND", c, PRINCIPAL_XML, { depth: "0" });
  trace.push(`1 principal: ${p1.status} at ${hostOf(p1.url)}`);
  if (p1.status === 401 || p1.status === 403) throw new Error("iCloud refused the login (check the Apple ID and app-specific password)");
  if (p1.status >= 400) throw new Error(`iCloud answered ${p1.status}`);
  const principal = first(first(p1.text, "current-user-principal") ?? "", "href");
  if (!principal) { trace.push(`1 tags: ${tags(p1.text)}`); throw new Error("iCloud didn't say where the calendars are"); }
  const principalUrl = absolute(unxml(principal), p1.url);
  const p2 = await dav(principalUrl, "PROPFIND", c, HOME_XML, { depth: "0" });
  trace.push(`2 home-set: ${p2.status} at ${hostOf(p2.url)}`);
  const homeHref = first(first(p2.text, "calendar-home-set") ?? "", "href");
  if (p2.status >= 400 || !homeHref) { trace.push(`2 tags: ${tags(p2.text)}`); throw new Error("iCloud didn't list the calendar home"); }
  const home = absolute(unxml(homeHref), p2.url);
  const p3 = await dav(home, "PROPFIND", c, CAL_PROPS, { depth: "1" });
  trace.push(`3 calendars: ${p3.status} at ${hostOf(p3.url)}, ${blocks(p3.text, "response").length} resources, ${p3.text.length} bytes`);
  if (p3.status >= 400) throw new Error(`iCloud answered ${p3.status}`);
  const cals = parseCalendars(p3.text, p3.url, provider);
  if (!cals.length) {
    trace.push(`3 tags: ${tags(p3.text)}`);
    // some accounts answer the home with only a listing; look at each collection on its own as a second chance
    const hrefs = blocks(p3.text, "response").map((r) => first(r, "href")).filter((h): h is string => !!h).map((h) => absolute(unxml(h), p3.url)).filter((u) => u.replace(/\/$/, "") !== p3.url.replace(/\/$/, ""));
    const out: Cal[] = [];
    for (const u of hrefs.slice(0, 40)) {
      const one = await dav(u, "PROPFIND", c, CAL_PROPS, { depth: "0" }).catch(() => null);
      if (one && one.status < 400) out.push(...parseCalendars(one.text, u, provider));
    }
    trace.push(`3b individual look: ${out.length} calendars from ${Math.min(hrefs.length, 40)} resources`);
    return out;
  }
  return cals;
}

// ---------- time helpers (Pacific) ----------
const pad = (n: number) => String(n).padStart(2, "0");
const icsUtc = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };

/** The UTC instant for a wall-clock time in a zone (handles daylight saving by checking the zone's offset at that instant). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz = TZ): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - t;
  };
  let t = guess - off(guess);
  t = guess - off(t);
  return t;
}
/** y/m/d/h/min/weekday of an instant in Pacific */
export function ptParts(ms: number) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }).formatToParts(new Date(ms));
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return { y: Number(g("year")), mo: Number(g("month")), d: Number(g("day")), h: Number(g("hour")), mi: Number(g("minute")), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")) };
}

// ---------- reading events ----------
type Ev = { start: number; end: number; allDay: boolean; summary: string; description: string; free: boolean };

function unfold(ics: string) { return ics.replace(/\r?\n[ \t]/g, ""); }
function icsTime(line: string): { ms: number; allDay: boolean } | null {
  const m = /^[A-Z-]+((?:;[^:]*)*):(.*)$/.exec(line); if (!m) return null;
  const params = m[1], v = m[2].trim();
  if (/VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(v)) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8);
    return { ms: zonedToUtc(y, mo, d, 0, 0), allDay: true };
  }
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/.exec(v); if (!t) return null;
  const [y, mo, d, h, mi] = [+t[1], +t[2], +t[3], +t[4], +t[5]];
  if (t[7] === "Z") return { ms: Date.UTC(y, mo - 1, d, h, mi, +(t[6] ?? 0)), allDay: false };
  const tz = /TZID=([^;:]+)/i.exec(params)?.[1]?.replace(/^"|"$/g, "");
  try { return { ms: zonedToUtc(y, mo, d, h, mi, tz || TZ), allDay: false }; } catch { return { ms: zonedToUtc(y, mo, d, h, mi), allDay: false }; }
}
function parseDuration(v: string): number {
  const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim()); if (!m) return 0;
  const ms = ((+(m[2] ?? 0)) * 7 * 86400 + (+(m[3] ?? 0)) * 86400 + (+(m[4] ?? 0)) * 3600 + (+(m[5] ?? 0)) * 60 + (+(m[6] ?? 0))) * 1000;
  return m[1] ? -ms : ms;
}
export function parseEvents(icsText: string): Ev[] {
  const out: Ev[] = [];
  for (const raw of icsText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []) {
    const body = unfold(raw).split(/\r?\n/);
    const line = (name: string) => body.find((l) => new RegExp(`^${name}[;:]`, "i").test(l));
    const ds = line("DTSTART"); if (!ds) continue;
    const s = icsTime(ds); if (!s) continue;
    const de = line("DTEND"), du = line("DURATION");
    let end = de ? icsTime(de)?.ms : undefined;
    if (end == null && du) end = s.ms + parseDuration(du.replace(/^DURATION:/i, ""));
    if (end == null) end = s.allDay ? s.ms + 86400_000 : s.ms;
    if (/^STATUS:CANCELLED/im.test(body.join("\n"))) continue;
    const txt = (name: string) => (line(name)?.replace(new RegExp(`^${name}[^:]*:`, "i"), "") ?? "").replace(/\\n/gi, " ").replace(/\\,/g, ",");
    out.push({ start: s.ms, end, allDay: s.allDay, summary: txt("SUMMARY"), description: txt("DESCRIPTION"), free: /^TRANSP:TRANSPARENT/im.test(body.join("\n")) });
  }
  return out;
}

const queryXml = (from: number, to: number) => `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand start="${icsUtc(from)}" end="${icsUtc(to)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${icsUtc(from)}" end="${icsUtc(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;

/** Busy intervals from the chosen calendars. Turo events block only around pickup and return. Throws if a calendar can't be read. */
export async function busyFrom(cals: Cal[], creds: Partial<Record<Provider, Creds>>, from: number, to: number, turoWindowMin = TURO_WINDOW_MIN): Promise<Busy[]> {
  const half = turoWindowMin * 60_000;
  const busy: Busy[] = [];
  const results = await Promise.all(cals.map(async (cal) => {
    const c = creds[cal.provider]; if (!c) throw new Error(`${cal.provider} isn't connected`);
    const r = await dav(cal.href, "REPORT", c, queryXml(from, to), { depth: "1" });
    if (r.status >= 400) throw new Error(`${cal.provider} calendar answered ${r.status}`);
    // a calendar NAMED Turo holds only Turo trips, so every event on it gets the Turo rule even if the title doesn't say so
    const turoCal = /turo/i.test(cal.name);
    return blocks(r.text, "calendar-data").flatMap((b) => parseEvents(unxml(b.replace(/^<[^>]*>|<\/[^>]*>$/g, ""))).map((ev) => ({ ...ev, turoCal })));
  }));
  for (const ev of results.flat()) {
    if (ev.allDay || ev.free) continue;                                       // birthdays, holidays, "free" blocks
    if (ev.turoCal || /turo/i.test(`${ev.summary} ${ev.description}`)) { turoWindows(ev.start, ev.end, half, busy); continue; }
    busy.push({ start: ev.start, end: Math.max(ev.end, ev.start + 15 * 60_000) });
  }
  return busy;
}
export function turoWindows(start: number, end: number, half: number, into: Busy[]) {
  into.push({ start: start - half, end: start + half });
  if (end > start) into.push({ start: end - half, end: end + half });
}

// ---------- free slots ----------
/** How long the meeting runs: what the caller said (appt_duration_min), else 60 minutes. Kept to 15 minutes .. 4 hours. */
export function durationFor(_purpose: string, said?: number | null): number {
  const n = Math.round(Number(said));
  return Number.isFinite(n) && n >= 15 && n <= 240 ? n : 60;
}

/** What the caller said about their own availability ("Tuesday afternoon", "after 2", "next week"), read with plain rules, no AI. */
export type Constraints = { days?: number[]; notDays?: number[]; fromMin?: number; toMin?: number; notBefore?: number; notAfter?: number };
const DAY_RX: [RegExp, number][] = [[/\bsun(day)?s?\b/, 0], [/\bmon(day)?s?\b/, 1], [/\btue(s|sday)?s?\b/, 2], [/\bwed(nesday)?s?\b/, 3], [/\bthu(r|rs|rsday)?s?\b/, 4], [/\bfri(day)?s?\b/, 5], [/\bsat(urday)?s?\b/, 6]];
const hourMin = (h: string, m: string | undefined, ap: string | undefined) => {
  let hh = Number(h); const mm = Number(m ?? 0);
  if (ap) { const pm = ap.toLowerCase() === "pm"; if (hh === 12) hh = pm ? 12 : 0; else if (pm) hh += 12; }
  else if (hh >= 1 && hh <= 7) hh += 12;          // "after 2" means 2 PM; "after 9" means 9 AM; "after 12" means noon
  return hh * 60 + mm;
};
export function parseConstraints(text: string, now = Date.now()): Constraints {
  const t = (text ?? "").toLowerCase().replace(/\bnoon\b/g, "12pm").replace(/\bmidnight\b/g, "12am");
  const c: Constraints = {};
  if (!t.trim()) return c;
  const yes: number[] = [], no: number[] = [];
  for (const [rx, d] of DAY_RX) {
    const g = new RegExp(rx.source, "g");
    for (let m = g.exec(t); m; m = g.exec(t)) {
      // "not Friday", "except Friday", "no Fridays", "Monday or Friday doesn't work" -> excluded; everything else -> allowed
      (/(?:\bnot|\bexcept|\bno|\bavoid|\bnever|n't)(?:\s+on)?(?:\s+\w+,?){0,2}\s*$/.test(t.slice(Math.max(0, m.index - 24), m.index)) || /^\s*(?:\w+\s+){0,2}(?:doesn't|does not|won't|don't) work/.test(t.slice(m.index + m[0].length)) ? no : yes).push(d);
    }
  }
  if (/\bweekends?\b/.test(t)) (/\b(no|not|except|avoid)\s+weekends?\b/.test(t) ? no : yes).push(0, 6);
  if (yes.length) c.days = [...new Set(yes)].filter((d) => !no.includes(d));
  if (no.length) c.notDays = [...new Set(no)];
  const T = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?";
  const between = new RegExp(`(?:between|from)\\s+${T}\\s+(?:and|to|-)\\s+${T}`).exec(t) ?? new RegExp(`\\b${T}\\s*(?:-|to)\\s*${T}`).exec(t);
  if (between && (between[3] || between[6] || /between|from/.test(between[0]))) {
    const b = hourMin(between[4], between[5], between[6]);
    let a = hourMin(between[1], between[2], between[3]);
    if (a >= b && !between[3] && between[6]) a = hourMin(between[1], between[2], between[6]);   // "10 to 12pm"-style: one suffix covers both
    if (b > a) { c.fromMin = a; c.toMin = b; }
  }
  if (c.fromMin == null) {
    const aft = new RegExp(`\\bafter\\s+${T}`).exec(t), bef = new RegExp(`\\bbefore\\s+${T}`).exec(t);
    if (aft) c.fromMin = hourMin(aft[1], aft[2], aft[3]);
    if (bef) c.toMin = hourMin(bef[1], bef[2], bef[3]);
    if (/\bmornings?\b/.test(t)) c.toMin = Math.min(c.toMin ?? 720, 720);
    if (/\bafternoons?\b/.test(t)) { c.fromMin = Math.max(c.fromMin ?? 720, 720); c.toMin = Math.min(c.toMin ?? 1020, 1020); }
    if (/\bevenings?\b/.test(t)) c.fromMin = Math.max(c.fromMin ?? 1020, 1020);
  }
  const p = ptParts(now), noon = (add: number) => zonedToUtc(p.y, p.mo, p.d + add, 0, 0);
  if (/\bnext week\b/.test(t)) c.notBefore = noon(((8 - p.wd) % 7) || 7);                 // the coming Monday
  else if (/\bthis week\b/.test(t)) c.notAfter = noon(((7 - p.wd) % 7) + 1);                // through Sunday
  if (/\btomorrow\b/.test(t)) { c.notBefore = noon(1); c.notAfter = noon(2); }
  if (/\btoday\b/.test(t)) { c.notBefore = noon(0); c.notAfter = noon(1); }
  return c;
}

/**
 * The next free slots: weekdays 9 AM to 6 PM Pacific by default, 30-minute steps, nothing sooner than 90 minutes from now, at most
 * two per day (the first free one from the start of the day and the first free one from 1 PM) so the choices are spread out.
 */
export function freeSlots(busy: Busy[], o: { now?: number; days?: number; count?: number; durationMin: number; hours?: Hours; bufferMin?: number; constraints?: Constraints }): Slot[] {
  const now = o.now ?? Date.now(), days = o.days ?? 14, count = o.count ?? 6, cs = o.constraints ?? {}, hrs = o.hours ?? DEFAULT_HOURS, dur = o.durationMin * 60_000, buf = (o.bufferMin ?? 10) * 60_000;
  const merged = [...busy].sort((a, b) => a.start - b.start);
  const clash = (s: number, e: number) => merged.some((b) => b.start < e + buf && b.end > s - buf);
  const out: Slot[] = [];
  const today = ptParts(now);
  for (let i = 0; i <= days && out.length < count; i++) {
    const base = zonedToUtc(today.y, today.mo, today.d + i, 12, 0);          // noon of day i, safe from daylight-saving edges
    const p = ptParts(base);
    if (!hrs.days.includes(p.wd) || (cs.days && !cs.days.includes(p.wd)) || cs.notDays?.includes(p.wd)) continue;
    const dayMid = zonedToUtc(p.y, p.mo, p.d, 0, 0);
    if ((cs.notBefore != null && dayMid < cs.notBefore) || (cs.notAfter != null && dayMid >= cs.notAfter)) continue;
    const fromMin = Math.max(hrs.start * 60, cs.fromMin ?? 0), toMin = Math.min(hrs.end * 60, cs.toMin ?? 1440);
    if (toMin - fromMin < o.durationMin) continue;
    const dayStart = zonedToUtc(p.y, p.mo, p.d, Math.floor(fromMin / 60), fromMin % 60), dayEnd = zonedToUtc(p.y, p.mo, p.d, Math.floor(toMin / 60), toMin % 60);
    const pickFrom = (from: number): Slot | null => {
      const step = 30 * 60_000;
      for (let t = Math.ceil(Math.max(from, now + 90 * 60_000) / step) * step; t + dur <= dayEnd; t += step) {
        if (!clash(t, t + dur)) return { start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() };
      }
      return null;
    };
    const a = pickFrom(dayStart);
    if (a) out.push(a);
    const b = pickFrom(Math.max(zonedToUtc(p.y, p.mo, p.d, 13, 0), dayStart, a ? Date.parse(a.end) : 0));
    if (b && b.start !== a?.start && out.length < count) out.push(b);
  }
  return out.slice(0, count);
}

/** "Tuesday at 9:00 AM" for a spoken offer (never anything but the offered time itself). */
export function spoken(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} at ${time} Pacific`;
}

// ---------- writing (Nextcloud only) ----------
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
export async function putEvent(c: Creds, calHref: string, ev: { uid: string; start: string; end: string; summary: string; description: string }): Promise<void> {
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bestly//Ava assistant//EN", "BEGIN:VEVENT", `UID:${ev.uid}`, `DTSTAMP:${icsUtc(Date.now())}`,
    `DTSTART:${icsUtc(Date.parse(ev.start))}`, `DTEND:${icsUtc(Date.parse(ev.end))}`, `SUMMARY:${esc(ev.summary)}`, `DESCRIPTION:${esc(ev.description)}`,
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const url = `${calHref.replace(/\/?$/, "/")}${encodeURIComponent(ev.uid)}.ics`;
  const r = await dav(url, "PUT", c, ics, { "content-type": "text/calendar; charset=utf-8", "if-none-match": "*" });
  if (r.status >= 300) throw new Error(`the calendar answered ${r.status}`);
}
