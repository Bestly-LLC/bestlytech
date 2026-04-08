import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { fetchOverviewStats, OverviewStats } from "@/services/homeHubApi";
import { Shield, House, Plug, RefreshCw, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "enabled" || status === "online" || status === "running"
      ? "bg-green-500"
      : status === "degraded" || status === "disabled"
      ? "bg-yellow-500"
      : "bg-red-500";
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}

const SERVICE_COLORS: Record<string, string> = {
  "Pi-hole": "text-green-400",
  "Home Assistant": "text-blue-400",
  Homebridge: "text-purple-400",
};

function ServiceCardSkeleton() {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-4 w-24 bg-white/[0.05]" />
        <Skeleton className="h-8 w-8 rounded-xl bg-white/[0.05]" />
      </div>
      <Skeleton className="h-8 w-20 bg-white/[0.05] mt-2" />
      <Skeleton className="h-3 w-32 bg-white/[0.03] mt-2" />
    </div>
  );
}

export default function HomeHubOverview() {
  const [data, setData] = useState<OverviewStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const stats = await fetchOverviewStats();
      setData(stats);
      setLastUpdated(new Date());
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Poll every 30s — overview aggregates all services
  useEffect(() => {
    load();
    const iv = setInterval(() => load(), 30_000);
    return () => clearInterval(iv);
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Home Hub"
        description="Raspberry Pi 5 service monitoring"
        actions={
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-white/30">Last updated {lastUpdated.toLocaleTimeString()}</span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => load(true)}
              disabled={refreshing || initialLoading}
              className="text-white/30 hover:text-white hover:bg-white/5 h-8 w-8 border-0"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />

      {/* Status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {initialLoading ? (
          <>
            <ServiceCardSkeleton />
            <ServiceCardSkeleton />
            <ServiceCardSkeleton />
          </>
        ) : data ? (
          <>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6 hover:bg-white/[0.05] transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <StatusDot status={data.pihole.status} />
                  <span className="text-sm font-medium text-white">Pi-hole</span>
                </div>
                <div className="h-8 w-8 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <Shield className="h-4 w-4 text-green-400" />
                </div>
              </div>
              <p className="text-2xl sm:text-3xl font-semibold text-white tabular-nums">{data.pihole.queriesBlocked.toLocaleString()}</p>
              <p className="text-[11px] text-white/40 mt-0.5">Queries Blocked Today</p>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-white/25">{data.pihole.percentBlocked}% blocked</p>
                {data.pihole.capturedAt && (
                  <p className="text-[10px] text-white/20">Pi synced {timeAgo(data.pihole.capturedAt)}</p>
                )}
              </div>
            </div>

            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6 hover:bg-white/[0.05] transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <StatusDot status={data.homeAssistant.status} />
                  <span className="text-sm font-medium text-white">Home Assistant</span>
                </div>
                <div className="h-8 w-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <House className="h-4 w-4 text-blue-400" />
                </div>
              </div>
              <p className="text-2xl sm:text-3xl font-semibold text-white tabular-nums">{data.homeAssistant.devicesOnline}</p>
              <p className="text-[11px] text-white/40 mt-0.5">Devices Online</p>
              <p className="text-[10px] text-white/25 mt-1">{data.homeAssistant.activeAutomations} active automations</p>
            </div>

            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6 hover:bg-white/[0.05] transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <StatusDot status={data.homebridge.status} />
                  <span className="text-sm font-medium text-white">Homebridge</span>
                </div>
                <div className="h-8 w-8 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <Plug className="h-4 w-4 text-purple-400" />
                </div>
              </div>
              <p className="text-2xl sm:text-3xl font-semibold text-white tabular-nums">{data.homebridge.accessories}</p>
              <p className="text-[11px] text-white/40 mt-0.5">Accessories</p>
              <p className="text-[10px] text-white/25 mt-1">{data.homebridge.pluginsActive} plugins active</p>
            </div>
          </>
        ) : null}
      </div>

      {/* Recent Activity */}
      {initialLoading ? (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <Skeleton className="h-4 w-32 bg-white/[0.05] mb-4" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 py-3 border-t border-white/[0.04]">
              <Skeleton className="h-4 w-4 rounded bg-white/[0.05] shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4 bg-white/[0.05]" />
                <Skeleton className="h-3 w-1/4 bg-white/[0.03]" />
              </div>
            </div>
          ))}
        </div>
      ) : data ? (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl">
          <div className="flex items-center gap-2 p-4 sm:p-6 pb-3">
            <Activity className="h-4 w-4 text-white/40" />
            <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {data.recentActivity.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 sm:px-6 py-3">
                <div className={`mt-0.5 ${SERVICE_COLORS[e.service] || "text-white/40"}`}>
                  <Activity className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/80">{e.description}</p>
                  <p className="text-xs text-white/30 mt-0.5">{timeAgo(e.timestamp)}</p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0 border-white/10 text-white/40">
                  {e.service}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
