/**
 * Car protection (Turo Watch): the log of what the car-protect engine saw and did (speeding, left LA / CA,
 * moved with no trip, auto-closed windows, auto-locked at home or LAX, Sentry on/off, tires, arrival time),
 * plus "Toll & ticket check": pick the date and time on a ticket or toll and see who had the car and where it was.
 * Data: admin_car_events(), admin_car_where(). The engine is car_protect_tick() (every 5 min, watchdog → Scout).
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Gauge, Lock, MapPin, Navigation, Search, Shield, ShieldCheck, Thermometer, TriangleAlert, Wind } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { LoadError, SectionHeader, cardCls, focusRing, text, tint } from "@/components/admin/ui";

type Ev = { id: number; at: string; kind: string; severity: string; title: string; detail: string; lat: number | null; lon: number | null; guest: string | null };
const ICON: Record<string, typeof Gauge> = {
  speed: Gauge, left_la: MapPin, left_ca: TriangleAlert, moved_no_trip: TriangleAlert, autofix_windows: Wind, autofix_lock: Lock,
  sentry_on: ShieldCheck, sentry_off: Shield, tires: Thermometer, eta: Navigation, late: TriangleAlert, wipe: ShieldCheck,
};
const at12 = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const maps = (lat: number, lon: number) => `https://maps.apple.com/?ll=${lat},${lon}&q=Car`;

export function CarProtectLog() {
  const [evs, setEvs] = useState<Ev[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await (supabase.rpc("admin_car_events" as never, { p_days: 30 } as never) as unknown as Promise<{ data: Ev[] | null; error: unknown }>);
    if (error) { setFailed(true); return; }
    setFailed(false); setEvs(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <section aria-labelledby="protect-title" id="protect" className="scroll-mt-24">
      <SectionHeader id="protect-title" title="Car protection" icon={<Shield className="h-3.5 w-3.5" aria-hidden />} aside="Last 30 days" />
      <div className={cn(cardCls, "overflow-hidden")}>
        {failed ? <div className="p-4 sm:p-6"><LoadError label="car protection" onRetry={load} /></div>
          : !evs ? <div className="h-32 animate-pulse" />
          : evs.length === 0 ? (
            <div className="px-4 py-5 sm:px-6">
              <p className={text.title}>All quiet</p>
              <p className={cn(text.detail, "mt-0.5")}>Speeding over 90 mph, leaving LA or California, moving with no trip, open windows, unlocked at home or LAX, Sentry, tires and return time all show up here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {evs.slice(0, 25).map((e) => {
                const Icon = ICON[e.kind] ?? Shield;
                const warn = e.severity === "warning" || e.severity === "critical";
                return (
                  <li key={e.id} className="flex items-start gap-3 px-4 py-3 sm:px-6">
                    <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", e.severity === "critical" ? tint.red : warn ? tint.orange : "text-white/50")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className={text.title}>{e.title}</p>
                      <p className={text.detail}>{e.detail}</p>
                      <p className={cn(text.meta, "mt-0.5")}>{at12(e.at)}{e.guest ? ` · ${e.guest}'s trip` : ""}
                        {e.lat != null && e.lon != null && <> · <a href={maps(e.lat, e.lon)} target="_blank" rel="noreferrer" className={cn(tint.blue, "hover:underline")}>Map</a></>}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </section>
  );
}

type Where = {
  at: string; trip: { reservation_id: number; guest: string | null; starts_at: string; ends_at: string; kind: string } | null;
  points: { at: string; lat: number; lon: number; mins: number }[];
  drives: { id: string; started_at: string; ended_at: string | null; from: string | null; to: string | null; miles: number | null; max_mph: number | null }[];
  history_from: string | null;
};

export function TollCheck() {
  const [val, setVal] = useState("");
  const [res, setRes] = useState<Where | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!val) return;
    setBusy(true);
    // The input is LA local time; send it as an LA timestamp.
    const iso = new Date(val).toISOString();
    const { data, error } = await (supabase.rpc("admin_car_where" as never, { p_at: iso } as never) as unknown as Promise<{ data: Where | null; error: { message: string } | null }>);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setRes(data);
  };
  const nearest = res?.points.slice().sort((a, b) => Math.abs(a.mins) - Math.abs(b.mins))[0];
  const summary = res && (res.trip
    ? `On ${at12(res.at)} the car was on ${res.trip.guest ?? "the guest"}'s Turo trip (reservation ${res.trip.reservation_id}, ${at12(res.trip.starts_at)} to ${at12(res.trip.ends_at)}).`
      + (nearest ? ` Car location ${Math.abs(nearest.mins)} min ${nearest.mins < 0 ? "before" : "after"}: ${nearest.lat.toFixed(5)}, ${nearest.lon.toFixed(5)}.` : "")
      + (res.drives.length ? ` Drives in that window: ${res.drives.map((d) => `${d.from ?? "?"} to ${d.to ?? "?"}`).join("; ")}.` : "")
    : `No Turo trip was active on ${at12(res.at)}.`);
  return (
    <section aria-labelledby="toll-title">
      <SectionHeader id="toll-title" title="Toll & ticket check" icon={<Search className="h-3.5 w-3.5" aria-hidden />} />
      <div className={cn(cardCls, "space-y-3 p-4 sm:p-6")}>
        <p className={text.detail}>Enter the date and time on the ticket or toll. You'll see who had the car and where it was.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="toll-at" className="sr-only">Date and time on the ticket</label>
          <input id="toll-at" type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)}
            className="min-h-[44px] rounded-[12px] bg-[#2C2C2E] px-3.5 text-[16px] text-white outline-none focus:ring-2 focus:ring-[#0A84FF] sm:text-[15px] bento:bg-[#7676801f] bento:text-black" />
          <button type="button" onClick={run} disabled={!val || busy}
            className={cn("inline-flex min-h-[44px] items-center rounded-full bg-[#0A84FF] px-5 text-[15px] font-semibold text-white disabled:opacity-50", focusRing)}>{busy ? "Checking…" : "Check"}</button>
        </div>
        {res && (
          <div className="space-y-2 rounded-2xl bg-white/[0.04] p-3.5">
            <p className="text-[17px] font-semibold text-white">{res.trip ? `${res.trip.guest ?? "Guest"} had the car` : "No trip at that time"}</p>
            {res.trip && <p className={text.detail}>{res.trip.kind === "home" ? "Home" : "LAX"} trip · {at12(res.trip.starts_at)} to {at12(res.trip.ends_at)} · #{res.trip.reservation_id}</p>}
            {nearest ? (
              <p className={text.detail}>Where: <a href={maps(nearest.lat, nearest.lon)} target="_blank" rel="noreferrer" className={cn(tint.blue, "hover:underline")}>{nearest.lat.toFixed(4)}, {nearest.lon.toFixed(4)}</a> ({Math.abs(nearest.mins)} min {nearest.mins < 0 ? "before" : "after"})</p>
            ) : (
              <p className={text.detail}>No saved location near that time{res.history_from ? ` (history starts ${at12(res.history_from)})` : " (location history started Sep 25, 2026)"}.</p>
            )}
            {res.drives.map((d) => <p key={d.id} className={text.detail}>Drive: {d.from ?? "?"} → {d.to ?? "?"}{d.miles ? ` · ${Math.round(d.miles)} mi` : ""}{d.max_mph ? ` · top ${Math.round(d.max_mph)} mph` : ""}</p>)}
            {summary && (
              <button type="button" onClick={() => { void navigator.clipboard.writeText(summary); toast.success("Copied for Turo"); }}
                className={cn("inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium", tint.blue)}><Copy className="h-4 w-4" aria-hidden /> Copy summary for Turo</button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
