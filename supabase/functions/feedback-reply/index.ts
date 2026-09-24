// feedback-reply — drafts Studio's answer to a client's note on a post.
// Jared reads it, edits it, and chooses Agree or Push back; nothing here is
// ever sent to the client. Auth: a staff token (Studio button) or the cron key
// in vault (feedback_draft_key) for the pre-draft pass. (Cowork / Spark 2026-09-23)
import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-draft-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const cleanKey = (raw?: string) => { if (!raw) return ""; const m = raw.match(/sk-ant-[A-Za-z0-9_\-]{20,}/); return (m ? m[0] : raw).trim(); };

const SYSTEM = `You help a small social-media studio answer its client's feedback on a finished video or post.
The studio owner (Jared) thinks most of this work is already right and wants to push back kindly and clearly, so the client understands the reason and the post can go back to her without an email thread.

You get: her note, the post, the studio's design reasons (RATIONALE), her other recent notes, and past replies the studio actually sent (follow their tone).

Decide a recommendation:
- "pushback" when a RATIONALE reason clearly covers her specific point (size of cards, the corner deck, series consistency), or when it is a matter of taste on a finished video.
- "agree" when she points at something plainly wrong: a typo, a wrong fact, text cut off, or what is shown on screen not matching what is being said at that moment.
- "ask" only when you truly cannot tell what she means; the reply asks one short, specific question.
A reason counts only if it clearly covers her point. Do not stretch a reason to cover something it does not say.

Write the reply TO HER, from the studio, as "we", addressing her as "you":
- 2 to 4 short sentences, warm and direct, no filler, no apologising for the work, no exclamation marks, no emoji.
- Name what she noticed in plain words, then the reason. If pushing back, end by saying we are keeping it as is and sending it back for her OK.
- If agreeing, say briefly what we will change and that the new cut comes back to her.
- Use ONLY reasons from RATIONALE or obvious facts about phones and social feeds. Never invent research, numbers, timestamps or claims about her product or health.
- Never say "mom" or "mama" unless she did.

Return ONLY JSON: {"call":"pushback|agree|ask","reply":"...","why":"one line for Jared: which reason you used, or why you agreed"}`;

async function draft(reviewId: string) {
  const { data: ctx, error } = await db.rpc("feedback_draft_context", { p_review: reviewId });
  if (error || !ctx) return { ok: false, error: "no_context" };
  const key = cleanKey(Deno.env.get("ANTHROPIC_API_KEY"));
  if (!key) return { ok: false, error: "not_configured" };
  const user = JSON.stringify(ctx);
  for (const model of MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 500, system: SYSTEM, messages: [{ role: "user", content: user }] }),
    });
    if (r.status === 404 || r.status === 400) continue;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: `model ${r.status}` };
    const txt = ((j as any).content ?? []).filter((x: any) => x.type === "text").map((x: any) => x.text).join("").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    let out: any = null; try { out = m ? JSON.parse(m[0]) : null; } catch { out = null; }
    if (!out?.reply) return { ok: false, error: "unparsed" };
    const d = { call: ["pushback", "agree", "ask"].includes(out.call) ? out.call : "pushback", reply: String(out.reply).slice(0, 1200), why: String(out.why ?? "").slice(0, 300), model, by: "Spark" };
    await db.rpc("feedback_draft_save", { p_review: reviewId, p_draft: d });
    return { ok: true, draft: d };
  }
  return { ok: false, error: "no model" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return J({ ok: false, error: "json" }, 400); }
  const ids = (Array.isArray(b.reviews) ? b.reviews : [b.review]).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 20);
  if (!ids.length) return J({ ok: false, error: "review required" }, 400);
  const ck = req.headers.get("x-draft-key") ?? "";
  let allowed = false;
  if (ck) { const { data } = await db.rpc("feedback_draft_key_ok", { p_key: ck }); allowed = data === true; }
  if (!allowed && b.token) {
    const { data: s } = await db.rpc("studio_resolve_staff", { p_token: String(b.token) });
    const who = (Array.isArray(s) ? s[0] : s) as Record<string, unknown> | null;
    allowed = !!who?.id;
  }
  if (!allowed) return J({ ok: false, error: "not_found" }, 401);
  // four at a time, so a batch of twelve finishes well inside the timeout
  const out: Record<string, unknown> = {};
  for (let i = 0; i < ids.length; i += 4) {
    const part = ids.slice(i, i + 4);
    const res = await Promise.all(part.map((id) => draft(id).catch(() => ({ ok: false, error: "threw" }))));
    part.forEach((id, k) => { out[id] = res[k]; });
  }
  return J({ ok: true, drafts: out });
});
