import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
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
  duplicate: "border-white/20 text-white/50 bg-white/[0.04]",
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

export default function AdminShieldReports() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Report["status"]>("new");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("shield_url_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      toast({
        title: "Couldn't load reports",
        description: error.message,
        variant: "destructive",
      });
    }
    setRows((data || []) as Report[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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

  async function decide(id: string, status: Report["status"], note?: string) {
    const update: Partial<Report> = {
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: "operator",
    };
    if (note !== undefined) update.decision_note = note;
    const { error } = await supabase
      .from("shield_url_reports")
      .update(update)
      .eq("id", id);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...update } as Report : r)));
    toast({ title: `Marked ${STATUS_LABEL[status].toLowerCase()}` });
  }

  async function copyDomain(domain: string | null) {
    if (!domain) return;
    try {
      await navigator.clipboard.writeText(domain);
      toast({ title: "Domain copied" });
    } catch {
      toast({ title: domain });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shield reports"
        description="URLs end-users have flagged as wrongly blocked. Review, decide, copy the domain into your Shield allowlist."
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="New" value={counts.new ?? 0} icon={Inbox} iconBg="bg-blue-500/10" iconColor="text-blue-400" />
        <StatCard label="Reviewing" value={counts.reviewing ?? 0} icon={Shield} iconBg="bg-amber-500/10" iconColor="text-amber-400" />
        <StatCard label="Allowed" value={counts.allowed ?? 0} icon={CheckCircle2} iconBg="bg-emerald-500/10" iconColor="text-emerald-400" />
        <StatCard label="Denied" value={counts.denied ?? 0} icon={XCircle} iconBg="bg-red-500/10" iconColor="text-red-400" />
        <StatCard label="Total" value={counts.all ?? 0} icon={Shield} iconBg="bg-white/5" iconColor="text-white/50" />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
          <SelectTrigger className="w-44">
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
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search url, domain, org, email…"
          className="max-w-sm"
        />
        <Button variant="outline" size="sm" onClick={load} className="ml-auto">
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
          <Shield className="h-10 w-10 text-white/30 mx-auto mb-3" />
          <h3 className="text-base font-medium text-white/80 mb-2">No reports here</h3>
          <p className="text-sm text-white/50">
            {filter === "new"
              ? "No new reports waiting for review. When a user submits a URL via /shield/report, it lands here."
              : "Try a different filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={STATUS_COLOR[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </Badge>
                    <span className="text-xs text-white/40">{fmtAge(r.created_at)}</span>
                    {r.reporter_org && (
                      <span className="text-xs text-white/60">· {r.reporter_org}</span>
                    )}
                  </div>
                  <div className="font-mono text-sm text-white/90 break-all">{r.reported_url}</div>
                  {r.reported_domain && r.reported_domain !== r.reported_url && (
                    <div className="text-xs text-white/40 mt-0.5">
                      domain: <span className="font-mono">{r.reported_domain}</span>
                    </div>
                  )}
                </div>
              </div>

              {r.reason && (
                <div className="text-sm text-white/70 mt-2 leading-relaxed border-l-2 border-white/10 pl-3">
                  {r.reason}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-3 text-xs text-white/50">
                {r.reporter_email && <span>{r.reporter_email}</span>}
                {r.deal_id && (
                  <span>
                    ·{" "}
                    <a className="hover:text-white" href={`/admin/cloud/${r.deal_id}`}>
                      view deal
                    </a>
                  </span>
                )}
                {r.reviewed_at && (
                  <span>
                    · reviewed {fmtAge(r.reviewed_at)}{r.reviewed_by ? ` by ${r.reviewed_by}` : ""}
                  </span>
                )}
              </div>

              {r.decision_note && (
                <div className="text-xs text-white/50 mt-1 italic">note: {r.decision_note}</div>
              )}

              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/[0.06]">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => copyDomain(r.reported_domain)}
                >
                  <Copy className="h-3 w-3" />
                  Copy domain
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a
                    href={r.reported_url.startsWith("http") ? r.reported_url : `https://${r.reported_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open
                  </a>
                </Button>
                <div className="ml-auto flex flex-wrap gap-2">
                  {r.status !== "allowed" && (
                    <Button
                      size="sm"
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => decide(r.id, "allowed")}
                    >
                      <Check className="h-3 w-3" />
                      Allow
                    </Button>
                  )}
                  {r.status !== "denied" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => decide(r.id, "denied")}
                    >
                      <X className="h-3 w-3" />
                      Deny
                    </Button>
                  )}
                  {r.status === "new" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-white/50"
                      onClick={() => decide(r.id, "reviewing")}
                    >
                      Mark reviewing
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
