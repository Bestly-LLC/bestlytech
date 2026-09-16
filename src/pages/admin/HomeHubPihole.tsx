import { useEffect, useState, useCallback, useMemo } from "react";
import { useAdminTheme, adminInk } from "@/hooks/useAdminTheme";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  fetchPiholeStats, fetchAgentState, fetchRecentCommands, enqueuePiholeCommand, waitForCommand,
  isAgentOnline, isCommandFinished, describeCommand, HomeHubError, STATS_STALE_MS, ACTION_LABELS,
  type PiholeStats, type AgentState, type HomeHubCommand, type PiholeAction,
} from "@/services/homeHubApi";
import { pollInterval } from "@/lib/polling";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  Shield, ShieldOff, Search, Database, BarChart3, ListFilter, RefreshCw, Users, Download,
  Loader2, Cpu, AlertTriangle, CheckCircle2, XCircle, Clock, ListRestart,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { toast } from "sonner";

/** Requested pause length. The agent's reply states what it actually did. */
const PAUSE_SECONDS = 300;

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const LA_TZ = "America/Los_Angeles";
const fmtLATime = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(ms));

/**
 * The Pi sends 24 hour-of-day slots labelled "00:00".."23:00" in LA local time, always in that
 * order. Rotate them so the chart runs oldest to newest and ends on the hour of the snapshot.
 * Labels in any other shape are left as they came.
 */
function chronologicalHours<T extends { hour: string }>(rows: T[], capturedAt: string): T[] {
  const laHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(capturedAt)),
  );
  const idx = rows.findIndex((r) => {
    const m = /^(\d{1,2}):00$/.exec(r.hour);
    return !!m && Number(m[1]) === laHour;
  });
  if (idx < 0) return rows;
  return [...rows.slice(idx + 1), ...rows.slice(0, idx + 1)];
}

function downloadCsv(rows: { domain: string; hits: number }[], filename: string) {
  const csv = ["\"Domain\",\"Hits\"", ...rows.map((r) => `"${r.domain.replace(/"/g, '""')}",${r.hits}`)].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function CommandStatusIcon({ c }: { c: HomeHubCommand }) {
  if (c.status === "done") return <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" aria-label="Done" />;
  if (c.status === "failed") return <XCircle className="h-4 w-4 text-red-400 shrink-0" aria-label="Failed" />;
  if (c.status === "expired") return <Clock className="h-4 w-4 text-amber-400 shrink-0" aria-label="Expired" />;
  return <Loader2 className="h-4 w-4 text-white/55 animate-spin shrink-0" aria-label="In progress" />;
}

function DomainList({ title, rows, search, onSearch, emptyLabel }: {
  title: string;
  rows: { domain: string; hits: number }[];
  search: string;
  onSearch: (v: string) => void;
  emptyLabel: string;
}) {
  return (
    <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6" aria-label={title}>
      <h3 className="text-sm font-semibold text-white mb-4">{title}</h3>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55" aria-hidden />
        <Input
          aria-label={`Search ${title.toLowerCase()}`}
          placeholder="Search domains…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="pl-9 bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/55 h-9 text-sm"
        />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-white/55 py-6 text-center">{search ? "No domains match this search." : emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {rows.map((d) => (
            <li key={d.domain} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-white/75 truncate">{d.domain}</span>
              <span className="text-sm text-white/60 tabular-nums shrink-0 ml-3">{d.hits.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function HomeHubPihole() {
  const { bento } = useAdminTheme();
  const ink = (a: number) => adminInk(bento, a);
  const [stats, setStats] = useState<PiholeStats | null>(null);
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [commands, setCommands] = useState<HomeHubCommand[]>([]);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<HomeHubError | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<PiholeAction | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [blockedSearch, setBlockedSearch] = useState("");
  const [permittedSearch, setPermittedSearch] = useState("");

  // PERF-05: debounce domain search; the lists can be long.
  const debouncedBlockedSearch = useDebouncedValue(blockedSearch, 300);
  const debouncedPermittedSearch = useDebouncedValue(permittedSearch, 300);

  const load = useCallback(async () => {
    const [s, a, c] = await Promise.allSettled([fetchPiholeStats(), fetchAgentState(), fetchRecentCommands(6, "pihole")]);
    if (s.status === "fulfilled") { setStats(s.value); setStatsError(null); }
    else setStatsError((s.reason as Error).message);
    if (a.status === "fulfilled") { setAgent(a.value); setAgentError(null); }
    else setAgentError(a.reason instanceof HomeHubError ? a.reason : new HomeHubError(String(a.reason)));
    if (c.status === "fulfilled") setCommands(c.value);
    setNow(Date.now());
    setInitialLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  // Pi pushes every ~60s; jitter avoids synchronised polling with other admin pages (PERF-03).
  useEffect(() => {
    load();
    const iv = setInterval(load, pollInterval(60_000));
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(iv); clearInterval(tick); };
  }, [load]);

  const agentOnline = isAgentOnline(agent, now);
  const statsStale = !!stats && now - new Date(stats.capturedAt).getTime() > STATS_STALE_MS;

  const controlsBlockedReason = agentError?.accessDenied
    ? "Controls are unavailable: this dashboard can't read the command queue yet."
    : agentError
    ? "Controls are unavailable: agent status couldn't be loaded."
    : !agent
    ? "Controls are unavailable: the Home Hub agent has never checked in."
    : !agentOnline
    ? `Controls are unavailable: the agent has been offline since ${new Date(agent.lastSeenAt).toLocaleString()}.`
    : null;

  const runCommand = async (action: PiholeAction, payload: Record<string, unknown> = {}) => {
    const label = ACTION_LABELS[action];
    setPending(action);
    try {
      const queued = await enqueuePiholeCommand(action, payload);
      setCommands((prev) => [queued, ...prev].slice(0, 6));
      const final = await waitForCommand(queued.id, { timeoutMs: action === "update_gravity" ? 240_000 : 90_000 });
      if (!final || !isCommandFinished(final)) {
        toast.warning(`${label}: the Pi hasn't finished yet. Its result will appear under Recent commands.`);
      } else if (final.status === "done") {
        toast.success(`${label}: ${describeCommand(final)}`);
      } else {
        toast.error(`${label} failed: ${describeCommand(final)}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(null);
      await load();
    }
  };

  const filteredBlocked = useMemo(
    () => stats?.topBlocked.filter((d) => d.domain.toLowerCase().includes(debouncedBlockedSearch.toLowerCase())) ?? [],
    [stats?.topBlocked, debouncedBlockedSearch],
  );
  const filteredPermitted = useMemo(
    () => stats?.topPermitted.filter((d) => d.domain.toLowerCase().includes(debouncedPermittedSearch.toLowerCase())) ?? [],
    [stats?.topPermitted, debouncedPermittedSearch],
  );

  const hourlyChart = useMemo(
    () => (stats ? chronologicalHours(stats.hourlyChart, stats.capturedAt) : []),
    [stats],
  );

  // A snapshot only arrives about once a minute. Until one lands that is newer than the last
  // pause/resume the Pi finished, trust that command's result for the blocking state.
  const lastToggle = commands.find(
    (c) => (c.action === "enable" || c.action === "disable") && c.status === "done" && c.completedAt,
  );
  const toggleDoneAt = lastToggle?.completedAt ? new Date(lastToggle.completedAt).getTime() : 0;
  const pauseSeconds = lastToggle?.action === "disable" ? Number(lastToggle.payload.seconds) || 0 : 0;
  const resumesAt = pauseSeconds > 0 ? toggleDoneAt + pauseSeconds * 1000 : null;
  const toggleNewer = !!stats && !!lastToggle && toggleDoneAt > new Date(stats.capturedAt).getTime();
  const blockingStatus: PiholeStats["status"] | undefined = toggleNewer
    ? (lastToggle!.action === "enable" || (resumesAt !== null && resumesAt <= now) ? "enabled" : "disabled")
    : stats?.status;
  const showResumesAt = blockingStatus === "disabled" && lastToggle?.action === "disable" && resumesAt !== null && resumesAt > now;

  const isPaused = blockingStatus === "disabled";
  const controlsDisabled = !!controlsBlockedReason || pending !== null || !stats;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pi-hole"
        description="Network-wide ad and tracker blocking on bestly-pi"
        actions={
          <>
            {isPaused ? (
              <Button onClick={() => runCommand("enable")} disabled={controlsDisabled} className="bg-white text-black hover:bg-white/90">
                {pending === "enable" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Shield className="h-4 w-4 mr-1.5" />}
                {pending === "enable" ? "Resuming…" : "Resume blocking"}
              </Button>
            ) : (
              <Button onClick={() => setConfirmPause(true)} disabled={controlsDisabled} className="bg-white text-black hover:bg-white/90">
                {pending === "disable" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldOff className="h-4 w-4 mr-1.5" />}
                {pending === "disable" ? "Pausing…" : "Pause blocking…"}
              </Button>
            )}
            <ActionMenu
              label="More Pi-hole actions"
              items={[
                {
                  group: "Maintenance",
                  label: pending === "update_gravity" ? "Updating blocklists…" : "Update blocklists",
                  icon: ListRestart,
                  hint: "gravity",
                  disabled: controlsDisabled,
                  onSelect: () => { void runCommand("update_gravity"); },
                },
                { group: "Export", label: `Top blocked CSV (${filteredBlocked.length})`, icon: Download, disabled: filteredBlocked.length === 0, onSelect: () => downloadCsv(filteredBlocked, "pihole-blocked") },
                { group: "Export", label: `Top permitted CSV (${filteredPermitted.length})`, icon: Download, disabled: filteredPermitted.length === 0, onSelect: () => downloadCsv(filteredPermitted, "pihole-permitted") },
                { group: "View", label: refreshing ? "Refreshing…" : "Refresh now", icon: RefreshCw, disabled: refreshing, onSelect: refresh },
              ]}
            />
          </>
        }
      />

      {/* Status strip: blocking state, stats freshness, agent heartbeat — all from the database */}
      {initialLoading ? (
        <Skeleton className="h-16 rounded-2xl bg-white/[0.04]" />
      ) : (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 sm:px-6 py-3 space-y-2" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            {stats ? (
              <span className={`inline-flex items-center gap-1.5 ${isPaused ? "text-amber-300" : blockingStatus === "enabled" ? "text-green-300" : "text-white/70"}`}>
                {isPaused ? <ShieldOff className="h-4 w-4" aria-hidden /> : <Shield className="h-4 w-4" aria-hidden />}
                {isPaused
                  ? `Blocking paused${showResumesAt ? `. Resumes at ${fmtLATime(resumesAt!)}` : ""}`
                  : blockingStatus === "enabled" ? "Blocking on" : "Blocking state unknown"}
              </span>
            ) : null}
            {stats && (
              <span className={`inline-flex items-center gap-1.5 ${statsStale ? "text-amber-300" : "text-white/70"}`}>
                {statsStale ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
                {statsStale ? `Stats stale: last push ${ago(stats.capturedAt, now)}` : `Stats pushed ${ago(stats.capturedAt, now)}`}
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 ${agentOnline ? "text-white/70" : "text-amber-300"}`}>
              <Cpu className="h-4 w-4" aria-hidden />
              {agentError
                ? "Agent status unavailable"
                : !agent
                ? "Agent has never checked in"
                : agentOnline
                ? `Agent online, seen ${ago(agent.lastSeenAt, now)}`
                : `Agent offline since ${new Date(agent.lastSeenAt).toLocaleString()}`}
            </span>
          </div>
          {controlsBlockedReason && <p className="text-xs text-white/60">{controlsBlockedReason}</p>}
          {pending && (
            <p className="text-xs text-white/70 inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {ACTION_LABELS[pending]}: waiting for the Pi (the agent checks in about every 15 seconds)…
            </p>
          )}
        </div>
      )}

      {statsError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
          <span>{statsError}{stats ? " Showing the last snapshot that loaded." : ""}</span>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="border-red-500/30 text-red-100 hover:bg-red-500/10">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}Retry
          </Button>
        </div>
      )}

      {initialLoading && (
        <div className="space-y-6" role="status" aria-label="Loading Pi-hole stats">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 rounded-2xl bg-white/[0.03]" />)}
          </div>
          <Skeleton className="h-64 rounded-2xl bg-white/[0.03]" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-64 rounded-2xl bg-white/[0.03]" />
            <Skeleton className="h-64 rounded-2xl bg-white/[0.03]" />
          </div>
        </div>
      )}

      {!initialLoading && !stats && !statsError && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 text-center">
          <Shield className="h-8 w-8 text-white/30 mx-auto mb-3" aria-hidden />
          <p className="text-sm text-white/75">No Pi-hole snapshot has arrived yet.</p>
          <p className="text-xs text-white/60 mt-1">
            Stats appear here once <code className="text-white/75">scripts/push_pihole_stats.py</code> runs on the Pi (every minute from cron).
          </p>
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Queries" value={stats.totalQueries.toLocaleString()} subtitle="last 24 hours" icon={BarChart3} />
            <StatCard label="Blocked" value={stats.queriesBlocked.toLocaleString()} subtitle="last 24 hours" icon={Shield} />
            <StatCard label="Percent blocked" value={`${stats.percentBlocked.toFixed(1)}%`} icon={ListFilter} />
            <StatCard label="Blocklist domains" value={stats.domainsOnBlocklist.toLocaleString()} icon={Database} />
            <StatCard label="Active clients" value={stats.activeClients.toLocaleString()} icon={Users} />
          </div>

          <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6" aria-label="Queries over the last 24 hours">
            <h3 className="text-sm font-semibold text-white mb-4">Queries, last 24 hours</h3>
            {hourlyChart.length === 0 ? (
              <p className="text-sm text-white/55 py-16 text-center">The latest snapshot has no hourly data.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ink(0.06)} />
                    <XAxis dataKey="hour" tick={{ fontSize: 11, fill: ink(0.6) }} tickLine={false} axisLine={false} interval={3} />
                    <YAxis tick={{ fontSize: 11, fill: ink(0.6) }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: bento ? "#fff" : "#111", border: `1px solid ${ink(0.1)}`, borderRadius: 12, fontSize: 12, color: bento ? "#111114" : "#fff" }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: ink(0.7) }} />
                    <Line type="monotone" dataKey="permitted" stroke="#4ade80" strokeWidth={2} dot={false} name="Permitted" />
                    <Line type="monotone" dataKey="blocked" stroke="#f87171" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Blocked" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DomainList title="Top blocked domains" rows={filteredBlocked} search={blockedSearch} onSearch={setBlockedSearch} emptyLabel="Nothing blocked in this snapshot." />
            <DomainList title="Top permitted domains" rows={filteredPermitted} search={permittedSearch} onSearch={setPermittedSearch} emptyLabel="No permitted queries in this snapshot." />
          </div>
        </>
      )}

      {!initialLoading && !agentError?.accessDenied && (
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl" aria-label="Recent commands">
          <div className="p-4 sm:p-6 pb-3">
            <h3 className="text-sm font-semibold text-white">Recent commands</h3>
            <p className="text-xs text-white/60 mt-0.5">What this dashboard asked the Pi to do, and what the agent reported back.</p>
          </div>
          {commands.length === 0 ? (
            <p className="px-4 sm:px-6 pb-6 text-sm text-white/55">No commands sent yet.</p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {commands.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 sm:px-6 py-3">
                  <span className="mt-0.5"><CommandStatusIcon c={c} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/85">
                      {ACTION_LABELS[c.action] ?? c.action}
                      <span className="text-white/60 capitalize"> · {c.status}</span>
                    </p>
                    <p className="text-xs text-white/60 mt-0.5 break-words">{describeCommand(c)}</p>
                  </div>
                  <span className="text-xs text-white/60 shrink-0 tabular-nums">{ago(c.createdAt, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <AlertDialog open={confirmPause} onOpenChange={setConfirmPause}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause Pi-hole blocking?</AlertDialogTitle>
            <AlertDialogDescription>
              Ads and trackers will reach every device on the network until blocking resumes. This asks the Pi for a
              {" "}{PAUSE_SECONDS / 60}-minute pause; the agent's reply will confirm what it actually did, and you can resume at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmPause(false); void runCommand("disable", { seconds: PAUSE_SECONDS }); }}
            >
              Pause blocking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
