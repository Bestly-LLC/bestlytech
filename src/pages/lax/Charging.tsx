/**
 * "Supercharging on your trip": every Supercharger stop inside the trip window, what it cost, and the running total.
 * Live during the trip from TezLab (estimate), replaced by Tesla's billed amounts after the trip (final).
 * Data: lax_guest_public(token).charging ← trip_charges_for(reservation) ← trip_charges (synced by trip_charges_tick).
 */
import { BatteryCharging, CheckCircle2, Clock, FileDown, Receipt, Zap } from "lucide-react";
import { track } from "./track";

export type ChargeSession = { at: string; end?: string | null; place?: string | null; address?: string | null; kwh?: number | null; from?: number | null; to?: number | null; cost?: number | null; idle?: number | null; final?: boolean; invoices?: { id: string; name?: string }[] | null };
export type Charging = { sessions: ChargeSession[]; total: number; idle: number; kwh: number; count: number; final: boolean; updated_at?: string | null };

const ACCENT = "var(--trip-accent)";
const RECEIPT = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/trip-receipt";
const money = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`;
};
const shortPlace = (p?: string | null) => (p ?? "Supercharger").replace(/, CA\b/, "").replace(/^Los Angeles - /, "");

export function ChargingCard({ charging, battery, pickupBattery, ended, embedded, titleFont, token }: {
  charging: Charging; battery?: number | null; pickupBattery?: number | null; ended?: boolean; embedded?: boolean; titleFont?: string; token?: string;
}) {
  const c = charging;
  const short = battery != null && pickupBattery != null ? pickupBattery - battery : null;
  return (
    <section id="charging" aria-label="Supercharging on your trip" className={embedded ? "" : "mt-6 scroll-mt-4 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Supercharging · this trip</p>
          <p className="mt-1 text-[34px] font-bold leading-none tabular-nums text-white" style={{ fontFamily: titleFont }}>{money(c.total)}</p>
          <p className="mt-1.5 text-[13px] text-white/65">{c.count === 0 ? "No stops yet" : `${c.count} stop${c.count === 1 ? "" : "s"} · ${c.kwh} kWh`}{c.idle > 0 ? ` · incl. ${money(c.idle)} idle fees` : ""}</p>
        </div>
        <span className={`mt-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${c.final ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/30" : "bg-white/10 text-white/75 ring-1 ring-white/15"}`}>
          {c.final ? <><CheckCircle2 className="h-3.5 w-3.5" /> Final</> : <><Clock className="h-3.5 w-3.5" /> Estimate</>}
        </span>
      </div>

      {!ended && battery != null && pickupBattery != null && (
        <div className="mt-3 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
          <div className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-1.5 text-white/80"><BatteryCharging className="h-4 w-4 text-emerald-300" /> Now <b className="tabular-nums text-white">{battery}%</b></span>
            <span className="text-white/65">Return at <b className="tabular-nums text-white">{pickupBattery}%+</b></span>
          </div>
          <div className="relative mt-2 h-2 rounded-full bg-white/10" aria-hidden>
            <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${Math.min(100, Math.max(2, battery))}%` }} />
            <span className="absolute -top-1 h-4 w-[2px] rounded bg-white" style={{ left: `${Math.min(100, pickupBattery)}%` }} />
          </div>
          <p className="mt-1.5 text-[12px] text-white/60">{short != null && short > 0 ? `About ${short}% to add before you return.` : "You're above your pickup charge."}</p>
        </div>
      )}

      {c.sessions.length > 0 ? (
        <ol className="mt-3 divide-y divide-white/10">
          {c.sessions.map((s) => (
            <li key={s.at} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10"><Zap className="h-4 w-4" style={{ color: ACCENT }} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-white">{shortPlace(s.place)}</p>
                <p className="text-[12px] text-white/60">{when(s.at)}{s.from != null && s.to != null ? ` · ${s.from}% → ${s.to}%` : ""}{s.kwh ? ` · ${s.kwh} kWh` : ""}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[15px] font-semibold tabular-nums text-white">{money((s.cost ?? 0) + (s.idle ?? 0))}</p>
                {!!s.idle && s.idle > 0 && <p className="text-[11px] text-amber-200">incl. {money(s.idle)} idle</p>}
                {token && s.invoices?.[0] && (
                  <a href={`${RECEIPT}?t=${encodeURIComponent(token)}&inv=${encodeURIComponent(s.invoices[0].id)}`} target="_blank" rel="noreferrer" onClick={() => track(token, "tesla_receipt")}
                    className="mt-0.5 inline-flex min-h-[28px] items-center gap-1 text-[12px] font-semibold underline decoration-white/30 underline-offset-2" style={{ color: ACCENT }}>
                    <Receipt className="h-3.5 w-3.5" /> Tesla receipt
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-[14px] leading-snug text-white/70">{ended ? "No Supercharger stops on this trip." : "No Supercharger stops yet. When you charge, it shows up here within about 30 minutes."}</p>
      )}

      {token && c.count > 0 && (
        <a href={`${RECEIPT}?t=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer" onClick={() => track(token, "charge_receipt")}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-[15px] font-semibold text-white ring-1 ring-white/15 active:scale-[0.98]">
          <FileDown className="h-4 w-4" style={{ color: ACCENT }} /> Download receipt (PDF)
        </a>
      )}
      <p className="mt-2 text-[12px] leading-snug text-white/55">
        Supercharging bills to the car's Tesla account{c.final ? "." : ". These are estimates until Tesla's final bill comes in after your trip."} Your host sends the total through Turo as a reimbursement request.
        {c.updated_at ? ` Updated ${ago(c.updated_at)}.` : ""}
      </p>
    </section>
  );
}
