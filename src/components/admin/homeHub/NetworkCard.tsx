/**
 * Home network card for the Home Hub page.
 *
 * Data: home_hub_network_samples (the Pi pings the router and the internet every 5 minutes,
 * agent >= 1.5.0) and the newest network.find_device scan in home_hub_commands. "Scan now" queues
 * a fresh scan through the normal command queue. Written for someone who has never seen a ping:
 * the words say what it means for the house, the numbers are secondary.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Wifi, RefreshCw, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchNetworkSamples, fetchLatestScan, type NetworkSample, type LanScan } from "@/services/homeHubApi";
import { pollInterval } from "@/lib/polling";
import { HealthBadge, ago, useCommand, type Health } from "./shared";

// Verizon's wireless home internet normally sits around 40-80 ms; over 150 ms feels slow.
const SLOW_MS = 150;
const STALE_MS = 15 * 60_000;

const lost = (s: NetworkSample) => (s.inetLossPct ?? 0) > 0 || (s.gwLossPct ?? 0) > 0;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const hourLabel = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function NetworkCard() {
  const [samples, setSamples] = useState<NetworkSample[] | null>(null);
  const [scan, setScan] = useState<LanScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showDevices, setShowDevices] = useState(false);

  const load = useCallback(async () => {
    const [s, d] = await Promise.allSettled([fetchNetworkSamples(24), fetchLatestScan()]);
    if (s.status === "fulfilled") setSamples(s.value);
    if (d.status === "fulfilled") setScan(d.value);
    setError(s.status === "rejected" ? (s.reason as Error).message : null);
    setNow(Date.now());
  }, []);
  const { busy, run } = useCommand(load);

  useEffect(() => {
    load();
    const iv = setInterval(load, pollInterval(60_000));
    return () => clearInterval(iv);
  }, [load]);

  const view = useMemo(() => {
    const rows = samples ?? [];
    const last = rows[rows.length - 1] ?? null;
    const hourAgo = now - 3600_000;
    const lastHour = rows.filter((r) => new Date(r.capturedAt).getTime() >= hourAgo);
    const delay = avg(lastHour.map((r) => r.inetAvgMs).filter((v): v is number => v != null));
    const router = avg(lastHour.map((r) => r.gwAvgMs).filter((v): v is number => v != null));
    const drops = rows.filter(lost);
    const recentDrop = lastHour.some(lost);
    const stale = !last || now - new Date(last.capturedAt).getTime() > STALE_MS;
    const health: Health = stale ? "down" : recentDrop || (delay ?? 0) > SLOW_MS ? "warn" : "ok";
    const label = stale ? "No data" : recentDrop ? "Dropping" : (delay ?? 0) > SLOW_MS ? "Slow" : "Healthy";
    const chart = rows.map((r) => ({
      t: new Date(r.capturedAt).getTime(),
      delay: r.inetAvgMs == null ? null : Math.round(r.inetAvgMs),
      drop: lost(r) ? Math.round(r.inetAvgMs ?? 0) : null,
    }));
    const headline = stale
      ? "The Pi hasn't sent a network check in a while."
      : recentDrop
        ? "Signal dropped in the last hour. Devices may time out."
        : (delay ?? 0) > SLOW_MS
          ? "The internet is slower than usual right now."
          : "Internet and Wi-Fi router are working normally.";
    return { last, delay, router, drops, health, label, chart, headline };
  }, [samples, now]);

  const devices = useMemo(() => {
    const list = (scan?.devices ?? []).slice();
    list.sort((a, b) => Number(!!b.name) - Number(!!a.name) || Number(a.ip.split(".").pop()) - Number(b.ip.split(".").pop()));
    return list;
  }, [scan]);

  if (samples === null && !error) return <Skeleton className="h-72 rounded-2xl bg-white/[0.04]" />;

  return (
    <section aria-label="Home network" className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-white">
          <Wifi className="h-4 w-4 text-white/60" aria-hidden /> Home network
        </h3>
        <HealthBadge health={view.health} label={view.label} />
      </div>
      <p className="text-sm text-white/75 mb-4">{error ?? view.headline}</p>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <p className="text-[11px] sm:text-xs text-white/60">Internet delay</p>
          <p className="text-lg sm:text-2xl font-semibold text-white tabular-nums">{view.delay == null ? "–" : `${Math.round(view.delay)} ms`}</p>
          <p className="text-[11px] text-white/50">last hour · under 80 is normal</p>
        </div>
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <p className="text-[11px] sm:text-xs text-white/60">Dropouts</p>
          <p className={`text-lg sm:text-2xl font-semibold tabular-nums ${view.drops.length ? "text-amber-300" : "text-white"}`}>{view.drops.length}</p>
          <p className="text-[11px] text-white/50">in 24 hours{view.drops.length ? ` · last ${clock(view.drops[view.drops.length - 1].capturedAt)}` : ""}</p>
        </div>
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <p className="text-[11px] sm:text-xs text-white/60">Router</p>
          <p className="text-lg sm:text-2xl font-semibold text-white tabular-nums">{view.router == null ? "–" : `${view.router.toFixed(1)} ms`}</p>
          <p className="text-[11px] text-white/50">Pi to router · wired</p>
        </div>
      </div>

      {view.chart.length > 1 ? (
        <div className="h-40 -ml-2" aria-label="Internet delay over the last 24 hours">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={view.chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={hourLabel}
                tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis width={36} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} tickLine={false} axisLine={false} unit="" />
              <Tooltip
                contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                labelFormatter={(v) => clock(new Date(Number(v)).toISOString())}
                formatter={(v: number, k: string) => [k === "drop" ? "Signal dropped" : `${v} ms`, k === "drop" ? "" : "Delay"]}
              />
              <Line type="monotone" dataKey="delay" stroke="#0A84FF" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Scatter dataKey="drop" fill="#F59E0B" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-white/60">The chart fills in as the Pi checks every 5 minutes.</p>
      )}
      <p className="text-[11px] text-white/50 mt-1">Blue line: internet delay. Orange dots: moments the signal dropped.{view.last ? ` Last check ${ago(view.last.capturedAt, now)}.` : ""}</p>

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => setShowDevices((v) => !v)} className="min-w-0 text-left inline-flex items-center gap-1.5" aria-expanded={showDevices}>
            <span className="text-sm text-white/85">
              {scan ? `${devices.length} devices on your network` : "No device scan yet"}
            </span>
            {scan && <span className="text-xs text-white/50 truncate">· scanned {ago(scan.at, now)}</span>}
            {scan && <ChevronDown className={`h-4 w-4 text-white/50 transition-transform ${showDevices ? "rotate-180" : ""}`} aria-hidden />}
          </button>
          <Button size="sm" variant="outline" disabled={!!busy}
            onClick={() => run("scan", "network", "find_device", {}, "Device scan")}
            className="border-white/15 text-white/85 hover:text-white hover:bg-white/5 shrink-0">
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />}
            Scan now
          </Button>
        </div>
        {showDevices && scan && (
          <ul className="mt-3 divide-y divide-white/[0.05]">
            {devices.map((d) => (
              <li key={d.ip} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-white/90 truncate">{d.name ?? d.vendor ?? "Unknown device"}</p>
                  <p className="text-xs text-white/50 truncate">
                    {d.ip}{d.name && d.vendor ? ` · ${d.vendor}` : ""}
                  </p>
                </div>
                <span className="text-xs text-white/50 tabular-nums shrink-0">
                  {d.pingMs != null ? `${Math.round(d.pingMs)} ms` : "quiet"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
