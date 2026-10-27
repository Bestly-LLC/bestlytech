import { supabase } from "@/integrations/supabase/client";

// The compliance tables are newer than the generated types; the overview RPC is admin-only (privacy_is_admin()).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => any };

export type ComplianceSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ComplianceFinding {
  key: string;
  area: string;
  title: string;
  severity: ComplianceSeverity;
  readiness: "fail" | "partial" | "gate" | "unknown";
  status: "open" | "watching";
  status_note: string | null;
  fix: string | null;
  lawyer: boolean;
  first_seen: string;
  checks: number;
  failing: number;
}

export interface ComplianceDeadline {
  key: string;
  due: string;
  what: string;
  note: string | null;
  money: boolean;
  uncertain: boolean;
  days_left: number;
}

export interface ComplianceRun {
  id: number;
  kind: string;
  started_at: string;
  finished_at: string | null;
  checks: number;
  failed: number;
  errored: number;
  summary: string | null;
}

export interface ComplianceOverview {
  last_run: ComplianceRun | null;
  last_weekly: ComplianceRun | null;
  counts: { open: number; watching: number; fixed: number; accepted: number; checks: number; failing: number };
  findings: ComplianceFinding[];
  deadlines: ComplianceDeadline[];
  failing_checks: { id: string; title: string; finding_key: string | null; last_detail: string | null; first_fail_at: string | null }[];
  law: { platform: string; headline: string | null; what_it_means: string | null; impact: string; effective_date: string | null; found_at: string; url: string | null }[];
}

export async function fetchComplianceOverview(): Promise<ComplianceOverview> {
  const { data, error } = await db.rpc("admin_compliance_overview");
  if (error) throw new Error(error.message);
  return data as ComplianceOverview;
}
