import { useCallback, useEffect, useState } from "react";
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
import { DomainDeepDive, useCyLiveRefresh } from "@/components/admin/DomainDeepDive";

type OpsStats = {
  ai_attempts: number;
  ai_successes: number;
  ai_breakdown: { status: string; count: number }[];
  patterns_fixed: number;
};

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
  const [aiStats, setAiStats] = useState<Pick<OpsStats, "ai_attempts" | "ai_successes" | "ai_breakdown">>({ ai_attempts: 0, ai_successes: 0, ai_breakdown: [] });
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
      // AI attempts (one per domain per day, real AI outcomes only) and distinct patterns fixed,
      // aggregated server-side: the raw log rows were capped at 1,000 and repeated every 3 hours.
      supabase.rpc("cy_operations_stats" as any, { p_days: WINDOW_DAYS }),
      supabase.from("device_registrations").select("id", { count: "exact", head: true }),
      supabase.from("device_tokens").select("id", { count: "exact", head: true }),
      supabase.rpc("get_top_domains" as any, { p_limit: 50, p_order: "reports" }),
      supabase.from("missed_banner_reports").select("id", { count: "exact", head: true }).eq("resolved", false),
    ]);
    const [pAll, pActive, dCount, ops, devices, push, topDomains, open] = results;

    const firstErr = results.find((r) => r.error)?.error;
    setError(firstErr ? firstErr.message : null);
    if (firstErr) console.error("[CY Operations]", firstErr.message);

    if (!pAll.error) setPatternCount(pAll.count ?? 0);
    if (!pActive.error) setActivePatternCount(pActive.count ?? 0);
    if (!dCount.error) setDismissalCount(dCount.count ?? 0);
    if (!ops.error && ops.data) {
      const o = ops.data as unknown as OpsStats;
      setFixCount(Number(o.patterns_fixed) || 0);
      setAiStats({ ai_attempts: Number(o.ai_attempts) || 0, ai_successes: Number(o.ai_successes) || 0, ai_breakdown: o.ai_breakdown ?? [] });
    }
    if (!devices.error) setDeviceCount(devices.count ?? 0);
    if (!push.error) setPushCount(push.count ?? 0);
    if (!topDomains.error) setDomainCoverage((topDomains.data as any[]) || []);
    if (!open.error) setOpenReports(open.count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useCyLiveRefresh(["cookie_patterns", "missed_banner_reports"], loadData, 3000);

  const breakdown = aiStats.ai_breakdown;
  const attempts = aiStats.ai_attempts;
  const successRate = attempts ? (aiStats.ai_successes / attempts) * 100 : 0;

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
          <StatCard label={`AI success · ${WINDOW_DAYS}d`} value={attempts ? `${successRate.toFixed(0)}%` : "—"} icon={Cpu} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" subtitle={`${attempts.toLocaleString()} domain-days attempted`} tooltip="Real AI generator outcomes only, counted once per domain per day. Excludes dismissal consensus, skips (including no HTML) and retry bookkeeping." />
          <StatCard label={`Auto fixes · ${WINDOW_DAYS}d`} value={fixCount} icon={Zap} iconBg="bg-amber-500/10" iconColor="text-amber-400" subtitle="distinct patterns changed" tooltip="Distinct patterns the maintenance job changed (deactivated, deleted, confidence lowered) or reports it resolved. Repeat runs on the same pattern count once." />
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
