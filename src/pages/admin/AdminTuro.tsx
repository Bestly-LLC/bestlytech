/**
 * /admin/turo — Turo Watch for Blue Steel (Tesla Model 3, vehicle 2522178).
 * Reads turo_runs / turo_day_prices / turo_comps, written by scripts/turo_watch.py.
 *
 * Runs are done by Claude: two scheduled tasks (7:05am, 7:12pm LA) drive Jared's own Chrome,
 * where Turo is signed in, and write here. Headless runners are retired (Cloudflare blocks them).
 * This page is the control panel: pause/resume and a note for the next run (turo_settings),
 * price trends (us vs Edgar vs market vs Turo's dynamic price), the price manager, and run history.
 * The runbook Claude follows lives in bestly_private_memory area 'turo' (kept off this page on purpose).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Car, CheckCircle2, ExternalLink, Pause, Play, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { cn } from "@/lib/utils";
import { DemandMeter, type DemandRow } from "@/components/admin/turo/DemandMeter";
import { Competitors, PriceManager, TuroTrends, type CompPrice, type SeriesRow, type Target } from "@/components/admin/turo/TuroTrends";

interface Run {
  id: string; ran_at: string; runner: string; mode: string; market_base: number | null; host_net: number | null;
  comp_n: number | null; ceiling: number | null; days_written: number; days_verified: number; days_blocked: number;
  gates: { gate: string; result: string; detail: string }[] | null; notes: string | null;
}
interface Settings { paused: boolean; pause_reason: string | null; note_for_claude: string | null; note_set_at: string | null }
interface Day { run_id: string; date: string; lead: number | null; floor: number | null; cur: number | null; proposed: number | null; applied: number | null; verified: boolean | null; status: string; gate: string | null; reason: string | null }

const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const money = (n: number | null | undefined) => (n == null ? "–" : `$${Math.round(Number(n))}`);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const MODE: Record<string, { label: string; tone: string }> = {
  applied: { label: "Prices written", tone: "text-emerald-300 bento:text-emerald-700" },
  "propose-only": { label: "Proposed only", tone: "text-amber-300 bento:text-amber-700" },
  blocked: { label: "Blocked", tone: "text-red-300 bento:text-red-700" },
};

export default function AdminTuro() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [comp, setComp] = useState<CompPrice[]>([]);
  const [demand, setDemand] = useState<DemandRow[] | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: r }, { data: st }, { data: ps }, { data: tg }, { data: cp }, { data: dm }] = await Promise.all([
      supabase.from("turo_runs" as never).select("*").order("ran_at", { ascending: false }).limit(30),
      supabase.from("turo_settings" as never).select("*").eq("id", 1).maybeSingle(),
      supabase.from("turo_price_series" as never).select("day, series, value").limit(5000),
      supabase.from("turo_watch_targets" as never).select("*").eq("active", true).order("chart", { ascending: false }),
      supabase.from("turo_competitor_prices" as never).select("*").order("observed_at", { ascending: false }).limit(200),
      supabase.from("turo_demand" as never).select("*").order("observed_at", { ascending: false }).limit(90),
    ]);
    const list = (r ?? []) as unknown as Run[];
    setRuns(list);
    setSettings((st as unknown as Settings) ?? null);
    setSeries((ps ?? []) as unknown as SeriesRow[]);
    setTargets((tg ?? []) as unknown as Target[]);
    setComp((cp ?? []) as unknown as CompPrice[]);
    setDemand((dm ?? []) as unknown as DemandRow[]);
    const ids = list.slice(0, 10).map((x) => x.id);
    if (ids.length) {
      const { data: d } = await supabase.from("turo_day_prices" as never).select("*").in("run_id", ids).order("date");
      setDays((d ?? []) as unknown as Day[]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (args: { p_paused?: boolean; p_reason?: string | null; p_note?: string }, msg: string) => {
    setSaving(true);
    const { error } = await supabase.rpc("turo_settings_set" as never, args as never);
    setSaving(false);
    if (error) toast.error(error.message); else { toast.success(msg); load(); }
  };

  const last = runs?.[0];
  const lastPlanRun = useMemo(() => runs?.find((r) => days.some((d) => d.run_id === r.id && d.proposed != null)), [runs, days]);
  const plan = days.filter((d) => d.run_id === lastPlanRun?.id);
  const lastWrite = runs?.find((r) => r.mode === "applied");
  const hoursSince = last ? (Date.now() - Date.parse(last.ran_at)) / 3600e3 : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <PageHeader title="Turo Watch" description="Blue Steel · Tesla Model 3 · twice-daily pricing against nearby Model 3s and Edgar." />

      {/* Status + controls */}
      {(() => {
        const lastText = last ? `${last.notes ?? ""} ${JSON.stringify(last.gates ?? [])}` : "";
        // The run's own browser link failing is not the same as Turo being signed out: say which one.
        const noBrowser = !!last && last.mode !== "applied" && /no claude in chrome|no browser tools|bridge down/i.test(lastText);
        const signedOut = !!last && !noBrowser && /401|403|signed out|expired/i.test(lastText) && last.mode !== "applied";
        const stale = hoursSince != null && hoursSince > 14;
        return (
          <section className={cn(card, "space-y-4 p-5")}>
            <div className="flex items-start gap-3">
              {settings?.paused || signedOut || noBrowser || stale
                ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300 bento:text-amber-600" />
                : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300 bento:text-emerald-600" />}
              <div className="space-y-1.5 text-[0.95rem] text-white/80">
                <p className="font-semibold text-white">
                  {settings?.paused ? "Paused: runs compute prices but write nothing." : noBrowser ? "The scheduled run couldn't reach your Chrome, so it couldn't check Turo." : signedOut ? `The last run (${when(last!.ran_at)}) couldn't reach Turo: it looked signed out then.` : stale ? "No run in over 14 hours." : "Running normally."}
                </p>
                <p>Claude runs it at 7:05am and 7:12pm in your own Chrome on the Mac mini, then reports here and to your phone.</p>
                {noBrowser && <p className="text-white/60">Fix, once: in the Claude desktop app on the Mac mini, open Scheduled tasks, open "Turo Watch 7:05am" and "Turo Watch 7:12pm", and turn on "Require this computer". Runs then happen on the Mac with your Chrome.</p>}
                {signedOut && <p className="text-white/60">If you're signed in to turo.com in Chrome now, nothing to do: the next run checks again and this clears.</p>}
                {settings?.paused && settings.pause_reason && <p className="text-white/60">Why: {settings.pause_reason}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {settings?.paused ? (
                <button disabled={saving} onClick={() => save({ p_paused: false }, "Resumed")} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-white px-4 text-sm font-medium text-black bento:bg-[#111114] bento:text-[#fff]"><Play className="h-4 w-4" /> Resume pricing</button>
              ) : (
                <button disabled={saving} onClick={() => save({ p_paused: true, p_reason: "Paused from the admin" }, "Paused")} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-white/[0.08] px-4 text-sm font-medium text-white"><Pause className="h-4 w-4" /> Pause pricing</button>
              )}
              <a href="https://turo.com/us/en/trips/calendar" target="_blank" rel="noreferrer" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-white/[0.08] px-4 text-sm font-medium text-white">
                Open Turo <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="border-t border-white/[0.06] pt-4">
              <label htmlFor="turo-note" className="text-xs font-semibold uppercase tracking-widest text-white/50">Note for the next run</label>
              {settings?.note_for_claude ? (
                <div className="mt-2 flex items-start justify-between gap-3 rounded-xl bg-white/[0.04] p-3 bento:bg-[var(--bento-well)]">
                  <p className="text-[0.95rem] text-white/85">{settings.note_for_claude}</p>
                  <button className="shrink-0 text-xs text-white/50 underline" onClick={() => save({ p_note: "" }, "Note cleared")}>Clear</button>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <input id="turo-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. hold Saturday at $120, or skip writing this weekend"
                    className="h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[16px] text-white outline-none placeholder:text-white/35 bento:bg-[var(--bento-well)] bento:border-black/5" />
                  <button disabled={saving || !note.trim()} onClick={() => { save({ p_note: note }, "Claude will read it next run"); setNote(""); }}
                    className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-medium text-black disabled:opacity-40 bento:bg-[#111114] bento:text-[#fff]"><Send className="h-4 w-4" /> Save</button>
                </div>
              )}
              <p className="mt-1.5 text-xs text-white/45">Claude reads it at the start of the next run, follows it, then clears it.</p>
            </div>
          </section>
        );
      })()}

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

      <DemandMeter rows={demand} />

      <TuroTrends rows={series} />

      <PriceManager rows={series} plan={plan} marketBase={lastPlanRun?.market_base ?? runs?.find((x) => x.market_base != null)?.market_base ?? null}
        paused={!!settings?.paused} canWrite={last?.mode === "applied"} />

      <Competitors targets={targets} prices={comp} />

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
