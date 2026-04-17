import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FileText, Clock, AlertTriangle, CheckCircle, ArrowRight, Mail, Briefcase, Snowflake, Users,
  ShoppingBag, Store, Video, Shield, Zap, Globe, Activity, Server, TrendingUp,
  Cookie, Cpu, Ban, CheckCircle2, Wifi, WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeFilter, filterByDateRange, type DateRange } from "@/components/admin/DateRangeFilter";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";

const statusColor: Record<string, string> = {
  Draft: "text-white/40",
  Submitted: "text-blue-400",
  "In Review": "text-amber-400",
  "Issues Flagged": "text-red-400",
  Approved: "text-green-400",
};

export default function AdminDashboard() {
  const { toast } = useToast();
  const [intakes, setIntakes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [contactCount, setContactCount] = useState(0);
  const [hireCount, setHireCount] = useState(0);
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [cySubCount, setCySubCount] = useState(0);

  // New super dashboard state
  const [patternCount, setPatternCount] = useState(0);
  const [activePatternCount, setActivePatternCount] = useState(0);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [dismissalCount, setDismissalCount] = useState(0);
  const [aiGenCount, setAiGenCount] = useState(0);
  const [deviceCount, setDeviceCount] = useState(0);
  const [pushCount, setPushCount] = useState(0);
  const [emailsSent, setEmailsSent] = useState(0);
  const [emailsFailed, setEmailsFailed] = useState(0);
  const [systemDown, setSystemDown] = useState(false);
  const [downSystems, setDownSystems] = useState<string[]>([]);
  const [pihole, setPihole] = useState<any>(null);
  const [userCount, setUserCount] = useState(0);
  const [passKeyCount, setPassKeyCount] = useState(0);

  useAdminRealtime({
    tables: ["seller_intakes"],
    onNewRecord: (_table, record) => setIntakes((prev) => [record, ...prev]),
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // Original queries
    const [intakesRes, contactsRes, hiresRes, waitlistRes, cySubsRes] = await Promise.all([
      supabase.from("seller_intakes").select("*").order("created_at", { ascending: false }),
      supabase.from("contact_submissions").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("hire_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("waitlist_subscribers").select("id", { count: "exact", head: true }),
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]);
    if (intakesRes.error) toast({ title: "Failed to load", description: intakesRes.error.message, variant: "destructive" });
    setIntakes(intakesRes.data || []);
    setContactCount(contactsRes.count ?? 0);
    setHireCount(hiresRes.count ?? 0);
    setWaitlistCount(waitlistRes.count ?? 0);
    setCySubCount(cySubsRes.count ?? 0);

    // Super dashboard queries - CookieYeti
    const [patternsAll, patternsActive, unresolvedRes, dismissalsRes, aiGenRes] = await Promise.all([
      supabase.from("cookie_patterns").select("id", { count: "exact", head: true }),
      supabase.from("cookie_patterns").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("missed_banner_reports").select("id", { count: "exact", head: true }).eq("resolved", false),
      supabase.from("dismissal_reports").select("id", { count: "exact", head: true }),
      supabase.from("ai_generation_log").select("id", { count: "exact", head: true }),
    ]);
    // Log any CookieYeti query errors for debugging
    [patternsAll, patternsActive, unresolvedRes, dismissalsRes, aiGenRes].forEach((r, i) => {
      if (r.error) console.error(`[CY Query ${i}]`, r.error.message);
    });
    setPatternCount(patternsAll.count ?? 0);
    setActivePatternCount(patternsActive.count ?? 0);
    setUnresolvedCount(unresolvedRes.count ?? 0);
    setDismissalCount(dismissalsRes.count ?? 0);
    setAiGenCount(aiGenRes.count ?? 0);

    // Devices, email, system
    const [devicesRes, pushRes, sentRes, failedRes, sysRes, piholeRes, usersRes, passkeysRes] = await Promise.all([
      supabase.from("device_registrations").select("id", { count: "exact", head: true }),
      supabase.from("device_tokens").select("id", { count: "exact", head: true }),
      supabase.from("email_send_log").select("id", { count: "exact", head: true }).eq("status", "sent"),
      supabase.from("email_send_log").select("id", { count: "exact", head: true }).eq("status", "failed"),
      (supabase.from("system_alert_state" as any).select("*").eq("id", 1).single() as any),
      (supabase.from("home_hub_pihole_stats" as any).select("*").order("captured_at", { ascending: false }).limit(1).single() as any),
      supabase.from("passkey_credentials" as any).select("id", { count: "exact", head: true }),
      supabase.from("passkey_credentials" as any).select("id", { count: "exact", head: true }),
    ]);
    // Log any ops query errors for debugging
    [devicesRes, pushRes, sentRes, failedRes, sysRes, piholeRes, usersRes, passkeysRes].forEach((r, i) => {
      if (r.error) console.error(`[Ops Query ${i}]`, r.error.message);
    });
    setDeviceCount(devicesRes.count ?? 0);
    setPushCount(pushRes.count ?? 0);
    setEmailsSent(sentRes.count ?? 0);
    setEmailsFailed(failedRes.count ?? 0);
    if (sysRes.data) {
      setSystemDown(sysRes.data.is_down ?? false);
      setDownSystems(sysRes.data.down_systems ?? []);
    }
    if (piholeRes.data) setPihole(piholeRes.data);
    setUserCount(usersRes.count ?? 0);
    setPassKeyCount(passkeysRes.count ?? 0);

    setLoading(false);
  };

  const filtered = useMemo(() => filterByDateRange(intakes, dateRange), [intakes, dateRange]);

  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const getPlatforms = (r: any): string[] => r.selected_platforms?.length ? r.selected_platforms : [r.platform];
    return {
      total: filtered.length,
      thisWeek: filtered.filter((r) => new Date(r.created_at!) > weekAgo).length,
      needsReview: filtered.filter((r) => r.status === "Submitted" || r.status === "In Review").length,
      approved: filtered.filter((r) => r.status === "Approved").length,
      amazon: filtered.filter((r) => getPlatforms(r).some((p: string) => p.toLowerCase().includes("amazon"))).length,
      shopify: filtered.filter((r) => getPlatforms(r).some((p: string) => p.toLowerCase().includes("shopify"))).length,
      tiktok: filtered.filter((r) => getPlatforms(r).some((p: string) => p.toLowerCase().includes("tiktok"))).length,
    };
  }, [filtered]);

  const recent = filtered.slice(0, 5);

  if (loading) {
    return (
      <div className="space-y-8 max-w-7xl">
        <div><Skeleton className="h-7 w-48 bg-white/[0.05]" /><Skeleton className="h-4 w-72 mt-2 bg-white/[0.05]" /></div>
        <Skeleton className="h-12 rounded-2xl bg-white/[0.03]" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-24 rounded-2xl bg-white/[0.03]" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl bg-white/[0.03]" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Command Center" description="Unified overview across all Bestly products and services." />
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* System Health Banner */}
      <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl border ${
        systemDown
          ? "bg-red-500/5 border-red-500/20"
          : "bg-emerald-500/5 border-emerald-500/20"
      }`}>
        {systemDown ? (
          <WifiOff className="h-4 w-4 text-red-400 shrink-0" />
        ) : (
          <Wifi className="h-4 w-4 text-emerald-400 shrink-0" />
        )}
        <span className={`text-sm font-medium ${systemDown ? "text-red-400" : "text-emerald-400"}`}>
          {systemDown ? `System Alert: ${downSystems.join(", ") || "Issue detected"}` : "All Systems Operational"}
        </span>
        <span className="text-xs text-white/20 ml-auto hidden sm:inline">
          26 edge functions &middot; 28 tables &middot; RLS active
        </span>
      </div>

      {/* ─── CookieYeti Overview ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Snowflake className="h-4 w-4 text-sky-400" />
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest">CookieYeti</h3>
          <Link to="/admin/cookie-yeti" className="ml-auto">
            <Button variant="ghost" size="sm" className="text-xs text-white/20 hover:text-white hover:bg-white/5 h-6 px-2">
              Full Dashboard <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Active Patterns" value={activePatternCount} icon={Cookie} accentColor="#8b5cf6" iconBg="bg-violet-500/10" iconColor="text-violet-400" subtitle={`${patternCount} total`} />
          <StatCard label="Dismissals" value={dismissalCount} icon={CheckCircle2} accentColor="#10b981" iconBg="bg-emerald-500/10" iconColor="text-emerald-400" />
          <StatCard label="AI Generations" value={aiGenCount} icon={Cpu} accentColor="#06b6d4" iconBg="bg-cyan-500/10" iconColor="text-cyan-400" />
          <StatCard label="Unresolved" value={unresolvedCount} icon={AlertTriangle} accentColor={unresolvedCount > 0 ? "#f59e0b" : "#10b981"} iconBg={unresolvedCount > 0 ? "bg-amber-500/10" : "bg-emerald-500/10"} iconColor={unresolvedCount > 0 ? "text-amber-400" : "text-emerald-400"} />
          <StatCard label="CY Subscribers" value={cySubCount} icon={Snowflake} accentColor="#38bdf8" iconBg="bg-sky-500/10" iconColor="text-sky-400" />
          <StatCard label="Devices" value={deviceCount} icon={Globe} iconBg="bg-white/[0.05]" iconColor="text-white/40" subtitle={`${pushCount} push-enabled`} />
        </div>
      </div>

      {/* ─── Revenue & Growth ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest">Revenue & Growth</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard label="Active Subs" value={cySubCount} icon={Snowflake} accentColor="#38bdf8" iconBg="bg-sky-500/10" iconColor="text-sky-400" />
          <StatCard label="Waitlist" value={waitlistCount} icon={Users} accentColor="#8b5cf6" iconBg="bg-violet-500/10" iconColor="text-violet-400" />
          <StatCard label="Emails Sent" value={emailsSent} icon={Mail} accentColor="#10b981" iconBg="bg-emerald-500/10" iconColor="text-emerald-400" subtitle={emailsFailed > 0 ? `${emailsFailed} failed` : undefined} />
          <StatCard label="Passkeys" value={passKeyCount} icon={Shield} iconBg="bg-white/[0.05]" iconColor="text-white/40" />
        </div>
      </div>

      {/* ─── Operations ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-amber-400" />
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest">Operations</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="New Contacts" value={contactCount} icon={Mail} accentColor={contactCount > 0 ? "#22c55e" : undefined} iconBg="bg-white/[0.05]" iconColor="text-white/40" />
          <StatCard label="Hire Requests" value={hireCount} icon={Briefcase} accentColor={hireCount > 0 ? "#a78bfa" : undefined} iconBg="bg-white/[0.05]" iconColor="text-white/40" />
          <StatCard label="Intake Submissions" value={stats.total} icon={FileText} accentColor="#3b82f6" iconBg="bg-blue-500/10" iconColor="text-blue-400" subtitle={stats.needsReview > 0 ? `${stats.needsReview} need review` : undefined} />
          <StatCard label="Amazon" value={stats.amazon} icon={ShoppingBag} iconBg="bg-white/[0.05]" iconColor="text-white/40" />
          <StatCard label="Shopify" value={stats.shopify} icon={Store} iconBg="bg-white/[0.05]" iconColor="text-white/40" />
        </div>
      </div>

      {/* ─── Pi-hole Quick Glance ─── */}
      {pihole && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-blue-400" />
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest">Home Hub</h3>
            <Link to="/admin/home-hub/pihole" className="ml-auto">
              <Button variant="ghost" size="sm" className="text-xs text-white/20 hover:text-white hover:bg-white/5 h-6 px-2">
                Pi-hole <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="DNS Queries" value={(pihole.total_queries ?? 0).toLocaleString()} icon={Globe} iconBg="bg-blue-500/10" iconColor="text-blue-400" />
            <StatCard label="Blocked" value={(pihole.queries_blocked ?? 0).toLocaleString()} icon={Ban} accentColor="#ef4444" iconBg="bg-red-500/10" iconColor="text-red-400" subtitle={`${(pihole.percent_blocked ?? 0).toFixed(1)}%`} />
            <StatCard label="Blocklist" value={(pihole.domains_on_blocklist ?? 0).toLocaleString()} icon={Server} iconBg="bg-white/[0.05]" iconColor="text-white/40" />
            <StatCard label="Clients" value={pihole.active_clients ?? 0} icon={Wifi} accentColor={pihole.status === "enabled" ? "#10b981" : "#ef4444"} iconBg="bg-emerald-500/10" iconColor="text-emerald-400" subtitle={pihole.status ?? "unknown"} />
          </div>
        </div>
      )}

      {/* ─── Recent Activity + Submissions ─── */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Submissions */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h3 className="text-[15px] font-semibold text-white">Recent Submissions</h3>
              <p className="text-xs text-white/30 mt-0.5">Latest marketplace intake submissions.</p>
            </div>
            <Link to="/admin/submissions">
              <Button variant="ghost" size="sm" className="text-xs text-white/30 hover:text-white hover:bg-white/5 border-0">
                View all <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-white/[0.06]">
                  <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Business</TableHead>
                  <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Contact</TableHead>
                  <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Platform</TableHead>
                  <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-[11px] text-white/25 uppercase tracking-wider">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <TableCell>
                      <Link to={`/admin/submissions/${r.id}`} className="text-white hover:text-white/80 font-medium text-sm transition-colors">
                        {r.business_legal_name || "Unnamed"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-white/40 text-sm">{r.client_name || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(r.selected_platforms?.length ? r.selected_platforms : [r.platform]).map((p: string) => (
                          <span key={p} className="text-xs text-white/50 border border-white/10 rounded-full px-2 py-0.5">{p}</span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium ${statusColor[r.status] || "text-white/40"}`}>{r.status}</span>
                    </TableCell>
                    <TableCell className="text-white/30 text-sm">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {recent.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState icon={FileText} title="No submissions yet" description="Intake submissions will appear here once clients submit their information." />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {recent.map((r) => (
              <Link key={r.id} to={`/admin/submissions/${r.id}`} className="block p-3 hover:bg-white/[0.03] transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-white truncate">{r.business_legal_name || "Unnamed"}</p>
                  <span className={`text-[10px] font-medium shrink-0 ${statusColor[r.status] || "text-white/40"}`}>{r.status}</span>
                </div>
                <p className="text-xs text-white/30 mt-0.5">{r.client_name || "—"}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {(r.selected_platforms?.length ? r.selected_platforms : [r.platform]).map((p: string) => (
                    <span key={p} className="text-[10px] text-white/40 border border-white/10 rounded-full px-1.5 py-0">{p}</span>
                  ))}
                  <span className="text-[10px] text-white/20 ml-auto">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}</span>
                </div>
              </Link>
            ))}
            {recent.length === 0 && (
              <div className="p-4">
                <EmptyState icon={FileText} title="No submissions yet" description="Intake submissions will appear here once clients submit their information." />
              </div>
            )}
          </div>
        </div>

        <ActivityFeed />
      </div>
    </div>
  );
}
