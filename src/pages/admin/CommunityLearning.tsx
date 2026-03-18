import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Brain, RefreshCw, Globe, Target, TrendingUp, Shield, Clock, AlertTriangle, CircleAlert, CheckCircle2, Wrench, Flag, Play, Loader2, BarChart3, Layers, Timer, CalendarClock, Bot, ChevronDown, Sparkles, Info } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
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
  error: "bg-red-500/15 text-red-500 border-red-500/30",
  skipped_no_html: "bg-muted text-muted-foreground border-muted-foreground/30",
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
  const [processingReports, setProcessingReports] = useState(false);
  const [rerunningDomain, setRerunningDomain] = useState<string | null>(null);
  const [genResultsOpen, setGenResultsOpen] = useState(false);
  const [genResults, setGenResults] = useState<any | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [aiGenLog, setAiGenLog] = useState<any[]>([]);
  const [aiGeneratedCount, setAiGeneratedCount] = useState(0);
  const hasLoadedRef = useRef(false);

  const fetchAll = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14] = await Promise.all([
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
        // New: candidates for AI generation
        supabase.from("missed_banner_reports").select("*").eq("resolved", false).order("report_count", { ascending: false }).limit(50),
        // New: AI generation log
        supabase.from("ai_generation_log").select("*").order("created_at", { ascending: false }).limit(50),
        // New: AI generated count
        supabase.from("cookie_patterns").select("id", { count: "exact", head: true }).eq("source", "ai_generated"),
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
      // Clear stale AI log entries for this domain
      await supabase.from("ai_generation_log").delete().eq("domain", domain).in("status", ["skipped_no_html", "error"]);
      // Reset ai_attempts on missed_banner_reports
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Build lookup sets for AI fixer cross-referencing (kept for Recent/Domains tabs)
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
          <Button variant="outline" size="sm" onClick={fetchAll} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Patterns" value={o.total_patterns} icon={Layers} iconColor="text-primary" iconBg="bg-primary/10" accentColor="border-primary/40" subtitle={`${o.patterns_last_7d} active last 7 days`} tooltip="Cookie banner CSS selectors learned by the community network" />
        <StatCard label="Domains Covered" value={o.total_domains} icon={Globe} iconColor="text-green-500" iconBg="bg-green-500/10" accentColor="border-green-500/40" subtitle={`${o.new_domains_last_7d} new this week`} tooltip="Unique websites where Cookie Yeti has learned patterns" />
        <StatCard label="Success Rate" value={`${o.overall_success_rate}%`} icon={Target} iconColor="text-blue-500" iconBg="bg-blue-500/10" accentColor="border-blue-500/40" subtitle={`${Number(o.total_successes).toLocaleString()} / ${Number(o.total_reports).toLocaleString()}`} tooltip="Percentage of pattern matches that successfully dismissed a banner. Calculated from success_count / report_count across all patterns" />
        <StatCard label="Avg Confidence" value={o.avg_confidence ?? "—"} icon={TrendingUp} iconColor="text-purple-500" iconBg="bg-purple-500/10" accentColor="border-purple-500/40" subtitle={`${o.high_confidence} high / ${o.low_confidence} low`} tooltip="Mean confidence score (0-1) across all active patterns. Higher = more reliable. Based on success rate and report volume" />
        <StatCard label="AI Generated" value={aiGeneratedCount} icon={Sparkles} iconColor="text-amber-500" iconBg="bg-amber-500/10" accentColor="border-amber-500/40" subtitle="Patterns from AI" tooltip="Patterns created by AI analysis of reported banner HTML" />
      </div>

      {/* Health Indicators */}
      <div className="grid grid-cols-3 gap-4">
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
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
          <TabsTrigger value="activity" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><TrendingUp className="h-3.5 w-3.5" />Activity</TabsTrigger>
          <TabsTrigger value="domains" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Globe className="h-3.5 w-3.5" />Domains</TabsTrigger>
          <TabsTrigger value="recent" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Brain className="h-3.5 w-3.5" />Recent</TabsTrigger>
          <TabsTrigger value="ai-generator" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Sparkles className="h-3.5 w-3.5" />AI Pattern Generator</TabsTrigger>
          <TabsTrigger value="breakdown" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><BarChart3 className="h-3.5 w-3.5" />Breakdown</TabsTrigger>
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
                    <TableHead>Domain</TableHead>
                     <TableHead className="text-right">Patterns<InfoTip text="Number of CSS selectors learned for this domain" /></TableHead>
                     <TableHead className="text-right">Reports<InfoTip text="Times users encountered banners on this domain" /></TableHead>
                     <TableHead className="text-right">Success Rate<InfoTip text="How often patterns successfully dismiss banners here" /></TableHead>
                     <TableHead>Confidence<InfoTip text="Reliability score 0-1, based on success rate and volume" /></TableHead>
                     <TableHead className="text-right">Last Active<InfoTip text="When a pattern last matched a banner on this domain" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((d: any, i: number) => {
                    const isFixed = fixedDomains.has(d.domain);
                    return (
                    <TableRow key={i} className={`even:bg-muted/30 ${isFixed ? "border-l-2 border-l-purple-500/50" : ""}`}>
                      <TableCell className="font-medium flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-muted-foreground" />{d.domain}<DomainAiBadge domain={d.domain} /></TableCell>
                      <TableCell className="text-right tabular-nums">{d.pattern_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(d.total_reports).toLocaleString()}</TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${rateColor(d.success_rate)}`}>{d.success_rate}%</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={d.avg_confidence * 100} className="h-2 w-16" />
                          <span className="text-xs text-muted-foreground tabular-nums">{d.avg_confidence}</span>
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
                      <TableHead className="text-right">Discovered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.map((r: any, i: number) => {
                      const isFixed = fixedPatterns.has(`${r.domain}::${r.selector}`);
                      return (
                      <TableRow key={i} className={`even:bg-muted/30 ${isFixed ? "border-l-2 border-l-purple-500/50" : ""}`}>
                        <TableCell className="font-medium">{r.domain}</TableCell>
                        <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block">{r.selector}</code></TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <Badge variant="outline" className={ACTION_BADGE_VARIANT[r.action_type] ?? ""}>{r.action_type}</Badge>
                            <AiFixerIndicator domain={r.domain} selector={r.selector} />
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.cmp_fingerprint}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.confidence}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.report_count}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">{r.source}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{r.created_at ? timeAgo(r.created_at) : "—"}</TableCell>
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
            {/* Header with Run Button */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-lg">AI Pattern Generator</CardTitle>
                  <CardDescription className="flex items-center gap-3 mt-1">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                      Analyzes banner HTML with AI to generate CSS selectors
                    </span>
                     <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                       <Timer className="h-3.5 w-3.5" />
                       Last run<InfoTip text="When the AI last attempted to generate patterns" />: {aiGenLog.length > 0 ? `${new Date(aiGenLog[0].created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} (${timeAgo(aiGenLog[0].created_at)})` : "Never"}
                     </span>
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleRunGenerator} disabled={runningGenerator} className="gap-2">
                  {runningGenerator ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Run AI Generator
                </Button>
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
                                <TableCell className="text-right tabular-nums">{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}</TableCell>
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
              <CardHeader>
                <CardTitle className="text-base">Pending Candidates</CardTitle>
                <CardDescription>Unresolved missed banner reports awaiting AI processing</CardDescription>
              </CardHeader>
              <CardContent>
                {candidates.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="No pending candidates" description="All reported domains have been processed." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead className="text-right">Reports</TableHead>
                         <TableHead>Has HTML<InfoTip text="Whether we captured the banner's HTML. Reports WITH HTML produce much better AI-generated patterns" /></TableHead>
                         <TableHead>CMP Type<InfoTip text="Consent Management Platform detected (OneTrust, Cookiebot, etc.)" /></TableHead>
                         <TableHead className="text-right">Last Reported</TableHead>
                         <TableHead className="text-right">AI Attempts<InfoTip text="Number of times AI tried to generate a pattern. Max 3 attempts" /></TableHead>
                         <TableHead className="w-24">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {candidates.map((c: any, i: number) => (
                        <TableRow key={i} className="even:bg-muted/30">
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
                          <TableCell className="text-right text-xs text-muted-foreground">{c.last_reported ? timeAgo(c.last_reported) : "—"}</TableCell>
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
                      ))}
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
                          <TableHead>AI Model</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {aiGenLog.map((log: any, i: number) => (
                          <TableRow key={i} className={log.status === "error" ? "bg-red-500/5" : "even:bg-muted/30"}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(log.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </TableCell>
                            <TableCell className="font-medium">{log.domain}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={AI_STATUS_BADGE[log.status] ?? "bg-muted text-muted-foreground border-muted-foreground/30"}>
                                {log.status}
                              </Badge>
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
                              {log.confidence != null ? `${Math.round(log.confidence * 100)}%` : "—"}
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
                        <TableCell className="text-right tabular-nums">{c.avg_confidence}</TableCell>
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
