/**
 * Command Center v2 (admin home): data + formatting helpers.
 *
 * Everything the home page shows comes from three admin-only paths, never a public token in the browser:
 *   admin_command_center()   Money / Turo / AI team / My day / Call next, one read-only bundle
 *   admin_cc_wx_events()     the calendar + Turo items the projection wall shows on its weather scenes
 *   weatherkit-proxy         Apple WeatherKit (+ air quality from Open-Meteo, fetched by the function, not the browser)
 *
 * House rules baked in here: 12-hour times, US units (degrees F, mph), PT, and "Updated 3 hours ago" wording for stale data.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const TZ = "America/Los_Angeles";
export const HOME = { lat: 34.09, lon: -118.3617, name: "West Hollywood" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = { rpc: (name: string, args?: object) => Promise<{ data: any; error: { message?: string } | null }> };
const rpc = supabase as unknown as Rpc;

/* ───────── formatting ───────── */

const D = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));
export const time12 = (d: Date | string | number) =>
  D(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
export const hour12 = (d: Date | string | number) =>
  D(d).toLocaleTimeString("en-US", { hour: "numeric", hour12: true, timeZone: TZ });
export const dayShort = (d: Date | string | number) => D(d).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
export const dayLong = (d: Date | string | number) => D(d).toLocaleDateString("en-US", { weekday: "long", timeZone: TZ });
export const monthDay = (d: Date | string | number) => D(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
export const ptDateKey = (d: Date | string | number) => D(d).toLocaleDateString("en-CA", { timeZone: TZ });

export const usd = (n: number | null | undefined, cents = true) =>
  n == null || !Number.isFinite(Number(n))
    ? "n/a"
    : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

/** "Tue 9:00 AM" inside the next 6 days, "Oct 27, 9:00 AM" further out, "Today 9:00 AM" today. */
export function whenShort(d: Date | string | number, now = new Date()): string {
  const x = D(d);
  const days = Math.round((new Date(ptDateKey(x)).getTime() - new Date(ptDateKey(now)).getTime()) / 864e5);
  if (days === 0) return `Today ${time12(x)}`;
  if (days === 1) return `Tomorrow ${time12(x)}`;
  if (days > 1 && days < 7) return `${dayShort(x)} ${time12(x)}`;
  return `${monthDay(x)}, ${time12(x)}`;
}

/** "just now", "12 minutes ago", "3 hours ago", "2 days ago". */
export function ageWords(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "not yet";
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (m < 2) return "just now";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/** The footer on every card: "Updated 8:05 PM" while fresh, "Updated 3 hours ago" once it is behind. Never blanks the card. */
export function stamp(iso: string | null | undefined, staleAfterMin: number, now = Date.now()): { text: string; stale: boolean } {
  if (!iso) return { text: "Waiting for the first update", stale: true };
  const mins = (now - new Date(iso).getTime()) / 60_000;
  if (mins > staleAfterMin) return { text: `Updated ${ageWords(iso, now)}`, stale: true };
  return { text: `Updated ${time12(iso)}`, stale: false };
}

/* ───────── generic polling loader ───────── */

export interface Live<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  busy: boolean;
  reload: () => Promise<void>;
}

/** Loads, keeps the last good value when a refresh fails (the page degrades, never blanks), and polls while visible. */
export function useLive<T>(loader: () => Promise<T>, pollMs: number): Live<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const ref = useRef(loader);
  ref.current = loader;
  const reload = useCallback(async () => {
    setBusy(true);
    try {
      setData(await ref.current());
      setError(null);
    } catch (e) {
      setError((e as Error)?.message || "unknown error");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
    const iv = setInterval(() => { if (!document.hidden) reload(); }, pollMs + Math.floor(Math.random() * pollMs * 0.1));
    const vis = () => { if (!document.hidden) reload(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, [reload, pollMs]);
  return { data, error, loading, busy, reload };
}

/* ───────── the bundle ───────── */

export interface CcBundle {
  at: string;
  money: null | {
    accounts: { name: string; last4: string; balance: number }[];
    total: number; in_30d: number; out_30d: number; burn_daily: number;
    runway_days: number | null; runway_date: string | null;
    bills: { name: string; amount: number; next: string; every_days: number }[];
    next_deposit: null | { amount: number; expected_at: string; basis: string };
    updated_at: string; estimate: boolean;
  };
  turo: {
    widget: null | { car: string; battery: number | null; range: number | null; locked: boolean | null; charging: string | null; observed_at: string | null;
      current: null | { guest: string; ends_at: string; return_pct: number | null }; next: null | { guest: string; starts_at: string; earnings: number | null }; owed: number | null };
    ready: null | { next: null | { kind: string; guest: string; starts_at: string; need_pct: number | null; battery_pct: number | null; place: string | null }; state: string;
      checks: { id: string; label: string; state: string; value: string; hint?: string }[] };
    owed: number;
    trips: { id: number; guest: string; car: string | null; starts_at: string; ends_at: string; earnings: number | null; in_progress: boolean | null }[];
  };
  ai: {
    spend_today: number; cap: number; employee_count: number;
    stuck: { slug: string; name: string; at: string; summary: string; kind: "job" | "pi" }[];
    employees: { slug: string; name: string; role: string; schedule: string }[];
  };
  myday: { calls: { count: number; top: { id: string; title: string }[] } };
  leads: { next: { table: string; company: string; window: string | null; why: string | null; priority: number; tz: string | null }[]; maya_queued: number; rg_found: number };
  issues: { key: string; title: string; severity: string; since: string }[];
}

export async function loadBundle(): Promise<CcBundle> {
  const { data, error } = await rpc.rpc("admin_command_center");
  if (error) throw new Error(error.message || "could not load the Command Center");
  return data as CcBundle;
}

/* ───────── "what employees will do next": parse the plain-language schedules ───────── */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** PT wall-clock (y, m, d, h, min) to a real instant. */
function ptToUtc(y: number, m: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const shown = new Date(guess).toLocaleString("en-US", { timeZone: TZ, hour12: false });
  const [dp, tp] = shown.split(", ");
  const [mm, dd, yy] = dp.split("/").map(Number);
  const [hh, mi] = tp.split(":").map(Number);
  const asIfUtc = Date.UTC(yy, mm - 1, dd, hh % 24, mi);
  return new Date(guess - (asIfUtc - guess));
}

/** The next time a plain schedule like "Mondays 8:45 AM" or "daily 4:17 AM" fires. Null for "every 5 min", "always on", ranges, etc. */
export function nextRun(schedule: string, now = new Date()): Date | null {
  const s = schedule.trim();
  if (s.length > 64 || /every\s+\d|always|answers|after every|when |hourly|checks|\bto\b|\d(st|nd|rd|th)\b|\(/i.test(s)) return null;
  const times = [...s.matchAll(/(\d{1,2})(?::(\d{2}))?\s?(AM|PM)/gi)].map((m) => {
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === "PM") h += 12;
    return { h, min: Number(m[2] ?? 0) };
  });
  if (!times.length) return null;
  const lower = s.toLowerCase();
  const days: number[] = /weekdays/.test(lower) ? [1, 2, 3, 4, 5]
    : WEEKDAYS.map((w, i) => (lower.includes(w) ? i : -1)).filter((i) => i >= 0);
  const allowed = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
  const [y, m, d] = ptDateKey(now).split("-").map(Number);
  let best: Date | null = null;
  for (let add = 0; add < 8; add++) {
    const base = new Date(Date.UTC(y, m - 1, d + add, 12));
    if (!allowed.includes(base.getUTCDay())) continue;
    for (const t of times) {
      const at = ptToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), t.h, t.min);
      if (at.getTime() > now.getTime() && (!best || at < best)) best = at;
    }
    if (best) break;
  }
  return best;
}

/* ───────── weather ───────── */

export interface WxHour { t: number; tempF: number; rain: number; cond: string; code: string; uv: number; windMph: number; daylight: boolean; aqi: number | null }
export interface WxDay { t: number; hiF: number; loF: number; rain: number; cond: string; code: string; uvMax: number; windMph: number }
export interface WxAlert { id: string; title: string; severity: "extreme" | "severe" | "moderate" | "minor" | "unknown"; until: number | null; area: string; url: string | null }
export interface Wx {
  readAt: string; fetchedAt: string;
  now: { tempF: number; feelsF: number; cond: string; code: string; windMph: number; gustMph: number; uv: number; humidity: number };
  hours: WxHour[]; days: WxDay[]; alerts: WxAlert[];
  air: { aqi: number | null; pm25: number | null; label: string } | null;
  sunrise: number | null; sunset: number | null;
}

const cToF = (c: number) => (c * 9) / 5 + 32;
const kmhToMph = (k: number) => k * 0.621371;

export function condLabel(code: string): string {
  return code.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ (\w)/g, (_, c: string) => " " + c.toLowerCase());
}
export const aqiLabel = (a: number) =>
  a <= 50 ? "Good" : a <= 100 ? "Moderate" : a <= 150 ? "Unhealthy for sensitive groups" : a <= 200 ? "Unhealthy" : a <= 300 ? "Very unhealthy" : "Hazardous";
const SEV: Record<string, number> = { extreme: 0, severe: 1, moderate: 2, minor: 3, unknown: 4 };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeWx(j: any): Wx {
  const cw = j?.currentWeather;
  if (!cw) throw new Error("WeatherKit returned no current conditions");
  const air = j?.airQuality as { aqi: number | null; pm25: number | null; hourly?: { time: string; aqi: number }[] } | null | undefined;
  const aqiAt = new Map<number, number>((air?.hourly ?? []).map((h) => [Math.floor(new Date(h.time).getTime() / 3.6e6), h.aqi] as [number, number]));
  const nowMs = Date.now();
  const hours: WxHour[] = (j?.forecastHourly?.hours ?? [])
    .map((h: any) => ({
      t: new Date(h.forecastStart).getTime(), tempF: cToF(h.temperature), rain: Math.round((h.precipitationChance ?? 0) * 100),
      cond: condLabel(h.conditionCode), code: h.conditionCode, uv: h.uvIndex ?? 0, windMph: kmhToMph(h.windSpeed ?? 0), daylight: !!h.daylight,
      aqi: aqiAt.get(Math.floor(new Date(h.forecastStart).getTime() / 3.6e6)) ?? null,
    }))
    .filter((h: WxHour) => h.t >= nowMs - 59 * 60_000)
    .slice(0, 24);
  const days: WxDay[] = (j?.forecastDaily?.days ?? [])
    .filter((d: any) => new Date(d.forecastEnd).getTime() > nowMs)
    .slice(0, 5)
    .map((d: any) => ({
      t: new Date(d.forecastStart).getTime(), hiF: cToF(d.temperatureMax), loF: cToF(d.temperatureMin), rain: Math.round((d.precipitationChance ?? 0) * 100),
      cond: condLabel(d.conditionCode), code: d.conditionCode, uvMax: d.maxUvIndex ?? 0, windMph: kmhToMph(d.windSpeedMax ?? 0),
    }));
  const alerts: WxAlert[] = (j?.weatherAlerts?.alerts ?? [])
    .map((a: any) => ({
      id: String(a.id ?? a.description), title: String(a.description ?? "Weather alert"), severity: (SEV[a.severity] != null ? a.severity : "unknown") as WxAlert["severity"],
      until: a.expireTime ? new Date(a.expireTime).getTime() : null, area: String(a.areaName ?? ""), url: a.detailsUrl ?? null,
    }))
    .sort((a: WxAlert, b: WxAlert) => SEV[a.severity] - SEV[b.severity]);
  const today = (j?.forecastDaily?.days ?? [])[0];
  return {
    readAt: cw.metadata?.readTime ?? cw.asOf, fetchedAt: j?.fetchedAt ?? new Date().toISOString(),
    now: { tempF: cToF(cw.temperature), feelsF: cToF(cw.temperatureApparent ?? cw.temperature), cond: condLabel(cw.conditionCode), code: cw.conditionCode,
      windMph: kmhToMph(cw.windSpeed ?? 0), gustMph: kmhToMph(cw.windGust ?? cw.windSpeed ?? 0), uv: cw.uvIndex ?? 0, humidity: Math.round((cw.humidity ?? 0) * 100) },
    hours, days, alerts,
    air: air && air.aqi != null ? { aqi: air.aqi, pm25: air.pm25, label: aqiLabel(air.aqi) } : null,
    sunrise: today?.sunrise ? new Date(today.sunrise).getTime() : null, sunset: today?.sunset ? new Date(today.sunset).getTime() : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function loadWeather(): Promise<Wx> {
  const { data, error } = await supabase.functions.invoke("weatherkit-proxy", {
    body: { lat: HOME.lat, lon: HOME.lon, dataSets: "currentWeather,forecastHourly,forecastDaily,weatherAlerts", air: true, country: "US", lang: "en" },
  });
  if (error) throw new Error(error.message || "weather is unavailable");
  return normalizeWx(data);
}

/** Chips that appear only when they matter. */
export function chips(wx: Wx): { id: "uv" | "air" | "rain"; label: string; tone: "orange" | "red" | "blue" }[] {
  const out: { id: "uv" | "air" | "rain"; label: string; tone: "orange" | "red" | "blue" }[] = [];
  const uvNow = Math.max(wx.now.uv, ...wx.hours.slice(0, 12).map((h) => h.uv));
  if (uvNow >= 6) out.push({ id: "uv", label: `UV ${Math.round(uvNow)} ${uvNow >= 8 ? "very high" : "high"}`, tone: uvNow >= 8 ? "red" : "orange" });
  const aqi = Math.max(wx.air?.aqi ?? 0, ...wx.hours.slice(0, 12).map((h) => h.aqi ?? 0));
  if (aqi >= 101) out.push({ id: "air", label: `Air ${Math.round(aqi)} ${aqiLabel(aqi).replace("Unhealthy for sensitive groups", "unhealthy for some")}`, tone: aqi >= 151 ? "red" : "orange" });
  const wet = wx.hours.slice(0, 12).reduce((m, h) => (h.rain > m.rain ? h : m), { rain: 0, t: 0 } as { rain: number; t: number });
  if (wet.rain >= 40) out.push({ id: "rain", label: `Rain ${wet.rain}% around ${hour12(wet.t)}`, tone: "blue" });
  return out;
}

/** One plain sentence for the top of the weather card. */
export function headline(wx: Wx): string {
  const cond = wx.now.cond.charAt(0).toUpperCase() + wx.now.cond.slice(1).toLowerCase();
  const soon = wx.hours.find((h) => h.rain >= 50);
  if (soon) {
    const dt = soon.t - Date.now();
    const when = dt < 36e5 ? "within the hour" : `around ${hour12(soon.t)}${ptDateKey(soon.t) === ptDateKey(Date.now()) ? "" : " " + dayLong(soon.t)}`;
    return `${cond}. Rain likely ${when}.`;
  }
  const later = wx.days.find((d) => d.rain >= 50);
  if (later) return `${cond}. No rain in the next 24 hours, then ${later.cond.toLowerCase()} ${ptDateKey(later.t) === ptDateKey(Date.now()) ? "today" : "on " + dayLong(later.t + 12 * 36e5)}.`;
  return `${cond}. No rain in sight for 5 days.`;
}

/* ───────── calendar items on the weather ───────── */

export interface WxEvent { title: string; start: string; end: string; calendar?: string; location?: string; source?: string; turo?: "pickup" | "return" }
export interface WxEventsPayload { events: WxEvent[]; updated_at: string | null; calendar_at: string | null; err: string | null }

export async function loadWxEvents(): Promise<WxEventsPayload> {
  const { data, error } = await rpc.rpc("admin_cc_wx_events");
  if (error) throw new Error(error.message || "could not load calendar items");
  return data as WxEventsPayload;
}

export interface Cluster { start: number; end: number; titles: string[]; events: WxEvent[] }

/**
 * The wall's rule: events that overlap share ONE capsule on the top lane, names joined with " · ", nothing cut off.
 * Back-to-back events that only touch stay separate capsules.
 */
export function clusterEvents(events: WxEvent[], from: number, to: number): Cluster[] {
  const rows = events
    .map((e) => ({ e, s: new Date(e.start).getTime(), f: new Date(e.end).getTime() }))
    .filter((r) => Number.isFinite(r.s) && Number.isFinite(r.f) && r.f > from && r.s < to)
    .sort((a, b) => a.s - b.s || a.f - b.f);
  const out: Cluster[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && r.s < last.end) {
      last.end = Math.max(last.end, r.f);
      if (!last.titles.includes(r.e.title)) last.titles.push(r.e.title);
      last.events.push(r.e);
    } else {
      out.push({ start: r.s, end: r.f, titles: [r.e.title], events: [r.e] });
    }
  }
  return out;
}

export function eventsAt(events: WxEvent[], t: number, span = 36e5): WxEvent[] {
  return events.filter((e) => new Date(e.start).getTime() < t + span && new Date(e.end).getTime() > t);
}

export function agendaByDay(events: WxEvent[]): Map<string, WxEvent[]> {
  const m = new Map<string, WxEvent[]>();
  for (const e of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    const k = ptDateKey(e.start);
    m.set(k, [...(m.get(k) ?? []), e]);
  }
  return m;
}
