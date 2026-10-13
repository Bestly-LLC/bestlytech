/**
 * "Not sure which plan?" picker on /agent#pricing. Two plain questions (calls a day, minutes a call), then the plan that costs
 * the least for those minutes and what the other two would cost. All maths comes from supabase/functions/_shared/agent-plans.ts.
 * Maya drives it through planBridge.ts; the visitor can always change it by hand.
 */
import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { centsLabel, dollars, recommendPlan, type AgentPlanId } from "../../../supabase/functions/_shared/agent-plans";
import { breakdownFor, type Usage } from "./pricingText";

const nw = (s: string) => <span className="whitespace-nowrap">{s}</span>;

function Stepper({ id, label, unit, value, min, max, decimals, onChange }: {
  id: string; label: string; unit: string; value: number; min: number; max: number; decimals?: boolean; onChange: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const clamp = (n: number) => Math.min(max, Math.max(min, decimals ? Math.round(n * 10) / 10 : Math.round(n)));
  // Follow the value when it moves from outside (Maya, or the other buttons) but never fight the visitor mid-typing.
  useEffect(() => {
    const parsed = parseFloat(text);
    if (!(Number.isFinite(parsed) && parsed === value) && !(text === "" && value === min)) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const btn = "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground transition-[transform,background-color] duration-100 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95 disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100";
  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium text-foreground">{label}</label>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={btn} aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => { const n = clamp(value - 1); setText(String(n)); onChange(n); }}>
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          id={id}
          inputMode={decimals ? "decimal" : "numeric"}
          autoComplete="off"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, "");
            setText(raw);
            const n = parseFloat(raw);
            onChange(Number.isFinite(n) ? clamp(n) : min);
          }}
          onBlur={() => setText(String(value))}
          className="h-11 w-20 rounded-xl border border-input bg-background text-center text-xl font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <button type="button" className={btn} aria-label={`More: ${label}`} disabled={value >= max} onClick={() => { const n = clamp(value + 1); setText(String(n)); onChange(n); }}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="whitespace-nowrap text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

export function AgentPlanPicker({ usage, minutes, setUsage, onChoose }: {
  usage: Usage;
  minutes: number;
  setUsage: (u: Usage) => void;
  onChoose: (id: AgentPlanId) => void;
}) {
  const rec = recommendPlan(minutes);
  const b = breakdownFor(rec.plan, minutes);
  return (
    <div id="plan-picker" className="mx-auto mt-14 max-w-4xl scroll-mt-24">
      <h3 className="font-modern text-2xl font-semibold tracking-[-0.015em] text-foreground sm:text-3xl">Not sure which plan? Tell us about your calls.</h3>
      <p className="mt-2 text-muted-foreground">A rough guess is fine. You can change plans any time.</p>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_1fr] md:gap-10">
        <div className="space-y-7">
          <Stepper id="plan-calls" label="About how many calls a day?" unit="calls a day" value={usage.calls} min={0} max={500}
            onChange={(n) => setUsage({ calls: n, avg: usage.avg, override: null })} />
          <Stepper id="plan-avg" label="About how long is a call?" unit="minutes" value={usage.avg} min={0} max={60} decimals
            onChange={(n) => setUsage({ calls: usage.calls, avg: n, override: null })} />
          <p className="text-lg text-foreground" aria-live="polite" data-testid="plan-minutes">
            About <strong className="whitespace-nowrap font-semibold tabular-nums">{Math.ceil(minutes).toLocaleString("en-US")} minutes</strong> a month
          </p>
          <p className="-mt-5 text-sm text-muted-foreground">
            {usage.override != null ? "From the total you gave." : "Based on 22 business days a month."} A minute is time on a call, rounded up.
          </p>
        </div>

        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-8"
            style={{ background: "radial-gradient(closest-side, hsl(var(--primary) / 0.13), hsl(var(--primary) / 0.05) 60%, transparent)" }}
          />
          <div className="relative rounded-2xl border border-primary/25 bg-card p-6 shadow-sm" data-testid="plan-fit">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">Best fit</p>
            <p className="mt-2 font-modern text-3xl font-semibold tracking-[-0.02em] text-foreground">
              {rec.plan.name}, about {nw(`${dollars(rec.cents)} a month`)}
            </p>
            <p className="mt-2 text-muted-foreground">
              {b.extra === 0
                ? <>All {nw(`${Math.ceil(minutes)} minutes`)} are included.</>
                : <>
                    {nw(dollars(rec.plan.monthlyCents))} covers the first {nw(`${rec.plan.includedMinutes} minutes`)}. The other {nw(`${b.extra.toLocaleString("en-US")} minutes`)} are {nw(centsLabel(rec.plan.extraCentsPerMinute))} each, {nw(dollars(b.extraCents))} more.
                  </>}
            </p>
            <Button className="mt-5 min-h-[44px]" onClick={() => onChoose(rec.plan.id)}>Choose {rec.plan.name}</Button>

            <h4 className="mt-6 text-sm font-semibold text-foreground">The other plans for the same minutes</h4>
            <ul className="mt-1 divide-y divide-border">
              {rec.alternatives.sort((a, c) => a.plan.monthlyCents - c.plan.monthlyCents).map((q) => (
                <li key={q.plan.id} className="flex min-h-[44px] items-center justify-between gap-3 py-2 text-foreground">
                  <span>{q.plan.name}</span>
                  <span className="whitespace-nowrap tabular-nums text-muted-foreground">about {dollars(q.cents)} a month</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
