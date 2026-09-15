import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search, ListChecks, Trash2, Download, RefreshCw, Copy, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ActionMenu } from "@/components/admin/ActionMenu";
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

function downloadCsv(rows: Record<string, any>[], columns: { key: string; label: string }[], filename: string) {
  const esc = (v: unknown) => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
  const csv = [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminWaitlist() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from("waitlist_subscribers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      // Keep showing the last good data.
      setLoadError(error.message);
    } else {
      setLoadError(null);
      setData(rows || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDelete = async (ids: string[]) => {
    setDeleting(true);
    const { data: removed, error } = await supabase.from("waitlist_subscribers").delete().in("id", ids).select("id");
    setDeleting(false);
    const n = removed?.length ?? 0;
    if (error) {
      toast({ title: "Couldn't delete", description: `${error.message}. Nothing was removed — try again.`, variant: "destructive" });
    } else if (n === 0) {
      toast({ title: "Nothing was deleted", description: "Your account isn't allowed to delete these rows, or they were already removed. Refresh and try again.", variant: "destructive" });
    } else {
      toast({
        title: `Deleted ${n} subscriber${n === 1 ? "" : "s"}`,
        description: n < ids.length ? `${ids.length - n} could not be deleted.` : undefined,
        variant: n < ids.length ? "destructive" : undefined,
      });
      const gone = new Set((removed || []).map((r) => r.id));
      setData((prev) => prev.filter((r) => !gone.has(r.id)));
      setSelected(new Set());
    }
    setDeleteConfirm(null);
  };

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      toast({ title: "Email copied" });
    } catch {
      toast({ title: "Couldn't copy", description: email, variant: "destructive" });
    }
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const allOnPageSelected = paged.length > 0 && paged.every((r) => selected.has(r.id));

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-72" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Waitlist Subscribers"
        description={`${data.length} total subscribers.`}
        actions={
          <ActionMenu
            items={[
              { group: "Export", label: `Export CSV (${filtered.length})`, icon: Download, disabled: filtered.length === 0, onSelect: () => downloadCsv(filtered, EXPORT_COLUMNS, "waitlist") },
              { group: "View", label: "Refresh", icon: RefreshCw, onSelect: loadData },
            ]}
          />
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
          <span>Couldn't load subscribers: {loadError}</span>
          <Button size="sm" variant="outline" onClick={loadData}>Retry</Button>
        </div>
      )}

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input aria-label="Search by email" placeholder="Search by email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); setSelected(new Set()); }} className="pl-9" />
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 sm:px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button variant="outline" size="sm" className="ml-2 text-red-400 hover:text-red-300 border-red-500/30" onClick={() => setDeleteConfirm(Array.from(selected))}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}

      <Card className="border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allOnPageSelected}
                    onCheckedChange={(checked) => setSelected(checked ? new Set(paged.map((r) => r.id)) : new Set())}
                  />
                </TableHead>
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Products</TableHead>
                <TableHead className="text-xs">Source</TableHead>
                <TableHead className="text-xs">Confirmed</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs w-12"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((r) => (
                <TableRow key={r.id} className="even:bg-muted/30" data-state={selected.has(r.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox aria-label={`Select ${r.email}`} checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                  </TableCell>
                  <TableCell className="font-medium text-sm">{r.email}</TableCell>
                  <TableCell className="text-sm">
                    {(r.products || []).map((p: string) => (
                      <Badge key={p} variant="outline" className="text-xs mr-1">{p}</Badge>
                    ))}
                    {(!r.products || r.products.length === 0) && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.source || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.confirmed ? "default" : "secondary"} className="text-xs">
                      {r.confirmed ? "Confirmed" : "Unconfirmed"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</TableCell>
                  <TableCell>
                    <ActionMenu
                      label={`Actions for ${r.email}`}
                      items={[
                        { label: "Copy email", icon: Copy, onSelect: () => copyEmail(r.email) },
                        { label: "Delete…", icon: Trash2, destructive: true, onSelect: () => setDeleteConfirm([r.id]) },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={ListChecks}
                      title={search ? "No matching subscribers" : "No subscribers yet"}
                      description={search ? "Try a different email search." : "People who join a product waitlist will appear here."}
                      action={search ? <Button variant="outline" size="sm" onClick={() => setSearch("")}>Clear search</Button> : undefined}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground tabular-nums">Page {safePage + 1} of {totalPages}</span>
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o && !deleting) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteConfirm?.length === 1 ? "subscriber" : `${deleteConfirm?.length} subscribers`}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the selected subscriber{(deleteConfirm?.length || 0) > 1 ? "s" : ""} from the waitlist. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); if (deleteConfirm) handleDelete(deleteConfirm); }}
            >
              {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
