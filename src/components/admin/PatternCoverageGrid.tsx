import { useMemo } from "react";
import { Grid3X3 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Domain {
  domain: string;
  pattern_count: number;
  avg_confidence: number | string | null;
  total_reports: number;
  last_active: string | null;
}

interface PatternCoverageGridProps {
  domains: Domain[];
  onDomainClick?: (domain: string) => void;
  /** Maximum tiles to show (default 50). */
  limit?: number;
}

type Band = { key: string; bg: string; border: string; swatch: string; label: string };

const BANDS: Band[] = [
  { key: "high", bg: "bg-emerald-500/20", border: "border-emerald-500/35", swatch: "bg-emerald-400", label: "High (7+)" },
  { key: "medium", bg: "bg-amber-500/20", border: "border-amber-500/35", swatch: "bg-amber-400", label: "Medium (5–7)" },
  { key: "low", bg: "bg-orange-500/20", border: "border-orange-500/35", swatch: "bg-orange-400", label: "Low (3–5)" },
  { key: "verylow", bg: "bg-red-500/20", border: "border-red-500/35", swatch: "bg-red-400", label: "Very low (<3)" },
  { key: "none", bg: "bg-white/[0.04]", border: "border-white/10", swatch: "bg-white/30", label: "No data" },
];

function bandFor(confidence: number | null): Band {
  if (confidence == null || confidence === 0) return BANDS[4];
  if (confidence >= 7) return BANDS[0];
  if (confidence >= 5) return BANDS[1];
  if (confidence >= 3) return BANDS[2];
  return BANDS[3];
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function PatternCoverageGrid({ domains, onDomainClick, limit = 50 }: PatternCoverageGridProps) {
  const topDomains = useMemo(() => {
    return [...domains]
      .sort((a, b) => (Number(b.total_reports) || 0) - (Number(a.total_reports) || 0))
      .slice(0, limit);
  }, [domains, limit]);

  return (
    <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5" aria-labelledby="coverage-grid-title">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-white/[0.05] flex items-center justify-center" aria-hidden="true">
            <Grid3X3 className="h-4 w-4 text-white/55" />
          </div>
          <div>
            <h3 id="coverage-grid-title" className="text-sm font-medium text-white">Pattern coverage</h3>
            <p className="text-xs text-white/55">Top domains by reports, coloured by average confidence</p>
          </div>
        </div>
      </div>

      {topDomains.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Grid3X3 className="h-8 w-8 text-white/20 mb-2" aria-hidden="true" />
          <p className="text-sm text-white/70">No domain data yet</p>
          <p className="text-xs text-white/55 mt-0.5">Domains appear here once patterns are generated.</p>
        </div>
      ) : (
        <>
          <TooltipProvider delayDuration={150}>
            <ul className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))]">
              {topDomains.map((d) => {
                const conf = toNumber(d.avg_confidence);
                const band = bandFor(conf);
                const reports = Number(d.total_reports) || 0;
                const confText = conf != null ? `${conf.toFixed(1)} (${band.label})` : "No data";
                return (
                  <li key={d.domain}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onDomainClick?.(d.domain)}
                          disabled={!onDomainClick}
                          aria-label={`${d.domain}: ${reports} reports, ${d.pattern_count} patterns, confidence ${confText}`}
                          className={cn(
                            "w-full rounded-lg border px-2 py-2 text-left transition-colors duration-150",
                            "hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
                            "disabled:cursor-default",
                            band.bg,
                            band.border,
                          )}
                        >
                          <p className="text-xs font-medium text-white/90 truncate leading-tight">
                            {d.domain.replace(/^www\./, "")}
                          </p>
                          <p className="text-[0.6875rem] text-white/60 mt-0.5 tabular-nums">
                            {reports.toLocaleString()} reports
                          </p>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="admin-shell max-w-[14rem] space-y-1 text-xs">
                        <p className="font-medium text-white">{d.domain}</p>
                        <div className="text-white/70 space-y-0.5">
                          <p>Patterns: {d.pattern_count}</p>
                          <p>Confidence: {confText}</p>
                          <p>Reports: {reports.toLocaleString()}</p>
                          <p>Last active: {formatDate(d.last_active)}</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </TooltipProvider>

          {/* Legend: colour is never the only signal. */}
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Confidence legend">
            {BANDS.map((b) => (
              <li key={b.key} className="inline-flex items-center gap-1.5 text-xs text-white/60">
                <span className={cn("h-2 w-2 rounded-full", b.swatch)} aria-hidden="true" />
                {b.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
