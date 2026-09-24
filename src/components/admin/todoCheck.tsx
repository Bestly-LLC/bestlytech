/**
 * "Check if it's done" for to-dos, shared by the top of the home page (CommandHero) and
 * Scout's list (ScoutToday). Backend: the todo-check edge function + todo_check_* tables.
 *
 * Every check goes into a queue on the server, so it keeps running if Jared leaves the page;
 * this hook just watches the queue (fast while something is running, slow otherwise) and
 * tells the page to reload when a to-do's result lands. A finished run also sends a notification.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, RefreshCw, SearchCheck, ThumbsDown, ThumbsUp, Undo2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface CheckRow { id: string; title: string; status: string; action: Record<string, any>; done_at?: string | null }
interface Settings { auto_close: boolean; threshold: number; note: string | null }
interface Run { id: string; trigger: string; total: number; finished: number; looks_done: number; closed: number; errors: number; created_at: string; finished_at: string | null }

const btn = "inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80 disabled:opacity-60";
const ghost = cn(btn, "text-white/70 hover:bg-white/[0.06] hover:text-white");

export const time12 = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  : "";
const clock12 = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";

/* ───────── state ───────── */

export function useTodoCheck(onChange: () => void) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<Run | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [starting, setStarting] = useState(false);
  const prev = useRef<Set<string>>(new Set());
  const changed = useRef(onChange);
  changed.current = onChange;

  const poll = useCallback(async () => {
    const [{ data: jobs }, { data: runs }, { data: s }] = await Promise.all([
      supabase.from("todo_check_jobs" as never).select("todo_id").in("status", ["queued", "running"]).limit(100),
      supabase.from("todo_check_runs" as never).select("*").neq("trigger", "button").order("created_at", { ascending: false }).limit(1),
      supabase.from("todo_check_settings" as never).select("auto_close, threshold, note").eq("id", 1).maybeSingle(),
    ]);
    const now = new Set(((jobs ?? []) as any[]).map((j) => String(j.todo_id)));
    // something finished since the last look: reload the to-dos so the result shows
    if ([...prev.current].some((id) => !now.has(id))) changed.current();
    prev.current = now;
    setPending(now);
    setRun(((runs ?? []) as any[])[0] ?? null);
    if (s) setSettings(s as any);
  }, []);

  const busy = pending.size > 0 || (run && !run.finished_at);
  useEffect(() => {
    poll();
    const t = setInterval(poll, busy ? 3000 : 30000);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [poll, busy]);

  const checkOne = async (id: string) => {
    setPending((p) => new Set(p).add(id));
    prev.current = new Set(prev.current).add(id);
    const { data, error } = await supabase.functions.invoke("todo-check", { body: { op: "check", id } });
    const d = data as any;
    if (error || !d?.ok) { toast.error(d?.error ?? error?.message ?? "Couldn't start the check"); poll(); return; }
    poll();
  };

  const checkAll = async () => {
    setStarting(true);
    const { data, error } = await supabase.functions.invoke("todo-check", { body: { op: "sweep" } });
    setStarting(false);
    const d = data as any;
    if (error || !d?.ok) { toast.error(d?.error ?? error?.message ?? "Couldn't start the check"); return; }
    toast.success(d.total ? `Checking ${d.total} to-do${d.total === 1 ? "" : "s"}. You can leave this page; Scout will notify you.` : "Everything is already being checked.");
    poll();
  };

  const feedback = async (r: CheckRow, kind: "up" | "down" | "undo", note?: string) => {
    const checkId = r.action?.check?.id ?? r.action?.auto_closed?.check_id;
    if (!checkId) return;
    const { data, error } = await supabase.rpc("todo_check_feedback" as never, { p_check: checkId, p_kind: kind, p_note: note ?? null } as never);
    if (error) { toast.error(error.message); return; }
    toast.success(kind === "up" ? "Thanks. Scout will trust checks like this more."
      : (data as any)?.reopened ? "Put back. Scout is learning from this." : "Got it. Scout is learning from this.");
    changed.current();
    poll();
  };

  const setAuto = async (on: boolean) => {
    setSettings((s) => (s ? { ...s, auto_close: on } : s));
    const { data, error } = await supabase.rpc("todo_check_set_auto" as never, { p_on: on } as never);
    if (error) { toast.error(error.message); poll(); return; }
    setSettings(data as any);
    toast.success(on ? "Scout will close to-dos it proves, nightly at 10 PM" : "Scout will only check when you ask");
  };

  return { pending, run, settings, starting, checkOne, checkAll, feedback, setAuto };
}
export type TodoCheck = ReturnType<typeof useTodoCheck>;

/* ───────── the big panel (top of "Your to-dos") ───────── */

export function CheckAllPanel({ tc }: { tc: TodoCheck }) {
  const { run, settings, starting } = tc;
  const active = !!run && !run.finished_at;
  const pct = run && run.total ? Math.round((run.finished / run.total) * 100) : 0;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-indigo-400/25 bg-gradient-to-br from-indigo-500/[0.14] via-white/[0.02] to-emerald-500/[0.10] p-4 bento:border-transparent bento:from-[#EEF0FF] bento:via-white bento:to-[#EAF8F1]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-500/20 text-indigo-200 bento:bg-indigo-100 bento:text-indigo-700">
            {active ? <RefreshCw className="h-5 w-5 animate-spin" /> : <SearchCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[1.02rem] font-semibold leading-tight text-white">
              {active ? `Checking ${Math.min(run!.finished + 1, run!.total)} of ${run!.total}…` : "Did any of these get done?"}
            </p>
            <p className="mt-0.5 text-sm text-white/60">
              {active
                ? "Keeps going if you leave this page. Scout will notify you."
                : run
                  ? `Last check ${clock12(run.finished_at ?? run.created_at)}: ${run.looks_done} look done${run.closed ? `, ${run.closed} closed` : ""}${run.errors ? `, ${run.errors} couldn't be checked` : ""}`
                  : "Scout looks through your email, memory, calls, Vault, Deck and git for proof."}
            </p>
          </div>
        </div>
        <button onClick={tc.checkAll} disabled={active || starting}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-[0.95rem] font-semibold text-black shadow-[0_8px_24px_-10px_rgba(99,102,241,0.7)] transition hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 bento:bg-[#111114] bento:text-white">
          {starting || active ? <RefreshCw className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
          {active ? "Checking…" : "Check them all"}
        </button>
      </div>
      {active && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-[width] duration-500" style={{ width: `${Math.max(6, pct)}%` }} />
        </div>
      )}
      {settings && (
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 border-t border-white/[0.07] pt-3 text-sm text-white/70 bento:border-black/5">
          <Switch checked={settings.auto_close} onCheckedChange={tc.setAuto} aria-label="Let Scout close to-dos it proves" />
          <span>
            <span className="font-medium text-white/85">Close them for me</span>
            <span className="text-white/50">
              {settings.auto_close
                ? ` · nightly at 10 PM, only when ${Math.round(settings.threshold * 100)}% sure with 2 kinds of proof. Put back any time.`
                : ` · off${settings.note ? ` (${settings.note})` : ""}. Scout only checks when you ask.`}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

/* ───────── per to-do ───────── */

export function CheckButton({ busy, onClick, compact }: { busy: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className={cn(btn, "shrink-0 border border-indigo-400/30 bg-indigo-500/10 text-indigo-100 hover:bg-indigo-500/20 bento:border-indigo-200 bento:bg-indigo-50 bento:text-indigo-800", compact && "min-h-[34px] px-2.5 text-xs")}
      aria-label="Check if it's done" title="Scout looks for proof in your email, memory, calls, Vault, Deck and git">
      {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
      {busy ? "Checking…" : "Check"}
    </button>
  );
}

const VERDICT = {
  done: { label: "Looks done", tint: "bg-emerald-500/15 text-emerald-200 bento:bg-emerald-100 bento:text-emerald-800" },
  partly: { label: "Partly done", tint: "bg-amber-500/15 text-amber-200 bento:bg-amber-100 bento:text-amber-800" },
  not_done: { label: "Not yet", tint: "bg-white/10 text-white/70" },
  unknown: { label: "Can't tell", tint: "bg-white/10 text-white/70" },
} as const;

export function Evidence({ items }: { items: any[] }) {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  return (
    <div className="mt-1">
      <button className="text-xs text-white/50 underline-offset-2 hover:text-white/80 hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide proof" : `Why (${items.length})`}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((e) => (
            <li key={e.id} className="text-xs leading-relaxed text-white/60">
              <span className="font-semibold uppercase tracking-wide text-white/45">{e.src}</span>
              {e.at ? ` · ${time12(e.at)}` : ""} · {e.url
                ? (/^https?:\/\//.test(e.url) ? <a href={e.url} target="_blank" rel="noreferrer" className="underline">{e.title}</a> : <Link to={e.url} className="underline">{e.title}</Link>)
                : e.title}
              {e.quote && <span className="block text-white/45">{String(e.quote).replace(/[«»]/g, "").slice(0, 220)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The result under a to-do. Mark done (when it looks done), thumbs up, thumbs down with a note. */
export function CheckResult({ r, tc, onDone }: { r: CheckRow; tc: TodoCheck; onDone: () => void }) {
  const c = r.action?.check ?? {};
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const v = VERDICT[(c.verdict as keyof typeof VERDICT) ?? "unknown"] ?? VERDICT.unknown;
  const rated = c.feedback === "up" || c.feedback === "down" || c.feedback === "undo";
  return (
    <div className="mt-2 rounded-xl border border-white/[0.07] bg-black/15 p-2.5 bento:border-black/5 bento:bg-[var(--bento-well)]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", v.tint)}>{v.label}</span>
        {typeof c.confidence === "number" && c.verdict !== "unknown" && <span className="text-xs tabular-nums text-white/45">{Math.round(c.confidence * 100)}% sure</span>}
        {c.at && <span className="text-xs text-white/40">· {time12(c.at)}</span>}
      </div>
      {c.summary && <p className="mt-1 text-sm leading-relaxed text-white/70">{c.summary}</p>}
      {c.remaining && c.verdict !== "done" && <p className="mt-0.5 text-xs text-white/55">Left: {c.remaining}</p>}
      <Evidence items={c.evidence ?? []} />
      {asking ? (
        <form className="mt-2 flex flex-wrap items-center gap-1" onSubmit={(e) => { e.preventDefault(); tc.feedback(r, "down", note); setAsking(false); }}>
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's actually true? (optional)"
            className="min-h-[36px] min-w-0 flex-1 rounded-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-white/25 bento:border-black/10 bento:bg-white" />
          <button type="submit" className={ghost}>Send</button>
          <button type="button" className={cn(ghost, "px-2.5")} aria-label="Cancel" onClick={() => setAsking(false)}><X className="h-4 w-4" /></button>
        </form>
      ) : (
        <div className="-mx-1 mt-1.5 flex flex-wrap items-center gap-1">
          {c.verdict === "done" && r.status === "open" && (
            <button className={cn(ghost, "min-h-[34px]")} onClick={() => { onDone(); tc.feedback(r, "up"); }}><Check className="h-4 w-4" /> Mark done</button>
          )}
          {rated ? (
            <span className="px-2 text-xs text-white/45">{c.feedback === "up" ? "You said this was right" : "Scout is learning from your correction"}</span>
          ) : (
            <>
              <button className={cn(ghost, "min-h-[34px] px-2.5")} aria-label="Right" title="Right" onClick={() => tc.feedback(r, "up")}><ThumbsUp className="h-4 w-4" /></button>
              <button className={cn(ghost, "min-h-[34px] px-2.5")} aria-label="Wrong: tell Scout" title="Wrong: tell Scout what's actually true" onClick={() => setAsking(true)}><ThumbsDown className="h-4 w-4" /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** What Scout closed on its own in the last 3 days, each with Put back. */
export function ClosedByScout({ rows, tc }: { rows: CheckRow[]; tc: TodoCheck }) {
  if (!rows.length) return null;
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-white/50">Closed by Scout · {rows.length}</p>
      <ul className="space-y-1">
        {rows.map((c) => (
          <li key={c.id} className="flex items-start gap-3 rounded-xl bg-emerald-500/[0.06] px-3 py-2 bento:bg-emerald-50">
            <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-300 bento:text-emerald-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[0.9375rem] text-white/75 line-through decoration-white/30">{c.title}</p>
              {c.action?.check?.summary && <p className="mt-0.5 text-sm text-white/55">{c.action.check.summary}</p>}
              <Evidence items={c.action?.check?.evidence ?? []} />
            </div>
            <button className={cn(ghost, "min-h-[34px]")} onClick={() => tc.feedback(c, "undo")} title="Not done: reopen it and teach Scout">
              <Undo2 className="h-4 w-4" /> Put back
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
