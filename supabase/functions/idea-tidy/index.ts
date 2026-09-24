// idea-tidy — the "Tidy it up for me" button on a client's "Send us an idea" sheet.
// She talks (the browser turns speech into words on her device; no audio ever
// reaches us) or types, then may ask for a short, clear version before sending.
// Only TEXT comes in here. Auth: her board token, resolved by
// approval_resolve_client — the same check every board RPC uses.
// (Cowork for Jared, 2026-09-23)
import { createClient } from "jsr:@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const MODELS = [Deno.env.get("IDEA_TIDY_MODEL") ?? "claude-haiku-4-5", "claude-sonnet-4-6"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const cleanKey = (raw?: string) => { if (!raw) return ""; const m = raw.match(/sk-ant-[A-Za-z0-9_\-]{20,}/); return (m ? m[0] : raw).trim(); };

const SYSTEM = `You tidy up an idea a client spoke or typed for her social-media team. It was often spoken aloud and transcribed, so it may ramble, repeat, or have transcription slips.
Rewrite it as a short, clear note IN HER VOICE (first person: "I", "my group"), as if she wrote it carefully herself:
- First line: the idea in one plain sentence.
- Then, only if she gave specifics, 1 to 4 short lines starting with "- ": who said what, what she saw, why it matters, any link or source she named.
Rules: every line must be something she actually said. Keep who-said-what exactly as she said it — never move her own suggestion into someone else's mouth. Add NOTHING: no statistics, sources, claims, advice, conclusions or padding. Fewer lines is better. Drop filler (um, like, so). Fix transcription slips only when the meaning is clear. If she says mamas, keep mamas (never moms). Plain text only, no headings, no bold, no preamble. Under 80 words.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return J({ ok: false, error: "json" }, 400); }
  const token = String(b.token ?? "");
  const text = String(b.text ?? "").trim();
  if (!token || text.length < 3) return J({ ok: false, error: "token and text required" }, 400);
  if (text.length > 8000) return J({ ok: false, error: "too_long" }, 400);
  const { data: c } = await db.rpc("approval_resolve_client", { p_token: token });
  const who = (Array.isArray(c) ? c[0] : c) as Record<string, unknown> | null;
  if (!who?.id) return J({ ok: false, error: "not_found" }, 401);
  const key = cleanKey(Deno.env.get("ANTHROPIC_API_KEY"));
  if (!key) return J({ ok: false, error: "not_configured" }, 503);
  for (const model of MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content: text }] }),
    });
    if (r.status === 404 || r.status === 400) continue;   // model name not on this key — try the next
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return J({ ok: false, error: `model ${r.status}` }, 502);
    const out = ((j as any).content ?? []).filter((x: any) => x.type === "text").map((x: any) => x.text).join("\n").trim();
    if (!out) return J({ ok: false, error: "empty" }, 502);
    return J({ ok: true, summary: out.slice(0, 1500), model });
  }
  return J({ ok: false, error: "no model" }, 502);
});
