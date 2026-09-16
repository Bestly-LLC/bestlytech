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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
type EventActivity = { event: string; users: number; events_in_window: number; last_at: string | null };
type PlatformRow = {
  platform: string; active_users: number; installs: number; activated: number;
  limit_hits: number; upgrades: number; dau: number;
};

// Real order a user goes through (checked against live counts: 52 installs, 39 enabled, 23 onboarded,
// 2 first dismiss). daily_limit_hit is not a step everyone passes, so it isn't in the funnel.
type FunnelKey = "install" | "extension_enabled" | "onboarding_complete" | "first_dismiss" | "upgrade_started" | "upgrade_completed";
const FUNNEL_STEPS: { key: FunnelKey; label: string }[] = [
  { key: "install", label: "Install" },
  { key: "extension_enabled", label: "Extension enabled" },
  { key: "onboarding_complete", label: "Onboarding complete" },
  { key: "first_dismiss", label: "First dismiss (activation)" },
  { key: "upgrade_started", label: "Upgrade started" },
  { key: "upgrade_completed", label: "Upgraded to Pro" },
];
const ACTIVITY_DAYS = 30;

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
  const [activity, setActivity] = useState<Map<string, EventActivity> | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    const [f, d, c, p, a] = await Promise.all([
      supabase.rpc("cy_funnel" as any),
      supabase.rpc("cy_dau" as any, { days: 30 }),
      supabase.rpc("cy_conversion" as any),
      supabase.rpc("cy_platform_breakdown" as any),
      supabase.rpc("cy_event_activity" as any, { p_days: ACTIVITY_DAYS }),
    ]);

    // Any RPC error → surface an explicit error state (never fake-green zeros).
    // Keep the last good data on screen if we had some.
    const firstErr = [f, d, c, p].find((r) => r.error)?.error;
    if (firstErr) {
      setError(firstErr.message || "Analytics is temporarily unavailable.");
    } else {
      setFunnel((f.data as unknown as Funnel) ?? null);
      setDau(((d.data as unknown as DauPoint[]) ?? []).map((x) => ({ ...x, day: String(x.day).slice(5) })));
      setConversion((c.data as unknown as Conversion) ?? null);
      setPlatforms((p.data as unknown as PlatformRow[]) ?? []);
    }
    // Optional: without it the funnel just can't flag events that stopped arriving.
    if (!a.error) setActivity(new Map(((a.data as unknown as EventActivity[]) ?? []).map((e) => [e.event, e])));
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
  const refresh = () => { setRefreshing(true); loadData(); };
  const installBase = funnel?.install ?? 0;
  const stepValue = (key: FunnelKey): number =>
    key === "upgrade_started" ? conversion?.upgrade_started ?? 0 : funnel?.[key] ?? 0;
  const notSent = (key: FunnelKey) => !!activity && !(activity.get(key)?.events_in_window);
  const maxDau = Math.max(1, ...dau.map((x) => x.dau));

  return (
    <div className="space-y-8 max-w-6xl">
      <PageHeader
        title="Product Analytics"
        description="Privacy-first product funnel, activation, and Free→Pro conversion — anonymous aggregates only, no PII."
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon" variant="outline" aria-label="Refresh analytics"
                className="h-9 w-9 border-white/10 text-white/70 hover:text-white hover:bg-white/5"
                onClick={refresh} disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh analytics</TooltipContent>
          </Tooltip>
        }
      />

      {/* Explicit error state — failures look like failures. */}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3.5">
          <AlertTriangle className="h-5 w-5 text-red-300 flex-none" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-red-200">Analytics didn't load</p>
            <p className="text-red-200/75 text-xs mt-0.5 break-words">
              {hasAnyData ? "Showing the last numbers that loaded. " : "This is an error, not zero activity. "}({error})
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="h-9 border-red-500/30 text-red-100 hover:bg-red-500/10">
            Retry
          </Button>
        </div>
      )}

      {!error && !hasAnyData && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
          <EmptyState
            icon={Activity}
            title="No product events yet"
            description="Metrics appear once the apps and extensions send events to the track function."
          />
        </div>
      )}

      {hasAnyData && (
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
                const val = stepValue(step.key);
                const pctOfInstall = installBase > 0 ? Math.min(100, Math.round((val / installBase) * 100)) : 0;
                const prev = i === 0 ? val : stepValue(FUNNEL_STEPS[i - 1].key);
                // Events are sent independently, so a later step can outnumber the one before it.
                // Never show a step conversion over 100%; fall back to % of installs only.
                const stepConv = prev > 0 && val <= prev ? Math.round((val / prev) * 100) : null;
                const stale = notSent(step.key);
                return (
                  <div key={step.key}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-white/80">
                        {step.label}
                        {stale && (
                          <span className="ml-2 inline-block rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[0.6875rem] text-amber-300 whitespace-nowrap">
                            not being sent · none in {ACTIVITY_DAYS}d
                          </span>
                        )}
                      </span>
                      <span className="text-white/60 tabular-nums text-xs sm:text-sm">
                        <span className="text-white/90">{val.toLocaleString()}</span>
                        <span> · {pctOfInstall}% of installs</span>
                        {i > 0 && stepConv !== null && <span className="hidden sm:inline"> · {stepConv}% from previous step</span>}
                      </span>
                    </div>
                    <div
                      className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.05]"
                      role="img"
                      aria-label={`${step.label}: ${val} users, ${pctOfInstall}% of installs`}
                    >
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
              <span className="text-xs text-white/55">distinct anonymous devices</span>
            </div>
            {dau.length > 1 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dau} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
                    <defs>
                      <linearGradient id="dauFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: "0.75rem" }} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis tick={{ fill: "rgba(255,255,255,0.6)", fontSize: "0.75rem" }} tickLine={false} axisLine={false} allowDecimals={false} domain={[0, maxDau]} width={32} />
                    <RTooltip
                      contentStyle={{ background: "#18181b", border: "0.0625rem solid #3f3f46", borderRadius: "0.75rem", color: "#fafafa", fontSize: "0.8125rem" }}
                      labelStyle={{ color: "rgba(255,255,255,0.7)" }}
                      formatter={(v: number) => [`${v} active`, "DAU"]}
                    />
                    <Area type="monotone" dataKey="dau" stroke="#38bdf8" strokeWidth={2} fill="url(#dauFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-white/60">
                Needs at least two days of events to draw a trend.
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
                    <tr className="text-[0.6875rem] uppercase tracking-wide text-white/55">
                      <th scope="col" className="text-left font-medium px-5 py-2.5">Platform</th>
                      <th scope="col" className="text-left font-medium px-3 py-2.5">Active</th>
                      <th scope="col" className="text-left font-medium px-3 py-2.5">DAU</th>
                      <th scope="col" className="text-left font-medium px-3 py-2.5">Installs</th>
                      <th scope="col" className="text-left font-medium px-3 py-2.5">Activated</th>
                      <th scope="col" className="text-left font-medium px-3 py-2.5">Limit hits</th>
                      <th scope="col" className="text-left font-medium px-5 py-2.5">Upgrades</th>
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
                              <Icon className="h-4 w-4 text-white/55" aria-hidden="true" /> {meta.label}
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

          <p className="text-xs text-white/55">
            Anonymous and aggregate-only, from <code className="text-white/70">product_events</code>. No emails, URLs or IPs are stored.
          </p>
        </>
      )}
    </div>
  );
}
