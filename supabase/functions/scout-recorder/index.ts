// scout-recorder: backend for the Scout Recorder Chrome extension (records the web meetings Jared or a
// partner is invited to and drops them into the Calls pipeline: voice_clips kind=meeting -> Mac mini).
// POST JSON {action, ...} with headers apikey + x-scout-key (a partner_connectors key, bpc_...).
// Every answer is {ok:true,...} or {ok:false,error:'plain words'}.
// verify_jwt = false; identity is checked in code with partner_connector_auth. The Mac worker key
// (x-worker-key) is accepted for `selftest` only (the watchdog scout_recorder_watch() calls it via pg_net).
import { createClient } from "npm:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const NC = "https://cloud.bestly.tech";
const BUCKET = "voice-clips";
const PART_BYTES = 40_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOIN = /(https:\/\/[\w.-]*zoom\.us\/(?:j|wc\/join)\/[^\s"<>\\]+|https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}|https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>\\]+|https:\/\/teams\.live\.com\/meet\/[^\s"<>\\]+)/i;

// ---------- http helpers ----------
function corsFor(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  // Only Chrome extensions get CORS access. Web pages (and pg_net, which does not use CORS) get no ACAO header.
  const allow: Record<string, string> = /^chrome-extension:\/\/[a-z0-9]{3,64}$/.test(o) ? { "Access-Control-Allow-Origin": o } : {};
  return {
    ...allow,
    "Access-Control-Allow-Headers": "apikey, content-type, x-scout-key, x-worker-key, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
class Refuse extends Error { constructor(public msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); } }

// ---------- time ----------
const fmtTime = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true })
  .format(d).replace(/[\u202f\u00a0]/g, " ");
function laStamp(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}${p.minute}` };
}

// ---------- meeting keys ----------
function platformOf(u: string): "meet" | "zoom" | "teams" | null {
  try {
    const h = new URL(u).hostname.toLowerCase();
    if (h === "meet.google.com") return "meet";
    if (h === "zoom.us" || h.endsWith(".zoom.us")) return "zoom";
    if (h === "teams.microsoft.com" || h === "teams.live.com") return "teams";
  } catch { /* not a url */ }
  return null;
}
function dec(s: string) { let x = s; for (let i = 0; i < 3; i++) { try { const y = decodeURIComponent(x); if (y === x) break; x = y; } catch { break; } } return x; }
function keyFromUrl(u: string): string | null {
  const p = platformOf(u); if (!p) return null;
  if (p === "meet") return u.match(/meet\.google\.com\/(?:lookup\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})/i)?.[1].toLowerCase() ?? null;
  if (p === "zoom") return u.match(/zoom\.us\/(?:j|s|w|wc\/join|wc)\/(\d{8,12})/i)?.[1] ?? null;
  const d = dec(u);
  const t = d.match(/(19:meeting_[A-Za-z0-9_-]+@thread\.v2)/i)?.[1];
  if (t) return t;
  return u.match(/teams\.live\.com\/meet\/(\d{6,})/i)?.[1] ?? null;
}
function normKey(platform: string, raw: string): string | null {
  const s = (raw ?? "").trim(); if (!s) return null;
  if (/^https?:\/\//i.test(s)) return keyFromUrl(s);
  if (platform === "meet") return s.toLowerCase().match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/)?.[0] ?? null;
  if (platform === "zoom") { const d = s.replace(/[\s-]/g, ""); return /^\d{8,12}$/.test(d) ? d : null; }
  if (platform === "teams") { const d = dec(s); return d.match(/19:meeting_[A-Za-z0-9_-]+@thread\.v2/i)?.[0] ?? (/^\d{6,}$/.test(d) ? d : null); }
  return null;
}
const sameKey = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ---------- calendar (copied from next-meeting, plus attendees + meeting_key) ----------
type Att = { name: string | null; email: string | null };
type Ev = { uid: string; title: string; start: string; end: string | null; all_day: boolean; join_url: string | null; platform: "meet" | "zoom" | "teams" | null; meeting_key: string | null; attendees: Att[]; text: string };

function unfold(ics: string) { return ics.replace(/\r?\n[ \t]/g, ""); }
function icsDate(v: string): { iso: string; allDay: boolean } {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return { iso: v, allDay: false };
  if (!m[4]) return { iso: `${m[1]}-${m[2]}-${m[3]}T00:00:00-07:00`, allDay: true };
  const base = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7]) return { iso: base + "Z", allDay: false };
  return { iso: base + "-07:00", allDay: false };
}
function parseIcs(ics: string): Ev[] {
  const out: Ev[] = [];
  for (const block of unfold(ics).split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const lines = body.split(/\r?\n/);
    const get = (k: string) => {
      const line = lines.find((l) => l.startsWith(k + ":") || l.startsWith(k + ";"));
      if (!line) return null;
      const i = line.indexOf(":");
      return { params: line.slice(0, i), value: line.slice(i + 1).replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";") };
    };
    const st = get("DTSTART"); if (!st) continue;
    if ((get("STATUS")?.value ?? "") === "CANCELLED") continue;
    const en = get("DTEND");
    const s = icsDate(st.value), e = en ? icsDate(en.value) : null;
    const loc = get("LOCATION")?.value ?? "", desc = get("DESCRIPTION")?.value ?? "", url = get("URL")?.value ?? "";
    const attendees: Att[] = [];
    for (const l of lines) {
      const m = l.match(/^(ATTENDEE|ORGANIZER)([^:]*):(.*)$/);
      if (!m) continue;
      const cn = m[2].match(/CN=("[^"]*"|[^;:]+)/i)?.[1]?.replace(/^"|"$/g, "") ?? null;
      const mail = m[3].replace(/^mailto:/i, "").trim() || null;
      attendees.push({ name: cn, email: mail ? mail.toLowerCase() : null });
    }
    let join = `${loc} ${url} ${desc}`.match(JOIN)?.[1]?.replace(/[.,)\]]+$/, "") ?? null;
    const platform = join ? platformOf(join) : null;
    if (!platform) join = null;
    const title = get("SUMMARY")?.value ?? "(no title)";
    const rec = get("RECURRENCE-ID")?.value;
    out.push({
      uid: (get("UID")?.value ?? title) + (rec ? "#" + rec : ""), title, start: s.iso, end: e?.iso ?? null, all_day: s.allDay,
      join_url: join, platform, meeting_key: join && platform ? keyFromUrl(join) : null, attendees,
      text: `${title} ${desc} ${lines.filter((l) => /^(ATTENDEE|ORGANIZER)/.test(l)).join(" ")}`.toLowerCase(),
    });
  }
  return out;
}

const cache = new Map<number, { t: number; events: Ev[]; cals: number }>();
async function calendarFetch(days: number): Promise<{ events: Ev[]; cals: number }> {
  const hit = cache.get(days);
  if (hit && Date.now() - hit.t < 5 * 60e3) return { events: hit.events, cals: hit.cals };
  const { data: cred } = await db.rpc("get_nextcloud_credentials");
  const row = Array.isArray(cred) ? cred[0] : cred;
  const user = row?.username || "jared", pass = row?.app_password;
  if (!pass) throw new Error("no Bestly Cloud credential");
  const basic = "Basic " + btoa(`${user}:${pass}`);
  const home = `${NC}/remote.php/dav/calendars/${encodeURIComponent(user)}/`;
  const pf = await fetch(home, { method: "PROPFIND", headers: { Authorization: basic, Depth: "1", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>` });
  if (pf.status >= 400) throw new Error("calendar login failed " + pf.status);
  const xml = await pf.text();
  const cals = [...xml.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)].map((m) => m[1])
    .filter((r) => /<cal:calendar\s*\/>|calendar\/>/.test(r) && !/inbox|outbox|trashbin/.test(r))
    .map((r) => ({ href: r.match(/<d:href>([^<]+)<\/d:href>/)?.[1] ?? "" }))
    .filter((c) => c.href && c.href !== new URL(home).pathname);
  const now = new Date(), end = new Date(Date.now() + days * 864e5);
  const z = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const report = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand start="${z(now)}" end="${z(end)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${z(now)}" end="${z(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const events: Ev[] = [];
  await Promise.all(cals.map(async (c) => {
    const r = await fetch(NC + c.href, { method: "REPORT", headers: { Authorization: basic, Depth: "1", "Content-Type": "application/xml" }, body: report });
    if (!r.ok) return;
    const t = await r.text();
    for (const m of t.matchAll(/<cal:calendar-data[^>]*>([\s\S]*?)<\/cal:calendar-data>/g)) {
      const ics = m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#13;/g, "");
      events.push(...parseIcs(ics));
    }
  }));
  // second source: Google Meet invites Scout Notetaker watches (meet_watch)
  try {
    const { data: mw } = await db.from("meet_watch").select("event_key,meet_code,meet_url,title,starts_at,ends_at,organizer,guests")
      .eq("skip", false).gte("ends_at", new Date(Date.now() - 15 * 60e3).toISOString()).lte("starts_at", end.toISOString());
    for (const m of mw ?? []) {
      const key = (m.meet_code || keyFromUrl(m.meet_url) || "").toLowerCase();
      if (!key || events.some((e) => e.platform === "meet" && e.meeting_key && sameKey(e.meeting_key, key))) continue;
      const guests: string[] = m.guests ?? [];
      events.push({
        uid: "meetwatch:" + m.event_key, title: m.title || "Google Meet", start: m.starts_at, end: m.ends_at, all_day: false,
        join_url: m.meet_url, platform: "meet", meeting_key: key,
        attendees: [...(m.organizer ? [{ name: null, email: String(m.organizer).toLowerCase() }] : []), ...guests.map((g) => ({ name: null, email: String(g).toLowerCase() }))],
        text: `${m.title ?? ""} ${m.organizer ?? ""} ${guests.join(" ")}`.toLowerCase(),
      });
    }
  } catch { /* optional source */ }
  const list = events.filter((e) => e.platform && e.meeting_key && !e.all_day);
  cache.set(days, { t: Date.now(), events: list, cals: cals.length });
  return { events: list, cals: cals.length };
}

type Auth = { user_id: string; roster: string | null; name: string; admin: boolean };
async function visibleEvents(a: Auth, days: number): Promise<Ev[]> {
  const { events } = await calendarFetch(days);
  let list = events.filter((e) => Date.parse(e.end ?? e.start) > Date.now() - 15 * 60e3).sort((x, y) => x.start.localeCompare(y.start));
  if (!a.admin) {
    const { data: p } = await db.from("partners").select("name,email,roster_name").eq("user_id", a.user_id).maybeSingle();
    const name = p?.name?.toLowerCase().trim() ?? "", email = p?.email?.toLowerCase().trim() ?? "";
    const roster = p?.roster_name?.toLowerCase().trim() ?? "";
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Whole-word matches only (a first name like "eli" must not match "delivery"). Attendee emails match exactly.
    const words = [name, name.split(/\s+/)[0], roster].filter((k, i, a): k is string => !!k && k.length > 2 && a.indexOf(k) === i).map((k) => new RegExp(`(^|[^a-z0-9])${esc(k)}([^a-z0-9]|$)`));
    list = list.filter((e) => (email && e.attendees.some((x) => x.email === email)) || e.attendees.some((x) => x.name && name && x.name.toLowerCase().trim() === name) || words.some((re) => re.test(e.text)));
  }
  return list.slice(0, 50);
}
const publicEvent = (e: Ev) => ({ uid: e.uid, title: e.title, start: e.start, end: e.end, join_url: e.join_url, platform: e.platform, meeting_key: e.meeting_key, attendees: e.attendees });

// ---------- input helpers ----------
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
async function mySession(a: Auth, id: unknown) {
  const sid = str(id, 40);
  if (!UUID.test(sid)) throw new Refuse("That recording session was not found.", 404);
  const { data: s } = await db.from("scout_rec_sessions").select("*").eq("id", sid).eq("user_id", a.user_id).maybeSingle();
  if (!s) throw new Refuse("That recording session was not found.", 404);
  return s;
}
const pn = (n: number) => String(n).padStart(3, "0");

// ---------- actions ----------
async function aStart(a: Auth, b: Record<string, unknown>) {
  const url = str(b.meeting_url, 1000);
  const platform = (["meet", "zoom", "teams"].includes(str(b.platform, 10)) ? str(b.platform, 10) : platformOf(url)) as "meet" | "zoom" | "teams" | null;
  if (!platform) throw new Refuse("Scout Recorder works with Google Meet, Zoom and Microsoft Teams only.");
  const key = normKey(platform, str(b.meeting_key, 400)) ?? (url ? normKey(platform, url) : null);
  if (!key) throw new Refuse("Scout could not tell which meeting this is.");
  const evs = await visibleEvents(a, 2).catch((e) => { if (a.admin) return [] as Ev[]; throw e; });
  const uid = str(b.event_uid, 400);
  const match = evs.find((e) => e.meeting_key && sameKey(e.meeting_key, key)) ?? (a.admin && uid ? evs.find((e) => e.uid === uid) : undefined);
  if (!a.admin && !match) throw new Refuse("This meeting is not on your Bestly Cloud calendar", 403);
  const now = new Date();
  const title = (match?.title ? str(match.title, 200) : "") || `Meeting ${fmtTime(now)}`;
  const la = laStamp(now);
  const file_name = `${now.toISOString().replace(/[:.]/g, "-")}-meeting-${la.ymd} ${la.hm}.webm`;
  const storage_path = `scout-rec/${file_name}`;
  const { data: s, error } = await db.from("scout_rec_sessions").insert({
    user_id: a.user_id, roster: a.roster, is_admin: a.admin, platform, meeting_url: url || null, meeting_key: key,
    event_uid: match?.uid ?? (uid || null), title, started_at: now.toISOString(), state: "starting",
    last_beat_at: now.toISOString(), last_progress_at: now.toISOString(), storage_path, ext_version: str(b.ext_version, 40) || null,
  }).select("id").single();
  if (error || !s) throw new Error("insert session: " + error?.message);
  return { session_id: s.id, title, file_name, storage_path, part_bytes: PART_BYTES };
}

async function aNotice(a: Auth, b: Record<string, unknown>) {
  const s = await mySession(a, b.session_id);
  const now = new Date().toISOString();
  if (b.ok === true) {
    await db.from("scout_rec_sessions").update({ notice_at: now, state: s.state === "starting" ? "recording" : s.state, last_beat_at: now, updated_at: now }).eq("id", s.id);
  } else {
    await db.from("scout_rec_sessions").update({ state: "failed", error: str(b.detail, 300) || "consent notice not confirmed", updated_at: now }).eq("id", s.id);
  }
  return {};
}

async function aPartUrl(a: Auth, b: Record<string, unknown>) {
  const s = await mySession(a, b.session_id);
  if (!s.notice_at) throw new Refuse("Scout has not confirmed the recording notice for this call yet.", 409);
  if (s.state === "failed") throw new Refuse("This recording was stopped.", 409);
  const part = Math.floor(num(b.part, -1));
  if (part < 0 || part > 199) throw new Refuse("That part number is not valid.");
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(`${s.storage_path}.part${pn(part)}`, { upsert: true });
  if (error || !data?.signedUrl) throw new Error("sign: " + error?.message);
  return { url: data.signedUrl };
}

async function aBeat(a: Auth, b: Record<string, unknown>) {
  const s = await mySession(a, b.session_id);
  const now = new Date().toISOString();
  const st = str(b.state, 20);
  const partsSent = Math.max(0, Math.floor(num(b.parts_sent, s.parts_sent)));
  const progressed = partsSent > s.parts_sent || num(b.bytes, 0) > Number(s.bytes);
  const upd: Record<string, unknown> = {
    last_beat_at: now, updated_at: now, parts_sent: Math.max(partsSent, s.parts_sent), bytes: Math.max(num(b.bytes, 0), Number(s.bytes)),
    seconds: num(b.seconds, Number(s.seconds ?? 0)), captions_count: Math.max(0, Math.floor(num(b.captions_lines, s.captions_count))),
  };
  if (["recording", "uploading"].includes(st) && ["starting", "recording", "uploading", "lost"].includes(s.state) && !(st === "recording" && s.state === "starting")) upd.state = st;
  if (st === "recording" || progressed) upd.last_progress_at = now;
  let retry: number[] = s.retry_parts ?? [];
  if (retry.length) {
    const present = new Set<number>(((await db.rpc("scout_rec_parts_present", { p_path: s.storage_path })).data as number[]) ?? []);
    retry = retry.filter((p) => !present.has(p));
    upd.retry_parts = retry;
    if (!retry.length) upd.retry_marked_at = null;
  }
  if (progressed) upd.retry_marked_at = null;
  await db.from("scout_rec_sessions").update(upd).eq("id", s.id);
  return { retry_parts: retry, stop: ["failed", "uploaded", "transcribed"].includes(s.state) };
}

async function aFinish(a: Auth, b: Record<string, unknown>) {
  const s = await mySession(a, b.session_id);
  if (s.clip_id) return { clip_id: s.clip_id };
  const parts = Math.floor(num(b.parts, 0));
  if (parts < 1 || parts > 200) throw new Refuse("The recording has no parts to upload.");
  const present = ((await db.rpc("scout_rec_parts_present", { p_path: s.storage_path })).data as number[]) ?? [];
  const have = new Set(present);
  const missing: number[] = []; for (let i = 0; i < parts; i++) if (!have.has(i)) missing.push(i);
  let useParts = parts;
  if (missing.length) {
    if (b.partial === true) {
      let c = 0; while (have.has(c)) c++;
      if (c === 0) throw new Refuse("None of the recording was uploaded yet.", 409, { missing });
      useParts = c;
    } else {
      throw new Refuse("Some parts of the recording have not arrived yet.", 409, { missing });
    }
  }
  const caps = (Array.isArray(b.captions) ? b.captions : []).slice(0, 20000).map((c: Record<string, unknown>) => ({
    t: Math.round(num(c?.t, 0) * 100) / 100, speaker: str(c?.speaker, 120), text: str(c?.text, 2000),
  })).filter((c) => c.text);
  const la = laStamp(new Date(s.started_at));
  const { data: clip, error } = await db.from("voice_clips").insert({
    title: s.title, path: s.storage_path, bytes: Math.max(0, Math.floor(num(b.bytes, Number(s.bytes)))), seconds: num(b.seconds, Number(s.seconds ?? 0)) || null,
    source: "scout-rec", status: "new", parts: useParts, kind: "meeting", recorded_at: s.started_at,
    meeting_name: `meeting-${la.ymd.replace(/-/g, "")}-${la.hm}`, captions: caps,
  }).select("id").single();
  if (error || !clip) throw new Error("insert clip: " + error?.message);
  const now = new Date().toISOString();
  await db.from("scout_rec_sessions").update({
    state: "uploaded", clip_id: clip.id, parts_sent: useParts, bytes: Math.max(0, Math.floor(num(b.bytes, Number(s.bytes)))),
    seconds: num(b.seconds, Number(s.seconds ?? 0)), captions_count: caps.length, retry_parts: [], retry_marked_at: null,
    finished_at: now, last_beat_at: now, last_progress_at: now, updated_at: now,
  }).eq("id", s.id);
  return { clip_id: clip.id };
}

async function aStatus(a: Auth, b: Record<string, unknown>) {
  let q = db.from("scout_rec_sessions").select("id,title,started_at,state,clip_id").eq("user_id", a.user_id).order("started_at", { ascending: false }).limit(20);
  const ids = (Array.isArray(b.session_ids) ? b.session_ids : []).map((x) => str(x, 40)).filter((x) => UUID.test(x)).slice(0, 20);
  if (ids.length) q = q.in("id", ids);
  const { data: rows } = await q;
  const clipIds = (rows ?? []).map((r) => r.clip_id).filter(Boolean) as string[];
  const cs = new Map<string, string>();
  if (clipIds.length) for (const c of (await db.from("voice_clips").select("id,status").in("id", clipIds)).data ?? []) cs.set(c.id, c.status);
  const out = [];
  for (const r of rows ?? []) {
    const cstat = r.clip_id ? cs.get(r.clip_id) ?? null : null;
    let state = r.state;
    if (state === "uploaded" && cstat === "done") {
      state = "transcribed";
      await db.from("scout_rec_sessions").update({ state, updated_at: new Date().toISOString() }).eq("id", r.id);
    }
    out.push({ session_id: r.id, title: r.title, started_at: r.started_at, state, clip_status: cstat });
  }
  return { sessions: out };
}

async function aReport(a: Auth, b: Record<string, unknown>) {
  const sev = ["info", "warning", "error"].includes(str(b.severity, 10)) ? str(b.severity, 10) : "warning";
  const sid = str(b.session_id, 40);
  let session_id: string | null = null;
  if (UUID.test(sid)) { const s = await db.from("scout_rec_sessions").select("id").eq("id", sid).eq("user_id", a.user_id).maybeSingle(); session_id = s.data?.id ?? null; }
  const { data, error } = await db.rpc("scout_rec_report", { p_where: str(b.where, 60) || "general", p_detail: str(b.detail, 400), p_severity: sev, p_session_id: session_id });
  if (error) throw new Error("report: " + error.message);
  return { deduped: !!data?.deduped };
}

async function aSelftest() {
  const out: Record<string, unknown> = {};
  const fails: string[] = [];
  try { const { error } = await db.from("scout_rec_sessions").select("id").limit(1); out.db = !error; if (error) fails.push("database: " + error.message); } catch (e) { out.db = false; fails.push("database: " + (e as Error).message); }
  try {
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl("scout-rec/_selftest/probe", { upsert: true });
    out.storage = !!data?.signedUrl; if (!data?.signedUrl) fails.push("storage: " + (error?.message ?? "no url"));
  } catch (e) { out.storage = false; fails.push("storage: " + (e as Error).message); }
  try { const c = await calendarFetch(1); out.calendar = true; out.calendars = c.cals; } catch (e) { out.calendar = false; fails.push("calendar: " + (e as Error).message); }
  if (fails.length) throw new Refuse("Self-check failed: " + fails.join("; "), 503, out);
  return out;
}

Deno.serve(async (req) => {
  const CORS = corsFor(req);
  const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...CORS } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only." }, 405);
  try {
    let b: Record<string, unknown>;
    if (Number(req.headers.get("content-length") ?? 0) > 6_000_000) return J({ ok: false, error: "That request was too large." }, 413);
    let raw = "";
    try { raw = await req.text(); } catch { return J({ ok: false, error: "That request was not understood." }, 400); }
    if (raw.length > 6_000_000) return J({ ok: false, error: "That request was too large." }, 413);
    try { b = JSON.parse(raw); } catch { return J({ ok: false, error: "That request was not understood." }, 400); }
    const action = str(b?.action, 30);
    // worker key may only run selftest
    const wk = req.headers.get("x-worker-key");
    if (action === "selftest" && wk && (await db.rpc("partner_ai_key_ok", { p_key: wk })).data === true) return J({ ok: true, ...(await aSelftest()) });
    const key = req.headers.get("x-scout-key") ?? "";
    const { data: au } = key ? await db.rpc("partner_connector_auth", { p_key: key }) : { data: null };
    if (!au?.user_id) return J({ ok: false, error: "Scout Recorder is not connected. Open the extension and tap Connect." }, 401);
    const a: Auth = { user_id: au.user_id, roster: au.roster ?? null, name: au.name ?? "Jared", admin: !!au.admin };
    switch (action) {
      case "me": return J({ ok: true, name: a.name, role: a.admin ? "admin" : "partner", roster: a.roster });
      case "invites": {
        const days = Math.max(1, Math.min(7, Math.floor(num(b.days, 2)) || 2));
        return J({ ok: true, events: (await visibleEvents(a, days)).map(publicEvent) });
      }
      case "start": return J({ ok: true, ...(await aStart(a, b)) });
      case "notice": return J({ ok: true, ...(await aNotice(a, b)) });
      case "part_url": return J({ ok: true, ...(await aPartUrl(a, b)) });
      case "beat": return J({ ok: true, ...(await aBeat(a, b)) });
      case "finish": return J({ ok: true, ...(await aFinish(a, b)) });
      case "status": return J({ ok: true, ...(await aStatus(a, b)) });
      case "report": return J({ ok: true, ...(await aReport(a, b)) });
      case "selftest": return J({ ok: true, ...(await aSelftest()) });
      default: return J({ ok: false, error: "That request is not supported." }, 400);
    }
  } catch (e) {
    if (e instanceof Refuse) return J({ ok: false, error: e.msg, ...e.extra }, e.status);
    console.error("scout-recorder", (e as Error).message);
    return J({ ok: false, error: "Something went wrong on our side. Try again in a minute." }, 500);
  }
});
