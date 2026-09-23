/**
 * The command center's top: what Scout prepared for today (table scout_daily,
 * filled by the scout-daily function).
 *
 *   Today's 3     one decision, one quick win, one focus task (9am)
 *   Replies ready drafted answers to real people (6am); Open in Mail / Copy / Sent / Skip
 *   From calls    commitments pulled out of each call, already on the Deck board
 *   Wrap          6pm: done, rolled over, tomorrow's first move
 *   Quiet line    what Scout fixed by itself in the last 24h
 *
 * Every button is one tap and writes through scout_daily_set().
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Binoculars, Check, ChevronDown, Clock3, Copy, ExternalLink, Mail, MoreHorizontal, RefreshCw, SearchCheck, Sparkles, ThumbsDown, ThumbsUp, Undo2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askScout } from "@/components/admin/scoutBus";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

type Status = "open" | "done" | "snoozed" | "dismissed" | "handed";
interface Row {
  id: string;
  day: string;
  kind: "pick" | "draft" | "call" | "wrap";
  slot: "decision" | "quick" | "focus" | null;
  title: string;
  why: string | null;
  body: string | null;
  url: string | null;
  action: Record<string, any>;
  status: Status;
  created_at: string;
  done_at?: string | null;
}

const SLOT = {
  decision: { label: "Decide", tint: "bg-violet-500/15 text-violet-200 bento:bg-[var(--bento-lavender)] bento:text-[#111114]" },
  quick: { label: "Quick win", tint: "bg-lime-500/15 text-lime-200 bento:bg-[var(--bento-lime)] bento:text-[#111114]" },
  focus: { label: "Focus", tint: "bg-orange-500/15 text-orange-200 bento:bg-[var(--bento-peach)] bento:text-[#111114]" },
} as const;

const laDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const btn = "inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80";
const ghost = cn(btn, "text-white/70 hover:bg-white/[0.06] hover:text-white");
const solid = cn(btn, "bg-white text-black hover:bg-white/90 bento:bg-[#111114] bento:text-[#fff]");

function isExternal(url: string) {
  return /^https?:\/\//.test(url);
}
function Go({ url, children, className }: { url: string; children: React.ReactNode; className?: string }) {
  if (isExternal(url)) return <a href={url} target="_blank" rel="noreferrer" className={className}>{children}</a>;
  return <Link to={url} className={className}>{children}</Link>;
}

export function ScoutToday() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [healed, setHealed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const today = laDay();

  const load = useCallback(async () => {
    const since = new Date(Date.parse(today + "T12:00:00Z") - 7 * 864e5).toISOString().slice(0, 10);
    const [{ data }, { count }] = await Promise.all([
      supabase.from("scout_daily" as never).select("*").gte("day", since).order("created_at", { ascending: true }).limit(200),
      supabase.from("monitor_issues" as never).select("key", { count: "exact", head: true })
        .eq("self_healed", true).gte("resolved_at", new Date(Date.now() - 864e5).toISOString()),
    ]);
    setRows(((data ?? []) as unknown) as Row[]);
    setHealed(count ?? 0);
  }, [today]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const set = async (r: Row, status: Status, msg?: string) => {
    setBusy(r.id);
    setRows((all) => all?.map((x) => (x.id === r.id ? { ...x, status } : x)) ?? null); // instant
    const { error } = await supabase.rpc("scout_daily_set" as never, { p_id: r.id, p_status: status } as never);
    setBusy(null);
    if (error) { toast.error(error.message); load(); return; }
    if (msg) toast.success(msg);
    if (status === "snoozed") load();
  };

  const run = async (job: "morning" | "drafts" | "wrap") => {
    setRunning(job);
    const { data, error } = await supabase.functions.invoke("scout-daily", { body: { op: "run", job, force: true } });
    setRunning(null);
    if (error || (data as any)?.[job]?.error) toast.error(error?.message ?? (data as any)[job].error);
    else toast.success(job === "morning" ? "Today's picks refreshed" : job === "drafts" ? "Checked your mail for replies" : "Wrap written");
    load();
  };

  const { picks, drafts, calls, wrap } = useMemo(() => {
    const r = rows ?? [];
    const order = { decision: 0, quick: 1, focus: 2 } as Record<string, number>;
    return {
      picks: r.filter((x) => x.kind === "pick" && x.day === today).sort((a, b) => order[a.slot ?? "focus"] - order[b.slot ?? "focus"]),
      drafts: r.filter((x) => x.kind === "draft" && x.status === "open"),
      calls: r.filter((x) => x.kind === "call" && x.status === "open"),
      wrap: r.find((x) => x.kind === "wrap" && x.day === today),
    };
  }, [rows, today]);

  // "Check if it's done" (todo-check function). Results live on action.check, so they survive a reload.
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [sweeping, setSweeping] = useState(false);
  const [auto, setAuto] = useState<{ auto_close: boolean; threshold: number; note: string | null } | null>(null);
  useEffect(() => {
    supabase.from("todo_check_settings" as never).select("auto_close, threshold, note").eq("id", 1).maybeSingle()
      .then(({ data }) => setAuto((data as any) ?? null));
  }, []);

  const checkTodo = async (r: Row) => {
    setChecking((s) => new Set(s).add(r.id));
    const { data, error } = await supabase.functions.invoke("todo-check", { body: { op: "check", id: r.id, force: true } });
    setChecking((s) => { const n = new Set(s); n.delete(r.id); return n; });
    const d = data as any;
    if (error || !d?.ok) { toast.error(d?.error ?? error?.message ?? "Check failed"); return; }
    setRows((all) => all?.map((x) => (x.id === r.id ? { ...x, action: { ...x.action, check: d } } : x)) ?? null);
  };

  const sweep = async () => {
    setSweeping(true);
    toast.message("Checking every open to-do. This takes about a minute.");
    const { data, error } = await supabase.functions.invoke("todo-check", { body: { op: "sweep" } });
    setSweeping(false);
    const d = data as any;
    if (error || !d?.ok) { toast.error(d?.error ?? error?.message ?? "Check failed"); return; }
    toast.success(`Checked ${d.checked}: ${d.done} look done${d.closed ? `, ${d.closed} closed` : ""}`);
    load();
  };

  const feedback = async (r: Row, kind: "up" | "down" | "undo", note?: string) => {
    const checkId = r.action?.check?.id ?? r.action?.auto_closed?.check_id;
    if (!checkId) return;
    setRows((all) => all?.map((x) => (x.id === r.id
      ? { ...x, status: kind === "up" ? x.status : (x.action?.auto_closed || kind === "undo") && x.status === "done" ? "open" : x.status,
          action: { ...x.action, check: { ...(x.action?.check ?? {}), feedback: kind } } }
      : x)) ?? null);
    const { data, error } = await supabase.rpc("todo_check_feedback" as never, { p_check: checkId, p_kind: kind, p_note: note ?? null } as never);
    if (error) { toast.error(error.message); load(); return; }
    toast.success(kind === "up" ? "Thanks. Scout will trust checks like this more."
      : (data as any)?.reopened ? "Put back. Scout is learning from this." : "Got it. Scout is learning from this.");
    load();
    supabase.from("todo_check_settings" as never).select("auto_close, threshold, note").eq("id", 1).maybeSingle().then(({ data }) => setAuto((data as any) ?? null));
  };

  const setAutoClose = async (on: boolean) => {
    const { data, error } = await supabase.rpc("todo_check_set_auto" as never, { p_on: on } as never);
    if (error) { toast.error(error.message); return; }
    setAuto(data as any);
    toast.success(on ? "Scout will close to-dos it finds proof for (10 PM nightly)" : "Scout will only check when you tap");
  };

  const closedByScout = useMemo(
    () => (rows ?? []).filter((x) => x.status === "done" && x.action?.auto_closed && x.done_at && Date.now() - Date.parse(x.done_at) < 3 * 864e5),
    [rows],
  );

  const doneCount = picks.filter((p) => p.status === "done").length;
  // Everyone who has owned a call to-do lately, so a wrong owner is one tap to fix.
  const people = useMemo(() => {
    const names = new Set<string>(["Jared"]);
    for (const r of rows ?? []) if (r.kind === "call" && r.action?.owner) names.add(String(r.action.owner));
    return [...names];
  }, [rows]);

  const setOwner = async (r: Row, owner: string) => {
    setRows((all) => all?.map((x) => (x.id === r.id ? { ...x, action: { ...x.action, owner } } : x)) ?? null);
    const { error } = await supabase.rpc("todo_set_owner" as never, { p_id: r.id, p_owner: owner } as never);
    if (error) { toast.error(error.message); load(); return; }
    toast.success(owner.toLowerCase() === "jared" ? "Moved to your list" : `Moved to ${owner}`);
  };

  return (
    <div className="space-y-8">
      {/* Today's 3 */}
      <section aria-labelledby="today3-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="today3-title" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/55">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Scout's picks for today
          </h2>
          <div className="flex items-center gap-1">
            {picks.length > 0 && <span className="text-sm tabular-nums text-white/60">{doneCount} of {picks.length} done</span>}
            <RunMenu running={running} onRun={run} sweeping={sweeping} onSweep={sweep} auto={auto} onAuto={setAutoClose} />
          </div>
        </div>

        {rows === null ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className={cn(card, "h-36 animate-pulse")} />)}
          </div>
        ) : picks.length === 0 ? (
          <div className={cn(card, "flex flex-wrap items-center justify-between gap-3 px-5 py-4")}>
            <p className="text-[0.9375rem] text-white/75">Scout picks your three at 9am.</p>
            <button className={solid} onClick={() => run("morning")} disabled={!!running}>
              {running === "morning" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Pick now
            </button>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {picks.map((p, i) => {
              const s = SLOT[p.slot ?? "focus"];
              const done = p.status === "done";
              const gone = p.status !== "open" && !done;
              return (
                <li
                  key={p.id}
                  className={cn(card, "scout-card-in flex flex-col gap-3 p-4 transition-opacity", (done || gone) && "opacity-55")}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", s.tint)}>{s.label}</span>
                    {done && <span className="flex items-center gap-1 text-xs font-medium text-emerald-300 bento:text-emerald-700"><Check className="h-3.5 w-3.5" /> Done</span>}
                    {p.status === "snoozed" && <span className="text-xs text-white/50">Tomorrow</span>}
                    {p.status === "handed" && <span className="text-xs text-white/50">With Scout</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[0.975rem] font-semibold leading-snug text-white", done && "line-through decoration-white/40")}>{p.title}</p>
                    {p.why && <p className="mt-1.5 text-sm leading-relaxed text-white/60">{p.why}</p>}
                    {p.action?.check && p.status === "open" && <CheckResult r={p} onDone={() => { set(p, "done", "Done"); feedback(p, "up"); }} onFeedback={feedback} />}
                  </div>
                  {p.status === "open" ? (
                    <div className="-mx-1 flex flex-wrap items-center gap-1">
                      <button className={solid} disabled={busy === p.id} onClick={() => set(p, "done")}>
                        <Check className="h-4 w-4" /> Done
                      </button>
                      {p.url && <Go url={p.url} className={ghost}>Open <ExternalLink className="h-3.5 w-3.5" /></Go>}
                      {/* Labelled, not a mystery icon: this is the button that means
                          "you do it", and it should read that way at a glance. */}
                      <button className={ghost} title="Scout takes this on"
                        onClick={() => { set(p, "handed"); askScout(`Take this off my plate: ${p.title}`, { about: `${p.title}\n${p.why ?? ""}\n${p.url ?? ""}` }); }}>
                        <Binoculars className="h-4 w-4" /> Scout does it
                      </button>
                      <button className={ghost} aria-label="Tomorrow" title="Move to tomorrow" onClick={() => set(p, "snoozed", "Moved to tomorrow")}>
                        <Clock3 className="h-4 w-4" />
                      </button>
                      <CheckButton busy={checking.has(p.id)} onClick={() => checkTodo(p)} />
                    </div>
                  ) : p.action?.auto_closed && done ? (
                    <div className="-mx-1 flex flex-wrap items-center gap-1">
                      <span className="px-1 text-xs text-white/50">Closed by Scout</span>
                      <button className={ghost} onClick={() => feedback(p, "undo")}><Undo2 className="h-4 w-4" /> Put back</button>
                    </div>
                  ) : (
                    <button className={cn(ghost, "self-start")} onClick={() => set(p, "open")}>Undo</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {healed > 0 && (
          <p className="mt-3 flex items-center gap-2 text-sm text-white/55">
            <Check className="h-4 w-4 text-emerald-300 bento:text-emerald-700" aria-hidden />
            Scout fixed {healed} thing{healed === 1 ? "" : "s"} on its own in the last day. Nothing needed you.
          </p>
        )}
      </section>

      {/* Replies ready */}
      {drafts.length > 0 && (
        <section id="drafts" aria-labelledby="drafts-title">
          <h2 id="drafts-title" className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/55">
            Replies ready · {drafts.length}
          </h2>
          <ul className="space-y-2">
            {drafts.map((d) => <DraftCard key={d.id} d={d} onSet={set} busy={busy === d.id} />)}
          </ul>
        </section>
      )}

      {/* From calls */}
      {calls.length > 0 && (
        <section aria-labelledby="calls-title">
          <h2 id="calls-title" className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/55">From your calls · {calls.length}</h2>
          {/* A to-do is one short line; on a wide screen a single column of them is a
              long thin ribbon. Let them flow into as many columns as fit. */}
          <ul className={cn(card, "grid grid-cols-[repeat(auto-fit,minmax(min(24rem,100%),1fr))] overflow-hidden")}>
            {calls.map((c) => {
              const owner = String(c.action?.owner ?? "Jared");
              const mine = owner.toLowerCase() === "jared";
              return (
                <li key={c.id} className="flex items-start gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0 sm:px-5">
                  <button
                    aria-label="Mark done"
                    onClick={() => set(c, "done", "Done")}
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/25 text-transparent transition hover:border-emerald-400 hover:text-emerald-400 active:scale-90"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9375rem] text-white">{c.title}</p>
                    <p className="mt-0.5 text-xs text-white/50">
                      <OwnerMenu owner={owner} mine={mine} people={people} onPick={(o) => setOwner(c, o)} />
                      {c.action?.due ? ` · due ${c.action.due}` : ""} · {String(c.action?.meeting ?? "")}
                    </p>
                    {c.action?.check && <CheckResult r={c} onDone={() => { set(c, "done", "Done"); feedback(c, "up"); }} onFeedback={feedback} />}
                  </div>
                  <CheckButton busy={checking.has(c.id)} onClick={() => checkTodo(c)} compact />
                  {c.action?.deck_url && (
                    <a href={c.action.deck_url} target="_blank" rel="noreferrer" className={ghost} aria-label="Open on Deck">Deck <ExternalLink className="h-3.5 w-3.5" /></a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Closed by Scout: the nightly pass found proof. One tap puts it back, and Scout learns from it. */}
      {closedByScout.length > 0 && (
        <section aria-labelledby="closed-title">
          <h2 id="closed-title" className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/55">Closed by Scout · {closedByScout.length}</h2>
          <ul className={cn(card, "overflow-hidden")}>
            {closedByScout.map((c) => (
              <li key={c.id} className="flex items-start gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0 sm:px-5">
                <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-300 bento:text-emerald-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9375rem] text-white/80 line-through decoration-white/30">{c.title}</p>
                  {c.action?.check?.summary && <p className="mt-0.5 text-sm text-white/55">{c.action.check.summary}</p>}
                  <Evidence items={c.action?.check?.evidence ?? []} />
                </div>
                <button className={ghost} onClick={() => feedback(c, "undo")} title="Not done: reopen it and teach Scout">
                  <Undo2 className="h-4 w-4" /> Put back
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Wrap */}
      {wrap?.body && (
        <section aria-labelledby="wrap-title" className={cn(card, "px-5 py-4")}>
          <h2 id="wrap-title" className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/55">Today's wrap</h2>
          {wrap.body.split("\n").map((l, i) => <p key={i} className={cn("text-[0.9375rem] text-white/80", i === 0 && "font-semibold text-white")}>{l}</p>)}
        </section>
      )}

      <style>{`
        .scout-card-in { animation: scout-card-in .42s cubic-bezier(.2,.8,.2,1) both; }
        @keyframes scout-card-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .scout-card-in { animation: none; } }
      `}</style>
    </div>
  );
}

function OwnerMenu({ owner, mine, people, onPick }: { owner: string; mine: boolean; people: string[]; onPick: (o: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn("inline-flex items-center gap-0.5 rounded font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80", mine ? "text-white/80" : "text-white/60")}
          aria-label={`Owner: ${mine ? "you" : owner}. Change owner`}
        >
          {mine ? "You" : owner} <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {people.filter((p) => p.toLowerCase() !== owner.toLowerCase()).map((p) => (
          <DropdownMenuItem key={p} onSelect={() => onPick(p)}>
            {p.toLowerCase() === "jared" ? "Mine" : `Give to ${p}`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RunMenu({ running, onRun, sweeping, onSweep, auto, onAuto }: {
  running: string | null; onRun: (j: "morning" | "drafts" | "wrap") => void;
  sweeping: boolean; onSweep: () => void;
  auto: { auto_close: boolean; threshold: number; note: string | null } | null; onAuto: (on: boolean) => void;
}) {
  // This was a hand-rolled absolute panel with a fixed-inset backdrop. Inside the
  // dashboard's grid it rendered as an empty black box - wrong stacking context in
  // dark mode, invisible white-on-white text in light. The shared menu is portalled
  // and themed, so it behaves the same everywhere.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(ghost, "px-2.5")} aria-label="Run Scout now">
          {running || sweeping ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {([["morning", "Re-pick today's 3"], ["drafts", "Check mail for replies"], ["wrap", "Write today's wrap"]] as const).map(([j, label]) => (
          <DropdownMenuItem key={j} disabled={!!running} onSelect={() => onRun(j)}>
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem disabled={sweeping} onSelect={onSweep}>Check which to-dos are done</DropdownMenuItem>
        {auto && (
          <DropdownMenuItem onSelect={() => onAuto(!auto.auto_close)}>
            <span className="flex flex-col">
              <span>{auto.auto_close ? "Stop Scout closing to-dos" : "Let Scout close to-dos it proves"}</span>
              <span className="text-xs opacity-60">
                {auto.auto_close ? `On: closes at ${Math.round(auto.threshold * 100)}% sure, 10 PM nightly` : auto.note ?? "Off: checks only when you tap"}
              </span>
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CheckButton({ busy, onClick, compact }: { busy: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button className={cn(ghost, compact && "shrink-0 px-2.5")} onClick={onClick} disabled={busy}
      aria-label="Check if it's done" title="Check if it's done: Scout looks in your email, memory, Vault, Deck, git and calls">
      {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
      {!compact && (busy ? "Checking…" : "Check if done")}
    </button>
  );
}

const VERDICT = {
  done: { label: "Looks done", tint: "bg-emerald-500/15 text-emerald-200 bento:bg-emerald-100 bento:text-emerald-800" },
  partly: { label: "Partly done", tint: "bg-amber-500/15 text-amber-200 bento:bg-amber-100 bento:text-amber-800" },
  not_done: { label: "Not yet", tint: "bg-white/10 text-white/70" },
  unknown: { label: "Can't tell", tint: "bg-white/10 text-white/70" },
} as const;

const time12 = (iso?: string) => iso
  ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  : "";

function Evidence({ items }: { items: any[] }) {
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
                ? (isExternal(e.url) ? <a href={e.url} target="_blank" rel="noreferrer" className="underline">{e.title}</a> : <Link to={e.url} className="underline">{e.title}</Link>)
                : e.title}
              {e.quote && <span className="block text-white/45">{String(e.quote).replace(/[«»]/g, "").slice(0, 220)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CheckResult({ r, onDone, onFeedback }: { r: Row; onDone: () => void; onFeedback: (r: Row, k: "up" | "down" | "undo", note?: string) => void }) {
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
        <form className="mt-2 flex flex-wrap items-center gap-1" onSubmit={(e) => { e.preventDefault(); onFeedback(r, "down", note); setAsking(false); }}>
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's actually true? (optional)"
            className="min-h-[36px] min-w-0 flex-1 rounded-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-white/25 bento:bg-white bento:border-black/10" />
          <button type="submit" className={ghost}>Send</button>
          <button type="button" className={cn(ghost, "px-2.5")} aria-label="Cancel" onClick={() => setAsking(false)}><X className="h-4 w-4" /></button>
        </form>
      ) : (
        <div className="-mx-1 mt-1.5 flex flex-wrap items-center gap-1">
          {c.verdict === "done" && r.status === "open" && (
            <button className={cn(ghost, "min-h-[34px]")} onClick={onDone}><Check className="h-4 w-4" /> Mark done</button>
          )}
          {rated ? (
            <span className="px-2 text-xs text-white/45">{c.feedback === "up" ? "You said this was right" : "Scout is learning from your correction"}</span>
          ) : (
            <>
              <button className={cn(ghost, "min-h-[34px] px-2.5")} aria-label="Right" title="Right" onClick={() => onFeedback(r, "up")}><ThumbsUp className="h-4 w-4" /></button>
              <button className={cn(ghost, "min-h-[34px] px-2.5")} aria-label="Wrong: tell Scout" title="Wrong: tell Scout what's actually true" onClick={() => setAsking(true)}><ThumbsDown className="h-4 w-4" /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DraftCard({ d, onSet, busy }: { d: Row; onSet: (r: Row, s: Status, msg?: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(d.body ?? "");
  const a = d.action ?? {};
  const mailto = `mailto:${encodeURIComponent(a.to ?? "")}?subject=${encodeURIComponent(a.subject ?? "")}&body=${encodeURIComponent(text)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success("Reply copied"); } catch { toast.error("Could not copy"); }
  };
  return (
    <li className={cn(card, "overflow-hidden")}>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Mail className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-medium text-white">{d.title}</p>
          {d.why && <p className="mt-0.5 truncate text-sm text-white/55">{d.why}</p>}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/40 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t border-white/[0.06] px-4 pb-4 pt-3 sm:px-5">
          <p className="text-xs text-white/50">To {a.to_name ? `${a.to_name} <${a.to}>` : a.to} · from {a.mailbox}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(12, Math.max(4, text.split("\n").length + 1))}
            className="w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-[0.9375rem] leading-relaxed text-white outline-none focus:border-white/25 bento:bg-[var(--bento-well)] bento:border-black/5"
          />
          <div className="-mx-1 flex flex-wrap gap-1">
            <a href={mailto} className={solid}><Mail className="h-4 w-4" /> Open in Mail</a>
            <button className={ghost} onClick={copy}><Copy className="h-4 w-4" /> Copy</button>
            <button className={ghost} disabled={busy} onClick={() => onSet(d, "done", "Marked sent")}><Check className="h-4 w-4" /> Sent</button>
            <button className={ghost} disabled={busy} onClick={() => onSet(d, "dismissed")}><X className="h-4 w-4" /> Skip</button>
          </div>
        </div>
      )}
    </li>
  );
}
