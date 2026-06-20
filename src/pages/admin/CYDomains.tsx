import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Search, Globe, Loader2, ArrowUpDown, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButton } from "@/components/admin/ExportButton";

type DomainRow = {
  domain: string;
  patterns: number;
  activePatterns: number;
  bestConfidence: number;
  successes: number;
  reports: number;
  resolved: boolean | null;
  lastReported: string | null;
  patternRows: any[];
};

type SortKey = "domain" | "reports" | "bestConfidence" | "successes" | "status";

const STATUS = {
  working: { label: "Working", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  pending: { label: "Pending fix", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  noPattern: { label: "No pattern", className: "bg-red-500/15 text-red-500 border-red-500/30" },
  resolved: { label: "Resolved", className: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
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

export default function CYDomains() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | keyof typeof STATUS>("all");
  const [sortKey, setSortKey] = useState<SortKey>("reports");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<DomainRow | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [patternsRes, reportsRes] = await Promise.all([
      supabase.from("cookie_patterns").select("domain, selector, action_type, cmp_fingerprint, confidence, success_count, is_active, last_seen"),
      supabase.from("missed_banner_reports").select("domain, report_count, resolved, has_working_pattern, last_reported, ai_attempts"),
    ]);
    const patterns = (patternsRes.data as any[]) || [];
    const reports = (reportsRes.data as any[]) || [];

    const map = new Map<string, DomainRow>();
    const ensure = (domain: string): DomainRow => {
      let r = map.get(domain);
      if (!r) {
        r = { domain, patterns: 0, activePatterns: 0, bestConfidence: 0, successes: 0, reports: 0, resolved: null, lastReported: null, patternRows: [] };
        map.set(domain, r);
      }
      return r;
    };

    for (const p of patterns) {
      const r = ensure(p.domain);
      r.patterns += 1;
      if (p.is_active) r.activePatterns += 1;
      r.bestConfidence = Math.max(r.bestConfidence, Number(p.confidence) || 0);
      r.successes += Number(p.success_count) || 0;
      r.patternRows.push(p);
    }
    for (const rep of reports) {
      const r = ensure(rep.domain);
      r.reports = Number(rep.report_count) || 0;
      r.resolved = !!rep.resolved;
      r.lastReported = rep.last_reported || null;
    }

    setRows(Array.from(map.values()));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.domain.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") {
      list = list.filter((r) => statusOf(r) === statusFilter);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "domain": return a.domain.localeCompare(b.domain) * dir;
        case "bestConfidence": return (a.bestConfidence - b.bestConfidence) * dir;
        case "successes": return (a.successes - b.successes) * dir;
        case "status": return statusOf(a).localeCompare(statusOf(b)) * dir;
        case "reports":
        default: return (a.reports - b.reports) * dir;
      }
    });
    return list;
  }, [rows, search, statusFilter, sortKey, sortDir]);

  const counts = useMemo(() => {
    const c = { all: rows.length, working: 0, pending: 0, noPattern: 0, resolved: 0 } as Record<string, number>;
    for (const r of rows) c[statusOf(r)] += 1;
    return c;
  }, [rows]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="All Domains"
        actions={
          <div className="flex items-center gap-2">
            <ExportButton data={exportData} columns={EXPORT_COLUMNS} filename="cookie-yeti-domains" />
            <Button variant="outline" size="sm" onClick={fetchAll} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />} Refresh
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["all", `All ${counts.all}`],
          ["working", `Working ${counts.working}`],
          ["pending", `Pending ${counts.pending}`],
          ["noPattern", `No pattern ${counts.noPattern}`],
          ["resolved", `Resolved ${counts.resolved}`],
        ] as ["all" | keyof typeof STATUS, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              statusFilter === key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search domains…"
              className="border-0 bg-transparent focus-visible:ring-0"
            />
            <span className="text-xs text-muted-foreground shrink-0">{filtered.length} domains</span>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Globe} title="No domains" description="No actioned domains match your filters yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("domain")}>Domain <ArrowUpDown className="inline h-3 w-3 opacity-50" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("status")}>Status</TableHead>
                  <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("reports")}>Reports</TableHead>
                  <TableHead className="text-right">Patterns</TableHead>
                  <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("bestConfidence")}>Confidence</TableHead>
                  <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("successes")}>Successes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const s = STATUS[statusOf(r)];
                  return (
                    <TableRow key={r.domain} className="cursor-pointer" onClick={() => setSelected(r)}>
                      <TableCell className="font-medium">{r.domain}</TableCell>
                      <TableCell><Badge variant="outline" className={s.className}>{s.label}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{r.reports}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.activePatterns}/{r.patterns}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.bestConfidence}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.successes}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selected.domain}
                  <a href={`https://${selected.domain}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-border p-2"><div className="text-lg font-bold">{selected.reports}</div><div className="text-xs text-muted-foreground">Reports</div></div>
                  <div className="rounded-lg border border-border p-2"><div className="text-lg font-bold">{selected.patterns}</div><div className="text-xs text-muted-foreground">Patterns</div></div>
                  <div className="rounded-lg border border-border p-2"><div className="text-lg font-bold">{selected.successes}</div><div className="text-xs text-muted-foreground">Successes</div></div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold">Patterns</p>
                  {selected.patternRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No patterns generated yet — the AI will attempt this domain on the next run.</p>
                  ) : (
                    <div className="space-y-2">
                      {[...selected.patternRows]
                        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
                        .map((p, i) => (
                          <div key={i} className="rounded-lg border border-border p-2 text-xs">
                            <code className="break-all text-foreground">{p.selector}</code>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                              <Badge variant="outline" className="text-[10px]">{p.action_type}</Badge>
                              <span>conf {p.confidence}</span>
                              <span>· {p.success_count} successes</span>
                              <span>· {p.cmp_fingerprint}</span>
                              {!p.is_active && <span className="text-red-500">· inactive</span>}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
