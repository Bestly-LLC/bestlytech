import { useMemo } from "react";
import { AlertTriangle, CircleAlert, Info, Sparkles, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface SmartAlertsProps {
  unresolvedReports: Array<{
    domain: string;
    report_count: number;
    ai_attempts: number;
    cmp_fingerprint?: string;
  }>;
  patterns: Array<{
    domain: string;
    confidence: number;
    is_active: boolean;
    success_count: number;
    report_count: number;
  }>;
  aiSuccessRate: number;
  permanentlyFailedCount: number;
  onDomainClick?: (domain: string) => void;
}

type Severity = "critical" | "warning" | "info";

interface Insight {
  severity: Severity;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

const SEVERITY_CONFIG: Record<
  Severity,
  {
    icon: typeof AlertTriangle;
    iconColor: string;
    borderColor: string;
  }
> = {
  critical: {
    icon: AlertTriangle,
    iconColor: "text-red-400",
    borderColor: "border-l-red-500",
  },
  warning: {
    icon: CircleAlert,
    iconColor: "text-amber-400",
    borderColor: "border-l-amber-500",
  },
  info: {
    icon: Info,
    iconColor: "text-blue-400",
    borderColor: "border-l-blue-500",
  },
};

export function SmartAlerts({
  unresolvedReports,
  patterns,
  aiSuccessRate,
  permanentlyFailedCount,
  onDomainClick,
}: SmartAlertsProps) {
  const insights = useMemo(() => {
    const result: Insight[] = [];

    // 1. Domains with high report count (>=10) and 0 successful AI attempts
    const criticalDomains = unresolvedReports.filter(
      (r) => r.report_count >= 10 && r.ai_attempts === 0
    );
    for (const d of criticalDomains) {
      result.push({
        severity: "critical",
        title: `No working pattern for ${d.domain}`,
        description: `${d.report_count} reports but no successful AI attempts.`,
        action: onDomainClick
          ? { label: d.domain, onClick: () => onDomainClick(d.domain) }
          : undefined,
      });
    }

    // 2. Patterns with very low confidence
    const lowConfidence = patterns.filter((p) => p.confidence < 3);
    if (lowConfidence.length > 0) {
      result.push({
        severity: "warning",
        title: "Low confidence patterns",
        description: `${lowConfidence.length} pattern${lowConfidence.length === 1 ? "" : "s"} have very low confidence (< 3).`,
      });
    }

    // 3. AI success rate below 50%
    if (aiSuccessRate < 50) {
      result.push({
        severity: "warning",
        title: "AI pipeline performance degraded",
        description: `Current success rate is ${aiSuccessRate.toFixed(1)}%, which is below the 50% threshold.`,
      });
    }

    // 4. Permanently failed domains
    if (permanentlyFailedCount > 0) {
      result.push({
        severity: "critical",
        title: `${permanentlyFailedCount} domain${permanentlyFailedCount === 1 ? "" : "s"} exhausted all retries`,
        description: "These domains have permanently failed and need manual intervention.",
      });
    }

    // 5. Domains with reports but no AI attempt at all
    const neverProcessed = unresolvedReports.filter(
      (r) => r.report_count > 0 && r.ai_attempts === 0
    );
    // Avoid duplicating domains already flagged in insight #1
    const neverProcessedNotCritical = neverProcessed.filter(
      (r) => r.report_count < 10
    );
    if (neverProcessedNotCritical.length > 0) {
      result.push({
        severity: "info",
        title: `${neverProcessedNotCritical.length} domain${neverProcessedNotCritical.length === 1 ? "" : "s"} never processed by AI`,
        description: "These domains have reports but have not been attempted by the AI pipeline yet.",
      });
    }

    return result.slice(0, 5);
  }, [unresolvedReports, patterns, aiSuccessRate, permanentlyFailedCount, onDomainClick]);

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-white/40" />
        <h3 className="text-sm font-semibold text-white">Insights</h3>
      </div>

      {insights.length === 0 ? (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="text-sm text-emerald-300 font-medium">
            All clear &mdash; no issues detected
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {insights.map((insight, idx) => {
            const config = SEVERITY_CONFIG[insight.severity];
            const Icon = config.icon;

            return (
              <div
                key={idx}
                className={cn(
                  "bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 flex items-center gap-3 border-l-2",
                  config.borderColor
                )}
              >
                {/* Severity icon */}
                <div className="shrink-0">
                  <Icon className={cn("h-4 w-4", config.iconColor)} />
                </div>

                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white leading-snug truncate">
                    {insight.title}
                  </p>
                  <p className="text-xs text-white/40 mt-0.5 line-clamp-2">
                    {insight.description}
                  </p>
                </div>

                {/* Action button */}
                {insight.action && (
                  <button
                    onClick={insight.action.onClick}
                    className="shrink-0 flex items-center gap-1 text-xs text-white/40 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/[0.05]"
                  >
                    <span className="truncate max-w-[100px]">
                      {insight.action.label}
                    </span>
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
