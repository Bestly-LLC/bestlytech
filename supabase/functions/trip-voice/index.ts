// trip-voice — the voice helper (Leo) on the Turo guest trip pages.
//
// Two doors, both verify_jwt = false:
//
//   POST {op:"session", token}            from the trip page. The guest's trip token (or a demo page) buys a short-lived
//                                         signed voice session. The page gets {signed_url, key}; only the opaque key goes
//                                         to the voice platform as the dynamic variable trip_key, never the trip token.
//                                         Max 20 sessions per trip per hour (40 on demo pages).
//
//   POST ?tool=<name>  {trip_key, conversation_id, ...}   from the voice platform (Leo's server tools).
//                                         The first call checks with ElevenLabs that conversation_id is a live call of
//                                         this agent (under 2 hours old) and binds the key to it; later calls must come
//                                         from that same conversation. Tools run through the same token-scoped,
//                                         rate-limited SQL the text helper (lax-ask) uses: lax_agent_diag, lax_agent_act,
//                                         lax_agent_job, lax_agent_driver, or lax_demo_tool on the demo pages.
//
//   POST {op:"act", token, tool, args}    buttons on Leo's inline cards (same power as the page's own buttons).
//   POST {op:"diag", ...}                  what Leo's screen hit on a real device -> leo_client_diag.
//
// Tools: trip_status, key_fix, job_status, extra_driver, notify_host, file_ticket, and the car tools car_status,
//        car_climate (page presets), car_lock (lock only), find_superchargers, send_to_car_nav, charging_summary,
//        send_sms (not live). Real trips go through the page's own gate (lax_guest_car_command); demo trips use the
//        pretend car (leo_demo_car). Phone calls get their trip_key from leo-phone-init instead of door 1.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors = corsWith({ headers: "authorization, apikey, content-type, x-client-info", methods: "POST, OPTIONS" });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const XI = "https://api.elevenlabs.io/v1";
const AGENT_SLUG = "leo";
let req_ua = "";
const NO_TRIP = { ok: false, error: "No trip is linked to this chat. Ask the guest to open their trip page and tap Talk to our team 24/7 there." };

type Session = { key: string; token: string; conversation_id: string | null; expires_at: string };
type Any = Record<string, unknown>;

async function xiKey(): Promise<string | null> {
  const { data, error } = await sb.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  return error || typeof data !== "string" || !data ? null : data;
}
async function agentId(): Promise<string | null> {
  const { data } = await sb.from("voice_agents").select("elevenlabs_agent_id, status").eq("slug", AGENT_SLUG).maybeSingle();
  return data && data.status !== "paused" ? (data.elevenlabs_agent_id as string | null) : null;
}
const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// ---------- door 1: the trip page asks for a session ----------
async function openSession(b: Any): Promise<Response> {
  const raw = clip(b.token, 120);
  if (!raw) return json({ ok: false, error: "Open your trip link to talk to Leo." }, 400);
  const demo = /^demo-(home|lax)$/.test(raw);
  const token = demo ? `demo:${raw}` : raw;
  if (!demo) {
    const { data: diag } = await sb.rpc("lax_agent_diag", { p_token: token });
    if (!diag || (diag as Any).error) return json({ ok: false, error: "This trip link isn't active." }, 404);
  }
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb.from("trip_voice_sessions").select("key", { count: "exact", head: true }).eq("token", token).gte("created_at", since);
  // Opening the card starts a call, so a guest who opens and closes it a few times uses several sessions.
  // Demo pages get more room: the host tests and shows them off.
  if ((count ?? 0) >= (demo ? 40 : 20)) return json({ ok: false, error: "Leo is busy on this trip right now. Try again in a few minutes, or message your host in the Turo app." }, 429);

  const aid = await agentId();
  const key = await xiKey();
  if (!aid || !key) return json({ ok: false, error: "Leo isn't available right now. Try again in a minute, or message your host in the Turo app." }, 503);
  const r = await fetch(`${XI}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(aid)}`, { headers: { "xi-api-key": key } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signed_url) {
    await sb.rpc("bestly_raise", { p_key: `agent.line.${AGENT_SLUG}`, p_kind: "problem", p_severity: "warning",
      p_title: "Leo: guests can't start a voice chat", p_body: `The voice platform refused a session (${r.status}).`, p_area: "agents" }).then(() => {}, () => {});
    return json({ ok: false, error: "Leo isn't available right now. Try again in a minute, or message your host in the Turo app." }, 502);
  }
  const sessionKey = `tv_${hex(24)}`;
  const ins = await sb.from("trip_voice_sessions").insert({ key: sessionKey, agent_slug: AGENT_SLUG, token });
  if (ins.error) return json({ ok: false, error: "Leo isn't available right now. Try again in a minute, or message your host in the Turo app." }, 500);
  return json({ ok: true, signed_url: j.signed_url, key: sessionKey });
}

// ---------- door 2: Leo's tools ----------
async function session(b: Any): Promise<Session | Response> {
  const k = clip(b.trip_key, 80);
  const conv = clip(b.conversation_id, 80);
  if (!/^tv_[0-9a-f]{48}$/.test(k)) return json(NO_TRIP);
  if (!/^conv_[A-Za-z0-9]+$/.test(conv)) return json({ ok: false, error: "no conversation" }, 401);
  const { data: s } = await sb.from("trip_voice_sessions").select("key, token, conversation_id, expires_at").eq("key", k).maybeSingle();
  if (!s || Date.parse(s.expires_at) < Date.now()) return json({ ok: false, error: "This chat timed out. Ask the guest to tap Talk to our team 24/7 again." });
  if (s.conversation_id) return s.conversation_id === conv ? s as Session : json({ ok: false, error: "wrong conversation" }, 401);

  // First tool call of this conversation: confirm with the voice platform, then bind.
  const [aid, key] = await Promise.all([agentId(), xiKey()]);
  if (!aid || !key) return json({ ok: false, error: "tools unavailable" }, 503);
  const r = await fetch(`${XI}/convai/conversations/${conv}`, { headers: { "xi-api-key": key } });
  if (!r.ok) return json({ ok: false, error: "unknown conversation" }, 401);
  const c = await r.json().catch(() => ({}));
  const started = Number(c?.metadata?.start_time_unix_secs ?? 0) * 1000;
  if (c?.agent_id !== aid || !started || Date.now() - started > 2 * 3600_000) return json({ ok: false, error: "not a live Leo call" }, 401);
  const up = await sb.from("trip_voice_sessions").update({ conversation_id: conv }).eq("key", k).is("conversation_id", null).select("key");
  if (up.error || !up.data?.length) return json({ ok: false, error: "wrong conversation" }, 401);
  return { ...(s as Session), conversation_id: conv };
}

async function run(token: string, name: string, args: Any): Promise<unknown> {
  if (token.startsWith("demo:")) return (await sb.rpc("lax_demo_tool", { p_link: "d:" + token.slice(5), p_name: name, p_args: args })).data;
  const act = async (a: string, note?: unknown) => (await sb.rpc("lax_agent_act", { p_token: token, p_action: a, p_note: note ? clip(note, 300) : null })).data;
  switch (name) {
    case "diagnose": return (await sb.rpc("lax_agent_diag", { p_token: token })).data;
    case "check_key": case "refresh_car": return await act(name);
    case "resend_key": case "make_key_now": case "notify_host": return await act(name, args.reason ?? args.summary);
    case "job_status": {
      let last: unknown = null;
      for (let i = 0; i < 10; i++) {
        last = (await sb.rpc("lax_agent_job", { p_token: token, p_job: Number(args.job) })).data;
        const st = (last as { status?: string } | null)?.status;
        if (st === "done" || st === "failed") return last;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return { ...((last as object) ?? {}), note: "still running; it usually finishes within a minute" };
    }
    default: {
      if (!name.startsWith("driver_")) return { error: "unknown tool" };
      return (await sb.rpc("lax_agent_driver", { p_token: token, p_action: name.slice(7), p_name: args.name ? clip(args.name, 60) : null,
        p_value: args.summary ? clip(args.summary, 300) : null })).data;
    }
  }
}

const KEY_FIX = new Set(["check_key", "resend_key", "make_key_now", "refresh_car"]);
const DRIVER = new Set(["status", "check", "resend", "notify_host"]);
// ---------- car tools (2026-10-11): same rules and command path as the trip page's own buttons ----------
// Real trips call lax_guest_car_command / lax_guest_car_job / lax_guest_public / trip_superchargers with the guest's
// trip token, exactly like the page, so Leo can never do more than the page allows at that moment (controls open
// 1 hour before pickup or once the phone key connects, daily limit, one command at a time). Demo trips use the
// pretend car (leo_demo_car). Unlock is never a voice action. Every result carries `say` (one plain line), `card`
// (what Leo's screen shows inline) and `toast` (the confirmation), so the page and the phone line tell the same story.
const CAR_TOOLS = new Set(["car_status", "car_lock", "car_climate", "find_superchargers", "send_to_car_nav", "charging_summary", "send_sms"]);
const PRESET: Record<string, { label: string; f: number | null }> = {
  cool: { label: "A/C on, cooling to 68°F", f: 68 }, warm: { label: "Heat on, warming to 74°F", f: 74 },
  seat: { label: "Driver seat heater on", f: null }, off: { label: "Climate off", f: null },
};
const LA_TZ = "America/Los_Angeles";
const t12 = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: LA_TZ }) : null);
const day12 = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: LA_TZ });
const niceSite = (n: string) => n.replace(/, CA\b/, "").replace(/^Los Angeles - /, "");
const rpcData = async (fn: string, args: Any) => (await sb.rpc(fn, args)).data as Any | null;

function climateMode(action: string, target: unknown): string | null {
  const a = action.toLowerCase();
  if (["cool", "start", "on"].includes(a)) return "cool";
  if (a === "warm") return "warm";
  if (a === "seat") return "seat";
  if (["off", "stop"].includes(a)) return "off";
  if (a === "set_temp") return Number(target ?? 70) <= 71 ? "cool" : "warm";
  return null;
}

/** Car card from the page's own car data (lax_car_public shape) or the pretend car. */
function carCard(c: Any, demo: boolean) {
  return { type: "car", demo, battery: c.battery ?? null, range_mi: c.range_real ?? c.range ?? c.range_mi ?? null,
    inside_f: c.inside_f ?? null, outside_f: c.outside_f ?? null, locked: c.locked ?? null,
    climate_on: c.climate_on ?? null, climate_mode: c.climate_mode ?? null, as_of: t12((c.observed_at as string) ?? new Date().toISOString()) };
}

async function waitJob(token: string, id: number, secs = 14): Promise<"done" | "failed" | "running"> {
  for (let i = 0; i < Math.ceil(secs / 1.5); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const j = await rpcData("lax_guest_car_job", { p_token: token, p_id: id });
    if (j?.status === "done") return "done";
    if (j?.status === "failed") return "failed";
  }
  return "running";
}

/** Send one page action for a real trip and report it the way the page would. */
async function pageCommand(token: string, action: string, okLine: string, card: Any, toast: string): Promise<Any> {
  const r = await rpcData("lax_guest_car_command", { p_token: token, p_action: action });
  if (!r?.ok) return { ok: false, say: String(r?.error ?? "I couldn't reach the car just now.") };
  if (!r.id) return { ok: true, say: okLine, card, toast };
  const st = await waitJob(token, Number(r.id));
  if (st === "failed") return { ok: false, say: "The car didn't take that one. I can try again, or let Jared know." };
  if (st === "running") return { ok: true, pending: true, say: "Sent. The car can take up to a minute to respond.", card: { ...card, pending: true }, toast };
  return { ok: true, say: okLine, card, toast };
}

async function carTool(name: string, token: string, b: Any): Promise<Any> {
  const demo = token.startsWith("demo:");
  const action = clip(b.action, 20).toLowerCase();
  if (name === "send_sms") return { ok: false, not_live: true, say: "I can't send texts yet. Everything is on your trip page." };
  if (name === "car_lock" && action === "unlock") {
    return { ok: false, say: "I can't unlock the car. Your Tesla app key does that. Want me to check your key?", card: { type: "notice", text: "Unlocking works through your Tesla app key." } };
  }

  if (demo) {
    const link = "d:" + token.slice(5);
    const args: Any = { action, target_temp_f: b.target_temp_f ?? null, destination: clip(b.destination, 120) };
    const r = (await sb.rpc("leo_demo_car", { p_link: link, p_name: name, p_args: args })).data as Any | null;
    if (!r?.ok) return { ok: false, say: String(r?.error ?? "That didn't work on the demo car.") };
    const c = (r.car ?? {}) as Any;
    switch (name) {
      case "car_status": return { ok: true, demo: true, say: `Demo car: ${c.battery}% with about ${c.range_mi} miles, ${c.inside_f}°F inside, ${c.locked ? "locked" : "unlocked"}.`, card: carCard(c, true) };
      case "car_climate": {
        const m = String(c.climate_on ? c.climate_mode : "off");
        return { ok: true, demo: true, say: m === "off" ? "Climate is off on the demo car." : `${PRESET[m]?.label ?? "Done"} on the demo car. It turns off by itself after 20 minutes.`,
          card: { type: "climate", demo: true, on: !!c.climate_on, mode: m, target_f: PRESET[m]?.f ?? null, until: t12(c.climate_until as string) },
          toast: `Leo: ${PRESET[m]?.label ?? "Climate updated"}` };
      }
      case "car_lock": return { ok: true, demo: true, say: "Done, the demo car is locked.", card: { type: "lock", demo: true, locked: true }, toast: "Leo locked the car" };
      case "find_superchargers": {
        const sites = ((r.sites ?? []) as Any[]).map((s) => ({ name: niceSite(String(s.name)), miles: s.miles, open: s.open, total: s.total }));
        return { ok: true, demo: true, say: `The closest is ${sites[0]?.name}, ${sites[0]?.miles} miles away. Want me to send it to the car?`, card: { type: "superchargers", demo: true, sites } };
      }
      case "send_to_car_nav": return { ok: true, demo: true, say: `Sent ${clip(b.destination, 80)} to the demo car's screen.`, card: { type: "nav", demo: true, destination: clip(b.destination, 80) }, toast: "Leo sent it to the car's navigation" };
      case "charging_summary": {
        const ch = r.charging as Any;
        return { ok: true, demo: true, say: `Demo trip: ${ch.count} Supercharger stops, $${Number(ch.total).toFixed(2)} so far. It's billed through Turo after the trip.`,
          card: { type: "charging", demo: true, total: ch.total, count: ch.count, kwh: ch.kwh, final: ch.final,
            sessions: ((ch.sessions ?? []) as Any[]).map((x) => ({ when: day12(String(x.started_at)), site: x.site, cost: x.cost })) } };
      }
    }
    return { ok: false, say: "I can't do that one." };
  }

  // Real trip: the page's own data and command path.
  const pub = await rpcData("lax_guest_public", { p_token: token });
  if (!pub?.ok) return { ok: false, say: "I can't find this trip. Open your trip page and try again." };
  const ctl = String(pub.controls_state ?? "off");
  const opens = t12(pub.controls_opens_at as string);
  const closedLine = ctl === "soon" && opens ? `Car controls open at ${opens}, an hour before pickup or once your phone key is connected.`
    : ctl === "ended" ? "Your trip is over, so car controls are off." : "Car controls are off right now.";

  switch (name) {
    case "car_status": {
      const c = pub.car as Any | null;
      if (!c) return { ok: false, say: closedLine };
      return { ok: true, say: `${c.battery}% with about ${c.range_real ?? c.range} miles. It's ${c.inside_f}°F inside and ${c.locked ? "locked" : "unlocked"}.`, card: carCard(c, false) };
    }
    case "car_climate": {
      const m = climateMode(action, b.target_temp_f);
      if (!m) return { ok: false, say: "I can cool it to 68°F, warm it to 74°F, turn on the seat heater, or turn climate off." };
      if (ctl !== "on") return { ok: false, say: closedLine };
      return await pageCommand(token, m, m === "off" ? "Climate is off." : `${PRESET[m].label}. It turns off by itself after 20 minutes.`,
        { type: "climate", demo: false, on: m !== "off", mode: m, target_f: PRESET[m].f }, `Leo: ${PRESET[m].label}`);
    }
    case "car_lock": {
      if (ctl !== "on") return { ok: false, say: closedLine };
      return await pageCommand(token, "lock", "Done, the car is locked.", { type: "lock", demo: false, locked: true }, "Leo locked the car");
    }
    case "find_superchargers": case "send_to_car_nav": {
      const dest = clip(b.destination, 120).toLowerCase();
      if (name === "send_to_car_nav" && !/super|charg/.test(dest)) {
        const kind = String(pub.kind ?? "lax");
        const preset = /garage|lax|airport|park/.test(dest) && kind === "lax" ? "nav_garage_lax" : /home|kings|return|drop/.test(dest) && kind === "home" ? "nav_home" : null;
        if (!preset) return { ok: false, say: "I can send the nearest Supercharger or the return spot to the car. For anywhere else, type it on the car's screen." };
        if (ctl !== "on") return { ok: false, say: closedLine };
        const where = preset === "nav_home" ? "The return spot" : "The garage";
        return await pageCommand(token, preset, `${where} is in the car's navigation.`, { type: "nav", demo: false, destination: where }, "Leo sent it to the car's navigation");
      }
      if (ctl !== "on") return { ok: false, say: closedLine };
      let sites: Any[] | null = null;
      for (let i = 0; i < 5 && !sites; i++) {
        const r = await rpcData("trip_superchargers", { p_token: token });
        if (!r?.ok || r.asleep) return { ok: false, say: "The car is asleep, so I can't see nearby Superchargers yet. The car's screen lists them too." };
        if (Array.isArray(r.sites)) sites = (r.sites as Any[]).filter((s) => !s.closed);
        else await new Promise((res) => setTimeout(res, 2000));
      }
      if (!sites?.length) return { ok: false, say: "I couldn't load nearby Superchargers just now. The car's screen lists them too." };
      const byDist = [...sites].sort((a, z) => Number(a.miles) - Number(z.miles));
      if (name === "find_superchargers") {
        const top = byDist.slice(0, 3).map((s) => ({ name: niceSite(String(s.name)), miles: s.miles, open: s.open, total: s.total }));
        return { ok: true, say: `The closest is ${top[0].name}, ${Number(top[0].miles).toFixed(1)} miles away. Want me to send it to the car?`, card: { type: "superchargers", demo: false, sites: top } };
      }
      const named = byDist.find((s) => dest && niceSite(String(s.name)).toLowerCase().split(/[\s,-]+/).some((w) => w.length > 3 && dest.includes(w)));
      const pick = named ?? byDist.find((s) => Number(s.open ?? 1) > 0) ?? byDist[0];
      const r = await rpcData("trip_supercharger_nav", { p_token: token, p_lat: pick.lat, p_lon: pick.lon });
      if (!r?.ok) return { ok: false, say: String(r?.error ?? "I couldn't send it to the car.") };
      const label = niceSite(String(pick.name));
      const st = r.id ? await waitJob(token, Number(r.id)) : "done";
      if (st === "failed") return { ok: false, say: "The car didn't take that one. You can tap it on the car's screen instead." };
      return { ok: true, say: `${label} Supercharger is in the car's navigation.`, card: { type: "nav", demo: false, destination: `${label} Supercharger`, pending: st === "running" }, toast: "Leo sent it to the car's navigation" };
    }
    case "charging_summary": {
      const ch = pub.charging as Any | null;
      if (!ch) return { ok: true, say: "No Supercharging on this trip yet.", card: { type: "charging", demo: false, total: 0, count: 0, kwh: 0, final: false, sessions: [] } };
      const sessions = ((ch.sessions ?? []) as Any[]).map((x) => ({ when: x.started_at ? day12(String(x.started_at)) : "", site: x.site ?? x.name ?? "", cost: x.cost ?? x.total ?? null }));
      return { ok: true, say: `${ch.count} Supercharger ${Number(ch.count) === 1 ? "stop" : "stops"}, $${Number(ch.total ?? 0).toFixed(2)} so far. It's billed through Turo after your trip.`,
        card: { type: "charging", demo: false, total: ch.total, count: ch.count, kwh: ch.kwh, final: ch.final, sessions } };
    }
  }
  return { ok: false, say: "I can't do that one." };
}

/** Leo's screen: buttons on his inline cards run the same tools with the trip token (same power as the page's buttons). */
const SCREEN_TOOLS = new Set(["car_status", "car_climate", "car_lock", "find_superchargers", "send_to_car_nav", "charging_summary"]);
async function screenAct(b: Any): Promise<Response> {
  const raw = clip(b.token, 120);
  const tool = clip(b.tool, 30);
  if (!raw || !SCREEN_TOOLS.has(tool)) return json({ ok: false, say: "That isn't available." }, 400);
  const demo = /^demo-(home|lax)$/.test(raw);
  const args = (b.args ?? {}) as Any;
  return json(await carTool(tool, demo ? `demo:${raw}` : raw, args));
}

async function tool(name: string, b: Any): Promise<Response> {
  const s = await session(b);
  if (s instanceof Response) return s;
  const t = s.token;
  try {
    if (CAR_TOOLS.has(name)) return json(await carTool(name, t, b));
    switch (name) {
      case "trip_status": return json({ ok: true, status: await run(t, "diagnose", {}) });
      case "key_fix": {
        const action = clip(b.action, 20);
        if (!KEY_FIX.has(action)) return json({ ok: false, error: "action must be check_key, resend_key, make_key_now or refresh_car" });
        return json({ ok: true, result: await run(t, action, { reason: clip(b.reason, 200) || "guest asked Leo by voice" }) });
      }
      case "job_status": return json({ ok: true, result: await run(t, "job_status", { job: Number(b.job) }) });
      case "extra_driver": {
        const action = clip(b.action, 20);
        if (!DRIVER.has(action)) return json({ ok: false, error: "action must be status, check, resend or notify_host" });
        return json({ ok: true, result: await run(t, `driver_${action}`, { name: b.name, summary: b.summary }) });
      }
      case "notify_host": return json({ ok: true, result: await run(t, "notify_host", { summary: `Leo (voice): ${clip(b.summary, 280)}` }) });
      case "file_ticket": {
        const { count } = await sb.from("support_tickets").select("id", { count: "exact", head: true }).eq("conversation_id", s.conversation_id);
        if ((count ?? 0) >= 3) return json({ ok: false, error: "too many tickets on this call" }, 429);
        if (t.startsWith("demo:")) return json({ ok: true, ticket: "DEMO-0000", kind: clip(b.kind, 20) || "support", follow_up: "today", note: "demo page: nothing was saved" });
        const { data, error } = await sb.rpc("leo_file_ticket", { p: { kind: clip(b.kind, 20), name: clip(b.name, 80), phone: clip(b.phone, 30),
          email: clip(b.email, 120), issue: clip(b.issue, 1000), conversation_id: s.conversation_id } });
        if (error) {
          await sb.rpc("bestly_raise", { p_key: `agent.line.${AGENT_SLUG}`, p_kind: "problem", p_severity: "warning",
            p_title: "Leo: I couldn't save a guest's ticket", p_body: error.message.slice(0, 300), p_area: "agents" }).then(() => {}, () => {});
          return json({ ok: false, error: "could not save" }, 500);
        }
        return json(data);
      }
      default: return json({ ok: false, error: "unknown tool" }, 404);
    }
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "That didn't work. Offer to take a message for the host." }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const b = (await req.json().catch(() => ({}))) as Any;
  req_ua = req.headers.get("user-agent") ?? "";
  const t = new URL(req.url).searchParams.get("tool");
  if (t) return tool(t, b);
  if (b.op === "session") return openSession(b);
  if (b.op === "act") return screenAct(b);
  if (b.op === "diag") {
    // What Leo's widget hit on a real device (CSP block, widget error text). Small, capped, no personal data.
    const kind = clip(b.kind, 30) || "error";
    const { count } = await sb.from("leo_client_diag").select("id", { count: "exact", head: true }).gte("at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) < 300) await sb.from("leo_client_diag").insert({ token: clip(b.token, 60) || null, kind,
      detail: { msg: clip((b.detail as Any)?.msg, 400), blocked: clip((b.detail as Any)?.blocked, 300), directive: clip((b.detail as Any)?.directive, 80),
        source: clip((b.detail as Any)?.source, 300) }, ua: clip(req_ua, 200) });
    return json({ ok: true });
  }
  return json({ ok: false, error: "unknown request" }, 400);
});
