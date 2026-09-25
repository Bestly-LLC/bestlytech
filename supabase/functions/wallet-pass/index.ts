// wallet-pass — Apple Wallet pass for the Turo LAX parking code (bestly.tech/lax/<slug>).
//
//   GET  /wallet-pass?slug=<slug>                → signed .pkpass (this month's Park My Share QR)
//   POST {"op":"push"} (service role)            → APNs "refresh" to every saved pass
//   POST {"op":"decode","png":b64} (admin JWT)   → read the QR out of a screenshot (admin page fallback)
//   GET  /wallet-pass?t=<guest token>            → the same pass, personalized for one Turo trip (name, times, reminders)
//   GET  /wallet-pass/qr.png?slug=|t=            → the current QR as a PNG (used in reminder emails)
//   POST {"op":"remind_due"} (service role)      → send due guest reminder emails from support@bestly.tech
//   GET  /wallet-pass/google?slug=<slug>         → 302 to "Save to Google Wallet" (Generic pass), when Google creds exist
//   Apple Wallet web service (PassKit):
//   POST|DELETE /v1/devices/:dev/registrations/:type/:serial
//   GET  /v1/devices/:dev/registrations/:type?passesUpdatedSince=
//   GET  /v1/passes/:type/:serial
//   POST /v1/log
//
// Secrets: Vault lax_pass_cert_pem / lax_pass_key_pem / lax_pass_auth_token via lax_pass_secrets() (service role).
// Copy rule: the QR opens the LOBBY door (never say garage door).
// One pass serial for everyone; its contents follow the newest code, so saved passes update in place.
import { createClient } from "npm:@supabase/supabase-js@2";
import forge from "npm:node-forge@1.3.1";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import { WWDR_G4_PEM } from "./wwdr.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_PUBLISHABLE: string = __keys("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const PASS_TYPE = "pass.tech.bestly.lax";
const TEAM = "PV65ABS5W9";
const SERIAL = "lax-parking";
const HOST_SERIAL = "host-lax"; // Jared's own pass: new art, no guest info, same lock-screen locations
const FN_URL = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/wallet-pass";
const SITE = "https://www.bestly.tech";
// Guest-facing links stay short (rule): bestly.tech/t/<7 chars> and bestly.tech/w/<7 chars> (Vercel rewrite to this function).
const SHORT = "https://bestly.tech";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const empty = (status: number) => new Response(null, { status, headers: cors });

type Secrets = { lax_pass_cert_pem: string; lax_pass_key_pem: string; lax_pass_auth_token: string };
let secretsCache: Secrets | null = null;
async function secrets(): Promise<Secrets> {
  if (secretsCache) return secretsCache;
  const { data, error } = await sb.rpc("lax_pass_secrets");
  if (error || !data) throw new Error("secrets unavailable: " + (error?.message ?? "empty"));
  secretsCache = data as Secrets;
  return secretsCache;
}

type Code = { id: string; payload: string; valid_month: string; note: string | null; created_at: string };
async function currentCode(): Promise<Code | null> {
  const { data } = await sb.rpc("lax_pass_current_row");
  const row = data as Code | null;
  return row && row.id ? row : null;
}

type Trip = { reservation_id: number; first: string | null; starts_at: string; ends_at: string; token?: string };
const isTripSerial = (s: string) => /^trip-\d+$/.test(s);
const knownSerial = (s: string) => s === SERIAL || s === HOST_SERIAL || isTripSerial(s);
// Host demo pages (/t/demo-lax, /t/demo-home): a real, signed pass for an example trip with a demo QR
// that does NOT open the lobby door. reservation_id 0 marks it.
const isDemoToken = (t: string | null) => !!t && /^demo-(home|lax)$/.test(t);
function demoTrip(t: string): Trip {
  const s = Date.now() + 30 * 60e3;
  return { reservation_id: 0, first: "Demo", starts_at: new Date(s).toISOString(), ends_at: new Date(s + 72 * 3600e3).toISOString(), token: t };
}
async function demoCode(): Promise<Code> {
  const cur = await currentCode().catch(() => null);
  return { id: "demo", payload: "BESTLY-DEMO-QR", valid_month: cur?.valid_month ?? laMonthNow(), note: "Demo pass. This QR code won't open the lobby door.", created_at: new Date().toISOString() };
}
async function tripByToken(t: string): Promise<Trip | null> {
  if (isDemoToken(t)) return demoTrip(t);
  const { data } = await sb.rpc("lax_guest_trip", { p_token: t });
  return (data as Trip) ?? null;
}
async function tripByRes(id: number): Promise<Trip | null> {
  const { data } = await sb.rpc("lax_guest_trip_by_res", { p_res: id });
  return (data as Trip) ?? null;
}
async function codeFor(trip: Trip | null): Promise<Code | null> {
  if (!trip) return await currentCode();
  if (trip.reservation_id === 0) return await demoCode();
  const { data } = await sb.rpc("lax_code_for", { p_at: trip.starts_at });
  const row = data as Code | null;
  return row && row.id ? row : await currentCode();
}
const LA = "America/Los_Angeles";
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: LA });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: LA });
const fmtShort = (iso: string) => `${new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: LA })}, ${fmtTime(iso)}`;
const fmtDow = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: LA });

async function log(kind: string, detail: unknown) {
  await sb.from("lax_pass_log").insert({ kind, detail });
}

// ---------- dates (LA) ----------
function monthEnd(validMonth: string) {
  const [y, m] = validMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)); // last day of that month (UTC date)
}
function laMonthNow() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}-01`;
}
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// ---------- pass ----------
type Guide = { garage?: string; level?: string; spot?: string; shuttle?: string; after_hours?: string; car?: string; shuttle_stop?: string; lat?: number; lng?: number };
type Settings = { slug: string; guide: Guide; updated_at: string };
async function settings(): Promise<Settings> {
  const { data } = await sb.from("lax_pass_settings").select("slug, guide, updated_at").eq("id", 1).single();
  return (data ?? { slug: "", guide: {}, updated_at: new Date(0).toISOString() }) as Settings;
}
// A pass changes when the code OR the guide changes.
const modifiedAt = (code: Code, st: Settings) => new Date(Math.max(new Date(code.created_at).getTime(), new Date(st.updated_at).getTime()));

function passJson(code: Code, token: string, st: Settings, trip: Trip | null = null) {
  const page = trip?.token ? `${SHORT}/t/${trip.token}` : `${SHORT}/lax/${st.slug}`;
  const g = st.guide ?? {};
  const level = g.level || "P3";
  const shuttle = g.shuttle || "The Parking Spot — Century";
  const stop = g.shuttle_stop || "5701 W Century Blvd";
  const garage = g.garage || "5730 W 98th St, LA 90045";
  const end = monthEnd(code.valid_month);
  const isCurrent = code.valid_month === laMonthNow();
  // End of the month in LA (11:59 PM PT ≈ 07:59 UTC next day). If the code is last month's (not refreshed yet),
  // don't ship an already-expired pass; give it two days and let the monthly update replace it.
  let expires = isCurrent
    ? new Date(end.getTime() + 31 * 3600 * 1000)
    : new Date(Date.now() + 2 * 86400 * 1000);
  // A guest's pass lives until their trip is over; a new month's code arrives by push.
  if (trip) expires = new Date(Math.max(expires.getTime(), new Date(trip.ends_at).getTime() + 86400 * 1000));
  const monthName = new Date(code.valid_month + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const back = [
    { key: "how", label: "PICKUP · ABOUT 20 MIN FROM WHEELS-DOWN", value:
      `1. Go up to Level 2 (Departures) and step outside. Yes, departures: that's where off-airport shuttles board.\n` +
      `2. Find the red "Hotel & Private Parking Shuttles" sign on the curb.\n` +
      `3. Board ${shuttle} (yellow shuttle with black spots), every 15–20 min. Tell the driver you're a Park My Share / Turo guest headed to ${g.garage || "5730 W 98th St"}. Not the Sepulveda shuttle — different lot.\n` +
      `4. ~5 min ride. At drop-off, follow the Park My Share signs across the alley to the garage.\n` +
      `5. Scan this QR at the lobby door and take the elevator to ${level}. ${level} only. If it won't scan, use the intercom by the door.` },
    { key: "ret", label: "RETURN · DROP THE CAR → CATCH THE SHUTTLE", value:
      `1. Drive to ${garage.split(",")[0]} and take the car share return lane on 98th St. After 10 PM: use the alley return lane between Century Blvd and 98th St instead.\n` +
      `2. Park on ${level}, designated carshare area only. Do NOT return to The Parking Spot Century at ${stop.replace(/ Blvd$/, "")}: your car won't have access there and you may be charged an improper-return fee.\n` +
      `3. Elevator down, exit onto 98th St, and follow the Park My Share signs.\n` +
      `4. Catch ${shuttle} at ${stop} back to LAX. Allow at least 1 hour before your terminal arrival for return + shuttle + TSA.` },
    ...(g.spot ? [{ key: "spot", label: "YOUR SPACE", value: `${level} · ${g.spot}` }] : []),
    ...(trip ? [{ key: "trip", label: "YOUR TRIP", value: `Pickup ${fmtWhen(trip.starts_at)}\nReturn ${fmtWhen(trip.ends_at)}\nCar: ${g.car || "Tesla Model 3"}` }] : []),
    { key: "garage", label: "GARAGE", value: garage },
    ...(g.after_hours ? [{ key: "late_back", label: "10 PM – 6 AM SHUTTLE", value: `Call to request a pickup (either direction): ${g.after_hours}` }] : []),
    ...(code.note ? [{ key: "note", label: "FROM YOUR HOST", value: code.note }] : []),
    { key: "valid", label: "GOOD FOR", value: `${monthName} (through ${fmtDay(end)})` },
    { key: "help", label: "QUESTIONS", value: "Message your host in the Turo app." },
    { key: "link", label: "OPEN IN BROWSER", value: page, attributedValue: `<a href="${page}">Open the parking page</a>` },
  ];
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE,
    serialNumber: trip ? `trip-${trip.reservation_id}` : SERIAL,
    teamIdentifier: TEAM,
    ...(trip ? {
      relevantDate: trip.starts_at,
      relevantDates: [{ startDate: new Date(new Date(trip.starts_at).getTime() - 3 * 3600 * 1000).toISOString(), endDate: new Date(new Date(trip.starts_at).getTime() + 2 * 3600 * 1000).toISOString() }],
    } : {}),
    organizationName: "LAX - Turo Rental",
    description: "Turo rental car: LAX lobby door pass",
    logoText: "LAX - Turo Rental",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(255, 184, 120)",
    backgroundColor: "rgb(43, 26, 115)",
    webServiceURL: FN_URL,
    authenticationToken: token,
    expirationDate: expires.toISOString(),
    barcodes: [{ format: "PKBarcodeFormatQR", message: code.payload, messageEncoding: "iso-8859-1", altText: "Scan at the lobby door" }],
    barcode: { format: "PKBarcodeFormatQR", message: code.payload, messageEncoding: "iso-8859-1", altText: "Scan at the lobby door" },
    // Lock-screen suggestions: at the LAX terminals (where the trip starts) and at the lobby door.
    locations: [
      { latitude: 33.9434, longitude: -118.4085, relevantText: "Landed? Go up to Level 2 (Departures) for the Parking Spot Century shuttle." },
      ...(g.lat && g.lng ? [{ latitude: g.lat, longitude: g.lng, relevantText: `Scan your QR at the lobby door, then take the elevator to ${level}.` }] : []),
    ],
    eventTicket: {
      // No header fields: they share the top row with the logo and squeezed "LAX Parking" to "LAX P...".
      // No primary field: the big text sat on top of the LAX art. "Park My Share" goes small, in the row below.
      primaryFields: [],
      secondaryFields: trip ? [
        { key: "pickup", label: trip.first ? `${trip.first.toUpperCase()}'S PICKUP` : "PICKUP", value: fmtShort(trip.starts_at) },
        { key: "return", label: "RETURN", value: fmtShort(trip.ends_at) },
      ] : [
        { key: "garage_short", label: "GARAGE", value: "Park My Share" },
        { key: "level", label: "LEVEL", value: g.spot ? `${level} · ${g.spot}` : `${level} only` },
      ],
      auxiliaryFields: trip ? [
        { key: "garage_short", label: "GARAGE", value: "Park My Share" },
        { key: "level", label: "LEVEL", value: g.spot ? `${level} · ${g.spot}` : level },
        { key: "shuttle", label: "SHUTTLE", value: "Parking Spot Century" },
      ] : [
        { key: "shuttle", label: "SHUTTLE", value: shuttle.replace(/^The Parking Spot\s*[—-]\s*/i, "Parking Spot ") },
        { key: "thru", label: "GOOD THRU", value: fmtDay(end) },
        ...(g.after_hours ? [{ key: "late", label: "AFTER HOURS", value: g.after_hours }] : []),
      ],
      backFields: back,
    },
  };
}

// Jared's own pass: blue-hour art, no guest info, same QR + lock-screen locations. Updates itself monthly by push.
function hostPassJson(code: Code, token: string, st: Settings) {
  const g = st.guide ?? {};
  const level = g.level || "P3";
  const garage = g.garage || "5730 W 98th St, LA 90045";
  const stop = g.shuttle_stop || "5701 W Century Blvd";
  const end = monthEnd(code.valid_month);
  const isCurrent = code.valid_month === laMonthNow();
  const monthName = new Date(code.valid_month + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const guestLink = `${SHORT}/lax/${st.slug}`;
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE,
    serialNumber: HOST_SERIAL,
    teamIdentifier: TEAM,
    organizationName: "Park My Share LAX",
    description: "Lobby door pass, Park My Share LAX",
    logoText: "LAX · Host",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(0, 229, 255)",
    backgroundColor: "rgb(3, 8, 30)",
    webServiceURL: FN_URL,
    authenticationToken: token,
    // Never expires: the 1st-of-month code arrives by push. Voided look only if the code is stale.
    barcodes: [{ format: "PKBarcodeFormatQR", message: code.payload, messageEncoding: "iso-8859-1", altText: "Scan at the lobby door" }],
    barcode: { format: "PKBarcodeFormatQR", message: code.payload, messageEncoding: "iso-8859-1", altText: "Scan at the lobby door" },
    locations: [
      { latitude: 33.9434, longitude: -118.4085, relevantText: "At LAX. Your lobby door pass is ready." },
      ...(g.lat && g.lng ? [{ latitude: g.lat, longitude: g.lng, relevantText: `Scan at the lobby door. Level ${level}.` }] : []),
    ],
    eventTicket: {
      primaryFields: [],
      secondaryFields: [
        { key: "garage_short", label: "GARAGE", value: "Park My Share" },
        { key: "month", label: isCurrent ? "THIS MONTH" : "OLD CODE", value: isCurrent ? monthName : "Needs update", changeMessage: "New month's code: %@" },
      ],
      auxiliaryFields: [
        { key: "level", label: "LEVEL", value: level },
        { key: "thru", label: "GOOD THRU", value: fmtDay(end) },
      ],
      backFields: [
        { key: "garage", label: "GARAGE", value: garage },
        { key: "in", label: "DRIVING IN", value: `Car share return lane on 98th St. After 10 PM: alley lane between Century Blvd and 98th St. Park on ${level}, carshare area only. Not The Parking Spot Century at ${stop.replace(/ Blvd$/, "")}.` },
        { key: "guest", label: "GUEST LINK (FOR TURO)", value: guestLink, attributedValue: `<a href="${guestLink}">${guestLink.replace("https://", "")}</a>` },
        { key: "admin", label: "UPDATE THE CODE", value: `${SITE}/admin/turo/lax-pass`, attributedValue: `<a href="${SITE}/admin/turo/lax-pass">Open the admin page</a>` },
      ],
    },
  };
}

// Pass art lives in the site repo (public/wallet/lax); fetched once per instance.
const IMG_NAMES = ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "logo@3x.png", "strip.png", "strip@2x.png", "strip@3x.png"];
let imgCache: Record<string, Uint8Array> | null = null;
async function images() {
  if (imgCache) return imgCache;
  const out: Record<string, Uint8Array> = {};
  for (const n of IMG_NAMES) {
    let r = await fetch(`${SITE}/wallet/lax/${n}`);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("image")) r = await fetch(`https://raw.githubusercontent.com/Bestly-LLC/bestlytech/main/public/wallet/lax/${n}`);
    if (!r.ok) throw new Error(`image ${n}: ${r.status}`);
    out[n] = new Uint8Array(await r.arrayBuffer());
  }
  imgCache = out;
  return out;
}

// Host pass swaps only the strip art (public/wallet/lax/host).
let hostCache: Record<string, Uint8Array> | null = null;
async function hostStrips() {
  if (hostCache) return hostCache;
  const out: Record<string, Uint8Array> = {};
  for (const n of ["strip.png", "strip@2x.png", "strip@3x.png"]) {
    let r = await fetch(`${SITE}/wallet/lax/host/${n}`);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("image")) r = await fetch(`https://raw.githubusercontent.com/Bestly-LLC/bestlytech/main/public/wallet/lax/host/${n}`);
    if (!r.ok) throw new Error(`host image ${n}: ${r.status}`);
    out[n] = new Uint8Array(await r.arrayBuffer());
  }
  hostCache = out;
  return out;
}

async function sha1hex(u8: Uint8Array) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", u8));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function buildPkpass(code: Code, trip: Trip | null = null, host = false): Promise<Uint8Array> {
  const s = await secrets();
  const st = await settings();
  const files: Record<string, Uint8Array> = { "pass.json": strToU8(JSON.stringify(host ? hostPassJson(code, s.lax_pass_auth_token, st) : passJson(code, s.lax_pass_auth_token, st, trip))) };
  Object.assign(files, await images());
  if (host) Object.assign(files, await hostStrips());
  const manifest: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) manifest[name] = await sha1hex(bytes);
  const manifestBytes = strToU8(JSON.stringify(manifest));

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(forge.util.binary.raw.encode(manifestBytes));
  const cert = forge.pki.certificateFromPem(s.lax_pass_cert_pem);
  p7.addCertificate(cert);
  p7.addCertificate(forge.pki.certificateFromPem(WWDR_G4_PEM));
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(s.lax_pass_key_pem),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const sig = Uint8Array.from(der, (c: string) => c.charCodeAt(0));

  return zipSync({ ...files, "manifest.json": manifestBytes, signature: sig }, { level: 6 });
}

async function passResponse(code: Code, download: boolean, trip: Trip | null = null, host = false) {
  const bytes = await buildPkpass(code, trip, host);
  const lm = modifiedAt(code, await settings());
  return new Response(bytes, {
    headers: {
      ...cors,
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="LAX-parking.pkpass"`,
      "Last-Modified": lm.toUTCString(),
      "Cache-Control": "no-store",
    },
  });
}

// ---------- APNs (pass updates) ----------
async function pushAll() {
  const { data: regs } = await sb.from("lax_pass_registrations").select("push_token").eq("pass_type", PASS_TYPE);
  const tokens = [...new Set((regs ?? []).map((r: { push_token: string }) => r.push_token))];
  if (!tokens.length) { await log("push", { devices: 0 }); return { devices: 0, sent: 0, failed: 0 }; }
  const s = await secrets();
  // deno-lint-ignore no-explicit-any
  const client = (Deno as any).createHttpClient({ cert: s.lax_pass_cert_pem, key: s.lax_pass_key_pem, http2: true, http1: false });
  let sent = 0, failed = 0; const errors: string[] = [];
  for (const t of tokens) {
    try {
      const r = await fetch(`https://api.push.apple.com/3/device/${t}`, {
        method: "POST", body: "{}", headers: { "apns-topic": PASS_TYPE, "apns-push-type": "background", "apns-priority": "5" },
        // deno-lint-ignore no-explicit-any
        client,
      } as any);
      if (r.status === 200) sent++;
      else {
        const txt = (await r.text()).slice(0, 120);
        failed++; errors.push(`${r.status} ${txt}`);
        // Phone removed the pass / token no longer valid: forget it.
        if (r.status === 410 || txt.includes("BadDeviceToken")) await sb.from("lax_pass_registrations").delete().eq("push_token", t);
      }
    } catch (e) { failed++; errors.push(String(e).slice(0, 160)); }
  }
  const out = { devices: tokens.length, sent, failed, errors: errors.slice(0, 5) };
  await log("push", out);
  return out;
}

// ---------- QR decode (admin page fallback when the browser has no BarcodeDetector) ----------
async function isAdmin(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const c = createClient(Deno.env.get("SUPABASE_URL")!, SB_PUBLISHABLE, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { error } = await c.rpc("lax_pass_admin_state");
  return !error;
}
// The admin page always sends a PNG it drew on a canvas (<=1600px). Pure-JS decoders only, loaded lazily,
// so nothing native can take the whole function down (imagescript did: "unsupported arch/platform").
async function decodeQr(b64: string): Promise<string | null> {
  const [{ decode }, { default: jsQR }] = await Promise.all([import("npm:fast-png@6.2.0"), import("npm:jsqr@1.4.0")]);
  const png = decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  const { width, height, channels } = png;
  const src = png.data as Uint8Array;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const gray = channels < 3;
    rgba[i * 4] = src[j]; rgba[i * 4 + 1] = gray ? src[j] : src[j + 1]; rgba[i * 4 + 2] = gray ? src[j] : src[j + 2];
    rgba[i * 4 + 3] = channels === 4 ? src[j + 3] : channels === 2 ? src[j + 1] : 255;
  }
  const r = jsQR(rgba, width, height, { inversionAttempts: "attemptBoth" });
  return r?.data ?? null;
}

// ---------- Google Wallet (Android) ----------
// Vault: gw_service_account (JSON key of a service account added as a user on the Wallet issuer), gw_issuer_id.
type GCreds = { sa: { client_email: string; private_key: string }; issuer: string };
let gCache: GCreds | null | undefined;
async function gcreds(): Promise<GCreds | null> {
  if (gCache !== undefined) return gCache;
  const { data } = await sb.rpc("lax_pass_google_secrets");
  const d = data as { gw_service_account?: string; gw_issuer_id?: string } | null;
  gCache = d?.gw_service_account && d?.gw_issuer_id ? { sa: JSON.parse(d.gw_service_account), issuer: String(d.gw_issuer_id).trim() } : null;
  return gCache;
}
const b64url = (u8: Uint8Array) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));
async function signJwt(payload: Record<string, unknown>, pem: string) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64urlStr(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head)));
  return head + "." + b64url(sig);
}
function googleObject(id: string, classId: string, code: Code, st: Settings, trip: Trip | null = null) {
  const g = st.guide ?? {};
  const level = g.level || "P3";
  const shuttle = g.shuttle || "The Parking Spot — Century";
  const stop = g.shuttle_stop || "5701 W Century Blvd";
  const garage = g.garage || "5730 W 98th St, LA 90045";
  const end = monthEnd(code.valid_month);
  const page = trip?.token ? `${SHORT}/t/${trip.token}` : `${SHORT}/lax/${st.slug}`;
  return {
    id, classId, state: "ACTIVE",
    cardTitle: { defaultValue: { language: "en-US", value: "LAX - Turo Rental" } },
    header: { defaultValue: { language: "en-US", value: "Park My Share" } },
    subheader: { defaultValue: { language: "en-US", value: g.spot ? `Level ${level} · Space ${g.spot}` : `Level ${level} only` } },
    hexBackgroundColor: "#2B1A73",
    logo: { sourceUri: { uri: `${SITE}/wallet/lax/app-icon-512.png` }, contentDescription: { defaultValue: { language: "en-US", value: "LAX parking" } } },
    heroImage: { sourceUri: { uri: `${SITE}/wallet/lax/hero.png` }, contentDescription: { defaultValue: { language: "en-US", value: "LA sunset over LAX" } } },
    barcode: { type: "QR_CODE", value: code.payload, alternateText: "Scan at the lobby door" },
    validTimeInterval: { end: { date: new Date(end.getTime() + 31 * 3600 * 1000).toISOString() } },
    textModulesData: [
      ...(trip ? [{ id: "trip", header: trip.first ? `Hi ${trip.first}` : "Your trip", body: `Pickup ${fmtWhen(trip.starts_at)}\nReturn ${fmtWhen(trip.ends_at)}` }] : []),
      { id: "car", header: "Your car", body: g.car || "Tesla Model 3" },
      { id: "garage", header: "Garage", body: garage },
      { id: "pickup", header: "Pickup · plane → shuttle → garage", body:
        `1. Go up to Level 2 (Departures) and step outside.\n2. Find the red "Hotel & Private Parking Shuttles" sign.\n3. Board ${shuttle} (yellow, black spots). Not the Sepulveda shuttle.\n4. ~5 min ride; follow the Park My Share signs across the alley.\n5. Scan this QR at the lobby door, elevator to ${level}. ${level} only; intercom if it won't scan.` },
      { id: "return", header: "Return · drop the car → catch the shuttle", body:
        `1. Drive to ${garage.split(",")[0]}, car share return lane on 98th St (after 10 PM: alley lane between Century Blvd and 98th St).\n2. Park on ${level}, carshare area only. NOT The Parking Spot Century at ${stop.replace(/ Blvd$/, "")}.\n3. Elevator down, exit onto 98th St.\n4. Catch ${shuttle} at ${stop}. Allow 1 hour before your terminal arrival.` },
      ...(code.note ? [{ id: "note", header: "From your host", body: code.note }] : []),
    ],
    linksModuleData: { uris: [
      { uri: page, description: "Open the full guide", id: "page" },
      ...(g.after_hours ? [{ uri: `tel:+1${g.after_hours.replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "")}`, description: `Shuttle 10 PM – 6 AM: ${g.after_hours}`, id: "tel" }] : []),
      { uri: `https://maps.google.com/?q=${encodeURIComponent(garage)}`, description: "Directions to the garage", id: "map" },
    ] },
  };
}
async function googleSaveUrl(code: Code, st: Settings, trip: Trip | null = null) {
  const c = await gcreds();
  if (!c) return null;
  const classId = `${c.issuer}.lax_parking`;
  const objectId = `${c.issuer}.lax_${crypto.randomUUID().replace(/-/g, "")}`;
  await sb.from("lax_pass_google_objects").insert({ object_id: objectId });
  const jwt = await signJwt({
    iss: c.sa.client_email, aud: "google", typ: "savetowallet", origins: [SITE], iat: Math.floor(Date.now() / 1000),
    payload: {
      genericClasses: [{ id: classId }],
      genericObjects: [googleObject(objectId, classId, code, st, trip)],
    },
  }, c.sa.private_key);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
async function googleToken(c: GCreds) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({ iss: c.sa.client_email, scope: "https://www.googleapis.com/auth/wallet_object.issuer", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }, c.sa.private_key);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${assertion}` });
  const j = await r.json();
  if (!j.access_token) throw new Error("google token: " + JSON.stringify(j).slice(0, 200));
  return j.access_token as string;
}
// New code or guide: rewrite every Google pass we've handed out (those never saved just 404).
async function googleUpdateAll() {
  const c = await gcreds();
  if (!c) return { google: "not configured" };
  const code = await currentCode(); if (!code) return { google: "no code" };
  const st = await settings();
  const token = await googleToken(c);
  const { data: rows } = await sb.from("lax_pass_google_objects").select("object_id").gte("created_at", new Date(Date.now() - 120 * 86400 * 1000).toISOString());
  let updated = 0, missing = 0, failed = 0;
  for (const { object_id } of (rows ?? []) as { object_id: string }[]) {
    const body = googleObject(object_id, `${c.issuer}.lax_parking`, code, st);
    const r = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(object_id)}`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) updated++; else if (r.status === 404) missing++; else failed++;
    await r.body?.cancel();
  }
  const out = { google_updated: updated, google_unsaved: missing, google_failed: failed };
  await log("google_push", out);
  return out;
}

// ---------- Guest reminder emails (from support@bestly.tech via Resend) ----------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
async function pickupWeather(at: string): Promise<string | null> {
  try {
    const r = await fetch(`https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/weatherkit-proxy?lat=33.9470&lon=-118.3816&dataSets=forecastHourly`);
    if (!r.ok) return null;
    const j = await r.json();
    const hours = (j.forecastHourly?.hours ?? []) as { forecastStart: string; temperature: number; conditionCode: string; precipitationChance: number }[];
    const target = new Date(at).getTime();
    const h = hours.reduce<typeof hours[0] | null>((best, x) => (!best || Math.abs(new Date(x.forecastStart).getTime() - target) < Math.abs(new Date(best.forecastStart).getTime() - target) ? x : best), null);
    if (!h || Math.abs(new Date(h.forecastStart).getTime() - target) > 2 * 3600 * 1000) return null;
    const f = Math.round(h.temperature * 9 / 5 + 32);
    const cond = h.conditionCode.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const rain = h.precipitationChance >= 0.3 ? `, ${Math.round(h.precipitationChance * 100)}% chance of rain` : "";
    return `${f}°F and ${cond}${rain} around pickup`;
  } catch { return null; }
}
function reminderEmail(trip: Trip & { token: string }, st: Settings, weather: string | null) {
  const g = st.guide ?? {};
  const level = g.level || "P3";
  const car = g.car || "Tesla Model 3";
  const garage = g.garage || "5730 W 98th St, LA 90045";
  const page = `${SHORT}/t/${trip.token}`;
  const passUrl = `${SHORT}/w/${trip.token}`;
  const qr = `${FN_URL}/qr.png?t=${trip.token}`;
  const name = trip.first ? esc(trip.first) : "there";
  const laDay = (d: Date) => d.toLocaleDateString("en-US", { timeZone: LA });
  const sameDay = laDay(new Date(trip.starts_at)) === laDay(new Date());
  const pickupWhen = sameDay ? `today at ${fmtTime(trip.starts_at)}` : fmtWhen(trip.starts_at);
  // Lead with Turo + the car, not the airport: that's what the guest recognizes.
  const subject = `Your Turo car is ready: ${car} pickup ${pickupWhen}`;
  const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#6b6480;font-size:14px;width:92px;vertical-align:top">${k}</td><td style="padding:6px 0;color:#1A1140;font-size:15px;font-weight:600">${v}</td></tr>`;
  const step = (n: number, html: string) => `<tr><td style="vertical-align:top;padding:0 12px 14px 0"><div style="width:28px;height:28px;border-radius:14px;background:#2B1A73;color:#fff;font-weight:700;font-size:14px;line-height:28px;text-align:center">${n}</div></td><td style="padding:3px 0 14px;color:#1A1140;font-size:16px;line-height:1.45">${html}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F4F1FB;font-family:-apple-system,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff">
<img src="${SITE}/wallet/lax/hero.png" width="560" alt="" style="display:block;width:100%;height:auto">
<div style="padding:24px 22px 8px">
<p style="margin:0;color:#7A2E9E;font-size:12px;letter-spacing:2px;font-weight:700">LAX · TURO RENTAL</p>
<h1 style="margin:6px 0 10px;font-size:26px;line-height:1.2;color:#1A1140">Hi ${name}, your Turo car is ready.</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#3d3654">You rented a <b>${esc(car)}</b> on Turo. It's parked in a garage <b>5 minutes from LAX</b>. This email shows you how to get there, and has the <b>QR code that opens the lobby door</b>.</p>
<img src="${SITE}/wallet/lax/car.jpg" width="516" alt="Your ${esc(car)}" style="display:block;width:100%;height:auto;border-radius:14px">
<table role="presentation" style="width:100%;margin:14px 0 6px;border-collapse:collapse">
${row("Car", esc(car))}
${row("Pick up", esc(fmtWhen(trip.starts_at)))}
${row("Return", esc(fmtWhen(trip.ends_at)))}
${row("Garage", `${esc(garage)}<br><span style="font-weight:400;color:#6b6480">Park My Share garage · Level ${esc(level)}${g.spot ? `, space ${esc(g.spot)}` : ""}</span>`)}
${row("Turo trip", `#${trip.reservation_id}`)}
</table>
${weather ? `<p style="margin:6px 0 0;font-size:14px;color:#6b6480">Weather: ${esc(weather)}.</p>` : ""}
<h2 style="font-size:20px;margin:24px 0 12px;color:#1A1140">How to get to your car</h2>
<table role="presentation" style="border-collapse:collapse">
${step(1, `After you land, go <b>up to Level 2 (Departures)</b> and step outside. Wait at the red <b>"Hotel &amp; Private Parking Shuttles"</b> sign.`)}
${step(2, `Get on the <b>yellow shuttle with black spots</b> that says <b>The Parking Spot · CENTURY</b>. <span style="color:#C81E4B">Not "Sepulveda."</span> Tell the driver: <b>5730 W 98th St</b>.`)}
${step(3, `It's a 5-minute ride. Get off, walk across the alley to the garage, and <b>scan the QR code below at the lobby door</b>.`)}
${step(4, `Take the elevator to <b>Level ${esc(level)}</b>. Your car is there.`)}
</table>
<div style="background:#1A1140;border-radius:18px;padding:18px;text-align:center;margin:6px 0 0">
<p style="margin:0 0 10px;color:#FFB878;font-size:12px;letter-spacing:2px;font-weight:700">SCAN AT THE LOBBY DOOR</p>
<img src="${qr}" width="220" height="220" alt="Lobby door QR code" style="display:block;margin:0 auto;background:#fff;border-radius:10px">
<p style="margin:12px 0 0"><a href="${passUrl}" style="background:#000;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600;display:inline-block;border:1px solid #ffffff33">Add to Apple Wallet</a></p>
</div>
${g.after_hours ? `<p style="margin:18px 0 0;font-size:15px;color:#3d3654"><b>Landing between 10 PM and 6 AM?</b> Call for the shuttle: <a href="tel:+1${g.after_hours.replace(/[^\d]/g, "")}" style="color:#7A2E9E;font-weight:600">${esc(g.after_hours)}</a></p>` : ""}
<p style="margin:14px 0 0;font-size:15px;color:#3d3654"><b>Returning ${esc(fmtWhen(trip.ends_at))}:</b> drive back to the same garage (${esc(garage.split(",")[0])}) and use the car share return lane on 98th St. Full steps are on <a href="${page}" style="color:#7A2E9E;font-weight:600">your trip page</a>.</p>
<p style="margin:22px 0 0;text-align:center"><a href="${page}" style="background:#2B1A73;color:#fff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:600;display:inline-block">Open your trip page</a></p>
<p style="margin:24px 0 20px;color:#8c86a0;font-size:13px;text-align:center">Questions? Message your host in the Turo app.</p>
</div></div></body></html>`;
  const text = `Hi ${trip.first ?? "there"}, your Turo car is ready.\n\nYou rented a ${car} on Turo. It's parked in a garage 5 minutes from LAX. Your QR code opens the lobby door.\n\nCar: ${car}\nPick up: ${fmtWhen(trip.starts_at)}\nReturn: ${fmtWhen(trip.ends_at)}\nGarage: ${garage} (Park My Share, Level ${level})\nTuro trip: #${trip.reservation_id}\n${weather ? `Weather: ${weather}.\n` : ""}\nHow to get to your car:\n1. After you land, go up to Level 2 (Departures). Wait at the red "Hotel & Private Parking Shuttles" sign.\n2. Get on the yellow shuttle with black spots: The Parking Spot · CENTURY (not Sepulveda). Tell the driver 5730 W 98th St.\n3. Walk across the alley to the garage and scan your QR code at the lobby door.\n4. Elevator to Level ${level}. Your car is there.\n\nYour QR code and full steps: ${page}\nAdd to Apple Wallet: ${passUrl}\n${g.after_hours ? `10 PM to 6 AM: call for the shuttle ${g.after_hours}\n` : ""}\nQuestions? Message your host in the Turo app.`;
  return { subject, html, text };
}
async function remindDue() {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { error: "RESEND_API_KEY missing" };
  const { data } = await sb.rpc("lax_guest_due");
  const due = (data ?? []) as (Trip & { token: string; email: string })[];
  const st = await settings();
  let sent = 0; const errors: string[] = [];
  for (const d of due) {
    const weather = await pickupWeather(d.starts_at);
    const m = reminderEmail(d, st, weather);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "LAX Turo Rental <support@bestly.tech>", to: [d.email], reply_to: "support@bestly.tech", subject: m.subject, html: m.html, text: m.text }),
    });
    const body = await r.text();
    if (r.ok) {
      sent++;
      await sb.from("lax_guest_links").update({ reminder_sent_at: new Date().toISOString(), reminder_error: null }).eq("reservation_id", d.reservation_id);
    } else {
      errors.push(body.slice(0, 200));
      await sb.from("lax_guest_links").update({ reminder_error: `gave up: ${r.status} ${body.slice(0, 150)}` }).eq("reservation_id", d.reservation_id);
    }
  }
  const out = { due: due.length, sent, errors };
  await log("remind", out);
  return out;
}

// ---------- web service ----------
async function authed(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const s = await secrets();
  return h === `ApplePass ${s.lax_pass_auth_token}`;
}

async function isServiceRole(req: Request) {
  if (isSvc(req)) return true;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  // Vault's service_role_key may be a different (legacy) form: prove it by calling a service-role-only RPC with it.
  const probe = createClient(Deno.env.get("SUPABASE_URL")!, bearer, { auth: { persistSession: false } });
  const { error } = await probe.rpc("lax_pass_secrets");
  return !error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty(204);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/wallet-pass/, "") || "/";
  try {
    // PassKit web service
    let m = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)\/([^/]+)$/);
    if (m) {
      const [, dev, type, serial] = m;
      if (type !== PASS_TYPE || !knownSerial(serial)) return empty(404);
      if (!(await authed(req))) return empty(401);
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const pushToken = String(body.pushToken ?? "");
        if (!pushToken) return empty(400);
        const { data: existing } = await sb.from("lax_pass_registrations").select("device_id").match({ device_id: dev, pass_type: type, serial }).maybeSingle();
        await sb.from("lax_pass_registrations").upsert({ device_id: dev, pass_type: type, serial, push_token: pushToken, updated_at: new Date().toISOString() });
        await log("register", { new: !existing });
        return empty(existing ? 200 : 201);
      }
      if (req.method === "DELETE") {
        await sb.from("lax_pass_registrations").delete().match({ device_id: dev, pass_type: type, serial });
        await log("unregister", {});
        return empty(200);
      }
      return empty(405);
    }
    m = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)$/);
    if (m && req.method === "GET") {
      const [, dev, type] = m;
      const { data: regs } = await sb.from("lax_pass_registrations").select("serial").match({ device_id: dev, pass_type: type });
      if (!regs?.length) return empty(404);
      const code = await currentCode();
      if (!code) return empty(204);
      const tag = String(modifiedAt(code, await settings()).getTime());
      const since = url.searchParams.get("passesUpdatedSince");
      if (since && Number(since) >= Number(tag)) return empty(204);
      return json({ serialNumbers: [...new Set((regs as { serial: string }[]).map((r) => r.serial))], lastUpdated: tag });
    }
    m = path.match(/^\/v1\/passes\/([^/]+)\/([^/]+)$/);
    if (m && req.method === "GET") {
      if (m[1] !== PASS_TYPE || !knownSerial(m[2])) return empty(404);
      if (!(await authed(req))) return empty(401);
      const trip = isTripSerial(m[2]) ? await tripByRes(Number(m[2].slice(5))) : null;
      const code = await codeFor(trip);
      if (!code) return empty(404);
      const ims = req.headers.get("if-modified-since");
      if (ims && new Date(ims).getTime() >= Math.floor(modifiedAt(code, await settings()).getTime() / 1000) * 1000) return empty(304);
      return await passResponse(code, false, trip, m[2] === HOST_SERIAL);
    }
    if (path === "/v1/log" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      await log("apple_log", { logs: (body.logs ?? []).slice(0, 20) });
      return empty(200);
    }

    // QR as a PNG (reminder emails can't run the page's JavaScript).
    if (path === "/qr.png" && req.method === "GET") {
      const t = url.searchParams.get("t");
      let code: Code | null = null;
      if (t) code = await codeFor(await tripByToken(t));
      else {
        const { data: pub } = await sb.rpc("lax_pass_public", { p_slug: url.searchParams.get("slug") ?? "" });
        if (pub?.ok && pub.ready) code = await currentCode();
      }
      if (!code) return empty(404);
      const QR = (await import("npm:qrcode@1.5.4")).default;
      const png: Uint8Array = await QR.toBuffer(code.payload, { type: "png", width: 600, margin: 2, errorCorrectionLevel: "M" });
      return new Response(png, { headers: { ...cors, "Content-Type": "image/png", "Cache-Control": "public, max-age=900" } });
    }

    // Android: Save to Google Wallet
    if (path === "/google" && req.method === "GET") {
      const t = url.searchParams.get("t");
      const gtrip = t ? await tripByToken(t) : null;
      let code: Code | null = null;
      if (t) code = gtrip ? await codeFor(gtrip) : null;
      else {
        const { data: pub } = await sb.rpc("lax_pass_public", { p_slug: url.searchParams.get("slug") ?? "" });
        code = pub?.ok && pub.ready ? await currentCode() : null;
      }
      if (!code) return json({ error: "not found" }, 404);
      const save = await googleSaveUrl(code, await settings(), gtrip);
      if (!save) return json({ error: "google wallet not set up" }, 404);
      await log("google_save", { ua: (req.headers.get("user-agent") ?? "").slice(0, 120) });
      return new Response(null, { status: 302, headers: { ...cors, Location: save, "Cache-Control": "no-store" } });
    }

    // Jared's host pass (private link from /admin/turo/lax-pass)
    if (req.method === "GET" && url.searchParams.get("host")) {
      const { data: ok } = await sb.rpc("lax_pass_host_ok", { p_token: url.searchParams.get("host") });
      const code = ok ? await currentCode() : null;
      if (!code) return json({ error: "not found" }, 404);
      await log("download", { host: true, ua: (req.headers.get("user-agent") ?? "").slice(0, 120) });
      return await passResponse(code, url.searchParams.get("dl") === "1", null, true);
    }

    // Guest download (personal)
    if (req.method === "GET" && url.searchParams.get("t")) {
      const trip = await tripByToken(url.searchParams.get("t")!);
      const code = trip ? await codeFor(trip) : null;
      if (!trip || !code) return json({ error: "not found" }, 404);
      await log("download", { trip: trip.reservation_id, ua: (req.headers.get("user-agent") ?? "").slice(0, 120) });
      return await passResponse(code, url.searchParams.get("dl") === "1", trip);
    }

    // Guest download
    if (req.method === "GET") {
      const slug = url.searchParams.get("slug") ?? "";
      const { data: pub } = await sb.rpc("lax_pass_public", { p_slug: slug });
      if (!pub?.ok) return json({ error: "not found" }, 404);
      if (!pub.ready) return json({ error: "no code yet" }, 404);
      const code = await currentCode();
      if (!code) return json({ error: "no code yet" }, 404);
      await log("download", { ua: (req.headers.get("user-agent") ?? "").slice(0, 120) });
      return await passResponse(code, url.searchParams.get("dl") === "1");
    }

    // Service ops
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.op === "decode") {
        if (!(await isAdmin(req)) && !(await isServiceRole(req))) return json({ error: "admin only" }, 403);
        if (typeof body.png !== "string" || body.png.length > 12_000_000) return json({ error: "bad image" }, 400);
        return json({ payload: await decodeQr(body.png) });
      }
      if (!(await isServiceRole(req))) return json({ error: "forbidden" }, 403);
      if (body.op === "remind_due") return json(await remindDue());
      if (body.op === "push") {
        const apple = await pushAll();
        const google = await googleUpdateAll().catch((e) => ({ google_error: String(e).slice(0, 200) }));
        return json({ ...apple, ...google });
      }
      if (body.op === "selftest") {
        const code = await currentCode() ?? { id: "x", payload: "TEST", valid_month: laMonthNow(), note: null, created_at: new Date().toISOString() };
        const bytes = await buildPkpass(code);
        // deno-lint-ignore no-explicit-any
        return json({ ok: true, bytes: bytes.length, createHttpClient: typeof (Deno as any).createHttpClient });
      }
      return json({ error: "unknown op" }, 400);
    }
    return empty(404);
  } catch (e) {
    console.error(e);
    await log("error", { path, error: String(e).slice(0, 300) }).catch(() => {});
    return json({ error: "server error" }, 500);
  }
});
