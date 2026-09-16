import type { LucideIcon } from "lucide-react";
import { Briefcase, Cloud, Store } from "lucide-react";

/** One row of v_crm_leads: a lead from any funnel, mapped onto one pipeline. */
export type CrmLead = {
  lead_key: string;
  funnel: Funnel;
  source_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  summary: string | null;
  stage: Stage;
  funnel_status: string | null;
  has_deal: boolean;
  value_cents: number | null;
  origin: string | null;
  created_at: string;
  last_activity_at: string;
  detail_url: string;
  starred: boolean;
  follow_up_on: string | null;
  note: string | null;
};

export type Funnel = "cloud" | "marketplace" | "hire";
export type Stage = "new" | "contacted" | "proposal" | "won" | "lost" | "archived";

export const FUNNELS: Record<Funnel, { label: string; short: string; icon: LucideIcon; badge: string; dot: string }> = {
  cloud: { label: "In-House Cloud", short: "Cloud", icon: Cloud, badge: "border-sky-400/25 bg-sky-400/10 text-sky-200", dot: "bg-sky-400" },
  marketplace: { label: "Marketplace Intake", short: "Marketplace", icon: Store, badge: "border-amber-400/25 bg-amber-400/10 text-amber-200", dot: "bg-amber-400" },
  hire: { label: "Hire Request", short: "Hire", icon: Briefcase, badge: "border-violet-400/25 bg-violet-400/10 text-violet-200", dot: "bg-violet-400" },
};

export const STAGES: { value: Stage; label: string; pill: string }[] = [
  { value: "new", label: "New", pill: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" },
  { value: "contacted", label: "Contacted", pill: "border-indigo-400/30 bg-indigo-400/10 text-indigo-200" },
  { value: "proposal", label: "Proposal", pill: "border-orange-400/30 bg-orange-400/10 text-orange-200" },
  { value: "won", label: "Won", pill: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  { value: "lost", label: "Lost", pill: "border-red-400/25 bg-red-400/10 text-red-200" },
  { value: "archived", label: "Archived", pill: "border-white/15 bg-white/5 text-white/60" },
];
export const stageMeta = (s: Stage) => STAGES.find((x) => x.value === s) ?? STAGES[0];
export const OPEN_STAGES: Stage[] = ["new", "contacted", "proposal"];

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const isDue = (l: CrmLead) => !!l.follow_up_on && l.follow_up_on <= todayIso() && OPEN_STAGES.includes(l.stage);

export function relTime(iso: string | null): string {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function fmtFollowUp(date: string): string {
  const t = todayIso();
  if (date === t) return "Today";
  const d = new Date(`${date}T12:00:00`);
  const diff = Math.round((d.getTime() - new Date(`${t}T12:00:00`).getTime()) / 86_400_000);
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return diff === -1 ? "Yesterday" : `${-diff}d overdue`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const displayName = (l: CrmLead) => l.company || l.name || l.email || "Unnamed lead";
export const secondaryName = (l: CrmLead) => (l.company ? l.name || l.email : l.email) || "";
