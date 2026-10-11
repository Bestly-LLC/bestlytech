// agent-hub: the generic layer behind every template phone agent (Maya now, new agents later).
// Plan: docs/agent-template-opusplan.md. Registry: public.voice_agents. Ava and Reese are legacy and never touched here.
//
//   ?hook=post           ElevenLabs post-call webhook (HMAC, secret in Vault as home_hub_agent_hub_webhook_secret).
//                        Verified first (bad signature = 401), then upserted into agent_calls. verify_jwt = false.
//   {action:"setup"}     admin: {slug} -> make sure the workspace webhook "Agent hub post-call" exists and is attached to the
//                        agent (platform_settings.workspace_overrides.webhooks.post_call_webhook_id). The ONLY change made to the agent.
//   {action:"sync"}      admin/service: {slug, limit=100} -> backfill any finished conversation missing from agent_calls (oldest first).
//   {action:"live"}      admin: {slug} -> calls in progress right now with the transcript so far.
//   {action:"audio"}     admin: {call_id} -> the recording (streamed).
//   {action:"voices"} / {action:"voice_say"} / {action:"voice_use"}   the account's voices, a preview, set the agent's TTS voice.
//   {action:"kb_list"} / {action:"kb_get"} / {action:"kb_save"}        the agent's knowledge docs.
//   {action:"prompt_get"} / {action:"prompt_set"}   template agents only, only when Jared presses Save.
//   {action:"playbook_push"}  rewrite only the block between <!-- playbook --> and <!-- /playbook --> with the approved lines.
//
// Non-hook doors check the caller is an admin (or the service key, for cron). Secrets come from Vault, never from the browser.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";
const SELF = `${Deno.env.get("SUPABASE_URL")}/functions/v1/agent-hub`;
const HOOK_SECRET = "home_hub_agent_hub_webhook_secret";
const HOOK_NAME = "Agent hub post-call";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const MAX_CALL_SECS = 600;
const SLUG = /^[a-z][a-z0-9-]{1,31}$/;
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;

// deno-lint-ignore no-explicit-any
type Any = any;
type AgentRow = { slug: string; name: string; purpose: string; kind: string; elevenlabs_agent_id: string | null; webhook_id: string | null;
  settings: Record<string, unknown> | null; status: string; voice_id: string | null; tool_ids: string[] };

const jerr = (error: string, status = 400, extra: Record<string, unknown> = {}) => Response.json({ ok: false, error, ...extra }, { status, headers: CORS });
const jok = (o: Record<string, unknown> = {}) => Response.json({ ok: true, ...o }, { headers: CORS });

async function xiKey(): Promise<string | null> {
  const { data, error } = await db.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  return error || typeof data !== "string" || !data ? null : data;
}
const H = (key: string, json = true): Record<string, string> => json ? { "xi-api-key": key, "content-type": "application/json" } : { "xi-api-key": key };
async function hmacHex(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
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
const toE164 = (v: unknown) => {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `+1${d}` : (String(v ?? "").trim() || null);
};

async function getAgent(slug: unknown, needTemplate = true): Promise<AgentRow | null> {
  const s = String(slug ?? "");
  if (!SLUG.test(s)) return null;
  const { data } = await db.from("voice_agents").select("slug, name, purpose, kind, elevenlabs_agent_id, webhook_id, settings, status, voice_id, tool_ids").eq("slug", s).maybeSingle();
  if (!data) return null;
  if (needTemplate && (data.kind !== "template" || !data.elevenlabs_agent_id)) return null;
  return data as AgentRow;
}

// ---------- ingest: one finished conversation -> agent_calls ----------
type Turn = { role: string; message: string | null; time_in_call_secs?: number };
const slim = (t: Turn[] | undefined) => (t ?? []).filter((x) => x.message).map((x) => ({ role: x.role === "agent" ? "agent" : "user", text: x.message as string, t: x.time_in_call_secs ?? 0 }));
const NAME_KEYS = ["caller_name", "prospect_name", "name", "full_name", "contact_name"];

async function ingest(a: AgentRow, d: Any): Promise<{ created: boolean; call_no?: number | null }> {
  const cid = String(d.conversation_id ?? "");
  if (!/^[\w-]{6,80}$/.test(cid)) throw new Error("bad conversation id");
  const md = d.metadata ?? {};
  const pc = md.phone_call ?? null;
  const dur = Number.isFinite(Number(md.call_duration_secs)) ? Math.round(Number(md.call_duration_secs)) : null;
  const perMin = Number((a.settings ?? {}).cost_per_min ?? 0.12);
  const dcr = (d.analysis?.data_collection_results ?? {}) as Record<string, { value?: unknown }>;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dcr)) { const val = v?.value; if (val !== null && val !== undefined && val !== "") data[k] = val; }
  let callerName: string | null = null;
  for (const k of NAME_KEYS) { const v = data[k]; if (typeof v === "string" && v.trim()) { callerName = v.trim().slice(0, 80); break; } }
  const direction = pc ? (pc.direction === "outbound" ? "outbound" : "inbound") : "web";
  const row = {
    agent_slug: a.slug, conversation_id: cid, direction, phone: pc?.external_number ? toE164(pc.external_number) : null, caller_name: callerName,
    started_at: md.start_time_unix_secs ? new Date(Number(md.start_time_unix_secs) * 1000).toISOString() : new Date().toISOString(),
    duration_secs: dur, status: "completed",
    summary: d.analysis?.transcript_summary ? String(d.analysis.transcript_summary).slice(0, 2000) : null,
    title: d.analysis?.call_summary_title ? String(d.analysis.call_summary_title).slice(0, 160) : null,
    transcript: slim(d.transcript), data, cost: dur != null ? Math.round((dur / 60) * perMin * 10000) / 10000 : null,
    has_audio: d.has_audio === true || d.has_user_audio === true || d.has_response_audio === true,
  };
  const { data: ex } = await db.from("agent_calls").select("id, call_no").eq("conversation_id", cid).maybeSingle();
  if (ex) {
    const { error } = await db.from("agent_calls").update(row).eq("id", ex.id);
    if (error) throw new Error(error.message);
    return { created: false, call_no: ex.call_no };
  }
  const ins = await db.from("agent_calls").insert(row).select("call_no").single();
  if (ins.error) {
    if (ins.error.code === "23505") return { created: false };   // a racing webhook/sync inserted it first
    throw new Error(ins.error.message);
  }
  return { created: true, call_no: ins.data?.call_no };
}

// ---------- the post-call webhook ----------
async function postHook(req: Request): Promise<Response> {
  const { data: secret } = await db.rpc("home_hub_vault_get", { p_name: HOOK_SECRET });
  if (typeof secret !== "string" || !secret) return new Response("webhook secret not configured", { status: 412 });
  const raw = await req.text();
  const sig = req.headers.get("elevenlabs-signature") ?? "";
  const t = sig.match(/t=(\d+)/)?.[1], v0 = sig.match(/v0=([0-9a-f]+)/)?.[1];
  if (!t || !v0 || Math.abs(Date.now() / 1000 - Number(t)) > 30 * 60) return new Response("bad signature", { status: 401 });
  if (!safeEq(await hmacHex(secret, `${t}.${raw}`), v0)) return new Response("bad signature", { status: 401 });

  let evt: Any;
  try { evt = JSON.parse(raw); } catch { return Response.json({ ok: true, ignored: "not json" }); }
  if (evt.type !== "post_call_transcription") return Response.json({ ok: true, ignored: evt.type });
  const d = evt.data ?? {};
  const { data: a } = await db.from("voice_agents").select("slug, name, purpose, kind, elevenlabs_agent_id, webhook_id, settings, status, voice_id, tool_ids")
    .eq("kind", "template").eq("elevenlabs_agent_id", String(d.agent_id ?? "")).maybeSingle();
  if (!a) return Response.json({ ok: true, ignored: "not a template agent" });
  try {
    const r = await ingest(a as AgentRow, d);
    return Response.json({ ok: true, slug: a.slug, created: r.created, call_no: r.call_no ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// ---------- setup: attach the post-call webhook ----------
async function setup(slug: unknown): Promise<Response> {
  const a = await getAgent(slug);
  if (!a) return jerr("No such template agent.", 404);
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const log: string[] = [];
  const { data: have } = await db.rpc("home_hub_vault_get", { p_name: HOOK_SECRET });
  const haveSecret = typeof have === "string" && !!have;

  let webhookId = a.webhook_id;
  if (!webhookId) {
    const { data: other } = await db.from("voice_agents").select("webhook_id").not("webhook_id", "is", null).limit(1).maybeSingle();
    webhookId = other?.webhook_id ?? null;
  }
  if (!webhookId && haveSecret) {
    const list = ((await (await fetch(`${XI}/workspace/webhooks`, { headers: H(key, false) })).json().catch(() => ({}))).webhooks ?? []) as { webhook_id: string; name: string }[];
    webhookId = list.find((w) => w.name === HOOK_NAME)?.webhook_id ?? null;
  }
  if (!webhookId) {
    const r = await fetch(`${XI}/workspace/webhooks`, { method: "POST", headers: H(key), body: JSON.stringify({ settings: { auth_type: "hmac", name: HOOK_NAME, webhook_url: `${SELF}?hook=post` } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.webhook_id || !j.webhook_secret) return jerr(`Couldn't create the post-call webhook (${r.status}).`, 502);
    webhookId = j.webhook_id as string;
    const put = await db.rpc("home_hub_vault_put", { p_name: HOOK_SECRET, p_value: j.webhook_secret, p_description: "Agent hub post-call webhook signing secret" });
    if (put.error) return jerr("Created the webhook but couldn't save its secret to Vault.", 500);
    log.push("Post-call webhook created; secret saved to Vault.");
  } else if (!haveSecret) {
    return jerr("The webhook exists but its secret is not in Vault. Delete the \"Agent hub post-call\" webhook in ElevenLabs and run setup again.", 409);
  }
  await db.from("voice_agents").update({ webhook_id: webhookId, updated_at: new Date().toISOString() }).eq("slug", a.slug);

  const cur = await fetch(`${XI}/convai/agents/${a.elevenlabs_agent_id}`, { headers: H(key, false) });
  if (!cur.ok) return jerr(`Couldn't read the agent (${cur.status}).`, 502);
  const cj = await cur.json();
  const wh = (cj?.platform_settings?.workspace_overrides?.webhooks ?? {}) as Record<string, unknown>;
  if (wh.post_call_webhook_id === webhookId) {
    log.push("Webhook already attached.");
  } else {
    // Only this one key changes; the rest of the existing webhooks block is sent back unchanged.
    const next = { ...wh, post_call_webhook_id: webhookId, events: (wh.events as string[] | undefined)?.length ? wh.events : ["transcript"], send_audio: wh.send_audio ?? false };
    const pr = await fetch(`${XI}/convai/agents/${a.elevenlabs_agent_id}`, { method: "PATCH", headers: H(key),
      body: JSON.stringify({ platform_settings: { workspace_overrides: { webhooks: next } } }) });
    if (!pr.ok) return jerr(`The voice platform wouldn't attach the webhook (${pr.status}): ${(await pr.text().catch(() => "")).slice(0, 200)}`, 502);
    log.push("Webhook attached.");
  }
  const back = await fetch(`${XI}/convai/agents/${a.elevenlabs_agent_id}`, { headers: H(key, false) });
  const bj = back.ok ? await back.json() : null;
  const attached = bj?.platform_settings?.workspace_overrides?.webhooks?.post_call_webhook_id === webhookId;
  return Response.json({ ok: attached, webhook_id: webhookId, attached, log, error: attached ? undefined : "Read the agent back and the webhook is not attached." }, { headers: CORS });
}

// ---------- sync: backfill missing finished conversations ----------
type ConvRow = { conversation_id: string; status: string; start_time_unix_secs?: number };
async function listConversations(key: string, agentId: string, limit: number): Promise<ConvRow[]> {
  const out: ConvRow[] = [];
  let cursor = "";
  for (let i = 0; i < 6 && out.length < limit; i++) {
    const q = new URLSearchParams({ agent_id: agentId, page_size: String(Math.min(100, limit)) });
    if (cursor) q.set("cursor", cursor);
    const r = await fetch(`${XI}/convai/conversations?${q}`, { headers: H(key, false) });
    if (!r.ok) throw new Error(`conversations ${r.status}`);
    const j = await r.json();
    out.push(...((j.conversations ?? []) as ConvRow[]));
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  return out.slice(0, limit);
}

async function syncAgent(a: AgentRow, key: string, limit: number): Promise<{ listed: number; added: number; call_nos: (number | null | undefined)[] }> {
  const convs = await listConversations(key, a.elevenlabs_agent_id!, limit);
  const ids = convs.map((c) => c.conversation_id);
  const have = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from("agent_calls").select("conversation_id").in("conversation_id", ids.slice(i, i + 100));
    (data ?? []).forEach((r: { conversation_id: string }) => have.add(r.conversation_id));
  }
  const missing = convs.filter((c) => c.status === "done" && !have.has(c.conversation_id))
    .sort((x, y) => (x.start_time_unix_secs ?? 0) - (y.start_time_unix_secs ?? 0));
  const details: Any[] = [];
  for (let i = 0; i < missing.length; i += 6) {
    const got = await Promise.all(missing.slice(i, i + 6).map(async (c) => {
      const r = await fetch(`${XI}/convai/conversations/${c.conversation_id}`, { headers: H(key, false) });
      return r.ok ? await r.json().catch(() => null) : null;
    }));
    details.push(...got);
  }
  const callNos: (number | null | undefined)[] = [];
  let added = 0;
  for (const d of details) {      // already oldest first, so call numbers follow the calendar
    if (!d || d.status !== "done") continue;
    const r = await ingest(a, d);
    if (r.created) { added += 1; callNos.push(r.call_no); }
  }
  await db.from("agent_health").upsert({ agent_slug: a.slug, last_sync_at: new Date().toISOString() }, { onConflict: "agent_slug" });
  return { listed: convs.length, added, call_nos: callNos };
}

async function syncAction(b: Record<string, unknown>): Promise<Response> {
  const a = await getAgent(b.slug);
  if (!a) return jerr("No such template agent.", 404);
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const limit = Math.max(1, Math.min(200, Math.floor(Number(b.limit) || 100)));
  try { return jok(await syncAgent(a, key, limit)); }
  catch (e) { return jerr(`Sync failed: ${(e as Error).message}`, 502); }
}

// ---------- live + audio ----------
function isLiveConv(c: { status: string; start_time_unix_secs?: number }): boolean {
  if (!["initiated", "in-progress", "processing"].includes(c.status)) return false;
  const age = c.start_time_unix_secs ? Date.now() / 1000 - c.start_time_unix_secs : 0;
  if (c.status === "initiated" && age > 90) return false;
  return age <= MAX_CALL_SECS + 120;
}

async function live(slug: unknown): Promise<Response> {
  const a = await getAgent(slug);
  if (!a) return jerr("No such template agent.", 404);
  const key = await xiKey();
  if (!key) return jok({ calls: [] });
  const lr = await fetch(`${XI}/convai/conversations?agent_id=${a.elevenlabs_agent_id}&page_size=10`, { headers: H(key, false) });
  const list = ((await lr.json().catch(() => ({}))).conversations ?? []) as ConvRow[];
  const active = list.filter(isLiveConv).slice(0, 3);
  const calls = await Promise.all(active.map(async (c) => {
    const d = await (await fetch(`${XI}/convai/conversations/${c.conversation_id}`, { headers: H(key, false) })).json().catch(() => ({}));
    const pc = d.metadata?.phone_call ?? null;
    return { conversation_id: c.conversation_id, status: d.status ?? c.status, direction: pc ? (pc.direction === "outbound" ? "outbound" : "inbound") : "web",
      phone: pc?.external_number ? toE164(pc.external_number) : null,
      elapsed: d.metadata?.start_time_unix_secs ? Math.round(Date.now() / 1000 - d.metadata.start_time_unix_secs) : 0, transcript: slim(d.transcript) };
  }));
  return jok({ calls });
}

async function audio(callId: unknown): Promise<Response> {
  const key = await xiKey();
  const id = String(callId ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("no recording for this call", { status: 404, headers: CORS });
  const { data: c } = await db.from("agent_calls").select("conversation_id").eq("id", id).maybeSingle();
  if (!key || !c?.conversation_id) return new Response("no recording for this call", { status: 404, headers: CORS });
  const res = await fetch(`${XI}/convai/conversations/${c.conversation_id}/audio`, { headers: { "xi-api-key": key } });
  if (!res.ok || !res.body) return new Response("recording not available yet", { status: res.status === 404 ? 404 : 502, headers: CORS });
  return new Response(res.body, { headers: { ...CORS, "content-type": res.headers.get("content-type") ?? "audio/mpeg", "cache-control": "private, max-age=3600" } });
}

// ---------- voices ----------
const trimTo = (v: unknown, n: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}.` : t; };
function slimVoice(v: Any) {
  const l = (v.labels ?? {}) as Record<string, string>;
  const full = String(v.name ?? "");
  const [head, ...rest] = full.split(/\s+[-–—]\s+/);
  return { voice_id: String(v.voice_id ?? ""), name: (head ?? "").trim() || full, accent: String(v.accent ?? l.accent ?? ""), age: String(v.age ?? l.age ?? ""),
    gender: String(v.gender ?? l.gender ?? ""), description: trimTo(v.description || rest.join(" - ") || l.descriptive, 100), preview_url: (v.preview_url as string | undefined) ?? null };
}

async function voices(b: Record<string, unknown>): Promise<Response> {
  const a = await getAgent(b.slug);
  if (!a) return jerr("No such template agent.", 404);
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  try {
    const out: ReturnType<typeof slimVoice>[] = [];
    let token = "";
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${XI.replace("/v1", "/v2")}/voices?page_size=100${token ? `&next_page_token=${encodeURIComponent(token)}` : ""}`, { headers: H(key, false) });
      if (!r.ok) throw new Error(`voices ${r.status}`);
      const j = await r.json();
      for (const v of (j.voices ?? []) as Any[]) { if (v.category === "cloned") continue; out.push(slimVoice(v)); }
      if (!j.has_more || !j.next_page_token) break;
      token = j.next_page_token;
    }
    // the agent's live voice (read from the agent so the page never shows a stale choice)
    const ar = await fetch(`${XI}/convai/agents/${a.elevenlabs_agent_id}`, { headers: H(key, false) });
    const aj = ar.ok ? await ar.json() : null;
    const currentId = String(aj?.conversation_config?.tts?.voice_id ?? a.voice_id ?? "");
    let current = out.find((v) => v.voice_id === currentId) ?? null;
    if (!current && currentId) {
      const vr = await fetch(`${XI}/voices/${currentId}`, { headers: H(key, false) });
      current = vr.ok ? slimVoice(await vr.json()) : { voice_id: currentId, name: "Current voice", accent: "", age: "", gender: "", description: "", preview_url: null };
    }
    return jok({ current, library: out });
  } catch (e) {
    return jerr(`Couldn't load voices right now (${(e as Error).message}). Try again.`, 502);
  }
}

async function voiceSay(b: Record<string, unknown>): Promise<Response> {
  const voice = String(b.voice_id ?? ""), text = String(b.text ?? "").replace(/\s+/g, " ").trim();
  if (!VOICE_ID.test(voice)) return jerr("Pick a voice first.");
  if (!text) return jerr("Type something for it to say.");
  if (text.length > 200) return jerr("Keep it to 200 characters.");
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const res = await fetch(`${XI}/text-to-speech/${voice}?output_format=mp3_44100_64`, { method: "POST", headers: H(key), body: JSON.stringify({ text, model_id: "eleven_flash_v2" }) });
  if (!res.ok || !res.body) { await res.text().catch(() => ""); return jerr(res.status === 404 ? "That voice isn't in your account anymore. Reload the list." : "The voice platform couldn't make that sample. Try again.", res.status === 404 ? 404 : 502); }
  return new Response(res.body, { headers: { ...CORS, "content-type": "audio/mpeg", "cache-control": "no-store" } });
}

async function voiceUse(b: Record<string, unknown>): Promise<Response> {
  const a = await getAgent(b.slug);
  if (!a) return jerr("No such template agent.", 404);
  const vid = String(b.voice_id ?? "");
  if (!VOICE_ID.test(vid)) return jerr("Pick a voice first.");
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const vr = await fetch(`${XI}/voices/${vid}`, { headers: H(key, false) });
  if (!vr.ok) { await vr.text().catch(() => ""); return jerr("That voice isn't in your account. Reload the list and try again.", 404); }
  const pr = await fetch(`${XI}/convai/agents/${a.elevenlabs_agent_id}`, { method: "PATCH", headers: H(key), body: JSON.stringify({ conversation_config: { tts: { voice_id: vid } } }) });
  if (!pr.ok) { await pr.text().catch(() => ""); return jerr("The voice platform wouldn't switch the voice. Try again.", 502); }
  await db.from("voice_agents").update({ voice_id: vid, updated_at: new Date().toISOString() }).eq("slug", a.slug);
  return jok({ voice_id: vid });
}

// ---------- knowledge ----------
type KbRef = { type?: string; name: string; id: string; usage_mode?: string };
async function readAgent(a: AgentRow, key: string): Promise<Any | null> {
  const r = await fetch(`${XI}/convai/agents/${a.elevenlabs_agent_id}`, { headers: H(key, false) });
  return r.ok ? await r.json() : null;
}

async function kbList(b: Record<string, unknown>): Promise<Response> {
  const a = await getAgent(b.slug);
  if (!a) return jerr("No such template agent.", 404);
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const aj = await readAgent(a, key);
  if (!aj) return jerr("Couldn't read the agent.", 502);
  const refs = (aj.conversation_config?.agent?.prompt?.knowledge_base ?? []) as KbRef[];
  const docs = await Promise.all(refs.map(async (k) => {
    const r = await fetch(`${XI}/convai/knowledge-base/${k.id}`, { headers: H(key, false) });
    const j = r.ok ? await r.json().catch(() => ({})) : {};
    return { id: k.id, name: k.name, type: k.type ?? j.type ?? "text", size_bytes: j.metadata?.size_bytes ?? null };
  }));
  return jok({ docs });
}

async function kbGet(b: Record<string, unknown>): Promise<Response> {
  const a = await getAgent(b.slug);
  if (!a) return jerr("No such template agent.", 404);
  const id = String(b.doc_id ?? "");
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return jerr("Pick a document first.");
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const aj = await readAgent(a, key);
  const refs = (aj?.conversation_config?.agent?.prompt?.knowledge_base ?? []) as KbRef[];
  const ref = refs.find((k) => k.id === id);
  if (!ref) return jerr("That document isn't on this agent.", 404);
  const r = await fetch(`${XI}/convai/knowledge-base/${id}/content`, { headers: H(key, false) });
  if (!r.ok) { await r.text().catch(() => ""); return jerr("Couldn't read that document.", 502); }
  const text = await r.text();
  return jok({ id, name: ref.name, text: text.length > 200_000 ? text.slice(0, 200_000) : text });
}

/** ElevenLabs text docs are not edited in place: make a new doc and swap it into the agent's list, keeping the others. */
async function kbSave(b: Record<string, unknown>): Promise<Response> {
  const a = await getAgent(b.slug);
  if (!a) return jerr("No such template agent.", 404);
  const name = trimTo(b.name, 80), text = String(b.text ?? "");
  if (!name) return jerr("Give the document a name.");
  if (!text.trim()) return jerr("The document is empty.");
  if (text.length > 200_000) return jerr("That document is too long. Keep it under 200,000 characters.");
  const docId = b.doc_id ? String(b.doc_id) : "";
  if (docId && !/^[A-Za-z0-9]{10,40}$/.test(docId)) return jerr("Bad document id.");
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const aj = await readAgent(a, key);
  if (!aj) return jerr("Couldn't read the agent.", 502);
  const refs = (aj.conversation_config?.agent?.prompt?.knowledge_base ?? []) as KbRef[];
  if (docId && !refs.some((k) => k.id === docId)) return jerr("That document isn't on this agent.", 404);
  const cr = await fetch(`${XI}/convai/knowledge-base/text`, { method: "POST", headers: H(key), body: JSON.stringify({ text, name }) });
  const cj = await cr.json().catch(() => ({}));
  if (!cr.ok || !cj.id) return jerr(`The voice platform couldn't save the document (${cr.status}).`, 502);
  const fresh: KbRef = { type: "text", name, id: cj.id, usage_mode: refs.find((k) => k.id === docId)?.usage_mode ?? "auto" };
  const next = docId ? refs.map((k) => (k.id === docId ? fresh : k)) : [...refs, fresh];
  const pr = await fetch(`${XI}/convai/agents/${a.elevenlabs_agent_id}`, { method: "PATCH", headers: H(key),
    body: JSON.stringify({ conversation_config: { agent: { prompt: { knowledge_base: next } } } }) });
  if (!pr.ok) return jerr(`Saved the document but couldn't attach it (${pr.status}). The old one is still in use.`, 502, { new_doc_id: cj.id });
  return jok({ doc_id: cj.id, replaced: docId || null });
}

// ---------- prompt + playbook ----------
async function promptGet(b: Record<string, unknown>): Promise<Response> {
  const a = await getAgent(b.slug);
  if (!a) return jerr("No such template agent.", 404);
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const aj = await readAgent(a, key);
  if (!aj) return jerr("Couldn't read the agent.", 502);
  const ag = aj.conversation_config?.agent ?? {};
  return jok({ prompt: String(ag.prompt?.prompt ?? ""), first_message: String(ag.first_message ?? ""), llm: ag.prompt?.llm ?? null });
}

async function promptSet(b: Record<string, unknown>): Promise<Response> {
  const a = await getAgent(b.slug);
  if (!a) return jerr("No such template agent.", 404);
  const prompt = String(b.prompt ?? ""), first = String(b.first_message ?? "");
  if (prompt.trim().length < 20) return jerr("The prompt is too short to save.");
  if (prompt.length > 60_000) return jerr("The prompt is too long.");
  if (first.length > 500) return jerr("Keep the greeting under 500 characters.");
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const pr = await fetch(`${XI}/convai/agents/${a.elevenlabs_agent_id}`, { method: "PATCH", headers: H(key),
    body: JSON.stringify({ conversation_config: { agent: { first_message: first, prompt: { prompt } } } }) });
  if (!pr.ok) return jerr(`The voice platform wouldn't save it (${pr.status}).`, 502);
  return jok({});
}

const PB_OPEN = "<!-- playbook -->", PB_CLOSE = "<!-- /playbook -->";
function playbookBlock(lines: string[]): string {
  const body = lines.length ? lines.map((l) => `- ${l}`).join("\n") : "(none yet)";
  return `${PB_OPEN}\n# Learned playbook (approved by Jared)\n${body}\n${PB_CLOSE}`;
}

async function playbookPush(b: Record<string, unknown>): Promise<Response> {
  const a = await getAgent(b.slug);
  if (!a) return jerr("No such template agent.", 404);
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const { data: on } = await db.from("agent_playbook").select("line").eq("agent_slug", a.slug).eq("status", "on").order("created_at");
  const lines = (on ?? []).map((r: { line: string }) => String(r.line).replace(/\s+/g, " ").trim()).filter(Boolean);
  const aj = await readAgent(a, key);
  if (!aj) return jerr("Couldn't read the agent.", 502);
  const cur = String(aj.conversation_config?.agent?.prompt?.prompt ?? "");
  const block = playbookBlock(lines);
  const i = cur.indexOf(PB_OPEN), j = cur.indexOf(PB_CLOSE);
  let next: string;
  if (i >= 0 && j > i) next = cur.slice(0, i) + block + cur.slice(j + PB_CLOSE.length);
  else if (!lines.length) return jok({ changed: false, lines: 0 });          // nothing to add and no block to empty
  else next = `${cur.replace(/\s+$/, "")}\n\n${block}\n`;
  if (next === cur) return jok({ changed: false, lines: lines.length });
  const pr = await fetch(`${XI}/convai/agents/${a.elevenlabs_agent_id}`, { method: "PATCH", headers: H(key),
    body: JSON.stringify({ conversation_config: { agent: { prompt: { prompt: next } } } }) });
  if (!pr.ok) return jerr(`The voice platform wouldn't save the playbook (${pr.status}).`, 502);
  return jok({ changed: true, lines: lines.length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  if (url.searchParams.get("hook") === "post") return postHook(req);
  if (!(await isAdmin(req))) return new Response("unauthorized", { status: 401, headers: CORS });
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.action) {
      case "setup": return await setup(body.slug);
      case "sync": return await syncAction(body);
      case "live": return await live(body.slug);
      case "audio": return await audio(body.call_id);
      case "voices": return await voices(body);
      case "voice_say": return await voiceSay(body);
      case "voice_use": return await voiceUse(body);
      case "kb_list": return await kbList(body);
      case "kb_get": return await kbGet(body);
      case "kb_save": return await kbSave(body);
      case "prompt_get": return await promptGet(body);
      case "prompt_set": return await promptSet(body);
      case "playbook_push": return await playbookPush(body);
      default: return jerr("unknown action", 400);
    }
  } catch (e) {
    return jerr(`Something went wrong: ${(e as Error).message}`, 500);
  }
});
