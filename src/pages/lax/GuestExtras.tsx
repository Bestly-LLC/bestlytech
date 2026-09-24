/**
 * Personal bits of the Turo guest page (/lax/t/:token): trip times, Apple Weather at LAX,
 * the live car card (1 hour before pickup → end of trip) and the reminder-email opt-in.
 * Data comes from lax_guest_public (page) and weatherkit-proxy (Apple WeatherKit, public, cached).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Armchair, ArrowRight, BatteryMedium, Car, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSun, Fan, Flame, Loader2, Lock, LockOpen, Mail, Moon, Power, Snowflake, Sun, Thermometer, Wind, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const PEACH = "#FFB878";
const LA = "America/Los_Angeles";
export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: LA });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: LA });
const cToF = (c: number) => Math.round((c * 9) / 5 + 32);
const cond = (code: string) => code.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

export type Trip = { first: string | null; starts_at: string; ends_at: string; car_opens_at: string };
export type CarState = {
  battery: number | null; range: number | null; inside_f: number | null; outside_f: number | null;
  locked: boolean | null; charging: string | null; online: string | null; observed_at: string; name: string | null; climate_on?: boolean | null;
  climate_mode?: string | null; climate_until?: string | null;
};

function Card({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>{icon}{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

const dayPart = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: LA });
const timeParts = (iso: string) => {
  const t = fmtTime(iso); // "9:00 PM"
  const i = t.lastIndexOf(" ");
  return { hm: t.slice(0, i), ap: t.slice(i + 1) };
};
function span(ms: number) {
  const h = Math.round(ms / 3600000);
  if (h < 24) return `${h} hr`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}
function tripStatus(trip: Trip, now: number) {
  const s = +new Date(trip.starts_at), e = +new Date(trip.ends_at);
  const rel = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} hr` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? "" : "s"}`; };
  if (now < s) return { text: `Starts in ${rel(s - now)}`, live: false };
  if (now < e) return { text: `On trip · ${rel(e - now)} left`, live: true };
  return { text: "Trip ended", live: false };
}
function Stop({ label, iso, align }: { label: string; iso: string; align: "left" | "right" }) {
  const { hm, ap } = timeParts(iso);
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">{label}</p>
      <p className="mt-0.5 font-semibold leading-none text-white tabular-nums"><span className="text-[30px] tracking-tight">{hm}</span><span className="ml-1 text-[13px] text-white/70">{ap}</span></p>
      <p className="mt-1 text-[14px] text-white/75">{dayPart(iso)}</p>
    </div>
  );
}

/** Trip dates, laid out like a boarding pass in Apple Wallet: pickup → return, with the length of the trip between. */
export function TripCard({ trip }: { trip: Trip }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(t); }, []);
  const st = tripStatus(trip, now);
  return (
    <section aria-label="Your Turo trip" className="rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}><Car className="h-3.5 w-3.5" />Your Turo trip</p>
        <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${st.live ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-white/80"}`}>{st.text}</span>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Stop label="Pickup" iso={trip.starts_at} align="left" />
        <div className="flex flex-col items-center gap-1 px-1 text-white/55" aria-label={`Trip length ${span(+new Date(trip.ends_at) - +new Date(trip.starts_at))}`}>
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
            <span className="w-6 border-t border-dashed border-white/35" />
            <ArrowRight className="h-4 w-4" style={{ color: PEACH }} aria-hidden />
          </div>
          <span className="text-[12px] font-medium tabular-nums">{span(+new Date(trip.ends_at) - +new Date(trip.starts_at))}</span>
        </div>
        <Stop label="Return" iso={trip.ends_at} align="right" />
      </div>
    </section>
  );
}

// ---------- Comfort: what to suggest, based on the car's inside temp (target ~72°F) ----------
export type Need = "cool" | "warm" | "comfy" | null;
export function climateNeed(inside?: number | null, outside?: number | null): Need {
  if (inside != null) {
    if (inside >= 77 || (outside != null && outside >= 85 && inside >= 74)) return "cool";
    if (inside <= 65 || (outside != null && outside <= 55 && inside <= 68)) return "warm";
    return "comfy";
  }
  if (outside == null) return null;
  if (outside >= 80) return "cool";
  if (outside <= 60) return "warm";
  return "comfy";
}
const seatNeeded = (inside?: number | null, outside?: number | null) => (inside ?? outside ?? 99) <= 60;

/** One line above the weather + car tiles: what to do before heading over. */
export function ClimateAdvice({ car, outsideF }: { car: CarState | null; outsideF: number | null }) {
  const inside = car?.inside_f ?? null;
  const outside = car?.outside_f ?? outsideF;
  if (car?.climate_until && +new Date(car.climate_until) > Date.now()) {
    return <p className="flex items-center gap-2 text-[15px] font-medium text-white/90"><Fan className="h-4 w-4 shrink-0 animate-spin text-sky-300 motion-reduce:animate-none" aria-hidden />Climate is on. The car will be comfy when you get there.</p>;
  }
  const need = climateNeed(inside, outside);
  if (!need) return null;
  const t = Math.round((inside ?? outside)!);
  const where = inside != null ? "in the car" : "outside";
  const [Icon, color, text] =
    need === "cool" ? [Snowflake, "text-sky-300", `It's ${t}° ${where}. Turn on the A/C before you head over.`] :
    need === "warm" ? [Flame, "text-orange-300", `It's chilly: ${t}° ${where}. Warm it up before you head over.`] :
    [Thermometer, "text-emerald-300", `The car's a comfortable ${t}°. No need for the A/C.`];
  return <p className="flex items-start gap-2 text-[15px] font-medium leading-snug text-white/90"><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden />{text}</p>;
}

type Hour = { forecastStart: string; temperature: number; conditionCode: string; precipitationChance: number; daylight?: boolean };
type Day = { forecastStart: string; temperatureMax: number; temperatureMin: number; conditionCode: string; precipitationChance: number };
type Wx = {
  currentWeather?: { temperature: number; conditionCode: string; daylight?: boolean; temperatureApparent?: number };
  forecastHourly?: { hours: Hour[] }; forecastDaily?: { days: Day[] };
};

function nearestHour(hours: Hour[], at: string) {
  const t = new Date(at).getTime();
  const h = hours.reduce<Hour | null>((b, x) => (!b || Math.abs(+new Date(x.forecastStart) - t) < Math.abs(+new Date(b.forecastStart) - t) ? x : b), null);
  return h && Math.abs(+new Date(h.forecastStart) - t) <= 2 * 3600 * 1000 ? h : null;
}
function dayOf(days: Day[], at: string) {
  const key = new Date(at).toLocaleDateString("en-US", { timeZone: LA });
  return days.find((d) => new Date(new Date(d.forecastStart).getTime() + 12 * 3600 * 1000).toLocaleDateString("en-US", { timeZone: LA }) === key) ?? null;
}

// Apple Weather look: sky gradient follows the condition and day/night.
function sky(code: string, day: boolean) {
  const c = code.toLowerCase();
  if (/rain|drizzle|shower|thunder|storm/.test(c)) return day ? "from-[#4b5d73] to-[#27313f]" : "from-[#232b38] to-[#11151c]";
  if (/fog|haze|smok|dust/.test(c)) return day ? "from-[#8a97a6] to-[#5b6674]" : "from-[#343a44] to-[#1a1d23]";
  if (/cloud|overcast/.test(c)) return day ? "from-[#5f7fa3] to-[#34506f]" : "from-[#26324a] to-[#121826]";
  return day ? "from-[#3a8ee6] to-[#1f5fb0]" : "from-[#1b2a55] to-[#0b1330]";
}
function WxIcon({ code, day, className }: { code: string; day: boolean; className?: string }) {
  const c = code.toLowerCase();
  const p = { className, strokeWidth: 1.75, "aria-hidden": true } as const;
  if (/thunder|storm/.test(c)) return <CloudLightning {...p} />;
  if (/drizzle/.test(c)) return <CloudDrizzle {...p} />;
  if (/rain|shower/.test(c)) return <CloudRain {...p} />;
  if (/fog|haze|smok|dust/.test(c)) return <CloudFog {...p} />;
  if (/wind|breez/.test(c)) return <Wind {...p} />;
  if (/partly|mostlyclear/.test(c)) return day ? <CloudSun {...p} /> : <CloudMoon {...p} />;
  if (/cloud|overcast/.test(c)) return <Cloud {...p} />;
  return day ? <Sun {...p} /> : <Moon {...p} />;
}
const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", hour12: true, timeZone: LA }).replace(" ", "");
const sameHour = (a: string, b: string) => Math.abs(+new Date(a) - +new Date(b)) < 30 * 60 * 1000;
const rainPct = (p: number) => (p >= 0.3 ? `${Math.round(p * 10) * 10}%` : null);

/** Apple Weather at LAX, laid out like the Weather app: big temp, hourly strip with the pickup hour marked, then pickup/return rows. */
export function WeatherCard({ trip, compact = false, onNow }: { trip: Trip | null; compact?: boolean; onNow?: (f: number) => void }) {
  const [wx, setWx] = useState<Wx | null | "loading">("loading");
  useEffect(() => {
    supabase.functions.invoke("weatherkit-proxy", { body: { lat: 33.947, lon: -118.3816, dataSets: "currentWeather,forecastHourly,forecastDaily" } })
      .then(({ data }) => { setWx((data as Wx) ?? null); const c = (data as Wx | null)?.currentWeather?.temperature; if (c != null) onNow?.(cToF(c)); }).catch(() => setWx(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (wx === "loading") return <div className={`${compact ? "h-full min-h-[220px]" : "h-[260px]"} animate-pulse rounded-3xl bg-white/[0.06] motion-reduce:animate-none`} aria-label="Loading weather" />;
  if (!wx?.currentWeather) return null;

  const now = wx.currentWeather;
  const day = now.daylight ?? true;
  const today = wx.forecastDaily?.days?.[0];
  const pickup = trip && new Date(trip.starts_at) > new Date() ? trip.starts_at : null;
  const ret = trip && new Date(trip.ends_at) > new Date() ? trip.ends_at : null;

  // Hourly strip: 12 hours from now, or shifted so a later pickup hour is in view.
  const hours = (wx.forecastHourly?.hours ?? []).filter((h) => +new Date(h.forecastStart) > Date.now() - 3600 * 1000);
  const pIdx = pickup ? hours.findIndex((h) => sameHour(h.forecastStart, pickup)) : -1;
  const start = pIdx > 6 ? pIdx - 3 : 0;
  const strip = hours.slice(start, start + 12);

  const rows: { label: string; when: string; code: string; day: boolean; temp: string; rain: string | null }[] = [];
  const addRow = (label: string, iso: string) => {
    const h = wx.forecastHourly ? nearestHour(wx.forecastHourly.hours, iso) : null;
    if (h) { rows.push({ label, when: fmtWhen(iso), code: h.conditionCode, day: h.daylight ?? true, temp: `${cToF(h.temperature)}°`, rain: rainPct(h.precipitationChance) }); return; }
    const d = wx.forecastDaily ? dayOf(wx.forecastDaily.days, iso) : null;
    if (d) rows.push({ label, when: fmtWhen(iso), code: d.conditionCode, day: true, temp: `${cToF(d.temperatureMax)}° / ${cToF(d.temperatureMin)}°`, rain: rainPct(d.precipitationChance) });
  };
  if (pickup) addRow("Pickup", pickup);
  if (ret) addRow("Return", ret);

  if (compact) {
    const atPickup = rows.find((r) => r.label === "Pickup");
    return (
      <section aria-label="Weather at LAX" className={`flex h-full flex-col rounded-3xl bg-gradient-to-b ${sky(now.conditionCode, day)} p-4 text-white shadow-lg shadow-black/20`}>
        <p className="flex items-center justify-between text-[13px] font-medium"><span>LAX now</span><WxIcon code={now.conditionCode} day={day} className="h-5 w-5" /></p>
        <p className="mt-1 text-[48px] font-extralight leading-none tracking-tight tabular-nums">{cToF(now.temperature)}°</p>
        <p className="mt-1 text-[14px] font-medium capitalize text-white/90">{cond(now.conditionCode)}</p>
        {today && <p className="text-[13px] text-white/75 tabular-nums">H:{cToF(today.temperatureMax)}°&nbsp; L:{cToF(today.temperatureMin)}°</p>}
        {atPickup && (
          <div className="mt-auto rounded-2xl bg-black/15 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/65">At pickup</p>
            <p className="flex items-center gap-1.5 text-[17px] font-semibold tabular-nums"><WxIcon code={atPickup.code} day={atPickup.day} className="h-4 w-4" />{atPickup.temp}</p>
            {atPickup.rain && <p className="text-[12px] font-semibold text-sky-200">{atPickup.rain} rain</p>}
          </div>
        )}
        {/* Next few hours: the rest of the tile, so it matches the car tile's height. */}
        <ol className={`${atPickup ? "mt-2" : "mt-auto"} grid gap-1 rounded-2xl bg-black/15 px-3 py-2`} aria-label="Next hours">
          {hours.slice(1, 5).map((h) => (
            <li key={h.forecastStart} className="flex items-center justify-between text-[13px] tabular-nums">
              <span className="w-10 text-white/75">{hourLabel(h.forecastStart)}</span>
              <WxIcon code={h.conditionCode} day={h.daylight ?? true} className="h-4 w-4" />
              <span className="w-9 text-right font-semibold">{cToF(h.temperature)}°</span>
            </li>
          ))}
        </ol>
        <a href="https://weatherkit.apple.com/legal-attribution.html" target="_blank" rel="noreferrer" className="mt-2 text-[10px] text-white/55">Apple Weather</a>
      </section>
    );
  }

  return (
    <section aria-label="Weather at LAX" className={`overflow-hidden rounded-3xl bg-gradient-to-b ${sky(now.conditionCode, day)} text-white shadow-lg shadow-black/20`}>
      <div className="px-5 pb-4 pt-5 text-center">
        <p className="text-[15px] font-medium">LAX</p>
        <p className="mt-0.5 text-[64px] font-extralight leading-none tracking-tight tabular-nums">{cToF(now.temperature)}°</p>
        <p className="mt-1 text-[17px] font-medium capitalize text-white/90">{cond(now.conditionCode)}</p>
        {today && <p className="text-[15px] text-white/80 tabular-nums">H:{cToF(today.temperatureMax)}°&nbsp;&nbsp;L:{cToF(today.temperatureMin)}°</p>}
      </div>

      {strip.length > 0 && (
        <div className="mx-3 mb-3 rounded-2xl bg-black/15 backdrop-blur-sm">
          <p className="border-b border-white/10 px-3 py-2 text-[12px] uppercase tracking-wide text-white/60">
            {pickup && pIdx >= 0 ? `Hourly · pickup at ${fmtTime(pickup)}` : "Hourly forecast"}
          </p>
          <ol className="flex snap-x gap-1 overflow-x-auto px-2 py-3 [scrollbar-width:none]" aria-label="Hourly forecast">
            {strip.map((h, i) => {
              const isPickup = pickup ? sameHour(h.forecastStart, pickup) : false;
              const label = i === 0 && start === 0 ? "Now" : hourLabel(h.forecastStart);
              const r = rainPct(h.precipitationChance);
              return (
                <li key={h.forecastStart}
                  className={`flex min-w-[52px] snap-start flex-col items-center gap-1.5 rounded-xl px-1.5 py-1.5 ${isPickup ? "bg-white/20 ring-1 ring-[#FFB878]/70" : ""}`}
                  aria-label={`${isPickup ? "Pickup, " : ""}${label}: ${cToF(h.temperature)} degrees, ${cond(h.conditionCode)}${r ? `, ${r} chance of rain` : ""}`}>
                  <span className={`text-[13px] font-medium ${isPickup ? "text-[#FFB878]" : "text-white/90"}`}>{isPickup ? "Pickup" : label}</span>
                  <WxIcon code={h.conditionCode} day={h.daylight ?? true} className="h-6 w-6" />
                  <span className="h-3 text-[11px] font-semibold text-sky-200">{r ?? ""}</span>
                  <span className="text-[17px] font-medium tabular-nums">{cToF(h.temperature)}°</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="mx-3 mb-3 divide-y divide-white/10 rounded-2xl bg-black/15 backdrop-blur-sm">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-3 px-3.5 py-3">
              <WxIcon code={r.code} day={r.day} className="h-6 w-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{r.label}</p>
                <p className="text-[13px] text-white/70">{r.when}</p>
              </div>
              <div className="text-right">
                <p className="text-[17px] font-medium tabular-nums">{r.temp}</p>
                {r.rain && <p className="text-[12px] font-semibold text-sky-200">{r.rain} rain</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <a href="https://weatherkit.apple.com/legal-attribution.html" target="_blank" rel="noreferrer"
        className="block pb-3 text-center text-[11px] text-white/55 hover:text-white/80">Apple Weather · Data sources</a>
    </section>
  );
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} days ago`;
};

/** Live car: shown from 1 hour before pickup until the trip ends. */
export const DEMO_CAR: CarState = {
  battery: 82, range: 248, inside_f: 97, outside_f: 84, locked: true, charging: "Disconnected",
  online: "online", observed_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), name: "Tesla Model 3",
};

export type ClimateAction = "cool" | "warm" | "seat" | "off";
const CLIMATE: { id: ClimateAction; label: string; sub: string; icon: typeof Snowflake }[] = [
  { id: "cool", label: "Cool it down", sub: "A/C to 68°F", icon: Snowflake },
  { id: "warm", label: "Warm it up", sub: "Heat to 74°F", icon: Flame },
  { id: "seat", label: "Heated seat", sub: "Driver seat, high", icon: Armchair },
  { id: "off", label: "Turn off", sub: "Stop climate", icon: Power },
];
const CLIMATE_MINUTES = 20;
const MODE_TEXT: Record<string, string> = { cool: "Cooling to 68°", warm: "Heating to 74°", seat: "Seat heat + climate" };

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Climate panel. On: fan spins + countdown. Turning off: fan slows. Off: fan winds down to a stop and the timer freezes. */
function ClimateOn({ mode, until, onOff, busy, stoppedAt, auto }: { mode: string; until: string; onOff: () => void; busy: boolean; stoppedAt?: number | null; auto?: boolean }) {
  const off = stoppedAt != null;
  const now = useNow(!off);
  const left = Math.max(0, +new Date(until) - (off ? stoppedAt! : now));
  const frac = Math.min(1, Math.max(0, left / (CLIMATE_MINUTES * 60000)));
  const cool = mode === "cool";
  const tint = off ? "text-white/45" : cool ? "text-sky-300" : "text-orange-300";
  const fanAnim = off ? "lax-fan-stop" : busy ? "animate-[spin_2.6s_linear_infinite]" : "animate-[spin_1.1s_linear_infinite]";
  return (
    <div role="status" aria-live="polite"
      className={`overflow-hidden rounded-2xl p-3 ring-1 transition-colors duration-700 ${off ? "bg-white/[0.05] ring-white/10" : cool ? "bg-sky-400/10 ring-sky-300/30" : "bg-orange-400/10 ring-orange-300/30"}`}>
      <style>{`@keyframes lax-fan-stop { from { transform: rotate(0deg) } to { transform: rotate(420deg) } }
        .lax-fan-stop { animation: lax-fan-stop 1.8s cubic-bezier(.12,.62,.25,1) forwards }
        @media (prefers-reduced-motion: reduce) { .lax-fan-stop { animation: none } }`}</style>
      <div className="flex items-center gap-2">
        <Fan className={`h-6 w-6 shrink-0 motion-reduce:animate-none ${fanAnim} ${tint} transition-colors duration-700`} aria-hidden />
        <p className={`whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.1em] transition-colors duration-700 ${off ? "text-white/60" : cool ? "text-sky-200" : "text-orange-200"}`}>
          {off ? (auto ? "Auto-off" : "Climate off") : busy ? "Turning off…" : "Climate on"}
        </p>
      </div>
      <p className={`mt-2 text-[34px] font-semibold leading-none tracking-tight tabular-nums transition-colors duration-700 ${off ? "text-white/35" : "text-white"}`} aria-label={off ? "Stopped" : `${mmss(left)} left`}>{mmss(left)}</p>
      <p className={`mt-1 text-[13px] font-medium ${off ? "text-white/55" : "text-white/80"}`}>{off ? (auto ? `Ran the full ${CLIMATE_MINUTES} minutes` : "Stopped") : MODE_TEXT[mode] ?? "Running"}</p>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full w-full origin-left rounded-full ${off ? "bg-white/30" : cool ? "bg-sky-300 transition-transform duration-1000 ease-linear" : "bg-orange-300 transition-transform duration-1000 ease-linear"}`} style={{ transform: `scaleX(${frac})` }} />
      </div>
      {off ? (
        <p className="mt-2 text-[12px] leading-snug text-white/60">The cabin stays comfy for a while. Turn it back on anytime.</p>
      ) : (
        <>
          <p className="mt-1.5 text-[11px] leading-snug text-white/55">Turns off by itself at {fmtTime(until)}</p>
          <button type="button" onClick={onOff} disabled={busy}
            className="mt-2.5 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-white/10 text-[14px] font-semibold text-white ring-1 ring-white/15 active:scale-[0.98] disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" style={{ color: PEACH }} />} {busy ? "Turning off" : "Turn off"}
          </button>
        </>
      )}
    </div>
  );
}

/** Climate buttons. Only the ones that make sense for the temperature right now (72° is the goal); "More" shows the rest. */
function ClimateControls({ demo, onAction, compact = false, lockedUntil, car }: { demo: boolean; onAction?: (a: ClimateAction, onStage?: (s: string) => void) => Promise<void>; compact?: boolean; lockedUntil?: string | null; car?: CarState | null }) {
  const [busy, setBusy] = useState<ClimateAction | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const [all, setAll] = useState(false);
  // Demo: pretend the car turned on, so the countdown can be previewed.
  const [demoOn, setDemoOn] = useState<{ mode: string; until: string } | null>(null);
  useEffect(() => {
    if (!busy) return;
    setSecs(0);
    const t = window.setInterval(() => setSecs((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [busy]);
  const now = useNow(true);
  const session = demoOn ?? (car?.climate_until && car.climate_mode ? { mode: car.climate_mode, until: car.climate_until } : null);
  const running = session && +new Date(session.until) > now ? session : null;
  // After "off" (or the 20-minute auto-off), keep the panel up for a few seconds: fan winds down, timer freezes.
  const [stopped, setStopped] = useState<{ mode: string; until: string; at: number; auto: boolean } | null>(null);
  const lastSession = useRef<{ mode: string; until: string } | null>(null);
  if (running) lastSession.current = running;
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    const s = lastSession.current;
    if (!stopped && s && !running && +new Date(s.until) <= now && shownFor.current !== s.until) {
      shownFor.current = s.until;
      setStopped({ ...s, at: +new Date(s.until), auto: true });
      setDemoOn(null);
    }
  }, [now, running, stopped]);
  useEffect(() => {
    if (!stopped) return;
    const t = window.setTimeout(() => setStopped(null), stopped.auto ? 9000 : 6000);
    return () => window.clearTimeout(t);
  }, [stopped]);

  const press = async (id: ClimateAction) => {
    const a = CLIMATE.find((x) => x.id === id)!;
    const was = running;
    setBusy(id); setDone(null); setStage("Sending your request");
    try {
      if (demo || !onAction) {
        await new Promise((r) => setTimeout(r, 900));
        setDemoOn(id === "off" ? null : { mode: id, until: new Date(Date.now() + CLIMATE_MINUTES * 60000).toISOString() });
      } else await onAction(id, setStage);
      if (id === "off" && was) { shownFor.current = was.until; setStopped({ ...was, at: Date.now(), auto: false }); lastSession.current = null; }
      setDone(id === "off" ? "Climate is off." : `${a.label}: on for ${CLIMATE_MINUTES} minutes.`);
    } catch (e) {
      setDone(`Couldn't reach the car. ${(e as Error).message ?? ""}`.trim());
    } finally { setBusy(null); setStage(null); }
  };

  const inside = car?.inside_f ?? null, outside = car?.outside_f ?? null;
  const need = climateNeed(inside, outside);
  const suggested: ClimateAction[] =
    need === "cool" ? ["cool"] :
    need === "warm" ? (seatNeeded(inside, outside) ? ["warm", "seat"] : ["warm"]) :
    need === "comfy" ? [] : ["cool", "warm"];
  const shown: ClimateAction[] = all ? ["cool", "warm", "seat"] : suggested;
  const locked = !!lockedUntil;

  return (
    <div className={compact ? "mt-3" : "mt-4 border-t border-white/10 pt-4"}>
      {!compact && <p className="text-[13px] font-semibold text-white">Get the car comfortable before you arrive</p>}
      {stopped ? (
        <ClimateOn mode={stopped.mode} until={stopped.until} busy={false} onOff={() => {}} stoppedAt={stopped.at} auto={stopped.auto} />
      ) : running && !locked ? (
        <ClimateOn mode={running.mode} until={running.until} busy={busy === "off"} onOff={() => press("off")} />
      ) : (
        <>
          {need === "comfy" && !all && (
            <p className="rounded-xl bg-emerald-400/10 px-3 py-2 text-[13px] leading-snug text-emerald-200 ring-1 ring-emerald-300/25">Already comfortable inside. No A/C needed.</p>
          )}
          <div className={compact ? "grid gap-1.5" : "mt-2.5 grid grid-cols-2 gap-2"}>
            {shown.map((id, i) => {
              const a = CLIMATE.find((x) => x.id === id)!;
              const Icon = a.icon;
              const primary = i === 0 && !all && need !== "comfy";
              return (
                <button key={id} type="button" onClick={() => press(id)} disabled={busy !== null || locked} aria-disabled={locked}
                  className={`flex items-center gap-2.5 rounded-xl text-left ring-1 transition active:scale-[0.98] disabled:opacity-40 disabled:saturate-0 ${primary ? (id === "cool" ? "bg-sky-400/20 ring-sky-300/40" : "bg-orange-400/20 ring-orange-300/40") : "bg-white/[0.08] ring-white/10"} ${compact ? "min-h-[48px] px-2.5 py-1.5" : "min-h-[56px] px-3 py-2.5"}`}>
                  {busy === id ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" style={{ color: PEACH }} /> : <Icon className="h-5 w-5 shrink-0" style={{ color: id === "cool" ? "#7dd3fc" : PEACH }} />}
                  <span><span className="block text-[14px] font-semibold leading-tight text-white">{a.label}</span><span className="block text-[11px] text-white/55">{a.sub}</span></span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setAll((x) => !x)} className="mt-1.5 min-h-[32px] text-[12px] font-medium text-white/55 underline decoration-white/25 underline-offset-2">
            {all ? "Show fewer" : need === "comfy" ? "Show A/C controls" : "More controls"}
          </button>
        </>
      )}
      <p className={`mt-1 min-h-[1.25rem] text-[12px] leading-snug ${busy ? "text-white/75" : done?.startsWith("Couldn't") ? "text-red-300" : "text-emerald-300"}`} aria-live="polite">
        {busy ? <>{stage ?? "Working"}… <span className="tabular-nums text-white/45">{secs}s</span>{stage === "Waking up the car" && <span className="block text-white/45">Can take up to a minute.</span>}</> : done}
      </p>
      <p className="text-[11px] leading-snug text-white/55">
        {demo ? "Preview only. Not connected to the car yet."
          : lockedUntil === "pending" ? "Turns on when your Tesla phone key is connected, or 1 hour before pickup."
          : lockedUntil ? <>Turns on <b className="text-white/80">{fmtWhen(lockedUntil)}</b>, or as soon as your phone key is connected.</>
          : `Runs ${CLIMATE_MINUTES} minutes, then turns off by itself.`}
      </p>
    </div>
  );
}

export function CarCard({ trip, car, demo = false, onClimate, compact = false, lockedUntil }: { trip: Trip | null; car: CarState | null; demo?: boolean; onClimate?: (a: ClimateAction, onStage?: (s: string) => void) => Promise<void>; compact?: boolean; lockedUntil?: string | null }) {
  if (compact) {
    const asleep = car?.online === "asleep" || car?.online === "offline";
    return (
      <div className="flex h-full flex-col rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}><Zap className="h-3.5 w-3.5" />Your car</p>
        {car ? (
          <>
            <div className="mt-1 flex items-center justify-between gap-1">
              {car.inside_f != null ? (
                <p className="flex flex-col text-[12px] leading-tight text-white/70">Inside <b className="mt-0.5 text-[28px] font-semibold leading-none text-white tabular-nums">{Math.round(car.inside_f)}°</b></p>
              ) : <span />}
              <img src="/wallet/lax/car-cutout.webp" alt="Your Tesla Model 3" width={300} height={206} loading="lazy" decoding="async"
                className="-mr-1 h-auto w-[76px] shrink-0 drop-shadow-[0_6px_10px_rgba(0,0,0,0.45)]" />
            </div>
            {car.battery != null && (
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-white/80"><BatteryMedium className="h-4 w-4 shrink-0 text-emerald-300" /><b className="text-white">{car.battery}%</b>{car.range != null && <span className="whitespace-nowrap">· {Math.round(car.range)} mi</span>}</p>
            )}
            <p className="mt-1 text-[11px] text-white/45">{asleep ? "Parked · " : ""}Updated {ago(car.observed_at)}</p>
          </>
        ) : (
          <p className="mt-1.5 text-[13px] leading-snug text-white/70">{onClimate ? "Parked and asleep. Tap a button and it wakes up." : "Car info isn't available right now."}</p>
        )}
        {(demo || onClimate || lockedUntil) ? (
          <ClimateControls demo={demo} onAction={onClimate} compact lockedUntil={lockedUntil} car={car} />
        ) : null}
      </div>
    );
  }
  if (!car || !trip) {
    if (trip && new Date(trip.car_opens_at) > new Date()) {
      return (
        <Card label="Your car" icon={<Zap className="h-3.5 w-3.5" />}>
          <p className="text-[14px] text-white/75">Live battery, cabin temperature and A/C controls show up here at <b className="text-white">{fmtWhen(trip.car_opens_at)}</b>, an hour before pickup.</p>
        </Card>
      );
    }
    return null;
  }
  return (
    <Card label={car.name ? `Your car · ${car.name}` : "Your car"} icon={<Zap className="h-3.5 w-3.5" />}>
      <img src="/wallet/lax/car-cutout.webp" alt="Your Tesla Model 3" width={300} height={206} loading="lazy" decoding="async"
        className="float-right -mt-2 ml-2 h-auto w-[110px] drop-shadow-[0_6px_10px_rgba(0,0,0,0.45)]" />
      <div className="grid grid-cols-2 gap-3 text-[15px]">
        {car.battery != null && <p className="flex items-center gap-2 text-white"><BatteryMedium className="h-4 w-4 text-emerald-300" /><b>{car.battery}%</b>{car.range != null && <span className="text-white/60">· {Math.round(car.range)} mi</span>}</p>}
        {car.inside_f != null && <p className="flex items-center gap-2 text-white"><Thermometer className="h-4 w-4" style={{ color: PEACH }} />Inside <b>{Math.round(car.inside_f)}°F</b></p>}
        {car.outside_f != null && <p className="flex items-center gap-2 text-white/80"><Thermometer className="h-4 w-4 text-white/40" />Outside {Math.round(car.outside_f)}°F</p>}
        {car.locked != null && <p className="flex items-center gap-2 text-white/80">{car.locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}{car.locked ? "Locked" : "Unlocked"}</p>}
      </div>
      <p className="mt-2 text-[12px] text-white/45">Updated {ago(car.observed_at)}{car.charging && car.charging !== "Disconnected" ? ` · ${car.charging.toLowerCase()}` : ""}</p>
      {(demo || onClimate) && <ClimateControls demo={demo} onAction={onClimate} car={car} />}
    </Card>
  );
}

/** Guest opts in to the pickup-day email (sent from support@bestly.tech). */
export function EmailCard({ token, email, reminderAt, sentAt }: { token: string; email: string | null; reminderAt: string | null; sentAt: string | null }) {
  const [shown, setShown] = useState<{ email: string | null; at: string | null }>({ email, at: reminderAt });
  const [editing, setEditing] = useState(!email);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await rpc("lax_guest_set_email", { p_token: token, p_email: value });
    setBusy(false);
    if (error) { setErr(error.message.replace(/^.*?: /, "")); return; }
    const d = data as { email: string; reminder_at: string | null };
    setShown({ email: d.email, at: d.reminder_at }); setEditing(false); setValue("");
  };
  return (
    <Card label="Reminder email" icon={<Mail className="h-3.5 w-3.5" />}>
      {!editing && shown.email ? (
        <div className="text-[14px] text-white/80">
          {sentAt ? <>Sent to <b className="text-white">{shown.email}</b>.</> : shown.at
            ? <>We'll email <b className="text-white">{shown.email}</b> {new Date(shown.at) <= new Date(Date.now() + 5 * 60000) ? "in a few minutes" : <>on {fmtWhen(shown.at)}</>} with your QR code and steps.</>
            : <>Saved: <b className="text-white">{shown.email}</b>.</>}
          <button type="button" onClick={() => setEditing(true)} className="ml-2 text-[13px] underline decoration-white/40 underline-offset-2">Change</button>
        </div>
      ) : (
        <div>
          <p className="text-[14px] text-white/75">Get this page's QR code and steps by email on pickup day.</p>
          <div className="mt-3 flex gap-2">
            <input type="email" inputMode="email" autoComplete="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="you@email.com"
              className="h-11 min-w-0 flex-1 rounded-xl bg-white px-3 text-[16px] text-[#1A1140] placeholder:text-[#1A1140]/40" />
            <button type="button" onClick={save} disabled={busy || !value.includes("@")}
              className="h-11 shrink-0 rounded-xl px-4 text-[15px] font-semibold text-[#1A1140] disabled:opacity-50" style={{ background: PEACH }}>
              {busy ? "Saving…" : "Email me"}
            </button>
          </div>
          {err && <p className="mt-2 text-[13px] text-[#FF8FA8]">{err}</p>}
          <p className="mt-2 text-[11px] text-white/40">Only used for this trip's reminder. Never shared.</p>
        </div>
      )}
    </Card>
  );
}
