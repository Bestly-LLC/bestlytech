/**
 * Shared bits of the Coach UI: types, the RPC helper, step names, score pills, and the formatting rules
 * (a number never splits from its unit, times are 12-hour). Used by AvaCoach, CoachPlaybook, CoachReviews and CoachSettings.
 */
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { CoachSource } from "./coachBus";

export type Source = CoachSource;

export type PlayStatus = "proposed" | "testing" | "live" | "rolled_back" | "declined" | "retired";
export type Play = {
  id: string; rule: string; why: string | null; kind: string; size: "small" | "big"; status: PlayStatus; origin: "coach" | "incident" | "jared" | string;
  started_at: string | null; decided_at: string | null; created_at: string; updated_at?: string;
  result: { calls_with?: number; calls_without?: number; score_with?: number; score_without?: number; restarted_at?: string;
    previous?: { calls_with?: number; calls_without?: number } } | null;
  calls_used?: number;
  test?: { with: Arm; without: Arm };
};
export type Arm = { n: number; booked: number; kept: number };
export type Review = {
  call_id: string; call_no: number | null; scores: Record<string, number | null> | null; impulse?: Record<string, number | null> | null;
  objections?: string[]; went_well: string | null; work_on: string | null; rule_flags: string[]; overall: number | null; confidence?: number | null;
  created_at?: string; outcome?: string | null; company?: string | null; direction?: string | null; caller?: string | null;
};
export type Coach = {
  weeks: (Record<string, number | null> & { week: string; n: number })[]; focus: string | null; objections?: Record<string, number>;
  playbook: Play[]; testing_counts?: Record<string, { with: number; without: number }>; reviews: Review[]; pending: number;
};
export type Manage = {
  playbook: Play[]; settings: { auto_test?: boolean; needs_approval?: boolean };
  last_weekly: string | null; reviewed_7d: number; ai_ok: boolean;
  watch: { waiting: number; behind: boolean; last_review_at: string | null };
};
export type FeedRow = {
  call_id: string; call_no: number | null; at: string; who: string | null; lead_id: string | null; direction: string | null; outcome: string | null;
  scores: Record<string, number | null> | null; objections: string[] | null; went_well: string | null; work_on: string | null; rule_flags: string[] | null;
  overall: number | null; confidence: number | null;
};

// bound: supabase.rpc reads this.rest, so it can't be pulled off the client on its own
export const rpc = supabase.rpc.bind(supabase) as unknown as <T>(f: string, a?: object) => Promise<{ data: T | null; error: { message: string } | null }>;

export const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
/** the Orb's apricot, the Coach's accent */
export const APRICOT = "#FFA270";

export const STEPS: Record<Source, { key: string; label: string }[]> = {
  roofguard: [{ key: "opening", label: "Opening" }, { key: "qualify", label: "Qualify" }, { key: "present", label: "Present" },
    { key: "close", label: "Close" }, { key: "rehash", label: "Lock it in" }],
  ava: [{ key: "name", label: "Name" }, { key: "message", label: "Message" }, { key: "urgency", label: "Urgency" },
    { key: "callback", label: "Callback" }, { key: "warm_brief", label: "Warm & brief" }, { key: "privacy", label: "Privacy" }],
};
export const OBJECTION: Record<string, string> = { already_have_roofer: "Already have a roofer", send_info: "Send me info", price: "Price", busy: "Busy",
  not_interested: "Not interested", wrong_person: "Wrong person", call_back_later: "Call back later", other: "Other" };
export const FLAG: Record<string, string> = { said_replacement: 'Said "replacement"', called_it_insurance: "Called it insurance", fake_social_proof: "Implied partners",
  invented_deadline: "Invented a deadline", denied_being_ai: "Denied being an AI", income_projection: "Money promise",
  shared_private_info: "Shared private info", claimed_to_be_jared: "Spoke as Jared", made_commitment_for_jared: "Committed for Jared" };

export const tone = (v: number | null | undefined) => v == null ? "bg-white/10 text-white/50"
  : v >= 4 ? "bg-emerald-500/15 text-emerald-300" : v >= 3 ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300";
export const barTone = (v: number | null | undefined) => v == null ? "bg-white/15" : v >= 4 ? "bg-emerald-400" : v >= 3 ? "bg-amber-400" : "bg-rose-400";
export const fmt = (v: number | null | undefined) => (v == null ? "–" : Number(v).toFixed(Number.isInteger(Number(v)) ? 0 : 1));
export const weekLabel = (w: string) => new Date(w + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
/** "Oct 5, 2:14 PM" (12-hour, one line) */
export const when12 = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s(AM|PM)$/, " $1")
  : "never";
/** "Mon, Oct 5, 10:05 AM" */
export const whenDay12 = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s(AM|PM)$/, " $1")
  : "not yet";
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : "–");

export function Score({ v, label, big }: { v: number | null | undefined; label?: string; big?: boolean }) {
  return (
    <span className={cn("inline-flex items-center justify-center whitespace-nowrap rounded-full font-semibold tabular-nums", tone(v), big ? "min-w-[2.75rem] px-2.5 py-1 text-sm" : "min-w-[2rem] px-2 py-0.5 text-xs")}
      aria-label={label ? `${label}: ${v == null ? "not scored" : `${fmt(v)} out of 5`}` : undefined}>
      {fmt(v)}
    </span>
  );
}
