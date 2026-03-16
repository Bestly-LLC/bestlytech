import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Clock, AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeFilter, filterByDateRange, type DateRange } from "@/components/admin/DateRangeFilter";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";

const statusColor: Record<string, string> = {
  Draft: "secondary",
  Submitted: "default",
  "In Review": "outline",
  "Issues Flagged": "destructive",
  Approved: "default",
};

export default function AdminDashboard() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  useAdminRealtime({
    tables: ["seller_intakes"],
    onNewRecord: (_table, record) => setData((prev) => [record, ...prev]),
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: all, error } = await supabase.from("seller_intakes").select("*").order("created_at", { ascending: false });
    if (error) toast({ title: "Failed to load submissions", description: error.message, variant: "destructive" });
    setData(all || []);
    setLoading(false);
  };

  const filtered = useMemo(() => filterByDateRange(data, dateRange), [data, dateRange]);

  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    return {
      total: filtered.length,
      thisWeek: filtered.filter((r) => new Date(r.created_at!) > weekAgo).length,
      needsReview: filtered.filter((r) => r.status === "Submitted" || r.status === "In Review").length,
      approved: filtered.filter((r) => r.status === "Approved").length,
    };
  }, [filtered]);

  const recent = filtered.slice(0, 5);

  const statCards = [
    { label: "Total Submissions", value: stats.total, icon: FileText, iconColor: "text-primary", iconBg: "bg-primary/10", accentColor: "border-primary/40" },
    { label: "New This Week", value: stats.thisWeek, icon: Clock, iconColor: "text-blue-500", iconBg: "bg-blue-500/10", accentColor: "border-blue-500/40" },
    { label: "Needs Review", value: stats.needsReview, icon: AlertTriangle, iconColor: "text-yellow-500", iconBg: "bg-yellow-500/10", accentColor: "border-yellow-500/40" },
    { label: "Approved", value: stats.approved, icon: CheckCircle, iconColor: "text-green-500", iconBg: "bg-green-500/10", accentColor: "border-green-500/40" },
  ];

  if (loading) {
    return (
      <div className="space-y-8 max-w-6xl">
        <div><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-72 mt-2" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Amazon Dashboard" description="Overview of marketplace seller intake submissions." />
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle className="text-base">Recent Submissions</CardTitle>
              <CardDescription className="text-xs">Latest intake submissions from clients.</CardDescription>
            </div>
            <Link to="/admin/submissions">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                View all <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Business Name</TableHead>
                  <TableHead className="text-xs">Contact</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id} className="even:bg-muted/30">
                    <TableCell>
                      <Link to={`/admin/submissions/${r.id}`} className="text-primary hover:underline font-medium text-sm">
                        {r.business_legal_name || "Unnamed"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.client_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusColor[r.status] as any} className="text-xs">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {recent.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="p-0">
                      <EmptyState icon={FileText} title="No submissions yet" description="Intake submissions will appear here once clients submit their information." />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <ActivityFeed />
      </div>
    </div>
  );
}
