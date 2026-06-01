import { useState, useMemo } from "react";
import { GradientText } from "@/components/ui/GradientText";
import { GlowCard } from "@/components/ui/GlowCard";
import { AnimatedSection } from "@/components/AnimatedSection";

/**
 * InteractivePricingCalculator
 *
 * SMB-focused. A small-business owner checks the subscriptions they actually
 * pay for today (Google Workspace, Zoom, Slack, the website, the AI tool),
 * slides their headcount (1-50), and sees a live, transparent comparison
 * against Bestly Cloud's real model: a one-time server purchase plus an
 * optional managed-support plan. No per-seat fees, ever.
 *
 * Prices are 2026 list, per-seat-month at annual billing unless flagged flat.
 * Sourced from each vendor's public pricing page; defensible. Month-to-month
 * billing on most of these runs ~20% higher, which the Annual/Monthly toggle
 * reflects.
 */

// ── Service catalog (curated for SMBs) ──────────────────────────────────────
type Service = {
  id: string;
  name: string;
  category: string;
  /** per-seat monthly (scales with headcount) */
  pricePerSeatMonth?: number;
  /** flat monthly (does not scale with headcount, e.g. the company website) */
  flatMonth?: number;
  defaultChecked?: boolean;
};

const SERVICES: Service[] = [
  // Email & productivity
  { id: "gws",   name: "Google Workspace Business Standard", category: "Email & productivity", pricePerSeatMonth: 14,    defaultChecked: true },
  { id: "m365",  name: "Microsoft 365 Business Standard",    category: "Email & productivity", pricePerSeatMonth: 12.50 },
  // Chat & video
  { id: "zoom",  name: "Zoom Pro",                           category: "Chat & video", pricePerSeatMonth: 15,   defaultChecked: true },
  { id: "slack", name: "Slack Pro",                          category: "Chat & video", pricePerSeatMonth: 8.75, defaultChecked: true },
  // Files & storage
  { id: "drop",  name: "Dropbox Business",                   category: "Files & storage", pricePerSeatMonth: 18 },
  // Passwords
  { id: "1pw",   name: "1Password Business",                 category: "Passwords", pricePerSeatMonth: 7.99, defaultChecked: true },
  // E-signature
  { id: "docusign", name: "DocuSign Standard",               category: "E-signature", pricePerSeatMonth: 25 },
  // Scheduling
  { id: "calendly", name: "Calendly Standard",               category: "Scheduling", pricePerSeatMonth: 10 },
  // AI
  { id: "gpt",   name: "ChatGPT Team",                       category: "AI", pricePerSeatMonth: 25, defaultChecked: true },
  // Website & domain (flat, not per-seat)
  { id: "site",  name: "Website + hosting (Squarespace/Wix)", category: "Website & domain", flatMonth: 23, defaultChecked: true },
  { id: "domain",name: "Domain + business DNS",             category: "Website & domain", flatMonth: 2,  defaultChecked: true },
];

// ── Bestly Cloud price model (the real one) ─────────────────────────────────
// One server handles a 1-50 person team. One-time hardware, then either
// self-manage for $0/mo with full docs, or let Bestly run it for $500/mo.
const BESTLY_HARDWARE   = 6500; // one-time, covers up to 50 users
const BESTLY_SUPPORT    = 500;  // optional managed support, monthly
const AMORTIZE_MONTHS   = 36;   // spread hardware across 3 years for an apples-to-apples monthly

// Month-to-month billing on typical SaaS runs ~20% over the annual-prepaid rate.
const MONTHLY_BILLING_UPLIFT = 1.2;

// ── Component ──────────────────────────────────────────────────────────────
export function InteractivePricingCalculator() {
  const [users, setUsers] = useState(12);
  const [billing, setBilling] = useState<"annual" | "monthly">("annual");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(SERVICES.filter(s => s.defaultChecked).map(s => s.id))
  );
  // Default to self-managed: it's the realistic path for a small business and
  // keeps the headline savings a real, positive number even under ~10 seats.
  // Turning managed support on still recomputes live (and may go negative for
  // very small teams — we now show that real figure instead of a dash).
  const [managedSupport, setManagedSupport] = useState(false);

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const calc = useMemo(() => {
    const chosen = SERVICES.filter(s => selected.has(s.id));
    const seatPerMonth = chosen.reduce((sum, s) => sum + (s.pricePerSeatMonth ?? 0), 0);
    const flatPerMonth = chosen.reduce((sum, s) => sum + (s.flatMonth ?? 0), 0);

    const uplift = billing === "monthly" ? MONTHLY_BILLING_UPLIFT : 1;
    const stackMonthly   = (seatPerMonth * users + flatPerMonth) * uplift;
    const stackPerSeatMonth = seatPerMonth * uplift;
    const stackAnnual    = stackMonthly * 12;
    const stackThreeYear = stackAnnual * 3;

    const bestlyOneTime   = BESTLY_HARDWARE;
    const bestlyMonthly   = managedSupport ? BESTLY_SUPPORT : 0;
    const bestlyThreeYear = bestlyOneTime + bestlyMonthly * 36;
    // What Bestly works out to per month if you spread the hardware over 3 years.
    const bestlyMonthlyEquiv = bestlyOneTime / AMORTIZE_MONTHS + bestlyMonthly;

    const savings = stackThreeYear - bestlyThreeYear;
    const savingsPct = stackThreeYear > 0 ? Math.round((savings / stackThreeYear) * 100) : 0;
    const monthlySaved = stackMonthly - bestlyMonthlyEquiv;

    return {
      stackPerSeatMonth, stackMonthly, stackAnnual, stackThreeYear,
      bestlyOneTime, bestlyMonthly, bestlyThreeYear, bestlyMonthlyEquiv,
      savings, savingsPct, monthlySaved,
    };
  }, [selected, users, billing, managedSupport]);

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const grouped = SERVICES.reduce((acc, s) => {
    (acc[s.category] ||= []).push(s);
    return acc;
  }, {} as Record<string, Service[]>);

  const priceLabel = (s: Service) =>
    s.flatMonth != null ? `$${s.flatMonth}/mo` : `$${s.pricePerSeatMonth}/seat`;

  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
        <AnimatedSection animation="fade-in" className="text-center mb-12">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">
            The math, on your business
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Add up what you rent today. <GradientText as="span">See what you'd save.</GradientText>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Check the subscriptions your business actually pays for. Slide your team size. The savings update live, no sales call required.
          </p>
        </AnimatedSection>

        {/* SMB selling-point strip */}
        <AnimatedSection animation="fade-in" className="mb-10">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              "One bill instead of a dozen renewals",
              "No IT department needed",
              "Email, files, chat, video, AI in one place",
            ].map(point => (
              <div
                key={point}
                className="rounded-xl border border-border bg-secondary/30 px-4 py-3 text-center text-sm font-medium text-foreground"
              >
                {point}
              </div>
            ))}
          </div>
        </AnimatedSection>

        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          {/* Left: inputs */}
          <GlowCard className="!p-6 lg:!p-8">
            {/* Team size slider */}
            <div className="mb-6">
              <div className="flex items-end justify-between mb-3">
                <label htmlFor="userCount" className="text-sm font-semibold text-foreground">
                  How many people on your team?
                </label>
                <span className="text-2xl font-semibold tracking-tight text-foreground">
                  {users} <span className="text-sm font-normal text-muted-foreground">{users === 1 ? "person" : "people"}</span>
                </span>
              </div>
              <input
                id="userCount"
                type="range"
                min={1}
                max={50}
                step={1}
                value={users}
                onChange={e => setUsers(Number(e.target.value))}
                className="w-full accent-[hsl(var(--gradient-end))]"
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>1</span><span>15</span><span>30</span><span>50</span>
              </div>
            </div>

            {/* Billing toggle */}
            <div className="mb-8 flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
              <span className="text-sm text-foreground">How are you billed today?</span>
              <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5">
                {(["annual", "monthly"] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setBilling(opt)}
                    className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                      billing === opt
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Service checkboxes by category */}
            <div className="space-y-5">
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                    {cat}
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {items.map(s => {
                      const isOn = selected.has(s.id);
                      return (
                        <label
                          key={s.id}
                          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                            isOn
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-background hover:border-primary/20"
                          }`}
                        >
                          <span className="flex items-center gap-2.5 text-sm">
                            <input
                              type="checkbox"
                              checked={isOn}
                              onChange={() => toggle(s.id)}
                              className="h-4 w-4 accent-[hsl(var(--gradient-end))]"
                            />
                            <span className="text-foreground">{s.name}</span>
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {priceLabel(s)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="pt-2 border-t border-border">
                <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={managedSupport}
                    onChange={e => setManagedSupport(e.target.checked)}
                    className="h-4 w-4 accent-[hsl(var(--gradient-end))]"
                  />
                  <span className="text-foreground">
                    Let Bestly run it for you ($500/mo)
                  </span>
                </label>
                <p className="mt-1 text-xs text-muted-foreground pl-6">
                  Or self-manage with full docs for $0/mo. Either way, no per-seat fees.
                </p>
              </div>
            </div>
          </GlowCard>

          {/* Right: live output */}
          <div className="space-y-4">
            <GlowCard className="!p-6 lg:!p-8 text-center">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Your 3-year savings
              </p>
              <p className="mt-3 text-5xl sm:text-6xl font-semibold tracking-tight">
                <GradientText as="span">
                  {fmt(calc.savings)}
                </GradientText>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {calc.savings >= 0
                  ? `${calc.savingsPct}% less than what you pay for Google Workspace and the rest of your stack`
                  : "Subscriptions are still cheaper at this size. Add the tools you actually pay for, or check back as you grow."}
              </p>
              {calc.savings >= 0 && calc.monthlySaved > 0 && (
                <p className="mt-3 inline-block rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-foreground">
                  About {fmt(calc.monthlySaved)}/mo back in your pocket
                </p>
              )}
            </GlowCard>

            <div className="grid gap-4 sm:grid-cols-2">
              <GlowCard className="!p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  What you pay now
                </p>
                <p className="mt-3 text-xl font-semibold text-foreground tabular-nums">
                  {fmt(calc.stackMonthly)}/mo
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {fmt(calc.stackAnnual)}/yr · billed {billing}
                </p>
                <p className="mt-3 text-sm font-medium text-foreground tabular-nums">
                  {fmt(calc.stackThreeYear)} <span className="text-xs text-muted-foreground font-normal">over 3 years</span>
                </p>
              </GlowCard>

              <GlowCard className="!p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                  Bestly Cloud
                </p>
                <p className="mt-3 text-xl font-semibold text-foreground tabular-nums">
                  {fmt(calc.bestlyOneTime)} <span className="text-xs text-muted-foreground font-normal">one-time server</span>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {calc.bestlyMonthly > 0 ? `+ ${fmt(calc.bestlyMonthly)}/mo managed` : "self-managed, $0/mo"} · ≈ {fmt(calc.bestlyMonthlyEquiv)}/mo all-in
                </p>
                <p className="mt-3 text-sm font-medium text-foreground tabular-nums">
                  {fmt(calc.bestlyThreeYear)} <span className="text-xs text-muted-foreground font-normal">over 3 years</span>
                </p>
              </GlowCard>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Subscription prices are 2026 list at annual billing; the Monthly toggle reflects the
              ~20% premium most vendors charge month-to-month. Bestly's monthly figure spreads the
              one-time server cost across 3 years so you can compare like for like. AI runs locally
              for $0; add your own key for Claude, GPT, or Gemini only if you want hosted models.
              One server covers a team of up to 50.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
