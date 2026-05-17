import { useState, useMemo } from "react";
import { GradientText } from "@/components/ui/GradientText";
import { GlowCard } from "@/components/ui/GlowCard";
import { AnimatedSection } from "@/components/AnimatedSection";

/**
 * InteractivePricingCalculator
 *
 * Replaces the static $X/$Y/$Z savings grid on /cloud. Customer picks the
 * SaaS services they actually use today + slides their headcount, and sees a
 * live, transparent comparison against Bestly Cloud's one-time hardware cost
 * + optional managed support.
 *
 * Prices are 2026 list, annual-billing per-seat unless noted. Sourced from
 * each vendor's public pricing page; defensible — if a vendor changes
 * pricing we update SERVICES below.
 */

// ── Service catalog ────────────────────────────────────────────────────────
type Service = {
  id: string;
  name: string;
  category: string;
  pricePerSeatMonth: number;
  note?: string;
  defaultChecked?: boolean;
};

const SERVICES: Service[] = [
  // Productivity
  { id: "gws",   name: "Google Workspace Business Standard", category: "Productivity", pricePerSeatMonth: 14,    defaultChecked: true },
  { id: "m365",  name: "Microsoft 365 Business Standard",    category: "Productivity", pricePerSeatMonth: 12.50 },
  // Communication
  { id: "zoom",  name: "Zoom Pro",                           category: "Communication", pricePerSeatMonth: 14.99, defaultChecked: true },
  { id: "slack", name: "Slack Business+",                    category: "Communication", pricePerSeatMonth: 15,    defaultChecked: true },
  { id: "loom",  name: "Loom Business",                      category: "Communication", pricePerSeatMonth: 15 },
  // Project & docs
  { id: "asana", name: "Asana Business",                     category: "Projects", pricePerSeatMonth: 24.99, defaultChecked: true },
  { id: "linear",name: "Linear",                             category: "Projects", pricePerSeatMonth: 14 },
  { id: "notion",name: "Notion Plus",                        category: "Projects", pricePerSeatMonth: 10 },
  // Files
  { id: "drop",  name: "Dropbox Business Standard",          category: "Files", pricePerSeatMonth: 15 },
  // Security & identity
  { id: "1pw",   name: "1Password Business",                 category: "Security", pricePerSeatMonth: 7.99, defaultChecked: true },
  { id: "okta",  name: "Okta SSO",                           category: "Security", pricePerSeatMonth: 8 },
  // Sales / signing
  { id: "docusign", name: "DocuSign Business Pro",           category: "Signing", pricePerSeatMonth: 40, defaultChecked: true },
  // Scheduling
  { id: "calendly", name: "Calendly Standard",               category: "Scheduling", pricePerSeatMonth: 10 },
  // AI
  { id: "gpt",   name: "ChatGPT Team",                       category: "AI",   pricePerSeatMonth: 25, defaultChecked: true },
  { id: "claude",name: "Claude Team",                        category: "AI",   pricePerSeatMonth: 25 },
  // Design / dev (often per-seat too)
  { id: "figma", name: "Figma Pro",                          category: "Design", pricePerSeatMonth: 15 },
  { id: "adobe", name: "Adobe Creative Cloud Teams",         category: "Design", pricePerSeatMonth: 80 },
  { id: "gh",    name: "GitHub Team",                        category: "Dev",  pricePerSeatMonth: 4 },
];

// ── Bestly Cloud price model ───────────────────────────────────────────────
// Hardware one-time + optional managed support monthly. Hardware doesn't
// scale per-user up to ~50 users (one Pi-class server handles it); larger
// teams scale to a second box at ~100, third at ~200.
function bestlyHardwareCost(users: number): number {
  if (users <= 50)  return 6500;
  if (users <= 100) return 11500; // primary + replication
  if (users <= 200) return 17500; // primary + 2 secondaries
  return 17500 + Math.ceil((users - 200) / 100) * 5500;
}
const BESTLY_SUPPORT_MONTH = 500; // optional managed; if self-managed = 0
const BESTLY_AI_MONTH      = 0;   // local Ollama default; BYOK via OpenRouter adds ~$30-100 depending on use

// ── Component ──────────────────────────────────────────────────────────────
export function InteractivePricingCalculator() {
  const [users, setUsers] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(SERVICES.filter(s => s.defaultChecked).map(s => s.id))
  );
  const [managedSupport, setManagedSupport] = useState(true);

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const calc = useMemo(() => {
    const stackPerSeatMonth = SERVICES
      .filter(s => selected.has(s.id))
      .reduce((sum, s) => sum + s.pricePerSeatMonth, 0);

    const stackMonthly  = stackPerSeatMonth * users;
    const stackAnnual   = stackMonthly * 12;
    const stackThreeYear = stackAnnual * 3;

    const bestlyOneTime = bestlyHardwareCost(users);
    const bestlyMonthly = managedSupport ? BESTLY_SUPPORT_MONTH + BESTLY_AI_MONTH : BESTLY_AI_MONTH;
    const bestlyThreeYear = bestlyOneTime + (bestlyMonthly * 36);

    const savings = stackThreeYear - bestlyThreeYear;
    const savingsPct = stackThreeYear > 0 ? Math.round((savings / stackThreeYear) * 100) : 0;

    return {
      stackPerSeatMonth, stackMonthly, stackAnnual, stackThreeYear,
      bestlyOneTime, bestlyMonthly, bestlyThreeYear,
      savings, savingsPct,
    };
  }, [selected, users, managedSupport]);

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  // Group services for the UI
  const grouped = SERVICES.reduce((acc, s) => {
    (acc[s.category] ||= []).push(s);
    return acc;
  }, {} as Record<string, Service[]>);

  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
        <AnimatedSection animation="fade-in" className="text-center mb-12">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">
            The math, on your stack
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Tell us what you pay for. <GradientText as="span">See your number.</GradientText>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Check the services your team actually uses today. Slide the headcount. The savings update live.
          </p>
        </AnimatedSection>

        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          {/* Left: inputs */}
          <GlowCard className="!p-6 lg:!p-8">
            {/* User count slider */}
            <div className="mb-8">
              <div className="flex items-end justify-between mb-3">
                <label htmlFor="userCount" className="text-sm font-semibold text-foreground">
                  Team size
                </label>
                <span className="text-2xl font-semibold tracking-tight text-foreground">
                  {users} <span className="text-sm font-normal text-muted-foreground">users</span>
                </span>
              </div>
              <input
                id="userCount"
                type="range"
                min={5}
                max={500}
                step={5}
                value={users}
                onChange={e => setUsers(Number(e.target.value))}
                className="w-full accent-[hsl(var(--gradient-end))]"
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>5</span><span>100</span><span>250</span><span>500</span>
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
                            <span className={isOn ? "text-foreground font-medium" : "text-foreground"}>
                              {s.name}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            ${s.pricePerSeatMonth}/seat
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
                    Bestly managed support ($500/mo, optional)
                  </span>
                </label>
                <p className="mt-1 text-xs text-muted-foreground pl-6">
                  Or self-manage with full docs — included free.
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
                  {calc.savings >= 0 ? fmt(calc.savings) : "—"}
                </GradientText>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {calc.savings >= 0
                  ? `${calc.savingsPct}% less than your current cloud stack`
                  : "Add a few more services to see your savings"}
              </p>
            </GlowCard>

            <div className="grid gap-4 sm:grid-cols-2">
              <GlowCard className="!p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Your current cloud stack
                </p>
                <p className="mt-3 text-xl font-semibold text-foreground tabular-nums">
                  {fmt(calc.stackMonthly)}/mo
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  ${calc.stackPerSeatMonth.toFixed(2)}/seat · {fmt(calc.stackAnnual)}/yr
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
                  {fmt(calc.bestlyOneTime)} <span className="text-xs text-muted-foreground font-normal">hardware</span>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {calc.bestlyMonthly > 0 ? `+ ${fmt(calc.bestlyMonthly)}/mo support` : "self-managed"}
                </p>
                <p className="mt-3 text-sm font-medium text-foreground tabular-nums">
                  {fmt(calc.bestlyThreeYear)} <span className="text-xs text-muted-foreground font-normal">over 3 years</span>
                </p>
              </GlowCard>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Prices are 2026 list, annual-billing per-seat. AI on Bestly Cloud uses local Ollama
              by default ($0); add a BYOK key for Claude / GPT / Gemini if you want hosted models
              (~$30–100/mo at typical usage). Hardware scales: one server up to 50 users, primary +
              replica to 100, primary + 2 replicas to 200.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
