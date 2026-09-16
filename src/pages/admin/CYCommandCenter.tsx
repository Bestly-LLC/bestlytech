import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Globe, Sparkles, AlertTriangle, Inbox, Activity, ChevronRight, RefreshCw, CheckCircle2, ArrowRight, PanelRightOpen, RotateCcw,
} from "lucide-react";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { DomainDeepDive, retryRenderForDomain, runAiForDomain, useCyLiveRefresh } from "@/components/admin/DomainDeepDive";

// ── helpers ───────────────────────────────────────────────
function relTime(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "<1m";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

type FeedRow = {
  id: number;
  domain: string;
  report_count: number | null;
  resolved: boolean | null;
  resolved_at: string | null;
  has_working_pattern: boolean | null;
  ai_attempts: number | null;
  render_attempts: number | null;
  ai_processed_at: string | null;
  last_reported: string | null;
  created_at: string | null;
  autofix_outcome?: string | null;
};

type NeedsRow = {
  id: number;
  domain: string;
  report_count: number | null;
  ai_attempts: number | null;
  render_attempts: number | null;
  last_reported: string | null;
  reason: string;
  autofix_outcome: string | null;
};

type FeedState = "fixed" | "fixing" | "needs";

// "Needs you" = Auto-Fix already tried and handed it to a human (same rule as the
// pipeline-health view), so the feed, this list and the Auto-Fix page never disagree.
const HUMAN_OUTCOMES = new Set(["blocked", "no_banner_seen", "ai_failed", "ai_wrong"]);
function deriveState(r: FeedRow): FeedState {
  if (r.resolved) return "fixed";
  if (HUMAN_OUTCOMES.has(r.autofix_outcome ?? "")) return "needs";
  return "fixing";
}

const STATE_META: Record<FeedState, { label: string; dot: string; pill: string }> = {
  fixed: { label: "Fixed", dot: "bg-emerald-400", pill: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25" },
  fixing: { label: "Fixing", dot: "bg-amber-400", pill: "text-amber-300 bg-amber-500/10 border-amber-500/25" },
  needs: { label: "Needs you", dot: "bg-red-400", pill: "text-red-300 bg-red-500/10 border-red-500/25" },
};

const OUTCOME_LABEL: Record<string, string> = {
  blocked: "Blocks our robot",
  no_banner_seen: "Check for a banner",
  ai_failed: "AI needs your report",
  ai_wrong: "AI fix didn't work",
};

const REASON_LABEL: Record<string, string> = {
  render_exhausted: "Render gave up",
  ai_exhausted: "AI gave up",
  stuck: "Stuck",
};

function timeToFix(r: FeedRow): string | null {
  if (!r.resolved) return null;
  const end = r.resolved_at || r.ai_processed_at;
  if (!end || !r.created_at) return null;
  return fmtDuration(new Date(end).getTime() - new Date(r.created_at).getTime());
}

const FEED_COLUMNS =
  "id, domain, report_count, resolved, resolved_at, has_working_pattern, ai_attempts, render_attempts, ai_processed_at, last_reported, created_at, autofix_outcome";

export default function CYCommandCenter({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<any>(null);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [needs, setNeeds] = useState<NeedsRow[]>([]);

  // domain deep dive
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDomain = useCallback((domain: string) => {
    setSelectedDomain(domain);
    setDrawerOpen(true);
  }, []);

  const loadData = useCallback(async () => {
    const [ov, recent, attention] = await Promise.all([
      supabase.rpc("get_community_overview" as any),
      supabase
        .from("missed_banner_reports")
        .select(FEED_COLUMNS)
        .order("last_reported", { ascending: false, nullsFirst: false })
        .limit(20),
      supabase
        .from("v_cookieyeti_needs_attention" as any)
        .select("id, domain, report_count, ai_attempts, render_attempts, last_reported, reason, autofix_outcome")
        .order("report_count", { ascending: false })
        .limit(50),
    ]);
    const firstErr = [ov, recent, attention].find((r) => r.error)?.error;
    // Keep showing the last good data when a refresh fails.
    if (firstErr) {
      console.error("[CYCommandCenter]", firstErr.message);
      setError(firstErr.message);
    } else {
      setError(null);
    }
    if (!ov.error) setOverview(Array.isArray(ov.data) ? ov.data[0] : ov.data);
    if (!recent.error) setFeed((recent.data as unknown as FeedRow[]) || []);
    if (!attention.error) setNeeds(((attention.data as unknown as NeedsRow[]) || []).filter((r) => HUMAN_OUTCOMES.has(r.autofix_outcome ?? "")));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useCyLiveRefresh(["cookie_patterns", "missed_banner_reports"], loadData);

  const refresh = () => { setRefreshing(true); loadData(); };

  if (loading) {
    return (
      <div className="space-y-8 max-w-5xl" aria-busy="true">
        {!embedded && <div><Skeleton className="h-9 w-48" /><Skeleton className="h-4 w-72 mt-3" /></div>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const o = overview || {};
  const needsCount = needs.length;

  return (
    <div className="space-y-8 max-w-5xl">
      <PageHeader
        embedded={embedded}
        title="Cookie Yeti"
        description="What users reported, what fixed itself, and what needs you."
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh"
                onClick={refresh}
                disabled={refreshing}
                className="h-9 w-9 border-white/10 text-white/70 hover:text-white hover:bg-white/5"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh (updates live on its own)</TooltipContent>
          </Tooltip>
        }
      />

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-300 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-red-200">Some data didn't load</p>
            <p className="text-red-200/75 text-xs mt-0.5 break-words">
              {feed.length || needs.length ? "Showing the last data that loaded. " : ""}{error}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="h-9 border-red-500/30 text-red-100 hover:bg-red-500/10">
            Retry
          </Button>
        </div>
      )}

      {/* ── Hero stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Needs you" value={needsCount} icon={AlertTriangle}
          accentColor={needsCount > 0 ? "#ef4444" : "#10b981"}
          iconBg={needsCount > 0 ? "bg-red-500/10" : "bg-emerald-500/10"}
          iconColor={needsCount > 0 ? "text-red-400" : "text-emerald-400"}
          subtitle={needsCount > 0 ? "about 30 seconds each" : "all clear"} />
        <StatCard label="Domains covered" value={o.total_domains ?? 0} icon={Globe} iconBg="bg-violet-500/10" iconColor="text-violet-400" subtitle={`${(o.total_patterns ?? 0).toLocaleString()} patterns`} />
        <StatCard label="Active this week" value={o.patterns_last_7d ?? 0} icon={Sparkles} iconBg="bg-emerald-500/10" iconColor="text-emerald-400" subtitle={`${o.new_domains_last_7d ?? 0} new domains`} tooltip="Patterns seen working in the last 7 days." />
        <StatCard label="Active today" value={o.patterns_last_24h ?? 0} icon={Activity} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" subtitle="patterns, last 24h" />
      </div>

      {/* ── Needs you ── In the Command Center section the Auto-Fix tab already lists these same
          sites (same view and filter) with the steps and actions, so embedded shows one line to it. */}
      {embedded ? (
        <Link
          to="/admin/cookie-yeti?tab=autofix"
          className={`flex items-center gap-3 rounded-2xl border px-5 py-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 group ${needsCount
            ? "border-red-500/25 bg-red-500/[0.06] hover:bg-red-500/10"
            : "border-emerald-500/20 bg-emerald-500/[0.05] hover:bg-emerald-500/10"}`}
        >
          {needsCount
            ? <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />}
          <span className={`min-w-0 flex-1 font-medium ${needsCount ? "text-red-100" : "text-emerald-100"}`}>
            {needsCount
              ? `${needsCount} site${needsCount === 1 ? " needs" : "s need"} you — see Auto-Fix`
              : "Nothing needs you — see Auto-Fix"}
          </span>
          <ArrowRight className="h-4 w-4 text-white/50 group-hover:text-white/80 transition-colors shrink-0" aria-hidden="true" />
        </Link>
      ) : (
      <section aria-labelledby="needs-title" className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
          <AlertTriangle className={`h-4 w-4 ${needsCount ? "text-red-400" : "text-emerald-400"}`} aria-hidden="true" />
          <h2 id="needs-title" className="text-[0.9375rem] font-semibold text-white">Needs you</h2>
          <span className="text-xs text-white/55">automatic render and AI attempts ran out</span>
          {needsCount > 8 && (
            <Link to="/admin/cookie-yeti?tab=autofix" className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/70 hover:text-white hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
              All {needsCount} <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
        </div>
        {needsCount === 0 ? (
          <EmptyState compact icon={CheckCircle2} title="Nothing needs you" description="Every reported domain is fixed or being fixed automatically." />
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {needs.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center pr-3">
                <button
                  type="button"
                  onClick={() => navigate("/admin/cookie-yeti?tab=autofix")}
                  className="min-w-0 flex-1 flex items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.025] focus-visible:outline-none focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30 transition-colors group"
                >
                  <span className="text-sm font-medium text-white truncate flex-1 group-hover:text-cyan-300 transition-colors">{r.domain}</span>
                  <span className="hidden sm:inline text-[0.6875rem] px-2 py-0.5 rounded-full border border-amber-500/25 bg-amber-500/10 text-amber-300 shrink-0">
                    {OUTCOME_LABEL[r.autofix_outcome ?? ""] ?? "Needs a hand"}
                  </span>
                  <span className="text-xs text-white/60 tabular-nums shrink-0">{r.report_count ?? 0} reports</span>
                  <span className="hidden sm:inline text-xs text-white/55 shrink-0 w-20 text-right">{relTime(r.last_reported)}</span>
                  <ChevronRight className="h-4 w-4 text-white/30 group-hover:text-white/60 transition-colors shrink-0" aria-hidden="true" />
                </button>
                <ActionMenu
                  label={`Actions for ${r.domain}`}
                  items={[
                    { label: "Show me what to do", icon: Sparkles, onSelect: () => navigate("/admin/cookie-yeti?tab=autofix") },
                    { label: "Details and history", icon: PanelRightOpen, onSelect: () => openDomain(r.domain) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {/* ── Just in feed ── */}
      <section aria-labelledby="feed-title" className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
          </span>
          <h2 id="feed-title" className="text-[0.9375rem] font-semibold text-white">Just in</h2>
          <span className="text-xs text-white/55">live · most recently reported domains</span>
        </div>

        {feed.length === 0 ? (
          <EmptyState compact icon={Inbox} title="Nothing reported yet" description="Domains appear here as soon as users report a cookie banner Cookie Yeti missed." />
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {feed.map((r) => {
              const st = deriveState(r);
              const meta = STATE_META[st];
              const ttf = timeToFix(r);
              const count = r.report_count ?? 1;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openDomain(r.domain)}
                    className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.025] focus-visible:outline-none focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30 transition-colors group"
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate group-hover:text-cyan-300 transition-colors">{r.domain}</span>
                        <span className={`text-[0.6875rem] px-1.5 py-0.5 rounded-full border ${meta.pill} shrink-0`}>{meta.label}</span>
                      </div>
                      <p className="text-xs text-white/55 mt-0.5 truncate">
                        {count} {count === 1 ? "report" : "reports"}
                        {ttf && <span className="text-emerald-300/80"> · fixed in {ttf}</span>}
                        {st === "needs" && <span className="text-red-300/80"> · needs a hand</span>}
                        {st === "fixing" && <span className="text-amber-300/80"> · {r.ai_attempts ?? 0} AI attempts so far</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-white/55 tabular-nums">{relTime(r.last_reported || r.created_at)}</span>
                      <ChevronRight className="h-4 w-4 text-white/30 group-hover:text-white/60 transition-colors" aria-hidden="true" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <DomainDeepDive domain={selectedDomain} open={drawerOpen} onOpenChange={setDrawerOpen} onRefresh={loadData} />
    </div>
  );
}
