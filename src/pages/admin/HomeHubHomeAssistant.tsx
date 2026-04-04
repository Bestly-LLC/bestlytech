import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { fetchHomeAssistantStats, HomeAssistantStats, toggleAutomation as apiToggle } from "@/services/homeHubApi";
import { House, Cpu, Zap, Radio, Clock, BatteryMedium, Activity, CloudSun, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

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
  const color = status === "ok" ? "bg-green-500" : status === "warning" ? "bg-yellow-500" : "bg-red-500";
  return (
    <span className="relative flex h-2 w-2">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
    </span>
  );
}

const SENSOR_ICONS: Record<string, any> = {
  battery: BatteryMedium,
  seismic: AlertTriangle,
  weather: CloudSun,
};

export default function HomeHubHomeAssistant() {
  const [data, setData] = useState<HomeAssistantStats | null>(null);

  const load = useCallback(async () => {
    setData(await fetchHomeAssistantStats());
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!data) return;
    await apiToggle(id, enabled);
    setData({
      ...data,
      automationList: data.automationList.map((a) => (a.id === id ? { ...a, enabled } : a)),
    });
  };

  if (!data) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Home Assistant" description="Smart home automation control" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Entities" value={data.entities} icon={Cpu} />
        <StatCard label="Automations" value={data.automations} icon={Zap} />
        <StatCard label="Active Sensors" value={data.activeSensors} icon={Radio} />
        <StatCard label="Last Triggered" value={data.lastAutomationTriggered.split(" — ")[0]} icon={Clock} subtitle={data.lastAutomationTriggered.split(" — ")[1]} />
      </div>

      {/* Sensors */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {data.sensors.map((s) => {
          const Icon = SENSOR_ICONS[s.type] || Radio;
          return (
            <div key={s.name} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6 hover:bg-white/[0.05] transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <StatusDot status={s.status} />
                  <span className="text-sm font-medium text-white">{s.name}</span>
                </div>
                <div className="h-8 w-8 rounded-xl bg-white/[0.05] flex items-center justify-center">
                  <Icon className="h-4 w-4 text-white/40" />
                </div>
              </div>
              <p className="text-2xl font-semibold text-white">{s.value}</p>
              <p className="text-[11px] text-white/40 mt-0.5 capitalize">{s.type} sensor</p>
            </div>
          );
        })}
      </div>

      {/* Automations */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl">
        <div className="p-4 sm:p-6 pb-3">
          <h3 className="text-sm font-semibold text-white">Automations</h3>
        </div>
        <div className="divide-y divide-white/[0.06]">
          {data.automationList.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 sm:px-6 py-3">
              <div className="min-w-0">
                <p className="text-sm text-white/80">{a.name}</p>
                <p className="text-xs text-white/30">Last: {timeAgo(a.lastTriggered)}</p>
              </div>
              <Switch checked={a.enabled} onCheckedChange={(v) => handleToggle(a.id, v)} />
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl">
        <div className="flex items-center gap-2 p-4 sm:p-6 pb-3">
          <Activity className="h-4 w-4 text-white/40" />
          <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
        </div>
        <div className="divide-y divide-white/[0.06]">
          {data.recentActivity.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-4 sm:px-6 py-3">
              <Activity className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/80">{e.description}</p>
                <p className="text-xs text-white/30 mt-0.5">{timeAgo(e.timestamp)}</p>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0 border-white/10 text-white/40">{e.type}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
