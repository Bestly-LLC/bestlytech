import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import {
  Globe, Cookie, Sparkles, AlertTriangle, CheckCircle2, Clock, Plus,
  ArrowRight, Inbox, Activity, ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";
import { DomainDeepDive } from "@/components/admin/DomainDeepDive";

// ── helpers ───────────────────────────────────────────────
function relTime(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "<1m";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

type FeedState = "fixed" | "fixing" | "needs";

function deriveState(r: any): FeedState {
  if (r.resolved) return "fixed";
  if ((r.ai_attempts ?? 0) >= 2 && !r.has_working_pattern) return "needs";
  return "fixing";
}

const STATE_META: Record<FeedState, { label: string; dot: string; pill: string }> = {
  fixed: { label: "Fixed", dot: "bg-emerald-400", pill: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20" },
  fixing: { label: "Fixing…", dot: "bg-amber-400 animate-pulse", pill: "text-amber-300 bg-amber-500/10 border-amber-500/20" },
  needs: { label: "Needs you", dot: "bg-red-400", pill: "text-red-300 bg-red-500/10 border-red-500/20" },
};

function timeToFix(r: any): string | null {
  if (!r.resolved) return null;
  const end = r.resolved_at || r.ai_processed_at || r.last_reported;
  if (!end || !r.created_at) return null;
  return fmtDuration(new Date(end).getTime() - new Date(r.created_at).getTime());
}

export default function CYCommandCenter() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [feed, setFeed] = useState<any[]>([]);
  const [needs, setNeeds] = useState<any[]>([]);

  // grant access
  const [dialogOpen, setDialogOpen] = useState(false);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantReason, setGrantReason] = useState("");

  // domain deep dive
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDomain = useCallback((domain: string) => {
    setSelectedDomain(domain);
    setDrawerOpen(true);
  }, []);

  const loadData = useCallback(async () => {
    const [ov, recent, unresolved] = await Promise.all([
      supabase.rpc("get_community_overview" as any),
      supabase
        .from("missed_banner_reports")
        .select("*")
        .order("last_reported", { ascending: false, nullsFirst: false })
        .limit(20) as any,
      supabase.rpc("get_unresolved_reports" as any),
    ]);
    if (ov.error) console.error("[CYCommandCenter] overview", ov.error.message);
    if (recent.error) console.error("[CYCommandCenter] feed", recent.error.message);
    setOverview(Array.isArray(ov.data) ? ov.data[0] : ov.data);
    setFeed(recent.data || []);
    const un = (unresolved.data || []) as any[];
    un.sort((a, b) => (b.report_count ?? 0) - (a.report_count ?? 0));
    setNeeds(un);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useAdminRealtime({
    tables: ["cookie_patterns", "missed_banner_reports"] as any,
    onNewRecord: () => loadData(),
  });

  const handleGrant = async () => {
    if (!grantEmail) return;
    const { error } = await supabase.from("granted_access").insert({
      email: grantEmail.trim().toLowerCase(),
      granted_by: "admin",
      reason: grantReason || null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Access granted" });
      setGrantEmail(""); setGrantReason(""); setDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-8 max-w-5xl">
        <div><Skeleton className="h-9 w-48" /><Skeleton className="h-4 w-72 mt-3" /></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const o = overview || {};
  const needsCount = needs.length;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* ── Header ── */}
      <PageHeader
        title="Cookie Yeti"
        description="Domains your users report, fixed automatically. Newest first."
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="border-white/10 bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.06]">
                <Plus className="h-4 w-4 mr-1" /> Grant access
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Grant premium access</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Email</Label>
                  <Input value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} placeholder="user@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Reason</Label>
                  <Textarea value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="Why grant access?" rows={2} />
                </div>
                <Button onClick={handleGrant} className="w-full">Grant access</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {/* ── Hero stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Domains covered" value={o.total_domains ?? 0} icon={Globe} accentColor="#8b5cf6" iconBg="bg-violet-500/10" iconColor="text-violet-400" subtitle={`${o.total_patterns ?? 0} patterns`} />
        <StatCard label="Fixed this week" value={o.patterns_last_7d ?? 0} icon={Sparkles} accentColor="#10b981" iconBg="bg-emerald-500/10" iconColor="text-emerald-400" subtitle={`${o.new_domains_last_7d ?? 0} new domains`} />
        <StatCard label="Learning now" value={o.patterns_last_24h ?? 0} icon={Activity} accentColor="#06b6d4" iconBg="bg-cyan-500/10" iconColor="text-cyan-400" subtitle="patterns last 24h" />
        <StatCard label="Needs you" value={needsCount} icon={AlertTriangle} accentColor={needsCount > 0 ? "#ef4444" : "#10b981"} iconBg={needsCount > 0 ? "bg-red-500/10" : "bg-emerald-500/10"} iconColor={needsCount > 0 ? "text-red-400" : "text-emerald-400"} subtitle={needsCount > 0 ? "domains to review" : "all clear"} />
      </div>

      {/* ── Just In feed (hero) ── */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
          </span>
          <h3 className="text-[15px] font-semibold text-white">Just in</h3>
          <span className="text-xs text-white/30">live · newest reported domains</span>
        </div>

        {feed.length === 0 ? (
          <EmptyState icon={Inbox} title="Nothing reported yet" description="Reported domains will stream in here as users hit cookie banners." />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {feed.map((r) => {
              const st = deriveState(r);
              const meta = STATE_META[st];
              const ttf = timeToFix(r);
              return (
                <button
                  key={r.id}
                  onClick={() => openDomain(r.domain)}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.025] transition-colors group"
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate group-hover:text-cyan-300 transition-colors">{r.domain}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${meta.pill} shrink-0`}>{meta.label}</span>
                    </div>
                    <p className="text-xs text-white/35 mt-0.5 truncate">
                      {(r.report_count ?? 1)} {(r.report_count ?? 1) === 1 ? "report" : "reports"}
                      {ttf && <span className="text-emerald-400/70"> · fixed in {ttf}</span>}
                      {st === "needs" && <span className="text-red-400/70"> · AI couldn’t auto-fix</span>}
                      {st === "fixing" && <span className="text-amber-400/70"> · AI working on it</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-white/25 tabular-nums">{relTime(r.last_reported || r.created_at)}</span>
                    <ChevronRight className="h-4 w-4 text-white/15 group-hover:text-white/40 transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Needs you ── */}
      {needsCount > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <h3 className="text-[15px] font-semibold text-white">Needs you</h3>
            <span className="text-xs text-white/30">domains the AI couldn’t fix — most-reported first</span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {needs.slice(0, 8).map((r) => (
              <button
                key={r.domain}
                onClick={() => openDomain(r.domain)}
                className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.025] transition-colors group"
              >
                <span className="text-sm font-medium text-white truncate flex-1 group-hover:text-cyan-300 transition-colors">{r.domain}</span>
                <span className="text-xs text-white/40 tabular-nums shrink-0">{r.report_count} reports</span>
                <span className="text-xs text-white/25 shrink-0 w-20 text-right">{relTime(r.last_reported)}</span>
                <ChevronRight className="h-4 w-4 text-white/15 group-hover:text-white/40 transition-colors shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Advanced links ── */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <span className="text-[11px] uppercase tracking-widest text-white/25 font-semibold mr-1">Advanced</span>
        {[
          { to: "/admin/cookie-yeti/analytics", label: "Product analytics" },
          { to: "/admin/cookie-yeti/ops", label: "Operations & pipeline" },
          { to: "/admin/cookie-yeti/community", label: "Community analytics" },
          { to: "/admin/cookie-yeti/domains", label: "All domains" },
          { to: "/admin/cookie-yeti/subscribers", label: "Subscribers" },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="inline-flex items-center gap-1 text-xs text-white/45 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-lg px-3 py-1.5 transition-colors"
          >
            {l.label}<ArrowRight className="h-3 w-3" />
          </Link>
        ))}
      </div>

      <DomainDeepDive domain={selectedDomain} open={drawerOpen} onOpenChange={setDrawerOpen} onRefresh={loadData} />
    </div>
  );
}
