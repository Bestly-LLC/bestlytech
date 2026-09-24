/**
 * Turo Watch: price trends and the price manager.
 *
 * All four lines are in LISTING-PRICE dollars per day (what you set, before Turo's fees):
 *   You     our listing price for each rental day
 *   Turo    Turo's dynamic price for that day: the floor the manager never goes under
 *   Market  median of nearby Model 3s (25 mi), converted from what renters pay (x 0.603)
 *   Edgar   Edgar's 2023 Model 3, same conversion
 * Data: view turo_price_series (history back to Aug 3 2026, rebuilt from the old artifact).
 */
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SeriesRow { day: string; series: "us" | "turo" | "market" | "edgar"; value: number }
export interface Target { id: string; label: string; page_url: string; vehicle: string | null; chart: boolean; note: string | null }
export interface CompPrice { observed_at: string; target_id: string; car: string | null; window_start: string | null; window_end: string | null; nights: number | null; trip_total: number | null; renter_daily: number | null; host_equiv: number | null }
export interface PlanDay { date: string; lead: number | null; floor: number | null; cur: number | null; proposed: number | null; applied: number | null; status: string; reason: string | null }

const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const SERIES = [
  { key: "us", label: "You", color: "#0A84FF", width: 3 },
  { key: "edgar", label: "Edgar", color: "#F97316", width: 2.5 },
  { key: "market", label: "Market median", color: "#10B981", width: 2 },
  { key: "turo", label: "Turo's dynamic price", color: "#A1A1AA", width: 2, dash: "5 4" },
] as const;
const RANGES = [
  { id: "today", label: "Today", days: 0 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "1y", label: "1 year", days: 365 },
] as const;

const todayPT = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const short = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const money = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "–" : `$${Math.round(n)}`);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Latest value at or before a day (competitor + market readings are sparse). */
function lastOn(rows: SeriesRow[], series: SeriesRow["series"], day: string) {
  let v: number | null = null;
  for (const r of rows) if (r.series === series && r.day <= day) v = Number(r.value);
  return v;
}

export function TuroTrends({ rows }: { rows: SeriesRow[] | null }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("30d");
  const today = todayPT();
  const sorted = useMemo(() => (rows ?? []).slice().sort((a, b) => a.day.localeCompare(b.day)), [rows]);

  const data = useMemo(() => {
    const r = RANGES.find((x) => x.id === range)!;
    const from = addDays(today, -r.days), to = addDays(today, 7); // a week ahead shows what's planned
    const byDay = new Map<string, Record<string, number | string>>();
    for (const x of sorted) {
      if (x.day < from || x.day > to) continue;
      const o = byDay.get(x.day) ?? { day: x.day };
      o[x.series] = Math.round(Number(x.value));
      byDay.set(x.day, o);
    }
    return [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  }, [sorted, range, today]);

  // Today's snapshot: each line's value for today (or the latest reading before it).
  const snap = SERIES.map((s) => ({ ...s, value: lastOn(sorted, s.key, today) }));
  const us = snap[0].value;

  return (
    <section className={cn(card, "p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><TrendingUp className="h-4 w-4 text-white/60" /> Price trends</h2>
        <div role="group" aria-label="Range" className="flex rounded-full bg-white/[0.06] p-1 bento:bg-[#F3F2EE]">
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => setRange(r.id)} aria-pressed={range === r.id}
              className={cn("h-8 rounded-full px-3.5 text-xs font-medium transition", range === r.id ? "bg-white text-black shadow bento:bg-[#111114] bento:text-[#fff]" : "text-white/60 hover:text-white")}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? <div className="mt-4 h-64 animate-pulse rounded-xl bg-white/[0.04]" /> : range === "today" ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {snap.map((s) => {
            const diff = s.key !== "us" && us != null && s.value != null ? us - s.value : null;
            return (
              <div key={s.key} className="rounded-2xl bg-white/[0.04] p-4 bento:bg-[#F3F2EE]">
                <p className="flex items-center gap-1.5 text-xs text-white/60"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-white">{money(s.value)}<span className="text-sm font-normal text-white/60">/day</span></p>
                {diff != null && (
                  <p className={cn("mt-0.5 flex items-center gap-0.5 text-xs", diff > 0 ? "text-emerald-300 bento:text-emerald-700" : diff < 0 ? "text-amber-300 bento:text-amber-700" : "text-white/60")}>
                    {diff > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : diff < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    you're {diff === 0 ? "even" : `${money(Math.abs(diff))} ${diff > 0 ? "above" : "below"}`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : data.length === 0 ? (
        <p className="mt-6 py-10 text-center text-sm text-white/60">No prices in this range yet.</p>
      ) : (
        <div className="mt-4 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
              <XAxis dataKey="day" tickFormatter={short} tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.5 }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.5 }} axisLine={false} tickLine={false} domain={["dataMin - 8", "dataMax + 8"]} width={48} />
              <Tooltip
                contentStyle={{ background: "rgba(20,20,24,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12, color: "#fff" }}
                labelFormatter={(d) => new Date(String(d) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                formatter={(v: number, k: string) => [`$${v}`, SERIES.find((s) => s.key === k)?.label ?? k]} />
              <Legend formatter={(k: string) => SERIES.find((s) => s.key === k)?.label ?? k} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine x={today} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" label={{ value: "today", fontSize: 10, fill: "currentColor", fillOpacity: 0.5, position: "insideTopRight" }} />
              {SERIES.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={s.width} strokeDasharray={"dash" in s ? s.dash : undefined}
                  dot={s.key === "edgar" || s.key === "market" ? { r: 3 } : false} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-3 text-xs text-white/60">
        Listing-price dollars per day. Market and Edgar are converted from what renters pay (x 0.603, Turo's cut). Right of "today" is what's planned.
      </p>
    </section>
  );
}

/* ───────── price manager ───────── */

const mult = (lead: number) => (lead >= 8 ? 1.2 : lead >= 4 ? 1.12 : lead >= 2 ? 1.06 : 1);

export function PriceManager({ rows, plan, marketBase, paused, canWrite }: {
  rows: SeriesRow[] | null; plan: PlanDay[]; marketBase: number | null; paused: boolean; canWrite: boolean;
}) {
  const today = todayPT();
  const sorted = (rows ?? []).slice().sort((a, b) => a.day.localeCompare(b.day));
  const market = lastOn(sorted, "market", today);
  const edgar = lastOn(sorted, "edgar", today);
  const ceiling = marketBase != null ? Math.round(marketBase * 1.1) : null;

  // Next 8 days: the latest run's plan where we have it, else the last known Turo price and ours.
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i + 1)).map((d, i) => {
    const p = plan.find((x) => x.date === d);
    const floor = p?.floor ?? sorted.filter((r) => r.series === "turo" && r.day === d).map((r) => Number(r.value))[0] ?? null;
    const cur = p?.cur ?? sorted.filter((r) => r.series === "us" && r.day === d).map((r) => Number(r.value))[0] ?? null;
    let rec = p?.applied ?? p?.proposed ?? null;
    if (rec == null && floor != null) {
      rec = Math.round(floor * mult(i + 1));
      if (ceiling != null) rec = Math.min(rec, ceiling);
      if (cur != null) rec = Math.min(Math.max(rec, Math.round(cur * 0.75)), Math.round(cur * 1.25));
      rec = Math.max(rec, floor);
    }
    return { d, lead: i + 1, floor, cur, rec, status: p?.status ?? (floor == null ? "no-data" : "estimate") };
  });

  // What the manager earns over Turo's own pricing, last 30 days of rental days.
  const from = addDays(today, -30);
  const pairs = sorted.filter((r) => r.series === "us" && r.day >= from && r.day <= today).map((r) => {
    const t = sorted.find((x) => x.series === "turo" && x.day === r.day);
    return t ? Number(r.value) - Number(t.value) : null;
  }).filter((x): x is number => x != null);
  const lift = avg(pairs);
  const next7 = avg(days.slice(0, 7).map((x) => x.rec ?? x.cur).filter((x): x is number => x != null));

  const tips: string[] = [];
  if (next7 != null && edgar != null) {
    const gap = Math.round(edgar - next7);
    tips.push(gap > 3 ? `Edgar's Model 3 is about $${gap}/day more than your next week. There's room to go up.`
      : gap < -3 ? `You're about $${-gap}/day above Edgar's Model 3. Fine while bookings hold; watch for empty days.`
      : "You're priced right alongside Edgar's Model 3.");
  }
  if (next7 != null && market != null) {
    const gap = Math.round(market - next7);
    tips.push(gap > 3 ? `The nearby market median is $${gap}/day above you.` : gap < -3 ? `You're $${-gap}/day above the nearby market median.` : "You're at the nearby market median.");
  }
  if (lift != null) tips.push(`Over the last 30 days the manager priced ${lift >= 0 ? `$${Math.round(lift)}/day above` : `$${Math.round(-lift)}/day below`} Turo's own dynamic price.`);

  return (
    <section className={cn(card, "p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Price manager</h2>
          <p className="mt-0.5 max-w-xl text-xs text-white/60">
            Starts from Turo's dynamic price (never goes under it), adds more the further out a day is, and caps at 10% over the nearby Model 3 market. Moves at most 25% per run.
          </p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-xs font-semibold",
          paused ? "bg-amber-500/15 text-amber-300 bento:text-amber-700" : canWrite ? "bg-emerald-500/15 text-emerald-300 bento:text-emerald-700" : "bg-amber-500/15 text-amber-300 bento:text-amber-700")}>
          {paused ? "Paused" : canWrite ? "Setting prices" : "Suggesting only (Turo signed out)"}
        </span>
      </div>

      {tips.length > 0 && (
        <ul className="mt-4 space-y-1.5 rounded-2xl bg-[#0A84FF]/10 p-4 text-sm text-white/85">
          {tips.map((t) => <li key={t} className="flex gap-2"><span className="text-[#5AB0FF]">•</span>{t}</li>)}
        </ul>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs text-white/60">
            <tr className="border-b border-white/[0.06]">
              <th className="py-2 pr-2 text-left font-medium">Day</th>
              <th className="px-2 py-2 text-right font-medium">Turo's price</th>
              <th className="px-2 py-2 text-right font-medium">Yours now</th>
              <th className="px-2 py-2 text-right font-medium">Recommended</th>
              <th className="px-2 py-2 text-right font-medium">vs Turo</th>
              <th className="py-2 pl-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {days.map((x) => {
              const up = x.rec != null && x.floor != null ? x.rec - x.floor : null;
              return (
                <tr key={x.d}>
                  <td className="py-2.5 pr-2 text-white">{new Date(x.d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-white/60">{money(x.floor)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-white/75">{money(x.cur)}</td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-white">{money(x.rec)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-emerald-300 bento:text-emerald-700">{up != null ? `+$${up}` : "–"}</td>
                  <td className="py-2.5 pl-2 text-right text-xs text-white/60">
                    {x.status === "applied" ? "Set" : x.status === "estimate" ? "Estimate" : x.status === "no-data" ? "Needs a run" : x.status === "blocked" ? "Not set" : x.status}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-white/60">"Estimate" rows use the last known Turo price; the next run with Turo signed in replaces them with live numbers and sets them.</p>
    </section>
  );
}

/* ───────── who we watch ───────── */

export function Competitors({ targets, prices }: { targets: Target[]; prices: CompPrice[] }) {
  return (
    <section className={cn(card, "p-5")}>
      <h2 className="text-sm font-semibold text-white">Who we're watching</h2>
      <ul className="mt-3 divide-y divide-white/[0.06]">
        {targets.map((t) => {
          const mine = prices.filter((p) => p.target_id === t.id);
          const at = mine.length ? mine.reduce((a, p) => (p.observed_at > a ? p.observed_at : a), "") : null;
          const latest = mine.filter((p) => p.observed_at.slice(0, 13) === at?.slice(0, 13));
          return (
            <li key={t.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">{t.label} <span className="font-normal text-white/60">· {t.vehicle}</span></p>
                  {t.note && <p className="text-xs text-white/60">{t.note}</p>}
                </div>
                <a href={t.page_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#5AB0FF] bento:text-[#0A6FD8]">Turo page <ExternalLink className="h-3.5 w-3.5" /></a>
              </div>
              {latest.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {latest.map((p, i) => (
                    <span key={i} className="rounded-xl bg-white/[0.05] px-3 py-1.5 text-xs text-white/75 bento:bg-[#F3F2EE]">
                      {p.car}: <b className="text-white">{money(p.renter_daily)}</b>/day to renters · ≈{money(p.host_equiv)} listing
                    </span>
                  ))}
                  <span className="self-center text-xs text-white/60">checked {new Date(at!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })}</span>
                </div>
              ) : <p className="mt-1 text-xs text-white/60">No reading yet. Every Turo Watch run checks it.</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
