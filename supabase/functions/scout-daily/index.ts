// scout-daily — Scout working for Jared every day, without being asked.
//
//   op tick     hourly cron; by Los Angeles time: 6 drafts, 9 picks, 18 wrap (once a day each)
//   op morning  Today's 3: one decision, one quick win, one focus task  -> scout_daily kind pick
//   op drafts   replies worth sending from the last 48h of synced mail   -> kind draft
//   op call     {id} a finished transcript -> commitments on the Bestly Ops Deck board -> kind call
//   op wrap     what got done, what rolls over, tomorrow's first move    -> kind wrap
//   op run      {job, force} the same, started from the admin home page (admin JWT)
//   op deck_check  can we reach the Deck board
//   op todo_owner  {id} rename a call to-do's Deck card to "<owner>: <task>" after todo_set_owner()
//                  moved it (v3: to-dos from one-mic meetings could land on the wrong person)
//   op reflect  {days, dry, paid} learn from the last day(s): Jared's own messages (corrections, repeats, friction) AND what failed
//               and what fixed it -> scout_lessons (+ mirrored to bestly_memory lessons/scout-playbook). Chunked, retried
//               across the free ladder. dry=true proposes lessons without saving.
//   op tick_reflect  hourly cron (:20): from 2 AM LA until today's reflect has finished (resumes a partial night, 8 tries a day)
//   op reflect_job {force}  the same job by hand (claims the day, records the attempt)
//
// Called by pg_cron / a trigger with the service key, or by an admin from the browser.
// Nothing here sends anything to anyone: drafts wait for Jared's tap in his own mail app.
// v7: AI runs free-only via ../_shared/free-llm.ts (see claude() below). $0.
// v18 (2026-10-10): reflect rebuilt (chunked, retried, reads Jared's messages, never exits early, watchdog scout.reflect.stale).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm, LlmUnavailable, type LlmTask } from "../_shared/free-llm.ts";
import { corsWith } from "../_shared/cors.ts";
import { isBlocked, type BlockRow } from "../_shared/spam-rules.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

// v4: background jobs run on the cheapest Claude model, are logged in ai_spend and stop at the daily
// background cap (scout_settings.background_cap_usd). They used to run on Sonnet with no check at all.
const MODEL = Deno.env.get("SCOUT_DAILY_MODEL") ?? "claude-haiku-4-5";
const PRICE: Record<string, [number, number]> = { haiku: [1, 5], sonnet: [3, 15], opus: [15, 75] }; // $ per million in/out
const priceOf = (m: string) => PRICE[Object.keys(PRICE).find((k) => m.includes(k)) ?? "sonnet"];
const TZ = "America/Los_Angeles";
const DECK_BOARD = "Bestly Ops";
const SERVICE = SB_SECRET;
const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE, { auth: { persistSession: false } });

const CORS = corsWith({
  headers: "authorization, content-type, apikey, x-client-info, x-proxy-key",
  methods: "POST, OPTIONS"
});
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

function la(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

function cleanKey(raw: string | undefined) {
  const m = (raw ?? "").match(/sk-ant-[A-Za-z0-9_\-]{20,}/);
  return (m ? m[0] : raw ?? "").trim();
}

// v7 (2026-09-23): $0. Every job runs on free AI through _shared/free-llm.ts — Groq -> Cloudflare Workers AI ->
// Mac mini Ollama (morning only) — all no-training providers. Paid Claude is never called from here.
// The name claude() is kept so the call sites stay untouched. If every free rung fails the job errors as before:
// morning falls back to the top of the queue, call un-claims the recording, drafts/reflect record the error.
// Rollback without a deploy: set env SCOUT_DAILY_PAID=fallback (Haiku comes back, under ai_budget), or redeploy v6.
const TASK: Record<string, LlmTask> = { morning: "pick", drafts: "triage", call: "extract", reflect: "reflect" };
const SHAPE: Record<string, (j: any) => string | null> = {
  morning: (j) => Array.isArray(j?.picks) ? null : "no picks array",
  drafts: (j) => Array.isArray(j?.drafts) ? null : "no drafts array",
  call: (j) => Array.isArray(j?.commitments) && typeof j?.summary === "string" ? null : "no commitments/summary",
  reflect: (j) => Array.isArray(j?.lessons) ? null : "no lessons array",
};

async function claude(system: string, user: string, maxTokens = 3000, job = "background", ref: string | null = null): Promise<any> {
  const paid = Deno.env.get("SCOUT_DAILY_PAID") === "fallback" ? "fallback" : "never";
  try {
    const r = await llm({
      task: TASK[job] ?? "summarize", system, user, json: true, job, ref, fn: "scout-daily", scope: "background", paid,
      maxTokens: Math.min(maxTokens * 2, 8000), // free reasoning models spend part of the budget thinking
      deadlineMs: 110_000, validate: SHAPE[job],
    });
    return r.json;
  } catch (e) {
    if (e instanceof LlmUnavailable) throw new Error(`free AI unavailable (${e.reason}): ${e.tried.map((t) => `${t.provider} ${t.outcome}`).join(", ")}`);
    throw e;
  }
}

async function claimRun(day: string, job: string, force = false): Promise<boolean> {
  if (force) {
    await db.from("scout_daily_runs").upsert({ day, job, ran_at: new Date().toISOString() });
    return true;
  }
  const { error } = await db.from("scout_daily_runs").insert({ day, job });
  return !error; // a duplicate key means it already ran today
}
const finishRun = (day: string, job: string, result: unknown) =>
  db.from("scout_daily_runs").update({ result }).eq("day", day).eq("job", job);

async function notify(title: string, body: string, push: boolean, dedupe: string) {
  await db.rpc("scout_notify", { p_title: title.slice(0, 200), p_body: body.slice(0, 500), p_severity: "info", p_push: push, p_url: "/admin", p_dedupe: dedupe });
}

const VOICE = "Jared Best runs Bestly LLC, a small privacy-first product studio in West Hollywood. He writes casually and directly: short sentences, no filler, no corporate phrasing, no emoji in business mail. He signs off as Jared.";

/* ───────── 9am: Today's 3 ───────── */

async function morning(day: string) {
  const [{ data: today }, { data: inc }, { data: jobs }, { data: carry }] = await Promise.all([
    db.rpc("admin_today"),
    db.from("monitor_issues").select("key, severity, title, needs_jared").eq("status", "open").not("needs_jared", "is", null).limit(15),
    db.from("mac_jobs").select("id, title").eq("status", "proposed").limit(5),
    db.from("scout_daily").select("kind, slot, title, why, url, source_key, action, day")
      .in("kind", ["pick", "call", "draft"]).eq("status", "open").gte("day", addDays(day, -7)).limit(40),
  ]);
  const snoozed = (carry ?? []).filter((c: any) => c.kind === "pick" && c.day === day);
  const candidates = [
    ...(today ?? []).map((t: any) => ({ source_key: `today:${t.key}`, title: t.title, detail: t.detail, rank: t.rank, url: t.url, from: t.source })),
    ...(inc ?? []).map((i: any) => ({ source_key: `incident:${i.key}`, title: i.title, detail: i.needs_jared, rank: 1, url: "/admin/monitor", from: "Monitor" })),
    ...(jobs ?? []).map((j: any) => ({ source_key: `job:${j.id}`, title: `Tap Run: ${j.title}`, detail: "A Mac mini job Scout proposed", rank: 2, url: "/admin?scout=open", from: "Scout" })),
    ...(carry ?? []).filter((c: any) => c.kind === "call" && (c.action?.owner ?? "").toLowerCase() === "jared")
      .map((c: any) => ({ source_key: c.source_key, title: c.title, detail: `From a call${c.action?.due ? `, due ${c.action.due}` : ""}`, rank: 2, url: c.action?.deck_url ?? "/admin", from: "Calls" })),
    ...(carry ?? []).filter((c: any) => c.kind === "draft").slice(0, 3)
      .map((c: any) => ({ source_key: c.source_key, title: `Send the reply: ${c.title}`, detail: c.why, rank: 3, url: "/admin#drafts", from: "Mail" })),
  ].filter((c) => !snoozed.some((s: any) => s.source_key === c.source_key));

  const need = 3 - snoozed.length;
  let picks: any[] = [];
  if (need > 0 && candidates.length) {
    try {
      const out = await claude(
        `${VOICE}\nYou are Scout, his assistant. Pick his day. Return JSON only: {"picks":[{"slot":"decision"|"quick"|"focus","source_key":"...","title":"...","why":"..."}]}.\n` +
        `Rules: exactly one per slot, ${need} picks total, skipping slots already taken: ${JSON.stringify(snoozed.map((s: any) => s.slot))}. ` +
        `decision = something only he can decide. quick = under 5 minutes. focus = the one piece of real work that moves the business most. ` +
        `title: an imperative under 70 characters that says exactly what to do. why: one plain line on why today. Use only source_keys from the list. Rank 0 and 1 are broken or stopped things; prefer them.`,
        JSON.stringify(candidates.slice(0, 40)),
        1500, "morning",
      );
      picks = (out.picks ?? []).filter((p: any) => candidates.some((c) => c.source_key === p.source_key)).slice(0, need);
    } catch (e) {
      console.error("morning model", e);
    }
    if (!picks.length) {
      // No model: take the top of the queue.
      const slots = ["decision", "quick", "focus"].filter((s) => !snoozed.some((x: any) => x.slot === s));
      picks = [...candidates].sort((a, b) => a.rank - b.rank).slice(0, need)
        .map((c, i) => ({ slot: slots[i], source_key: c.source_key, title: c.title.slice(0, 90), why: c.detail }));
    }
  }
  for (const p of picks) {
    const c = candidates.find((x) => x.source_key === p.source_key)!;
    await db.from("scout_daily").upsert({
      day, kind: "pick", slot: p.slot, title: String(p.title).slice(0, 140), why: String(p.why ?? "").slice(0, 300),
      url: c.url ?? null, source_key: p.source_key, action: { from: c.from },
    }, { onConflict: "day,kind,source_key", ignoreDuplicates: true });
  }
  const all = [...snoozed, ...picks];
  const order = { decision: 0, quick: 1, focus: 2 } as Record<string, number>;
  all.sort((a, b) => order[a.slot] - order[b.slot]);
  const { count: drafts } = await db.from("scout_daily").select("id", { count: "exact", head: true }).eq("kind", "draft").eq("status", "open");
  if (all.length) {
    await notify(`Today's 3: ${all.map((p) => p.title).join(" · ")}`.slice(0, 200),
      drafts ? `${drafts} replies drafted and waiting too.` : "Open the admin to tap through them.", true, `scout.today.${day}`);
  }
  return { picks: all.length, drafts: drafts ?? 0 };
}

/* ───────── 6am: drafted replies ───────── */

// 2026-10-07 (Spam Desk): bulk-mail senders and bulk-mail footers are noise too, so they never reach a reply draft.
const NOISE = /(no-?reply|donotreply|notifications?@|mailer|newsletter|news@|updates?@|marketing|promo|deals?@|offers?@|rewards?@|surveys?@|campaigns?@|mailing|info@.*(shop|store)|bounce|support@(apple|google|github)|@(github|vercel|stripe|supabase|google|apple|amazon|linkedin|facebook|instagram|x|twitter|turo|uber|lyft|doordash|paypal|venmo|chase|wellsfargo|bankofamerica)\.com)/i;
const BULK_BODY = /(view (this email )?in (your )?browser|you are receiving this (email |message )?because|manage (your )?(email )?preferences|update (your )?(email )?preferences)/i;

async function drafts(day: string) {
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const { data: mail } = await db.from("bestly_mail").select("id, mailbox, from_addr, from_name, subject, sent_at, body_text, message_id, to_addrs")
    .eq("folder", "INBOX").gte("sent_at", since).order("sent_at", { ascending: false }).limit(150);
  const { data: done } = await db.from("scout_daily").select("source_key").eq("kind", "draft").gte("day", addDays(day, -14));
  const seen = new Set((done ?? []).map((d: any) => d.source_key));
  // Spam Desk: blocked senders and anything already judged phishing / commercial / spam never become a reply draft.
  // ("unsure" mail gets a Spam? card from spam-desk instead; "legit" is judged fine and drafts as before.)
  const { data: blockRows } = await db.from("mail_blocklist").select("pattern, kind").eq("active", true).limit(5000);
  const blocklist = (blockRows ?? []) as BlockRow[];
  const mailIds = (mail ?? []).map((m: any) => m.id);
  const { data: verdictRows } = mailIds.length
    ? await db.from("mail_verdicts").select("mail_id, verdict").in("mail_id", mailIds).in("verdict", ["phishing", "commercial", "spam", "unsure"])
    : { data: [] as any[] };
  const spammy = new Set((verdictRows ?? []).map((v: any) => v.mail_id));
  const cands = (mail ?? []).filter((m: any) =>
    m.from_addr && !NOISE.test(m.from_addr) && !/jared(best)?@|@bestly\.tech$/i.test(m.from_addr) && !seen.has(`mail:${m.id}`) &&
    !isBlocked(blocklist, m.from_addr) && !spammy.has(m.id) &&
    !/unsubscribe/i.test(String(m.body_text ?? "").slice(-1500)) && !BULK_BODY.test(String(m.body_text ?? "").slice(0, 2500))).slice(0, 40);
  if (!cands.length) return { drafted: 0, looked_at: 0 };

  // v9 (2026-09-30): the mail goes in batches that fit Groq's 8K tokens/min per model and the Mac mini's 8K context.
  // One ~40-email call (~28K tokens with output) only ever fit Cloudflare, so drafts failed whenever Cloudflare's
  // daily Neurons were gone ("groq skipped_size, cloudflare rate_limited": 9/27, 9/30).
  const system =
    `${VOICE}\nYou are Scout. From these emails, choose the ones where a real person is waiting on a reply from Jared (at most 5; zero is fine). ` +
    `Skip receipts, automated mail, marketing and anything that needs no answer. For each, write the reply he would send: short, specific to what they asked, ` +
    `no invented facts, dates or promises (use [brackets] for anything he must fill in). Return JSON only: {"drafts":[{"mail_id":"...","why":"one line: what they need","reply":"..."}]}.`;
  const BATCH_CHARS = 13_000;           // ~3.7K tokens of mail + ~0.3K system + 2K output < GROQ_MAX / LOCAL_MAX (7K)
  const batches: any[][] = [];
  let cur: any[] = [], size = 0;
  for (const m of cands) {
    const item = { mail_id: m.id, from: `${m.from_name ?? ""} <${m.from_addr}>`, to: m.mailbox, subject: m.subject, sent: m.sent_at, body: String(m.body_text ?? "").slice(0, 900) };
    const len = JSON.stringify(item).length;
    if (cur.length && size + len > BATCH_CHARS) { batches.push(cur); cur = []; size = 0; }
    cur.push(item); size += len;
  }
  if (cur.length) batches.push(cur);
  const found: any[] = [];
  const errors: string[] = [];
  const t0 = Date.now();
  for (const b of batches) {
    if (found.length >= 5 || Date.now() - t0 > 90_000) break; // stay inside the function's time limit
    try {
      const r = await claude(system, JSON.stringify(b), 1000, "drafts");
      found.push(...(r.drafts ?? []));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!found.length && errors.length) throw new Error(errors[errors.length - 1]);
  const out = { drafts: found };
  let n = 0;
  for (const d of (out.drafts ?? []).slice(0, 5)) {
    const m = cands.find((c: any) => c.id === d.mail_id);
    if (!m || !d.reply) continue;
    const subject = /^re:/i.test(m.subject ?? "") ? m.subject : `Re: ${m.subject ?? ""}`;
    await db.from("scout_daily").upsert({
      day, kind: "draft", title: `${m.from_name || m.from_addr}: ${m.subject ?? "(no subject)"}`.slice(0, 140),
      why: String(d.why ?? "").slice(0, 300), body: String(d.reply).slice(0, 4000), source_key: `mail:${m.id}`,
      action: { to: m.from_addr, to_name: m.from_name, subject, mailbox: m.mailbox, message_id: m.message_id, received: m.sent_at },
    }, { onConflict: "day,kind,source_key", ignoreDuplicates: true });
    n++;
  }
  return { drafted: n, looked_at: cands.length };
}

/* ───────── calls -> Deck ───────── */

async function deck() {
  const { data: cred } = await db.rpc("nextcloud_cred");
  const c = cred as Record<string, string> | null;
  if (!c?.nextcloud_base_url) throw new Error("no Nextcloud credentials");
  const base = c.nextcloud_base_url.replace(/\/+$/, "");
  const headers = {
    Authorization: "Basic " + btoa(`${c.nextcloud_user}:${c.nextcloud_app_password}`),
    "OCS-APIRequest": "true", Accept: "application/json", "Content-Type": "application/json",
  };
  const api = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${base}/index.php/apps/deck/api/v1.0${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`deck ${r.status} ${path}`);
    return r.json();
  };
  const boards = await api("/boards");
  const board = (boards as any[]).find((b) => b.title === DECK_BOARD && !b.archived && !b.deletedAt);
  if (!board) throw new Error(`no Deck board called ${DECK_BOARD}`);
  const stacks = (await api(`/boards/${board.id}/stacks`)) as any[];
  stacks.sort((a, b) => a.order - b.order);
  const stack = stacks.find((s) => /to ?do|backlog|inbox|next/i.test(s.title)) ?? stacks[0];
  if (!stack) throw new Error("Deck board has no lists");
  return {
    board, stack,
    renameCard: async (cardId: number, title: string) => {
      // Deck's PUT needs the card's current type/owner; its list may have changed since it was made.
      for (const s of stacks) {
        const found = ((await api(`/boards/${board.id}/stacks/${s.id}`)).cards ?? []).find((c: any) => c.id === cardId);
        if (!found) continue;
        await api(`/boards/${board.id}/stacks/${s.id}/cards/${cardId}`, {
          method: "PUT",
          body: JSON.stringify({ title: title.slice(0, 250), type: found.type ?? "plain", owner: found.owner?.uid ?? found.owner ?? "",
            description: found.description ?? "", duedate: found.duedate ?? null, order: found.order ?? 999 }),
        });
        return true;
      }
      return false;
    },
    addCard: async (title: string, description: string, due: string | null) => {
      const card = await api(`/boards/${board.id}/stacks/${stack.id}/cards`, {
        method: "POST",
        body: JSON.stringify({ title: title.slice(0, 250), type: "plain", order: 999, description, duedate: due ? `${due}T17:00:00-07:00` : null }),
      });
      return { id: card.id, url: `${base}/apps/deck/board/${board.id}/card/${card.id}` };
    },
  };
}

async function call(id: string, force = false) {
  const { data: r } = await db.from("meeting_recordings").select("id, name, started_at, roster, transcript, tasks_at").eq("id", id).maybeSingle();
  if (!r) return { ok: false, error: "no recording" };
  if (r.tasks_at && !force) return { ok: true, skipped: "already done" };
  const text = String(r.transcript ?? "");
  if (text.length < 400) return { ok: true, skipped: "too short" };
  await db.from("meeting_recordings").update({ tasks_at: new Date().toISOString() }).eq("id", id); // claim first: no double cards

  const t = text.length > 90_000 ? text.slice(0, 45_000) + "\n[...]\n" + text.slice(-45_000) : text;
  let out: any;
  try {
    out = await claude(
      `${VOICE}\nYou are Scout. Read this call transcript (JARED lines are his own mic; a name ending in ? was a voice guess, so check it against context). ` +
      `Return JSON only: {"summary":"2 sentences","decisions":["..."],"commitments":[{"owner":"Jared|<first name>","task":"imperative, under 90 characters","due":"YYYY-MM-DD or null","quote":"exact words"}],"questions":["..."]}. ` +
      `Only what was actually agreed. A due date only if one was said (today is ${la().day}; resolve "Friday" etc. to a date). No duplicates. ` +
      `Owner = the person who will DO it, worked out from what is said ("I'll send it" -> the speaker; "can you..." -> the person asked; "Jared will..." -> Jared). ` +
      `Speaker labels can be wrong, especially on one-mic recordings (the header says so): trust what the words say over the label. When it's unclear who will do it, the owner is Jared. ` +
      `NOT commitments: anything said in a demo, test call or role-play (e.g. a phone bot like Ava or RoofGuard "booking" a call, someone pretending to be a customer), ` +
      `lines read aloud from an app or to-do list, and hypotheticals. Add "quote": the exact words (under 160 characters) the commitment came from.`,
      `Call: ${r.name}\nPeople: Jared, ${(r.roster ?? []).join(", ")}\n\n${t}`,
      2500, "call", id,
    );
  } catch (e) {
    await db.from("meeting_recordings").update({ tasks_at: null }).eq("id", id);
    throw e;
  }
  const commitments = (out.commitments ?? []).slice(0, 20);
  let d: Awaited<ReturnType<typeof deck>> | null = null;
  let deckErr = "";
  try { d = commitments.length ? await deck() : null; } catch (e) { deckErr = (e as Error).message; }

  const day = la().day;
  let mine = 0;
  for (let i = 0; i < commitments.length; i++) {
    const c = commitments[i];
    const owner = String(c.owner ?? "Jared").trim() || "Jared";
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(c.due)) ? String(c.due) : null;
    let card: { id: number; url: string } | null = null;
    if (d) {
      try { card = await d.addCard(`${owner}: ${c.task}`, `From the call ${r.name}.\n\n${out.summary ?? ""}`, due); }
      catch (e) { deckErr = (e as Error).message; }
    }
    if (owner.toLowerCase() === "jared") mine++;
    await db.from("scout_daily").upsert({
      day, kind: "call", title: String(c.task).slice(0, 140), why: `${owner}${due ? ` · due ${due}` : ""} · from ${r.name}`,
      source_key: `call:${r.id}:${i}`, url: card?.url ?? null,
      action: { owner, due, meeting: r.name, meeting_id: r.id, deck_card: card?.id ?? null, deck_url: card?.url ?? null,
        quote: c.quote ? String(c.quote).slice(0, 200) : null },
    }, { onConflict: "day,kind,source_key", ignoreDuplicates: true });
  }
  await db.from("meeting_recordings").update({
    summary: { summary: out.summary, decisions: out.decisions ?? [], commitments, questions: out.questions ?? [], deck_error: deckErr || null },
  }).eq("id", id);
  const who = (r.roster ?? []).map((n: string) => n[0]?.toUpperCase() + n.slice(1)).join(", ") || "the call";
  await notify(`Call with ${who}: ${commitments.length} to-do${commitments.length === 1 ? "" : "s"}${d ? " on Deck" : ""}, ${mine} yours`,
    String(out.summary ?? "") + (deckErr ? ` (Deck: ${deckErr})` : ""), false, `scout.call.${r.id}`);
  return { ok: true, commitments: commitments.length, mine, deck: d ? d.board.title : null, deck_error: deckErr || null };
}

/* ───────── 6pm: wrap ───────── */

async function wrap(day: string) {
  const { data: rows } = await db.from("scout_daily").select("kind, slot, title, status").eq("day", day).in("kind", ["pick", "call", "draft"]);
  const picks = (rows ?? []).filter((r: any) => r.kind === "pick");
  const done = (rows ?? []).filter((r: any) => r.status === "done");
  const left = picks.filter((r: any) => r.status === "open");
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { count: healed } = await db.from("monitor_issues").select("key", { count: "exact", head: true }).eq("self_healed", true).gte("resolved_at", since);
  if (!picks.length && !done.length) return { sent: false };
  const { data: q } = await db.rpc("admin_today");
  const first = left.find((p: any) => p.slot === "focus") ?? left[0] ?? (q ?? [])[0];
  const lines = [
    `Done ${picks.filter((p: any) => p.status === "done").length} of ${picks.length} picks${done.length > picks.length ? `, plus ${done.length - picks.filter((p: any) => p.status === "done").length} other items` : ""}.`,
    left.length ? `Rolls over: ${left.map((p: any) => p.title).join("; ")}.` : "Nothing rolls over.",
    healed ? `Scout fixed ${healed} thing${healed === 1 ? "" : "s"} on its own.` : "",
    first ? `Tomorrow, start with: ${first.title}.` : "",
  ].filter(Boolean);
  await db.from("scout_daily").upsert({ day, kind: "wrap", title: "Today's wrap", body: lines.join("\n"), source_key: "wrap" }, { onConflict: "day,kind,source_key" });
  await notify(lines[0], lines.slice(1).join(" "), done.length > 0 || left.length > 0, `scout.wrap.${day}`);
  return { sent: true, done: done.length, left: left.length };
}

/* ───────── 2am: reflect (self-learning) ───────── */

// v18 (2026-10-10, Scout audit): reflect failed 7 of 14 nights. One ~30K-token prompt only ever fit a slow FreeLLM rung, FreeLLM timed
// out 3-5 times and ate the whole deadline before Groq was reached, and a failed night was never retried. It also read only what
// FAILED and quit when nothing had, so it never learned from Jared himself. Now:
//   * the input is cut into chunks of about 4K tokens (fits Groq's 7K window), Jared's own messages first;
//   * every chunk is tried FreeLLM > Groq > Cloudflare, then Groq > Cloudflare without FreeLLM, then Cloudflare alone, with backoff,
//     and only then paid (the Paid AI switch still governs that: if it is off the paid rung refuses and the watchdog says so);
//   * a night that does not finish is resumed by the hourly tick_reflect (done chunks are remembered), up to 8 attempts a day;
//   * it never exits early because nothing failed; every run checks in as scout-learner (agent_beat);
//   * public.scout_reflect_watch() raises scout.reflect.stale (owner scout-learner) if no run finished in 26 hours.
const REFLECT_SLUG = "scout-learner";
const REFLECT_BUDGET_MS = 120_000;   // per invocation: the cron request gives the function ~150 s
const REFLECT_MAX_ATTEMPTS = 8;       // per LA day
const CHUNK_USER_CHARS = 11_000;      // ~3.1K tokens; with the prompt and 1.4K of output that stays under Groq's 7K
const reflectBeat = (ok: boolean, summary: string) => db.rpc("agent_beat", { p_slug: REFLECT_SLUG, p_ok: ok, p_summary: summary.slice(0, 200) }).then(() => {}, () => {});

type RChunk = { id: string; kind: "jared" | "failures" | "ops"; text: string; scopes: string; items: number };
const clip = (v: unknown, n: number) => { const t = typeof v === "string" ? v : JSON.stringify(v ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; };
const hash6 = (t: string) => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** Jared's words say what Scout should do differently. Corrections and repeats first. */
const CORRECTION = /\b(no[,.!]|nope|wrong|not what|that'?s not|thats not|i said|i told you|i asked|again|already|still (not|wrong|going|broken)|why did you|you (forgot|missed|didn'?t|should(n'?t| not)? have)|stop|don'?t|do not|undo|revert|instead|never|always|i want|i need you to|remember)\b/i;
const NOT_HIM = /^(Autopilot fix attempt|The Mac mini job|\[Stopped\]|\[File:|\[Video:)/;
const TAP = /^(keep going|do it|not now|yes|no|yes, do it|show me first|skip it|ok|okay|thanks|status\??)\.?$/i;
const toks = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3));
const similar = (a: Set<string>, b: Set<string>) => { if (a.size < 3 || b.size < 3) return false; let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.min(a.size, b.size) >= 0.6; };

async function jaredChunks(since: string): Promise<{ chunks: RChunk[]; stats: Record<string, number> }> {
  const { data } = await db.from("admin_chat_messages").select("id, thread_id, role, body, created_at").gte("created_at", since).order("created_at").limit(1500);
  const byThread = new Map<string, any[]>();
  for (const m of (data ?? []) as any[]) { if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []); byThread.get(m.thread_id)!.push(m); }
  const items: { id: string; weight: number; text: string; scope: string }[] = [];
  const stats = { jared_messages: 0, corrections: 0, repeats: 0, keep_going_taps: 0, paid_asks: 0 };
  for (const [tid, msgs] of byThread) {
    let lastBot = "";
    const seen: Set<string>[] = [];
    let keepGoing = 0, paidAsks = 0;
    for (const m of msgs) {
      const body = String(m.body ?? "");
      if (m.role !== "user") { if (!/^(Working:|Worked \d+ steps)/.test(body)) lastBot = body; continue; }
      if (NOT_HIM.test(body)) continue;
      stats.jared_messages++;
      const t = body.replace(/\s+/g, " ").trim();
      if (/^keep going\b/i.test(t)) { keepGoing++; stats.keep_going_taps++; continue; }
      if (/\b(use|with|switch to)\s+(paid|pair)\s*ai\b|\buse (claude|opus|sonnet)\b/i.test(t)) { paidAsks++; stats.paid_asks++; }
      if (TAP.test(t)) continue;
      const tk = toks(t);
      const repeat = seen.some((x) => similar(x, tk));
      seen.push(tk);
      const corr = CORRECTION.test(t);
      if (repeat) stats.repeats++;
      if (corr) stats.corrections++;
      items.push({
        id: String(m.id).slice(0, 8), scope: "jared",
        weight: (corr ? 3 : 0) + (repeat ? 3 : 0) + (paidAsks ? 1 : 0) + (t.length > 40 ? 1 : 0),
        text: JSON.stringify({ id: String(m.id).slice(0, 8), thread: String(tid).slice(0, 8), scout_said: clip(lastBot.replace(/^\s*OPTIONS:.*$/gm, "").trim(), 260), jared: clip(t, 420), flags: [corr ? "correction" : "", repeat ? "repeated ask" : ""].filter(Boolean) }),
      });
    }
    if (keepGoing >= 2 || paidAsks >= 2) {
      items.push({ id: `t${String(tid).slice(0, 6)}`, scope: "jared", weight: 4, text: JSON.stringify({ thread: String(tid).slice(0, 8), friction: [keepGoing >= 2 ? `Jared typed "Keep going" ${keepGoing} times: Scout stopped before the job was done` : "", paidAsks >= 2 ? `Jared asked for paid AI ${paidAsks} times in this thread` : ""].filter(Boolean) }) });
    }
  }
  // Highest-signal first; plain asks fill the rest. The chunks go to the model in that order.
  items.sort((a, b) => b.weight - a.weight);
  const chunks: RChunk[] = [];
  let cur: typeof items = [], size = 0;
  const flush = () => { if (cur.length) { chunks.push({ id: `j:${hash6(cur.map((x) => x.id).join(","))}`, kind: "jared", text: `[${cur.map((x) => x.text).join(",")}]`, scopes: "jared", items: cur.length }); cur = []; size = 0; } };
  for (const it of items.slice(0, 160)) { if (cur.length && size + it.text.length > CHUNK_USER_CHARS) flush(); cur.push(it); size += it.text.length + 1; }
  flush();
  return { chunks, stats };
}

async function failureChunks(since: string): Promise<{ chunks: RChunk[]; counts: Record<string, number> }> {
  const [{ data: acts }, { data: jobs }, { data: inc }] = await Promise.all([
    db.from("admin_chat_actions").select("id, thread_id, tool, args, result, ok, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(800),
    db.from("mac_jobs").select("id, thread_id, title, status, exit_code, script, output, created_at").gte("created_at", since).in("status", ["done", "failed"]).limit(60),
    db.from("monitor_issues").select("key, title, body, status, self_healed, heal_attempts, resolved_at").gte("updated_at", since).limit(60),
  ]);
  const byThread = new Map<string, any[]>();
  for (const x of ((acts ?? []) as any[]).reverse()) { const k = String(x.thread_id).slice(0, 8); if (!byThread.has(k)) byThread.set(k, []); byThread.get(k)!.push(x); }
  const threads: { id: string; text: string; scopes: string }[] = [];
  for (const [tid, xs] of byThread) {
    if (!xs.some((x) => !x.ok)) continue;   // a thread where nothing failed has no lesson to teach
    const steps = xs.map((x) => ({ id: String(x.id).slice(0, 8), tool: x.tool, ok: x.ok, at: String(x.created_at).slice(5, 16),
      args: clip(x.tool === "commit_files" ? { message: x.args?.message, paths: [x.args?.files, x.args?.edits].filter(Array.isArray).flat().map((f: any) => f?.path).filter(Boolean) } : x.args, 220),
      result: x.ok ? clip(x.result, 100) : clip(x.result, 320) }));
    const text = JSON.stringify({ thread: tid, steps });
    threads.push({ id: tid, text: text.length > CHUNK_USER_CHARS ? JSON.stringify({ thread: tid, steps: steps.slice(-30) }) : text, scopes: xs.map((x) => `tool:${x.tool}`).join(" ") + " " + text.slice(0, 3000) });
  }
  const chunks: RChunk[] = [];
  let cur: typeof threads = [], size = 0;
  const flush = () => { if (cur.length) { chunks.push({ id: `f:${hash6(cur.map((x) => x.id).join(","))}`, kind: "failures", text: `[${cur.map((x) => x.text).join(",")}]`, scopes: cur.map((x) => x.scopes).join(" "), items: cur.length }); cur = []; size = 0; } };
  for (const t of threads) { if (cur.length && size + t.text.length > CHUNK_USER_CHARS) flush(); cur.push(t); size += t.text.length + 1; }
  flush();
  const opsItems = [
    ...((jobs ?? []) as any[]).filter((j) => j.status === "failed").map((j) => ({ job: String(j.id).slice(0, 8), title: j.title, exit: j.exit_code, script: clip(j.script, 300), output_tail: clip(String(j.output ?? "").slice(-300), 300) })),
    ...((inc ?? []) as any[]).map((i) => ({ incident: i.key, title: i.title, status: i.status, healed: i.self_healed, tries: i.heal_attempts, body: clip(i.body, 240) })),
  ];
  let oc: any[] = [], os = 0;
  const oflush = () => { if (oc.length) { const t = JSON.stringify(oc); chunks.push({ id: `o:${hash6(t.slice(0, 400))}`, kind: "ops", text: t, scopes: t.slice(0, 3000), items: oc.length }); oc = []; os = 0; } };
  for (const it of opsItems) { const l = JSON.stringify(it).length; if (oc.length && os + l > CHUNK_USER_CHARS) oflush(); oc.push(it); os += l + 1; }
  oflush();
  return { chunks, counts: { actions: (acts ?? []).length, failed_threads: threads.length, failed_jobs: opsItems.filter((i: any) => i.job).length, incidents: (inc ?? []).length } };
}

const REFLECT_BASE =
  `You are Scout's reflection step. Scout is the assistant in Jared's admin (tools: run_sql, db_write, read_file, list_files, commit_files, mac_run, pi_command, recorder, ...). ` +
  `A LESSON must be specific and reusable and must be shown by the data: never invent a fix the data doesn't show; skip one-off noise. ` +
  `Fields: scope (tool:<name>, table:<name>, project:<name>, mac, pi, deploy, recorder, or jared:<topic> for Jared's own preferences and corrections), title (under 60 chars), ` +
  `when (the situation), do (what Scout should do next time, one or two sentences), avoid (what went wrong, or null), signature (key words from the error or his words), evidence (the ids given). ` +
  `Return JSON only: {"lessons":[{"scope":"...","title":"...","when":"...","do":"...","avoid":"... or null","signature":"...","evidence":["<ids>"]}],"unsolved":[{"scope":"...","problem":"one line"}]}. At most 6 lessons; zero is fine.`;
const REFLECT_KIND: Record<RChunk["kind"], string> = {
  jared: `This batch is JARED'S OWN MESSAGES to Scout (each with what Scout had just said). Learn from Jared, not from errors: a correction ("no", "wrong", "I said", "again", "you should not have"), a repeated ask, a stated preference or rule, or friction (he had to type Keep going or ask for paid AI again and again) each become a lesson with scope jared:<topic> (for example jared:replies, jared:code-changes, jared:paid-ai, jared:ui, jared:turo). do = what Scout does differently next time, in his terms. Only when his own words show it; put his short quote in "when". Never turn a one-time task request into a lesson.`,
  failures: `This batch is Scout's TOOL CALLS grouped by chat thread (steps in order, ok true/false). Find lessons where something failed and then something else worked, or the same mistake repeats and the fix is clear from the data (a table's real columns, a tool's argument, a path). Also list UNSOLVED problems: failures that repeat with no fix yet.`,
  ops: `This batch is failed Mac mini jobs and monitor incidents. Find lessons where the cause and the fix are both visible. List UNSOLVED ones that repeat with no fix.`,
};

type Attempt = { name: string; skip: string[]; deadline: number; paid: "never" | "first"; wait: number };
const ATTEMPTS: Attempt[] = [
  { name: "freellm>groq>cloudflare", skip: [], deadline: 38_000, paid: "never", wait: 0 },
  { name: "groq>cloudflare", skip: ["freellm"], deadline: 32_000, paid: "never", wait: 6_000 },
  { name: "cloudflare", skip: ["freellm", "groq"], deadline: 32_000, paid: "never", wait: 15_000 },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One chunk through the ladder with retries; paid last (still behind the Paid AI switch). Returns the model JSON or throws. */
async function reflectChunk(c: RChunk, known: { scope: string; title: string }[], allowPaid: boolean, deadline: number): Promise<{ json: any; via: string }> {
  const scopesLC = c.scopes.toLowerCase();
  const mine = known.filter((k) => k.scope.startsWith("jared:") ? c.kind === "jared" : scopesLC.includes(k.scope.replace(/^[a-z]+:/, "").toLowerCase())).slice(0, 20).map((k) => `${k.scope}|${k.title}`).join("\n").slice(0, 1500);
  const system = `${REFLECT_BASE}\n\n${REFLECT_KIND[c.kind]}${mine ? `\n\nLessons that already exist (to update one, reuse its exact scope and title):\n${mine}` : ""}`;
  let last = "";
  const plan: Attempt[] = [...ATTEMPTS, ...(allowPaid ? [{ name: "paid", skip: [], deadline: 45_000, paid: "first" as const, wait: 2_000 }] : [])];
  for (const at of plan) {
    if (Date.now() + 8_000 > deadline) throw new Error(`out of time (${last || "not tried"})`);
    if (at.wait) await sleep(Math.min(at.wait, Math.max(0, deadline - Date.now() - 8_000)));
    try {
      const r = await llm({
        task: "reflect", system, user: c.text, json: true, job: "reflect", ref: c.id, fn: "scout-daily", scope: "background",
        paid: at.paid, paidModel: "claude-haiku-4-5", maxTokens: 1400, deadlineMs: Math.min(at.deadline, deadline - Date.now()),
        validate: SHAPE.reflect, skip: at.skip as any,
      });
      return { json: r.json, via: `${at.name}:${r.provider}` };
    } catch (e) {
      last = e instanceof LlmUnavailable ? `${at.name}: ${e.reason} (${e.tried.map((t) => `${t.provider} ${t.outcome}`).join(", ")})` : `${at.name}: ${(e as Error).message}`;
    }
  }
  throw new Error(last);
}

async function saveLessons(lessons: any[], source: string): Promise<number> {
  let learned = 0;
  for (const l of (lessons ?? []).slice(0, 8)) {
    if (!l?.scope || !l?.title || !l?.when || !l?.do) continue;
    const scope = String(l.scope).toLowerCase().slice(0, 60), title = String(l.title).slice(0, 90);
    const { data: prev } = await db.from("scout_lessons").select("id, evidence").eq("scope", scope).eq("title", title).maybeSingle();
    const evidence = [...new Set([...(((prev as any)?.evidence) ?? []), ...((l.evidence ?? []) as string[])])].slice(-20);
    const row = { scope, title, when_text: String(l.when).slice(0, 400), do_text: String(l.do).slice(0, 800), avoid_text: l.avoid ? String(l.avoid).slice(0, 400) : null,
      signature: String(l.signature ?? "").toLowerCase().slice(0, 200), evidence, updated_at: new Date().toISOString() };
    const { error } = prev ? await db.from("scout_lessons").update(row).eq("id", (prev as any).id)
      : await db.from("scout_lessons").insert({ ...row, source });
    if (!error) learned++;
  }
  return learned;
}

type ReflectState = { since?: string; done?: string[]; fails?: Record<string, number>; learned?: number; unsolved?: string[]; attempts?: number; via?: string[] };
type ReflectOpts = { days?: number; dry?: boolean; allowPaid?: boolean; state?: ReflectState };

async function reflect(opts: ReflectOpts = {}) {
  const t0 = Date.now(), deadline = t0 + REFLECT_BUDGET_MS;
  const st: ReflectState = { ...(opts.state ?? {}) };
  const since = st.since ?? new Date(Date.now() - (opts.days ?? 1) * 864e5).toISOString();
  st.since = since;
  const done = new Set(st.done ?? []), fails = { ...(st.fails ?? {}) };
  const [{ chunks: jc, stats }, { chunks: fc, counts }, { data: known }] = await Promise.all([
    jaredChunks(since), failureChunks(since),
    db.from("scout_lessons").select("scope, title").eq("active", true).limit(300),
  ]);
  const all = [...jc, ...fc];   // Jared first
  let learned = st.learned ?? 0, ranChunks = 0;
  const unsolved = new Set(st.unsolved ?? []), via: string[] = [], proposed: any[] = [];
  const failed: string[] = [], skipped: string[] = [];
  for (const c of all) {
    if (done.has(c.id)) continue;
    if ((fails[c.id] ?? 0) >= 3) { skipped.push(c.id); continue; }   // a chunk that failed on three separate runs is set aside, not retried forever
    if (Date.now() + 10_000 > deadline) break;
    try {
      const r = await reflectChunk(c, (known ?? []) as any[], opts.allowPaid !== false, deadline);
      via.push(r.via);
      if (opts.dry) proposed.push(...(r.json.lessons ?? []).map((l: any) => ({ ...l, from: c.kind })));
      else learned += await saveLessons(r.json.lessons ?? [], c.kind === "jared" ? "reflect:jared" : "reflect");
      for (const u of (r.json.unsolved ?? []).slice(0, 4)) if (u?.problem) unsolved.add(String(u.problem).slice(0, 160));
      done.add(c.id); ranChunks++;
    } catch (e) {
      fails[c.id] = (fails[c.id] ?? 0) + 1;
      failed.push(`${c.kind} ${c.id}: ${(e as Error).message}`.slice(0, 300));
    }
  }
  const remaining = all.filter((c) => !done.has(c.id) && (fails[c.id] ?? 0) < 3).length;
  const finished = remaining === 0;
  const out: Record<string, unknown> = {
    ok: finished, learned, unsolved: unsolved.size, chunks: { total: all.length, done: done.size, ran_now: ranChunks, failed_now: failed.length, set_aside: skipped.length },
    jared: stats, looked_at: counts, via, ms: Date.now() - t0,
    ...(failed.length ? { failed } : {}), ...(opts.dry ? { dry_run: true, proposed } : {}),
    partial: finished ? undefined : { since, done: [...done], fails, learned, unsolved: [...unsolved].slice(0, 8) },
  };
  if (!opts.dry) {
    if (finished) {
      await mirrorPlaybook();
      const u = [...unsolved].slice(0, 5);
      if (learned || u.length) {
        await db.rpc("scout_notify", {
          p_title: learned ? `Scout learned ${learned} thing${learned === 1 ? "" : "s"} overnight` : "Scout found something it can't fix yet",
          p_body: [u.length ? `Still stuck on: ${u.join("; ")}` : "", "See /admin/playbook."].filter(Boolean).join(" ").slice(0, 500),
          p_severity: u.length ? "warning" : "info", p_push: false, p_url: "/admin/playbook", p_dedupe: `scout.reflect.${la().day}`,
        });
      }
    }
    await reflectBeat(finished, finished
      ? `Learned ${learned} from ${all.length} batches (${stats.jared_messages} of Jared's messages, ${stats.corrections} corrections)`
      : `Partial: ${done.size} of ${all.length} batches done; ${failed[0] ?? "out of time"}`);
  }
  return out;
}

/** The nightly job: claim the day, resume where an earlier attempt stopped, record every attempt. */
async function reflectJob(day: string, force: boolean) {
  const { data: row } = await db.from("scout_daily_runs").select("ran_at, result").eq("day", day).eq("job", "reflect").maybeSingle();
  const prev = ((row as any)?.result ?? {}) as Record<string, any>;
  if (!force && row) {
    if (prev.ok === true || (prev.ok === undefined && prev.learned !== undefined && !prev.error)) return { skipped: "already finished today" };   // old rows had no ok flag
    if ((prev.attempts ?? 1) >= REFLECT_MAX_ATTEMPTS) return { skipped: `gave up after ${REFLECT_MAX_ATTEMPTS} attempts today` };
    if (prev.running === true && Date.now() - Date.parse((row as any).ran_at) < 10 * 60_000) return { skipped: "an attempt is running" };
  }
  const attempts = (row && !force ? Number(prev.attempts ?? 1) : 0) + 1;
  await db.from("scout_daily_runs").upsert({ day, job: "reflect", ran_at: new Date().toISOString(), result: { ...prev, running: true, attempts, ok: false } });
  try {
    const res = await reflect({ days: 1, state: (prev.partial ?? undefined) as ReflectState | undefined });
    await finishRun(day, "reflect", { ...res, attempts, running: false });
    return res;
  } catch (e) {
    const err = { ok: false, error: (e as Error).message, attempts, running: false, partial: prev.partial };
    await finishRun(day, "reflect", err);
    await reflectBeat(false, `Reflect crashed: ${(e as Error).message}`);
    return err;
  }
}

/** The playbook every Claude session can read: bestly_memory lessons/scout-playbook. */
async function mirrorPlaybook() {
  const { data } = await db.from("scout_lessons").select("scope, title, when_text, do_text, avoid_text, wins, losses")
    .eq("active", true).order("scope").limit(80);
  if (!data?.length) return;
  const body = "What Scout has learned (auto-written nightly from what failed and what fixed it; source table scout_lessons, managed at /admin/playbook).\n\n" +
    (data as any[]).map((l) => `[${l.scope}] ${l.title}\n  When: ${l.when_text}\n  Do: ${l.do_text}${l.avoid_text ? `\n  Avoid: ${l.avoid_text}` : ""}${l.wins || l.losses ? `\n  Record: ${l.wins} worked, ${l.losses} didn't` : ""}`).join("\n\n");
  await db.from("bestly_memory").upsert({
    area: "lessons", key: "scout-playbook", title: "Scout's playbook: lessons from what failed and what worked", kind: "convention",
    body: body.slice(0, 20000), tags: ["scout", "lessons", "self-healing"], source: "scout-daily reflect", written_by: "Spark", pinned: true, active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "area,key" });
}

/* ───────── entry ───────── */

// The cron sends the service key from the vault; it may not be byte-identical to this
// function's env copy, so a key that can use the admin API counts as the service key too.
async function isService(jwt: string) {
  if (__svc.has(jwt)) return true;
  if (!jwt || jwt.split(".").length !== 3) return false;
  try {
    const role = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role;
    if (role !== "service_role") return false;
    const probe = createClient(Deno.env.get("SUPABASE_URL")!, jwt, { auth: { persistSession: false } });
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

async function job(name: string, day: string, force: boolean) {
  if (!(await claimRun(day, name, force))) return { skipped: "already ran today" };
  try {
    const res = name === "morning" ? await morning(day) : name === "drafts" ? await drafts(day) : await wrap(day);
    await finishRun(day, name, res);
    return res;
  } catch (e) {
    const err = { error: (e as Error).message };
    await finishRun(day, name, err);
    if (name === "morning") await db.rpc("scout_digest"); // the old digest still goes out
    return err;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const service = isSvc(req) || await isService(jwt);
  if (!service && !(jwt && (await isAdmin(jwt)))) return J({ ok: false, error: "unauthorized" }, 401);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const { day, hour } = la();

  try {
    switch (body.op) {
      case "tick": {
        const ran: Record<string, unknown> = {};
        if (hour >= 6 && hour < 9) ran.drafts = await job("drafts", day, false);
        if (hour >= 9 && hour < 12) ran.morning = await job("morning", day, false);
        if (hour >= 18 && hour < 21) ran.wrap = await job("wrap", day, false);
        return J({ ok: true, hour, ran });
      }
      case "run": {
        const name = String(body.job);
        if (!["morning", "drafts", "wrap"].includes(name)) return J({ ok: false, error: "job must be morning, drafts or wrap" }, 400);
        return J({ ok: true, [name]: await job(name, day, !!body.force) });
      }
      case "call":
        return J(await call(String(body.id), !!body.force));
      case "tick_reflect":
        // v18: from 2 AM on, every hour, until today's reflect has finished (a night that failed is retried, not skipped).
        return J({ ok: true, hour, ran: hour >= 2 ? await reflectJob(day, false) : null });
      case "reflect_job":
        return J({ ok: true, reflect: await reflectJob(day, !!body.force) });
      case "reflect":   // direct run, nothing claimed. body.dry = true proposes lessons without saving; body.paid = true allows the paid rung.
        return J({ ok: true, reflect: await reflect({ days: Math.min(30, Math.max(1, Number(body.days) || 1)), dry: !!body.dry, allowPaid: body.paid === true }) });
      case "todo_owner": {
        const { data: t } = await db.from("scout_daily").select("id, title, action").eq("id", String(body.id)).maybeSingle();
        const cardId = Number((t as any)?.action?.deck_card);
        if (!t || !cardId) return J({ ok: false, error: "no to-do with a Deck card" });
        const d = await deck();
        const ok = await d.renameCard(cardId, `${(t as any).action.owner}: ${(t as any).title}`);
        return J({ ok, card: cardId });
      }
      case "deck_check": {
        const d = await deck();
        return J({ ok: true, board: d.board.title, list: d.stack.title });
      }
      default:
        return J({ ok: false, error: "unknown op" }, 400);
    }
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 200);
  }
});
