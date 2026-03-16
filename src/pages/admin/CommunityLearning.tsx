import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Brain, RefreshCw, Globe, Target, TrendingUp, Shield, Clock, AlertTriangle, CircleAlert, CheckCircle2, Wrench, Flag, Play, Loader2, BarChart3, Layers, Timer, CalendarClock, Bot } from "lucide-react";
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
  const [runningFixer, setRunningFixer] = useState(false);
  const [processingReports, setProcessingReports] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!overview) setLoading(true);
    try {
      const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11] = await Promise.all([
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
    } catch (e) {
      console.error("Failed to fetch community data", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRunFixer = useCallback(async () => {
    setRunningFixer(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-pattern-maintenance`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Maintenance complete — Fixed: ${data.fix?.fixed ?? 0}, Failed: ${data.fix?.failed ?? 0}`);
      fetchAll();
    } catch (e: any) {
      toast.error(`Maintenance failed: ${e.message}`);
    } finally {
      setRunningFixer(false);
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-80 mt-2" /></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
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
        description="Cookie pattern intelligence from the Cookie Yeti network"
        actions={
          <Button variant="outline" size="sm" onClick={fetchAll} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Patterns" value={o.total_patterns} icon={Layers} iconColor="text-primary" iconBg="bg-primary/10" accentColor="border-primary/40" subtitle={`${o.patterns_last_7d} active last 7 days`} />
        <StatCard label="Domains Covered" value={o.total_domains} icon={Globe} iconColor="text-green-500" iconBg="bg-green-500/10" accentColor="border-green-500/40" subtitle={`${o.new_domains_last_7d} new this week`} />
        <StatCard label="Success Rate" value={`${o.overall_success_rate}%`} icon={Target} iconColor="text-blue-500" iconBg="bg-blue-500/10" accentColor="border-blue-500/40" subtitle={`${Number(o.total_successes).toLocaleString()} / ${Number(o.total_reports).toLocaleString()}`} />
        <StatCard label="Avg Confidence" value={o.avg_confidence ?? "—"} icon={TrendingUp} iconColor="text-purple-500" iconBg="bg-purple-500/10" accentColor="border-purple-500/40" subtitle={`${o.high_confidence} high / ${o.low_confidence} low`} />
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
              <p className="text-xs text-muted-foreground">Active last 24h</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-amber-500/40">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-semibold tabular-nums">{o.stale_patterns}</p>
              <p className="text-xs text-muted-foreground">Stale 30d+</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-t-2 border-red-500/40">
          <CardContent className="flex items-center gap-3 py-4">
            <CircleAlert className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-sm font-semibold tabular-nums">{issueCount}</p>
              <p className="text-xs text-muted-foreground">Issues detected</p>
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
          <TabsTrigger value="issues" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><AlertTriangle className="h-3.5 w-3.5" />Issues</TabsTrigger>
          <TabsTrigger value="breakdown" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><BarChart3 className="h-3.5 w-3.5" />Breakdown</TabsTrigger>
          <TabsTrigger value="ai-fixer" className="gap-1.5 rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"><Wrench className="h-3.5 w-3.5" />AI Fixer</TabsTrigger>
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
                    <TableHead className="text-right">Patterns</TableHead>
                    <TableHead className="text-right">Reports</TableHead>
                    <TableHead className="text-right">Success Rate</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead className="text-right">Last Active</TableHead>
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
                  ))}
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
                    {recent.map((r: any, i: number) => (
                      <TableRow key={i} className="even:bg-muted/30">
                        <TableCell className="font-medium">{r.domain}</TableCell>
                        <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block">{r.selector}</code></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={ACTION_BADGE_VARIANT[r.action_type] ?? ""}>{r.action_type}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.cmp_fingerprint}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.confidence}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.report_count}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">{r.source}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{r.created_at ? timeAgo(r.created_at) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Issues Tab */}
        <TabsContent value="issues">
          <Card>
            <CardHeader><CardTitle className="text-lg">Pattern Issues</CardTitle></CardHeader>
            <CardContent>
              {issues.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No issues detected!" description="All patterns are healthy." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Issue</TableHead>
                      <TableHead>Domain</TableHead>
                      <TableHead>Selector</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead className="text-right">Reports</TableHead>
                      <TableHead className="text-right">Success Rate</TableHead>
                      <TableHead className="text-right">Last Seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {issues.map((p: any, i: number) => {
                      const issue = ISSUE_BADGE[p.issue_type] ?? ISSUE_BADGE.other;
                      return (
                        <TableRow key={i} className="even:bg-muted/30">
                          <TableCell><Badge variant="outline" className={issue.className}>{issue.label}</Badge></TableCell>
                          <TableCell className="font-medium">{p.domain}</TableCell>
                          <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[180px] truncate inline-block">{p.selector}</code></TableCell>
                          <TableCell><Badge variant="outline" className={ACTION_BADGE_VARIANT[p.action_type] ?? ""}>{p.action_type}</Badge></TableCell>
                          <TableCell className="text-right tabular-nums">{p.confidence}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.report_count}</TableCell>
                          <TableCell className={`text-right font-medium tabular-nums ${rateColor(p.success_rate ?? 0)}`}>{p.success_rate ?? 0}%</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">{p.last_seen ? timeAgo(p.last_seen) : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
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
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
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
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
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
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" name="Patterns" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* AI Fixer Tab */}
        <TabsContent value="ai-fixer">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">AI Auto-Fixer</CardTitle>
                <CardDescription>Automated pattern maintenance — deletes stale/broken patterns, downranks low-quality ones</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleRunFixer} disabled={runningFixer} className="gap-2">
                {runningFixer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run Now
              </Button>
            </CardHeader>
            <CardContent>
              {/* Schedule & Last Run Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <Card className="border border-border/60">
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <CalendarClock className="h-[18px] w-[18px] text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Every 6 hours</p>
                      <p className="text-xs text-muted-foreground">Auto-trigger schedule (pg_cron)</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border border-border/60">
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="h-9 w-9 rounded-xl bg-green-500/10 flex items-center justify-center">
                      <Timer className="h-[18px] w-[18px] text-green-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {fixLog.length > 0 ? new Date(fixLog[0].created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last maintenance run{fixLog.length > 0 ? ` (${timeAgo(fixLog[0].created_at)})` : ""}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
              {fixLog.length === 0 ? (
                <EmptyState icon={Wrench} title="No fix actions recorded yet" description="Run the AI Fixer to automatically maintain pattern quality." />
              ) : (
                <>
                  {(() => {
                    const latestBatch = fixLog.filter((f: any) => {
                      const t = new Date(f.created_at).getTime();
                      const newest = new Date(fixLog[0].created_at).getTime();
                      return newest - t < 5000;
                    });
                    const successes = latestBatch.filter((f: any) => f.success).length;
                    const failures = latestBatch.filter((f: any) => !f.success).length;
                    return (
                      <div className="grid grid-cols-3 gap-4 mb-6">
                        <Card className="border-t-2 border-primary/40"><CardContent className="py-3 text-center"><p className="text-2xl font-bold tabular-nums">{latestBatch.length}</p><p className="text-xs text-muted-foreground">Processed</p></CardContent></Card>
                        <Card className="border-t-2 border-green-500/40"><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-green-500 tabular-nums">{successes}</p><p className="text-xs text-muted-foreground">Fixed</p></CardContent></Card>
                        <Card className="border-t-2 border-red-500/40"><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-red-500 tabular-nums">{failures}</p><p className="text-xs text-muted-foreground">Failed</p></CardContent></Card>
                      </div>
                    );
                  })()}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead>Selector</TableHead>
                        <TableHead>Issue</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fixLog.map((f: any, i: number) => (
                        <TableRow key={i} className={f.success ? "even:bg-muted/30" : "bg-red-500/5"}>
                          <TableCell className="text-xs text-muted-foreground">{timeAgo(f.created_at)}</TableCell>
                          <TableCell className="font-medium">{f.domain}</TableCell>
                          <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[180px] truncate inline-block">{f.selector}</code></TableCell>
                          <TableCell>
                            <Badge variant="outline" className={ISSUE_BADGE[f.issue_type]?.className ?? "bg-muted text-muted-foreground border-muted-foreground/30"}>
                              {ISSUE_BADGE[f.issue_type]?.label ?? f.issue_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{f.action_taken}</TableCell>
                          <TableCell className="text-right">
                            {f.success ? (
                              <Badge variant="outline" className="bg-green-600/15 text-green-600 border-green-600/30">Success</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-red-500/15 text-red-500 border-red-500/30">Failed</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
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
                    <Card className="border-t-2 border-amber-500/40"><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-amber-500 tabular-nums">{unresolvedReports.filter((r: any) => r.report_count >= 3).length}</p><p className="text-xs text-muted-foreground">Priority (3+ reports)</p></CardContent></Card>
                  </div>
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
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
