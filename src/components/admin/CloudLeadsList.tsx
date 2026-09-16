import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  Link2,
  Loader2,
  RotateCcw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ActionMenu, type ActionItem } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { cn } from "@/lib/utils";
import {
  STAGES,
  STATUS_LABEL,
  exportLeadItems,
  filterLeadItems,
  fmtExact,
  fmtRelative,
  type LeadItem,
  type LeadListFilters,
  type LeadSort,
} from "@/components/admin/cloudLeads";

const PAGE_SIZE = 25;

const STATUS_CLASS: Record<string, string> = {
  new: "border-blue-400/30 text-blue-200",
  contacted: "border-white/15 text-white/70",
  qualified: "border-emerald-400/30 text-emerald-200",
  disqualified: "border-red-400/30 text-red-200",
  converted: "border-emerald-400/30 text-emerald-200",
};

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={fmtExact(iso)} className="tabular-nums">
      {fmtRelative(iso)}
    </time>
  );
}

/** Stops row navigation when interacting with checkboxes and menus (portal events bubble in React). */
function Stop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

export function CloudLeadsList({
  items,
  loading,
  filters,
  onFiltersChange,
  onRequestDelete,
  onRemoved,
  onStatusChanged,
  onCopyLeadFormLink,
}: {
  items: LeadItem[];
  loading: boolean;
  filters: LeadListFilters;
  onFiltersChange: (f: LeadListFilters) => void;
  onRequestDelete: (item: LeadItem) => void;
  /** Called with ids that were deleted by a bulk action. */
  onRemoved: (ids: string[]) => void;
  onStatusChanged: (id: string, status: string) => void;
  onCopyLeadFormLink: () => void;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<LeadItem[] | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const filtered = useMemo(() => filterLeadItems(items, filters), [items, filters]);

  // Drop selections for rows that no longer exist (deleted here or elsewhere).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, none: 0, disqualified: 0 };
    for (const i of items) {
      if (!i.hasDeal) c.none++;
      if (i.status === "disqualified") c.disqualified++;
      if (i.stageNum) c[String(i.stageNum)] = (c[String(i.stageNum)] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const allOnPageSelected = paged.length > 0 && paged.every((r) => selected.has(r.id));
  const isFiltering = !!filters.search || filters.stage !== "all";
  const selectedItems = items.filter((i) => selected.has(i.id));
  const bulkBusy = bulkProgress !== null;

  function updateFilters(patch: Partial<LeadListFilters>) {
    onFiltersChange({ ...filters, ...patch });
    setPage(0);
    if (patch.search !== undefined || patch.stage !== undefined) setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function copyEmail(item: LeadItem) {
    try {
      await navigator.clipboard.writeText(item.contactEmail);
      toast({ title: "Email copied", description: item.contactEmail });
    } catch {
      toast({ title: "Couldn't copy", description: item.contactEmail, variant: "destructive" });
    }
  }

  async function setStatus(item: LeadItem, status: "disqualified" | "new") {
    setSavingId(item.id);
    const { data, error } = await supabase
      .from("cloud_leads")
      .update({ status })
      .eq("id", item.id)
      .select("id");
    setSavingId(null);
    if (error || !data || data.length === 0) {
      toast({
        title: status === "disqualified" ? "Couldn't disqualify lead" : "Couldn't restore lead",
        description: error
          ? `${error.message}. Nothing changed, try again.`
          : "No rows were updated. The lead may have been removed, or your account lacks permission. Refresh and try again.",
        variant: "destructive",
      });
      return;
    }
    onStatusChanged(item.id, status);
    toast({ title: status === "disqualified" ? `Marked ${item.company} disqualified` : `Restored ${item.company}` });
  }

  async function runBulkDelete(targets: LeadItem[]) {
    const deleted: string[] = [];
    const failures: string[] = [];
    setBulkProgress({ done: 0, total: targets.length });
    for (const [n, t] of targets.entries()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("admin_delete_cloud_lead", { p_lead_id: t.id });
      if (error || !data?.deleted) failures.push(`${t.company}${error?.message ? ` (${error.message})` : ""}`);
      else deleted.push(t.id);
      setBulkProgress({ done: n + 1, total: targets.length });
    }
    setBulkProgress(null);
    setBulkConfirm(null);
    if (deleted.length) {
      setSelected((prev) => new Set([...prev].filter((id) => !deleted.includes(id))));
      onRemoved(deleted);
    }
    toast({
      title: `Deleted ${deleted.length} of ${targets.length} lead${targets.length === 1 ? "" : "s"}`,
      description: failures.length ? `Failed: ${failures.join(", ")}` : undefined,
      variant: failures.length ? "destructive" : undefined,
    });
  }

  function exportSelected() {
    const n = exportLeadItems(selectedItems, "cloud-leads-selected");
    toast({ title: n ? `Exported ${n} lead${n === 1 ? "" : "s"}` : "Nothing to export" });
  }

  const rowActions = (i: LeadItem): ActionItem[] => [
    { label: "Open", icon: FolderOpen, onSelect: () => navigate(`/admin/cloud/${i.id}`) },
    { label: "Copy email", icon: Copy, disabled: !i.contactEmail, onSelect: () => copyEmail(i) },
    i.status === "disqualified"
      ? { group: "Status", label: "Restore lead", icon: RotateCcw, disabled: savingId === i.id, onSelect: () => setStatus(i, "new") }
      : { group: "Status", label: "Mark disqualified", icon: Ban, disabled: savingId === i.id, onSelect: () => setStatus(i, "disqualified") },
    { label: "Delete lead…", icon: Trash2, destructive: true, onSelect: () => onRequestDelete(i) },
  ];

  const stageCell = (i: LeadItem) => (
    <div className="min-w-0">
      <div className="text-sm text-white/85">
        {i.stageNum ? (
          <>
            <span className="tabular-nums text-white/55">{i.stageNum} · </span>
            {i.stageLabel}
          </>
        ) : (
          <span className="text-white/70">No deal yet</span>
        )}
      </div>
      {i.nextStep && <div className="text-xs text-white/55 truncate max-w-[16rem]">{i.nextStep}</div>}
    </div>
  );

  const statusBadge = (i: LeadItem) => (
    <Badge variant="outline" className={cn("text-xs font-normal", STATUS_CLASS[i.status] ?? "border-white/15 text-white/70")}>
      {STATUS_LABEL[i.status] ?? i.status}
    </Badge>
  );

  const emptyState = (
    <EmptyState
      compact
      icon={Users}
      title={isFiltering ? "No matching leads" : "No leads yet"}
      description={
        isFiltering
          ? "Try a different search or stage filter."
          : "Leads from the /get-started form will appear here, one row per company."
      }
      action={
        isFiltering ? (
          <Button variant="outline" size="sm" onClick={() => updateFilters({ search: "", stage: "all" })}>
            Clear filters
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onCopyLeadFormLink}>
            <Link2 className="h-4 w-4" /> Copy lead form link
          </Button>
        )
      }
    />
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
        <div className="relative sm:max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/45" aria-hidden />
          <Input
            aria-label="Search leads"
            placeholder="Search company, contact, email..."
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            className="pl-9"
          />
        </div>
        <div className="flex gap-3">
          <Select value={filters.stage} onValueChange={(v) => updateFilters({ stage: v })}>
            <SelectTrigger aria-label="Filter by stage" className="flex-1 sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All leads ({counts.all})</SelectItem>
              <SelectItem value="none">No deal yet ({counts.none})</SelectItem>
              {STAGES.map((s) => (
                <SelectItem key={s.num} value={String(s.num)}>
                  {s.num} · {s.label} ({counts[String(s.num)] ?? 0})
                </SelectItem>
              ))}
              <SelectItem value="disqualified">Disqualified ({counts.disqualified})</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.sort} onValueChange={(v) => updateFilters({ sort: v as LeadSort })}>
            <SelectTrigger aria-label="Sort leads" className="flex-1 sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created-desc">Newest first</SelectItem>
              <SelectItem value="created-asc">Oldest first</SelectItem>
              <SelectItem value="activity-desc">Recent activity</SelectItem>
              <SelectItem value="activity-asc">Least recent activity</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Bulk bar: only when rows are selected */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 sm:px-4 py-2">
          <span className="text-sm font-medium text-white/85">{selected.size} selected</span>
          <Button variant="outline" size="sm" className="ml-2" disabled={bulkBusy} onClick={exportSelected}>
            <Download className="h-4 w-4" /> Export selected
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-400 hover:text-red-300 border-red-500/30"
            disabled={bulkBusy}
            onClick={() => setBulkConfirm(selectedItems)}
          >
            <Trash2 className="h-4 w-4" /> Delete selected…
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        {loading ? (
          <div className="p-3 space-y-2" aria-busy="true" aria-label="Loading leads">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-white/[0.06]">
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all on this page"
                        checked={allOnPageSelected}
                        disabled={paged.length === 0}
                        onCheckedChange={(checked) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            for (const r of paged) { if (checked) next.add(r.id); else next.delete(r.id); }
                            return next;
                          })
                        }
                      />
                    </TableHead>
                    <TableHead className="text-xs text-white/55">Company</TableHead>
                    <TableHead className="text-xs text-white/55">Contact</TableHead>
                    <TableHead className="text-xs text-white/55">Stage</TableHead>
                    <TableHead className="text-xs text-white/55">Users</TableHead>
                    <TableHead className="text-xs text-white/55">Created</TableHead>
                    <TableHead className="text-xs text-white/55">Last activity</TableHead>
                    <TableHead className="text-xs text-white/55">Status</TableHead>
                    <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((i) => (
                    <TableRow
                      key={i.id}
                      data-state={selected.has(i.id) ? "selected" : undefined}
                      className={cn("cursor-pointer border-white/[0.06] hover:bg-white/[0.03]", i.status === "disqualified" && "opacity-70")}
                      onClick={() => navigate(`/admin/cloud/${i.id}`)}
                    >
                      <TableCell>
                        <Stop>
                          <Checkbox aria-label={`Select ${i.company}`} checked={selected.has(i.id)} onCheckedChange={() => toggle(i.id)} />
                        </Stop>
                      </TableCell>
                      <TableCell className="max-w-[14rem]">
                        <Link
                          to={`/admin/cloud/${i.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate text-sm font-medium text-white/90 hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {i.company}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[14rem]">
                        <div className="truncate text-sm text-white/80">{i.contactName}</div>
                        <div className="truncate text-xs text-white/55">{i.contactEmail}</div>
                      </TableCell>
                      <TableCell>{stageCell(i)}</TableCell>
                      <TableCell className="text-sm text-white/70 tabular-nums whitespace-nowrap">{i.users ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="text-sm text-white/70"><When iso={i.createdAt} /></div>
                        {i.source && <div className="text-xs text-white/55 capitalize">{i.source}</div>}
                      </TableCell>
                      <TableCell className="text-sm text-white/70 whitespace-nowrap"><When iso={i.lastActivity} /></TableCell>
                      <TableCell>{statusBadge(i)}</TableCell>
                      <TableCell>
                        <Stop>
                          <ActionMenu label={`Actions for ${i.company}`} items={rowActions(i)} />
                        </Stop>
                      </TableCell>
                    </TableRow>
                  ))}
                  {paged.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={9} className="p-0">{emptyState}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-white/[0.06]">
              {paged.map((i) => (
                <div
                  key={i.id}
                  className={cn("p-3 cursor-pointer", selected.has(i.id) && "bg-white/[0.04]", i.status === "disqualified" && "opacity-70")}
                  onClick={() => navigate(`/admin/cloud/${i.id}`)}
                >
                  <div className="flex items-start gap-3">
                    <Stop className="pt-1">
                      <Checkbox aria-label={`Select ${i.company}`} checked={selected.has(i.id)} onCheckedChange={() => toggle(i.id)} />
                    </Stop>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            to={`/admin/cloud/${i.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="block truncate text-sm font-medium text-white/90 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {i.company}
                          </Link>
                          <div className="truncate text-xs text-white/55">
                            {i.contactName}{i.contactEmail ? ` · ${i.contactEmail}` : ""}
                          </div>
                        </div>
                        <Stop>
                          <ActionMenu label={`Actions for ${i.company}`} items={rowActions(i)} />
                        </Stop>
                      </div>
                      {stageCell(i)}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
                        {statusBadge(i)}
                        {i.users && <span>{i.users} users</span>}
                        <span>Created <When iso={i.createdAt} /></span>
                        <span>Active <When iso={i.lastActivity} /></span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {paged.length === 0 && emptyState}
            </div>
          </>
        )}
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-white/55 tabular-nums">
            Page {safePage + 1} of {totalPages} · {filtered.length} leads
          </span>
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <AlertDialog open={!!bulkConfirm} onOpenChange={(o) => { if (!o && !bulkBusy) setBulkConfirm(null); }}>
        <AlertDialogContent className="admin-shell">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {bulkConfirm?.length} lead{bulkConfirm?.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {bulkConfirm?.length === 1 ? "the lead" : "each lead"} and everything attached:
              deals, briefs, timeline and Shield requests. It can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {bulkConfirm && bulkConfirm.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/75 space-y-0.5">
              {bulkConfirm.map((t) => (
                <li key={t.id} className="truncate">{t.company}</li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={bulkBusy} onClick={() => bulkConfirm && runBulkDelete(bulkConfirm)}>
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {bulkBusy ? `Deleting ${bulkProgress!.done} of ${bulkProgress!.total}…` : `Delete ${bulkConfirm?.length ?? 0}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
