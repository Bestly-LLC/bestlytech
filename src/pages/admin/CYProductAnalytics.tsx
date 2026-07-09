import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from "recharts";
import {
  Activity, Users, TrendingUp, AlertTriangle, Download, ArrowDownRight, RefreshCw,
  Smartphone, Monitor, Chrome, Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";

// ── Types (shapes returned by the cy_* rollup RPCs) ───────────────────────
type Funnel = {
  install: number; onboarding_complete: number; extension_enabled: number;
  first_dismiss: number; daily_limit_hit: number; upgrade_completed: number;
};
type DauPoint = { day: string; dau: number; events: number };
type Conversion = {
  installs: number; paywall_viewed: number; upgrade_started: number; upgrade_completed: number;
  install_to_pro_rate: number; paywall_to_pro_rate: number;
};
type PlatformRow = {
  platform: string; active_users: number; installs: number; activated: number;
  limit_hits: number; upgrades: number; dau: number;
};

const FUNNEL_STEPS: { key: keyof Funnel; label: string }[] = [
  { key: "install", label: "Install" },
  { key: "onboarding_complete", label: "Onboarding complete" },
  { key: "extension_enabled", label: "Extension enabled" },
  { key: "first_dismiss", label: "First dismiss (activation)" },
  { key: "daily_limit_hit", label: "Daily limit hit" },
  { key: "upgrade_completed", label: "Upgraded to Pro" },
];

const PLATFORM_META: Record<string, { label: string; icon: any }> = {
  ios: { label: "iOS", icon: Smartphone },
  macos: { label: "macOS", icon: Monitor },
  chrome: { label: "Chrome", icon: Chrome },
  safari: { label: "Safari", icon: Compass },
};

export default function CYProductAnalytics() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [dau, setDau] = useState<DauPoint[]>([]);
  const [conversion, setConversion] = useState<Conversion | null>(null);
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);

  const loadData = useCallback(async () => {
    setError(null);
    const [f, d, c, p] = await Promise.all([
      supabase.rpc("cy_funnel" as any),
      supabase.rpc("cy_dau" as any, { days: 30 }),
      supabase.rpc("cy_conversion" as any),
      supabase.rpc("cy_platform_breakdown" as any),
    ]);

    // Any RPC error → surface an explicit error state (never fake-green zeros).
    const firstErr = [f, d, c, p].find((r) => r.error)?.error;
    if (firstErr) {
      setError(firstErr.message || "Analytics is temporarily unavailable.");
      setFunnel(null); setDau([]); setConversion(null); setPlatforms([]);
    } else {
      setFunnel((f.data as unknown as Funnel) ?? null);
      setDau(((d.data as unknown as DauPoint[]) ?? []).map((x) => ({ ...x, day: String(x.day).slice(5) })));
      setConversion((c.data as unknown as Conversion) ?? null);
      setPlatforms((p.data as unknown as PlatformRow[]) ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-8 max-w-6xl">
        <div><Skeleton className="h-9 w-56" /><Skeleton className="h-4 w-96 mt-3" /></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const totalEvents = dau.reduce((n, x) => n + (x.events || 0), 0);
  const hasAnyData = (funnel?.install ?? 0) > 0 || totalEvents > 0 || platforms.length > 0;
  const installBase = funnel?.install ?? 0;
  const maxDau = Math.max(1, ...dau.map((x) => x.dau));

  return (
    <div className="space-y-8 max-w-6xl">
      <PageHeader
        title="Product Analytics"
        description="Privacy-first product funnel, activation, and Free→Pro conversion — anonymous aggregates only, no PII."
        actions={
          <Button
            size="sm" variant="outline"
            className="border-white/10 bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.06]"
            onClick={() => { setRefreshing(true); loadData(); }}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      {/* Explicit error state — failures look like failures. */}
      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3.5">
          <AlertTriangle className="h-5 w-5 text-red-300 flex-none mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-red-200">Analytics data unavailable</p>
            <p className="text-red-200/70 text-[12.5px] mt-0.5">
              The rollup RPCs did not return. This is an error state, not "zero activity." ({error})
            </p>
          </div>
        </div>
      )}

      {!error && !hasAnyData && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
          <EmptyState
            icon={Activity}
            title="No product events yet"
            description="The analytics pipeline is live and ready. Metrics will populate once the apps and extensions start emitting events to /functions/v1/track."
          />
        </div>
      )}

      {!error && hasAnyData && (
        <>
          {/* ── Headline conversion cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Installs" value={conversion?.installs ?? 0} icon={Download}
              iconBg="bg-sky-500/10" iconColor="text-sky-300" />
            <StatCard label="Upgraded to Pro" value={conversion?.upgrade_completed ?? 0} icon={TrendingUp}
              iconBg="bg-emerald-500/10" iconColor="text-emerald-300" />
            <StatCard label="Install → Pro" value={`${conversion?.install_to_pro_rate ?? 0}%`} icon={ArrowDownRight}
              iconBg="bg-violet-500/10" iconColor="text-violet-300" />
            <StatCard label="Paywall → Pro" value={`${conversion?.paywall_to_pro_rate ?? 0}%`} icon={Users}
              iconBg="bg-amber-500/10" iconColor="text-amber-300" />
          </div>

          {/* ── Activation funnel ── */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="text-sm font-medium text-white mb-4">Activation funnel</h2>
            <div className="space-y-2.5">
              {FUNNEL_STEPS.map((step, i) => {
                const val = funnel?.[step.key] ?? 0;
                const pctOfInstall = installBase > 0 ? Math.round((val / installBase) * 100) : 0;
                const prev = i === 0 ? val : (funnel?.[FUNNEL_STEPS[i - 1].key] ?? 0);
                const stepConv = prev > 0 ? Math.round((val / prev) * 100) : 0;
                return (
                  <div key={step.key}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-white/80">{step.label}</span>
                      <span className="text-white/50 tabular-nums">
                        {val.toLocaleString()}
                        <span className="text-white/30"> · {pctOfInstall}% of installs</span>
                        {i > 0 && <span className="text-white/30"> · {stepConv}% step</span>}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                      <div className="h-full rounded-full bg-gradient-to-r from-sky-500/70 to-emerald-500/70"
                        style={{ width: `${Math.max(pctOfInstall, val > 0 ? 2 : 0)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── DAU trend ── */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-white">Daily active users · 30d</h2>
              <span className="text-xs text-white/30">distinct anonymous devices</span>
            </div>
            {dau.length > 1 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dau} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dauFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} domain={[0, maxDau]} />
                    <RTooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 12, color: "#fafafa" }}
                      formatter={(v: number) => [`${v} DAU`, "Active"]}
                    />
                    <Area type="monotone" dataKey="dau" stroke="#38bdf8" strokeWidth={2} fill="url(#dauFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-white/30">
                Not enough days of data yet.
              </div>
            )}
          </div>

          {/* ── Platform breakdown ── */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="px-5 pt-4 pb-2">
              <h2 className="text-sm font-medium text-white">By platform</h2>
            </div>
            {platforms.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState icon={Activity} title="No platform data yet" description="Per-platform metrics appear once events arrive with a platform tag." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-white/35">
                      <th className="text-left font-medium px-5 py-2.5">Platform</th>
                      <th className="text-left font-medium px-3 py-2.5">Active</th>
                      <th className="text-left font-medium px-3 py-2.5">DAU</th>
                      <th className="text-left font-medium px-3 py-2.5">Installs</th>
                      <th className="text-left font-medium px-3 py-2.5">Activated</th>
                      <th className="text-left font-medium px-3 py-2.5">Limit hits</th>
                      <th className="text-left font-medium px-5 py-2.5">Upgrades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platforms.map((r) => {
                      const meta = PLATFORM_META[r.platform] ?? { label: r.platform, icon: Activity };
                      const Icon = meta.icon;
                      return (
                        <tr key={r.platform} className="border-t border-white/[0.06]">
                          <td className="px-5 py-2.5 text-white/90">
                            <span className="inline-flex items-center gap-2">
                              <Icon className="h-4 w-4 text-white/40" /> {meta.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-white/70 tabular-nums">{r.active_users}</td>
                          <td className="px-3 py-2.5 text-white/70 tabular-nums">{r.dau}</td>
                          <td className="px-3 py-2.5 text-white/60 tabular-nums">{r.installs}</td>
                          <td className="px-3 py-2.5 text-white/60 tabular-nums">{r.activated}</td>
                          <td className="px-3 py-2.5 text-white/60 tabular-nums">{r.limit_hits}</td>
                          <td className="px-5 py-2.5 text-emerald-300/90 tabular-nums">{r.upgrades}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-white/25">
            Anonymous, aggregate-only. Backed by <code className="text-white/40">product_events</code> via the
            SECURITY DEFINER rollups <code className="text-white/40">cy_funnel / cy_dau / cy_conversion / cy_platform_breakdown</code>.
            No emails, URLs, or IPs are stored.
          </p>
        </>
      )}
    </div>
  );
}
