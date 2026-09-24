/**
 * Turo settings > "How guests use their page": for each trip, which steps the guest got through
 * (link sent → opened → tapped key → key added → set up at the car → returned), and across trips,
 * the step where guests stop most. Data: turo_guest_funnel().
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { card, label, pill, secondary, separator, tertiary, tint } from "./laxUi";

type Step = { id: string; label: string; at: string | null; count?: number; late_min?: number | null; guessed?: boolean };
type Trip = { reservation_id: number; guest: string; kind: "home" | "lax"; starts_at: string; ends_at: string; phase: "upcoming" | "on_trip" | "ended"; steps: Step[]; asked: number; resends: number };

const H = 3600e3;
const t12 = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

/** When each step should be done by. Past that and still not done = stuck. */
function dueBy(id: string, t: Trip): number | null {
  const s = +new Date(t.starts_at), e = +new Date(t.ends_at);
  return ({ sent: s - 48 * H, opened: s - 2 * H, tapped: s, added: s, setup: s + H, returned: e + 0.5 * H } as Record<string, number>)[id] ?? null;
}
/** A step is skipped when a later one is done (e.g. you added the guest in the Tesla app yourself). */
const skipped = (t: Trip, i: number) => !t.steps[i].at && t.steps.slice(i + 1).some((s) => s.at);
function stuckAt(t: Trip): Step | null {
  const now = Date.now();
  for (const [i, st] of t.steps.entries()) {
    if (st.at || skipped(t, i)) continue;
    const due = dueBy(st.id, t);
    return due != null && now > due ? st : null;
  }
  return null;
}

export function GuestFunnel() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (supabase.rpc("turo_guest_funnel" as never, { p_days: 120 } as never) as unknown as Promise<{ data: { trips: Trip[] } | null; error: { message: string } | null }>)
      .then(({ data, error }) => { if (error) setErr(error.message); else setTrips(data?.trips ?? []); });
  }, []);

  // Across trips that should have finished each step: how many did.
  const summary = useMemo(() => {
    if (!trips?.length) return null;
    const ids = trips[0].steps.map((s) => ({ id: s.id, label: s.label }));
    const rows = ids.map(({ id, label: l }) => {
      const due = trips.filter((t) => { const d = dueBy(id, t); const i = t.steps.findIndex((s) => s.id === id); return d != null && Date.now() > d && !skipped(t, i); });
      const done = due.filter((t) => t.steps.find((s) => s.id === id)?.at);
      return { id, label: l, done: done.length, of: due.length };
    });
    const stops = new Map<string, number>();
    for (const t of trips) { const s = stuckAt(t); if (s) stops.set(s.label, (stops.get(s.label) ?? 0) + 1); }
    const worst = [...stops.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    return { rows, worst };
  }, [trips]);

  if (err) return <div className={cn(card, "text-[14px]", tint.orange)}>Couldn't load guest steps: {err}</div>;
  if (!trips) return <div className={cn(card, "h-40 animate-pulse")} />;
  if (!trips.length) return <div className={cn(card, "text-[14px]", secondary)}>No guest pages in the last 120 days.</div>;

  return (
    <div className={cn(card, "space-y-4")} id="guest-steps">
      {summary && (
        <div>
          <p className={cn("text-[15px] font-semibold", label)}>
            {summary.worst ? <>Guests most often stop at <span className={tint.orange}>{summary.worst[0]}</span></> : "No guest is stuck right now"}
          </p>
          <ol className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {summary.rows.map((r) => (
              <li key={r.id} className="rounded-[14px] bg-[#2C2C2E] px-2.5 py-2 bento:bg-[#7676801a]">
                <p className={cn("text-[20px] font-semibold tabular-nums leading-none", label)}>{r.of ? `${r.done}/${r.of}` : "–"}</p>
                <p className={cn("mt-1 text-[12px] leading-tight", secondary)}>{r.label}</p>
              </li>
            ))}
          </ol>
          <p className={cn("mt-2 text-[12px]", tertiary)}>Counts only trips that have reached the time each step should be done.</p>
        </div>
      )}

      <ul className={cn("divide-y", separator)}>
        {trips.map((t) => {
          const stuck = stuckAt(t);
          return (
            <li key={t.reservation_id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className={cn("text-[15px] font-semibold", label)}>
                  {t.guest} <span className={cn("font-normal", secondary)}>· {t.kind === "lax" ? "LAX" : "Home"} · {day(t.starts_at)} – {day(t.ends_at)}</span>
                </p>
                <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", stuck ? pill.orange : t.phase === "ended" ? pill.green : pill.blue)}>
                  {stuck ? `Stuck: ${stuck.label}` : t.phase === "upcoming" ? "Upcoming" : t.phase === "on_trip" ? "On trip" : "Done"}
                </span>
              </div>
              <ol className="mt-2 flex flex-wrap gap-x-1 gap-y-1.5" aria-label={`${t.guest}'s steps`}>
                {t.steps.map((s, i) => {
                  const due = dueBy(s.id, t);
                  const skip = skipped(t, i);
                  const overdue = !s.at && !skip && due != null && Date.now() > due;
                  return (
                    <li key={s.id} title={s.guessed ? `${s.label}: likely done (she drove the car; Set Up tracking started after this trip began)` : s.at ? `${s.label}: ${t12(s.at)}${s.count && s.count > 1 ? ` (${s.count}×)` : ""}` : due ? `${s.label}: expected by ${t12(new Date(due).toISOString())}` : s.label}
                      className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium",
                        s.at ? pill.green : overdue ? pill.orange : "bg-[#2C2C2E] text-[#EBEBF599] bento:bg-[#7676801a] bento:text-[#3C3C4399]")}>
                      {s.at ? <Check className="h-3.5 w-3.5" aria-hidden /> : overdue ? <Clock className="h-3.5 w-3.5" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
                      {s.label}{skip ? " · skipped" : ""}{s.guessed ? " · likely" : ""}
                      {s.id === "returned" && s.late_min ? ` · ${s.late_min} min late` : ""}
                      <span className="sr-only">{s.at ? `done ${t12(s.at)}` : overdue ? "not done, overdue" : "not yet"}</span>
                    </li>
                  );
                })}
              </ol>
              {(t.asked > 0 || t.resends > 0) && (
                <p className={cn("mt-1.5 text-[12px]", tertiary)}>
                  {[t.asked ? `Asked the AI ${t.asked}×` : null, t.resends ? `Key resent ${t.resends}×` : null].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
