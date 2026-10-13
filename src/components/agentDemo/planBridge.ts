/**
 * Bridge between the Bestly Agent pricing section (/agent#pricing) and Maya. Same pattern as cloud/calcBridge.ts and
 * maya/formBridge.ts (docs/maya-sales-opusplan.md, part 3).
 *
 * The pricing section registers itself while it is on screen. Maya's agent_pricing and agent_checkout tools (presenter.ts)
 * wait for it, drive it like a person would (the picker numbers move, a plan is chosen, the checkout card opens and the
 * visitor's details are typed in, the way a hand would), and read back the exact figures the page shows, so she never
 * quotes a price the visitor can't see.
 *
 * Maya never presses Pay. The visitor taps "Pay securely" themselves, and card details are typed only on Stripe's page.
 * When the visitor changes the picker or the plan by hand, the page announces it as `maya:plan-changed` (debounced, the
 * visitor's own edits only) and the Maya screen passes it to her as context.
 */
import type { AgentPlanId } from "../../../supabase/functions/_shared/agent-plans";

export type PlanUsage = {
  callsPerDay?: number;
  avgMinutes?: number;
  /** Minutes a month, when the visitor gave a total instead of calls a day. */
  minutes?: number;
};

export type CheckoutValues = { name?: string; email?: string; company?: string; phone?: string };

export type PlanApi = {
  /** Move the picker. Returns what the page now shows, in a sentence for Maya, and which plan is the best fit. */
  setUsage(v: PlanUsage): { say: string; recommended: AgentPlanId };
  /** Pick a plan: the checkout card opens under it. */
  choose(plan: AgentPlanId): { say: string };
  /** Open the checkout card (if closed) and type these into it. Never presses Pay. */
  fillCheckout(v: CheckoutValues): Promise<{ say: string; missing: string[] }>;
  /** What the page shows right now, without changing anything. */
  read(): { say: string };
  /** A block to bring into view and highlight. */
  element(which: "pricing" | "picker" | "checkout"): HTMLElement | null;
};

let current: PlanApi | null = null;
let waiting: ((a: PlanApi) => void)[] = [];

export function registerPlans(api: PlanApi): () => void {
  current = api;
  const ws = waiting;
  waiting = [];
  ws.forEach((w) => w(api));
  return () => {
    if (current === api) current = null;
  };
}

/** The pricing section if it is on screen now, or once it mounts (up to `ms`). */
export function getPlans(ms = 4000): Promise<PlanApi | null> {
  if (current) return Promise.resolve(current);
  return new Promise((resolve) => {
    const done = (a: PlanApi | null) => {
      clearTimeout(t);
      waiting = waiting.filter((w) => w !== ok);
      resolve(a);
    };
    const ok = (a: PlanApi) => done(a);
    const t = setTimeout(() => done(null), ms);
    waiting.push(ok);
  });
}

/** Debounced 1.2 s, the visitor's own edits only. detail = a sentence describing the pricing section now. */
export const PLAN_CHANGED = "maya:plan-changed";

// ---------- plain words for Maya ----------

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 226 -> "two hundred twenty-six". Whole numbers up to 999,999. */
export function spokenNumber(n: number): string {
  n = Math.max(0, Math.floor(n));
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${spokenNumber(n % 100)}` : ""}`;
  if (n < 1_000_000) return `${spokenNumber(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${spokenNumber(n % 1000)}` : ""}`;
  return String(n);
}

/** 22650 cents -> "two hundred twenty-six dollars and fifty cents"; 4900 -> "forty-nine dollars". */
export function spokenDollars(cents: number): string {
  const d = Math.floor(cents / 100);
  const c = cents % 100;
  const dw = `${spokenNumber(d)} ${d === 1 ? "dollar" : "dollars"}`;
  return c ? `${dw} and ${spokenNumber(c)} ${c === 1 ? "cent" : "cents"}` : dw;
}
