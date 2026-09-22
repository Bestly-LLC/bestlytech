/**
 * /admin/turo — Turo Watch for Blue Steel (Tesla Model 3, vehicle 2522178).
 * Reads turo_runs / turo_day_prices / turo_comps, written by scripts/turo_watch.py.
 *
 * The runner lives on the Mac mini (~/TuroWatch, launchd tech.bestly.turo-watch) but its
 * schedule is OFF: Turo's Cloudflare blocks automated browsers, and we do not work around
 * bot protection. Until there is an allowed way in, a run is a person (or Claude in Jared's
 * own Chrome) and this page shows what the last run saw and proposed.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Car, CheckCircle2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { cn } from "@/lib/utils";

interface Run {
  id: string; ran_at: string; runner: string; mode: string; market_base: number | null; host_net: number | null;
  comp_n: number | null; ceiling: number | null; days_written: number; days_verified: number; days_blocked: number;
  gates: { gate: string; result: string; detail: string }[] | null; notes: string | null;
}
interface Day { run_id: string; date: string; lead: number | null; floor: number | null; cur: number | null; proposed: number | null; applied: number | null; verified: boolean | null; status: string; gate: string | null; reason: string | null }

const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const money = (n: number | null | undefined) => (n == null ? "–" : `$${Math.round(Number(n))}`);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const dayLabel = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const MODE: Record<string, { label: string; tone: string }> = {
  applied: { label: "Prices written", tone: "text-emerald-300 bento:text-emerald-700" },
  "propose-only": { label: "Proposed only", tone: "text-amber-300 bento:text-amber-700" },
  blocked: { label: "Blocked", tone: "text-red-300 bento:text-red-700" },
};

export default function AdminTuro() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [days, setDays] = useState<Day[]>([]);

  useEffect(() => {
    (async () => {
      const { data: r } = await supabase.from("turo_runs" as never).select("*").order("ran_at", { ascending: false }).limit(30);
      const list = (r ?? []) as unknown as Run[];
      setRuns(list);
      const withPlan = list.slice(0, 10).map((x) => x.id);
      if (withPlan.length) {
        const { data: d } = await supabase.from("turo_day_prices" as never).select("*").in("run_id", withPlan).order("date");
        setDays((d ?? []) as unknown as Day[]);
      }
    })();
  }, []);

  const last = runs?.[0];
  const lastPlanRun = useMemo(() => runs?.find((r) => days.some((d) => d.run_id === r.id && d.proposed != null)), [runs, days]);
  const plan = days.filter((d) => d.run_id === lastPlanRun?.id);
  const lastWrite = runs?.find((r) => r.mode === "applied");
  const hoursSince = last ? (Date.now() - Date.parse(last.ran_at)) / 3600e3 : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <PageHeader title="Turo Watch" description="Blue Steel · Tesla Model 3 · twice-daily pricing against nearby Model 3s." />

      {/* Status */}
      <section className={cn(card, "space-y-3 p-5")}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300 bento:text-amber-600" />
          <div className="space-y-1.5 text-[0.95rem] text-white/80">
            <p className="font-semibold text-white">Automatic runs are paused.</p>
            <p>Turo's security service blocks automated browsers, including the Mac mini runner. We don't work around that, since it could flag your account.</p>
            <p className="text-white/60">Until there's an allowed way in, price from the plan below in the Turo app. Your last automatic write was {lastWrite ? when(lastWrite.ran_at) : "never"}.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href="https://turo.com/us/en/trips/calendar" target="_blank" rel="noreferrer" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-white px-4 text-sm font-medium text-black bento:bg-[#111114] bento:text-[#fff]">
            Open Turo calendar <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      {/* Headline numbers */}
      {last && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Last run", hoursSince != null ? (hoursSince < 48 ? `${Math.round(hoursSince)} h ago` : `${Math.round(hoursSince / 24)} days ago`) : "–", MODE[last.mode]?.label ?? last.mode],
            ["Market (renter/day)", money(lastPlanRun?.market_base ?? last.market_base), `${lastPlanRun?.comp_n ?? last.comp_n ?? 0} nearby Model 3s`],
            ["Your net / day", money(lastPlanRun?.host_net ?? last.host_net), "after Turo's cut"],
            ["Ceiling", money(lastPlanRun?.ceiling ?? last.ceiling), "never priced above"],
          ].map(([k, v, sub]) => (
            <div key={k} className={cn(card, "p-4")}>
              <p className="text-xs text-white/50">{k}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-white">{v}</p>
              <p className="mt-0.5 text-xs text-white/45">{sub}</p>
            </div>
          ))}
        </section>
      )}

      {/* Plan */}
      <section>
        <h2 className="mb-2.5 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-widest text-white/55">
          <span>Price plan</span>
          {lastPlanRun && <span className="normal-case tracking-normal text-white/40">from the run on {when(lastPlanRun.ran_at)}</span>}
        </h2>
        {plan.length === 0 ? (
          <p className={cn(card, "px-5 py-4 text-white/60")}>No plan yet.</p>
        ) : (
          <div className={cn(card, "overflow-hidden")}>
            <table className="w-full text-sm">
              <thead className="text-xs text-white/45">
                <tr className="border-b border-white/[0.06]">
                  <th className="px-4 py-2.5 text-left font-medium">Day</th>
                  <th className="px-2 py-2.5 text-right font-medium">Was</th>
                  <th className="px-2 py-2.5 text-right font-medium">Plan</th>
                  <th className="px-2 py-2.5 text-right font-medium">Floor</th>
                  <th className="px-4 py-2.5 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {plan.map((d) => {
                  const past = d.date < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={d.date} className={cn(past && "opacity-45")} title={d.reason ?? ""}>
                      <td className="px-4 py-2.5 text-white">{dayLabel(d.date)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-white/60">{money(d.cur)}</td>
                      <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-white">{money(d.applied ?? d.proposed)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-white/45">{money(d.floor)}</td>
                      <td className="px-4 py-2.5 text-right text-xs">
                        {d.status === "applied" ? <span className="inline-flex items-center gap-1 text-emerald-300 bento:text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Set</span>
                          : <span className="text-white/50">{d.status === "blocked" ? "Not set" : d.status}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="mb-2.5 px-1 text-xs font-semibold uppercase tracking-widest text-white/55">Run history</h2>
        {runs === null ? <div className={cn(card, "h-32 animate-pulse")} /> : (
          <ul className={cn(card, "divide-y divide-white/[0.06] overflow-hidden")}>
            {runs.map((r) => {
              const tripped = (r.gates ?? []).filter((g) => g.result === "TRIPPED").map((g) => g.gate);
              return (
                <li key={r.id} className="px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[0.95rem] text-white"><Car className="h-4 w-4 text-white/40" /> {when(r.ran_at)}</span>
                    <span className={cn("text-xs font-semibold", MODE[r.mode]?.tone ?? "text-white/60")}>{MODE[r.mode]?.label ?? r.mode}</span>
                  </div>
                  <p className="mt-1 text-xs text-white/50">
                    {r.runner} · market {money(r.market_base)} · n={r.comp_n ?? 0}
                    {r.mode === "applied" ? ` · ${r.days_verified}/${r.days_written} days verified` : ""}
                    {tripped.length ? ` · stopped by: ${tripped.join(", ")}` : ""}
                  </p>
                  {r.notes && <p className="mt-1 line-clamp-2 text-xs text-white/40">{r.notes.replace(/^CRASH:.*/s, "Runner crashed (fixed Sept 22).")}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
