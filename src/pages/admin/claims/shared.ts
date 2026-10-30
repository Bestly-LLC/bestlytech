/**
 * Claims page: types, RPC helper, formatters, label maps and the pure "who needs Jared" logic.
 * Everything here is moved as-is from the old single-file ClaimsCloser.tsx; only the derived helpers at the bottom are new.
 */
import { supabase } from "@/integrations/supabase/client";

export type Draft = { id: string; kind: string; body: string; reason: string | null; status: string; created_at: string; sent_at: string | null; last_error: string | null; verified: boolean | null };
export type Ev = { id: number; at: string; kind: string; title: string | null; detail: Record<string, unknown> | null };
export type Case = { id: string; reservation_id: number; guest_first: string | null; guest_last: string | null; status: string; path: string; opened_at: string;
  estimate_due_at: string | null; escalate_by: string | null; estimate_amount: number | null; guest_max: number | null; facts: string | null;
  insurer: Record<string, string>; invoices: { amount: number | null; due_text: string | null; paid: boolean }[]; trip_end: string | null;
  turo_claim_no: string | null; car: string | null; host_responsibility: number | null; recovered_amount: number | null; outcome: string | null;
  history: boolean; closed_at: string | null;
  turo_status: string | null; turo_next_action: string | null; turo_deadline: string | null; invoice_max: number | null; synced_at: string | null;
  guest_response: { submitted?: string; answers?: Record<string, string>; photos?: string } | null;
  damage_report: { submitted?: string; answers?: Record<string, string> } | null;
  turo_invoice: Record<string, unknown> | null; chosen_shop_id: string | null; chosen_estimate_id: string | null;
  repair_booking: { state?: string; dropoff_at?: string; pickup_at?: string; days?: number; notes?: string } | null };
export type Evidence = { id: string; uuid: string; kind: string; step: string | null; taken_at: string | null; path: string };
export type Estimate = { id: string; shop_id: string; shop: string; distance_mi: number | null; phone: string | null; channel: string; status: string; requested_at: string;
  replied_at: string | null; amount: number | null; oem: boolean | null; repair_vs_replace: string | null; notes: string | null; chosen: boolean; chosen_reason: string | null };
export type Question = { id: string; question: string; options: { value: string; label: string }[]; answer: string | null; asked_at: string; answered_at: string | null; kind: string };
export type TuroAction = { id: string; kind: string; status: string; payload: { amount?: number; dry_run?: boolean } | null; error: string | null; created_at: string; done_at: string | null };
export type Shop = { id: string; name: string; distance_mi: number | null };
export type Row = { case: Case; drafts: Draft[]; events: Ev[]; evidence: Evidence[]; estimates: Estimate[]; questions: Question[]; turo_actions: TuroAction[] };
export type Data = { sender: { claims_enabled: boolean; links_enabled: boolean; seen_at: string | null; last_error: string | null } | null;
  beat: { at: string; ok: boolean; summary: string | null } | null; settings: { autonomy: "full" | "guest_approval"; max_shop_miles: number; shops_per_request: number } | null;
  reader: { seen_at: string | null; signed_in: boolean; version: string | null; last_error: string | null } | null; shops: Shop[]; cases: Row[] };

/* Cleaning reports (2026-10-29, migration 20261029230000_claims_cleaning.sql, edge fn claims-cleaning) */
export type CleanPhoto = { uuid: string; side: "pre" | "post" | "guest_post"; taken_at: string | null; support: boolean };
export type CleanRow = { reservation_id: number; guest_first: string | null; trip_end: string; deadline: string; status: string; dry_run: boolean;
  verdict: "abuse" | "normal" | "unclear" | null; confidence: number | null; reasons: string | null; pre_count: number | null; post_count: number | null;
  turo_status: string | null; filed_at: string | null; last_error: string | null; photos: CleanPhoto[] };
export type CleanData = { settings: { mode: "auto" | "ask"; min_confidence: number } | null; rows: CleanRow[] };

export const rpc = <T,>(fn: string, args?: object) => supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: T | null; error: { message: string } | null }>;

const TZ = "America/Los_Angeles";
export const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "—";
export const clock = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }) : "—";
export const usd = (n?: number | null) => n == null ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }) : "—";
export const shortDay = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" }) : "—";

export const KIND: Record<string, string> = { reply: "Reply", follow_up: "Follow-up", insurance_ask: "Insurance ask", estimate: "Estimate", escalation: "Escalation note", other: "Message" };
export const EST: Record<string, string> = { requested: "Waiting for a quote", replied: "Replied, reading it", received: "Quote in", declined: "Declined", no_reply: "No reply", needs_visit: "Wants to see the car" };
export const BOOK: Record<string, string> = { requested: "Calling the shop", calling: "Ava is on the phone with the shop", booked: "Booked", manual: "Booked by you", failed: "Needs your call", by_hand: "You are booking it" };
export const STATUS: Record<string, string> = { open: "Open", waiting_guest: "Waiting on guest", insurance: "Through insurance", invoiced: "Invoiced", paid: "Paid", escalated: "Escalated to Turo", closed: "Closed" };
export const CLEAN: Record<string, string> = {
  waiting: "Waiting for your check-out photos", checking: "Checking the photos", clean: "Looks like normal use", no_evidence: "Can't report: photos missing",
  needs_you: "Your call", filing: "Filing with Turo", filed: "Filed, confirming with Turo", saved: "Turo has the report", approved: "Turo approved the fee",
  denied: "Turo turned it down", skipped: "You skipped it", expired: "Turo's window closed", error: "Couldn't check yet" };
export const CLEAN_TONE: Record<string, string> = {
  needs_you: "text-[#FF9F0A] bento:text-[#C93400]", approved: "text-[#30D158] bento:text-[#248A3D]", saved: "text-[#30D158] bento:text-[#248A3D]",
  denied: "text-[#FF453A] bento:text-[#D70015]", error: "text-[#FF453A] bento:text-[#D70015]" };
/** Cleaning states with nothing left to do (the case is closed out or Turo already has it). */
/** What to show for a cleaning row's status. "Your call" is the marker, so the words say what was found. */
export const cleanLabel = (status: string) => status === "needs_you" ? "Possible mess found in the photos" : CLEAN[status] ?? status;
export const CLEAN_FINAL = ["clean", "skipped", "saved", "approved", "denied", "expired"];

export const fullName = (c: Case) => [c.guest_first, c.guest_last].filter(Boolean).join(" ") || "Guest";
export const isHistory = (c: Case) => c.status === "paid" || c.status === "closed";

/* ───────── what needs Jared ───────── */
export const openQuestions = (r: Row) => r.questions.filter((q) => !q.answered_at && q.kind !== "fyi");
export const pendingDrafts = (r: Row) => r.drafts.filter((d) => d.status === "pending");
/** "Book it" is ready: a shop is chosen, there is a price, and nobody has started a booking. */
export const canBook = (r: Row) => !!r.estimates.find((e) => e.chosen) && !!r.case.estimate_amount && !(r.case.repair_booking?.state);
export const bookFailed = (r: Row) => r.case.repair_booking?.state === "failed";
export const needsList = (r: Row) => ({
  questions: openQuestions(r), drafts: pendingDrafts(r), book: canBook(r), bookFailed: bookFailed(r),
});
export const caseNeedsCount = (r: Row) => {
  const n = needsList(r);
  return n.questions.length + n.drafts.length + (n.book || n.bookFailed ? 1 : 0);
};
export const cleanLive = (r: CleanRow) => Date.parse(r.deadline) > Date.now();
export const cleanNeedsYou = (r: CleanRow) => r.status === "needs_you" && !r.dry_run && cleanLive(r);
/** Still inside Turo's 72-hour window and not finished. */
export const cleanOpen = (r: CleanRow) => cleanLive(r) && !CLEAN_FINAL.includes(r.status);

/** Days until Claims Closer escalates to Turo; null when it doesn't apply. */
export const daysToEscalate = (c: Case): number | null => {
  if (!c.escalate_by || ["paid", "closed", "escalated"].includes(c.status)) return null;
  return Math.ceil((Date.parse(c.escalate_by) - Date.now()) / 864e5);
};
export const escalateText = (d: number) => d > 1 ? `${d} days to escalate` : d === 1 ? "1 day to escalate" : d === 0 ? "Escalates today" : d === -1 ? "1 day overdue" : `${-d} days overdue`;

export type Tab = "open" | "clean" | "history";
export const tabOfId = (id: string): Tab => id.startsWith("clean:") ? "clean" : id.startsWith("hist:") ? "history" : "open";

export function wonTotal(rows: Row[]) {
  const won = rows.filter((r) => r.case.status === "paid");
  return { won, total: won.reduce((n, r) => n + Number(r.case.recovered_amount ?? 0), 0), settlement: won.some((r) => r.case.recovered_amount == null) };
}
