import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { DeleteLeadDialog } from "@/components/admin/DeleteLeadDialog";
import { CloudLeadsList } from "@/components/admin/CloudLeadsList";
import {
  DEFAULT_LEAD_FILTERS,
  STAGES,
  buildLeadItems,
  exportLeadItems,
  filterLeadItems,
  fmtRelative,
  stageOf,
  type LeadExtra,
  type LeadListFilters,
  type LeadRow,
} from "@/components/admin/cloudLeads";
import { cn } from "@/lib/utils";
import {
  Cloud,
  Inbox,
  FileText,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  Link2,
  ExternalLink,
  Trash2,
  FolderOpen,
  Download,
  LayoutGrid,
  List as ListIcon,
} from "lucide-react";

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

type ViewMode = "board" | "list";
const VIEW_KEY = "bestly.admin.cloud.view";

function readViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "board" || v === "list") return v;
  } catch {
    /* storage unavailable */
  }
  return "list";
}

function isStuck(row: LeadRow): boolean {
  // Live deployments are the terminal stage, not stuck.
  if (row.deal_stage === 8) return false;
  const ref = row.stage_changed_at || row.created_at;
  return Date.now() - new Date(ref).getTime() > 7 * 86400000;
}

export default function CloudDeals() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; company_name: string; hasDeal: boolean } | null>(null);
  const [extras, setExtras] = useState<Map<string, LeadExtra>>(new Map());
  const [view, setView] = useState<ViewMode>(readViewMode);
  const [listFilters, setListFilters] = useState<LeadListFilters>(DEFAULT_LEAD_FILTERS);

  const load = useCallback(async () => {
    setLoadError(null);
    const [funnel, leads, deals] = await Promise.all([
      supabase.from("v_cloud_lead_funnel").select("*").limit(500),
      // Columns the funnel view doesn't carry, for the list view.
      supabase.from("cloud_leads").select("id, source, updated_at").limit(500),
      supabase
        .from("cloud_deals")
        .select("lead_id, updated_at, company_name, primary_contact_name, primary_contact_email")
        .limit(500),
    ]);
    const { data, error } = funnel;
    const extraError = leads.error ?? deals.error;
    if (!error && !extraError) {
      const m = new Map<string, LeadExtra>();
      for (const l of leads.data ?? []) {
        m.set(l.id, { source: l.source, lead_updated_at: l.updated_at, deal_updated_at: null, deal_company_name: null, deal_contact_name: null, deal_contact_email: null });
      }
      for (const d of deals.data ?? []) {
        const e = m.get(d.lead_id);
        if (!e) continue;
        // One deal per lead (unique index); if that ever changes, keep the most recently touched.
        if (e.deal_updated_at && new Date(e.deal_updated_at) > new Date(d.updated_at)) continue;
        e.deal_updated_at = d.updated_at;
        e.deal_company_name = d.company_name;
        e.deal_contact_name = d.primary_contact_name;
        e.deal_contact_email = d.primary_contact_email;
      }
      setExtras(m);
    }
    if (error || extraError) {
      // Keep the last good rows on screen.
      setLoadError((error ?? extraError)!.message);
    } else {
      // The funnel view joins deals, so a lead with several deal rows appears several times.
      // Keep one card per lead: the most advanced deal wins.
      const byLead = new Map<string, LeadRow>();
      for (const r of (data || []) as LeadRow[]) {
        const prev = byLead.get(r.id);
        if (!prev || (r.deal_stage ?? 0) > (prev.deal_stage ?? 0)) byLead.set(r.id, r);
      }
      setRows(Array.from(byLead.values()));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function changeView(next: ViewMode) {
    if (next === view) return;
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* storage unavailable */
    }
    // Pick up anything changed in the other view (deletes, status changes).
    load();
  }

  const leadItems = useMemo(() => buildLeadItems(rows, extras), [rows, extras]);
  const filteredLeadItems = useMemo(() => filterLeadItems(leadItems, listFilters), [leadItems, listFilters]);

  function removeRows(ids: string[]) {
    const gone = new Set(ids);
    setRows((prev) => prev.filter((r) => !gone.has(r.id)));
    load();
  }

  function exportFiltered() {
    const n = exportLeadItems(filteredLeadItems);
    toast({ title: n ? `Exported ${n} lead${n === 1 ? "" : "s"}` : "Nothing to export" });
  }

  async function copyLeadFormLink() {
    const url = `${window.location.origin}/get-started`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Lead form link copied", description: url });
    } catch {
      toast({ title: "Couldn't copy", description: url, variant: "destructive" });
    }
  }

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
        actions={
          <>
          <div role="group" aria-label="View" className="inline-flex rounded-md border border-white/10 bg-white/[0.03] p-0.5">
            {([
              ["list", "List", ListIcon],
              ["board", "Board", LayoutGrid],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => changeView(key)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                  view === key ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/[0.05] hover:text-white",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <ActionMenu
            items={[
              ...(view === "list"
                ? [{ group: "Export", label: `Export CSV (${filteredLeadItems.length})`, icon: Download, disabled: filteredLeadItems.length === 0, onSelect: exportFiltered }]
                : []),
              { group: "Lead form", label: "Copy lead form link", icon: Link2, onSelect: copyLeadFormLink },
              { group: "Lead form", label: "Open lead form", icon: ExternalLink, onSelect: () => { window.open("/get-started", "_blank", "noopener,noreferrer"); } },
              { group: "View", label: "Refresh", icon: RefreshCw, onSelect: load },
            ]}
          />
          </>
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
          <span>Couldn't load deals: {loadError}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
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
      )}

      {/* Stuck strip */}
      {stuck.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-amber-200 mb-2">
              {stuck.length} deal{stuck.length === 1 ? "" : "s"} stuck for more than 7 days
            </div>
            <div className="flex flex-wrap gap-2">
              {stuck.slice(0, 6).map((r) => (
                <Link
                  key={r.id}
                  to={`/admin/cloud/${r.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-100 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  {r.company_name}
                  <span className="text-amber-200/80">· {fmtRelative(r.stage_changed_at || r.created_at)}</span>
                </Link>
              ))}
              {stuck.length > 6 && (
                <span className="text-xs text-amber-200/80">+{stuck.length - 6} more</span>
              )}
            </div>
          </div>
        </div>
      )}

      {view === "list" ? (
        <CloudLeadsList
          items={leadItems}
          loading={loading}
          filters={listFilters}
          onFiltersChange={setListFilters}
          onRequestDelete={(i) => setDeleting({ id: i.id, company_name: i.company, hasDeal: i.hasDeal })}
          onRemoved={removeRows}
          onStatusChanged={(id, status) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))}
          onCopyLeadFormLink={copyLeadFormLink}
        />
      ) : /* Pipeline */
      loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : rows.length === 0 && !loadError ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
          <Cloud className="h-10 w-10 text-white/40 mx-auto mb-3" aria-hidden />
          <h3 className="text-base font-medium text-white/80 mb-2">No leads yet</h3>
          <p className="text-sm text-white/60 max-w-md mx-auto">
            When someone submits the form at{" "}
            <Link to="/get-started" className="underline">
              /get-started
            </Link>
            , they'll show up here as a new lead.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={copyLeadFormLink}>
            <Link2 className="h-4 w-4" /> Copy lead form link
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {STAGES.map((s) => {
            const Icon = s.icon;
            const cards = grouped[s.key] || [];
            return (
              <div
                key={s.key}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 min-h-[12.5rem]"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${s.accent}`} aria-hidden />
                    <span className="text-sm font-medium text-white/80">{s.label}</span>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-white/10 bg-white/[0.04] text-white/60 text-[0.6875rem] font-normal"
                  >
                    {cards.length}
                  </Badge>
                </div>
                {cards.length === 0 ? (
                  <div className="text-xs text-white/55 py-4 text-center">No deals here</div>
                ) : (
                  <div className="space-y-2">
                    {cards.map((c) => {
                      const stuckHere = isStuck(c);
                      return (
                        <div
                          key={c.id}
                          className={`group relative rounded-lg border transition-colors hover:bg-white/[0.04] ${
                            stuckHere
                              ? "border-amber-500/30 bg-amber-500/[0.03]"
                              : "border-white/[0.06] bg-white/[0.02]"
                          }`}
                        >
                          <Link
                            to={`/admin/cloud/${c.id}`}
                            className="block rounded-lg p-2.5 pr-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <div className="text-sm font-medium text-white/90 truncate">
                              {c.company_name}
                            </div>
                            <div className="text-xs text-white/60 mt-0.5 truncate">
                              {c.user_count_band} users
                              {c.urgency ? ` · ${URGENCY_LABEL[c.urgency] ?? c.urgency}` : ""}
                            </div>
                            <div className="text-xs text-white/60 mt-1 flex items-center justify-between">
                              <span>{fmtRelative(c.stage_changed_at || c.created_at)}</span>
                              {stuckHere && <span className="inline-flex items-center gap-1 text-amber-300"><AlertTriangle className="h-3 w-3" aria-hidden />Stuck</span>}
                            </div>
                          </Link>
                          <div className="absolute right-1.5 top-1.5">
                            <ActionMenu
                              label={`Actions for ${c.company_name}`}
                              className="h-8 w-8 border-transparent bg-transparent"
                              items={[
                                { label: "Open deal", icon: FolderOpen, onSelect: () => navigate(`/admin/cloud/${c.id}`) },
                                { label: "Delete lead…", icon: Trash2, destructive: true, onSelect: () => setDeleting({ id: c.id, company_name: c.company_name, hasDeal: !!c.deal_id }) },
                              ]}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <DeleteLeadDialog
        lead={deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        onDeleted={() => { if (deleting) removeRows([deleting.id]); else load(); }}
      />
    </div>
  );
}
