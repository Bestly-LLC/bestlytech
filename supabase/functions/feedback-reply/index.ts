// feedback-reply — drafts Studio's answer to a client's note on a post.
// Jared reads it, edits it, and chooses Agree or Push back; nothing here is
// ever sent to the client. Auth: a staff token (Studio button) or the cron key
// in vault (feedback_draft_key) for the pre-draft pass. (Cowork / Spark 2026-09-23)
// v2 (2026-09-23): drafts come from the free, no-training AI (_shared/free-llm.ts, Groq -> Cloudflare), $0.
// It never calls paid Claude: the hourly pre-draft pass was unlogged, ungated Sonnet spend.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm } from "../_shared/free-llm.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-draft-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

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
  const user = JSON.stringify(ctx);
  let r;
  try {
    r = await llm({ task: "summarize", system: SYSTEM, user, json: true, maxTokens: 1500, job: "feedback-draft", ref: reviewId,
      fn: "feedback-reply", scope: "background", paid: "never", deadlineMs: 60_000,
      validate: (o) => (o && typeof o.reply === "string" && o.reply.trim() ? null : "no reply") });
  } catch {
    return { ok: false, error: "free_ai_busy" };
  }
  const out = r.json;
  const d = { call: ["pushback", "agree", "ask"].includes(out.call) ? out.call : "pushback", reply: String(out.reply).replace(/\*\*/g, "").slice(0, 1200),
    why: String(out.why ?? "").slice(0, 300), model: r.model, by: "Spark" };
  await db.rpc("feedback_draft_save", { p_review: reviewId, p_draft: d });
  return { ok: true, draft: d };
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
