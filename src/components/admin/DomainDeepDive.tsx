import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
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
import { Switch } from "@/components/ui/switch";
import { ActionMenu } from "@/components/admin/ActionMenu";
import {
  ChevronDown,
  CheckCircle2,
  XCircle,
  Sparkles,
  FileWarning,
  Wrench,
  CheckCheck,
  PenLine,
  Clock,
  Cpu,
  Zap,
  AlertTriangle,
  Hash,
  Globe,
  ExternalLink,
  Copy,
  Loader2,
  MousePointerClick,
  RotateCw,
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
// Shared domain actions (also used by the Auto-Fix and Command Center pages)
// ---------------------------------------------------------------------------

/** ai_generation_log rows that are bookkeeping, not real generation attempts. */
const NON_ATTEMPT_STATUSES = new Set(["no_candidates", "skipped_already_covered", "skipped_excluded_domain"]);
export function isRealAiAttempt(status: string | null | undefined): boolean {
  return !!status && !NON_ATTEMPT_STATUSES.has(status);
}

async function edgeErrorMessage(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return String(body.message ?? body.error);
  } catch {
    /* body was not JSON */
  }
  return error?.message || "Request failed";
}

/**
 * Ask ai-generate-pattern to process one domain. The function only acts on an
 * UNRESOLVED missed_banner_reports row, so we report "nothing to do" honestly
 * instead of claiming success.
 */
export async function runAiForDomain(domain: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("ai-generate-pattern", { body: { domain } });
  if (error) {
    toast.error(`AI run failed for ${domain}`, { description: await edgeErrorMessage(error) });
    return false;
  }
  const res = data as { processed?: number; generated?: number; results?: { status?: string; error?: string }[] } | null;
  if (!res || (res.processed ?? 0) === 0) {
    toast.info(`Nothing to run for ${domain}`, {
      description: "It has no open report. The generator only works on unresolved reports.",
    });
    return false;
  }
  const status = res.results?.[0]?.status ?? "unknown";
  if ((res.generated ?? 0) > 0 || status.startsWith("success")) {
    toast.success(`New pattern generated for ${domain}`, { description: status.replace(/_/g, " ") });
    return true;
  }
  toast.warning(`AI could not fix ${domain}`, {
    description: res.results?.[0]?.error?.slice(0, 180) || status.replace(/_/g, " "),
  });
  return true;
}

/** Mark a domain's missed-banner report resolved. Verifies a row actually changed. */
export async function markDomainResolved(domain: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("missed_banner_reports")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("domain", domain)
    .eq("resolved", false)
    .select("id");
  if (error) {
    toast.error(`Couldn't mark ${domain} resolved`, { description: error.message });
    return false;
  }
  if (!data || data.length === 0) {
    toast.error(`Couldn't mark ${domain} resolved`, {
      description: "No open report was updated. It may already be resolved, or you lack permission.",
    });
    return false;
  }
  toast.success(`${domain} marked resolved`);
  return true;
}

/**
 * Quietly re-run `onChange` (debounced) when any of the Cookie Yeti tables change.
 * Unlike useAdminRealtime this listens to UPDATEs too (report_count bumps, resolves)
 * and never pops a toast for pipeline noise.
 */
export function useCyLiveRefresh(tables: string[], onChange: () => void, delayMs = 1500) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase.channel(`cy-live-${key}-${Math.random().toString(36).slice(2, 8)}`);
    key.split(",").forEach((table) => {
      channel.on("postgres_changes" as any, { event: "*", schema: "public", table }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => cb.current(), delayMs);
      });
    });
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [key, delayMs]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AI_STATUS_COLORS: Record<string, string> = {
  error: "bg-red-500/15 text-red-300 border-red-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
  permanently_failed: "bg-red-500/15 text-red-300 border-red-500/30",
  needs_manual_review: "bg-orange-500/15 text-orange-300 border-orange-500/30",
};

function aiStatusClass(status: string | null | undefined): string {
  if (!status) return "bg-white/[0.06] text-white/70 border-white/15";
  if (status.startsWith("success")) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  return AI_STATUS_COLORS[status] ?? "bg-white/[0.06] text-white/70 border-white/15";
}

function confidenceColor(c: number | null | undefined): string {
  if (c == null) return "text-white/60";
  if (c >= 7) return "text-emerald-300";
  if (c >= 4) return "text-amber-300";
  return "text-red-300";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(s: string | null | undefined, len = 32): string {
  if (!s) return "—";
  return s.length > len ? s.slice(0, len) + "…" : s;
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
        <button
          type="button"
          className="flex w-full min-h-[2.5rem] items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-white hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-white/55" aria-hidden="true" />
            {title}
            {count !== undefined && (
              <span className="ml-1 text-xs text-white/55 tabular-nums">({count})</span>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 text-white/55 transition-transform ${open ? "rotate-180" : ""}`}
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<any[]>([]);
  const [aiLogs, setAiLogs] = useState<any[]>([]);
  const [missedReport, setMissedReport] = useState<any | null>(null);
  const [dismissals, setDismissals] = useState<any[]>([]);
  const [fixLogs, setFixLogs] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState<"ai" | "resolve" | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ---- Fetch all data ----
  const fetchData = useCallback(async (d: string) => {
    setLoading(true);
    setLoadError(null);
    const [patternsRes, aiRes, missedRes, dismissalRes, fixRes] = await Promise.all([
      supabase
        .from("cookie_patterns")
        .select("id, selector, action_type, confidence, source, is_active, last_seen, cmp_fingerprint, success_count, validation_status")
        .eq("domain", d)
        .order("confidence", { ascending: false }),
      supabase
        .from("ai_generation_log")
        .select("id, status, created_at, ai_model, prompt_tokens, completion_tokens, error_message")
        .eq("domain", d)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("missed_banner_reports")
        .select("id, report_count, last_reported, resolved, resolved_at, ai_attempts, render_attempts, page_url, cmp_fingerprint, has_working_pattern")
        .eq("domain", d)
        .limit(1),
      supabase
        .from("dismissal_reports")
        .select("id, clicked_selector, created_at")
        .eq("domain", d)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("pattern_fix_log")
        .select("id, issue_type, action_taken, success, created_at")
        .eq("domain", d)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const firstError = [patternsRes, aiRes, missedRes, dismissalRes, fixRes].find((r) => r.error)?.error;
    if (firstError) {
      console.error("[DomainDeepDive] load", firstError.message);
      setLoadError(firstError.message);
    }
    setPatterns(patternsRes.data || []);
    setAiLogs(aiRes.data || []);
    setMissedReport(missedRes.data?.[0] ?? null);
    setDismissals(dismissalRes.data || []);
    setFixLogs(fixRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (domain && open) {
      fetchData(domain);
    }
  }, [domain, open, fetchData]);

  // ---- Derived stats ----
  const activePatterns = patterns.filter((p) => p.is_active);
  const attempts = aiLogs.filter((l) => isRealAiAttempt(l.status));
  const successCount = attempts.filter((l) => (l.status || "").startsWith("success")).length;
  const successRate = attempts.length > 0 ? Math.round((successCount / attempts.length) * 100) : null;
  const cmpFingerprint =
    missedReport?.cmp_fingerprint && missedReport.cmp_fingerprint !== "unknown"
      ? missedReport.cmp_fingerprint
      : patterns.find((p) => p.cmp_fingerprint && p.cmp_fingerprint !== "generic")?.cmp_fingerprint ?? null;
  const hasOpenReport = !!missedReport && !missedReport.resolved;

  // ---- Actions ----
  const handleRerunAI = async () => {
    if (!domain) return;
    setActionLoading("ai");
    const changed = await runAiForDomain(domain);
    setActionLoading(null);
    if (changed) {
      fetchData(domain);
      onRefresh?.();
    }
  };

  const handleMarkResolved = async () => {
    if (!domain) return;
    setActionLoading("resolve");
    const ok = await markDomainResolved(domain);
    setActionLoading(null);
    if (ok) {
      fetchData(domain);
      onRefresh?.();
    }
  };

  const handleTogglePattern = async (patternId: string, nextActive: boolean) => {
    setTogglingId(patternId);
    const { data, error } = await supabase
      .from("cookie_patterns")
      .update({ is_active: nextActive })
      .eq("id", patternId)
      .select("id");
    setTogglingId(null);
    if (error || !data || data.length === 0) {
      toast.error(`Couldn't ${nextActive ? "turn on" : "turn off"} pattern`, {
        description: error?.message ?? "No row was updated. You may lack permission.",
      });
      return;
    }
    toast.success(`Pattern ${nextActive ? "turned on" : "turned off"}`);
    if (domain) fetchData(domain);
    onRefresh?.();
  };

  const copyDomain = async () => {
    if (!domain) return;
    try {
      await navigator.clipboard.writeText(domain);
      toast.success("Domain copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  // ---- Render ----
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="admin-shell w-full sm:max-w-[36rem] overflow-y-auto bg-[#0a0a0a] border-white/[0.06] text-white"
      >
        <SheetDescription className="sr-only">
          Patterns, AI history, reports and actions for the selected domain.
        </SheetDescription>

        {loading ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col gap-5">
            {/* ---- HEADER ---- */}
            <SheetHeader className="gap-2 pr-8 text-left">
              <SheetTitle className="text-xl font-semibold text-white flex items-center gap-2 break-all">
                <Globe className="h-5 w-5 shrink-0 text-white/55" aria-hidden="true" />
                {domain}
              </SheetTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {activePatterns.length > 0 ? (
                  <Badge variant="outline" className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" /> Covered
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-red-500/15 text-red-300 border-red-500/30 text-xs">
                    <XCircle className="h-3 w-3 mr-1" aria-hidden="true" /> No active pattern
                  </Badge>
                )}
                {missedReport && (
                  <Badge variant="outline" className="border-white/15 text-white/70 text-xs">
                    {missedReport.resolved ? "Report resolved" : "Report open"}
                  </Badge>
                )}
                {cmpFingerprint && (
                  <Badge variant="outline" className="border-white/15 text-white/70 text-xs">
                    CMP: {cmpFingerprint}
                  </Badge>
                )}
              </div>
            </SheetHeader>

            {/* ---- ACTIONS: one primary, one secondary, rest in More ---- */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-9 gap-2"
                disabled={actionLoading !== null || !hasOpenReport}
                onClick={handleRerunAI}
                title={hasOpenReport ? undefined : "Only domains with an open report can be re-run"}
              >
                {actionLoading === "ai" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                )}
                {actionLoading === "ai" ? "Running AI…" : "Re-run AI"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 border-white/15 text-white/80 hover:text-white hover:bg-white/[0.06]"
                disabled={actionLoading !== null || !hasOpenReport}
                onClick={handleMarkResolved}
              >
                {actionLoading === "resolve" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCheck className="h-4 w-4" aria-hidden="true" />
                )}
                Mark resolved
              </Button>
              <ActionMenu
                label={`More actions for ${domain ?? "domain"}`}
                items={[
                  {
                    label: "Open site",
                    icon: ExternalLink,
                    onSelect: () => { if (domain) window.open(`https://${domain}`, "_blank", "noopener,noreferrer"); },
                  },
                  { label: "Copy domain", icon: Copy, onSelect: copyDomain },
                  { label: "Reload details", icon: RotateCw, onSelect: () => { if (domain) return fetchData(domain); } },
                ]}
              />
            </div>
            {!hasOpenReport && (
              <p className="-mt-3 text-xs text-white/55">
                {missedReport ? "This report is already resolved." : "No user has reported this domain."} AI runs only
                work on open reports.{" "}
                <Link
                  to="/admin/cookie-yeti/community"
                  className="inline-flex items-center gap-1 text-white/80 underline underline-offset-2 hover:text-white"
                  onClick={() => onOpenChange(false)}
                >
                  <PenLine className="h-3 w-3" aria-hidden="true" /> Add a manual pattern
                </Link>
              </p>
            )}

            {loadError && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2.5">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-300" aria-hidden="true" />
                <div className="min-w-0 flex-1 text-xs">
                  <p className="font-medium text-red-200">Some details didn't load</p>
                  <p className="text-red-200/75 mt-0.5 break-words">{loadError}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-red-500/30 text-red-100 hover:bg-red-500/10"
                  onClick={() => domain && fetchData(domain)}
                >
                  Retry
                </Button>
              </div>
            )}

            {/* ---- QUICK STATS ---- */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatBox label="Active patterns" value={`${activePatterns.length}/${patterns.length}`} icon={CheckCircle2} />
              <StatBox label="User reports" value={missedReport?.report_count ?? 0} icon={FileWarning} />
              <StatBox label="AI attempts" value={attempts.length} icon={Cpu} />
              <StatBox label="AI success" value={successRate === null ? "—" : `${successRate}%`} icon={Zap} />
            </div>

            <div className="h-px bg-white/[0.06]" />

            {/* ---- PATTERNS ---- */}
            <Section title="Patterns" icon={Hash} count={patterns.length} defaultOpen>
              {patterns.length === 0 ? (
                <p className="text-sm text-white/55 px-2">No patterns for this domain yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/55 border-b border-white/[0.06]">
                        <th scope="col" className="text-left py-2 px-2 font-medium">Selector</th>
                        <th scope="col" className="text-left py-2 px-2 font-medium">Action</th>
                        <th scope="col" className="text-left py-2 px-2 font-medium">Conf.</th>
                        <th scope="col" className="text-left py-2 px-2 font-medium">Worked</th>
                        <th scope="col" className="text-left py-2 px-2 font-medium">Last seen</th>
                        <th scope="col" className="text-right py-2 px-2 font-medium">On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patterns.map((p: any) => (
                        <tr key={p.id} className="border-b border-white/[0.04]">
                          <td className="py-2 px-2">
                            <code
                              className="text-[0.6875rem] bg-white/[0.06] rounded px-1.5 py-0.5 text-white/80 font-mono"
                              title={p.selector}
                            >
                              {truncate(p.selector, 28)}
                            </code>
                            <div className="mt-1 text-[0.6875rem] text-white/55">{p.source || "unknown source"}</div>
                          </td>
                          <td className="py-2 px-2">
                            <ActionBadge type={p.action_type} />
                          </td>
                          <td className="py-2 px-2 tabular-nums">
                            <span className={confidenceColor(p.confidence)}>
                              {p.confidence != null ? `${p.confidence}/10` : "—"}
                            </span>
                          </td>
                          <td className="py-2 px-2 tabular-nums text-white/70">{p.success_count ?? 0}</td>
                          <td className="py-2 px-2 text-white/60 whitespace-nowrap">{fmtDate(p.last_seen)}</td>
                          <td className="py-2 px-2 text-right">
                            {togglingId === p.id ? (
                              <Loader2 className="inline h-4 w-4 animate-spin text-white/60" aria-label="Saving" />
                            ) : (
                              <Switch
                                checked={!!p.is_active}
                                onCheckedChange={(v) => handleTogglePattern(p.id, v)}
                                disabled={togglingId !== null}
                                aria-label={`${p.is_active ? "Turn off" : "Turn on"} pattern ${p.selector}`}
                                className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-white/15"
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* ---- AI GENERATION HISTORY ---- */}
            <Section title="AI history" icon={Sparkles} count={aiLogs.length} defaultOpen={hasOpenReport}>
              {aiLogs.length === 0 ? (
                <p className="text-sm text-white/55 px-2">No AI runs for this domain yet.</p>
              ) : (
                <ol className="flex flex-col gap-2 pl-2">
                  {aiLogs.map((log: any, i: number) => (
                    <li
                      key={log.id || i}
                      className="flex flex-col gap-1 rounded-lg bg-white/[0.03] border border-white/[0.06] p-3"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[0.6875rem] ${aiStatusClass(log.status)}`}>
                          {(log.status || "unknown").replace(/_/g, " ")}
                        </Badge>
                        <span className="text-xs text-white/55 flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {fmtDate(log.created_at)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
                        {log.ai_model && (
                          <span className="flex items-center gap-1">
                            <Cpu className="h-3 w-3" aria-hidden="true" />
                            {log.ai_model}
                          </span>
                        )}
                        {(log.prompt_tokens != null || log.completion_tokens != null) && (
                          <span className="tabular-nums">
                            {log.prompt_tokens ?? 0} in / {log.completion_tokens ?? 0} out tokens
                          </span>
                        )}
                      </div>
                      {log.error_message && (
                        <div className="mt-1 rounded bg-red-500/10 border border-red-500/20 px-2 py-1.5 text-xs text-red-200 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                          <span className="break-words">{log.error_message}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            {/* ---- REPORTS ---- */}
            <Section title="Reports" icon={FileWarning} count={missedReport?.report_count ?? 0}>
              {missedReport ? (
                <dl className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-xs grid grid-cols-2 gap-y-1.5 gap-x-4 mb-3">
                  <dt className="text-white/55">Reports</dt>
                  <dd className="text-white tabular-nums">{missedReport.report_count ?? "—"}</dd>
                  <dt className="text-white/55">Last reported</dt>
                  <dd className="text-white">{fmtDate(missedReport.last_reported)}</dd>
                  <dt className="text-white/55">Status</dt>
                  <dd>
                    {missedReport.resolved ? (
                      <span className="text-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Resolved {missedReport.resolved_at ? fmtDate(missedReport.resolved_at) : ""}
                      </span>
                    ) : (
                      <span className="text-amber-300 flex items-center gap-1">
                        <XCircle className="h-3 w-3" aria-hidden="true" /> Open
                      </span>
                    )}
                  </dd>
                  <dt className="text-white/55">AI / render attempts</dt>
                  <dd className="text-white tabular-nums">
                    {missedReport.ai_attempts ?? 0} / {missedReport.render_attempts ?? 0}
                  </dd>
                  <dt className="text-white/55">Page URL</dt>
                  <dd className="text-white/80 break-all">
                    {missedReport.page_url ? truncate(missedReport.page_url, 60) : "—"}
                  </dd>
                </dl>
              ) : (
                <p className="text-sm text-white/55 px-2 mb-3">No user reports for this domain.</p>
              )}
            </Section>

            {/* ---- DISMISSALS ---- */}
            {dismissals.length > 0 && (
              <Section title="Recent dismissals" icon={MousePointerClick} count={dismissals.length}>
                <ul className="space-y-1.5">
                  {dismissals.map((d: any, i: number) => (
                    <li
                      key={d.id || i}
                      className="flex items-center justify-between gap-2 rounded bg-white/[0.02] px-3 py-2 text-xs"
                    >
                      <code className="text-[0.6875rem] bg-white/[0.06] rounded px-1.5 py-0.5 text-white/80 font-mono" title={d.clicked_selector}>
                        {truncate(d.clicked_selector, 36)}
                      </code>
                      <span className="text-white/55 whitespace-nowrap">{fmtDate(d.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* ---- FIX LOG ---- */}
            <Section title="Fix log" icon={Wrench} count={fixLogs.length}>
              {fixLogs.length === 0 ? (
                <p className="text-sm text-white/55 px-2">No automatic fixes logged.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/55 border-b border-white/[0.06]">
                        <th scope="col" className="text-left py-2 px-2 font-medium">Issue</th>
                        <th scope="col" className="text-left py-2 px-2 font-medium">Action</th>
                        <th scope="col" className="text-left py-2 px-2 font-medium">Result</th>
                        <th scope="col" className="text-left py-2 px-2 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fixLogs.map((f: any, i: number) => (
                        <tr key={f.id || i} className="border-b border-white/[0.04]">
                          <td className="py-2 px-2 text-white/70">{f.issue_type || "—"}</td>
                          <td className="py-2 px-2 text-white/60" title={f.action_taken}>{truncate(f.action_taken, 30)}</td>
                          <td className="py-2 px-2">
                            {f.success ? (
                              <span className="inline-flex items-center gap-1 text-emerald-300">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> OK
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-300">
                                <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Failed
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-white/60 whitespace-nowrap">{fmtDate(f.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
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
      <Icon className="h-3.5 w-3.5 text-white/45" aria-hidden="true" />
      <span className="text-base font-semibold text-white tabular-nums">{value}</span>
      <span className="text-[0.6875rem] text-white/60 text-center leading-tight">{label}</span>
    </div>
  );
}

function ActionBadge({ type }: { type: string | null | undefined }) {
  const colors: Record<string, string> = {
    reject: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    necessary: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    close: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    save: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    accept: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  };

  const cls = colors[(type || "").toLowerCase()] || "bg-white/[0.06] text-white/70 border-white/15";

  return (
    <Badge variant="outline" className={`text-[0.6875rem] ${cls}`}>
      {type || "unknown"}
    </Badge>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading domain details">
      <div className="space-y-3">
        <Skeleton className="h-6 w-48 bg-white/[0.06]" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 bg-white/[0.06]" />
          <Skeleton className="h-5 w-16 bg-white/[0.06]" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28 bg-white/[0.06]" />
        <Skeleton className="h-9 w-32 bg-white/[0.06]" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg bg-white/[0.06]" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-8 w-full rounded-lg bg-white/[0.06]" />
          <Skeleton className="h-24 w-full rounded-lg bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}
