import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  Mail,
  Briefcase,
  FileText,
  AlertCircle,
  MailX,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Severity = "critical" | "urgent" | "stale" | "info";

interface ActionItem {
  id: string;
  severity: Severity;
  icon: typeof AlertTriangle;
  title: string;
  detail?: string;
  ageMs: number;
  href: string;
}

const severityRank: Record<Severity, number> = {
  critical: 0,
  urgent: 1,
  stale: 2,
  info: 3,
};

const severityDot: Record<Severity, string> = {
  critical: "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]",
  urgent: "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]",
  stale: "bg-yellow-500/70",
  info: "bg-white/30",
};

const severityIconColor: Record<Severity, string> = {
  critical: "text-red-400",
  urgent: "text-amber-400",
  stale: "text-yellow-500",
  info: "text-white/40",
};

const STALE_INTAKE_DAYS = 5;
const RECENT_FAIL_HOURS = 24;

function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ActionInbox() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const now = Date.now();
      const recentFailCutoff = new Date(now - RECENT_FAIL_HOURS * 3600_000).toISOString();
      const staleIntakeCutoff = new Date(now - STALE_INTAKE_DAYS * 86400_000).toISOString();

      const [sysRes, contactsRes, hiresRes, intakesRes, missedRes, failedEmailsRes] =
        await Promise.all([
          supabase
            .from("system_alert_state" as never)
            .select("*")
            .eq("id" as never, 1 as never)
            .maybeSingle(),
          supabase
            .from("contact_submissions")
            .select("id, name, message, created_at")
            .eq("status", "new")
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("hire_requests")
            .select("id, name, role, created_at")
            .eq("status", "new")
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("seller_intakes")
            .select("id, business_legal_name, status, updated_at, created_at")
            .in("status", ["Submitted", "In Review"])
            .lt("updated_at", staleIntakeCutoff)
            .order("updated_at", { ascending: true })
            .limit(20),
          supabase
            .from("missed_banner_reports")
            .select("id, domain, created_at")
            .eq("resolved", false)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("email_send_log")
            .select("id, recipient_email, error_message, created_at")
            .eq("status", "failed")
            .gte("created_at", recentFailCutoff)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

      if (cancelled) return;

      const out: ActionItem[] = [];

      const sys = sysRes.data as { is_down?: boolean; down_systems?: string[]; updated_at?: string } | null;
      if (sys?.is_down && (sys.down_systems?.length ?? 0) > 0) {
        const ageMs = sys.updated_at ? now - new Date(sys.updated_at).getTime() : 0;
        out.push({
          id: "sys-alert",
          severity: "critical",
          icon: AlertTriangle,
          title: `${sys.down_systems!.length} system${sys.down_systems!.length === 1 ? "" : "s"} down`,
          detail: sys.down_systems!.slice(0, 3).join(" · "),
          ageMs,
          href: "/admin/home-hub",
        });
      }

      (contactsRes.data ?? []).forEach((c: any) => {
        const ageMs = c.created_at ? now - new Date(c.created_at).getTime() : 0;
        out.push({
          id: `contact-${c.id}`,
          severity: ageMs > 24 * 3600_000 ? "stale" : "urgent",
          icon: Mail,
          title: `New contact from ${c.name || "anon"}`,
          detail: (c.message || "").slice(0, 80) + ((c.message || "").length > 80 ? "…" : ""),
          ageMs,
          href: "/admin/contacts",
        });
      });

      (hiresRes.data ?? []).forEach((h: any) => {
        const ageMs = h.created_at ? now - new Date(h.created_at).getTime() : 0;
        out.push({
          id: `hire-${h.id}`,
          severity: ageMs > 24 * 3600_000 ? "stale" : "urgent",
          icon: Briefcase,
          title: `Hire request: ${h.name || "anon"}${h.role ? ` — ${h.role}` : ""}`,
          ageMs,
          href: "/admin/hires",
        });
      });

      (intakesRes.data ?? []).forEach((i: any) => {
        const ageMs = i.updated_at ? now - new Date(i.updated_at).getTime() : 0;
        out.push({
          id: `intake-${i.id}`,
          severity: "stale",
          icon: FileText,
          title: `Intake stalled: ${i.business_legal_name || "Unnamed"}`,
          detail: `${i.status} · no movement for ${timeAgo(ageMs)}`,
          ageMs,
          href: `/admin/submissions/${i.id}`,
        });
      });

      (missedRes.data ?? []).slice(0, 5).forEach((m: any) => {
        const ageMs = m.created_at ? now - new Date(m.created_at).getTime() : 0;
        out.push({
          id: `missed-${m.id}`,
          severity: "info",
          icon: AlertCircle,
          title: `Missed banner report: ${m.domain || "unknown"}`,
          ageMs,
          href: "/admin/cookie-yeti",
        });
      });

      (failedEmailsRes.data ?? []).slice(0, 3).forEach((e: any) => {
        const ageMs = e.created_at ? now - new Date(e.created_at).getTime() : 0;
        out.push({
          id: `email-${e.id}`,
          severity: "urgent",
          icon: MailX,
          title: `Email failed to ${e.recipient_email || "?"}`,
          detail: (e.error_message || "").slice(0, 80),
          ageMs,
          href: "/admin",
        });
      });

      out.sort((a, b) => {
        const r = severityRank[a.severity] - severityRank[b.severity];
        if (r !== 0) return r;
        return b.ageMs - a.ageMs;
      });

      setItems(out);
      setLoading(false);
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const summary = useMemo(() => {
    const critical = items.filter((i) => i.severity === "critical").length;
    const urgent = items.filter((i) => i.severity === "urgent").length;
    const stale = items.filter((i) => i.severity === "stale").length;
    const total = items.length;
    return { critical, urgent, stale, total };
  }, [items]);

  if (loading) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
        <Skeleton className="h-5 w-40 bg-white/[0.05]" />
        <div className="mt-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-xl bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  if (summary.total === 0) {
    return (
      <div className="bg-gradient-to-br from-emerald-500/[0.04] to-transparent border border-emerald-500/20 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-white">Inbox zero</h3>
            <p className="text-xs text-white/40 mt-0.5">
              Nothing waiting on you. No system alerts, no unanswered requests, no stalled intakes.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const headlineColor =
    summary.critical > 0
      ? "text-red-400"
      : summary.urgent > 0
        ? "text-amber-400"
        : "text-yellow-500";

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-[15px] font-semibold text-white">Action Inbox</h3>
          <p className={cn("text-xs mt-0.5 font-medium", headlineColor)}>
            {summary.total} {summary.total === 1 ? "item" : "items"} need you
            {summary.critical > 0 && ` · ${summary.critical} critical`}
            {summary.urgent > 0 && ` · ${summary.urgent} urgent`}
            {summary.stale > 0 && ` · ${summary.stale} stale`}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-white/[0.04]">
        {items.slice(0, 8).map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.id}>
              <Link
                to={item.href}
                className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors group"
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    severityDot[item.severity],
                  )}
                  aria-hidden
                />
                <Icon
                  className={cn("h-4 w-4 shrink-0", severityIconColor[item.severity])}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{item.title}</p>
                  {item.detail && (
                    <p className="text-xs text-white/40 truncate mt-0.5">{item.detail}</p>
                  )}
                </div>
                <span className="text-[11px] text-white/30 tabular-nums shrink-0">
                  {timeAgo(item.ageMs)}
                </span>
                <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/60 transition-colors shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
      {items.length > 8 && (
        <div className="px-5 py-3 text-center border-t border-white/[0.04]">
          <span className="text-xs text-white/30">
            +{items.length - 8} more {items.length - 8 === 1 ? "item" : "items"} in queue
          </span>
        </div>
      )}
    </div>
  );
}
