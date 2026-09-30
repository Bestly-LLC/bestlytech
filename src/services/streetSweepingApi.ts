// Street-sweeping ticket guard for Blue Steel (N Kings Rd, West Hollywood).
//
// Each block of Kings Rd has its own sweep days (bluesteel_sweep_zones): the 700 block
// (Melrose to Waring, home) is west curb Monday / east curb Tuesday; the 800 block
// (Waring to Willoughby) is west curb Thursday / east curb Friday; 8-10 AM.
// bluesteel_sweep_tick() runs in the database every 5 min on sweep mornings (6:55-10 AM):
// it reads the car's own GPS feed, works out block + curb, pushes MOVE BLUE STEEL about
// every 30 min, logs to bluesteel_sweep_runs, and drives the wall / iPhone card.
// This page reads and controls that state through admin-only RPCs.

import { supabase } from "@/integrations/supabase/client";

export type SweepOutcome =
  | "alerted"
  | "safe_side"
  | "not_on_street"
  | "acknowledged"
  | "disabled"
  | "skipped"
  | "location_error"
  | "outside_window"
  | "test";

export type CurbSide = "west" | "east";

export interface SweepRun {
  id: number;
  ran_at: string;
  outcome: SweepOutcome;
  side: CurbSide | null;
  latitude: number | null;
  longitude: number | null;
  alert_title: string | null;
  alert_body: string | null;
  note: string | null;
  zone?: string | null;
}

export interface CalibrationPoint {
  lat: number;
  lon: number;
  side: CurbSide;
  at: string;
  note?: string | null;
}

/** One block of the street with its own sweep days. Days are 0 = Sunday … 6 = Saturday. */
export interface SweepZone {
  id: string;
  name: string;
  between_streets: string;
  street: string;
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
  split_lon: number;
  west_dow: number | null;
  east_dow: number | null;
  start_min: number;
  end_min: number;
  fine_usd: number;
  calibration: CalibrationPoint[];
  sort: number;
}

/** Where the car's latest position falls: block, curb, and that curb's sweep day. */
export interface CarWhere {
  zone: string;
  name: string;
  between: string;
  street: string;
  side: CurbSide;
  dow: number | null;
  day: string | null;
  start_min: number;
  end_min: number;
  fine_usd: number;
}

export interface CarNow {
  lat: number;
  lon: number;
  at: string;
  source: string;
  where: CarWhere | null;
}

export interface SweepAck {
  id: number;
  acked_at: string;
  via: string | null;
}

export interface SweepState {
  config: { alerts_enabled: boolean; skip_dates: string[]; updated_at: string };
  la_today: string;
  acked_today: boolean;
  last_location: { ran_at: string; side: CurbSide | null; latitude: number; longitude: number; outcome: SweepOutcome } | null;
  /** Latest position from the car's own feed (updates every ~20 min), with its block + curb. */
  car?: CarNow | null;
  zones?: SweepZone[];
  runs: SweepRun[];
  acks: SweepAck[];
}

// supabase-js types are generated from the schema and don't know these RPCs yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args);

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchSweepState = async () => {
  const s = await call<SweepState>("admin_bluesteel_sweep_state");
  if (!s || typeof s !== "object" || !("config" in s) || !s.la_today) throw new Error("Unexpected response from the server");
  return s;
};
export const setAlertsEnabled = (enabled: boolean) =>
  call<SweepState["config"]>("admin_bluesteel_sweep_set", { p_alerts_enabled: enabled });
export const setSkipDates = (dates: string[]) =>
  call<SweepState["config"]>("admin_bluesteel_sweep_set", { p_skip_dates: dates });
export const acknowledgeToday = () => call<{ ok: boolean; confirmation_sent: boolean }>("admin_bluesteel_sweep_ack");
export const sendTestAlert = () => call<number>("admin_bluesteel_sweep_test");
/** Record the car's current spot as a known point on `side` of block `zone` (widens the block if needed). */
export const calibrateHere = (zone: string, side: CurbSide, note?: string) =>
  call<SweepZone>("admin_bluesteel_sweep_calibrate", { p_zone: zone, p_side: side, p_note: note ?? null });

/* ───────── where the car is (and whether we still believe it) ───────── */

/** The car's feed updates every ~20 min, so a reading older than this is history, not "now". */
export const CAR_FRESH_MS = 2 * 60 * 60 * 1000;
/** Old enough that "it might still be parked there" is worth a heads-up, but not a fact. */
export const CAR_RECENT_MS = 18 * 60 * 60 * 1000;

export type CarStatus =
  | "on_sweep_curb"   // parked on the curb that gets swept next
  | "on_safe_curb"    // parked on the other curb
  | "off_street"      // the check found it, and it isn't on Kings Rd
  | "stale"           // we have a reading, but it's too old to call it current
  | "unknown";        // nothing has ever reported a position

export interface CarPlacement {
  status: CarStatus;
  /** Curb from the last reading (null when the car wasn't on the street). */
  side: CurbSide | null;
  ageMs: number | null;
  ranAt: string | null;
  /** True while the reading is recent enough to act on. */
  fresh: boolean;
}

export function carPlacement(
  car: CarNow | null | undefined,
  dangerSide: CurbSide | null,
  now: number = Date.now(),
): CarPlacement {
  if (!car) return { status: "unknown", side: null, ageMs: null, ranAt: null, fresh: false };
  const ageMs = now - new Date(car.at).getTime();
  const fresh = ageMs < CAR_FRESH_MS;
  const base = { side: car.where?.side ?? null, ageMs, ranAt: car.at, fresh };
  if (!fresh) return { ...base, status: "stale" };
  if (!car.where) return { ...base, side: null, status: "off_street" };
  return { ...base, status: car.where.side === dangerSide ? "on_sweep_curb" : "on_safe_curb" };
}

/* ───────── schedule helpers (all in America/Los_Angeles) ───────── */

export const LA_TZ = "America/Los_Angeles";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "8 AM", "9:30 AM" from minutes after midnight. */
export function min12(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, "0")}` : ""}\u00a0${h < 12 ? "AM" : "PM"}`;
}

/** The curb a block sweeps on a weekday, or null. */
export function zoneSideOn(z: SweepZone, dow: number): CurbSide | null {
  if (z.west_dow === dow) return "west";
  if (z.east_dow === dow) return "east";
  return null;
}

export interface SweepStop { zone: SweepZone; side: CurbSide }

/** Every (block, curb) swept on a weekday. */
export function stopsOn(zones: SweepZone[], dow: number): SweepStop[] {
  const out: SweepStop[] = [];
  for (const z of zones) {
    if (z.west_dow === dow) out.push({ zone: z, side: "west" });
    if (z.east_dow === dow) out.push({ zone: z, side: "east" });
  }
  return out;
}

function isoInLA(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Weekday (0=Sun) for a YYYY-MM-DD calendar date. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function laNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function laTodayIso(): string {
  return isoInLA(new Date());
}

export interface SweepDay {
  date: string;
  stops: SweepStop[];
  skipped: boolean;
}

/** Upcoming sweep days from today (inclusive while the window is still open). */
export function upcomingSweepDays(today: string, skipDates: string[], zones: SweepZone[], count = 6): SweepDay[] {
  const out: SweepDay[] = [];
  const pastToday = laNowMinutes() >= 10 * 60;
  for (let i = 0; out.length < count && i < 60; i++) {
    const date = addDays(today, i);
    const stops = stopsOn(zones, weekdayOf(date));
    if (!stops.length) continue;
    if (i === 0 && pastToday) continue;
    out.push({ date, stops, skipped: skipDates.includes(date) });
  }
  return out;
}

/** Next date (from today, while today's window is open) a given block's curb is swept and not skipped. */
export function nextSweepFor(today: string, skipDates: string[], z: SweepZone, side: CurbSide): string | null {
  const dow = side === "west" ? z.west_dow : z.east_dow;
  if (dow == null) return null;
  const pastToday = laNowMinutes() >= z.end_min;
  for (let i = 0; i < 60; i++) {
    const date = addDays(today, i);
    if (i === 0 && pastToday) continue;
    if (weekdayOf(date) === dow && !skipDates.includes(date)) return date;
  }
  return null;
}

export function fmtDay(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function fmtLA(ts: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: LA_TZ }).format(new Date(ts));
}

export function ago(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
