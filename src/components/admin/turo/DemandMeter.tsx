/**
 * Turo Watch demand meter: how busy things are, in one glance.
 *   Your car     2020 Model 3: share of the next 14 days already booked
 *   Model 3s     nearby Model 3s: how many are still free next week vs 5 weeks out, and how much pricier next week is
 *   All cars     every car nearby: how much pricier next week is than 5 weeks out
 * Scores 0-100 from turo_demand (written by each Turo Watch run). Under 30 Slow, 30-54 Normal, 55-74 Busy, 75+ Hot.
 */
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DemandRow {
  observed_at: string; scope: "car" | "model3" | "all"; score: number; booked_share: number | null;
  near_count: number | null; far_count: number | null; far_capped: boolean | null;
  near_median_daily: number | null; far_median_daily: number | null; note: string | null;
}

const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const BANDS = [
  { max: 29, label: "Slow", color: "#60A5FA" },
  { max: 54, label: "Normal", color: "#34D399" },
  { max: 74, label: "Busy", color: "#FBBF24" },
  { max: 100, label: "Hot", color: "#F87171" },
];
const band = (s: number) => BANDS.find((b) => s <= b.max) ?? BANDS[3];
const SCOPES = [
  { id: "car", title: "Your car", sub: "2020 Tesla Model 3" },
  { id: "model3", title: "Model 3s nearby", sub: "All years, near West Hollywood" },
  { id: "all", title: "All cars nearby", sub: "Every make, near West Hollywood" },
] as const;

function why(r: DemandRow) {
  const pricier = r.near_median_daily && r.far_median_daily ? Math.round((r.near_median_daily / r.far_median_daily - 1) * 100) : null;
  if (r.scope === "car") return r.booked_share != null ? `${Math.round(r.booked_share * 14)} of the next 14 days are booked.` : r.note ?? "";
  if (r.scope === "model3") {
    const free = r.near_count != null && r.far_count != null ? `${r.near_count} still free next week vs ${r.far_count}${r.far_capped ? "+" : ""} a month out.` : "";
    return `${free} ${pricier != null ? `Next week runs ${pricier >= 0 ? `${pricier}% pricier` : `${-pricier}% cheaper`}.` : ""}`.trim();
  }
  return pricier != null ? `Renters pay ${pricier >= 0 ? `${pricier}% more` : `${-pricier}% less`} next week than a month out ($${r.near_median_daily} vs $${r.far_median_daily}/day).` : r.note ?? "";
}

/** Semicircle gauge: coloured bands, a needle, the score in the middle. */
function Gauge({ score }: { score: number }) {
  const r = 52, cx = 64, cy = 64;
  const pt = (s: number, rad = r) => {
    const a = Math.PI * (1 - s / 100);
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)] as const;
  };
  let from = 0;
  const arcs = BANDS.map((b) => {
    const [x1, y1] = pt(from + 1.5), [x2, y2] = pt(b.max - 1.5);
    const d = `M${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    from = b.max;
    return <path key={b.label} d={d} stroke={b.color} strokeWidth="11" strokeLinecap="round" fill="none" opacity={band(score).label === b.label ? 1 : 0.28} />;
  });
  const [nx, ny] = pt(score, r - 16);
  return (
    <svg viewBox="0 0 128 76" className="w-full max-w-[12rem]" aria-hidden>
      {arcs}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" style={{ transition: "all .6s cubic-bezier(.2,.8,.2,1)" }} />
      <circle cx={cx} cy={cy} r="5.5" fill="currentColor" />
    </svg>
  );
}

export function DemandMeter({ rows }: { rows: DemandRow[] | null }) {
  const latest = (s: string) => (rows ?? []).filter((r) => r.scope === s).sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0];
  const car = latest("car"), m3 = latest("model3"), all = latest("all");
  const hot = [car, m3, all].filter(Boolean).filter((r) => r!.score >= 55).length;
  const advice = !car && !m3 ? null
    : hot >= 2 ? "Demand is up: lean prices toward the top of the range, and don't discount short trips."
    : hot === 1 ? "Mixed: hold prices where they are and watch the open days."
    : "Demand is soft: stay near Turo's price and let longer-trip discounts fill the gaps.";
  const at = [car, m3, all].filter(Boolean).map((r) => r!.observed_at).sort().pop();

  return (
    <section className={cn(card, "p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Flame className="h-4 w-4 text-white/60" /> Demand</h2>
        {at && <span className="text-xs text-white/60">checked {new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })}</span>}
      </div>
      {rows === null ? <div className="mt-4 h-40 animate-pulse rounded-xl bg-white/[0.04]" /> : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {SCOPES.map((s) => {
              const r = latest(s.id);
              const b = r ? band(r.score) : null;
              return (
                <div key={s.id} className="flex flex-col items-center rounded-2xl bg-white/[0.04] px-4 pb-4 pt-3 text-center bento:bg-[#F3F2EE]">
                  <p className="text-sm font-semibold text-white">{s.title}</p>
                  <p className="text-xs text-white/60">{s.sub}</p>
                  {r && b ? (
                    <>
                      <div className="mt-2 w-full text-white"><Gauge score={r.score} /></div>
                      <p className="-mt-1 text-lg font-bold" style={{ color: b.color }}>{b.label}</p>
                      <p className="text-xs tabular-nums text-white/60">{r.score} / 100</p>
                      <p className="mt-2 text-xs leading-snug text-white/65">{why(r)}</p>
                    </>
                  ) : <p className="mt-6 text-xs text-white/60">No reading yet. The next run checks it.</p>}
                </div>
              );
            })}
          </div>
          {advice && <p className="mt-4 rounded-2xl bg-[#0A84FF]/10 px-4 py-3 text-sm text-white/85">{advice}</p>}
          <p className="mt-2 text-xs text-white/60">Slow · Normal · Busy · Hot. Checked on every Turo Watch run, twice a day.</p>
        </>
      )}
    </section>
  );
}
