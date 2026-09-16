import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Globe, RefreshCw, Search } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ExportButton } from "@/components/admin/ExportButton";
import { DomainDeepDive } from "@/components/admin/DomainDeepDive";
import { cn } from "@/lib/utils";
import { fetchAllRows } from "@/lib/fetchAllRows";

type DomainRow = {
  domain: string;
  patterns: number;
  activePatterns: number;
  bestConfidence: number;
  successes: number;
  reports: number;
  resolved: boolean | null;
  lastReported: string | null;
};

type SortKey = "domain" | "reports" | "bestConfidence" | "successes" | "status";

const STATUS = {
  working: { label: "Working", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  pending: { label: "Pending fix", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  noPattern: { label: "No pattern", className: "bg-red-500/15 text-red-300 border-red-500/30" },
  resolved: { label: "Resolved", className: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
} as const;

function statusOf(r: DomainRow): keyof typeof STATUS {
  if (r.successes > 0) return "working";
  if (r.patterns === 0) return "noPattern";
  if (r.resolved) return "resolved";
  return "pending";
}

const EXPORT_COLUMNS = [
  { key: "domain", label: "Domain" },
  { key: "status", label: "Status" },
  { key: "patterns", label: "Patterns" },
  { key: "bestConfidence", label: "Best Confidence" },
  { key: "successes", label: "Confirmed Successes" },
  { key: "reports", label: "User Reports" },
  { key: "lastReported", label: "Last Reported" },
];

const FILTERS: ["all" | keyof typeof STATUS, string][] = [
  ["all", "All"],
  ["working", "Working"],
  ["pending", "Pending"],
  ["noPattern", "No pattern"],
  ["resolved", "Resolved"],
];

export default function CYDomains() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | keyof typeof STATUS>("all");
  const [sortKey, setSortKey] = useState<SortKey>("reports");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDomain = (domain: string) => { setSelectedDomain(domain); setDrawerOpen(true); };

  const fetchAll = useCallback(async () => {
    const [patternsRes, reportsRes] = await Promise.all([
      // Paged: .limit(10000) was silently capped at 1,000 rows by PostgREST.
      fetchAllRows<{ domain: string; confidence: number; success_count: number; is_active: boolean }>((from, to) =>
        supabase.from("cookie_patterns").select("domain, confidence, success_count, is_active").order("id").range(from, to)),
      fetchAllRows<{ domain: string; report_count: number; resolved: boolean; last_reported: string | null }>((from, to) =>
        supabase.from("missed_banner_reports").select("domain, report_count, resolved, last_reported").order("id").range(from, to)),
    ]);
    const firstErr = patternsRes.error || reportsRes.error;
    if (firstErr) {
      // Keep the last good table rather than blanking it.
      setError(firstErr.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setError(null);
    setTruncated(patternsRes.truncated || reportsRes.truncated);

    const map = new Map<string, DomainRow>();
    const ensure = (domain: string): DomainRow => {
      let r = map.get(domain);
      if (!r) {
        r = { domain, patterns: 0, activePatterns: 0, bestConfidence: 0, successes: 0, reports: 0, resolved: null, lastReported: null };
        map.set(domain, r);
      }
      return r;
    };
    for (const p of patternsRes.data || []) {
      const r = ensure(p.domain);
      r.patterns += 1;
      if (p.is_active) r.activePatterns += 1;
      r.bestConfidence = Math.max(r.bestConfidence, Number(p.confidence) || 0);
      r.successes += Number(p.success_count) || 0;
    }
    for (const rep of reportsRes.data || []) {
      const r = ensure(rep.domain);
      r.reports = Number(rep.report_count) || 0;
      r.resolved = !!rep.resolved;
      r.lastReported = rep.last_reported || null;
    }

    setRows(Array.from(map.values()));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const refresh = () => { setRefreshing(true); fetchAll(); };

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.domain.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") list = list.filter((r) => statusOf(r) === statusFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "domain": return a.domain.localeCompare(b.domain) * dir;
        case "bestConfidence": return (a.bestConfidence - b.bestConfidence) * dir;
        case "successes": return (a.successes - b.successes) * dir;
        case "status": return statusOf(a).localeCompare(statusOf(b)) * dir;
        case "reports":
        default: return (a.reports - b.reports) * dir;
      }
    });
  }, [rows, search, statusFilter, sortKey, sortDir]);

  const counts = useMemo(() => {
    const c = { all: rows.length, working: 0, pending: 0, noPattern: 0, resolved: 0 } as Record<string, number>;
    for (const r of rows) c[statusOf(r)] += 1;
    return c;
  }, [rows]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "domain" ? "asc" : "desc"); }
  };

  const exportData = filtered.map((r) => ({
    domain: r.domain,
    status: STATUS[statusOf(r)].label,
    patterns: r.patterns,
    bestConfidence: r.bestConfidence,
    successes: r.successes,
    reports: r.reports,
    lastReported: r.lastReported ?? "",
  }));

  // A render helper (not a component) so the header button keeps focus across re-sorts.
  const sortHead = (k: SortKey, children: string, align: "left" | "right" = "left", className?: string) => {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead
        key={k}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        className={cn("text-xs text-white/60", align === "right" && "text-right", className)}
      >
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={cn(
            "inline-flex items-center gap-1 rounded px-1 py-1 -mx-1 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
            active && "text-white",
          )}
        >
          {children}
          <Icon className={cn("h-3 w-3", active ? "opacity-90" : "opacity-50")} aria-hidden="true" />
        </button>
      </TableHead>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="All Domains"
        description="Every domain with a pattern or a user report. Open one for its history and actions."
        actions={
          <>
            <ExportButton data={exportData} columns={EXPORT_COLUMNS} filename="cookie-yeti-domains" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="icon" aria-label="Refresh"
                  onClick={refresh} disabled={refreshing || loading}
                  className="h-9 w-9 border-white/10 text-white/70 hover:text-white hover:bg-white/5"
                >
                  <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </>
        }
      />

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-300 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm text-red-200">
            Couldn't load domains{rows.length ? " (showing the last list that loaded)" : ""}: <span className="text-red-200/75">{error}</span>
          </p>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="h-9 border-red-500/30 text-red-100 hover:bg-red-500/10">Retry</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={statusFilter === key}
            onClick={() => setStatusFilter(key)}
            className={cn(
              "min-h-[2.25rem] rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              statusFilter === key
                ? "border-white/40 bg-white/10 text-white"
                : "border-white/10 text-white/65 hover:bg-white/[0.05] hover:text-white",
            )}
          >
            {label} <span className="tabular-nums text-white/55">{counts[key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <Search className="h-4 w-4 text-white/45 shrink-0" aria-hidden="true" />
          <Input
            aria-label="Search domains"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search domains"
            className="h-9 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <span className="text-xs text-white/55 shrink-0 tabular-nums">{filtered.length} domains{truncated ? " · first 50,000 rows only" : ""}</span>
        </div>

        {loading ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Globe}
            title={rows.length ? "No domains match" : "No domains yet"}
            description={rows.length ? "Try a different search or status." : "Domains appear once users report banners or patterns are created."}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-white/[0.06]">
                  {sortHead("domain", "Domain")}
                  {sortHead("status", "Status")}
                  {sortHead("reports", "Reports", "right")}
                  <TableHead className="text-right text-xs text-white/60 hidden sm:table-cell">Active / total</TableHead>
                  {sortHead("bestConfidence", "Best conf.", "right", "hidden md:table-cell")}
                  {sortHead("successes", "Successes", "right", "hidden md:table-cell")}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const s = STATUS[statusOf(r)];
                  return (
                    <TableRow key={r.domain} className="border-white/[0.04]">
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => openDomain(r.domain)}
                          className="rounded text-left font-medium text-white/90 hover:text-cyan-300 break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          {r.domain}
                        </button>
                      </TableCell>
                      <TableCell><Badge variant="outline" className={cn("text-xs whitespace-nowrap", s.className)}>{s.label}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums text-white/80">{r.reports}</TableCell>
                      <TableCell className="text-right tabular-nums text-white/60 hidden sm:table-cell">{r.activePatterns}/{r.patterns}</TableCell>
                      <TableCell className="text-right tabular-nums text-white/60 hidden md:table-cell">{r.bestConfidence}</TableCell>
                      <TableCell className="text-right tabular-nums text-white/60 hidden md:table-cell">{r.successes}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <DomainDeepDive domain={selectedDomain} open={drawerOpen} onOpenChange={setDrawerOpen} onRefresh={fetchAll} />
    </div>
  );
}
