import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Activity, FileText, ShieldCheck, Wrench } from "lucide-react";

const ICON_MAP: Record<string, any> = {
  new_submission: FileText,
  access_granted: ShieldCheck,
  pattern_maintenance: Wrench,
};

const COLOR_MAP: Record<string, string> = {
  new_submission: "text-blue-400",
  access_granted: "text-green-400",
  pattern_maintenance: "text-amber-400",
};

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function ActivityFeed() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (supabase
      .from("admin_activity_log" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20) as any)
      .then(({ data }: { data: any[] | null }) => {
        setEvents(data || []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4">
        <Activity className="h-4 w-4 text-white/30" />
        <div>
          <h3 className="text-[15px] font-semibold text-white">Activity Feed</h3>
          <p className="text-xs text-white/30 mt-0.5">Recent events across the admin suite.</p>
        </div>
      </div>

      {loading ? (
        <div className="divide-y divide-white/[0.06]">
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
        <div className="px-5 py-10 text-center">
          <Activity className="h-6 w-6 text-white/15 mx-auto mb-2" />
          <p className="text-sm text-white/30">No activity yet</p>
          <p className="text-xs text-white/20 mt-0.5">Events will appear here as they happen.</p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {events.map((e) => {
            const Icon = ICON_MAP[e.event_type] || Activity;
            const color = COLOR_MAP[e.event_type] || "text-white/40";
            return (
              <div key={e.id} className="flex items-start gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                <div className={`mt-0.5 shrink-0 ${color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/70">{e.description}</p>
                  <p className="text-xs text-white/30 mt-0.5">{timeAgo(e.created_at)}</p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0 border-white/10 text-white/30">
                  {e.event_type.replace(/_/g, " ")}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
