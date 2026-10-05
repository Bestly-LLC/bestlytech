// claims-closer — Bestly's damage-claim negotiator (team slug claims-closer). Migration 20261005040000_claims_closer.sql.
//
// Sees a Turo damage claim through to payment. Cases open on their own from Turo's claim mail (Scout's mail pipe ->
// claims_mail_trg). Guest replies arrive through the Pi Turo reader (turo_inbox -> claims_inbox_trg).
//
//   op tick    cron via claims_tick() when a case needs work: drafts the next guest message with FREE AI only
//              (paid: never), pushes it to Jared for one-tap approve/edit at /admin/claims.
//   op daily   9 AM Los Angeles: deadline check (estimate due, 20-day escalation cutoff, unpaid invoices) + tick.
//   op run     admin button: same as tick.
//   op preview {reservation, kind, extra?} write a draft, save and send nothing (testing).
//
// Hard rules (the reason this exists without a human in the loop for drafting):
//   - Nothing reaches a guest without Jared's yes. This function only writes claim_drafts rows (status pending).
//     Approved rows go out through the Link Sender (turo_sender_claim, claims-only mode).
//   - Reviews: may say Jared will leave an honest review of how the trip and car were handled; never ties the review
//     to payment, insurance or the claim (Turo can treat that as leverage and it hurts the claim). Enforced by
//     reviewGuard() after the model writes, not just by the prompt.
//   - No made-up money: every dollar amount in a draft must be one the case actually has (estimate, plan max, invoices).
//   - Every run checks in with Team Watch: agent_beat('claims-closer', ok, summary).
//
// Auth: service key (cron/invoke_edge_function) or an admin JWT. verify_jwt = false.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm, LlmUnavailable } from "../_shared/free-llm.ts";
import { corsWith } from "../_shared/cors.ts";

const SECRETS: string[] = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const SECRET = SECRETS[0];
const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRET, { auth: { persistSession: false }, global: { headers: { apikey: SECRET } } });
const CORS = corsWith({ headers: "authorization, content-type, apikey, x-client-info", methods: "POST, OPTIONS" });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const SLUG = "claims-closer";
const TZ = "America/Los_Angeles";

async function authorized(req: Request) {
  const apikey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (SECRETS.includes(apikey) || SECRETS.includes(bearer)) return true;
  if (!bearer || bearer.split(".").length !== 3) return false;
  const { data } = await db.auth.getUser(bearer);
  if (!data?.user) return false;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return !!ok;
}

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : null;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

// "October 06 at 11:55 AM" (Turo's wording, Los Angeles time) -> epoch ms, this year (next year if that is far past).
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
export function laTime(text: string, nowMs = Date.now()): number | null {
  const m = /^([A-Za-z]+) (\d{1,2}) at (\d{1,2}):(\d{2}) ?([AP]M)$/i.exec(text.trim());
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].toLowerCase());
  if (mon < 0) return null;
  let h = Number(m[3]) % 12; if (m[5].toUpperCase() === "PM") h += 12;
  const year = Number(new Date(nowMs).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 4));
  const at = (y: number) => {
    const guess = Date.UTC(y, mon, Number(m[2]), h, Number(m[4]));
    const shown = new Date(new Date(guess).toLocaleString("en-US", { timeZone: TZ })).getTime();
    const asUtc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
    return guess + (asUtc - shown);   // shift by the LA offset on that date
  };
  const t = at(year);
  return t < nowMs - 200 * 864e5 ? at(year + 1) : t;
}

type Case = Record<string, any>;
type Msg = { message_id: string; sent_at: string; role: string; author: string | null; body: string | null };
type Draft = Record<string, any>;

// ---------------------------------------------------------------- guards
const LEVERAGE = /\b(if|unless|as long as|provided|depend\w*|in exchange|otherwise|so that|avoid|instead of|in return|pay\w*|insur\w*|claim\w*|invoice\w*|settle\w*|resolv\w*|cooperat\w*|handle[sd]? this|reflect\w*|affect\w*|impact\w*|consequen\w*|future rentals?|ability to rent)\b/i;
export function reviewGuard(text: string): { ok: boolean; cleaned: string } {
  const sentences = text.split(/(?<=[.!?])\s+/);
  let ok = true;
  const kept = sentences.filter((s) => {
    if (!/\b(review|rating|rate you|stars?)\b/i.test(s)) return true;
    if (LEVERAGE.test(s)) { ok = false; return false; }
    return true;
  });
  return { ok, cleaned: kept.join(" ").trim() };
}

function moneyGuard(text: string, allowed: number[]): boolean {
  for (const m of text.matchAll(/\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g)) {
    const v = Number(m[1].replace(/,/g, ""));
    if (!allowed.some((a) => Math.abs(a - v) < 0.01)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- drafting
const SYSTEM = `You write short Turo messages for Jared, a Turo host, to a guest who damaged his car. You write AS Jared, first person.
Goal, in order: (1) the guest runs the repair through their personal auto insurance so the full repair is paid; (2) if they won't,
they pay their Turo protection plan's out-of-pocket max through the Turo app; (3) Turo's claims team steps in if they stall.
Voice: calm, direct, friendly but firm, plain words, 2 to 5 short sentences, no emoji, no greetings longer than "Hi <name>,".
Facts only from the CASE data. Never invent amounts, dates, damage, promises, legal threats or Turo policy.
Insurance: ask for their insurer's name and policy number; Jared will handle the rest with the estimate. Adjusters can see clause 2.6 of the Turo car sharing agreement.
Reviews: you MAY say once that Jared will leave an honest review of how the trip and the car were handled. NEVER link the review to paying,
insurance, the claim, cooperating or how this gets resolved, and never hint the review could change. If in doubt, leave reviews out.
Never mention AI, drafts, automation or that someone else is writing. Never ask the guest to message outside Turo.
Reply ONLY with JSON: {"message": "<the message>", "reason": "<one line for Jared: why this message now>"}`;

async function draft(kind: string, c: Case, trip: any, thread: Msg[], extra: string): Promise<{ message: string; reason: string } | null> {
  const allowed = [Number(c.guest_max ?? 500), ...(c.estimate_amount ? [Number(c.estimate_amount)] : []),
    ...((c.invoices ?? []) as any[]).map((i) => Number(i.amount)).filter((n) => !Number.isNaN(n))];
  const caseData = {
    guest_first_name: c.guest_first, reservation: c.reservation_id,
    trip: trip ? { start: fmt(trip.starts_at), end: fmt(trip.ends_at), car: "2020 Tesla Model 3" } : null,
    path: c.path, status: c.status, goal: c.goal, facts: c.facts,
    estimate: c.estimate_amount ? money(Number(c.estimate_amount)) : "not yet (body shop estimate coming)",
    guest_plan_max: money(Number(c.guest_max ?? 500)),
    insurer_on_file: c.insurer && Object.keys(c.insurer).length ? c.insurer : null,
    open_invoices: c.invoices, escalate_cutoff: fmt(c.escalate_by),
  };
  const convo = thread.slice(-14).map((m) => `${m.role === "GUEST" ? (m.author ?? "Guest") : "Jared"} (${fmt(m.sent_at)}): ${(m.body ?? "").slice(0, 700)}`).join("\n");
  const task = {
    follow_up: "The guest has not replied. Write a polite, short follow-up that asks for their auto insurance details (insurer name + policy number) so it can go through insurance. If insurance was already asked, gently restate it and mention the alternative of paying through the Turo app.",
    insurance_ask: "Ask the guest whether they have personal auto insurance and, if so, for their insurer's name and policy number so Jared can run the repair through it.",
    reply: "Reply to the guest's latest message. Answer what they said using only the CASE facts, then move toward the goal (insurance details, or paying through the Turo app). If they share insurance details, thank them and say Jared will open the claim with the estimate. If they dispute fault, stay calm: the pre-trip photos show the corner was undamaged at handoff and the damage was found at check-in.",
    estimate: "Share the body shop estimate amount with the guest and ask how they want to handle it: through their auto insurance (preferred, send insurer + policy number), or by paying their Turo plan's maximum through the Turo app invoice.",
  }[kind] ?? "Write the next helpful message toward the goal.";
  const user = `CASE: ${JSON.stringify(caseData)}\n\nCONVERSATION (oldest first):\n${convo || "(none)"}\n\nTASK: ${task}${extra ? `\nNOTE: ${extra}` : ""}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try {
      r = await llm({ task: "write", system: SYSTEM + (attempt ? "\nYour last draft broke the review or money rule. Leave reviews and any unlisted dollar amounts out entirely." : ""),
        user, json: true, job: SLUG, ref: String(c.reservation_id), fn: SLUG, paid: "never", privacy: "private", deadlineMs: 45_000, maxTokens: 500,
        validate: (j) => typeof j?.message === "string" && j.message.trim().length >= 20 && j.message.length <= 900 ? null : "message missing or wrong length" });
    } catch (e) {
      if (e instanceof LlmUnavailable) return null;
      throw e;
    }
    let msg = String(r.json.message).trim();
    const g = reviewGuard(msg);
    if (!g.ok) { if (attempt === 0) continue; msg = g.cleaned; }
    if (!moneyGuard(msg, allowed)) { if (attempt === 0) continue; return null; }
    if (msg.length < 20) return null;
    return { message: msg, reason: String(r.json.reason ?? "").slice(0, 240) };
  }
  return null;
}

// Plain fallback when every free model is down (follow-ups only; replies need judgment, so Jared gets pinged instead).
function fallbackFollowUp(c: Case) {
  const n = c.guest_first ? ` ${c.guest_first}` : "";
  return `Hi${n}, following up on the bumper damage from your trip. Do you have personal auto insurance? If so, send me your insurer's name and policy number and I'll handle the claim with the body shop estimate. Otherwise we can settle it through the Turo app.`;
}

// ---------------------------------------------------------------- one case
// Signed by Claims Closer (Jared's rule: the employee responsible sends its own alerts). Title gets the "Claims Closer: " prefix.
async function notify(title: string, body: string, dedupe: string, severity = "info") {
  await db.rpc("claims_notify", { p_title: title.replace(/^Claims: /, ""), p_body: body, p_severity: severity, p_dedupe: dedupe });
}

async function event(c: Case, kind: string, title: string, detail: unknown = null) {
  await db.from("claim_events").insert({ case_id: c.id, reservation_id: c.reservation_id, kind, title, detail });
}

async function work(c: Case, daily: boolean): Promise<string> {
  const [{ data: trip }, { data: inbox }, { data: drafts }] = await Promise.all([
    db.from("turo_trips").select("*").eq("reservation_id", c.reservation_id).maybeSingle(),
    db.from("turo_inbox").select("message_id, sent_at, role, author, body").eq("reservation_id", c.reservation_id).order("sent_at", { ascending: true }).limit(60),
    db.from("claim_drafts").select("*").eq("case_id", c.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const thread = (inbox ?? []) as Msg[];
  const all = (drafts ?? []) as Draft[];
  const pending = all.find((d) => d.status === "pending" && d.kind !== "escalation");
  const inFlight = all.find((d) => ["approved", "sending"].includes(d.status));
  const lastGuest = [...thread].reverse().find((m) => m.role === "GUEST");
  const lastHost = [...thread].reverse().find((m) => m.role === "HOST");
  const notes: string[] = [];
  const now = Date.now();

  // ---- daily deadline check (pushes to Jared, never to the guest)
  if (daily) {
    const day = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
    if (c.estimate_due_at && !c.estimate_amount) {
      const hrs = (new Date(c.estimate_due_at).getTime() - now) / 36e5;
      if (hrs < 36) {
        await notify(`Claims: estimate for ${c.guest_first ?? c.reservation_id} due ${fmt(c.estimate_due_at)}`,
          hrs > 0 ? "Turo wants a pro estimate shared with the guest within 3 days. Add the amount on the Claims page and I'll draft the message."
                  : "The 3-day estimate window has passed. Add the amount on the Claims page as soon as you have it.", `claims-est-${c.id}-${day}`, hrs > 0 ? "info" : "warning");
        notes.push("estimate reminder");
      }
    }
    if (c.escalate_by && !["paid", "closed", "escalated"].includes(c.status)) {
      const days = (new Date(c.escalate_by).getTime() - now) / 864e5;
      if (days < 4 && !all.some((d) => d.kind === "escalation")) {
        const body = `Escalation request for reservation ${c.reservation_id} (${c.guest_first ?? "guest"} ${c.guest_last ?? ""}). Resolve-directly started ${fmt(c.opened_at)}. `
          + `Damage found at check-in; pre-trip photos show the area undamaged at handoff. Estimate: ${c.estimate_amount ? money(Number(c.estimate_amount)) : "attached"}. `
          + `${lastGuest ? `Guest last replied ${fmt(lastGuest.sent_at)}.` : "Guest has not replied to messages."} Requesting Turo take over the claim.`;
        const { data: d } = await db.from("claim_drafts").insert({ case_id: c.id, reservation_id: c.reservation_id, kind: "escalation", body,
          reason: "For you to paste into Turo's Claims tab (Escalate). Not sent to the guest." }).select("id").single();
        await notify(`Claims: escalate ${c.guest_first ?? c.reservation_id} by ${fmt(c.escalate_by)}`,
          "Turo stops taking over this claim after the cutoff. Your escalation note is ready on the Claims page.", `claims-esc-${d?.id}`, "warning");
        notes.push("escalation note");
      }
    }
    for (const inv of (c.invoices ?? []) as any[]) {
      if (inv.paid || !inv.due_text) continue;
      const due = laTime(inv.due_text);
      if (due !== null && due < now) {
        await notify(`Claims: ${c.guest_first ?? "guest"}'s ${money(Number(inv.amount))} invoice is past due`,
          "No payment email from Turo yet. If it stays unpaid, escalate it from the Turo invoice page.", `claims-inv-${c.id}-${inv.mail_id}-${day}`, "warning");
        notes.push("invoice past due");
      }
    }
  }

  // ---- what to say next (one pending draft per case, nothing while a message is going out)
  let kind: string | null = null, extra = "", forMsg: string | null = null;
  const lastSentAt = Math.max(...all.filter((d) => d.status === "sent").map((d) => Date.parse(d.sent_at)), 0, lastHost ? Date.parse(lastHost.sent_at) : 0);
  if (!pending && !inFlight) {
    if (lastGuest && Date.parse(lastGuest.sent_at) > lastSentAt && !all.some((d) => d.for_message_id === lastGuest.message_id)) {
      kind = "reply"; forMsg = lastGuest.message_id;
    } else if (c.estimate_amount && !all.some((d) => d.kind === "estimate" && ["approved", "sending", "sent", "pending"].includes(d.status))) {
      kind = "estimate";
    } else if (c.follow_up_at && Date.parse(c.follow_up_at) <= now && (!lastGuest || Date.parse(lastGuest.sent_at) < lastSentAt)) {
      const sinceGuest = all.filter((d) => d.status === "sent" && d.kind === "follow_up" && (!lastGuest || Date.parse(d.sent_at) > Date.parse(lastGuest.sent_at))).length;
      if (sinceGuest >= 3) {
        await notify(`Claims: ${c.guest_first ?? "guest"} has ignored 3 follow-ups`, `Time to escalate to Turo (cutoff ${fmt(c.escalate_by)}).`, `claims-ghost-${c.id}`, "warning");
        await db.from("claim_cases").update({ follow_up_at: null }).eq("id", c.id);
        notes.push("guest ghosting; told Jared");
      } else {
        kind = "follow_up";
        extra = sinceGuest ? `This is follow-up number ${sinceGuest + 1}; keep it shorter than the last one.` : "";
      }
    }
  }

  if (kind) {
    let d = await draft(kind, c, trip, thread, extra);
    if (!d && kind === "follow_up") d = { message: fallbackFollowUp(c), reason: "Free AI was unavailable, so this is the standard follow-up." };
    if (!d) {
      if (kind === "reply") {
        await notify(`Claims: ${c.guest_first ?? "guest"} replied; I couldn't draft an answer`, (lastGuest?.body ?? "").slice(0, 200) + " Reply in Turo, or tap Redraft on the Claims page.", `claims-nodraft-${forMsg}`, "warning");
        notes.push("reply draft failed; pinged Jared");
      } else notes.push(`${kind} draft failed`);
    } else {
      const { data: row } = await db.from("claim_drafts").insert({ case_id: c.id, reservation_id: c.reservation_id, kind, body: d.message, reason: d.reason, for_message_id: forMsg })
        .select("id").single();
      await event(c, "draft", `Drafted a ${kind.replace("_", " ")} for Jared`, { draft_id: row?.id });
      await notify(`Claims: message to ${c.guest_first ?? "guest"} ready for your OK`, d.message.slice(0, 220), `claims-draft-${row?.id}`);
      await db.from("claim_drafts").update({ notified_at: new Date().toISOString() }).eq("id", row?.id);
      notes.push(`drafted ${kind}`);
      if (kind === "follow_up") await db.from("claim_cases").update({ follow_up_at: null }).eq("id", c.id);
    }
  }

  await db.from("claim_cases").update({ needs_work: false, work_reason: null, last_run_at: new Date().toISOString(),
    ...(daily ? { last_daily_at: new Date().toLocaleDateString("en-CA", { timeZone: TZ }) } : {}), updated_at: new Date().toISOString() }).eq("id", c.id);
  return `${c.guest_first ?? c.reservation_id}: ${notes.join(", ") || (pending ? "waiting on your OK" : inFlight ? "message going out" : "nothing new")}`;
}

// ---------------------------------------------------------------- entry
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!(await authorized(req))) return J({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const op = String(body.op ?? "tick");
  const daily = op === "daily";
  // op preview {reservation, kind}: write a draft but save and send nothing (testing the voice and the guards).
  if (op === "preview") {
    const { data: c } = await db.from("claim_cases").select("*").eq("reservation_id", Number(body.reservation)).maybeSingle();
    if (!c) return J({ error: "no case" }, 404);
    const [{ data: trip }, { data: inbox }] = await Promise.all([
      db.from("turo_trips").select("*").eq("reservation_id", c.reservation_id).maybeSingle(),
      db.from("turo_inbox").select("message_id, sent_at, role, author, body").eq("reservation_id", c.reservation_id).order("sent_at", { ascending: true }).limit(60)]);
    return J({ ok: true, draft: await draft(String(body.kind ?? "follow_up"), c, trip, (inbox ?? []) as Msg[], String(body.extra ?? "")) });
  }
  try {
    let q = db.from("claim_cases").select("*").not("status", "in", "(paid,closed)");
    const { data: cases, error } = await q;
    if (error) throw error;
    const due = (cases ?? []).filter((c: Case) => daily || op === "run" || c.needs_work || (c.follow_up_at && Date.parse(c.follow_up_at) <= Date.now()));
    const out: string[] = [];
    for (const c of due) {
      try { out.push(await work(c, daily)); }
      catch (e) {
        out.push(`${c.reservation_id}: error ${String(e).slice(0, 120)}`);
        await db.from("claim_cases").update({ last_run_at: new Date().toISOString() }).eq("id", c.id);
      }
    }
    const failed = out.some((s) => s.includes(": error "));
    const summary = (out.length ? out.join(" | ") : `${(cases ?? []).length} open claim(s), nothing new`).slice(0, 480);
    await db.rpc("agent_beat", { p_slug: SLUG, p_ok: !failed, p_summary: summary });
    return J({ ok: !failed, op, worked: out });
  } catch (e) {
    await db.rpc("agent_beat", { p_slug: SLUG, p_ok: false, p_summary: `run failed: ${String(e).slice(0, 200)}` });
    return J({ ok: false, error: String(e) }, 500);
  }
});
