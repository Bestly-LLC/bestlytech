// team-hr — the Team page's people desk (docs/org-chart-opusplan.md, round 2).
//   op welcome {slug}  write a new bot's profile (free AI, discovery theme) and email Jared a welcome card with
//                       the bot's animated mascot GIF (bestly.tech/mascots/<icon>.gif, built by scripts/mascot-gifs).
//                       {preview: true} re-sends it marked [Preview] without touching the welcome record.
//                       Called by the bestly_agents insert trigger and retried by team_welcome_sweep.
//   op improve         The Improver: read the whole picture (improver_context) and save 3-6 ranked ideas.
//                       Weekly cron + the "Ask The Improver now" button. Nothing is changed by this function.
//   op recruit         The Recruiter + The Improver: the Recruiter proposes new bots for real gaps (hr_context),
//                       The Improver vets each one; only hires both back show up in "Suggested hires" (hr_save).
//                       Weekly cron (Mon 9:15 AM, after The Improver) + the "Look for hires now" button.
//   op reorg           Reorg round ("layoffs"): The Recruiter finds bots whose jobs overlap, sit idle or aren't needed,
//                       The Improver vets each; only moves both back reach Jared in "Reorg" (reorg_save).
//                       Weekly cron (Mon 9:30 AM) + the "Run a reorg review" button. Changes nothing by itself.
//   op farewell {id}   After Jared lets a bot go: a short farewell email with its mascot GIF and where its work went.
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

const SITE = "https://www.bestly.tech";   // canonical host (bestly.tech 308s here)

/** The bot's mascot GIF; falls back to the plain bot face if its GIF isn't built yet (never a broken image). */
async function mascotUrl(icon: string | null) {
  for (const name of [icon, "bot"]) {
    if (!name || !/^[a-z0-9-]+$/.test(name)) continue;
    const url = `${SITE}/mascots/${name}.gif`;
    try {
      const r = await fetch(url, { method: "HEAD" });
      if (r.ok && (r.headers.get("content-type") ?? "").includes("gif")) return { url, fallback: name !== icon };
    } catch { /* try the next one */ }
  }
  return null;
}

async function welcome(slug: string, preview = false) {
  const { data: ctx, error } = await db.rpc("team_welcome_get", { p_slug: slug });
  if (error || !ctx?.agent) return { ok: false, error: error?.message ?? "no such bot" };
  if (ctx.welcome?.sent_at && !preview) return { ok: true, skipped: "already welcomed" };
  const a = ctx.agent;
  const training = a.status === "planned";   // hired from Suggested hires, Scout still building it

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

  const mascot = await mascotUrl(a.icon ?? null);
  const row = (k: string, v: unknown) => v ? `<tr><td style="padding:8px 0;color:#6e6e73;font-size:13px;width:120px;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;color:#1d1d1f;font-size:15px;line-height:1.45">${esc(v)}</td></tr>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <p style="margin:0 0 12px;color:#6e6e73;font-size:13px;letter-spacing:.04em;text-transform:uppercase">Bestly expedition · new crew member</p>
    <div style="background:#fff;border-radius:22px;padding:28px 24px;box-shadow:0 1px 2px rgba(0,0,0,.06)">
      ${mascot ? `<img src="${mascot.url}" width="96" height="96" alt="${esc(a.name)}, the new crew member" style="display:block;width:96px;height:96px;border:0;margin:0 0 14px">` : ""}
      <p style="margin:0;color:#0a84ff;font-size:13px;font-weight:600">Suggested field name: ${esc(profile.field_name)}</p>
      <h1 style="margin:6px 0 2px;color:#1d1d1f;font-size:28px;line-height:1.15">Welcome aboard, ${esc(a.name)}</h1>
      <p style="margin:0 0 18px;color:#6e6e73;font-size:15px">${esc(a.role)}${ctx.boss?.name ? ` · reports to ${esc(ctx.boss.name)}` : ""}</p>
      ${training ? `<p style="margin:0 0 18px;background:#fff4e5;color:#8a4b00;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.45">In training. You hired it from Suggested hires; Scout has the build plan and waits for your yes before anything runs.</p>` : ""}
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
        subject: (preview ? "[Preview] " : "") + (training ? `New hire: ${a.name} joined the expedition (in training)` : `New crew member: ${a.name} joined the expedition`), html }),
    });
    ok = r.ok;
    if (!ok) err = `resend ${r.status}: ${(await r.text()).slice(0, 200)}`;
  } catch (e) {
    err = (e as Error).message;
  }
  await db.from("email_send_log").insert({ message_id: messageId, template_name: "team-welcome", recipient_email: TO,
    status: ok ? "sent" : "failed", error_message: ok ? null : err,
    metadata: { slug, provider: "resend", preview, mascot: mascot?.url ?? null, mascot_fallback: mascot?.fallback ?? null } });
  if (!preview) await db.rpc("team_welcome_mark", { p_slug: slug, p_ok: ok, p_error: ok ? null : err, p_profile: profile });
  return { ok, error: ok ? undefined : err, field_name: profile.field_name, mascot: mascot?.url ?? null };
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

/* ---------------------------------------------------------------- The Recruiter (+ The Improver's second opinion) */

async function recruit() {
  const { data: ctx, error } = await db.rpc("hr_context");
  if (error) {
    await db.rpc("agent_beat", { p_slug: "hr", p_ok: false, p_summary: `Could not read the picture: ${error.message}`.slice(0, 200) });
    return { ok: false, error: error.message };
  }

  // 1. The Recruiter: where is a bot missing?
  const pitch = await freeJson("reflect",
    "You are The Recruiter, HR for Bestly's crew of AI bots. Bestly is a one-person product studio run by Jared; " +
    "Scout is Chief of Staff and the bots in roster already exist. Find 1 to 4 jobs NO current bot covers that a new bot " +
    "could take off Jared's plate. Evidence must come from the data: The Improver's ideas, problems that keep coming back, " +
    "failing jobs, open roles, recent decisions. Never propose a bot that overlaps one in roster or past_hires. " +
    "Prefer cheap: runs on the always-on Raspberry Pi (pi) with free AI models; use claude only when it truly needs it. " +
    "Nothing that needs Jared to ask a third party for anything. Plain words for someone busy. Names are short job titles " +
    "like Invoice Chaser or Alert Tamer. reports_to must be a slug from roster (an existing lead, or scout). " +
    'Return JSON only: {"candidates":[{"name":"2-3 words","role":"under 6 words","dept":"one of departments",' +
    '"reports_to":"slug","what_it_does":"one or two sentences","why":"the evidence for the gap, one or two sentences",' +
    '"saves":"what it saves Jared, one line","runs_on":"pi|cloud|claude|mac_mini","schedule":"how often, plain words",' +
    '"cost":"rough monthly cost in plain words","first_task":"the first thing it would do"}]}',
    JSON.stringify(ctx), 1800);
  const cands = Array.isArray(pitch?.candidates) ? pitch.candidates.filter((c: any) => c?.name).slice(0, 4) : [];
  if (!cands.length) {
    await db.rpc("agent_beat", { p_slug: "hr", p_ok: false, p_summary: "Free AI did not answer this week; will try again next run" });
    return { ok: false, error: "no candidates from free AI" };
  }

  // 2. The Improver vets every candidate against the same picture
  const review = await freeJson("reflect",
    "You are The Improver, Bestly's continuous-improvement analyst. The Recruiter wants to hire these new bots. " +
    "Check each one against the data: does it fix something real, does it overlap a bot in roster, is it worth what it costs " +
    "in tokens, money and upkeep, could an existing bot or a small change do it instead? Be tough: back only hires that clearly pay off. " +
    'Return JSON only: {"reviews":[{"name":"exact candidate name","verdict":"back|pass","score":1-5,"note":"one or two sentences, plain words"}]}',
    JSON.stringify({ candidates: cands, roster: ctx.roster, ai_spend_7d: ctx.ai_spend_7d, noisy_problems_14d: ctx.noisy_problems_14d,
      failing_db_jobs_7d: ctx.failing_db_jobs_7d, improver_ideas: ctx.improver_ideas }), 1200);
  const reviews: any[] = Array.isArray(review?.reviews) ? review.reviews : [];
  const byName = new Map(reviews.map((r) => [String(r?.name ?? "").toLowerCase().trim(), r]));
  if (!reviews.length) {
    // no second opinion = nobody gets through; try again next run rather than hire on one bot's word
    await db.rpc("agent_beat", { p_slug: "hr", p_ok: false, p_summary: "The Improver could not review the candidates; trying again next run" });
    return { ok: false, error: "no review from The Improver" };
  }
  const rows = cands.map((c: any) => {
    const r = byName.get(String(c.name).toLowerCase().trim());
    // free models vary the wording ("Back", "backed", "yes", "hire"); a missing verdict with a 4-5 score counts as backing
    const v = String(r?.verdict ?? "").toLowerCase().trim();
    const score = Number(r?.score ?? 0);
    const backs = /^(back|yes|hire|approve)/.test(v) || (!/^(pass|no|reject|veto)/.test(v) && score >= 4);
    return { ...c, verdict: backs ? "back" : "pass", improver_score: Number.isFinite(score) && score > 0 ? score : null, improver_note: r?.note ?? "No review" };
  });

  const { data: saved } = await db.rpc("hr_save", { p_hires: rows });
  const backed = rows.filter((r: any) => r.verdict === "back");
  const summary = backed.length
    ? `${backed.length} hire${backed.length === 1 ? "" : "s"} backed by The Improver, waiting for you`
    : `Looked at ${rows.length}; The Improver passed on all of them`;
  await db.rpc("agent_beat", { p_slug: "hr", p_ok: true, p_summary: summary });
  if (backed.length && (saved ?? 0) > 0) {
    await db.rpc("scout_notify", { p_title: `${backed.length} suggested hire${backed.length === 1 ? "" : "s"} for the crew`,
      p_body: backed.map((b: any) => `• ${b.name}: ${b.role ?? ""}`).join("\n"), p_severity: "info", p_push: false,
      p_url: "/admin/team#hires", p_dedupe: `hr-${new Date().toISOString().slice(0, 10)}` });
  }
  return { ok: true, saved, backed: backed.map((b: any) => b.name), passed: rows.filter((r: any) => r.verdict !== "back").map((r: any) => r.name) };
}

/* ---------------------------------------------------------------- reorgs (The Recruiter + The Improver) */

const PROTECTED = new Set(["scout", "improver", "hr", "fix-ladder", "team-watch", "team-watch-ping"]);

async function reorg() {
  const { data: ctx, error } = await db.rpc("reorg_context");
  if (error) {
    await db.rpc("agent_beat", { p_slug: "hr", p_ok: false, p_summary: `Reorg review could not read the picture: ${error.message}`.slice(0, 200) });
    return { ok: false, error: error.message };
  }
  const slugs = new Set((ctx.roster ?? []).map((r: any) => r.slug));

  // 1. The Recruiter: where is the crew bigger than the work?
  const pitch = await freeJson("reflect",
    "You are The Recruiter, HR for Bestly's crew of AI bots, running this week's reorg review. Bestly is a one-person product " +
    "studio run by Jared. Goal: only the bots needed to run the business, nothing convoluted. Find 0 to 3 bots in roster to let go: " +
    "kind merge = its job overlaps another bot, so its duties move to that bot (give into = that bot's slug); kind retire = its job " +
    "is no longer needed (idle, duplicated, switched off for good, failing with nobody missing it). Evidence must come from the data " +
    "(team health and last run, failing jobs, AI spend, noisy problems, recent decisions). Never pick a bot in protected, a person, " +
    "or one in past_reorgs. Proposing nothing is a fine answer when the crew is lean. Plain words for someone busy. " +
    "For every move, list its handover: split the bot's job into 1 to 4 duties and say which bot (slug from roster) takes each one, " +
    "or null if that duty is simply dropped. " +
    'Return JSON only: {"moves":[{"bot":"slug","kind":"merge|retire","into":"slug or null","why":"the evidence, one or two sentences",' +
    '"change":"what moves where, one line","saves":"what it saves, one line","risk":"what could break, one line",' +
    '"handover":[{"duty":"one duty, plain words","to":"slug or null"}]}]}',
    JSON.stringify(ctx), 1500);
  const moves = (Array.isArray(pitch?.moves) ? pitch.moves : [])
    .filter((m: any) => m?.bot && slugs.has(m.bot) && !PROTECTED.has(m.bot))
    .map((m: any) => ({ ...m, into: m.into && slugs.has(m.into) && m.into !== m.bot ? m.into : null, kind: m.kind === "merge" && m.into ? "merge" : "retire",
      handover: (Array.isArray(m.handover) ? m.handover : []).filter((h: any) => h?.duty).slice(0, 4)
        .map((h: any) => ({ duty: String(h.duty), to: h.to && slugs.has(h.to) && h.to !== m.bot ? h.to : null })) }))
    .slice(0, 3);
  if (pitch == null) {
    await db.rpc("agent_beat", { p_slug: "hr", p_ok: false, p_summary: "Reorg review: free AI did not answer; will try again next run" });
    return { ok: false, error: "no answer from free AI" };
  }
  if (!moves.length) {
    await db.rpc("agent_beat", { p_slug: "hr", p_ok: true, p_summary: "Reorg review: the crew is lean, nobody to let go this week" });
    return { ok: true, saved: 0, backed: [], passed: [] };
  }

  // 2. The Improver vets every move against the same picture
  const review = await freeJson("reflect",
    "You are The Improver, Bestly's continuous-improvement analyst. The Recruiter proposes letting these bots go. For each, check the " +
    "data: is the job really covered elsewhere or not needed, would Jared lose anything he relies on, does the bot taking over actually " +
    "do similar work, and does every duty in the handover land somewhere sensible (or is it truly safe to drop)? " +
    "Back only moves that clearly simplify the business without losing anything important. " +
    'Return JSON only: {"reviews":[{"bot":"exact slug","verdict":"back|pass","score":1-5,"note":"one or two sentences, plain words"}]}',
    JSON.stringify({ moves, roster: ctx.roster, team: ctx.team, failing_db_jobs_7d: ctx.failing_db_jobs_7d, ai_spend_7d: ctx.ai_spend_7d,
      improver_ideas: ctx.improver_ideas }), 1200);
  const reviews: any[] = Array.isArray(review?.reviews) ? review.reviews : [];
  if (!reviews.length) {
    await db.rpc("agent_beat", { p_slug: "hr", p_ok: false, p_summary: "Reorg review: The Improver could not review; trying again next run" });
    return { ok: false, error: "no review from The Improver" };
  }
  const byBot = new Map(reviews.map((r) => [String(r?.bot ?? "").toLowerCase().trim(), r]));
  const rows = moves.map((m: any) => {
    const r = byBot.get(String(m.bot).toLowerCase());
    const v = String(r?.verdict ?? "").toLowerCase().trim();
    const score = Number(r?.score ?? 0);
    const backs = /^(back|yes|approve|agree)/.test(v) || (!/^(pass|no|reject|veto|keep)/.test(v) && score >= 4);
    return { ...m, verdict: backs ? "back" : "pass", improver_score: score > 0 ? score : null, improver_note: r?.note ?? "No review" };
  });
  const { data: saved } = await db.rpc("reorg_save", { p_moves: rows });
  const backed = rows.filter((r: any) => r.verdict === "back");
  await db.rpc("agent_beat", { p_slug: "hr", p_ok: true,
    p_summary: backed.length ? `Reorg review: ${backed.length} bot${backed.length === 1 ? "" : "s"} to let go, waiting for you` : "Reorg review: The Improver kept everyone this week" });
  if (backed.length && (saved ?? 0) > 0) {
    await db.rpc("scout_notify", { p_title: `Reorg: ${backed.length} bot${backed.length === 1 ? "" : "s"} could be let go`,
      p_body: backed.map((b: any) => `• ${b.bot}${b.into ? ` (work moves to ${b.into})` : ""}`).join("\n"), p_severity: "info", p_push: false,
      p_url: "/admin/team#reorg", p_dedupe: `reorg-${new Date().toISOString().slice(0, 10)}` });
  }
  return { ok: true, saved, backed: backed.map((b: any) => b.bot), passed: rows.filter((r: any) => r.verdict !== "back").map((r: any) => r.bot) };
}

async function farewell(id: string) {
  const { data: ctx, error } = await db.rpc("reorg_farewell_get", { p_id: id });
  if (error || !ctx?.agent) return { ok: false, error: error?.message ?? "no such reorg" };
  const a = ctx.agent, r = ctx.reorg;
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY missing" };
  const mascot = await mascotUrl(a.icon ?? null);
  const where = ctx.heir?.name ? `${ctx.heir.name} (${ctx.heir.role}) picks up its work.` : "Its job wasn't needed any more.";
  const duties: any[] = ctx.handover?.duties ?? [];
  const reports: any[] = ctx.handover?.reports ?? [];
  const handoverHtml = duties.length ? `
      <p style="margin:6px 0 6px;color:#1d1d1f;font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase">Who takes over what</p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e5e5ea;margin:0 0 12px">
        ${duties.map((d) => `<tr><td style="padding:8px 8px 8px 0;color:#1d1d1f;font-size:14px;line-height:1.4;vertical-align:top">${esc(d.duty)}</td>
          <td style="padding:8px 0;font-size:14px;line-height:1.4;vertical-align:top;text-align:right;white-space:nowrap;${d.to_name ? "color:#0a84ff;font-weight:600" : "color:#8e8e93"}">${d.to_name ? `&rarr; ${esc(d.to_name)}` : "Dropped"}</td></tr>`).join("")}
      </table>
      ${reports.length ? `<p style="margin:0 0 12px;color:#6e6e73;font-size:14px;line-height:1.5">${esc(reports.map((r) => r.name).join(", "))} now report${reports.length === 1 ? "s" : ""} to ${esc(ctx.handover?.reports_to?.name ?? "Scout")}.</p>` : ""}` : "";
  const motto = a.profile?.motto ? `Its motto was "${a.profile.motto}"` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <p style="margin:0 0 12px;color:#6e6e73;font-size:13px;letter-spacing:.04em;text-transform:uppercase">Bestly expedition · reorg</p>
    <div style="background:#fff;border-radius:22px;padding:28px 24px;box-shadow:0 1px 2px rgba(0,0,0,.06)">
      ${mascot ? `<img src="${mascot.url}" width="96" height="96" alt="${esc(a.name)}" style="display:block;width:96px;height:96px;border:0;margin:0 0 14px;opacity:.85">` : ""}
      <h1 style="margin:0 0 4px;color:#1d1d1f;font-size:26px;line-height:1.15">Farewell, ${esc(a.name)}</h1>
      <p style="margin:0 0 18px;color:#6e6e73;font-size:15px">${esc(a.role)} · packed its box and left the expedition</p>
      <p style="margin:0 0 12px;color:#1d1d1f;font-size:16px;line-height:1.5">${esc(where)}</p>
      ${handoverHtml}
      ${r.why ? `<p style="margin:0 0 12px;color:#6e6e73;font-size:14px;line-height:1.5"><b style="color:#1d1d1f">Why:</b> ${esc(r.why)}</p>` : ""}
      ${r.saves ? `<p style="margin:0 0 12px;color:#248A3D;font-size:14px;line-height:1.5">Saves: ${esc(r.saves)}</p>` : ""}
      ${motto ? `<p style="margin:0 0 12px;color:#6e6e73;font-size:14px;font-style:italic">${esc(motto)}</p>` : ""}
      <p style="margin:16px 0 0;color:#6e6e73;font-size:13px;line-height:1.5">Scout has the plan to switch its job off and waits for your yes. Changed your mind? Tap Bring back on the Team page within 7 days.</p>
      <a href="https://bestly.tech/admin/team#reorg" style="display:inline-block;margin-top:18px;background:#0a84ff;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:999px">See the crew</a>
    </div>
    <p style="margin:14px 4px 0;color:#8e8e93;font-size:12px">Left ${esc(pacific())} · crew of ${esc(ctx.team_size)} now.</p>
  </div></body></html>`;
  let ok = false, err = "";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Scout at Bestly <noreply@bestly.tech>", to: [TO], subject: `Farewell, ${a.name}: it left the expedition`, html }),
    });
    ok = res.ok;
    if (!ok) err = `resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    err = (e as Error).message;
  }
  await db.from("email_send_log").insert({ message_id: crypto.randomUUID(), template_name: "team-farewell", recipient_email: TO,
    status: ok ? "sent" : "failed", error_message: ok ? null : err, metadata: { slug: a.slug, reorg_id: id, provider: "resend", mascot: mascot?.url ?? null } });
  return { ok, error: ok ? undefined : err };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await authorized(req))) return J({ ok: false, error: "unauthorized" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  try {
    if (body.op === "welcome") return J(await welcome(String(body.slug ?? ""), body.preview === true));
    if (body.op === "improve") return J(await improve());
    if (body.op === "recruit") return J(await recruit());
    if (body.op === "reorg") return J(await reorg());
    if (body.op === "farewell") return J(await farewell(String(body.id ?? "")));
    return J({ ok: false, error: "op must be welcome, improve, recruit, reorg or farewell" }, 400);
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 200);
  }
});
