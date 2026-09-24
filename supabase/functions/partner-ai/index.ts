// partner-ai — answers Eli's Scout questions on the FREE LLM chain, the same one the admin Scout
// uses (groq -> Cloudflare Workers AI -> the Mac mini), and never on a paid model.
//
// Before this, /partner Scout could only be answered by worker.py on Jared's Mac mini. With the Mac
// asleep the question sat in partner_chat until partner_ai_claim() timed it out four minutes later
// ("Interrupted. Ask again."). Now the cloud answers in seconds and the Mac is just the last rung.
//
// Free is structural, not a setting:
//   - the call goes through the free-llm function with paid: "never", so the ladder throws
//     LlmUnavailable rather than reaching Anthropic;
//   - and an answer that somehow came back from a paid provider, or cost anything, is thrown away
//     here rather than written to the chat.
//
//   op tick   claim and answer up to `max` pending questions (default 3). Cron every minute
//             (partner-ai-drain) and fired by the portal the moment Eli sends, so it is instant.
//
// Auth: the service key (apikey or Bearer), or any signed-in user's JWT — a signed-in user may only
// nudge the drain, never choose whose question gets answered or read the answer.

import { createClient } from "jsr:@supabase/supabase-js@2";

const secretKeys = (() => {
  const out: string[] = [];
  try {
    const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    for (const v of Object.values(j)) if (typeof v === "string") out.push(v);
  } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) out.push(legacy);
  return out;
})();
const SECRET = secretKeys[0];
const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, SECRET, { auth: { persistSession: false }, global: { headers: { apikey: SECRET } } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o, null, 1), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

async function authorized(req: Request) {
  const apikey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secretKeys.includes(apikey) || secretKeys.includes(bearer)) return true;
  if (!bearer || bearer.split(".").length !== 3) return false;
  const { data } = await db.auth.getUser(bearer);
  return !!data?.user;
}

/* ───────── the prompt (same shape worker.py builds, so answers read the same) ───────── */

const ABOUT =
  `Bestly LLC is Jared Best's product studio (bestly.tech), privacy-first and plain-spoken. What it makes:
- In-House Cloud: a private cloud server (Nextcloud: files, calendar, Talk video calls, office docs) installed at a business, sold as a project (discovery call, SOW + deposit, tech intake, provisioning, install, live).
- Cookie Yeti: a browser extension and Apple app that handles cookie banners for you.
- InventoryProof: a home-inventory app for insurance claims (live on the App Store).
- Other products in the studio: SchoolPilot, ParentIQ, HOAscope, HOKU, El Dora, and Vesta (a women-only social + well-being app with Eli and Rohit).
Bestly runs its own tools on cloud.bestly.tech: Deck (Bestly Ops board), Talk, Files, Calendar, and Studio (studio.bestly.tech, the review queue).`;

const STAGE: Record<number, string> = {
  3: "Discovery", 4: "SOW + deposit", 5: "Tech intake", 6: "Provisioning", 7: "Install", 8: "Live",
};
const day = (s: unknown) => String(s ?? "").slice(0, 10);
const title = (s: unknown) => { const t = String(s ?? ""); return t ? t[0].toUpperCase() + t.slice(1) : t; };

function context(job: any): string {
  const name = job.name || "Partner";
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", weekday: "long", year: "numeric", month: "long", day: "numeric",
  }).format(new Date());
  const L: string[] = [
    `You are Scout, the Bestly assistant (named after the binoculars logo), chatting with ${name}. If asked who you are, you are Scout. Today is ${today}.`,
    "", ABOUT, "",
  ];

  const calls = job.calls ?? [];
  if (calls.length) {
    L.push(`Recent calls ${name} was on (newest first):`);
    for (const c of calls) {
      const s = c.summary ?? {};
      const others = (c.people ?? []).filter((p: string) => p.toLowerCase() !== String(name).toLowerCase()).map(title);
      L.push(`- ${day(c.date)} with Jared${others.length ? ` and ${others.join(", ")}` : ""}`);
      if (s.summary) L.push(`  Summary: ${s.summary}`);
      for (const d of (s.decisions ?? []).slice(0, 6)) L.push(`  Decided: ${d}`);
      for (const q of (s.questions ?? []).slice(0, 4)) L.push(`  Still open: ${q}`);
    }
    L.push("");
  }

  const todos = job.todos ?? [];
  if (todos.length) {
    L.push("Open to-dos from those calls:");
    for (const t of todos) L.push(`- [${title(t.owner ?? "?")}] ${t.title}${t.due ? ` (due ${t.due})` : ""}`);
    L.push("");
  }

  const emails = job.emails ?? [];
  if (emails.length) {
    L.push("Recent emails Jared sent them (newest first):");
    for (const e of emails) {
      const files = (e.files ?? []).filter(Boolean).join(", ");
      L.push(`- ${day(e.date)} "${e.subject || "(no subject)"}"${files ? ` (attached: ${files})` : ""}`);
      if (e.text) L.push("  " + String(e.text).split(/\s+/).join(" ").slice(0, 400));
    }
    L.push("");
  }

  const p = job.pipeline ?? {};
  if ((p.deals ?? []).length || (p.leads ?? []).length) {
    L.push("In-House Cloud pipeline:");
    for (const d of p.deals ?? []) L.push(`- ${d.company}: ${STAGE[d.stage] ?? `stage ${d.stage}`}`);
    for (const l of p.leads ?? []) L.push(`- ${l.company}: new lead (${l.size || "size unknown"})`);
    L.push("");
  }

  L.push(
    "How to answer: short, clear and friendly, like a sharp colleague texting back. Lead with the answer. " +
    "Use the calls, emails, to-dos and pipeline above when they're relevant and say which call a fact came from. " +
    "If something isn't in them, say you don't know rather than guessing, and suggest asking Jared. " +
    "Never invent numbers, prices, dates or commitments. You can't send messages, change anything or see " +
    "anything beyond what's above; you can draft emails, messages, outlines and ideas for them to use. " +
    "Plain text, no markdown tables.",
  );
  return L.join("\n");
}

/** The conversation, flattened: the ladder takes one system + one user string, not a message array. */
function conversation(job: any): string {
  const hist = (job.history ?? []) as { role: string; content: string }[];
  const lines = hist.map((h) => `${h.role === "assistant" ? "Scout" : job.name || "Partner"}: ${String(h.content).slice(0, 1200)}`);
  lines.push(`${job.name || "Partner"}: ${job.question}`, "Scout:");
  return lines.join("\n");
}

/* ───────── the free ladder ───────── */

// "pick" is the routing key whose ladder is groq -> Cloudflare -> the Mac mini: the whole free chain,
// in that order. ("write" would route to Cloudflare alone and prefers the paid rung.)
async function askFree(system: string, user: string) {
  const r = await fetch(`${URL_}/functions/v1/free-llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ op: "run", task: "pick", system, user, paid: "never", privacy: "private", maxTokens: 1200 }),
    signal: AbortSignal.timeout(110_000),
  });
  const j = await r.json().catch(() => ({ ok: false, error: `free-llm ${r.status}` }));
  if (!j?.ok) return { error: String(j?.error ?? "no free model answered"), tried: j?.tried };
  // Free means free. An answer off a paid provider, or one that cost anything, is not written.
  if (j.provider === "anthropic" || Number(j.cost_usd ?? 0) > 0) {
    return { error: `refused a paid answer from ${j.provider}`, tried: j.tried };
  }
  const text = String(j.text ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) return { error: "the free model came back empty", tried: j.tried };
  return { text, provider: String(j.provider), model: String(j.model) };
}

const WHY_NONE =
  "The free AI is busy or resting right now, so I couldn't get to this one. Give it a minute and ask again — " +
  "nothing here ever runs on a paid model.";

async function answerOne(job: any) {
  const replyId = job.reply_id as string;
  try {
    const r = await askFree(context(job), conversation(job));
    if ("text" in r && r.text) {
      await db.rpc("partner_ai_write_cloud", { p_reply_id: replyId, p_content: r.text, p_done: true });
      return { reply_id: replyId, ok: true, provider: r.provider, model: r.model, chars: r.text.length };
    }
    await db.rpc("partner_ai_write_cloud", { p_reply_id: replyId, p_content: WHY_NONE, p_done: false, p_error: WHY_NONE });
    return { reply_id: replyId, ok: false, error: (r as any).error, tried: (r as any).tried };
  } catch (e) {
    const msg = (e as Error).message;
    await db.rpc("partner_ai_write_cloud", { p_reply_id: replyId, p_content: WHY_NONE, p_done: false, p_error: WHY_NONE });
    return { reply_id: replyId, ok: false, error: msg };
  }
}

async function tick(max: number) {
  const out: unknown[] = [];
  for (let i = 0; i < max; i++) {
    const { data: job, error } = await db.rpc("partner_ai_claim_cloud");
    if (error) { out.push({ error: error.message }); break; }
    if (!job) break; // nothing waiting
    out.push(await answerOne(job));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await authorized(req))) return J({ ok: false, error: "unauthorized" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is a tick */ }
  const op = body.op ?? "tick";
  if (op !== "tick") return J({ ok: false, error: "op must be tick" }, 400);
  try {
    return J({ ok: true, answered: await tick(Math.min(Number(body.max ?? 3) || 3, 8)) });
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 200);
  }
});
