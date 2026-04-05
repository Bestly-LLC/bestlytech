import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { ExportButton } from "@/components/admin/ExportButton";
import { fetchPiholeStats, PiholeStats, piholeEnable, piholeDisable, piholeUpdateGravity } from "@/services/homeHubApi";
import { Shield, Search, Database, BarChart3, ListFilter, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { toast } from "sonner";

function dataAge(capturedAt: string | null): string {
  if (!capturedAt) return "never synced";
  const diffSec = Math.floor((Date.now() - new Date(capturedAt).getTime()) / 1000);
  if (diffSec < 90) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}

export default function HomeHubPihole() {
  const [data, setData] = useState<PiholeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [blockedSearch, setBlockedSearch] = useState("");
  const [permittedSearch, setPermittedSearch] = useState("");
  const [toggling, setToggling] = useState(false);
  const [updatingGravity, setUpdatingGravity] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setData(await fetchPiholeStats());
    setLoading(false);
  }, []);

  // Poll every 70s — Pi pushes every 60s so this keeps UI near-realtime
  useEffect(() => {
    load();
    const iv = setInterval(load, 70_000);
    return () => clearInterval(iv);
  }, [load]);

  const handleToggle = async () => {
    if (!data) return;
    setToggling(true);
    if (data.status === "enabled") {
      await piholeDisable();
      setData({ ...data, status: "disabled" });
      toast.success("Pi-hole disabled");
    } else {
      await piholeEnable();
      setData({ ...data, status: "enabled" });
      toast.success("Pi-hole enabled");
    }
    setToggling(false);
  };

  const handleGravity = async () => {
    setUpdatingGravity(true);
    const res = await piholeUpdateGravity();
    if (data) setData({ ...data, domainsOnBlocklist: res.domainsOnBlocklist });
    toast.success("Gravity updated successfully");
    setUpdatingGravity(false);
  };

  const filteredBlocked = data?.topBlocked.filter((d) => d.domain.toLowerCase().includes(blockedSearch.toLowerCase())) ?? [];
  const filteredPermitted = data?.topPermitted.filter((d) => d.domain.toLowerCase().includes(permittedSearch.toLowerCase())) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pi-hole"
        description="DNS-level ad blocking"
        actions={
          <div className="flex items-center gap-2">
            {data?.capturedAt && (
              <span className="text-xs text-white/30">
                Pi synced {dataAge(data.capturedAt)}
              </span>
            )}
            {data?.status === "offline" && (
              <span className="text-xs text-red-400/80 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-1">
                Offline
              </span>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleToggle} disabled={toggling || data?.status === "offline"} className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
              {data?.status === "enabled" ? "Disable" : "Enable"} Pi-hole
            </Button>
            <Button variant="outline" size="sm" onClick={handleGravity} disabled={updatingGravity || data?.status === "offline"} className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${updatingGravity ? "animate-spin" : ""}`} />
              Update Gravity
            </Button>
          </div>
        }
      />

      {data?.status === "offline" && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 text-center">
          <Shield className="h-8 w-8 text-white/20 mx-auto mb-3" />
          <p className="text-sm text-white/50">No data yet — waiting for the Pi cron script to push its first snapshot.</p>
          <p className="text-xs text-white/25 mt-1">Run <code className="text-white/40">scripts/push_pihole_stats.py</code> on the Raspberry Pi to start.</p>
        </div>
      )}

      {data && data.status !== "offline" && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Queries" value={data.totalQueries.toLocaleString()} icon={BarChart3} />
            <StatCard label="Queries Blocked" value={data.queriesBlocked.toLocaleString()} icon={Shield} />
            <StatCard label="Percent Blocked" value={`${data.percentBlocked.toFixed(1)}%`} icon={ListFilter} />
            <StatCard label="Domains on Blocklist" value={data.domainsOnBlocklist.toLocaleString()} icon={Database} />
          </div>

          {/* Chart */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
            <h3 className="text-sm font-semibold text-white mb-4">Queries — Last 24 Hours</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.hourlyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} tickLine={false} axisLine={false} interval={3} />
                  <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12, color: "#fff" }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }} />
                  <Line type="monotone" dataKey="permitted" stroke="#4ade80" strokeWidth={2} dot={false} name="Permitted" />
                  <Line type="monotone" dataKey="blocked" stroke="#f87171" strokeWidth={2} dot={false} name="Blocked" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Blocked */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Top Blocked Domains</h3>
                <ExportButton data={filteredBlocked} filename="pihole-blocked" columns={[{ key: "domain", label: "Domain" }, { key: "hits", label: "Hits" }]} />
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <Input placeholder="Search domains..." value={blockedSearch} onChange={(e) => setBlockedSearch(e.target.value)} className="pl-9 bg-white/[0.03] border-white/[0.06] text-white placeholder:text-white/30 h-9 text-sm" />
              </div>
              <div className="divide-y divide-white/[0.06]">
                {filteredBlocked.map((d) => (
                  <div key={d.domain} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-white/70 truncate">{d.domain}</span>
                    <span className="text-sm text-white/40 tabular-nums shrink-0 ml-3">{d.hits.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Permitted */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Top Permitted Domains</h3>
                <ExportButton data={filteredPermitted} filename="pihole-permitted" columns={[{ key: "domain", label: "Domain" }, { key: "hits", label: "Hits" }]} />
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <Input placeholder="Search domains..." value={permittedSearch} onChange={(e) => setPermittedSearch(e.target.value)} className="pl-9 bg-white/[0.03] border-white/[0.06] text-white placeholder:text-white/30 h-9 text-sm" />
              </div>
              <div className="divide-y divide-white/[0.06]">
                {filteredPermitted.map((d) => (
                  <div key={d.domain} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-white/70 truncate">{d.domain}</span>
                    <span className="text-sm text-white/40 tabular-nums shrink-0 ml-3">{d.hits.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
