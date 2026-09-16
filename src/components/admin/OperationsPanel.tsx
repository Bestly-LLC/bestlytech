import { useState } from "react";
import { Brain, Loader2, RotateCcw, Wrench, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/admin/ActionMenu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface OperationsPanelProps {
  onRefresh?: () => void;
  candidateCount?: number;
  permanentlyFailedCount?: number;
}

type OpId = "ai-generate" | "retry-failed" | "run-maintenance" | "reset-failed";

const LABELS: Record<OpId, string> = {
  "ai-generate": "AI generator",
  "retry-failed": "Retry failed domains",
  "run-maintenance": "Pattern maintenance",
  "reset-failed": "Reset failed domains",
};

/**
 * Cookie Yeti maintenance jobs, grouped by task:
 *   primary   Run AI generator          edge fn ai-generate-pattern (admin JWT accepted)
 *   menu      Retry failed domains      edge fn auto-retry-failed-patterns (admin JWT accepted)
 *             Run pattern maintenance…  rpc run_maintenance_cron (confirm: deactivates stale, deletes broken)
 *   danger    Reset failed domains…     rpc reset_failed_domains_cron (deletes 30-day-old failure logs)
 * All of these also run on cron; this panel is for running one now.
 */
export function OperationsPanel({ onRefresh, candidateCount, permanentlyFailedCount }: OperationsPanelProps) {
  const [running, setRunning] = useState<OpId | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  const invokeFn = async (slug: string): Promise<any> => {
    const { data, error } = await supabase.functions.invoke(slug, { body: {} });
    if (error) {
      let detail = error.message;
      try {
        const body = await (error as any).context?.json?.();
        if (body?.error) detail = body.error;
      } catch {
        /* keep generic message */
      }
      throw new Error(detail);
    }
    return data;
  };

  const ops: Record<OpId, () => Promise<string>> = {
    "ai-generate": async () => {
      const d = await invokeFn("ai-generate-pattern");
      if (!d?.processed) return "No domains were waiting for a pattern.";
      return `Processed ${d.processed}: ${d.generated} generated, ${d.failed} failed, ${d.skipped} skipped.`;
    },
    "retry-failed": async () => {
      const d = await invokeFn("auto-retry-failed-patterns");
      if (d?.message) return d.message;
      return `Retried ${d?.processed ?? 0}: ${d?.succeeded ?? 0} fixed, ${d?.still_failed ?? 0} still failing, ${d?.permanently_failed ?? 0} gave up.`;
    },
    "run-maintenance": async () => {
      const { data, error } = await supabase.rpc("run_maintenance_cron" as never);
      if (error) throw error;
      const d = data as { fix?: { processed?: number; fixed?: number; failed?: number }; reports?: { newly_resolved?: number } } | null;
      if (!d?.fix) return "Maintenance ran.";
      return `${d.fix.fixed ?? 0} pattern${d.fix.fixed === 1 ? "" : "s"} changed${d.fix.failed ? `, ${d.fix.failed} failed` : ""}, ${d.reports?.newly_resolved ?? 0} reports resolved.`;
    },
    "reset-failed": async () => {
      const { data, error } = await supabase.rpc("reset_failed_domains_cron" as never);
      if (error) throw error;
      const d = data as { reset_domains?: number; reset_render?: number; cleaned_logs?: number } | null;
      return `${d?.reset_domains ?? 0} domains queued for AI retry, ${d?.reset_render ?? 0} for another render, ${d?.cleaned_logs ?? 0} old failure logs cleared.`;
    },
  };

  const run = async (id: OpId) => {
    if (running) return;
    setRunning(id);
    try {
      const result = await ops[id]();
      toast.success(`${LABELS[id]} finished`, { description: result });
      onRefresh?.();
    } catch (err: any) {
      toast.error(`${LABELS[id]} failed`, {
        description: `${err?.message ?? "Unknown error"}. Try again, or check the function logs in Supabase.`,
      });
    } finally {
      setRunning(null);
    }
  };

  const busyLabel = running ? `${LABELS[running]} running…` : null;

  return (
    <section aria-labelledby="ops-title" className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-cyan-500/10 flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4 text-cyan-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 id="ops-title" className="text-sm font-semibold text-white">Operations</h3>
            <p className="text-xs text-white/60 mt-0.5" aria-live="polite">
              {busyLabel ??
                [
                  candidateCount !== undefined ? `${candidateCount} unresolved report${candidateCount === 1 ? "" : "s"}` : null,
                  permanentlyFailedCount !== undefined ? `${permanentlyFailedCount} permanently failed` : null,
                  "Jobs also run on schedule.",
                ]
                  .filter(Boolean)
                  .join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-9" onClick={() => run("ai-generate")} disabled={running !== null}>
            {running === "ai-generate" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <Brain className="h-4 w-4 mr-1.5" aria-hidden />}
            {running === "ai-generate" ? "Generating…" : "Run AI generator"}
          </Button>
          <ActionMenu
            label="More maintenance jobs"
            items={[
              { label: "Retry failed domains", icon: RotateCcw, group: "Maintenance", disabled: running !== null, onSelect: () => run("retry-failed") },
              { label: "Run pattern maintenance…", icon: Wrench, group: "Maintenance", disabled: running !== null, onSelect: () => setConfirmMaintenance(true) },
              { label: "Reset failed domains…", icon: RotateCcw, destructive: true, disabled: running !== null, onSelect: () => setConfirmReset(true) },
            ]}
          />
        </div>
      </div>

      <AlertDialog open={confirmMaintenance} onOpenChange={setConfirmMaintenance}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run pattern maintenance now?</AlertDialogTitle>
            <AlertDialogDescription>
              This is the same job that runs every 3 hours. It changes live patterns: patterns not re-reported in 30 days
              are deactivated, patterns reported more than 5 times that never worked are deleted, and weak patterns have
              their confidence lowered. It also resolves user reports that now have a working pattern. Deleted patterns
              can't be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run("run-maintenance")}>Run maintenance</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset failed domains?</AlertDialogTitle>
            <AlertDialogDescription>
              Domains whose last permanent AI failure was over 30 days ago get their attempt count reset so the AI generator
              tries them again, and domains whose render attempts ran out over 30 days ago get another render.
              Failure log entries older than 30 days are deleted. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => run("reset-failed")}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
