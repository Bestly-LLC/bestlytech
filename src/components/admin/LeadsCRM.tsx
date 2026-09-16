import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { downloadCsv } from "@/components/admin/ExportButton";
import {
  CrmLead, Funnel, FUNNELS, OPEN_STAGES, Stage, STAGES, displayName, fmtFollowUp, isDue, relTime, secondaryName, stageMeta,
} from "@/components/admin/crmLeads";
import {
  AlertTriangle, CalendarClock, ChevronDown, Download, ExternalLink, LayoutGrid, List as ListIcon, Mail, NotebookPen,
  RefreshCw, Search, Star, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Leads: every lead from every funnel (In-House Cloud, Marketplace Intake, Hire Requests) in one
 * list, on one pipeline. Data comes from v_crm_leads; moving a stage writes the funnel's own
 * status through crm_set_stage, so the funnel pages stay the source of truth. Star, follow-up
 * date and note live in crm_lead_meta.
 */

type StageFilter = "open" | "due" | "all" | Stage;
type FunnelFilter = "all" | Funnel;
type View = "list" | "board";

const VIEW_KEY = "bestly.admin.leads.view";
const BOARD_STAGES: Stage[] = ["new", "contacted", "proposal", "won"];

function readView(): View {
  try { return localStorage.getItem(VIEW_KEY) === "board" ? "board" : "list"; } catch { return "list"; }
}

function FunnelBadge({ funnel, compact = false }: { funnel: Funnel; compact?: boolean }) {
  const f = FUNNELS[funnel];
  const Icon = f.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] whitespace-nowrap", f.badge)}>
      <Icon className="h-3 w-3" aria-hidden="true" /> {compact ? f.short : f.label}
    </span>
  );
}

export default function LeadsCRM() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [funnel, setFunnel] = useState<FunnelFilter>("all");
  const [stage, setStage] = useState<StageFilter>("open");
  const [view, setView] = useState<View>(readView);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<CrmLead | null>(null);
  const [draftDate, setDraftDate] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("v_crm_leads" as any)
      .select("*")
      .order("last_activity_at", { ascending: false })
      .limit(1000);
    if (err) setError(err.message);
    else { setError(null); setRows((data as unknown as CrmLead[]) ?? []); }
    setLoading(false);
  }, []);

  // Live: reload (debounced) when any funnel table or a notification changes; poll as a fallback.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    load();
    const soon = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = window.setTimeout(load, 800); };
    const channel = supabase.channel("crm-leads-live");
    for (const table of ["cloud_leads", "hire_requests", "admin_notifications"]) {
      channel.on("postgres_changes" as any, { event: "*", schema: "public", table }, soon);
    }
    channel.subscribe();
    const poll = window.setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { supabase.removeChannel(channel); window.clearInterval(poll); if (timer.current) window.clearTimeout(timer.current); };
  }, [load]);

  const changeView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };

  const funnelRows = useMemo(() => rows.filter((r) => funnel === "all" || r.funnel === funnel), [rows, funnel]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0, due: 0, all: funnelRows.length };
    for (const s of STAGES) c[s.value] = 0;
    for (const r of funnelRows) {
      c[r.stage] += 1;
      if (OPEN_STAGES.includes(r.stage)) c.open += 1;
      if (isDue(r)) c.due += 1;
    }
    return c;
  }, [funnelRows]);
  const funnelCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0, cloud: 0, marketplace: 0, hire: 0 };
    for (const r of rows) if (r.stage !== "archived") { c.all += 1; c[r.funnel] += 1; }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return funnelRows
      .filter((r) => {
        // The board has a Won column, so "Open" there means open + won.
        if (stage === "open" && !OPEN_STAGES.includes(r.stage) && !(view === "board" && r.stage === "won")) return false;
        if (stage === "due" && !isDue(r)) return false;
        if (stage !== "open" && stage !== "due" && stage !== "all" && r.stage !== stage) return false;
        if (stage === "all" && r.stage === "archived") return false;
        if (!q) return true;
        return [r.name, r.company, r.email, r.summary, r.origin, r.note].some((v) => (v ?? "").toLowerCase().includes(q));
      })
      .sort((a, b) =>
        Number(b.starred) - Number(a.starred) ||
        Number(isDue(b)) - Number(isDue(a)) ||
        new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime());
  }, [funnelRows, stage, search, view]);

  const patchRow = (key: string, patch: Partial<CrmLead>) =>
    setRows((rs) => rs.map((r) => (r.lead_key === key ? { ...r, ...patch } : r)));

  const moveStage = async (lead: CrmLead, next: Stage) => {
    if (lead.stage === next) return;
    setBusy((b) => ({ ...b, [lead.lead_key]: true }));
    const { data, error: err } = await supabase.rpc("crm_set_stage" as any, { p_key: lead.lead_key, p_stage: next } as any);
    setBusy((b) => ({ ...b, [lead.lead_key]: false }));
    if (err || !data) {
      toast.error(`Couldn't move ${displayName(lead)}`, { description: err?.message ?? "Nothing changed." });
      return;
    }
    patchRow(lead.lead_key, { stage: data as Stage });
    toast.success(`${displayName(lead)} → ${stageMeta(data as Stage).label}`);
  };

  const saveMeta = async (lead: CrmLead, patch: { starred?: boolean; follow_up_on?: string | null; note?: string | null }) => {
    const row = {
      lead_key: lead.lead_key,
      starred: patch.starred ?? lead.starred,
      follow_up_on: patch.follow_up_on !== undefined ? patch.follow_up_on : lead.follow_up_on,
      note: patch.note !== undefined ? patch.note : lead.note,
      updated_at: new Date().toISOString(),
    };
    const { data, error: err } = await supabase.from("crm_lead_meta" as any).upsert(row as any).select("lead_key");
    if (err || !data?.length) {
      toast.error("Couldn't save", { description: err?.message ?? "No row was saved." });
      return false;
    }
    patchRow(lead.lead_key, { starred: row.starred, follow_up_on: row.follow_up_on, note: row.note });
    return true;
  };

  const openEditor = (lead: CrmLead) => { setEditing(lead); setDraftDate(lead.follow_up_on ?? ""); setDraftNote(lead.note ?? ""); };
  const saveEditor = async () => {
    if (!editing) return;
    setSaving(true);
    const ok = await saveMeta(editing, { follow_up_on: draftDate || null, note: draftNote.trim() || null });
    setSaving(false);
    if (ok) { toast.success("Saved"); setEditing(null); }
  };

  const exportCsv = () => { downloadCsv(
    filtered.map((r) => ({
      lead: displayName(r), contact: r.name, email: r.email, phone: r.phone, funnel: FUNNELS[r.funnel].label,
      stage: stageMeta(r.stage).label, funnel_status: r.funnel_status, summary: r.summary, origin: r.origin,
      follow_up: r.follow_up_on, note: r.note, created: r.created_at, last_activity: r.last_activity_at,
    })),
    "leads",
  ); };

  const stagePicker = (lead: CrmLead) => {
    const meta = stageMeta(lead.stage);
    const onDeal = lead.funnel === "cloud" && lead.has_deal;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button" disabled={busy[lead.lead_key]} onClick={(e) => e.stopPropagation()}
            aria-label={`Stage: ${meta.label}. Change stage`}
            className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40", meta.pill)}
          >
            {meta.label} <ChevronDown className="h-3 w-3 opacity-70" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel className="text-xs">{onDeal ? `Deal: ${lead.funnel_status}` : "Move to"}</DropdownMenuLabel>
          {onDeal ? (
            <DropdownMenuItem onSelect={() => navigate(lead.detail_url)}>
              <ExternalLink className="h-3.5 w-3.5 mr-2" aria-hidden="true" /> Move it on the deal page
            </DropdownMenuItem>
          ) : (
            STAGES.map((s) => (
              <DropdownMenuItem key={s.value} disabled={s.value === lead.stage} onSelect={() => moveStage(lead, s.value)}>
                <span className={cn("mr-2 h-2 w-2 rounded-full border", s.pill)} aria-hidden="true" /> {s.label}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const menuFor = (lead: CrmLead) => (
    <ActionMenu
      label={`Actions for ${displayName(lead)}`}
      items={[
        { label: "Open", icon: ExternalLink, onSelect: () => navigate(lead.detail_url) },
        ...(lead.email ? [{ label: "Email", icon: Mail, onSelect: () => { window.location.href = `mailto:${lead.email}`; } }] : []),
        { group: "Organize", label: lead.starred ? "Unstar" : "Star", icon: Star, onSelect: () => saveMeta(lead, { starred: !lead.starred }) },
        { group: "Organize", label: lead.follow_up_on || lead.note ? "Edit follow-up and note" : "Set follow-up or note", icon: CalendarClock, onSelect: () => openEditor(lead) },
        ...(lead.funnel === "cloud" && lead.has_deal ? [] : [
          ...(lead.stage !== "lost" ? [{ group: "Close out", label: "Mark lost", icon: AlertTriangle, onSelect: () => moveStage(lead, "lost") }] : []),
          ...(lead.stage !== "archived" ? [{ group: "Close out", label: "Archive", icon: NotebookPen, onSelect: () => moveStage(lead, "archived") }] : []),
        ]),
      ]}
    />
  );

  const starButton = (lead: CrmLead) => (
    <button
      type="button" aria-pressed={lead.starred} aria-label={lead.starred ? "Unstar" : "Star"}
      onClick={(e) => { e.stopPropagation(); saveMeta(lead, { starred: !lead.starred }); }}
      className="h-9 w-9 -m-2 grid place-items-center rounded-md text-white/35 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <Star className={cn("h-4 w-4", lead.starred && "fill-amber-300 text-amber-300")} aria-hidden="true" />
    </button>
  );

  const followUp = (lead: CrmLead) =>
    lead.follow_up_on ? (
      <span className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap", isDue(lead) ? "text-amber-300" : "text-white/60")}>
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {fmtFollowUp(lead.follow_up_on)}
      </span>
    ) : null;

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-10 rounded-xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const pipelineChips: { value: StageFilter; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "new", label: "New" },
    { value: "contacted", label: "Contacted" },
    { value: "proposal", label: "Proposal" },
    { value: "won", label: "Won" },
    { value: "lost", label: "Lost" },
    { value: "due", label: "Follow-ups due" },
    { value: "archived", label: "Archived" },
  ];

  return (
    <div className="space-y-4 min-w-0">
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-300" aria-hidden="true" />
          <p className="text-sm text-red-200 flex-1">Couldn't load leads: {error}</p>
          <Button size="sm" variant="outline" className="h-9 border-red-400/30 text-red-100" onClick={load}>Retry</Button>
        </div>
      )}

      {/* Pipeline: stage chips double as the stage filter. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex w-max gap-2" role="group" aria-label="Filter by stage">
          {pipelineChips.map((c) => {
            const on = stage === c.value;
            const n = counts[c.value] ?? 0;
            const due = c.value === "due" && n > 0;
            return (
              <button
                key={c.value} type="button" aria-pressed={on} onClick={() => setStage(c.value)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-xl border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                  on ? "border-white/30 bg-white/10 text-white" : "border-white/10 bg-white/[0.02] text-white/70 hover:text-white hover:bg-white/5",
                  due && !on && "border-amber-400/30 text-amber-200",
                )}
              >
                {c.label}
                <span className={cn("tabular-nums text-xs", on ? "text-white/80" : "text-white/50")}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search, funnel, view */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, email, note"
            aria-label="Search leads" className="h-9 pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <div className="-mx-1 overflow-x-auto px-1 flex-1 sm:flex-none">
            <div className="flex w-max rounded-lg border border-white/10 bg-white/[0.02] p-0.5" role="group" aria-label="Filter by funnel">
              {(["all", "cloud", "marketplace", "hire"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={funnel === f} onClick={() => setFunnel(f)}
                  className={cn("h-8 rounded-md px-2.5 text-xs whitespace-nowrap", funnel === f ? "bg-white/10 text-white" : "text-white/60 hover:text-white")}>
                  {f === "all" ? "All funnels" : FUNNELS[f].short} <span className="tabular-nums text-white/45">{funnelCounts[f]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="hidden sm:flex rounded-lg border border-white/10 bg-white/[0.02] p-0.5" role="group" aria-label="View">
            {([["list", ListIcon, "List"], ["board", LayoutGrid, "Board"]] as const).map(([v, Icon, label]) => (
              <button key={v} type="button" aria-pressed={view === v} aria-label={label} onClick={() => changeView(v)}
                className={cn("h-8 w-8 grid place-items-center rounded-md", view === v ? "bg-white/10 text-white" : "text-white/55 hover:text-white")}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </button>
            ))}
          </div>
          <ActionMenu label="More lead actions" items={[
            { group: "Export", label: `Export CSV (${filtered.length})`, icon: Download, disabled: filtered.length === 0, onSelect: exportCsv },
            { group: "View", label: "Refresh", icon: RefreshCw, onSelect: load },
          ]} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
          <EmptyState
            icon={Users}
            title={rows.length === 0 ? "No leads yet" : "No leads match"}
            description={rows.length === 0
              ? "New In-House Cloud leads, marketplace intakes and hire requests land here automatically."
              : "Try another stage or funnel, or clear the search."}
            action={rows.length > 0 ? <Button size="sm" variant="outline" className="h-9" onClick={() => { setSearch(""); setStage("all"); setFunnel("all"); }}>Show all leads</Button> : undefined}
          />
        </div>
      ) : view === "board" ? (
        <div className="-mx-1 overflow-x-auto px-1 pb-2">
          <div className="grid grid-cols-4 gap-3 min-w-[56rem]">
            {BOARD_STAGES.map((s) => {
              const col = filtered.filter((r) => r.stage === s);
              const meta = stageMeta(s);
              return (
                <section key={s} aria-label={meta.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-2 min-h-[12rem]">
                  <header className="flex items-center justify-between px-2 py-1.5">
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs", meta.pill)}>{meta.label}</span>
                    <span className="text-xs text-white/50 tabular-nums">{col.length}</span>
                  </header>
                  <ul className="space-y-2">
                    {col.map((l) => (
                      <li key={l.lead_key}>
                        <div role="button" tabIndex={0} onClick={() => navigate(l.detail_url)}
                          onKeyDown={(e) => { if (e.key === "Enter") navigate(l.detail_url); }}
                          className="rounded-xl border border-white/10 bg-black/40 p-3 hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 cursor-pointer">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-white truncate">{displayName(l)}</p>
                              <p className="text-xs text-white/55 truncate">{secondaryName(l)}</p>
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>{menuFor(l)}</div>
                          </div>
                          {l.summary && <p className="mt-2 text-xs text-white/60 line-clamp-2">{l.summary}</p>}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <FunnelBadge funnel={l.funnel} compact />
                            {l.starred && <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-label="Starred" />}
                            {followUp(l)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
          {/* Desktop table */}
          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="text-[0.6875rem] uppercase tracking-wide text-white/55 border-b border-white/[0.06]">
                <th scope="col" className="w-10 px-3 py-2.5"><span className="sr-only">Star</span></th>
                <th scope="col" className="text-left font-medium px-2 py-2.5">Lead</th>
                <th scope="col" className="text-left font-medium px-2 py-2.5">Funnel</th>
                <th scope="col" className="text-left font-medium px-2 py-2.5">Stage</th>
                <th scope="col" className="text-left font-medium px-2 py-2.5 hidden lg:table-cell">Details</th>
                <th scope="col" className="text-left font-medium px-2 py-2.5">Follow-up</th>
                <th scope="col" className="text-right font-medium px-2 py-2.5">Activity</th>
                <th scope="col" className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.lead_key} onClick={() => navigate(l.detail_url)}
                  className="border-t border-white/[0.05] hover:bg-white/[0.03] cursor-pointer">
                  <td className="px-3 py-2.5">{starButton(l)}</td>
                  <td className="px-2 py-2.5 max-w-[16rem]">
                    <button type="button" onClick={(e) => { e.stopPropagation(); navigate(l.detail_url); }}
                      className="block max-w-full text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
                      <span className="block truncate font-medium text-white">{displayName(l)}</span>
                      <span className="block truncate text-xs text-white/55">{secondaryName(l)}</span>
                    </button>
                  </td>
                  <td className="px-2 py-2.5"><FunnelBadge funnel={l.funnel} compact /></td>
                  <td className="px-2 py-2.5">{stagePicker(l)}</td>
                  <td className="px-2 py-2.5 hidden lg:table-cell max-w-[18rem]">
                    <span className="block truncate text-white/65">{l.summary || "—"}</span>
                    {l.note && <span className="block truncate text-xs text-white/45">Note: {l.note}</span>}
                  </td>
                  <td className="px-2 py-2.5">{followUp(l)}</td>
                  <td className="px-2 py-2.5 text-right text-xs text-white/55 whitespace-nowrap">{relTime(l.last_activity_at)}</td>
                  <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>{menuFor(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phone cards */}
          <ul className="md:hidden divide-y divide-white/[0.06]">
            {filtered.map((l) => (
              <li key={l.lead_key} className="p-3" onClick={() => navigate(l.detail_url)}>
                <div className="flex items-start gap-2">
                  {starButton(l)}
                  <div className="min-w-0 flex-1 pl-1">
                    <p className="truncate font-medium text-white">{displayName(l)}</p>
                    <p className="truncate text-xs text-white/55">{secondaryName(l)}</p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>{menuFor(l)}</div>
                </div>
                {l.summary && <p className="mt-1.5 pl-8 text-xs text-white/60 line-clamp-2">{l.summary}</p>}
                <div className="mt-2 pl-8 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {stagePicker(l)}
                  <FunnelBadge funnel={l.funnel} compact />
                  {followUp(l)}
                  <span className="ml-auto text-xs text-white/45">{relTime(l.last_activity_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Follow-up and note</DialogTitle>
            <DialogDescription>{editing ? `${displayName(editing)} · ${FUNNELS[editing.funnel].label}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm text-white/80">
              Follow up on
              <div className="mt-1.5 flex gap-2">
                <Input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="h-9" />
                {draftDate && <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setDraftDate("")}>Clear</Button>}
              </div>
            </label>
            <label className="block text-sm text-white/80">
              Note
              <Textarea value={draftNote} onChange={(e) => setDraftNote(e.target.value)} maxLength={2000} rows={4}
                placeholder="Where things stand, what you promised, next step" className="mt-1.5" />
            </label>
          </div>
          <DialogFooter>
            <Button onClick={saveEditor} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
