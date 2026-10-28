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
// v2 (2026-10-06, docs/claims-closer-v2-opusplan.md): FULLY HANDS-OFF per Jared. Guest messages, shop estimate requests and the
// Turo invoice go out on their own (settings.autonomy = 'full'; 'guest_approval' brings back the old tap-to-send). Only booking the
// repair waits for Jared. The estimate pipeline lives in claims-estimates.ts (shops, Resend email with Jared's Bestly signature,
// reply parsing, Ava calls, choosing, the Turo invoice queue).
//
// Hard rules (the reason this can run without a human in the loop):
//   - RETURN GATE (2026-10-26, Jared): no message to a guest on any channel (Turo thread or Turo invoice message) until the Turo
//     reservation has ENDED and Jared tapped "Complete trip" on that trip's guest page (lax_guest_links.host_completed_at). Never a
//     reply during a live trip. While gated the case is opened and the message is drafted, then HELD (claim_drafts.status = 'held',
//     claim_cases.status = 'waiting_return'); when the gate opens claims_gate_sweep() wakes the case and the held draft goes out.
//     The gate is the SQL function claims_gate(case_id); a failed lookup counts as closed. The watchdog claims_guard_watch() backs it up.
//   - NO DOLLAR AMOUNTS, NO SPEAKING FOR TURO (Jared): never state or guess a deductible, plan cap, out-of-pocket max or any coverage
//     figure, never describe Turo's plans, policies, processes or payment options. The only dollar figure a guest message may carry is
//     the body shop estimate total. guest_max is null unless the guest states an amount; it is internal only and never repeated.
//   - NO REVIEWS: guest messages never mention reviews, ratings or stars. Enforced by reviewGuard() / planGuard() after the model
//     writes, not just by the prompt.
//   - Guest drafts pass reviewGuard + planGuard + moneyGuard first. In 'full' they are inserted already approved (when the gate is open)
//     and the Pi reader sends them (claims_send_claim); in 'guest_approval' they wait pending for Jared as in v1.
//   - Every run checks in with Team Watch: agent_beat('claims-closer', ok, summary).
//
// Auth: service key (cron/invoke_edge_function) or an admin JWT. verify_jwt = false.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm, LlmUnavailable } from "../_shared/free-llm.ts";
import { corsWith } from "../_shared/cors.ts";
import { estimatePipeline, previewParse, previewRequest, askShops, type Ctx } from "./estimates.ts";
import { answeredQuestions, bookingStep, thirdParties } from "./booking.ts";
import { moneyGuard, planGuard, reviewGuard } from "./guards.ts";
import { laTime } from "./time.ts";
import { autoBookStep, deadlineStep, loadAutonomy, teslaStep } from "./engine.ts";
import { insurerStep, outsideClaimsStep } from "./insurer.ts";

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

const ctx: Ctx = { db, llm, LlmUnavailable, notify: (t, b, d, s) => notify(t, b, d, s), event: (c, k, t, d) => event(c, k, t, d), fmt, money,
  supabaseUrl: Deno.env.get("SUPABASE_URL")!, serviceKey: SECRET };
async function loadSettings() {
  const { data } = await db.from("claims_settings").select("*").eq("id", true).maybeSingle();
  return (data ?? { autonomy: "full", max_shop_miles: 15, shops_per_request: 3 }) as Record<string, any>;
}
// verify snippet the Pi reader looks for in the Turo thread after sending (same rule as claims_draft_decide)
const snippetOf = (t: string) => (/^[A-Za-z0-9 ,.]{8,40}/.exec(t.replace(/\s+/g, " ")) ?? [""])[0].slice(0, 40);

// laTime ("October 06 at 11:55 AM" in Turo's wording, Los Angeles time) lives in time.ts with the other Pacific-time helpers.
export { laTime };

type Case = Record<string, any>;
type Msg = { message_id: string; sent_at: string; role: string; author: string | null; body: string | null };
type Draft = Record<string, any>;

// ---------------------------------------------------------------- guards
// reviewGuard / planGuard / moneyGuard live in guards.ts (pure, so vitest runs them); the same ones now gate every outbound path through send.ts.
export { reviewGuard, planGuard };

// strip any sentence that carries a plan / cap / dollar figure out of text the model will read (old cases still have "$500" in goal and facts)
const SCRUB = /out[-\s]of[-\s]pocket|plan\s+(max|cap)|protection|deductible|\bturo['\u2019]s\b|\bguest\s+(owes|plan)|\$\s?[0-9]/i;
const scrub = (t?: string | null) => t ? t.split(/(?<=[.!?])\s+/).filter((x) => !SCRUB.test(x)).join(" ") || null : null;

// a coverage amount the GUEST stated in their own message (internal use only, never repeated to anyone)
function guestStatedMax(body: string): number | null {
  const m = /(deductible|out[-\s]of[-\s]pocket|max(?:imum)?|cap|coverage|protection plan)[^$.\n]{0,60}\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)|\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)[^.\n]{0,40}(deductible|out[-\s]of[-\s]pocket|max(?:imum)?)/i.exec(body);
  const v = m ? (m[2] ?? m[3]) : null;
  return v ? Number(v.replace(/,/g, "")) : null;
}

// ---------------------------------------------------------------- drafting
const SYSTEM = `You write short Turo messages for Jared, a Turo host, to a guest who damaged his car. You write AS Jared, first person.
Goal: the guest runs the repair through their personal auto insurance so the full repair is paid.
Voice: calm, direct, friendly but firm, plain words, 2 to 5 short sentences, no emoji, no greetings longer than "Hi <name>,".
Facts only from the CASE data. Never invent amounts, dates, damage, promises or legal threats.
Insurance: ask for their insurer's name and policy number; Jared will handle the rest with the estimate.
Hard rules: the only dollar figure you may ever write is the body shop estimate total, and only when the CASE gives it. Never mention a deductible, plan cap,
out-of-pocket max, protection plan or any coverage amount. Never describe or explain Turo's plans, policies, processes, claim steps or payment options, and never tell the
guest how or where to pay. You speak for Jared only, never for Turo. Never mention reviews, ratings or stars.
Never mention AI, drafts, automation or that someone else is writing. Never ask the guest to message outside Turo.
Reply ONLY with JSON: {"message": "<the message>", "reason": "<one line for Jared: why this message now>"}`;

async function draft(kind: string, c: Case, trip: any, thread: Msg[], extra: string): Promise<{ message: string; reason: string } | null> {
  const allowed = c.estimate_amount ? [Number(c.estimate_amount)] : [];   // the repair estimate is the only dollar figure a guest message may carry
  const caseData = {
    guest_first_name: c.guest_first, reservation: c.reservation_id,
    trip: trip ? { start: fmt(trip.starts_at), end: fmt(trip.ends_at), car: "2020 Tesla Model 3" } : null,
    path: c.path, status: c.status, goal: scrub(c.goal), facts: scrub(c.facts),
    estimate: c.estimate_amount ? money(Number(c.estimate_amount)) : "not yet (body shop estimate coming)",
    invoice_posted: await invoiceDone(c),
    insurer_on_file: c.insurer && Object.keys(c.insurer).length ? c.insurer : null,
    escalate_cutoff: fmt(c.escalate_by),
  };
  const convo = thread.slice(-14).map((m) => `${m.role === "GUEST" ? (m.author ?? "Guest") : "Jared"} (${fmt(m.sent_at)}): ${(m.body ?? "").slice(0, 700)}`).join("\n");
  const task = {
    follow_up: "The guest has not replied. Write a polite, short follow-up that asks for their auto insurance details (insurer name + policy number) so it can go through insurance. If insurance was already asked, gently restate it. Do not offer, name or describe any other way to pay.",
    insurance_ask: "Ask the guest whether they have personal auto insurance and, if so, for their insurer's name and policy number so Jared can run the repair through it.",
    reply: "Reply to the guest's latest message. Answer what they said using only the CASE facts, then move toward the goal (their insurance details). If they share insurance details, thank them and say Jared will open the claim with the estimate. If they dispute fault, stay calm and stick to what the CASE facts say about the handoff photos and the check-in; invent nothing.",
    estimate: "Tell the guest the body shop estimate total (the only dollar figure you may write). If invoice_posted is true, also say an invoice with the estimate and photos is up. Then ask for their personal auto insurance details (insurer name + policy number) so the full repair can run through it. Never say what the guest owes, what a plan covers, or how to pay.",
  }[kind] ?? "Write the next helpful message toward the goal.";
  const user = `CASE: ${JSON.stringify(caseData)}\n\nCONVERSATION (oldest first):\n${convo || "(none)"}\n\nTASK: ${task}${extra ? `\nNOTE: ${extra}` : ""}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try {
      r = await llm({ task: "write", system: SYSTEM + (attempt ? "\nYour last draft broke a hard rule. Leave out reviews, plans, caps, deductibles, anything about how Turo works or how to pay, and every dollar figure except the estimate total." : ""),
        user, json: true, job: SLUG, ref: String(c.reservation_id), fn: SLUG, paid: "never", privacy: "private", deadlineMs: 45_000, maxTokens: 500,
        validate: (j) => typeof j?.message === "string" && j.message.trim().length >= 20 && j.message.length <= 900 ? null : "message missing or wrong length" });
    } catch (e) {
      if (e instanceof LlmUnavailable) return null;
      throw e;
    }
    let msg = String(r.json.message).trim();
    const g = reviewGuard(msg);
    if (!g.ok) { if (attempt === 0) continue; msg = g.cleaned; }
    if (!planGuard(msg) || !moneyGuard(msg, allowed)) { if (attempt === 0) continue; return null; }
    if (msg.length < 20) return null;
    return { message: msg, reason: String(r.json.reason ?? "").slice(0, 240) };
  }
  return null;
}

// Plain fallback when every free model is down (follow-ups only; replies need judgment, so Jared gets pinged instead).
function fallbackFollowUp(c: Case) {
  const n = c.guest_first ? ` ${c.guest_first}` : "";
  return `Hi${n}, following up on the damage found after your trip. Do you have personal auto insurance? If so, please send me your insurer's name and policy number and I'll handle the claim with the body shop estimate. If not, just let me know.`;
}

// ---------------------------------------------------------------- one case
// Signed by Claims Closer (Jared's rule: the employee responsible sends its own alerts). Title gets the "Claims Closer: " prefix.
async function notify(title: string, body: string, dedupe: string, severity = "info") {
  await db.rpc("claims_notify", { p_title: title.replace(/^Claims: /, ""), p_body: body, p_severity: severity, p_dedupe: dedupe });
}

async function event(c: Case, kind: string, title: string, detail: unknown = null) {
  await db.from("claim_events").insert({ case_id: c.id, reservation_id: c.reservation_id, kind, title, detail });
}

// the Turo invoice is posted (or Turo already shows one) before the guest is told about it
async function invoiceDone(c: Case): Promise<boolean> {
  const { data } = await db.from("claim_turo_actions").select("id").eq("case_id", c.id).eq("kind", "create_invoice").eq("status", "done").limit(1);
  return (data ?? []).length > 0 || (c.invoices ?? []).some((i: any) => i.amount) || !!(c.turo_invoice && Object.keys(c.turo_invoice).length);
}

async function work(c: Case, daily: boolean, settings: Record<string, any>): Promise<string> {
  const [{ data: trip }, { data: inbox }, { data: drafts }] = await Promise.all([
    db.from("turo_trips").select("*").eq("reservation_id", c.reservation_id).maybeSingle(),
    db.from("turo_inbox").select("message_id, sent_at, role, author, body").eq("reservation_id", c.reservation_id).order("sent_at", { ascending: true }).limit(60),
    db.from("claim_drafts").select("*").eq("case_id", c.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const notes: string[] = [];
  const thread = (inbox ?? []) as Msg[];
  const all = (drafts ?? []) as Draft[];
  // ---- RETURN GATE: nothing reaches the guest until the reservation has ended AND Jared tapped Complete trip, and never during a live trip.
  // claims_gate() is the single source of truth (fails closed: if the lookup breaks, nothing is released).
  const { data: gateRow } = await db.rpc("claims_gate", { p_case: c.id });
  const gate = (gateRow ?? { ok: false, live: false, reason: "gate lookup failed" }) as Record<string, any>;
  if (gate.ok && c.status === "waiting_return") { c.status = "waiting_guest"; await db.from("claim_cases").update({ status: "waiting_guest" }).eq("id", c.id); }

  // a coverage amount the guest states themselves is the only way guest_max is ever set (internal use; never repeated back to anyone)
  if (c.guest_max == null) {
    const said = [...thread].reverse().find((m) => m.role === "GUEST" && guestStatedMax(m.body ?? "") != null);
    if (said) {
      const v = guestStatedMax(said.body ?? "")!;
      c.guest_max = v;
      await db.from("claim_cases").update({ guest_max: v }).eq("id", c.id);
      await event(c, "note", "Guest stated a coverage amount in their own message (internal only, never repeated)", { amount: v, message_id: said.message_id });
    }
  }

  // hands-off: a draft written before autonomy was switched on, or held until the gate opened, goes out now if it passes every guard
  if (gate.ok) {
    const waiting = all.filter((x) => ["pending", "held"].includes(x.status) && x.kind !== "escalation" && (x.status === "held" || settings.autonomy === "full"));
    for (const d of waiting) {
      const g = reviewGuard(d.body);
      const allowedNow = c.estimate_amount ? [Number(c.estimate_amount)] : [];
      if (!g.ok || !planGuard(d.body) || !moneyGuard(d.body, allowedNow)) {
        if (d.status === "held") {   // written under old rules or edited: never send it; a fresh draft is written below
          await db.from("claim_drafts").update({ status: "rejected", last_error: "held draft broke the no-dollar / no-Turo-voice / no-review rules", updated_at: new Date().toISOString() }).eq("id", d.id);
          d.status = "rejected"; notes.push(`dropped held ${d.kind} (broke the rules)`);
        }
        continue;
      }
      const nowIso = new Date().toISOString();
      const auto = settings.autonomy === "full";
      const { error: upErr } = await db.from("claim_drafts").update(auto
        ? { status: "approved", approved_at: nowIso, verify_snippet: snippetOf(d.body), updated_at: nowIso }
        : { status: "pending", updated_at: nowIso }).eq("id", d.id).eq("status", d.status);
      if (!upErr) {
        const was = d.status;
        d.status = auto ? "approved" : "pending";
        if (auto) {
          await event(c, "approved", `Trip is complete: sending the ${String(d.kind).replace("_", " ")} to ${c.guest_first ?? "the guest"}`, { draft_id: d.id, auto: true, was });
          await db.from("turo_reader_state").update({ poke_at: nowIso }).eq("id", 1);
        } else {
          await event(c, "draft", `Trip is complete: ${String(d.kind).replace("_", " ")} for ${c.guest_first ?? "the guest"} is ready for Jared`, { draft_id: d.id });
          await notify(`Claims: message to ${c.guest_first ?? "guest"} ready for your OK`, d.body.slice(0, 220), `claims-draft-${d.id}`);
        }
        notes.push(`${auto ? "sent" : "released"} ${was === "held" ? "held " : "waiting "}${d.kind}`);
      }
    }
  }
  const pending = all.find((d) => d.status === "pending" && d.kind !== "escalation");
  const inFlight = all.find((d) => ["approved", "sending"].includes(d.status));
  const held = all.find((d) => d.status === "held" && d.kind !== "escalation");
  const lastGuest = [...thread].reverse().find((m) => m.role === "GUEST");
  const lastHost = [...thread].reverse().find((m) => m.role === "HOST");
  const now = Date.now();
  // the scheduled re-check that woke us is spent; the pipeline sets a new one below if it is still waiting on shops
  if (c.next_check_at && Date.parse(c.next_check_at) <= now) await db.from("claim_cases").update({ next_check_at: null }).eq("id", c.id);

  // ---- daily deadline check (pushes to Jared, never to the guest)
  if (daily) {
    const day = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
    if (c.estimate_due_at && !c.estimate_amount && !c.estimates_requested_at) {
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

  // ---- 2026-10-28 autonomy: each step is isolated, and each sends only through canSend (hold, return gate, guards)
  const auto = await loadAutonomy(ctx);
  const isolated = async (name: string, step: () => Promise<void>) => {
    try { await step(); }
    catch (e) {
      notes.push(`${name} error: ${String(e).slice(0, 100)}`);
      await event(c, "error", `Claims Closer step failed: ${name}`, { error: String(e).slice(0, 300) });
      try { await db.rpc("bestly_raise", { p_key: `claims.${name.replace(/ /g, "-")}`, p_kind: "problem", p_severity: "warning", p_title: `Claims Closer ${name} step failed`, p_body: String(e).slice(0, 300), p_area: "turo", p_needs_jared: null, p_healed: false }); } catch { /* */ }
    }
  };
  await isolated("tesla estimate", () => teslaStep(ctx, c, notes));

  // ---- v2: shops, estimates, choosing, the Turo invoice (failures here never block talking to the guest)
  try { await estimatePipeline(ctx, c, settings, notes); }
  catch (e) {
    notes.push(`estimate pipeline error: ${String(e).slice(0, 100)}`);
    await event(c, "error", "Estimate pipeline hit an error", { error: String(e).slice(0, 300) });
    try { await db.rpc("bestly_raise", { p_key: "claims.estimates", p_kind: "problem", p_severity: "warning", p_title: "Claims Closer estimate step failed", p_body: String(e).slice(0, 300), p_area: "turo", p_needs_jared: null, p_healed: false }); } catch { /* */ }
  }

  // ---- v2: answers Jared / Scout gave, the guest's insurer and the garage, and the repair booking (each isolated; none blocks the guest)
  for (const [name, step] of [["answers", () => answeredQuestions(ctx, c, notes)], ["third parties", () => thirdParties(ctx, c, notes)], ["booking", async () => {
      const fresh = (await db.from("claim_cases").select("*").eq("id", c.id).maybeSingle()).data ?? c;   // an answer above may have just changed the booking state
      await bookingStep(ctx, fresh, notes); }]] as [string, () => Promise<void>][]) {
    try { await step(); }
    catch (e) {
      notes.push(`${name} error: ${String(e).slice(0, 100)}`);
      await event(c, "error", `Claims Closer step failed: ${name}`, { error: String(e).slice(0, 300) });
      try { await db.rpc("bestly_raise", { p_key: `claims.${name.replace(" ", "-")}`, p_kind: "problem", p_severity: "warning", p_title: `Claims Closer ${name} step failed`, p_body: String(e).slice(0, 300), p_area: "turo", p_needs_jared: null, p_healed: false }); } catch { /* */ }
    }
  }

  // ---- deadlines and route (item 2, 12), the guest's insurer (item 9), booking on its own (item 10)
  {
    const fresh = (await db.from("claim_cases").select("*").eq("id", c.id).maybeSingle()).data ?? c;
    await isolated("deadlines", () => deadlineStep(ctx, fresh, auto, notes));
    await isolated("insurer", () => insurerStep(ctx, fresh, notes));
    await isolated("auto booking", () => autoBookStep(ctx, fresh, auto, notes));
  }

  // ---- what to say next (one pending draft per case, nothing while a message is going out)
  let kind: string | null = null, extra = "", forMsg: string | null = null;
  const lastSentAt = Math.max(...all.filter((d) => d.status === "sent").map((d) => Date.parse(d.sent_at)), 0, lastHost ? Date.parse(lastHost.sent_at) : 0);
  // never draft or reply during a live trip, and never while a watchdog hold is on the case; after the trip, draft but hold until Complete trip
  if (gate.live) notes.push("trip is live; not messaging the guest");
  else if (c.outbound_hold) notes.push("outbound held by the watchdog");
  else if (held && !gate.ok) notes.push("message held until the trip is complete");
  if (!pending && !inFlight && !held && !gate.live && !c.outbound_hold) {
    if (lastGuest && Date.parse(lastGuest.sent_at) > lastSentAt && !all.some((d) => d.for_message_id === lastGuest.message_id)) {
      kind = "reply"; forMsg = lastGuest.message_id;
    } else if (c.estimate_amount && !all.some((d) => d.kind === "estimate" && ["approved", "sending", "sent", "pending"].includes(d.status))
               && (c.path !== "resolve_directly" || await invoiceDone(c))) {
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
      const hold = !gate.ok;   // draft now, send when the trip has ended and Jared has tapped Complete trip
      const auto = settings.autonomy === "full" && !hold;
      const nowIso = new Date().toISOString();
      const { data: row } = await db.from("claim_drafts").insert({ case_id: c.id, reservation_id: c.reservation_id, kind, body: d.message,
        reason: hold ? `${d.reason} (held until the trip is over and you tap Complete trip)`.slice(0, 300) : d.reason, for_message_id: forMsg,
        ...(hold ? { status: "held" } : auto ? { status: "approved", approved_at: nowIso, verify_snippet: snippetOf(d.message), notified_at: nowIso } : {}) }).select("id").single();
      if (hold) {
        await event(c, "held", `Drafted a ${kind.replace("_", " ")} for ${c.guest_first ?? "the guest"} and holding it until the trip is over and Jared taps Complete trip`, { draft_id: row?.id, reason: gate.reason });
        if (["open", "waiting_guest"].includes(c.status)) { c.status = "waiting_return"; await db.from("claim_cases").update({ status: "waiting_return" }).eq("id", c.id); }
      } else if (auto) {
        await event(c, "approved", `Sending a ${kind.replace("_", " ")} to ${c.guest_first ?? "the guest"}`, { draft_id: row?.id, auto: true });
        await db.from("turo_reader_state").update({ poke_at: nowIso }).eq("id", 1);   // the Pi sends within ~15 s
      } else {
        await event(c, "draft", `Drafted a ${kind.replace("_", " ")} for Jared`, { draft_id: row?.id });
        await notify(`Claims: message to ${c.guest_first ?? "guest"} ready for your OK`, d.message.slice(0, 220), `claims-draft-${row?.id}`);
        await db.from("claim_drafts").update({ notified_at: nowIso }).eq("id", row?.id);
      }
      notes.push(`${hold ? "held" : auto ? "sent" : "drafted"} ${kind}`);
      if (kind === "follow_up") await db.from("claim_cases").update({ follow_up_at: null }).eq("id", c.id);
    }
  }

  await db.from("claim_cases").update({ needs_work: false, work_reason: null, held_for_gate: !gate.ok, last_run_at: new Date().toISOString(),
    ...(daily ? { last_daily_at: new Date().toLocaleDateString("en-CA", { timeZone: TZ }) } : {}), updated_at: new Date().toISOString() }).eq("id", c.id);
  return `${c.guest_first ?? c.reservation_id}: ${notes.join(", ") || (pending ? "waiting on your OK" : inFlight ? "message going out" : held ? "message held for the trip" : "nothing new")}`;
}

// ---------------------------------------------------------------- entry
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!(await authorized(req))) return J({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const op = String(body.op ?? "tick");
  const settings = await loadSettings();
  if (op === "preview_request") {
    const { data: pc } = await db.from("claim_cases").select("*").eq("reservation_id", Number(body.reservation)).maybeSingle();
    if (!pc) return J({ error: "no case" }, 404);
    return J({ ok: true, ...(await previewRequest(ctx, pc, settings)) });
  }
  if (op === "ask_shop") {   // {reservation, shop: slug}: ask one named shop for a photo estimate now
    const { data: pc } = await db.from("claim_cases").select("*").eq("reservation_id", Number(body.reservation)).maybeSingle();
    const { data: shop } = await db.from("claim_shops").select("id, name").eq("slug", String(body.shop ?? "")).maybeSingle();
    if (!pc || !shop) return J({ error: !pc ? "no case" : "no shop" }, 404);
    return J({ ok: true, shop: shop.name, notes: await askShops(ctx, pc, settings, [shop.id]) });
  }
  if (op === "preview_parse") return J({ ok: true, ...(await previewParse(ctx, String(body.shop ?? "Shop"), String(body.subject ?? ""), String(body.body ?? ""))) });
  if (op === "evidence_urls") {   // Claims page: signed photo links (1 hour)
    const { data } = await db.from("claim_evidence").select("id, storage_path").eq("case_id", String(body.case_id ?? ""));
    const out: Record<string, string> = {};
    for (const e of (data ?? []) as any[]) { const { data: u } = await db.storage.from("claim-evidence").createSignedUrl(e.storage_path, 3600); if (u?.signedUrl) out[e.id] = u.signedUrl; }
    return J({ ok: true, urls: out });
  }
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
    const due = (cases ?? []).filter((c: Case) => daily || op === "run" || c.needs_work || (c.follow_up_at && Date.parse(c.follow_up_at) <= Date.now()) || (c.next_check_at && Date.parse(c.next_check_at) <= Date.now()));
    const out: string[] = [];
    for (const c of due) {
      try { out.push(await work(c, daily, settings)); }
      catch (e) {
        out.push(`${c.reservation_id}: error ${String(e).slice(0, 120)}`);
        await db.from("claim_cases").update({ last_run_at: new Date().toISOString() }).eq("id", c.id);
      }
    }
    try { const n: string[] = []; await outsideClaimsStep(ctx, n); if (n.length) out.push(`outside claims: ${n.join(", ")}`); }
    catch (e) { out.push(`outside claims: error ${String(e).slice(0, 120)}`); }
    const failed = out.some((s) => s.includes(": error "));
    const summary = (out.length ? out.join(" | ") : `${(cases ?? []).length} open claim(s), nothing new`).slice(0, 480);
    await db.rpc("agent_beat", { p_slug: SLUG, p_ok: !failed, p_summary: summary });
    return J({ ok: !failed, op, worked: out });
  } catch (e) {
    await db.rpc("agent_beat", { p_slug: SLUG, p_ok: false, p_summary: `run failed: ${String(e).slice(0, 200)}` });
    return J({ ok: false, error: String(e) }, 500);
  }
});
