import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Clock, AlertTriangle, CheckCircle } from "lucide-react";

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
    { label: "Total Submissions", value: stats.total, icon: FileText, color: "text-primary" },
    { label: "New This Week", value: stats.thisWeek, icon: Clock, color: "text-blue-500" },
    { label: "Needs Review", value: stats.needsReview, icon: AlertTriangle, color: "text-yellow-500" },
    { label: "Approved", value: stats.approved, icon: CheckCircle, color: "text-green-500" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Amazon Dashboard</h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    <p className="text-3xl font-bold text-foreground">{s.value}</p>
                  </div>
                  <s.icon className={`h-8 w-8 ${s.color}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Submissions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to={`/admin/submissions/${r.id}`} className="text-primary hover:underline font-medium">
                        {r.business_legal_name || "Unnamed"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.client_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusColor[r.status] as any}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {recent.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
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
