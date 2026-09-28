// voice-ask — "Hey Scout" from the wall Pi (W7, wall round 4, 2026-09-28).
//
// Caller: /opt/bestly/voice/voice.py on bestly-pi, authenticated with the Home Hub agent key (x-api-key), the same
// key home-hub-agent and the wall RPCs use. verify_jwt is off; nothing here runs without that key.
//
//   op "ask"    {audio_b64 (16 kHz mono WAV, <= 12 s), ctx, wake}  -> {ok, text, reply, ms:{stt, llm}, via}
//   op "text"   {text, ctx}                                         -> same, no speech-to-text (tests)
//   op "log"    {event:{kind, outcome?, why?, score, model}}        -> wall_voice_log row (false-wake tuning)
//   op "status" {status}                                            -> wall_voice_status (admin Voice card)
//
// Speech-to-text: Groq whisper-large-v3-turbo (free tier), Cloudflare Workers AI whisper as the fallback. Keys come
// from llm_keys() (Vault), never from the Pi. The audio is used once and never stored.
// Answer: Scout on the free ladder only (paid "never"), through the free-llm function (op run = _shared/free-llm.ts
// llm(): Groq -> Cloudflare -> Mac mini). A quick spoken answer from the wall's live snapshot plus Scout's own queue
// (admin_today, upcoming Turo trips, open incidents). If it needs Scout's tools it goes to admin-chat on autopilot
// (free agent first; anything that needs Jared's yes is refused in code there). Every turn lands in a
// "Hey Scout (voice)" chat in the admin so he can follow up there.
// Self-contained on purpose (no _shared imports): deploys as one small file.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRET_KEY: string = (() => {
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const v = j.default ?? Object.values(j)[0]; if (v) return String(v); } catch { /* legacy */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
})();
const keyHeaders = (k: string): Record<string, string> =>
  k.startsWith("sb_secret_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, SECRET_KEY, { auth: { persistSession: false } });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

let agentKey: { at: number; v: string } | null = null;
async function expectedKey(): Promise<string> {
  if (agentKey && Date.now() - agentKey.at < 10 * 60_000) return agentKey.v;
  const v = Deno.env.get("HOME_HUB_AGENT_KEY") ?? String((await db.rpc("get_home_hub_agent_key")).data ?? "");
  agentKey = { at: Date.now(), v };
  return v;
}

let keysCache: { at: number; v: Record<string, string> } | null = null;
async function keys(): Promise<Record<string, string>> {
  if (keysCache && Date.now() - keysCache.at < 10 * 60_000) return keysCache.v;
  const { data } = await db.rpc("llm_keys");
  const raw = (data && typeof data === "object") ? data as Record<string, string> : {};
  const pick = (val: string | undefined, re: RegExp) => { const m = (val ?? "").match(re); return m ? m[0] : (val ?? "").trim(); };
  const v = {
    groq: pick(raw.groq_api_key, /gsk_[A-Za-z0-9]{20,}/),
    cf: pick(raw.cloudflare_ai_token, /cfut_[A-Za-z0-9_\-]{20,}|(?<![A-Za-z0-9_\-])[A-Za-z0-9_\-]{40}(?![A-Za-z0-9_\-])/),
    cfAcct: pick(raw.cloudflare_account_id, /[0-9a-f]{32}/),
  };
  keysCache = { at: Date.now(), v };
  return v;
}

const VOCAB = "Hey Scout. Turo, Tesla, HomePod, Bestly, Eli, Jared, West Hollywood, Kings Road, LAX, EcoFlow, Nextcloud.";

async function stt(wav: Uint8Array): Promise<{ text: string; via: string }> {
  const k = await keys();
  const errs: string[] = [];
  if (k.groq) {
    for (const model of ["whisper-large-v3-turbo", "whisper-large-v3"]) {
      try {
        const fd = new FormData();
        fd.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "ask.wav");
        fd.append("model", model);
        fd.append("language", "en");
        fd.append("temperature", "0");
        fd.append("response_format", "json");
        fd.append("prompt", VOCAB);
        const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST", headers: { Authorization: `Bearer ${k.groq}` }, body: fd, signal: AbortSignal.timeout(15_000),
        });
        if (r.ok) return { text: String((await r.json())?.text ?? "").trim(), via: `groq/${model}` };
        errs.push(`groq ${model} ${r.status}`);
        if (r.status !== 429 && r.status < 500) break;
      } catch (e) { errs.push(`groq ${(e as Error).name}`); }
    }
  }
  if (k.cf && k.cfAcct) {
    try {
      let bin = "";
      for (let i = 0; i < wav.length; i += 0x8000) bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${k.cfAcct}/ai/run/@cf/openai/whisper-large-v3-turbo`, {
        method: "POST", headers: { Authorization: `Bearer ${k.cf}`, "Content-Type": "application/json" },
        body: JSON.stringify({ audio: btoa(bin), language: "en", initial_prompt: VOCAB }), signal: AbortSignal.timeout(20_000),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success !== false) return { text: String(j?.result?.text ?? "").trim(), via: "cloudflare/whisper-large-v3-turbo" };
      errs.push(`cloudflare ${r.status}`);
    } catch (e) { errs.push(`cloudflare ${(e as Error).name}`); }
  }
  throw new Error(`speech-to-text failed (${errs.join(", ") || "no keys"})`);
}

/** Drop the wake word Whisper often keeps ("Hey Scout, what's ..."). */
function stripWake(t: string): string {
  return t.replace(/^\s*(?:(?:hey|hi|hay|a|okay|ok)[\s,]+)?(?:scout|scott|jarvis)\b[\s,.!?:;-]*/i, "").trim();
}

const SPOKEN_RULES = `You are Scout, the assistant in Jared's home at 733 N Kings Rd, West Hollywood. He just asked you something OUT LOUD
("Hey Scout ...") and your answer is read aloud by a speaker, so:
- Answer in one or two short sentences, under 35 words. Lead with the answer. Friendly, plain, a little warm; no filler.
- No markdown, lists, emoji, URLs or symbols. Say numbers the way people say them: "78 degrees", "3:15 PM", "about 2 miles".
- 12-hour times, US units (degrees Fahrenheit, miles, mph). Today and times are Pacific.
- Never make up facts. Use the live snapshot below, the conversation, and general knowledge only.`;

function tier1Prompt(ctx: unknown, convo: string) {
  return `${SPOKEN_RULES}
- If answering needs something you can't see here (anything else to look up) or asks you to DO something
  (turn on/off, play, send, remind, add, change, fix), reply with exactly one word: NEEDS_TOOLS

Live snapshot (the wall + Scout's queue, read a moment ago; times in the data are UTC unless marked):
${JSON.stringify(ctx ?? {}).slice(0, 9000)}

Recent voice conversation (oldest first):
${convo || "(none)"}`;
}

async function adminUid(): Promise<string | null> {
  const { data } = await db.from("user_roles").select("user_id").eq("role", "admin").order("user_id").limit(1).maybeSingle();
  return (data as any)?.user_id ?? null;
}

/** One "Hey Scout" chat per Pacific day, so voice turns show up in the admin's Scout chat list. */
async function voiceThread(): Promise<string | null> {
  const day = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" });
  const title = `Hey Scout (voice) · ${day}`;
  const uid = await adminUid();
  if (!uid) return null;
  const { data: th } = await db.from("admin_chat_threads").select("id").eq("user_id", uid).eq("title", title).order("created_at", { ascending: false }).limit(1);
  if (th?.length) return (th[0] as any).id;
  const { data, error } = await db.from("admin_chat_threads").insert({ user_id: uid, title }).select("id").single();
  return error ? null : (data as any).id;
}

async function recentConvo(threadId: string | null): Promise<string> {
  if (!threadId) return "";
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data } = await db.from("admin_chat_messages").select("role, body").eq("thread_id", threadId).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(6);
  return ((data ?? []) as any[]).reverse().map((m) => `${m.role === "assistant" ? "Scout" : "Jared"}: ${String(m.body).slice(0, 300)}`).join("\n");
}

function spoken(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^\s*(OPTIONS|FIXED|NEEDS_YES|STUCK|DRAFT):.*$/gim, "")
    .replace(/[*_`#>\[\]]/g, "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Scout's own view for the quick answer: what needs him, upcoming Turo trips, open incidents. */
async function scoutSnapshot(): Promise<Record<string, unknown>> {
  const now = new Date();
  const [{ data: today }, { data: trips }, { data: inc }] = await Promise.all([
    db.rpc("admin_today"),
    db.from("turo_trips").select("guest_first, starts_at, ends_at, status, earnings, airport_code, pickup_city")
      .gte("ends_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + 8 * 86400_000).toISOString())
      .order("starts_at").limit(8),
    db.from("monitor_issues").select("title, severity").eq("status", "open").limit(10),
  ]);
  const la = (t: string) => new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return {
    needs_jared: ((today ?? []) as any[]).slice(0, 10).map((t) => ({ title: t.title, detail: String(t.detail ?? "").slice(0, 160) })),
    turo_trips_next_8_days: ((trips ?? []) as any[]).filter((t) => !/cancel/i.test(String(t.status))).map((t) => ({
      guest: t.guest_first, starts: t.starts_at ? la(t.starts_at) + " Pacific" : null, ends: t.ends_at ? la(t.ends_at) + " Pacific" : null,
      status: t.status, earnings_usd: t.earnings, where: t.airport_code || t.pickup_city })),
    open_incidents: ((inc ?? []) as any[]).map((i) => `${i.severity}: ${i.title}`),
  };
}

async function freeLlm(system: string, user: string): Promise<{ text: string; via: string }> {
  const r = await fetch(`${URL_}/functions/v1/free-llm`, {
    method: "POST", headers: { "Content-Type": "application/json", ...keyHeaders(SECRET_KEY) },
    body: JSON.stringify({ op: "run", task: "summarize", system, user, paid: "never", maxTokens: 700 }),
    signal: AbortSignal.timeout(25_000),
  });
  const j = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(String(j?.error ?? `free-llm ${r.status}`).slice(0, 160));
  return { text: String(j.text ?? ""), via: `${j.provider}/${j.model}` };
}

async function answer(text: string, ctx: unknown): Promise<{ reply: string; via: string; ms: number; tier: number }> {
  const t0 = Date.now();
  const [threadId, snap] = await Promise.all([voiceThread(), scoutSnapshot().catch(() => ({}))]);
  const convo = await recentConvo(threadId);
  let reply = "", via = "";
  try {
    const r = await freeLlm(tier1Prompt({ ...(ctx as Record<string, unknown> ?? {}), scout: snap }, convo), text);
    reply = spoken(r.text);
    via = r.via;
  } catch (e) {
    via = `tier1 failed: ${(e as Error).message}`.slice(0, 160);
  }
  if (reply && !/NEEDS_TOOLS/i.test(reply)) {
    if (threadId) {
      await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "user", body: text });
      await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: reply });
      await db.from("admin_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
    }
    return { reply, via, ms: Date.now() - t0, tier: 1 };
  }
  // Tier 2: Scout with its tools (admin-chat autopilot = free agent first, nothing that needs a yes runs).
  try {
    const ask = `[Voice] Jared just asked this out loud through the Hey Scout mic at home. It is a question from him, not an incident: ` +
      `skip the incident checks and answer it with your read tools. Reply in one or two short sentences for a speaker (no lists, no markdown). ` +
      `If it needs his yes, say what you would do and that he can OK it in the Scout chat.\nHe said: "${text}"`;
    const r = await fetch(`${URL_}/functions/v1/admin-chat`, {
      method: "POST", headers: { "Content-Type": "application/json", ...keyHeaders(SECRET_KEY) },
      body: JSON.stringify({ body: ask, autopilot: true, thread_id: threadId, title: "Hey Scout (voice)" }),
      signal: AbortSignal.timeout(50_000),
    });
    const j = await r.json().catch(() => null);
    const raw = String(j?.reply ?? "");
    const said = spoken(raw.replace(/^Free AI is stuck:.*$/gim, "").replace(/^The free AI looked.*$/gim, ""));
    if (said && !/paid AI/i.test(said)) return { reply: said, via: `admin-chat${j?.free ? " free" : ""}`, ms: Date.now() - t0, tier: 2 };
    via += ` | admin-chat ${r.status} ${raw.slice(0, 60)}`;
  } catch (e) {
    via += ` | admin-chat ${(e as Error).name}`;
  }
  return { reply: "Sorry, I couldn't work that out by voice. It's waiting in the Scout chat.", via, ms: Date.now() - t0, tier: 3 };
}

async function logEvent(ev: Record<string, unknown>) {
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const str = (v: unknown, n = 200) => (v == null ? null : String(v).slice(0, n));
  await db.from("wall_voice_log").insert({
    kind: str(ev.kind, 20) ?? "event",
    outcome: str(ev.outcome, 20) ?? (["ignored", "empty", "junk"].includes(String(ev.kind)) ? String(ev.kind) : null), why: str(ev.why, 40), score: num(ev.score), model: str(ev.model, 30),
    heard: str(ev.heard, 500), reply: str(ev.reply, 600), lat: ev.lat && typeof ev.lat === "object" ? ev.lat : null,
  });
  if (Math.random() < 0.05) await db.from("wall_voice_log").delete().lt("at", new Date(Date.now() - 14 * 86400_000).toISOString());
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const presented = (req.headers.get("x-api-key") ?? "").trim();
  const expected = await expectedKey();
  if (!expected || presented !== expected) return J({ ok: false, error: "unauthorized" }, 401);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }
  const op = String(body.op ?? "");

  if (op === "log") {
    await logEvent(body.event ?? {});
    return J({ ok: true });
  }
  if (op === "status") {
    await db.from("wall_voice_status").upsert({ id: 1, status: body.status ?? {}, at: new Date().toISOString() });
    return J({ ok: true });
  }
  if (op !== "ask" && op !== "text") return J({ ok: false, error: "unknown op" }, 400);

  const ms: Record<string, number> = {};
  let text = "", sttVia = "";
  if (op === "ask") {
    const b64 = String(body.audio_b64 ?? "");
    if (!b64 || b64.length > 1_200_000) return J({ ok: false, stage: "stt", error: "audio missing or longer than ~15 s" }, 400);
    const wav = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const t0 = Date.now();
    try {
      const r = await stt(wav);
      text = stripWake(r.text);
      sttVia = r.via;
    } catch (e) {
      await logEvent({ kind: "turn", outcome: "error", why: "stt", score: body.wake?.score, model: body.wake?.model });
      return J({ ok: false, stage: "stt", error: (e as Error).message });
    }
    ms.stt = Date.now() - t0;
  } else {
    text = stripWake(String(body.text ?? "")).slice(0, 500);
  }
  // Whisper's usual inventions on near-silence count as a false wake, not a question.
  const junk = /^\W*(thank you\.?|thanks for watching!?|you|bye\.?|okay\.?|\.+)?\W*$/i.test(text);
  if (!text || junk || text.replace(/[^a-z0-9]/gi, "").length < 2) {
    await logEvent({ kind: "turn", outcome: text && junk ? "junk" : "empty", score: body.wake?.score, model: body.wake?.model, heard: text, lat: ms });
    return J({ ok: true, text: "", reply: "", ms, via: sttVia });
  }
  const a = await answer(text, body.ctx);
  ms.llm = a.ms;
  await logEvent({ kind: "turn", outcome: "command", score: body.wake?.score, model: body.wake?.model, heard: text, reply: a.reply, lat: { ...ms, via: a.via, stt_via: sttVia, tier: a.tier } });
  return J({ ok: true, text, reply: a.reply, ms, via: a.via, stt_via: sttVia, tier: a.tier });
});
