/** Local types for the Pipeline RPCs (see docs/pipeline-opusplan.md). Not tied to the generated Supabase types. */
export type Outcomes = { answered: number; voicemail: number; booked: number; not_interested: number; other: number };
export type AgentKind = "leads" | "support" | "errands";
export type PipelineAgent = {
  slug: string; name: string; purpose: string; kind: AgentKind; page_url: string | null;
  queued: number; target: number; calls_today: number; outcomes: Outcomes; next_call_at: string | null;
};
export type DayPoint = { day: string; found: number; qualified: number; queued: number; called: number; booked: number };
export type Overview = {
  today: { found: number; qualified: number; queued: number; called: number; booked: number; targets: { queued: number } };
  quality: { avg_reach: number; avg_fit: number; n: number };
  funnel14: DayPoint[];
  sources14: Array<{ source: string; found: number; qualified: number }>;
  agents: PipelineAgent[];
  health: { ok: boolean; problems: string[] | null; checked_at: string };
};
export type LeadsPage = { total: number; rows: LeadRow[] };
export type SendResult = { ok: boolean; sent_to: string; lead_table: string; id: string };
export type LeadStatus = "qualified" | "queued" | "called" | "booked" | "archived" | "dnc" | "new";
export type LeadRow = {
  lead_table: "maya_leads" | "rg_leads"; id: string; owner: string; company: string; category: string | null; city: string | null; state: string | null;
  phone_present: boolean; line_type: string | null; fit: number | null; reach: number | null; priority: number | null;
  status: LeadStatus; apollo: boolean | null; updated_at: string;
};
export type Errand = {
  id: string; title: string; who: string | null; phone: string | null; details: string | null; due_by: string | null;
  last_call_id: string | null; status: "open" | "calling" | "done" | "cancelled"; created_at: string; done_at: string | null;
};
export type TakerAgent = { slug: string; name: string };
export type Detail = {
  lead_table: string; id: string; owner: string;
  pipeline: { status: string; owner: string; fit: number | null; reach: number | null; priority: number | null };
  lead: Record<string, unknown>;
  score: Record<string, unknown> | null;
  apollo: { status?: string; found?: Record<string, unknown> | null; tried_at?: string | null } | null;
  calls: Record<string, unknown> | null;
  queue: unknown[] | null;
};
