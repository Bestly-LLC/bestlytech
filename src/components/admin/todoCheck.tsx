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
import { Check, ChevronDown, RefreshCw, SearchCheck, ThumbsDown, ThumbsUp, Undo2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface CheckRow { id: string; title: string; status: string; action: Record<string, any>; done_at?: string | null }
interface Settings { auto_close: boolean; threshold: number; note: string | null }
interface Run { id: string; trigger: string; total: number; finished: number; looks_done: number; closed: number; errors: number; created_at: string; finished_at: string | null }


export const time12 = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  : "";
const clock12 = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";

/** Open/closed that survives a reload (this browser only). */
export function useRemembered(key: string, initial: boolean): [boolean, () => void] {
  const [v, setV] = useState<boolean>(() => {
    try { const x = localStorage.getItem(key); return x === null ? initial : x === "1"; } catch { return initial; }
  });
  const toggle = () => setV((o) => {
    try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* private mode */ }
    return !o;
  });
  return [v, toggle];
}

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

/* ───────── look (Apple system colors; hex so the light theme's white/black swap can't flip them) ───────── */

const BLUE_TEXT = "text-[#0A84FF] bento:text-[#007AFF]";
const BLUE_FILL = "bg-[#0A84FF] bento:bg-[#007AFF] text-[#fff]";
const tap = "transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/60 disabled:opacity-50";

const VERDICT = {
  done: { label: "Looks done", dot: "bg-[#30D158] bento:bg-[#34C759]", text: "text-[#30D158] bento:text-[#248A3D]" },
  partly: { label: "Partly done", dot: "bg-[#FF9F0A] bento:bg-[#FF9500]", text: "text-[#FF9F0A] bento:text-[#C93400]" },
  not_done: { label: "Not yet", dot: "bg-white/30", text: "text-white/60" },
  unknown: { label: "Can't tell", dot: "bg-white/20", text: "text-white/50" },
} as const;

/* ───────── the control row under "Your to-dos" ───────── */

export function CheckAllPanel({ tc }: { tc: TodoCheck }) {
  const { run, settings, starting } = tc;
  const active = !!run && !run.finished_at;
  const pct = run && run.total ? Math.round((run.finished / run.total) * 100) : 0;
  const status = active
    ? `Checking ${Math.min(run!.finished + 1, run!.total)} of ${run!.total}. Keeps going if you leave.`
    : run
      ? `Last check ${clock12(run.finished_at ?? run.created_at)} · ${run.looks_done} look done${run.closed ? ` · ${run.closed} closed` : ""}`
      : "Finds proof in your email, calls, memory, Vault, Deck and git.";
  return (
    <div className="rounded-[14px] bg-white/[0.04] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-white">Check with Scout</p>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-white/55">{status}</p>
        </div>
        <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
        {settings && (
          <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-white/60"
            title={`Nightly at 10 PM Scout closes to-dos it's at least ${Math.round(settings.threshold * 100)}% sure about, with 2 kinds of proof. You can put any back.`}>
            Close when sure
            <Switch checked={settings.auto_close} onCheckedChange={tc.setAuto} aria-label="Close to-dos Scout is sure about"
              className="data-[state=checked]:bg-[#30D158] bento:data-[state=checked]:bg-[#34C759]" />
          </label>
        )}
        <button onClick={tc.checkAll} disabled={active || starting}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[0.875rem] font-semibold hover:brightness-110", BLUE_FILL, tap)}>
          {starting || active ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
          {active ? `${pct}%` : "Check all"}
        </button>
        </div>
      </div>
      {active && (
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-[#0A84FF] transition-[width] duration-500 bento:bg-[#007AFF]" style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
      )}
    </div>
  );
}

/* ───────── per to-do ───────── */

export function CheckButton({ busy, onClick }: { busy: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[0.8125rem] font-medium hover:bg-[#0A84FF]/10", BLUE_TEXT, tap)}
      aria-label="Check if it's done" title="Scout looks for proof in your email, calls, memory, Vault, Deck and git">
      {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
      {busy ? "Checking" : "Check"}
    </button>
  );
}

function ProofList({ items }: { items: any[] }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-2 space-y-2 border-t border-white/[0.07] pt-2">
      {items.map((e) => (
        <li key={e.id} className="text-[0.75rem] leading-relaxed text-white/60">
          <span className="font-medium text-white/75">
            {e.url
              ? (/^https?:\/\//.test(e.url) ? <a href={e.url} target="_blank" rel="noreferrer" className={cn("hover:underline", BLUE_TEXT)}>{e.title}</a> : <Link to={e.url} className={cn("hover:underline", BLUE_TEXT)}>{e.title}</Link>)
              : e.title}
          </span>
          <span className="text-white/40"> · {e.src}{e.at ? `, ${time12(e.at)}` : ""}</span>
          {e.quote && <span className="block text-white/50">{String(e.quote).replace(/[«»]/g, "").slice(0, 220)}</span>}
        </li>
      ))}
    </ul>
  );
}
export function Evidence({ items }: { items: any[] }) {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  return (
    <div>
      <button className={cn("text-[0.75rem] font-medium hover:underline", BLUE_TEXT)} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide proof" : "Show proof"}
      </button>
      {open && <ProofList items={items} />}
    </div>
  );
}

/** One quiet status line under a to-do; tap it for the summary, proof and thumbs. */
export function CheckResult({ r, tc, onDone }: { r: CheckRow; tc: TodoCheck; onDone: () => void }) {
  const c = r.action?.check ?? {};
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const v = VERDICT[(c.verdict as keyof typeof VERDICT) ?? "unknown"] ?? VERDICT.unknown;
  const rated = c.feedback === "up" || c.feedback === "down" || c.feedback === "undo";
  const pct = typeof c.confidence === "number" && c.verdict !== "unknown" ? Math.round(c.confidence * 100) : null;
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="-mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[0.8125rem] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/60">
          <span className={cn("h-[7px] w-[7px] rounded-full", v.dot)} aria-hidden />
          <span className={cn("font-medium", v.text)}>{v.label}</span>
          {pct !== null && <span className="text-white/40">{pct}%</span>}
          <ChevronDown className={cn("h-3.5 w-3.5 text-white/35 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {c.verdict === "done" && r.status === "open" && (
          <button onClick={() => { onDone(); tc.feedback(r, "up"); }}
            className={cn("text-[0.8125rem] font-semibold text-[#30D158] hover:underline bento:text-[#248A3D]", tap)}>Mark done</button>
        )}
      </div>
      {open && (
        <div className="mt-1.5 rounded-[12px] bg-white/[0.04] px-3 py-2.5">
          {c.summary && <p className="text-[0.8125rem] leading-relaxed text-white/80">{c.summary}</p>}
          {c.remaining && c.verdict !== "done" && <p className="mt-1 text-[0.75rem] text-white/55">Still to do: {c.remaining}</p>}
          <ProofList items={c.evidence ?? []} />
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-2 text-[0.75rem] text-white/45">
            {c.at && <span>Checked {time12(c.at)}</span>}
            <span className="flex-1" />
            {asking ? (
              <form className="flex w-full items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); tc.feedback(r, "down", note); setAsking(false); }}>
                <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's actually true? (optional)"
                  className="h-8 min-w-0 flex-1 rounded-full bg-white/[0.06] px-3 text-[0.8125rem] text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-[#0A84FF]/50" />
                <button type="submit" className={cn("h-8 rounded-full px-3 text-[0.8125rem] font-semibold", BLUE_FILL, tap)}>Send</button>
                <button type="button" aria-label="Cancel" onClick={() => setAsking(false)} className={cn("grid h-8 w-8 place-items-center rounded-full text-white/50 hover:bg-white/[0.06]", tap)}><X className="h-4 w-4" /></button>
              </form>
            ) : rated ? (
              <span>{c.feedback === "up" ? "You said this was right" : "Scout is learning from your correction"}</span>
            ) : (
              <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                Is this right?
                <button aria-label="Right" onClick={() => tc.feedback(r, "up")} className={cn("ml-1 grid h-7 w-7 place-items-center rounded-full text-white/55 hover:bg-white/[0.07]", tap)}><ThumbsUp className="h-3.5 w-3.5" /></button>
                <button aria-label="Wrong: tell Scout" onClick={() => setAsking(true)} className={cn("grid h-7 w-7 place-items-center rounded-full text-white/55 hover:bg-white/[0.07]", tap)}><ThumbsDown className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </div>
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
      <p className="mb-1 px-1 text-[0.75rem] font-medium text-white/45">Closed by Scout</p>
      <ul className="divide-y divide-white/[0.06] rounded-[14px] bg-white/[0.04]">
        {rows.map((c) => (
          <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#30D158] bento:text-[#34C759]" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[0.875rem] text-white/60 line-through decoration-white/25">{c.title}</p>
              {c.action?.check?.summary && <p className="mt-0.5 text-[0.75rem] text-white/45">{c.action.check.summary}</p>}
              <Evidence items={c.action?.check?.evidence ?? []} />
            </div>
            <button className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[0.8125rem] font-medium hover:bg-[#0A84FF]/10", BLUE_TEXT, tap)}
              onClick={() => tc.feedback(c, "undo")} title="Not done: reopen it and teach Scout">
              <Undo2 className="h-3.5 w-3.5" /> Put back
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
