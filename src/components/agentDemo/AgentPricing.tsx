/**
 * Pricing on /agent (#pricing): three plans, the plan picker and the checkout card. Plan: docs/maya-sales-opusplan.md.
 *
 * Every number comes from supabase/functions/_shared/agent-plans.ts (the one source of prices). Maya drives this section through
 * planBridge.ts the way she drives the savings calculator: she moves the picker, chooses a plan, opens the checkout card and
 * types the visitor's details in. She never presses Pay; that is the visitor's own tap.
 * Copy is for someone who has never heard of the product. No made-up numbers, no "most popular" claims (nobody has bought yet).
 */
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Button } from "@/components/ui/button";
import { AGENT_PLANS, AGENT_TERMS, centsLabel, dollars, planById, recommendPlan, type AgentPlanId } from "../../../supabase/functions/_shared/agent-plans";
import { createFillGuard, noteManualEdit, runSteps, spoken, describeForm, type FillStep } from "@/components/maya/formBridge";
import { AgentPlanPicker } from "./AgentPlanPicker";
import { AgentCheckoutCard } from "./AgentCheckoutCard";
import { CHECKOUT_FIELD_IDS, missingFor, type CheckoutFields } from "./pricingText";
import { PLAN_CHANGED, registerPlans, type CheckoutValues, type PlanApi, type PlanUsage } from "./planBridge";
import { DEFAULT_USAGE, describeUsage, minutesOf, readBackSpoken, type Usage } from "./pricingText";

const nw = (s: string) => <span className="whitespace-nowrap">{s}</span>;
const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const EMPTY: CheckoutFields = { name: "", email: "", company: "", phone: "" };

export function AgentPricing() {
  const [usage, setUsageState] = useState<Usage>(DEFAULT_USAGE);
  const [chosen, setChosen] = useState<AgentPlanId | null>(null);
  const [fields, setFields] = useState<CheckoutFields>(EMPTY);
  const sectionRef = useRef<HTMLElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const live = useRef({ usage, chosen, fields });
  live.current = { usage, chosen, fields };
  const guard = useRef(createFillGuard()).current;
  const byMaya = useRef(false);
  const announceTimer = useRef<ReturnType<typeof setTimeout>>();
  const openedByVisitor = useRef(false);

  const minutes = minutesOf(usage);
  const rec = recommendPlan(minutes);

  // ---- Maya (planBridge.ts) ----
  const sayNow = (): string => {
    const { usage: u, chosen: c, fields: f } = live.current;
    const base = describeUsage(u).say;
    if (!c) return base;
    const miss = missingFor(f);
    return `${base} Plan chosen: ${planById(c).name}. ${miss.length ? `The checkout card is open; still needed: ${miss.join(", ")}.` : "The checkout card is filled in."}`;
  };

  // The visitor changed something by hand: tell Maya (debounced), so she keeps up.
  const announce = () => {
    if (byMaya.current) return;
    clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent(PLAN_CHANGED, { detail: sayNow() }));
      } catch { /* never let an announcement break the page */ }
    }, 1200);
  };

  const setUsage = (u: Usage) => { setUsageState(u); announce(); };
  const choose = (id: AgentPlanId) => {
    openedByVisitor.current = true;
    setChosen(id);
    announce();
  };

  // Bring the checkout card into view and focus the first field when the visitor opens it.
  useEffect(() => {
    if (!chosen || !openedByVisitor.current) return;
    openedByVisitor.current = false;
    const t = setTimeout(() => {
      const card = document.getElementById("plan-checkout");
      card?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
      (document.getElementById(CHECKOUT_FIELD_IDS.name) as HTMLInputElement | null)?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(t);
  }, [chosen]);

  useEffect(() => {
    const valueOf = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    const read = () => ({
      name: valueOf(CHECKOUT_FIELD_IDS.name), email: valueOf(CHECKOUT_FIELD_IDS.email),
      company: valueOf(CHECKOUT_FIELD_IDS.company), phone: valueOf(CHECKOUT_FIELD_IDS.phone),
    });
    const flagMaya = () => { byMaya.current = true; setTimeout(() => { byMaya.current = false; }, 500); };
    const waitFor = async (id: string, ms = 2000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const el = document.getElementById(id);
        if (el) return el;
        await sleep(60);
      }
      return null;
    };

    const api: PlanApi = {
      element: (which) => (which === "pricing" ? sectionRef.current : which === "picker" ? pickerRef.current : document.getElementById("plan-checkout")),
      read: () => ({ say: sayNow() }),
      setUsage: (v: PlanUsage) => {
        flagMaya();
        const cur = live.current.usage;
        const num = (n: unknown) => (n == null || n === "" || !Number.isFinite(Number(n)) ? undefined : Number(n));
        const minutesIn = num(v.minutes);
        const calls = num(v.callsPerDay);
        const avg = num(v.avgMinutes);
        const next: Usage = minutesIn != null
          ? { calls: cur.calls, avg: cur.avg, override: Math.max(0, Math.min(1_000_000, Math.round(minutesIn))) }
          : { calls: Math.max(0, Math.min(500, Math.round(calls ?? cur.calls))), avg: Math.max(0, Math.min(60, Math.round((avg ?? cur.avg) * 10) / 10)), override: cur.override != null && calls == null && avg == null ? cur.override : null };
        live.current.usage = next;
        setUsageState(next);
        return describeUsage(next);
      },
      choose: (plan) => {
        flagMaya();
        live.current.chosen = plan;
        setChosen(plan);
        const p = planById(plan);
        return { say: `The ${p.name} plan is chosen and the checkout card is open under it: ${readBackSpoken(plan)}.` };
      },
      fillCheckout: async (v: CheckoutValues) => {
        flagMaya();
        if (!live.current.chosen) return { say: "No plan is chosen yet. Choose one first.", missing: ["plan"] };
        await waitFor(CHECKOUT_FIELD_IDS.name);
        const text = (s: unknown, max: number) => (s == null ? undefined : String(s).replace(/\s+/g, " ").trim().slice(0, max));
        const name = text(v.name, 100);
        const email = text(v.email, 255)?.toLowerCase();
        const company = text(v.company, 120);
        const phone = text(v.phone, 40);
        const steps: FillStep[] = [];
        const add = (key: keyof CheckoutFields, label: string, next: string | undefined) => {
          if (!next) return;
          const id = CHECKOUT_FIELD_IDS[key];
          steps.push({ id, label, el: () => document.getElementById(id), get: () => valueOf(id), next, text: true });
        };
        add("name", "name", name);
        add("email", "email", email);
        add("company", "business name", company);
        add("phone", "phone", phone);
        const out = await runSteps(guard, steps);
        await sleep(40);
        const f = read();
        const miss = missingFor(f);
        const picked = live.current.chosen;
        const say = [
          picked ? `The plan on the card: ${readBackSpoken(picked)}.` : "",
          out.filled.length ? `Typed into the checkout card: ${out.filled.join(", ")}.` : "Nothing new to type.",
          out.replaced.length ? `That replaced what the visitor had typed in ${out.replaced.join(", ")}; say so.` : "",
          out.kept.length ? `Left ${out.kept.join(", ")} as the visitor typed it.` : "",
          describeForm(
            [{ label: "name", value: f.name }, { label: "email", value: f.email }, { label: "business name", value: f.company }, { label: "phone", value: f.phone }],
            miss, ["phone"],
          ),
          f.phone.trim() ? `The phone number as spoken: ${spoken("phone", f.phone)}.` : "",
        ];
        return { say: say.filter(Boolean).join(" "), missing: miss };
      },
    };
    return registerPlans(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onField = (key: keyof CheckoutFields, value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    noteManualEdit(guard, CHECKOUT_FIELD_IDS[key], () => sayNow());
  };

  const chosenIdx = chosen ? AGENT_PLANS.findIndex((p) => p.id === chosen) : -1;

  return (
    <section id="pricing" ref={sectionRef} className="scroll-mt-20 overflow-x-clip border-b border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Pricing</p>
          <h2 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] [word-spacing:0.04em] text-foreground sm:text-4xl">Simple monthly plans.</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            You pay one price a month. It includes a set number of minutes of calls. If you go over, extra minutes are billed on your next bill. We set everything up for you.
          </p>
        </AnimatedSection>

        <div className="grid gap-6 lg:grid-cols-3">
          {AGENT_PLANS.map((p, i) => {
            const isFit = rec.plan.id === p.id;
            const isChosen = chosen === p.id;
            return (
              <div key={p.id} className="relative" style={{ order: i * 2 }}>
                {isFit && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-6"
                    style={{ background: "radial-gradient(closest-side, hsl(var(--primary) / 0.12), hsl(var(--primary) / 0.04) 60%, transparent)" }}
                  />
                )}
                <div
                  className={`relative flex h-full flex-col rounded-2xl border bg-card p-7 transition-[border-color,box-shadow] duration-300 motion-reduce:transition-none ${isChosen ? "border-primary shadow-lg ring-1 ring-primary/40" : isFit ? "border-primary/40 shadow-md" : "border-border"}`}
                  data-plan={p.id}
                  data-fit={isFit ? "true" : undefined}
                >
                  <div className="flex min-h-[28px] items-center justify-between gap-2">
                    <h3 className="font-modern text-2xl font-semibold tracking-[-0.015em] text-foreground">{p.name}</h3>
                    {isFit && <span className="whitespace-nowrap rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Best fit for your calls</span>}
                  </div>
                  <p className="mt-2 text-muted-foreground">{p.blurb}</p>
                  <p className="mt-6">
                    <span className="whitespace-nowrap">
                      <span className="font-modern text-5xl font-semibold tracking-[-0.03em] tabular-nums text-foreground">{dollars(p.monthlyCents)}</span>{" "}
                      <span className="text-base text-muted-foreground">/month</span>
                    </span>
                  </p>
                  <ul className="mt-6 space-y-3 text-foreground">
                    <li className="flex items-start gap-2.5">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>{nw(`${p.includedMinutes} minutes`)} of calls included</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>Extra minutes {nw(centsLabel(p.extraCentsPerMinute))} each</span>
                    </li>
                  </ul>
                  <Button
                    className="mt-8 min-h-[44px] w-full"
                    variant={isFit || isChosen ? "default" : "outline"}
                    aria-pressed={isChosen}
                    aria-controls={isChosen ? "plan-checkout" : undefined}
                    onClick={() => choose(p.id)}
                  >
                    {isChosen ? `${p.name} chosen` : `Choose ${p.name}`}
                  </Button>
                </div>
              </div>
            );
          })}

          {chosen && (
            // On a phone it sits right under the plan that was chosen; on a wide screen, under all three.
            <div className="lg:col-span-3 lg:!order-10" style={{ order: chosenIdx * 2 + 1 }}>
              <AgentCheckoutCard plan={chosen} fields={fields} onField={onField} onClose={() => { setChosen(null); announce(); }} />
            </div>
          )}
        </div>

        <ul className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3 text-foreground" aria-label="What every plan promises">
          <li className="flex min-h-[44px] items-center gap-2"><Check className="h-4 w-4 text-primary" aria-hidden="true" /> {AGENT_TERMS.setupFeeCents === 0 ? "No setup fee" : `${dollars(AGENT_TERMS.setupFeeCents)} setup fee`}</li>
          <li className="flex min-h-[44px] items-center gap-2"><Check className="h-4 w-4 text-primary" aria-hidden="true" /> {nw(`${AGENT_TERMS.moneyBackDays}-day`)} money back</li>
          <li className="flex min-h-[44px] items-center gap-2"><Check className="h-4 w-4 text-primary" aria-hidden="true" /> Cancel anytime</li>
        </ul>

        <div ref={pickerRef}>
          <AgentPlanPicker usage={usage} minutes={minutes} setUsage={setUsage} onChoose={choose} />
        </div>
      </div>
    </section>
  );
}
