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
import { Binoculars, Check, ChevronDown, Clock3, Copy, ExternalLink, Mail, MoreHorizontal, RefreshCw, Sparkles, X } from "lucide-react";
import {
  Disclosure, IconButton, Pill, SectionHeader, btnPlain, btnPrimary, cardCls, divider, focusRing, hairline, inset, rowCls, text, tint,
} from "@/components/admin/ui";
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
  done_at: string | null;
  created_at: string;
}

const SLOT = {
  decision: { label: "Decide" },
  quick: { label: "Quick win" },
  focus: { label: "Focus" },
} as const;

const laDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
/** Short lists: show this many, fold the rest behind "Show all". */
const FOLD = 5;
const btn = cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-[15px] font-medium transition active:scale-[0.97] disabled:opacity-50 sm:min-h-9", focusRing);
const ghost = cn(btn, "text-white/75 hover:bg-white/[0.06] hover:text-white");
const solid = cn(btnPrimary, "px-4");

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
  const [allCalls, setAllCalls] = useState(false);
  const [allDrafts, setAllDrafts] = useState(false);
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

  const set = async (r: Row, status: Status, msg?: string, quiet = false) => {
    setBusy(r.id);
    // done_at moves with the status, exactly as scout_daily_set() does it, so the
    // Done list below sorts right away instead of waiting for the next poll.
    const at = status === "open" ? null : new Date().toISOString();
    setRows((all) => all?.map((x) => (x.id === r.id ? { ...x, status, done_at: at } : x)) ?? null); // instant
    const { error } = await supabase.rpc("scout_daily_set" as never, { p_id: r.id, p_status: status } as never);
    setBusy(null);
    if (error) { toast.error(error.message); load(); return; }
    // Every status change is one tap, so every status change is undoable. Without
    // this a mis-tap on a to-do dropped it out of the list with no way back.
    if (!quiet && (msg || status !== "open")) {
      toast(msg ?? "Done", {
        description: r.title,
        action: { label: "Undo", onClick: () => set(r, r.status, undefined, true) },
      });
    }
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

  const { picks, drafts, calls, callsDone, wrap } = useMemo(() => {
    const r = rows ?? [];
    const order = { decision: 0, quick: 1, focus: 2 } as Record<string, number>;
    return {
      picks: r.filter((x) => x.kind === "pick" && x.day === today).sort((a, b) => order[a.slot ?? "focus"] - order[b.slot ?? "focus"]),
      drafts: r.filter((x) => x.kind === "draft" && x.status === "open"),
      calls: r.filter((x) => x.kind === "call" && x.status === "open"),
      callsDone: r.filter((x) => x.kind === "call" && x.status === "done")
        .sort((a, b) => String(b.done_at ?? "").localeCompare(String(a.done_at ?? ""))),
      wrap: r.find((x) => x.kind === "wrap" && x.day === today),
    };
  }, [rows, today]);

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

  // Yours first, then everyone else's, so the top of a folded list is always what's on you.
  const callsSorted = useMemo(() => [...calls].sort((a, b) =>
    Number(String(b.action?.owner ?? "Jared").toLowerCase() === "jared") - Number(String(a.action?.owner ?? "Jared").toLowerCase() === "jared")), [calls]);
  const shownCalls = allCalls ? callsSorted : callsSorted.slice(0, FOLD);
  const shownDrafts = allDrafts ? drafts : drafts.slice(0, 3);

  return (
    <div className="space-y-8">
      {/* Today's 3 */}
      <section aria-labelledby="today3-title">
        <SectionHeader
          id="today3-title"
          title="Scout's picks"
          icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
          aside={
            <>
              {picks.length > 0 && <span>{doneCount} of {picks.length} done</span>}
              <RunMenu running={running} onRun={run} />
            </>
          }
        />

        {rows === null ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className={cn(cardCls, "h-36 animate-pulse")} />)}
          </div>
        ) : picks.length === 0 ? (
          <div className={cn(cardCls, "flex flex-wrap items-center justify-between gap-3 py-3", inset)}>
            <p className={text.title}>Scout picks your three at 9:00 AM.</p>
            <button className={solid} onClick={() => run("morning")} disabled={!!running}>
              {running === "morning" ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />} Pick now
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
                  className={cn(cardCls, "scout-card-in flex flex-col gap-3 p-4 transition-opacity sm:p-5", (done || gone) && "opacity-60")}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Pill>{s.label}</Pill>
                    {done && <Pill tone="green"><Check className="h-3 w-3" aria-hidden /> Done</Pill>}
                    {p.status === "snoozed" && <Pill>Tomorrow</Pill>}
                    {p.status === "handed" && <Pill tone="blue">With Scout</Pill>}
                  </div>
                  <div className="min-w-0 flex-1">
                    {p.url && p.status === "open" ? (
                      <Go url={p.url} className={cn("group inline-flex items-start gap-1 rounded-md text-[17px] font-semibold leading-snug text-white hover:underline underline-offset-2", focusRing)}>
                        {p.title}
                        <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-white/45" aria-label="Open" />
                      </Go>
                    ) : (
                      <p className={cn("text-[17px] font-semibold leading-snug text-white", done && "line-through decoration-white/40")}>{p.title}</p>
                    )}
                    {p.why && <p className={cn(text.detail, "mt-1 line-clamp-2")} title={p.why}>{p.why}</p>}
                  </div>
                  {p.status === "open" ? (
                    <div className="-mx-1 flex flex-wrap items-center gap-1">
                      <button className={solid} disabled={busy === p.id} onClick={() => set(p, "done")}>
                        <Check className="h-4 w-4" aria-hidden /> Done
                      </button>
                      {/* Labelled, not a mystery icon: this is the button that means
                          "you do it", and it should read that way at a glance. */}
                      <button className={ghost} title="Scout takes this on"
                        onClick={() => { set(p, "handed"); askScout(`Take this off my plate: ${p.title}`, { about: `${p.title}\n${p.why ?? ""}\n${p.url ?? ""}` }); }}>
                        <Binoculars className="h-4 w-4" aria-hidden /> Scout does it
                      </button>
                      <IconButton label="Move to tomorrow" className="ml-auto" onClick={() => set(p, "snoozed", "Moved to tomorrow")}>
                        <Clock3 className="h-4 w-4" aria-hidden />
                      </IconButton>
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
          <p className={cn(text.detail, "mt-2 flex items-center gap-2", inset)}>
            <Check className={cn("h-4 w-4 shrink-0", tint.green)} aria-hidden />
            Scout fixed {healed} thing{healed === 1 ? "" : "s"} on its own today.
          </p>
        )}
      </section>

      {/* Replies ready */}
      {drafts.length > 0 && (
        <section id="drafts" aria-labelledby="drafts-title">
          <SectionHeader id="drafts-title" title="Replies ready" aside={drafts.length} />
          <div className={cn(cardCls, "overflow-hidden")}>
            <ul id="drafts-list" className={divider}>
              {shownDrafts.map((d) => <DraftCard key={d.id} d={d} onSet={set} busy={busy === d.id} />)}
            </ul>
            {drafts.length > 3 && (
              <Disclosure open={allDrafts} onToggle={() => setAllDrafts((v) => !v)} controls="drafts-list">
                {allDrafts ? "Show fewer" : `Show all ${drafts.length}`}
              </Disclosure>
            )}
          </div>
        </section>
      )}

      {/* From calls */}
      {(calls.length > 0 || callsDone.length > 0) && (
        <section id="calls" aria-labelledby="calls-title" className="scroll-mt-24">
          <SectionHeader id="calls-title" title="From your calls" aside={calls.length} />
          {calls.length === 0 ? (
            <div className={cn(cardCls, rowCls)}>
              <Check className={cn("h-5 w-5 shrink-0", tint.green)} aria-hidden />
              <p className={text.title}>All done from your calls.</p>
            </div>
          ) : (
            <div className={cn(cardCls, "overflow-hidden")}>
              <ul id="calls-list" className={divider}>
                {shownCalls.map((c) => {
                  const owner = String(c.action?.owner ?? "Jared");
                  const mine = owner.toLowerCase() === "jared";
                  return (
                    <li key={c.id} className={cn(rowCls, "py-2 pl-2 sm:pl-4")}>
                      <CheckCircle label={`Mark done: ${c.title}`} onClick={() => set(c, "done", "Marked done")} />
                      <div className="min-w-0 flex-1">
                        <p className={text.title}>{c.title}</p>
                        <p className={cn(text.detail, "mt-0.5")}>
                          <OwnerMenu owner={owner} mine={mine} people={people} onPick={(o) => setOwner(c, o)} />
                          {c.action?.due ? ` · due ${c.action.due}` : ""}{c.action?.meeting ? ` · ${String(c.action.meeting)}` : ""}
                        </p>
                      </div>
                      {c.action?.deck_url && (
                        <a href={c.action.deck_url} target="_blank" rel="noreferrer" className={cn(btnPlain, "shrink-0 text-[13px] sm:min-h-9")} aria-label={`Open on Deck: ${c.title}`}>
                          Deck <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
              {calls.length > FOLD && (
                <Disclosure open={allCalls} onToggle={() => setAllCalls((v) => !v)} controls="calls-list">
                  {allCalls ? "Show fewer" : `Show all ${calls.length}`}
                </Disclosure>
              )}
            </div>
          )}
          {callsDone.length > 0 && <CallsDone rows={callsDone} onReopen={(r) => set(r, "open", "Back on your list")} />}
        </section>
      )}

      {/* Wrap */}
      {wrap?.body && (
        <section aria-labelledby="wrap-title">
          <SectionHeader id="wrap-title" title="Today's wrap" />
          <div className={cn(cardCls, "space-y-1 p-4 sm:p-6")}>
            {wrap.body.split("\n").map((l, i) => <p key={i} className={cn("text-[15px] text-white/80", i === 0 && "font-semibold text-white")}>{l}</p>)}
          </div>
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

/** Round tick: 44px hit area on touch, 22px circle drawn inside. */
function CheckCircle({ label, onClick, checked }: { label: string; onClick: () => void; checked?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("group grid h-11 w-11 shrink-0 place-items-center rounded-full sm:h-9 sm:w-9", focusRing)}
    >
      <span className={cn(
        "grid h-[22px] w-[22px] place-items-center rounded-full transition active:scale-90",
        checked
          ? "bg-[#30D158] text-[#fff] group-hover:bg-white/20 bento:bg-[#34C759]"
          : "border-2 border-white/30 text-transparent group-hover:border-[#30D158] group-hover:text-[#30D158]",
      )}>
        <Check className="h-3.5 w-3.5" aria-hidden />
      </span>
    </button>
  );
}

/**
 * Finished call to-dos. Collapsed, newest first: tap the green check to put one
 * back on the list. A to-do that can only ever go one way is a trap, not a list.
 */
function CallsDone({ rows, onReopen }: { rows: Row[]; onReopen: (r: Row) => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FOLD);
  return (
    <div className={cn("mt-2", inset)}>
      <Disclosure variant="inline" open={open} onToggle={() => setOpen((o) => !o)} controls="calls-done" className="text-white/60 bento:text-white/60">
        Done ({rows.length})
      </Disclosure>
      {open && (
        <div id="calls-done" className={cn(cardCls, "-mx-4 mt-1 overflow-hidden sm:-mx-6")}>
          <ul className={divider}>
            {shown.map((r) => (
              <li key={r.id} className={cn(rowCls, "py-2 pl-2 sm:pl-4")}>
                <CheckCircle checked label={`Put back on the list: ${r.title}`} onClick={() => onReopen(r)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] text-white/50 line-through decoration-white/30">{r.title}</p>
                  <p className="mt-0.5 text-[13px] text-white/45">
                    {String(r.action?.owner ?? "Jared")}
                    {r.done_at ? ` · done ${new Date(r.done_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {rows.length > FOLD && (
            <Disclosure open={all} onToggle={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </Disclosure>
          )}
        </div>
      )}
    </div>
  );
}

function OwnerMenu({ owner, mine, people, onPick }: { owner: string; mine: boolean; people: string[]; onPick: (o: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn("inline-flex items-center gap-0.5 rounded font-semibold underline-offset-2 hover:underline", focusRing, mine ? "text-white/80" : "text-white/60")}
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

function RunMenu({ running, onRun }: { running: string | null; onRun: (j: "morning" | "drafts" | "wrap") => void }) {
  // This was a hand-rolled absolute panel with a fixed-inset backdrop. Inside the
  // dashboard's grid it rendered as an empty black box - wrong stacking context in
  // dark mode, invisible white-on-white text in light. The shared menu is portalled
  // and themed, so it behaves the same everywhere.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Run Scout now" className="-mr-2">
          {running ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {([["morning", "Re-pick today's 3"], ["drafts", "Check mail for replies"], ["wrap", "Write today's wrap"]] as const).map(([j, label]) => (
          <DropdownMenuItem key={j} disabled={!!running} onSelect={() => onRun(j)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DraftCard({ d, onSet, busy }: { d: Row; onSet: (r: Row, s: Status, msg?: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [text_, setText] = useState(d.body ?? "");
  const a = d.action ?? {};
  const mailto = `mailto:${encodeURIComponent(a.to ?? "")}?subject=${encodeURIComponent(a.subject ?? "")}&body=${encodeURIComponent(text_)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text_); toast.success("Reply copied"); } catch { toast.error("Could not copy"); }
  };
  return (
    <li>
      <button className={cn(rowCls, "w-full text-left transition-colors hover:bg-white/[0.04] focus-visible:ring-inset", focusRing)} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Mail className="h-4 w-4 shrink-0 text-white/55" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cn(text.title, "truncate")}>{d.title}</p>
          {d.why && <p className={cn(text.detail, "mt-0.5 truncate")}>{d.why}</p>}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/40 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className={cn("space-y-3 border-t pb-4 pt-3", hairline, inset)}>
          <p className={text.detail}>To {a.to_name ? `${a.to_name} <${a.to}>` : a.to} · from {a.mailbox}</p>
          <textarea
            value={text_}
            onChange={(e) => setText(e.target.value)}
            aria-label={`Reply to ${a.to_name ?? a.to ?? "sender"}`}
            rows={Math.min(12, Math.max(4, text_.split("\n").length + 1))}
            className="w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-[15px] leading-relaxed text-white outline-none focus:border-white/25 focus-visible:ring-2 focus-visible:ring-[#0A84FF] bento:border-black/5 bento:bg-[var(--bento-well)]"
          />
          <div className="-mx-1 flex flex-wrap gap-1">
            <a href={mailto} className={solid}><Mail className="h-4 w-4" aria-hidden /> Open in Mail</a>
            <button className={ghost} onClick={copy}><Copy className="h-4 w-4" aria-hidden /> Copy</button>
            <button className={ghost} disabled={busy} onClick={() => onSet(d, "done", "Marked sent")}><Check className="h-4 w-4" aria-hidden /> Sent</button>
            <button className={ghost} disabled={busy} onClick={() => onSet(d, "dismissed")}><X className="h-4 w-4" aria-hidden /> Skip</button>
          </div>
        </div>
      )}
    </li>
  );
}
