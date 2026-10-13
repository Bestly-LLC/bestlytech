/**
 * Plain-words helpers for the pricing section and for Maya's agent_pricing / agent_checkout tools: the same numbers the
 * page shows, as sentences she can read out. Every figure comes from supabase/functions/_shared/agent-plans.ts.
 */
import {
  AGENT_PLANS, dollars, minutesFromCalls, monthlyCost, planById, recommendPlan, termsLine,
  type AgentPlan, type AgentPlanId,
} from "../../../supabase/functions/_shared/agent-plans";
import { spokenDollars } from "./planBridge";

/** What the picker holds. `override` is a total of minutes a month, when that was given instead of calls a day. */
export type Usage = { calls: number; avg: number; override: number | null };

export const DEFAULT_USAGE: Usage = { calls: 5, avg: 3, override: null };

export const minutesOf = (u: Usage): number => (u.override != null ? Math.max(0, Math.round(u.override)) : minutesFromCalls(u.calls, u.avg));

/** Included minutes, extra minutes and what the extras cost, for one plan at this many minutes. */
export function breakdownFor(plan: AgentPlan, minutes: number): { included: number; extra: number; extraCents: number } {
  const m = Math.ceil(minutes);
  const extra = Math.max(0, m - plan.includedMinutes);
  return { included: Math.min(m, plan.includedMinutes), extra, extraCents: extra * plan.extraCentsPerMinute };
}

/** The picker as one paragraph for Maya, with every figure as the page shows it. */
export function describeUsage(u: Usage): { say: string; recommended: AgentPlanId } {
  const minutes = minutesOf(u);
  const rec = recommendPlan(minutes);
  const b = breakdownFor(rec.plan, minutes);
  const basis = u.override != null ? `about ${minutes} minutes a month (the total they gave)` : `${u.calls} calls a day at ${u.avg} minutes each, about ${minutes} minutes a month`;
  const others = rec.alternatives.map((q) => `${q.plan.name} about ${spokenDollars(q.cents)} a month`).join("; ");
  const cover = b.extra === 0
    ? `All ${minutes} minutes are included.`
    : `${dollars(rec.plan.monthlyCents)} covers the first ${rec.plan.includedMinutes} minutes, and the other ${b.extra} minutes are ${rec.plan.extraCentsPerMinute} cents each, ${spokenDollars(b.extraCents)} more.`;
  return {
    say: `On the page now: ${basis}. Best fit is ${rec.plan.name}, about ${spokenDollars(rec.cents)} a month. ${cover} For the same minutes: ${others}.`,
    recommended: rec.plan.id,
  };
}

/** "Lite, $49 a month, no setup fee, 30-day money back, cancel anytime": the read-back before anyone pays. */
export function readBackLine(id: AgentPlanId): string {
  const p = planById(id);
  const t = termsLine();
  return `${p.name}, ${dollars(p.monthlyCents)} a month, ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

/** Same promise for Maya to say aloud (dollars in words). */
export function readBackSpoken(id: AgentPlanId): string {
  const p = planById(id);
  const t = termsLine();
  return `${p.name}, ${spokenDollars(p.monthlyCents)} a month, ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

export const allTotals = (minutes: number): string => AGENT_PLANS.map((p) => `${p.name} about ${dollars(monthlyCost(p, minutes))} a month`).join(", ");

export type CheckoutFields = { name: string; email: string; company: string; phone: string };

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is missing before the card can be paid, in the words Maya and the visitor use. */
export function missingFor(f: CheckoutFields): string[] {
  const m: string[] = [];
  if (!f.name.trim()) m.push("name");
  if (!f.email.trim()) m.push("email");
  else if (!EMAIL_RE.test(f.email.trim())) m.push("a valid email");
  if (!f.company.trim()) m.push("business name");
  return m;
}

const FIELD_IDS = { name: "agent_co_name", email: "agent_co_email", company: "agent_co_company", phone: "agent_co_phone" } as const;
export { FIELD_IDS as CHECKOUT_FIELD_IDS };

