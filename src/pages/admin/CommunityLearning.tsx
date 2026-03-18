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
  const hasLoadedRef = useRef(false);

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
      const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17, r18] = await Promise.all([
        supabase.rpc("get_community_overview" as any),
        supabase.rpc("get_daily_pattern_activity" as any, { p_days: 30 }),
        supabase.rpc("get_top_domains" as any, { p_limit: 25 }),
        supabase.rpc("get_recently_learned" as any, { p_limit: 50 }),
        supabase.rpc("get_pattern_issues" as any, { p_limit: 50 }),
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
    } catch (e) {
      console.error("Failed to fetch community data", e);
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, []);

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
          <div className="flex items-center gap-2">
            <ManualPatternForm onSuccess={fetchAll} />
            <Button variant="outline" size="sm" onClick={fetchAll} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        }
      />

      {/* Permanently Failed Alert */}
      {aiTokenStats.permFailedCount > 0 && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-500">
                {aiTokenStats.permFailedCount} domain{aiTokenStats.permFailedCount > 1 ? "s" : ""} permanently failed
              </p>
              <p className="text-xs text-muted-foreground">These domains exhausted all retry attempts. Consider adding patterns manually.</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 gap-1.5 border-red-500/30 text-red-500 hover:bg-red-500/10" onClick={() => setActiveTab("ai-generator")}>
              <Flag className="h-3.5 w-3.5" /> View
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Patterns" value={o.total_patterns} icon={Layers} iconColor="text-primary" iconBg="bg-primary/10" accentColor="border-primary/40" subtitle={`${o.patterns_last_7d} active last 7 days`} tooltip="Cookie banner CSS selectors learned by the community network" />
        <StatCard label="Domains Covered" value={o.total_domains} icon={Globe} iconColor="text-green-500" iconBg="bg-green-500/10" accentColor="border-green-500/40" subtitle={`${o.new_domains_last_7d} new this week`} tooltip="Unique websites where Cookie Yeti has learned patterns" />
        <StatCard label="Success Rate" value={`${o.overall_success_rate}%`} icon={Target} iconColor="text-blue-500" iconBg="bg-blue-500/10" accentColor="border-blue-500/40" subtitle={`${Number(o.total_successes).toLocaleString()} / ${Number(o.total_reports).toLocaleString()}`} tooltip="Percentage of pattern matches that successfully dismissed a banner. Calculated from success_count / report_count across all patterns" />
        <StatCard label="Avg Confidence" value={o.avg_confidence != null ? `${Math.round(o.avg_confidence * 10)}%` : "—"} icon={TrendingUp} iconColor="text-purple-500" iconBg="bg-purple-500/10" accentColor="border-purple-500/40" subtitle={`${o.high_confidence} high / ${o.low_confidence} low`} tooltip="Mean confidence score across all active patterns. Higher = more reliable. Based on success rate and report volume" />
        <StatCard label="AI Generated" value={aiGeneratedCount} icon={Sparkles} iconColor="text-amber-500" iconBg="bg-amber-500/10" accentColor="border-amber-500/40" subtitle="Patterns from AI" tooltip="Patterns created by AI analysis of reported banner HTML" />
      </div>

      {/* Health Indicators */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-t-2 border-green-500/40">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="relative">
              <Clock className="h-5 w-5 text-green-500" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold tabular-nums">{o.patterns_last_24h}</p>
              <p className="text-xs text-muted-foreground">Active last 24h<InfoTip text="Patterns that matched a banner in the last 24 hours" /></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-amber-500/40">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-semibold tabular-nums">{o.stale_patterns}</p>
              <p className="text-xs text-muted-foreground">Stale 30d+<InfoTip text="Patterns not seen in 30+ days — may be outdated" /></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-red-500/40">
          <CardContent className="flex items-center gap-3 py-4">
            <CircleAlert className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-sm font-semibold tabular-nums">{issueCount}</p>
              <p className="text-xs text-muted-foreground">Issues detected<InfoTip text="Patterns with very low confidence, zero successes, or other problems" /></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-primary/40">
          <CardContent className="flex items-center gap-3 py-4">
            <Coins className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold tabular-nums">{(aiTokenStats.totalPrompt + aiTokenStats.totalCompletion).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">AI Tokens Used<InfoTip text={`${aiTokenStats.totalRuns} AI runs total. Prompt: ${aiTokenStats.totalPrompt.toLocaleString()}, Completion: ${aiTokenStats.totalCompletion.toLocaleString()}`} /></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-purple-500/40">
          <CardContent className="flex items-center gap-3 py-4">
            <MousePointerClick className="h-5 w-5 text-purple-500" />
            <div>
              <p className="text-sm font-semibold tabular-nums">{dismissalReports.length}</p>
              <p className="text-xs text-muted-foreground">Dismissal Reports<InfoTip text="User-reported banner dismissals awaiting consensus processing" /></p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-teal-500/40">
          <CardContent className="flex items-center gap-3 py-4">
            <Users className="h-5 w-5 text-teal-500" />
            <div>
              <p className="text-sm font-semibold tabular-nums">{consensusPatternCount}</p>
              <p className="text-xs text-muted-foreground">Consensus Patterns<InfoTip text="Patterns created from user dismissal consensus" /></p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
          <TabsTrigger value="activity" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><TrendingUp className="h-3.5 w-3.5" />Activity</TabsTrigger>
          <TabsTrigger value="domains" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Globe className="h-3.5 w-3.5" />Domains</TabsTrigger>
          <TabsTrigger value="recent" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Brain className="h-3.5 w-3.5" />Recent</TabsTrigger>
          <TabsTrigger value="ai-generator" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Sparkles className="h-3.5 w-3.5" />AI Pattern Generator</TabsTrigger>
          <TabsTrigger value="breakdown" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><BarChart3 className="h-3.5 w-3.5" />Breakdown</TabsTrigger>
          <TabsTrigger value="dismissals" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><MousePointerClick className="h-3.5 w-3.5" />Dismissals{dismissalReports.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{dismissalReports.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="user-reports" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Flag className="h-3.5 w-3.5" />Reports</TabsTrigger>
        </TabsList>

        {/* Activity Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader><CardTitle className="text-lg">Pattern Activity (30 days)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
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
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="new_patterns" stroke="hsl(270,60%,55%)" strokeWidth={2} fill="url(#gradNew)" name="New Patterns" />
                    <Area type="monotone" dataKey="new_domains" stroke="hsl(142,76%,36%)" strokeWidth={2} fill="url(#gradDomains)" name="New Domains" />
                    <Line type="monotone" dataKey="active_patterns" stroke="hsl(45,93%,47%)" strokeWidth={2} strokeDasharray="5 5" name="Active Patterns" dot={false} />
                    <Legend />
                  </AreaChart>
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recent Tab */}
        <TabsContent value="recent">
          <Card>
            <CardHeader><CardTitle className="text-lg">Recently Learned Patterns</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
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
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-lg">AI Pattern Generator</CardTitle>
                  <CardDescription className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                      Analyzes banner HTML with AI to generate CSS selectors
                    </span>
                     <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                       <Timer className="h-3.5 w-3.5" />
                       Last run<InfoTip text="When the AI last attempted to generate patterns" />: {aiGenLog.length > 0 ? `${new Date(aiGenLog[0].created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} (${timeAgo(aiGenLog[0].created_at)})` : "Never"}
                     </span>
                     <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                       <Coins className="h-3.5 w-3.5" />
                       {aiTokenStats.totalRuns} runs · {(aiTokenStats.totalPrompt + aiTokenStats.totalCompletion).toLocaleString()} tokens
                     </span>
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleRunMaintenance} disabled={runningMaintenance} className="gap-2">
                    {runningMaintenance ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                    Run Maintenance
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleRunRetry} disabled={runningRetry} className="gap-2">
                    {runningRetry ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Retry Failed
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleRunGenerator} disabled={runningGenerator} className="gap-2">
                    {runningGenerator ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Run AI Generator
                  </Button>
                </div>
              </CardHeader>
            </Card>

            {/* Post-Run Results Panel (collapsible) */}
            {genResults && (
              <Collapsible open={genResultsOpen} onOpenChange={setGenResultsOpen}>
                <Card className="border-amber-500/30">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="flex flex-row items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors py-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        <CardTitle className="text-sm font-medium">Latest Generation Results</CardTitle>
                        <span className="text-xs text-muted-foreground">
                          — {genResults.processed ?? 0} processed, {genResults.generated ?? 0} generated, {genResults.skipped ?? 0} skipped, {genResults.failed ?? 0} failed
                        </span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${genResultsOpen ? "rotate-180" : ""}`} />
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0 space-y-4">
                      <div className="grid grid-cols-4 gap-3">
                        <Card className="border-t-2 border-primary/40"><CardContent className="py-2.5 text-center"><p className="text-xl font-bold tabular-nums">{genResults.processed ?? 0}</p><p className="text-[11px] text-muted-foreground">Processed</p></CardContent></Card>
                        <Card className="border-t-2 border-green-500/40"><CardContent className="py-2.5 text-center"><p className="text-xl font-bold text-green-500 tabular-nums">{genResults.generated ?? 0}</p><p className="text-[11px] text-muted-foreground">Generated</p></CardContent></Card>
                        <Card className="border-t-2 border-muted"><CardContent className="py-2.5 text-center"><p className="text-xl font-bold text-muted-foreground tabular-nums">{genResults.skipped ?? 0}</p><p className="text-[11px] text-muted-foreground">Skipped</p></CardContent></Card>
                        <Card className="border-t-2 border-red-500/40"><CardContent className="py-2.5 text-center"><p className="text-xl font-bold text-red-500 tabular-nums">{genResults.failed ?? 0}</p><p className="text-[11px] text-muted-foreground">Failed</p></CardContent></Card>
                      </div>
                      {genResults.results?.length > 0 && (
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
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            {/* Section A: Pending Candidates */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Pending Candidates</CardTitle>
                  <CardDescription>Unresolved missed banner reports awaiting AI processing</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {/* Filter buttons */}
                  <div className="flex items-center border rounded-md overflow-hidden">
                    {(["all", "never_processed", "failed"] as const).map(filter => (
                      <button
                        key={filter}
                        onClick={() => { setCandidateFilter(filter); setSelectedCandidates(new Set()); }}
                        className={`px-2.5 py-1 text-xs font-medium transition-colors ${candidateFilter === filter ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                      >
                        {filter === "all" ? "All" : filter === "never_processed" ? "Never Processed" : "Previously Failed"}
                      </button>
                    ))}
                  </div>
                  {selectedCandidates.size > 0 && (
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" disabled={bulkRerunning} onClick={handleBulkRerunAI}>
                      {bulkRerunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      Re-run {selectedCandidates.size} selected
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {filteredCandidates.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="No pending candidates" description={candidateFilter !== "all" ? "No candidates match this filter." : "All reported domains have been processed."} />
                ) : (
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
                         <TableHead>Has HTML<InfoTip text="Whether we captured the banner's HTML. Reports WITH HTML produce much better AI-generated patterns" /></TableHead>
                         <TableHead>CMP Type<InfoTip text="Consent Management Platform detected (OneTrust, Cookiebot, etc.)" /></TableHead>
                         <TableHead>Status<InfoTip text="Whether AI has attempted to process this domain" /></TableHead>
                         <TableHead className="text-right">AI Attempts<InfoTip text="Number of times AI tried to generate a pattern. Max 5 before permanently failed" /></TableHead>
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
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Timestamp</TableHead>
                          <TableHead>Domain</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Selector Generated</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead className="text-right">Confidence</TableHead>
                          <TableHead className="text-right">Tokens<InfoTip text="Prompt + completion tokens used for this AI call" /></TableHead>
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
                              {(log.prompt_tokens || log.completion_tokens) ? `${((log.prompt_tokens || 0) + (log.completion_tokens || 0)).toLocaleString()}` : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{log.ai_model ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Breakdown Tab */}
        <TabsContent value="breakdown">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Confidence Distribution</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={confDist}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" name="Patterns" radius={[4, 4, 0, 0]}>
                        {confDist.map((_: any, i: number) => (
                          <Cell key={i} fill={CONFIDENCE_COLORS[i] ?? "hsl(var(--primary))"} />
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
            <div className="grid grid-cols-3 gap-4">
              <Card className="border-t-2 border-purple-500/40">
                <CardContent className="py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums">{dismissalReports.length}</p>
                  <p className="text-xs text-muted-foreground">Total Dismissal Reports</p>
                </CardContent>
              </Card>
              <Card className="border-t-2 border-blue-500/40">
                <CardContent className="py-3 text-center">
                  <p className="text-2xl font-bold text-blue-500 tabular-nums">{dismissalsByDomain.size}</p>
                  <p className="text-xs text-muted-foreground">Unique Domains</p>
                </CardContent>
              </Card>
              <Card className="border-t-2 border-teal-500/40">
                <CardContent className="py-3 text-center">
                  <p className="text-2xl font-bold text-teal-500 tabular-nums">{consensusCandidates.length}</p>
                  <p className="text-xs text-muted-foreground">Pending Consensus<InfoTip text="Domains with dismissal reports not yet converted to patterns" /></p>
                </CardContent>
              </Card>
            </div>

            {/* Consensus Results */}
            {consensusResults && (
              <Card className="border-teal-500/30 bg-teal-500/5">
                <CardContent className="py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-4 w-4 text-teal-500" />
                    <p className="text-sm font-medium">Consensus Results — {consensusResults.created ?? 0} patterns created from {consensusResults.processed ?? 0} candidates</p>
                  </div>
                  {consensusResults.results?.length > 0 && (
                    <div className="space-y-1">
                      {consensusResults.results.map((r: any, i: number) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {r.error ? `❌ ${r.domain}: ${r.error}` : `✅ ${r.domain} → ${r.selector} (confidence: ${Math.round((r.confidence ?? 0) * 10)}%, ${r.reports} reports)`}
                        </p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Actions Bar */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-lg">Dismissal Reports</CardTitle>
                  <CardDescription>User-reported banner dismissals from the extension</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {selectedDismissals.size > 0 && (
                    <Button variant="outline" size="sm" className="gap-1.5 text-red-500 border-red-500/30 hover:bg-red-500/10" disabled={deletingDismissals} onClick={handleDeleteDismissals}>
                      {deletingDismissals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Delete {selectedDismissals.size} selected
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleRunConsensus} disabled={runningConsensus || consensusCandidates.length === 0} className="gap-2">
                    {runningConsensus ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Run Consensus{consensusCandidates.length > 0 ? ` (${consensusCandidates.length})` : ""}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {dismissalReports.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="No dismissal reports" description="No user-reported banner dismissals yet." />
                ) : (
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
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* User Reports Tab */}
        <TabsContent value="user-reports">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Missed Banner Reports</CardTitle>
                <CardDescription>Domains reported by users where cookie banners weren't handled</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleProcessReports} disabled={processingReports} className="gap-2">
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
                    <Card className="border-t-2 border-primary/40"><CardContent className="py-3 text-center"><p className="text-2xl font-bold tabular-nums">{unresolvedReports.length}</p><p className="text-xs text-muted-foreground">Unresolved</p></CardContent></Card>
                    <Card className="border-t-2 border-amber-500/40"><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-amber-500 tabular-nums">{unresolvedReports.filter((r: any) => r.report_count >= 3).length}</p><p className="text-xs text-muted-foreground">Priority (3+ reports)<InfoTip text="Domains reported 3+ times — highest priority for fixing" /></p></CardContent></Card>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead className="text-right">Reports</TableHead>
                        <TableHead>Working Pattern?<InfoTip text="Whether an existing pattern covers this domain" /></TableHead>
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
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
