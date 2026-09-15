// Street-sweeping ticket guard for Blue Steel (N Kings Rd, West Hollywood).
//
// The checks themselves run as two Claude scheduled tasks (Mon + Tue, 6:55–9:55am PT,
// every 30 min). They read the car from TezLab, decide which curb it's on, push a
// priority-5 ntfy alert through pg_net, and log every check to bluesteel_sweep_runs.
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

export const fetchSweepState = () => call<SweepState>("admin_bluesteel_sweep_state");
export const setAlertsEnabled = (enabled: boolean) =>
  call<SweepState["config"]>("admin_bluesteel_sweep_set", { p_alerts_enabled: enabled });
export const setSkipDates = (dates: string[]) =>
  call<SweepState["config"]>("admin_bluesteel_sweep_set", { p_skip_dates: dates });
export const acknowledgeToday = () => call<{ ok: boolean; confirmation_sent: boolean }>("admin_bluesteel_sweep_ack");
export const sendTestAlert = () => call<number>("admin_bluesteel_sweep_test");

/* ───────── schedule helpers (all in America/Los_Angeles) ───────── */

export const LA_TZ = "America/Los_Angeles";

/** Mon = west curb, Tue = east curb, 8–10am. */
export const SWEEP_DAYS: Record<number, CurbSide> = { 1: "west", 2: "east" };

/** Longitude split between the two curb lanes (~9 m apart), calibrated from parking history. */
export const SIDE_SPLIT_LON = -118.37175;
export const STREET_BOUNDS = { latMin: 34.0836, latMax: 34.0868, lonMin: -118.37195, lonMax: -118.3716 };

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
  side: CurbSide;
  skipped: boolean;
}

/** Upcoming sweep days from today (inclusive while the window is still open). */
export function upcomingSweepDays(today: string, skipDates: string[], count = 6): SweepDay[] {
  const out: SweepDay[] = [];
  const pastToday = laNowMinutes() >= 10 * 60;
  for (let i = 0; out.length < count && i < 60; i++) {
    const date = addDays(today, i);
    const side = SWEEP_DAYS[weekdayOf(date)];
    if (!side) continue;
    if (i === 0 && pastToday) continue;
    out.push({ date, side, skipped: skipDates.includes(date) });
  }
  return out;
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
