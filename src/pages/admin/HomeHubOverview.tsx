import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/admin/PageHeader";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchPiholeStats, fetchAgentState, fetchRecentCommands, isAgentOnline, describeCommand,
  HomeHubError, STATS_STALE_MS, ACTION_LABELS, TARGET_LABELS, SNAPSHOT_STALE_MS,
  type PiholeStats, type AgentState, type HomeHubCommand,
} from "@/services/homeHubApi";
import { pollInterval } from "@/lib/polling";
import { AgentUpgradeBanner, useSnapshot } from "@/components/admin/homeHub/shared";
import { NetworkCard } from "@/components/admin/homeHub/NetworkCard";
import type { HaSnapshot, HbSnapshot } from "@/services/homeHubApi";
import { Shield, Cpu, RefreshCw, ArrowRight, CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, History } from "lucide-react";

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

type Health = "ok" | "warn" | "down";

function HealthBadge({ health, label }: { health: Health; label: string }) {
  const tone = health === "ok" ? "text-green-300 bg-green-500/10 border-green-500/25"
    : health === "warn" ? "text-amber-300 bg-amber-500/10 border-amber-500/25"
    : "text-red-300 bg-red-500/10 border-red-500/25";
  const Icon = health === "ok" ? CheckCircle2 : health === "warn" ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

function CardShell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6 flex flex-col">
      {children}
    </section>
  );
}

export default function HomeHubOverview() {
  const [stats, setStats] = useState<PiholeStats | null>(null);
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [commands, setCommands] = useState<HomeHubCommand[]>([]);
  const [errors, setErrors] = useState<{ stats?: string; agent?: HomeHubError; commands?: HomeHubError }>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [s, a, c] = await Promise.allSettled([fetchPiholeStats(), fetchAgentState(), fetchRecentCommands(8)]);
    const next: typeof errors = {};
    if (s.status === "fulfilled") setStats(s.value); else next.stats = (s.reason as Error).message;
    if (a.status === "fulfilled") setAgent(a.value); else next.agent = a.reason instanceof HomeHubError ? a.reason : new HomeHubError(String(a.reason));
    if (c.status === "fulfilled") setCommands(c.value); else next.commands = c.reason instanceof HomeHubError ? c.reason : new HomeHubError(String(c.reason));
    setErrors(next);
    setNow(Date.now());
    setInitialLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  useEffect(() => {
    load();
    const iv = setInterval(load, pollInterval(30_000));
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(iv); clearInterval(tick); };
  }, [load]);

  const agentOnline = isAgentOnline(agent, now);
  const statsAge = stats ? now - new Date(stats.capturedAt).getTime() : Infinity;
  const statsHealth: Health = !stats ? "down" : statsAge > STATS_STALE_MS ? "warn" : "ok";
  const anyError = errors.stats || errors.agent || errors.commands;
  const ha = useSnapshot<HaSnapshot>("homeassistant");
  const hb = useSnapshot<HbSnapshot>("homebridge");
  const serviceHealth = (snap: { ok: boolean; fails: number; capturedAt: string } | null): Health =>
    !snap ? "down" : now - new Date(snap.capturedAt).getTime() > SNAPSHOT_STALE_MS || snap.fails >= 3 ? "down" : snap.ok ? "ok" : "warn";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Home Hub"
        description="The Pi agent, your home network, Pi-hole, Home Assistant and Homebridge"
        actions={
          <>
            <Button asChild variant="outline" className="border-white/15 text-white/85 hover:text-white hover:bg-white/5">
              <Link to="/admin/home-hub/pihole">Open Pi-hole <ArrowRight className="h-4 w-4 ml-1.5" aria-hidden /></Link>
            </Button>
            <ActionMenu
              label="More Home Hub actions"
              items={[{ group: "View", label: refreshing ? "Refreshing…" : "Refresh now", icon: RefreshCw, disabled: refreshing, onSelect: refresh }]}
            />
          </>
        }
      />

      {anyError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
          <ul className="space-y-0.5">
            {errors.stats && <li>{errors.stats}</li>}
            {errors.agent && <li>{errors.agent.message}</li>}
            {errors.commands && errors.commands.message !== errors.agent?.message && <li>{errors.commands.message}</li>}
          </ul>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="border-red-500/30 text-red-100 hover:bg-red-500/10">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}Retry
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {initialLoading ? (
          <>
            <Skeleton className="h-40 rounded-2xl bg-white/[0.04]" />
            <Skeleton className="h-40 rounded-2xl bg-white/[0.04]" />
          </>
        ) : (
          <>
            <CardShell label="Home Hub agent">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-white">
                  <Cpu className="h-4 w-4 text-white/60" aria-hidden /> Home Hub agent
                </span>
                {errors.agent ? <HealthBadge health="warn" label="Unknown" />
                  : !agent ? <HealthBadge health="down" label="Never seen" />
                  : agentOnline ? <HealthBadge health="ok" label="Online" />
                  : <HealthBadge health="down" label="Offline" />}
              </div>
              {errors.agent ? (
                <p className="text-sm text-white/70">{errors.agent.accessDenied ? "This dashboard can't read the agent heartbeat yet." : "Heartbeat couldn't be loaded."}</p>
              ) : !agent ? (
                <p className="text-sm text-white/70">The systemd agent on the Pi hasn't checked in. Pi-hole controls stay disabled until it does.</p>
              ) : (
                <>
                  <p className="text-2xl font-semibold text-white tabular-nums">{ago(agent.lastSeenAt, now)}</p>
                  <p className="text-xs text-white/60 mt-0.5">
                    {agentOnline ? "Last heartbeat" : `Offline since ${new Date(agent.lastSeenAt).toLocaleString()}`}
                  </p>
                  <p className="text-xs text-white/60 mt-3">
                    {[agent.host, agent.version ? `v${agent.version}` : null].filter(Boolean).join(" · ") || agent.agent}
                  </p>
                </>
              )}
            </CardShell>

            <CardShell label="Pi-hole stats feed">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-white">
                  <Shield className="h-4 w-4 text-white/60" aria-hidden /> Pi-hole
                </span>
                {errors.stats && !stats ? <HealthBadge health="warn" label="Unknown" />
                  : statsHealth === "ok" ? <HealthBadge health="ok" label={stats?.status === "disabled" ? "Paused" : "Reporting"} />
                  : statsHealth === "warn" ? <HealthBadge health="warn" label="Stale" />
                  : <HealthBadge health="down" label="No data" />}
              </div>
              {stats ? (
                <>
                  <p className="text-2xl font-semibold text-white tabular-nums">{stats.queriesBlocked.toLocaleString()}</p>
                  <p className="text-xs text-white/60 mt-0.5">
                    queries blocked in the last 24 hours, {stats.percentBlocked.toFixed(1)}% of {stats.totalQueries.toLocaleString()}
                  </p>
                  <p className={`text-xs mt-3 ${statsHealth === "warn" ? "text-amber-300" : "text-white/60"}`}>
                    Last push {ago(stats.capturedAt, now)}{statsHealth === "warn" ? " (expected every minute)" : ""}
                  </p>
                </>
              ) : (
                <p className="text-sm text-white/70">No snapshot has arrived from the Pi yet.</p>
              )}
            </CardShell>
          </>
        )}
      </div>

      <AgentUpgradeBanner agent={agent} />

      <NetworkCard />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { to: "/admin/home-hub/home-assistant", label: "Home Assistant", snap: ha.snap, detail: ha.snap ? `${ha.snap.data.entity_count ?? 0} entities · ${(ha.snap.data.automations ?? []).filter((a) => a.on).length} automations on` : "Waiting for data" },
          { to: "/admin/home-hub/homebridge", label: "Homebridge", snap: hb.snap, detail: hb.snap ? `${(hb.snap.data.plugins ?? []).length} plugins${hb.snap.data.update_available ? " · update available" : ""}` : "Waiting for data" },
        ].map((x) => {
          const hh = serviceHealth(x.snap);
          return (
            <Link key={x.to} to={x.to} className="group bg-white/[0.03] border border-white/[0.06] hover:border-white/15 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{x.label}</p>
                <p className="text-xs text-white/60 mt-0.5 truncate">{x.detail}</p>
              </div>
              <HealthBadge health={hh} label={!x.snap ? "No data" : hh === "ok" ? "Running" : hh === "warn" ? "Check" : "Down"} />
            </Link>
          );
        })}
        <Link to="/admin/home-hub/access" className="bg-white/[0.03] border border-white/[0.06] hover:border-white/15 rounded-2xl p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Access backup</p>
            <p className="text-xs text-white/60 mt-0.5">IPs, SSH, logins and where secrets live</p>
          </div>
          <ArrowRight className="h-4 w-4 text-white/60" aria-hidden />
        </Link>
      </div>

      <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl" aria-label="Recent commands">
        <div className="flex items-center gap-2 p-4 sm:p-6 pb-3">
          <History className="h-4 w-4 text-white/60" aria-hidden />
          <h3 className="text-sm font-semibold text-white">Recent commands</h3>
        </div>
        {initialLoading ? (
          <div className="px-4 sm:px-6 pb-6 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg bg-white/[0.04]" />)}
          </div>
        ) : errors.commands ? (
          <p className="px-4 sm:px-6 pb-6 text-sm text-white/60">Command history is unavailable.</p>
        ) : commands.length === 0 ? (
          <p className="px-4 sm:px-6 pb-6 text-sm text-white/60">No commands yet. Pausing, resuming or updating Pi-hole from its page will show up here with the agent's reply.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {commands.map((c) => {
              const Icon = c.status === "done" ? CheckCircle2 : c.status === "failed" ? XCircle : c.status === "expired" ? Clock : Loader2;
              const tone = c.status === "done" ? "text-green-400" : c.status === "failed" ? "text-red-400" : c.status === "expired" ? "text-amber-400" : "text-white/60 animate-spin";
              return (
                <li key={c.id} className="flex items-start gap-3 px-4 sm:px-6 py-3">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone}`} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/85">
                      {TARGET_LABELS[c.target] ?? c.target}: {ACTION_LABELS[c.action] ?? c.action}
                      <span className="text-white/60 capitalize"> · {c.status}</span>
                    </p>
                    <p className="text-xs text-white/60 mt-0.5 break-words">{describeCommand(c)}</p>
                  </div>
                  <span className="text-xs text-white/60 shrink-0 tabular-nums">{ago(c.createdAt, now)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
