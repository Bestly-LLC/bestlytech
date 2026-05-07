import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Cloud,
  Inbox,
  CalendarCheck,
  FileText,
  CreditCard,
  Wrench,
  Truck,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";

// Stage definitions ─ keep in sync with docs/customer-intake-opusplan.md
const STAGES: {
  num: number;
  key: string;
  label: string;
  short: string;
  description: string;
  icon: any;
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

type LeadRow = {
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

const PAIN_LABEL: Record<string, string> = {
  cost: "Cost",
  sovereignty: "Sovereignty",
  "ai-privacy": "AI privacy",
  brand: "Brand",
  "lock-in": "Lock-in",
  other: "Other",
};

const URGENCY_LABEL: Record<string, string> = {
  "renewal-30": "Renewal in 30d",
  "renewal-90": "Renewal in 90d",
  "renewal-180": "Renewal in 180d",
  exploring: "Exploring",
};

function fmtRelative(iso: string | null): string {
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

function stageOf(row: LeadRow): { num: number; key: string } {
  if (row.deal_stage != null) {
    const s = STAGES.find((x) => x.num === row.deal_stage)!;
    return { num: s.num, key: s.key };
  }
  // No deal yet → lead/brief stages
  if (row.brief_submitted_at) return { num: 3, key: "discovery" };
  if (row.funnel_state === "brief-pending" || row.funnel_state === "lead-only") {
    return { num: row.brief_submitted_at ? 3 : row.brief_submitted_at == null ? 2 : 1, key: "brief" };
  }
  return { num: 1, key: "lead" };
}

function isStuck(row: LeadRow): boolean {
  const ref = row.stage_changed_at || row.created_at;
  return Date.now() - new Date(ref).getTime() > 7 * 86400000;
}

export default function CloudDeals() {
  const { toast } = useToast();
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("v_cloud_lead_funnel")
        .select("*")
        .limit(500);
      if (cancelled) return;
      if (error) {
        toast({
          title: "Couldn't load deals",
          description: error.message,
          variant: "destructive",
        });
      }
      setRows((data || []) as LeadRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Group rows by stage
  const grouped = useMemo(() => {
    const g: Record<string, LeadRow[]> = {};
    for (const s of STAGES) g[s.key] = [];
    for (const r of rows) g[stageOf(r).key].push(r);
    return g;
  }, [rows]);

  const stuck = useMemo(() => rows.filter(isStuck), [rows]);
  const totalLeads = rows.length;
  const newThisWeek = useMemo(() => {
    const wk = Date.now() - 7 * 86400000;
    return rows.filter((r) => new Date(r.created_at).getTime() > wk).length;
  }, [rows]);
  const briefsOpen = rows.filter((r) => r.funnel_state === "brief-pending").length;
  const liveDeals = rows.filter((r) => r.deal_stage === 8).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cloud Deals"
        description="In-House Cloud customer intake pipeline. Lead → brief → discovery → quote → install → live."
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total leads"
          value={totalLeads}
          icon={Inbox}
          iconBg="bg-blue-500/10"
          iconColor="text-blue-400"
        />
        <StatCard
          label="New this week"
          value={newThisWeek}
          icon={ArrowRight}
          iconBg="bg-purple-500/10"
          iconColor="text-purple-400"
        />
        <StatCard
          label="Briefs awaiting"
          value={briefsOpen}
          icon={FileText}
          iconBg="bg-amber-500/10"
          iconColor="text-amber-400"
        />
        <StatCard
          label="Live deployments"
          value={liveDeals}
          icon={CheckCircle2}
          iconBg="bg-emerald-500/10"
          iconColor="text-emerald-400"
        />
      </div>

      {/* Stuck strip */}
      {stuck.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-amber-200 mb-2">
              {stuck.length} deal{stuck.length === 1 ? "" : "s"} stuck &gt; 7 days
            </div>
            <div className="flex flex-wrap gap-2">
              {stuck.slice(0, 6).map((r) => (
                <Link
                  key={r.id}
                  to={`/admin/cloud/${r.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-100 hover:bg-amber-500/20"
                >
                  {r.company_name}
                  <span className="text-amber-300/70">· {fmtRelative(r.stage_changed_at || r.created_at)}</span>
                </Link>
              ))}
              {stuck.length > 6 && (
                <span className="text-xs text-amber-200/60">+{stuck.length - 6} more</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pipeline */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {STAGES.map((s) => {
            const Icon = s.icon;
            const cards = grouped[s.key] || [];
            return (
              <div
                key={s.key}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 min-h-[200px]"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${s.accent}`} />
                    <span className="text-sm font-medium text-white/80">{s.label}</span>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-white/10 bg-white/[0.04] text-white/60 text-[11px] font-normal"
                  >
                    {cards.length}
                  </Badge>
                </div>
                {cards.length === 0 ? (
                  <div className="text-xs text-white/30 py-4 text-center">No deals here</div>
                ) : (
                  <div className="space-y-2">
                    {cards.map((c) => {
                      const stuckHere = isStuck(c);
                      return (
                        <Link
                          key={c.id}
                          to={`/admin/cloud/${c.id}`}
                          className={`block rounded-lg border p-2.5 hover:bg-white/[0.04] transition-colors ${
                            stuckHere
                              ? "border-amber-500/30 bg-amber-500/[0.03]"
                              : "border-white/[0.06] bg-white/[0.02]"
                          }`}
                        >
                          <div className="text-sm font-medium text-white/90 truncate">
                            {c.company_name}
                          </div>
                          <div className="text-xs text-white/50 mt-0.5 truncate">
                            {c.user_count_band} users
                            {c.urgency ? ` · ${URGENCY_LABEL[c.urgency] ?? c.urgency}` : ""}
                          </div>
                          <div className="text-[11px] text-white/40 mt-1 flex items-center justify-between">
                            <span>{fmtRelative(c.stage_changed_at || c.created_at)}</span>
                            {stuckHere && <span className="text-amber-400">stuck</span>}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
          <Cloud className="h-10 w-10 text-white/30 mx-auto mb-3" />
          <h3 className="text-base font-medium text-white/80 mb-2">No leads yet</h3>
          <p className="text-sm text-white/50 max-w-md mx-auto">
            When someone submits the form at{" "}
            <Link to="/get-started" className="underline">
              /get-started
            </Link>
            , they'll show up here. Existing CTAs on the In-House Cloud page now route there.
          </p>
        </div>
      )}
    </div>
  );
}
