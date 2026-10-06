/**
 * The Coach, for both Avas (Jared 2026-10-05: "why is there no UI for the coach ... we need a full UI for this").
 * Data: admin_coach(source) (scores, focus, objections), admin_coach_manage(source) (every rule, settings, the Coach's health),
 * admin_coach_feed(source) (reviews), admin_call_review(source, call). Plan + rules: docs/ava-learning-opusplan.md,
 * migrations 20261005160000_ava_coach.sql and 20261005210000_coach_manager.sql.
 *
 *   CoachSection   /admin/ava: a CollapsibleSection, open by default, below Messages and All calls.
 *   AvaCoach       /admin/roofguard: the Coach tab (variant "full") and the Scorecard (variant "summary", with a Manage rules button).
 *                  Eli's partner Scorecard uses it read-only (admin=false): the older lists, no controls.
 *   CallReview     one call's review, for the call sheet on both pages.
 * Pieces: CoachPlaybook (the rules manager), CoachReviews (the feed and Review now), CoachSettings (the Settings sheet group), coachBus (events).
 *
 * RoofGuard: small rules test themselves on half her calls; big ones wait for Jared. Personal Ava: rules wait for Jared (settings can change that).
 */
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, FlaskConical, GraduationCap, Hourglass, ListChecks, ShieldAlert, Target } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import { PlaybookManager, StatusPill } from "./CoachPlaybook";
import { CoachReviews } from "./CoachReviews";
import { CoachNotes } from "./CoachNotes";
import { onCoachChanged, onOpenCoach, openCoach } from "./coachBus";
import {
  APRICOT, FLAG, OBJECTION, STEPS, Score, fmt, plural, ring, rpc, weekLabel, whenDay12,
  type Coach, type Manage, type Play, type Review, type Source,
} from "./coachShared";

export type { Source };

// ---------------------------------------------------------------- data
export function useCoach(source: Source) {
  const [c, setC] = useState<Coach | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await rpc<Coach>("admin_coach", { p_source: source });
    if (error) { setErr(error.message); return; }
    setErr(null); setC(data);
  }, [source]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 120_000); return () => clearInterval(t); }, [load]);
  return { c, err, reload: load };
}

/** The Coach's scores plus (for Jared) every rule, the settings and the watchdog. Reloads when anything changes the playbook. */
export function useCoachData(source: Source, admin: boolean) {
  const { c, err, reload: reloadCoach } = useCoach(source);
  const [m, setM] = useState<Manage | null>(null);
  const [merr, setMerr] = useState<string | null>(null);
  const loadManage = useCallback(async () => {
    if (!admin) return;
    const { data, error } = await rpc<Manage>("admin_coach_manage", { p_source: source });
    if (error) { setMerr(error.message); return; }
    setMerr(null); setM(data);
  }, [source, admin]);
  useEffect(() => { void loadManage(); const t = setInterval(() => { if (!document.hidden) void loadManage(); }, 120_000); return () => clearInterval(t); }, [loadManage]);
  const reload = useCallback(async () => { await Promise.all([reloadCoach(), loadManage()]); }, [reloadCoach, loadManage]);
  useEffect(() => onCoachChanged(source, () => void reload()), [source, reload]);
  return { c, m, err: err ?? merr, reload };
}

// ---------------------------------------------------------------- header: status, focus, watchdog
function statusLine(m: Manage | null, c: Coach | null) {
  const waiting = (m?.playbook ?? c?.playbook ?? []).filter((p) => p.status === "proposed").length;
  return { waiting, reviewed: m?.reviewed_7d ?? null };
}

function CoachStatus({ m, c }: { m: Manage | null; c: Coach }) {
  const { waiting, reviewed } = statusLine(m, c);
  const w = m?.watch;
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] leading-snug text-white/80">
        {reviewed != null ? <>Reviewed {plural(reviewed, "call")} this week</> : <>{plural(c.weeks.reduce((n, x) => n + (x.n ?? 0), 0), "call")} reviewed</>}
        <span aria-hidden> · </span>
        <span className={cn(waiting > 0 && "font-semibold text-amber-300")}>{waiting > 0 ? `${plural(waiting, "rule")} waiting for you` : "no rules waiting"}</span>
        {m && <><span aria-hidden> · </span><span className={m.ai_ok ? "text-emerald-300" : "text-amber-300"}>{m.ai_ok ? "free AI OK" : "free AI is limited right now"}</span></>}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {w && (w.behind
          ? <span role="status" className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Coach is behind by {plural(w.waiting, "call")}</span>
          : w.waiting > 0
            ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/80"><Hourglass className="h-3.5 w-3.5" aria-hidden />{plural(w.waiting, "call")} waiting for a review</span>
            : <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Watchdog OK</span>)}
        {m && <span className="whitespace-nowrap text-xs text-white/55">Weekly pass: Mondays 10:05&nbsp;AM Pacific · last {whenDay12(m.last_weekly)}</span>}
      </div>
    </div>
  );
}

function CoachHeader({ source, c, m, admin }: { source: Source; c: Coach; m: Manage | null; admin: boolean }) {
  const name = source === "roofguard" ? "RoofGuard Ava" : "Ava";
  const total = c.weeks.reduce((n, w) => n + (w.n ?? 0), 0);
  return (
    <>
      <header className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${APRICOT}26`, color: APRICOT }}><GraduationCap className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-[1.0625rem] font-semibold text-white">Coach</h3>
          {admin ? <CoachStatus m={m} c={c} /> : (
            <p className="text-[13px] leading-snug text-white/60">{plural(total, "call")} reviewed{c.pending > 0 ? <> · {plural(c.pending, "call")} waiting</> : null}</p>
          )}
        </div>
      </header>
      <p className="text-[13px] leading-snug text-white/60">
        {source === "roofguard"
          ? "Scores every call on the 5 Steps to a Sale, gives her one thing to work on, and tests new moves on half her calls. Winners stay, losers roll back."
          : "Scores every call, gives her one thing to work on, and suggests new habits. You approve each one."}
      </p>
      <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: `${APRICOT}12`, boxShadow: `inset 0 0 0 1px ${APRICOT}30` }}>
        <Target className="mt-0.5 h-4 w-4 shrink-0" style={{ color: APRICOT }} aria-hidden />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.04em]" style={{ color: APRICOT }}>Working on</div>
          <p className="mt-0.5 text-[0.9375rem] leading-snug text-white">{c.focus ?? `Nothing yet. The Coach reviews ${name}'s calls about 10 minutes after they end.`}</p>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- step scores, week over week
function StepScores({ source, c }: { source: Source; c: Coach }) {
  const steps = STEPS[source];
  const last = c.weeks[c.weeks.length - 1], prev = c.weeks[c.weeks.length - 2];
  if (!last) return null;
  return (
    <div>
      <h4 className="mb-2 text-[0.8125rem] font-semibold text-white/80">
        Getting better <span className="font-normal text-white/60">· week of {weekLabel(last.week)}{prev ? ` vs ${weekLabel(prev.week)}` : ""}</span>
      </h4>
      <div className={cn("grid gap-2", steps.length > 5 ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-5")}>
        {steps.map((s) => {
          const v = last[s.key] as number | null, p = prev?.[s.key] as number | null | undefined;
          const d = v != null && p != null ? Math.round((v - p) * 10) / 10 : null;
          return (
            <div key={s.key} className="rounded-2xl bg-white/[0.04] px-3 py-2.5 text-center">
              <div className="text-xs text-white/65">{s.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-white">{fmt(v)}</div>
              <div className={cn("mt-0.5 inline-flex items-center gap-0.5 whitespace-nowrap text-[0.6875rem] tabular-nums",
                d == null || d === 0 ? "text-white/50" : d > 0 ? "text-emerald-300" : "text-rose-300")}>
                {d == null ? "–" : d === 0 ? "same" : <>{d > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}{d > 0 ? "+" : ""}{d}</>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[0.6875rem] text-white/55">Average out of 5 for calls that reached that step. {plural(last.n, "call")} this week.</p>
    </div>
  );
}

function Objections({ c }: { c: Coach }) {
  const objections = Object.entries(c.objections ?? {}).sort((a, b) => b[1] - a[1]);
  if (!objections.length) return null;
  return (
    <div>
      <h4 className="mb-2 text-[0.8125rem] font-semibold text-white/80">Objections she hears <span className="font-normal text-white/60">· 30&nbsp;days</span></h4>
      <div className="flex flex-wrap gap-1.5">
        {objections.map(([k, n]) => (
          <span key={k} className="whitespace-nowrap rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-white/75">{OBJECTION[k] ?? k} <b className="tabular-nums text-white">{n}</b></span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the panel
export function CoachPanel({ source, admin, variant = "full", data }: { source: Source; admin: boolean; variant?: "full" | "summary"; data: ReturnType<typeof useCoachData> }) {
  const { c, m, err, reload } = data;
  if (err && !c) return <div role="alert" className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load the Coach: {err}</div>;
  if (!c) return <div className="h-40 animate-pulse rounded-3xl bg-white/[0.03] ring-1 ring-white/10" aria-label="Loading the Coach" />;

  if (!admin) return <ReadOnlyCoach source={source} c={c} />;

  if (variant === "summary") {
    const rules = m?.playbook ?? [];
    const n = (s: Play["status"]) => rules.filter((p) => p.status === s).length;
    return (
      <div className="space-y-4">
        <CoachHeader source={source} c={c} m={m} admin />
        <StepScores source={source} c={c} />
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/10">
          <ListChecks className="h-4 w-4 text-white/60" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-white/80">
            {m ? <><span className="tabular-nums">{n("live")}</span>&nbsp;live · <span className="tabular-nums">{n("testing")}</span>&nbsp;testing · <span className={cn("tabular-nums", n("proposed") > 0 && "font-semibold text-amber-300")}>{n("proposed")}</span>&nbsp;waiting for you</> : "Rules load in the Coach tab."}
          </p>
          <button type="button" onClick={() => openCoach(source)} className={cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white/[0.09] px-3.5 text-[14px] font-medium text-white hover:bg-white/[0.14]", ring)}>
            Manage rules</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <CoachHeader source={source} c={c} m={m} admin />
      <StepScores source={source} c={c} />
      <PlaybookManager source={source} rules={m?.playbook ?? []} loading={!m} reload={reload} />
      {!m && err && <p role="alert" className="text-sm text-red-200">Could not load the rules: {err}</p>}
      <CoachReviews source={source} pending={c.pending} onReviewed={() => void reload()} />
      <CoachNotes source={source} />
      <Objections c={c} />
    </div>
  );
}

/** RoofGuard: the Coach tab, and the Scorecard's compact version. */
export function AvaCoach({ source, admin = false, variant = "full" }: { source: Source; admin?: boolean; variant?: "full" | "summary" }) {
  const data = useCoachData(source, admin);
  return (
    <section aria-label="Coach" className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
      <CoachPanel source={source} admin={admin} variant={variant} data={data} />
    </section>
  );
}

/** Both pages: the Coach as a collapsible section, open by default (/admin/ava below All calls; /admin/roofguard on its Coach tab). */
export function CoachSection({ source = "ava", anchorId = "scorecard" }: { source?: Source; anchorId?: string }) {
  const data = useCoachData(source, true);
  const [signal, setSignal] = useState(0);
  useEffect(() => onOpenCoach(source, () => { setSignal((n) => n + 1); setTimeout(() => document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); }), [source]);
  const { c, m } = data;
  const waiting = (m?.playbook ?? []).filter((p) => p.status === "proposed").length;
  const behind = m?.watch.behind;
  return (
    <CollapsibleSection id={`${source}-coach`} anchorId={anchorId} defaultOpen openSignal={signal}
      title="Coach" icon={<span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${APRICOT}26`, color: APRICOT }}><GraduationCap className="h-4 w-4" /></span>}
      summary={m && c ? <>{plural(m.reviewed_7d, "call")} reviewed this week · {waiting > 0 ? `${plural(waiting, "rule")} waiting for you` : "no rules waiting"} · {behind ? `behind by ${plural(m.watch.waiting, "call")}` : m.ai_ok ? "free AI OK" : "free AI limited"}</> : "Reviews every call and keeps her playbook"}
      badge={waiting > 0 ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300"><Hourglass className="h-3.5 w-3.5" aria-hidden /><span className="tabular-nums">{waiting}</span>&nbsp;waiting</span>
        : behind ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Behind</span> : undefined}
      bodyClassName="p-4 sm:p-5">
      <CoachPanel source={source} admin variant="full" data={data} />
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------- read-only (Eli's partner Scorecard)
function ReadOnlyRule({ p, counts }: { p: Play; counts?: { with: number; without: number } }) {
  const goal = 40;
  return (
    <li className="space-y-2 py-3">
      <StatusPill status={p.status} />
      <p className="text-[0.9375rem] leading-snug text-white">{p.rule}</p>
      {p.why && <p className="text-xs leading-snug text-white/60">Why: {p.why}</p>}
      {p.status === "testing" && counts && (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-xs text-white/60">
            <span>Calls with it <b className="tabular-nums text-white">{counts.with}</b> · without <b className="tabular-nums text-white">{counts.without}</b></span>
            <span className="whitespace-nowrap tabular-nums">decides at {goal}&nbsp;each</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Test progress" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(counts.with, counts.without)}>
            <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.min(100, (100 * Math.min(counts.with, counts.without)) / goal)}%` }} />
          </div>
        </div>
      )}
      {p.result && p.status !== "testing" && p.result.calls_with != null && (
        <p className="text-xs text-white/60">{p.result.calls_with}&nbsp;calls with it, {p.result.calls_without}&nbsp;without · score {p.result.score_with} vs {p.result.score_without}</p>
      )}
    </li>
  );
}

function ReadOnlyCoach({ source, c }: { source: Source; c: Coach }) {
  const [showOld, setShowOld] = useState(false);
  const waiting = c.playbook.filter((p) => p.status === "proposed");
  const testing = c.playbook.filter((p) => p.status === "testing");
  const live = c.playbook.filter((p) => p.status === "live");
  const old = c.playbook.filter((p) => ["rolled_back", "retired", "declined"].includes(p.status));
  return (
    <div className="space-y-4">
      <CoachHeader source={source} c={c} m={null} admin={false} />
      <StepScores source={source} c={c} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white/[0.03] px-4 ring-1 ring-white/10">
          <h4 className="flex items-center gap-2 pt-3 text-[0.8125rem] font-semibold text-white/85"><FlaskConical className="h-4 w-4 text-sky-300" aria-hidden />New moves</h4>
          {waiting.length === 0 && testing.length === 0 ? <p className="py-3 text-sm text-white/60">None right now. Every Monday the Coach reads the week and suggests up to 3.</p> : (
            <ul className="divide-y divide-white/5">{[...waiting, ...testing].map((p) => <ReadOnlyRule key={p.id} p={p} counts={c.testing_counts?.[p.id]} />)}</ul>
          )}
        </div>
        <div className="rounded-2xl bg-white/[0.03] px-4 ring-1 ring-white/10">
          <h4 className="flex items-center gap-2 pt-3 text-[0.8125rem] font-semibold text-white/85"><Check className="h-4 w-4 text-emerald-300" aria-hidden />Her playbook <span className="font-normal text-white/60">· {live.length}&nbsp;live</span></h4>
          {live.length === 0 ? <p className="py-3 text-sm text-white/60">Empty so far. Moves land here once they win their test.</p> : <ul className="divide-y divide-white/5">{live.map((p) => <ReadOnlyRule key={p.id} p={p} />)}</ul>}
          {old.length > 0 && (
            <div className="border-t border-white/5 py-2">
              <button type="button" onClick={() => setShowOld(!showOld)} aria-expanded={showOld} className={cn("min-h-[44px] text-xs text-white/65 hover:text-white/85", ring)}>{showOld ? "Hide" : "Show"} {old.length}&nbsp;turned off</button>
              {showOld && <ul className="divide-y divide-white/5 opacity-80">{old.map((p) => <ReadOnlyRule key={p.id} p={p} />)}</ul>}
            </div>
          )}
        </div>
      </div>
      <Objections c={c} />
      <div>
        <h4 className="text-[0.8125rem] font-semibold text-white/80">Latest reviews</h4>
        {c.reviews.length === 0 ? <p className="py-2 text-sm text-white/60">No reviews yet.</p> : (
          <ul className="divide-y divide-white/5">{c.reviews.slice(0, 8).map((r) => <ReviewRow key={r.call_id} r={r} source={source} />)}</ul>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ r, source }: { r: Review; source: Source }) {
  const [open, setOpen] = useState(false);
  const who = source === "roofguard" ? r.company : r.caller;
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cn("flex min-h-[44px] w-full items-start gap-3 py-2.5 text-left", ring)}>
        <Score v={r.overall} label="Overall" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-[0.8125rem]">
            <span className="font-medium text-white">Call #{r.call_no ?? "?"}</span>
            {who && <span className="truncate text-white/60">{who}</span>}
            {r.rule_flags?.length > 0 && <span className="inline-flex items-center gap-1 text-rose-300"><ShieldAlert className="h-3.5 w-3.5" aria-hidden />rule slip</span>}
          </span>
          {r.work_on && <span className="mt-0.5 block text-[0.8125rem] leading-snug text-white/75">{r.work_on}</span>}
        </span>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-white/40 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="pb-3 pl-11"><ReviewBody r={r} source={source} /></div>}
    </li>
  );
}

function ReviewBody({ r, source }: { r: Review; source: Source }) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {STEPS[source].map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] py-0.5 pl-2.5 pr-1 text-xs text-white/70">
            {s.label}<Score v={r.scores?.[s.key]} label={s.label} />
          </span>
        ))}
        {source === "roofguard" && r.confidence != null && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] py-0.5 pl-2.5 pr-1 text-xs text-white/70">Confidence<Score v={r.confidence} label="Confidence" /></span>
        )}
      </div>
      {r.went_well && <p className="text-[0.8125rem] leading-snug text-white/75"><span className="text-emerald-300">Went well: </span>{r.went_well}</p>}
      {r.work_on && <p className="text-[0.8125rem] leading-snug text-white/75"><span className="text-sky-300">Work on: </span>{r.work_on}</p>}
      {!!r.objections?.length && <p className="text-xs text-white/60">Objections: {r.objections.map((o) => OBJECTION[o] ?? o).join(", ")}</p>}
      {!!r.rule_flags?.length && (
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-rose-300"><ShieldAlert className="h-4 w-4" aria-hidden />{r.rule_flags.map((f) => FLAG[f] ?? f).join(", ")}</p>
      )}
    </div>
  );
}

/** One call's review, for the call sheet. */
export function CallReview({ source, callId }: { source: Source; callId: string }) {
  const [r, setR] = useState<Review | null | undefined>(undefined);
  useEffect(() => {
    let off = false;
    setR(undefined);
    void rpc<Review>("admin_call_review", { p_source: source, p_call: callId }).then(({ data }) => { if (!off) setR(data ?? null); });
    return () => { off = true; };
  }, [source, callId]);
  if (r === undefined) return null;
  return (
    <div className="rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/10">
      <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/60">
        <GraduationCap className="h-3.5 w-3.5 text-sky-300" aria-hidden />Coach's review
        {r && <span className="ml-auto"><Score v={r.overall} label="Overall" big /></span>}
      </h4>
      {r ? <ReviewBody r={r} source={source} /> : <p className="text-sm text-white/60">Not reviewed yet. The Coach reviews calls about 10&nbsp;minutes after they end.</p>}
    </div>
  );
}
