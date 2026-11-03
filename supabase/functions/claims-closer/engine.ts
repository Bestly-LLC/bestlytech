// Claims Closer autonomy engine (2026-10-28): the steps that read the case and act, using the pure rules in autonomy.ts.
//   deadlineStep   item 2   store every Turo window; act ahead of each (queue a move to a Turo claim before one lapses)
//   pathStep       item 12  choose resolve directly / Turo claim / guest insurer and log why
//   teslaStep      item 4   a Tesla Service or Collision Center estimate is a first-class estimate
//   autoBookStep   item 10  booking_mode='auto': start the booking itself once the money is assured
// Everything that leaves the building goes through send.ts (canSend): hold, return gate and guards apply here exactly as they do to the guest.
import type { Ctx } from "./estimates.ts";
import { bookingShopKind, choosePath, deadlineActions, deriveWindows, fundingAssured, parseTeslaEstimate } from "./autonomy.ts";
import { queueTuroAction } from "./send.ts";
import { DAY } from "./time.ts";

type Row = Record<string, any>;
const DEFAULTS = { insurer_contact_mode: "draft_only", booking_mode: "confirm", min_accept_pct: 100, auto_complete: false, booking_buffer_hours: 4, deadline_lead_hours: 72 };

export async function loadAutonomy(ctx: Ctx): Promise<Row> {
  const { data } = await ctx.db.from("claims_autonomy_settings").select("*").eq("id", true).maybeSingle();
  return { ...DEFAULTS, ...(data ?? {}) };   // no row: the safe defaults (nothing contacts an insurer, nothing books itself)
}

const damageInvoicePaid = (c: Row) => (c.invoices ?? []).some((i: Row) => i.paid && i.kind !== "incidental");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

// ---------------------------------------------------------------- items 2 and 12
export async function deadlineStep(ctx: Ctx, c: Row, st: Row, notes: string[]): Promise<void> {
  if (c.history || ["paid", "closed"].includes(String(c.status))) return;
  const now = Date.now();
  const wins = deriveWindows(c, now);
  if (wins.length) await ctx.db.rpc("claims_set_windows", { p_case: c.id, p_windows: wins });

  const [{ data: acts }, { data: drafts }, { data: trackRow }] = await Promise.all([
    ctx.db.from("claim_turo_actions").select("id, kind, status").eq("case_id", c.id).eq("kind", "escalate").in("status", ["queued", "sending", "done"]),
    ctx.db.from("claim_drafts").select("id, kind, status").eq("case_id", c.id).eq("kind", "escalation"),
    ctx.db.from("claim_insurer_track").select("*").eq("case_id", c.id).maybeSingle(),
  ]);
  const escalationQueued = (acts ?? []).length > 0 || c.status === "escalated";
  const insurerOnFile = !!(c.insurer?.name && c.insurer?.policy_no);
  const lead = Number(st.deadline_lead_hours ?? 72);
  const invoiceDead = wins.some((w) => w.kind === "invoice_expiry" && w.status === "lapsed") || /EXPIRED|DECLINED|CANCEL/i.test(String(c.turo_status ?? ""));
  const paid = damageInvoicePaid(c);

  // item 12: which route, and why. Logged whenever the answer changes, so Jared can read the reasoning.
  const choice = choosePath(c, wins, { now, leadHours: lead, damageInvoicePaid: paid, invoiceExpiredOrDeclined: invoiceDead, insurerClaimOpen: !!trackRow && !["identified", "stalled", "denied"].includes(String(trackRow.state)) });
  const { data: last } = await ctx.db.from("claim_decisions").select("chosen, why").eq("case_id", c.id).eq("kind", "path").order("at", { ascending: false }).limit(1);
  if (!last?.[0] || last[0].chosen !== choice.chosen || last[0].why !== choice.why) {
    await ctx.db.from("claim_decisions").insert({ case_id: c.id, kind: "path", chosen: choice.chosen, why: choice.why, options: choice.options, inputs: { protect_with_turo: choice.protectWithTuro, estimate: c.estimate_amount, lead_hours: lead } });
    await ctx.event(c, "decision", `Route: ${choice.chosen.replace("_", " ")}. ${choice.why}`.slice(0, 280), { chosen: choice.chosen });
  }

  const actions = deadlineActions(c, wins, { now, leadHours: lead, damageInvoicePaid: paid, escalationQueued, insurerOnFile });
  if (choice.protectWithTuro && !escalationQueued && !actions.some((a) => a.type === "escalate_to_turo"))
    actions.push({ type: "escalate_to_turo", urgent: false, why: "protecting the Turo deadline while the slower route finishes" });

  for (const a of actions) {
    if (a.type === "escalate_to_turo") {
      const message = escalationNote(ctx, c);
      const r = await queueTuroAction(ctx, c, "escalate", { message, why: a.why, urgent: a.urgent }, c.estimate_amount ? [Number(c.estimate_amount)] : []);
      if (r.ok) {
        if (!(drafts ?? []).length) await ctx.db.from("claim_drafts").insert({ case_id: c.id, reservation_id: c.reservation_id, kind: "escalation", body: message, reason: "Ready to paste into Turo's Claims tab if the automatic step does not complete. Never sent to the guest." });
        await ctx.db.from("claim_windows").update({ acted_at: new Date().toISOString() }).eq("case_id", c.id).in("kind", ["resolve_directly", "turo_claim_filing"]);
        await ctx.event(c, "turo_action", `Queued a move to a Turo claim: ${a.why}`, { action_id: r.id, progress: true });
        await ctx.notify(`${c.guest_first ?? "A"} claim: moving to a Turo claim`, `${a.why}. The request is queued for the Turo reader and the note is on the Claims page.`, `claims-esc-queued-${c.id}`, "warning");
        notes.push("queued a Turo claim");
      } else {
        // blocked (hold, or the trip is not complete yet): report once a day and stop on this item
        await ctx.notify(`${c.guest_first ?? "A"} claim: a Turo deadline is close and I am blocked`, `${a.why}. ${r.error ?? "Blocked."} I will not work around it. Lift the hold or tap Complete trip, or file it in Turo yourself.`, `claims-esc-blocked-${c.id}-${today()}`, "warning");
        notes.push(`Turo claim held: ${r.error}`);
      }
    } else if (a.type === "alert_next_action") {
      await ctx.notify(`${c.guest_first ?? "A"} claim: Turo needs the next step by ${ctx.fmt(a.due_at)}`, a.why, `claims-next-${c.id}-${new Date(a.due_at).toISOString().slice(0, 10)}`, "warning");
      notes.push("Turo next-action alert");
    } else if (a.type === "path_exhausted" && choice.chosen === "none" && !insurerOnFile) {
      await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision", p_key: `path-exhausted-${c.id}`,
        p_question: `Every way to recover this one has closed (${a.why}). I have no insurer on file for ${c.guest_first ?? "the guest"}. Absorb the cost and close it, or will you take it from here?`,
        p_options: [{ value: "absorb", label: "Absorb it and close" }, { value: "mine", label: "I will handle it" }] });
      notes.push("every route closed; asked Jared");
    }
  }
}

/** The note for Turo's Claims tab. The estimate is the only dollar figure; nothing about plans, caps or the guest's coverage. */
export function escalationNote(ctx: Pick<Ctx, "fmt" | "money">, c: Row): string {
  return `Escalation request for reservation ${c.reservation_id} (${c.guest_first ?? "guest"} ${c.guest_last ?? ""}). Resolve-directly started ${ctx.fmt(c.opened_at)}. `
    + `Damage found at check-in; pre-trip photos show the area undamaged at handoff. Estimate: ${c.estimate_amount ? ctx.money(Number(c.estimate_amount)) : "attached"}. Requesting Turo take over the claim.`;
}

// ---------------------------------------------------------------- item 4: Tesla Service / Collision Center
export async function teslaStep(ctx: Ctx, c: Row, notes: string[]): Promise<void> {
  if (c.history || c.estimate_amount != null || ["paid", "closed"].includes(String(c.status))) return;
  const since = new Date(Math.max(Date.parse(c.opened_at ?? c.created_at ?? new Date(0).toISOString()) - DAY, Date.now() - 30 * DAY)).toISOString();
  const { data: mails } = await ctx.db.from("bestly_mail").select("id, from_addr, subject, body_text, sent_at").gte("sent_at", since).order("sent_at", { ascending: true }).limit(40);
  const tesla = ((mails ?? []) as Row[]).filter((m) => /@(service\.)?tesla\.com/i.test(String(m.from_addr ?? "")) && /(estimate|repair|collision|invoice|quote)/i.test(String(m.subject ?? "")));
  if (!tesla.length) return;
  const { data: seen } = await ctx.db.from("claim_events").select("mail_id").eq("case_id", c.id).eq("kind", "tesla_mail");
  const done = new Set(((seen ?? []) as Row[]).map((e) => e.mail_id));
  const { data: waiting } = await ctx.db.from("claim_cases").select("id").is("estimate_amount", null).eq("history", false).not("status", "in", "(paid,closed)");
  for (const m of tesla) {
    if (done.has(m.id)) continue;
    const text = `${m.subject ?? ""}\n${String(m.body_text ?? "").slice(0, 6000)}`;
    const names = (c.vin && text.includes(c.vin)) || text.includes(String(c.reservation_id));
    if (!names && (waiting ?? []).length !== 1) continue;   // never attach a Tesla estimate to a case on a guess
    const p = parseTeslaEstimate(text);
    await ctx.db.from("claim_events").insert({ case_id: c.id, reservation_id: c.reservation_id, kind: "tesla_mail", title: `Tesla ${p.source === "collision" ? "Collision Center" : "Service"} wrote about an estimate`, detail: { total: p.total, ref: p.ref }, mail_id: m.id });
    if (p.total) {
      const r = await ctx.db.rpc("claims_add_estimate", { p_case: c.id, p_shop_slug: "tesla-service", p_amount: p.total, p_oem: true, p_source: "tesla_mail", p_detail: { text: text.slice(0, 2500), items: [], ref: p.ref } });
      if (r.data?.ok) notes.push(`Tesla estimate $${p.total}`);
    } else {
      await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision", p_key: `tesla-total-${m.id}`,
        p_question: `Tesla emailed about an estimate for ${c.guest_first ?? "this car"} but I could not read a total in it. Type the total in the note box (for example 1,850) and I will add it as the Tesla estimate. Nothing you type is sent to anyone.`,
        p_options: [{ value: "none", label: "There is no Tesla estimate" }] });
      notes.push("Tesla mail without a readable total; asked Jared");
    }
  }
}

/** Jared typed the Tesla total into the note box. The number becomes an estimate row; the sentence goes nowhere. */
export async function teslaTotalAnswer(ctx: Ctx, c: Row, answer: string): Promise<boolean> {
  const m = /\$?\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/.exec(answer);
  const total = m ? Number(m[1].replace(/,/g, "")) : NaN;
  if (!(total > 0)) return false;
  const r = await ctx.db.rpc("claims_add_estimate", { p_case: c.id, p_shop_slug: "tesla-service", p_amount: total, p_oem: true, p_source: "jared_note", p_detail: { items: [] } });
  return !!r.data?.ok;
}

// ---------------------------------------------------------------- item 10: booking_mode = 'auto'
export async function autoBookStep(ctx: Ctx, c: Row, st: Row, notes: string[]): Promise<void> {
  if (st.booking_mode !== "auto" || c.history || ["paid", "closed"].includes(String(c.status))) return;
  const rb = (c.repair_booking ?? {}) as Row;
  if (rb.state || !c.chosen_shop_id || c.estimate_amount == null) return;
  const [{ data: shop }, { data: track }] = await Promise.all([
    ctx.db.from("claim_shops").select("*").eq("id", c.chosen_shop_id).maybeSingle(),
    ctx.db.from("claim_insurer_track").select("*").eq("case_id", c.id).maybeSingle(),
  ]);
  if (!shop) return;
  const f = fundingAssured(c, track ?? null, damageInvoicePaid(c));
  if (!f.assured) { notes.push(`not booking yet: ${f.why}`); return; }
  const kind = bookingShopKind(shop);
  if (kind !== "call") {
    await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision", p_key: `booking-nopath-${c.id}`,
      p_question: `${shop.name} is the shop and the money is assured (${f.why}), but I can only book shops by phone and ${shop.name} ${kind === "app" ? "books in the Tesla app" : "has no phone number on file"}. Will you book it?`,
      p_options: [{ value: "by_hand", label: "I will book it" }] });
    notes.push("booking needs Jared (no phone path)");
    return;
  }
  await ctx.db.from("claim_cases").update({ repair_booking: { state: "requested", requested_at: new Date().toISOString(), tries: 0, shop_id: c.chosen_shop_id, auto: true, why: f.why }, needs_work: true, work_reason: "booking on its own" }).eq("id", c.id);
  c.repair_booking = { state: "requested", tries: 0, shop_id: c.chosen_shop_id, auto: true };
  await ctx.event(c, "booking", `Booking ${shop.name} on its own (auto mode): ${f.why}`, { progress: true });
  notes.push(`auto-booking ${shop.name}`);
}

/** Jared's answer to a path-exhausted question. Absorbing closes the case with the reason recorded; anything else leaves it for him. */
export async function pathExhaustedAnswer(ctx: Ctx, c: Row, answer: string): Promise<void> {
  if (answer === "absorb") {
    await ctx.db.from("claim_cases").update({ status: "closed", closed_at: new Date().toISOString(), outcome: "Closed by Jared's decision: every recovery route had closed.", needs_work: false, work_reason: null }).eq("id", c.id);
    await ctx.event(c, "closed", "Closed: Jared chose to absorb the cost", { progress: true });
  } else {
    await ctx.db.from("claim_cases").update({ needs_work: false, work_reason: null }).eq("id", c.id);
    await ctx.event(c, "note", "Jared is handling this one himself", {});
  }
}

