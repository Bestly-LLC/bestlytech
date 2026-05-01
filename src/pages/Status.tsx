import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/SEOHead";

/**
 * Public status page — bestly.tech/status (CNAME → status.bestly.tech later).
 *
 * Reads aggregated uptime from the get_public_status() RPC. The RPC is
 * security-definer + granted to anon, so this page works without auth and
 * never exposes raw probe rows or error messages — only current status,
 * 24h / 30d / 90d uptime percentages, and a daily-uptime sparkline series.
 *
 * Theming: matches the marketing site's v7/v8 indigo + Newsreader treatment.
 */

interface DailyPoint {
  day: string;
  pct: number | null;
}

interface ServiceStatus {
  service: string;
  current_status: "ok" | "warn" | "down" | "unknown";
  last_checked: string;
  uptime_24h_pct: number | string;
  uptime_30d_pct: number | string;
  daily_uptime: DailyPoint[];
}

const STATUS_LABEL: Record<ServiceStatus["current_status"], string> = {
  ok: "Operational",
  warn: "Degraded",
  down: "Outage",
  unknown: "Checking",
};

const STATUS_BG: Record<ServiceStatus["current_status"], string> = {
  ok: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  warn: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  down: "bg-red-500/10 text-red-300 border-red-500/20",
  unknown: "bg-white/[0.05] text-white/40 border-white/10",
};

const STATUS_DOT: Record<ServiceStatus["current_status"], string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  down: "bg-red-400",
  unknown: "bg-white/30",
};

// Friendlier labels — order matters, top to bottom.
const SERVICE_DISPLAY: Record<string, { label: string; description: string }> = {
  "bestly.tech": {
    label: "Bestly Marketing Site",
    description: "Main bestly.tech website",
  },
  "cloud.bestly.tech": {
    label: "Bestly Cloud",
    description: "In-house Nextcloud + Proxmox surface",
  },
  "cookieyeti.com": {
    label: "Cookie Yeti Site",
    description: "Marketing / install page",
  },
  "hoascope.com": {
    label: "HOAscope Site",
    description: "Marketing / signup",
  },
  "app.hoascope.com": {
    label: "HOAscope App",
    description: "Member portal",
  },
};

const SERVICE_ORDER = [
  "bestly.tech",
  "cloud.bestly.tech",
  "cookieyeti.com",
  "hoascope.com",
  "app.hoascope.com",
];

function pickHeadlineStatus(rows: ServiceStatus[]): ServiceStatus["current_status"] {
  if (rows.some((r) => r.current_status === "down")) return "down";
  if (rows.some((r) => r.current_status === "warn")) return "warn";
  if (rows.length === 0) return "unknown";
  return "ok";
}

function formatRelative(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Sparkline({ points }: { points: DailyPoint[] }) {
  // 90 boxes, one per day. Color by uptime pct.
  return (
    <div className="flex items-end gap-[2px] h-7 mt-3">
      {points.map((p, i) => {
        const pct = p.pct ?? null;
        let bg = "bg-white/[0.06]";
        let height = "h-2";
        if (pct === null || pct === 0) {
          bg = "bg-white/[0.06]";
          height = "h-1.5";
        } else if (pct >= 0.99) {
          bg = "bg-emerald-400/80";
          height = "h-7";
        } else if (pct >= 0.95) {
          bg = "bg-emerald-400/60";
          height = "h-6";
        } else if (pct >= 0.5) {
          bg = "bg-amber-400/70";
          height = "h-4";
        } else {
          bg = "bg-red-400/70";
          height = "h-3";
        }
        return (
          <span
            key={i}
            className={`flex-1 rounded-sm ${bg} ${height} transition-colors`}
            title={`${p.day}: ${pct === null ? "no data" : `${(pct * 100).toFixed(0)}% up`}`}
          />
        );
      })}
    </div>
  );
}

export default function Status() {
  const [rows, setRows] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await (supabase as any).rpc("get_public_status");
      if (cancelled) return;
      if (error) {
        console.error("[status] failed:", error);
        setLoading(false);
        return;
      }
      const ordered = (data ?? []).slice().sort(
        (a: ServiceStatus, b: ServiceStatus) =>
          SERVICE_ORDER.indexOf(a.service) - SERVICE_ORDER.indexOf(b.service)
      );
      setRows(ordered);
      setUpdatedAt(new Date());
      setLoading(false);
    }
    load();
    const i = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  const headline = pickHeadlineStatus(rows);
  const headlineColor =
    headline === "ok"
      ? "text-emerald-300"
      : headline === "warn"
        ? "text-amber-300"
        : headline === "down"
          ? "text-red-300"
          : "text-white/40";
  const headlineText =
    headline === "ok"
      ? "All systems operational"
      : headline === "warn"
        ? "Some systems degraded"
        : headline === "down"
          ? "Active incident"
          : "Checking…";

  return (
    <>
      <SEOHead
        title="Bestly Status"
        description="Real-time uptime status for Bestly's products and infrastructure."
        path="/status"
      />

      <div className="min-h-screen bg-[hsl(var(--wow-paper))] text-foreground">
        {/* Indigo glow background — same vocabulary as marketing site */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[hsl(var(--wow-indigo)/0.06)] rounded-full blur-[120px]" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-[hsl(var(--wow-indigo-deep)/0.04)] rounded-full blur-[100px]" />
        </div>

        <div className="relative mx-auto max-w-3xl px-6 py-20 lg:py-28">
          {/* Header */}
          <div className="flex items-baseline justify-between mb-2">
            <a
              href="/"
              className="font-display text-xl font-normal text-foreground hover:opacity-70 transition-opacity"
            >
              Bestly
            </a>
            <span className="text-xs text-muted-foreground">
              Updated {formatRelative(updatedAt.toISOString())}
            </span>
          </div>

          <h1 className="font-display text-5xl sm:text-6xl font-normal text-foreground tracking-[-0.02em] leading-[0.95] mt-6">
            Status
          </h1>

          {/* Headline pill */}
          <div className="mt-8 flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${STATUS_DOT[headline]} animate-[pulse-dot_1.5s_ease-in-out_infinite]`}
              />
              <span className={`relative inline-flex h-3 w-3 rounded-full ${STATUS_DOT[headline]}`} />
            </span>
            <span className={`text-lg font-medium ${headlineColor}`}>{headlineText}</span>
          </div>

          {/* Service rows */}
          <div className="mt-12 space-y-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-24 rounded-2xl border border-border bg-card animate-pulse"
                  />
                ))}
              </div>
            ) : (
              SERVICE_ORDER.map((key) => {
                const row = rows.find((r) => r.service === key);
                const display = SERVICE_DISPLAY[key];
                if (!row) {
                  return (
                    <div
                      key={key}
                      className="rounded-2xl border border-border bg-card p-5"
                    >
                      <p className="text-sm text-muted-foreground">{display?.label ?? key}</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">No data yet</p>
                    </div>
                  );
                }
                const status = row.current_status;
                const u24 = typeof row.uptime_24h_pct === "string"
                  ? parseFloat(row.uptime_24h_pct)
                  : row.uptime_24h_pct;
                const u30 = typeof row.uptime_30d_pct === "string"
                  ? parseFloat(row.uptime_30d_pct)
                  : row.uptime_30d_pct;
                return (
                  <div
                    key={key}
                    className="rounded-2xl border border-border bg-card hover:bg-card/80 transition-colors p-5"
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <h3 className="font-display text-xl text-foreground">
                          {display?.label ?? key}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {display?.description ?? key}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${STATUS_BG[status]}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
                        {STATUS_LABEL[status]}
                      </span>
                    </div>

                    {/* Sparkline */}
                    <Sparkline points={row.daily_uptime ?? []} />

                    {/* Uptime numbers */}
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground/60">90 days</span>
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground tabular-nums">
                          24h&nbsp;
                          <span className="font-medium text-foreground">{u24}%</span>
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          30d&nbsp;
                          <span className="font-medium text-foreground">{u30}%</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer note */}
          <p className="mt-16 text-xs text-muted-foreground/60 leading-relaxed">
            Bestly probes each service every 5 minutes from a Supabase Edge runtime in
            us-east-1. A service is marked operational when it returns HTTP 2xx within
            8 seconds, degraded after one failed probe, and an outage after two
            consecutive failures (~10 minutes).
          </p>

          <style>{`
            @keyframes pulse-dot {
              0%, 100% { transform: scale(1); opacity: 0.75; }
              50% { transform: scale(2); opacity: 0; }
            }
          `}</style>
        </div>
      </div>
    </>
  );
}
