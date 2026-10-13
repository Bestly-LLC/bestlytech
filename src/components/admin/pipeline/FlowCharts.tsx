import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NBSP, dayLabel } from "./lib";
import { Empty, Panel } from "./parts";
import type { Overview } from "./types";

/** Each bar slices a day's finds by how far they got. Segments are exclusive, so the bar height is the number found. */
const SEGS = [
  { key: "booked", label: "Booked", color: "#34d399" },
  { key: "called", label: "Called, not booked", color: "#fbbf24" },
  { key: "queued", label: "Queued, not called", color: "#a78bfa" },
  { key: "qualified", label: "Qualified, not queued", color: "#38bdf8" },
  { key: "found", label: "Found, not qualified", color: "#71717a" },
] as const;

export function FlowCharts({ data }: { data: Overview }) {
  const rows = useMemo(() => (data.funnel14 ?? []).map((d) => ({
    day: dayLabel(d.day),
    booked: d.booked,
    called: Math.max(0, d.called - d.booked),
    queued: Math.max(0, d.queued - d.called),
    qualified: Math.max(0, d.qualified - d.queued),
    found: Math.max(0, d.found - d.qualified),
  })), [data.funnel14]);
  const total = rows.reduce((a, r) => a + r.booked + r.called + r.queued + r.qualified + r.found, 0);
  const sources = [...(data.sources14 ?? [])].sort((a, b) => b.found - a.found);
  const maxFound = Math.max(1, ...sources.map((s) => s.found));
  const tickGap = typeof window !== "undefined" && window.innerWidth < 640 ? 2 : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <h3 className="text-[17px] font-semibold text-white">Last 14 days</h3>
        <p className="mt-1 text-[14px] text-white/60">Each bar is the leads found that day, colored by how far they got.</p>
        {total === 0 ? <Empty>No leads in the last 14 days yet.</Empty> : (
          <>
            <div className="mt-3 h-[220px] w-full" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }} tickLine={false} axisLine={false} interval={tickGap} />
                  <YAxis allowDecimals={false} tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,0.05)" }} isAnimationActive={false}
                    contentStyle={{ background: "#141418", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, color: "#fff", fontSize: 13 }}
                    labelStyle={{ color: "#fff", fontWeight: 600 }} itemStyle={{ color: "rgba(255,255,255,0.85)" }} />
                  {[...SEGS].reverse().map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="f" fill={s.color} isAnimationActive={false} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only"><caption>Leads found per day, by how far they got</caption>
              <thead><tr><th>Day</th>{SEGS.map((x) => <th key={x.key}>{x.label}</th>)}</tr></thead>
              <tbody>{rows.map((r) => <tr key={r.day}><th>{r.day}</th>{SEGS.map((x) => <td key={x.key}>{r[x.key]}</td>)}</tr>)}</tbody></table>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-white/80">
              {SEGS.map((s) => <li key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />{s.label}</li>)}
            </ul>
          </>
        )}
      </Panel>

      <Panel>
        <h3 className="text-[17px] font-semibold text-white">Where leads come from</h3>
        <p className="mt-1 text-[14px] text-white/60">Last 14 days. The bright part is the share that qualified.</p>
        {sources.length === 0 ? <Empty>No sources have produced leads yet.</Empty> : (
          <ul className="mt-3 space-y-3">
            {sources.map((s) => (
              <li key={s.source}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[15px] font-medium text-white">{s.source.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</span>
                  <span className="whitespace-nowrap text-[13px] tabular-nums text-white/70">{s.qualified}{NBSP}of{NBSP}{s.found} qualified</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/10" style={{ width: `${Math.max(8, (s.found / maxFound) * 100)}%` }}
                  role="img" aria-label={`${s.source}: ${s.qualified} of ${s.found} qualified`}>
                  <div className="h-full rounded-full bg-sky-400 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${s.found ? (s.qualified / s.found) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
