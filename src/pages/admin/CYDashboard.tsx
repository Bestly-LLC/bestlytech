import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Crown, Users, ShieldCheck, Calendar, Plus, ArrowRight, Cookie, Cpu, AlertTriangle,
  CheckCircle2, Globe, Zap, Ban, Target,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeFilter, filterByDateRange, type DateRange } from "@/components/admin/DateRangeFilter";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";

export default function CYDashboard() {
  const [subs, setSubs] = useState<any[]>([]);
  const [grants, setGrants] = useState<any[]>([]);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const { toast } = useToast();

  // New CookieYeti Command Center state
  const [patternCount, setPatternCount] = useState(0);
  const [activePatternCount, setActivePatternCount] = useState(0);
  const [dismissalCount, setDismissalCount] = useState(0);
  const [aiGenCount, setAiGenCount] = useState(0);
  const [aiSuccessCount, setAiSuccessCount] = useState(0);
  const [fixCount, setFixCount] = useState(0);
  const [unresolvedReports, setUnresolvedReports] = useState<any[]>([]);
  const [topPatterns, setTopPatterns] = useState<any[]>([]);
  const [deviceCount, setDeviceCount] = useState(0);
  const [pushCount, setPushCount] = useState(0);
  const [activationCount, setActivationCount] = useState(0);

  useAdminRealtime({
    tables: ["subscriptions", "granted_access"],
    onNewRecord: (table, record) => {
      if (table === "subscriptions") setSubs((p) => [record, ...p]);
      if (table === "granted_access") setGrants((p) => [record, ...p]);
    },
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // Original data
    const [{ data: s }, { data: g }] = await Promise.all([
      supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
      supabase.from("granted_access").select("*").order("created_at", { ascending: false }),
    ]);
    setSubs(s || []);
    setGrants(g || []);

    // CookieYeti Command Center data
    const [
      pAll, pActive, dCount, aiAll, aiSuccess, fixes,
      missed, patterns, devices, push, activations,
    ] = await Promise.all([
      supabase.from("cookie_patterns").select("id", { count: "exact", head: true }),
      supabase.from("cookie_patterns").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("dismissal_reports").select("id", { count: "exact", head: true }),
      supabase.from("ai_generation_log").select("id", { count: "exact", head: true }),
      supabase.from("ai_generation_log").select("id", { count: "exact", head: true }).eq("status", "success"),
      supabase.from("pattern_fix_log").select("id", { count: "exact", head: true }).eq("success", true),
      (supabase.from("missed_banner_reports").select("*").eq("resolved", false).order("report_count", { ascending: false }).limit(10) as any),
      (supabase.from("cookie_patterns").select("*").eq("is_active", true).order("report_count", { ascending: false }).limit(10) as any),
      supabase.from("device_registrations").select("id", { count: "exact", head: true }),
      supabase.from("device_tokens").select("id", { count: "exact", head: true }),
      supabase.from("activation_codes").select("id", { count: "exact", head: true }).eq("active", true),
    ]);

    // Log any query errors for debugging
    [pAll, pActive, dCount, aiAll, aiSuccess, fixes, missed, patterns, devices, push, activations].forEach((r, i) => {
      if (r.error) console.error(`[CY Dashboard Query ${i}]`, r.error.message);
    });
    setPatternCount(pAll.count ?? 0);
    setActivePatternCount(pActive.count ?? 0);
    setDismissalCount(dCount.count ?? 0);
    setAiGenCount(aiAll.count ?? 0);
    setAiSuccessCount(aiSuccess.count ?? 0);
    setFixCount(fixes.count ?? 0);
    setUnresolvedReports(missed.data || []);
    setTopPatterns(patterns.data || []);
    setDeviceCount(devices.count ?? 0);
    setPushCount(push.count ?? 0);
    setActivationCount(activations.count ?? 0);

    setLoading(false);
  };

  const handleGrant = async () => {
    if (!grantEmail) return;
    const { error } = await supabase.from("granted_access").insert({
      email: grantEmail.trim().toLowerCase(),
      granted_by: "admin",
      reason: grantReason || null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Access Granted" });
      setGrantEmail("");
      setGrantReason("");
      setDialogOpen(false);
      loadData();
    }
  };

  const filteredSubs = useMemo(() => filterByDateRange(subs, dateRange), [subs, dateRange]);
  const filteredGrants = useMemo(() => filterByDateRange(grants, dateRange), [grants, dateRange]);

  const activeSubs = filteredSubs.filter((s) => s.status === "active");
  const monthly = activeSubs.filter((s) => s.plan === "monthly").length;
  const yearly = activeSubs.filter((s) => s.plan === "yearly").length;
  const lifetime = activeSubs.filter((s) => s.plan === "lifetime").length;
  const aiSuccessRate = aiGenCount > 0 ? ((aiSuccessCount / aiGenCount) * 100).toFixed(1) : "N/A";

  const getPriority = (count: number) => {
    if (count >= 10) return { label: "critical", color: "destructive" as const };
    if (count >= 5) return { label: "high", color: "default" as const };
    if (count >= 2) return { label: "medium", color: "secondary" as const };
    return { label: "low", color: "outline" as const };
  };

  if (loading) {
    return (
      <div className="space-y-8 max-w-7xl">
        <div><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-72 mt-2" /></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          title="CookieYeti Command Center"
          description="Pattern management, AI pipeline, subscribers, and cross-platform metrics."
          actions={
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Grant Access</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Grant Premium Access</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Email</Label>
                    <Input value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} placeholder="user@example.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Reason</Label>
                    <Textarea value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="Why grant access?" rows={2} />
                  </div>
                  <Button onClick={handleGrant} className="w-full">Grant Access</Button>
                </div>
              </DialogContent>
            </Dialog>
          }
        />
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* ─── Pattern & AI Stats ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Cookie className="h-4 w-4 text-violet-400" />
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest">Pattern Engine</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Active Patterns" value={activePatternCount} icon={Cookie} accentColor="#8b5cf6" iconBg="bg-violet-500/10" iconColor="text-violet-400" subtitle={`${patternCount} total`} />
          <StatCard label="Dismissals" value={dismissalCount} icon={CheckCircle2} accentColor="#10b981" iconBg="bg-emerald-500/10" iconColor="text-emerald-400" />
          <StatCard label="AI Generations" value={aiGenCount} icon={Cpu} accentColor="#06b6d4" iconBg="bg-cyan-500/10" iconColor="text-cyan-400" subtitle={`${aiSuccessRate}% success`} />
          <StatCard label="Pattern Fixes" value={fixCount} icon={Zap} accentColor="#f59e0b" iconBg="bg-amber-500/10" iconColor="text-amber-400" />
          <StatCard label="Unresolved" value={unresolvedReports.length} icon={AlertTriangle} accentColor={unresolvedReports.length > 0 ? "#ef4444" : "#10b981"} iconBg={unresolvedReports.length > 0 ? "bg-red-500/10" : "bg-emerald-500/10"} iconColor={unresolvedReports.length > 0 ? "text-red-400" : "text-emerald-400"} />
          <StatCard label="Activations" value={activationCount} icon={Target} iconBg="bg-white/[0.05]" iconColor="text-white/40" subtitle={`${deviceCount} devices, ${pushCount} push`} />
        </div>
      </div>

      {/* ─── Subscriber Stats ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Crown className="h-4 w-4 text-yellow-400" />
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest">Subscribers</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Total Premium" value={activeSubs.length + filteredGrants.length} icon={Crown} iconColor="text-yellow-500" iconBg="bg-yellow-500/10" accentColor="#eab308" />
          <StatCard label="Paid" value={activeSubs.length} icon={Users} iconColor="text-primary" iconBg="bg-primary/10" accentColor="#3b82f6" />
          <StatCard label="Granted" value={filteredGrants.length} icon={ShieldCheck} iconColor="text-green-500" iconBg="bg-green-500/10" accentColor="#22c55e" />
          <StatCard label="Monthly" value={monthly} icon={Calendar} iconColor="text-blue-500" iconBg="bg-blue-500/10" />
          <StatCard label="Yearly / Lifetime" value={`${yearly} / ${lifetime}`} icon={Calendar} iconColor="text-purple-500" iconBg="bg-purple-500/10" />
        </div>
      </div>

      {/* ─── Missed Banner Queue ─── */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <div>
              <h3 className="text-[15px] font-semibold text-white">Missed Banner Queue</h3>
              <p className="text-xs text-white/30 mt-0.5">Unresolved reports sorted by urgency.</p>
            </div>
          </div>
          <Link to="/admin/cookie-yeti/community">
            <Button variant="ghost" size="sm" className="text-xs text-white/30 hover:text-white hover:bg-white/5 border-0">
              Community <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-white/[0.06]">
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Priority</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Domain</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Reports</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">AI Tries</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">CMP</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Last Reported</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unresolvedReports.map((r) => {
              const p = getPriority(r.report_count);
              return (
                <TableRow key={r.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <TableCell><Badge variant={p.color} className="text-[10px] uppercase">{p.label}</Badge></TableCell>
                  <TableCell className="text-sm text-white font-medium">{r.domain}</TableCell>
                  <TableCell className="text-sm text-white/60 tabular-nums">{r.report_count}</TableCell>
                  <TableCell className="text-sm text-white/60 tabular-nums">{r.ai_attempts ?? 0}</TableCell>
                  <TableCell className="text-xs text-white/40">{r.cmp_fingerprint ?? "unknown"}</TableCell>
                  <TableCell className="text-sm text-white/30">{r.last_reported ? new Date(r.last_reported).toLocaleDateString() : "—"}</TableCell>
                </TableRow>
              );
            })}
            {unresolvedReports.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="p-0">
                  <EmptyState icon={CheckCircle2} title="All clear!" description="No unresolved missed banner reports." />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─── Top Patterns ─── */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="text-[15px] font-semibold text-white">Top Patterns</h3>
          <p className="text-xs text-white/30 mt-0.5">Most-used cookie banner patterns by report count.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-white/[0.06]">
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Domain</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Selector</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Action</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Confidence</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Reports</TableHead>
              <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topPatterns.map((p) => (
              <TableRow key={p.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <TableCell className="text-sm text-white font-medium">{p.domain}</TableCell>
                <TableCell>
                  <code className="text-[11px] text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded max-w-[200px] truncate block">{p.selector}</code>
                </TableCell>
                <TableCell className="text-xs text-white/50">{p.action_type}</TableCell>
                <TableCell>
                  <span className={`text-sm font-medium tabular-nums ${p.confidence >= 7 ? "text-emerald-400" : p.confidence >= 4 ? "text-amber-400" : "text-red-400"}`}>
                    {p.confidence}/10
                  </span>
                </TableCell>
                <TableCell className="text-sm text-white/60 tabular-nums">{p.report_count}</TableCell>
                <TableCell>
                  <Badge variant={p.source === "ai" ? "default" : "secondary"} className="text-[10px]">{p.source}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {topPatterns.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="p-0">
                  <EmptyState icon={Cookie} title="No patterns yet" description="Patterns will appear as CookieYeti users report cookie banners." />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─── Subscribers & Grants ─── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-sm font-semibold">Recent Subscribers</CardTitle>
              <CardDescription className="text-xs">Latest paid subscriptions.</CardDescription>
            </div>
            <Link to="/admin/cookie-yeti/subscribers">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7">
                View all <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Plan</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSubs.slice(0, 5).map((s) => (
                  <TableRow key={s.id} className="even:bg-muted/30">
                    <TableCell className="text-sm">{s.email}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{s.plan}</Badge></TableCell>
                    <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"} className="text-xs">{s.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {filteredSubs.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="p-0"><EmptyState icon={Users} title="No subscribers" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-sm font-semibold">Recently Granted</CardTitle>
              <CardDescription className="text-xs">Manual premium access grants.</CardDescription>
            </div>
            <Link to="/admin/cookie-yeti/granted">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7">
                View all <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGrants.slice(0, 5).map((g) => (
                  <TableRow key={g.id} className="even:bg-muted/30">
                    <TableCell className="text-sm">{g.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{g.reason || "—"}</TableCell>
                  </TableRow>
                ))}
                {filteredGrants.length === 0 && (
                  <TableRow><TableCell colSpan={2} className="p-0"><EmptyState icon={ShieldCheck} title="No granted access" /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
