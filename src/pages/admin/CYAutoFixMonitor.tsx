import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { ActionMenu } from "@/components/admin/ActionMenu";
import {
  DomainDeepDive, markDomainResolved, runAiForDomain, useCyLiveRefresh,
} from "@/components/admin/DomainDeepDive";
import {
  Sparkles, AlertTriangle, CheckCircle2, Clock, RefreshCw, ShieldX, Globe, CheckCheck, ExternalLink, PanelRightOpen,
} from "lucide-react";

type Health = {
  unresolved_total: number;
  in_progress: number;
  needs_attention: number;
  resolved_24h: number;
  patterns_serving: number;
  patterns_validated: number;
  patterns_pulled: number;
  ai_success_24h: number;
  ai_fail_24h: number;
};

type Stuck = {
  id: number;
  domain: string;
  report_count: number;
  ai_attempts: number;
  render_attempts: number;
  last_reported: string | null;
  reason: string;
};

const REASON_LABEL: Record<string, string> = {
  render_exhausted: "Render gave up",
  ai_exhausted: "AI gave up",
  stuck: "Stuck",
};

function relTime(iso?: string | null): string {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export default function CYAutoFixMonitor() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [stuck, setStuck] = useState<Stuck[]>([]);
  // A failed query must read as UNKNOWN, never as a healthy all-zero pipeline.
  const [healthError, setHealthError] = useState<string | null>(null);
  const [stuckError, setStuckError] = useState<string | null>(null);
  // null = probe failed (unknown); true/false = the render engine answered an authenticated ping.
  const [renderConfigured, setRenderConfigured] = useState<boolean | null>(null);

  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDomain = (domain: string) => { setSelectedDomain(domain); setDrawerOpen(true); };

  const loadData = useCallback(async () => {
    const [h, s, render] = await Promise.all([
      supabase.from("v_cookieyeti_pipeline_health" as any).select("*").maybeSingle(),
      supabase
        .from("v_cookieyeti_needs_attention" as any)
        .select("id, domain, report_count, ai_attempts, render_attempts, last_reported, reason")
        .order("report_count", { ascending: false })
        .limit(50),
      supabase.functions.invoke("cy-render-health", { method: "GET" }),
    ]);
    if (h.error) console.error("[CYAutoFixMonitor] health", h.error.message);
    if (s.error) console.error("[CYAutoFixMonitor] needs", s.error.message);
    setHealthError(h.error ? h.error.message : null);
    if (!h.error) setHealth((h.data as unknown as Health) || null);
    setStuckError(s.error ? s.error.message : null);
    if (!s.error) setStuck((s.data as unknown as Stuck[]) || []);
    if (render.error || !render.data) setRenderConfigured(null);
    else setRenderConfigured(!!((render.data as any).online ?? (render.data as any).configured));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useCyLiveRefresh(["cookie_patterns", "missed_banner_reports"], loadData);

  const refresh = () => { setRefreshing(true); loadData(); };

  if (loading) {
    return (
      <div className="space-y-8 max-w-5xl" aria-busy="true">
        <div><Skeleton className="h-9 w-56" /><Skeleton className="h-4 w-80 mt-3" /></div>
        <Skeleton className="h-16 rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const h = health || ({} as Health);
  const needs = h.needs_attention ?? stuck.length;
  const anyError = healthError || stuckError;

  return (
    <div className="space-y-7 max-w-5xl">
      <PageHeader
        title="Auto-Fix"
        description="The self-healing pipeline. It updates live; you only act on the list below."
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon" variant="outline" aria-label="Refresh"
                className="h-9 w-9 border-white/10 text-white/70 hover:text-white hover:bg-white/5"
                onClick={refresh} disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh (updates live on its own)</TooltipContent>
          </Tooltip>
        }
      />

      {/* Top-line status. A failed query is an error state, not "all clear". */}
      {anyError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3.5">
          <AlertTriangle className="h-5 w-5 text-red-300 flex-none" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-red-200">Pipeline status unavailable</p>
            <p className="text-red-200/75 text-xs mt-0.5 break-words">
              We can't confirm the pipeline is healthy. {anyError}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="h-9 border-red-500/30 text-red-100 hover:bg-red-500/10">
            Retry
          </Button>
        </div>
      ) : needs === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3.5">
          <CheckCircle2 className="h-5 w-5 text-emerald-300 flex-none" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium text-emerald-200">All clear, everything is fixing itself</p>
            <p className="text-emerald-200/75 text-xs mt-0.5">
              {h.in_progress ?? 0} in progress, {h.resolved_24h ?? 0} resolved in the last 24 hours.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3.5">
          <AlertTriangle className="h-5 w-5 text-amber-300 flex-none" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium text-amber-200">{needs} domain{needs === 1 ? "" : "s"} need a look</p>
            <p className="text-amber-200/75 text-xs mt-0.5">
              These used up their automatic render and AI attempts. Everything else is still self-fixing.
            </p>
          </div>
        </div>
      )}

      {renderConfigured === false && (
        <div className="flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3.5">
          <ShieldX className="h-5 w-5 text-sky-300 flex-none mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium text-sky-200">Render engine offline</p>
            <p className="text-sky-200/75 text-xs mt-0.5">
              The renderer at <code className="px-1 rounded bg-white/10">bestly.tech/api/cy-render</code> didn't answer, so
              JavaScript-rendered sites can't be rendered or validated right now. It retries on the next run.
            </p>
          </div>
        </div>
      )}
      {renderConfigured === null && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3.5">
          <AlertTriangle className="h-5 w-5 text-amber-300 flex-none mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium text-amber-200">Render engine status unknown</p>
            <p className="text-amber-200/75 text-xs mt-0.5">
              The render-health check didn't respond. Treat render coverage as unverified.
            </p>
          </div>
        </div>
      )}

      {/* KPIs — hidden when health is unknown so zeros aren't shown as facts. */}
      {!healthError && health && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Needs you" value={needs} icon={AlertTriangle}
            iconBg={needs === 0 ? "bg-emerald-500/10" : "bg-amber-500/10"}
            iconColor={needs === 0 ? "text-emerald-300" : "text-amber-300"}
            subtitle={`${h.unresolved_total ?? 0} open reports in total`} />
          <StatCard label="Fixing now" value={h.in_progress ?? 0} icon={Clock} subtitle="still has attempts left" />
          <StatCard label="Resolved · 24h" value={h.resolved_24h ?? 0} icon={CheckCircle2}
            iconBg="bg-emerald-500/10" iconColor="text-emerald-300"
            subtitle={`${(h.patterns_serving ?? 0).toLocaleString()} patterns serving`} />
          <StatCard label="AI fixes · 24h" value={h.ai_success_24h ?? 0} icon={Sparkles}
            iconBg="bg-emerald-500/10" iconColor="text-emerald-300"
            subtitle={`${h.ai_fail_24h ?? 0} failed · ${h.patterns_validated ?? 0} validated · ${h.patterns_pulled ?? 0} pulled`} />
        </div>
      )}

      {/* Needs-attention list — the only thing to act on */}
      <section aria-labelledby="needs-list-title" className="rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <Globe className="h-4 w-4 text-white/55" aria-hidden="true" />
          <h2 id="needs-list-title" className="text-sm font-medium text-white">Needs you</h2>
          <span className="text-xs text-white/55">open a domain for its history, or use the row menu</span>
        </div>
        {stuckError && stuck.length === 0 ? (
          <EmptyState
            compact
            icon={AlertTriangle}
            title="Couldn't load the list"
            description={stuckError}
            action={<Button size="sm" variant="outline" onClick={refresh} className="h-9">Retry</Button>}
          />
        ) : stuck.length === 0 ? (
          <EmptyState
            compact
            icon={CheckCircle2}
            title="Nothing needs you"
            description="The pipeline is handling every reported domain automatically."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.6875rem] uppercase tracking-wide text-white/55">
                  <th scope="col" className="text-left font-medium px-5 py-2.5">Domain</th>
                  <th scope="col" className="text-left font-medium px-3 py-2.5">Why</th>
                  <th scope="col" className="text-right font-medium px-3 py-2.5">Reports</th>
                  <th scope="col" className="text-right font-medium px-3 py-2.5 hidden sm:table-cell">AI / renders</th>
                  <th scope="col" className="text-left font-medium px-3 py-2.5 hidden md:table-cell">Last report</th>
                  <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {stuck.map((r) => (
                  <tr key={r.id} className="border-t border-white/[0.06] hover:bg-white/[0.02]">
                    <td className="px-5 py-2">
                      <button
                        type="button"
                        onClick={() => openDomain(r.domain)}
                        className="rounded text-left font-medium text-white/90 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      >
                        {r.domain}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-block text-[0.6875rem] px-2 py-0.5 rounded-full border border-amber-500/25 bg-amber-500/10 text-amber-300 whitespace-nowrap">
                        {REASON_LABEL[r.reason] ?? r.reason}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-white/70 tabular-nums">{r.report_count ?? 0}</td>
                    <td className="px-3 py-2 text-right text-white/60 tabular-nums hidden sm:table-cell">{r.ai_attempts ?? 0} / {r.render_attempts ?? 0}</td>
                    <td className="px-3 py-2 text-white/60 hidden md:table-cell whitespace-nowrap">{relTime(r.last_reported)}</td>
                    <td className="px-3 py-2 text-right">
                      <ActionMenu
                        label={`Actions for ${r.domain}`}
                        items={[
                          { label: "Open details", icon: PanelRightOpen, onSelect: () => openDomain(r.domain) },
                          { label: "Re-run AI", icon: Sparkles, onSelect: async () => { if (await runAiForDomain(r.domain)) loadData(); } },
                          { label: "Open site", icon: ExternalLink, onSelect: () => { window.open(`https://${r.domain}`, "_blank", "noopener,noreferrer"); } },
                          { group: "Resolve", label: "Mark resolved", icon: CheckCheck, onSelect: async () => { if (await markDomainResolved(r.domain)) loadData(); } },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DomainDeepDive domain={selectedDomain} open={drawerOpen} onOpenChange={setDrawerOpen} onRefresh={loadData} />
    </div>
  );
}
