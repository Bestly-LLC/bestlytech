/**
 * Maya Desk formatting. Times are 12-hour in Pacific time, and a number never splits from its unit (non-breaking space).
 */
const PT = "America/Los_Angeles";
const NB = " ";
const nb = (s: string) => s.replace(/\s(AM|PM)\b/g, `${NB}$1`);

export type Ticket = {
  id: string; code: string; created_at: string; kind: "support" | "billing" | "privacy" | "callback" | "sales_lead";
  product: string | null; name: string | null; email: string | null; phone: string | null; issue: string | null;
  privacy_action: "delete" | "export" | "correct" | "opt_out" | null; conversation_id: string | null;
  status: "open" | "done" | "spam"; due_at: string; resolved_at: string | null; note: string | null;
  overdue: boolean; due_in_minutes: number;
};

export const KIND_LABEL: Record<Ticket["kind"], string> = {
  support: "Support", billing: "Billing", privacy: "Privacy", callback: "Call back", sales_lead: "Demo request",
};
export const PRIVACY_ACTION: Record<NonNullable<Ticket["privacy_action"]>, string> = {
  delete: "Delete their data", export: "Send them a copy of their data", correct: "Correct their data", opt_out: "Stop selling or sharing their data",
};

export const clock = (iso: string) =>
  nb(new Intl.DateTimeFormat("en-US", { timeZone: PT, hour: "numeric", minute: "2-digit" }).format(new Date(iso)));

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dayDiff = (iso: string) => Math.round((Date.parse(ymd(new Date(iso))) - Date.parse(ymd(new Date()))) / 86400000);
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: PT, month: "short", day: "numeric" }).format(new Date(iso));
const weekday = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: PT, weekday: "short" }).format(new Date(iso));

/** "Today", "Tomorrow", "Yesterday", "Mon" within the week, otherwise "Oct 6". */
export function dayWord(iso: string): string {
  const n = dayDiff(iso);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (Math.abs(n) <= 6) return weekday(iso);
  return shortDate(iso);
}
/** "Today 4:04 PM" */
export const whenWords = (iso: string) => `${dayWord(iso)} ${clock(iso)}`;

/** "5 min", "2 hr", "3 days": always with a non-breaking space. */
export function span(mins: number): string {
  const m = Math.max(1, Math.round(Math.abs(mins)));
  if (m < 60) return `${m}${NB}min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}${NB}hr`;
  const d = Math.round(h / 24);
  return `${d}${NB}${d === 1 ? "day" : "days"}`;
}

export const callLength = (secs: number | null | undefined): string => {
  if (secs == null) return "";
  if (secs < 60) return `${Math.max(1, Math.round(secs))}${NB}sec`;
  return `${Math.round(secs / 60)}${NB}min`;
};

export type Due = { text: string; tone: "ok" | "soon" | "late"; sub?: string };

/** The due line on a ticket. Privacy requests carry a legal deadline; within 10 days it turns orange. */
export function dueOf(t: Ticket): Due {
  if (t.status !== "open") return { text: "", tone: "ok" };
  const mins = Math.round((Date.parse(t.due_at) - Date.now()) / 60000);
  if (mins < 0) return { text: `Overdue by ${span(-mins)}`, tone: "late" };
  if (t.kind === "privacy") {
    const days = Math.ceil(mins / 1440);
    return { text: `Legal deadline ${shortDate(t.due_at)}`, sub: `${days}${NB}${days === 1 ? "day" : "days"} left`, tone: days <= 10 ? "soon" : "ok" };
  }
  const w = dayWord(t.due_at);
  return { text: `Due ${w === "Today" ? "today" : w === "Tomorrow" ? "tomorrow" : w} ${clock(t.due_at)}`, tone: mins <= 60 ? "soon" : "ok" };
}
