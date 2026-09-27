// todo-check: "Check if it's done" for Scout to-dos (scout_daily kind pick / call).
// Plan: docs/todo-check-opusplan.md. Migration: 20260923200000_todo_check.sql
//
//   op check   {id}           queue one to-do (the button). Admin JWT. Returns at once.
//   op sweep                  queue every open to-do; closes the sure ones ("Check them all"). Admin JWT.
//   op drain                  work the queue in the background (todo_check_drain cron, every minute).
//   op tick                   hourly cron; queues the nightly pass at 10 PM Los Angeles, once a day.
//   op nightly {force?}       the nightly pass (the watchdog calls this with force when tick missed).
//   op refresh                the Refresh button on the admin home: checks "Needs you" AND the to-dos. Admin JWT.
//
// v6 (2026-09-27): Refresh checks what is already done. admin_needs_rules() closes alerts with hard proof
//   (monitor resolved, later Mac job OK, newer duplicate) and queues the rest into admin_needs_checks; the
//   drain judges them here with the same evidence + free AI as to-dos and closes only under the to-do bar.
//   Open to-dos not checked in the last 2 hours are swept too. Migration 20260927220000_refresh_checks_needs.sql.
// v6.1: an alert its own system still reports (monitor open / raised again) is "not yet" with no AI call; when the
//   free AI is out the item waits and retries (not_before, up to 3 tries) instead of settling for a no-AI read;
//   the drain does Needs you before to-dos. Migration 20260927223000_refresh_checks_retry.sql.
//
// v5 (2026-09-23): $0. The judge and the lesson writer use the shared helper _shared/free-llm.ts:
//   Groq -> Cloudflare Workers AI -> Mac mini, all no-training, paid never. Haiku is no longer called.
//   If every free rung fails, the check is a no-AI read (same as before). Rollback: redeploy v4.
// v4: Sent mail is evidence (todo_evidence_sent: bestly_sent_mail + partner_mail); partners can check their own to-dos.
// v3: obeys the Paid AI switch. Off = free AI only (Mac mini); asleep = no-AI read, never paid.
// v2: everything goes through todo_check_jobs so a check finishes even if Jared closes the page;
// the page reads progress from todo_check_runs / todo_check_jobs, and a finished run sends a notification.
//   op learn   {check_id}     after a thumbs down / put back: write a lesson Scout reads next time.
//   op learn_backlog          retry lessons that failed to write (watchdog).
//
// Evidence is gathered without any AI (todo_evidence: mail, memory, meetings, Vault names, Scout's own
// actions, Mac jobs, related to-dos; plus the Deck card and GitHub commits). Only the verdict uses a
// model. The judge is `llm()` below, which has the same shape as the planned shared free-model helper
// (_shared/free-llm.ts, owned by the Scout free-LLM plan). When that lands, swap the import; nothing
// else changes. Until then it's Haiku under the background AI cap, and if the cap is hit it falls back
// to a no-AI verdict instead of failing.
//
// Self-healing: every source has its own timeout and a failed source is reported, not fatal;
// a failed judge degrades to the no-AI verdict; todo_check_watchdog() reruns missed nightly passes
// and failed lessons. Nothing here sends anything to anyone.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm as sharedLlm, LlmUnavailable, type LlmTask } from "../_shared/free-llm.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SECRETS: string[] = (() => {
  const out = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""];
  try { out.push(...Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[]); } catch { /* */ }
  return out.filter(Boolean);
})();
const db = createClient(URL_, SECRETS[0], { auth: { persistSession: false } });
const MODEL = Deno.env.get("TODO_CHECK_MODEL") ?? "claude-haiku-4-5";
const TZ = "America/Los_Angeles";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

function laNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
const time12 = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  : "";
const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error(`${what} timed out`)), ms))]);

/* ───────── auth ───────── */

async function isService(tok: string) {
  if (!tok) return false;
  if (SECRETS.includes(tok)) return true;
  // the cron sends a key from Vault that may differ from this function's env copy
  if (!tok.startsWith("sb_secret_") && tok.split(".").length !== 3) return false;
  try {
    const probe = createClient(URL_, tok, { auth: { persistSession: false } });
    const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
    return !error;
  } catch { return false; }
}
/** A signed-in partner (Eli): their roster name, for checking their own to-dos only. */
async function partnerOf(jwt: string): Promise<{ uid: string; roster: string } | null> {
  if (!jwt || jwt.split(".").length !== 3) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: p } = await db.from("partners").select("roster_name").eq("user_id", data.user.id).maybeSingle();
  return (p as any)?.roster_name ? { uid: data.user.id, roster: String((p as any).roster_name).toLowerCase() } : null;
}
async function adminId(jwt: string): Promise<string | null> {
  if (!jwt || jwt.split(".").length !== 3) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return ok ? data.user.id : null;
}

/* ───────── the judge (same shape as the planned _shared/free-llm.ts) ───────── */

function cleanKey(raw: string | undefined) {
  const m = (raw ?? "").match(/sk-ant-[A-Za-z0-9_\-]{20,}/);
  return (m ? m[0] : raw ?? "").trim();
}
type LlmReq = { task: string; system: string; user: string; maxTokens: number; json: boolean; job: string; ref: string | null };
type LlmOut = { text: string; json?: any; model: string; provider: string; cost_usd: number };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const parseJson = (text: string) => {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("model did not return JSON");
  return JSON.parse(t.slice(s, e + 1));
};

// v3: "Paid AI" off (scout_settings.paid_ai_ok = false) means free AI only: the model on Jared's
// Mac mini (fix_ai_jobs queue, same one the Scout chat uses). If the Mac is asleep, no paid
// fallback: the check becomes a no-AI read and the nightly pass tries again.
async function paidAllowed() {
  const { data } = await db.from("scout_settings").select("paid_ai_ok").limit(1).maybeSingle();
  return (data as any)?.paid_ai_ok === true;
}
class FreeOffline extends Error { quiet = true; }
async function macLlm(o: LlmReq): Promise<LlmOut> {
  const { data: st } = await db.from("partner_ai_status").select("seen_at, model").eq("id", 1).maybeSingle();
  const seen = (st as any)?.seen_at ? Date.parse((st as any).seen_at) : 0;
  if (Date.now() - seen > 3 * 60_000) throw new FreeOffline("free AI on the Mac mini is offline");
  const prompt = `${o.system}\n\n${o.user}\n\nReply with the JSON object only.`;
  const { data: job, error } = await db.from("fix_ai_jobs").insert({ issue_key: `todo-check:${o.ref ?? o.job}`, prompt }).select("id").single();
  if (error || !job) throw new FreeOffline("free AI queue unavailable");
  const until = Date.now() + 100_000;
  while (Date.now() < until) {
    await sleep(2000);
    const { data: row } = await db.from("fix_ai_jobs").select("status, answer").eq("id", (job as any).id).maybeSingle();
    if ((row as any)?.status === "done") {
      const text = String((row as any).answer ?? "");
      const model = `mac:${(st as any)?.model ?? "local"}`;
      await db.from("ai_spend").insert({ fn: "todo-check", scope: "background", job: o.job, model, input_tokens: Math.round(prompt.length / 4), output_tokens: Math.round(text.length / 4), cost_usd: 0, ref: o.ref });
      return { text, json: o.json ? parseJson(text) : undefined, model, provider: "mac-mini", cost_usd: 0 };
    }
  }
  throw new FreeOffline("free AI on the Mac mini took too long");
}

async function llm(o: LlmReq): Promise<LlmOut> {
  // v5: free only, through the shared helper. "learn" isn't a helper task; it's a short summarize job.
  const task: LlmTask = o.task === "judge" ? "judge" : "summarize";
  try {
    const r = await sharedLlm({
      task, system: o.system, user: o.user, json: o.json, job: o.job, ref: o.ref, fn: "todo-check", scope: "background",
      paid: "never", maxTokens: Math.max(o.maxTokens * 3, 1500), // free reasoning models think before answering
      deadlineMs: 60_000,
    });
    return { text: r.text, json: r.json, model: `${r.provider}:${r.model}`, provider: r.provider, cost_usd: r.cost_usd };
  } catch (e) {
    if (e instanceof LlmUnavailable) throw new FreeOffline(`free AI unavailable: ${e.tried.map((t) => `${t.provider} ${t.outcome}`).join(", ")}`);
    throw e;
  }
}

async function haiku(o: LlmReq): Promise<LlmOut> {
  const key = cleanKey(Deno.env.get("ANTHROPIC_API_KEY"));
  if (!key) throw new Error("no ANTHROPIC_API_KEY");
  const { data: budget } = await db.rpc("ai_budget", { p_scope: "background" });
  if ((budget as any)?.ok === false) throw new Error("daily background AI cap reached");
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: o.maxTokens, system: o.system, messages: [{ role: "user", content: o.user }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (r.ok) {
      const j = await r.json();
      const inT = Number(j.usage?.input_tokens ?? 0), outT = Number(j.usage?.output_tokens ?? 0);
      const cost = (inT * 1 + outT * 5) / 1e6; // haiku $ per million in/out
      await db.from("ai_spend").insert({ fn: "todo-check", scope: "background", job: o.job, model: String(j.model ?? MODEL), input_tokens: inT, output_tokens: outT, cost_usd: cost, ref: o.ref });
      const text = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
      let json;
      if (o.json) {
        const s = text.indexOf("{"), e = text.lastIndexOf("}");
        if (s < 0 || e < s) throw new Error("model did not return JSON");
        json = JSON.parse(text.slice(s, e + 1));
      }
      return { text, json, model: String(j.model ?? MODEL), provider: "anthropic", cost_usd: cost };
    }
    last = `anthropic ${r.status}: ${(await r.text()).slice(0, 160)}`;
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 2500)); continue; }
    break;
  }
  throw new Error(last || "model failed");
}

/* ───────── evidence ───────── */

const STOP = new Set(`a an the and or but for with from into onto about after before when then than that this these those your their her his its our my
to of in on at by as is are be been was were it he she they we you i me us them one two three four five six seven eight nine ten
set up make made prepare finish finished discuss ask asked give gave send sent write wrote run check get got update clear diagnose
review feedback ready today tomorrow tonight real own words out off via next new more most first last also still just all any each
should would could will can need needs done do does did have has had not no yes please thing things stuff way ways start started
track tracking look see show tell let help keep put take took add added use used work working find found go going`.split(/\s+/));

function termsOf(title: string, why: string | null): string[] {
  const words = (title + " " + (why ?? "").replace(/·.*$/, "")).split(/[^A-Za-z0-9'’]+/).map((w) => w.replace(/['’]s$/i, "").replace(/['’]/g, ""));
  const seen = new Map<string, number>();
  words.forEach((w, i) => {
    const l = w.toLowerCase();
    if (l.length < 3 || STOP.has(l) || /^\d+$/.test(l)) return;
    const proper = /^[A-Z]/.test(w) && i > 0 ? 3 : 0; // names and products first
    const score = proper + Math.min(l.length, 10) / 10 + (i < title.split(/\s+/).length ? 1 : 0);
    seen.set(l, Math.max(seen.get(l) ?? 0, score));
  });
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([w]) => w);
}

type Item = { id: string; src: string; at: string | null; title: string; quote: string; url: string | null };

async function nextcloud() {
  const { data: cred } = await db.rpc("nextcloud_cred");
  const c = cred as Record<string, string> | null;
  if (!c?.nextcloud_base_url) throw new Error("no Nextcloud credentials");
  const base = c.nextcloud_base_url.replace(/\/+$/, "");
  const headers = { Authorization: "Basic " + btoa(`${c.nextcloud_user}:${c.nextcloud_app_password}`), "OCS-APIRequest": "true", Accept: "application/json" };
  return async (path: string) => {
    const r = await fetch(`${base}/index.php/apps/deck/api/v1.0${path}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`deck ${r.status}`);
    return r.json();
  };
}

async function deckEvidence(todo: any): Promise<Item[]> {
  const url = String(todo.action?.deck_url ?? "");
  const m = url.match(/board\/(\d+)\/card\/(\d+)/);
  if (!m) return [];
  const [, board, card] = m;
  const api = await nextcloud();
  const find = (stacks: any[], archived: boolean) => {
    for (const s of stacks ?? []) for (const c of s.cards ?? []) if (String(c.id) === card) return { s, c, archived: archived || !!c.archived };
    return null;
  };
  let hit = find(await api(`/boards/${board}/stacks`), false);
  if (!hit) hit = find(await api(`/boards/${board}/stacks/archived`), true);
  if (!hit) return [{ id: `deck:${card}`, src: "deck", at: null, title: "Deck card", quote: "The Deck card was deleted.", url }];
  const done = hit.archived || /done|complete|finished|shipped|closed/i.test(hit.s.title) || !!hit.c.done;
  const changed = hit.c.lastModified ? new Date(hit.c.lastModified * 1000).toISOString() : null;
  return [{
    id: `deck:${card}`, src: "deck", at: changed, title: `Deck card in "${hit.s.title}"${hit.archived ? " (archived)" : ""}`,
    quote: done ? `The card was moved to ${hit.archived ? "the archive" : `"${hit.s.title}"`}${changed ? ` on ${time12(changed)}` : ""}.`
      : `The card is still in "${hit.s.title}".`, url,
  }];
}

async function githubEvidence(terms: string[], since: string): Promise<Item[]> {
  const top = terms.slice(0, 2);
  if (!top.length) return [];
  const { data: tok } = await db.rpc("todo_check_github_token");
  if (!tok) return [];
  const out: Item[] = [];
  for (const owner of ["org:Bestly-LLC", "user:fungus-amungus"]) {
    const q = `${top.join(" ")} committer-date:>=${since.slice(0, 10)} ${owner}`;
    const r = await fetch(`https://api.github.com/search/commits?per_page=3&sort=committer-date&q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json", "User-Agent": "bestly-todo-check" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) continue;
    for (const c of ((await r.json()).items ?? []).slice(0, 3)) {
      out.push({ id: `git:${String(c.sha).slice(0, 10)}`, src: "git", at: c.commit?.committer?.date ?? null,
        title: `${c.repository?.full_name ?? "commit"}`, quote: String(c.commit?.message ?? "").split("\n")[0].slice(0, 200), url: c.html_url ?? null });
    }
  }
  return out;
}

async function gather(todo: any) {
  const created = Date.parse(todo.created_at);
  const since = new Date(created - 12 * 3600e3).toISOString();
  const terms = termsOf(todo.title, todo.why);
  const searched: Record<string, string> = {};
  const items: Item[] = [];

  const run = async (name: string, fn: () => Promise<Item[]>, ms: number) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const got = await withTimeout(fn(), ms, name); items.push(...got); searched[name] = `ok (${got.length})`; return; }
      catch (e) { searched[name] = `error: ${(e as Error).message.slice(0, 120)}`; }
    }
  };

  await Promise.all([
    run("database", async () => {
      const { data, error } = await db.rpc("todo_evidence", { p_terms: terms, p_since: since, p_exclude: todo.id });
      if (error) throw new Error(error.message);
      const e = (data ?? {}) as Record<string, any[]>;
      const fromMeeting = String(todo.why ?? "").match(/meeting-\d{8}-\d{4}/)?.[0];
      const list: Item[] = [];
      for (const m of e.mail ?? []) list.push({ id: m.id, src: "email", at: m.sent_at, title: `${m.from_name || m.from_addr}: ${m.subject ?? ""}`.slice(0, 160), quote: m.quote, url: null });
      for (const m of e.memory ?? []) list.push({ id: m.id, src: "memory", at: m.updated_at, title: `${m.key}: ${m.title ?? ""}`.slice(0, 160), quote: m.quote, url: null });
      for (const m of e.meetings ?? []) {
        if (m.name === fromMeeting || Date.parse(m.started_at) < created) continue; // not the call the to-do came from
        list.push({ id: m.id, src: "meeting", at: m.started_at, title: m.name, quote: m.quote, url: "/admin/meetings" });
      }
      for (const v of e.vault ?? []) list.push({ id: v.id, src: "vault", at: v.updated_at, title: `Vault secret "${v.name}"`, quote: v.description ?? "(no description)", url: null });
      for (const a of e.scout_actions ?? []) list.push({ id: a.id, src: "scout", at: a.created_at, title: `Scout ran ${a.tool}${a.ok ? "" : " (failed)"}`, quote: `${a.args} → ${a.result}`.slice(0, 400), url: null });
      for (const j of e.mac_jobs ?? []) list.push({ id: j.id, src: "mac", at: j.finished_at, title: `Mac job "${j.title}" ${j.status}${j.exit_code != null ? ` (exit ${j.exit_code})` : ""}`, quote: j.output ?? "", url: null });
      for (const t of e.related_todos ?? []) list.push({ id: t.id, src: "todo", at: t.done_at, title: `Related ${t.kind} marked ${t.status}`, quote: t.title, url: null });
      return list;
    }, 12000),
    run("sent", async () => {
      // what Jared (or his partner-mail copies) SENT: the proof for "email X" / "send Y" to-dos
      const { data, error } = await db.rpc("todo_evidence_sent", { p_terms: terms, p_since: since });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((m) => ({ id: m.id, src: "sent", at: m.sent_at,
        title: `Jared sent to ${String(m.to_addrs ?? "").slice(0, 80)}: ${m.subject ?? ""}`.slice(0, 160), quote: m.quote, url: null }));
    }, 12000),
    run("deck", () => deckEvidence(todo), 15000),
    run("github", () => githubEvidence(terms, since), 15000),
  ]);
  return { terms, since, items, searched };
}

/* ───────── check one to-do ───────── */

async function lessons() {
  const { data } = await db.from("scout_lessons").select("id, title, when_text, do_text, avoid_text, wins, losses")
    .eq("scope", "todo-check").eq("active", true).order("updated_at", { ascending: false }).limit(40);
  return ((data ?? []) as any[]).sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses)).slice(0, 12);
}

async function check(id: string, trigger: "button" | "sweep" | "nightly", allowClose: boolean) {
  const { data: todo } = await db.from("scout_daily").select("*").eq("id", id).maybeSingle();
  if (!todo) throw new Error("no such to-do");
  const [{ items, searched, terms }, les, { data: past }, { data: settings }] = await Promise.all([
    gather(todo), lessons(),
    db.from("todo_checks").select("verdict, feedback, feedback_note, created_at").eq("todo_id", id).not("feedback", "is", null).order("created_at", { ascending: false }).limit(3),
    db.from("todo_check_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const corrected = ((past ?? []) as any[]).some((p) => p.feedback === "down" || p.feedback === "undo");

  let verdict = "unknown", confidence = 0, summary = "", remaining = "", next = "", cited: string[] = [], model = "none", err: string | null = null;
  const byId = new Map(items.map((i) => [i.id, i]));
  try {
    if (!items.length) throw Object.assign(new Error("no evidence"), { quiet: true });
    const system = [
      "You decide whether one of Jared's to-dos has actually been done, using ONLY the evidence given.",
      "Jared runs Bestly LLC, a small product studio. To-dos come from his calls and from Scout (his assistant).",
      "Rules: every claim must cite evidence ids. A match on words is not proof: the evidence must show the action itself happened",
      "(a reply was sent or received, a commit landed, a card moved to Done, a memory note says it shipped, a later call says it was done).",
      "Evidence with source \"sent\" is an email Jared actually sent: strong proof for to-dos about emailing, sending or asking someone.",
      "A plan, a mention, or the to-do being discussed is NOT proof. If nothing shows it happened, verdict is unknown or not_done.",
      "The to-do's owner may be someone other than Jared; judge whether THAT person did it.",
      les.length ? "Lessons from Jared's past corrections (follow them):\n" + les.map((l) => `- ${l.title}: when ${l.when_text ?? "judging"}, ${l.do_text ?? ""}${l.avoid_text ? `; avoid ${l.avoid_text}` : ""}`).join("\n") : "",
      'Return JSON only: {"verdict":"done|partly|not_done|unknown","confidence":0-1,"evidence_ids":["..."],"summary":"one plain sentence","remaining":"what is left, or empty","next_step":"the one next action, or empty"}',
    ].filter(Boolean).join("\n");
    // the free Mac model has a small context window: fewer, shorter snippets when it's the judge
    const paid = true; // v5: Groq/Cloudflare have room for the full evidence (was: paid AI only)
    const user = JSON.stringify({
      todo: { title: todo.title, detail: todo.why, owner: todo.action?.owner ?? "Jared", due: todo.action?.due ?? null, created: time12(todo.created_at) },
      jared_said_before: ((past ?? []) as any[]).map((p) => ({ verdict_was: p.verdict, he_said: p.feedback, note: p.feedback_note })),
      evidence: (paid ? items : items.slice(0, 12)).map((i) => ({ id: i.id, source: i.src, when: time12(i.at), title: i.title, text: String(i.quote ?? "").replace(/[«»]/g, "").slice(0, paid ? 500 : 240) })),
    });
    const out = await llm({ task: "judge", system, user, maxTokens: 500, json: true, job: "todo-check", ref: id });
    const j = out.json ?? {};
    model = out.model;
    verdict = ["done", "partly", "not_done", "unknown"].includes(j.verdict) ? j.verdict : "unknown";
    confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0));
    cited = (Array.isArray(j.evidence_ids) ? j.evidence_ids : []).map(String).filter((x: string) => byId.has(x));
    summary = String(j.summary ?? "").slice(0, 300);
    remaining = String(j.remaining ?? "").slice(0, 300);
    next = String(j.next_step ?? "").slice(0, 200);
    // checked by code, not trusted
    if (verdict === "done" && !cited.length) { verdict = "unknown"; confidence = Math.min(confidence, 0.3); summary ||= "Nothing found that proves it."; }
    if (verdict === "done" && confidence < 0.6) verdict = "partly";
  } catch (e) {
    const quiet = (e as any).quiet;
    if (!quiet) err = (e as Error).message.slice(0, 300);
    const offline = e instanceof FreeOffline;
    const deck = items.find((i) => i.src === "deck" && /moved to/.test(i.quote));
    if (deck) { verdict = "done"; confidence = 0.7; cited = [deck.id]; summary = "The Deck card was moved to Done."; }
    else { verdict = "unknown"; summary = items.length ? "Found some related things but could not judge them." : "Nothing found about this yet."; cited = items.slice(0, 4).map((i) => i.id); }
    if (err) summary += " (Judge unavailable, so this is a no-AI read.)";
    else if (offline) summary += " (The free AI isn't answering right now, so this is a no-AI read. Scout tries again tonight.)";
    model = "no-ai";
  }

  const kinds = new Set(cited.map((c) => byId.get(c)?.src));
  const s = (settings ?? { auto_close: false, threshold: 0.95, min_sources: 2 }) as any;
  const mine = todo.kind === "pick" || String(todo.action?.owner ?? "Jared").toLowerCase() === "jared";
  const close = allowClose && s.auto_close && todo.status === "open" && !corrected && mine && !err
    && verdict === "done" && confidence >= Number(s.threshold) && kinds.size >= Number(s.min_sources);

  const evidence = cited.map((c) => byId.get(c)!).filter(Boolean);
  const { data: row, error: insErr } = await db.from("todo_checks").insert({
    todo_id: id, trigger, verdict, confidence, summary, remaining, next_step: next, evidence,
    searched: { ...searched, terms: terms.join(", "), found: String(items.length) }, lessons_used: les.map((l) => l.id),
    model, auto_closed: close, error: err,
  }).select("id, created_at").single();
  if (insErr) throw new Error(insErr.message);
  if (les.length) await db.from("scout_lessons").update({ last_used_at: new Date().toISOString() }).in("id", les.map((l) => l.id));

  const checkDoc = { id: row.id, verdict, confidence, summary, remaining, next_step: next, evidence: evidence.slice(0, 5), at: row.created_at, auto_closed: close, model };
  const { data: fresh } = await db.from("scout_daily").select("action, status").eq("id", id).single();
  const action = { ...((fresh as any)?.action ?? {}), check: checkDoc } as Record<string, unknown>;
  const patch: Record<string, unknown> = { action };
  if (close && (fresh as any)?.status === "open") {
    action.auto_closed = { check_id: row.id, at: row.created_at };
    patch.status = "done";
    patch.done_at = new Date().toISOString();
  }
  await db.from("scout_daily").update(patch).eq("id", id);
  return { todo: { id, title: todo.title }, ...checkDoc, searched };
}

/* ───────── check one "Needs you" row (Refresh) ───────── */

/** What the system itself says now about an alert: is the problem still being raised? */
async function alertState(key: string, raised: string): Promise<Item[]> {
  if (!key.startsWith("bell:")) return [];
  const { data: n } = await db.from("admin_notifications").select("id, title, entity_key, created_at").eq("id", key.slice(5)).maybeSingle();
  if (!n) return [];
  const out: Item[] = [];
  const ek = String((n as any).entity_key ?? "");
  if (ek.startsWith("monitor:")) {
    const { data: m } = await db.from("monitor_issues").select("key, status, updated_at, resolved_at, occurrences").eq("key", ek.slice(8)).maybeSingle();
    if (m) out.push({ id: `monitor:${(m as any).key}`, src: "monitor", at: (m as any).resolved_at ?? (m as any).updated_at,
      title: `Monitor issue "${(m as any).key}"`,
      quote: (m as any).status === "resolved" ? `Resolved ${time12((m as any).resolved_at)}.`
        : `Still open; last seen ${time12((m as any).updated_at)} (${(m as any).occurrences ?? 1} times).`, url: null });
  }
  // raised again since? That means it is NOT fixed.
  const norm = String((n as any).title).toLowerCase().replace(/[0-9]+/g, "#");
  const { data: later } = await db.from("admin_notifications").select("id, title, created_at").gt("created_at", raised)
    .neq("id", (n as any).id).order("created_at", { ascending: false }).limit(60);
  const again = ((later ?? []) as any[]).filter((x) => String(x.title).toLowerCase().replace(/[0-9]+/g, "#") === norm);
  if (again.length) out.push({ id: `again:${again[0].id}`, src: "alerts", at: again[0].created_at,
    title: "Same alert raised again", quote: `Raised ${again.length} more time${again.length === 1 ? "" : "s"}, last at ${time12(again[0].created_at)}.`, url: null });
  return out;
}

async function checkNeed(job: any) {
  const { data: rows, error } = await db.rpc("admin_today");
  if (error) throw new Error(error.message);
  const row = ((rows ?? []) as any[]).find((r) => r.key === job.key);
  if (!row) {
    // it left the list on its own (fixed at the source, or ticked) between the refresh and now
    return { verdict: "cleared", confidence: 1, summary: "Already off the list.", evidence: [], model: "none", closed: false };
  }
  const raised = row.since ?? job.created_at;
  // The system that raised it says it is still happening: that IS the answer, no AI needed.
  const state = await alertState(job.key, raised);
  const firing = state.find((i) => i.src === "alerts" || (i.src === "monitor" && /still open/i.test(i.quote)));
  if (firing) {
    const q = firing.quote.replace(/^Still open; /, "").replace(/\.$/, "");
    const why = firing.src === "monitor" ? `Not fixed yet: its monitor still sees the problem, ${q}.` : `Not fixed yet: the same alert came back. ${q}.`;
    return { verdict: "not_done", confidence: 1, summary: why, evidence: [firing], model: "rule", closed: false, error: null };
  }
  const pseudo = { id: crypto.randomUUID(), title: row.title, why: row.detail, created_at: raised, action: {} };
  const [{ items: found }, les, { data: settings }] = await Promise.all([
    gather(pseudo), lessons(),
    db.from("todo_check_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const items = [...state, ...found];
  const byId = new Map(items.map((i) => [i.id, i]));
  let verdict = "unknown", confidence = 0, summary = "", cited: string[] = [], model = "none", err: string | null = null;
  try {
    if (!items.length) throw Object.assign(new Error("no evidence"), { quiet: true });
    const system = [
      "You decide whether an item on Jared's \"Needs you\" list is already taken care of, using ONLY the evidence given.",
      "Items are alerts from his systems (something broke or looked wrong) or asks waiting on him. Jared runs Bestly LLC, a small product studio.",
      "It is done only if the evidence shows the problem was FIXED or the ask was HANDLED after it was raised",
      "(a monitor resolved it, a fix was committed or deployed, a memory note says it was fixed, a later job succeeded, a reply was sent).",
      "Evidence that the same alert was raised again, or that its monitor issue is still open, means NOT done.",
      "A mention, a plan, or the alert being discussed is not proof. When unsure, verdict is unknown. Every claim must cite evidence ids.",
      les.length ? "Lessons from Jared's past corrections (follow them):\n" + les.map((l) => `- ${l.title}: when ${l.when_text ?? "judging"}, ${l.do_text ?? ""}${l.avoid_text ? `; avoid ${l.avoid_text}` : ""}`).join("\n") : "",
      'Return JSON only: {"verdict":"done|partly|not_done|unknown","confidence":0-1,"evidence_ids":["..."],"summary":"one plain sentence"}',
    ].filter(Boolean).join("\n");
    const user = JSON.stringify({
      item: { title: row.title, detail: row.detail, from: row.source, raised: time12(raised), why_listed: row.why },
      evidence: items.map((i) => ({ id: i.id, source: i.src, when: time12(i.at), title: i.title, text: String(i.quote ?? "").replace(/[«»]/g, "").slice(0, 500) })),
    });
    const out = await llm({ task: "judge", system, user, maxTokens: 400, json: true, job: "needs-check", ref: job.key });
    const j = out.json ?? {};
    model = out.model;
    verdict = ["done", "partly", "not_done", "unknown"].includes(j.verdict) ? j.verdict : "unknown";
    confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0));
    cited = (Array.isArray(j.evidence_ids) ? j.evidence_ids : []).map(String).filter((x: string) => byId.has(x));
    summary = String(j.summary ?? "").slice(0, 300);
    // checked by code, not trusted
    if (verdict === "done" && !cited.length) { verdict = "unknown"; confidence = Math.min(confidence, 0.3); summary ||= "Nothing found that proves it."; }
    if (verdict === "done" && confidence < 0.6) verdict = "partly";
  } catch (e) {
    // free AI out (rate limit / daily quota): wait and try again rather than settle for a guess
    if (e instanceof FreeOffline && !(e as any).message?.startsWith("no evidence") && Number(job.attempts ?? 1) < 3) throw new RetryLater((e as Error).message);
    if (!(e as any).quiet) err = (e as Error).message.slice(0, 300);
    verdict = "unknown";
    summary = items.length ? "Found some related things but could not judge them." : "Nothing found about this yet.";
    if (e instanceof FreeOffline) summary += " (The free AI was out all three tries, so this is a no-AI read.)";
    cited = [];
    model = "no-ai";
  }
  const kinds = new Set(cited.map((c) => byId.get(c)?.src));
  const s = (settings ?? { auto_close: false, threshold: 0.95, min_sources: 2 }) as any;
  // Cookie Yeti asks are never auto-closed: ticking one erases its text, so it could not be put back.
  const close = !err && job.key.startsWith("bell:") && s.auto_close && verdict === "done"
    && confidence >= Number(s.threshold) && kinds.size >= Number(s.min_sources ?? 2);
  if (close) await db.rpc("admin_today_done", { p_key: job.key });
  const evidence = cited.map((c) => byId.get(c)!).filter(Boolean).slice(0, 5);
  return { verdict, confidence, summary, evidence, model, closed: close, error: err };
}

class RetryLater extends Error {}

async function drainNeeds(stop: number) {
  let n = 0;
  while (Date.now() < stop - 65_000) {
    const { data: jobs, error } = await db.rpc("admin_needs_claim", { p_n: 2 });
    if (error) throw new Error(error.message);
    const list = (jobs ?? []) as any[];
    if (!list.length) break;
    await Promise.all(list.map(async (j) => {
      try {
        const r = await checkNeed(j);
        await db.from("admin_needs_checks").update({
          status: "done", verdict: r.verdict, confidence: r.confidence, summary: r.summary, evidence: r.evidence,
          model: r.model, closed: r.closed, error: r.error ?? null, finished_at: new Date().toISOString(),
        }).eq("id", j.id);
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        if (e instanceof RetryLater) {
          // the minute drain picks it up again once the wait is over
          await db.from("admin_needs_checks").update({ status: "queued", started_at: null, error: `waiting for free AI: ${msg}`.slice(0, 300),
            not_before: new Date(Date.now() + 90_000).toISOString() }).eq("id", j.id);
          n++;
          return;
        }
        // under 3 tries: back in the queue for the next drain; the SQL drain gives up after 3
        await db.from("admin_needs_checks").update(j.attempts >= 3
          ? { status: "error", error: msg, finished_at: new Date().toISOString() }
          : { status: "queued", started_at: null, error: msg }).eq("id", j.id);
      }
      n++;
    }));
  }
  if (n) await notifyNeeds().catch(() => {});
  return n;
}

/** When a refresh's AI pass finishes and it closed something, say so once (quiet if it closed nothing). */
async function notifyNeeds() {
  const { data } = await db.from("admin_needs_checks").select("run_id, title, summary, closed, rule, status")
    .gte("created_at", new Date(Date.now() - 3600e3).toISOString());
  const byRun = new Map<string, any[]>();
  for (const r of (data ?? []) as any[]) (byRun.get(r.run_id) ?? byRun.set(r.run_id, []).get(r.run_id)!).push(r);
  for (const [run, rows] of byRun) {
    if (rows.some((r) => r.status === "queued" || r.status === "running")) continue;
    const ai = rows.filter((r) => r.closed && !r.rule);
    if (!ai.length) continue;
    await db.rpc("scout_notify", {
      p_title: `Scout closed ${ai.length} item${ai.length === 1 ? "" : "s"} that were already done`,
      p_body: ai.map((r) => `${r.title}: ${r.summary}`).join("\n").slice(0, 480) + "\nWrong? Open it on the home page and tap Undo.",
      p_severity: "info", p_push: false, p_url: "/admin", p_dedupe: `needs-check.run.${run}`,
    });
  }
}

/* ───────── the queue: checks keep going after Jared leaves the page ───────── */

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const background = (p: Promise<unknown>) => {
  const safe = p.catch((e) => console.error("todo-check background:", (e as Error).message));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(safe);
};

async function openTodos(skipRecent: boolean | number) {
  const since = new Date(Date.now() - 21 * 864e5).toISOString();
  const { data } = await db.from("scout_daily").select("id, action").in("kind", ["pick", "call"]).eq("status", "open")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(40);
  // true = nightly (skip what was checked today); a number = skip anything checked within that many ms
  const window = skipRecent === true ? 12 * 3600e3 : typeof skipRecent === "number" ? skipRecent : 0;
  return ((data ?? []) as any[]).filter((t) => {
    const at = t.action?.check?.at ? Date.parse(t.action.check.at) : 0;
    return !window || Date.now() - at > window;
  }).map((t) => String(t.id));
}

async function enqueue(ids: string[], trigger: "button" | "sweep" | "nightly", allowClose: boolean, by: string | null) {
  if (!ids.length) return { run_id: null, total: 0 };
  // a to-do already waiting keeps its place (unique live job per to-do)
  const { data: live } = await db.from("todo_check_jobs").select("todo_id").in("todo_id", ids).in("status", ["queued", "running"]);
  const busy = new Set(((live ?? []) as any[]).map((r) => r.todo_id));
  const fresh = ids.filter((i) => !busy.has(i));
  if (!fresh.length) return { run_id: null, total: 0, already: ids.length };
  const { data: run, error } = await db.from("todo_check_runs").insert({ trigger, total: fresh.length, started_by: by }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: jErr } = await db.from("todo_check_jobs").insert(fresh.map((todo_id) => ({ run_id: run.id, todo_id, trigger, allow_close: allowClose })));
  if (jErr) {
    await db.from("todo_check_runs").delete().eq("id", run.id);
    throw new Error(jErr.message);
  }
  return { run_id: run.id as string, total: fresh.length, already: ids.length - fresh.length };
}

async function notifyRun(r: any) {
  const { data: jobs } = await db.from("todo_check_jobs").select("result, todo:scout_daily(title)").eq("run_id", r.id);
  const rows = ((jobs ?? []) as any[]).filter((j) => j.result);
  const closed = rows.filter((j) => j.result.auto_closed);
  const done = rows.filter((j) => j.result.verdict === "done" && !j.result.auto_closed);
  const title = r.total === 1 && rows[0]
    ? `Checked: ${rows[0].todo?.title ?? "your to-do"}`
    : `Scout checked ${r.total} to-do${r.total === 1 ? "" : "s"}`;
  const label: Record<string, string> = { done: "Looks done", partly: "Partly done", not_done: "Not yet", unknown: "Can't tell" };
  const body = r.total === 1 && rows[0]
    ? `${label[rows[0].result.verdict] ?? "Checked"}: ${rows[0].result.summary ?? ""}`
    : [
        closed.length ? `Closed ${closed.length}: ${closed.map((c) => c.todo?.title).join("; ")}` : "",
        done.length ? `${done.length} look done, tap Mark done: ${done.map((c) => c.todo?.title).join("; ")}` : "",
        !closed.length && !done.length ? "Nothing new looks done." : "",
        r.errors ? `${r.errors} couldn't be checked; Scout will retry tonight.` : "",
        closed.length ? "Wrong? Tap Put back." : "",
      ].filter(Boolean).join("\n");
  // nightly with nothing to report stays quiet
  if (r.trigger === "nightly" && !closed.length && !done.length) return;
  await db.rpc("scout_notify", {
    p_title: title.slice(0, 200), p_body: body.slice(0, 480), p_severity: "info", p_push: false,
    p_url: "/admin", p_dedupe: `todo-check.run.${r.id}`,
  });
}

// Work the queue until the time budget runs out; todo_check_drain() (every minute) picks up the rest.
async function drain(budgetMs = 140_000) {
  const stop = Date.now() + budgetMs;
  const paid = true; // v5: free Groq answers in ~1 s; the Mac mini is only the last rung
  // the Mac mini answers one at a time and can take ~30-90s, so leave room for a whole job
  const margin = paid ? 65_000 : 105_000;
  let n = 0;
  // Needs you first: a Refresh means Jared is looking at that list right now
  try { n += await drainNeeds(stop); } catch (e) { console.error("needs drain:", (e as Error).message); }
  while (Date.now() < stop - margin) {
    const { data: jobs, error } = await db.rpc("todo_check_claim", { p_n: paid ? 3 : 1 });
    if (error) throw new Error(error.message);
    const list = (jobs ?? []) as any[];
    if (!list.length) break;
    await Promise.all(list.map(async (j) => {
      let res: any = null, err: string | null = null;
      try { res = await check(j.todo_id, j.trigger, j.allow_close); } catch (e) { err = (e as Error).message; }
      const slim = res ? { verdict: res.verdict, confidence: res.confidence, summary: res.summary, auto_closed: res.auto_closed, check_id: res.id } : null;
      const { data: finishedRun } = await db.rpc("todo_check_job_done", { p_job: j.id, p_ok: !!res, p_result: slim, p_error: err });
      if (finishedRun) await notifyRun(finishedRun).catch(() => {});
      n++;
    }));
  }
  return n;
}

/* ───────── learning from a thumbs down ───────── */

async function learn(checkId: string) {
  const { data: c } = await db.from("todo_checks").select("*, todo:scout_daily(title, why, action)").eq("id", checkId).maybeSingle();
  if (!c) throw new Error("no such check");
  const row = c as any;
  if (row.learned) return { ok: true, already: true };
  let lesson: any = null;
  try {
    const out = await llm({
      task: "learn", json: true, maxTokens: 400, job: "todo-check-learn", ref: checkId,
      system: [
        "Scout (Jared's assistant) judged whether a to-do was done, and Jared said the judgement was wrong.",
        "Write ONE short, reusable rule that would have prevented this mistake on FUTURE to-dos of the same kind.",
        "Generalize (e.g. 'a Deck card moved to Done is not proof an email was sent'), don't just restate this to-do.",
        'Return JSON only: {"title":"3-8 words","when_text":"when this applies","do_text":"what to do","avoid_text":"what not to do"}',
      ].join("\n"),
      user: JSON.stringify({
        todo: row.todo?.title, detail: row.todo?.why, scout_said: row.verdict, confidence: row.confidence, scout_summary: row.summary,
        auto_closed: row.auto_closed, jared: row.feedback === "undo" ? "put it back (it is not done)" : "thumbs down", jared_note: row.feedback_note,
        evidence_scout_used: (row.evidence ?? []).map((e: any) => `${e.src}: ${e.title}: ${String(e.quote ?? "").replace(/[«»]/g, "").slice(0, 200)}`),
      }),
    });
    lesson = out.json;
  } catch { /* fall back below */ }
  if (!lesson?.title || !lesson?.do_text) {
    const kinds = [...new Set((row.evidence ?? []).map((e: any) => e.src))].join(" + ") || "word matches";
    lesson = {
      title: `Don't trust ${kinds} alone`,
      when_text: `judging a to-do like "${String(row.todo?.title ?? "").slice(0, 80)}"`,
      do_text: row.feedback_note ? `remember Jared said: ${row.feedback_note}` : "require evidence that the action itself happened",
      avoid_text: `calling it ${row.verdict} from ${kinds} only`,
    };
  }
  const title = String(lesson.title).slice(0, 80);
  const { data: prev } = await db.from("scout_lessons").select("id, evidence").eq("scope", "todo-check").eq("title", title).maybeSingle();
  const ev = [...(((prev as any)?.evidence ?? []) as any[]), { check_id: checkId, todo: row.todo?.title, note: row.feedback_note, at: new Date().toISOString() }].slice(-10);
  const body = { scope: "todo-check", title, when_text: String(lesson.when_text ?? "").slice(0, 300), do_text: String(lesson.do_text ?? "").slice(0, 400),
    avoid_text: String(lesson.avoid_text ?? "").slice(0, 300), evidence: ev, active: true, updated_at: new Date().toISOString() };
  const { error } = prev ? await db.from("scout_lessons").update(body).eq("id", (prev as any).id)
    : await db.from("scout_lessons").insert({ ...body, source: "feedback", signature: `todo-check:${title.toLowerCase()}` });
  if (error) throw new Error(error.message);
  await db.from("todo_checks").update({ learned: true }).eq("id", checkId);
  return { ok: true, lesson: title };
}

/* ───────── entry ───────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const apikey = req.headers.get("apikey") ?? "";
  const service = (await isService(bearer)) || (apikey.startsWith("sb_secret_") && (await isService(apikey)));
  const admin = service ? null : await adminId(bearer);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* empty */ }
  // Partners (Eli) may only check their OWN call to-dos, one at a time, never auto-closed.
  if (!service && !admin) {
    const partner = body.op === "check" ? await partnerOf(bearer) : null;
    if (!partner) return J({ ok: false, error: "sign in to the Bestly admin" }, 401);
    const { data: t } = await db.from("scout_daily").select("kind, action").eq("id", String(body.id ?? "")).maybeSingle();
    if (!t || (t as any).kind !== "call" || String((t as any).action?.owner ?? "").toLowerCase() !== partner.roster) {
      return J({ ok: false, error: "you can only check your own to-dos" }, 403);
    }
    const { data: gate } = await db.rpc("ai_gate", { p_fn: "todo-check", p_who: `partner:${partner.uid}` });
    if ((gate as any)?.ok === false) return J({ ok: false, error: "paused for today" }, 429);
    const q = await enqueue([String(body.id)], "button", false, null);
    background(drain());
    return J({ ok: true, queued: true, ...q });
  }

  try {
    switch (body.op) {
      case "check": {
        // one to-do: queued, so it finishes even if the page closes
        if (!body.id) return J({ ok: false, error: "id required" }, 400);
        if (!service) {
          const { data: gate } = await db.rpc("ai_gate", { p_fn: "todo-check", p_who: `user:${admin}` });
          if ((gate as any)?.ok === false) return J({ ok: false, error: `paused: ${(gate as any)?.reason ?? "limit"} (resets at midnight Pacific)` }, 429);
        }
        const q = await enqueue([String(body.id)], "button", false, admin);
        background(drain());
        return J({ ok: true, queued: true, ...q });
      }
      case "sweep": {
        const q = await enqueue(await openTodos(false), "sweep", true, admin);
        background(drain());
        return J({ ok: true, queued: true, ...q });
      }
      case "refresh": {
        // The Refresh button: close what is provably done, queue the rest for the judge, sweep the to-dos.
        if (!admin && !service) return J({ ok: false, error: "sign in to the Bestly admin" }, 401);
        const run = crypto.randomUUID();
        const { data: rules, error: rErr } = await db.rpc("admin_needs_rules", { p_run: run });
        if (rErr) throw new Error(rErr.message);
        // to-dos checked in the last 2 hours are skipped: the free AI has a small per-minute budget
        const q = await enqueue(await openTodos(2 * 3600e3), "sweep", true, admin);
        background(drain());
        const r = (rules ?? {}) as { closed?: any[]; queued?: number };
        return J({ ok: true, run, closed: r.closed ?? [], judging: r.queued ?? 0, todos: q.total, todo_run: q.run_id });
      }
      case "drain": {
        if (!service) return J({ ok: false, error: "service only" }, 403);
        background(drain());
        return J({ ok: true, draining: true });
      }
      case "tick": {
        const { day, hour } = laNow();
        if (hour !== 22) return J({ ok: true, hour, ran: null });
        const { error } = await db.from("scout_daily_runs").insert({ day, job: "todo-check" });
        if (error) return J({ ok: true, hour, ran: "already ran today" });
        const q = await enqueue(await openTodos(true), "nightly", true, null);
        await db.from("scout_daily_runs").update({ result: q }).eq("day", day).eq("job", "todo-check");
        background(drain());
        return J({ ok: true, hour, ran: q });
      }
      case "nightly": {
        if (!service) return J({ ok: false, error: "service only" }, 403);
        const { day } = laNow();
        await db.from("scout_daily_runs").upsert({ day, job: "todo-check", ran_at: new Date().toISOString() });
        const q = await enqueue(await openTodos(true), "nightly", true, null);
        await db.from("scout_daily_runs").update({ result: { ...q, healed: !!body.force } }).eq("day", day).eq("job", "todo-check");
        background(drain());
        return J({ ok: true, ...q });
      }
      case "learn":
        return J(await learn(String(body.check_id)));
      case "learn_backlog": {
        const { data } = await db.from("todo_checks").select("id").in("feedback", ["down", "undo"]).eq("learned", false)
          .gte("feedback_at", new Date(Date.now() - 3 * 864e5).toISOString()).limit(10);
        const out = [];
        for (const r of (data ?? []) as any[]) { try { out.push(await learn(r.id)); } catch (e) { out.push({ id: r.id, error: (e as Error).message }); } }
        return J({ ok: true, retried: out });
      }
      default:
        return J({ ok: false, error: "unknown op" }, 400);
    }
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 200);
  }
});
