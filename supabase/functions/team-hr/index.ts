// team-hr — the Team page's people desk (docs/org-chart-opusplan.md, round 2).
//   op welcome {slug}  write a new bot's profile (free AI, discovery theme) and email Jared a welcome card.
//                       Called by the bestly_agents insert trigger and retried by team_welcome_sweep.
//   op improve         The Improver: read the whole picture (improver_context) and save 3-6 ranked ideas.
//                       Weekly cron + the "Ask The Improver now" button. Nothing is changed by this function.
// Free AI only (the free-llm function's op run, paid: never). If every free model is down, welcome still sends
// with a plain profile, and improve records a failed check-in so Team Watch tells Scout.
// Auth: service key (apikey or Bearer) or an admin JWT. verify_jwt = false (new sb_secret keys are not JWTs).
import { createClient } from "jsr:@supabase/supabase-js@2";

const secretKeys = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
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
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const TO = "jared@bestly.tech";

async function authorized(req: Request) {
  const apikey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secretKeys.includes(apikey) || secretKeys.includes(bearer)) return true;
  if (!bearer || bearer.split(".").length !== 3) return false;
  const { data } = await db.auth.getUser(bearer);
  if (!data?.user) return false;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return !!ok;
}

/** One free-AI call through the free-llm function (FreeLLM -> Groq -> Cloudflare ...). Never paid. */
async function freeJson(task: string, system: string, user: string, maxTokens = 1200): Promise<any | null> {
  try {
    const r = await fetch(`${URL_}/functions/v1/free-llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SECRET, Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ op: "run", task, system, user, json: true, paid: "never", privacy: "private", maxTokens }),
    });
    const j = await r.json();
    if (!j?.ok) return null;
    if (j.json && typeof j.json === "object") return j.json;
    const m = String(j.text ?? "").match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

const pacific = (d = new Date()) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

/* ---------------------------------------------------------------- welcome */

const FIELD_NAMES = ["Lantern", "Compass", "Sextant", "Ranger", "Meridian", "Tracker", "Beacon", "Atlas", "Fieldnote", "Waypoint", "Trailhead", "Spyglass"];

async function welcome(slug: string) {
  const { data: ctx, error } = await db.rpc("team_welcome_get", { p_slug: slug });
  if (error || !ctx?.agent) return { ok: false, error: error?.message ?? "no such bot" };
  if (ctx.welcome?.sent_at) return { ok: true, skipped: "already welcomed" };
  const a = ctx.agent;

  let profile = a.profile && a.profile.personality ? a.profile : null;
  if (!profile) {
    const p = await freeJson("write",
      "You write fun, short crew profiles for Bestly's AI team. The team is themed like a discovery expedition: " +
      "Scout (binoculars) leads it; the bots are explorers, naturalists, cartographers, lookouts and field guides. " +
      "Warm, punchy, a little playful, never cheesy or long. Plain words, no emoji, no apostrophes in field_name. " +
      'Return JSON only: {"field_name":"one discovery-themed word that fits the job","personality":"2 short sentences",' +
      '"superpower":"one line","quirk":"one line","motto":"under 8 words","first_week":"what it will do in its first week, one line"}',
      JSON.stringify({ name: a.name, role: a.role, what_it_does: a.what_it_does, runs_on: a.runs_on, schedule: a.schedule,
        reports_to: ctx.boss?.name ?? null, works_with: ctx.liaison?.name ?? null, teammates: ctx.teammates }), 500);
    profile = p && p.personality ? p : {
      field_name: FIELD_NAMES[Math.abs([...slug].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % FIELD_NAMES.length],
      personality: `Quiet, steady and on time. ${a.name} does one job and does it well.`,
      superpower: a.what_it_does,
      quirk: "Checks in even when nothing happened, just to say so.",
      motto: "Report in. Every time.",
      first_week: `Learn the trail: ${a.schedule ?? "run on its schedule"} and check in after each run.`,
    };
    profile = { ...profile, written_at: new Date().toISOString() };
  }

  const key = Deno.env.get("RESEND_API_KEY");
  const messageId = crypto.randomUUID();
  if (!key) {
    await db.rpc("team_welcome_mark", { p_slug: slug, p_ok: false, p_error: "RESEND_API_KEY missing", p_profile: profile });
    return { ok: false, error: "RESEND_API_KEY missing" };
  }

  const row = (k: string, v: unknown) => v ? `<tr><td style="padding:8px 0;color:#6e6e73;font-size:13px;width:120px;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;color:#1d1d1f;font-size:15px;line-height:1.45">${esc(v)}</td></tr>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <p style="margin:0 0 12px;color:#6e6e73;font-size:13px;letter-spacing:.04em;text-transform:uppercase">Bestly expedition · new crew member</p>
    <div style="background:#fff;border-radius:22px;padding:28px 24px;box-shadow:0 1px 2px rgba(0,0,0,.06)">
      <p style="margin:0;color:#0a84ff;font-size:13px;font-weight:600">Suggested field name: ${esc(profile.field_name)}</p>
      <h1 style="margin:6px 0 2px;color:#1d1d1f;font-size:28px;line-height:1.15">Welcome aboard, ${esc(a.name)}</h1>
      <p style="margin:0 0 18px;color:#6e6e73;font-size:15px">${esc(a.role)}${ctx.boss?.name ? ` · reports to ${esc(ctx.boss.name)}` : ""}</p>
      <p style="margin:0 0 18px;color:#1d1d1f;font-size:16px;line-height:1.5">${esc(profile.personality)}</p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e5e5ea">
        ${row("The job", a.what_it_does)}
        ${row("Superpower", profile.superpower)}
        ${row("Quirk", profile.quirk)}
        ${row("Motto", profile.motto)}
        ${row("First week", profile.first_week)}
        ${row("Works from", ({ pi: "the Pi", mac_mini: "the Mac mini", macbook: "your MacBook", cloud: "the cloud", claude: "Claude" } as Record<string, string>)[a.runs_on] ?? a.runs_on)}
        ${row("How often", a.schedule)}
        ${ctx.liaison?.name ? row("Works with", `${ctx.liaison.name} (${ctx.liaison.role}), on your behalf`) : ""}
      </table>
      <a href="https://bestly.tech/admin/team" style="display:inline-block;margin-top:22px;background:#0a84ff;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:999px">Meet the crew</a>
    </div>
    <p style="margin:14px 4px 0;color:#8e8e93;font-size:12px;line-height:1.5">Joined ${esc(pacific())} · crew of ${esc(ctx.team_size)}. Like the field name? Rename it on the Team page. Scout keeps an eye on every crew member and tells you if one goes quiet.</p>
  </div></body></html>`;

  let ok = false, err = "";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Scout at Bestly <noreply@bestly.tech>", to: [TO],
        subject: `New crew member: ${a.name} joined the expedition`, html }),
    });
    ok = r.ok;
    if (!ok) err = `resend ${r.status}: ${(await r.text()).slice(0, 200)}`;
  } catch (e) {
    err = (e as Error).message;
  }
  await db.from("email_send_log").insert({ message_id: messageId, template_name: "team-welcome", recipient_email: TO,
    status: ok ? "sent" : "failed", error_message: ok ? null : err, metadata: { slug, provider: "resend" } });
  await db.rpc("team_welcome_mark", { p_slug: slug, p_ok: ok, p_error: ok ? null : err, p_profile: profile });
  return { ok, error: ok ? undefined : err, field_name: profile.field_name };
}

/* ---------------------------------------------------------------- The Improver */

async function improve() {
  const { data: ctx, error } = await db.rpc("improver_context");
  if (error) {
    await db.rpc("agent_beat", { p_slug: "improver", p_ok: false, p_summary: `Could not read the picture: ${error.message}`.slice(0, 200) });
    return { ok: false, error: error.message };
  }
  const out = await freeJson("reflect",
    "You are The Improver, Bestly's continuous-improvement analyst. Bestly is a one-person product studio run by Jared, " +
    "helped by a crew of AI bots (Scout is Chief of Staff). Jared wants: fewer tokens and less money spent, recurring jobs on " +
    "the always-on Raspberry Pi with free AI models first, fewer noisy alerts, a simpler admin, and smoother workflows. " +
    "Read the data and propose 3 to 6 concrete improvements, best first. Every idea must point at evidence in the data " +
    "(a number, a bot, a job, a problem). No generic advice, nothing already in past_ideas, nothing that needs Jared to ask " +
    "a third party. Plain words for someone busy. " +
    'Return JSON only: {"ideas":[{"title":"under 70 chars","area":"which part of Bestly","kind":"tokens|money|ux|workflow|reliability|security",' +
    '"why":"the evidence, one or two sentences","change":"exactly what to change, 1-3 short steps","effort":"S|M|L","impact":1-5}]}',
    JSON.stringify(ctx), 1800);
  const ideas = Array.isArray(out?.ideas) ? out.ideas.slice(0, 6) : [];
  if (!ideas.length) {
    await db.rpc("agent_beat", { p_slug: "improver", p_ok: false, p_summary: "Free AI did not answer this week; will try again next run" });
    return { ok: false, error: "no ideas from free AI" };
  }
  const { data: saved } = await db.rpc("improver_save", { p_ideas: ideas });
  await db.rpc("agent_beat", { p_slug: "improver", p_ok: true, p_summary: `${saved ?? 0} new ideas for you on the Team page` });
  if ((saved ?? 0) > 0) {
    await db.rpc("scout_notify", { p_title: `The Improver has ${saved} new idea${saved === 1 ? "" : "s"}`,
      p_body: ideas.slice(0, 3).map((i: any) => `• ${i.title}`).join("\n"), p_severity: "info", p_push: false,
      p_url: "/admin/team#ideas", p_dedupe: `improver-${new Date().toISOString().slice(0, 10)}` });
  }
  return { ok: true, saved, ideas: ideas.map((i: any) => i.title) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await authorized(req))) return J({ ok: false, error: "unauthorized" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  try {
    if (body.op === "welcome") return J(await welcome(String(body.slug ?? "")));
    if (body.op === "improve") return J(await improve());
    return J({ ok: false, error: "op must be welcome or improve" }, 400);
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 200);
  }
});
