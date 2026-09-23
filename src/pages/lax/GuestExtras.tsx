/**
 * Personal bits of the Turo guest page (/lax/t/:token): trip times, Apple Weather at LAX,
 * the live car card (1 hour before pickup → end of trip) and the reminder-email opt-in.
 * Data comes from lax_guest_public (page) and weatherkit-proxy (Apple WeatherKit, public, cached).
 */
import { useEffect, useState, type ReactNode } from "react";
import { BatteryMedium, Car, CloudSun, Lock, LockOpen, Mail, Thermometer, Zap } from "lucide-react";
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
  locked: boolean | null; charging: string | null; online: string | null; observed_at: string; name: string | null;
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

type Hour = { forecastStart: string; temperature: number; conditionCode: string; precipitationChance: number };
type Day = { forecastStart: string; temperatureMax: number; temperatureMin: number; conditionCode: string; precipitationChance: number };
type Wx = { currentWeather?: { temperature: number; conditionCode: string }; forecastHourly?: { hours: Hour[] }; forecastDaily?: { days: Day[] } };

function nearestHour(hours: Hour[], at: string) {
  const t = new Date(at).getTime();
  const h = hours.reduce<Hour | null>((b, x) => (!b || Math.abs(+new Date(x.forecastStart) - t) < Math.abs(+new Date(b.forecastStart) - t) ? x : b), null);
  return h && Math.abs(+new Date(h.forecastStart) - t) <= 2 * 3600 * 1000 ? h : null;
}
function dayOf(days: Day[], at: string) {
  const key = new Date(at).toLocaleDateString("en-US", { timeZone: LA });
  return days.find((d) => new Date(new Date(d.forecastStart).getTime() + 12 * 3600 * 1000).toLocaleDateString("en-US", { timeZone: LA }) === key) ?? null;
}

/** Apple Weather at LAX: now, plus pickup/return if they're inside the forecast window. */
export function WeatherCard({ trip }: { trip: Trip | null }) {
  const [wx, setWx] = useState<Wx | null>(null);
  useEffect(() => {
    supabase.functions.invoke("weatherkit-proxy", { body: { lat: 33.947, lon: -118.3816, dataSets: "currentWeather,forecastHourly,forecastDaily" } })
      .then(({ data }) => setWx((data as Wx) ?? null)).catch(() => setWx(null));
  }, []);
  if (!wx?.currentWeather) return null;
  const rows: { label: string; text: string }[] = [];
  const at = (label: string, iso: string) => {
    const h = wx.forecastHourly ? nearestHour(wx.forecastHourly.hours, iso) : null;
    if (h) {
      rows.push({ label: `${label} · ${fmtTime(iso)}`, text: `${cToF(h.temperature)}°F, ${cond(h.conditionCode)}${h.precipitationChance >= 0.3 ? ` · ${Math.round(h.precipitationChance * 100)}% rain` : ""}` });
      return;
    }
    const d = wx.forecastDaily ? dayOf(wx.forecastDaily.days, iso) : null;
    if (d) rows.push({ label: `${label} · ${new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: LA })}`, text: `${cToF(d.temperatureMax)}° / ${cToF(d.temperatureMin)}°, ${cond(d.conditionCode)}${d.precipitationChance >= 0.3 ? ` · ${Math.round(d.precipitationChance * 100)}% rain` : ""}` });
  };
  if (trip && new Date(trip.starts_at) > new Date()) at("Pickup", trip.starts_at);
  if (trip && new Date(trip.ends_at) > new Date()) at("Return", trip.ends_at);
  return (
    <Card label="Weather at LAX" icon={<CloudSun className="h-3.5 w-3.5" />}>
      <p className="text-[15px] text-white"><span className="text-2xl font-semibold">{cToF(wx.currentWeather.temperature)}°F</span> <span className="text-white/70">now, {cond(wx.currentWeather.conditionCode)}</span></p>
      {rows.map((r) => (
        <p key={r.label} className="mt-1.5 text-[14px] text-white/80"><span className="text-white/50">{r.label}:</span> {r.text}</p>
      ))}
      <p className="mt-2 text-[11px] text-white/35"> Weather</p>
    </Card>
  );
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} days ago`;
};

/** Live car: shown from 1 hour before pickup until the trip ends. */
export function CarCard({ trip, car }: { trip: Trip; car: CarState | null }) {
  if (!car) {
    if (new Date(trip.car_opens_at) > new Date()) {
      return (
        <Card label="Your car" icon={<Zap className="h-3.5 w-3.5" />}>
          <p className="text-[14px] text-white/75">Live battery and cabin temperature show up here at <b className="text-white">{fmtWhen(trip.car_opens_at)}</b>, an hour before pickup.</p>
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
