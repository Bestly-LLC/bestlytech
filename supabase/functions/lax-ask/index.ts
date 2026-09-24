// lax-ask — the free "Ask" helper on the Turo guest trip pages (LAX + Home).
//
//   POST {token?|slug?, question}  → {ok, reply_id, status, content?, fixed?}
//
// v7: live status is pre-loaded into the prompt; Groq gets a compact prompt.
// v6: on a personal trip link the helper is an AGENT. It can look at the live systems for this guest's trip
// (key, invite, Tesla jobs, car, TezLab + Mac helper) and run a few safe fixes: re-check the key with Tesla,
// resend the key, make it now, refresh the car, or wake the host. Every action is scoped to the token's trip,
// rate-limited and logged in SQL (lax_agent_act), and fixes are reported to Scout.
//
// Ladder (all free):
//   1. Gemini free tier (tools on personal links).
//   2. Groq free (gpt-oss, OpenAI-style tools) when Gemini is out of quota or down.
//   3. Mac mini local model (Ollama) via lax_ask_poll (no tools).
//   4. FAQ keyword match (lax_ask_fallback).
import { createClient } from "npm:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Prompt = { system: string; history: { role: string; content: string }[]; question: string; reply_id: number; model: string };
type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: unknown; thoughtSignature?: string; thought?: boolean };
type Content = { role: string; parts: Part[] };
type Result = { text: string; actions: string[]; via: string };

const AGENT_RULES = `
YOU ARE ALSO THE TRIP'S NIGHT-SHIFT FIXER. You have tools that look at the real systems for THIS guest's trip and can fix common problems. The host may be asleep, so you are the first responder.
- When the guest reports a problem (key not showing, car not in their Tesla app, invite expired, key link broken, car not responding, buttons not working) or asks about their key's status: read the LIVE STATUS in your instructions first (call diagnose only to re-check after a fix). Never guess.
- Then pick the smallest fix that matches what you see:
  * key status ready but guest says they accepted -> check_key (asks Tesla who is on the car).
  * accepted but the car isn't in their app, or the link says expired/invalid/already used, or they used the wrong Tesla account -> resend_key (cancels the old invite, a fresh link appears on their page in ~30 seconds; tell them to tap it signed in to the Tesla account they will drive with).
  * scheduled/failed/expired within 3 hours of pickup and they need it now -> make_key_now.
  * car data looks old or offline -> refresh_car.
- After a tool that starts a job, call job_status once to confirm before telling the guest it worked.
- If you can't fix it after one attempt, or anything involves safety, damage, money, the reservation, or someone driving who isn't approved in Turo: call notify_host with a one-line summary, and tell the guest the host has been alerted and what to do meanwhile.
- Never invent status. Only say what diagnose/job_status returned. Don't mention tools, jobs, IDs or systems by name: speak plainly ("I just sent you a fresh key, it's on your page now").
- ANTICIPATE: use the trip phase and time to add ONE useful next step at the end (e.g. 40 minutes before pickup: "Cool it down now so it's comfy when you get there"; key ready but not added: "Tap Add the car to my Tesla app"; 2 hours before return: charging + photos reminder). Keep it to one line.`;

const DECL = [
  { name: "diagnose", description: "Live status for this guest's trip: key/invite status and times, extra drivers, recent Tesla jobs and errors, car battery/temp/connection, whether climate buttons are open, trip phase.", parameters: { type: "OBJECT", properties: {} } },
  { name: "check_key", description: "Ask Tesla which drivers are on the car now, to confirm whether the guest's key was accepted. Use when status is ready but the guest says they accepted.", parameters: { type: "OBJECT", properties: {} } },
  { name: "resend_key", description: "Cancel the guest's current Tesla invite (and remove the car from their app) and create a fresh invite link on their page. Max twice per 6 hours.", parameters: { type: "OBJECT", properties: { reason: { type: "STRING", description: "why, in one line" } }, required: ["reason"] } },
  { name: "make_key_now", description: "Create the key now if it hasn't been made or failed (only within 3 hours of pickup).", parameters: { type: "OBJECT", properties: { reason: { type: "STRING" } }, required: ["reason"] } },
  { name: "refresh_car", description: "Ask the car for a fresh reading (battery, temperature, online).", parameters: { type: "OBJECT", properties: {} } },
  { name: "job_status", description: "Result of a job started by check_key, resend_key, make_key_now or refresh_car. Waits up to ~12 seconds.", parameters: { type: "OBJECT", properties: { job: { type: "NUMBER" } }, required: ["job"] } },
  { name: "notify_host", description: "Alert the host (Jared) on his phone right now. Use when you can't fix it or it needs a person.", parameters: { type: "OBJECT", properties: { summary: { type: "STRING", description: "one or two lines: what's wrong, what you tried" } }, required: ["summary"] } },
];
const GEMINI_TOOLS = [{ functionDeclarations: DECL }];
// OpenAI-style (Groq): lower-case JSON schema types.
const lower = (o: unknown): unknown => Array.isArray(o) ? o.map(lower) : o && typeof o === "object"
  ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toLowerCase() : lower(v)])) : o;
const OPENAI_TOOLS = DECL.map((d) => ({ type: "function", function: lower(d) }));

async function runTool(token: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const act = async (a: string, note?: unknown) => (await sb.rpc("lax_agent_act", { p_token: token, p_action: a, p_note: note ? String(note).slice(0, 300) : null })).data;
  switch (name) {
    case "diagnose": return (await sb.rpc("lax_agent_diag", { p_token: token })).data;
    case "check_key": return await act("check_key");
    case "resend_key": return await act("resend_key", args.reason);
    case "make_key_now": return await act("make_key_now", args.reason);
    case "refresh_car": return await act("refresh_car");
    case "notify_host": return await act("notify_host", args.summary);
    case "job_status": {
      const id = Number(args.job);
      let last: unknown = null;
      for (let i = 0; i < 12; i++) {
        last = (await sb.rpc("lax_agent_job", { p_token: token, p_job: id })).data;
        const st = (last as { status?: string } | null)?.status;
        if (st === "done" || st === "failed") return last;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return { ...((last as object) ?? {}), note: "still running; it usually finishes within a minute" };
    }
  }
  return { error: "unknown tool" };
}

// Google retires model names; when that happens, list the models this key can use and switch to the newest Flash.
let flashCache: string[] | null = null;
async function flashModels(key: string): Promise<string[]> {
  if (flashCache) return flashCache;
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
  if (!r.ok) return [];
  const j = await r.json();
  const names = ((j.models ?? []) as { name: string; supportedGenerationMethods?: string[] }[])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n));
  const ver = (n: string) => parseFloat(n.split("-")[1]) - (n.endsWith("-lite") ? 0.01 : 0);
  names.sort((a, b) => ver(b) - ver(a));
  flashCache = names;
  return names;
}
async function newestFlash(key: string): Promise<string | null> {
  return (await flashModels(key)).find((n) => !n.endsWith("-lite")) ?? null;
}

const clean = (t: string) => t.trim().replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*[*-]\s+/gm, "• ");

async function gcall(key: string, model: string, system: string, contents: Content[], tools: boolean, plain = false) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const gen = plain ? { temperature: 0.4, maxOutputTokens: 700 }
      : { temperature: 0.4, maxOutputTokens: 700, ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : { thinkingConfig: { thinkingLevel: "low" } }) };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: gen, ...(tools ? { tools: GEMINI_TOOLS } : {}) }),
    });
    return { r, j: await r.json() };
  } finally { clearTimeout(timer); }
}

async function gemini(key: string, p: Prompt, token: string | null, retried = false): Promise<Result> {
  const tools = !!token;
  const system = tools ? p.system + "\n" + AGENT_RULES : p.system;
  const contents: Content[] = [...p.history, { role: "user", content: p.question }]
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const actions: string[] = [];
  let plain = false;
  for (let round = 0; round < 6; round++) {
    let { r, j } = await gcall(key, p.model, system, contents, tools, plain);
    if (r.status === 400 && !plain && /thinking/i.test(j?.error?.message ?? "")) { plain = true; ({ r, j } = await gcall(key, p.model, system, contents, tools, true)); }
    if (r.status === 503 && !retried && round === 0) {
      for (const m of (await flashModels(key)).filter((n) => n !== p.model).slice(0, 1)) {
        try { return await gemini(key, { ...p, model: m }, token, true); } catch { /* next rung */ }
      }
    }
    if (r.status === 404 && !retried) {
      const m = await newestFlash(key);
      if (m && m !== p.model) { await sb.rpc("lax_ask_set_model", { p_model: m }); return await gemini(key, { ...p, model: m }, token, true); }
    }
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(j?.error?.message ?? JSON.stringify(j)).slice(0, 200)}`);
    const parts: Part[] = j.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((x) => x.functionCall);
    if (!calls.length || !tools) {
      const text = parts.filter((x) => !x.thought).map((x) => x.text ?? "").join("");
      if (!text.trim()) throw new Error("gemini: empty answer (" + (j.candidates?.[0]?.finishReason ?? "no candidate") + ")");
      return { text: clean(text), actions, via: "gemini" };
    }
    // Echo the model turn back exactly (thought signatures included), then answer every call.
    contents.push({ role: "model", parts });
    const responses: Part[] = [];
    for (const c of calls) {
      const name = c.functionCall!.name;
      let out: unknown;
      try { out = await runTool(token!, name, c.functionCall!.args ?? {}); } catch (e) { out = { error: String(e).slice(0, 200) }; }
      actions.push(name);
      responses.push({ functionResponse: { name, response: { result: out ?? null } } });
    }
    contents.push({ role: "user", parts: responses });
  }
  throw new Error("agent: too many tool rounds");
}

// Rung 2: Groq (free, private-OK per house rules), OpenAI-compatible tool calling.
async function groq(key: string, p: Prompt, token: string | null): Promise<Result> {
  const tools = !!token;
  type Msg = { role: string; content: string | null; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]; tool_call_id?: string };
  // Groq's free tier allows ~8K tokens a minute: drop the long FAQ/manual block, keep facts + live status + rules.
  const faqAt = p.system.indexOf("\nFAQ (the source of truth):"), howAt = p.system.indexOf("HOW TO ANSWER:");
  const compact = faqAt > 0 && howAt > faqAt ? p.system.slice(0, faqAt) + "\n" + p.system.slice(howAt) : p.system;
  const messages: Msg[] = [{ role: "system", content: tools ? compact + "\n" + AGENT_RULES : compact },
    ...p.history.slice(-4).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })), { role: "user", content: p.question }];
  const actions: string[] = [];
  for (const model of ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"]) {
    try {
      for (let round = 0; round < 6; round++) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 15000);
        let j: { choices?: { message: Msg }[]; error?: { message?: string } };
        let status = 0;
        try {
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 900, ...(tools ? { tools: OPENAI_TOOLS, tool_choice: "auto" } : {}) }),
          });
          status = r.status; j = await r.json();
        } finally { clearTimeout(timer); }
        if (status !== 200) throw new Error(`groq ${status}: ${(j?.error?.message ?? "").slice(0, 160)}`);
        const msg = j.choices?.[0]?.message;
        if (!msg) throw new Error("groq: no message");
        if (!msg.tool_calls?.length || !tools) {
          if (!msg.content?.trim()) throw new Error("groq: empty answer");
          return { text: clean(msg.content), actions, via: "groq" };
        }
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const c of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* empty */ }
          let out: unknown;
          try { out = await runTool(token!, c.function.name, args); } catch (e) { out = { error: String(e).slice(0, 200) }; }
          actions.push(c.function.name);
          messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out ?? null).slice(0, 6000) });
        }
      }
      throw new Error("agent: too many tool rounds");
    } catch (e) {
      if (model.startsWith("llama") || actions.length) throw e;  // don't redo actions on a second model
      console.error(e);
    }
  }
  throw new Error("groq: no model answered");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const { data: start, error } = await sb.rpc("lax_ask_start", { p_token: b.token ?? null, p_slug: b.slug ?? null, p_question: String(b.question ?? "") });
    if (error) throw error;
    if (!start?.ok) return json(start ?? { ok: false, error: "Try again" });
    const rid = start.reply_id as number;
    const token = typeof b.token === "string" && b.token ? b.token : null;

    const { data: gkey } = await sb.rpc("lax_ask_gemini_key");
    const { data: keys } = await sb.rpc("llm_keys");
    const groqKey = (keys as Record<string, string> | null)?.groq_api_key;
    if (gkey || groqKey) {
      const { data: p } = await sb.rpc("lax_ask_prompt", { p_reply_id: rid });
      if (token && p) {
        const { data: diag } = await sb.rpc("lax_agent_diag", { p_token: token });
        if (diag) (p as Prompt).system += "\nLIVE STATUS RIGHT NOW (already checked for you; call diagnose again only after a fix):\n" + JSON.stringify(diag).slice(0, 2500);
      }
      await sb.from("lax_ask_msgs").update({ status: "working", updated_at: new Date().toISOString() }).eq("id", rid);
      let res: Result | null = null;
      if (gkey) {
        try { res = await gemini(gkey as string, p as Prompt, token); await sb.rpc("lax_ask_gemini_result", { p_ok: true }); }
        catch (e) { console.error(e); await sb.rpc("lax_ask_gemini_result", { p_ok: false, p_error: String(e) }); }
      }
      if (!res && groqKey) {
        try { res = await groq(groqKey, p as Prompt, token); } catch (e) { console.error(e); await sb.rpc("lax_ask_agent_result", { p_via: "groq", p_ok: false, p_error: String(e) }).then(() => {}, () => {}); }
      }
      if (res) {
        const src = res.via + (res.actions.length ? "-agent" : "");
        await sb.rpc("lax_ask_finish", { p_reply_id: rid, p_content: res.text, p_source: src, p_done: true });
        if (res.via === "groq") await sb.rpc("lax_ask_agent_result", { p_via: "groq", p_ok: true }).then(() => {}, () => {});
        return json({ ok: true, reply_id: rid, status: "done", content: res.text, left: start.left, fixed: res.actions.some((a) => a === "resend_key" || a === "make_key_now") });
      }
      await sb.from("lax_ask_msgs").update({ status: "pending", created_at: new Date().toISOString() }).eq("id", rid).eq("status", "working");
    }
    const { data: local } = await sb.rpc("lax_ask_local_online");
    if (local) return json({ ok: true, reply_id: rid, status: "pending", left: start.left });
    await sb.rpc("lax_ask_fallback", { p_reply_id: rid });
    const { data: done } = await sb.from("lax_ask_msgs").select("content,status").eq("id", rid).single();
    return json({ ok: true, reply_id: rid, status: done?.status ?? "done", content: done?.content ?? "", left: start.left });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "The helper hit a snag. Try again, or message your host in the Turo app." }, 500);
  }
});
