import { useCallback, useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FileText, AlertTriangle, ArrowRight, Mail, Briefcase, Snowflake, Users,
  ShoppingBag, Store, Shield, Globe, Activity, Server, TrendingUp,
  Cookie, Cpu, Ban, CheckCircle2, Wifi, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";
import { SystemPulse } from "@/components/admin/SystemPulse";
import { ActionInbox } from "@/components/admin/ActionInbox";

const statusColor: Record<string, string> = {
  Draft: "text-white/55",
  Submitted: "text-blue-400",
  "In Review": "text-amber-400",
  "Issues Flagged": "text-red-400",
  Approved: "text-green-400",
};

/** Section header link, e.g. "Full dashboard →". Readable contrast and a 2.25rem hit area. */
function SectionLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="ghost" size="sm" className="ml-auto h-9 px-2 text-xs text-white/60 hover:text-white hover:bg-white/5">
      <Link to={to}>
        {children} <ArrowRight className="h-3 w-3 ml-1" aria-hidden />
      </Link>
    </Button>
  );
}

export default function AdminDashboard() {
  const [intakes, setIntakes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumping this remounts the self-loading panels (inbox, pulse, activity) so "Refresh now" reloads everything.
  const [refreshKey, setRefreshKey] = useState(0);
  const [contactCount, setContactCount] = useState(0);
  const [hireCount, setHireCount] = useState(0);
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [cySubCount, setCySubCount] = useState(0);
  const [activationCount, setActivationCount] = useState(0);

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
  const [pihole, setPihole] = useState<any>(null);
  const [passKeyCount, setPassKeyCount] = useState(0);
  // Real Active Users = today's DAU from product_events. null => unknown/unavailable.
  const [dau, setDau] = useState<number | null>(null);

  useAdminRealtime({
    tables: ["seller_intakes"],
    onNewRecord: (_table, record) => setIntakes((prev) => [record, ...prev]),
  });

  const loadData = useCallback(async () => {
    // Original queries
    const [intakesRes, contactsRes, hiresRes, waitlistRes, cySubsRes, activationsRes] = await Promise.all([
      supabase.from("seller_intakes").select("*").order("created_at", { ascending: false }),
      supabase.from("contact_submissions").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("hire_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("waitlist_subscribers").select("id", { count: "exact", head: true }),
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("activation_codes").select("id", { count: "exact", head: true }).eq("active", true),
    ]);
    const failed: string[] = [];
    if (intakesRes.error) failed.push("submissions");
    else setIntakes(intakesRes.data || []);
    if ([contactsRes, hiresRes, waitlistRes, cySubsRes, activationsRes].some((r) => r.error)) failed.push("request and subscriber counts");
    if (!contactsRes.error) setContactCount(contactsRes.count ?? 0);
    if (!hiresRes.error) setHireCount(hiresRes.count ?? 0);
    if (!waitlistRes.error) setWaitlistCount(waitlistRes.count ?? 0);
    if (!cySubsRes.error) setCySubCount(cySubsRes.count ?? 0);
    if (!activationsRes.error) setActivationCount(activationsRes.count ?? 0);

    // Super dashboard queries - CookieYeti
    const [patternsAll, patternsActive, unresolvedRes, dismissalsRes, aiGenRes] = await Promise.all([
      supabase.from("cookie_patterns").select("id", { count: "exact", head: true }),
      supabase.from("cookie_patterns").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("missed_banner_reports").select("id", { count: "exact", head: true }).eq("resolved", false),
      supabase.from("dismissal_reports").select("id", { count: "exact", head: true }),
      supabase.from("ai_generation_log").select("id", { count: "exact", head: true }),
    ]);
    if ([patternsAll, patternsActive, unresolvedRes, dismissalsRes, aiGenRes].some((r) => r.error)) failed.push("Cookie Yeti stats");
    if (!patternsAll.error) setPatternCount(patternsAll.count ?? 0);
    if (!patternsActive.error) setActivePatternCount(patternsActive.count ?? 0);
    if (!unresolvedRes.error) setUnresolvedCount(unresolvedRes.count ?? 0);
    if (!dismissalsRes.error) setDismissalCount(dismissalsRes.count ?? 0);
    if (!aiGenRes.error) setAiGenCount(aiGenRes.count ?? 0);

    // Devices, email, system
    const [devicesRes, pushRes, sentRes, failedRes, piholeRes, passkeysRes] = await Promise.all([
      supabase.from("device_registrations").select("id", { count: "exact", head: true }),
      supabase.from("device_tokens").select("id", { count: "exact", head: true }),
      supabase.from("email_send_log").select("id", { count: "exact", head: true }).eq("status", "sent"),
      supabase.from("email_send_log").select("id", { count: "exact", head: true }).eq("status", "failed"),
      (supabase.from("home_hub_pihole_stats" as any).select("*").order("captured_at", { ascending: false }).limit(1).single() as any),
      supabase.from("passkey_credentials" as any).select("id", { count: "exact", head: true }),
    ]);
    if ([devicesRes, pushRes, sentRes, failedRes, passkeysRes].some((r) => r.error)) failed.push("device and email stats");
    if (!devicesRes.error) setDeviceCount(devicesRes.count ?? 0);
    if (!pushRes.error) setPushCount(pushRes.count ?? 0);
    if (!sentRes.error) setEmailsSent(sentRes.count ?? 0);
    if (!failedRes.error) setEmailsFailed(failedRes.count ?? 0);
    if (piholeRes.data) setPihole(piholeRes.data);
    if (!passkeysRes.error) setPassKeyCount(passkeysRes.count ?? 0);

    // Active Users = today's DAU (anonymous product analytics), not a summed
    // activations+subs aggregate. null => unavailable (shown as "—").
    const dauRes = await supabase.rpc("cy_dau" as any, { days: 1 });
    if (dauRes.error || !Array.isArray(dauRes.data)) {
      setDau(null);
    } else {
      const rows = dauRes.data as any[];
      setDau(rows.length ? Number(rows[rows.length - 1].dau ?? 0) : 0);
    }

    setLoadError(failed.length ? `Couldn't load ${failed.join(", ")}. Showing the last values we have.` : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refreshAll = async () => {
    setRefreshKey((k) => k + 1);
    await loadData();
  };

  const stats = useMemo(() => {
    const getPlatforms = (r: any): string[] => r.selected_platforms?.length ? r.selected_platforms : [r.platform];
    return {
      total: intakes.length,
      needsReview: intakes.filter((r) => r.status === "Submitted" || r.status === "In Review").length,
      amazon: intakes.filter((r) => getPlatforms(r).some((p: string) => p.toLowerCase().includes("amazon"))).length,
      shopify: intakes.filter((r) => getPlatforms(r).some((p: string) => p.toLowerCase().includes("shopify"))).length,
    };
  }, [intakes]);

  const recent = intakes.slice(0, 5);

  if (loading) {
    return (
      <div className="space-y-8 max-w-7xl" aria-busy="true">
        <div><Skeleton className="h-8 w-48 bg-white/[0.05]" /><Skeleton className="h-4 w-72 mt-2 bg-white/[0.05]" /></div>
        <Skeleton className="h-12 rounded-2xl bg-white/[0.03]" />
        <Skeleton className="h-48 rounded-2xl bg-white/[0.03]" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-24 rounded-2xl bg-white/[0.03]" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl bg-white/[0.03]" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <PageHeader
        title="Command Center"
        description="What needs you, system health, and a glance across every Bestly product."
        actions={
          <ActionMenu
            label="More dashboard actions"
            items={[{ label: "Refresh now", icon: RefreshCw, onSelect: refreshAll }]}
          />
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0" aria-hidden />
          <p className="text-sm text-amber-100 flex-1 min-w-0">{loadError}</p>
          <Button size="sm" variant="outline" className="h-9 border-amber-400/30 text-amber-100 hover:bg-amber-500/10" onClick={() => loadData()}>
            Retry
          </Button>
        </div>
      )}

      {/* System health (live, polls every 60s). Unknown/error reads as unverified, never healthy. */}
      <SystemPulse key={`pulse-${refreshKey}`} />

      {/* What needs you right now */}
      <ActionInbox key={`inbox-${refreshKey}`} />

      {/* ─── CookieYeti Overview ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Snowflake className="h-4 w-4 text-sky-400" />
          <h3 className="text-xs font-semibold text-white/55 uppercase tracking-widest">CookieYeti</h3>
          <SectionLink to="/admin/cookie-yeti">Open</SectionLink>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Active Patterns" value={activePatternCount} icon={Cookie} accentColor="#8b5cf6" iconBg="bg-violet-500/10" iconColor="text-violet-400" subtitle={`${patternCount} total`} />
          <StatCard label="Dismissals" value={dismissalCount} icon={CheckCircle2} accentColor="#10b981" iconBg="bg-emerald-500/10" iconColor="text-emerald-400" />
          <StatCard label="AI Generations" value={aiGenCount} icon={Cpu} accentColor="#06b6d4" iconBg="bg-cyan-500/10" iconColor="text-cyan-400" />
          <StatCard label="Unresolved" value={unresolvedCount} icon={AlertTriangle} accentColor={unresolvedCount > 0 ? "#f59e0b" : "#10b981"} iconBg={unresolvedCount > 0 ? "bg-amber-500/10" : "bg-emerald-500/10"} iconColor={unresolvedCount > 0 ? "text-amber-400" : "text-emerald-400"} />
          <StatCard label="Devices" value={deviceCount} icon={Globe} iconBg="bg-white/[0.05]" iconColor="text-white/55" subtitle={`${pushCount} push-enabled`} />
        </div>
      </div>

      {/* ─── Revenue & Growth ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          <h3 className="text-xs font-semibold text-white/55 uppercase tracking-widest">Revenue & Growth</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard label="Active Users" value={dau === null ? "—" : dau} icon={Snowflake} accentColor="#38bdf8" iconBg="bg-sky-500/10" iconColor="text-sky-400" subtitle={dau === null ? "DAU unavailable" : `daily active · ${activationCount} activated, ${cySubCount} paid`} />
          <StatCard label="Waitlist" value={waitlistCount} icon={Users} accentColor="#8b5cf6" iconBg="bg-violet-500/10" iconColor="text-violet-400" />
          <StatCard label="Emails Sent" value={emailsSent} icon={Mail} accentColor="#10b981" iconBg="bg-emerald-500/10" iconColor="text-emerald-400" subtitle={emailsFailed > 0 ? `${emailsFailed} failed` : undefined} />
          <StatCard label="Passkeys" value={passKeyCount} icon={Shield} iconBg="bg-white/[0.05]" iconColor="text-white/55" />
        </div>
      </div>

      {/* ─── Operations ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-amber-400" />
          <h3 className="text-xs font-semibold text-white/55 uppercase tracking-widest">Operations</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="New Contacts" value={contactCount} icon={Mail} accentColor={contactCount > 0 ? "#22c55e" : undefined} iconBg="bg-white/[0.05]" iconColor="text-white/55" />
          <StatCard label="Hire Requests" value={hireCount} icon={Briefcase} accentColor={hireCount > 0 ? "#a78bfa" : undefined} iconBg="bg-white/[0.05]" iconColor="text-white/55" />
          <StatCard label="Intake Submissions" value={stats.total} icon={FileText} accentColor="#3b82f6" iconBg="bg-blue-500/10" iconColor="text-blue-400" subtitle={stats.needsReview > 0 ? `${stats.needsReview} need review` : undefined} />
          <StatCard label="Amazon" value={stats.amazon} icon={ShoppingBag} iconBg="bg-white/[0.05]" iconColor="text-white/55" />
          <StatCard label="Shopify" value={stats.shopify} icon={Store} iconBg="bg-white/[0.05]" iconColor="text-white/55" />
        </div>
      </div>

      {/* ─── Pi-hole Quick Glance ─── */}
      {pihole && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-blue-400" />
            <h3 className="text-xs font-semibold text-white/55 uppercase tracking-widest">Home Hub</h3>
            <SectionLink to="/admin/home-hub/pihole">Open Pi-hole</SectionLink>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="DNS Queries" value={(pihole.total_queries ?? 0).toLocaleString()} icon={Globe} iconBg="bg-blue-500/10" iconColor="text-blue-400" />
            <StatCard label="Blocked" value={(pihole.queries_blocked ?? 0).toLocaleString()} icon={Ban} accentColor="#ef4444" iconBg="bg-red-500/10" iconColor="text-red-400" subtitle={`${(pihole.percent_blocked ?? 0).toFixed(1)}%`} />
            <StatCard label="Blocklist" value={(pihole.domains_on_blocklist ?? 0).toLocaleString()} icon={Server} iconBg="bg-white/[0.05]" iconColor="text-white/55" />
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
              <h3 className="text-[0.9375rem] font-semibold text-white">Recent Submissions</h3>
              <p className="text-xs text-white/60 mt-0.5">Latest marketplace intake submissions.</p>
            </div>
            <Button asChild variant="ghost" size="sm" className="h-9 text-xs text-white/60 hover:text-white hover:bg-white/5">
              <Link to="/admin/submissions">View all <ArrowRight className="h-3 w-3 ml-1" aria-hidden /></Link>
            </Button>
          </div>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-white/[0.06]">
                  <TableHead className="text-[0.6875rem] text-white/60 uppercase tracking-wider">Business</TableHead>
                  <TableHead className="text-[0.6875rem] text-white/60 uppercase tracking-wider">Contact</TableHead>
                  <TableHead className="text-[0.6875rem] text-white/60 uppercase tracking-wider">Platform</TableHead>
                  <TableHead className="text-[0.6875rem] text-white/60 uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-[0.6875rem] text-white/60 uppercase tracking-wider">Date</TableHead>
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
                    <TableCell className="text-white/55 text-sm">{r.client_name || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(r.selected_platforms?.length ? r.selected_platforms : [r.platform]).map((p: string) => (
                          <span key={p} className="text-xs text-white/60 border border-white/10 rounded-full px-2 py-0.5">{p}</span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium ${statusColor[r.status] || "text-white/55"}`}>{r.status}</span>
                    </TableCell>
                    <TableCell className="text-white/60 text-sm">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {recent.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState icon={FileText} title="No submissions yet" description="When a seller starts the intake form, it shows up here." />
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
                  <span className={`text-xs font-medium shrink-0 ${statusColor[r.status] || "text-white/55"}`}>{r.status}</span>
                </div>
                <p className="text-xs text-white/60 mt-0.5">{r.client_name || "—"}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {(r.selected_platforms?.length ? r.selected_platforms : [r.platform]).map((p: string) => (
                    <span key={p} className="text-xs text-white/55 border border-white/10 rounded-full px-1.5 py-0">{p}</span>
                  ))}
                  <span className="text-xs text-white/55 ml-auto">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}</span>
                </div>
              </Link>
            ))}
            {recent.length === 0 && (
              <div className="p-4">
                <EmptyState icon={FileText} title="No submissions yet" description="When a seller starts the intake form, it shows up here." />
              </div>
            )}
          </div>
        </div>

        <ActivityFeed key={`activity-${refreshKey}`} />
      </div>
    </div>
  );
}
