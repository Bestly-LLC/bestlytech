import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Cookie, Cpu, CheckCircle2, Zap, Smartphone, RefreshCw, AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { OperationsPanel } from "@/components/admin/OperationsPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SystemPulse } from "@/components/admin/SystemPulse";
import { PipelineHealthRing } from "@/components/admin/PipelineHealthRing";
import { PatternCoverageGrid } from "@/components/admin/PatternCoverageGrid";
import { DomainDeepDive, isRealAiAttempt, useCyLiveRefresh } from "@/components/admin/DomainDeepDive";

/**
 * Operations — the pipeline engine room.
 *
 * Owns: system health, pattern-engine numbers, and the manual "run it now" jobs.
 * Everything triage-related (what needs you, per-domain actions) lives on the
 * Command Center and Auto-Fix pages; subscribers and grants live on their own pages.
 */

const WINDOW_DAYS = 30;

export default function CYDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openReports, setOpenReports] = useState<number | undefined>(undefined);

  const [patternCount, setPatternCount] = useState(0);
  const [activePatternCount, setActivePatternCount] = useState(0);
  const [dismissalCount, setDismissalCount] = useState(0);
  const [fixCount, setFixCount] = useState(0);
  const [deviceCount, setDeviceCount] = useState(0);
  const [pushCount, setPushCount] = useState(0);
  const [aiStatuses, setAiStatuses] = useState<string[]>([]);
  const [domainCoverage, setDomainCoverage] = useState<any[]>([]);

  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const handleDomainClick = useCallback((domain: string) => {
    setSelectedDomain(domain);
    setDrawerOpen(true);
  }, []);

  const loadData = useCallback(async () => {
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
    const results = await Promise.all([
      supabase.from("cookie_patterns").select("id", { count: "exact", head: true }),
      supabase.from("cookie_patterns").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("dismissal_reports").select("id", { count: "exact", head: true }).gte("created_at", since),
      // Real fixes only — the maintenance job writes a '_system' heartbeat row every run.
      supabase.from("pattern_fix_log").select("id", { count: "exact", head: true }).eq("success", true).neq("domain", "_system").gte("created_at", since),
      supabase.from("device_registrations").select("id", { count: "exact", head: true }),
      supabase.from("device_tokens").select("id", { count: "exact", head: true }),
      supabase.from("ai_generation_log").select("status").gte("created_at", since).limit(5000),
      supabase.rpc("get_top_domains" as any, { p_limit: 50 }),
      supabase.from("missed_banner_reports").select("id", { count: "exact", head: true }).eq("resolved", false),
    ]);
    const [pAll, pActive, dCount, fixes, devices, push, aiLogs, topDomains, open] = results;

    const firstErr = results.find((r) => r.error)?.error;
    setError(firstErr ? firstErr.message : null);
    if (firstErr) console.error("[CY Operations]", firstErr.message);

    if (!pAll.error) setPatternCount(pAll.count ?? 0);
    if (!pActive.error) setActivePatternCount(pActive.count ?? 0);
    if (!dCount.error) setDismissalCount(dCount.count ?? 0);
    if (!fixes.error) setFixCount(fixes.count ?? 0);
    if (!devices.error) setDeviceCount(devices.count ?? 0);
    if (!push.error) setPushCount(push.count ?? 0);
    if (!aiLogs.error) setAiStatuses(((aiLogs.data as any[]) || []).map((l) => l.status || "unknown"));
    if (!topDomains.error) setDomainCoverage((topDomains.data as any[]) || []);
    if (!open.error) setOpenReports(open.count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useCyLiveRefresh(["cookie_patterns", "missed_banner_reports"], loadData, 3000);

  // Heartbeat / skip rows are bookkeeping, not attempts — counting them made the
  // success rate and donut meaningless.
  const { breakdown, attempts, successRate } = useMemo(() => {
    const real = aiStatuses.filter(isRealAiAttempt);
    const map = new Map<string, number>();
    real.forEach((s) => map.set(s, (map.get(s) || 0) + 1));
    const ok = real.filter((s) => s.startsWith("success")).length;
    return {
      breakdown: Array.from(map.entries()).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
      attempts: real.length,
      successRate: real.length ? (ok / real.length) * 100 : 0,
    };
  }, [aiStatuses]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const headerActions = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline" size="icon" aria-label="Refresh numbers"
          onClick={refresh} disabled={refreshing}
          className="h-9 w-9 border-white/10 text-white/70 hover:text-white hover:bg-white/5"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Refresh (updates live on its own)</TooltipContent>
    </Tooltip>
  );

  if (loading) {
    return (
      <div className="space-y-8 max-w-7xl" aria-busy="true">
        <div><Skeleton className="h-9 w-48" /><Skeleton className="h-4 w-80 mt-3" /></div>
        <Skeleton className="h-14 rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <PageHeader
        title="Operations"
        description="Pipeline health, the pattern engine, and running a scheduled job now when you don't want to wait."
        actions={headerActions}
      />

      <SystemPulse />

      {/* Manual runs of the scheduled jobs: one primary, the rest in its menu. */}
      <OperationsPanel onRefresh={loadData} candidateCount={openReports} />

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-300 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-red-200">Some numbers didn't load</p>
            <p className="text-red-200/75 text-xs mt-0.5 break-words">Showing the last values that loaded. {error}</p>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="h-9 border-red-500/30 text-red-100 hover:bg-red-500/10">
            Retry
          </Button>
        </div>
      )}

      <section aria-labelledby="engine-title">
        <div className="flex items-center gap-2 mb-3">
          <Cookie className="h-4 w-4 text-violet-400" aria-hidden="true" />
          <h2 id="engine-title" className="text-xs font-semibold text-white/60 uppercase tracking-widest">Pattern engine</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Active patterns" value={activePatternCount} icon={Cookie} iconBg="bg-violet-500/10" iconColor="text-violet-400" subtitle={`${patternCount.toLocaleString()} total`} />
          <StatCard label={`AI success · ${WINDOW_DAYS}d`} value={attempts ? `${successRate.toFixed(0)}%` : "—"} icon={Cpu} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" subtitle={`${attempts.toLocaleString()} real attempts`} tooltip="Excludes heartbeat and already-covered rows the generator logs when it has nothing to do." />
          <StatCard label={`Auto fixes · ${WINDOW_DAYS}d`} value={fixCount} icon={Zap} iconBg="bg-amber-500/10" iconColor="text-amber-400" subtitle="patterns repaired" />
          <StatCard label={`Dismissals · ${WINDOW_DAYS}d`} value={dismissalCount} icon={CheckCircle2} iconBg="bg-emerald-500/10" iconColor="text-emerald-400" subtitle="banners users closed" />
          <StatCard label="Devices" value={deviceCount} icon={Smartphone} subtitle={`${pushCount.toLocaleString()} with push`} />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <PipelineHealthRing data={breakdown} successRate={successRate} />
        <PatternCoverageGrid domains={domainCoverage} onDomainClick={handleDomainClick} />
      </div>

      <DomainDeepDive domain={selectedDomain} open={drawerOpen} onOpenChange={setDrawerOpen} onRefresh={loadData} />
    </div>
  );
}
