import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search, FileText } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButton } from "@/components/admin/ExportButton";
import { useToast } from "@/hooks/use-toast";

const STATUSES = ["All", "Draft", "Submitted", "In Review", "Issues Flagged", "Approved"];
const PAGE_SIZE = 20;

const EXPORT_COLUMNS = [
  { key: "business_legal_name", label: "Business Name" },
  { key: "client_name", label: "Contact" },
  { key: "client_email", label: "Email" },
  { key: "platform", label: "Platform" },
  { key: "status", label: "Status" },
  { key: "created_at", label: "Submitted" },
  { key: "updated_at", label: "Updated" },
];

export default function AdminSubmissions() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: rows, error } = await supabase
      .from("seller_intakes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Failed to load submissions", description: error.message, variant: "destructive" });
    setData(rows || []);
    setLoading(false);
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

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const bulkUpdateStatus = async (newStatus: string) => {
    const ids = Array.from(selected);
    const { error } = await supabase
      .from("seller_intakes")
      .update({ status: newStatus })
      .in("id", ids);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Updated ${ids.length} submissions to "${newStatus}"` });
      setSelected(new Set());
      loadData();
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div><Skeleton className="h-7 w-40" /><Skeleton className="h-4 w-64 mt-2" /></div>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Submissions"
        description="All marketplace seller intake submissions."
        actions={<ExportButton data={filtered} filename="submissions" columns={EXPORT_COLUMNS} />}
      />

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

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <span className="text-muted-foreground">·</span>
          {["Submitted", "In Review", "Issues Flagged", "Approved"].map((status) => (
            <Button key={status} variant="outline" size="sm" className="text-xs h-7" onClick={() => bulkUpdateStatus(status)}>
              Mark {status}
            </Button>
          ))}
          <Button variant="ghost" size="sm" className="text-xs h-7 ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <Card className="border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={selected.size === paged.length && paged.length > 0}
                    onCheckedChange={(checked) => {
                      setSelected(checked ? new Set(paged.map((r) => r.id)) : new Set());
                    }}
                  />
                </TableHead>
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
                <TableRow key={r.id} className="even:bg-muted/30">
                  <TableCell>
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                  </TableCell>
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
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState icon={FileText} title="No submissions found" description="Try adjusting your search or filter criteria." />
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
