import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  CheckCircle2,
  XCircle,
  Circle,
  Sparkles,
  FileWarning,
  Wrench,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  CheckCheck,
  PenLine,
  Clock,
  Cpu,
  Zap,
  AlertTriangle,
  Hash,
  Globe,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DomainDeepDiveProps {
  domain: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AI_STATUS_COLORS: Record<string, string> = {
  success: "bg-green-600/15 text-green-600 border-green-600/30",
  success_cmp_fallback: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  success_cmp_fingerprint:
    "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  success_gemini_failsafe: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30",
  error: "bg-red-500/15 text-red-500 border-red-500/30",
  permanently_failed: "bg-red-900/15 text-red-400 border-red-900/30",
  needs_manual_review: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  skipped_no_html:
    "bg-muted text-muted-foreground border-muted-foreground/30",
};

function confidenceColor(c: number | null | undefined): string {
  if (c == null) return "text-white/40";
  if (c >= 7) return "text-emerald-400";
  if (c >= 4) return "text-amber-400";
  return "text-red-400";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(s: string | null | undefined, len = 32): string {
  if (!s) return "-";
  return s.length > len ? s.slice(0, len) + "\u2026" : s;
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  title,
  icon: Icon,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ElementType;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-white hover:bg-white/[0.04] transition-colors">
          <span className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-white/40" />
            {title}
            {count !== undefined && (
              <span className="ml-1 text-xs text-white/25">({count})</span>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-white/30 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-1 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DomainDeepDive({
  domain,
  open,
  onOpenChange,
  onRefresh,
}: DomainDeepDiveProps) {
  const [loading, setLoading] = useState(false);
  const [patterns, setPatterns] = useState<any[]>([]);
  const [aiLogs, setAiLogs] = useState<any[]>([]);
  const [missedReport, setMissedReport] = useState<any | null>(null);
  const [dismissals, setDismissals] = useState<any[]>([]);
  const [fixLogs, setFixLogs] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ---- Fetch all data ----
  const fetchData = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const [patternsRes, aiRes, missedRes, dismissalRes, fixRes] =
        await Promise.all([
          (supabase
            .from("cookie_patterns" as any)
            .select("*")
            .eq("domain", d) as any),
          (supabase
            .from("ai_generation_log" as any)
            .select("*")
            .eq("domain", d)
            .order("created_at", { ascending: false })
            .limit(20) as any),
          (supabase
            .from("missed_banner_reports" as any)
            .select("*")
            .eq("domain", d) as any),
          (supabase
            .from("dismissal_reports" as any)
            .select("*")
            .eq("domain", d)
            .limit(20) as any),
          (supabase
            .from("pattern_fix_log" as any)
            .select("*")
            .eq("domain", d)
            .limit(20) as any),
        ]);

      setPatterns(patternsRes.data || []);
      setAiLogs(aiRes.data || []);
      setMissedReport(
        missedRes.data && missedRes.data.length > 0
          ? missedRes.data[0]
          : null,
      );
      setDismissals(dismissalRes.data || []);
      setFixLogs(fixRes.data || []);
    } catch (err) {
      console.error("DomainDeepDive fetch error", err);
      toast.error("Failed to load domain data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (domain && open) {
      fetchData(domain);
    }
  }, [domain, open, fetchData]);

  // ---- Derived stats ----
  const activePatterns = patterns.filter((p) => p.is_active);
  const totalReports =
    (missedReport?.report_count ?? 0) + dismissals.length;
  const aiAttempts = aiLogs.length;
  const successCount = aiLogs.filter((l: any) =>
    (l.status || "").startsWith("success"),
  ).length;
  const successRate =
    aiAttempts > 0 ? Math.round((successCount / aiAttempts) * 100) : 0;
  const cmpFingerprint =
    patterns.find((p) => p.cmp_name)?.cmp_name ??
    aiLogs.find((l: any) => l.cmp_name)?.cmp_name ??
    null;

  // ---- Actions ----
  const handleRerunAI = async () => {
    if (!domain) return;
    setActionLoading("ai");
    try {
      const { error } = await supabase.functions.invoke(
        "ai-generate-pattern",
        { body: { domain } },
      );
      if (error) throw error;
      toast.success("AI generation triggered for " + domain);
      fetchData(domain);
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.message || "AI generation failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkResolved = async () => {
    if (!domain) return;
    setActionLoading("resolve");
    try {
      const { error } = await (supabase
        .from("missed_banner_reports" as any)
        .update({ resolved: true } as any)
        .eq("domain", domain) as any);
      if (error) throw error;
      toast.success("Marked as resolved");
      fetchData(domain);
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to mark resolved");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTogglePattern = async (patternId: string, currentActive: boolean) => {
    try {
      const { error } = await (supabase
        .from("cookie_patterns" as any)
        .update({ is_active: !currentActive } as any)
        .eq("id", patternId) as any);
      if (error) throw error;
      toast.success(
        `Pattern ${!currentActive ? "activated" : "deactivated"}`,
      );
      if (domain) fetchData(domain);
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle pattern");
    }
  };

  // ---- Render ----
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[500px] sm:w-[600px] overflow-y-auto bg-[#0a0a0a] border-white/[0.06]"
      >
        {/* Accessible description for screen readers */}
        <SheetDescription className="sr-only">
          Detailed information about the selected domain including patterns, AI
          generation history, reports, and quick actions.
        </SheetDescription>

        {loading ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col gap-5">
            {/* ---- HEADER ---- */}
            <SheetHeader className="gap-2">
              <SheetTitle className="text-xl font-bold text-white flex items-center gap-2">
                <Globe className="h-5 w-5 text-white/40" />
                {domain}
              </SheetTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {cmpFingerprint && (
                  <Badge
                    variant="outline"
                    className="border-white/[0.1] text-white/60 text-xs"
                  >
                    CMP: {cmpFingerprint}
                  </Badge>
                )}
                {activePatterns.length > 0 ? (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">
                    Covered
                  </Badge>
                ) : (
                  <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-xs">
                    Uncovered
                  </Badge>
                )}
              </div>
            </SheetHeader>

            {/* ---- QUICK STATS ---- */}
            <div className="grid grid-cols-4 gap-2">
              <StatBox
                label="Active Patterns"
                value={activePatterns.length}
                icon={CheckCircle2}
              />
              <StatBox
                label="Total Reports"
                value={totalReports}
                icon={FileWarning}
              />
              <StatBox
                label="AI Attempts"
                value={aiAttempts}
                icon={Cpu}
              />
              <StatBox
                label="Success Rate"
                value={`${successRate}%`}
                icon={Zap}
              />
            </div>

            <div className="h-px bg-white/[0.06]" />

            {/* ---- PATTERNS ---- */}
            <Section
              title="Patterns"
              icon={Hash}
              count={patterns.length}
              defaultOpen
            >
              {patterns.length === 0 ? (
                <p className="text-sm text-white/25 px-2">
                  No patterns found for this domain.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/25 border-b border-white/[0.06]">
                        <th className="text-left py-2 px-2 font-medium">
                          Selector
                        </th>
                        <th className="text-left py-2 px-2 font-medium">
                          Action
                        </th>
                        <th className="text-left py-2 px-2 font-medium">
                          Conf.
                        </th>
                        <th className="text-left py-2 px-2 font-medium">
                          Source
                        </th>
                        <th className="text-center py-2 px-2 font-medium">
                          Active
                        </th>
                        <th className="text-left py-2 px-2 font-medium">
                          Last Seen
                        </th>
                        <th className="py-2 px-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {patterns.map((p: any) => (
                        <tr
                          key={p.id}
                          className="border-b border-white/[0.04] hover:bg-white/[0.02]"
                        >
                          <td className="py-2 px-2">
                            <code className="text-[11px] bg-white/[0.06] rounded px-1.5 py-0.5 text-white/70 font-mono">
                              {truncate(p.selector, 28)}
                            </code>
                          </td>
                          <td className="py-2 px-2">
                            <ActionBadge type={p.action_type} />
                          </td>
                          <td className="py-2 px-2">
                            <span className={confidenceColor(p.confidence)}>
                              {p.confidence != null
                                ? `${p.confidence}/10`
                                : "-"}
                            </span>
                          </td>
                          <td className="py-2 px-2">
                            <Badge
                              variant="outline"
                              className="text-[10px] border-white/[0.1] text-white/50"
                            >
                              {p.source || "unknown"}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-center">
                            {p.is_active ? (
                              <Circle className="inline h-2.5 w-2.5 fill-emerald-400 text-emerald-400" />
                            ) : (
                              <Circle className="inline h-2.5 w-2.5 fill-red-400 text-red-400" />
                            )}
                          </td>
                          <td className="py-2 px-2 text-white/40">
                            {fmtDate(p.last_seen)}
                          </td>
                          <td className="py-2 px-1">
                            <button
                              onClick={() =>
                                handleTogglePattern(p.id, p.is_active)
                              }
                              className="text-white/30 hover:text-white transition-colors"
                              title={
                                p.is_active ? "Deactivate" : "Activate"
                              }
                            >
                              {p.is_active ? (
                                <ToggleRight className="h-4 w-4 text-emerald-400" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-white/25" />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* ---- AI GENERATION HISTORY ---- */}
            <Section
              title="AI Generation History"
              icon={Sparkles}
              count={aiLogs.length}
              defaultOpen
            >
              {aiLogs.length === 0 ? (
                <p className="text-sm text-white/25 px-2">
                  No AI generation attempts yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2 pl-2">
                  {aiLogs.map((log: any, i: number) => (
                    <div
                      key={log.id || i}
                      className="relative flex flex-col gap-1 rounded-lg bg-white/[0.03] border border-white/[0.06] p-3"
                    >
                      {/* Top row */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${AI_STATUS_COLORS[log.status] || "bg-muted text-muted-foreground border-muted-foreground/30"}`}
                        >
                          {(log.status || "unknown").replaceAll("_", " ")}
                        </Badge>
                        <span className="text-[10px] text-white/25 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {fmtDate(log.created_at)}
                        </span>
                      </div>

                      {/* Details row */}
                      <div className="flex items-center gap-3 text-[11px] text-white/40">
                        {log.model && (
                          <span className="flex items-center gap-1">
                            <Cpu className="h-3 w-3" />
                            {log.model}
                          </span>
                        )}
                        {(log.prompt_tokens != null ||
                          log.completion_tokens != null) && (
                          <span>
                            {log.prompt_tokens ?? 0}p /{" "}
                            {log.completion_tokens ?? 0}c tokens
                          </span>
                        )}
                      </div>

                      {/* Error message */}
                      {log.error_message && (
                        <div className="mt-1 rounded bg-red-500/10 border border-red-500/20 px-2 py-1.5 text-[11px] text-red-400 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span className="break-all">
                            {log.error_message}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ---- REPORT HISTORY ---- */}
            <Section
              title="Report History"
              icon={FileWarning}
              count={totalReports}
            >
              {/* Missed banner report */}
              {missedReport ? (
                <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-xs space-y-2 mb-3">
                  <p className="text-white/60 font-medium text-sm">
                    Missed Banner Report
                  </p>
                  <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-white/50">
                    <span>Report Count</span>
                    <span className="text-white">
                      {missedReport.report_count ?? "-"}
                    </span>
                    <span>Last Reported</span>
                    <span className="text-white">
                      {fmtDate(missedReport.last_reported)}
                    </span>
                    <span>Resolved</span>
                    <span>
                      {missedReport.resolved ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Yes
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1">
                          <XCircle className="h-3 w-3" /> No
                        </span>
                      )}
                    </span>
                    <span>AI Attempts</span>
                    <span className="text-white">
                      {missedReport.ai_attempts ?? "-"}
                    </span>
                    <span>Page URL</span>
                    <span className="text-white/70 break-all">
                      {missedReport.page_url
                        ? truncate(missedReport.page_url, 50)
                        : "-"}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-white/25 px-2 mb-3">
                  No missed banner reports.
                </p>
              )}

              {/* Dismissal reports */}
              {dismissals.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-white/40 text-xs font-medium px-2">
                    Dismissal Reports
                  </p>
                  {dismissals.map((d: any, i: number) => (
                    <div
                      key={d.id || i}
                      className="flex items-center justify-between gap-2 rounded bg-white/[0.02] px-3 py-2 text-xs"
                    >
                      <code className="text-[11px] bg-white/[0.06] rounded px-1.5 py-0.5 text-white/70 font-mono">
                        {truncate(d.clicked_selector, 36)}
                      </code>
                      <span className="text-white/25 whitespace-nowrap">
                        {fmtDate(d.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ---- FIX LOG ---- */}
            <Section
              title="Fix Log"
              icon={Wrench}
              count={fixLogs.length}
            >
              {fixLogs.length === 0 ? (
                <p className="text-sm text-white/25 px-2">
                  No fix log entries.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/25 border-b border-white/[0.06]">
                        <th className="text-left py-2 px-2 font-medium">
                          Issue Type
                        </th>
                        <th className="text-left py-2 px-2 font-medium">
                          Action
                        </th>
                        <th className="text-center py-2 px-2 font-medium">
                          Success
                        </th>
                        <th className="text-left py-2 px-2 font-medium">
                          Timestamp
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {fixLogs.map((f: any, i: number) => (
                        <tr
                          key={f.id || i}
                          className="border-b border-white/[0.04] hover:bg-white/[0.02]"
                        >
                          <td className="py-2 px-2 text-white/60">
                            {f.issue_type || "-"}
                          </td>
                          <td className="py-2 px-2 text-white/50">
                            {truncate(f.action_taken, 30)}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {f.success ? (
                              <CheckCircle2 className="inline h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <XCircle className="inline h-3.5 w-3.5 text-red-400" />
                            )}
                          </td>
                          <td className="py-2 px-2 text-white/40">
                            {fmtDate(f.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <div className="h-px bg-white/[0.06]" />

            {/* ---- QUICK ACTIONS ---- */}
            <div className="space-y-3 pb-4">
              <p className="text-sm font-medium text-white flex items-center gap-2">
                <Zap className="h-4 w-4 text-white/40" /> Quick Actions
              </p>

              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start gap-2 border-white/[0.1] text-white/70 hover:text-white hover:bg-white/[0.06]"
                  disabled={actionLoading === "ai"}
                  onClick={handleRerunAI}
                >
                  {actionLoading === "ai" ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Re-run AI Generator
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start gap-2 border-white/[0.1] text-white/70 hover:text-white hover:bg-white/[0.06]"
                  disabled={
                    actionLoading === "resolve" ||
                    !missedReport ||
                    missedReport?.resolved
                  }
                  onClick={handleMarkResolved}
                >
                  {actionLoading === "resolve" ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCheck className="h-4 w-4" />
                  )}
                  Mark Resolved
                </Button>

                <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-white/[0.08] text-xs text-white/30">
                  <PenLine className="h-4 w-4" />
                  <span>
                    Create Manual Pattern — use the{" "}
                    <span className="text-white/50">Manual Pattern Form</span>{" "}
                    in the sidebar
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatBox({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5">
      <Icon className="h-3.5 w-3.5 text-white/25" />
      <span className="text-base font-semibold text-white">{value}</span>
      <span className="text-[10px] text-white/40 text-center leading-tight">
        {label}
      </span>
    </div>
  );
}

function ActionBadge({ type }: { type: string | null | undefined }) {
  const colors: Record<string, string> = {
    click: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    hide: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    remove: "bg-red-500/15 text-red-400 border-red-500/30",
    accept: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  };

  const cls =
    colors[(type || "").toLowerCase()] ||
    "bg-white/[0.06] text-white/50 border-white/[0.1]";

  return (
    <Badge variant="outline" className={`text-[10px] ${cls}`}>
      {type || "unknown"}
    </Badge>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-3">
        <Skeleton className="h-6 w-48 bg-white/[0.06]" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 bg-white/[0.06]" />
          <Skeleton className="h-5 w-16 bg-white/[0.06]" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg bg-white/[0.06]" />
        ))}
      </div>
      <Skeleton className="h-px w-full bg-white/[0.06]" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-8 w-full rounded-lg bg-white/[0.06]" />
          <Skeleton className="h-24 w-full rounded-lg bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}
