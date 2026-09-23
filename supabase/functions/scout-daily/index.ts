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
//   op reflect  {days} learn from the last day(s): what failed, what fixed it -> scout_lessons
//               (+ mirrored to bestly_memory lessons/scout-playbook). Nightly at 2am LA via tick_reflect.
//
// Called by pg_cron / a trigger with the service key, or by an admin from the browser.
// Nothing here sends anything to anyone: drafts wait for Jared's tap in his own mail app.

import { createClient } from "jsr:@supabase/supabase-js@2";

// v4: background jobs run on the cheapest Claude model, are logged in ai_spend and stop at the daily
// background cap (scout_settings.background_cap_usd). They used to run on Sonnet with no check at all.
const MODEL = Deno.env.get("SCOUT_DAILY_MODEL") ?? "claude-haiku-4-5";
const PRICE: Record<string, [number, number]> = { haiku: [1, 5], sonnet: [3, 15], opus: [15, 75] }; // $ per million in/out
const priceOf = (m: string) => PRICE[Object.keys(PRICE).find((k) => m.includes(k)) ?? "sonnet"];
const TZ = "America/Los_Angeles";
const DECK_BOARD = "Bestly Ops";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-proxy-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
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

async function claude(system: string, user: string, maxTokens = 3000, job = "background", ref: string | null = null): Promise<any> {
  const key = cleanKey(Deno.env.get("ANTHROPIC_API_KEY"));
  if (!key) throw new Error("no ANTHROPIC_API_KEY");
  const { data: budget } = await db.rpc("ai_budget", { p_scope: "background" });
  if ((budget as any)?.ok === false) throw new Error(`daily background AI cap reached ($${(budget as any).spent} of $${(budget as any).cap})`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(100_000),
    });
    if (r.ok) {
      const j = await r.json();
      const [pin, pout] = priceOf(String(j.model ?? MODEL));
      const inT = Number(j.usage?.input_tokens ?? 0) + Number(j.usage?.cache_creation_input_tokens ?? 0) + Number(j.usage?.cache_read_input_tokens ?? 0);
      const outT = Number(j.usage?.output_tokens ?? 0);
      await db.from("ai_spend").insert({ fn: "scout-daily", scope: "background", job, model: String(j.model ?? MODEL), input_tokens: inT, output_tokens: outT, cost_usd: (inT * pin + outT * pout) / 1e6, ref });
      const text = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
      const s = text.indexOf("{"), e = text.lastIndexOf("}");
      if (s < 0 || e < s) throw new Error("model did not return JSON");
      return JSON.parse(text.slice(s, e + 1));
    }
    if ((r.status === 429 || r.status >= 500) && attempt === 0) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
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

const NOISE = /(no-?reply|donotreply|notifications?@|mailer|newsletter|news@|updates?@|marketing|info@.*(shop|store)|bounce|support@(apple|google|github)|@(github|vercel|stripe|supabase|google|apple|amazon|linkedin|facebook|instagram|x|twitter|turo|uber|lyft|doordash|paypal|venmo|chase|wellsfargo|bankofamerica)\.com)/i;

async function drafts(day: string) {
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const { data: mail } = await db.from("bestly_mail").select("id, mailbox, from_addr, from_name, subject, sent_at, body_text, message_id, to_addrs")
    .eq("folder", "INBOX").gte("sent_at", since).order("sent_at", { ascending: false }).limit(150);
  const { data: done } = await db.from("scout_daily").select("source_key").eq("kind", "draft").gte("day", addDays(day, -14));
  const seen = new Set((done ?? []).map((d: any) => d.source_key));
  const cands = (mail ?? []).filter((m: any) =>
    m.from_addr && !NOISE.test(m.from_addr) && !/jared(best)?@|@bestly\.tech$/i.test(m.from_addr) && !seen.has(`mail:${m.id}`) &&
    !/unsubscribe/i.test(String(m.body_text ?? "").slice(-1500))).slice(0, 40);
  if (!cands.length) return { drafted: 0, looked_at: 0 };

  const out = await claude(
    `${VOICE}\nYou are Scout. From these emails, choose the ones where a real person is waiting on a reply from Jared (at most 5; zero is fine). ` +
    `Skip receipts, automated mail, marketing and anything that needs no answer. For each, write the reply he would send: short, specific to what they asked, ` +
    `no invented facts, dates or promises (use [brackets] for anything he must fill in). Return JSON only: {"drafts":[{"mail_id":"...","why":"one line: what they need","reply":"..."}]}.`,
    JSON.stringify(cands.map((m: any) => ({ mail_id: m.id, from: `${m.from_name ?? ""} <${m.from_addr}>`, to: m.mailbox, subject: m.subject, sent: m.sent_at, body: String(m.body_text ?? "").slice(0, 1800) }))),
    4000, "drafts",
  );
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
      `Return JSON only: {"summary":"2 sentences","decisions":["..."],"commitments":[{"owner":"Jared|<first name>","task":"imperative, under 90 characters","due":"YYYY-MM-DD or null"}],"questions":["..."]}. ` +
      `Only what was actually agreed. A due date only if one was said (today is ${la().day}; resolve "Friday" etc. to a date). No duplicates. ` +
      `Owner = the person who will DO it, worked out from what is said ("I'll send it" -> the speaker; "can you..." -> the person asked; "Jared will..." -> Jared). ` +
      `Speaker labels can be wrong, especially on one-mic recordings (the header says so): trust what the words say over the label. When it's unclear who will do it, the owner is Jared.`,
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
      action: { owner, due, meeting: r.name, meeting_id: r.id, deck_card: card?.id ?? null, deck_url: card?.url ?? null },
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

async function reflect(days = 1) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const [{ data: acts }, { data: jobs }, { data: inc }, { data: known }] = await Promise.all([
    db.from("admin_chat_actions").select("id, thread_id, tool, args, result, ok, created_at").gte("created_at", since).order("created_at").limit(400),
    db.from("mac_jobs").select("id, thread_id, title, status, exit_code, script, output, created_at").gte("created_at", since).in("status", ["done", "failed"]).limit(60),
    db.from("monitor_issues").select("key, title, body, status, self_healed, heal_attempts, resolved_at").gte("updated_at", since).limit(60),
    db.from("scout_lessons").select("scope, title, do_text").eq("active", true).limit(200),
  ]);
  const trim = (v: unknown, n: number) => { const t = typeof v === "string" ? v : JSON.stringify(v ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; };
  const a = (acts ?? []).map((x: any) => ({ id: x.id, thread: String(x.thread_id).slice(0, 8), tool: x.tool, ok: x.ok, at: x.created_at.slice(5, 16),
    args: trim(x.tool === "commit_files" ? { message: x.args?.message, paths: (x.args?.files ?? x.args?.edits ?? []).map((f: any) => f.path) } : x.args, 300),
    result: x.ok ? trim(x.result, 120) : trim(x.result, 400) }));
  const failures = a.filter((x) => !x.ok).length + (jobs ?? []).filter((j: any) => j.status === "failed").length;
  if (!failures && !(inc ?? []).length) return { learned: 0, note: "nothing failed" };

  const out = await claude(
    `You are Scout's reflection step. Scout is the assistant in Jared's admin (tools: run_sql, db_write, read_file, list_files, commit_files, mac_run, pi_command, recorder, ...). ` +
    `Below is what Scout did recently: its tool calls in order (grouped by thread), Mac mini jobs, and monitor incidents. ` +
    `Find LESSONS: something failed and then something else worked (same thread or same kind of task), or the same mistake repeats and the fix is clear from the data. ` +
    `A lesson must be specific and reusable: e.g. scope "table:cloud_leads", when "reading cloud leads", do "the columns are contact_name, company_name, status (there is no name column)". ` +
    `Scopes: tool:<name>, table:<name>, project:<name>, mac, pi, deploy, recorder. Never invent a fix that the data doesn't show. Skip one-off noise. ` +
    `Also list UNSOLVED problems: failures that repeat with no fix yet. Existing lessons (update one by reusing its exact scope+title): ${JSON.stringify(known ?? [])}. ` +
    `Return JSON only: {"lessons":[{"scope":"...","title":"<60 chars","when":"...","do":"...","avoid":"... or null","signature":"key words from the error","evidence":["<action or job ids>"]}],"unsolved":[{"scope":"...","problem":"one line"}]}. At most 12 lessons.`,
    JSON.stringify({ actions: a, jobs: (jobs ?? []).map((j: any) => ({ id: j.id, title: j.title, status: j.status, exit: j.exit_code, script: trim(j.script, 500), output_tail: trim(String(j.output ?? "").slice(-500), 500) })),
      incidents: (inc ?? []).map((i: any) => ({ key: i.key, title: i.title, status: i.status, healed: i.self_healed, tries: i.heal_attempts, body: trim(i.body, 300) })) }),
    4000, "reflect",
  );

  let learned = 0;
  for (const l of (out.lessons ?? []).slice(0, 12)) {
    if (!l?.scope || !l?.title || !l?.when || !l?.do) continue;
    const scope = String(l.scope).toLowerCase().slice(0, 60), title = String(l.title).slice(0, 90);
    const { data: prev } = await db.from("scout_lessons").select("id, evidence").eq("scope", scope).eq("title", title).maybeSingle();
    const evidence = [...new Set([...(((prev as any)?.evidence) ?? []), ...((l.evidence ?? []) as string[])])].slice(-20);
    const row = { scope, title, when_text: String(l.when).slice(0, 400), do_text: String(l.do).slice(0, 800), avoid_text: l.avoid ? String(l.avoid).slice(0, 400) : null,
      signature: String(l.signature ?? "").toLowerCase().slice(0, 200), evidence, updated_at: new Date().toISOString() };
    const { error } = prev ? await db.from("scout_lessons").update(row).eq("id", (prev as any).id)
      : await db.from("scout_lessons").insert({ ...row, source: "reflect" });
    if (!error) learned++;
  }
  await mirrorPlaybook();
  const unsolved = (out.unsolved ?? []).slice(0, 5);
  if (learned || unsolved.length) {
    await db.rpc("scout_notify", {
      p_title: learned ? `Scout learned ${learned} thing${learned === 1 ? "" : "s"} overnight` : "Scout found something it can't fix yet",
      p_body: [unsolved.length ? `Still stuck on: ${unsolved.map((u: any) => u.problem).join("; ")}` : "", "See /admin/playbook."].filter(Boolean).join(" ").slice(0, 500),
      p_severity: unsolved.length ? "warning" : "info", p_push: false, p_url: "/admin/playbook", p_dedupe: `scout.reflect.${la().day}`,
    });
  }
  return { learned, unsolved: unsolved.length, looked_at: { actions: a.length, jobs: (jobs ?? []).length, incidents: (inc ?? []).length } };
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
  if (jwt === SERVICE) return true;
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
    const res = name === "morning" ? await morning(day) : name === "drafts" ? await drafts(day) : name === "reflect" ? await reflect(1) : await wrap(day);
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
  const service = await isService(jwt);
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
        return J({ ok: true, hour, ran: hour === 2 ? await job("reflect", day, false) : null });
      case "reflect":
        return J({ ok: true, reflect: await reflect(Math.min(30, Math.max(1, Number(body.days) || 1))) });
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
