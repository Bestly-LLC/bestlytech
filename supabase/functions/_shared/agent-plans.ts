/**
 * Bestly Agent plans: the ONE place the prices live (docs/maya-sales-opusplan.md, Jared 2026-10-12).
 *
 * Plain TypeScript with no Deno or npm imports on purpose, so three places read the same file:
 *   - the website  (src/components/agentDemo/*, imported by a relative path),
 *   - the edge functions (agent-checkout builds the Stripe price from it, maya-watch writes Maya's selling instructions from it),
 *   - the checks (a node/tsx script can import it as is).
 * Nothing else in the repo may type these numbers. The server never trusts a price sent from a browser: it takes the plan id
 * and looks the amount up here.
 *
 * Extra minutes are billed on the next bill. For now the overage is added by hand (phase 2 turns the minutes already counted per
 * customer agent into Stripe usage); the copy only promises "billed on your next bill", which stays true.
 */

export type AgentPlanId = "lite" | "starter" | "growth";

export type AgentPlan = {
  id: AgentPlanId;
  name: string;
  /** Monthly price in cents. */
  monthlyCents: number;
  includedMinutes: number;
  /** Price of each minute past the included ones, in cents. */
  extraCentsPerMinute: number;
  /** One plain line for the plan card. */
  blurb: string;
  /** Stripe price lookup key; agent-checkout finds (or creates) the price by it. */
  lookupKey: string;
};

export const AGENT_PLANS: AgentPlan[] = [
  {
    id: "lite",
    name: "Lite",
    monthlyCents: 4900,
    includedMinutes: 30,
    extraCentsPerMinute: 100,
    blurb: "For a business that gets a few calls a week.",
    lookupKey: "bestly_agent_lite_monthly",
  },
  {
    id: "starter",
    name: "Starter",
    monthlyCents: 19900,
    includedMinutes: 150,
    extraCentsPerMinute: 75,
    blurb: "For a business with calls most days.",
    lookupKey: "bestly_agent_starter_monthly",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyCents: 49900,
    includedMinutes: 500,
    extraCentsPerMinute: 50,
    blurb: "For a busy business that lives on the phone.",
    lookupKey: "bestly_agent_growth_monthly",
  },
];

export const AGENT_TERMS = { setupFeeCents: 0, moneyBackDays: 30, cancelAnytime: true } as const;

export function isPlanId(v: unknown): v is AgentPlanId {
  return v === "lite" || v === "starter" || v === "growth";
}

export function planById(id: AgentPlanId): AgentPlan {
  return AGENT_PLANS.find((p) => p.id === id) as AgentPlan;
}

/** Cents for one month on a plan at this many minutes: the monthly price plus every minute past the included ones. */
export function monthlyCost(plan: AgentPlan, minutes: number): number {
  const m = Math.max(0, Math.ceil(Number.isFinite(minutes) ? minutes : 0));
  return plan.monthlyCents + Math.max(0, m - plan.includedMinutes) * plan.extraCentsPerMinute;
}

export type PlanQuote = { plan: AgentPlan; cents: number };

/** The cheapest plan for this many minutes (a tie goes to the bigger plan), plus the other two for comparison. */
export function recommendPlan(minutes: number): { plan: AgentPlan; cents: number; alternatives: PlanQuote[] } {
  const quotes: PlanQuote[] = AGENT_PLANS.map((plan) => ({ plan, cents: monthlyCost(plan, minutes) }));
  const best = quotes.reduce((a, b) => (b.cents < a.cents || (b.cents === a.cents && b.plan.monthlyCents > a.plan.monthlyCents) ? b : a));
  return { plan: best.plan, cents: best.cents, alternatives: quotes.filter((q) => q.plan.id !== best.plan.id) };
}

/** Minutes a month from calls a day and minutes a call. 22 business days by default. */
export function minutesFromCalls(callsPerDay: number, avgMinutes: number, daysPerMonth = 22): number {
  const c = Math.max(0, Number.isFinite(callsPerDay) ? callsPerDay : 0);
  const a = Math.max(0, Number.isFinite(avgMinutes) ? avgMinutes : 0);
  return Math.max(0, Math.round(c * a * daysPerMonth));
}

/** "$49", "$1,234", "$226.50": whole dollars when there are no cents. */
export function dollars(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

/** "20¢" for an amount under a dollar. */
export function centsLabel(cents: number): string {
  return cents < 100 ? `${cents}¢` : dollars(cents);
}

/** "a dollar" / "75 cents", for words Maya says out loud. */
export function spokenRate(cents: number): string {
  if (cents === 100) return "a dollar";
  if (cents < 100) return `${cents} cents`;
  return `${dollars(cents)}`;
}

/** The refund and cancel promises as one short line, built from the terms. */
export function termsLine(): string {
  return `${AGENT_TERMS.setupFeeCents === 0 ? "No setup fee" : `${dollars(AGENT_TERMS.setupFeeCents)} setup fee`}, ${AGENT_TERMS.moneyBackDays}-day money back, ${AGENT_TERMS.cancelAnytime ? "cancel anytime" : "no cancelling mid-month"}`;
}

/** Plain-English summary for Maya's instructions. Built from the plans so her numbers always match the page. */
export function pricingSentence(): string {
  const plans = AGENT_PLANS.map((p) =>
    `${p.name} is ${dollars(p.monthlyCents)} a month with ${p.includedMinutes} minutes of calls included, and extra minutes are ${spokenRate(p.extraCentsPerMinute)} each`).join("; ");
  return `Bestly Agent has three monthly plans. ${plans}. ${termsLine()}. A minute is time on a call, rounded up to the next minute. Minutes past the included ones are billed on the next bill.`;
}
