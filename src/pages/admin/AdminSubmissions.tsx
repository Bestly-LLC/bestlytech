import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle, Archive, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, ExternalLink,
  FileText, Loader2, RefreshCw, Search, Tag, Trash2, X,
} from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionMenu, type ActionItem } from "@/components/admin/ActionMenu";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATUS_OPTIONS = ["Draft", "Submitted", "In Review", "Issues Flagged", "Approved", "Archived"] as const;
const STATUS_FILTERS = ["All", ...STATUS_OPTIONS];
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

const statusTone: Record<string, string> = {
  Draft: "border-white/15 text-white/70",
  Submitted: "border-blue-400/30 text-blue-300",
  "In Review": "border-amber-400/30 text-amber-300",
  "Issues Flagged": "border-red-400/30 text-red-300",
  Approved: "border-emerald-400/30 text-emerald-300",
  Archived: "border-white/10 text-white/55",
};

function platformsOf(r: any): string[] {
  return r.selected_platforms?.length ? r.selected_platforms : [r.platform].filter(Boolean);
}

function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={`text-xs font-medium ${statusTone[status] ?? "border-white/15 text-white/70"} ${className ?? ""}`}>
      {status}
    </Badge>
  );
}

function toCsv(rows: Record<string, any>[]): string {
  const header = EXPORT_COLUMNS.map((c) => `"${c.label}"`).join(",");
  const body = rows.map((row) =>
    EXPORT_COLUMNS.map((c) => (row[c.key] == null ? '""' : `"${String(row[c.key]).replace(/"/g, '""')}"`)).join(","),
  );
  return [header, ...body].join("\n");
}

export default function AdminSubmissions() {
  const [data, setData] = useState<any[]>([]);
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [platformFilter, setPlatformFilter] = useState("All");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    const [intakesRes, docsRes] = await Promise.all([
      supabase.from("seller_intakes").select("*").order("created_at", { ascending: false }),
      supabase.from("intake_documents").select("intake_id"),
    ]);
    if (intakesRes.error) {
      // Keep showing the last good rows; surface the failure inline with Retry.
      setLoadError(intakesRes.error.message);
    } else {
      setLoadError(null);
      setData(intakesRes.data || []);
    }
    const counts: Record<string, number> = {};
    (docsRes.data || []).forEach((d: any) => {
      counts[d.intake_id] = (counts[d.intake_id] || 0) + 1;
    });
    setDocCounts(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = useMemo(
    () =>
      data
        .filter((r) => {
          if (statusFilter !== "All" && r.status !== statusFilter) return false;
          if (platformFilter !== "All" && !platformsOf(r).some((p) => p.toLowerCase().includes(platformFilter.toLowerCase()))) return false;
          if (search) {
            const q = search.toLowerCase();
            return [r.business_legal_name, r.client_name, r.client_email, r.client_phone, r.ein].some((v) =>
              (v || "").toLowerCase().includes(q),
            );
          }
          return true;
        })
        .sort((a, b) => {
          const cmp = String(a[sortKey] || "").localeCompare(String(b[sortKey] || ""));
          return sortDir === "asc" ? cmp : -cmp;
        }),
    [data, statusFilter, platformFilter, search, sortKey, sortDir],
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allOnPageSelected = paged.length > 0 && paged.every((r) => selected.has(r.id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      paged.forEach((r) => (checked ? next.add(r.id) : next.delete(r.id)));
      return next;
    });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  /** Sets status on the given rows and verifies how many rows RLS actually let through. */
  const updateStatus = async (ids: string[], newStatus: string) => {
    if (ids.length === 0) return;
    setBusy(`status:${newStatus}`);
    const { data: rows, error } = await supabase
      .from("seller_intakes")
      .update({ status: newStatus })
      .in("id", ids)
      .select("id");
    setBusy(null);
    const changed = rows?.length ?? 0;
    if (error || changed === 0) {
      toast({
        title: "Couldn't update status",
        description: error?.message ?? "No rows were changed. Your account may not have edit permission. Reload and try again.",
        variant: "destructive",
      });
      return;
    }
    const noun = changed === 1 ? "submission" : "submissions";
    toast({
      title: newStatus === "Archived" ? `Archived ${changed} ${noun}` : `Marked ${changed} ${noun} “${newStatus}”`,
      description: changed < ids.length ? `${ids.length - changed} could not be changed.` : undefined,
    });
    setSelected((prev) => {
      const next = new Set(prev);
      rows!.forEach((r) => next.delete(r.id));
      return next;
    });
    loadData();
  };

  const handleDelete = async (ids: string[]) => {
    // Documents and validations cascade via FK. `.select` returns the rows actually removed, so a
    // policy that silently blocks the delete shows up as an error instead of a fake "Deleted".
    setBusy("delete");
    const { data: rows, error } = await supabase.from("seller_intakes").delete().in("id", ids).select("id");
    setBusy(null);
    const removed = rows?.length ?? 0;
    if (error || removed === 0) {
      toast({
        title: "Couldn't delete",
        description: error?.message ?? "Nothing was removed. Your account may not have delete permission.",
        variant: "destructive",
      });
    } else {
      toast({
        title: `Deleted ${removed} submission${removed > 1 ? "s" : ""}`,
        description: removed < ids.length ? `${ids.length - removed} could not be deleted.` : undefined,
      });
      setSelected(new Set());
      loadData();
    }
    setDeleteConfirm(null);
  };

  const exportCsv = (rows: any[], label: string) => {
    if (rows.length === 0) {
      toast({ title: "Nothing to export", description: "No submissions match the current filters." });
      return;
    }
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `submissions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `Exported ${rows.length} ${label}` });
  };

  const rowActions = (r: any): ActionItem[] => [
    { label: "Open", icon: ExternalLink, onSelect: () => navigate(`/admin/submissions/${r.id}`) },
    ...(r.status !== "Archived"
      ? [{ label: "Archive", icon: Archive, group: "Status", onSelect: () => updateStatus([r.id], "Archived") }]
      : [{ label: "Restore to Submitted", icon: RefreshCw, group: "Status", onSelect: () => updateStatus([r.id], "Submitted") }]),
    { label: "Delete…", icon: Trash2, destructive: true, onSelect: () => setDeleteConfirm([r.id]) },
  ];

  const isRowClickIgnored = (e: React.MouseEvent) =>
    !!(e.target as HTMLElement).closest('[role="checkbox"], [data-row-actions], button, a');

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl" aria-busy="true">
        <div>
          <Skeleton className="h-8 w-44 bg-white/[0.05]" />
          <Skeleton className="h-4 w-72 mt-2 bg-white/[0.05]" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-72 bg-white/[0.05]" />
          <Skeleton className="h-10 w-40 bg-white/[0.05]" />
          <Skeleton className="h-10 w-40 bg-white/[0.05]" />
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  const selectedIds = Array.from(selected);
  const selectedRows = data.filter((r) => selected.has(r.id));

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Submissions"
        description="Marketplace seller intake submissions."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-white/10 text-white/80 hover:text-white hover:bg-white/5"
              onClick={() => exportCsv(filtered, filtered.length === 1 ? "submission" : "submissions")}
              disabled={filtered.length === 0}
            >
              <Download className="h-4 w-4 mr-1.5" aria-hidden />
              Export CSV
            </Button>
            <ActionMenu
              label="More submission actions"
              items={[{ label: "Reload list", icon: RefreshCw, group: "View", onSelect: () => loadData() }]}
            />
          </>
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-300 shrink-0" aria-hidden />
          <p className="text-sm text-red-200 flex-1 min-w-0">
            Couldn't load submissions: {loadError}
            {data.length > 0 && <span className="text-red-200/70"> Showing the last loaded list.</span>}
          </p>
          <Button size="sm" variant="outline" className="h-9 border-red-400/30 text-red-100 hover:bg-red-500/10" onClick={() => loadData()}>
            Retry
          </Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative sm:max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55" aria-hidden />
          <Input
            placeholder="Search name, email, phone, EIN"
            aria-label="Search submissions"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => <SelectItem key={s} value={s}>{s === "All" ? "All statuses" : s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={(v) => { setPlatformFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by platform"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p === "All" ? "All platforms" : p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 sm:px-4 py-2"
        >
          <span className="text-sm font-medium text-white tabular-nums">{selected.size} selected</span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 border-white/10 text-white/80 hover:bg-white/5" disabled={busy !== null}>
                  {busy?.startsWith("status:") ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <Tag className="h-4 w-4 mr-1.5" aria-hidden />}
                  Set status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {STATUS_OPTIONS.filter((s) => s !== "Draft").map((s) => (
                  <DropdownMenuItem key={s} className="py-2" onSelect={() => updateStatus(selectedIds, s)}>
                    {s === "Archived" ? "Archive" : `Mark ${s}`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-white/10 text-white/80 hover:bg-white/5"
              onClick={() => exportCsv(selectedRows, "selected")}
            >
              <Download className="h-4 w-4 mr-1.5" aria-hidden /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-red-500/25 text-red-300 hover:text-red-200 hover:bg-red-500/10"
              onClick={() => setDeleteConfirm(selectedIds)}
              disabled={busy !== null}
            >
              <Trash2 className="h-4 w-4 mr-1.5" aria-hidden /> Delete…
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 ml-auto text-white/70 hover:text-white hover:bg-white/5"
            onClick={() => setSelected(new Set())}
          >
            <X className="h-4 w-4 mr-1" aria-hidden /> Clear
          </Button>
        </div>
      )}

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-white/[0.06]">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allOnPageSelected}
                    onCheckedChange={(checked) => togglePage(!!checked)}
                  />
                </TableHead>
                {([
                  ["business_legal_name", "Business"],
                  ["client_name", "Contact"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <SortableHead key={key} label={label} col={key} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                ))}
                <TableHead className="text-xs text-white/60">Platform</TableHead>
                <TableHead className="text-xs text-white/60">Docs</TableHead>
                <SortableHead label="Status" col="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="Submitted" col="created_at" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="Updated" col="updated_at" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((r) => (
                <TableRow
                  key={r.id}
                  data-state={selected.has(r.id) ? "selected" : undefined}
                  className="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer data-[state=selected]:bg-white/[0.05]"
                  onClick={(e) => {
                    if (isRowClickIgnored(e)) return;
                    navigate(`/admin/submissions/${r.id}`);
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${r.business_legal_name || "unnamed submission"}`}
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggleSelect(r.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="text-white font-medium text-sm">{r.business_legal_name || "Unnamed"}</span>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-white/80">{r.client_name || "—"}</div>
                    <div className="text-xs text-white/55 truncate max-w-[14rem]">{r.client_email || ""}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {platformsOf(r).map((p) => (
                        <Badge key={p} variant="outline" className="text-xs border-white/10 text-white/70">{p}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-white/60 text-xs tabular-nums">{docCounts[r.id] || 0}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-white/60 text-sm tabular-nums">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-white/60 text-sm tabular-nums">
                    {r.updated_at ? new Date(r.updated_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()} data-row-actions>
                    <ActionMenu label={`Actions for ${r.business_legal_name || "submission"}`} items={rowActions(r)} className="border-transparent" />
                  </TableCell>
                </TableRow>
              ))}
              {paged.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="p-0">
                    <EmptyStateForFilters
                      hasData={data.length > 0}
                      onClear={() => { setSearch(""); setStatusFilter("All"); setPlatformFilter("All"); setPage(0); }}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards */}
        <ul className="md:hidden divide-y divide-white/[0.06]">
          {paged.map((r) => (
            <li
              key={r.id}
              className="p-3 flex gap-3 items-start cursor-pointer hover:bg-white/[0.03]"
              onClick={(e) => {
                if (isRowClickIgnored(e)) return;
                navigate(`/admin/submissions/${r.id}`);
              }}
            >
              <Checkbox
                aria-label={`Select ${r.business_legal_name || "unnamed submission"}`}
                checked={selected.has(r.id)}
                onCheckedChange={() => toggleSelect(r.id)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-white truncate">{r.business_legal_name || "Unnamed"}</p>
                  <StatusBadge status={r.status} className="shrink-0" />
                </div>
                <p className="text-xs text-white/60 mt-0.5 truncate">
                  {r.client_name || "—"}{r.client_email ? ` · ${r.client_email}` : ""}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {platformsOf(r).map((p) => (
                    <Badge key={p} variant="outline" className="text-xs px-1.5 py-0 border-white/10 text-white/70">{p}</Badge>
                  ))}
                  <span className="text-xs text-white/55 ml-auto tabular-nums">
                    {docCounts[r.id] || 0} docs · {r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}
                  </span>
                </div>
              </div>
              <div data-row-actions onClick={(e) => e.stopPropagation()}>
                <ActionMenu label={`Actions for ${r.business_legal_name || "submission"}`} items={rowActions(r)} className="border-transparent" />
              </div>
            </li>
          ))}
          {paged.length === 0 && (
            <li className="p-4">
              <EmptyStateForFilters
                hasData={data.length > 0}
                onClear={() => { setSearch(""); setStatusFilter("All"); setPlatformFilter("All"); setPage(0); }}
              />
            </li>
          )}
        </ul>
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Pagination">
          <Button variant="outline" size="icon" className="h-9 w-9 border-white/10" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-white/60 tabular-nums">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="icon" className="h-9 w-9 border-white/10" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      )}

      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open && busy !== "delete") setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteConfirm?.length === 1 ? "this submission" : `${deleteConfirm?.length} submissions`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the submission{(deleteConfirm?.length || 0) > 1 ? "s" : ""} and all attached
              documents and validation results. This can't be undone. To keep a record, archive instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "delete"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy === "delete"}
              onClick={(e) => {
                e.preventDefault();
                if (deleteConfirm) handleDelete(deleteConfirm);
              }}
            >
              {busy === "delete" ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SortableHead({
  label, col, sortKey, sortDir, onSort,
}: { label: string; col: SortKey; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void }) {
  const active = sortKey === col;
  return (
    <TableHead
      className="text-xs text-white/60"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1 rounded-md py-1 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        {active && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </TableHead>
  );
}

function EmptyStateForFilters({ hasData, onClear }: { hasData: boolean; onClear: () => void }) {
  return hasData ? (
    <EmptyState
      icon={Search}
      title="No submissions match"
      description="Try a different search, status or platform."
      action={<Button variant="outline" size="sm" className="h-9 border-white/10" onClick={onClear}>Clear filters</Button>}
    />
  ) : (
    <EmptyState
      icon={FileText}
      title="No submissions yet"
      description="When a seller starts the intake form, their submission shows up here."
    />
  );
}
