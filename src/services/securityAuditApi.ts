import { supabase } from "@/integrations/supabase/client";

// The security tables are newer than the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

export type Severity = "red" | "yellow";
export type FindingStatus = "open" | "fixed" | "dismissed";
export type RunStatus = "running" | "green" | "yellow" | "red" | "failed";

export interface SecurityRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  trigger: "scheduled" | "manual";
  checks_total: number;
  checks_passed: number;
  checks_warn: number;
  checks_failed: number;
  checks_skipped: number;
  new_findings: number;
  fixed_findings: number;
  open_red: number;
  open_yellow: number;
  summary: string | null;
}

export interface SecurityFinding {
  id: string;
  key: string;
  layer: string;
  asset: string;
  check_name: string;
  severity: Severity;
  status: FindingStatus;
  title: string;
  detail: string | null;
  proposed_fix: string | null;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  nights_open: number;
  dismissed_reason: string | null;
}

export interface SecurityLogRow {
  id: number;
  at: string;
  run_id: string | null;
  finding_key: string | null;
  actor: "audit" | "jared" | "scout";
  action: string;
  asset: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
}

function unwrap<T>(res: { data: T | null; error: { message?: string } | null }): T {
  if (res.error) throw new Error(res.error.message || "request failed");
  return (res.data ?? ([] as unknown)) as T;
}

export async function fetchLatestRun(): Promise<SecurityRun | null> {
  const rows = unwrap<SecurityRun[]>(
    await db.from("security_audit_runs").select("*").order("started_at", { ascending: false }).limit(1),
  );
  return rows[0] ?? null;
}

export async function fetchRuns(limit = 30): Promise<SecurityRun[]> {
  return unwrap<SecurityRun[]>(
    await db.from("security_audit_runs").select("*").order("started_at", { ascending: false }).limit(limit),
  );
}

export async function fetchFindings(): Promise<SecurityFinding[]> {
  return unwrap<SecurityFinding[]>(
    await db
      .from("security_findings")
      .select("id,key,layer,asset,check_name,severity,status,title,detail,proposed_fix,first_seen,last_seen,resolved_at,nights_open,dismissed_reason")
      .order("last_seen", { ascending: false })
      .limit(500),
  );
}

export async function fetchLog(limit = 200): Promise<SecurityLogRow[]> {
  return unwrap<SecurityLogRow[]>(
    await db.from("security_audit_log").select("*").order("at", { ascending: false }).limit(limit),
  );
}

export async function setFindingStatus(id: string, status: FindingStatus, note?: string): Promise<void> {
  unwrap(await db.rpc("security_finding_set_status", { p_id: id, p_status: status, p_note: note ?? null }));
}

/** Command Center chip: green / yellow / red, plus "no run last night". */
export function runHeadline(run: SecurityRun | null): { tone: "ok" | "warn" | "bad"; word: string } {
  if (!run) return { tone: "warn", word: "Never run" };
  const ageH = (Date.now() - new Date(run.started_at).getTime()) / 3_600_000;
  if (ageH > 30) return { tone: "warn", word: "No run last night" };
  if (run.status === "running") return { tone: "warn", word: "Running now" };
  if (run.status === "failed") return { tone: "warn", word: "Last run failed" };
  if (run.open_red > 0) return { tone: "bad", word: `${run.open_red} red` + (run.open_yellow ? ` · ${run.open_yellow} yellow` : "") };
  if (run.open_yellow > 0) return { tone: "warn", word: `${run.open_yellow} to fix this week` };
  return { tone: "ok", word: "All clear" };
}
