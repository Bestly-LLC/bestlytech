import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

const STATUSES = ["All", "Draft", "Submitted", "In Review", "Issues Flagged", "Approved"];
const PAGE_SIZE = 20;

export default function AdminSubmissions() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: rows } = await supabase
      .from("seller_intakes")
      .select("*")
      .order("created_at", { ascending: false });
    setData(rows || []);
  };

  const filtered = data.filter((r) => {
    if (statusFilter !== "All" && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (r.business_legal_name || "").toLowerCase().includes(q) ||
        (r.client_name || "").toLowerCase().includes(q) ||
        (r.client_email || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Submissions</h1>
          <p className="text-sm text-muted-foreground mt-1">All marketplace seller intake submissions.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Business Name</TableHead>
                  <TableHead className="text-xs">Contact</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Platform</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Submitted</TableHead>
                  <TableHead className="text-xs">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to={`/admin/submissions/${r.id}`} className="text-primary hover:underline font-medium text-sm">
                        {r.business_legal_name || "Unnamed"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.client_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.client_email || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{r.platform}</Badge></TableCell>
                    <TableCell><Badge className="text-xs">{r.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.updated_at ? new Date(r.updated_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {paged.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12 text-sm">
                      No submissions found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              Page {page + 1} of {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
    </div>
  );
}
