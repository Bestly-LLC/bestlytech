import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Brain, RefreshCw, Globe, Target, TrendingUp, Shield, Clock, AlertTriangle, CircleAlert, CheckCircle2, Wrench, Flag, Play, Loader2, BarChart3, Layers, Timer, CalendarClock, Bot, ChevronDown, ChevronUp, ArrowUpDown, Sparkles, Info, Trash2, Zap, Coins, RotateCcw, MousePointerClick, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { ManualPatternForm } from "@/components/admin/ManualPatternForm";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as RechartsTooltip } from "recharts";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend, Area, AreaChart,
} from "recharts";

interface Overview {
  total_patterns: number; total_domains: number; high_confidence: number;
  low_confidence: number; avg_confidence: number; total_reports: number;
  total_successes: number; overall_success_rate: number; patterns_last_24h: number;
  patterns_last_7d: number; new_domains_last_7d: number; stale_patterns: number;
}

const ACTION_COLORS: Record<string, string> = {
  accept: "hsl(142, 76%, 36%)", reject: "hsl(0, 84%, 60%)",
  necessary: "hsl(217, 91%, 60%)", save: "hsl(45, 93%, 47%)", close: "hsl(270, 60%, 55%)",
};

const ACTION_BADGE_VARIANT: Record<string, string> = {
  accept: "bg-green-600/15 text-green-600 border-green-600/30",
  reject: "bg-red-500/15 text-red-500 border-red-500/30",
  necessary: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  save: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  close: "bg-purple-500/15 text-purple-500 border-purple-500/30",
};

const ISSUE_BADGE: Record<string, { label: string; className: string }> = {
  very_low_confidence: { label: "Very Low Confidence", className: "bg-red-500/15 text-red-500 border-red-500/30" },
  never_succeeds: { label: "Never Succeeds", className: "bg-red-500/15 text-red-500 border-red-500/30" },
  low_success_rate: { label: "Low Success Rate", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  stale: { label: "Stale 30d+", className: "bg-muted text-muted-foreground border-muted-foreground/30" },
  other: { label: "Other", className: "bg-muted text-muted-foreground border-muted-foreground/30" },
};

const CONFIDENCE_COLORS = ["hsl(0,84%,60%)", "hsl(25,95%,53%)", "hsl(45,93%,47%)", "hsl(142,60%,50%)", "hsl(250,60%,55%)"];

const AI_STATUS_BADGE: Record<string, string> = {
  success: "bg-green-600/15 text-green-600 border-green-600/30",
  success_cmp_fallback: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  success_cmp_fingerprint: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  success_gemini_failsafe: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30",
  success_probe: "bg-teal-500/15 text-teal-500 border-teal-500/30",
  success_consensus: "bg-purple-500/15 text-purple-500 border-purple-500/30",
  error: "bg-red-500/15 text-red-500 border-red-500/30",
  skipped_no_html: "bg-muted text-muted-foreground border-muted-foreground/30",
  failed_not_cookie_banner: "bg-red-500/15 text-red-500 border-red-500/30",
  needs_manual_review: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  permanently_failed: "bg-red-900/15 text-red-400 border-red-900/30",
};

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <UITooltip>
        <TooltipTrigger asChild>
          <Info className="h-3 w-3 text-muted-foreground/60 cursor-help inline-block ml-1" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-xs">{text}</TooltipContent>
      </UITooltip>
    </TooltipProvider>
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Cron jobs run at 06:00 UTC (auto-retry) and 07:00 UTC (maintenance). */
function inferRunSource(dateStr: string): "auto" | "manual" {
  const d = new Date(dateStr);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  // Within ~5 min of cron schedule → likely automated
  if ((h === 6 && m < 5) || (h === 7 && m < 5) || (h === 3 && m < 5)) return "auto";
  return "manual";
}

function nextAutoRun(): string {
  const now = new Date();
  // Next 06:00 UTC
  const next = new Date(now);
  next.setUTCHours(6, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const diff = next.getTime() - now.getTime();
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function rateColor(rate: number) {
  if (rate >= 80) return "text-green-500";
  if (rate >= 50) return "text-amber-500";
  return "text-red-500";
}

export default function CommunityLearning() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("activity");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [domains, setDomains] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [cmpDist, setCmpDist] = useState<any[]>([]);
  const [actionStats, setActionStats] = useState<any[]>([]);
  const [confDist, setConfDist] = useState<any[]>([]);
  const [sourceDist, setSourceDist] = useState<any[]>([]);
  const [fixLog, setFixLog] = useState<any[]>([]);
  const [unresolvedReports, setUnresolvedReports] = useState<any[]>([]);
  const [runningGenerator, setRunningGenerator] = useState(false);
  const [runningRetry, setRunningRetry] = useState(false);
  const [runningMaintenance, setRunningMaintenance] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [runningReset, setRunningReset] = useState(false);
  const [processingReports, setProcessingReports] = useState(false);
  const [deletingPattern, setDeletingPattern] = useState<string | null>(null);
  const [rerunningDomain, setRerunningDomain] = useState<string | null>(null);
  const [genResultsOpen, setGenResultsOpen] = useState(false);
  const [genResults, setGenResults] = useState<any | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [aiGenLog, setAiGenLog] = useState<any[]>([]);
  const [aiGeneratedCount, setAiGeneratedCount] = useState(0);
  const [aiTokenStats, setAiTokenStats] = useState({ totalPrompt: 0, totalCompletion: 0, totalRuns: 0, permFailedCount: 0 });
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [bulkRerunning, setBulkRerunning] = useState(false);
  const [candidateFilter, setCandidateFilter] = useState<"all" | "never_processed" | "failed">("all");
  const [fetchingDomain, setFetchingDomain] = useState<string | null>(null);
  const [latestReportTime, setLatestReportTime] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  // Activity graph controls
  const [activityDays, setActivityDays] = useState(30);
  const [visibleSeries, setVisibleSeries] = useState<Set<string>>(new Set(["reports", "new_patterns", "new_domains", "active_patterns"]));
  const [chartType, setChartType] = useState<"area" | "bar">("area");

  // Dismissals state
  const [dismissalReports, setDismissalReports] = useState<any[]>([]);
  const [consensusCandidates, setConsensusCandidates] = useState<any[]>([]);
  const [consensusPatternCount, setConsensusPatternCount] = useState(0);
  const [runningConsensus, setRunningConsensus] = useState(false);
  const [consensusResults, setConsensusResults] = useState<any | null>(null);
  const [selectedDismissals, setSelectedDismissals] = useState<Set<string>>(new Set());
  const [deletingDismissals, setDeletingDismissals] = useState(false);
  const [togglingPattern, setTogglingPattern] = useState<string | null>(null);

  // Domain sorting state
  type DomainSortKey = "domain" | "pattern_count" | "total_reports" | "success_rate" | "avg_confidence" | "last_active";
  const [domainSortKey, setDomainSortKey] = useState<DomainSortKey>("last_active");
  const [domainSortAsc, setDomainSortAsc] = useState(false);

  const sortedDomains = useMemo(() => {
    const sorted = [...domains].sort((a: any, b: any) => {
      let aVal = a[domainSortKey];
      let bVal = b[domainSortKey];
      if (domainSortKey === "domain") {
        aVal = (aVal || "").toLowerCase();
        bVal = (bVal || "").toLowerCase();
        return domainSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (domainSortKey === "last_active") {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      }
      aVal = Number(aVal) || 0;
      bVal = Number(bVal) || 0;
      return domainSortAsc ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [domains, domainSortKey, domainSortAsc]);

  const handleDomainSort = (key: DomainSortKey) => {
    if (domainSortKey === key) {
      setDomainSortAsc(!domainSortAsc);
    } else {
      setDomainSortKey(key);
      setDomainSortAsc(key === "domain"); // A-Z default for domain, desc for numbers
    }
  };

  const SortIcon = ({ sortKey }: { sortKey: DomainSortKey }) => {
    if (domainSortKey !== sortKey) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return domainSortAsc ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />;
  };

  const fetchAll = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17, r18, r19] = await Promise.all([
        supabase.rpc("get_community_overview" as any),
        supabase.rpc("get_daily_pattern_activity" as any, { p_days: activityDays }),
        supabase.rpc("get_top_domains" as any, { p_limit: 30 }),
        supabase.rpc("get_recently_learned" as any, { p_limit: 25 }),
        supabase.rpc("get_pattern_issues" as any, { p_limit: 25 }),
        supabase.rpc("get_cmp_distribution" as any),
        supabase.rpc("get_action_type_stats" as any),
        supabase.rpc("get_confidence_distribution" as any),
        supabase.rpc("get_source_breakdown" as any),
        supabase.from("pattern_fix_log").select("*").order("created_at", { ascending: false }).limit(25),
        supabase.rpc("get_unresolved_reports" as any, { p_limit: 50 }),
        supabase.from("missed_banner_reports").select("*").eq("resolved", false).order("report_count", { ascending: false }).limit(50),
        supabase.from("ai_generation_log").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("cookie_patterns").select("id", { count: "exact", head: true }).eq("source", "ai_generated"),
        // AI token usage stats
        supabase.from("ai_generation_log").select("prompt_tokens, completion_tokens, status"),
        // Dismissal reports
        supabase.from("dismissal_reports").select("*").order("created_at", { ascending: false }).limit(200),
        // Consensus candidates via RPC
        supabase.rpc("find_dismissal_consensus" as any),
        // Consensus pattern count
        supabase.from("cookie_patterns").select("id", { count: "exact", head: true }).eq("source", "user_consensus"),
        // Latest report timestamp (for heartbeat — includes resolved reports)
        supabase.from("missed_banner_reports").select("last_reported").order("last_reported", { ascending: false }).limit(1),
      ]);
      setOverview(r1.data as any);
      setActivity(r2.data as any ?? []);
      setDomains(r3.data as any ?? []);
      setRecent(r4.data as any ?? []);
      setIssues(r5.data as any ?? []);
      setCmpDist(r6.data as any ?? []);
      setActionStats(r7.data as any ?? []);
      setConfDist(r8.data as any ?? []);
      setSourceDist(r9.data as any ?? []);
      setFixLog(r10.data as any ?? []);
      setUnresolvedReports(r11.data as any ?? []);
      setCandidates(r12.data as any ?? []);
      setAiGenLog(r13.data as any ?? []);
      setAiGeneratedCount(r14.count ?? 0);

      // Calculate token stats
      const allLogs = r15.data as any[] ?? [];
      const totalPrompt = allLogs.reduce((s: number, l: any) => s + (l.prompt_tokens || 0), 0);
      const totalCompletion = allLogs.reduce((s: number, l: any) => s + (l.completion_tokens || 0), 0);
      const permFailedCount = allLogs.filter((l: any) => l.status === "permanently_failed").length;
      setAiTokenStats({ totalPrompt, totalCompletion, totalRuns: allLogs.length, permFailedCount });

      // Dismissal data
      setDismissalReports(r16.data as any[] ?? []);
      setConsensusCandidates(r17.data as any[] ?? []);
      setConsensusPatternCount(r18.count ?? 0);
      setLatestReportTime(r19.data?.[0]?.last_reported ?? null);
    } catch (e) {
      console.error("Failed to fetch community data", e);
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [activityDays]);

  // Refetch activity when days change
  useEffect(() => {
    if (!hasLoadedRef.current) return; // skip on initial load (fetchAll handles it)
    (async () => {
      const { data } = await supabase.rpc("get_daily_pattern_activity" as any, { p_days: activityDays });
      setActivity(data as any ?? []);
    })();
  }, [activityDays]);

  const toggleSeries = (key: string) => {
    setVisibleSeries(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); } else next.add(key);
      return next;
    });
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  }, [fetchAll]);

  const handleRunGenerator = useCallback(async () => {
    setRunningGenerator(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-generate-pattern`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`AI Generator complete — Generated: ${data.generated ?? 0}, Skipped: ${data.skipped ?? 0}, Failed: ${data.failed ?? 0}`);
      setGenResults(data);
      setGenResultsOpen(true);
      await fetchAll();
    } catch (e: any) {
      toast.error(`AI Generator failed: ${e.message}`);
    } finally {
      setRunningGenerator(false);
    }
  }, [fetchAll]);

  const handleRunRetry = useCallback(async () => {
    setRunningRetry(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-retry-failed-patterns`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ triggered_by: "admin" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Auto-retry complete — Processed: ${data.processed ?? 0}, Succeeded: ${data.succeeded ?? 0}, Failed: ${data.still_failed ?? 0}`);
      await fetchAll();
    } catch (e: any) {
      toast.error(`Auto-retry failed: ${e.message}`);
    } finally {
      setRunningRetry(false);
    }
  }, [fetchAll]);

  const handleRunMaintenance = useCallback(async () => {
    setRunningMaintenance(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-pattern-maintenance`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Maintenance complete — Fixed: ${data.fix?.fixed ?? 0}, Failed: ${data.fix?.failed ?? 0}, Reports resolved: ${data.reports?.newly_resolved ?? 0}`);
      await fetchAll();
    } catch (e: any) {
      toast.error(`Maintenance failed: ${e.message}`);
    } finally {
      setRunningMaintenance(false);
    }
  }, [fetchAll]);

  const handleResetFailed = useCallback(async () => {
    setRunningReset(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-failed-patterns`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Reset complete — ${data.reset_count ?? 0} domains re-queued for evaluation`);
      await fetchAll();
    } catch (e: any) {
      toast.error(`Reset failed: ${e.message}`);
    } finally {
      setRunningReset(false);
    }
  }, [fetchAll]);

  const handleProcessReports = useCallback(async () => {
    setProcessingReports(true);
    try {
      const { data, error } = await supabase.rpc("process_user_reports" as any);
      if (error) throw error;
      const d = data as any;
      toast.success(`Reports processed — Resolved: ${d.newly_resolved ?? 0}, Unresolved: ${d.total_unresolved ?? 0}`);
      fetchAll();
    } catch (e: any) {
      toast.error(`Processing failed: ${e.message}`);
    } finally {
      setProcessingReports(false);
    }
  }, [fetchAll]);

  const handleRerunAI = useCallback(async (domain: string) => {
    setRerunningDomain(domain);
    try {
      await supabase.from("ai_generation_log").delete().eq("domain", domain).in("status", ["skipped_no_html", "error"]);
      await supabase.from("missed_banner_reports").update({ ai_attempts: 0, ai_processed_at: null }).eq("domain", domain);

      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-generate-pattern`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const result = data.results?.[0];
      if (result?.status === "success") {
        toast.success(`AI generated pattern for ${domain}: ${result.selector}`);
      } else if (result?.status === "skipped_no_html") {
        toast.warning(`${domain}: No HTML available for AI analysis`);
      } else {
        toast.error(`${domain}: ${result?.error || "Unknown error"}`);
      }
      await fetchAll();
    } catch (e: any) {
      toast.error(`Re-run failed: ${e.message}`);
    } finally {
      setRerunningDomain(null);
    }
  }, [fetchAll]);

  const handleBulkRerunAI = useCallback(async () => {
    if (selectedCandidates.size === 0) return;
    setBulkRerunning(true);
    const domains = Array.from(selectedCandidates);
    let succeeded = 0;
    let failed = 0;
    for (const domain of domains) {
      try {
        await supabase.from("ai_generation_log").delete().eq("domain", domain).in("status", ["skipped_no_html", "error"]);
        await supabase.from("missed_banner_reports").update({ ai_attempts: 0, ai_processed_at: null }).eq("domain", domain);

        const { data: { session } } = await supabase.auth.getSession();
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-generate-pattern`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ domain }),
        });
        if (res.ok) succeeded++; else failed++;
      } catch {
        failed++;
      }
    }
    toast.success(`Bulk re-run complete: ${succeeded} succeeded, ${failed} failed`);
    setSelectedCandidates(new Set());
    await fetchAll();
    setBulkRerunning(false);
  }, [selectedCandidates, fetchAll]);

  const handleDeletePattern = useCallback(async (domain: string, selector: string, actionType: string) => {
    const key = `${domain}::${selector}`;
    setDeletingPattern(key);
    try {
      const { error } = await supabase
        .from("cookie_patterns")
        .delete()
        .eq("domain", domain)
        .eq("selector", selector)
        .eq("action_type", actionType);
      if (error) throw error;
      toast.success(`Deleted pattern for ${domain}`);
      await fetchAll();
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`);
    } finally {
      setDeletingPattern(null);
    }
  }, [fetchAll]);

  // Handler: Fetch & Process (calls report-missed-banner for server-side fetch)
  const handleFetchAndProcess = useCallback(async (domain: string, pageUrl?: string) => {
    setFetchingDomain(domain);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/report-missed-banner`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ domain, page_url: pageUrl || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (data.ai_processing?.results?.[0]?.status?.startsWith("success")) {
        toast.success(`Pattern generated for ${domain}!`);
      } else {
        toast.info(`Fetch & process triggered for ${domain}. AI result: ${data.ai_processing?.results?.[0]?.status || "pending"}`);
      }
      await fetchAll();
    } catch (e: any) {
      toast.error(`Fetch & Process failed: ${e.message}`);
    } finally {
      setFetchingDomain(null);
    }
  }, [fetchAll]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleRunConsensus = useCallback(async () => {
    setRunningConsensus(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-dismissal-consensus`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Consensus complete — Created: ${data.created ?? 0} patterns from ${data.processed ?? 0} candidates`);
      setConsensusResults(data);
      await fetchAll();
    } catch (e: any) {
      toast.error(`Consensus failed: ${e.message}`);
    } finally {
      setRunningConsensus(false);
    }
  }, [fetchAll]);

  const handleTogglePatternActive = useCallback(async (patternId: string, currentActive: boolean) => {
    setTogglingPattern(patternId);
    try {
      const { error } = await supabase
        .from("cookie_patterns")
        .update({ is_active: !currentActive } as any)
        .eq("id", patternId);
      if (error) throw error;
      toast.success(`Pattern ${!currentActive ? "activated" : "deactivated"}`);
      setRecent(prev => prev.map((r: any) => r.id === patternId ? { ...r, is_active: !currentActive } : r));
    } catch (e: any) {
      toast.error(`Toggle failed: ${e.message}`);
    } finally {
      setTogglingPattern(null);
    }
  }, []);

  const handleDeleteDismissals = useCallback(async () => {
    if (selectedDismissals.size === 0) return;
    setDeletingDismissals(true);
    try {
      for (const id of selectedDismissals) {
        await supabase.from("dismissal_reports").delete().eq("id", id);
      }
      toast.success(`Deleted ${selectedDismissals.size} dismissal report(s)`);
      setSelectedDismissals(new Set());
      await fetchAll();
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`);
    } finally {
      setDeletingDismissals(false);
    }
  }, [selectedDismissals, fetchAll]);

  const dismissalsByDomain = useMemo(() => {
    const map = new Map<string, { count: number; reports: any[] }>();
    for (const r of dismissalReports) {
      const existing = map.get(r.domain) ?? { count: 0, reports: [] };
      existing.count++;
      existing.reports.push(r);
      map.set(r.domain, existing);
    }
    return map;
  }, [dismissalReports]);

  // Build lookup sets for AI fixer cross-referencing
  const fixedPatterns = useMemo(() => new Set(fixLog.map((f: any) => `${f.domain}::${f.selector}`)), [fixLog]);
  const fixedDomains = useMemo(() => new Set(fixLog.map((f: any) => f.domain)), [fixLog]);
  const fixActionMap = useMemo(() => {
    const map = new Map<string, { action: string; success: boolean }>();
    for (const f of fixLog) {
      const key = `${f.domain}::${f.selector}`;
      if (!map.has(key)) map.set(key, { action: f.action_taken, success: f.success });
    }
    return map;
  }, [fixLog]);

  // Build set of domains that have AI log entries for filter
  const aiLoggedDomains = useMemo(() => new Set(aiGenLog.map((l: any) => l.domain)), [aiGenLog]);

  // No-HTML reports for Manual Review tab
  const noHtmlReports = useMemo(() => candidates.filter((c: any) => !c.banner_html || c.banner_html.trim().length === 0), [candidates]);

  // Skipped domains from AI log (deduplicated by domain, latest per domain)
  const skippedDomains = useMemo(() => {
    const map = new Map<string, any>();
    for (const log of aiGenLog) {
      if (log.status === "skipped_no_html" && !map.has(log.domain)) {
        map.set(log.domain, log);
      }
    }
    return Array.from(map.values());
  }, [aiGenLog]);

  // Filter candidates based on selected filter
  const filteredCandidates = useMemo(() => {
    if (candidateFilter === "all") return candidates;
    if (candidateFilter === "never_processed") return candidates.filter((c: any) => c.ai_attempts === 0 && !aiLoggedDomains.has(c.domain));
    if (candidateFilter === "failed") return candidates.filter((c: any) => c.ai_attempts > 0 || aiLoggedDomains.has(c.domain));
    return candidates;
  }, [candidates, candidateFilter, aiLoggedDomains]);

  const toggleCandidateSelection = (domain: string) => {
    setSelectedCandidates(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain); else next.add(domain);
      return next;
    });
  };

  const toggleAllCandidates = () => {
    if (selectedCandidates.size === filteredCandidates.length) {
      setSelectedCandidates(new Set());
    } else {
      setSelectedCandidates(new Set(filteredCandidates.map((c: any) => c.domain)));
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-80 mt-2" /></div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const o = overview!;
  const issueCount = issues.length;

  const FIX_ACTION_BADGE: Record<string, string> = {
    deleted_stale: "bg-red-500/15 text-red-500 border-red-500/30",
    deleted_broken: "bg-red-500/15 text-red-500 border-red-500/30",
    confidence_zeroed: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    confidence_halved: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    skipped: "bg-muted text-muted-foreground border-muted-foreground/30",
  };

  const AiFixerIndicator = ({ domain, selector }: { domain: string; selector: string }) => {
    const key = `${domain}::${selector}`;
    const fix = fixActionMap.get(key);
    if (!fix) return null;
    return (
      <TooltipProvider delayDuration={200}>
        <UITooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 ml-1.5">
              <Bot className="h-3.5 w-3.5 text-purple-500" />
              <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${FIX_ACTION_BADGE[fix.action] ?? "bg-purple-500/15 text-purple-500 border-purple-500/30"}`}>
                {fix.action.replace(/_/g, " ")}
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">AI Fixer: <span className="font-semibold">{fix.action.replace(/_/g, " ")}</span> — {fix.success ? "Success" : "Failed"}</p>
          </TooltipContent>
        </UITooltip>
      </TooltipProvider>
    );
  };

  const DomainAiBadge = ({ domain }: { domain: string }) => {
    if (!fixedDomains.has(domain)) return null;
    return (
      <TooltipProvider delayDuration={200}>
        <UITooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex ml-1.5">
              <Bot className="h-3.5 w-3.5 text-purple-500" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">AI Fixer has actioned patterns on this domain</p>
          </TooltipContent>
        </UITooltip>
      </TooltipProvider>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Community Learning"
        actions={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <ManualPatternForm onSuccess={fetchAll} />
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-2">
              <RefreshCw className={`h-4 w-4 transition-transform ${refreshing ? "animate-spin" : ""}`} /> {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        }
      />

      {/* Permanently Failed Alert */}
      {aiTokenStats.permFailedCount > 0 && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-3 py-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-500">
                {aiTokenStats.permFailedCount} domain{aiTokenStats.permFailedCount > 1 ? "s" : ""} permanently failed
              </p>
              <p className="text-xs text-muted-foreground">These domains exhausted all retry attempts. Consider adding patterns manually.</p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <TooltipProvider delayDuration={300}>
                <UITooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="flex-1 sm:flex-initial shrink-0 gap-1.5 border-amber-500/30 text-amber-500 hover:bg-amber-500/10" onClick={handleResetFailed} disabled={runningReset}>
                      {runningReset ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Resetting...</> : <><RotateCcw className="h-3.5 w-3.5" /> Reset Failed</>}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[240px] text-center">Re-queues permanently failed domains for fresh AI analysis (older than 30 days)</TooltipContent>
                </UITooltip>
              </TooltipProvider>
              <Button variant="outline" size="sm" className="flex-1 sm:flex-initial shrink-0 gap-1.5 border-red-500/30 text-red-500 hover:bg-red-500/10" onClick={() => setActiveTab("ai-generator")}>
                <Flag className="h-3.5 w-3.5" /> View
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Heartbeat Monitor */}
      {(() => {
        const now = Date.now();
        const heartbeats = [
          {
            label: "AI Generator",
            icon: Sparkles,
            lastRun: aiGenLog.find((l: any) => l.status?.startsWith("success"))?.created_at,
            thresholds: [24, 72], // hours: green < 24h, yellow < 72h, red > 72h
          },
          {
            label: "Report Ingestion",
            icon: Flag,
            lastRun: candidates.length > 0 ? candidates.reduce((latest: any, c: any) => (!latest || new Date(c.last_reported) > new Date(latest) ? c.last_reported : latest), null) : null,
            thresholds: [24, 72],
          },
          {
            label: "Pattern Learning",
            icon: Brain,
            lastRun: recent.length > 0 ? recent[0]?.created_at : null,
            thresholds: [48, 168], // patterns can take longer
          },
          {
            label: "Cron Jobs",
            icon: CalendarClock,
            lastRun: fixLog.length > 0 ? fixLog[0]?.created_at : null,
            thresholds: [26, 50], // should run daily, 26h allows for drift
          },
        ];

        return (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5 px-4">
            <span className="text-xs font-medium text-muted-foreground mr-1">System Status</span>
            {heartbeats.map((hb) => {
              const hoursAgo = hb.lastRun ? (now - new Date(hb.lastRun).getTime()) / 3600000 : Infinity;
              const status = hoursAgo <= hb.thresholds[0] ? "green" : hoursAgo <= hb.thresholds[1] ? "yellow" : "red";
              const statusColor = status === "green" ? "bg-green-500" : status === "yellow" ? "bg-amber-500" : "bg-red-500";
              const textColor = status === "green" ? "text-green-500" : status === "yellow" ? "text-amber-500" : "text-red-500";
              const Icon = hb.icon;
              return (
                <TooltipProvider key={hb.label} delayDuration={150}>
                  <UITooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-muted/30 cursor-default">
                        <span className="relative flex h-2 w-2">
                          {status === "green" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />}
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${statusColor}`} />
                        </span>
                        <Icon className={`h-3 w-3 ${textColor}`} />
                        <span className="text-[11px] font-medium text-foreground hidden sm:inline">{hb.label}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs max-w-[220px]">
                      <p className="font-medium">{hb.label}</p>
                      <p className="text-muted-foreground">
                        {hb.lastRun ? `Last: ${timeAgo(hb.lastRun)}` : "No activity recorded"}
                      </p>
                    </TooltipContent>
                  </UITooltip>
                </TooltipProvider>
              );
            })}
          </div>
        );
      })()}

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Patterns" value={o.total_patterns} icon={Layers} iconColor="text-primary" iconBg="bg-primary/10" accentColor="border-primary/40" subtitle={`${o.patterns_last_7d} active last 7 days`} tooltip="Cookie banner CSS selectors learned by the community network" />
        <StatCard label="Domains Covered" value={o.total_domains} icon={Globe} iconColor="text-green-500" iconBg="bg-green-500/10" accentColor="border-green-500/40" subtitle={`${o.new_domains_last_7d} new this week`} tooltip="Unique websites where Cookie Yeti has learned patterns" />
        <StatCard label="Success Rate" value={`${o.overall_success_rate}%`} icon={Target} iconColor="text-blue-500" iconBg="bg-blue-500/10" accentColor="border-blue-500/40" subtitle={`${Number(o.total_successes).toLocaleString()} / ${Number(o.total_reports).toLocaleString()}`} tooltip="Percentage of pattern matches that successfully dismissed a banner. Calculated from success_count / report_count across all patterns" />
        <StatCard label="Avg Confidence" value={o.avg_confidence != null ? `${Math.round(o.avg_confidence * 10)}%` : "—"} icon={TrendingUp} iconColor="text-purple-500" iconBg="bg-purple-500/10" accentColor="border-purple-500/40" subtitle={`${o.high_confidence} high / ${o.low_confidence} low`} tooltip="Mean confidence score across all active patterns. Higher = more reliable. Based on success rate and report volume" />
        <StatCard label="AI Generated" value={aiGeneratedCount} icon={Sparkles} iconColor="text-amber-500" iconBg="bg-amber-500/10" accentColor="border-amber-500/40" subtitle="Patterns from AI" tooltip="Patterns created by AI analysis of reported banner HTML" />
      </div>

      {/* Health Indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="border-t-2 border-green-500/40">
          <CardContent className="flex items-center gap-3 py-3 px-3 sm:py-4 sm:px-6">
            <div className="relative shrink-0">
              <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2 sm:h-2.5 sm:w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 sm:h-2.5 sm:w-2.5 bg-green-500"></span>
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums">{o.patterns_last_24h}</p>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">Active 24h<span className="hidden sm:inline"><InfoTip text="Patterns that matched a banner in the last 24 hours" /></span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-amber-500/40">
          <CardContent className="flex items-center gap-3 py-3 px-3 sm:py-4 sm:px-6">
            <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums">{o.stale_patterns}</p>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">Stale 30d+<span className="hidden sm:inline"><InfoTip text="Patterns not seen in 30+ days — may be outdated" /></span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-red-500/40">
          <CardContent className="flex items-center gap-3 py-3 px-3 sm:py-4 sm:px-6">
            <CircleAlert className="h-4 w-4 sm:h-5 sm:w-5 text-red-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums">{issueCount}</p>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">Issues<span className="hidden sm:inline"><InfoTip text="Patterns with very low confidence, zero successes, or other problems" /></span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-primary/40">
          <CardContent className="flex items-center gap-3 py-3 px-3 sm:py-4 sm:px-6">
            <Coins className="h-4 w-4 sm:h-5 sm:w-5 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums">{(aiTokenStats.totalPrompt + aiTokenStats.totalCompletion).toLocaleString()}</p>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">AI Tokens<span className="hidden sm:inline"><InfoTip text={`${aiTokenStats.totalRuns} AI runs total. Prompt: ${aiTokenStats.totalPrompt.toLocaleString()}, Completion: ${aiTokenStats.totalCompletion.toLocaleString()}`} /></span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-purple-500/40">
          <CardContent className="flex items-center gap-3 py-3 px-3 sm:py-4 sm:px-6">
            <MousePointerClick className="h-4 w-4 sm:h-5 sm:w-5 text-purple-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums">{dismissalReports.length}</p>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">Dismissals<span className="hidden sm:inline"><InfoTip text="User-reported banner dismissals awaiting consensus processing" /></span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-teal-500/40">
          <CardContent className="flex items-center gap-3 py-3 px-3 sm:py-4 sm:px-6">
            <Users className="h-4 w-4 sm:h-5 sm:w-5 text-teal-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums">{consensusPatternCount}</p>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">Consensus<span className="hidden sm:inline"><InfoTip text="Patterns created from user dismissal consensus" /></span></p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="overflow-x-auto -mx-1 px-1 scrollbar-hide">
          <TabsList className="inline-flex h-10 items-center justify-start rounded-lg bg-muted p-1 text-muted-foreground w-max">
            <TabsTrigger value="activity" className="gap-1 sm:gap-1.5 rounded-md px-2 sm:px-3 text-xs sm:text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><TrendingUp className="h-3.5 w-3.5 hidden sm:block" />Activity</TabsTrigger>
            <TabsTrigger value="domains" className="gap-1 sm:gap-1.5 rounded-md px-2 sm:px-3 text-xs sm:text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Globe className="h-3.5 w-3.5 hidden sm:block" />Domains</TabsTrigger>
            <TabsTrigger value="recent" className="gap-1 sm:gap-1.5 rounded-md px-2 sm:px-3 text-xs sm:text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Brain className="h-3.5 w-3.5 hidden sm:block" />Recent</TabsTrigger>
            <TabsTrigger value="ai-generator" className="gap-1 sm:gap-1.5 rounded-md px-2 sm:px-3 text-xs sm:text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Sparkles className="h-3.5 w-3.5 hidden sm:block" />AI Gen</TabsTrigger>
            <TabsTrigger value="breakdown" className="gap-1 sm:gap-1.5 rounded-md px-2 sm:px-3 text-xs sm:text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><BarChart3 className="h-3.5 w-3.5 hidden sm:block" />Breakdown</TabsTrigger>
            <TabsTrigger value="dismissals" className="gap-1 sm:gap-1.5 rounded-md px-2 sm:px-3 text-xs sm:text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><MousePointerClick className="h-3.5 w-3.5 hidden sm:block" />Dismissals{dismissalReports.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{dismissalReports.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="manual-review" className="gap-1 sm:gap-1.5 rounded-md px-2 sm:px-3 text-xs sm:text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><AlertTriangle className="h-3.5 w-3.5 hidden sm:block" />Review{noHtmlReports.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{noHtmlReports.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="user-reports" className="gap-1 sm:gap-1.5 rounded-md px-2 sm:px-3 text-xs sm:text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Flag className="h-3.5 w-3.5 hidden sm:block" />Reports</TabsTrigger>
          </TabsList>
        </div>

        {/* Activity Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-3">
                <CardTitle className="text-lg">Pattern Activity</CardTitle>
                {/* Time range & chart type controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
                    {([7, 14, 30, 90] as const).map(d => (
                      <button
                        key={d}
                        onClick={() => setActivityDays(d)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${activityDays === d ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5 ml-auto">
                    <button
                      onClick={() => setChartType("area")}
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${chartType === "area" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Area
                    </button>
                    <button
                      onClick={() => setChartType("bar")}
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${chartType === "bar" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Bar
                    </button>
                  </div>
                </div>
                {/* Series toggle chips */}
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { key: "reports", label: "Reports", color: "hsl(200,80%,50%)" },
                    { key: "new_patterns", label: "New Patterns", color: "hsl(270,60%,55%)" },
                    { key: "new_domains", label: "New Domains", color: "hsl(142,76%,36%)" },
                    { key: "active_patterns", label: "Active Patterns", color: "hsl(45,93%,47%)" },
                  ] as const).map(s => {
                    const active = visibleSeries.has(s.key);
                    return (
                      <button
                        key={s.key}
                        onClick={() => toggleSeries(s.key)}
                         className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${active ? "text-foreground" : "border-border text-muted-foreground opacity-50"}`}
                         style={active ? { borderColor: s.color, backgroundColor: s.color + "20" } : undefined}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: active ? s.color : "currentColor" }} />
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[280px] sm:h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === "area" ? (
                    <AreaChart data={activity}>
                      <defs>
                        <linearGradient id="gradNew" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(270,60%,55%)" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="hsl(270,60%,55%)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradDomains" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(142,76%,36%)" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="hsl(142,76%,36%)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradReports" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(200,80%,50%)" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="hsl(200,80%,50%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      {visibleSeries.has("reports") && <Area type="monotone" dataKey="reports" stroke="hsl(200,80%,50%)" strokeWidth={2} fill="url(#gradReports)" name="Reports" />}
                      {visibleSeries.has("new_patterns") && <Area type="monotone" dataKey="new_patterns" stroke="hsl(270,60%,55%)" strokeWidth={2} fill="url(#gradNew)" name="New Patterns" />}
                      {visibleSeries.has("new_domains") && <Area type="monotone" dataKey="new_domains" stroke="hsl(142,76%,36%)" strokeWidth={2} fill="url(#gradDomains)" name="New Domains" />}
                      {visibleSeries.has("active_patterns") && <Line type="monotone" dataKey="active_patterns" stroke="hsl(45,93%,47%)" strokeWidth={2} strokeDasharray="5 5" name="Active Patterns" dot={false} />}
                      <Legend />
                    </AreaChart>
                  ) : (
                    <BarChart data={activity}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      {visibleSeries.has("reports") && <Bar dataKey="reports" fill="hsl(200,80%,50%)" name="Reports" radius={[2, 2, 0, 0]} />}
                      {visibleSeries.has("new_patterns") && <Bar dataKey="new_patterns" fill="hsl(270,60%,55%)" name="New Patterns" radius={[2, 2, 0, 0]} />}
                      {visibleSeries.has("new_domains") && <Bar dataKey="new_domains" fill="hsl(142,76%,36%)" name="New Domains" radius={[2, 2, 0, 0]} />}
                      {visibleSeries.has("active_patterns") && <Bar dataKey="active_patterns" fill="hsl(45,93%,47%)" name="Active Patterns" radius={[2, 2, 0, 0]} />}
                      <Legend />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Domains Tab */}
        <TabsContent value="domains">
          <Card>
            <CardHeader><CardTitle className="text-lg">Top Domains</CardTitle></CardHeader>
            <CardContent>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {sortedDomains.map((d: any, i: number) => {
                  const isFixed = fixedDomains.has(d.domain);
                  return (
                    <div key={i} className={`border rounded-lg p-3 space-y-2 ${isFixed ? "border-l-2 border-l-purple-500/50" : ""}`}>
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm truncate">{d.domain}</span>
                        <DomainAiBadge domain={d.domain} />
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-muted-foreground">Patterns</span><span className="tabular-nums font-medium">{d.pattern_count}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Reports</span><span className="tabular-nums font-medium">{Number(d.total_reports).toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Success</span><span className={`tabular-nums font-medium ${rateColor(d.success_rate)}`}>{d.success_rate}%</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Confidence</span><span className="tabular-nums">{Math.round(d.avg_confidence * 10)}%</span></div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Last active: {d.last_active ? timeAgo(d.last_active) : "—"}</p>
                    </div>
                  );
                })}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleDomainSort("domain")}>
                        <span className="inline-flex items-center">Domain<SortIcon sortKey="domain" /></span>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleDomainSort("pattern_count")}>
                        <span className="inline-flex items-center justify-end">Patterns<InfoTip text="Number of CSS selectors learned for this domain" /><SortIcon sortKey="pattern_count" /></span>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleDomainSort("total_reports")}>
                        <span className="inline-flex items-center justify-end">Reports<InfoTip text="Times users encountered banners on this domain" /><SortIcon sortKey="total_reports" /></span>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleDomainSort("success_rate")}>
                        <span className="inline-flex items-center justify-end">Success Rate<InfoTip text="How often patterns successfully dismiss banners here" /><SortIcon sortKey="success_rate" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleDomainSort("avg_confidence")}>
                        <span className="inline-flex items-center">Confidence<InfoTip text="Reliability score 1-100%, based on success rate and volume" /><SortIcon sortKey="avg_confidence" /></span>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleDomainSort("last_active")}>
                        <span className="inline-flex items-center justify-end">Last Active<InfoTip text="When a pattern last matched a banner on this domain" /><SortIcon sortKey="last_active" /></span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedDomains.map((d: any, i: number) => {
                      const isFixed = fixedDomains.has(d.domain);
                      return (
                      <TableRow key={i} className={`even:bg-muted/30 ${isFixed ? "border-l-2 border-l-purple-500/50" : ""}`}>
                        <TableCell className="font-medium flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-muted-foreground" />{d.domain}<DomainAiBadge domain={d.domain} /></TableCell>
                        <TableCell className="text-right tabular-nums">{d.pattern_count}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(d.total_reports).toLocaleString()}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${rateColor(d.success_rate)}`}>{d.success_rate}%</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={d.avg_confidence * 10} className="h-2 w-16" />
                            <span className="text-xs text-muted-foreground tabular-nums">{Math.round(d.avg_confidence * 10)}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{d.last_active ? timeAgo(d.last_active) : "—"}</TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recent Tab */}
        <TabsContent value="recent">
          <Card>
            <CardHeader><CardTitle className="text-lg">Recently Learned Patterns</CardTitle></CardHeader>
            <CardContent>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {recent.map((r: any, i: number) => {
                  const isFixed = fixedPatterns.has(`${r.domain}::${r.selector}`);
                  const isInactive = r.is_active === false;
                  return (
                    <div key={i} className={`border rounded-lg p-3 space-y-2 ${isFixed ? "border-l-2 border-l-purple-500/50" : ""} ${isInactive ? "opacity-50" : ""}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm truncate flex-1">{r.domain}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <Switch
                            checked={r.is_active !== false}
                            disabled={togglingPattern === r.id}
                            onCheckedChange={() => handleTogglePatternActive(r.id, r.is_active !== false)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-red-500"
                            disabled={deletingPattern === `${r.domain}::${r.selector}`}
                            onClick={() => handleDeletePattern(r.domain, r.selector, r.action_type)}
                          >
                            {deletingPattern === `${r.domain}::${r.selector}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </div>
                      <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded block truncate">{r.selector}</code>
                      <div className="flex items-center flex-wrap gap-1.5">
                        <Badge variant="outline" className={ACTION_BADGE_VARIANT[r.action_type] ?? ""}>{r.action_type}</Badge>
                        {r.strategy && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-cyan-500/15 text-cyan-500 border-cyan-500/30">⚡ {r.strategy}</Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">{r.source}</Badge>
                        {isInactive && <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-muted text-muted-foreground border-muted-foreground/30">Inactive</Badge>}
                        <AiFixerIndicator domain={r.domain} selector={r.selector} />
                      </div>
                      <div className="grid grid-cols-3 gap-x-3 text-xs">
                        <div><span className="text-muted-foreground">Conf:</span> <span className="tabular-nums">{r.confidence != null ? `${Math.round(r.confidence * 10)}%` : "—"}</span></div>
                        <div><span className="text-muted-foreground">Reports:</span> <span className="tabular-nums">{r.report_count}</span></div>
                        <div className="text-muted-foreground">{r.created_at ? timeAgo(r.created_at) : "—"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Selector</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>CMP</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead className="text-right">Reports</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-center">Active<InfoTip text="Toggle to soft-disable a pattern without deleting it" /></TableHead>
                      <TableHead className="text-right">Discovered</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.map((r: any, i: number) => {
                      const isFixed = fixedPatterns.has(`${r.domain}::${r.selector}`);
                      const isInactive = r.is_active === false;
                      return (
                      <TableRow key={i} className={`even:bg-muted/30 ${isFixed ? "border-l-2 border-l-purple-500/50" : ""} ${isInactive ? "opacity-50" : ""}`}>
                        <TableCell className="font-medium">
                          {r.domain}
                          {isInactive && <Badge variant="outline" className="ml-1.5 text-[10px] py-0 px-1.5 bg-muted text-muted-foreground border-muted-foreground/30">Inactive</Badge>}
                        </TableCell>
                        <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block">{r.selector}</code></TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <Badge variant="outline" className={ACTION_BADGE_VARIANT[r.action_type] ?? ""}>{r.action_type}</Badge>
                            {r.strategy && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-cyan-500/15 text-cyan-500 border-cyan-500/30">
                                ⚡ {r.strategy}
                              </Badge>
                            )}
                            <AiFixerIndicator domain={r.domain} selector={r.selector} />
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.cmp_fingerprint}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.confidence != null ? `${Math.round(r.confidence * 10)}%` : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.report_count}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">{r.source}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={r.is_active !== false}
                            disabled={togglingPattern === r.id}
                            onCheckedChange={() => handleTogglePatternActive(r.id, r.is_active !== false)}
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{r.created_at ? timeAgo(r.created_at) : "—"}</TableCell>
                        <TableCell>
                          <TooltipProvider delayDuration={200}>
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-red-500"
                                  disabled={deletingPattern === `${r.domain}::${r.selector}`}
                                  onClick={() => handleDeletePattern(r.domain, r.selector, r.action_type)}
                                >
                                  {deletingPattern === `${r.domain}::${r.selector}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left"><p className="text-xs">Delete this pattern</p></TooltipContent>
                            </UITooltip>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Pattern Generator Tab */}
        <TabsContent value="ai-generator">
          <div className="space-y-4">
            {/* Header with Run Buttons */}
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
                <div>
                  <CardTitle className="text-lg">AI Pattern Generator</CardTitle>
                  <CardDescription className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                      Analyzes banner HTML with AI
                    </span>
                     <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                       <Timer className="h-3.5 w-3.5" />
                       Last run: {aiGenLog.length > 0 ? (
                         <>
                           {timeAgo(aiGenLog[0].created_at)}
                           <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 ml-0.5">
                             {inferRunSource(aiGenLog[0].created_at) === "auto" ? "auto" : "manual"}
                           </Badge>
                         </>
                       ) : "Never"}
                     </span>
                     <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                       <Clock className="h-3.5 w-3.5" />
                       Next auto-run: {nextAutoRun()}
                     </span>
                     <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                       <Coins className="h-3.5 w-3.5" />
                       {aiTokenStats.totalRuns} runs · {(aiTokenStats.totalPrompt + aiTokenStats.totalCompletion).toLocaleString()} tokens
                     </span>
                  </CardDescription>
                </div>
                <TooltipProvider delayDuration={300}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={handleRunMaintenance} disabled={runningMaintenance} className="gap-1.5 text-xs sm:text-sm">
                          {runningMaintenance ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                          Maintenance
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[240px] text-center">Runs auto-fix on broken patterns and processes unresolved user reports</TooltipContent>
                    </UITooltip>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={handleRunRetry} disabled={runningRetry} className="gap-1.5 text-xs sm:text-sm">
                          {runningRetry ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          Retry
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[240px] text-center">Re-attempts pattern generation on domains that previously failed (up to 5 tries)</TooltipContent>
                    </UITooltip>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" onClick={handleRunGenerator} disabled={runningGenerator} className="gap-1.5 text-xs sm:text-sm">
                          {runningGenerator ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                          Run AI
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[240px] text-center">Triggers AI analysis on all pending missed-banner reports to generate new CSS selectors</TooltipContent>
                    </UITooltip>
                  </div>
                </TooltipProvider>
              </CardHeader>
            </Card>

            {/* Post-Run Results Panel (collapsible) */}
            {genResults && (
              <Collapsible open={genResultsOpen} onOpenChange={setGenResultsOpen}>
                <Card className="border-amber-500/30">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="flex flex-row items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors py-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
                        <CardTitle className="text-sm font-medium">Latest Results</CardTitle>
                        <span className="text-xs text-muted-foreground truncate">
                          — {genResults.generated ?? 0} gen, {genResults.skipped ?? 0} skip, {genResults.failed ?? 0} fail
                        </span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${genResultsOpen ? "rotate-180" : ""}`} />
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0 space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Card className="border-t-2 border-primary/40"><CardContent className="py-2.5 text-center"><p className="text-xl font-bold tabular-nums">{genResults.processed ?? 0}</p><p className="text-[11px] text-muted-foreground">Processed</p></CardContent></Card>
                        <Card className="border-t-2 border-green-500/40"><CardContent className="py-2.5 text-center"><p className="text-xl font-bold text-green-500 tabular-nums">{genResults.generated ?? 0}</p><p className="text-[11px] text-muted-foreground">Generated</p></CardContent></Card>
                        <Card className="border-t-2 border-muted"><CardContent className="py-2.5 text-center"><p className="text-xl font-bold text-muted-foreground tabular-nums">{genResults.skipped ?? 0}</p><p className="text-[11px] text-muted-foreground">Skipped</p></CardContent></Card>
                        <Card className="border-t-2 border-red-500/40"><CardContent className="py-2.5 text-center"><p className="text-xl font-bold text-red-500 tabular-nums">{genResults.failed ?? 0}</p><p className="text-[11px] text-muted-foreground">Failed</p></CardContent></Card>
                      </div>
                      {genResults.results?.length > 0 && (
                        <>
                          {/* Mobile gen results */}
                          <div className="md:hidden space-y-2">
                            {genResults.results.map((r: any, i: number) => (
                              <div key={i} className={`border rounded-lg p-2.5 space-y-1.5 ${r.status === "error" ? "bg-red-500/5" : ""}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-sm truncate">{r.domain}</span>
                                  <Badge variant="outline" className={`shrink-0 ${AI_STATUS_BADGE[r.status] ?? "bg-muted text-muted-foreground border-muted-foreground/30"}`}>{r.status}</Badge>
                                </div>
                                {r.selector && <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded block truncate">{r.selector}</code>}
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  {r.action && <span>{r.action}</span>}
                                  {r.confidence != null && <span className="tabular-nums">{Math.round(r.confidence * 10)}%</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* Desktop gen results */}
                          <div className="hidden md:block">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Domain</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead>Selector</TableHead>
                                  <TableHead>Action</TableHead>
                                  <TableHead className="text-right">Confidence</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {genResults.results.map((r: any, i: number) => (
                                  <TableRow key={i} className={r.status === "error" ? "bg-red-500/5" : "even:bg-muted/30"}>
                                    <TableCell className="font-medium text-sm">{r.domain}</TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className={AI_STATUS_BADGE[r.status] ?? "bg-muted text-muted-foreground border-muted-foreground/30"}>
                                        {r.status}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>
                                      {r.selector ? <code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block">{r.selector}</code> : <span className="text-xs text-muted-foreground">—</span>}
                                    </TableCell>
                                    <TableCell>{r.action ?? "—"}</TableCell>
                                    <TableCell className="text-right tabular-nums">{r.confidence != null ? `${Math.round(r.confidence * 10)}%` : "—"}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            {/* Section A: Pending Candidates */}
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Pending Candidates</CardTitle>
                  <CardDescription>Unresolved missed banner reports awaiting AI processing</CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Filter buttons */}
                  <div className="flex items-center border rounded-md overflow-hidden">
                    {(["all", "never_processed", "failed"] as const).map(filter => (
                      <button
                        key={filter}
                        onClick={() => { setCandidateFilter(filter); setSelectedCandidates(new Set()); }}
                        className={`px-2.5 py-1.5 sm:py-1 text-xs font-medium transition-colors ${candidateFilter === filter ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                      >
                        {filter === "all" ? "All" : filter === "never_processed" ? "New" : "Failed"}
                      </button>
                    ))}
                  </div>
                  {selectedCandidates.size > 0 && (
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" disabled={bulkRerunning} onClick={handleBulkRerunAI}>
                      {bulkRerunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      Re-run {selectedCandidates.size}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {filteredCandidates.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="No pending candidates" description={candidateFilter !== "all" ? "No candidates match this filter." : "All reported domains have been processed."} />
                ) : (
                  <>
                    {/* Mobile candidates */}
                    <div className="md:hidden space-y-3">
                      {filteredCandidates.map((c: any, i: number) => {
                        const isNeverProcessed = c.ai_attempts === 0 && !aiLoggedDomains.has(c.domain);
                        return (
                          <div key={i} className={`border rounded-lg p-3 space-y-2 ${isNeverProcessed ? "border-l-2 border-l-amber-500/50" : ""}`}>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={selectedCandidates.has(c.domain)}
                                onCheckedChange={() => toggleCandidateSelection(c.domain)}
                              />
                              <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-medium text-sm truncate flex-1">{c.domain}</span>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1 h-7 text-xs shrink-0"
                                disabled={rerunningDomain === c.domain}
                                onClick={() => handleRerunAI(c.domain)}
                              >
                                {rerunningDomain === c.domain ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                AI
                              </Button>
                            </div>
                            <div className="flex items-center flex-wrap gap-1.5">
                              {c.banner_html ? (
                                <Badge variant="outline" className="bg-green-600/15 text-green-600 border-green-600/30 text-[10px]">HTML ✓</Badge>
                              ) : (
                                <Badge variant="outline" className="bg-red-500/15 text-red-500 border-red-500/30 text-[10px]">No HTML</Badge>
                              )}
                              {isNeverProcessed ? (
                                <Badge variant="outline" className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[10px]">Never processed</Badge>
                              ) : c.ai_attempts >= 5 ? (
                                <Badge variant="outline" className="bg-red-900/15 text-red-400 border-red-900/30 text-[10px]">Perm. failed</Badge>
                              ) : (
                                <Badge variant="outline" className="bg-blue-500/15 text-blue-500 border-blue-500/30 text-[10px]">Attempted</Badge>
                              )}
                              <span className="text-[11px] text-muted-foreground">{c.cmp_fingerprint ?? "unknown"} · {c.report_count} reports · {c.ai_attempts ?? 0} attempts</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Desktop candidates */}
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8">
                              <Checkbox
                                checked={selectedCandidates.size === filteredCandidates.length && filteredCandidates.length > 0}
                                onCheckedChange={toggleAllCandidates}
                              />
                            </TableHead>
                            <TableHead>Domain</TableHead>
                            <TableHead className="text-right">Reports</TableHead>
                             <TableHead>Has HTML<InfoTip text="Whether we captured the banner's HTML" /></TableHead>
                             <TableHead>CMP Type<InfoTip text="Consent Management Platform detected" /></TableHead>
                             <TableHead>Status</TableHead>
                             <TableHead className="text-right">AI Attempts</TableHead>
                             <TableHead className="w-24">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredCandidates.map((c: any, i: number) => {
                            const isNeverProcessed = c.ai_attempts === 0 && !aiLoggedDomains.has(c.domain);
                            return (
                            <TableRow key={i} className={`even:bg-muted/30 ${isNeverProcessed ? "border-l-2 border-l-amber-500/50" : ""}`}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedCandidates.has(c.domain)}
                                  onCheckedChange={() => toggleCandidateSelection(c.domain)}
                                />
                              </TableCell>
                              <TableCell className="font-medium flex items-center gap-2">
                                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                                {c.domain}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">{c.report_count}</TableCell>
                              <TableCell>
                                {c.banner_html ? (
                                  <Badge variant="outline" className="bg-green-600/15 text-green-600 border-green-600/30">Yes</Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-red-500/15 text-red-500 border-red-500/30">No</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{c.cmp_fingerprint ?? "unknown"}</TableCell>
                              <TableCell>
                                {isNeverProcessed ? (
                                  <Badge variant="outline" className="bg-amber-500/15 text-amber-500 border-amber-500/30">Never processed</Badge>
                                ) : c.ai_attempts >= 5 ? (
                                  <Badge variant="outline" className="bg-red-900/15 text-red-400 border-red-900/30">Permanently failed</Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-blue-500/15 text-blue-500 border-blue-500/30">Attempted</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{c.ai_attempts ?? 0}</TableCell>
                              <TableCell>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1 h-7 text-xs"
                                  disabled={rerunningDomain === c.domain}
                                  onClick={() => handleRerunAI(c.domain)}
                                >
                                  {rerunningDomain === c.domain ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Play className="h-3 w-3" />
                                  )}
                                  Re-run AI
                                </Button>
                              </TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Section B: AI Generation Log */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI Generation Log</CardTitle>
                <CardDescription>Recent AI pattern generation attempts (last 50)</CardDescription>
              </CardHeader>
              <CardContent>
                {aiGenLog.length === 0 ? (
                  <EmptyState icon={Sparkles} title="No generation history" description="Run the AI Generator to start creating patterns." />
                ) : (
                  <>
                    {/* Mobile AI log */}
                    <div className="md:hidden space-y-3">
                      {aiGenLog.map((log: any, i: number) => (
                        <div key={i} className={`border rounded-lg p-2.5 space-y-1.5 ${log.status === "error" ? "bg-red-500/5" : log.status === "permanently_failed" ? "bg-red-900/5" : ""}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate">{log.domain}</span>
                            <span className="inline-flex items-center gap-1 shrink-0">
                              {log.status === "permanently_failed" && <AlertTriangle className="h-3 w-3 text-red-400" />}
                              <Badge variant="outline" className={`text-[10px] ${AI_STATUS_BADGE[log.status] ?? "bg-muted text-muted-foreground border-muted-foreground/30"}`}>
                                {log.status.replace(/_/g, " ")}
                              </Badge>
                            </span>
                          </div>
                          {log.selector_generated && <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded block truncate">{log.selector_generated}</code>}
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                            {log.action_type && <Badge variant="outline" className={`text-[10px] ${ACTION_BADGE_VARIANT[log.action_type] ?? ""}`}>{log.action_type}</Badge>}
                            {log.confidence != null && <span className="tabular-nums">Conf: {Math.round(log.confidence * 10)}%</span>}
                            {(log.prompt_tokens || log.completion_tokens) && <span className="tabular-nums">{(log.prompt_tokens || 0) + (log.completion_tokens || 0)} tok</span>}
                            <span>{new Date(log.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Desktop AI log */}
                    <div className="hidden md:block overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Timestamp</TableHead>
                            <TableHead>Domain</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Selector Generated</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead className="text-right">Confidence</TableHead>
                            <TableHead className="text-right">Tokens</TableHead>
                            <TableHead>AI Model</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {aiGenLog.map((log: any, i: number) => (
                            <TableRow key={i} className={log.status === "error" ? "bg-red-500/5" : log.status === "permanently_failed" ? "bg-red-900/5" : "even:bg-muted/30"}>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {new Date(log.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </TableCell>
                              <TableCell className="font-medium">{log.domain}</TableCell>
                              <TableCell>
                                <span className="inline-flex items-center gap-1">
                                  {log.status === "needs_manual_review" && <Flag className="h-3.5 w-3.5 text-orange-500" />}
                                  {log.status === "permanently_failed" && <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
                                  {log.status === "success_probe" && <Target className="h-3.5 w-3.5 text-teal-500" />}
                                  {log.status === "success_consensus" && <Shield className="h-3.5 w-3.5 text-purple-500" />}
                                  <Badge variant="outline" className={AI_STATUS_BADGE[log.status] ?? "bg-muted text-muted-foreground border-muted-foreground/30"}>
                                    {log.status.replace(/_/g, " ")}
                                  </Badge>
                                </span>
                              </TableCell>
                              <TableCell>
                                {log.selector_generated ? (
                                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block font-mono">{log.selector_generated}</code>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {log.action_type ? (
                                  <Badge variant="outline" className={ACTION_BADGE_VARIANT[log.action_type] ?? ""}>{log.action_type}</Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {log.confidence != null ? `${Math.round(log.confidence * 10)}%` : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                                {(log.prompt_tokens || log.completion_tokens) ? `${(log.prompt_tokens || 0) + (log.completion_tokens || 0)}` : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{log.ai_model ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Skipped — No HTML Section */}
            {skippedDomains.length > 0 && (
              <Collapsible>
                <Card className="border-muted-foreground/20">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="flex flex-row items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors py-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-medium">Skipped — No HTML</CardTitle>
                        <Badge variant="secondary" className="text-[10px]">{skippedDomains.length}</Badge>
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        {skippedDomains.map((log: any, i: number) => (
                          <div key={i} className="flex items-center justify-between gap-3 border rounded-lg p-2.5">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-medium text-sm truncate">{log.domain}</span>
                              <span className="text-[11px] text-muted-foreground shrink-0">{log.created_at ? timeAgo(log.created_at) : "—"}</span>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 h-7 text-xs shrink-0"
                              disabled={fetchingDomain === log.domain}
                              onClick={() => handleFetchAndProcess(log.domain)}
                            >
                              {fetchingDomain === log.domain ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                              Retry
                            </Button>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}
          </div>
        </TabsContent>

        {/* Breakdown Tab */}
        <TabsContent value="breakdown">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Confidence Distribution</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={confDist}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" name="Patterns" radius={[4, 4, 0, 0]}>
                        {confDist.map((_: any, i: number) => (
                          <Cell key={i} fill={CONFIDENCE_COLORS[i % CONFIDENCE_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg">Action Types</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={actionStats} dataKey="count" nameKey="action_type" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} label={({ action_type }) => action_type}>
                        {actionStats.map((a: any, i: number) => (
                          <Cell key={i} fill={ACTION_COLORS[a.action_type] ?? "hsl(var(--muted))"} />
                        ))}
                      </Pie>
                      <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg">CMP Fingerprints</CardTitle></CardHeader>
              <CardContent>
                {/* Mobile CMP cards */}
                <div className="md:hidden space-y-2">
                  {cmpDist.map((c: any, i: number) => (
                    <div key={i} className="border rounded-lg p-2.5 flex items-center justify-between gap-3">
                      <span className="font-medium text-sm truncate">{c.cmp_fingerprint}</span>
                      <div className="flex items-center gap-3 text-xs shrink-0">
                        <span className="tabular-nums">{c.pattern_count}p</span>
                        <span className="tabular-nums">{c.domain_count}d</span>
                        <span className={`tabular-nums font-medium ${rateColor(c.success_rate)}`}>{c.success_rate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop CMP table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>CMP</TableHead>
                        <TableHead className="text-right">Patterns</TableHead>
                        <TableHead className="text-right">Domains</TableHead>
                        <TableHead className="text-right">Confidence</TableHead>
                        <TableHead className="text-right">Success</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cmpDist.map((c: any, i: number) => (
                        <TableRow key={i} className="even:bg-muted/30">
                          <TableCell className="font-medium">{c.cmp_fingerprint}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.pattern_count}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.domain_count}</TableCell>
                          <TableCell className="text-right tabular-nums">{Math.round(c.avg_confidence * 10)}%</TableCell>
                          <TableCell className={`text-right font-medium tabular-nums ${rateColor(c.success_rate)}`}>{c.success_rate}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg">Source Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sourceDist} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="source" tick={{ fontSize: 11 }} width={80} />
                      <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" name="Patterns" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Dismissals Tab */}
        <TabsContent value="dismissals">
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <Card className="border-t-2 border-purple-500/40">
                <CardContent className="py-2.5 sm:py-3 text-center">
                  <p className="text-lg sm:text-2xl font-bold tabular-nums">{dismissalReports.length}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Total Reports</p>
                </CardContent>
              </Card>
              <Card className="border-t-2 border-blue-500/40">
                <CardContent className="py-2.5 sm:py-3 text-center">
                  <p className="text-lg sm:text-2xl font-bold text-blue-500 tabular-nums">{dismissalsByDomain.size}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Unique Domains</p>
                </CardContent>
              </Card>
              <Card className="border-t-2 border-teal-500/40">
                <CardContent className="py-2.5 sm:py-3 text-center">
                  <p className="text-lg sm:text-2xl font-bold text-teal-500 tabular-nums">{consensusCandidates.length}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Pending<span className="hidden sm:inline"> Consensus</span></p>
                </CardContent>
              </Card>
            </div>

            {/* Consensus Results */}
            {consensusResults && (
              <Card className="border-teal-500/30 bg-teal-500/5">
                <CardContent className="py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-4 w-4 text-teal-500" />
                    <p className="text-sm font-medium">Consensus — {consensusResults.created ?? 0} patterns from {consensusResults.processed ?? 0} candidates</p>
                  </div>
                  {consensusResults.results?.length > 0 && (
                    <div className="space-y-1">
                      {consensusResults.results.map((r: any, i: number) => (
                        <p key={i} className="text-xs text-muted-foreground break-all">
                          {r.error ? `❌ ${r.domain}: ${r.error}` : `✅ ${r.domain} → ${r.selector} (${Math.round((r.confidence ?? 0) * 10)}%, ${r.reports} reports)`}
                        </p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Actions Bar */}
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
                <div>
                  <CardTitle className="text-lg">Dismissal Reports</CardTitle>
                  <CardDescription>User-reported banner dismissals from the extension</CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedDismissals.size > 0 && (
                    <Button variant="outline" size="sm" className="gap-1.5 text-red-500 border-red-500/30 hover:bg-red-500/10" disabled={deletingDismissals} onClick={handleDeleteDismissals}>
                      {deletingDismissals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Delete {selectedDismissals.size}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleRunConsensus} disabled={runningConsensus || consensusCandidates.length === 0} className="gap-2">
                    {runningConsensus ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Consensus{consensusCandidates.length > 0 ? ` (${consensusCandidates.length})` : ""}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {dismissalReports.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="No dismissal reports" description="No user-reported banner dismissals yet." />
                ) : (
                  <>
                    {/* Mobile dismissals */}
                    <div className="md:hidden space-y-3">
                      {dismissalReports.map((r: any) => (
                        <div key={r.id} className="border rounded-lg p-2.5 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={selectedDismissals.has(r.id)}
                              onCheckedChange={() => {
                                setSelectedDismissals(prev => {
                                  const next = new Set(prev);
                                  if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                                  return next;
                                });
                              }}
                            />
                            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="font-medium text-sm truncate flex-1">{r.domain}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">{r.created_at ? timeAgo(r.created_at) : "—"}</span>
                          </div>
                          <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded block truncate">{r.clicked_selector}</code>
                          {r.banner_selector && <code className="text-[11px] bg-muted/50 px-1.5 py-0.5 rounded block truncate text-muted-foreground">{r.banner_selector}</code>}
                        </div>
                      ))}
                    </div>
                    {/* Desktop dismissals */}
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8">
                              <Checkbox
                                checked={selectedDismissals.size === dismissalReports.length && dismissalReports.length > 0}
                                onCheckedChange={() => {
                                  if (selectedDismissals.size === dismissalReports.length) {
                                    setSelectedDismissals(new Set());
                                  } else {
                                    setSelectedDismissals(new Set(dismissalReports.map((r: any) => r.id)));
                                  }
                                }}
                              />
                            </TableHead>
                            <TableHead>Domain</TableHead>
                            <TableHead>Clicked Selector</TableHead>
                            <TableHead>Banner Selector</TableHead>
                            <TableHead className="text-right">Reported</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dismissalReports.map((r: any) => (
                            <TableRow key={r.id} className="even:bg-muted/30">
                              <TableCell>
                                <Checkbox
                                  checked={selectedDismissals.has(r.id)}
                                  onCheckedChange={() => {
                                    setSelectedDismissals(prev => {
                                      const next = new Set(prev);
                                      if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                                      return next;
                                    });
                                  }}
                                />
                              </TableCell>
                              <TableCell className="font-medium flex items-center gap-2">
                                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                                {r.domain}
                              </TableCell>
                              <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block">{r.clicked_selector}</code></TableCell>
                              <TableCell>
                                {r.banner_selector ? (
                                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block">{r.banner_selector}</code>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">{r.created_at ? timeAgo(r.created_at) : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Manual Review Tab */}
        <TabsContent value="manual-review">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Manual Review — No Banner HTML</CardTitle>
              <CardDescription>Domains reported where the extension couldn't capture banner HTML. Use "Fetch & Process" to attempt server-side detection.</CardDescription>
            </CardHeader>
            <CardContent>
              {noHtmlReports.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No reports needing review" description="All reported domains have captured banner HTML." />
              ) : (
                <>
                  {/* Mobile */}
                  <div className="md:hidden space-y-3">
                    {noHtmlReports.map((c: any, i: number) => (
                      <div key={i} className="border rounded-lg p-3 space-y-2 border-l-2 border-l-amber-500/50">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm truncate flex-1">{c.domain}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 h-7 text-xs shrink-0"
                            disabled={fetchingDomain === c.domain}
                            onClick={() => handleFetchAndProcess(c.domain, c.page_url)}
                          >
                            {fetchingDomain === c.domain ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                            Fetch
                          </Button>
                        </div>
                        <div className="flex items-center flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                          <span className="tabular-nums">{c.report_count} reports</span>
                          <span>·</span>
                          <span>{c.cmp_fingerprint ?? "unknown"}</span>
                          <span>·</span>
                          <span>{c.last_reported ? timeAgo(c.last_reported) : "—"}</span>
                        </div>
                        {c.page_url && <p className="text-[11px] text-muted-foreground truncate">{c.page_url}</p>}
                      </div>
                    ))}
                  </div>
                  {/* Desktop */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Domain</TableHead>
                          <TableHead className="text-right">Reports</TableHead>
                          <TableHead>CMP</TableHead>
                          <TableHead>Page URL</TableHead>
                          <TableHead className="text-right">Last Reported</TableHead>
                          <TableHead className="w-32">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {noHtmlReports.map((c: any, i: number) => (
                          <TableRow key={i} className="even:bg-muted/30 border-l-2 border-l-amber-500/50">
                            <TableCell className="font-medium flex items-center gap-2">
                              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                              {c.domain}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{c.report_count}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{c.cmp_fingerprint ?? "unknown"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{c.page_url || "—"}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{c.last_reported ? timeAgo(c.last_reported) : "—"}</TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 h-7 text-xs"
                                disabled={fetchingDomain === c.domain}
                                onClick={() => handleFetchAndProcess(c.domain, c.page_url)}
                              >
                                {fetchingDomain === c.domain ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                Fetch & Process
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* User Reports Tab */}
        <TabsContent value="user-reports">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Missed Banner Reports</CardTitle>
                <CardDescription>Domains reported by users where cookie banners weren't handled</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleProcessReports} disabled={processingReports} className="gap-2 w-full sm:w-auto">
                {processingReports ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Process Reports
              </Button>
            </CardHeader>
            <CardContent>
              {unresolvedReports.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No unresolved reports!" description="All user-reported domains have been handled." />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <Card className="border-t-2 border-primary/40"><CardContent className="py-3 text-center"><p className="text-xl sm:text-2xl font-bold tabular-nums">{unresolvedReports.length}</p><p className="text-[10px] sm:text-xs text-muted-foreground">Unresolved</p></CardContent></Card>
                    <Card className="border-t-2 border-amber-500/40"><CardContent className="py-3 text-center"><p className="text-xl sm:text-2xl font-bold text-amber-500 tabular-nums">{unresolvedReports.filter((r: any) => r.report_count >= 3).length}</p><p className="text-[10px] sm:text-xs text-muted-foreground">Priority (3+)</p></CardContent></Card>
                  </div>
                  {/* Mobile user reports */}
                  <div className="md:hidden space-y-3">
                    {unresolvedReports.map((r: any, i: number) => (
                      <div key={i} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm truncate flex-1">{r.domain}</span>
                          {r.report_count >= 3 && (
                            <Badge variant="outline" className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[10px] shrink-0">Priority</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="tabular-nums font-medium">{r.report_count} reports</span>
                          {r.has_working_pattern ? (
                            <Badge variant="outline" className="bg-green-600/15 text-green-600 border-green-600/30 text-[10px]">Pattern ✓</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-500/15 text-red-500 border-red-500/30 text-[10px]">No pattern</Badge>
                          )}
                          <span className="text-muted-foreground ml-auto">{r.last_reported ? timeAgo(r.last_reported) : "—"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop user reports */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Domain</TableHead>
                          <TableHead className="text-right">Reports</TableHead>
                          <TableHead>Working Pattern?</TableHead>
                          <TableHead className="text-right">Last Reported</TableHead>
                          <TableHead className="text-right">First Seen</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unresolvedReports.map((r: any, i: number) => (
                          <TableRow key={i} className="even:bg-muted/30">
                            <TableCell className="font-medium flex items-center gap-2">
                              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                              {r.domain}
                              {r.report_count >= 3 && (
                                <Badge variant="outline" className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[10px]">Priority</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{r.report_count}</TableCell>
                            <TableCell>
                              {r.has_working_pattern ? (
                                <Badge variant="outline" className="bg-green-600/15 text-green-600 border-green-600/30">Yes</Badge>
                              ) : (
                                <Badge variant="outline" className="bg-red-500/15 text-red-500 border-red-500/30">No</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{r.last_reported ? timeAgo(r.last_reported) : "—"}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{r.created_at ? timeAgo(r.created_at) : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}