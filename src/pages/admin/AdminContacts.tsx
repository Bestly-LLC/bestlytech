import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search, Mail, Eye, Trash2, Archive, Download, RefreshCw, Reply, ChevronDown, Loader2, CheckCheck, Inbox } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const STATUSES = ["new", "read", "replied", "archived"] as const;
const STATUS_LABEL: Record<string, string> = { new: "New", read: "Read", replied: "Replied", archived: "Archived" };
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

function downloadCsv(rows: Record<string, any>[], columns: { key: string; label: string }[], filename: string) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const csv = [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function replyHref(r: any) {
  return `mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.subject || "your message"}`)}`;
}

export default function AdminContacts() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from("contact_submissions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(error.message);
    } else {
      setLoadError(null);
      setData(rows || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /** Updates status and verifies rows actually changed (RLS returns success on 0 rows). */
  const setStatus = async (ids: string[], status: string, { quiet = false } = {}) => {
    setSaving((prev) => new Set([...prev, ...ids]));
    const { data: updated, error } = await supabase
      .from("contact_submissions")
      .update({ status })
      .in("id", ids)
      .select("id");
    setSaving((prev) => { const n = new Set(prev); ids.forEach((i) => n.delete(i)); return n; });
    const n = updated?.length ?? 0;
    if (error) {
      toast({ title: "Couldn't update status", description: `${error.message}. Nothing changed — try again.`, variant: "destructive" });
      return 0;
    }
    if (n === 0) {
      toast({ title: "Status not changed", description: "No rows were updated. Your account may not have permission, or the message was removed. Refresh and try again.", variant: "destructive" });
      return 0;
    }
    const done = new Set(updated!.map((r) => r.id));
    setData((prev) => prev.map((r) => (done.has(r.id) ? { ...r, status } : r)));
    setViewing((v: any) => (v && done.has(v.id) ? { ...v, status } : v));
    if (!quiet) {
      toast({
        title: ids.length === 1 ? `Marked ${STATUS_LABEL[status].toLowerCase()}` : `Marked ${n} message${n === 1 ? "" : "s"} ${STATUS_LABEL[status].toLowerCase()}`,
        description: n < ids.length ? `${ids.length - n} could not be updated.` : undefined,
      });
    }
    return n;
  };

  const bulkStatus = async (status: string) => {
    setBulkBusy(true);
    const n = await setStatus(Array.from(selected), status);
    setBulkBusy(false);
    if (n > 0) setSelected(new Set());
  };

  const openMessage = (r: any) => {
    setViewing(r);
    // Opening a new message marks it read, like a mail client.
    if ((r.status || "new") === "new") setStatus([r.id], "read", { quiet: true });
  };

  const handleDelete = async (ids: string[]) => {
    setDeleting(true);
    const { data: removed, error } = await supabase.from("contact_submissions").delete().in("id", ids).select("id");
    setDeleting(false);
    const n = removed?.length ?? 0;
    if (error) {
      toast({ title: "Couldn't delete", description: `${error.message}. Nothing was removed — try again.`, variant: "destructive" });
    } else if (n === 0) {
      toast({ title: "Nothing was deleted", description: "Your account isn't allowed to delete these messages, or they were already removed. Refresh and try again.", variant: "destructive" });
    } else {
      toast({
        title: `Deleted ${n} message${n === 1 ? "" : "s"}`,
        description: n < ids.length ? `${ids.length - n} could not be deleted.` : undefined,
        variant: n < ids.length ? "destructive" : undefined,
      });
      const gone = new Set(removed!.map((r) => r.id));
      setData((prev) => prev.filter((r) => !gone.has(r.id)));
      setSelected(new Set());
      if (viewing && gone.has(viewing.id)) setViewing(null);
    }
    setDeleteConfirm(null);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const filtered = data.filter((r) => {
    if (statusFilter !== "All" && (r.status || "new") !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (r.name || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q) || (r.subject || "").toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const allOnPageSelected = paged.length > 0 && paged.every((r) => selected.has(r.id));
  const isFiltering = !!search || statusFilter !== "All";

  const rowActions = (r: any) => [
    { label: "Open message", icon: Eye, onSelect: () => openMessage(r) },
    { label: "Reply by email", icon: Reply, onSelect: () => { window.location.href = replyHref(r); } },
    { label: "Delete…", icon: Trash2, destructive: true, onSelect: () => setDeleteConfirm([r.id]) },
  ];

  const statusSelect = (r: any, compact = false) => (
    <Select value={r.status || "new"} onValueChange={(v) => setStatus([r.id], v)} disabled={saving.has(r.id)}>
      <SelectTrigger aria-label={`Status for message from ${r.name}`} className={compact ? "h-9 w-28 text-xs" : "h-9 w-28 text-xs"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const emptyState = (
    <EmptyState
      icon={Mail}
      title={isFiltering ? "No matching messages" : "No messages yet"}
      description={isFiltering ? "Try a different search or status filter." : "Messages sent from the contact form will appear here."}
      action={isFiltering ? <Button variant="outline" size="sm" onClick={() => { setSearch(""); setStatusFilter("All"); }}>Clear filters</Button> : undefined}
    />
  );

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-10 w-36" /></div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Contact Submissions"
        description="Messages from the contact form."
        actions={
          <ActionMenu
            items={[
              { group: "Export", label: `Export CSV (${filtered.length})`, icon: Download, disabled: filtered.length === 0, onSelect: () => downloadCsv(filtered, EXPORT_COLUMNS, "contacts") },
              { group: "View", label: "Refresh", icon: RefreshCw, onSelect: loadData },
            ]}
          />
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
          <span>Couldn't load messages: {loadError}</span>
          <Button size="sm" variant="outline" onClick={loadData}>Retry</Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search messages" placeholder="Search name, email, subject..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); setSelected(new Set()); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); setSelected(new Set()); }}>
          <SelectTrigger aria-label="Filter by status" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 sm:px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button variant="outline" size="sm" className="ml-2" disabled={bulkBusy} onClick={() => bulkStatus("archived")}>
            {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} Archive
          </Button>
          <ActionMenu
            label="Set status for selected"
            trigger={
              <Button variant="outline" size="sm" disabled={bulkBusy}>
                Mark as <ChevronDown className="h-4 w-4" />
              </Button>
            }
            align="start"
            items={[
              { label: "New", icon: Inbox, onSelect: () => bulkStatus("new") },
              { label: "Read", icon: CheckCheck, onSelect: () => bulkStatus("read") },
              { label: "Replied", icon: Reply, onSelect: () => bulkStatus("replied") },
            ]}
          />
          <Button variant="outline" size="sm" className="text-red-400 hover:text-red-300 border-red-500/30" disabled={bulkBusy} onClick={() => setDeleteConfirm(Array.from(selected))}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>Clear selection</Button>
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
                      aria-label="Select all on this page"
                      checked={allOnPageSelected}
                      onCheckedChange={(checked) => setSelected(checked ? new Set(paged.map((r) => r.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">Subject</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs w-12"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((r) => (
                  <TableRow key={r.id} className="even:bg-muted/30" data-state={selected.has(r.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox aria-label={`Select message from ${r.name}`} checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      <button type="button" onClick={() => openMessage(r)} className="text-left hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {(r.status || "new") === "new" && <span className="inline-block h-2 w-2 rounded-full bg-blue-400 mr-2 align-middle" aria-label="Unread" />}
                        {r.name}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.email}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{r.category || "—"}</Badge></TableCell>
                    <TableCell className="text-sm max-w-[12.5rem] truncate">{r.subject}</TableCell>
                    <TableCell>{statusSelect(r)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <ActionMenu label={`Actions for message from ${r.name}`} items={rowActions(r)} />
                    </TableCell>
                  </TableRow>
                ))}
                {paged.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="p-0">{emptyState}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border">
            {paged.map((r) => (
              <div key={r.id} className="p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Checkbox aria-label={`Select message from ${r.name}`} checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" onClick={() => openMessage(r)} className="min-w-0 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.email}</p>
                      </button>
                      <ActionMenu label={`Actions for message from ${r.name}`} items={rowActions(r)} />
                    </div>
                    <p className="text-xs text-foreground line-clamp-1 mt-1">{r.subject}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <Badge variant="outline" className="text-xs">{r.category || "—"}</Badge>
                      {statusSelect(r, true)}
                      <span className="text-xs text-muted-foreground ml-auto">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {paged.length === 0 && <div className="p-4">{emptyState}</div>}
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground tabular-nums">Page {safePage + 1} of {totalPages}</span>
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.subject || "Message"}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <div className="flex gap-4">
                <span className="text-muted-foreground w-20 shrink-0">From</span>
                <span className="break-all">{viewing.name} ({viewing.email})</span>
              </div>
              {viewing.category && (
                <div className="flex gap-4">
                  <span className="text-muted-foreground w-20 shrink-0">Category</span>
                  <Badge variant="outline">{viewing.category}</Badge>
                </div>
              )}
              <div className="flex gap-4">
                <span className="text-muted-foreground w-20 shrink-0">Date</span>
                <span>{viewing.created_at ? new Date(viewing.created_at).toLocaleString() : "—"}</span>
              </div>
              <div className="border-t pt-3 max-h-[50vh] overflow-y-auto">
                <p className="whitespace-pre-wrap text-foreground">{viewing.message}</p>
              </div>
            </div>
          )}
          {viewing && (
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                disabled={saving.has(viewing.id) || viewing.status === "archived"}
                onClick={async () => { const n = await setStatus([viewing.id], "archived"); if (n) setViewing(null); }}
              >
                <Archive className="h-4 w-4" /> Archive
              </Button>
              <Button asChild>
                <a href={replyHref(viewing)} onClick={() => { if (viewing.status !== "replied") setStatus([viewing.id], "replied", { quiet: true }); }}>
                  <Reply className="h-4 w-4" /> Reply
                </a>
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o && !deleting) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteConfirm?.length === 1 ? "message" : `${deleteConfirm?.length} messages`}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes the selected contact submission{(deleteConfirm?.length || 0) > 1 ? "s" : ""}. This can't be undone. Archive instead if you only want it out of the way.</AlertDialogDescription>
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
