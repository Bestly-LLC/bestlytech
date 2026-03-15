import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Brain, RefreshCw, Globe, Target, TrendingUp, Shield, Clock, AlertTriangle, CircleAlert, CheckCircle2, Wrench, Flag, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
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
    setLoading(true);
    try {
      const [r1, r2, r3, r4, r5, r6, r7, r8, r9] = await Promise.all([
        supabase.rpc("get_community_overview" as any),
        supabase.rpc("get_daily_pattern_activity" as any, { p_days: 30 }),
        supabase.rpc("get_top_domains" as any, { p_limit: 25 }),
        supabase.rpc("get_recently_learned" as any, { p_limit: 50 }),
        supabase.rpc("get_pattern_issues" as any, { p_limit: 50 }),
        supabase.rpc("get_cmp_distribution" as any),
        supabase.rpc("get_action_type_stats" as any),
        supabase.rpc("get_confidence_distribution" as any),
        supabase.rpc("get_source_breakdown" as any),
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
    } catch (e) {
      console.error("Failed to fetch community data", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Brain className="h-12 w-12 text-primary animate-pulse" />
        <p className="text-muted-foreground text-sm">Loading community intelligence…</p>
      </div>
    );
  }

  const o = overview!;
  const issueCount = issues.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Community Learning</h1>
          <p className="text-muted-foreground text-sm">Cookie pattern intelligence from the Cookie Yeti network</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Total Patterns</CardDescription>
            <CardTitle className="text-3xl">{o.total_patterns}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">{o.patterns_last_7d} active last 7 days</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Domains Covered</CardDescription>
            <CardTitle className="text-3xl">{o.total_domains}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">{o.new_domains_last_7d} new this week</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Success Rate</CardDescription>
            <CardTitle className="text-3xl">{o.overall_success_rate}%</CardTitle>
          </CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">{Number(o.total_successes).toLocaleString()} / {Number(o.total_reports).toLocaleString()} interactions</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Avg Confidence</CardDescription>
            <CardTitle className="text-3xl">{o.avg_confidence ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">{o.high_confidence} high / {o.low_confidence} low</p></CardContent>
        </Card>
      </div>

      {/* Health Indicators */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-green-500/30">
          <CardContent className="flex items-center gap-3 py-4">
            <Clock className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-sm font-medium">{o.patterns_last_24h}</p>
              <p className="text-xs text-muted-foreground">Active last 24h</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium">{o.stale_patterns}</p>
              <p className="text-xs text-muted-foreground">Stale 30d+</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-500/30">
          <CardContent className="flex items-center gap-3 py-4">
            <CircleAlert className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-sm font-medium">{issueCount}</p>
              <p className="text-xs text-muted-foreground">Issues detected</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="activity" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="recent">Recent</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
        </TabsList>

        {/* Activity Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader><CardTitle className="text-lg">Pattern Activity (30 days)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activity}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Line type="monotone" dataKey="new_patterns" stroke="hsl(270,60%,55%)" strokeWidth={2} name="New Patterns" dot={false} />
                    <Line type="monotone" dataKey="new_domains" stroke="hsl(142,76%,36%)" strokeWidth={2} name="New Domains" dot={false} />
                    <Line type="monotone" dataKey="active_patterns" stroke="hsl(45,93%,47%)" strokeWidth={2} strokeDasharray="5 5" name="Active Patterns" dot={false} />
                    <Legend />
                  </LineChart>
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
                  {domains.map((d: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-muted-foreground" />{d.domain}</TableCell>
                      <TableCell className="text-right">{d.pattern_count}</TableCell>
                      <TableCell className="text-right">{Number(d.total_reports).toLocaleString()}</TableCell>
                      <TableCell className={`text-right font-medium ${rateColor(d.success_rate)}`}>{d.success_rate}%</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={d.avg_confidence * 100} className="h-2 w-16" />
                          <span className="text-xs text-muted-foreground">{d.avg_confidence}</span>
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
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.domain}</TableCell>
                        <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate inline-block">{r.selector}</code></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={ACTION_BADGE_VARIANT[r.action_type] ?? ""}>{r.action_type}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.cmp_fingerprint}</TableCell>
                        <TableCell className="text-right">{r.confidence}</TableCell>
                        <TableCell className="text-right">{r.report_count}</TableCell>
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
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                  <p className="text-muted-foreground font-medium">No issues detected!</p>
                </div>
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
                        <TableRow key={i}>
                          <TableCell><Badge variant="outline" className={issue.className}>{issue.label}</Badge></TableCell>
                          <TableCell className="font-medium">{p.domain}</TableCell>
                          <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[180px] truncate inline-block">{p.selector}</code></TableCell>
                          <TableCell><Badge variant="outline" className={ACTION_BADGE_VARIANT[p.action_type] ?? ""}>{p.action_type}</Badge></TableCell>
                          <TableCell className="text-right">{p.confidence}</TableCell>
                          <TableCell className="text-right">{p.report_count}</TableCell>
                          <TableCell className={`text-right font-medium ${rateColor(p.success_rate ?? 0)}`}>{p.success_rate ?? 0}%</TableCell>
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
            {/* Confidence Histogram */}
            <Card>
              <CardHeader><CardTitle className="text-lg">Confidence Distribution</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={confDist}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
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

            {/* Action Type Donut */}
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
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* CMP Fingerprints Table */}
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
                      <TableRow key={i}>
                        <TableCell className="font-medium">{c.cmp_fingerprint}</TableCell>
                        <TableCell className="text-right">{c.pattern_count}</TableCell>
                        <TableCell className="text-right">{c.domain_count}</TableCell>
                        <TableCell className="text-right">{c.avg_confidence}</TableCell>
                        <TableCell className={`text-right font-medium ${rateColor(c.success_rate)}`}>{c.success_rate}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Source Breakdown Bar */}
            <Card>
              <CardHeader><CardTitle className="text-lg">Source Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sourceDist} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="source" tick={{ fontSize: 11 }} width={80} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                      <Bar dataKey="count" name="Patterns" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
