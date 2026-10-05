/**
 * The Coach, inside the Scorecard (Jared 2026-10-05: "the coach lives in or is merged with Scorecard").
 * Data: admin_coach(source) and admin_call_review(source, call). Writes: admin_playbook_set.
 * Plan + rules: docs/ava-learning-opusplan.md, supabase/migrations/20261005160000_ava_coach.sql.
 *
 *   AvaCoach     the "Coach" section: what she's working on, step scores week by week, her playbook (Your call / Testing /
 *                Live / Dropped), objections she hears, and the latest call reviews.
 *   CallReview   one call's review, for the call sheet on both pages.
 *
 * RoofGuard: small playbook moves test themselves on half her calls; big ones wait for Jared. Personal Ava: every
 * move waits for Jared (too few calls to A/B). Eli sees RoofGuard's panel read-only.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, Beaker, Check, ChevronDown, FlaskConical, GraduationCap, Loader2, ShieldAlert, Target, X } from "lucide-react";

type Source = "roofguard" | "ava";
type Play = { id: string; rule: string; why: string | null; kind: string; size: "small" | "big";
  status: "proposed" | "testing" | "live" | "rolled_back" | "declined" | "retired"; origin: string;
  started_at: string | null; decided_at: string | null; result: { calls_with?: number; calls_without?: number; score_with?: number; score_without?: number } | null; created_at: string };
type Review = { call_id: string; call_no: number | null; scores: Record<string, number | null> | null; impulse?: Record<string, number | null> | null;
  objections?: string[]; went_well: string | null; work_on: string | null; rule_flags: string[]; overall: number | null; confidence?: number | null;
  created_at: string; outcome?: string | null; company?: string | null; direction?: string | null; caller?: string | null };
type Coach = { weeks: (Record<string, number | null> & { week: string; n: number })[]; focus: string | null; objections?: Record<string, number>;
  playbook: Play[]; testing_counts?: Record<string, { with: number; without: number }>; reviews: Review[]; pending: number };

// bound: supabase.rpc reads this.rest, so it can't be pulled off the client on its own
const rpc = supabase.rpc.bind(supabase) as unknown as <T>(f: string, a: object) => Promise<{ data: T | null; error: { message: string } | null }>;

const STEPS: Record<Source, { key: string; label: string }[]> = {
  roofguard: [{ key: "opening", label: "Opening" }, { key: "qualify", label: "Qualify" }, { key: "present", label: "Present" },
    { key: "close", label: "Close" }, { key: "rehash", label: "Lock it in" }],
  ava: [{ key: "name", label: "Name" }, { key: "message", label: "Message" }, { key: "urgency", label: "Urgency" },
    { key: "callback", label: "Callback" }, { key: "warm_brief", label: "Warm & brief" }, { key: "privacy", label: "Privacy" }],
};
const OBJECTION: Record<string, string> = { already_have_roofer: "Already have a roofer", send_info: "Send me info", price: "Price", busy: "Busy",
  not_interested: "Not interested", wrong_person: "Wrong person", call_back_later: "Call back later", other: "Other" };
const FLAG: Record<string, string> = { said_replacement: 'Said "replacement"', called_it_insurance: "Called it insurance", fake_social_proof: "Implied partners",
  invented_deadline: "Invented a deadline", denied_being_ai: "Denied being an AI", income_projection: "Money promise",
  shared_private_info: "Shared private info", claimed_to_be_jared: "Spoke as Jared", made_commitment_for_jared: "Committed for Jared" };

const tone = (v: number | null | undefined) => v == null ? "bg-white/10 text-white/50"
  : v >= 4 ? "bg-emerald-500/15 text-emerald-300" : v >= 3 ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300";
const fmt = (v: number | null | undefined) => (v == null ? "–" : Number(v).toFixed(Number.isInteger(Number(v)) ? 0 : 1));
const weekLabel = (w: string) => new Date(w + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Score({ v, label, big }: { v: number | null | undefined; label?: string; big?: boolean }) {
  return (
    <span className={cn("inline-flex items-center justify-center whitespace-nowrap rounded-full font-semibold tabular-nums", tone(v), big ? "min-w-[2.75rem] px-2.5 py-1 text-sm" : "min-w-[2rem] px-2 py-0.5 text-xs")}
      aria-label={label ? `${label}: ${v == null ? "not scored" : `${fmt(v)} out of 5`}` : undefined}>
      {fmt(v)}
    </span>
  );
}

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

/** One playbook line with its state and Jared's buttons. */
function PlayRow({ p, source, admin, counts, onDone, badge }: { p: Play; source: Source; admin: boolean; counts?: { with: number; without: number }; onDone: () => void; badge?: "yours" | "testing" }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (action: "approve" | "decline" | "retire" | "restore") => {
    setBusy(action);
    const { error } = await rpc("admin_playbook_set", { p_source: source, p_id: p.id, p_action: action });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(action === "approve" ? (source === "roofguard" ? "Testing it on half her calls" : "She'll use it from her next call")
      : action === "decline" ? "Dropped" : action === "retire" ? "Taken out of her playbook" : "Back in her playbook");
    onDone();
  };
  const goal = 40;
  return (
    <li className="space-y-2 py-3">
      {badge === "yours" && <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-300">Your call</span>}
      {badge === "testing" && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-sky-300"><Beaker className="h-3 w-3" aria-hidden />Testing</span>}
      <p className="text-[0.9375rem] leading-snug text-white">{p.rule}</p>
      {p.why && <p className="text-xs leading-snug text-white/55">Why: {p.why}</p>}
      {p.status === "testing" && counts && (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-xs text-white/60">
            <span>Calls with it <b className="tabular-nums text-white">{counts.with}</b> · without <b className="tabular-nums text-white">{counts.without}</b></span>
            <span className="whitespace-nowrap tabular-nums">decides at {goal}&nbsp;each</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Test progress" aria-valuemin={0} aria-valuemax={goal}
            aria-valuenow={Math.min(counts.with, counts.without)}>
            <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.min(100, (100 * Math.min(counts.with, counts.without)) / goal)}%` }} />
          </div>
        </div>
      )}
      {p.result && p.status !== "testing" && p.result.calls_with != null && (
        <p className="text-xs text-white/55">{p.result.calls_with}&nbsp;calls with it, {p.result.calls_without}&nbsp;without · score {p.result.score_with} vs {p.result.score_without}</p>
      )}
      {admin && (
        <div className="flex flex-wrap gap-2">
          {p.status === "proposed" && <>
            <button type="button" disabled={!!busy} onClick={() => void act("approve")}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-[#0A84FF] px-3.5 text-[13px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-50">
              {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{source === "roofguard" ? "Test it" : "Use it"}</button>
            <button type="button" disabled={!!busy} onClick={() => void act("decline")}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-[13px] font-medium text-white/80 transition hover:bg-white/15 disabled:opacity-50">
              <X className="h-3.5 w-3.5" />No</button>
          </>}
          {(p.status === "live" || p.status === "testing") && (
            <button type="button" disabled={!!busy} onClick={() => void act("retire")}
              className="inline-flex min-h-[36px] items-center rounded-full bg-white/10 px-3.5 text-[13px] font-medium text-white/75 transition hover:bg-white/15 disabled:opacity-50">
              {p.status === "testing" ? "Stop the test" : "Take it out"}</button>
          )}
          {(p.status === "rolled_back" || p.status === "retired") && (
            <button type="button" disabled={!!busy} onClick={() => void act("restore")}
              className="inline-flex min-h-[36px] items-center rounded-full bg-white/10 px-3.5 text-[13px] font-medium text-white/75 transition hover:bg-white/15 disabled:opacity-50">
              Put it back</button>
          )}
        </div>
      )}
    </li>
  );
}

function ReviewRow({ r, source }: { r: Review; source: Source }) {
  const [open, setOpen] = useState(false);
  const who = source === "roofguard" ? r.company : r.caller;
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex min-h-[44px] w-full items-start gap-3 py-2.5 text-left">
        <Score v={r.overall} label="Overall" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-[0.8125rem]">
            <span className="font-medium text-white">Call #{r.call_no ?? "?"}</span>
            {who && <span className="truncate text-white/55">{who}</span>}
            {r.rule_flags?.length > 0 && <span className="inline-flex items-center gap-1 text-rose-300"><ShieldAlert className="h-3.5 w-3.5" aria-hidden />rule slip</span>}
          </span>
          {r.work_on && <span className="mt-0.5 block text-[0.8125rem] leading-snug text-white/75">{r.work_on}</span>}
        </span>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-white/35 transition-transform", open && "rotate-180")} aria-hidden />
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
      {!!r.objections?.length && <p className="text-xs text-white/55">Objections: {r.objections.map((o) => OBJECTION[o] ?? o).join(", ")}</p>}
      {!!r.rule_flags?.length && (
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-rose-300"><ShieldAlert className="h-4 w-4" aria-hidden />{r.rule_flags.map((f) => FLAG[f] ?? f).join(", ")}</p>
      )}
    </div>
  );
}

/** The Coach section of the Scorecard. */
export function AvaCoach({ source, admin = false }: { source: Source; admin?: boolean }) {
  const { c, err, reload } = useCoach(source);
  const [showOld, setShowOld] = useState(false);
  if (err) return <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load the coach: {err}</div>;
  if (!c) return <div className="h-40 animate-pulse rounded-3xl bg-white/[0.03] ring-1 ring-white/10" aria-label="Loading the coach" />;

  const steps = STEPS[source];
  const last = c.weeks[c.weeks.length - 1], prev = c.weeks[c.weeks.length - 2];
  const yourCall = c.playbook.filter((p) => p.status === "proposed");
  const testing = c.playbook.filter((p) => p.status === "testing");
  const live = c.playbook.filter((p) => p.status === "live");
  const old = c.playbook.filter((p) => ["rolled_back", "retired", "declined"].includes(p.status));
  const objections = Object.entries(c.objections ?? {}).sort((a, b) => b[1] - a[1]);
  const total = c.weeks.reduce((n, w) => n + (w.n ?? 0), 0);
  const name = source === "roofguard" ? "RoofGuard Ava" : "Ava";

  return (
    <section id={source === "ava" ? "scorecard" : undefined} aria-label="Coach" className="space-y-4 rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
      <header className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300"><GraduationCap className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[1.0625rem] font-semibold text-white">Coach</h3>
          <p className="text-[0.8125rem] leading-snug text-white/60">
            {source === "roofguard"
              ? "Scores every call on the 5 Steps to a Sale, gives her one thing to work on, and tests new moves on half her calls. Winners stay, losers roll back."
              : "Scores every call, gives her one thing to work on, and suggests new habits. You approve each one."}
          </p>
        </div>
        <span className="whitespace-nowrap text-xs text-white/55">
          {total}&nbsp;reviewed{c.pending > 0 ? <> · {c.pending}&nbsp;waiting</> : null}
        </span>
      </header>

      {/* what she's working on */}
      <div className="flex items-start gap-3 rounded-2xl bg-sky-500/[0.07] px-4 py-3 ring-1 ring-sky-400/20">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.04em] text-sky-300">Working on</div>
          <p className="mt-0.5 text-[0.9375rem] leading-snug text-white">{c.focus ?? `Nothing yet. The coach reviews ${name}'s calls about 10 minutes after they end.`}</p>
        </div>
      </div>

      {/* step scores, latest week vs the one before */}
      {last ? (
        <div>
          <h4 className="mb-2 text-[0.8125rem] font-semibold text-white/80">
            Getting better <span className="font-normal text-white/50">· week of {weekLabel(last.week)}{prev ? ` vs ${weekLabel(prev.week)}` : ""}</span>
          </h4>
          <div className={cn("grid gap-2", steps.length > 5 ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-5")}>
            {steps.map((s) => {
              const v = last[s.key] as number | null, p = prev?.[s.key] as number | null | undefined;
              const d = v != null && p != null ? Math.round((v - p) * 10) / 10 : null;
              return (
                <div key={s.key} className="rounded-2xl bg-white/[0.04] px-3 py-2.5 text-center">
                  <div className="text-xs text-white/60">{s.label}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-white">{fmt(v)}</div>
                  <div className={cn("mt-0.5 inline-flex items-center gap-0.5 whitespace-nowrap text-[0.6875rem] tabular-nums",
                    d == null || d === 0 ? "text-white/40" : d > 0 ? "text-emerald-300" : "text-rose-300")}>
                    {d == null ? "–" : d === 0 ? "same" : <>{d > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}{d > 0 ? "+" : ""}{d}</>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[0.6875rem] text-white/45">Average out of 5 for calls that reached that step. {last.n}&nbsp;calls this week.</p>
        </div>
      ) : null}

      {/* the playbook */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white/[0.03] px-4 ring-1 ring-white/10">
          <h4 className="flex items-center gap-2 pt-3 text-[0.8125rem] font-semibold text-white/85">
            <FlaskConical className="h-4 w-4 text-sky-300" aria-hidden />New moves
          </h4>
          {yourCall.length === 0 && testing.length === 0 ? (
            <p className="py-3 text-sm text-white/55">None right now. Every Monday the coach reads the week and suggests up to 3.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {yourCall.map((p) => <PlayRow key={p.id} badge="yours" p={p} source={source} admin={admin} onDone={() => void reload()} />)}
              {testing.map((p) => <PlayRow key={p.id} badge="testing" p={p} source={source} admin={admin} counts={c.testing_counts?.[p.id]} onDone={() => void reload()} />)}
            </ul>
          )}
        </div>
        <div className="rounded-2xl bg-white/[0.03] px-4 ring-1 ring-white/10">
          <h4 className="flex items-center gap-2 pt-3 text-[0.8125rem] font-semibold text-white/85">
            <Check className="h-4 w-4 text-emerald-300" aria-hidden />Her playbook <span className="font-normal text-white/50">· {live.length}&nbsp;live</span>
          </h4>
          {live.length === 0 ? <p className="py-3 text-sm text-white/55">Empty so far. Moves land here once they win{source === "ava" ? " or you approve them" : " their test"}.</p> : (
            <ul className="divide-y divide-white/5">{live.map((p) => <PlayRow key={p.id} p={p} source={source} admin={admin} onDone={() => void reload()} />)}</ul>
          )}
          {old.length > 0 && (
            <div className="border-t border-white/5 py-2">
              <button type="button" onClick={() => setShowOld(!showOld)} className="min-h-[36px] text-xs text-white/55 hover:text-white/80">
                {showOld ? "Hide" : "Show"} {old.length}&nbsp;dropped
              </button>
              {showOld && <ul className="divide-y divide-white/5 opacity-75">{old.map((p) => <PlayRow key={p.id} p={p} source={source} admin={admin} onDone={() => void reload()} />)}</ul>}
            </div>
          )}
        </div>
      </div>

      {objections.length > 0 && (
        <div>
          <h4 className="mb-2 text-[0.8125rem] font-semibold text-white/80">Objections she hears <span className="font-normal text-white/50">· 30&nbsp;days</span></h4>
          <div className="flex flex-wrap gap-1.5">
            {objections.map(([k, n]) => (
              <span key={k} className="whitespace-nowrap rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-white/75">{OBJECTION[k] ?? k} <b className="tabular-nums text-white">{n}</b></span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-[0.8125rem] font-semibold text-white/80">Latest reviews</h4>
        {c.reviews.length === 0 ? <p className="py-2 text-sm text-white/55">No reviews yet.</p> : (
          <ul className="divide-y divide-white/5">{c.reviews.slice(0, 8).map((r) => <ReviewRow key={r.call_id} r={r} source={source} />)}</ul>
        )}
      </div>
    </section>
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
      <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">
        <GraduationCap className="h-3.5 w-3.5 text-sky-300" aria-hidden />Coach's review
        {r && <span className="ml-auto"><Score v={r.overall} label="Overall" big /></span>}
      </h4>
      {r ? <ReviewBody r={r} source={source} /> : <p className="text-sm text-white/55">Not reviewed yet. The coach reviews calls about 10&nbsp;minutes after they end.</p>}
    </div>
  );
}
