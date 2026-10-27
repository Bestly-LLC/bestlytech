import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, Scale, ShieldCheck } from "lucide-react";
import { Lines } from "@/components/Lines";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { pollInterval } from "@/lib/polling";
import {
  fetchComplianceOverview, type ComplianceDeadline, type ComplianceFinding, type ComplianceOverview, type ComplianceSeverity,
} from "@/services/complianceApi";

/**
 * Security > Compliance. Vera (Compliance Officer) checks every site, app and agent against the laws daily at 6:20 AM and watches
 * the regulators every Monday. This tab shows what is still open (worst first), what is due soon, and when she last ran.
 */

const LA_TZ = "America/Los_Angeles";
const fmt = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) =>
  iso ? new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, ...opts }).format(new Date(iso)) : "never";

/** "2026-10-31" -> "Fri, Oct 31". The date is a calendar day, so format it as UTC to keep it from sliding a day. */
const day = (d: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(d + "T00:00:00Z"));

const nowrap = "whitespace-nowrap";
const pill = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap";
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80";

const SEV: Record<ComplianceSeverity, { label: string; chip: string }> = {
  critical: { label: "Critical", chip: "bg-red-500/10 text-red-300 border-red-500/25" },
  high: { label: "High", chip: "bg-orange-500/10 text-orange-300 border-orange-500/25" },
  medium: { label: "Medium", chip: "bg-amber-500/10 text-amber-300 border-amber-500/25" },
  low: { label: "Low", chip: "bg-white/[0.06] text-white/70 border-white/10" },
  info: { label: "Note", chip: "bg-white/[0.06] text-white/60 border-white/10" },
};
const ORDER: ComplianceSeverity[] = ["critical", "high", "medium", "low", "info"];

function Stat({ value, label, tone }: { value: number; label: string; tone?: "bad" | "ok" }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] px-4 py-3">
      <div className={cn("text-2xl font-semibold tabular-nums leading-none", tone === "bad" ? "text-red-300" : tone === "ok" ? "text-emerald-300" : "text-white")}>{value}</div>
      <div className="mt-1.5 text-xs text-white/55">{label}</div>
    </div>
  );
}

function FindingRow({ f }: { f: ComplianceFinding }) {
  const [open, setOpen] = useState(false);
  const sev = SEV[f.severity];
  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className={cn("flex min-h-[44px] w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.03] sm:px-5", focusRing)}>
        <span className="mt-0.5 w-12 shrink-0 text-xs font-medium text-white/45 tabular-nums">{f.key}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] leading-snug text-white">{f.title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={cn(pill, sev.chip)}>{sev.label}</span>
            {f.status === "watching" && <span className={cn(pill, "bg-sky-500/10 text-sky-300 border-sky-500/25")}>Being fixed</span>}
            {f.lawyer && <span className={cn(pill, "bg-violet-500/10 text-violet-300 border-violet-500/25")}>Needs a lawyer</span>}
            {f.failing > 0 && <span className={cn(pill, "bg-red-500/10 text-red-300 border-red-500/25")}>Check failing</span>}
          </span>
        </span>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-white/40 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-4 pl-[4.75rem] text-sm text-white/70 sm:px-5 sm:pl-[5.25rem]">
          {f.fix && <p><span className="font-medium text-white/85">Fix. </span><Lines>{f.fix}</Lines></p>}
          {f.status_note && <p className="text-white/55"><Lines>{f.status_note}</Lines></p>}
          <p className="text-xs text-white/40">First seen {fmt(f.first_seen, { month: "short", day: "numeric", year: "numeric" })}</p>
        </div>
      )}
    </li>
  );
}

function DeadlineRow({ d }: { d: ComplianceDeadline }) {
  const late = d.days_left < 0;
  const when = late ? <>{Math.abs(d.days_left)}&nbsp;days late</> : d.days_left === 0 ? <>Today</> : d.days_left === 1 ? <>Tomorrow</> : <>In&nbsp;{d.days_left}&nbsp;days</>;
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <div className="w-24 shrink-0">
        <div className={cn("text-sm font-medium text-white", nowrap)}>{day(d.due)}</div>
        <div className={cn("mt-0.5 text-xs", late ? "text-red-300" : d.days_left <= 7 ? "text-amber-300" : "text-white/50", nowrap)}>{when}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[0.9375rem] leading-snug text-white">{d.what}</div>
        {d.note && <p className="mt-1 text-sm text-white/60"><Lines>{d.note}</Lines></p>}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {d.money && <span className={cn(pill, "bg-emerald-500/10 text-emerald-300 border-emerald-500/25")}>Money due</span>}
          {d.uncertain && <span className={cn(pill, "bg-white/[0.06] text-white/65 border-white/10")}>Not sure it applies yet</span>}
        </div>
      </div>
    </li>
  );
}

export function ComplianceTab() {
  const [data, setData] = useState<ComplianceOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try { setData(await fetchComplianceOverview()); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), pollInterval(5 * 60_000));
    return () => clearInterval(t);
  }, [load]);

  if (err && !data) return <p className="rounded-2xl border border-white/[0.06] px-4 py-4 text-sm text-white/70">Compliance could not load: {err}</p>;
  if (!data) return <Skeleton className="h-64 w-full rounded-2xl bg-white/[0.05]" />;

  const { counts, findings, deadlines, failing_checks: failing, law, last_run: run, last_weekly: weekly } = data;
  const bySev = ORDER.map((s) => ({ s, rows: findings.filter((f) => f.severity === s) })).filter((g) => g.rows.length > 0);
  const urgent = bySev.filter((g) => g.s === "critical" || g.s === "high");
  const rest = bySev.filter((g) => g.s !== "critical" && g.s !== "high");
  const restCount = rest.reduce((n, g) => n + g.rows.length, 0);
  const renderGroup = (g: { s: ComplianceSeverity; rows: ComplianceFinding[] }) => (
    <section key={g.s}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
        {SEV[g.s].label}<span className="text-xs font-normal text-white/45 tabular-nums">{g.rows.length}</span>
      </h3>
      <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06]">{g.rows.map((f) => <FindingRow key={f.key} f={f} />)}</ul>
    </section>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/[0.06] px-4 py-3.5 sm:px-5">
        <div className="flex items-start gap-3">
          {run && run.failed === 0 && run.errored === 0
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
            : <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-white/60" aria-hidden />}
          <div className="min-w-0 text-sm">
            {run ? (
              <>
                <p className="font-medium text-white">
                  Vera last checked {fmt(run.started_at, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
                <p className="mt-0.5 text-white/60"><Lines>{`${run.checks} checks: ${run.checks - run.failed - run.errored} passing, ${run.failed} failing${run.errored ? `, ${run.errored} could not run` : ""}.`}</Lines></p>
              </>
            ) : <p className="text-white/70"><Lines>Vera has not run yet. Her first check is the next 6:20 AM.</Lines></p>}
            <p className="mt-0.5 text-white/45">Law watch last ran {fmt(weekly?.started_at, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. It runs Mondays at 6:40 AM.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={counts.open} label="Open findings" tone={counts.open ? "bad" : "ok"} />
        <Stat value={counts.watching} label="Being fixed" />
        <Stat value={counts.failing} label="Checks failing now" tone={counts.failing ? "bad" : "ok"} />
        <Stat value={counts.checks} label="Checks running" />
      </div>

      <div className="space-y-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white"><AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden />Open findings, worst first</h2>
        {findings.length === 0 && <p className="text-sm text-white/70">Nothing open.</p>}
        {urgent.map(renderGroup)}
        {restCount > 0 && (
          <div className="space-y-5">
            <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}
              className={cn("inline-flex h-11 items-center gap-1.5 rounded-md px-2 -ml-2 text-sm text-white/70 hover:bg-white/5 hover:text-white", focusRing)}>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showAll && "rotate-180")} aria-hidden />
              {showAll ? "Hide" : "Show"} medium and lower ({restCount})
            </button>
            {showAll && rest.map(renderGroup)}
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-white"><CalendarClock className="h-4 w-4 text-sky-300" aria-hidden />Coming up</h2>
        {deadlines.length === 0
          ? <p className="text-sm text-white/70">No deadlines in the next two weeks.</p>
          : <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06]">{deadlines.map((d) => <DeadlineRow key={d.key} d={d} />)}</ul>}
      </section>

      {failing.length > 0 && (
        <section>
          <h2 className="mb-2 text-base font-semibold text-white">Checks failing now</h2>
          <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06]">
            {failing.map((c) => (
              <li key={c.id} className="px-4 py-3 sm:px-5">
                <div className="text-[0.9375rem] leading-snug text-white">{c.title}</div>
                <p className="mt-1 text-sm text-white/55">{c.last_detail}</p>
                {c.first_fail_at && <p className="mt-1 text-xs text-white/40">Failing since {fmt(c.first_fail_at, { month: "short", day: "numeric" })}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {law.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-white"><Scale className="h-4 w-4 text-violet-300" aria-hidden />Law and platform changes</h2>
          <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06]">
            {law.map((l, i) => (
              <li key={i} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.9375rem] text-white">{l.headline ?? l.platform}</span>
                  <span className={cn(pill, l.impact === "high" ? SEV.high.chip : SEV.medium.chip)}>{l.impact === "high" ? "High" : "Medium"}</span>
                </div>
                {l.what_it_means && <p className="mt-1 text-sm text-white/60"><Lines>{l.what_it_means}</Lines></p>}
                <p className="mt-1 text-xs text-white/40">{l.platform} · found {fmt(l.found_at, { month: "short", day: "numeric" })}{l.effective_date ? ` · starts ${day(l.effective_date)}` : ""}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
