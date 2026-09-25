/**
 * Car protection (Turo Watch): the log of what the car-protect engine saw and did (speeding, left LA / CA,
 * moved with no trip, auto-closed windows, auto-locked at home or LAX, Sentry on/off, tires, arrival time),
 * plus "Toll & ticket check": pick the date and time on a ticket or toll and see who had the car and where it was.
 * Data: admin_car_events(), admin_car_where(). The engine is car_protect_tick() (every 5 min, watchdog → Scout).
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Copy, Gauge, Lock, MapPin, Navigation, Search, Shield, ShieldCheck, Thermometer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { LoadError, SectionHeader, cardCls, focusRing, text, tint } from "@/components/admin/ui";
import { TirePsiGrid } from "./TirePsiGrid";

type Ev = { id: number; at: string; kind: string; severity: string; title: string; detail: string; lat: number | null; lon: number | null; guest: string | null; read_at: string | null };
const at12 = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const maps = (lat: number, lon: number) => `https://maps.apple.com/?ll=${lat},${lon}&q=Car`;

/** The categories, like the Car widget: one row each with a status dot; tap to see the incidents, newest first. */
const GROUPS: { id: string; label: string; kinds: string[]; icon: typeof Gauge; about: string }[] = [
  { id: "speed", label: "Speeding", kinds: ["speed"], icon: Gauge, about: "Any drive over 90 mph, with the guest, top speed and where." },
  { id: "where", label: "Left LA or California", kinds: ["left_la", "left_ca"], icon: MapPin, about: "The car went more than 60 miles from LA, or crossed the state line." },
  { id: "moved", label: "Moved with no trip", kinds: ["moved_no_trip"], icon: TriangleAlert, about: "The car moved when no one had it booked." },
  { id: "tires", label: "Tire pressure", kinds: ["tires"], icon: Thermometer, about: "Red under 38 psi, yellow when a tire is getting close (under 40) or two tires differ." },
  { id: "fixes", label: "Windows & locks", kinds: ["autofix_windows", "autofix_lock"], icon: Lock, about: "Windows closed automatically anywhere; locked automatically only at N Kings Rd or the LAX garage." },
  { id: "sentry", label: "Sentry", kinds: ["sentry_on", "sentry_off"], icon: ShieldCheck, about: "Sentry turns on between trips and off during trips." },
  { id: "arrival", label: "Returns & arrival", kinds: ["eta", "late"], icon: Navigation, about: "How far away the guest is when heading back, and late returns." },
  { id: "wipe", label: "Guest access removed", kinds: ["wipe"], icon: Shield, about: "The guest's Tesla access removed after the trip." },
];
const serious = (e: Ev) => e.severity === "warning" || e.severity === "critical";

function Dot({ tone }: { tone: "red" | "yellow" | "green" }) {
  return <span className={cn("h-3 w-3 shrink-0 rounded-full", tone === "red" ? "bg-[#FF453A]" : tone === "yellow" ? "bg-[#FFD60A]" : "bg-[#30D158]")} aria-hidden />;
}

export function CarProtectLog() {
  const [evs, setEvs] = useState<Ev[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // The four pressures, straight from car_health_admin — the same read the Car health card
  // shows. The old code scraped them out of the "41 · 41 · 40 · 40 psi" summary string,
  // which gave a lowest number and no way to say which corner it was.
  const [tires, setTires] = useState<Record<string, number | null> | null>(null);
  const [tiresAt, setTiresAt] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [{ data, error }, ready] = await Promise.all([
      supabase.rpc("admin_car_events" as never, { p_days: 60 } as never) as unknown as Promise<{ data: Ev[] | null; error: unknown }>,
      supabase.rpc("car_health_admin" as never) as unknown as Promise<{ data: { health?: { tires?: Record<string, number | null> } | null; health_at?: string | null } | null }>,
    ]);
    if (error) { setFailed(true); return; }
    setFailed(false); setEvs(data ?? []);
    setTires(ready.data?.health?.tires ?? null);
    setTiresAt(ready.data?.health_at ?? null);
  }, []);


  useEffect(() => { load(); }, [load]);

  const psi = tires ? Object.values(tires).filter((n): n is number => typeof n === "number") : [];
  const lowPsi = psi.length ? Math.min(...psi) : null;

  const toggle = (g: (typeof GROUPS)[number]) => {
    const next = open === g.id ? null : g.id;
    setOpen(next);
    if (next && evs?.some((e) => g.kinds.includes(e.kind) && !e.read_at)) {
      void (supabase.rpc("admin_car_events_read" as never, { p_kinds: g.kinds } as never) as unknown as Promise<unknown>);
      const now = new Date().toISOString();
      setEvs((xs) => xs?.map((e) => (g.kinds.includes(e.kind) && !e.read_at ? { ...e, read_at: now } : e)) ?? xs);
    }
  };

  return (
    <section aria-labelledby="protect-title" id="protect" className="scroll-mt-24">
      <SectionHeader id="protect-title" title="Car protection" icon={<Shield className="h-3.5 w-3.5" aria-hidden />} aside="Last 60 days" />
      <div className={cn(cardCls, "overflow-hidden")}>
        {failed ? <div className="p-4 sm:p-6"><LoadError label="car protection" onRetry={load} /></div>
          : !evs ? <div className="h-64 animate-pulse" />
          : (
            <ul className="divide-y divide-white/[0.06]">
              {GROUPS.map((g) => {
                const list = evs.filter((e) => g.kinds.includes(e.kind));
                const unread = list.filter((e) => !e.read_at);
                const tireTone = g.id === "tires" && lowPsi != null ? (lowPsi < 38 ? "red" : lowPsi < 40 ? "yellow" : null) : null;
                const tone: "red" | "yellow" | "green" = unread.some(serious) || tireTone === "red" ? "red" : unread.length || tireTone === "yellow" ? "yellow" : "green";
                const Icon = g.icon;
                const isOpen = open === g.id;
                const right = unread.length ? `${unread.length} new` : list.length ? `Last ${at12(list[0].at)}` : "None";
                return (
                  <li key={g.id}>
                    <button type="button" onClick={() => toggle(g)} aria-expanded={isOpen} aria-controls={`protect-${g.id}`}
                      className={cn("flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.03] sm:px-5", focusRing, "focus-visible:ring-inset")}>
                      <Dot tone={tone} />
                      <Icon className="h-[18px] w-[18px] shrink-0 text-white/50" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[15px] text-white">{g.label}
                        {g.id === "tires" && lowPsi != null && <span className="text-white/50"> · lowest {Math.round(lowPsi)} psi</span>}</span>
                      <span className={cn("shrink-0 text-[13px] tabular-nums", unread.length ? (tone === "red" ? tint.red : tint.orange) : "text-white/50")}>{right}</span>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/40 transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
                    </button>
                    {isOpen && (
                      <div id={`protect-${g.id}`} className="bg-white/[0.02] px-4 pb-3 pt-1 sm:px-5">
                        {g.id === "tires" && (
                          <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-1 rounded-2xl bg-white/[0.04] px-3 py-2.5 bento:bg-black/[0.03]">
                            <div>
                              <p className={cn(text.meta, "mb-1 uppercase tracking-wide")}>Right now</p>
                              {tires
                                ? <TirePsiGrid tires={tires} low={38} size="lg" />
                                : <p className={text.detail}>Not read yet.</p>}
                            </div>
                            <p className={cn(text.meta, "pb-1")}>
                              {tiresAt ? `Read ${at12(tiresAt)}` : "Reads when the car is awake"}
                              {lowPsi != null && <> · lowest {Math.round(lowPsi)} psi</>}
                            </p>
                          </div>
                        )}
                        <p className={cn(text.detail, "pb-2")}>{g.about}</p>
                        {list.length === 0 ? <p className={cn(text.meta, "pb-1")}>Nothing yet.</p> : (
                          <ol className="space-y-2">
                            {list.map((e) => (
                              <li key={e.id} className="flex gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
                                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", serious(e) ? "bg-[#FF453A]" : e.severity === "info" ? "bg-white/30" : "bg-[#FFD60A]")} aria-hidden />
                                <div className="min-w-0 flex-1">
                                  <p className={text.title}>{e.title}</p>
                                  {e.detail && <p className={text.detail}>{e.detail}</p>}
                                  <p className={cn(text.meta, "mt-0.5")}>{at12(e.at)}{e.guest ? ` · ${e.guest}` : " · no trip"}
                                    {e.lat != null && e.lon != null && <> · <a href={maps(e.lat, e.lon)} target="_blank" rel="noreferrer" className={cn(tint.blue, "hover:underline")}>Map</a></>}</p>
                                </div>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
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
