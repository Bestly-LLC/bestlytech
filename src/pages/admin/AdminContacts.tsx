import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search, Mail, Eye, Trash2, Archive } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ExportButton } from "@/components/admin/ExportButton";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const STATUSES = ["All", "new", "read", "replied", "archived"];
const PAGE_SIZE = 20;

const EXPORT_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "category", label: "Category" },
  { key: "subject", label: "Subject" },
  { key: "message", label: "Message" },
  { key: "status", label: "Status" },
  { key: "created_at", label: "Date" },
];

export default function AdminContacts() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<any | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
  const { toast } = useToast();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const { data: rows, error } = await supabase
      .from("contact_submissions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    setData(rows || []);
    setLoading(false);
  };

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("contact_submissions").update({ status }).eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Marked as ${status}` });
      loadData();
    }
  };

  const bulkUpdateStatus = async (newStatus: string) => {
    const ids = Array.from(selected);
    const { error } = await supabase.from("contact_submissions").update({ status: newStatus }).in("id", ids);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Updated ${ids.length} contacts to "${newStatus}"` });
      setSelected(new Set());
      loadData();
    }
  };

  const handleDelete = async (ids: string[]) => {
    const { error } = await supabase.from("contact_submissions").delete().in("id", ids);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Deleted ${ids.length} contact${ids.length > 1 ? "s" : ""}` });
      setSelected(new Set());
      loadData();
    }
    setDeleteConfirm(null);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const filtered = data.filter((r) => {
    if (statusFilter !== "All" && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (r.name || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q) || (r.subject || "").toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Contact Submissions"
        description="Messages from the contact form."
        actions={<ExportButton data={filtered} filename="contacts" columns={EXPORT_COLUMNS} />}
      />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, email, subject..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s === "All" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 sm:px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <span className="text-muted-foreground hidden sm:inline">&middot;</span>
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => bulkUpdateStatus("read")}>Mark Read</Button>
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => bulkUpdateStatus("replied")}>Mark Replied</Button>
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => bulkUpdateStatus("archived")}>
            <Archive className="h-3 w-3 mr-1" /> Archive
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-7 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(Array.from(selected))}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="text-xs h-7 ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
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
                      onCheckedChange={(checked) => setSelected(checked ? new Set(paged.map((r) => r.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">Subject</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((r) => (
                  <TableRow key={r.id} className="even:bg-muted/30">
                    <TableCell>
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                    </TableCell>
                    <TableCell className="font-medium text-sm">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.email}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{r.category || "—"}</Badge></TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{r.subject}</TableCell>
                    <TableCell>
                      <Select value={r.status || "new"} onValueChange={(v) => updateStatus(r.id, v)}>
                        <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.filter(s => s !== "All").map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setViewing(r)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm([r.id])}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {paged.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="p-0"><EmptyState icon={Mail} title="No contacts found" description="Contact submissions will appear here." /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border">
            {paged.map((r) => (
              <div key={r.id} className="p-3 space-y-1.5">
                <div className="flex items-start gap-2">
                  <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.email}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setViewing(r)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm([r.id])}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-foreground line-clamp-1">{r.subject}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">{r.category || "—"}</Badge>
                      <Select value={r.status || "new"} onValueChange={(v) => updateStatus(r.id, v)}>
                        <SelectTrigger className="h-6 w-[90px] text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.filter(s => s !== "All").map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <span className="text-[10px] text-muted-foreground ml-auto">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {paged.length === 0 && (
              <div className="p-4"><EmptyState icon={Mail} title="No contacts found" description="Contact submissions will appear here." /></div>
            )}
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground tabular-nums">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.subject}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <div className="flex gap-4">
                <span className="text-muted-foreground w-16">From:</span>
                <span>{viewing.name} ({viewing.email})</span>
              </div>
              {viewing.category && (
                <div className="flex gap-4">
                  <span className="text-muted-foreground w-16">Category:</span>
                  <Badge variant="outline">{viewing.category}</Badge>
                </div>
              )}
              <div className="flex gap-4">
                <span className="text-muted-foreground w-16">Date:</span>
                <span>{viewing.created_at ? new Date(viewing.created_at).toLocaleString() : "—"}</span>
              </div>
              <div className="border-t pt-3">
                <p className="whitespace-pre-wrap text-foreground">{viewing.message}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteConfirm?.length === 1 ? "contact" : `${deleteConfirm?.length} contacts`}?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the selected contact submission{(deleteConfirm?.length || 0) > 1 ? "s" : ""}. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
