/**
 * The Playbook manager: every rule the Coach (or Jared) has put in an Ava's playbook, with real controls.
 *   Filter  Waiting for you / Testing / Live / Off (rolled back, declined, paused)
 *   Row     rule, why, kind tag, origin tag (Coach / From an incident / You), status pill, live A/B numbers for tests
 *   Actions Approve, Decline, Edit, Pause, Restore, Delete (inline confirm), See calls
 *   Sheet   New rule and Edit. Every save goes through playbook_guard first; a refusal shows inline.
 * Data: admin_coach_manage(source) (passed in). Writes: admin_playbook_set / admin_playbook_upsert / admin_playbook_delete.
 * RoofGuard: a small new rule starts testing on half her calls; a big one goes live after a confirm; editing a testing rule restarts its test.
 * Personal Ava: a new rule goes live right away (too few calls to A/B).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Check, CheckCircle2, ChevronRight, FlaskConical, GraduationCap, Hourglass, Loader2, PauseCircle, Pencil, Phone, Plus, RotateCcw,
  ShieldAlert, Trash2, Undo2, UserRound, X, XCircle,
} from "lucide-react";
import { ScrollSheet } from "./AvaSheet";
import { coachChanged, openCall, onOpenCoach, takePendingFocus } from "./coachBus";
import { APRICOT, Score, pct, plural, ring, rpc, when12, type Arm, type Play, type PlayStatus, type Source } from "./coachShared";

type Filter = "waiting" | "testing" | "live" | "off";
const FILTERS: { id: Filter; label: string; statuses: PlayStatus[] }[] = [
  { id: "waiting", label: "Waiting for you", statuses: ["proposed"] },
  { id: "testing", label: "Testing", statuses: ["testing"] },
  { id: "live", label: "Live", statuses: ["live"] },
  { id: "off", label: "Off", statuses: ["rolled_back", "declined", "retired"] },
];
const filterOf = (s: PlayStatus): Filter => FILTERS.find((f) => f.statuses.includes(s))!.id;

const STATUS: Record<PlayStatus, { label: string; Icon: typeof Check; cls: string }> = {
  proposed: { label: "Waiting for you", Icon: Hourglass, cls: "bg-amber-500/15 text-amber-300" },
  testing: { label: "Testing", Icon: FlaskConical, cls: "bg-sky-500/15 text-sky-300" },
  live: { label: "Live", Icon: CheckCircle2, cls: "bg-emerald-500/15 text-emerald-300" },
  rolled_back: { label: "Rolled back", Icon: Undo2, cls: "bg-rose-500/15 text-rose-300" },
  declined: { label: "Declined", Icon: XCircle, cls: "bg-white/10 text-white/70" },
  retired: { label: "Paused", Icon: PauseCircle, cls: "bg-white/10 text-white/70" },
};
const KIND: Record<string, string> = { comeback: "Comeback", wording: "Wording", pacing: "Pacing", close: "Closing", flow: "Call flow", other: "Other" };
const KINDS = Object.keys(KIND);
const ORIGIN: Record<string, { label: string; Icon: typeof Check }> = {
  coach: { label: "Coach", Icon: GraduationCap },
  incident: { label: "From an incident", Icon: ShieldAlert },
  jared: { label: "You", Icon: UserRound },
};
const TEST_GOAL = 40;
const MAX = 240;

const btn = cn("inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 text-[14px] font-medium transition motion-reduce:transition-none disabled:opacity-50", ring);
const btnGhost = cn(btn, "bg-white/[0.07] text-white/85 hover:bg-white/[0.12]");
const btnGreen = cn(btn, "bg-[#30D158] font-semibold text-[#1c1c1e] hover:bg-[#4bdc72]");
const btnApricot = cn(btn, "font-semibold text-[#1c1c1e] hover:brightness-105");
const btnDanger = cn(btn, "bg-rose-500 font-semibold text-white hover:bg-rose-400");

export function StatusPill({ status }: { status: PlayStatus }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", s.cls)}><s.Icon className="h-3.5 w-3.5" aria-hidden />{s.label}</span>;
}
const Tag = ({ children, icon }: { children: ReactNode; icon?: ReactNode }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-white/75">{icon}{children}</span>
);

// ---------------------------------------------------------------- A/B numbers
function ArmCard({ title, arm, strong }: { title: string; arm: Arm | undefined; strong?: boolean }) {
  const n = arm?.n ?? 0;
  return (
    <div className={cn("rounded-2xl px-3 py-2.5 ring-1", strong ? "bg-sky-500/[0.07] ring-sky-400/25" : "bg-white/[0.04] ring-white/10")}>
      <div className="text-xs font-medium text-white/65">{title}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">{plural(n, "call")}</div>
      <dl className="mt-1 space-y-0.5 text-xs text-white/70">
        <div className="flex justify-between gap-2"><dt>Booked</dt><dd className="whitespace-nowrap tabular-nums text-white/90">{arm?.booked ?? 0} · {pct(arm?.booked ?? 0, n)}</dd></div>
        <div className="flex justify-between gap-2"><dt>Kept talking</dt><dd className="whitespace-nowrap tabular-nums text-white/90">{arm?.kept ?? 0} · {pct(arm?.kept ?? 0, n)}</dd></div>
      </dl>
    </div>
  );
}

function TestNumbers({ p }: { p: Play }) {
  const w = p.test?.with, wo = p.test?.without;
  const lo = Math.min(w?.n ?? 0, wo?.n ?? 0);
  return (
    <div className="space-y-2" aria-label="Live test numbers">
      <div className="grid grid-cols-2 gap-2"><ArmCard title="With the rule" arm={w} strong /><ArmCard title="Without it" arm={wo} /></div>
      <div className="flex items-baseline justify-between text-xs text-white/65">
        <span>Test progress</span><span className="whitespace-nowrap tabular-nums">decides at {TEST_GOAL}&nbsp;calls each</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Test progress" aria-valuemin={0} aria-valuemax={TEST_GOAL} aria-valuenow={Math.min(lo, TEST_GOAL)}>
        <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.min(100, (100 * lo) / TEST_GOAL)}%` }} />
      </div>
      {p.result?.restarted_at && (
        <p className="text-xs text-white/60">Test restarted {when12(p.result.restarted_at)} after an edit.
          {p.result.previous && (p.result.previous.calls_with || p.result.previous.calls_without)
            ? <> Before it: {plural(p.result.previous.calls_with ?? 0, "call")} with, {plural(p.result.previous.calls_without ?? 0, "call")} without.</> : null}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- calls that used a rule
type UsedCall = { call_id: string; call_no: number | null; at: string; who: string | null; lead_id: string | null; outcome: string | null; overall: number | null; phase: "testing" | "live" };
function CallsPanel({ source, p }: { source: Source; p: Play }) {
  const [rows, setRows] = useState<UsedCall[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void rpc<UsedCall[]>("admin_playbook_calls", { p_source: source, p_id: p.id }).then(({ data, error }) => {
      if (off) return;
      if (error) setErr(error.message); else setRows(data ?? []);
    });
    return () => { off = true; };
  }, [source, p.id]);
  if (err) return <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200">Could not load the calls: {err}</p>;
  if (!rows) return <div className="flex min-h-[44px] items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-white/50" aria-label="Loading calls" /></div>;
  if (rows.length === 0) return <p className="rounded-xl bg-white/[0.04] px-3 py-3 text-sm text-white/65">No calls have used this rule yet. {p.status === "testing" ? "Calls on the with-the-rule side of the test show up here." : "Calls after it went live show up here."}</p>;
  return (
    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
      <p className="px-3 pt-2.5 text-xs text-white/60">{rows.length >= 40 ? "The latest 40 calls that used it." : `${plural(rows.length, "call")} used it.`} Tap one to open it.</p>
      <ul className="divide-y divide-white/5">
        {rows.map((r) => (
          <li key={r.call_id}>
            <button type="button" onClick={() => openCall(source, r.call_id, r.lead_id)} className={cn("flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.05]", ring)}>
              <Phone className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span className="font-mono text-xs tabular-nums text-white/70">#{r.call_no ?? "?"}</span>
                  <span className="truncate font-medium text-white">{r.who || "Unknown"}</span>
                </span>
                <span className="block text-xs text-white/55">{when12(r.at)}{r.outcome ? ` · ${r.outcome.replace(/_/g, " ")}` : ""}{p.status === "testing" || r.phase === "testing" ? " · with the rule" : ""}</span>
              </span>
              {r.overall != null && <Score v={r.overall} label="Overall" />}
              <ChevronRight className="h-4 w-4 shrink-0 text-white/30" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- one rule
type Pending = { id: string; kind: "delete" | "restore" } | null;

function RuleRow({ p, source, busy, confirm, showCalls, highlight, onAct, onEdit, onConfirm, onToggleCalls }: {
  p: Play; source: Source; busy: string | null; confirm: Pending; showCalls: boolean; highlight: boolean;
  onAct: (p: Play, a: "approve" | "decline" | "retire" | "restore" | "delete") => void; onEdit: (p: Play) => void;
  onConfirm: (c: Pending) => void; onToggleCalls: (id: string) => void;
}) {
  const origin = ORIGIN[p.origin] ?? ORIGIN.coach;
  const asking = confirm?.id === p.id ? confirm.kind : null;
  const b = (a: string) => busy === `${p.id}:${a}`;
  const anyBusy = busy !== null;
  const canCalls = p.status === "testing" || p.status === "live";
  const off = p.status === "rolled_back" || p.status === "declined" || p.status === "retired";
  return (
    <li id={`coach-rule-${p.id}`} className={cn("scroll-mt-24 rounded-2xl bg-white/[0.035] p-4 ring-1 transition-shadow motion-reduce:transition-none", highlight ? "ring-2 ring-[#FFA270]" : "ring-white/10")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill status={p.status} />
        <Tag>{KIND[p.kind] ?? "Other"}</Tag>
        <Tag icon={<origin.Icon className="h-3.5 w-3.5" aria-hidden />}>{origin.label}</Tag>
        {p.size === "big" && <Tag>Big change</Tag>}
        {canCalls && p.calls_used != null && <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-white/55">{plural(p.calls_used, "call")} so far</span>}
      </div>
      <p className="mt-2.5 text-[15px] leading-snug text-white [overflow-wrap:anywhere]">{p.rule}</p>
      {p.why && <p className="mt-1 text-[13px] leading-snug text-white/65 [overflow-wrap:anywhere]">Why: {p.why}</p>}

      {p.status === "testing" && <div className="mt-3"><TestNumbers p={p} /></div>}
      {off && p.result?.calls_with != null && (
        <p className="mt-2 text-xs text-white/60">Last test: {plural(p.result.calls_with, "call")} with it, {p.result.calls_without ?? 0}&nbsp;without. Score {p.result.score_with ?? "–"} vs {p.result.score_without ?? "–"}.</p>
      )}
      {p.decided_at && (p.status === "live" || off) && <p className="mt-1 text-xs text-white/50">{p.status === "live" ? "Live since" : p.status === "rolled_back" ? "Rolled back" : p.status === "declined" ? "Declined" : "Paused"} {when12(p.decided_at)}</p>}

      {asking === "delete" ? (
        <div role="alertdialog" aria-label="Delete this rule?" className="mt-3 rounded-2xl bg-rose-500/10 p-3 ring-1 ring-rose-400/30">
          <p className="text-sm text-white">This removes the rule and its history.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" className={btnGhost} onClick={() => onConfirm(null)} autoFocus>Keep it</button>
            <button type="button" className={btnDanger} disabled={anyBusy} onClick={() => onAct(p, "delete")}>{b("delete") ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}Delete rule</button>
          </div>
        </div>
      ) : asking === "restore" ? (
        <div role="alertdialog" aria-label="Put this rule back live?" className="mt-3 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/15">
          <p className="text-sm text-white">Put it back live? It skips the test and goes on every call.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" className={btnGhost} onClick={() => onConfirm(null)} autoFocus>Not now</button>
            <button type="button" className={btnGreen} disabled={anyBusy} onClick={() => onAct(p, "restore")}>{b("restore") ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}Put it back</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {p.status === "proposed" && <>
            <button type="button" className={btnGreen} disabled={anyBusy} onClick={() => onAct(p, "approve")}>
              {b("approve") ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}{source === "roofguard" ? "Start the test" : "Approve"}</button>
            <button type="button" className={btnGhost} disabled={anyBusy} onClick={() => onAct(p, "decline")}>
              {b("decline") ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}Decline</button>
          </>}
          {off && (
            <button type="button" className={btnGhost} disabled={anyBusy} onClick={() => (source === "roofguard" ? onConfirm({ id: p.id, kind: "restore" }) : onAct(p, "restore"))}>
              {b("restore") ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}Restore</button>
          )}
          {(p.status === "live" || p.status === "testing") && (
            <button type="button" className={btnGhost} disabled={anyBusy} onClick={() => onAct(p, "retire")}>
              {b("retire") ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PauseCircle className="h-4 w-4" aria-hidden />}{p.status === "testing" ? "Stop the test" : "Pause"}</button>
          )}
          {canCalls && (
            <button type="button" className={btnGhost} aria-expanded={showCalls} onClick={() => onToggleCalls(p.id)}>
              <Phone className="h-4 w-4" aria-hidden />{showCalls ? "Hide calls" : "See calls"}</button>
          )}
          <button type="button" className={btnGhost} disabled={anyBusy} onClick={() => onEdit(p)}><Pencil className="h-4 w-4" aria-hidden />Edit</button>
          <button type="button" className={cn(btn, "text-rose-300 hover:bg-rose-500/10")} disabled={anyBusy} onClick={() => onConfirm({ id: p.id, kind: "delete" })}
            aria-label={`Delete rule: ${p.rule.slice(0, 60)}`}><Trash2 className="h-4 w-4" aria-hidden />Delete</button>
        </div>
      )}
      {showCalls && canCalls && <div className="mt-3"><CallsPanel source={source} p={p} /></div>}
    </li>
  );
}

// ---------------------------------------------------------------- the manager
export function PlaybookManager({ source, rules, loading, reload }: { source: Source; rules: Play[]; loading: boolean; reload: () => Promise<void> | void }) {
  const [filter, setFilter] = useState<Filter | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending>(null);
  const [calls, setCalls] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ edit: Play | null } | null>(null);
  const [hl, setHl] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const personal = source === "ava";

  const visibleFilters = personal ? FILTERS.filter((f) => f.id !== "testing") : FILTERS;
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, rules.filter((r) => f.statuses.includes(r.status)).length])) as Record<Filter, number>, [rules]);
  const auto: Filter = visibleFilters.find((f) => counts[f.id] > 0)?.id ?? "live";
  const active: Filter = filter && visibleFilters.some((f) => f.id === filter) ? filter : auto;
  const shown = rules.filter((r) => FILTERS.find((f) => f.id === active)!.statuses.includes(r.status));

  // a request from the Reply guard / Scorecard to jump to one rule (made before this mounted, or while it is showing)
  useEffect(() => {
    const take = () => { const id = takePendingFocus(source); if (id) setFocusId(id); };
    take();
    return onOpenCoach(source, take);
  }, [source]);
  useEffect(() => {
    if (!focusId || loading) return;
    const r = rules.find((x) => x.id === focusId);
    setFocusId(null);
    if (!r) { if (rules.length) toast.message("That rule is no longer in the playbook"); return; }
    setFilter(filterOf(r.status)); setConfirm(null); setHl(r.id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => document.getElementById(`coach-rule-${r.id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }), 150);
    window.setTimeout(() => setHl((h) => (h === r.id ? null : h)), 4500);
  }, [focusId, loading, rules]);

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = visibleFilters.findIndex((f) => f.id === active), n = visibleFilters.length;
    const next = visibleFilters[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n];
    setFilter(next.id); setConfirm(null); setCalls(null);
    requestAnimationFrame(() => document.getElementById(`coach-tab-${source}-${next.id}`)?.focus());
    e.preventDefault();
  };

  const done = async (msg: string) => { toast.success(msg); await reload(); coachChanged(source); };

  const act = async (p: Play, a: "approve" | "decline" | "retire" | "restore" | "delete") => {
    setBusy(`${p.id}:${a}`);
    const res = a === "delete"
      ? await rpc("admin_playbook_delete", { p_source: source, p_id: p.id })
      : await rpc("admin_playbook_set", { p_source: source, p_id: p.id, p_action: a });
    setBusy(null); setConfirm(null);
    if (res.error) { toast.error(res.error.message); return; }
    await done(a === "approve" ? (source === "roofguard" ? "Testing it on half her calls" : "She'll use it from her next call")
      : a === "decline" ? "Declined" : a === "retire" ? "Paused. She won't use it" : a === "restore" ? "Back in her playbook" : "Rule deleted");
  };

  return (
    <section aria-label="Playbook" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-[15px] font-semibold text-white">Playbook <span className="font-normal text-white/55">· her rules</span></h4>
          <p className="text-xs text-white/60">Short instructions that reach her on every call. They can never touch her hard rules.</p>
        </div>
        <button type="button" className={btnApricot} style={{ background: APRICOT }} onClick={() => setSheet({ edit: null })}><Plus className="h-4 w-4" aria-hidden />New rule</button>
      </div>

      <div role="tablist" aria-label="Rules by state" onKeyDown={onTabKey} className="flex gap-1 overflow-x-auto rounded-2xl bg-white/[0.06] p-1 ring-1 ring-white/10 [scrollbar-width:none]">
        {visibleFilters.map((f) => (
          <button key={f.id} type="button" role="tab" id={`coach-tab-${source}-${f.id}`} aria-selected={active === f.id} tabIndex={active === f.id ? 0 : -1} aria-controls={`coach-panel-${source}`}
            onClick={() => { setFilter(f.id); setConfirm(null); setCalls(null); }}
            className={cn("flex min-h-[44px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-medium transition-colors motion-reduce:transition-none", ring,
              active === f.id ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white")}>
            {f.label}
            <span className={cn("min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums", active === f.id ? "bg-black/10" : "bg-white/10",
              f.id === "waiting" && counts.waiting > 0 && active !== f.id && "bg-amber-500/25 text-amber-200")}>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <div id={`coach-panel-${source}`} role="tabpanel" aria-labelledby={`coach-tab-${source}-${active}`}>
        {loading ? <div className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" aria-label="Loading rules" /> : shown.length === 0 ? (
          <EmptyState filter={active} source={source} onNew={() => setSheet({ edit: null })} />
        ) : (
          <ul className="space-y-2.5">
            {shown.map((p) => (
              <RuleRow key={p.id} p={p} source={source} busy={busy} confirm={confirm} showCalls={calls === p.id} highlight={hl === p.id}
                onAct={(r, a) => void act(r, a)} onEdit={(r) => setSheet({ edit: r })} onConfirm={setConfirm} onToggleCalls={(id) => setCalls((c) => (c === id ? null : id))} />
            ))}
          </ul>
        )}
      </div>

      <RuleSheet source={source} open={!!sheet} edit={sheet?.edit ?? null} onClose={() => setSheet(null)}
        onSaved={async (msg) => { setSheet(null); await done(msg); }} />
    </section>
  );
}

function EmptyState({ filter, source, onNew }: { filter: Filter; source: Source; onNew: () => void }) {
  const text: Record<Filter, string> = {
    waiting: source === "roofguard"
      ? "Nothing waiting. Every Monday the Coach reads the week and suggests up to 3 rules. Small ones start testing on their own (you can change that in Settings); big ones wait here."
      : "Nothing waiting. Every Monday the Coach reads the week and suggests up to 3 rules. They wait here for your tap.",
    testing: "No tests running. A small rule tested on half her calls shows its live numbers here.",
    live: "No live rules yet. Rules land here once they win a test or you approve them.",
    off: "Nothing turned off. Rolled-back, declined and paused rules wait here, and you can put any of them back.",
  };
  return (
    <div className="rounded-2xl bg-white/[0.03] px-4 py-6 text-center ring-1 ring-white/10">
      <p className="mx-auto max-w-md text-sm text-white/65">{text[filter]}</p>
      <button type="button" className={cn(btnGhost, "mt-3")} onClick={onNew}><Plus className="h-4 w-4" aria-hidden />Write a rule yourself</button>
    </div>
  );
}

// ---------------------------------------------------------------- new / edit sheet
export function RuleSheet({ source, open, edit, onClose, onSaved }: { source: Source; open: boolean; edit: Play | null; onClose: () => void; onSaved: (msg: string) => void | Promise<void> }) {
  const uid = useId();
  const [rule, setRule] = useState(""), [why, setWhy] = useState(""), [kind, setKind] = useState("other"), [size, setSize] = useState<"small" | "big">("small");
  const [reason, setReason] = useState<string | null>(null);   // playbook_guard / save refusal
  const [saving, setSaving] = useState(false);
  const [bigAsk, setBigAsk] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setRule(edit?.rule ?? ""); setWhy(edit?.why ?? ""); setKind(edit?.kind ?? "other"); setSize(edit?.size ?? "small");
    setReason(null); setSaving(false); setBigAsk(false); setDiscardAsk(false); setFail(null);
    const t = setTimeout(() => first.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [open, edit]);

  const text = rule.replace(/\s+/g, " ").trim();
  const dirty = open && (rule !== (edit?.rule ?? "") || why !== (edit?.why ?? "") || kind !== (edit?.kind ?? "other") || size !== (edit?.size ?? "small"));

  // the hard-rule guard as she types (the same playbook_guard the Coach and the save use)
  useEffect(() => {
    if (!open) return;
    if (text.length < 12) { setReason(null); return; }
    let off = false;
    const t = setTimeout(() => {
      void rpc<string | null>("playbook_guard", { p_rule: text }).then(({ data }) => { if (!off) setReason(typeof data === "string" && data ? data : null); });
    }, 500);
    return () => { off = true; clearTimeout(t); };
  }, [text, open]);

  const restartsTest = source === "roofguard" && edit?.status === "testing";
  const wordingChanged = !!edit && text !== edit.rule.replace(/\s+/g, " ").trim();

  const save = async (confirmed = false) => {
    setFail(null);
    const g = await rpc<string | null>("playbook_guard", { p_rule: text });                    // guard first
    if (g.error) { setFail(g.error.message); return; }
    if (typeof g.data === "string" && g.data) { setReason(g.data); return; }
    if (source === "roofguard" && !edit && size === "big" && !confirmed) { setBigAsk(true); return; }
    setSaving(true);
    const { data, error } = await rpc<{ ok: boolean; refused?: string; restarted?: boolean }>("admin_playbook_upsert",
      { p_source: source, p_id: edit?.id ?? null, p_rule: text, p_why: why.trim(), p_kind: kind, p_size: size });
    setSaving(false); setBigAsk(false);
    if (error) { setFail(error.message); return; }
    if (!data?.ok) { setReason(data?.refused ?? "That didn't save."); return; }
    await onSaved(edit ? (data.restarted ? "Saved. The test starts over" : "Saved") : source === "ava" ? "Added. She'll use it from her next call"
      : size === "big" ? "Added and live" : "Added. Testing it on half her calls");
  };

  const requestClose = () => { if (dirty && !saving) setDiscardAsk(true); else onClose(); };
  const over = text.length > MAX - 20;
  const ruleErr = reason;
  const sizeHelp = edit ? (restartsTest ? "" : "Changes reach her on her next call.")
    : source === "ava" ? "Goes live on her very next call."
    : size === "small" ? "Starts as a test on half her calls. The Coach keeps it if it wins and rolls it back if it doesn't."
    : "Goes live on every call right away, after you confirm.";

  return (
    <ScrollSheet open={open} onClose={requestClose}
      title={<><span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${APRICOT}26`, color: APRICOT }}><GraduationCap className="h-4 w-4" aria-hidden /></span>{edit ? "Edit rule" : "New rule"}</>}
      description={source === "ava" ? "One short instruction for Ava." : "One short instruction for RoofGuard Ava."}>
      <form className="space-y-5 pb-4 pt-1" onSubmit={(e) => { e.preventDefault(); if (!saving && !bigAsk && text && !reason && text.length <= MAX) void save(); }}>
        {discardAsk && (
          <div role="alertdialog" aria-label="Discard your changes?" className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/15">
            <p className="text-sm text-white">Discard what you typed?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className={btnGhost} onClick={() => setDiscardAsk(false)} autoFocus>Keep editing</button>
              <button type="button" className={btnDanger} onClick={() => { setDiscardAsk(false); onClose(); }}>Discard</button>
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label htmlFor={`${uid}-rule`} className="text-[13px] font-medium text-white">The rule</label>
            <span className={cn("whitespace-nowrap text-xs tabular-nums", over ? "text-amber-300" : "text-white/55")} aria-live="polite">{text.length}&nbsp;/&nbsp;{MAX}</span>
          </div>
          <textarea id={`${uid}-rule`} ref={first} rows={4} maxLength={MAX} value={rule} onChange={(e) => { setRule(e.target.value); setReason(null); }}
            aria-invalid={!!ruleErr} aria-describedby={`${uid}-rule-help ${uid}-rule-err`}
            placeholder="When they say they already have a roofer, say you only need a minute and ask who looks after the roofs."
            className={cn("w-full resize-none rounded-xl bg-white/[0.06] px-3 py-2.5 text-[15px] leading-snug text-white placeholder:text-white/35 ring-1", ruleErr ? "ring-rose-400/60" : "ring-white/10", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60")} />
          <p id={`${uid}-rule-err`} role="alert" className={cn("mt-1.5 flex items-start gap-1.5 text-sm text-rose-300", !ruleErr && "hidden")}>
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{ruleErr ? <>Can't save this one: {ruleErr}.</> : null}</span></p>
          <p id={`${uid}-rule-help`} className="mt-1.5 text-xs leading-snug text-white/60">
            Write it as an instruction to her. A rule can never touch her hard rules: the AI disclosure, the recording notice, do-not-call, saying "replacement", insurance wording,
            dollar amounts, other clients, or invented deadlines. It's checked before it saves.</p>
        </div>

        <div>
          <label htmlFor={`${uid}-why`} className="mb-1 block text-[13px] font-medium text-white">Why <span className="font-normal text-white/55">(optional)</span></label>
          <input id={`${uid}-why`} value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} placeholder="What you noticed that made you want this"
            className="min-h-[44px] w-full rounded-xl bg-white/[0.06] px-3 text-[15px] text-white ring-1 ring-white/10 placeholder:text-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60" />
        </div>

        <div>
          <label htmlFor={`${uid}-kind`} className="mb-1 block text-[13px] font-medium text-white">Kind</label>
          <select id={`${uid}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}
            className="min-h-[44px] w-full appearance-none rounded-xl bg-white/[0.06] px-3 text-[15px] text-white ring-1 ring-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            {KINDS.map((k) => <option key={k} value={k} className="bg-[#1c1c1e]">{KIND[k]}</option>)}
          </select>
        </div>

        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-white">Size</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Size of the change">
            {([["small", "Small tweak", "A wording, comeback or pacing change"], ["big", "Big change", "A new angle, opener or call flow"]] as const).map(([v, t, d]) => (
              <button key={v} type="button" role="radio" aria-checked={size === v} onClick={() => setSize(v)}
                className={cn("min-h-[56px] rounded-xl px-3 py-2 text-left ring-1 transition motion-reduce:transition-none", ring, size === v ? "bg-white/[0.12] ring-white/40" : "bg-white/[0.04] ring-white/10 hover:bg-white/[0.07]")}>
                <span className="flex items-center gap-1.5 text-[14px] font-medium text-white">{size === v && <Check className="h-4 w-4" aria-hidden />}{t}</span>
                <span className="mt-0.5 block text-xs leading-snug text-white/60">{d}</span>
              </button>
            ))}
          </div>
          {sizeHelp && <p className="mt-1.5 text-xs leading-snug text-white/60">{sizeHelp}</p>}
        </fieldset>

        {restartsTest && (
          <p className={cn("flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm leading-snug ring-1", wordingChanged ? "bg-amber-500/10 text-amber-100 ring-amber-400/30" : "bg-white/[0.04] text-white/75 ring-white/10")}>
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Changing the wording of a rule that's being tested restarts its test: the clock and the call counts go back to zero.</span></p>
        )}
        {source === "roofguard" && !edit && size === "small" && (
          <p className="flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-sm leading-snug text-white/75 ring-1 ring-white/10"><FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden />Tests run on half her calls until about {TEST_GOAL}&nbsp;calls on each side.</p>
        )}

        {fail && <p role="alert" className="flex items-start gap-1.5 text-sm text-rose-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{fail}</p>}

        {bigAsk ? (
          <div role="alertdialog" aria-label="Put this big change live?" className="rounded-2xl bg-amber-500/10 p-3 ring-1 ring-amber-400/30">
            <p className="text-sm text-white">A big change skips the test and goes on every call right away. Put it live?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className={btnGhost} onClick={() => setBigAsk(false)} autoFocus>Go back</button>
              <button type="button" className={btnGreen} disabled={saving} onClick={() => void save(true)}>{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Go live now</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" className={cn(btnGhost, "flex-1")} onClick={requestClose}>Cancel</button>
            <button type="submit" disabled={saving || !text || !!reason || text.length > MAX} className={cn(btnApricot, "flex-[2]")} style={{ background: APRICOT }}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{edit ? "Save changes" : "Add rule"}</button>
          </div>
        )}
      </form>
    </ScrollSheet>
  );
}
