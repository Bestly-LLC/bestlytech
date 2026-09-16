import { useEffect, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  fetchSystemHealth,
  healthHeadlineStatus,
  healthHeadlineText,
  type HealthStatus,
  type SubsystemState,
} from "@/lib/systemHealth";
import { Skeleton } from "@/components/ui/skeleton";

interface SystemPulseProps {
  className?: string;
}

/**
 * SystemPulse — top-of-dashboard health banner.
 *
 * v2 (2026-04-30) — rebuilt to read real schema.
 *
 * The previous version read four boolean columns (`ai_pipeline_ok`, `reports_ok`,
 * `patterns_ok`, `maintenance_ok`) that don't exist in `system_alert_state` and
 * never have. Banner stayed green because `is_down=false`, which the v9 health
 * check only flips when its own narrow heartbeat goes stale.
 *
 * Now we compute live health on the client from data the schema actually has:
 *   - AI Generator         last `ai_generation_log` row (any status = alive; success = healthy)
 *   - Cron Heartbeat       last `pattern_fix_log` row
 *   - Email Pipeline       failure count last 24h vs sent count
 *   - External Services    aggregate of `external_health` (from probe-external fn)
 *
 * Each indicator is independently red / amber / green, and the headline is the
 * worst of them. We also still render the v9 `is_down` and `down_systems` from
 * system_alert_state — that's the SMS-firing source of truth for the operator.
 */

type Status = HealthStatus;

const STATUS_DOT: Record<Status, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  down: "bg-red-400",
  unknown: "bg-white/20",
};

const STATUS_WORD: Record<Status, string> = {
  ok: "healthy",
  warn: "degraded",
  down: "down",
  unknown: "unknown",
};

const HEADLINE_BG: Record<Status, string> = {
  ok: "bg-emerald-500/5 border-emerald-500/20",
  warn: "bg-amber-500/5 border-amber-500/20",
  down: "bg-red-500/5 border-red-500/20",
  unknown: "bg-white/[0.03] border-white/[0.06]",
};

function formatRelativeTime(dateString: string): string {
  const diffSec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function SystemPulse({ className }: SystemPulseProps) {
  const [subsystems, setSubsystems] = useState<SubsystemState[]>([]);
  const [downSystems, setDownSystems] = useState<string[]>([]);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [relativeTime, setRelativeTime] = useState("");

  const [alertUnknown, setAlertUnknown] = useState(false);

  const updateRelativeTime = useCallback((iso: string | null) => {
    if (iso) setRelativeTime(formatRelativeTime(iso));
  }, []);

  const loadHealth = useCallback(async () => {
    // Probes live in lib/systemHealth so the admin home Status chip reads the same rules.
    const h = await fetchSystemHealth();
    setSubsystems(h.subsystems);
    setAlertUnknown(h.alertUnknown);
    setDownSystems(h.downSystems);
    setLastChecked(h.lastChecked);
    updateRelativeTime(h.lastChecked);
  }, [updateRelativeTime]);

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, 60_000);
    return () => clearInterval(interval);
  }, [loadHealth]);

  // Note: there is no manual "run health check" button. check-system-health only accepts the service
  // role key or MAINTENANCE_SECRET (it runs on cron), so an admin JWT always got a silent 401. The
  // banner re-reads live data every 60s; the dashboard's More menu offers "Refresh now".

  // Tick relative time every 30s
  useEffect(() => {
    if (!lastChecked) return;
    const i = setInterval(() => updateRelativeTime(lastChecked), 30_000);
    return () => clearInterval(i);
  }, [lastChecked, updateRelativeTime]);

  const health = useMemo(
    () => ({ subsystems, downSystems, lastChecked, alertUnknown }),
    [subsystems, downSystems, lastChecked, alertUnknown]
  );
  const headlineStatus: Status = useMemo(() => healthHeadlineStatus(health), [health]);
  const headlineText = useMemo(() => healthHeadlineText(health), [health]);

  if (subsystems.length === 0) {
    return (
      <div
        className={cn("rounded-2xl border px-4 py-3 bg-white/[0.03] border-white/[0.06] flex items-center gap-3", className)}
        aria-busy="true"
        aria-label="Loading system status"
      >
        <Skeleton className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
        <Skeleton className="h-4 w-48 bg-white/[0.06]" />
        <Skeleton className="h-3 w-64 ml-auto bg-white/[0.04] hidden sm:block" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 transition-colors duration-500",
        HEADLINE_BG[headlineStatus],
        className
      )}
      role="status"
      aria-live="polite"
    >
      {/* Headline pulse + text */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75 animate-[pulse-dot_1.5s_ease-in-out_infinite]",
              STATUS_DOT[headlineStatus]
            )}
          />
          <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", STATUS_DOT[headlineStatus])} />
        </span>
        <span className="text-sm font-medium text-white truncate">{headlineText}</span>
      </div>

      {/* Last-checked from alert_state */}
      {relativeTime && (
        <span className="text-xs text-white/60 tabular-nums whitespace-nowrap">Last check {relativeTime}</span>
      )}

      {/* Subsystem indicators */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ml-auto">
        {subsystems.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5" title={s.detail}>
            <span className={cn("h-1.5 w-1.5 rounded-full transition-colors duration-500", STATUS_DOT[s.status])} aria-hidden />
            <span className="text-xs text-white/70 whitespace-nowrap">
              {s.label}
              <span className="text-white/55 ml-1">{s.detail}</span>
              <span className="sr-only"> ({STATUS_WORD[s.status]})</span>
            </span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { transform: scale(1); opacity: 0.75; }
          50% { transform: scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
