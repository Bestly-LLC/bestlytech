import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search, FileText, ArrowUp, ArrowDown, MoreHorizontal, Archive, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButton } from "@/components/admin/ExportButton";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const STATUSES = ["All", "Draft", "Submitted", "In Review", "Issues Flagged", "Approved", "Archived"];
const PLATFORMS = ["All", "Amazon", "Shopify", "TikTok"];
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

type SortKey = "business_legal_name" | "client_name" | "status" | "created_at" | "updated_at";
type SortDir = "asc" | "desc";

export default function AdminSubmissions() {
  const [data, setData] = useState<any[]>([]);
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [{ data: rows, error }, { data: docRows }] = await Promise.all([
      supabase.from("seller_intakes").select("*").order("created_at", { ascending: false }),
      supabase.from("intake_documents").select("intake_id"),
    ]);
    if (error) toast({ title: "Failed to load submissions", description: error.message, variant: "destructive" });
    setData(rows || []);
    const counts: Record<string, number> = {};
    (docRows || []).forEach((d: any) => {
      counts[d.intake_id] = (counts[d.intake_id] || 0) + 1;
    });
    setDocCounts(counts);
    setLoading(false);
  };

  const filtered = data
    .filter((r) => {
      if (statusFilter !== "All" && r.status !== statusFilter) return false;
      if (platformFilter !== "All") {
        const platforms = r.selected_platforms?.length ? r.selected_platforms : [r.platform];
        if (!platforms.some((p: string) => p.toLowerCase().includes(platformFilter.toLowerCase()))) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          (r.business_legal_name || "").toLowerCase().includes(q) ||
          (r.client_name || "").toLowerCase().includes(q) ||
          (r.client_email || "").toLowerCase().includes(q) ||
          (r.client_phone || "").toLowerCase().includes(q) ||
          (r.ein || "").toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const aVal = a[sortKey] || "";
      const bVal = b[sortKey] || "";
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline ml-1" /> : <ArrowDown className="h-3 w-3 inline ml-1" />;
  };

  const bulkUpdateStatus = async (newStatus: string) => {
    const ids = Array.from(selected);
    const { error } = await supabase.from("seller_intakes").update({ status: newStatus }).in("id", ids);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Updated ${ids.length} submissions to "${newStatus}"` });
      setSelected(new Set());
      loadData();
    }
  };

  const handleDelete = async (ids: string[]) => {
    // Cascade delete documents and validations first
    await Promise.all([
      supabase.from("intake_documents").delete().in("intake_id", ids),
      supabase.from("intake_validations").delete().in("intake_id", ids),
    ]);
    const { error } = await supabase.from("seller_intakes").delete().in("id", ids);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Deleted ${ids.length} submission${ids.length > 1 ? "s" : ""}` });
      setSelected(new Set());
      loadData();
    }
    setDeleteConfirm(null);
  };

  const formatPhone = (phone: string | null) => {
    if (!phone) return "—";
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return phone;
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
            placeholder="Search name, email, phone, EIN..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={(v) => { setPlatformFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue placeholder="Platform" /></SelectTrigger>
          <SelectContent>
            {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p === "All" ? "All Platforms" : p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 sm:px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <span className="text-muted-foreground hidden sm:inline">&middot;</span>
          {["Submitted", "In Review", "Issues Flagged", "Approved"].map((status) => (
            <Button key={status} variant="outline" size="sm" className="text-xs h-7" onClick={() => bulkUpdateStatus(status)}>
              Mark {status}
            </Button>
          ))}
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => bulkUpdateStatus("Archived")}>
            <Archive className="h-3 w-3 mr-1" /> Archive
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-7 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(Array.from(selected))}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="text-xs h-7 ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <Card className="border-border/50">
        <CardContent className="p-0">
          {/* Desktop table */}
          <div className="hidden md:block">
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
                  <TableHead className="text-xs cursor-pointer select-none" onClick={() => handleSort("business_legal_name")}>
                    Business Name <SortIcon col="business_legal_name" />
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer select-none" onClick={() => handleSort("client_name")}>
                    Contact <SortIcon col="client_name" />
                  </TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Platform</TableHead>
                  <TableHead className="text-xs">Timezone</TableHead>
                  <TableHead className="text-xs">Docs</TableHead>
                  <TableHead className="text-xs cursor-pointer select-none" onClick={() => handleSort("status")}>
                    Status <SortIcon col="status" />
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer select-none" onClick={() => handleSort("created_at")}>
                    Submitted <SortIcon col="created_at" />
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer select-none" onClick={() => handleSort("updated_at")}>
                    Updated <SortIcon col="updated_at" />
                  </TableHead>
                  <TableHead className="text-xs w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((r) => (
                  <TableRow
                    key={r.id}
                    className="even:bg-muted/30 cursor-pointer"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[role="checkbox"]') || (e.target as HTMLElement).closest('[data-row-actions]')) return;
                      navigate(`/admin/submissions/${r.id}`);
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                    </TableCell>
                    <TableCell>
                      <span className="text-primary font-medium text-sm">
                        {r.business_legal_name || "Unnamed"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{r.client_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.client_email || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(r.selected_platforms && r.selected_platforms.length > 0
                          ? r.selected_platforms
                          : [r.platform]
                        ).map((p: string) => (
                          <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.client_timezone || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{docCounts[r.id] || 0} files</TableCell>
                    <TableCell><Badge className="text-xs">{r.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.updated_at ? new Date(r.updated_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()} data-row-actions>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => bulkUpdateStatus("Archived").then(() => { setSelected(new Set()); }) && void supabase.from("seller_intakes").update({ status: "Archived" }).eq("id", r.id).then(() => { toast({ title: "Archived" }); loadData(); })}>
                            <Archive className="h-3.5 w-3.5 mr-2" /> Archive
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteConfirm([r.id])}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {paged.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="p-0">
                      <EmptyState icon={FileText} title="No submissions found" description="Try adjusting your search or filter criteria." />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border">
            {paged.map((r) => (
              <div
                key={r.id}
                className="p-3 flex gap-3 items-start cursor-pointer"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('[role="checkbox"]') || (e.target as HTMLElement).closest('[data-row-actions]')) return;
                  navigate(`/admin/submissions/${r.id}`);
                }}
              >
                <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-primary truncate">{r.business_legal_name || "Unnamed"}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge className="text-[10px]">{r.status}</Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" data-row-actions>
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => supabase.from("seller_intakes").update({ status: "Archived" }).eq("id", r.id).then(() => { toast({ title: "Archived" }); loadData(); })}>
                            <Archive className="h-3.5 w-3.5 mr-2" /> Archive
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteConfirm([r.id])}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{r.client_name || "—"} &middot; {r.client_email || ""}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {(r.selected_platforms?.length ? r.selected_platforms : [r.platform]).map((p: string) => (
                      <Badge key={p} variant="outline" className="text-[10px] px-1.5 py-0">{p}</Badge>
                    ))}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {docCounts[r.id] || 0} docs &middot; {r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {paged.length === 0 && (
              <div className="p-4">
                <EmptyState icon={FileText} title="No submissions found" description="Try adjusting your search or filter criteria." />
              </div>
            )}
          </div>
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

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteConfirm?.length === 1 ? "submission" : `${deleteConfirm?.length} submissions`}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected submission{(deleteConfirm?.length || 0) > 1 ? "s" : ""} along with all associated documents and validations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
