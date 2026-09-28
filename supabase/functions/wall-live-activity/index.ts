// wall-live-activity — W6 (wall round 4, 2026-09-28): the aircraft Live Activity on Jared's iPhone.
//
// The Pi (server.py, section "W6 SKY LIVE ACTIVITY") decides WHAT to show — the plane on the wall's name tag
// (state.airFocus / heartbeat tag_hex) — and calls op=push. This function signs APNs pushes with the team's
// APNs .p8 key from Vault (get_apns_credentials) and sends them to the tokens the "Bestly Sky" app registered.
//
//   op=register  (app, x-sky-key)   {kind:'start'|'update', token, activity_id?, env, device?, app_version?}
//   op=current   (app, x-sky-key)   -> {state, event, at}   (the in-app live compass reads this)
//   op=push      (Pi, x-api-key)    {event:'start'|'update'|'end', state, alert?, priority?, stale_s?}
//                                   -> {ok, sent, results:[{kind, env, tail, status, reason}]}
//   op=health    (Pi, x-api-key)    -> {tokens:{start, update}, last_ok_at, last_fail}
//
// APNs: topic tech.bestly.sky.push-type.liveactivity, apns-push-type liveactivity. The debug build installed from
// the Mac mini is development-signed -> sandbox host; a TestFlight/App Store build would register env=production.
// Nothing here ever returns or logs a key or a full device token.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const BUNDLE = "tech.bestly.sky";
const TOPIC = BUNDLE + ".push-type.liveactivity";
const ATTR_TYPE = "AircraftAttributes";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-api-key, x-sky-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

const b64url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));
const same = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

type Creds = { team_id: string | null; key_id: string | null; private_key: string | null; app_key: string | null };
let credsCache: { at: number; c: Creds } | null = null;
async function creds(): Promise<Creds> {
  if (credsCache && Date.now() - credsCache.at < 10 * 60_000) return credsCache.c;
  const { data, error } = await db.rpc("get_apns_credentials");
  if (error) throw new Error("vault read failed: " + error.message);
  const c = (Array.isArray(data) ? data[0] : data) as Creds;
  credsCache = { at: Date.now(), c };
  return c;
}

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

// One provider token shared across isolates (APNs: refresh no more than every 20 min, valid up to 60 min).
let jwtMem: { token: string; at: number } | null = null;
async function providerToken(c: Creds): Promise<string> {
  const now = Date.now();
  if (jwtMem && now - jwtMem.at < 40 * 60_000) return jwtMem.token;
  const { data: row } = await db.from("wall_sky_jwt").select("token, minted_at").eq("id", 1).maybeSingle();
  if (row?.token && row.minted_at && now - Date.parse(row.minted_at) < 40 * 60_000) {
    jwtMem = { token: row.token, at: Date.parse(row.minted_at) };
    return row.token;
  }
  const iat = Math.floor(now / 1000);
  const input = `${b64urlText(JSON.stringify({ alg: "ES256", kid: c.key_id }))}.${b64urlText(JSON.stringify({ iss: c.team_id, iat }))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await importKey(c.private_key!), new TextEncoder().encode(input)));
  const token = `${input}.${b64url(sig)}`;
  jwtMem = { token, at: iat * 1000 };
  await db.from("wall_sky_jwt").upsert({ id: 1, token, minted_at: new Date(iat * 1000).toISOString() });
  return token;
}

async function apns(env: string, token: string, payload: unknown, priority: number, c: Creds, collapse?: string) {
  const host = env === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const headers: Record<string, string> = {
    authorization: `bearer ${await providerToken(c)}`,
    "apns-topic": TOPIC,
    "apns-push-type": "liveactivity",
    "apns-priority": String(priority),
    "apns-expiration": String(Math.floor(Date.now() / 1000) + 120),
  };
  if (collapse) headers["apns-collapse-id"] = collapse;
  try {
    const r = await fetch(`${host}/3/device/${token}`, { method: "POST", headers, body: JSON.stringify(payload) });
    const txt = await r.text();
    let reason = "";
    try { reason = JSON.parse(txt || "{}").reason ?? ""; } catch { /* empty body on 200 */ }
    if (r.status === 403 && reason === "ExpiredProviderToken") { jwtMem = null; await db.from("wall_sky_jwt").delete().eq("id", 1); }
    return { status: r.status, reason };
  } catch (e) {
    return { status: 0, reason: String((e as Error).message ?? e).slice(0, 120) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return J({ ok: false, error: "expected JSON" }, 400); }
  const op = String(body.op ?? "");

  let c: Creds;
  try { c = await creds(); } catch (e) { return J({ ok: false, error: String((e as Error).message) }, 500); }

  // ---------- app side ----------
  if (op === "register" || op === "current") {
    if (!same(req.headers.get("x-sky-key") ?? "", c.app_key ?? "")) return J({ ok: false, error: "unauthorized" }, 401);
    if (op === "current") {
      const { data } = await db.from("wall_sky_current").select("event, state, at").eq("id", 1).maybeSingle();
      return J({ ok: true, ...(data ?? {}) });
    }
    const kind = body.kind === "update" ? "update" : body.kind === "start" ? "start" : null;
    const token = String(body.token ?? "").toLowerCase();
    if (!kind || !/^[0-9a-f]{32,200}$/.test(token)) return J({ ok: false, error: "bad token" }, 400);
    const env = body.env === "production" ? "production" : "sandbox";
    const row = { token, kind, env, activity_id: body.activity_id ? String(body.activity_id).slice(0, 80) : null,
      device: body.device ? String(body.device).slice(0, 60) : null, app_version: body.app_version ? String(body.app_version).slice(0, 20) : null,
      last_seen: new Date().toISOString(), dead: false };
    const { error } = await db.from("wall_sky_tokens").upsert(row, { onConflict: "token" });
    if (error) return J({ ok: false, error: error.message }, 500);
    if (kind === "start") {   // a new push-to-start token replaces the old ones from this device
      await db.from("wall_sky_tokens").update({ dead: true }).eq("kind", "start").eq("device", row.device ?? "").neq("token", token);
    }
    return J({ ok: true, kind, env });
  }

  // ---------- Pi side ----------
  if (!c.team_id || !c.key_id || !c.private_key) return J({ ok: false, error: "APNs not configured in Vault" }, 503);
  const agentKey = (await db.rpc("get_home_hub_agent_key")).data as string | null;
  if (!same(req.headers.get("x-api-key") ?? "", agentKey ?? "")) return J({ ok: false, error: "unauthorized" }, 401);

  if (op === "health") {
    const { data: toks } = await db.from("wall_sky_tokens").select("kind, env, last_seen, last_status, last_reason").eq("dead", false);
    const { data: lastOk } = await db.from("wall_sky_log").select("at, event").gt("ok", 0).order("at", { ascending: false }).limit(1);
    const { data: lastFail } = await db.from("wall_sky_log").select("at, event, statuses").eq("ok", 0).gt("sent", 0).order("at", { ascending: false }).limit(1);
    return J({ ok: true, tokens: { start: (toks ?? []).filter((t) => t.kind === "start").length, update: (toks ?? []).filter((t) => t.kind === "update").length },
      last_ok_at: lastOk?.[0]?.at ?? null, last_fail: lastFail?.[0] ?? null });
  }

  if (op !== "push") return J({ ok: false, error: "unknown op" }, 400);
  const event = String(body.event ?? "");
  if (!["start", "update", "end"].includes(event)) return J({ ok: false, error: "bad event" }, 400);
  const state = body.state ?? {};
  const now = Math.floor(Date.now() / 1000);
  const staleS = Math.min(Math.max(Number(body.stale_s ?? 150), 60), 3600);
  const priority = event === "update" ? (Number(body.priority) === 10 ? 10 : 5) : 10;

  const aps: Record<string, unknown> = { timestamp: now, event, "content-state": state };
  if (event !== "end") aps["stale-date"] = now + staleS;
  if (event === "end") aps["dismissal-date"] = now + Math.min(Math.max(Number(body.dismiss_s ?? 0), 0), 3600);
  if (event === "start") {
    aps["attributes-type"] = ATTR_TYPE;
    aps["attributes"] = { home: "Home", lat: 34.0852, lon: -118.3718 };
    aps["alert"] = body.alert ?? { title: "Plane overhead", body: String(state.flight ?? "") };
    aps["input-push-token"] = 1;
  } else if (body.alert && priority === 10) {
    aps["alert"] = body.alert;
  }
  aps["relevance-score"] = 60;

  const since = new Date(Date.now() - 9 * 3600e3).toISOString();
  const q = db.from("wall_sky_tokens").select("token, kind, env").eq("dead", false);
  const { data: toks, error: te } = event === "start" ? await q.eq("kind", "start") : await q.eq("kind", "update").gte("last_seen", since);
  if (te) return J({ ok: false, error: te.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const t of toks ?? []) {
    const r = await apns(t.env, t.token, { aps }, priority, c);
    results.push({ kind: t.kind, env: t.env, tail: t.token.slice(-6), ...r });
    const dead = r.status === 410 || (r.status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(r.reason));
    await db.from("wall_sky_tokens").update({ last_push_at: new Date().toISOString(), last_status: r.status, last_reason: r.reason || null,
      ...(dead || (event === "end" && t.kind === "update" && r.status === 200) ? { dead: true } : {}) }).eq("token", t.token);
  }
  const ok = results.filter((r) => r.status === 200).length;
  await db.from("wall_sky_log").insert({ event, hex: state.hex ? String(state.hex).slice(0, 12) : null, sent: results.length, ok, statuses: results });
  await db.from("wall_sky_current").upsert({ id: 1, event, state: event === "end" ? null : state, at: new Date().toISOString() });
  if (Math.random() < 0.02) await db.rpc("wall_sky_log_prune");
  return J({ ok: results.length > 0 && ok === results.length, sent: results.length, delivered: ok, results });
});
