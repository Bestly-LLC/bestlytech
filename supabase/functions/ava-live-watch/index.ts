// ava-live-watch: the live transcript, recorded by a cron job instead of by Ava. (Spark, 2026-10-05)
//
// Jared: "what happened to our live transcript of live calls? I still want that... a cron job or something else manages it
// so it doesn't provide any lag to her on a call."
//
// How this adds ZERO latency to Ava: she is never asked anything. This reads the voice platform's own record of the
// conversation from the OUTSIDE (GET /v1/convai/conversations/{id}) and writes each new turn into our database. Ava's
// audio path (PSTN -> Telnyx -> ElevenLabs) is never touched, never proxied, never forked. If this function is slow,
// down, or deleted, her calls are completely unaffected.
//
//   {action:"tick"}      one polling pass over the calls we are already watching (cron, every 5 seconds while a call is up)
//   {action:"discover"}  ask the platform whether a call we don't know about is live, e.g. someone calling IN (cron, 30 s)
//   {action:"feed"}      what the admin page reads: live calls + their words, straight from OUR database (fast, no platform call)
//
// Diagnostic that matters: ava_live_watch.mid_call_partial records whether the platform gave us words WHILE the call was
// still in progress. On the Creator plan the live-monitoring websocket is Enterprise-gated, so polling is the only road,
// and whether polling returns partial turns is undocumented. The next real call answers it for us, in data.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

// ON_CALL  = someone is actually on the phone (the "live" dot, and the only state where a mid-call word counts as partial)
// KEEP      = still worth polling. "processing" means the call ended and the platform is still writing up the transcript,
//             so we must KEEP polling through it: that is when the words actually appear, and dropping the watch there
//             would leave a just-ended call showing an empty transcript.
const ON_CALL = new Set(["initiated", "in-progress"]);
const KEEP = new Set(["initiated", "in-progress", "processing"]);
const MAX_WATCH = 6;          // never poll more than this many calls in one pass
const STALE_MINS = 12;        // a watch older than this is closed no matter what the platform says

const err = (error: string, status = 400) => Response.json({ ok: false, error }, { status, headers: CORS });
const ok = (b: Record<string, unknown>) => Response.json({ ok: true, ...b }, { headers: CORS });

async function vault(name: string): Promise<string | null> {
  const { data, error } = await db.rpc("ava_secret", { p_name: name });
  return error || typeof data !== "string" || !data ? null : data;
}
async function isAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (SERVICE_KEYS.has(token)) return true;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

// deno-lint-ignore no-explicit-any
type Raw = Record<string, any>;
type Turn = { role: string; message: string | null; time_in_call_secs: number | null; interrupted: boolean };

const xiGet = async (key: string, path: string): Promise<Raw | null> => {
  const r = await fetch(`${XI}${path}`, { headers: { "xi-api-key": key } }).catch(() => null);
  if (!r?.ok) { await r?.text().catch(() => ""); return null; }
  return await r.json().catch(() => null);
};

/** Turns worth showing: a real spoken line, never a tool call or an empty frame. */
function spoken(t: Raw[]): Turn[] {
  return (t ?? []).map((e) => ({
    role: String(e.role ?? ""), message: typeof e.message === "string" ? e.message : null,
    time_in_call_secs: e.time_in_call_secs == null ? null : Number(e.time_in_call_secs),
    interrupted: e.interrupted === true,
  })).filter((e) => (e.role === "agent" || e.role === "user") && e.message && e.message.trim() !== ""
    && !/tool_code|default_api|^print\(/.test(e.message));
}

/** One pass over the calls we're watching. Writes only new turns; existing rows are never rewritten. */
async function tick(key: string): Promise<Response> {
  const { data: watches } = await db.from("ava_live_watch").select("*").is("ended_at", null)
    .order("started_at", { ascending: false }).limit(MAX_WATCH);
  if (!watches?.length) return ok({ watched: 0 });

  let wrote = 0, closed = 0;
  for (const w of watches) {
    const stale = Date.now() - Date.parse(w.started_at) > STALE_MINS * 60_000;
    const c = await xiGet(key, `/convai/conversations/${w.conversation_id}`);
    if (!c) {
      await db.from("ava_live_watch").update({ polls: (w.polls ?? 0) + 1, last_poll_at: new Date().toISOString(),
        ...(stale ? { ended_at: new Date().toISOString(), status: "unreachable" } : {}) }).eq("conversation_id", w.conversation_id);
      if (stale) closed++;
      continue;
    }
    const status = String(c.status ?? "");
    const turns = spoken(c.transcript ?? []);
    const fresh = turns.slice(w.turns_seen ?? 0);

    if (fresh.length) {
      const rows = fresh.map((t, i) => ({
        conversation_id: w.conversation_id, source: w.source, seq: (w.turns_seen ?? 0) + i,
        role: t.role, text: (t.message ?? "").slice(0, 2000), at_secs: t.time_in_call_secs, interrupted: t.interrupted,
      }));
      const { error } = await db.from("ava_live_turns").upsert(rows, { onConflict: "conversation_id,seq", ignoreDuplicates: true });
      if (!error) wrote += rows.length;
    }

    const onCall = status === "in-progress";
    const done = !KEEP.has(status) || stale;
    await db.from("ava_live_watch").update({
      status, polls: (w.polls ?? 0) + 1, last_poll_at: new Date().toISOString(), turns_seen: turns.length,
      ...(turns.length && !w.first_turn_seen_at ? { first_turn_seen_at: new Date().toISOString() } : {}),
      // the answer to the open question: did we get words while the call was still going?
      ...(turns.length && onCall ? { mid_call_partial: true } : {}),
      ...(c.metadata?.call_duration_secs != null ? { duration_sec: c.metadata.call_duration_secs } : {}),
      ...(done ? { ended_at: new Date().toISOString() } : {}),
    }).eq("conversation_id", w.conversation_id);
    if (done) closed++;
  }
  return ok({ watched: watches.length, wrote, closed });
}

/** Catch a call nobody told us about (someone ringing in). Outbound calls are registered the moment they're placed. */
async function discover(key: string): Promise<Response> {
  const [{ data: rg }, { data: av }] = await Promise.all([
    db.from("rg_settings").select("agent_id").eq("id", true).maybeSingle(),
    db.from("ava_settings").select("agent_id").limit(1).maybeSingle(),
  ]);
  const agents: [string, string][] = [];
  if (rg?.agent_id) agents.push([rg.agent_id, "roofguard"]);
  if (av?.agent_id) agents.push([av.agent_id, "ava"]);
  if (!agents.length) return ok({ added: 0 });

  let added = 0;
  for (const [agentId, source] of agents) {
    const list = await xiGet(key, `/convai/conversations?agent_id=${agentId}&page_size=10`);
    const live = ((list?.conversations ?? []) as Raw[]).filter((c) => ON_CALL.has(String(c.status ?? ""))).slice(0, 3);
    for (const c of live) {
      const cid = String(c.conversation_id ?? "");
      if (!/^conv_[A-Za-z0-9]{6,60}$/.test(cid)) continue;
      const { data: known } = await db.from("ava_live_watch").select("conversation_id").eq("conversation_id", cid).maybeSingle();
      if (known) continue;
      const d = await xiGet(key, `/convai/conversations/${cid}`);
      const pc: Raw = d?.metadata?.phone_call ?? {};
      const phone = pc.external_number ?? null;
      const { data: call } = await db.from("rg_calls").select("id, lead_id").eq("conversation_id", cid).maybeSingle();
      const { error } = await db.from("ava_live_watch").insert({
        conversation_id: cid, source, call_id: call?.id ?? null, phone,
        direction: pc.direction ?? "inbound", status: String(d?.status ?? c.status ?? "initiated"),
      });
      if (!error) added++;
    }
  }
  // retention lives here, not in the sweep: 30 days of words is plenty and the table should not grow forever
  await db.from("ava_live_turns").delete().lt("first_seen_at", new Date(Date.now() - 30 * 864e5).toISOString());
  return ok({ added });
}

/** What the admin page reads. Our own tables only, so the page never waits on the voice platform. */
async function feed(body: Raw): Promise<Response> {
  const cid = typeof body.conversation_id === "string" ? body.conversation_id : null;
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  let q = db.from("ava_live_watch").select("*").gte("started_at", since).order("started_at", { ascending: false }).limit(8);
  if (cid) q = q.eq("conversation_id", cid);
  const { data: watches } = await q;
  if (!watches?.length) return ok({ calls: [] });

  const ids = watches.map((w) => w.conversation_id);
  const { data: turns } = await db.from("ava_live_turns").select("conversation_id, seq, role, text, at_secs, interrupted")
    .in("conversation_id", ids).order("seq", { ascending: true });

  const byId = new Map<string, Raw[]>();
  for (const t of turns ?? []) { const a = byId.get(t.conversation_id) ?? []; a.push(t); byId.set(t.conversation_id, a); }

  const calls = watches.map((w) => ({
    conversation_id: w.conversation_id, call_id: w.call_id, source: w.source, direction: w.direction,
    phone: w.phone, status: w.status, live: !w.ended_at && ON_CALL.has(String(w.status ?? "")),
    elapsed: Math.max(0, Math.round((Date.parse(w.ended_at ?? new Date().toISOString()) - Date.parse(w.started_at)) / 1000)),
    duration_sec: w.duration_sec, words_live: w.mid_call_partial === true,
    turns: byId.get(w.conversation_id) ?? [],
  }));
  return ok({ calls });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAdmin(req))) return new Response("unauthorized", { status: 401, headers: CORS });
  const b = await req.json().catch(() => ({}));
  const key = await vault("elevenlabs_api_key");
  if (!key) return err("The ElevenLabs key is missing from Vault.", 412);
  try {
    switch (b.action) {
      case "tick": return await tick(key);
      case "discover": return await discover(key);
      case "feed": return await feed(b);
      default: return err("unknown action");
    }
  } catch (e) {
    return err(`Something went wrong (${e instanceof Error ? e.message : "error"}).`, 500);
  }
});
