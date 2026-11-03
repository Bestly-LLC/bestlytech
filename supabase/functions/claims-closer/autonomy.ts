// Claims Closer autonomy rules (2026-10-28). Pure: no Deno, no network, no database. The edge function reads the facts, these decide.
//   deriveWindows / deadlineActions   item 2   every Turo window per case, and what to do ahead of each
//   choosePath                        item 12  resolve directly vs Turo claim vs the guest's insurer, with the reason
//   settlementDecision                item 11  min_accept_pct: anything under it is Jared's call, never a counter-offer
//   chaseDelayHours                   item 9   how often to chase an insurer
//   bookingSlots / fundingAssured     item 10  drop-off times that do not collide with Turo trips; when it is safe to book
//   parseTeslaEstimate                item 4   Tesla Service / Collision Center estimate text
import { DAY, HOUR, laDate, laInstant, laTime, laWeekday } from "./time.ts";

type Row = Record<string, any>;

// ---------------------------------------------------------------- item 2: windows
export type WindowKind = "estimate_share" | "resolve_directly" | "invoice_expiry" | "turo_claim_filing" | "turo_next_action" | "insurer_exception";
export type Win = { kind: WindowKind; due_at: string; source: string; note?: string; status?: "open" | "met" | "lapsed" | "moot" };

/** Every Turo window the case record tells us about. Explicit dates from Turo's own mail (stored by claims_mail_seen) win over these rules. */
export function deriveWindows(c: Row, now = Date.now()): Win[] {
  const out: Win[] = [];
  const iso = (ms: number) => new Date(ms).toISOString();
  if (c.estimate_due_at && c.estimate_amount == null) out.push({ kind: "estimate_share", due_at: c.estimate_due_at, source: "Turo: share a professional estimate with the guest within 3 days", status: Date.parse(c.estimate_due_at) < now ? "lapsed" : "open" });
  if (c.escalate_by && c.path === "resolve_directly") {
    const lapsed = Date.parse(c.escalate_by) < now;
    out.push({ kind: "resolve_directly", due_at: c.escalate_by, source: "Turo: 20 days from trip end to resolve directly", status: lapsed ? "lapsed" : "open" });
    out.push({ kind: "turo_claim_filing", due_at: c.escalate_by, source: "Turo: escalate to a Turo claim before the resolve-directly window ends", status: lapsed ? "lapsed" : "open" });
  }
  for (const inv of (c.invoices ?? []) as Row[]) {
    if (inv.paid || !inv.due_text) continue;
    const t = laTime(String(inv.due_text), now);
    if (t !== null) out.push({ kind: "invoice_expiry", due_at: iso(t), source: `Turo: invoice${inv.amount ? ` of $${inv.amount}` : ""} must be paid or disputed by this time`, status: t < now ? "lapsed" : "open" });
  }
  if (c.turo_deadline && c.turo_next_action) out.push({ kind: "turo_next_action", due_at: c.turo_deadline, source: `Turo next action: ${String(c.turo_next_action).slice(0, 80)}`, status: Date.parse(c.turo_deadline) < now ? "lapsed" : "open" });
  return out;
}

export type DeadlineAction =
  | { type: "escalate_to_turo"; why: string; urgent: boolean }
  | { type: "alert_next_action"; why: string; due_at: string }
  | { type: "path_exhausted"; why: string };

export type DeadlineFacts = { now: number; leadHours: number; damageInvoicePaid: boolean; escalationQueued: boolean; insurerOnFile: boolean };

/**
 * What to do ahead of the windows. Respect the existing rules: this only decides; queueTuroAction() still runs the gate, the hold and the guards
 * (no dollar amounts except the estimate, no Turo voice) before anything goes to the Turo reader.
 */
export function deadlineActions(c: Row, windows: Win[], f: DeadlineFacts): DeadlineAction[] {
  const out: DeadlineAction[] = [];
  if (["paid", "closed", "escalated"].includes(String(c.status)) || c.history || f.damageInvoicePaid) return out;
  const resolve = windows.find((w) => w.kind === "resolve_directly");
  const filing = windows.find((w) => w.kind === "turo_claim_filing");
  const turoStatus = String(c.turo_status ?? "").toUpperCase();
  const invoiceDead = windows.some((w) => w.kind === "invoice_expiry" && w.status === "lapsed" && (c.path === "resolve_directly")) || /EXPIRED|DECLINED|CANCEL/.test(turoStatus);
  const filingOpen = filing ? Date.parse(filing.due_at) > f.now : c.path === "turo_claim";
  const hoursLeft = resolve ? (Date.parse(resolve.due_at) - f.now) / HOUR : null;

  if (c.path === "resolve_directly" && !f.escalationQueued) {
    if (invoiceDead && filingOpen) out.push({ type: "escalate_to_turo", urgent: true, why: "the invoice expired or was declined and the Turo claim window is still open" });
    else if (hoursLeft !== null && hoursLeft > 0 && hoursLeft <= f.leadHours) out.push({ type: "escalate_to_turo", urgent: hoursLeft <= 24, why: `resolve directly ends in ${Math.max(1, Math.round(hoursLeft))} hours and nothing is paid` });
    else if (invoiceDead && !filingOpen) out.push({ type: "path_exhausted", why: "the invoice expired and the window to file a Turo claim has passed" });
    else if (hoursLeft !== null && hoursLeft <= 0 && !filingOpen && !invoiceDead) out.push({ type: "path_exhausted", why: "the resolve-directly window ended unpaid and the Turo claim window has passed" });
  }
  const next = windows.find((w) => w.kind === "turo_next_action" && w.status === "open");
  if (next && (Date.parse(next.due_at) - f.now) / HOUR <= 24) out.push({ type: "alert_next_action", why: next.source, due_at: next.due_at });
  return out;
}

// ---------------------------------------------------------------- item 12: path choice
export type PathOption = { path: "resolve_directly" | "turo_claim" | "guest_insurer"; feasible: boolean; expected: number | null; speed: 1 | 2 | 3; reason: string };
export type PathChoice = { chosen: PathOption["path"] | "none"; protectWithTuro: boolean; why: string; options: PathOption[] };

/**
 * Which route recovers the most, given the deadlines. All numbers are the repair estimate Jared would receive; none of them is ever said to the guest.
 *  - resolve directly: fast, capped by the guest's out-of-pocket maximum when Turo reports it (invoice_max, internal only)
 *  - Turo claim: Turo pays the estimate minus Jared's damage responsibility (host_responsibility, when known); needs the filing window open
 *  - guest insurer: the full estimate, slowest, needs the insurer and policy on file
 * When a Turo window closes within the lead time and the slower route has not paid, a Turo claim is also filed to protect the deadline.
 */
export function choosePath(c: Row, windows: Win[], f: { now: number; leadHours: number; damageInvoicePaid: boolean; invoiceExpiredOrDeclined: boolean; insurerClaimOpen?: boolean }): PathChoice {
  const est = c.estimate_amount != null ? Number(c.estimate_amount) : null;
  const filing = windows.find((w) => w.kind === "turo_claim_filing");
  const filingOpen = c.path === "turo_claim" || (filing ? Date.parse(filing.due_at) > f.now : false);
  const resolve = windows.find((w) => w.kind === "resolve_directly");
  const resolveOpen = c.path === "resolve_directly" && !f.invoiceExpiredOrDeclined && (resolve ? Date.parse(resolve.due_at) > f.now : true);
  const insurer = !!(c.insurer?.name && c.insurer?.policy_no);
  const cap = c.invoice_max != null ? Number(c.invoice_max) : null;
  const resp = c.host_responsibility != null ? Number(c.host_responsibility) : 0;
  const options: PathOption[] = [
    { path: "resolve_directly", feasible: resolveOpen && !f.damageInvoicePaid, expected: est === null ? null : cap !== null ? Math.min(est, cap) : est, speed: 3,
      reason: !resolveOpen ? (f.invoiceExpiredOrDeclined ? "the invoice expired or was declined" : "the resolve-directly window is closed") : cap !== null && est !== null && cap < est ? `the guest's out-of-pocket maximum caps it at $${cap}` : "open" },
    { path: "turo_claim", feasible: filingOpen, expected: est === null ? null : Math.max(0, est - resp), speed: 2, reason: filingOpen ? (resp ? "Turo pays the estimate minus Jared's damage responsibility" : "Turo manages it") : "the window to file with Turo has passed" },
    { path: "guest_insurer", feasible: insurer, expected: est, speed: 1, reason: insurer ? "the guest's insurer and policy are on file" : "no insurer and policy from the guest yet" },
  ];
  const feasible = options.filter((o) => o.feasible);
  if (!feasible.length) return { chosen: "none", protectWithTuro: false, why: "every route is closed or unknown; Jared decides whether to absorb it", options };
  // most recovered; ties go to the faster route
  const best = [...feasible].sort((a, b) => (b.expected ?? -1) - (a.expected ?? -1) || b.speed - a.speed)[0];
  const hoursLeft = resolve ? (Date.parse(resolve.due_at) - f.now) / HOUR : null;
  const deadlineClose = hoursLeft !== null && hoursLeft > 0 && hoursLeft <= f.leadHours;
  const protect = deadlineClose && filingOpen && best.path !== "turo_claim" && !f.insurerClaimOpen;
  const money = (o: PathOption) => (o.expected === null ? "an amount not known yet" : `$${o.expected}`);
  const why = `${best.path.replace("_", " ")} recovers the most (${money(best)})`
    + `${feasible.length > 1 ? `; others: ${feasible.filter((o) => o !== best).map((o) => `${o.path.replace("_", " ")} ${money(o)}`).join(", ")}` : ""}`
    + `${options.filter((o) => !o.feasible).length ? `; closed: ${options.filter((o) => !o.feasible).map((o) => `${o.path.replace("_", " ")} (${o.reason})`).join(", ")}` : ""}`
    + `${protect ? `; a Turo window closes in ${Math.round(hoursLeft!)} hours, so a Turo claim is filed too as protection` : ""}.`;
  return { chosen: best.path, protectWithTuro: protect, why, options };
}

// ---------------------------------------------------------------- item 11: settlement offers
/** min_accept_pct (Jared, 2026-10-28) = 100. An offer below that percentage of the chosen estimate always goes to Jared; no counters, no partial acceptance. */
export function settlementDecision(offer: number, estimate: number, minAcceptPct: number): { decision: "accept" | "jared"; pct: number } {
  const pct = estimate > 0 ? Math.round((offer / estimate) * 10000) / 100 : 0;
  return { decision: estimate > 0 && offer >= estimate * (minAcceptPct / 100) - 0.005 ? "accept" : "jared", pct };
}

// ---------------------------------------------------------------- item 9: chasing
const CHASE_HOURS = [48, 72, 96, 120, 168];
export const MAX_CHASES = 5;
export const chaseDelayHours = (chaseCount: number) => CHASE_HOURS[Math.min(chaseCount, CHASE_HOURS.length - 1)];

// ---------------------------------------------------------------- item 10: booking
/**
 * Drop-off times (8:30 AM Pacific, weekdays, starting tomorrow) when the car has no Turo trip from `bufferHours` before the drop-off until
 * `bufferHours` after the pick-up. Trips are {starts_at, ends_at, vin?, status?}.
 */
export function bookingSlots(trips: Row[], o: { now: number; days: number; count?: number; horizonDays?: number; bufferHours: number; vin?: string | null }): number[] {
  const count = o.count ?? 3, horizon = o.horizonDays ?? 14;
  const mine = trips.filter((t) => !/CANCEL/i.test(String(t.status ?? "")) && (!t.vin || !o.vin || t.vin === o.vin) && Date.parse(t.ends_at) > o.now);
  const out: number[] = [];
  const tomorrow = Date.parse(laDate(o.now + 24 * HOUR) + "T12:00:00Z");
  const buf = o.bufferHours * HOUR;
  for (let i = 0; i < horizon && out.length < count; i++) {
    const day = laDate(tomorrow + i * DAY);
    const wd = laWeekday(laInstant(day, 12, 0));
    if (wd === "Sat" || wd === "Sun") continue;
    const drop = laInstant(day, 8, 30);
    const pick = drop + o.days * DAY + 2 * HOUR;
    if (mine.some((t) => Date.parse(t.starts_at) < pick + buf && Date.parse(t.ends_at) > drop - buf)) continue;
    if (out.length && drop - out[out.length - 1] < 20 * HOUR) continue;
    out.push(drop);
  }
  return out;
}

/**
 * Jared's rule (2026-10-27 decision, "avoid fronting repair cost"): book the repair itself only when the money is assured, not before.
 * Assured = the damage invoice is paid, Turo approved the claim, the guest's insurer accepted the estimate, or Jared flagged it ok to front.
 */
export function fundingAssured(c: Row, track: Row | null, damageInvoicePaid: boolean): { assured: boolean; why: string } {
  if (c.repair_booking?.fronting_ok) return { assured: true, why: "Jared said fronting this repair is fine" };
  if (damageInvoicePaid) return { assured: true, why: "the damage invoice is paid" };
  if (/APPROVED|ACCEPTED|PAYMENT|SETTLED/i.test(String(c.turo_status ?? "")) && c.path === "turo_claim") return { assured: true, why: `Turo shows the claim as ${c.turo_status}` };
  if (track && ["awaiting_payment", "estimate_accepted"].includes(String(track.state))) return { assured: true, why: "the guest's insurer accepted the estimate" };
  return { assured: false, why: "no payment is assured yet (Jared's rule: do not front the repair)" };
}

/** the shop to book: the shop of the chosen estimate; Tesla Service/Collision (OEM) only when it was chosen, i.e. when fully covered or the best option */
export function bookingShopKind(shop: Row): "call" | "app" | "manual" {
  if (String(shop.slug ?? "") === "tesla-service") return "app";   // booked in the Tesla app chat; no phone or email path
  return shop.phone ? "call" : "manual";
}

// ---------------------------------------------------------------- item 4: Tesla Service / Collision Center estimates
/** Pull the total out of a Tesla estimate (email or pasted app chat). Never invents: the number must appear in the text next to a total word. */
export function parseTeslaEstimate(text: string): { total: number | null; source: "service" | "collision" | "unknown"; ref: string | null } {
  const t = String(text ?? "");
  const m = /(?:estimated?\s+(?:total|cost|repair cost)|total\s+(?:estimate|cost|due|price|repair)|grand\s+total|total)[^$\d\n]{0,30}\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/i.exec(t);
  const total = m ? Number(m[1].replace(/,/g, "")) : null;
  const source = /collision/i.test(t) ? "collision" : /service/i.test(t) ? "service" : "unknown";
  const ref = /(?:estimate|repair order|RO|work order)\s*(?:#|no\.?|number)?\s*[:#]?\s*([A-Z0-9-]{5,16})/i.exec(t)?.[1] ?? null;
  return { total: total && total > 0 ? total : null, source, ref };
}
