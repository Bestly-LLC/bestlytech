/**
 * Personal bits of the Turo guest page (/lax/t/:token): trip times, Apple Weather at LAX,
 * the live car card (1 hour before pickup → end of trip) and the reminder-email opt-in.
 * Data comes from lax_guest_public (page) and weatherkit-proxy (Apple WeatherKit, public, cached).
 */
import { useEffect, useState, type ReactNode } from "react";
import { Armchair, BatteryMedium, Car, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSun, Flame, Loader2, Lock, LockOpen, Mail, Moon, Power, Snowflake, Sun, Thermometer, Wind, Zap } from "lucide-react";
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
};

function Card({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>{icon}{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function TripCard({ trip }: { trip: Trip }) {
  return (
    <Card label="Your Turo trip" icon={<Car className="h-3.5 w-3.5" />}>
      <img src="/wallet/lax/car.jpg" alt="Your Tesla Model 3" className="mb-3 aspect-[16/10] w-full rounded-xl object-cover" />
      <div className="grid grid-cols-2 gap-3 text-[15px]">
        <div><p className="text-xs text-white/55">Pickup</p><p className="font-semibold text-white">{fmtWhen(trip.starts_at)}</p></div>
        <div><p className="text-xs text-white/55">Return</p><p className="font-semibold text-white">{fmtWhen(trip.ends_at)}</p></div>
      </div>
    </Card>
  );
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
export function WeatherCard({ trip, compact = false }: { trip: Trip | null; compact?: boolean }) {
  const [wx, setWx] = useState<Wx | null | "loading">("loading");
  useEffect(() => {
    supabase.functions.invoke("weatherkit-proxy", { body: { lat: 33.947, lon: -118.3816, dataSets: "currentWeather,forecastHourly,forecastDaily" } })
      .then(({ data }) => setWx((data as Wx) ?? null)).catch(() => setWx(null));
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

/** Climate buttons. Live mode is wired once Tesla access is connected; demo mode only shows what would happen. */
function ClimateControls({ demo, onAction, compact = false, lockedUntil }: { demo: boolean; onAction?: (a: ClimateAction) => Promise<void>; compact?: boolean; lockedUntil?: string | null }) {
  const [busy, setBusy] = useState<ClimateAction | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const press = async (a: (typeof CLIMATE)[number]) => {
    setBusy(a.id); setDone(null);
    try {
      if (demo || !onAction) await new Promise((r) => setTimeout(r, 900));
      else await onAction(a.id);
      setDone(a.id === "off" ? "Climate is off." : `${a.label}: on. Give it about 10 minutes.`);
    } catch (e) {
      setDone(`Couldn't reach the car. ${(e as Error).message ?? ""}`.trim());
    } finally { setBusy(null); }
  };
  return (
    <div className={compact ? "mt-3" : "mt-4 border-t border-white/10 pt-4"}>
      {!compact && <p className="text-[13px] font-semibold text-white">Get the car comfortable before you arrive</p>}
      <div className={compact ? "grid gap-1.5" : "mt-2.5 grid grid-cols-2 gap-2"}>
        {CLIMATE.map((a) => {
          const Icon = a.icon;
          return (
            <button key={a.id} type="button" onClick={() => press(a)} disabled={busy !== null || !!lockedUntil} aria-disabled={!!lockedUntil}
              className={`flex items-center gap-2.5 rounded-xl bg-white/[0.08] text-left ring-1 ring-white/10 transition active:scale-[0.98] disabled:opacity-40 disabled:saturate-0 ${compact ? "min-h-[44px] px-2.5 py-1.5" : "min-h-[56px] px-3 py-2.5"}`}>
              {busy === a.id ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" style={{ color: PEACH }} /> : <Icon className="h-5 w-5 shrink-0" style={{ color: PEACH }} />}
              <span><span className="block text-[14px] font-semibold leading-tight text-white">{a.label}</span>{!compact && <span className="block text-[12px] text-white/55">{a.sub}</span>}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 min-h-[1.25rem] text-[12px] leading-snug text-emerald-300" aria-live="polite">{done}</p>
      <p className="text-[11px] leading-snug text-white/55">
        {demo ? "Preview only. Not connected to the car yet."
          : lockedUntil === "pending" ? "Turns on when your Tesla phone key is connected, or 1 hour before pickup."
          : lockedUntil ? <>Turns on <b className="text-white/80">{fmtWhen(lockedUntil)}</b>, or as soon as your phone key is connected.</>
          : "Works until your trip ends."}
      </p>
    </div>
  );
}

export function CarCard({ trip, car, demo = false, onClimate, compact = false, lockedUntil }: { trip: Trip | null; car: CarState | null; demo?: boolean; onClimate?: (a: ClimateAction) => Promise<void>; compact?: boolean; lockedUntil?: string | null }) {
  if (compact) {
    const asleep = car?.online === "asleep" || car?.online === "offline";
    return (
      <div className="flex h-full flex-col rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}><Zap className="h-3.5 w-3.5" />Your car</p>
        {car ? (
          <>
            {car.inside_f != null && (
              <p className="mt-1.5 flex items-baseline gap-1.5 text-[13px] text-white/70">Inside <b className="text-[28px] font-semibold leading-none text-white tabular-nums">{Math.round(car.inside_f)}°</b></p>
            )}
            {car.battery != null && (
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-white/80"><BatteryMedium className="h-4 w-4 shrink-0 text-emerald-300" /><b className="text-white">{car.battery}%</b>{car.range != null && <span className="whitespace-nowrap">· {Math.round(car.range)} mi</span>}</p>
            )}
            {car.climate_on && <p className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-sky-200"><Snowflake className="h-3.5 w-3.5" />Climate is on</p>}
            <p className="mt-1 text-[11px] text-white/45">{asleep ? "Parked · " : ""}Updated {ago(car.observed_at)}</p>
          </>
        ) : (
          <p className="mt-1.5 text-[13px] leading-snug text-white/70">{onClimate ? "Parked and asleep. Tap a button and it wakes up." : "Car info isn't available right now."}</p>
        )}
        {(demo || onClimate || lockedUntil) ? (
          <ClimateControls demo={demo} onAction={onClimate} compact lockedUntil={lockedUntil} />
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
      <div className="grid grid-cols-2 gap-3 text-[15px]">
        {car.battery != null && <p className="flex items-center gap-2 text-white"><BatteryMedium className="h-4 w-4 text-emerald-300" /><b>{car.battery}%</b>{car.range != null && <span className="text-white/60">· {Math.round(car.range)} mi</span>}</p>}
        {car.inside_f != null && <p className="flex items-center gap-2 text-white"><Thermometer className="h-4 w-4" style={{ color: PEACH }} />Inside <b>{Math.round(car.inside_f)}°F</b></p>}
        {car.outside_f != null && <p className="flex items-center gap-2 text-white/80"><Thermometer className="h-4 w-4 text-white/40" />Outside {Math.round(car.outside_f)}°F</p>}
        {car.locked != null && <p className="flex items-center gap-2 text-white/80">{car.locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}{car.locked ? "Locked" : "Unlocked"}</p>}
      </div>
      <p className="mt-2 text-[12px] text-white/45">Updated {ago(car.observed_at)}{car.charging && car.charging !== "Disconnected" ? ` · ${car.charging.toLowerCase()}` : ""}</p>
      {(demo || onClimate) && <ClimateControls demo={demo} onAction={onClimate} />}
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
