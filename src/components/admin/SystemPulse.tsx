import { useEffect, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

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

type Status = "ok" | "warn" | "down" | "unknown";

interface SubsystemState {
  key: string;
  label: string;
  status: Status;
  detail: string;
}

const STATUS_DOT: Record<Status, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  down: "bg-red-400",
  unknown: "bg-white/20",
};

const HEADLINE_BG: Record<Status, string> = {
  ok: "bg-emerald-500/5 border-emerald-500/20",
  warn: "bg-amber-500/5 border-amber-500/20",
  down: "bg-red-500/5 border-red-500/20",
  unknown: "bg-white/[0.03] border-white/[0.06]",
};

function hoursAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

function formatAge(iso: string | null | undefined): string {
  const h = hoursAgo(iso);
  if (h === null) return "never";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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
  const [isRefreshing, setIsRefreshing] = useState(false);

  const updateRelativeTime = useCallback((iso: string | null) => {
    if (iso) setRelativeTime(formatRelativeTime(iso));
  }, []);

  const loadHealth = useCallback(async () => {
    // Run all probes in parallel — every panel is non-blocking.
    const [
      aiGenSuccessRes,
      aiGenAttemptsRes,
      aiGenLatestRes,
      cronRes,
      emailSentRes,
      emailFailedRes,
      externalRes,
      alertStateRes,
    ] = await Promise.all([
      supabase
        .from("ai_generation_log")
        .select("created_at")
        .eq("status", "success")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("ai_generation_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
      supabase
        .from("ai_generation_log")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("pattern_fix_log")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("email_send_log")
        .select("id", { count: "exact", head: true })
        .eq("status", "sent")
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()),
      supabase
        .from("email_send_log")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()),
      // external_health created by P0-5 migration; soft-fail if not deployed yet
      (supabase
        .from("external_health" as any)
        .select("service, status, last_checked, latency_ms") as any),
      supabase
        .from("system_alert_state")
        .select("*")
        .eq("id", 1)
        .maybeSingle(),
    ]);

    const next: SubsystemState[] = [];

    // 1. AI Generator — uses latest activity (heartbeat or success) for liveness
    const lastAiSuccess = aiGenSuccessRes.data?.[0]?.created_at ?? null;
    const lastAiActivity = aiGenLatestRes.data?.[0]?.created_at ?? null;
    const aiAttempts7d = aiGenAttemptsRes.count ?? 0;
    const aiSuccessHours = hoursAgo(lastAiSuccess);
    const aiActivityHours = hoursAgo(lastAiActivity);
    let aiStatus: Status;
    let aiDetail: string;
    if (aiActivityHours === null) {
      aiStatus = "down";
      aiDetail = "no activity ever";
    } else if (aiActivityHours > 24) {
      aiStatus = "down";
      aiDetail = `silent ${formatAge(lastAiActivity)}`;
    } else if (aiSuccessHours !== null && aiSuccessHours <= 24) {
      aiStatus = "ok";
      aiDetail = formatAge(lastAiSuccess);
    } else if (aiSuccessHours !== null && aiSuccessHours <= 72) {
      aiStatus = "warn";
      aiDetail = formatAge(lastAiSuccess);
    } else {
      // Generator is alive (ran within 24h) but no recent successes — idle is ok
      aiStatus = "ok";
      aiDetail = `idle — ${formatAge(lastAiActivity)}`;
    }
    next.push({ key: "ai", label: "AI Generator", status: aiStatus, detail: aiDetail });

    // 2. Cron Heartbeat — pattern_fix_log writes a heartbeat every 3h
    const lastCron = cronRes.data?.[0]?.created_at ?? null;
    const cronHours = hoursAgo(lastCron);
    const cronStatus: Status = cronHours === null ? "down" : cronHours > 6 ? "down" : cronHours > 4 ? "warn" : "ok";
    next.push({ key: "cron", label: "Cron", status: cronStatus, detail: formatAge(lastCron) });

    // 3. Email Pipeline — failures vs sent in 24h
    const sent24 = emailSentRes.count ?? 0;
    const failed24 = emailFailedRes.count ?? 0;
    let emailStatus: Status = "ok";
    let emailDetail: string;
    if (failed24 === 0 && sent24 === 0) {
      emailStatus = "unknown";
      emailDetail = "idle 24h";
    } else if (failed24 > sent24) {
      emailStatus = "down";
      emailDetail = `${failed24} fail / ${sent24} ok`;
    } else if (failed24 > 0) {
      emailStatus = "warn";
      emailDetail = `${failed24} fail / ${sent24} ok`;
    } else {
      emailStatus = "ok";
      emailDetail = `${sent24} ok`;
    }
    next.push({ key: "email", label: "Email", status: emailStatus, detail: emailDetail });

    // 4. External Services — aggregate from probe-external
    const ext = (externalRes as any).data as Array<{ service: string; status: string; last_checked: string }> | null;
    if (ext && ext.length > 0) {
      const downCount = ext.filter((s) => s.status === "down").length;
      const warnCount = ext.filter((s) => s.status === "warn").length;
      const extStatus: Status = downCount > 0 ? "down" : warnCount > 0 ? "warn" : "ok";
      const extDetail =
        downCount > 0
          ? `${downCount} down`
          : warnCount > 0
            ? `${warnCount} degraded`
            : `${ext.length} ok`;
      next.push({ key: "external", label: "External", status: extStatus, detail: extDetail });
    } else {
      next.push({ key: "external", label: "External", status: "unknown", detail: "probe pending" });
    }

    setSubsystems(next);

    const alertState = alertStateRes.data as { down_systems?: string[]; last_checked?: string } | null;
    setDownSystems(alertState?.down_systems ?? []);
    setLastChecked(alertState?.last_checked ?? null);
    updateRelativeTime(alertState?.last_checked ?? null);
  }, [updateRelativeTime]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (token) {
        await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-system-health`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        ).catch(() => {});
      }
      await loadHealth();
    } finally {
      setIsRefreshing(false);
    }
  }, [loadHealth]);

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, 60_000);
    return () => clearInterval(interval);
  }, [loadHealth]);

  // Subscribe to alert_state realtime so SMS-fired downs surface instantly
  useEffect(() => {
    const channel = supabase
      .channel("system-pulse")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "system_alert_state", filter: "id=eq.1" },
        () => loadHealth()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadHealth]);

  // Tick relative time every 30s
  useEffect(() => {
    if (!lastChecked) return;
    const i = setInterval(() => updateRelativeTime(lastChecked), 30_000);
    return () => clearInterval(i);
  }, [lastChecked, updateRelativeTime]);

  const headlineStatus: Status = useMemo(() => {
    if (subsystems.some((s) => s.status === "down")) return "down";
    if (subsystems.some((s) => s.status === "warn")) return "warn";
    if (subsystems.length === 0) return "unknown";
    return "ok";
  }, [subsystems]);

  const headlineText = useMemo(() => {
    if (downSystems.length > 0) return `System Alert — ${downSystems.join(", ")}`;
    if (headlineStatus === "down") {
      const down = subsystems.filter((s) => s.status === "down").map((s) => s.label);
      return `System Alert — ${down.join(", ")}`;
    }
    if (headlineStatus === "warn") {
      const warn = subsystems.filter((s) => s.status === "warn").map((s) => s.label);
      return `Degraded — ${warn.join(", ")}`;
    }
    if (headlineStatus === "unknown") return "Loading statusâ¦";
    return "All Systems Operational";
  }, [headlineStatus, subsystems, downSystems]);

  if (subsystems.length === 0) {
    return (
      <div className={cn("rounded-2xl border px-4 py-3 bg-white/[0.03] border-white/[0.06] animate-pulse", className)}>
        <div className="h-5" />
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
    >
      {/* Headline pulse + text */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
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
        <span className="text-xs text-white/25 tabular-nums whitespace-nowrap">Checked {relativeTime}</span>
      )}

      {/* Refresh button */}
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="shrink-0 p-1 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/[0.05] transition-colors disabled:opacity-40"
        title="Refresh system health"
        aria-label="Refresh system health"
      >
        <svg
          className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 21h5v-5" />
        </svg>
      </button>

      {/* Subsystem indicators */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ml-auto">
        {subsystems.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5" title={s.detail}>
            <span className={cn("h-1.5 w-1.5 rounded-full transition-colors duration-500", STATUS_DOT[s.status])} />
            <span className="text-[11px] text-white/40 whitespace-nowrap">
              {s.label}
              <span className="text-white/25 ml-1">{s.detail}</span>
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
