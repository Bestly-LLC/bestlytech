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
  /** Ares's Auto-Fixer state: needs_person = handed to Jared; watching = Ares has it. */
  autofix: { state?: string; reason?: string; at?: string } | null;
}

/** Who holds an open finding right now. */
export type FindingOwner = "you" | "ares";
export function findingOwner(f: Pick<SecurityFinding, "status" | "severity" | "autofix">): FindingOwner {
  if (f.severity === "red") return "you";
  return f.autofix?.state === "needs_person" ? "you" : "ares";
}

/** Live counts from the findings table itself, not from the last nightly run's snapshot. */
export interface LiveCounts {
  red: number;
  yellow: number;
  needsYou: number;
  withAres: number;
}

export function countOpen(findings: Pick<SecurityFinding, "status" | "severity" | "autofix">[]): LiveCounts {
  const c: LiveCounts = { red: 0, yellow: 0, needsYou: 0, withAres: 0 };
  for (const f of findings) {
    if (f.status !== "open") continue;
    if (f.severity === "red") c.red++; else c.yellow++;
    if (findingOwner(f) === "you") c.needsYou++; else c.withAres++;
  }
  return c;
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
      .select("id,key,layer,asset,check_name,severity,status,title,detail,proposed_fix,first_seen,last_seen,resolved_at,nights_open,dismissed_reason,autofix")
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

export interface SecurityStatus extends LiveCounts {
  run: SecurityRun | null;
}

/** Command Center chip data: the last run (is the audit alive?) plus live open counts. */
export async function fetchSecurityStatus(): Promise<SecurityStatus> {
  const [run, open] = await Promise.all([
    fetchLatestRun(),
    db.from("security_findings").select("status,severity,autofix").eq("status", "open").limit(500)
      .then((r: { data: SecurityFinding[] | null; error: { message?: string } | null }) => unwrap<SecurityFinding[]>(r)),
  ]);
  return { run, ...countOpen(open) };
}

/**
 * Headline for the Command Center chip and the Security page. Counts are live (they drop
 * the moment Ares or Jared closes a finding); the run only says whether the audit is alive.
 * Only things that need Jared turn it orange: findings Ares holds don't.
 */
export function liveHeadline(run: SecurityRun | null, live: LiveCounts): { tone: "ok" | "warn" | "bad"; word: string } {
  if (live.red > 0) return { tone: "bad", word: `${live.red} red` + (live.needsYou > live.red ? ` · ${live.needsYou - live.red} more need you` : "") };
  if (!run) return { tone: "warn", word: "Never run" };
  const ageH = (Date.now() - new Date(run.started_at).getTime()) / 3_600_000;
  if (ageH > 30) return { tone: "warn", word: "No run last night" };
  if (run.status === "failed") return { tone: "warn", word: "Last run failed" };
  if (live.needsYou > 0) return { tone: "warn", word: `${live.needsYou} ${live.needsYou === 1 ? "needs" : "need"} you` };
  if (run.status === "running") return { tone: "ok", word: "Running now" };
  if (live.withAres > 0) return { tone: "ok", word: `Ares has ${live.withAres}` };
  return { tone: "ok", word: "All clear" };
}

/** Realtime: call onChange (debounced) whenever a finding or run changes. Returns cleanup. */
export function subscribeSecurity(onChange: () => void, name = "security-live"): () => void {
  let t: number | null = null;
  const soon = () => { if (t) window.clearTimeout(t); t = window.setTimeout(onChange, 600); };
  const channel = supabase.channel(`${name}-${Math.random().toString(36).slice(2, 8)}`);
  for (const table of ["security_findings", "security_audit_runs"]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channel.on("postgres_changes" as any, { event: "*", schema: "public", table }, soon);
  }
  channel.subscribe();
  return () => { if (t) window.clearTimeout(t); supabase.removeChannel(channel); };
}
