import { useCallback, useEffect, useMemo, useState } from "react";
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
  RefreshCw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Severity = "critical" | "urgent" | "stale" | "info";

interface ActionItem {
  id: string;
  severity: Severity;
  icon: typeof AlertTriangle;
  title: string;
  detail?: string;
  ageMs: number;
  /** Where to go to deal with it. Omitted when there is no admin page for it yet. */
  href?: string;
}

const severityRank: Record<Severity, number> = {
  critical: 0,
  urgent: 1,
  stale: 2,
  info: 3,
};

const severityDot: Record<Severity, string> = {
  critical: "bg-red-500 shadow-[0_0_0.75rem_rgba(239,68,68,0.6)]",
  urgent: "bg-amber-400 shadow-[0_0_0.625rem_rgba(251,191,36,0.5)]",
  stale: "bg-yellow-500/70",
  info: "bg-white/40",
};

const severityWord: Record<Severity, string> = {
  critical: "Critical",
  urgent: "Urgent",
  stale: "Waiting",
  info: "FYI",
};

const COLLAPSED_COUNT = 8;

const severityIconColor: Record<Severity, string> = {
  critical: "text-red-400",
  urgent: "text-amber-400",
  stale: "text-yellow-500",
  info: "text-white/55",
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
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const now = Date.now();
    const recentFailCutoff = new Date(now - RECENT_FAIL_HOURS * 3600_000).toISOString();
    const staleIntakeCutoff = new Date(now - STALE_INTAKE_DAYS * 86400_000).toISOString();

    const [sysRes, contactsRes, hiresRes, intakesRes, missedRes, failedEmailsRes] = await Promise.all([
      supabase.from("system_alert_state").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("contact_submissions")
        .select("id, name, subject, message, created_at")
        .eq("status", "new")
        .order("created_at", { ascending: false })
        .limit(20),
      // hire_requests has no `role` column — selecting it made this query fail, so hire requests
      // never reached the inbox. project_type is the closest real field.
      supabase
        .from("hire_requests")
        .select("id, name, company, project_type, created_at")
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

    const failures = [
      ["system alerts", sysRes.error],
      ["contacts", contactsRes.error],
      ["hire requests", hiresRes.error],
      ["intakes", intakesRes.error],
      ["missed banner reports", missedRes.error],
      ["email log", failedEmailsRes.error],
    ].filter(([, e]) => e) as [string, { message: string }][];
    setError(failures.length ? `Couldn't check ${failures.map(([n]) => n).join(", ")}.` : null);

    const out: ActionItem[] = [];

    const sys = sysRes.data as { is_down?: boolean; down_systems?: string[]; updated_at?: string } | null;
    if (sys?.is_down && (sys.down_systems?.length ?? 0) > 0) {
      out.push({
        id: "sys-alert",
        severity: "critical",
        icon: AlertTriangle,
        title: `${sys.down_systems!.length} system${sys.down_systems!.length === 1 ? "" : "s"} down`,
        detail: sys.down_systems!.slice(0, 3).join(" · "),
        ageMs: sys.updated_at ? now - new Date(sys.updated_at).getTime() : 0,
        // check-system-health watches the Cookie Yeti AI generator and cron, which live on the CY ops page.
        href: "/admin/cookie-yeti/ops",
      });
    }

    (contactsRes.data ?? []).forEach((c: any) => {
      const ageMs = c.created_at ? now - new Date(c.created_at).getTime() : 0;
      const text = c.subject || c.message || "";
      out.push({
        id: `contact-${c.id}`,
        severity: ageMs > 24 * 3600_000 ? "stale" : "urgent",
        icon: Mail,
        title: `New contact from ${c.name || "someone"}`,
        detail: text.slice(0, 80) + (text.length > 80 ? "…" : ""),
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
        title: `Hire request from ${h.name || "someone"}${h.company ? ` (${h.company})` : ""}`,
        detail: h.project_type || undefined,
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
        detail: `${i.status} · no change for ${timeAgo(ageMs).replace(" ago", "")}`,
        ageMs,
        href: `/admin/submissions/${i.id}`,
      });
    });

    (missedRes.data ?? []).slice(0, 5).forEach((m: any) => {
      out.push({
        id: `missed-${m.id}`,
        severity: "info",
        icon: AlertCircle,
        title: `Missed banner report: ${m.domain || "unknown"}`,
        ageMs: m.created_at ? now - new Date(m.created_at).getTime() : 0,
        href: "/admin/cookie-yeti",
      });
    });

    (failedEmailsRes.data ?? []).slice(0, 3).forEach((e: any) => {
      out.push({
        id: `email-${e.id}`,
        severity: "urgent",
        icon: MailX,
        title: `Email failed to ${e.recipient_email || "unknown recipient"}`,
        detail: (e.error_message || "").slice(0, 80),
        ageMs: e.created_at ? now - new Date(e.created_at).getTime() : 0,
        // No email-log page exists yet; this used to link back to /admin (the page you're on).
      });
    });

    out.sort((a, b) => {
      const r = severityRank[a.severity] - severityRank[b.severity];
      if (r !== 0) return r;
      return b.ageMs - a.ageMs;
    });

    setItems(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) load();
    };
    run();
    const interval = setInterval(run, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [load]);

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

  const errorBar = error && (
    <div role="alert" className="flex items-center gap-3 px-5 py-2.5 border-b border-amber-500/20 bg-amber-500/[0.06]">
      <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0" aria-hidden />
      <p className="text-xs text-amber-100 flex-1">{error} The list below may be incomplete.</p>
      <Button
        size="sm"
        variant="outline"
        className="h-9 border-amber-400/30 text-amber-100 hover:bg-amber-500/10"
        onClick={() => load()}
      >
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Retry
      </Button>
    </div>
  );

  if (summary.total === 0) {
    return (
      <div className="bg-white/[0.03] border border-emerald-500/20 rounded-2xl overflow-hidden">
        {errorBar}
        <div className="flex items-center gap-3 p-5">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-emerald-400" aria-hidden />
          </div>
          <div>
            <h3 className="text-[0.9375rem] font-semibold text-white">{error ? "Nothing found" : "Inbox zero"}</h3>
            <p className="text-xs text-white/60 mt-0.5">
              {error
                ? "No items came back from the sources that loaded."
                : "Nothing waiting on you. No system alerts, unanswered requests or stalled intakes."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const headlineColor =
    summary.critical > 0 ? "text-red-400" : summary.urgent > 0 ? "text-amber-400" : "text-yellow-400";

  const visible = showAll ? items : items.slice(0, COLLAPSED_COUNT);
  const hidden = items.length - COLLAPSED_COUNT;

  return (
    <section aria-labelledby="action-inbox-title" className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <div>
          <h3 id="action-inbox-title" className="text-[0.9375rem] font-semibold text-white">Needs you</h3>
          <p className={cn("text-xs mt-0.5 font-medium", headlineColor)}>
            {summary.total} {summary.total === 1 ? "item" : "items"}
            {summary.critical > 0 && ` · ${summary.critical} critical`}
            {summary.urgent > 0 && ` · ${summary.urgent} urgent`}
            {summary.stale > 0 && ` · ${summary.stale} waiting`}
          </p>
        </div>
      </div>
      {errorBar}
      <ul className="divide-y divide-white/[0.04]">
        {visible.map((item) => {
          const Icon = item.icon;
          const body = (
            <>
              <span className={cn("h-2 w-2 rounded-full shrink-0", severityDot[item.severity])} aria-hidden />
              <Icon className={cn("h-4 w-4 shrink-0", severityIconColor[item.severity])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">
                  <span className="sr-only">{severityWord[item.severity]}: </span>
                  {item.title}
                </p>
                {item.detail && <p className="text-xs text-white/60 truncate mt-0.5">{item.detail}</p>}
              </div>
              <span className="text-xs text-white/55 tabular-nums shrink-0">{timeAgo(item.ageMs)}</span>
            </>
          );
          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  to={item.href}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {body}
                  <ChevronRight className="h-4 w-4 text-white/40 group-hover:text-white/70 transition-colors shrink-0" aria-hidden />
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-5 py-3 pr-12">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <div className="px-5 py-2 text-center border-t border-white/[0.04]">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-white/70 hover:text-white hover:bg-white/5"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show fewer" : `Show ${hidden} more`}
          </Button>
        </div>
      )}
    </section>
  );
}
