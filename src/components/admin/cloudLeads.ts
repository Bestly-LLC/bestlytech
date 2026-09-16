import type { LucideIcon } from "lucide-react";
import { downloadCsv } from "@/components/admin/ExportButton";
import {
  Cloud,
  Inbox,
  CalendarCheck,
  FileText,
  CreditCard,
  Wrench,
  Truck,
  CheckCircle2,
} from "lucide-react";

// Stage definitions ─ keep in sync with docs/customer-intake-opusplan.md
export const STAGES: {
  num: number;
  key: string;
  label: string;
  short: string;
  description: string;
  icon: LucideIcon;
  accent: string;
}[] = [
  { num: 1, key: "lead",        label: "New lead",       short: "Lead",      description: "Form submitted, awaiting first contact", icon: Inbox,         accent: "text-blue-400" },
  { num: 2, key: "brief",       label: "Brief in flight", short: "Brief",     description: "Pre-call brief sent, awaiting answers",  icon: FileText,      accent: "text-purple-400" },
  { num: 3, key: "discovery",   label: "Discovery",       short: "Call",      description: "Discovery call scheduled or done",        icon: CalendarCheck, accent: "text-amber-400" },
  { num: 4, key: "sow",         label: "SOW + deposit",   short: "Quote",     description: "Quote sent, signature/payment pending",  icon: CreditCard,    accent: "text-orange-400" },
  { num: 5, key: "intake",      label: "Tech intake",     short: "Intake",    description: "Client filling network/branding/users",  icon: Wrench,        accent: "text-fuchsia-400" },
  { num: 6, key: "provisioning",label: "Provisioning",    short: "Build",     description: "Bestly building the box",                 icon: Cloud,         accent: "text-teal-400" },
  { num: 7, key: "install",     label: "Install",         short: "Install",   description: "Hardware shipped or being installed",    icon: Truck,         accent: "text-cyan-400" },
  { num: 8, key: "live",        label: "Live",            short: "Live",      description: "Deployed and running",                    icon: CheckCircle2,  accent: "text-emerald-400" },
];

/** One row of v_cloud_lead_funnel. */
export type LeadRow = {
  id: string;
  created_at: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  user_count_band: string;
  primary_pain: string | null;
  urgency: string | null;
  status: string;
  brief_submitted_at: string | null;
  deal_id: string | null;
  deal_stage: number | null;
  stage_changed_at: string | null;
  funnel_state: string;
};

/** Columns the funnel view doesn't carry, fetched separately for the list view. */
export type LeadExtra = {
  source: string | null;
  lead_updated_at: string | null;
  deal_updated_at: string | null;
  deal_company_name: string | null;
  deal_contact_name: string | null;
  deal_contact_email: string | null;
};

export function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function fmtExact(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "";
}

export function stageOf(row: LeadRow): { num: number; key: string } {
  if (row.deal_stage != null) {
    const s = STAGES.find((x) => x.num === row.deal_stage) ?? STAGES[0];
    return { num: s.num, key: s.key };
  }
  // No deal yet. Matches CloudDealDetail: brief submitted = Discovery, otherwise Brief.
  // Every lead gets a brief shell on insert, so "lead-only" only happens on a data anomaly.
  if (row.brief_submitted_at) return { num: 3, key: "discovery" };
  if (row.funnel_state === "lead-only") return { num: 1, key: "lead" };
  return { num: 2, key: "brief" };
}

export type LeadSort = "created-desc" | "created-asc" | "activity-desc" | "activity-asc";
/** "all" | "none" (no deal yet) | "1".."8" (deal stage) | "disqualified" */
export type LeadStageFilter = string;
export type LeadListFilters = { search: string; stage: LeadStageFilter; sort: LeadSort };
export const DEFAULT_LEAD_FILTERS: LeadListFilters = { search: "", stage: "all", sort: "created-desc" };

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  disqualified: "Disqualified",
  converted: "Converted",
};

/** A lead merged with its deal (one per lead). */
export type LeadItem = {
  id: string;
  company: string;
  contactName: string;
  contactEmail: string;
  hasDeal: boolean;
  stageNum: number | null;
  stageLabel: string;
  users: string | null;
  status: string;
  source: string | null;
  createdAt: string;
  lastActivity: string;
  nextStep: string | null;
};

function latest(...isos: (string | null | undefined)[]): string {
  let best = "";
  let bestT = -Infinity;
  for (const iso of isos) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (t > bestT) { bestT = t; best = iso; }
  }
  return best;
}

export function buildLeadItems(rows: LeadRow[], extras: Map<string, LeadExtra>): LeadItem[] {
  return rows.map((r) => {
    const x = extras.get(r.id);
    const hasDeal = r.deal_id != null && r.deal_stage != null;
    const stage = hasDeal ? STAGES.find((s) => s.num === r.deal_stage) : undefined;
    const disqualified = r.status === "disqualified";
    let nextStep: string | null = null;
    if (!disqualified) {
      if (stage) nextStep = stage.num === 8 ? null : stage.description;
      else if (r.funnel_state === "brief-done") nextStep = "Brief answered, book the discovery call";
      else if (r.funnel_state === "brief-pending") nextStep = "Waiting on brief answers";
      else nextStep = "Awaiting first contact";
    }
    return {
      id: r.id,
      company: x?.deal_company_name || r.company_name,
      contactName: x?.deal_contact_name || r.contact_name,
      contactEmail: x?.deal_contact_email || r.contact_email,
      hasDeal,
      stageNum: stage?.num ?? null,
      stageLabel: stage?.label ?? "No deal yet",
      users: r.user_count_band || null,
      status: r.status || "new",
      source: x?.source ?? null,
      createdAt: r.created_at,
      lastActivity: latest(x?.deal_updated_at, r.stage_changed_at, x?.lead_updated_at, r.created_at),
      nextStep,
    };
  });
}

export function filterLeadItems(items: LeadItem[], f: LeadListFilters): LeadItem[] {
  const q = f.search.trim().toLowerCase();
  const out = items.filter((i) => {
    if (f.stage === "none" && i.hasDeal) return false;
    if (f.stage === "disqualified" && i.status !== "disqualified") return false;
    if (/^\d$/.test(f.stage) && i.stageNum !== Number(f.stage)) return false;
    if (q) {
      return (
        i.company.toLowerCase().includes(q) ||
        i.contactName.toLowerCase().includes(q) ||
        i.contactEmail.toLowerCase().includes(q)
      );
    }
    return true;
  });
  const key = f.sort.startsWith("activity") ? "lastActivity" : "createdAt";
  const dir = f.sort.endsWith("asc") ? 1 : -1;
  return out.sort((a, b) => dir * (new Date(a[key]).getTime() - new Date(b[key]).getTime()));
}

const EXPORT_COLUMNS = [
  { key: "company", label: "Company" },
  { key: "contactName", label: "Contact" },
  { key: "contactEmail", label: "Email" },
  { key: "stage", label: "Stage" },
  { key: "users", label: "Users" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "createdAt", label: "Created" },
  { key: "lastActivity", label: "Last activity" },
];

/** CSV download (formula guard is built into downloadCsv). Returns rows written. */
export function exportLeadItems(items: LeadItem[], filename = "cloud-leads"): number {
  return downloadCsv(
    items.map((i) => ({
      ...i,
      stage: i.stageNum ? `${i.stageNum} · ${i.stageLabel}` : i.stageLabel,
      status: STATUS_LABEL[i.status] ?? i.status,
    })),
    filename,
    EXPORT_COLUMNS,
  );
}

