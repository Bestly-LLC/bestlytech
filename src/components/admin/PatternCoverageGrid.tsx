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
  avg_confidence: number;
  total_reports: number;
  last_active: string | null;
}

interface PatternCoverageGridProps {
  domains: Domain[];
  onDomainClick?: (domain: string) => void;
}

function getConfidenceColor(confidence: number | null | undefined): {
  bg: string;
  border: string;
  label: string;
} {
  if (confidence == null || confidence === 0) {
    return { bg: "bg-gray-500/20", border: "border-gray-500/30", label: "No data" };
  }
  if (confidence >= 7) {
    return { bg: "bg-emerald-500/25", border: "border-emerald-500/30", label: "High" };
  }
  if (confidence >= 5) {
    return { bg: "bg-amber-500/25", border: "border-amber-500/30", label: "Medium" };
  }
  if (confidence >= 3) {
    return { bg: "bg-orange-500/25", border: "border-orange-500/30", label: "Low" };
  }
  return { bg: "bg-red-500/25", border: "border-red-500/30", label: "Very low" };
}

function truncateDomain(domain: string, maxLen = 12): string {
  if (domain.length <= maxLen) return domain;
  // Remove common prefixes for display
  const short = domain.replace(/^www\./, "");
  if (short.length <= maxLen) return short;
  return short.slice(0, maxLen - 1) + "\u2026";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function PatternCoverageGrid({
  domains,
  onDomainClick,
}: PatternCoverageGridProps) {
  const topDomains = useMemo(() => {
    return [...domains]
      .sort((a, b) => b.total_reports - a.total_reports)
      .slice(0, 50);
  }, [domains]);

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-8 rounded-xl bg-white/[0.05] flex items-center justify-center">
          <Grid3X3 className="h-4 w-4 text-white/40" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-white">Pattern Coverage</h3>
          <p className="text-[10px] text-white/25">
            Domains colored by confidence
          </p>
        </div>
      </div>

      {/* Grid */}
      {topDomains.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Grid3X3 className="h-8 w-8 text-white/10 mb-2" />
          <p className="text-xs text-white/30">No domain data available</p>
          <p className="text-[10px] text-white/15 mt-0.5">
            Domains will appear here once patterns are generated
          </p>
        </div>
      ) : (
        <TooltipProvider delayDuration={150}>
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
            }}
          >
            {topDomains.map((d) => {
              const colors = getConfidenceColor(d.avg_confidence);
              return (
                <Tooltip key={d.domain}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onDomainClick?.(d.domain)}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-left transition-all duration-150",
                        "hover:scale-[1.04] hover:shadow-lg hover:z-10",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
                        colors.bg,
                        colors.border,
                        onDomainClick ? "cursor-pointer" : "cursor-default",
                      )}
                    >
                      <p className="text-[10px] font-medium text-white/80 truncate leading-tight">
                        {truncateDomain(d.domain)}
                      </p>
                      <p className="text-[9px] text-white/30 mt-0.5 tabular-nums">
                        {d.total_reports.toLocaleString()} reports
                      </p>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-[220px] space-y-1 text-xs"
                  >
                    <p className="font-medium text-white">{d.domain}</p>
                    <div className="text-white/60 space-y-0.5 text-[11px]">
                      <p>Patterns: {d.pattern_count}</p>
                      <p>
                        Confidence:{" "}
                        {d.avg_confidence != null
                          ? `${d.avg_confidence.toFixed(1)} (${colors.label})`
                          : "N/A"}
                      </p>
                      <p>Reports: {d.total_reports.toLocaleString()}</p>
                      <p>Last active: {formatDate(d.last_active)}</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
