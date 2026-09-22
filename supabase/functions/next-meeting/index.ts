// next-meeting: the next events on Jared's Nextcloud calendars (next 7 days), with a one-tap
// join link pulled from each event (Talk room, Zoom, Meet, Teams). Used by the Command Center's
// "Join next meeting" and the partner portal. Admin sees everything; a partner only sees events
// that mention them (their email or name), plus their standing call room.
// verify_jwt = false (checks the caller itself).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });
const NC = "https://cloud.bestly.tech";
const JOIN = /(https:\/\/cloud\.bestly\.tech\/(?:index\.php\/)?call\/[a-z0-9]+|https:\/\/[\w.-]*zoom\.us\/j\/[^\s"<>\\]+|https:\/\/meet\.google\.com\/[a-z-]+|https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>\\]+)/i;

type Ev = { title: string; start: string; end: string | null; all_day: boolean; join_url: string | null; location: string | null; calendar: string; text: string };

function unfold(ics: string) { return ics.replace(/\r?\n[ \t]/g, ""); }
function icsDate(v: string, params: string): { iso: string; allDay: boolean } {
  // 20260923T170000Z | 20260923T100000 (TZID) | 20260923 (all day). Server-side expand returns UTC.
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return { iso: v, allDay: false };
  if (!m[4]) return { iso: `${m[1]}-${m[2]}-${m[3]}T00:00:00-07:00`, allDay: true };
  const base = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7]) return { iso: base + "Z", allDay: false };
  // Floating/TZID time: treat as LA time (Jared's calendars are LA).
  return { iso: base + (params.includes("TZID") ? "-07:00" : "-07:00"), allDay: false };
}
function parse(ics: string, calendar: string): Ev[] {
  const out: Ev[] = [];
  for (const block of unfold(ics).split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const get = (k: string) => {
      const line = body.split(/\r?\n/).find((l) => l.startsWith(k + ":") || l.startsWith(k + ";"));
      if (!line) return null;
      const i = line.indexOf(":");
      return { params: line.slice(0, i), value: line.slice(i + 1).replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\;/g, ";") };
    };
    const st = get("DTSTART"); if (!st) continue;
    if ((get("STATUS")?.value ?? "") === "CANCELLED") continue;
    const en = get("DTEND");
    const s = icsDate(st.value, st.params), e = en ? icsDate(en.value, en.params) : null;
    const loc = get("LOCATION")?.value ?? null, desc = get("DESCRIPTION")?.value ?? "", url = get("URL")?.value ?? "";
    const attendees = body.split(/\r?\n/).filter((l) => l.startsWith("ATTENDEE") || l.startsWith("ORGANIZER")).join(" ");
    out.push({ title: get("SUMMARY")?.value ?? "(no title)", start: s.iso, end: e?.iso ?? null, all_day: s.allDay,
      join_url: (`${loc ?? ""} ${url} ${desc}`.match(JOIN)?.[1]) ?? null, location: loc, calendar, text: `${get("SUMMARY")?.value ?? ""} ${desc} ${attendees}`.toLowerCase() });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // The Mac mini worker key also works (acts as the admin): lets Scout and health checks read the calendar.
  const wk = req.headers.get("x-worker-key");
  const viaWorker = !!wk && !!(await svc.rpc("partner_ai_key_ok", { p_key: wk })).data;
  let isAdmin = viaWorker, partner: { name: string; email: string; roster_name: string; call_url: string | null } | null = null;
  if (!viaWorker) {
    const me = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await me.auth.getUser();
    if (!u?.user) return J({ ok: false, error: "unauthorized" }, 401);
    const [{ data: a }, { data: p }] = await Promise.all([
      svc.rpc("has_role", { _user_id: u.user.id, _role: "admin" }),
      svc.from("partners").select("name, email, roster_name, call_url").eq("user_id", u.user.id).maybeSingle(),
    ]);
    isAdmin = !!a; partner = p as typeof partner;
  }
  if (!isAdmin && !partner) return J({ ok: false, error: "forbidden" }, 403);

  const { data: cred } = await svc.rpc("get_nextcloud_credentials");
  const row = Array.isArray(cred) ? cred[0] : cred;
  const user = row?.username || "jared", pass = row?.app_password;
  if (!pass) return J({ ok: false, error: "no Nextcloud credential", events: [], call_url: partner?.call_url ?? null });
  const basic = "Basic " + btoa(`${user}:${pass}`);

  // 1. calendars
  const home = `${NC}/remote.php/dav/calendars/${encodeURIComponent(user)}/`;
  const pf = await fetch(home, { method: "PROPFIND", headers: { Authorization: basic, Depth: "1", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>` });
  const xml = await pf.text();
  const cals = [...xml.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)].map((m) => m[1])
    .filter((r) => /<cal:calendar\s*\/>|calendar\/>/.test(r) && !/inbox|outbox|trashbin/.test(r))
    .map((r) => ({ href: r.match(/<d:href>([^<]+)<\/d:href>/)?.[1] ?? "", name: r.match(/<d:displayname>([^<]*)<\/d:displayname>/)?.[1] ?? "Calendar" }))
    .filter((c) => c.href && c.href !== new URL(home).pathname);

  // 2. events in the next 7 days, recurrences expanded by the server
  const now = new Date(), end = new Date(Date.now() + 7 * 864e5);
  const z = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const report = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand start="${z(now)}" end="${z(end)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${z(now)}" end="${z(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const events: Ev[] = [];
  await Promise.all(cals.map(async (c) => {
    const r = await fetch(NC + c.href, { method: "REPORT", headers: { Authorization: basic, Depth: "1", "Content-Type": "application/xml" }, body: report });
    if (!r.ok) return;
    const t = await r.text();
    for (const m of t.matchAll(/<cal:calendar-data[^>]*>([\s\S]*?)<\/cal:calendar-data>/g)) {
      const ics = m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#13;/g, "");
      events.push(...parse(ics, c.name));
    }
  }));

  let list = events.filter((e) => Date.parse(e.end ?? e.start) > Date.now() - 15 * 60e3).sort((a, b) => a.start.localeCompare(b.start));
  if (!isAdmin && partner) {
    // Match on anything that identifies him in the event: the address he was invited at,
    // his full name, either half of it, and his roster handle. A call he is on shows up
    // whether Jared invited "Eli", "Eli Cooper" or eli.cooper@bdcuniversal.com.
    const name = partner.name?.toLowerCase().trim() ?? "";
    const email = partner.email?.toLowerCase() ?? "";
    const keys = [
      email,
      email.split("@")[0],
      name,
      ...name.split(/\s+/),
      partner.roster_name?.toLowerCase(),
    ].filter((k): k is string => !!k && k.length > 2);
    list = list.filter((e) => keys.some((k) => e.text.includes(k)));
  }
  const clean = list.slice(0, 12).map(({ text: _t, ...e }) => e);
  const next = clean.find((e) => !e.all_day) ?? null;
  return J({ ok: true, events: clean, next, call_url: partner?.call_url ?? null, calendars: cals.length });
});
