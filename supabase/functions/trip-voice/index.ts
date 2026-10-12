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
//   POST {op:"selftest"}                  hourly watchdog (cron leo-demo-parity): drives the DEMO car only, checks unlock is still
//                                         refused for real trips, raises/clears leo.demo-parity signed Leo.
//
// Open demo (leo_demo_open(), temporary, expires by itself): on demo-home / demo-lax only, car_lock unlock works on the
// pretend car and the session cap is 200/hour instead of 40. Real trips never unlock.
//
// Tools: trip_status, key_fix, job_status, extra_driver, notify_host, file_ticket, reminder_email, and the car tools car_status,
//        car_climate (page presets), car_lock (lock only), find_superchargers, send_to_car_nav, charging_summary,
//        send_sms (fixed-link texts to the trip page; off until leo_settings.sms_mode is switched on and the 10DLC watchdog says ready). Real trips go through the page's own gate (lax_guest_car_command); demo trips use the
//        pretend car (leo_demo_car). Phone calls get their trip_key from leo-phone-init instead of door 1.
//
// Session channels (trip_voice_sessions.channel, enforced here in tool() and run(), never in the prompt). Caller ID can be spoofed, so:
//   page           the guest's own trip link: every tool.
//   phone          caller's number matched a trip: trip_status (no key detail, no car, no stops), notify_host, file_ticket, reminder_email
//                  (status and send_now to an email already on file; never "set"). No car, key, nav or text tools: they get a plain sentence pointing at the trip page link.
//   phone_unknown  nobody matched: file_ticket and notify_host (files a callback ticket) only.
//   page_unknown   a real trip link whose trip is gone (link-down page, 2026-10-11): same scope as phone_unknown,
//                  10 sessions per link and 60 in all per hour. Made-up tokens still get no session.
//   phone_test     Jared's own cell on the demo trip and pretend car: every tool.
// Every failed result carries ok:false and a say line starting "Not sent:" or "Didn't work:". Every call is counted in leo_tool_log (no personal
// data) for the leo-health watchdog (pg_cron every 10 min, raises signed Leo alerts).
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
const NO_TRIP = { ok: false, say: "Didn't work: I can't see a trip on this chat. If the guest is on the phone, offer to take a message for the host (file_ticket). If they are on the trip page, ask them to open the trip link from their Turo message and talk to me from there.",
  error: "No trip is linked to this chat." };

type Session = { key: string; token: string; conversation_id: string | null; expires_at: string; channel: string };
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

/** One row per tool call for the leo-health watchdog. No names, phones, emails or tokens. code: ok | refused | error | no_trip | session | expired */
async function logTool(tool: string, channel: string, demo: boolean, ok: boolean, code: string) {
  await sb.from("leo_tool_log").insert({ tool: tool.slice(0, 40), channel, demo, ok, code }).then(() => {}, () => {});
}

// ---------- door 1: the trip page asks for a session ----------
async function openSession(b: Any): Promise<Response> {
  const raw = clip(b.token, 120);
  if (!raw) return json({ ok: false, error: "Open your trip link to talk to Leo." }, 400);
  const demo = /^demo-(home|lax)$/.test(raw);
  const token = demo ? `demo:${raw}` : raw;
  // 2026-10-11 link-down pages: a real trip link whose trip is gone (changed, rebooked, canceled, long over) still gets
  // Leo, on a limited channel (page_unknown): take a message for the host, nothing else. Made-up tokens get nothing.
  let channel = "page";
  if (!demo) {
    // A link whose trip is gone still passes lax_agent_diag, so ask the page's own check first.
    const { data: pub } = await sb.rpc("lax_guest_public", { p_token: token });
    const { data: diag } = (pub as Any | null)?.ok ? await sb.rpc("lax_agent_diag", { p_token: token }) : { data: null };
    if (!diag || (diag as Any).error) {
      const { data: link } = await sb.from("lax_guest_links").select("reservation_id").eq("token", token).maybeSingle();
      if (!link) return json({ ok: false, error: "This trip link isn't active." }, 404);
      channel = "page_unknown";
    }
  }
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb.from("trip_voice_sessions").select("key", { count: "exact", head: true }).eq("token", token).gte("created_at", since);
  // Opening the card starts a call, so a guest who opens and closes it a few times uses several sessions.
  // Demo pages get more room: the host tests and shows them off (200 an hour while the open demo is on).
  const cap = demo ? ((await demoOpen()) ? 200 : 40) : channel === "page_unknown" ? 10 : 20;
  if ((count ?? 0) >= cap) return json({ ok: false, error: "Leo is busy on this trip right now. Try again in a few minutes, or message your host in the Turo app." }, 429);
  if (channel === "page_unknown") {
    const { count: all } = await sb.from("trip_voice_sessions").select("key", { count: "exact", head: true }).eq("channel", "page_unknown").gte("created_at", since);
    if ((all ?? 0) >= 60) return json({ ok: false, error: "Leo is busy right now. Try again in a few minutes, or message your host in the Turo app." }, 429);
  }

  const aid = await agentId();
  const key = await xiKey();
  if (!aid || !key) return json({ ok: false, error: "Leo isn't available right now. Try again in a minute, or message your host in the Turo app." }, 503);
  const r = await fetch(`${XI}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(aid)}`, { headers: { "xi-api-key": key } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signed_url) {
    await sb.rpc("bestly_raise", { p_key: `agent.line.${AGENT_SLUG}`, p_kind: "problem", p_severity: "warning",
      p_title: "Leo: guests can't start a voice chat", p_body: `The voice platform refused a session (${r.status}).`, p_area: "agents" }).then(() => {}, () => {});
    await logTool("session_open", "page", demo, false, "error");
    return json({ ok: false, error: "Leo isn't available right now. Try again in a minute, or message your host in the Turo app." }, 502);
  }
  const sessionKey = `tv_${hex(24)}`;
  const ins = await sb.from("trip_voice_sessions").insert({ key: sessionKey, agent_slug: AGENT_SLUG, token, channel });
  if (ins.error) { await logTool("session_open", "page", demo, false, "error"); return json({ ok: false, error: "Leo isn't available right now. Try again in a minute, or message your host in the Turo app." }, 500); }
  return json({ ok: true, signed_url: j.signed_url, key: sessionKey });
}

// ---------- door 2: Leo's tools ----------
async function session(b: Any, name = "?"): Promise<Session | Response> {
  const k = clip(b.trip_key, 80);
  const conv = clip(b.conversation_id, 80);
  if (!/^tv_[0-9a-f]{48}$/.test(k)) { await logTool(name, "unknown", false, false, "no_trip"); return json(NO_TRIP); }
  if (!/^conv_[A-Za-z0-9]+$/.test(conv)) { await logTool(name, "unknown", false, false, "session"); return json({ ok: false, say: "Didn't work: I lost the connection to this call's details. Offer to take a message for the host.", error: "no conversation" }, 401); }
  const { data: s } = await sb.from("trip_voice_sessions").select("key, token, conversation_id, expires_at, channel").eq("key", k).maybeSingle();
  if (!s || Date.parse(s.expires_at) < Date.now()) {
    await logTool(name, s?.channel ?? "unknown", String(s?.token ?? "").startsWith("demo:"), false, s ? "expired" : "no_trip");
    return json({ ok: false, error: "This chat timed out.", say: s?.channel?.startsWith("phone")
      ? "Didn't work: this call has been going a long time and my access timed out. Offer to take a message for the host, or ask the guest to call back."
      : "Didn't work: this chat timed out. Ask the guest to close and reopen Leo from their trip page (the trip link in their Turo message)." });
  }
  const sFail = async (err: string, say: string) => { await logTool(name, s.channel, String(s.token).startsWith("demo:"), false, "session"); return json({ ok: false, error: err, say }, 401); };
  if (s.conversation_id) return s.conversation_id === conv ? s as Session : await sFail("wrong conversation", "Didn't work: I can't verify this call. Offer to take a message for the host.");

  // First tool call of this conversation: confirm with the voice platform, then bind.
  const [aid, key] = await Promise.all([agentId(), xiKey()]);
  if (!aid || !key) { await logTool(name, s.channel, String(s.token).startsWith("demo:"), false, "error"); return json({ ok: false, error: "tools unavailable", say: "Didn't work: my tools are unavailable right now. Offer to take a message for the host." }, 503); }
  const r = await fetch(`${XI}/convai/conversations/${conv}`, { headers: { "xi-api-key": key } });
  if (!r.ok) return await sFail("unknown conversation", "Didn't work: I can't verify this call. Offer to take a message for the host.");
  const c = await r.json().catch(() => ({}));
  const started = Number(c?.metadata?.start_time_unix_secs ?? 0) * 1000;
  if (c?.agent_id !== aid || !started || Date.now() - started > 2 * 3600_000) return await sFail("not a live Leo call", "Didn't work: I can't verify this call. Offer to take a message for the host.");
  const up = await sb.from("trip_voice_sessions").update({ conversation_id: conv }).eq("key", k).is("conversation_id", null).select("key");
  if (up.error || !up.data?.length) {
    // Two tools fired at once at the start of a chat: the other call bound it first. Same conversation is fine.
    const { data: again } = await sb.from("trip_voice_sessions").select("conversation_id").eq("key", k).maybeSingle();
    if (again?.conversation_id !== conv) return await sFail("wrong conversation", "Didn't work: I can't verify this call. Offer to take a message for the host.");
  }
  return { ...(s as Session), conversation_id: conv };
}

// ---------- scopes (see header): phone sessions never reach the key, the car, nav or texts ----------
const PHONE_TOOLS = new Set(["trip_status", "notify_host", "file_ticket", "reminder_email"]);
const UNKNOWN_TOOLS = new Set(["file_ticket", "notify_host"]);
const PHONE_REFUSE = "Didn't work: I can't do that over the phone. Your trip page link, the one in your Turo message, does that. Or I can have your host get back to you. Want me to take a message?";
const LINK_DOWN_REFUSE = "Didn't work: this trip link no longer works, so I can't see the trip or the car from here. They can sign in again at bestly.tech/turo-key (home pickup) or bestly.tech/turo-lax (LAX) with their phone number and last name. Or I can take a message for the host: ask for their name and best number.";
const UNKNOWN_REFUSE ="Didn't work: I can't look up trips or run anything on this call, but I can take a message for the host. What's your name and the best number to reach you?";
function scopeRefusal(channel: string, name: string): Any | null {
  if (channel === "phone" && !PHONE_TOOLS.has(name)) return { ok: false, scope: true, error: "not available on a phone call", say: PHONE_REFUSE };
  if (channel === "phone_unknown" && !UNKNOWN_TOOLS.has(name)) return { ok: false, scope: true, error: "not available for an unmatched caller", say: UNKNOWN_REFUSE };
  if (channel === "page_unknown" && !UNKNOWN_TOOLS.has(name)) return { ok: false, scope: true, error: "not available on a link that no longer works", say: LINK_DOWN_REFUSE };
  return null;
}
/** What Leo receives from the trip lookup: no internal system state, and on the phone only a thin, key-free view. */
function leoStatus(d: unknown, channel: string): Any {
  const x = (d && typeof d === "object" ? { ...(d as Any) } : {}) as Any;
  if (!d || x.error) return { ok: false, error: String(x.error ?? "no data"), say: "Didn't work: I can't find this trip right now. Offer to take a message for the host." };
  const sys = (x.systems ?? {}) as Any;
  delete x.systems; delete x.recent_jobs;
  x.car_reachable = typeof sys.mac_helper_online === "boolean" ? sys.mac_helper_online : true;
  if (x.key && typeof x.key === "object") { x.key = { ...(x.key as Any) }; delete (x.key as Any).last_error; }
  if (channel !== "phone") return { ok: true, status: x };
  // Phone: caller ID can be faked, so no key link or invite detail, no car data, no driver names, no stop locations.
  const k = (x.key ?? {}) as Any; const held = (k.held ?? null) as Any | null; const sc = (x.supercharging ?? {}) as Any;
  return { ok: true, status: { now: x.now, trip: x.trip,
    key: { status: k.status, meaning: k.meaning, ...(held ? { held: { tell_guest: held.tell_guest, waiting_on_license: held.waiting_on_license, waiting_on_host_checkin: held.waiting_on_host_checkin } } : {}) },
    buttons: x.buttons, car_reachable: x.car_reachable,
    supercharging: { total_usd: sc.total_usd, stops: sc.stops, amounts_are: sc.amounts_are, note: sc.note },
    phone_note: "This is a phone call, so I can't see or send the key link or run the car. The trip page link in their Turo message does those." } };
}

async function run(token: string, name: string, args: Any, channel = "page"): Promise<unknown> {
  const refuse = scopeRefusal(channel, name === "diagnose" ? "trip_status" : name);
  if (refuse) return refuse;
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
const CAR_TOOLS = new Set(["car_status", "car_lock", "car_climate", "find_superchargers", "send_to_car_nav", "charging_summary"]);
const PRESET: Record<string, { label: string; f: number | null }> = {
  cool: { label: "A/C on, cooling to 68°F", f: 68 }, warm: { label: "Heat on, warming to 74°F", f: 74 },
  seat: { label: "Driver seat heater on", f: null }, off: { label: "Climate off", f: null },
};
const LA_TZ = "America/Los_Angeles";
const t12 = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: LA_TZ }) : null);
const day12 = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: LA_TZ });
const niceSite = (n: string) => n.replace(/, CA\b/, "").replace(/^Los Angeles - /, "");
/** Temporary open demo (leo_demo_open): true while the host has the demo page wide open. Demo tokens only ever ask. */
const demoOpen = async (): Promise<boolean> => {
  const { data } = await sb.rpc("leo_demo_open");
  return !!(data as { open?: boolean } | null)?.open;
};
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
  if (!r?.ok) return { ok: false, broken: !r?.error, say: String(r?.error ?? "I couldn't reach the car just now.") };
  if (!r.id) return { ok: true, say: okLine, card, toast };
  const st = await waitJob(token, Number(r.id));
  if (st === "failed") return { ok: false, broken: true, say: "The car didn't take that one. I can try again, or let Jared know." };
  if (st === "running") return { ok: true, pending: true, say: "Sent. The car can take up to a minute to respond.", card: { ...card, pending: true }, toast };
  return { ok: true, say: okLine, card, toast };
}

async function carTool(name: string, token: string, b: Any): Promise<Any> {
  const demo = token.startsWith("demo:");
  const action = clip(b.action, 20).toLowerCase();
  if (name === "car_lock" && action === "unlock" && !(demo && await demoOpen())) {
    return { ok: false, say: "I can't unlock the car. Your Tesla app key does that. Want me to check your key?", card: { type: "notice", text: "Unlocking works through your Tesla app key." } };
  }

  if (demo) {
    const link = "d:" + token.slice(5);
    const args: Any = { action, target_temp_f: b.target_temp_f ?? null, destination: clip(b.destination, 120) };
    const r = (await sb.rpc("leo_demo_car", { p_link: link, p_name: name, p_args: args })).data as Any | null;
    if (!r?.ok) return { ok: false, say: String(r?.error ?? "That didn't work on the demo car.") };
    const c = (r.car ?? {}) as Any;
    switch (name) {
      case "car_status": return { ok: true, demo: true, say: `The demo car's battery is at ${c.battery}%, about ${c.range_mi} miles of range. It's ${c.inside_f}°F inside and the car is ${c.locked ? "locked" : "unlocked"}.`, card: carCard(c, true) };
      case "car_climate": {
        const m = String(c.climate_on ? c.climate_mode : "off");
        return { ok: true, demo: true, say: m === "off" ? "Climate is off on the demo car." : `${PRESET[m]?.label ?? "Done"} on the demo car. It turns off by itself after 20 minutes.`,
          card: { type: "climate", demo: true, on: !!c.climate_on, mode: m, target_f: PRESET[m]?.f ?? null, until: t12(c.climate_until as string) },
          toast: `Leo: ${PRESET[m]?.label ?? "Climate updated"}` };
      }
      case "car_lock":
        if (action === "unlock") return { ok: true, demo: true, say: "Unlocked the demo car. On a real trip, your Tesla app key does this.", card: { type: "lock", demo: true, locked: false }, toast: "Leo unlocked the demo car" };
        return { ok: true, demo: true, say: "Done, the demo car is locked.", card: { type: "lock", demo: true, locked: true }, toast: "Leo locked the car" };
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
      return { ok: true, say: `The battery is at ${c.battery}%, about ${c.range_real ?? c.range} miles of range. It's ${c.inside_f}°F inside and the car is ${c.locked ? "locked" : "unlocked"}.`, card: carCard(c, false) };
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

// ---------- reminder_email (2026-10-11): Turo guests never give us an email, so Leo collects it ----------
// action "set"      save the email the guest spelled out (lax_guest_set_email: same rules as the trip page) and say when the
//                   reminder goes out (LAX: 4 hours before pickup, home: 1 hour before; lax-guest-tick sends it, every 10 min).
// action "send_now" send one reminder email right now through the existing senders (wallet-pass remind_due for LAX trips,
//                   trip-remind for home trips). Max 2 per trip per rolling day (leo_reminder_log, which holds no emails).
// action "status"   is an email on file (masked), when the reminder is scheduled or was sent.
// Trip-scoped by the session's token only. A full address is never said or returned back; demo trips send nothing.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const maskEmail = (e: string) => `${e.split("@")[0].slice(0, 1)}***@${e.split("@")[1] ?? ""}`;
const sayEmail = (e: string) => `${e.split("@")[0].slice(0, 1)} at ${e.split("@")[1] ?? ""}`;
const laDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: LA_TZ });
/** "today at 3:05 PM", "tomorrow at 8:00 AM", "Tue, Oct 14 at 8:00 AM" (Pacific, 12-hour). */
function whenPhrase(iso: string): string {
  const d = new Date(iso);
  const day = laDate(d) === laDate(new Date()) ? "today" : laDate(d) === laDate(new Date(Date.now() + 86400_000)) ? "tomorrow"
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: LA_TZ });
  return `${day} at ${t12(iso)}`;
}
const cleanSpokenEmail = (v: unknown) => clip(v, 200).toLowerCase().replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s+/g, "");
const SENDER_FN = { lax: { fn: "wallet-pass", body: { op: "remind_due" } }, home: { fn: "trip-remind", body: {} } } as const;

async function reminderEmail(token: string, conv: string | null, b: Any, channel = "page"): Promise<Any> {
  const action = clip(b.action, 12).toLowerCase();
  if (!["set", "send_now", "status"].includes(action)) return { ok: false, say: "I can save an email, send the reminder now, or check what's saved." };
  // Caller ID can be faked and the reminder email carries the trip page link (key access): by phone an email is never added or changed.
  if (channel === "phone" && action === "set") return { ok: false, say: "For your security I can't add an email by phone. You can add it on your trip page's Reminder email card, from the link in your Turo message." };
  const demo = token.startsWith("demo:");
  const log = (a: string) => sb.from("leo_reminder_log").insert({ token, action: a, conversation_id: conv }).then(() => {}, () => {});

  // ---- demo pages: pretend, nothing real is saved or sent ----
  if (demo) {
    const home = token === "demo:demo-home";
    const lead = home ? "1 hour" : "4 hours";
    if (action === "set") {
      const e = cleanSpokenEmail(b.email);
      if (!EMAIL_RE.test(e)) return { ok: false, demo: true, say: "That email doesn't look right. Can you spell it again?" };
      await log("demo_set");
      return { ok: true, demo: true, email_masked: maskEmail(e), say: `Saved on the demo page. On a real trip the reminder goes out ${lead} before pickup. Nothing is emailed from the demo.` };
    }
    const { count } = await sb.from("leo_reminder_log").select("id", { count: "exact", head: true }).eq("token", token).eq("action", "demo_set").gte("at", new Date(Date.now() - 2 * 3600_000).toISOString());
    const has = (count ?? 0) > 0;
    if (action === "status") return { ok: true, demo: true, on_file: has, email_masked: has ? "d***@example.com" : null,
      say: has ? `Demo: an email is saved. The reminder would go out ${lead} before pickup.` : "Demo: no email saved yet." };
    if (!has) return { ok: false, demo: true, say: "I don't have an email yet. What's the best one to send it to?" };
    return { ok: true, demo: true, say: "Demo: that's what the reminder would do. Nothing is emailed from the demo page." };
  }

  // ---- real trip ----
  const { data: link } = await sb.from("lax_guest_links").select("reservation_id, email, reminder_at, reminder_sent_at, reminder_error, email_changes").eq("token", token).maybeSingle();
  if (!link) return { ok: false, say: "I can't find this trip. Open your trip page and try again." };
  const { data: trip } = await sb.from("turo_trips").select("starts_at, ends_at, airport_code").eq("reservation_id", link.reservation_id).maybeSingle();
  if (!trip) return { ok: false, say: "I can't find this trip. Open your trip page and try again." };
  const kind: "lax" | "home" = trip.airport_code === "LAX" ? "lax" : "home";
  const lead = kind === "home" ? "1 hour" : "4 hours";
  const ended = Date.parse(trip.ends_at) < Date.now();
  const started = Date.parse(trip.starts_at) < Date.now();

  if (action === "status") {
    const e = link.email as string | null;
    if (!e) return { ok: true, on_file: false, say: "There's no email on file for this trip yet." };
    const base = { ok: true, on_file: true, email_masked: maskEmail(e), reminder_at: link.reminder_at, sent_at: link.reminder_sent_at };
    if (link.reminder_sent_at) return { ...base, say: `A reminder went to the email starting with ${sayEmail(e)} ${whenPhrase(link.reminder_sent_at)}.` };
    if (String(link.reminder_error ?? "").startsWith("gave up")) return { ...base, failed: true, say: `I have the email starting with ${sayEmail(e)}, but the reminder didn't go through. I can try sending it now.` };
    if (link.reminder_at && !ended) return { ...base, say: Date.parse(link.reminder_at) <= Date.now() + 11 * 60_000
      ? `I have the email starting with ${sayEmail(e)}. The reminder goes out within about 10 minutes.`
      : `I have the email starting with ${sayEmail(e)}. The reminder goes out ${whenPhrase(link.reminder_at)}.` };
    return { ...base, say: `I have the email starting with ${sayEmail(e)}, but no reminder is scheduled${ended ? " because the trip is over" : started ? " because pickup has already started" : ""}.` };
  }

  if (action === "set") {
    const e = cleanSpokenEmail(b.email);
    if (!EMAIL_RE.test(e) || e.length > 200) return { ok: false, say: "That email doesn't look right. Can you spell it again?" };
    if (ended) return { ok: false, say: "This trip is over, so I can't set up a reminder." };
    const { data, error } = await sb.rpc("lax_guest_set_email", { p_token: token, p_email: e });
    if (error) return { ok: false, broken: !/changes|doesn't look|ended/i.test(error.message), say: /changes|doesn't look|ended/i.test(error.message) ? error.message.slice(0, 160) : "I couldn't save that email. Try the Reminder email card on your trip page." };
    await log("set");
    const at = (data as { reminder_at?: string | null } | null)?.reminder_at ?? null;
    const m = maskEmail(e);
    if (!at) return { ok: true, email_masked: m, scheduled: false, say: "Saved. Pickup has already started, so no reminder is scheduled. Want me to email it to you now?" };
    if (Date.parse(at) <= Date.now() + 60_000) return { ok: true, email_masked: m, scheduled: true, reminder_at: at, say: "Saved. Your reminder email goes out within about 10 minutes." };
    return { ok: true, email_masked: m, scheduled: true, reminder_at: at, say: `Saved. Your reminder email goes out ${whenPhrase(at)}, ${lead} before pickup.` };
  }

  // send_now
  const e = link.email as string | null;
  if (!e) return { ok: false, say: "I don't have an email yet. What's the best one to send it to?" };
  if (ended) return { ok: false, say: "This trip is over, so there's nothing to send." };
  if (kind === "home" && Date.parse(trip.starts_at) < Date.now() - 30 * 60_000) {
    return { ok: false, say: "The pickup email only goes out around pickup time, and your trip has started. Everything is on your trip page." };
  }
  const { count } = await sb.from("leo_reminder_log").select("id", { count: "exact", head: true }).eq("token", token).eq("action", "send_now").gte("at", new Date(Date.now() - 86400_000).toISOString());
  if ((count ?? 0) >= 2) return { ok: false, limit: true, say: "I've already sent two reminders for this trip today, which is the limit. Check your inbox and spam folder, or message your host in the Turo app." };
  await log("send_now");
  const t0 = Date.now() - 1000;
  await sb.from("lax_guest_links").update({ reminder_at: new Date().toISOString(), reminder_sent_at: null, reminder_error: null, reminder_attempts: 0 }).eq("reservation_id", link.reservation_id);
  const snd = SENDER_FN[kind];
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${snd.fn}`, { method: "POST", signal: AbortSignal.timeout(25_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET }, body: JSON.stringify(snd.body) });
    await r.text().catch(() => "");
  } catch { /* the check below decides what to say */ }
  const { data: after } = await sb.from("lax_guest_links").select("reminder_sent_at, reminder_error").eq("reservation_id", link.reservation_id).maybeSingle();
  if (after?.reminder_sent_at && Date.parse(after.reminder_sent_at) >= t0) return { ok: true, sent: true, say: `Sent to the email starting with ${sayEmail(e)}. It should land in a minute. Check spam if it doesn't.` };
  return { ok: false, sent: false, broken: true, say: "I couldn't send it just now. It will try again by itself within about 10 minutes, and you can also find everything on your trip page." };
}

// ---------- send_sms (2026-10-12): one short link to the guest's trip page, never free text. Ships OFF (leo_settings.sms_mode). ----------
// Leo never writes the text: the body is built here from a fixed purpose. Gates, in order: sms_mode/sms_ready (kill switch + 10DLC watchdog),
// opt-out/DNC list, 3 sends per trip per day, 2 number changes per trip per day, US numbers only, never Leo's own or Turo's line.
// Demo pages send nothing, except to the owner's own number when sms_mode allows it.
const LEO_FROM = "+13106227052", OWNER = "+18165007236", TURO_LINE = "+14159654525";
const PURPOSE: Record<string, [string, string]> = { trip_page: ["your trip page", ""], key: ["your Tesla key is on your trip page", ""],
  pickup_guide: ["your pickup guide", "#pickup"], return_checklist: ["your return checklist", "#return"] };
const e164 = (v: unknown) => { const d = String(v ?? "").replace(/\D/g, ""); const t = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(t) ? `+1${t}` : null; };
const smsText = (p: string, slug: string) => `Leo from Bestly: ${PURPOSE[p][0]}: bestly.tech/t/${slug}${PURPOSE[p][1]} Reply STOP to opt out.`;
const NOT_LIVE = { ok: false, not_live: true, say: "I can't send texts yet. It's all on your trip page, and I can email it to you instead." };
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const smsSettings = async () => (await sb.from("leo_settings").select("sms_mode, sms_ready, sms_profile_id, sms_campaign_id").eq("id", 1).maybeSingle()).data as Any | null;
const txKey = async () => { const { data } = await sb.rpc("ava_secret", { p_name: "telnyx_api_key" }); return typeof data === "string" ? data : null; };
const tx = async (path: string, init: RequestInit = {}) => { const k = await txKey(); if (!k) throw new Error("no telnyx key");
  const r = await fetch(`https://api.telnyx.com/v2${path}`, { ...init, signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${k}`, "content-type": "application/json" } });
  return { status: r.status, j: await r.json().catch(() => ({})) as Any }; };
async function telnyxSend(to: string, text: string, profile?: string | null) {
  const r = await tx("/messages", { method: "POST", body: JSON.stringify({ from: LEO_FROM, to, text, ...(profile ? { messaging_profile_id: profile } : {}) }) });
  const id = (r.j.data as Any)?.id as string | undefined;
  if (r.status >= 300 || !id) return { ok: false, code: String(((r.j.errors as Any[]) ?? [])[0]?.code ?? r.status) } as { ok: boolean; id?: string; status?: string; code?: string };
  let st = "queued";
  for (let i = 0; i < 3; i++) { await new Promise((z) => setTimeout(z, 1500));
    st = String((((await tx(`/messages/${id}`)).j.data as Any)?.to as Any[])?.[0]?.status ?? st);
    if (st !== "queued" && st !== "sending") break; }
  return { ok: !/failed/.test(st), id, status: st, code: /failed/.test(st) ? st : undefined } as { ok: boolean; id?: string; status?: string; code?: string };
}
/** Two failed sends in an hour: switch texting off by itself (sms_ready=false) and tell Jared. The hourly check turns it back on when Telnyx looks healthy. */
async function smsBreaker() {
  const { count } = await sb.from("leo_sms_log").select("id", { count: "exact", head: true }).eq("action", "failed").gte("at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) < 2) return;
  const { data: cur } = await sb.from("leo_settings").select("sms_detail").eq("id", 1).maybeSingle();
  await sb.from("leo_settings").update({ sms_ready: false, sms_detail: { ...((cur?.sms_detail as Any) ?? {}), breaker: true, breaker_at: new Date().toISOString() } }).eq("id", 1);
  await sb.rpc("bestly_raise", { p_key: "leo.sms", p_kind: "problem", p_severity: "warning", p_title: "Leo: I stopped sending texts",
    p_body: "Two texts failed within an hour, so I paused texting by myself. I will check the carrier again within the hour.", p_area: "agents", p_needs_jared: false, p_healed: false }).then(() => {}, () => {});
}
async function sendSms(token: string, conv: string | null, b: Any): Promise<Any> {
  const action = clip(b.action, 10), purpose = clip(b.purpose, 20), demo = token.startsWith("demo:");
  const slug = demo ? token.slice(5) : token;
  const log = (row: Any) => sb.from("leo_sms_log").insert({ token, conversation_id: conv, ...row }).then(() => {}, () => {});
  const given = b.phone ? e164(b.phone) : null;
  if (b.phone && !given) return { ok: false, say: "That number doesn't look right. I can only text US numbers. Can you say it again?" };
  if (given && (given === LEO_FROM || given === TURO_LINE)) return { ok: false, say: "I can't text that number. What's your mobile number?" };
  if (demo) {
    if (action === "status") return { ok: true, demo: true, on_file: false, say: "No number on file on the demo. What number should I text?" };
    if (!PURPOSE[purpose]) return { ok: false, say: "I can text your trip page, key, pickup guide or return checklist." };
    if (!given) return { ok: false, need_phone: true, say: "What number should I text? I'll read it back." };
    if (given !== OWNER) { await log({ action: "demo_send", purpose, to_last4: given.slice(-4) });
      return { ok: true, demo: true, sent: false, say: `Demo: I'd text the number ending in ${given.slice(-4)}. Nothing is sent from the demo.` }; }
  }
  let rid: number | null = null, target = given, ended = false, started = false, onFile: string | null = null;
  if (!demo) {
    const { data: link } = await sb.from("lax_guest_links").select("reservation_id, sms_phone").eq("token", token).maybeSingle();
    if (!link) return { ok: false, say: "I can't find this trip. Open your trip page and try again." };
    const { data: trip } = await sb.from("turo_trips").select("starts_at, ends_at, guest_phone").eq("reservation_id", link.reservation_id).maybeSingle();
    if (!trip) return { ok: false, say: "I can't find this trip. Open your trip page and try again." };
    rid = link.reservation_id; ended = Date.parse(trip.ends_at) < Date.now(); started = Date.parse(trip.starts_at) < Date.now();
    onFile = e164(link.sms_phone) ?? e164(trip.guest_phone);
    if (action === "status") return onFile ? { ok: true, on_file: true, phone_last4: onFile.slice(-4), say: `I can text the number ending in ${onFile.slice(-4)}. Is that your mobile?` }
      : { ok: true, on_file: false, say: "I don't have a number for texts. What's your mobile number?" };
    if (!PURPOSE[purpose]) return { ok: false, say: "I can text your trip page, key, pickup guide or return checklist." };
    if (ended) return { ok: false, say: "This trip is over, so there's nothing to text." };
    if (purpose === "return_checklist" && !started) return { ok: false, say: "The return checklist opens once your trip starts. Want the pickup guide instead?" };
    target = given ?? onFile;
    if (!target) return { ok: false, need_phone: true, say: "What's the best number to text? I'll read it back." };
  }
  const s = await smsSettings();
  if (!s || s.sms_mode === "off" || !s.sms_ready || (s.sms_mode === "owner_only" && target !== OWNER)) { await log({ action: "refused", purpose, reservation_id: rid, status: "not_live" }); return NOT_LIVE; }
  if ((await sb.rpc("leo_sms_blocked", { p_phone: target })).data === true) return { ok: false, say: "That number opted out of texts. Everything is on your trip page, and I can email it instead." };
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await sb.from("leo_sms_log").select("id", { count: "exact", head: true }).eq("token", token).in("action", ["send", "owner_test"]).gte("at", since);
  if ((count ?? 0) >= 3) return { ok: false, limit: true, say: "I've sent three texts for this trip today, which is the limit. Everything is on your trip page." };
  if (given && !demo) {
    const { count: ch } = await sb.from("leo_sms_log").select("id", { count: "exact", head: true }).eq("token", token).eq("action", "set_phone").gte("at", since);
    if ((ch ?? 0) >= 2) return { ok: false, say: "That number was already changed twice today. Message your host in the Turo app to change it." };
    await sb.from("lax_guest_links").update({ sms_phone: given, sms_phone_at: new Date().toISOString() }).eq("token", token);
    await log({ action: "set_phone", reservation_id: rid, to_last4: given.slice(-4) });
  }
  const r = await telnyxSend(target!, smsText(purpose, slug), s.sms_profile_id as string | null);
  if (!r.ok) {
    await log({ action: "failed", purpose, reservation_id: rid, to_last4: target!.slice(-4), telnyx_id: r.id ?? null, error_code: r.code });
    if (r.code === "40300") { await sb.from("leo_sms_optouts").upsert({ phone_hash: await sha256(target!), source: "telnyx_40300" }); return { ok: false, say: "That number opted out of texts. I can email it instead." }; }
    await smsBreaker();
    return { ok: false, sent: false, broken: true, say: "The text didn't go through. Everything is on your trip page, and I can email it instead." };
  }
  await log({ action: "send", purpose, reservation_id: rid, to_last4: target!.slice(-4), telnyx_id: r.id, status: r.status });
  return { ok: true, sent: true, say: `Sent to the number ending in ${target!.slice(-4)}. It has ${PURPOSE[purpose][0]}.` };
}

/** Watchdog (sends nothing): is Leo's number able to text? Reads the messaging profile and the 10DLC campaign; heals what it can.
 *  Writes leo_settings.sms_ready / sms_detail. Raises leo.sms (signed Leo) only when texting is switched on and not ready. */
async function smsCheck(): Promise<Any> {
  const healed: string[] = [];
  const detail: Any = { checked: new Date().toISOString() };
  let why = "";
  try {
    const { data: cur } = await sb.from("leo_settings").select("sms_mode, sms_profile_id, sms_campaign_id, sms_detail").eq("id", 1).maybeSingle();
    const mode = String(cur?.sms_mode ?? "off");
    const enc = encodeURIComponent(LEO_FROM);
    const num = await tx(`/phone_numbers?filter[phone_number]=${enc}`);
    const rec = ((num.j.data as Any[]) ?? [])[0] as Any | undefined;
    detail.number_found = !!rec; detail.number_status = rec?.status ?? null; detail.shapes = { phone_numbers_keys: rec ? Object.keys(rec).slice(0, 30) : [] };
    if (!rec) why = "Leo's number was not found at the carrier";
    let profile: string | null = null;
    if (rec) {
      const ms = await tx(`/phone_numbers/${rec.id}/messaging`);
      const md = (ms.j.data ?? {}) as Any;
      detail.shapes = { ...(detail.shapes as Any), messaging_keys: Object.keys(md).slice(0, 30) };
      profile = (md.messaging_profile_id as string | null) ?? null;
      detail.features = md.features ?? null;
      if (!profile && cur?.sms_profile_id) {
        const p = await tx(`/phone_numbers/${rec.id}/messaging`, { method: "PATCH", body: JSON.stringify({ messaging_profile_id: cur.sms_profile_id }) });
        if (p.status < 300) { profile = String(cur.sms_profile_id); healed.push("re-attached messaging profile"); }
      }
      detail.profile = profile;
      if (!profile) why ||= "Leo's number has no messaging profile";
    }
    if (profile) {
      const pr = await tx(`/messaging_profiles/${profile}`);
      const pd = (pr.j.data ?? {}) as Any;
      detail.profile_enabled = pd.enabled ?? null;
      if (pd.enabled === false) why ||= "the messaging profile is switched off";
    }
    // 10DLC: number must be assigned to an active campaign
    const as = await tx(`/10dlc/phone_number_campaigns/${enc}`);
    let ad = (as.j ?? {}) as Any; if (ad.data) ad = ad.data as Any;
    let campaign = (ad.campaignId as string | undefined) ?? null;
    detail.shapes = { ...(detail.shapes as Any), campaign_assignment_status: as.status, campaign_assignment_keys: Object.keys(ad).slice(0, 30) };
    if (!campaign && as.status === 404 && cur?.sms_campaign_id) {
      const a = await tx("/10dlc/phone_number_campaigns", { method: "POST", body: JSON.stringify({ phoneNumber: LEO_FROM, campaignId: cur.sms_campaign_id }) });
      if (a.status < 300) { campaign = String(cur.sms_campaign_id); healed.push("re-assigned campaign"); }
    }
    detail.campaign = campaign; detail.assignment_status = ad.assignmentStatus ?? ad.telnyxCampaignAssignmentStatus ?? null;
    let cstatus: string | null = null;
    if (campaign) {
      const c = await tx(`/10dlc/campaign/${campaign}`);
      const cd = (c.j.data ?? c.j ?? {}) as Any;
      cstatus = String(cd.status ?? cd.campaignStatus ?? "") || null;
      detail.shapes = { ...(detail.shapes as Any), campaign_keys: Object.keys(cd).slice(0, 40) };
    }
    detail.campaign_status = cstatus;
    if (!campaign) why ||= "Leo's number is not assigned to a 10DLC campaign yet (it needs an approved customer-care campaign)";
    else if (!cstatus) why ||= "the 10DLC campaign status is unknown";
    else if (!/active|accepted|approved|registered/i.test(cstatus)) why ||= `the 10DLC campaign status is ${cstatus}`;
    const breaker = (await sb.from("leo_sms_log").select("id", { count: "exact", head: true }).eq("action", "failed").gte("at", new Date(Date.now() - 3600_000).toISOString())).count ?? 0;
    if (breaker >= 2) { detail.breaker = true; why ||= "two texts failed within the last hour"; }
    const ready = !why && !!profile && !!campaign;
    detail.ready = ready; detail.why = why || null; detail.healed = healed;
    await sb.from("leo_settings").update({ sms_ready: ready, sms_detail: detail, sms_checked_at: new Date().toISOString(),
      ...(profile && !cur?.sms_profile_id ? { sms_profile_id: profile } : {}), ...(campaign && !cur?.sms_campaign_id ? { sms_campaign_id: campaign } : {}) }).eq("id", 1);
    if (mode !== "off") {
      if (!ready) await sb.rpc("bestly_raise", { p_key: "leo.sms", p_kind: "problem", p_severity: "warning", p_title: "Leo: I can't send texts",
        p_body: clip(`Texting is on but not ready: ${why}.`, 280), p_area: "agents", p_needs_jared: !healed.length, p_healed: healed.length > 0 }).then(() => {}, () => {});
      else await sb.rpc("bestly_raise", { p_key: "leo.sms", p_kind: "resolved", p_title: "Leo: texting works again",
        p_body: healed.length ? healed.join("; ") : "Messaging profile and campaign look good.", p_area: "agents", p_healed: healed.length > 0 }).then(() => {}, () => {});
    }
    return { ok: true, ready, mode, ...detail };
  } catch (e) {
    const msg = clip((e as Error)?.message, 160);
    await sb.from("leo_settings").update({ sms_ready: false, sms_detail: { checked: new Date().toISOString(), error: msg }, sms_checked_at: new Date().toISOString() }).eq("id", 1).then(() => {}, () => {});
    return { ok: false, ready: false, error: msg };
  }
}
const isService = (req: Request) => { const a = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return !!a && (a === SB_SECRET || a === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "\0")); };
/** Owner-only test text (service key only; built for Jared to fire on purpose, same gates as any send). */
async function smsOwnerTest(): Promise<Any> {
  const s = await smsSettings();
  if (!s || s.sms_mode === "off" || !s.sms_ready) return { ok: false, refused: "sms is off or not ready" };
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await sb.from("leo_sms_log").select("id", { count: "exact", head: true }).eq("token", "owner_test").eq("action", "owner_test").gte("at", since);
  if ((count ?? 0) >= 3) return { ok: false, refused: "3 per day" };
  if ((await sb.rpc("leo_sms_blocked", { p_phone: OWNER })).data === true) return { ok: false, refused: "owner number opted out" };
  const r = await telnyxSend(OWNER, smsText("trip_page", "demo-lax"), s.sms_profile_id as string | null);
  await sb.from("leo_sms_log").insert({ token: "owner_test", action: "owner_test", purpose: "trip_page", to_last4: OWNER.slice(-4), telnyx_id: r.id ?? null, status: r.status ?? null, error_code: r.code ?? null });
  return { ok: r.ok, status: r.status, code: r.code };
}
/** One-time setup: a messaging-only profile attached to Leo's number (voice settings untouched). Does not touch 10DLC. */
async function smsSetup(): Promise<Any> {
  const { data: cur } = await sb.from("leo_settings").select("sms_profile_id").eq("id", 1).maybeSingle();
  if (cur?.sms_profile_id) return { ok: true, already: true, profile: cur.sms_profile_id };
  const enc = encodeURIComponent(LEO_FROM);
  const num = await tx(`/phone_numbers?filter[phone_number]=${enc}`);
  const rec = ((num.j.data as Any[]) ?? [])[0] as Any | undefined;
  if (!rec) return { ok: false, error: "number not found" };
  const p = await tx("/messaging_profiles", { method: "POST", body: JSON.stringify({ name: "Leo texts", whitelisted_destinations: ["US"] }) });
  const pid = (p.j.data as Any)?.id as string | undefined;
  if (!pid) return { ok: false, error: `profile create failed (${p.status})`, errors: p.j.errors };
  await sb.from("leo_settings").update({ sms_profile_id: pid }).eq("id", 1);
  const a = await tx(`/phone_numbers/${rec.id}/messaging`, { method: "PATCH", body: JSON.stringify({ messaging_profile_id: pid }) });
  return { ok: a.status < 300, profile: pid, attach_status: a.status };
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

/** Hourly watchdog: Leo drives his own demo car (status, cool, off) and checks a real-shaped unlock is still refused.
 *  Touches only the pretend car. Resets the demo car once and retries before raising. Signed Leo via leo.demo-parity. */
let lastSelf: { at: number; out: Any } | null = null;
async function selftest(): Promise<Any> {
  if (lastSelf && Date.now() - lastSelf.at < 60_000) return lastSelf.out;
  const demoTok = "demo:demo-lax";
  const run3 = async () => {
    const bad: string[] = [];
    const st = await carTool("car_status", demoTok, {});
    if (st.ok !== true) bad.push("status");
    const cool = await carTool("car_climate", demoTok, { action: "cool" });
    if (cool.ok !== true) bad.push("cool");
    const off = await carTool("car_climate", demoTok, { action: "off" });
    if (off.ok !== true) bad.push("off");
    // reminder_email on the demo page: bad email refused, set accepted, status sees it.
    const rBad = await reminderEmail(demoTok, null, { action: "set", email: "not-an-email" });
    if (rBad.ok !== false) bad.push("reminder_email validation");
    const rSet = await reminderEmail(demoTok, null, { action: "set", email: "leo-selftest@example.com" });
    if (rSet.ok !== true) bad.push("reminder_email set");
    const rSt = await reminderEmail(demoTok, null, { action: "status" });
    if (rSt.ok !== true || rSt.on_file !== true) bad.push("reminder_email status");
    // by phone, "set" must always be refused (caller ID can be spoofed).
    const rPh = await reminderEmail(demoTok, null, { action: "set", email: "leo-selftest@example.com" }, "phone");
    if (rPh.ok !== false) bad.push("PHONE REMINDER SET NOT REFUSED");
    return bad;
  };
  let bad: string[] = [];
  let healed = false;
  try {
    bad = await run3();
    if (bad.length) {
      await sb.from("leo_demo_car_state").delete().eq("link", "d:demo-lax");
      bad = await run3();
      healed = bad.length === 0;
    }
  } catch (e) { bad = ["error: " + clip((e as Error)?.message, 120)]; }
  // Safety parity: a real-shaped trip must still refuse unlock (this refuses before touching anything).
  try {
    const u = await carTool("car_lock", "selftest-not-a-real-trip-token", { action: "unlock" });
    if (u.ok !== false) bad.push("REAL TRIP UNLOCK NOT REFUSED");
  } catch (e) { bad.push("unlock check error"); }
  // A real-shaped trip must not save or send anything for an unknown token (it refuses before touching anything).
  try {
    const r = await reminderEmail("selftest-not-a-real-trip-token", null, { action: "set", email: "leo-selftest@example.com" });
    if (r.ok !== false) bad.push("REAL TRIP REMINDER NOT REFUSED");
  } catch (_e) { bad.push("reminder refusal check error"); }
  // send_sms: a demo number must never send; an unknown trip must never send (both refuse before touching Telnyx).
  try {
    const d = await sendSms("demo:demo-lax", null, { action: "send", purpose: "trip_page", phone: "2135550100" });
    if (d.demo !== true || d.sent !== false) bad.push("SMS DEMO NOT SAFE");
  } catch (_e) { bad.push("sms demo check error"); }
  try {
    const r = await sendSms("selftest-not-a-real-trip-token", null, { action: "send", purpose: "trip_page", phone: "2135550100" });
    if (r.ok !== false) bad.push("REAL TRIP SMS NOT REFUSED");
  } catch (_e) { bad.push("sms refusal check error"); }
  // Texting watchdog (hourly; sends nothing).
  let smsOut: Any | null = null;
  try {
    const { data: ls } = await sb.from("leo_settings").select("sms_checked_at, sms_detail, sms_ready").eq("id", 1).maybeSingle();
    if (!ls?.sms_checked_at || Date.now() - Date.parse(ls.sms_checked_at) > 50 * 60_000) smsOut = await smsCheck();
    else smsOut = { cached: true, ready: ls.sms_ready, detail: ls.sms_detail };
  } catch (_e) { smsOut = { error: "sms check failed" }; }
  // send_now reaches the reminder sender with the service key: prove that door still opens (wallet-pass selftest only builds a pass).
  try {
    const w = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wallet-pass`, { method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET }, body: JSON.stringify({ op: "selftest" }) });
    const wj = await w.json().catch(() => ({}));
    if (!w.ok || wj?.ok !== true) bad.push("reminder sender auth");
  } catch (_e) { bad.push("reminder sender unreachable"); }
  // Phone scope: a phone session must never reach the key, the car, nav or texts, and an unmatched caller only gets tickets + host message.
  try {
    if (!scopeRefusal("phone", "car_lock") || !scopeRefusal("phone", "car_climate") || !scopeRefusal("phone", "key_fix") || !scopeRefusal("phone", "send_to_car_nav")
        || !scopeRefusal("phone", "send_sms") || !scopeRefusal("phone", "extra_driver") || scopeRefusal("phone", "trip_status") || scopeRefusal("phone", "file_ticket")
        || !scopeRefusal("phone_unknown", "trip_status") || !scopeRefusal("phone_unknown", "reminder_email") || scopeRefusal("phone_unknown", "notify_host")
        || !scopeRefusal("page_unknown", "car_lock") || !scopeRefusal("page_unknown", "trip_status") || !scopeRefusal("page_unknown", "key_fix")
        || scopeRefusal("page_unknown", "notify_host") || scopeRefusal("page_unknown", "file_ticket")) bad.push("PHONE SCOPE");
    const r = await run("selftest-not-a-real-trip-token", "resend_key", {}, "phone") as Any;
    if (r?.ok !== false) bad.push("PHONE SCOPE run()");
  } catch (_e) { bad.push("PHONE SCOPE check error"); }
  // Housekeeping (kept here, not in SQL): old logs and expired voice sessions.
  await sb.from("leo_reminder_log").delete().lt("at", new Date(Date.now() - 7 * 86400_000).toISOString()).then(() => {}, () => {});
  await sb.from("leo_tool_log").delete().lt("at", new Date(Date.now() - 7 * 86400_000).toISOString()).then(() => {}, () => {});
  await sb.from("trip_voice_sessions").delete().lt("created_at", new Date(Date.now() - 2 * 86400_000).toISOString()).then(() => {}, () => {});
  const unsafe = bad.some((x) => x.startsWith("REAL TRIP") || x.startsWith("SMS DEMO") || x.startsWith("PHONE SCOPE"));
  if (bad.length) {
    await sb.rpc("bestly_raise", { p_key: "leo.demo-parity", p_kind: "problem", p_severity: unsafe ? "error" : "warning",
      p_title: unsafe ? "Leo: a real trip was not refused" : "Leo: my demo car stopped answering",
      p_body: `My hourly demo check failed on: ${bad.join(", ")}. ${unsafe ? "A real-shaped trip was allowed through something it must refuse (unlock, the reminder email, a text or the phone scope). I need this fixed now." : "Guests on real trips are not affected, but the demo page and my phone test line are."}`,
      p_area: "agents" }).then(() => {}, () => {});
  } else {
    await sb.rpc("bestly_raise", { p_key: "leo.demo-parity", p_kind: "resolved", p_title: "Leo: my demo car is answering again",
      p_body: healed ? "I reset the demo car and it answers." : "Status, cool, off and the reminder email all work on the demo.", p_area: "agents" }).then(() => {}, () => {});
  }
  const out: Any = { ok: bad.length === 0, healed, failed: bad, sms: smsOut };
  lastSelf = { at: Date.now(), out };
  return out;
}

const FAILED_SAY = "Didn't work: that didn't go through. Offer to take a message for the host.";
const hasPrefix = (t: string) => /^(Not sent|Didn't work|Not done)\s*:/i.test(t);
/** One shape for every failure: top-level ok:false and a `say` line that starts "Not sent:" or "Didn't work:" so Leo never reports a failure as success. */
function shape(name: string, r: Any): Any {
  let o: Any = r;
  const inner = r.result && typeof r.result === "object" ? r.result as Any : null;
  if (r.ok === true && inner && (inner.ok === false || (inner.error && inner.ok !== true))) {
    o = { ok: false, error: String(inner.error ?? "failed"), ...(inner.held ? { held: true } : {}), result: inner,
      ...(inner.held && inner.tell_guest ? { say: "The key link isn't released yet: your host confirms your license and finishes the car check-in first, then it shows up on your trip page by itself. " + String(inner.tell_guest) } : {}) };
  }
  if (!(o.ok === false || (o.ok === undefined && o.error))) return o;
  const base = clip(o.say ?? o.error ?? o.note ?? "", 400);
  const isSend = name === "send_sms" || o.sent === false;
  const pre = isSend ? "Not sent: " : "Didn't work: ";
  return { ...o, ok: false, say: base ? (hasPrefix(base) ? base : pre + base) : FAILED_SAY };
}

/** The tool itself: returns the result and an HTTP status. Throws are caught by tool(). */
async function dispatch(name: string, b: Any, s: Session): Promise<{ out: Any; status?: number }> {
  const t = s.token, ch = s.channel ?? "page";
  const refuse = scopeRefusal(ch, name);
  if (refuse) return { out: refuse };
  if (CAR_TOOLS.has(name)) return { out: await carTool(name, t, b) };
  if (name === "send_sms") return { out: await sendSms(t, s.conversation_id, b) };
  switch (name) {
    case "trip_status": return { out: leoStatus(await run(t, "diagnose", {}, ch), ch) };
    case "key_fix": {
      const action = clip(b.action, 20);
      if (!KEY_FIX.has(action)) return { out: { ok: false, error: "action must be check_key, resend_key, make_key_now or refresh_car" } };
      return { out: { ok: true, result: await run(t, action, { reason: clip(b.reason, 200) || "guest asked Leo by voice" }, ch) } };
    }
    case "job_status": return { out: { ok: true, result: await run(t, "job_status", { job: Number(b.job) }, ch) } };
    case "extra_driver": {
      const action = clip(b.action, 20);
      if (!DRIVER.has(action)) return { out: { ok: false, error: "action must be status, check, resend or notify_host" } };
      return { out: { ok: true, result: await run(t, `driver_${action}`, { name: b.name, summary: b.summary }, ch) } };
    }
    case "notify_host": {
      if (ch === "phone_unknown" || ch === "page_unknown") {
        // Nobody matched this caller to a trip, so there is no trip to alert about: file a callback ticket (pings Jared signed Leo).
        const summary = clip(b.summary, 280);
        const who = ch === "page_unknown" ? "Guest on a trip link that no longer works" : "Unmatched phone caller";
        const f = await fileTicket(s, { kind: "callback", name: b.name, phone: b.phone, issue: `${who} asked for the host: ${summary}` });
        if (f.out.ok === false) return f;
        return { out: { ok: true, result: { ok: true, note: "I left your message for the host and a callback is queued." }, ...(b.phone ? {} : { ask_for_phone: "No callback number yet: ask for one and file it with file_ticket." }) } };
      }
      return { out: { ok: true, result: await run(t, "notify_host", { summary: `Leo (${ch.startsWith("phone") ? "phone" : "voice"}): ${clip(b.summary, 280)}` }, ch) } };
    }
    case "reminder_email": return { out: await reminderEmail(t, s.conversation_id, b, ch) };
    case "file_ticket": return await fileTicket(s, b);
  }
  return { out: { ok: false, error: "unknown tool" }, status: 404 };
}

async function fileTicket(s: Session, b: Any): Promise<{ out: Any; status?: number }> {
  const t = s.token;
  const { count } = await sb.from("support_tickets").select("id", { count: "exact", head: true }).eq("conversation_id", s.conversation_id);
  if ((count ?? 0) >= 3) return { out: { ok: false, error: "too many tickets on this call" }, status: 429 };
  if (t.startsWith("demo:")) return { out: { ok: true, ticket: "DEMO-0000", kind: clip(b.kind, 20) || "support", follow_up: "today", note: "demo page: nothing was saved" } };
  const { data, error } = await sb.rpc("leo_file_ticket", { p: { kind: clip(b.kind, 20), name: clip(b.name, 80), phone: clip(b.phone, 30),
    email: clip(b.email, 120), issue: clip(b.issue, 1000), conversation_id: s.conversation_id } });
  if (error) {
    await sb.rpc("bestly_raise", { p_key: `agent.line.${AGENT_SLUG}`, p_kind: "problem", p_severity: "warning",
      p_title: "Leo: I couldn't save a guest's ticket", p_body: error.message.slice(0, 300), p_area: "agents" }).then(() => {}, () => {});
    return { out: { ok: false, broken: true, error: "could not save", say: "Didn't work: I couldn't save that message. Ask them to message the host in the Turo app." }, status: 500 };
  }
  return { out: (data ?? { ok: true }) as Any };
}

async function tool(name: string, b: Any): Promise<Response> {
  const s = await session(b, name);
  if (s instanceof Response) return s;
  const ch = s.channel ?? "page", demo = s.token.startsWith("demo:");
  let out: Any, status = 200;
  try { ({ out, status = 200 } = await dispatch(name, b, s)); }
  catch (e) {
    console.error(e);
    out = { ok: false, broken: true, error: "tool crashed", say: "Didn't work: that didn't go through. Offer to take a message for the host." }; status = 500;
  }
  const broken = !!out.broken;
  const shaped = shape(name, out);
  delete shaped.broken;
  await logTool(name, ch, demo, shaped.ok !== false, status >= 500 || broken ? "error" : shaped.ok === false ? "refused" : "ok");
  return json(shaped, status);
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
  if (b.op === "selftest") return json(await selftest());
  if (b.op === "demo_weather") {
    // Demo page Hot / Cold / Nice switch: the pretend car Leo reads gets the same cabin and outside temperature (demo links only).
    const raw = clip(b.token, 20), w = clip(b.weather, 8).toLowerCase();
    if (!/^demo-(home|lax)$/.test(raw) || !["hot", "cold", "nice"].includes(w)) return json({ ok: false, error: "demo pages only" }, 400);
    const { data, error } = await sb.rpc("leo_demo_weather", { p_link: "d:" + raw, p_weather: w });
    return json(error ? { ok: false, error: "couldn't set the demo weather" } : data, error ? 500 : 200);
  }
  if (b.op === "sms_check" || b.op === "sms_setup" || b.op === "sms_test") {
    if (!isService(req)) return json({ ok: false, error: "service key only" }, 401);
    return json(b.op === "sms_check" ? await smsCheck() : b.op === "sms_setup" ? await smsSetup() : await smsOwnerTest());
  }
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
