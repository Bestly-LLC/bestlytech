/**
 * Admin › Wall › Advanced › Electricity: what the wall costs to run, counting up live (W4, 2026-09-27).
 *
 * Watts come from the Pi (server.py power_loop, pushed with the watchdog status about once a minute):
 * projector = the Capsule 3's own input reading (volts x amps from the charger bus), Pi = the Pi 5 power chip's
 * rails plus a little for the fan and supply. The Pi also adds up kWh per day and month. Dollars are worked out
 * here with LADWP's standard home plan (R-1A) Tier 1 price including adjustments (same rate as the wall widget).
 *
 * HIG: one grouped inset list, big live number first, tabular figures so digits don't jitter while counting,
 * numbers never wrap away from their units, the live count is not announced to screen readers every second.
 */
import { useEffect, useState } from "react";
import { Zap } from "lucide-react";

export type WallPowerMeter = {
  w?: number | null; proj_w?: number | null; pi_w?: number | null; proj_on?: boolean | null;
  kwh_today?: number; kwh_month?: number; kwh_day_avg?: number | null; days_measured?: number;
  at?: number | null; err?: string | null;
};

/** LADWP R-1A Tier 1, all-in $/kWh by month (Jan..Dec), the same price the wall's energy widget uses (wall_feeds
 *  'energy' rate_c_kwh). Oct–Dec 2026 aren't published yet: the Jan–Mar price is used. */
const LADWP_T1 = [0.24771, 0.24771, 0.24771, 0.24362, 0.24362, 0.24362, 0.26408, 0.26408, 0.26408, 0.24771, 0.24771, 0.24771];
const rateNow = () => LADWP_T1[new Date().getMonth()];

const NW = ({ children }: { children: React.ReactNode }) => <span className="whitespace-nowrap">{children}</span>;
const money = (d: number) => (d < 1 ? `$${d.toFixed(3)}` : d < 100 ? `$${d.toFixed(2)}` : `$${Math.round(d).toLocaleString("en-US")}`);
const watts = (w: number | null | undefined) => (w == null ? "–" : w < 10 ? w.toFixed(1) : String(Math.round(w)));
const time12 = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

export function WallPowerCost({ meter }: { meter: WallPowerMeter | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rate = rateNow();
  const at = meter?.at ? meter.at * 1000 : null;
  const fresh = at != null && now - at < 15 * 60 * 1000 && !meter?.err;
  const w = fresh ? meter?.w ?? null : null;
  // live count: the Pi's kWh so far + the current draw since that reading (capped at 15 min)
  const extraKwh = w && at ? (w * Math.min(now - at, 15 * 60 * 1000)) / 3.6e9 : 0;
  const today = ((meter?.kwh_today ?? 0) + extraKwh) * rate;
  const month = ((meter?.kwh_month ?? 0) + extraKwh) * rate;
  const perDayKwh = meter?.kwh_day_avg ?? (w ? (w * 24) / 1000 : null);
  const year = perDayKwh != null ? perDayKwh * 365 * rate : null;
  const paceFromDays = meter?.kwh_day_avg != null;
  const started = (meter?.days_measured ?? 0) <= 2;

  return (
    <section id="power-cost" className="scroll-mt-20 space-y-2">
      <h2 className="px-4 text-[13px] font-medium uppercase tracking-[0.06em] text-white/50">Electricity</h2>
      <div className="overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
        <div className="flex min-h-[72px] items-center gap-3 border-b border-white/[0.07] px-4 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/15">
            <Zap className="h-5 w-5 text-amber-300" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[22px] font-semibold tabular-nums text-white">
              {w != null ? <NW>{watts(w)}&nbsp;W</NW> : <span className="text-white/50">No reading</span>}
              {w != null && <span className="ml-2 text-[15px] font-normal text-white/50">right now</span>}
            </div>
            <div className="text-[13px] text-white/55">
              {w != null ? (
                <>
                  <NW>Projector {watts(meter?.proj_w)}&nbsp;W{meter?.proj_on === false ? " (asleep)" : ""}</NW>
                  {" · "}
                  <NW>Pi {watts(meter?.pi_w)}&nbsp;W</NW>
                </>
              ) : at ? (
                <>Last reading <NW>{time12(at)}</NW>{meter?.err ? `: ${meter.err}` : ""}</>
              ) : (
                "Waiting for the Pi's first reading."
              )}
            </div>
          </div>
        </div>
        <div aria-live="off">
          <Line label="Today" value={money(today)} />
          <Line label={started ? "This month (since Sep 27)" : "This month so far"} value={money(month)} />
          <Line label="Per year at this pace" value={year != null ? money(year) : "–"}
            detail={year == null ? undefined : paceFromDays ? "From the last 7 days" : "From the power it's using right now"} />
        </div>
      </div>
      <p className="px-4 text-[13px] leading-snug text-white/50">
        Estimate at LADWP's <NW>{(rate * 100).toFixed(1)}¢ per kWh</NW> (standard home plan with adjustments). Measured watts from the
        projector and the Pi; the Pi also runs Home Assistant, so this counts all of it.
      </p>
    </section>
  );
}

function Line({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 border-b border-white/[0.07] px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[16px] text-white">{label}</div>
        {detail && <div className="mt-0.5 text-[13px] text-white/50">{detail}</div>}
      </div>
      <div className="shrink-0 whitespace-nowrap text-[17px] tabular-nums text-white">{value}</div>
    </div>
  );
}
