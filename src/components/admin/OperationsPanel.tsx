import { useState } from "react";
import { Brain, RotateCcw, Wrench, RefreshCw, Zap, Loader2, LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface OperationsPanelProps {
  onRefresh?: () => void;
  candidateCount?: number;
  permanentlyFailedCount?: number;
}

interface Operation {
  id: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  color: string;
  iconBg: string;
  run: () => Promise<string>;
}

export function OperationsPanel({
  onRefresh,
  candidateCount,
  permanentlyFailedCount,
}: OperationsPanelProps) {
  const [runningOps, setRunningOps] = useState<Record<string, boolean>>({});

  const callEdgeFunction = async (functionName: string): Promise<string> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) throw new Error("Not authenticated");

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(errorBody || `HTTP ${res.status}`);
    }

    const json = await res.json();
    return json.message ?? JSON.stringify(json);
  };

  const operations: Operation[] = [
    {
      id: "ai-generate",
      label: "Run AI Generator",
      subtitle: candidateCount !== undefined ? `${candidateCount} candidates` : "Generate cookie patterns with AI",
      icon: Brain,
      color: "rgb(34 211 238)",   // cyan-400
      iconBg: "bg-cyan-500/10",
      run: () => callEdgeFunction("ai-generate-pattern"),
    },
    {
      id: "retry-failed",
      label: "Retry Failed",
      subtitle: "Retry domains that failed AI generation",
      icon: RotateCcw,
      color: "rgb(251 191 36)",   // amber-400
      iconBg: "bg-amber-500/10",
      run: () => callEdgeFunction("auto-retry-failed-patterns"),
    },
    {
      id: "run-maintenance",
      label: "Run Maintenance",
      subtitle: "Fix patterns + process reports",
      icon: Wrench,
      color: "rgb(167 139 250)",  // violet-400
      iconBg: "bg-violet-500/10",
      run: async () => {
        const { error } = await supabase.rpc("run_maintenance_cron" as any);
        if (error) throw error;
        return "Maintenance completed successfully";
      },
    },
    {
      id: "reset-failed",
      label: "Reset Failed",
      subtitle: permanentlyFailedCount !== undefined
        ? `${permanentlyFailedCount} permanently failed`
        : "Reset permanently failed domains",
      icon: RefreshCw,
      color: "rgb(251 113 133)",  // rose-400
      iconBg: "bg-rose-500/10",
      run: async () => {
        const { error } = await supabase.rpc("reset_failed_domains_cron" as any);
        if (error) throw error;
        return "Failed domains reset successfully";
      },
    },
  ];

  const handleRun = async (op: Operation) => {
    if (runningOps[op.id]) return;

    setRunningOps((prev) => ({ ...prev, [op.id]: true }));
    try {
      const result = await op.run();
      toast.success(`${op.label} completed`, { description: result });
      onRefresh?.();
    } catch (err: any) {
      toast.error(`${op.label} failed`, {
        description: err?.message ?? "Unknown error",
      });
    } finally {
      setRunningOps((prev) => ({ ...prev, [op.id]: false }));
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-3.5 w-3.5 text-white/40" />
        <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">
          Operations
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {operations.map((op) => {
          const Icon = op.icon;
          const isRunning = runningOps[op.id];

          return (
            <div
              key={op.id}
              className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 hover:bg-white/[0.05] transition-colors duration-200 flex flex-col"
            >
              <div
                className={`h-9 w-9 rounded-xl flex items-center justify-center mb-3 ${op.iconBg}`}
              >
                <Icon className="h-[18px] w-[18px]" style={{ color: op.color }} />
              </div>

              <p className="text-sm font-medium text-white leading-tight">
                {op.label}
              </p>
              <p className="text-[11px] text-white/40 mt-1 leading-snug flex-1">
                {op.subtitle}
              </p>

              <button
                onClick={() => handleRun(op)}
                disabled={isRunning}
                className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 disabled:opacity-60"
                style={{
                  backgroundColor: isRunning ? "rgba(255,255,255,0.05)" : `color-mix(in srgb, ${op.color} 15%, transparent)`,
                  color: isRunning ? "rgba(255,255,255,0.4)" : op.color,
                }}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Running...
                  </>
                ) : (
                  "Run"
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
