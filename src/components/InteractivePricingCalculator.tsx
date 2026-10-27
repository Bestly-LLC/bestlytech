import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { GradientText } from "@/components/ui/GradientText";
import { GlowCard } from "@/components/ui/GlowCard";
import { AnimatedSection } from "@/components/AnimatedSection";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { DeviceSavingsMini } from "@/components/cloud/DeviceSavingsMini";
import { registerCalc, CALC_CHANGED, type CalcChange, type CalcResult } from "@/components/cloud/calcBridge";

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
  { id: "zoho",  name: "Zoho Workplace Professional",        category: "Email & productivity", pricePerSeatMonth: 7 },
  // Chat & video
  { id: "zoom",  name: "Zoom Pro",                           category: "Chat & video", pricePerSeatMonth: 15,   defaultChecked: true },
  { id: "slack", name: "Slack Pro",                          category: "Chat & video", pricePerSeatMonth: 8.75, defaultChecked: true },
  { id: "teams", name: "Microsoft Teams Essentials",         category: "Chat & video", pricePerSeatMonth: 4 },
  // Files & storage
  { id: "drop",  name: "Dropbox Business",                   category: "Files & storage", pricePerSeatMonth: 18 },
  { id: "box",   name: "Box Business",                       category: "Files & storage", pricePerSeatMonth: 20 },
  // Passwords
  { id: "1pw",   name: "1Password Business",                 category: "Passwords", pricePerSeatMonth: 7.99, defaultChecked: true },
  { id: "lastpass", name: "LastPass Business",               category: "Passwords", pricePerSeatMonth: 7 },
  // E-signature
  { id: "docusign", name: "DocuSign Standard",               category: "E-signature", pricePerSeatMonth: 25, defaultChecked: true },
  { id: "adobesign", name: "Adobe Acrobat Sign",             category: "E-signature", pricePerSeatMonth: 17 },
  // Scheduling
  { id: "calendly", name: "Calendly Standard",               category: "Scheduling", pricePerSeatMonth: 10 },
  { id: "acuity",   name: "Acuity Scheduling",               category: "Scheduling", pricePerSeatMonth: 20 },
  // AI
  { id: "gpt",    name: "ChatGPT Team",                      category: "AI", pricePerSeatMonth: 25, defaultChecked: true },
  { id: "claude", name: "Claude Team",                       category: "AI", pricePerSeatMonth: 25 },
  // Project management (2026 list, annual billing)
  { id: "asana",  name: "Asana Starter",                     category: "Project management", pricePerSeatMonth: 10.99 },
  { id: "monday", name: "monday.com Basic",                  category: "Project management", pricePerSeatMonth: 9 },
  // Notes & wiki
  { id: "notion", name: "Notion Plus",                       category: "Notes & wiki", pricePerSeatMonth: 10 },
  { id: "confluence", name: "Confluence Standard",           category: "Notes & wiki", pricePerSeatMonth: 6 },
  // Backup
  { id: "backblaze", name: "Backblaze Business Backup",      category: "Backup", pricePerSeatMonth: 8, defaultChecked: true },
  { id: "acronis",   name: "Acronis Cyber Protect",          category: "Backup", pricePerSeatMonth: 9 },
  // Remote access
  { id: "nordlayer", name: "NordLayer VPN (Lite)",           category: "Remote access", pricePerSeatMonth: 8 },
  { id: "tailscale", name: "Tailscale Starter",              category: "Remote access", pricePerSeatMonth: 6 },
  // Web security
  { id: "dnsfilter", name: "DNSFilter (Pro)",                category: "Web security", pricePerSeatMonth: 2.5, defaultChecked: true },
  { id: "cfzt",      name: "Cloudflare Zero Trust",          category: "Web security", pricePerSeatMonth: 7 },
  // Website & domain (flat, not per-seat)
  { id: "site",  name: "Website + hosting (Squarespace/Wix)", category: "Website & domain", flatMonth: 23, defaultChecked: true },
  { id: "webflow", name: "Webflow CMS site",                 category: "Website & domain", flatMonth: 29 },
  { id: "domain",name: "Domain + business DNS",             category: "Website & domain", flatMonth: 2,  defaultChecked: true },
];

// ── Bestly Cloud price model (per Eli strategy, June 2026) ──────────────────
// One server handles a 1-50 person team. LEAD with the Managed plan: startup
// cost + monthly subscription (we run it — monitoring, updates, backups,
// priority support). Self-hosted ($0/mo, pay-per-call help) is the fallback.
const BESTLY_HARDWARE   = 6500; // startup cost: hardware + install, covers up to 50 users
const MANAGED_MONTHLY   = 199;  // managed subscription, flat — never per-seat
const AMORTIZE_MONTHS   = 36;   // spread startup across 3 years for an apples-to-apples monthly
const ON_DEMAND_CALL    = 149;  // self-hosted plan: pay-per-call support, charged only when used

// Month-to-month billing on typical SaaS runs ~20% over the annual-prepaid rate.
const MONTHLY_BILLING_UPLIFT = 1.2;


// ── Pure math (shared by the page and by Maya, so she quotes exactly what the page shows) ──
type Billing = "annual" | "monthly";
type Plan = "managed" | "selfhosted";

function computeCalc(selected: Set<string>, users: number, billing: Billing, plan: Plan) {
  const chosen = SERVICES.filter(s => selected.has(s.id));
  const seatPerMonth = chosen.reduce((sum, s) => sum + (s.pricePerSeatMonth ?? 0), 0);
  const flatPerMonth = chosen.reduce((sum, s) => sum + (s.flatMonth ?? 0), 0);

  const uplift = billing === "monthly" ? MONTHLY_BILLING_UPLIFT : 1;
  const stackMonthly   = (seatPerMonth * users + flatPerMonth) * uplift;
  const stackPerSeatMonth = seatPerMonth * uplift;
  const stackAnnual    = stackMonthly * 12;
  const stackThreeYear = stackAnnual * 3;

  const bestlyOneTime  = BESTLY_HARDWARE;
  // Managed (lead plan): startup + flat monthly subscription, never per-seat.
  // Self-hosted (fallback): startup only, $0/mo; pay-per-call help shown
  // separately, never in the monthly math.
  const bestlyMonthly  = plan === "managed" ? MANAGED_MONTHLY : 0;
  const ownThreeYear    = bestlyOneTime + bestlyMonthly * AMORTIZE_MONTHS;
  const ownMonthlyEquiv = ownThreeYear / AMORTIZE_MONTHS; // startup spread over 3 yrs + subscription
  const bestlyMonthlyEquiv = ownMonthlyEquiv;

  const savings = stackThreeYear - ownThreeYear;
  const savingsPct = stackThreeYear > 0 ? Math.round((savings / stackThreeYear) * 100) : 0;
  const monthlySaved = stackMonthly - ownMonthlyEquiv;

  // ROI: the startup cost pays for itself out of what you stop renting
  // (net of the Bestly subscription on the managed plan).
  const netMonthly = stackMonthly - bestlyMonthly;
  const paybackMonths = netMonthly > 0 ? Math.ceil(bestlyOneTime / netMonthly) : null;

  // Team size at which owning beats renting (used for the small-team message).
  const monthlyToolsPerUser = seatPerMonth * uplift;
  const breakevenUsers = monthlyToolsPerUser > 0
    ? Math.max(1, Math.ceil((ownMonthlyEquiv - flatPerMonth * uplift) / monthlyToolsPerUser))
    : null;

  return {
    stackPerSeatMonth, stackMonthly, stackAnnual, stackThreeYear,
    bestlyOneTime, bestlyMonthly, ownThreeYear, bestlyMonthlyEquiv,
    savings, savingsPct, monthlySaved, paybackMonths, breakevenUsers,
  };
}

/** What visitors call each tool. Matching is by these words first, then by the product name. */
const APP_WORDS: Record<string, string[]> = {
  gws: ["google workspace", "g suite", "gsuite", "gmail", "google docs", "google drive", "google"],
  m365: ["microsoft 365", "office 365", "o365", "outlook", "microsoft office", "office", "word", "excel"],
  zoho: ["zoho"],
  zoom: ["zoom"],
  slack: ["slack"],
  teams: ["microsoft teams", "teams"],
  drop: ["dropbox"],
  box: ["box"],
  "1pw": ["1password", "one password"],
  lastpass: ["lastpass", "last pass"],
  docusign: ["docusign", "docu sign"],
  adobesign: ["adobe sign", "acrobat sign", "adobe acrobat"],
  calendly: ["calendly"],
  acuity: ["acuity"],
  gpt: ["chatgpt", "chat gpt", "openai", "gpt"],
  claude: ["claude", "anthropic"],
  asana: ["asana"],
  monday: ["monday"],
  notion: ["notion"],
  confluence: ["confluence"],
  backblaze: ["backblaze"],
  acronis: ["acronis"],
  nordlayer: ["nordlayer", "nord vpn", "nordvpn", "vpn"],
  tailscale: ["tailscale"],
  dnsfilter: ["dnsfilter", "dns filter"],
  cfzt: ["cloudflare"],
  site: ["squarespace", "wix", "website", "web site", "web hosting", "hosting"],
  webflow: ["webflow"],
  domain: ["domain", "dns", "godaddy", "namecheap"],
};

function matchApps(names: string[] | undefined): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of names ?? []) {
    const n = raw.toLowerCase().replace(/\s+/g, " ").trim();
    if (!n) continue;
    // Longest phrase wins, so "microsoft teams" beats "microsoft 365" and "google docs" beats "google".
    let best: { id: string; len: number } | null = null;
    for (const [id, words] of Object.entries(APP_WORDS)) {
      for (const w of words) {
        const hit = n === w || n.includes(w) || (w.length > 4 && w.includes(n));
        if (hit && (!best || w.length > best.len)) best = { id, len: w.length };
      }
    }
    if (!best) {
      const byName = SERVICES.find(s => s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase()));
      if (byName) best = { id: byName.id, len: 1 };
    }
    if (best) { if (!ids.includes(best.id)) ids.push(best.id); } else unknown.push(raw.trim());
  }
  return { ids, unknown };
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** The calculator's state in one paragraph, every number exactly as the page shows it. */
function describeCalc(selected: Set<string>, users: number, billing: Billing, plan: Plan, notCovered: string[] = []): CalcResult {
  const c = computeCalc(selected, users, billing, plan);
  const apps = SERVICES.filter(s => selected.has(s.id))
    .map(s => `${s.name} (${s.flatMonth != null ? `$${s.flatMonth} a month` : `$${s.pricePerSeatMonth} a seat`})`);
  const parts = [
    `On screen: ${users} ${users === 1 ? "person" : "people"}, billed ${billing === "annual" ? "annually" : "monthly"}, ${plan === "managed" ? `Managed plan ($${MANAGED_MONTHLY} a month)` : "Self-hosted plan ($0 a month)"}.`,
    apps.length ? `Apps checked: ${apps.join(", ")}.` : "No apps are checked yet.",
    `Today they pay about ${money(c.stackMonthly)} a month, ${money(c.stackThreeYear)} over 3 years.`,
    `Bestly Cloud: ${money(BESTLY_HARDWARE)} startup${c.bestlyMonthly ? ` plus ${money(c.bestlyMonthly)} a month` : ""}, ${money(c.ownThreeYear)} over 3 years.`,
  ];
  if (c.savings >= 0) {
    parts.push(`3-year savings: ${money(c.savings)} (${c.savingsPct}% less), about ${money(Math.max(0, c.monthlySaved))} a month back.`);
    if (c.paybackMonths != null && c.paybackMonths <= 36) parts.push(`The startup cost pays for itself in about ${c.paybackMonths} months, then they own it.`);
  } else {
    parts.push(`At this size their subscriptions cost less than Bestly Cloud over 3 years, so there are no savings yet.${c.breakevenUsers != null && c.breakevenUsers <= 50 ? ` Teams like this usually come out ahead around ${c.breakevenUsers}+ people.` : ""}`);
  }
  if (notCovered.length) parts.push(`Not in the calculator (Bestly Cloud does not replace these, so they are not counted): ${notCovered.join(", ")}.`);
  return { say: parts.join(" "), notCovered };
}

// ── Component ──────────────────────────────────────────────────────────────
export function InteractivePricingCalculator() {
  const [users, setUsers] = useState(12);
  const [billing, setBilling] = useState<"annual" | "monthly">("annual");
  const [plan, setPlan] = useState<"managed" | "selfhosted">("managed");
  const [showMorePlans, setShowMorePlans] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(SERVICES.filter(s => s.defaultChecked).map(s => s.id))
  );
  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const calc = useMemo(() => computeCalc(selected, users, billing, plan), [selected, users, billing, plan]);

  // ── Maya can drive this calculator (calcBridge.ts) ─────────────────────────
  const sectionRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const live = useRef({ selected, users, billing, plan });
  live.current = { selected, users, billing, plan };
  const byMaya = useRef(false);
  const slideRaf = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Move the slider the way a hand would, so the visitor sees it travel (not a jump).
    const slideTo = (target: number) => new Promise<void>((resolve) => {
      cancelAnimationFrame(slideRaf.current);
      const from = live.current.users;
      if (reduce || from === target) { setUsers(target); resolve(); return; }
      const t0 = performance.now();
      const dur = Math.min(1100, 250 + Math.abs(target - from) * 25);
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        setUsers(Math.round(from + (target - from) * e));
        if (k < 1) slideRaf.current = requestAnimationFrame(step); else resolve();
      };
      slideRaf.current = requestAnimationFrame(step);
    });

    return registerCalc({
      // The headline savings card (top of the results column): centering it keeps the slider in view too.
      element: () => (resultRef.current?.firstElementChild as HTMLElement | null) ?? resultRef.current ?? sectionRef.current,
      read: () => describeCalc(live.current.selected, live.current.users, live.current.billing, live.current.plan),
      apply: async (change: CalcChange) => {
        byMaya.current = true;
        const notCovered: string[] = [];
        let next = new Set(live.current.selected);
        if (change.only) {
          const m = matchApps(change.only);
          notCovered.push(...m.unknown);
          if (m.ids.length) next = new Set(m.ids);
        }
        if (change.add) { const m = matchApps(change.add); notCovered.push(...m.unknown); m.ids.forEach(id => next.add(id)); }
        if (change.remove) { const m = matchApps(change.remove); m.ids.forEach(id => next.delete(id)); }
        const nextUsers = change.teamSize ? Math.max(1, Math.min(50, Math.round(change.teamSize))) : live.current.users;
        const nextBilling = change.billing ?? live.current.billing;
        const nextPlan = change.plan ?? live.current.plan;
        if (nextPlan === "selfhosted") setShowMorePlans(true);
        setSelected(next);
        setBilling(nextBilling);
        setPlan(nextPlan);
        await slideTo(nextUsers);
        setTimeout(() => { byMaya.current = false; }, 400);
        const r = describeCalc(next, nextUsers, nextBilling, nextPlan, notCovered);
        if (change.teamSize && change.teamSize > 50) {
          r.say += " The calculator stops at 50 people; one Bestly Cloud server covers up to 50, so bigger teams get a custom quote on a call.";
        }
        return r;
      },
    });
  }, []);

  // The visitor changed it by hand: tell Maya (debounced), so she keeps up.
  useEffect(() => {
    if (byMaya.current) return;
    const t = setTimeout(() => {
      window.dispatchEvent(new CustomEvent(CALC_CHANGED, { detail: describeCalc(selected, users, billing, plan).say }));
    }, 1200);
    return () => clearTimeout(t);
  }, [selected, users, billing, plan]);

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const grouped = SERVICES.reduce((acc, s) => {
    (acc[s.category] ||= []).push(s);
    return acc;
  }, {} as Record<string, Service[]>);

  const priceLabel = (s: Service) =>
    s.flatMonth != null ? `$${s.flatMonth}/mo` : `$${s.pricePerSeatMonth}/seat`;

  return (
    <section id="savings" ref={sectionRef} className="scroll-mt-20 border-t border-border">
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

              <div className="pt-3 border-t border-border">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                  Your Bestly plan
                </p>
                <div className="space-y-2">
                  <label
                    className={`block cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                      plan === "managed" ? "border-primary/60 bg-primary/5" : "border-border bg-background hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
                        <input
                          type="radio"
                          name="bestlyPlan"
                          checked={plan === "managed"}
                          onChange={() => setPlan("managed")}
                          className="h-4 w-4 accent-[hsl(var(--gradient-end))]"
                        />
                        Managed
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          Recommended
                        </span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-foreground">${MANAGED_MONTHLY}/mo</span>
                    </div>
                    <p className="mt-1 pl-6 text-xs text-muted-foreground leading-relaxed">
                      We run it for you: monitoring, updates, backups, and priority support included.
                      Flat — never per-seat. Plus the {fmt(BESTLY_HARDWARE)} startup cost.
                    </p>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowMorePlans((v) => !v)}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                    aria-expanded={showMorePlans || plan === "selfhosted"}
                  >
                    <span>More plans</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showMorePlans || plan === "selfhosted" ? "rotate-180" : ""}`} />
                  </button>
                  {(showMorePlans || plan === "selfhosted") && (
                    <label
                      className={`block cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                        plan === "selfhosted" ? "border-primary/60 bg-primary/5" : "border-border bg-background hover:border-primary/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
                          <input
                            type="radio"
                            name="bestlyPlan"
                            checked={plan === "selfhosted"}
                            onChange={() => setPlan("selfhosted")}
                            className="h-4 w-4 accent-[hsl(var(--gradient-end))]"
                          />
                          Self-hosted
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-foreground">$0/mo</span>
                      </div>
                      <p className="mt-1 pl-6 text-xs text-muted-foreground leading-relaxed">
                        You own and run it after the {fmt(BESTLY_HARDWARE)} startup cost. Need a hand? On-demand
                        support is <span className="font-semibold text-foreground">{fmt(ON_DEMAND_CALL)} per call</span> — pay only when you use it.
                      </p>
                    </label>
                  )}
                </div>
              </div>
            </div>
          </GlowCard>

          {/* Right: live output */}
          <div ref={resultRef} className="space-y-4">
            <GlowCard className="!p-6 lg:!p-8 text-center">
              {/* The device's glow brightens with your savings */}
              <div className="mx-auto -mt-2 mb-1 h-32 w-44" aria-hidden="true">
                <DeviceSavingsMini intensity={Math.min(1, Math.max(0, calc.savingsPct / 90))} />
              </div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Your 3-year savings
              </p>
              {calc.savings >= 0 ? (
                <>
                  <p className="mt-3 text-5xl sm:text-6xl font-semibold tracking-tight">
                    <GradientText as="span">
                      <AnimatedNumber value={calc.savings} format={fmt} />
                    </GradientText>
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {calc.savingsPct}% less over 3 years than renting Google Workspace and the rest of your stack — and you own the server.
                    {plan === "managed" && " Monitoring, updates, and support already counted."}
                  </p>
                  {calc.monthlySaved > 0 && (
                    <p className="mt-3 inline-block rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-foreground">
                      About {fmt(calc.monthlySaved)}/mo back in your pocket
                    </p>
                  )}
                  {calc.paybackMonths != null && calc.paybackMonths <= 36 && (
                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                      The startup cost pays for itself in about{" "}
                      <span className="font-semibold text-foreground">
                        {calc.paybackMonths} month{calc.paybackMonths === 1 ? "" : "s"}
                      </span>{" "}
                      from what you stop renting{plan === "managed" ? " — even after the subscription" : ""}. After that, you own it.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                    A bit small to save — yet
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    At {users} {users === 1 ? "person" : "people"}, your subscriptions total less than Bestly Cloud over 3 years.
                    {calc.breakevenUsers != null && calc.breakevenUsers <= 50
                      ? <> Most teams come out ahead around {calc.breakevenUsers}+ people — add the tools you really pay for, or check back as you grow.</>
                      : <> Add the tools you actually pay for to see your real number.</>}
                  </p>
                </>
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
                  Bestly Cloud · {plan === "managed" ? "Managed" : "Self-hosted"}
                </p>
                {plan === "managed" ? (
                  <>
                    <p className="mt-3 text-xl font-semibold text-foreground tabular-nums">
                      ${MANAGED_MONTHLY}/mo <span className="text-xs text-muted-foreground font-normal">flat · never per-seat</span>
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      + {fmt(calc.bestlyOneTime)} startup · we run it for you
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-xl font-semibold text-foreground tabular-nums">
                      {fmt(calc.bestlyOneTime)} <span className="text-xs text-muted-foreground font-normal">one-time · you own it</span>
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Self-hosted · $0/mo, no per-seat fees
                    </p>
                  </>
                )}
                <p className="mt-3 text-sm font-medium text-foreground tabular-nums">
                  {fmt(calc.ownThreeYear)}{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    over 3 years{plan === "selfhosted" ? <> · {fmt(ON_DEMAND_CALL)}/call only if you need help</> : <> · support included</>}
                  </span>
                </p>
              </GlowCard>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Subscription prices are 2026 list at annual billing; the Monthly toggle reflects the
              ~20% premium most vendors charge month-to-month. Savings compare your subscriptions to
              Bestly Cloud on the plan you pick: Managed is ${MANAGED_MONTHLY}/mo flat (monitoring, updates,
              backups, support — never per-seat) plus the {fmt(BESTLY_HARDWARE)} startup cost; Self-hosted is
              the startup cost only, $0/mo, with on-demand support ({fmt(ON_DEMAND_CALL)}/call) pay-as-you-go and
              never part of the monthly math. AI runs locally for $0; add your own key for Claude, GPT,
              or Gemini only if you want hosted models. One server covers a team of up to 50. Your data
              stays on your hardware — Bestly never sells or shares it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
