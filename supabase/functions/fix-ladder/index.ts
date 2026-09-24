// fix-ladder — every open monitor incident climbs, cheapest first, until something fixes it:
//
//   1 auto     the built-in heals (monitor_tick restarts, drains, retries) get 15 minutes, plus a few
//              known playbook fixes here. Most things end here and the bell says "Fixed: ...".
//   2 free_ai  the local model on the Mac mini (Ollama, costs nothing) reads it and writes a diagnosis.
//   3 scout    Scout (paid) on autopilot: it can look at anything and do what needs no yes. Anything
//              that needs Jared's yes is refused in code and comes back as NEEDS_YES (one tap to approve).
//   4 claude   nobody could fix it: the incident carries a ready-to-paste prompt for Claude.
//
// Runs every 10 minutes (cron fix-ladder) and on "Try again now" from the alert pane (admin JWT).
// At most one Scout run starts per tick and one per incident episode (plus "Try again"), so the
// paid rung can't run away. Scout runs in the background and is read on the next tick.
import { createClient } from "jsr:@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = (k: string): Record<string, string> => k.startsWith("sb_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = SB_SECRET;
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const AUTO_GRACE_MIN = 15;     // built-in heals get this long before any AI is spent
const FREE_AI_WAIT_MIN = 8;    // how long the Mac mini gets to answer
const SCOUT_WAIT_MIN = 6;      // a Scout run is capped near 2.5 min; after this it is lost

type Issue = {
  key: string; status: string; severity: string; title: string; body: string | null; area: string | null;
  needs_jared: string | null; heal_attempts: number; occurrences: number; opened_at: string;
  fix_stage: string; fix_log: { at: string; by: string; text: string; ok: boolean | null }[];
  ai_diagnosis: string | null; scout_ask: string | null; claude_prompt: string | null; fix_next_at: string | null;
  scout_thread: string | null; scout_started_at: string | null;
};

async function isService(jwt: string) {
  if (jwt === SERVICE) return true;
  if (!jwt || jwt.split(".").length !== 3) return false;
  try {
    const role = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role;
    if (role !== "service_role") return false;
    const probe = createClient(URL_, jwt, { auth: { persistSession: false } });
    const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
    return !error;
  } catch { return false; }
}
async function isAdmin(jwt: string) {
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return !!ok;
}

const log = (key: string, by: string, text: string, ok: boolean | null = null) =>
  db.rpc("fix_log_add", { p_key: key, p_by: by, p_text: text, p_ok: ok });
const mins = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity);
const later = (m: number) => new Date(Date.now() + m * 60000).toISOString();

async function setStage(key: string, patch: Record<string, unknown>) {
  await db.from("monitor_issues").update(patch).eq("key", key).eq("status", "open");
  // Re-save the open bell card so its "Next:" line follows the stage (trigger monitor_bell_words).
  const { data } = await db.from("admin_notifications").select("id, body").eq("entity_key", `monitor:${key}`)
    .is("read_at", null).neq("severity", "success").limit(3);
  for (const n of data ?? []) await db.from("admin_notifications").update({ body: n.body }).eq("id", n.id);
}

// What the machines already know about it: the monitor's own words, the cron error, recent events, lessons.
async function context(i: Issue) {
  const parts: string[] = [];
  if (i.key.startsWith("cron.")) {
    const { data } = await db.rpc("fix_cron_last_error", { p_job: i.key.slice(5) });
    if (data) parts.push(`Last error from the job:\n${data}`);
  }
  const { data: ev } = await db.from("monitor_events").select("created_at, kind, title, body").eq("key", i.key)
    .order("created_at", { ascending: false }).limit(5);
  if (ev?.length) parts.push("Recent monitor events:\n" + ev.map((e: any) => `- ${e.created_at.slice(0, 16)} ${e.kind}: ${e.title}${e.body ? ` (${String(e.body).slice(0, 160)})` : ""}`).join("\n"));
  const { data: ls } = await db.from("scout_lessons").select("title, do_text").eq("active", true)
    .or(`scope.eq.${i.area ?? "none"},title.ilike.%${(i.area ?? i.key.split(".")[0]).replace(/[%,()]/g, "")}%`).limit(4);
  if (ls?.length) parts.push("Lessons Scout saved before:\n" + ls.map((l: any) => `- ${l.title}: ${l.do_text}`).join("\n"));
  return parts.join("\n\n");
}

// Rung 1 extras: fixes known to be safe to do with no one watching. The monitor's own heals
// (restart Nextcloud, drain mail, retry notifications) already ran; these cover what they miss.
async function playbook(i: Issue, ctx: string): Promise<string | null> {
  const err = ctx.toLowerCase();
  // A table added without its grant (this project grants nothing by default; RLS still guards rows).
  const m = /permission denied for (?:table|view) ([a-z0-9_]+)/.exec(err);
  if (m) {
    const { data: ok } = await db.rpc("fix_grant_select", { p_table: m[1] });
    if (ok === true) return `Granted read on ${m[1]} (it was missing its grant; row rules still apply).`;
  }
  return null;
}

async function freeAiOnline() {
  const { data } = await db.from("partner_ai_status").select("seen_at").eq("id", 1).maybeSingle();
  return mins((data as any)?.seen_at ?? null) < 3;
}

function freePrompt(i: Issue, ctx: string) {
  return `You are the first-line fixer for a small company's production systems (Supabase Postgres + edge functions, a Vite site on Vercel, a Mac mini and a Raspberry Pi running agents).
An automatic monitor raised this problem and its built-in self-heal did not clear it.

Problem: ${i.title}
Key: ${i.key} · severity ${i.severity} · area ${i.area ?? "-"} · open ${Math.round(mins(i.opened_at))} min · seen ${i.occurrences} times · self-heal tries ${i.heal_attempts}
What the monitor says: ${i.body ?? "-"}
The monitor's hint: ${i.needs_jared ?? "-"}

${ctx}

Answer in at most 8 short lines, plain text, no markdown headers:
CAUSE: the most likely root cause, one line.
CHECK: the one query or command that would confirm it.
FIX: the smallest fix, concretely (SQL, file, or command).
RISK: low / medium / high, and why in a few words.`;
}

function scoutAsk(i: Issue, ctx: string) {
  return `Autopilot fix attempt. Jared is not here; the fix ladder sent you.
Incident ${i.key}: ${i.title}
What the monitor says: ${i.body ?? "-"}
Monitor's hint: ${i.needs_jared ?? "-"}
Self-heal tries: ${i.heal_attempts}. Open ${Math.round(mins(i.opened_at))} min.
${i.ai_diagnosis ? `\nThe free local model's read (may be wrong, verify it):\n${i.ai_diagnosis}\n` : ""}
${ctx}

Find the root cause with your tools and fix it if you can do that without Jared's yes. Anything that needs his yes will be refused, so don't try it; describe it instead.
If you fix it, save what worked with learn so next time is instant. Keep it to a few tool calls.
End your reply with exactly ONE of these as the last line:
FIXED: <what you did, one line Jared will read>
NEEDS_YES: <the exact single action you'd take with his yes, one line>
STUCK: <why, one line>`.slice(0, 5900);
}

// Scout runs in the background (a turn can take ~2 minutes, longer than this function may wait):
// open its thread, send the ask, and read the answer from the thread on a later tick.
async function scoutStart(i: Issue, ctx: string) {
  const { data: adm } = await db.from("user_roles").select("user_id").eq("role", "admin").order("user_id").limit(1).maybeSingle();
  const { data: th, error } = await db.from("admin_chat_threads")
    .insert({ user_id: (adm as any)?.user_id, title: `Autopilot: ${i.title}`.slice(0, 70) }).select("id").single();
  if (error) throw new Error(error.message);
  await db.from("monitor_issues").update({ scout_thread: th.id, scout_started_at: new Date().toISOString(), fix_next_at: later(3) }).eq("key", i.key);
  const run = fetch(`${URL_}/functions/v1/admin-chat`, {
    method: "POST",
    headers: { ...sbHeaders(SB_SECRET), "Content-Type": "application/json" },
    body: JSON.stringify({ body: scoutAsk(i, ctx), autopilot: true, thread_id: th.id }),
  }).then((r) => r.text()).catch(() => "");
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(run); else await Promise.race([run, new Promise((r) => setTimeout(r, 3000))]);
}

async function scoutRead(i: Issue): Promise<{ verdict: "FIXED" | "NEEDS_YES" | "STUCK"; line: string; reply: string } | null> {
  const { data } = await db.from("admin_chat_messages").select("body, created_at").eq("thread_id", i.scout_thread!)
    .eq("role", "assistant").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const reply = (data as any)?.body as string | undefined;
  if (!reply) {
    if (mins(i.scout_started_at) < SCOUT_WAIT_MIN) return null;
    return { verdict: "STUCK", line: "Scout didn't answer in time.", reply: "" };
  }
  const last = [...reply.matchAll(/^(FIXED|NEEDS_YES|STUCK):\s*(.+)$/gm)].pop();
  if (!last) return { verdict: "STUCK", line: reply.split("\n").filter(Boolean).pop()?.slice(0, 300) ?? "No clear answer.", reply };
  return { verdict: last[1] as any, line: last[2].trim(), reply };
}

function claudePrompt(i: Issue, ctx: string, scoutReply?: string) {
  const tried = (i.fix_log ?? []).map((l) => `- ${l.by}${l.ok === true ? " (worked, but it came back)" : l.ok === false ? " (failed)" : ""}: ${l.text}`).join("\n") || "- nothing logged";
  return `Fix this Bestly production issue end to end. The automatic fixes, the free local AI and Scout have all tried; what they found is below.

ISSUE: ${i.title}
Key: ${i.key} · severity ${i.severity} · area ${i.area ?? "-"} · open since ${new Date(i.opened_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT · seen ${i.occurrences} times
Monitor says: ${i.body ?? "-"}
Monitor's hint: ${i.needs_jared ?? "-"}

WHAT WAS TRIED
${tried}
${i.ai_diagnosis ? `\nFREE AI DIAGNOSIS\n${i.ai_diagnosis}\n` : ""}${scoutReply ? `\nSCOUT'S LAST WORD\n${scoutReply.slice(-1500)}\n` : ""}
${ctx ? `CONTEXT\n${ctx}\n` : ""}
WHERE THINGS LIVE
- Site + admin: repo Bestly-LLC/bestlytech (Vite + React + TS), Vercel deploys main. Read CLAUDE.md first. Commit and push when done.
- Supabase project rcqfqhguwpmaarseifqg. The monitor is public.monitor_tick() (cron bestly-monitor, every 5 min); incidents are public.monitor_issues; public.bestly_raise() opens and closes them. Migrations are append-only.
- Mac mini agents are launchd jobs (tech.bestly.*); the Pi takes jobs through public.home_hub_commands.
- Secrets live only in Supabase Vault.

DONE MEANS
1. Root cause found and fixed (not just the symptom).
2. The check passes: incident ${i.key} resolves on the next monitor_tick.
3. Log it so the bell tells Jared what fixed it:
   select public.fix_log_add('${i.key}', 'claude', '<one line: what you fixed>', true);
4. If it could happen again, add a scout_lessons row so Scout fixes it alone next time.`;
}

async function climb(i: Issue, opts: { scoutOk: boolean; force: boolean }): Promise<string> {
  const ctx = await context(i);

  if (i.fix_stage === "auto") {
    if (!opts.force && mins(i.opened_at) < AUTO_GRACE_MIN) return "auto: grace";
    const already = (i.fix_log ?? []).some((l) => l.by === "auto" && l.ok === true);
    const done = already ? null : await playbook(i, ctx);
    if (done) {
      await log(i.key, "auto", done, true);
      await setStage(i.key, { fix_next_at: later(35) });  // cron checks look back 30 minutes
      return "auto: playbook fixed";
    }
    if (i.heal_attempts > 0) await log(i.key, "auto", `Self-heal ran ${i.heal_attempts} time${i.heal_attempts === 1 ? "" : "s"} and it is still open.`, false);
    else await log(i.key, "auto", "No automatic fix covers this one.", false);
    await setStage(i.key, { fix_stage: "free_ai", fix_next_at: new Date().toISOString() });
    i.fix_stage = "free_ai";
  }

  if (i.fix_stage === "free_ai") {
    const { data: job } = await db.from("fix_ai_jobs").select("id, status, answer, created_at").eq("issue_key", i.key)
      .gte("created_at", i.opened_at).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!job) {
      if (!(await freeAiOnline())) {
        await log(i.key, "free_ai", "The free AI on the Mac mini is offline, so this went straight to Scout.", null);
      } else {
        await db.from("fix_ai_jobs").insert({ issue_key: i.key, prompt: freePrompt(i, ctx) });
        await setStage(i.key, { fix_next_at: later(2) });
        return "free_ai: queued";
      }
    } else if (job.status === "done") {
      await log(i.key, "free_ai", `Diagnosed it: ${String(job.answer).split("\n").find((l: string) => /^CAUSE/i.test(l))?.replace(/^CAUSE:\s*/i, "") ?? String(job.answer).slice(0, 200)}`, null);
      await db.from("monitor_issues").update({ ai_diagnosis: job.answer }).eq("key", i.key);
      i.ai_diagnosis = job.answer;
    } else if (mins(job.created_at) < FREE_AI_WAIT_MIN && !opts.force) {
      return "free_ai: waiting";
    } else {
      await log(i.key, "free_ai", job.status === "error" ? "The free AI hit an error, so this moved on to Scout." : "The free AI didn't answer in time, so this moved on to Scout.", false);
    }
    await setStage(i.key, { fix_stage: "scout", fix_next_at: new Date().toISOString() });
    i.fix_stage = "scout";
  }

  if (i.fix_stage === "scout") {
    const lastScout = [...(i.fix_log ?? [])].reverse().find((l) => l.by === "scout");
    if (lastScout?.ok === true && i.scout_started_at && lastScout.at >= i.scout_started_at) {
      // Scout already said it fixed it, and it is still open: it didn't stick.
      await log(i.key, "scout", "Scout's fix didn't stick (the check still fails).", false);
      await setStage(i.key, { fix_stage: "claude", claude_prompt: claudePrompt(i, ctx) });
      return "claude: scout fix did not stick";
    }
    if (!i.scout_thread) {
      if (!opts.scoutOk) return "scout: next tick";
      try { await scoutStart(i, ctx); return "scout: started"; }
      catch (e) { await log(i.key, "scout", `Couldn't start Scout (${(e as Error).message}).`, false); return "scout: start failed"; }
    }
    const res = await scoutRead(i);
    if (!res) { await setStage(i.key, { fix_next_at: later(2) }); return "scout: running"; }
    if (res.verdict === "FIXED") {
      await log(i.key, "scout", res.line, true);
      // If Scout closed the incident itself, the "Fixed" card went out before this note existed.
      const { data: now } = await db.from("monitor_issues").select("status").eq("key", i.key).maybeSingle();
      if ((now as any)?.status === "resolved") {
        const note = `Scout: ${res.line}`;
        await db.from("monitor_issues").update({ fix_note: note }).eq("key", i.key);
        const { data: card } = await db.from("admin_notifications").select("id").eq("entity_key", `monitor:${i.key}`)
          .eq("severity", "success").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (card) await db.from("admin_notifications").update({ body: note }).eq("id", (card as any).id);
        return "scout: fixed";
      }
      await setStage(i.key, { fix_next_at: later(35) });
      return "scout: fixed (waiting for the check)";
    }
    if (res.verdict === "NEEDS_YES") {
      await log(i.key, "scout", `Found the fix, needs your yes: ${res.line}`, null);
      i.fix_log = [...(i.fix_log ?? []), { at: new Date().toISOString(), by: "scout", text: `Needs a yes: ${res.line}`, ok: null }];
      await setStage(i.key, { fix_stage: "needs_yes", scout_ask: res.line, claude_prompt: claudePrompt(i, ctx, res.reply) });
      return "needs_yes";
    }
    await log(i.key, "scout", `Stuck: ${res.line}`, false);
    i.fix_log = [...(i.fix_log ?? []), { at: new Date().toISOString(), by: "scout", text: `Stuck: ${res.line}`, ok: false }];
    await setStage(i.key, { fix_stage: "claude", claude_prompt: claudePrompt(i, ctx, res.reply) });
    return "claude";
  }
  return `${i.fix_stage}: waiting on Jared`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const service = isSvc(req) || await isService(jwt);
  if (!service && !(jwt && (await isAdmin(jwt)))) return J({ ok: false, error: "unauthorized" }, 401);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* empty */ }

  try {
    if (body.op === "retry") {
      const key = String(body.key ?? "");
      const { data: i } = await db.from("monitor_issues").select("*").eq("key", key).eq("status", "open").maybeSingle();
      if (!i) return J({ ok: true, result: "already fixed" });
      await log(key, "you", "You asked the ladder to try again.", null);
      await db.from("monitor_issues").update({ fix_stage: "auto", fix_next_at: new Date().toISOString(), scout_thread: null, scout_started_at: null }).eq("key", key);
      const { data: fresh } = await db.from("monitor_issues").select("*").eq("key", key).single();
      return J({ ok: true, result: await climb(fresh as Issue, { scoutOk: true, force: true }) });
    }

    // tick: every open incident whose turn it is. One Scout call per tick.
    const { data: open } = await db.from("monitor_issues").select("*").eq("status", "open")
      .not("fix_stage", "in", "(needs_yes,claude,fixed)").order("opened_at");
    const out: Record<string, string> = {};
    let scoutOk = true;
    for (const i of (open ?? []) as Issue[]) {
      if (i.fix_next_at && new Date(i.fix_next_at).getTime() > Date.now()) { out[i.key] = "later"; continue; }
      const r = await climb(i, { scoutOk, force: false });
      if (r === "scout: started") scoutOk = false;
      if (r === "needs_yes" || r === "claude") scoutOk = false;
      out[i.key] = r;
    }
    return J({ ok: true, ran: out });
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 200);
  }
});
