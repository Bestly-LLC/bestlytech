// trip-voice — the voice helper (Leo) on the Turo guest trip pages.
//
// Two doors, both verify_jwt = false:
//
//   POST {op:"session", token}            from the trip page. The guest's trip token (or a demo page) buys a short-lived
//                                         signed voice session. The page gets {signed_url, key}; only the opaque key goes
//                                         to the voice platform as the dynamic variable trip_key, never the trip token.
//                                         Max 8 sessions per trip per hour.
//
//   POST ?tool=<name>  {trip_key, conversation_id, ...}   from the voice platform (Leo's server tools).
//                                         The first call checks with ElevenLabs that conversation_id is a live call of
//                                         this agent (under 2 hours old) and binds the key to it; later calls must come
//                                         from that same conversation. Tools run through the same token-scoped,
//                                         rate-limited SQL the text helper (lax-ask) uses: lax_agent_diag, lax_agent_act,
//                                         lax_agent_job, lax_agent_driver, or lax_demo_tool on the demo pages.
//
// Tools: trip_status, key_fix, job_status, extra_driver, notify_host, file_ticket.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors = corsWith({ headers: "authorization, apikey, content-type, x-client-info", methods: "POST, OPTIONS" });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const XI = "https://api.elevenlabs.io/v1";
const AGENT_SLUG = "leo";
const NO_TRIP = { ok: false, error: "No trip is linked to this chat. Ask the guest to open their trip page and tap Talk to Leo there." };

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
  if ((count ?? 0) >= 8) return json({ ok: false, error: "Leo is taking a short break on this trip. Try the text helper, or message your host in the Turo app." }, 429);

  const aid = await agentId();
  const key = await xiKey();
  if (!aid || !key) return json({ ok: false, error: "Leo isn't available right now. Try the text helper below." }, 503);
  const r = await fetch(`${XI}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(aid)}`, { headers: { "xi-api-key": key } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signed_url) {
    await sb.rpc("bestly_raise", { p_key: `agent.line.${AGENT_SLUG}`, p_kind: "problem", p_severity: "warning",
      p_title: "Leo: guests can't start a voice chat", p_body: `The voice platform refused a session (${r.status}).`, p_area: "agents" }).then(() => {}, () => {});
    return json({ ok: false, error: "Leo isn't available right now. Try the text helper below." }, 502);
  }
  const sessionKey = `tv_${hex(24)}`;
  const ins = await sb.from("trip_voice_sessions").insert({ key: sessionKey, agent_slug: AGENT_SLUG, token });
  if (ins.error) return json({ ok: false, error: "Leo isn't available right now. Try the text helper below." }, 500);
  return json({ ok: true, signed_url: j.signed_url, key: sessionKey });
}

// ---------- door 2: Leo's tools ----------
async function session(b: Any): Promise<Session | Response> {
  const k = clip(b.trip_key, 80);
  const conv = clip(b.conversation_id, 80);
  if (!/^tv_[0-9a-f]{48}$/.test(k)) return json(NO_TRIP);
  if (!/^conv_[A-Za-z0-9]+$/.test(conv)) return json({ ok: false, error: "no conversation" }, 401);
  const { data: s } = await sb.from("trip_voice_sessions").select("key, token, conversation_id, expires_at").eq("key", k).maybeSingle();
  if (!s || Date.parse(s.expires_at) < Date.now()) return json({ ok: false, error: "This chat timed out. Ask the guest to tap Talk to Leo again." });
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

async function tool(name: string, b: Any): Promise<Response> {
  const s = await session(b);
  if (s instanceof Response) return s;
  const t = s.token;
  try {
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
  const t = new URL(req.url).searchParams.get("tool");
  if (t) return tool(t, b);
  if (b.op === "session") return openSession(b);
  return json({ ok: false, error: "unknown request" }, 400);
});
