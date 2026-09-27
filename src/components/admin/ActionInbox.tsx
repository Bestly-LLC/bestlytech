import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  AlertCircle,
  Activity,
  Bell,
  Clapperboard,
  Cookie,
  Mail,
  MessageSquare,
  Package,
  Home,
  ShieldCheck,
  RefreshCw,
  Check,
  CheckCircle2,
  X,
  ExternalLink,
  MoreHorizontal,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Disclosure, IconButton, LoadError, Pill, SectionHeader, SkeletonRows,
  cardCls, divider, hairline, inset, rowCls, text, tint,
} from "@/components/admin/ui";
import { AskScoutButton } from "./AskScoutButton";
import { toast } from "sonner";

/**
 * Everything waiting on the operator, from one server-side rule set.
 *
 * This used to fan out six queries from the browser and only knew about contacts,
 * hire requests, intakes, missed banners and failed emails - so Cookie Yeti releases,
 * Studio previews, client asks, a stalled mail runner and low stock never showed up
 * here at all. public.admin_today() now owns the rules: it returns only rows a human
 * has to act on, collapses backlogs into a single card, and ranks them. Adding a
 * source is a change to that function, not to this component.
 */

type Severity = "critical" | "urgent" | "stale" | "info";

interface TodayRow {
  key: string;
  source: string;
  severity: string;
  title: string;
  detail: string | null;
  action_label: string | null;
  url: string | null;
  since: string | null;
  item_count: number | null;
  rank: number;
  origin_table: string | null;
  origin_id: string | null;
  why: string | null;
  fingerprint: string | null;
}

interface ActionItem {
  id: string;
  severity: Severity;
  icon: typeof AlertTriangle;
  title: string;
  detail?: string;
  ageMs: number;
  href?: string;
  external?: boolean;
  count?: number;
  /** Cards that resolve with a tap rather than a visit. */
  done?: boolean;
  doneLabel?: string;
  /** Where this came from, for the ⓘ: the table, the record, and the condition that raised it. */
  originTable?: string;
  originId?: string;
  why?: string;
  since?: string;
  /** Scout's latest "is this already done?" read from a Refresh (admin_needs_checks). */
  check?: NeedCheck;
}

interface NeedCheck { verdict: string; summary: string | null; at: string | null; closed: boolean }

const VERDICT_WORD: Record<string, string> = { done: "Looks done", partly: "Partly done", not_done: "Not yet", unknown: "Can't tell" };
const clock12 = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true })
  : "";

const severityRank: Record<Severity, number> = { critical: 0, urgent: 1, stale: 2, info: 3 };

const severityWord: Record<Severity, string> = {
  critical: "Critical",
  urgent: "Urgent",
  stale: "Waiting",
  info: "FYI",
};

/** Only the two loud severities get a visible pill; the rest stay quiet (word is still read out). */
const severityPill: Partial<Record<Severity, "red" | "orange">> = { critical: "red", urgent: "orange" };

/** admin_today() severities -> the four this panel shows. */
const severityFromRow: Record<string, Severity> = {
  blocked: "critical",
  critical: "critical",
  error: "critical",
  warning: "urgent",
  todo: "stale",
  info: "info",
};

const sourceIcon: Record<string, typeof AlertTriangle> = {
  "Cookie Yeti": Cookie,
  Uptime: Activity,
  "Home Hub": Home,
  Studio: Clapperboard,
  "Client asks": MessageSquare,
  Mail: Mail,
  Shop: Package,
  Claims: ShieldCheck,
  Alerts: Bell,
};

const COLLAPSED_COUNT = 5;

function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** Small centered popup that shows when a Needs You row is clicked. */
function ItemPopup({ item, onClose, onDone, working }: {
  item: ActionItem;
  onClose: () => void;
  onDone: (id: string, title: string) => void;
  working: string | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const Icon = item.icon;
  const pill = severityPill[item.severity];

  const when = item.since
    ? new Date(item.since).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Trap focus inside the popup
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>('button,a,[tabindex]:not([tabindex="-1"])');
    focusable[0]?.focus();
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        aria-hidden
        onClick={onClose}
      />
      {/* Popup */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[0.10] bg-[#1c1c1e] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-white/[0.06] px-5 py-4">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-white/55" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {pill && <Pill tone={pill}>{severityWord[item.severity]}</Pill>}
              <p className={cn(text.title, "leading-snug")}>{item.title}</p>
            </div>
            {when && <p className={cn(text.meta, "mt-0.5")}>{when}</p>}
          </div>
          <div className="relative -mr-1 -mt-1 flex shrink-0 items-center gap-0.5">
            {/* ... menu */}
            <div className="relative">
              <button
                type="button"
                aria-label="More options"
                onClick={() => setMenuOpen((v) => !v)}
                className="grid h-8 w-8 place-items-center rounded-full text-white/50 transition hover:bg-white/[0.06] hover:text-white"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-[61] mt-1 w-48 rounded-xl border border-white/[0.10] bg-[#2c2c2e] py-1 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setFlagged(true);
                        setMenuOpen(false);
                        // Tell Scout to learn this is low-urgency
                        const { askScout } = require('./scoutBus');
                        import('./scoutBus').then(({ askScout: ask }) => {
                          ask(
                            `Flag "${item.title}" as not urgent so you don't surface it as a priority. Note it as low-urgency and self-heal if you can.`,
                            { about: [item.title, item.detail, item.why].filter(Boolean).join(' | ') }
                          );
                        });
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-white/70 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      <VolumeX className="h-4 w-4 shrink-0" aria-hidden />
                      {flagged ? 'Flagged as not urgent' : 'Not urgent'}
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full text-white/50 transition hover:bg-white/[0.06] hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {item.detail && (
            <p className={cn(text.detail, "leading-relaxed whitespace-pre-line")}>{item.detail}</p>
          )}
          {item.check && VERDICT_WORD[item.check.verdict] && (
            <p className="text-[13px] leading-snug text-white/70">
              <span className="font-medium text-white/90">Scout checked{item.check.at ? <> at <span className="whitespace-nowrap">{clock12(item.check.at)}</span></> : null}: </span>
              {VERDICT_WORD[item.check.verdict]}{item.check.summary ? ` · ${item.check.summary}` : ""}
            </p>
          )}
          {item.why && (
            <p className="text-[12px] leading-snug text-white/40">{item.why}</p>
          )}
          {item.originTable && (
            <p className="font-mono text-[11px] text-white/30">
              {item.originTable}
              {item.originId ? ` · ${item.originId.length > 20 ? item.originId.slice(0, 8) + "…" : item.originId}` : ""}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-5 py-3">
          <AskScoutButton
            question={`Help me with this: ${item.title}. What's going on, and can you fix it?`}
            about={[item.title, item.detail, item.href].filter(Boolean).join(" | ")}
            className="h-9 rounded-full px-3 text-[13px] font-medium"
            label="Ask Scout"
          />
          {item.href && (
            <a
              href={item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener noreferrer" : undefined}
              onClick={onClose}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/[0.10] px-3 text-[13px] font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white"
            >
              {item.doneLabel ?? "Open"}
              {item.external && <ExternalLink className="h-3.5 w-3.5" aria-hidden />}
            </a>
          )}
          {item.done && (
            <button
              type="button"
              disabled={working === item.id}
              onClick={() => { onDone(item.id, item.title); onClose(); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/[0.10] px-3 text-[13px] font-medium text-white/60 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50 ml-auto"
            >
              {working === item.id
                ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
                : <Check className="h-4 w-4" aria-hidden />}
              Mark done
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export function ActionInbox() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<ActionItem | null>(null);
  /** A Refresh in flight: the rules already ran; `run` is the AI pass still judging `pending` items. */
  const [checking, setChecking] = useState<{ run: string | null; pending: number } | null>(null);

  const load = useCallback(async () => {
    // admin_today / admin_today_done are newer than the generated Supabase types;
    // the cast goes away next time types are regenerated.
    const { data, error: rpcError } = await (supabase.rpc as any)("admin_today");

    if (rpcError) {
      setError("Couldn't load the queue.");
      setLoading(false);
      return;
    }
    setError(null);

    const now = Date.now();
    const rows = (data ?? []) as TodayRow[];

    // Scout's latest read per row (last day), so the popup can say what the last Refresh found.
    const checks = new Map<string, NeedCheck>();
    const keys = rows.map((r) => r.key).filter((k) => k.startsWith("bell:") || k.startsWith("cy:"));
    if (keys.length) {
      const { data: cs } = await supabase.from("admin_needs_checks" as never)
        .select("key, verdict, summary, finished_at, closed, status")
        .in("key", keys).eq("status", "done").gte("created_at", new Date(now - 864e5).toISOString())
        .order("created_at", { ascending: false }).limit(200);
      for (const c of ((cs ?? []) as any[])) {
        if (!checks.has(c.key)) checks.set(c.key, { verdict: c.verdict, summary: c.summary, at: c.finished_at, closed: c.closed });
      }
    }

    const out: ActionItem[] = rows.map((r) => {
      const count = r.item_count ?? 1;
      return {
        id: r.key,
        severity: severityFromRow[r.severity] ?? "info",
        icon: sourceIcon[r.source] ?? AlertCircle,
        title: r.title,
        detail: r.detail || undefined,
        ageMs: r.since ? now - new Date(r.since).getTime() : 0,
        href: r.url || undefined,
        external: !!r.url && /^https?:/i.test(r.url) && !r.url.startsWith(window.location.origin) && !r.url.startsWith("/"),
        count: count > 1 ? count : undefined,
        // Every row can be ticked now. admin_today_done() used to raise for anything that was
        // not a Cookie Yeti release or a bell alert, so the check mark was hidden on the rest.
        done: true,
        doneLabel: r.action_label || "Done",
        originTable: r.origin_table || undefined,
        originId: r.origin_id || undefined,
        why: r.why || undefined,
        since: r.since || undefined,
        check: checks.get(r.key),
      };
    });

    out.sort((a, b) => {
      const r = severityRank[a.severity] - severityRank[b.severity];
      if (r !== 0) return r;
      return b.ageMs - a.ageMs;
    });

    setItems(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) load();
    };
    run();
    const interval = setInterval(run, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [load]);

  const undoDone = useCallback(async (key: string, title: string) => {
    const { error: rpcError } = await (supabase.rpc as any)("admin_today_undo", { p_key: key });
    if (rpcError) { toast.error("Couldn't put it back", { description: rpcError.message }); return; }
    toast("Back on the list", { description: title });
    load();
  }, [load]);

  const markDone = useCallback(
    async (key: string, title: string) => {
      setWorking(key);
      const { error: rpcError } = await (supabase.rpc as any)("admin_today_done", { p_key: key });
      if (rpcError) {
        setError("That didn't go through. Try again.");
      } else {
        setItems((prev) => prev.filter((i) => i.id !== key));
        // A tick is one tap and the row leaves the list, so the same tap has to be reversible.
        // Cookie Yeti and bell rows really change at the source; the rest record a dismissal,
        // and admin_today_undo removes it either way.
        toast("Done", {
          description: title,
          action: { label: "Undo", onClick: () => void undoDone(key, title) },
        });
      }
      setWorking(null);
      load();
    },
    [load, undoDone],
  );

  const undoMany = useCallback(async (keys: string[]) => {
    const results = await Promise.all(keys.map((k) => (supabase.rpc as any)("admin_today_undo", { p_key: k })));
    const failed = results.filter((r) => r.error).length;
    if (failed) toast.error(`Couldn't put ${failed} back`);
    else toast(keys.length === 1 ? "Back on the list" : `${keys.length} back on the list`, { description: "Scout won't close these again for a week." });
    load();
  }, [load]);

  const listTitles = (rows: { title: string }[]) =>
    rows.slice(0, 3).map((r) => r.title).join(" · ") + (rows.length > 3 ? ` · and ${rows.length - 3} more` : "");

  /**
   * Refresh = reload AND have Scout check whether anything here (and in the to-dos) is already done.
   * The server closes what it can prove right away, then an AI pass judges the rest in the background;
   * this polls that pass and reports what it closed. Everything it closes is one tap to put back.
   */
  const scoutRefresh = useCallback(async () => {
    if (checking) { load(); return; }
    setChecking({ run: null, pending: 0 });
    const { data, error: fnErr } = await supabase.functions.invoke("todo-check", { body: { op: "refresh" } });
    const d = data as { ok?: boolean; error?: string; run?: string; closed?: { key: string; title: string; why: string }[]; judging?: number; todos?: number } | null;
    await load();
    if (fnErr || !d?.ok) {
      setChecking(null);
      toast.error("Scout couldn't check right now", { description: d?.error ?? fnErr?.message ?? "Refreshed the list only." });
      return;
    }
    if ((d.todos ?? 0) > 0) window.dispatchEvent(new CustomEvent("scout:checking", { detail: { todos: d.todos } }));
    const closed = d.closed ?? [];
    const more = [d.judging ? `${d.judging} on this list` : "", d.todos ? `${d.todos} to-do${d.todos === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    if (closed.length) {
      toast(`Scout cleared ${closed.length} that ${closed.length === 1 ? "was" : "were"} already handled`, {
        description: listTitles(closed) + (more ? `. Still checking ${more}.` : ""),
        action: { label: "Undo", onClick: () => void undoMany(closed.map((c) => c.key)) },
        duration: 10_000,
      });
    } else if (more) {
      toast(`Scout is checking ${more}`, { description: "Anything already done gets cleared. You can leave this page." });
    } else {
      toast("Up to date", { description: "Nothing new to check. Scout looked at everything here in the last 20 minutes." });
    }
    setChecking(d.judging && d.run ? { run: d.run, pending: d.judging } : null);
  }, [checking, load, undoMany]);

  // Watch the AI pass a Refresh started; report what it closed. Gives up watching after 4 minutes
  // (the server keeps going and sends a notification when it closes anything).
  useEffect(() => {
    const run = checking?.run;
    if (!run) return;
    const stopAt = Date.now() + 240_000;
    let stopped = false;
    const tick = async () => {
      const { data } = await supabase.from("admin_needs_checks" as never)
        .select("key, title, status, closed, rule").eq("run_id", run);
      const rows = (data ?? []) as { key: string; title: string; status: string; closed: boolean; rule: string | null }[];
      const left = rows.filter((r) => r.status === "queued" || r.status === "running").length;
      if (stopped) return;
      if (left > 0 && Date.now() < stopAt) { setChecking({ run, pending: left }); return; }
      stopped = true;
      setChecking(null);
      load();
      if (left > 0) return;
      const aiClosed = rows.filter((r) => r.closed && !r.rule);
      const judged = rows.filter((r) => !r.rule).length;
      if (aiClosed.length) {
        toast(`Scout cleared ${aiClosed.length} more`, {
          description: listTitles(aiClosed),
          action: { label: "Undo", onClick: () => void undoMany(aiClosed.map((c) => c.key)) },
          duration: 10_000,
        });
      } else if (judged) {
        toast(`Scout checked ${judged} more`, { description: "None of them are done yet. Tap one to see what Scout found." });
      }
    };
    const t = setInterval(tick, 3000);
    return () => { stopped = true; clearInterval(t); };
  }, [checking?.run, load, undoMany]);

  // The page's "Refresh now" menu item runs the same check.
  useEffect(() => {
    const on = () => void scoutRefresh();
    window.addEventListener("admin:refresh-now", on);
    return () => window.removeEventListener("admin:refresh-now", on);
  }, [scoutRefresh]);

  const summary = useMemo(() => {
    const critical = items.filter((i) => i.severity === "critical").length;
    const urgent = items.filter((i) => i.severity === "urgent").length;
    const stale = items.filter((i) => i.severity === "stale").length;
    return { critical, urgent, stale, total: items.length };
  }, [items]);

  const header = (
    <SectionHeader
      id="action-inbox-title"
      title="Needs you"
      aside={
        <>
          {checking ? (
            <span aria-live="polite">
              {checking.pending > 0 ? <>Scout is checking <span className="whitespace-nowrap">{checking.pending} {checking.pending === 1 ? "item" : "items"}</span>…</> : "Scout is checking…"}
            </span>
          ) : !loading && summary.total > 0 && (
            <span>
              {summary.total}
              {summary.critical > 0 && ` · ${summary.critical} critical`}
              {summary.urgent > 0 && ` · ${summary.urgent} urgent`}
            </span>
          )}
          <IconButton
            label={checking ? "Scout is checking what's already done" : "Refresh, and have Scout clear what's already done"}
            title="Refresh · Scout clears what's already done"
            onClick={() => void scoutRefresh()}
            aria-busy={!!checking}
            className="-mr-2"
          >
            <RefreshCw className={cn("h-4 w-4", checking && "animate-spin motion-reduce:animate-none")} aria-hidden />
          </IconButton>
        </>
      }
    />
  );

  if (loading) {
    return (
      <section aria-labelledby="action-inbox-title" aria-busy>
        {header}
        <SkeletonRows rows={3} />
      </section>
    );
  }

  const errorBar = error && (
    <div className={cn("border-b py-2", hairline, inset)}>
      <LoadError label="the queue" message={error.replace(/\.$/, "")} onRetry={() => load()} />
    </div>
  );

  if (summary.total === 0) {
    return (
      <section aria-labelledby="action-inbox-title">
        {header}
        <div className={cn(cardCls, "overflow-hidden")}>
          {errorBar}
          <div className={cn(rowCls, "py-4")}>
            <CheckCircle2 className={cn("h-5 w-5 shrink-0", error ? "text-white/40" : tint.green)} aria-hidden />
            <p className={text.title}>
              {error ? "Nothing loaded, so this may not be everything." : "Nothing needs you."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const visible = showAll ? items : items.slice(0, COLLAPSED_COUNT);
  const hidden = items.length - COLLAPSED_COUNT;

  return (
    <section aria-labelledby="action-inbox-title">
      {header}
      <div className={cn(cardCls, "overflow-hidden")}>
        {errorBar}
        <ul id="action-inbox-list" className={divider}>
          {visible.map((item) => {
            const Icon = item.icon;
            const pill = severityPill[item.severity];
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setOpenItem(item)}
                  className={cn(
                    "flex w-full min-h-[44px] items-center gap-3 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF] focus-visible:ring-inset",
                    inset,
                  )}
                  aria-label={`${severityWord[item.severity]}: ${item.title}`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-white/55" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={cn(text.title, "flex min-w-0 items-center gap-2")}>
                      {pill ? <Pill tone={pill}>{severityWord[item.severity]}</Pill> : <span className="sr-only">{severityWord[item.severity]}: </span>}
                      <span className="truncate">{item.title}</span>
                    </p>
                    {item.detail && <p className={cn(text.detail, "mt-0.5 truncate")}>{item.detail}</p>}
                  </div>
                  {item.count && <Pill>{item.count}</Pill>}
                  <span className={cn(text.meta, "shrink-0")}>
                    <span className="sr-only">Waiting </span>{timeAgo(item.ageMs)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {hidden > 0 && (
          <Disclosure open={showAll} onToggle={() => setShowAll((v) => !v)} controls="action-inbox-list">
            {showAll ? "Show fewer" : `Show all ${items.length}`}
          </Disclosure>
        )}
      </div>
      {openItem && (
        <ItemPopup
          item={openItem}
          onClose={() => setOpenItem(null)}
          onDone={markDone}
          working={working}
        />
      )}
    </section>
  );
}
