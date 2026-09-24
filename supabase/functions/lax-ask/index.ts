// lax-ask — the free "Ask" helper on the LAX Turo guest page.
//
//   POST {token?|slug?, question}  → {ok, reply_id, status, content?}
//
// Ladder (all free):
//   1. Gemini free tier, when a key is in Vault (lax_ask_gemini_key). 12s budget.
//   2. Mac mini local model (Ollama qwen3 via the partner-ai worker). Page polls lax_ask_poll.
//   3. FAQ keyword match (lax_ask_fallback). lax_ask_poll + the watchdog fall back after ~50s on their own.
// The prompt is built in SQL (lax_ask_prompt) so every rung reads the same facts.
import { createClient } from "npm:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
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

async function gemini(key: string, p: Prompt, retried = false): Promise<string> {
  const contents = [...p.history, { role: "user", content: p.question }]
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent`, {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: p.system }] }, contents,
        // 2.5 models take a thinking budget; newer ones use thinking levels. Keep it fast either way.
        generationConfig: { temperature: 0.4, maxOutputTokens: 600, ...(p.model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : { thinkingConfig: { thinkingLevel: "low" } }) },
      }),
    });
    const j = await r.json();
    // A config field this model doesn't accept: retry once with plain settings.
    if (r.status === 400 && !retried && /thinking/i.test(j?.error?.message ?? "")) {
      const plain = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent`, {
        method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: p.system }] }, contents, generationConfig: { temperature: 0.4, maxOutputTokens: 600 } }),
      });
      const pj = await plain.json();
      if (!plain.ok) throw new Error(`gemini ${plain.status}: ${(pj?.error?.message ?? "").slice(0, 200)}`);
      return (pj.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? "").join("").trim().replace(/\*\*(.+?)\*\*/g, "$1");
    }
    if ((r.status === 503 || r.status === 429) && !retried) {
      for (const m of (await flashModels(key)).filter((n) => n !== p.model).slice(0, 2)) {
        try { return await gemini(key, { ...p, model: m }, true); } catch { /* try the next one */ }
      }
    }
    if (r.status === 404 && !retried) {
      const m = await newestFlash(key);
      if (m && m !== p.model) {
        await sb.rpc("lax_ask_set_model", { p_model: m });
        return await gemini(key, { ...p, model: m }, true);
      }
    }
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(j?.error?.message ?? JSON.stringify(j)).slice(0, 200)}`);
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? "").join("").trim();
    if (!text) throw new Error("gemini: empty answer (" + (j.candidates?.[0]?.finishReason ?? "no candidate") + ")");
    return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*[*-]\s+/gm, "• ");
  } finally { clearTimeout(timer); }
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

    const { data: key } = await sb.rpc("lax_ask_gemini_key");
    if (key) {
      const { data: p } = await sb.rpc("lax_ask_prompt", { p_reply_id: rid });
      // Hold the reply so the Mac mini doesn't answer it at the same time.
      await sb.from("lax_ask_msgs").update({ status: "working", updated_at: new Date().toISOString() }).eq("id", rid);
      try {
        const text = await gemini(key as string, p as Prompt);
        await sb.rpc("lax_ask_finish", { p_reply_id: rid, p_content: text, p_source: "gemini", p_done: true });
        await sb.rpc("lax_ask_gemini_result", { p_ok: true });
        return json({ ok: true, reply_id: rid, status: "done", content: text, left: start.left });
      } catch (e) {
        console.error(e);
        await sb.rpc("lax_ask_gemini_result", { p_ok: false, p_error: String(e) });
        // Hand it to the next rung.
        await sb.from("lax_ask_msgs").update({ status: "pending", created_at: new Date().toISOString() }).eq("id", rid).eq("status", "working");
      }
    }
    // Rung 2: the Mac mini picks it up if it's online; otherwise answer from the FAQ now.
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
