import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search, ListChecks, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ExportButton } from "@/components/admin/ExportButton";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const PAGE_SIZE = 20;

const EXPORT_COLUMNS = [
  { key: "email", label: "Email" },
  { key: "products", label: "Products" },
  { key: "source", label: "Source" },
  { key: "confirmed", label: "Confirmed" },
  { key: "created_at", label: "Date" },
];

export default function AdminWaitlist() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
  const { toast } = useToast();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const { data: rows, error } = await supabase
      .from("waitlist_subscribers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    setData(rows || []);
    setLoading(false);
  };

  const handleDelete = async (ids: string[]) => {
    const { error } = await supabase.from("waitlist_subscribers").delete().in("id", ids);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Deleted ${ids.length} subscriber${ids.length > 1 ? "s" : ""}` });
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
    if (!search) return true;
    return (r.email || "").toLowerCase().includes(search.toLowerCase());
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
        title="Waitlist Subscribers"
        description={`${data.length} total subscribers.`}
        actions={<ExportButton data={filtered} filename="waitlist" columns={EXPORT_COLUMNS} />}
      />

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 sm:px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <span className="text-muted-foreground hidden sm:inline">&middot;</span>
          <Button variant="outline" size="sm" className="text-xs h-7 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(Array.from(selected))}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="text-xs h-7 ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
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
                    onCheckedChange={(checked) => setSelected(checked ? new Set(paged.map((r) => r.id)) : new Set())}
                  />
                </TableHead>
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Products</TableHead>
                <TableHead className="text-xs">Source</TableHead>
                <TableHead className="text-xs">Confirmed</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((r) => (
                <TableRow key={r.id} className="even:bg-muted/30">
                  <TableCell>
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                  </TableCell>
                  <TableCell className="font-medium text-sm">{r.email}</TableCell>
                  <TableCell className="text-sm">
                    {(r.products || []).map((p: string) => (
                      <Badge key={p} variant="outline" className="text-xs mr-1">{p}</Badge>
                    ))}
                    {(!r.products || r.products.length === 0) && "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.source || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.confirmed ? "default" : "secondary"} className="text-xs">
                      {r.confirmed ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm([r.id])}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {paged.length === 0 && (
                <TableRow><TableCell colSpan={7} className="p-0"><EmptyState icon={ListChecks} title="No subscribers" description="Waitlist sign-ups will appear here." /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground tabular-nums">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteConfirm?.length === 1 ? "subscriber" : `${deleteConfirm?.length} subscribers`}?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the selected subscriber{(deleteConfirm?.length || 0) > 1 ? "s" : ""} from the waitlist. This action cannot be undone.</AlertDialogDescription>
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
