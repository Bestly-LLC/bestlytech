import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Clock, AlertTriangle, CheckCircle, ArrowRight, Mail, Briefcase, Snowflake, Users, ShoppingBag, Store, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  useAdminRealtime({
    tables: ["seller_intakes"],
    onNewRecord: (_table, record) => setIntakes((prev) => [record, ...prev]),
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
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

  const statCards = [
    { label: "Intake Submissions", value: stats.total, icon: FileText },
    { label: "Needs Review", value: stats.needsReview, icon: AlertTriangle },
    { label: "Amazon", value: stats.amazon, icon: ShoppingBag },
    { label: "Shopify", value: stats.shopify, icon: Store },
    { label: "TikTok", value: stats.tiktok, icon: Video },
    { label: "New Contacts", value: contactCount, icon: Mail },
    { label: "Hire Requests", value: hireCount, icon: Briefcase },
    { label: "CY Subscribers", value: cySubCount, icon: Snowflake },
    { label: "Waitlist", value: waitlistCount, icon: Users },
  ];

  if (loading) {
    return (
      <div className="space-y-8 max-w-6xl">
        <div><Skeleton className="h-7 w-48 bg-white/[0.05]" /><Skeleton className="h-4 w-72 mt-2 bg-white/[0.05]" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-24 rounded-2xl bg-white/[0.03]" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl bg-white/[0.03]" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Dashboard" description="Overview across all products and services." />
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {statCards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

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
