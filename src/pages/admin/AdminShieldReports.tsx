import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { ActionMenu, type ActionItem } from "@/components/admin/ActionMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  Check,
  X,
  Copy,
  ExternalLink,
  Inbox,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  CopyX,
  Cloud,
  Loader2,
  Search,
} from "lucide-react";

type Report = {
  id: string;
  created_at: string;
  reported_url: string;
  reported_domain: string | null;
  reason: string | null;
  reporter_email: string | null;
  reporter_org: string | null;
  deal_id: string | null;
  status: "new" | "reviewing" | "allowed" | "denied" | "duplicate";
  reviewed_at: string | null;
  reviewed_by: string | null;
  decision_note: string | null;
};

const STATUS_LABEL: Record<Report["status"], string> = {
  new: "New",
  reviewing: "Reviewing",
  allowed: "Allowed",
  denied: "Denied",
  duplicate: "Duplicate",
};

const STATUS_COLOR: Record<Report["status"], string> = {
  new: "border-blue-500/30 text-blue-300 bg-blue-500/[0.08]",
  reviewing: "border-amber-500/30 text-amber-300 bg-amber-500/[0.08]",
  allowed: "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]",
  denied: "border-red-500/30 text-red-300 bg-red-500/[0.08]",
  duplicate: "border-white/20 text-white/60 bg-white/[0.04]",
};

function fmtAge(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function domainOf(r: Report): string {
  if (r.reported_domain) return r.reported_domain;
  try {
    return new URL(r.reported_url.startsWith("http") ? r.reported_url : `https://${r.reported_url}`).hostname;
  } catch {
    return r.reported_url;
  }
}

export default function AdminShieldReports() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Report["status"]>("new");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // shield_url_reports.deal_id is a cloud_deals.id, but /admin/cloud/:id is keyed by lead id.
  const [dealLeadIds, setDealLeadIds] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase
      .from("shield_url_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }
    const list = (data || []) as Report[];
    setRows(list);
    setLoading(false);

    const dealIds = Array.from(new Set(list.map((r) => r.deal_id).filter(Boolean))) as string[];
    if (dealIds.length) {
      const { data: deals } = await supabase.from("cloud_deals").select("id, lead_id").in("id", dealIds);
      const map: Record<string, string> = {};
      for (const d of deals || []) map[d.id] = d.lead_id;
      setDealLeadIds(map);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let out = rows;
    if (filter !== "all") out = out.filter((r) => r.status === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (r) =>
          (r.reported_url || "").toLowerCase().includes(q) ||
          (r.reported_domain || "").toLowerCase().includes(q) ||
          (r.reporter_org || "").toLowerCase().includes(q) ||
          (r.reporter_email || "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, filter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { new: 0, reviewing: 0, allowed: 0, denied: 0, duplicate: 0, all: rows.length };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  async function decide(r: Report, status: Report["status"]) {
    // Copy first, while we still have the click's user activation.
    let copied = false;
    if (status === "allowed") {
      try {
        await navigator.clipboard.writeText(domainOf(r));
        copied = true;
      } catch {
        copied = false;
      }
    }
    setBusy(r.id);
    // Reopening ("new") clears the review so the report doesn't read "Reviewed just now".
    const reopening = status === "new";
    const update = {
      status,
      reviewed_at: reopening ? null : new Date().toISOString(),
      reviewed_by: reopening ? null : "operator",
    };
    const { data, error } = await supabase
      .from("shield_url_reports")
      .update(update)
      .eq("id", r.id)
      .select("id");
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't update report", description: `${error.message}. Nothing changed — try again.`, variant: "destructive" });
      return;
    }
    if (!data || data.length === 0) {
      toast({ title: "Report not updated", description: "No rows changed. Your account may not have permission, or the report was removed. Refresh and try again.", variant: "destructive" });
      return;
    }
    setRows((prev) => prev.map((x) => (x.id === r.id ? ({ ...x, ...update } as Report) : x)));
    if (status === "allowed") {
      toast({
        title: "Marked allowed",
        description: copied
          ? `${domainOf(r)} copied. Paste it into the Shield allowlist to unblock it.`
          : `Add ${domainOf(r)} to the Shield allowlist to unblock it.`,
      });
    } else {
      toast({ title: `Marked ${STATUS_LABEL[status].toLowerCase()}` });
    }
  }

  async function copyDomain(r: Report) {
    const d = domainOf(r);
    try {
      await navigator.clipboard.writeText(d);
      toast({ title: "Domain copied", description: d });
    } catch {
      toast({ title: "Couldn't copy", description: d, variant: "destructive" });
    }
  }

  const rowActions = (r: Report): ActionItem[] => {
    const items: ActionItem[] = [
      {
        group: "Inspect",
        label: "Open URL",
        icon: ExternalLink,
        onSelect: () => {
          window.open(r.reported_url.startsWith("http") ? r.reported_url : `https://${r.reported_url}`, "_blank", "noopener,noreferrer");
        },
      },
      { group: "Inspect", label: "Copy domain", icon: Copy, onSelect: () => copyDomain(r) },
    ];
    if (r.status === "new") items.push({ group: "Decide", label: "Mark reviewing", icon: Eye, onSelect: () => decide(r, "reviewing") });
    if (r.status !== "duplicate") items.push({ group: "Decide", label: "Mark duplicate", icon: CopyX, onSelect: () => decide(r, "duplicate") });
    if (r.status !== "denied") items.push({ group: "Decide", label: "Deny", icon: X, onSelect: () => decide(r, "denied") });
    if (r.status === "allowed" || r.status === "denied" || r.status === "duplicate") {
      items.push({ group: "Decide", label: "Reopen", icon: Inbox, onSelect: () => decide(r, "new") });
    }
    return items;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shield reports"
        description="URLs people have flagged as wrongly blocked. Allow copies the domain so you can paste it into the Shield allowlist."
        actions={<ActionMenu items={[{ label: "Refresh", icon: RefreshCw, onSelect: load }]} />}
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
          <span>Couldn't load reports: {loadError}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="New" value={counts.new ?? 0} icon={Inbox} iconBg="bg-blue-500/10" iconColor="text-blue-400" />
        <StatCard label="Reviewing" value={counts.reviewing ?? 0} icon={Shield} iconBg="bg-amber-500/10" iconColor="text-amber-400" />
        <StatCard label="Allowed" value={counts.allowed ?? 0} icon={CheckCircle2} iconBg="bg-emerald-500/10" iconColor="text-emerald-400" />
        <StatCard label="Denied" value={counts.denied ?? 0} icon={XCircle} iconBg="bg-red-500/10" iconColor="text-red-400" />
        <StatCard label="Total" value={counts.all ?? 0} icon={Shield} iconBg="bg-white/5" iconColor="text-white/60" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger aria-label="Filter by status" className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({counts.all ?? 0})</SelectItem>
            <SelectItem value="new">New ({counts.new ?? 0})</SelectItem>
            <SelectItem value="reviewing">Reviewing ({counts.reviewing ?? 0})</SelectItem>
            <SelectItem value="allowed">Allowed ({counts.allowed ?? 0})</SelectItem>
            <SelectItem value="denied">Denied ({counts.denied ?? 0})</SelectItem>
            <SelectItem value="duplicate">Duplicate ({counts.duplicate ?? 0})</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search reports"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search URL, domain, org, email…"
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
          <Shield className="h-10 w-10 text-white/40 mx-auto mb-3" aria-hidden />
          <h3 className="text-base font-medium text-white/80 mb-2">
            {filter === "new" && !search ? "Nothing waiting for review" : "No reports match"}
          </h3>
          <p className="text-sm text-white/60 max-w-md mx-auto">
            {filter === "new" && !search
              ? "When someone submits a URL at /shield/report, it lands here."
              : "Try a different status or search."}
          </p>
          {(filter !== "all" || search) && rows.length > 0 && (
            <Button variant="outline" size="sm" className="mt-4" onClick={() => { setFilter("all"); setSearch(""); }}>
              Show all reports
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => {
            const leadId = r.deal_id ? dealLeadIds[r.deal_id] : undefined;
            return (
              <li key={r.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant="outline" className={STATUS_COLOR[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                      <span className="text-xs text-white/60">{fmtAge(r.created_at)}</span>
                      {r.reporter_org && <span className="text-xs text-white/60">· {r.reporter_org}</span>}
                    </div>
                    <div className="font-mono text-sm text-white/90 break-all">{r.reported_url}</div>
                    {r.reported_domain && r.reported_domain !== r.reported_url && (
                      <div className="text-xs text-white/60 mt-0.5">
                        domain: <span className="font-mono">{r.reported_domain}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.status !== "allowed" && (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={busy === r.id}
                        onClick={() => decide(r, "allowed")}
                      >
                        {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Allow
                      </Button>
                    )}
                    <ActionMenu label={`More actions for ${domainOf(r)}`} items={rowActions(r)} />
                  </div>
                </div>

                {r.reason && (
                  <div className="text-sm text-white/70 mt-3 leading-relaxed border-l-2 border-white/10 pl-3">
                    {r.reason}
                  </div>
                )}

                {(r.reporter_email || r.deal_id || r.reviewed_at || r.decision_note) && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-3 text-xs text-white/60">
                    {r.reporter_email && <span>{r.reporter_email}</span>}
                    {r.deal_id && leadId && (
                      <Link
                        to={`/admin/cloud/${leadId}`}
                        className="inline-flex items-center gap-1 hover:text-white underline-offset-2 hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Cloud className="h-3 w-3" aria-hidden /> View deal
                      </Link>
                    )}
                    {r.reviewed_at && (
                      <span>
                        Reviewed {fmtAge(r.reviewed_at)}
                        {r.reviewed_by ? ` by ${r.reviewed_by}` : ""}
                      </span>
                    )}
                    {r.decision_note && <span className="italic">Note: {r.decision_note}</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
