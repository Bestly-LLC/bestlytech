import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface SystemPulseProps {
  className?: string;
}

interface SystemAlertState {
  id: number;
  is_down: boolean;
  down_systems: string[];
  last_checked: string;
  ai_pipeline_ok: boolean;
  reports_ok: boolean;
  patterns_ok: boolean;
  maintenance_ok: boolean;
}

const SUBSYSTEMS = [
  { key: "ai_pipeline_ok" as const, label: "AI Pipeline" },
  { key: "reports_ok" as const, label: "Reports" },
  { key: "patterns_ok" as const, label: "Patterns" },
  { key: "maintenance_ok" as const, label: "Maintenance" },
];

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export function SystemPulse({ className }: SystemPulseProps) {
  const [state, setState] = useState<SystemAlertState | null>(null);
  const [relativeTime, setRelativeTime] = useState("");

  const updateRelativeTime = useCallback((lastChecked: string | undefined) => {
    if (lastChecked) {
      setRelativeTime(formatRelativeTime(lastChecked));
    }
  }, []);

  // Fetch initial state
  useEffect(() => {
    async function fetchState() {
      const { data, error } = await supabase
        .from("system_alert_state")
        .select("*")
        .eq("id", 1)
        .single();

      if (!error && data) {
        setState(data as unknown as SystemAlertState);
        updateRelativeTime(data.last_checked);
      }
    }

    fetchState();
  }, [updateRelativeTime]);

  // Subscribe to realtime changes
  useEffect(() => {
    const channel = supabase
      .channel("system-pulse")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "system_alert_state",
          filter: "id=eq.1",
        },
        (payload) => {
          const newState = payload.new as unknown as SystemAlertState;
          setState(newState);
          updateRelativeTime(newState.last_checked);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [updateRelativeTime]);

  // Update relative time every 30 seconds
  useEffect(() => {
    if (!state?.last_checked) return;

    updateRelativeTime(state.last_checked);
    const interval = setInterval(() => {
      updateRelativeTime(state.last_checked);
    }, 30_000);

    return () => clearInterval(interval);
  }, [state?.last_checked, updateRelativeTime]);

  if (!state) {
    return (
      <div
        className={cn(
          "rounded-2xl border px-4 py-3 bg-white/[0.03] border-white/[0.06] animate-pulse",
          className
        )}
      >
        <div className="h-5" />
      </div>
    );
  }

  const allOk = !state.is_down;

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 transition-colors duration-500",
        allOk
          ? "bg-emerald-500/5 border-emerald-500/20"
          : "bg-red-500/5 border-red-500/20",
        className
      )}
    >
      {/* Left: pulse dot + status text */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75 animate-[pulse-dot_1.5s_ease-in-out_infinite]",
              allOk ? "bg-emerald-400" : "bg-red-400"
            )}
          />
          <span
            className={cn(
              "relative inline-flex h-2.5 w-2.5 rounded-full",
              allOk ? "bg-emerald-400" : "bg-red-400"
            )}
          />
        </span>

        <span className="text-sm font-medium text-white truncate">
          {allOk ? (
            "All Systems Operational"
          ) : (
            <>
              System Alert
              {state.down_systems?.length > 0 && (
                <span className="text-white/40 font-normal">
                  {" "}&mdash; {state.down_systems.join(", ")}
                </span>
              )}
            </>
          )}
        </span>
      </div>

      {/* Center: last checked */}
      {relativeTime && (
        <span className="text-xs text-white/25 tabular-nums whitespace-nowrap">
          Checked {relativeTime}
        </span>
      )}

      {/* Right: mini status indicators */}
      <div className="flex items-center gap-3 ml-auto">
        {SUBSYSTEMS.map(({ key, label }) => {
          const ok = state[key];
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors duration-500",
                  ok ? "bg-emerald-400" : "bg-red-400"
                )}
              />
              <span className="text-[11px] text-white/40 whitespace-nowrap">
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Pulse keyframes injected via style tag */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% {
            transform: scale(1);
            opacity: 0.75;
          }
          50% {
            transform: scale(2);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
