import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, FileText, RefreshCw, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  new_submission: FileText,
  access_granted: ShieldCheck,
  pattern_maintenance: Wrench,
};

const COLOR_MAP: Record<string, string> = {
  new_submission: "text-blue-400",
  access_granted: "text-green-400",
  pattern_maintenance: "text-amber-400",
};

interface ActivityEvent {
  id: string;
  event_type: string;
  description: string | null;
  created_at: string;
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface ActivityFeedProps {
  /** How many events to show (default 20). */
  limit?: number;
  /** Drop the card chrome and heading, for use inside another section. */
  embedded?: boolean;
}

export function ActivityFeed({ limit = 20, embedded = false }: ActivityFeedProps = {}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await (supabase
      .from("admin_activity_log" as never)
      .select("id, event_type, description, created_at")
      .order("created_at", { ascending: false })
      .limit(limit) as unknown as Promise<{ data: ActivityEvent[] | null; error: { message: string } | null }>);
    if (err) setError(err.message);
    else {
      setError(null);
      setEvents(data || []);
    }
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  };

  return (
    <section
      aria-labelledby={embedded ? undefined : "activity-feed-title"}
      aria-label={embedded ? "Recent activity" : undefined}
      className={embedded ? "overflow-hidden" : "bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden"}
    >
      {!embedded && (
      <div className="flex items-center gap-2 px-5 py-4">
        <Activity className="h-4 w-4 text-white/55" aria-hidden />
        <div>
          <h3 id="activity-feed-title" className="text-[0.9375rem] font-semibold text-white">Activity</h3>
          <p className="text-xs text-white/60 mt-0.5">Recent events across the admin suite.</p>
        </div>
      </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-3 px-5 py-2.5 border-y border-red-500/20 bg-red-500/[0.06]">
          <AlertTriangle className="h-4 w-4 text-red-300 shrink-0" aria-hidden />
          <p className="text-xs text-red-200 flex-1">Couldn't load activity: {error}</p>
          <Button size="sm" variant="outline" className="h-9 border-red-400/30 text-red-100 hover:bg-red-500/10" onClick={retry} disabled={retrying}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? "animate-spin" : ""}`} aria-hidden /> Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="divide-y divide-white/[0.06]" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 px-5 py-3">
              <Skeleton className="h-4 w-4 rounded bg-white/[0.05] shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4 rounded bg-white/[0.05]" />
                <Skeleton className="h-3 w-1/3 rounded bg-white/[0.03]" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        !error && (
          <div className="px-5 py-10 text-center">
            <Activity className="h-6 w-6 text-white/30 mx-auto mb-2" aria-hidden />
            <p className="text-sm text-white/70">No activity yet</p>
            <p className="text-xs text-white/55 mt-0.5">New submissions and access grants will be listed here.</p>
          </div>
        )
      ) : (
        <ul className="divide-y divide-white/[0.04]">
          {events.map((e) => {
            const Icon = ICON_MAP[e.event_type] || Activity;
            const color = COLOR_MAP[e.event_type] || "text-white/55";
            return (
              <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                <div className={`mt-0.5 shrink-0 ${color}`}>
                  <Icon className="h-4 w-4" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/80">{e.description}</p>
                  <p className="text-xs text-white/55 mt-0.5">
                    <time dateTime={e.created_at} title={new Date(e.created_at).toLocaleString()}>{timeAgo(e.created_at)}</time>
                  </p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0 border-white/10 text-white/60 capitalize">
                  {e.event_type.replace(/_/g, " ")}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
