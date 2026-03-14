import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Clock, AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const statusColor: Record<string, string> = {
  Draft: "secondary",
  Submitted: "default",
  "In Review": "outline",
  "Issues Flagged": "destructive",
  Approved: "default",
};

export default function AdminDashboard() {
  const [stats, setStats] = useState({ total: 0, thisWeek: 0, needsReview: 0, approved: 0 });
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: all } = await supabase.from("seller_intakes").select("*").order("created_at", { ascending: false });
    if (!all) return;

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    setStats({
      total: all.length,
      thisWeek: all.filter((r) => new Date(r.created_at!) > weekAgo).length,
      needsReview: all.filter((r) => r.status === "Submitted" || r.status === "In Review").length,
      approved: all.filter((r) => r.status === "Approved").length,
    });
    setRecent(all.slice(0, 5));
  };

  const statCards = [
    { label: "Total Submissions", value: stats.total, icon: FileText, color: "text-primary", bg: "bg-primary/10" },
    { label: "New This Week", value: stats.thisWeek, icon: Clock, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Needs Review", value: stats.needsReview, icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-500/10" },
    { label: "Approved", value: stats.approved, icon: CheckCircle, color: "text-green-500", bg: "bg-green-500/10" },
  ];

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="space-y-8 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Amazon Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of marketplace seller intake submissions.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((s) => (
            <Card key={s.label} className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{s.label}</p>
                    <p className="text-3xl font-bold text-foreground mt-1">{s.value}</p>
                  </div>
                  <div className={`h-10 w-10 rounded-xl ${s.bg} flex items-center justify-center`}>
                    <s.icon className={`h-5 w-5 ${s.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

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
                  <TableRow key={r.id}>
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
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                      No submissions yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
