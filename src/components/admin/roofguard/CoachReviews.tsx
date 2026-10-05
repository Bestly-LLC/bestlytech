/**
 * The Coach's reviews feed: recent call reviews with the per-step scores as small bars, what went well, what to work on, and
 * the objections she heard. Tapping one opens that call's own sheet (RoofGuard: the Calls tab; Ava: the page's call sheet).
 * "Pending reviews: N" with "Review now" runs the ava-coach function's on-demand review ({op:"review"}), free AI only.
 * Data: admin_coach_feed(source) and admin_coach(source).pending.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, ChevronRight, Hourglass, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { onCoachChanged, openCall } from "./coachBus";
import { CollapsibleSection } from "./CollapsibleSection";
import { FLAG, OBJECTION, Score, STEPS, barTone, fmt, plural, ring, rpc, when12, type FeedRow, type Source } from "./coachShared";

function StepBars({ source, scores }: { source: Source; scores: Record<string, number | null> | null }) {
  const steps = STEPS[source];
  return (
    <span className={cn("mt-1.5 grid gap-x-2.5 gap-y-1.5", steps.length > 5 ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-5")} role="group" aria-label="Scores by step">
      {steps.map((s) => {
        const v = scores?.[s.key] ?? null;
        return (
          <span key={s.key} className="block min-w-0" aria-label={`${s.label}: ${v == null ? "not scored" : `${fmt(v)} out of 5`}`}>
            <span className="flex items-baseline justify-between gap-1 text-[11px] leading-tight text-white/65">
              <span className="truncate">{s.label}</span><span className="font-semibold tabular-nums text-white/90">{fmt(v)}</span>
            </span>
            <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <span className={cn("block h-full rounded-full", barTone(v))} style={{ width: v == null ? 0 : `${Math.max(6, (v / 5) * 100)}%` }} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

function FeedItem({ r, source }: { r: FeedRow; source: Source }) {
  const objs = r.objections ?? [], flags = r.rule_flags ?? [];
  return (
    <li>
      <button type="button" onClick={() => openCall(source, r.call_id, r.lead_id)} aria-label={`Open call ${r.call_no ?? ""} ${r.who ?? ""}`.trim()}
        className={cn("flex min-h-[44px] w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.04]", ring)}>
        <Score v={r.overall} label="Overall" big />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
            <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white/75">#{r.call_no ?? "?"}</span>
            {r.who && <span className="max-w-full truncate font-medium text-white">{r.who}</span>}
            <span className="whitespace-nowrap text-xs text-white/55">{when12(r.at)}</span>
            {flags.length > 0 && <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-300"><ShieldAlert className="h-3.5 w-3.5" aria-hidden />Rule slip: {flags.map((f) => FLAG[f] ?? f).join(", ")}</span>}
          </span>
          <StepBars source={source} scores={r.scores} />
          {r.went_well && <span className="mt-2 block text-[13px] leading-snug text-white/80 [overflow-wrap:anywhere]"><span className="font-medium text-emerald-300">Went well: </span>{r.went_well}</span>}
          {r.work_on && <span className="mt-1 block text-[13px] leading-snug text-white/80 [overflow-wrap:anywhere]"><span className="font-medium text-[#FFA270]">Work on: </span>{r.work_on}</span>}
          {objs.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {objs.map((o) => <span key={o} className="whitespace-nowrap rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] text-white/70">{OBJECTION[o] ?? o}</span>)}
            </span>
          )}
        </span>
        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-white/30" aria-hidden />
      </button>
    </li>
  );
}

export function CoachReviews({ source, pending, onReviewed }: { source: Source; pending: number; onReviewed: () => void }) {
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(8);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await rpc<FeedRow[]>("admin_coach_feed", { p_source: source, p_limit: 40 });
    if (error) { setErr(error.message); return; }
    setErr(null); setRows(data ?? []);
  }, [source]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 120_000); return () => clearInterval(t); }, [load]);
  useEffect(() => onCoachChanged(source, () => void load()), [source, load]);

  // the function's on-demand path: {op:"review"} reviews the oldest waiting calls on free AI (both Avas, up to 6 each). It can take a minute.
  const reviewNow = async () => {
    setRunning(true); setNote(null);
    const { data, error } = await supabase.functions.invoke("ava-coach", { body: { op: "review", limit: 6 } });
    setRunning(false);
    if (error || data?.ok === false) { setNote({ ok: false, text: `Couldn't start the review. ${error?.message ?? data?.error ?? ""}`.trim() }); void load(); onReviewed(); return; }
    const mine = ((data?.[source === "ava" ? "ava" : "roofguard"] ?? []) as { ok?: boolean; skipped?: boolean; error?: string }[]);
    const good = mine.filter((x) => x.ok && !x.skipped).length, skipped = mine.filter((x) => x.ok && x.skipped).length, bad = mine.filter((x) => x.ok === false).length;
    setNote(bad && !good ? { ok: false, text: `Free AI wasn't available. The Coach will retry on its own every 10 minutes.` }
      : { ok: true, text: mine.length === 0 ? "Nothing was waiting." : `Reviewed ${plural(good, "call")}${skipped ? `, skipped ${plural(skipped, "call")} that weren't real conversations` : ""}${bad ? `, ${plural(bad, "call")} will retry` : ""}.` });
    void load(); onReviewed();
  };

  const shown = (rows ?? []).slice(0, limit);
  const latest = rows?.[0];
  // closed: "Latest: Call #52 · 7.5 · 2:14 PM" so the newest review is visible without opening it
  const summary = err ? "Couldn't load the reviews" : !rows ? "Loading…" : !latest ? "No reviews yet"
    : <>Latest: Call&nbsp;#{latest.call_no ?? "?"}{latest.overall != null ? <> · score <span className="tabular-nums">{fmt(latest.overall)}</span></> : null}{latest.at ? <> · {when12(latest.at)}</> : null} · <span className="tabular-nums">{rows.length}</span>&nbsp;total</>;
  const pill = (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", pending > 0 ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300")}>
      {pending > 0 ? <Hourglass className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}{pending > 0 ? <><span className="tabular-nums">{pending}</span>&nbsp;pending</> : "Up to date"}
    </span>
  );
  return (
    <CollapsibleSection id={`${source}-coach-reviews`} title="Latest reviews" summary={summary} badge={pill} className="rounded-2xl" bodyClassName="pb-1">
      <header className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <span className="text-sm text-white/75">Pending reviews:&nbsp;<span className="tabular-nums">{pending}</span></span>
        {pending > 0 && (
          <button type="button" onClick={() => void reviewNow()} disabled={running}
            className={cn("ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white/[0.09] px-3.5 text-[14px] font-medium text-white hover:bg-white/[0.14] disabled:opacity-60", ring)}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}{running ? "Reviewing…" : "Review now"}</button>
        )}
      </header>
      <p className="px-4 pb-1 pt-1 text-xs text-white/60">The Coach reviews each call about 10&nbsp;minutes after it ends, on free AI. "Review now" does the waiting ones right away (up to 6 per Ava), which can take a minute.</p>
      <div aria-live="polite" className="px-4">
        {running && <p className="py-1 text-sm text-white/70">Reviewing the waiting calls. You can keep using the page.</p>}
        {note && <p role={note.ok ? "status" : "alert"} className={cn("flex items-start gap-1.5 py-1 text-sm", note.ok ? "text-emerald-300" : "text-amber-200")}>
          {note.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}{note.text}</p>}
      </div>

      {err ? <p role="alert" className="px-4 py-3 text-sm text-red-200">Could not load the reviews: {err}</p>
        : !rows ? <div className="mx-4 my-3 h-20 animate-pulse rounded-xl bg-white/[0.04]" aria-label="Loading reviews" />
        : rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-white/60">No reviews yet. Each finished call gets one.</p>
        : <>
          <ul className="divide-y divide-white/5 border-t border-white/5">{shown.map((r) => <FeedItem key={r.call_id} r={r} source={source} />)}</ul>
          {rows.length > limit && (
            <div className="border-t border-white/5 p-2">
              <button type="button" onClick={() => setLimit((l) => l + 8)} className={cn("min-h-[44px] w-full rounded-xl text-[14px] font-medium text-white/80 hover:bg-white/[0.05]", ring)}>Show more ({rows.length - limit} left)</button>
            </div>
          )}
        </>}
    </CollapsibleSection>
  );
}
