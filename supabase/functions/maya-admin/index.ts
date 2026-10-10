// maya-admin: read-only calls feed for the Maya Desk page (/admin/maya). Admin JWT only (verify_jwt = true,
// plus an explicit admin check). Maya = ElevenLabs agent "Maya - Bestly Sales Outreach", (213) 641-0074.
//
//   {action:"calls", limit?}          recent calls: time, length, caller, summary, ticket codes filed on the call
//   {action:"call", conversation_id}  one call: full transcript, summary, collected data, tickets
//
// Tickets themselves are read and changed through the admin_maya_* RPCs, not here.
import { createClient } from "jsr:@supabase/supabase-js@2";

const AGENT_ID = "agent_3701m4jbjnyef6ga4ys73xtbz37s";
const XI = "https://api.elevenlabs.io/v1";
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const serviceCall = (req: Request) => {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return [bearer, (req.headers.get("apikey") ?? "").trim()].some((t) => t && SERVICE_KEYS.has(t));
};
async function isAdmin(req: Request): Promise<boolean> {
  if (serviceCall(req)) return true;
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

type Turn = { role: string; message: string | null; time_in_call_secs?: number };
const slim = (t: Turn[] | undefined) => (t ?? []).filter((x) => x.message).map((x) => ({ role: x.role, text: x.message, t: x.time_in_call_secs ?? 0 }));

async function raise(ok: boolean, body?: string) {
  try {
    if (ok) await db.rpc("bestly_raise", { p_key: "maya.admin", p_kind: "resolved", p_severity: "info", p_title: "Maya: my admin page loads calls again", p_area: "maya" });
    else await db.rpc("bestly_raise", { p_key: "maya.admin", p_kind: "problem", p_severity: "warning", p_title: "Maya: my admin page can't load calls", p_body: body ?? null, p_area: "maya" });
  } catch { /* an alert must never be the thing that fails the page */ }
}
const fail = (error: string, status = 502) => Response.json({ ok: false, error }, { status, headers: CORS });

async function ticketsFor(ids: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!ids.length) return out;
  const { data } = await db.from("support_tickets").select("code, conversation_id").in("conversation_id", ids);
  for (const r of (data ?? []) as { code: string; conversation_id: string }[]) (out[r.conversation_id] ??= []).push(r.code);
  return out;
}

/** Run fn over items, at most `n` at a time. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]); }
  }));
  return res;
}

async function calls(key: string, limit: number): Promise<Response> {
  const lr = await fetch(`${XI}/convai/conversations?agent_id=${AGENT_ID}&page_size=${limit}`, { headers: { "xi-api-key": key } });
  if (!lr.ok) { await raise(false, `ElevenLabs answered ${lr.status}.`); return fail("Couldn't reach the call log. Try again in a minute."); }
  const list = ((await lr.json().catch(() => ({}))).conversations ?? []) as { conversation_id: string; start_time_unix_secs?: number; call_duration_secs?: number; status?: string; call_summary_title?: string; direction?: string }[];
  const tix = await ticketsFor(list.map((c) => c.conversation_id));
  const rows = await pool(list, 5, async (c) => {
    const r = await fetch(`${XI}/convai/conversations/${c.conversation_id}`, { headers: { "xi-api-key": key } });
    const d = r.ok ? await r.json().catch(() => ({})) : {};
    const pc = d?.metadata?.phone_call ?? {};
    const started = d?.metadata?.start_time_unix_secs ?? c.start_time_unix_secs ?? null;
    return {
      conversation_id: c.conversation_id,
      started_at: started ? new Date(started * 1000).toISOString() : null,
      duration_secs: d?.metadata?.call_duration_secs ?? c.call_duration_secs ?? null,
      status: d?.status ?? c.status ?? null,
      caller: pc.external_number ?? null,
      direction: pc.direction ?? c.direction ?? null,
      summary: d?.analysis?.transcript_summary ?? d?.analysis?.call_summary_title ?? c.call_summary_title ?? null,
      tickets: tix[c.conversation_id] ?? [],
    };
  });
  await raise(true);
  return Response.json({ ok: true, calls: rows }, { headers: CORS });
}

async function oneCall(key: string, id: string): Promise<Response> {
  if (!/^conv_[A-Za-z0-9]+$/.test(id)) return fail("That isn't a call id.", 400);
  const r = await fetch(`${XI}/convai/conversations/${id}`, { headers: { "xi-api-key": key } });
  if (!r.ok) { await raise(false, `ElevenLabs answered ${r.status} for a call.`); return fail("Couldn't open that call. Try again in a minute."); }
  const d = await r.json().catch(() => ({}));
  if (d?.agent_id !== AGENT_ID) return fail("That call isn't one of Maya's.", 404);
  const pc = d?.metadata?.phone_call ?? {};
  const started = d?.metadata?.start_time_unix_secs ?? null;
  const dc = (d?.analysis?.data_collection_results ?? {}) as Record<string, { value?: unknown; rationale?: string }>;
  const data = Object.entries(dc).map(([k, v]) => ({ key: k, value: v?.value ?? null })).filter((x) => x.value !== null && x.value !== "");
  const tix = await ticketsFor([id]);
  await raise(true);
  return Response.json({ ok: true, call: {
    conversation_id: id,
    started_at: started ? new Date(started * 1000).toISOString() : null,
    duration_secs: d?.metadata?.call_duration_secs ?? null,
    status: d?.status ?? null, caller: pc.external_number ?? null, direction: pc.direction ?? null,
    summary: d?.analysis?.transcript_summary ?? d?.analysis?.call_summary_title ?? null,
    data, transcript: slim(d?.transcript), tickets: tix[id] ?? [],
  } }, { headers: CORS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });
  if (!(await isAdmin(req))) return new Response("unauthorized", { status: 401, headers: CORS });
  let p: Record<string, unknown> = {};
  try { p = await req.json(); } catch { /* empty body */ }
  const { data: key } = await db.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  if (typeof key !== "string" || !key) { await raise(false, "The ElevenLabs key is missing from the vault."); return fail("Maya's call log isn't connected yet.", 500); }
  try {
    if (p.action === "calls") return await calls(key, Math.min(Math.max(Number(p.limit) || 25, 1), 50));
    if (p.action === "call") return await oneCall(key, String(p.conversation_id ?? ""));
    return fail("unknown action", 400);
  } catch (e) {
    await raise(false, String(e).slice(0, 200));
    return fail("Couldn't load calls. Try again in a minute.", 500);
  }
});
