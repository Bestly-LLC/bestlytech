import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Disclosure, IconButton, LoadError, Pill, RowLink, SectionHeader, SkeletonRows,
  cardCls, divider, hairline, inset, rowCls, text, tint,
} from "@/components/admin/ui";
import { AskScoutButton } from "./AskScoutButton";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
}

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

/**
 * Where a to-do came from. Hover, or focus it with the keyboard — it is a button, so a tap on a
 * phone opens it too. The row itself only ever said "Studio"; this names the table, the record
 * and the exact condition that put it in front of you.
 */
function WhereFrom({ item }: { item: ActionItem }) {
  if (!item.originTable && !item.why) return null;
  const when = item.since
    ? new Date(item.since).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={`Where this came from: ${item.why ?? item.originTable}`}
          className="grid h-11 w-9 shrink-0 place-items-center self-center text-white/60 transition hover:text-white sm:h-9">
          <Info className="h-4 w-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-left">
        {item.why && <p className="text-[0.8125rem] leading-snug">{item.why}</p>}
        {item.originTable && (
          <p className="mt-1 font-mono text-[0.6875rem] opacity-70">
            {item.originTable}{item.originId ? ` · ${item.originId.length > 20 ? item.originId.slice(0, 8) + "…" : item.originId}` : ""}
          </p>
        )}
        {when && <p className="mt-1 text-[0.6875rem] opacity-70">Since {when}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

export function ActionInbox() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

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
        external: !!r.url && /^https?:/i.test(r.url),
        count: count > 1 ? count : undefined,
        // Every row can be ticked now. admin_today_done() used to raise for anything that was
        // not a Cookie Yeti release or a bell alert, so the check mark was hidden on the rest.
        done: true,
        doneLabel: r.action_label || "Done",
        originTable: r.origin_table || undefined,
        originId: r.origin_id || undefined,
        why: r.why || undefined,
        since: r.since || undefined,
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
          {!loading && summary.total > 0 && (
            <span>
              {summary.total}
              {summary.critical > 0 && ` · ${summary.critical} critical`}
              {summary.urgent > 0 && ` · ${summary.urgent} urgent`}
            </span>
          )}
          <IconButton label="Refresh the queue" onClick={() => load()} className="-mr-2">
            <RefreshCw className="h-4 w-4" aria-hidden />
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
            const body = (
              <>
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
              </>
            );

            // One layout for every row. The row itself is the link — that is what "Open this
            // preview" means — and the tick is its own small button beside it. They used to be
            // the same control: the tick wore the row's action_label, so a button reading
            // "Open this preview" quietly dismissed the item instead of opening it, and the ⓘ
            // lived in a branch nothing reached any more.
            return (
              <li key={item.id} className="flex items-stretch">
                <div className="min-w-0 flex-1">
                  <RowLink href={item.href} label={item.href ? `${item.doneLabel}: ${item.title}` : undefined}>
                    {body}
                  </RowLink>
                </div>
                <WhereFrom item={item} />
                {item.done && (
                  <IconButton
                    label={`Mark done: ${item.title}`}
                    disabled={working === item.id}
                    onClick={() => markDone(item.id, item.title)}
                    className="self-center"
                  >
                    {working === item.id
                      ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
                      : <Check className="h-4 w-4" aria-hidden />}
                  </IconButton>
                )}
                <AskScoutButton
                  question={`Help me with this: ${item.title}. What's going on, and can you fix it?`}
                  about={[item.title, item.detail, item.href].filter(Boolean).join(" | ")}
                  className="mr-2 h-11 w-11 self-center rounded-full sm:mr-3 sm:h-9 sm:w-9"
                />
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
    </section>
  );
}
