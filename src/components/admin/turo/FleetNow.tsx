/**
 * Turo Watch, fleet side: who has the car, when it comes back, and what the car is doing.
 *
 * Reads turo_trips and turo_vehicle_state, both written by the turo-ingest edge function.
 * Nothing here fetches Turo directly - the browser session that can read Turo pushes to
 * turo-ingest, and this renders whatever landed.
 *
 * Two things this is careful about:
 *  - Telemetry can be stale. TezLab reports when the car last phoned home, so observed_at
 *    is shown as an age whenever it is old rather than pretending the reading is current.
 *  - Status never rides on color alone: every warning carries an icon and words, because a
 *    red ring means nothing to a colorblind reader or in a screenshot printed in grey.
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle, BatteryCharging, CalendarClock, Car, CheckCircle2, ExternalLink,
  Gauge, Lock, MapPin, Plane, Thermometer, Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface Trip {
  reservation_id: number; vin: string | null;
  guest_first: string | null; guest_last: string | null; guest_url: string | null;
  starts_at: string; ends_at: string; local_start: string | null; local_end: string | null;
  in_progress: boolean; checked_out: boolean;
  pickup_address: string | null; pickup_city: string | null; airport_code: string | null;
  earnings: number | null; miles_included: number | null; miles_unlimited: boolean;
  guest_phone: string | null;
}
export interface VehicleState {
  vin: string; display_name: string | null; observed_at: string;
  battery_pct: number | null; range_real: number | null; range_epa: number | null;
  odometer: number | null; latitude: number | null; longitude: number | null;
  locked: boolean | null; charging_state: string | null; plugged_in: boolean | null;
  inside_temp: number | null; outside_temp: number | null; connection_state: string | null;
}

/** Home base - 733 N Kings Rd. Distance from here is the "is my car where I think it is" check. */
const HOME = { lat: 34.0836, lon: -118.3765 };
/** What the car should leave on. Below this before a handoff is a problem worth naming. */
const READY_PCT = 80;

const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const muted = "text-white/50 bento:text-[#55525c]";
const ink = "text-white bento:text-[#17151c]";

/** Turo quotes host earnings to the cent; rounding them would misreport the payout. */
const money = (n: number | null | undefined) =>
  n == null ? null : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Straight-line miles. Good enough to answer "is it in the neighborhood or in Vegas". */
function milesFrom(lat: number, lon: number) {
  const R = 3958.8, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat - HOME.lat), dLon = rad(lon - HOME.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(HOME.lat)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** "4d 6h" / "3h 12m" / "18m". Coarse on purpose - nobody needs seconds on a 4-day trip. */
function until(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  const past = ms < 0;
  const s = Math.abs(ms) / 1000;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return { text, past, hours: s / 3600 };
}

const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });

/** A status line. Icon + words always, color only as reinforcement. */
function Flag({ tone, icon: Icon, children }: { tone: "ok" | "warn" | "bad"; icon: typeof Lock; children: React.ReactNode }) {
  const c = tone === "bad"
    ? "text-red-300 bento:text-red-700"
    : tone === "warn"
      ? "text-amber-300 bento:text-amber-700"
      : "text-emerald-300 bento:text-emerald-700";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", c)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  );
}

/**
 * Blue Steel itself. Cropped tight to the car and served at 560px - twice the largest
 * size it renders - so it stays sharp on a retina screen for 31KB.
 */
function CarShot({ className }: { className?: string }) {
  return (
    <img
      src="/blue-steel.webp"
      alt="Blue Steel, the 2020 Tesla Model 3"
      width={560}
      height={272}
      loading="eager"
      decoding="async"
      className={cn("h-auto w-[13rem] shrink-0 drop-shadow-[0_12px_24px_rgba(0,0,0,0.45)] sm:w-[16rem]", className)}
    />
  );
}

function Tile({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(card, "p-4", className)}>
      <p className={cn("text-[0.7rem] font-semibold uppercase tracking-wide", muted)}>{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function FleetNow({ trips, vehicle }: { trips: Trip[]; vehicle: VehicleState | null }) {
  // One tick a minute keeps every countdown on this page honest without a render storm.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const sorted = [...trips].sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  const current = sorted.find((t) => t.in_progress) ?? null;
  const upcoming = sorted.filter((t) => !t.in_progress && +new Date(t.starts_at) > now);
  const next = upcoming[0] ?? null;

  const name = (t: Trip) => [t.guest_first, t.guest_last].filter(Boolean).join(" ") || "Guest";
  const back = current ? until(current.ends_at, now) : null;

  // The turnaround: how long between this car coming back and going out again.
  const gapFrom = current?.ends_at ?? null;
  const gap = next && gapFrom ? (+new Date(next.starts_at) - +new Date(gapFrom)) / 3600000 : null;

  const pct = vehicle?.battery_pct ?? null;
  const age = vehicle ? (now - +new Date(vehicle.observed_at)) / 3600000 : null;
  const stale = age != null && age > 2;
  const hot = (vehicle?.inside_temp ?? 0) >= 100;
  const needsCharge = pct != null && pct < READY_PCT;

  return (
    <div className="space-y-4">
      {/* ── Out now ─────────────────────────────────────────────── */}
      <div className={cn(card, "relative overflow-hidden p-5 sm:p-6")}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-[#0A84FF]/12 blur-3xl" />
        {current ? (
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
            <CarShot />
            <div className="min-w-0">
              <p className={cn("text-[0.7rem] font-semibold uppercase tracking-wide", muted)}>Out now</p>
              <h3 className={cn("mt-1 text-[1.75rem] font-bold leading-tight tracking-tight", ink)}>
                {name(current)}
              </h3>
              <p className={cn("mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm", muted)}>
                <span>Back {dayTime(current.ends_at)}</span>
                {current.airport_code && (
                  <span className="inline-flex items-center gap-1"><Plane className="h-3.5 w-3.5" aria-hidden />{current.airport_code}</span>
                )}
                {current.pickup_city && <span>{current.pickup_city}</span>}
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {current.earnings != null && (
                  <span className={cn("text-sm font-semibold", ink)}>{money(current.earnings)}</span>
                )}
                {current.miles_unlimited
                  ? <Flag tone="ok" icon={Gauge}>Unlimited miles</Flag>
                  : current.miles_included != null
                    ? <Flag tone="warn" icon={Gauge}>{`${current.miles_included.toLocaleString()} mi cap`}</Flag>
                    : null}
              </p>
              {current.guest_url && (
                <a href={current.guest_url} target="_blank" rel="noopener noreferrer"
                  className={cn("mt-2.5 inline-flex items-center gap-1.5 text-xs underline-offset-2 hover:underline", muted)}>
                  Guest profile <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
            </div>
            <div className="shrink-0 lg:text-right">
              <p className={cn("text-[0.7rem] font-semibold uppercase tracking-wide", muted)}>
                {back?.past ? "Overdue by" : "Returns in"}
              </p>
              <p className={cn("text-[2.5rem] font-bold leading-none tracking-tight tabular-nums", back?.past ? "text-red-300 bento:text-red-700" : ink)}>
                {back?.text}
              </p>
              {back?.past && <div className="mt-2 lg:flex lg:justify-end"><Flag tone="bad" icon={AlertTriangle}>Past the return time</Flag></div>}
            </div>
          </div>
        ) : (
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
            <CarShot />
            <div>
              <p className={cn("text-[0.7rem] font-semibold uppercase tracking-wide", muted)}>Out now</p>
              <h3 className={cn("mt-1 text-[1.5rem] font-bold tracking-tight", ink)}>Nobody has the car</h3>
              <p className={cn("mt-1 text-sm", muted)}>
                {next ? `Next out ${dayTime(next.starts_at)}` : "Nothing booked."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── The row: next up, the car, where it is ──────────────── */}
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))]">
        <Tile label="Next up">
          {next ? (
            <>
              <p className={cn("text-lg font-semibold leading-tight", ink)}>{name(next)}</p>
              <p className={cn("mt-1 text-sm", muted)}>{dayTime(next.starts_at)}</p>
              <p className={cn("mt-0.5 text-xs", muted)}>
                in {until(next.starts_at, now).text}
                {next.earnings != null && <> &middot; <span className={ink}>{money(next.earnings)}</span></>}
              </p>
              {gap != null && (
                <p className="mt-3">
                  {gap < 3
                    ? <Flag tone="warn" icon={CalendarClock}>{`Only ${gap.toFixed(1)}h to turn around`}</Flag>
                    : <Flag tone="ok" icon={CalendarClock}>{`${Math.round(gap)}h to turn around`}</Flag>}
                </p>
              )}
              {upcoming.length > 1 && (
                <p className={cn("mt-2 text-xs", muted)}>+{upcoming.length - 1} more booked</p>
              )}
            </>
          ) : (
            <p className={cn("text-sm", muted)}>Nothing booked after this.</p>
          )}
        </Tile>

        <Tile label={vehicle?.display_name ?? "Vehicle"}>
          {vehicle ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-[2rem] font-bold leading-none tabular-nums", ink)}>{pct ?? "–"}%</span>
                {vehicle.range_real != null && (
                  <span className={cn("text-sm tabular-nums", muted)}>{Math.round(vehicle.range_real)} mi</span>
                )}
              </div>
              {/* A meter, not a chart: one value against its own full scale. */}
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-white/10 bento:bg-[#e6e4de]">
                <div
                  className={cn("h-full rounded-full transition-[width]", needsCharge ? "bg-amber-400" : "bg-emerald-400")}
                  style={{ width: `${Math.max(2, Math.min(100, pct ?? 0))}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {vehicle.plugged_in
                  ? <Flag tone="ok" icon={BatteryCharging}>{vehicle.charging_state ?? "Plugged in"}</Flag>
                  : needsCharge
                    ? <Flag tone="warn" icon={BatteryCharging}>{`Under ${READY_PCT}% for handoff`}</Flag>
                    : <Flag tone="ok" icon={CheckCircle2}>Ready to hand off</Flag>}
                {vehicle.locked === false
                  ? <Flag tone="bad" icon={Unlock}>Unlocked</Flag>
                  : <Flag tone="ok" icon={Lock}>Locked</Flag>}
                {hot && <Flag tone="warn" icon={Thermometer}>{`Cabin ${Math.round(vehicle.inside_temp!)}°`}</Flag>}
              </div>
              <p className={cn("mt-3 flex flex-wrap items-center gap-x-3 text-xs", muted)}>
                {vehicle.odometer != null && (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Gauge className="h-3.5 w-3.5" aria-hidden />{vehicle.odometer.toLocaleString()} mi
                  </span>
                )}
                {stale && (
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    last seen {age! >= 24 ? `${Math.round(age! / 24)}d` : `${Math.round(age!)}h`} ago
                  </span>
                )}
              </p>
            </>
          ) : (
            <p className={cn("text-sm", muted)}>No telemetry yet.</p>
          )}
        </Tile>

        <Tile label="Where it is">
          {vehicle?.latitude != null && vehicle.longitude != null ? (
            <>
              {(() => {
                const mi = milesFrom(vehicle.latitude!, vehicle.longitude!);
                return (
                  <>
                    <p className={cn("text-[2rem] font-bold leading-none tabular-nums", ink)}>
                      {mi < 1 ? "<1" : mi.toFixed(mi < 10 ? 1 : 0)}
                      <span className="ml-1 text-sm font-medium">mi away</span>
                    </p>
                    <p className={cn("mt-2 text-xs tabular-nums", muted)}>
                      {vehicle.latitude!.toFixed(4)}, {vehicle.longitude!.toFixed(4)}
                    </p>
                    <p className="mt-2.5">
                      {mi > 150
                        ? <Flag tone="warn" icon={MapPin}>Well outside the area</Flag>
                        : <Flag tone="ok" icon={MapPin}>In the area</Flag>}
                    </p>
                  </>
                );
              })()}
              <a
                href={`https://maps.apple.com/?ll=${vehicle.latitude},${vehicle.longitude}&q=${encodeURIComponent(vehicle.display_name ?? "Car")}`}
                target="_blank" rel="noopener noreferrer"
                className={cn("mt-3 inline-flex items-center gap-1.5 text-xs underline-offset-2 hover:underline", muted)}
              >
                Open in Maps <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </>
          ) : (
            <p className={cn("text-sm", muted)}>No location yet.</p>
          )}
        </Tile>
      </div>

      {/* ── Everything else booked ──────────────────────────────── */}
      {upcoming.length > 0 && (
        <div className={cn(card, "overflow-hidden")}>
          <p className={cn("flex items-baseline justify-between px-4 pt-4 text-[0.7rem] font-semibold uppercase tracking-wide", muted)}>
            <span>Booked</span>
            {(() => {
              // What is already committed, current trip included - the number he actually cares about.
              const total = [current, ...upcoming].reduce((n, t) => n + (t?.earnings ?? 0), 0);
              return total > 0 ? <span className={cn("tabular-nums", ink)}>{money(total)} booked</span> : null;
            })()}
          </p>
          <ul className="mt-1 divide-y divide-white/[0.06] bento:divide-[#e6e4de]">
            {upcoming.map((t) => (
              <li key={t.reservation_id} className="flex items-center gap-3 px-4 py-3">
                <Car className={cn("h-4 w-4 shrink-0", muted)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-medium", ink)}>{name(t)}</p>
                  <p className={cn("text-xs", muted)}>{dayTime(t.starts_at)} &rarr; {dayTime(t.ends_at)}</p>
                </div>
                <span className="shrink-0 text-right">
                  {t.earnings != null && <span className={cn("block text-sm font-medium tabular-nums", ink)}>{money(t.earnings)}</span>}
                  <span className={cn("block text-xs tabular-nums", muted)}>in {until(t.starts_at, now).text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
