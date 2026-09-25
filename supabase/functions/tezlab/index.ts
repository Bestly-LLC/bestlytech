// tezlab — sends guest car commands through Jared's TezLab account (TezLab MCP) instead of paying for
// Tesla Fleet API calls. TezLab has its own paired key, so climate / honk / flash / unlock work without
// the Bestly virtual key, and they count against Jared's TezLab allowance.
//
//   POST {op:"start"}            (admin JWT) → registers an OAuth client once, returns the TezLab sign-in URL
//   GET  /connect?s=<state>                   → one-time connect link (state pre-made in tezlab_oauth) → TezLab sign-in
//   GET  /callback?code&state                 → TezLab redirects here; tokens go to Vault; back to admin
//   POST {op:"status"}           (admin JWT) → live vehicle status through TezLab (connection test)
//   POST {op:"battery_health"}   (admin JWT) → TezLab battery health (degradation, capacity, cycles)
//   POST {op:"job", id}          (from the DB trigger) → runs one queued guest command
// If TezLab fails, the job goes back to the queue for the Mac mini worker (Tesla Fleet API) and Scout is told.
//
// v14: merges the car-protection jobs (lost when v13 was deployed over them): 'caps' (TezLab command list),
//      'drives' (drives with top speed → car_drives, for speed alerts), 'cmd' (server-made TezLab commands: Sentry,
//      charge start, erase guest data), and refresh stores TezLab's full status (car_raw_store) for windows/Sentry.
// v12: TezLab outages are recognised as TezLab's problem, not ours. 2026-09-24 their OAuth origin behind
//      Cloudflare answered 502 to every /oauth/token call (even a bogus one; a healthy server says 400) while
//      their MCP endpoint rejected a still-valid access token with 401. v11 treated that as "token refresh
//      failed", retried the refresh 3x per job (~9 s of waiting before the Tesla backup), and Scout told Jared
//      to Reconnect — which would have failed on the same 502. Now:
//        - a 5xx / network failure from TezLab, or a 401 against a token they issued seconds ago, throws
//          TezLabDown; the job falls straight back to Tesla and tezlab_down() pauses TezLab routing
//          (5 → 10 → 20 → 30 min, cleared by the next success) so guests never wait on a dead endpoint;
//        - a forced refresh while our stored token should still be good is a one-shot probe, not a 3x loop;
//        - only a 4xx from the token endpoint (invalid_grant etc.) is called a credential problem.
// v11: 'battery_health' job (daily, from battery_health_tick) → car_battery_health_store → guest pages show "Battery health: Good".
// v10: refresh also passes TezLab's live charging detail (power, time left, limit) for the idle-fee alerts;
//      nav_point (a Supercharger picked from the live open-stalls list); battery_health op.
// v9: lock + windows_close (return checklist); refresh also reports location and trunk/frunk.
// v8: nav_home. v7: nav_garage_lax. v6: 'charges' jobs. v5: nav_charger_lax + token refresh retries on 5xx.
// v4: nav_charger. v3: a 401 forces a refresh and retries once.
// Secrets: Vault tezlab_refresh_token / tezlab_access_token via tezlab_secrets() (service role only).
import { createClient } from "npm:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_ANON: string = __keys("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const sb = createClient(SB_URL, SB_SECRET, { auth: { persistSession: false } });

const MCP = "https://mcp.tezlabapp.com";
const REDIRECT = `${SB_URL}/functions/v1/tezlab/callback`;
const ADMIN = "https://www.bestly.tech/admin/turo/lax-pass";
const SCOPE = "mcp mcp_commands";
const STATE_TTL = 3 * 24 * 3600e3; // one-time connect links work for 3 days
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-proxy-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const back = (qs: string) => new Response(null, { status: 302, headers: { Location: `${ADMIN}?${qs}#tezlab` } });
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const F2C = (f: number) => Math.round(((f - 32) * 5) / 9 * 10) / 10;
const challengeOf = async (v: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** TezLab's side is broken (5xx, unreachable, or rejecting tokens it just issued). Nothing to reconnect. */
class TezLabDown extends Error { constructor(m: string) { super(m); this.name = "TezLabDown"; } }
const isDown = (e: unknown) => e instanceof TezLabDown || /^TezLabDown/.test(String(e));
const DOWN_MSG = (what: string) => `TezLab's servers are down (${what}). That's on TezLab's side, nothing to reconnect; the Tesla backup covers until they're back.`;

async function isAdmin(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const c = createClient(SB_URL, SB_ANON || SB_SECRET, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await c.rpc("tezlab_admin_state");
  return !error && !!data;
}

type Sec = { client_id: string | null; refresh_token: string | null; access_token: string | null; access_note: string | null };
async function secrets(): Promise<Sec> { const { data } = await sb.rpc("tezlab_secrets"); return data as Sec; }
const tokenExpiry = (s: Sec) => { const m = /expires (.+)$/.exec(s.access_note ?? ""); return m ? Date.parse(m[1].replace(" ", "T").replace(/\+00$/, "+00:00")) : 0; };

/** Refresh through TezLab's token endpoint. `tries` > 1 only when our own token has really expired. */
async function refreshToken(s: Sec, tries: number): Promise<string> {
  let status = 0;
  // deno-lint-ignore no-explicit-any
  let j: any = {};
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(`${MCP}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ grant_type: "refresh_token", refresh_token: s.refresh_token!, client_id: s.client_id!, resource: MCP }) });
      status = r.status;
      j = await r.json().catch(() => ({}));
      if (j.access_token || r.status < 500) break;
    } catch (e) { status = 0; j = { error: "unreachable", error_description: String(e).slice(0, 80) }; }
    if (a + 1 < tries) await sleep(1500 * (a + 1));
  }
  if (j.access_token) {
    await sb.rpc("tezlab_store_tokens", { p_refresh: j.refresh_token ?? s.refresh_token, p_access: j.access_token, p_expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString() });
    return j.access_token as string;
  }
  if (status === 0 || status >= 500) throw new TezLabDown(DOWN_MSG(status ? `token server answered ${status}` : "token server unreachable"));
  // A real 4xx: TezLab looked at our refresh token and said no. This one does need a Reconnect.
  throw new Error(`TezLab rejected our refresh token (${status}): ${JSON.stringify(j).slice(0, 160)}. Reconnect TezLab in admin.`);
}

async function accessToken(force = false): Promise<string> {
  const s = await secrets();
  if (!s?.refresh_token || !s.client_id) throw new Error("TezLab isn't connected");
  const fresh = !!s.access_token && tokenExpiry(s) > Date.now() + 5 * 60e3;
  if (!force && fresh) return s.access_token!;
  // Forced while our token should still be good = TezLab said 401 to a valid token. Probe their token
  // endpoint once; if it's 5xx they're down and we should not sit in a retry loop with a guest waiting.
  return await refreshToken(s, force && fresh ? 1 : 3);
}

// deno-lint-ignore no-explicit-any
async function rpcCall(token: string, session: string | null, body: any) {
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` };
  if (session) h["mcp-session-id"] = session;
  let r: Response;
  try { r = await fetch(`${MCP}/`, { method: "POST", headers: h, body: JSON.stringify(body) }); }
  catch (e) { throw new TezLabDown(DOWN_MSG(`unreachable: ${String(e).slice(0, 60)}`)); }
  const sid = r.headers.get("mcp-session-id") ?? session;
  const text = await r.text();
  if (r.status >= 500) throw new TezLabDown(DOWN_MSG(`answered ${r.status}`));
  if (!r.ok) throw new Error(`TezLab ${r.status}: ${text.slice(0, 200)}`);
  // deno-lint-ignore no-explicit-any
  let msg: any = null;
  if ((r.headers.get("content-type") ?? "").includes("event-stream")) {
    for (const line of text.split("\n")) if (line.startsWith("data:")) { try { const d = JSON.parse(line.slice(5)); if (d.id === body.id) msg = d; } catch { /* keep going */ } }
  } else if (text) { msg = JSON.parse(text); }
  return { sid, msg };
}
const is401 = (e: unknown) => /TezLab 401|invalid_token/i.test(String(e));
async function tool(name: string, args: Record<string, unknown>) {
  try { return await toolOnce(name, args, false); }
  catch (e) {
    if (isDown(e) || !is401(e)) throw e;
    try { return await toolOnce(name, args, true); }
    catch (e2) {
      // A token TezLab issued seconds ago is "invalid or expired"? Their auth backend is flapping, not our credentials.
      if (is401(e2)) throw new TezLabDown(DOWN_MSG("rejecting a token they just issued, 401"));
      throw e2;
    }
  }
}
async function toolOnce(name: string, args: Record<string, unknown>, force: boolean) {
  const token = await accessToken(force);
  const init = await rpcCall(token, null, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bestly-trips", version: "1.0" } } });
  await fetch(`${MCP}/`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, ...(init.sid ? { "mcp-session-id": init.sid } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }).then((r) => r.text()).catch(() => "");
  const { msg } = await rpcCall(token, init.sid, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  if (msg?.error) throw new Error(`TezLab ${name}: ${JSON.stringify(msg.error).slice(0, 200)}`);
  const res = msg?.result;
  const txt = (res?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
  if (res?.isError) throw new Error(`TezLab ${name}: ${txt.slice(0, 200)}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

/** TezLab is down on their side: pause routing (escalating), record it, and say so in the log. */
async function markDown(e: unknown, where: string) {
  console.warn(`tezlab ${where}: TEZLAB DOWN — ${String(e).slice(0, 300)}`);
  await sb.rpc("tezlab_down", { p_error: String(e) }).then(({ error }) => { if (error) console.error("tezlab_down rpc:", error.message); });
}

// TezLab's charging block → one small shape (field names vary a little between TezLab versions, so read a few).
// deno-lint-ignore no-explicit-any
function chargeDetail(c: any) {
  if (!c || typeof c !== "object") return null;
  const n = (...k: string[]) => { for (const x of k) { const v = c[x]; if (v != null && v !== "" && !isNaN(Number(v))) return Number(v); } return null; };
  return {
    power_kw: n("power_kw", "charger_power_kw", "charger_power", "power"),
    minutes_left: n("minutes_remaining", "minutes_to_full", "time_remaining_min", "time_to_full_min") ??
      (n("time_remaining_hours", "hours_remaining", "time_to_full_charge") != null ? Math.round(n("time_remaining_hours", "hours_remaining", "time_to_full_charge")! * 60) : null),
    limit_pct: n("charge_limit_pct", "charge_limit_soc", "limit_pct", "charge_limit"),
    rate_mph: n("rate_mph", "charge_rate", "rate"),
    energy_kwh: n("energy_added_kwh", "charge_energy_added", "energy_added"),
    fast: c.fast_charger ?? c.fast_charger_present ?? c.is_dc_fast ?? (n("power_kw", "charger_power_kw", "charger_power", "power") != null ? n("power_kw", "charger_power_kw", "charger_power", "power")! >= 30 : null),
    raw: c,
  };
}

// Loose readers for TezLab drive records (field names vary between list and detail).
// deno-lint-ignore no-explicit-any
function deep(o: any, re: RegExp): any { if (!o || typeof o !== "object") return null; for (const [k, v] of Object.entries(o)) { if (re.test(k) && v && typeof v === "object") return v; } return null; }
// deno-lint-ignore no-explicit-any
function findNum(o: any, re: RegExp, depth = 0): number | null {
  if (!o || typeof o !== "object" || depth > 3) return null;
  for (const [k, v] of Object.entries(o)) if (re.test(k) && v != null && v !== "" && !isNaN(Number(v))) return Number(v);
  for (const v of Object.values(o)) { const r = findNum(v, re, depth + 1); if (r != null) return r; }
  return null;
}
// deno-lint-ignore no-explicit-any
function pick(a: any, b: any, re: RegExp): string | null { for (const o of [a, b]) if (o) for (const [k, v] of Object.entries(o)) if (re.test(k) && typeof v === "string") return v; return null; }
const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

// TezLab status → the state shape tesla_job_done expects (now with location + trunks for the return checklist).
// deno-lint-ignore no-explicit-any
function toState(v: any) {
  if (!v || typeof v !== "object") return null;
  return {
    battery: v.battery?.level_pct ?? null, range: v.battery?.range ?? null, range_real: v.battery?.real_world_range ?? null,
    inside_f: v.climate?.inside_temp != null ? Math.round(v.climate.inside_temp) : null,
    outside_f: v.climate?.outside_temp != null ? Math.round(v.climate.outside_temp) : null,
    locked: v.doors?.locked ?? null, climate_on: v.climate?.active ?? null, charging: v.charging_state ?? null,
    plugged_in: v.plugged_in ?? null, software: v.software_version ?? null,
    latitude: v.location?.latitude ?? null, longitude: v.location?.longitude ?? null,
    doors: v.doors ? { locked: v.doors.locked ?? null, front_trunk_open: v.doors.front_trunk_open ?? null, rear_trunk_open: v.doors.rear_trunk_open ?? null } : null,
    charge: chargeDetail(v.charging),
    online: v.connection_state === "online" ? "online" : "offline",
  };
}

const PLAN: Record<string, { cmd: string; args?: Record<string, unknown> }[]> = {
  cool: [{ cmd: "set_temps", args: { driver_temp: F2C(68) } }, { cmd: "climate_on" }],
  warm: [{ cmd: "set_temps", args: { driver_temp: F2C(74) } }, { cmd: "climate_on" }],
  seat: [{ cmd: "set_temps", args: { driver_temp: F2C(74) } }, { cmd: "climate_on" }],
  off: [{ cmd: "climate_off" }],
  honk: [{ cmd: "horn_honk" }],
  flash: [{ cmd: "lights_flash" }],
  unlock: [{ cmd: "unlock" }],
  lock: [{ cmd: "lock" }],
  windows_close: [{ cmd: "windows_close" }],
  nav_charger: [{ cmd: "navigate_to_point", args: { latitude: 34.0909484, longitude: -118.3418798 } }],
  nav_charger_lax: [{ cmd: "navigate_to_point", args: { latitude: 33.98681, longitude: -118.390323 } }],
  nav_garage_lax: [{ cmd: "navigate_to_point", args: { latitude: 33.9472637, longitude: -118.3826063 } }],
  nav_home: [{ cmd: "navigate_to_point", args: { latitude: 34.084241, longitude: -118.371793 } }],
};
// deno-lint-ignore no-explicit-any
function planFor(job: any) {
  if (job.action === "nav_point") {
    const lat = Number(job.args?.lat), lon = Number(job.args?.lon);
    if (!isFinite(lat) || !isFinite(lon)) throw new Error("nav_point without coordinates");
    return [{ cmd: "navigate_to_point", args: { latitude: lat, longitude: lon } }];
  }
  return PLAN[job.action];
}

async function runJob(id: number) {
  const { data: job } = await sb.rpc("tezlab_job_get", { p_id: id });
  if (!job || job.via !== "tezlab" || job.status !== "running") return { skipped: true };
  const { data: mine } = await sb.rpc("tezlab_job_claim", { p_id: id });
  if (!mine) return { skipped: "already running" };
  const vin = job.vin as string;
  try {
    if (job.action === "charges") {
      const a = (job.args ?? {}) as { start?: string; end?: string };
      const from = Date.parse(a.start ?? "") || Date.now() - 7 * 864e5, to = Date.parse(a.end ?? "") || Date.now();
      const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const out: Record<string, unknown>[] = [];
      for (let offset = 0; offset < 200; offset += 50) {
        // deno-lint-ignore no-explicit-any
        const r: any = await tool("get_charges", { vin, start_date: day(from - 864e5), end_date: day(to + 864e5), limit: 50, offset, order: "asc" });
        // deno-lint-ignore no-explicit-any
        for (const c of (r?.charges ?? []) as any[]) {
          const t = Date.parse(c.start_time);
          if (!(t >= from - 15 * 60e3 && t <= to + 15 * 60e3)) continue;
          out.push({ id: c.id, started_at: c.start_time, ended_at: c.end_time, place: c.location?.name ?? null, address: c.location?.address ?? null,
            lat: c.location?.latitude ?? null, lon: c.location?.longitude ?? null, kwh: c.energy_added_kwh ?? null,
            start_pct: c.start_battery_pct ?? null, end_pct: c.end_battery_pct ?? null, cost: c.cost?.amount ?? null,
            currency: c.cost?.currency ?? "USD", supercharger: !!c.is_dc_fast });
        }
        if (!r?.pagination?.has_more) break;
      }
      await sb.rpc("tesla_job_done", { p_id: id, p_ok: true, p_result: { ok: true, source: "tezlab", via: "tezlab", charges: out, count: out.length }, p_state: null });
      await sb.rpc("tezlab_ok");
      return { ok: true, count: out.length };
    }
    if (job.action === "battery_health") {
      const h = await tool("get_battery_health", { vin });
      if (!h || typeof h !== "object") throw new Error("TezLab sent no battery health");
      // deno-lint-ignore no-explicit-any
      const { capacity_history: _hist, ...keep } = h as any;
      await sb.rpc("car_battery_health_store", { p_health: keep });
      await sb.rpc("tesla_job_done", { p_id: id, p_ok: true, p_result: { ok: true, via: "tezlab", health_score: keep.health_score ?? null }, p_state: null });
      await sb.rpc("tezlab_ok");
      return { ok: true };
    }
    if (job.action === "caps") {
      const c = await tool("get_command_capabilities", { vin });
      await sb.from("car_protect_settings").update({ caps: c, caps_at: new Date().toISOString() }).eq("id", 1);
      await sb.rpc("tesla_job_done", { p_id: id, p_ok: true, p_result: { ok: true, via: "tezlab", caps: c }, p_state: null });
      await sb.rpc("tezlab_ok");
      return { ok: true };
    }
    if (job.action === "drives") {
      const since = String(job.args?.since ?? new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10));
      // deno-lint-ignore no-explicit-any
      const br: any = await tool("get_drives_brief", { vin, start_date: since, limit: 100, order: "desc" });
      // deno-lint-ignore no-explicit-any
      const list: any[] = Array.isArray(br) ? br : (br?.drives ?? br?.data ?? []);
      const ids = list.map((d) => String(d.id));
      const { data: known } = await sb.rpc("car_drives_known", { p_ids: ids });
      const knownSet = new Set((known ?? []) as string[]);
      const out: Record<string, unknown>[] = [];
      for (const d of list.slice(0, 25)) {
        const idS = String(d.id);
        // deno-lint-ignore no-explicit-any
        let det: any = null;
        if (!knownSet.has(idS) || job.args?.all) det = await tool("get_drive_detail", { vin, id: idS }).catch(() => null);
        if (knownSet.has(idS) && !det) continue;
        const src = det ?? d;
        out.push({
          id: idS, vin, started_at: pick(src, d, /^(start_time|started_at|start)$/), ended_at: pick(src, d, /^(end_time|ended_at|end)$/),
          from_name: deep(d, /^from$/)?.name ?? deep(src, /start_location|from/)?.name ?? null,
          from_lat: num(deep(d, /^from$/)?.latitude ?? deep(src, /start_location|from/)?.latitude),
          from_lon: num(deep(d, /^from$/)?.longitude ?? deep(src, /start_location|from/)?.longitude),
          to_name: deep(d, /^to$/)?.name ?? deep(src, /end_location|to/)?.name ?? null,
          to_lat: num(deep(d, /^to$/)?.latitude ?? deep(src, /end_location|to/)?.latitude),
          to_lon: num(deep(d, /^to$/)?.longitude ?? deep(src, /end_location|to/)?.longitude),
          state: d.state ?? src.state ?? null, country: d.country_code ?? src.country_code ?? null,
          miles: num(findNum(src, /^(distance|distance_mi|distance_miles|miles)$/) ?? findNum(d, /distance/)),
          max_mph: num(findNum(src, /max.*speed|speed.*max/)), avg_mph: num(findNum(src, /(avg|average).*speed|speed.*(avg|average)/)),
          odo_start: num(findNum(src, /(start|begin).*odometer|odometer.*(start|begin)/)), odo_end: num(findNum(src, /end.*odometer|odometer.*end/)),
          raw: det ?? d,
        });
      }
      const { data: n } = await sb.rpc("car_drives_store", { p_drives: out });
      await sb.rpc("tesla_job_done", { p_id: id, p_ok: true, p_result: { ok: true, via: "tezlab", drives: list.length, stored: n }, p_state: null });
      await sb.rpc("tezlab_ok");
      return { ok: true, stored: n };
    }
    if (job.action === "cmd") {
      const command = String(job.args?.command ?? "");
      if (!command) throw new Error("cmd without a command");
      await sb.rpc("tezlab_job_stage", { p_id: id, p_stage: "Waking up the car" });
      await tool("send_vehicle_command", { vin, command: "wake_up" }).catch((e) => { if (isDown(e)) throw e; });
      await sb.rpc("tezlab_job_stage", { p_id: id, p_stage: "Sending to the car" });
      const r = await tool("send_vehicle_command", { vin, command, ...((job.args?.params ?? {}) as Record<string, unknown>) });
      const v = await tool("get_vehicle_status", { vin }).catch(() => null);
      if (v) await sb.rpc("car_raw_store", { p_raw: v });
      await sb.rpc("tesla_job_done", { p_id: id, p_ok: true, p_result: { ok: true, via: "tezlab", command, reply: r }, p_state: toState(v) });
      await sb.rpc("tezlab_ok");
      return { ok: true };
    }
    if (job.action === "refresh") {
      const v = await tool("get_vehicle_status", { vin });
      if (v && typeof v === "object") await sb.rpc("car_raw_store", { p_raw: v });
      await sb.rpc("tesla_job_done", { p_id: id, p_ok: true, p_result: { ok: true, msg: "updated", via: "tezlab" }, p_state: toState(v) });
      await sb.rpc("tezlab_ok");
      return { ok: true };
    }
    const steps = planFor(job);
    if (!steps) throw new Error(`no TezLab mapping for ${job.action}`);
    await sb.rpc("tezlab_job_stage", { p_id: id, p_stage: "Waking up the car" });
    await tool("send_vehicle_command", { vin, command: "wake_up" }).catch((e) => { if (isDown(e)) throw e; });
    await sb.rpc("tezlab_job_stage", { p_id: id, p_stage: "Sending to the car" });
    for (const s of steps) {
      let last: unknown = null;
      for (let a = 0; a < 3; a++) {
        try { await tool("send_vehicle_command", { vin, command: s.cmd, ...(s.args ?? {}) }); last = null; break; }
        catch (e) { last = e; if (isDown(e)) break; await sleep(4000); }
      }
      if (last) throw last;
    }
    await sb.rpc("tezlab_job_stage", { p_id: id, p_stage: "Done, checking the car" });
    await sleep(2500);
    const v = await tool("get_vehicle_status", { vin }).catch(() => null);
    await sb.rpc("tesla_job_done", { p_id: id, p_ok: true, p_result: { ok: true, msg: job.action, via: "tezlab" }, p_state: toState(v) });
    await sb.rpc("tezlab_ok");
    return { ok: true };
  } catch (e) {
    const down = isDown(e);
    if (down) await markDown(e, `job ${id} ${job.action}`);
    else console.warn(`tezlab job ${id} ${job.action} failed: ${String(e).slice(0, 300)}`);
    await sb.rpc("tezlab_job_fallback", { p_id: id, p_error: String(e) });
    return { ok: false, fallback: "fleet", down, error: String(e).slice(0, 200) };
  }
}

async function authorizeUrl(state: string, verifier: string) {
  const { data: st } = await sb.from("tezlab_settings").select("client_id").eq("id", 1).single();
  const q = new URLSearchParams({ response_type: "code", client_id: st!.client_id!, redirect_uri: REDIRECT, scope: SCOPE, state,
    code_challenge: await challengeOf(verifier), code_challenge_method: "S256", resource: MCP });
  return `${MCP}/oauth/authorize?${q}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/tezlab/, "") || "/";
  try {
    if (path === "/connect" && req.method === "GET") {
      const s = url.searchParams.get("s") ?? "";
      const { data: row } = await sb.from("tezlab_oauth").select("verifier, created_at").eq("state", s).maybeSingle();
      if (!row || Date.now() - Date.parse(row.created_at) > STATE_TTL) return back("tezlab=error&why=link+expired");
      return new Response(null, { status: 302, headers: { Location: await authorizeUrl(s, row.verifier) } });
    }
    if (path === "/callback" && req.method === "GET") {
      if (url.searchParams.get("error")) return back(`tezlab=error&why=${encodeURIComponent(url.searchParams.get("error_description") ?? url.searchParams.get("error")!)}`);
      const code = url.searchParams.get("code"), state = url.searchParams.get("state");
      if (!code || !state) return back("tezlab=error&why=missing+code");
      const { data: rows } = await sb.from("tezlab_oauth").delete().eq("state", state).gte("created_at", new Date(Date.now() - STATE_TTL).toISOString()).select("verifier");
      const verifier = rows?.[0]?.verifier;
      if (!verifier) return back("tezlab=error&why=link+expired,+try+again");
      const s = await secrets();
      const r = await fetch(`${MCP}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: s.client_id!, code_verifier: verifier, resource: MCP }) });
      const j = await r.json().catch(() => ({}));
      if (!j.refresh_token) {
        const why = r.status >= 500 ? `TezLab's servers are down right now (${r.status}). Try again later; nothing is wrong on our side.` : "sign-in failed: " + JSON.stringify(j).slice(0, 120);
        return back(`tezlab=error&why=${encodeURIComponent(why)}`);
      }
      await sb.rpc("tezlab_store_tokens", { p_refresh: j.refresh_token, p_access: j.access_token, p_expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString() });
      await sb.from("tezlab_settings").update({ connected_at: new Date().toISOString(), last_error: null, down_until: null, down_streak: 0 }).eq("id", 1);
      await sb.rpc("scout_notify", { p_title: "TezLab connected", p_body: "Guest A/C, honk, flash and unlock now go through your TezLab allowance. Tesla Fleet API is the backup.", p_severity: "info", p_push: true, p_url: "/admin/turo/lax-pass#tezlab", p_dedupe: "tezlab-connected" });
      return back("tezlab=connected");
    }
    if (req.method !== "POST") return json({ error: "not found" }, 404);
    const body = await req.json().catch(() => ({}));
    if (body.op === "job") return json(await runJob(Number(body.id)));
    if (!(await isAdmin(req))) return json({ error: "admin only" }, 403);
    if (body.op === "start") {
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
      const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
      await sb.from("tezlab_oauth").insert({ state, verifier });
      return json({ url: await authorizeUrl(state, verifier) });
    }
    if (body.op === "status" || body.op === "battery_health") {
      const { data: fs } = await sb.from("tesla_fleet_settings").select("vin").eq("id", 1).single();
      try {
        const v = await tool(body.op === "status" ? "get_vehicle_status" : "get_battery_health", { vin: fs!.vin });
        await sb.rpc("tezlab_ok");
        return json(body.op === "status" ? { ok: true, vehicle: v } : { ok: true, health: v });
      } catch (e) {
        if (isDown(e)) { await markDown(e, body.op); return json({ ok: false, down: true, error: String(e).replace(/^TezLabDown: /, "") }, 503); }
        throw e;
      }
    }
    return json({ error: "unknown op" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
