import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";
import {
  Sparkles, AlertTriangle, CheckCircle2, Clock, Inbox, RefreshCw,
  ShieldCheck, ShieldX, Activity, Globe,
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
  const [tokenActive, setTokenActive] = useState<boolean>(true);

  const loadData = useCallback(async () => {
    const [h, s, rendered] = await Promise.all([
      supabase.from("v_cookieyeti_pipeline_health" as any).select("*").maybeSingle(),
      supabase.from("v_cookieyeti_needs_attention" as any).select("*").order("report_count", { ascending: false }).limit(50),
      supabase.from("missed_banner_reports" as any).select("id", { count: "exact", head: true }).gt("render_attempts", 0),
    ]);
    if (h.error) console.error("[CYAutoFixMonitor] health", h.error.message);
    if (s.error) console.error("[CYAutoFixMonitor] stuck", s.error.message);
    setHealth((h.data as unknown as Health) || null);
    setStuck((s.data as unknown as Stuck[]) || []);
    // Render engine is "live" once it has rendered at least one report.
    setTokenActive((rendered.count ?? 0) > 0);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useAdminRealtime({
    tables: ["cookie_patterns", "missed_banner_reports"] as any,
    onNewRecord: () => loadData(),
  });

  if (loading) {
    return (
      <div className="space-y-8 max-w-5xl">
        <div><Skeleton className="h-9 w-56" /><Skeleton className="h-4 w-80 mt-3" /></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const h = health || ({} as Health);
  const needs = h.needs_attention ?? 0;

  return (
    <div className="space-y-7 max-w-5xl">
      <PageHeader
        title="Auto-Fix Monitor"
        description="The self-healing pipeline. Green means everything is fixing itself — you only act on the list below."
        actions={
          <Button
            size="sm" variant="outline"
            className="border-white/10 bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.06]"
            onClick={() => { setRefreshing(true); loadData(); }}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      {/* Render-engine setup notice */}
      {!tokenActive && (
        <div className="flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3.5">
          <ShieldCheck className="h-5 w-5 text-sky-300 flex-none mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-sky-200">Render engine offline</p>
            <p className="text-sky-200/70 text-[12.5px] mt-0.5">
              Set <code className="px-1 rounded bg-white/10">BROWSERLESS_TOKEN</code> in Supabase &rarr; Edge Functions &rarr; Secrets to enable hands-off
              auto-fixing of JavaScript-rendered sites. Until then, render + validation are safe no-ops.
            </p>
          </div>
        </div>
      )}

      {/* Top-line status */}
      {needs === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3.5">
          <CheckCircle2 className="h-5 w-5 text-emerald-300 flex-none" />
          <div className="text-sm">
            <p className="font-medium text-emerald-200">All clear &mdash; everything's auto-fixing</p>
            <p className="text-emerald-200/70 text-[12.5px] mt-0.5">
              No domains need you. {h.in_progress ?? 0} in progress, {h.resolved_24h ?? 0} resolved in the last 24h.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3.5">
          <AlertTriangle className="h-5 w-5 text-amber-300 flex-none" />
          <div className="text-sm">
            <p className="font-medium text-amber-200">{needs} domain{needs === 1 ? "" : "s"} need a look</p>
            <p className="text-amber-200/70 text-[12.5px] mt-0.5">
              These exhausted the automatic render + AI attempts. Everything else is still self-fixing.
            </p>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Needs attention" value={needs} icon={AlertTriangle}
          iconBg={needs === 0 ? "bg-emerald-500/10" : "bg-amber-500/10"}
          iconColor={needs === 0 ? "text-emerald-300" : "text-amber-300"} />
        <StatCard label="Auto in-progress" value={h.in_progress ?? 0} icon={Clock} />
        <StatCard label="Resolved · 24h" value={h.resolved_24h ?? 0} icon={CheckCircle2}
          iconBg="bg-emerald-500/10" iconColor="text-emerald-300" />
        <StatCard label="Unresolved total" value={h.unresolved_total ?? 0} icon={Inbox} />
        <StatCard label="AI fixes · 24h" value={h.ai_success_24h ?? 0} icon={Sparkles}
          iconBg="bg-emerald-500/10" iconColor="text-emerald-300" />
        <StatCard label="AI fails · 24h" value={h.ai_fail_24h ?? 0} icon={Activity}
          iconBg={(h.ai_fail_24h ?? 0) > 0 ? "bg-red-500/10" : undefined}
          iconColor={(h.ai_fail_24h ?? 0) > 0 ? "text-red-300" : undefined} />
        <StatCard label="Validated patterns" value={h.patterns_validated ?? 0} icon={ShieldCheck}
          iconBg="bg-emerald-500/10" iconColor="text-emerald-300" />
        <StatCard label="Pulled (bad)" value={h.patterns_pulled ?? 0} icon={ShieldX}
          iconBg={(h.patterns_pulled ?? 0) > 0 ? "bg-amber-500/10" : undefined}
          iconColor={(h.patterns_pulled ?? 0) > 0 ? "text-amber-300" : undefined} />
      </div>

      {/* Needs-attention list — the only thing to act on */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <Globe className="h-4 w-4 text-white/40" />
          <h2 className="text-sm font-medium text-white">Needs attention &mdash; the only list you act on</h2>
        </div>
        {stuck.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              icon={CheckCircle2}
              title="Nothing stuck"
              description="The pipeline is handling every reported domain automatically."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-white/35">
                  <th className="text-left font-medium px-5 py-2.5">Domain</th>
                  <th className="text-left font-medium px-3 py-2.5">Reports</th>
                  <th className="text-left font-medium px-3 py-2.5">AI tries</th>
                  <th className="text-left font-medium px-3 py-2.5">Renders</th>
                  <th className="text-left font-medium px-3 py-2.5">Why</th>
                  <th className="text-left font-medium px-5 py-2.5">Last report</th>
                </tr>
              </thead>
              <tbody>
                {stuck.map((r) => (
                  <tr key={r.id} className="border-t border-white/[0.06]">
                    <td className="px-5 py-2.5 text-white/90">{r.domain}</td>
                    <td className="px-3 py-2.5 text-white/60 tabular-nums">{r.report_count ?? 0}</td>
                    <td className="px-3 py-2.5 text-white/60 tabular-nums">{r.ai_attempts ?? 0}</td>
                    <td className="px-3 py-2.5 text-white/60 tabular-nums">{r.render_attempts ?? 0}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-block text-[11px] px-2 py-0.5 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-300">
                        {REASON_LABEL[r.reason] ?? r.reason}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-white/40">{relTime(r.last_reported)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
