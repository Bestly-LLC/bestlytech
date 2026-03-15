import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, FileText, ShieldCheck, Wrench } from "lucide-react";

const ICON_MAP: Record<string, any> = {
  new_submission: FileText,
  access_granted: ShieldCheck,
  pattern_maintenance: Wrench,
};

const COLOR_MAP: Record<string, string> = {
  new_submission: "text-primary",
  access_granted: "text-green-500",
  pattern_maintenance: "text-yellow-500",
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
    supabase
      .from("admin_activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setEvents(data || []);
        setLoading(false);
      });
  }, []);

  if (loading) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">Activity Feed</CardTitle>
        </div>
        <CardDescription className="text-xs">Recent events across the admin suite.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <div className="px-6 pb-6 text-sm text-muted-foreground text-center py-8">
            No activity yet. Events will appear here as they happen.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {events.map((e) => {
              const Icon = ICON_MAP[e.event_type] || Activity;
              const color = COLOR_MAP[e.event_type] || "text-muted-foreground";
              return (
                <div key={e.id} className="flex items-start gap-3 px-6 py-3">
                  <div className={`mt-0.5 ${color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{e.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(e.created_at)}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {e.event_type.replace(/_/g, " ")}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
