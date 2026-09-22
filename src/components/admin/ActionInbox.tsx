import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  Sparkles,
  ChevronRight,
  RefreshCw,
  Check,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AskScoutButton } from "./AskScoutButton";

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
}

const severityRank: Record<Severity, number> = { critical: 0, urgent: 1, stale: 2, info: 3 };

const severityDot: Record<Severity, string> = {
  critical: "bg-red-500 shadow-[0_0_0.75rem_rgba(239,68,68,0.6)]",
  urgent: "bg-amber-400 shadow-[0_0_0.625rem_rgba(251,191,36,0.5)]",
  stale: "bg-yellow-500/70",
  info: "bg-white/40",
};

const severityWord: Record<Severity, string> = {
  critical: "Critical",
  urgent: "Urgent",
  stale: "Waiting",
  info: "FYI",
};

const severityIconColor: Record<Severity, string> = {
  critical: "text-red-400",
  urgent: "text-amber-400",
  stale: "text-yellow-500",
  info: "text-white/55",
};

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

const COLLAPSED_COUNT = 8;

function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
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
        done: r.key.startsWith("cy:") || r.key.startsWith("bell:"),
        doneLabel: r.action_label || "Done",
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

  const markDone = useCallback(
    async (key: string) => {
      setWorking(key);
      const { error: rpcError } = await (supabase.rpc as any)("admin_today_done", { p_key: key });
      if (rpcError) {
        setError("That didn't go through. Try again.");
      } else {
        setItems((prev) => prev.filter((i) => i.id !== key));
      }
      setWorking(null);
      load();
    },
    [load],
  );

  const summary = useMemo(() => {
    const critical = items.filter((i) => i.severity === "critical").length;
    const urgent = items.filter((i) => i.severity === "urgent").length;
    const stale = items.filter((i) => i.severity === "stale").length;
    return { critical, urgent, stale, total: items.length };
  }, [items]);

  if (loading) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
        <Skeleton className="h-5 w-40 bg-white/[0.05]" />
        <div className="mt-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-xl bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  const errorBar = error && (
    <div role="alert" className="flex items-center gap-3 px-5 py-2.5 border-b border-amber-500/20 bg-amber-500/[0.06]">
      <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0" aria-hidden />
      <p className="text-xs text-amber-100 flex-1">{error}</p>
      <Button
        size="sm"
        variant="outline"
        className="h-9 border-amber-400/30 text-amber-100 hover:bg-amber-500/10"
        onClick={() => load()}
      >
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Retry
      </Button>
    </div>
  );

  if (summary.total === 0) {
    return (
      <div className="bg-white/[0.03] border border-emerald-500/20 rounded-2xl overflow-hidden">
        {errorBar}
        <div className="flex items-center gap-3 p-5">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-emerald-400" aria-hidden />
          </div>
          <div>
            <h3 className="text-[0.9375rem] font-semibold text-white">
              {error ? "Nothing found" : "Nothing needs you"}
            </h3>
            <p className="text-xs text-white/60 mt-0.5">
              {error
                ? "The queue didn't load, so this may not be the whole picture."
                : "Every queue is clear - releases, Studio, client asks, mail, stock and uptime."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const headlineColor =
    summary.critical > 0 ? "text-red-400" : summary.urgent > 0 ? "text-amber-400" : "text-yellow-400";

  const visible = showAll ? items : items.slice(0, COLLAPSED_COUNT);
  const hidden = items.length - COLLAPSED_COUNT;

  return (
    <section
      aria-labelledby="action-inbox-title"
      className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <div>
          <h3 id="action-inbox-title" className="text-[0.9375rem] font-semibold text-white">
            Needs you
          </h3>
          <p className={cn("text-xs mt-0.5 font-medium", headlineColor)}>
            {summary.total} {summary.total === 1 ? "item" : "items"}
            {summary.critical > 0 && ` · ${summary.critical} critical`}
            {summary.urgent > 0 && ` · ${summary.urgent} urgent`}
            {summary.stale > 0 && ` · ${summary.stale} waiting`}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 text-xs text-white/60 hover:text-white hover:bg-white/5"
          onClick={() => load()}
          aria-label="Refresh the queue"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      {errorBar}
      <ul className="divide-y divide-white/[0.04]">
        {visible.map((item) => {
          const Icon = item.icon;
          const body = (
            <>
              <span className={cn("h-2 w-2 rounded-full shrink-0", severityDot[item.severity])} aria-hidden />
              <Icon className={cn("h-4 w-4 shrink-0", severityIconColor[item.severity])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">
                  <span className="sr-only">{severityWord[item.severity]}: </span>
                  {item.title}
                </p>
                {item.detail && <p className="text-xs text-white/60 truncate mt-0.5">{item.detail}</p>}
              </div>
              {item.count && (
                <span className="text-[0.6875rem] text-white/60 tabular-nums shrink-0 rounded-full border border-white/10 px-2 py-0.5">
                  {item.count}
                </span>
              )}
              <span className="text-xs text-white/55 tabular-nums shrink-0">{timeAgo(item.ageMs)}</span>
            </>
          );

          if (item.done) {
            return (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                {body}
                <Button
                  size="sm"
                  className="h-9 shrink-0 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                  disabled={working === item.id}
                  onClick={() => markDone(item.id)}
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                  {working === item.id ? "..." : item.doneLabel}
                </Button>
                <AskScoutButton
                  question={`Help me with this: ${item.title}. What's going on, and can you handle it?`}
                  about={[item.title, item.detail].filter(Boolean).join(" | ")}
                  className="-mr-2"
                />
              </li>
            );
          }

          const ask = (
            <AskScoutButton
              question={`Help me with this: ${item.title}. What's going on, and can you fix it?`}
              about={[item.title, item.detail, item.href].filter(Boolean).join(" | ")}
              className="mr-2 self-center"
            />
          );
          return (
            <li key={item.id} className="flex items-stretch">
              <div className="min-w-0 flex-1">
              {item.href ? (
                item.external ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {body}
                    <ChevronRight
                      className="h-4 w-4 text-white/40 group-hover:text-white/70 transition-colors shrink-0"
                      aria-hidden
                    />
                  </a>
                ) : (
                  <Link
                    to={item.href}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {body}
                    <ChevronRight
                      className="h-4 w-4 text-white/40 group-hover:text-white/70 transition-colors shrink-0"
                      aria-hidden
                    />
                  </Link>
                )
              ) : (
                <div className="flex items-center gap-3 px-5 py-3">{body}</div>
              )}
              </div>
              {ask}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <div className="px-5 py-2 text-center border-t border-white/[0.04]">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-white/70 hover:text-white hover:bg-white/5"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show fewer" : `Show ${hidden} more`}
          </Button>
        </div>
      )}
    </section>
  );
}
