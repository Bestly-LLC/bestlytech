/**
 * Live charging helpers for the trip pages (Home + LAX), all read-only unless the guest taps "Send to car":
 *  - ChargeNow: "Charging now: 64% → 80%, 12 min left", then "Done: move the car" (Tesla idle fees start when it's full).
 *    Data: lax_car_public().charging + charge_detail (TezLab, refreshed every 5 min on a trip by car_watch_tick).
 *  - OpenStalls: Superchargers near the car with live open stalls (Tesla nearby_charging_sites via trip_superchargers,
 *    cached 3 min) and a Send-to-car button (trip_supercharger_nav → nav_point).
 *  - RangeCheck: real-world range vs road miles back to the return spot (lax_guest_public.range_check).
 */
import { useState } from "react";
import { ArrowDown, BatteryCharging, Car, CheckCircle2, ChevronRight, Loader2, MapPin, Route, TriangleAlert, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { track } from "./track";

const ACCENT = "var(--trip-accent)";
const rpc = (fn: string, args: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

export type ChargeDetail = { power_kw?: number | null; minutes_left?: number | null; limit_pct?: number | null; energy_kwh?: number | null; fast?: boolean | null } | null;
export type RangeCheckData = { range_mi: number; miles: number; spare: number; status: "ok" | "tight" | "charge"; observed_at?: string } | null;

export function ChargeNow({ state, battery, detail, target }: { state?: string | null; battery?: number | null; detail?: ChargeDetail; target?: number | null }) {
  const charging = state === "Charging" || state === "Starting";
  const done = state === "Complete";
  if (!charging && !done) return null;
  const lim = detail?.limit_pct ?? null;
  const mins = detail?.minutes_left ?? null;
  return (
    <div className={`mt-3 rounded-2xl p-3 ring-1 ${done ? "bg-amber-300/15 ring-amber-200/40" : "bg-emerald-400/10 ring-emerald-300/30"}`} aria-live="polite">
      <p className="flex items-center gap-2 text-[15px] font-bold text-white">
        {done ? <TriangleAlert className="h-4 w-4 text-amber-200" /> : <BatteryCharging className="h-4 w-4 text-emerald-300 motion-safe:animate-pulse" />}
        {done ? "Charging is done: move the car now" : `Charging now${battery != null ? `: ${battery}%` : ""}${lim ? ` → ${lim}%` : ""}`}
      </p>
      <p className="mt-0.5 text-[13px] leading-snug text-white/75">
        {done ? "Unplug and move within 5 minutes. Tesla adds idle fees when a full car stays plugged in, and they're billed to you."
          : [mins != null ? `${mins} min left` : null, detail?.power_kw ? `${Math.round(detail.power_kw)} kW` : null,
             target != null && battery != null ? (battery >= target ? `You're past your ${target}% return level` : `${target - battery}% to your return level`) : null].filter(Boolean).join(" · ")
            || "We'll tell you when it's done."}
      </p>
      {!done && battery != null && (
        <div className="relative mt-2 h-2 rounded-full bg-white/10" aria-hidden>
          <div className="h-2 rounded-full bg-emerald-400 transition-[width] duration-700" style={{ width: `${Math.min(100, Math.max(3, battery))}%` }} />
          {target != null && <span className="absolute -top-1 h-4 w-[2px] rounded bg-white" style={{ left: `${Math.min(100, target)}%` }} />}
        </div>
      )}
    </div>
  );
}

type Site = { name: string; lat: number; lon: number; miles: number; open: number | null; total: number | null; closed?: boolean };
const DEMO_SITES: Site[] = [
  { name: "Santa Monica, CA", lat: 34.024563, lon: -118.485488, miles: 0.4, open: 35, total: 62 },
  { name: "Santa Monica, CA - Cloverfield Blvd", lat: 34.025043, lon: -118.469222, miles: 0.6, open: 2, total: 16 },
  { name: "Los Angeles, CA - W Olympic Blvd", lat: 34.038566, lon: -118.44367, miles: 2.2, open: 6, total: 16 },
];
const nice = (n: string) => n.replace(/, CA\b/, "").replace(/^Los Angeles - /, "");

export function OpenStalls({ token, live, demo }: { token?: string; live: boolean; demo?: boolean }) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const find = async () => {
    if (demo) { setSites(DEMO_SITES); return; }
    if (!token) return;
    setBusy(true); setMsg(null); track(token, "open_stalls");
    try {
      for (let i = 0; i < 12; i++) {
        const { data } = await rpc("trip_superchargers", { p_token: token });
        const r = data as { ok: boolean; sites?: Site[]; pending?: boolean; asleep?: boolean; error?: string } | null;
        if (!r?.ok) { setMsg(r?.error ?? "Couldn't check right now."); return; }
        if (r.sites) { setSites(r.sites.filter((s) => !s.closed)); return; }
        if (r.asleep) { setMsg("The car is asleep, so Tesla can't see open stalls right now. Tap again once you're driving."); return; }
        await new Promise((res) => setTimeout(res, 2500));
      }
      setMsg("Tesla didn't answer in time. Try again in a minute.");
    } finally { setBusy(false); }
  };
  const send = async (s: Site) => {
    if (demo) { setSent(s.name); return; }
    if (!token) return;
    setSent(null); setMsg(null);
    const { data } = await rpc("trip_supercharger_nav", { p_token: token, p_lat: s.lat, p_lon: s.lon });
    const r = data as { ok: boolean; error?: string } | null;
    if (r?.ok) { setSent(s.name); track(token, "nav_point"); } else setMsg(r?.error ?? "Couldn't send it.");
  };
  // Before the first tap it's one quiet row; the stall list appears after.
  if (!sites) return (
    <>
      <button type="button" onClick={() => void find()} disabled={busy || (!demo && !token)}
        className="mt-3 flex min-h-[52px] w-full items-center gap-3 rounded-2xl bg-white/[0.05] px-3 text-left ring-1 ring-white/10 disabled:opacity-60 active:scale-[0.99]">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10">{busy ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: ACCENT }} /> : <Zap className="h-4 w-4" style={{ color: ACCENT }} />}</span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-white">{busy ? "Asking Tesla…" : "Find open stalls nearby"}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden />
      </button>
      {msg && <p className="mt-1 text-[12px] text-white/70" aria-live="polite">{msg}</p>}
    </>
  );
  return (
    <div className="mt-3 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[14px] font-semibold text-white"><Zap className="h-4 w-4" style={{ color: ACCENT }} /> Open stalls right now</p>
        <button type="button" onClick={() => void find()} disabled={busy} className="min-h-[44px] text-[13px] font-semibold" style={{ color: ACCENT }}>{busy ? "Checking…" : "Refresh"}</button>
      </div>
      {sites && (
        <ul className="mt-2 divide-y divide-white/10">
          {sites.slice(0, 4).map((s) => {
            const pct = s.total ? (s.open ?? 0) / s.total : 0;
            return (
              <li key={s.name} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-white">{nice(s.name)}</p>
                  <p className="text-[12px] text-white/60">{s.miles < 10 ? s.miles.toFixed(1) : Math.round(s.miles)} mi away</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums ${pct >= 0.25 ? "bg-emerald-400/15 text-emerald-200" : (s.open ?? 0) > 0 ? "bg-amber-300/15 text-amber-100" : "bg-rose-400/15 text-rose-200"}`}>
                  {s.open ?? "?"}/{s.total ?? "?"} open
                </span>
                {live && (
                  <button type="button" onClick={() => void send(s)} aria-label={`Send ${nice(s.name)} to the car`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#1A1140] active:scale-95" style={{ background: ACCENT }}>
                    {sent === s.name ? <CheckCircle2 className="h-5 w-5" /> : <SendToCarIcon />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {sent && <p className="mt-1 text-[12px] text-emerald-200" aria-live="polite">Sent. It shows on the car's map in about a minute.{demo ? " (Demo: nothing is sent.)" : ""}</p>}
      {msg && <p className="mt-1 text-[12px] text-white/70" aria-live="polite">{msg}</p>}
    </div>
  );
}

export function RangeCheck({ rc, kind, className = "", warnOnly }: { rc: RangeCheckData | undefined; kind: "home" | "lax"; className?: string; warnOnly?: boolean }) {
  if (!rc || (warnOnly && rc.status === "ok")) return null;
  const tone = rc.status === "ok" ? "bg-emerald-400/10 ring-emerald-300/30" : rc.status === "tight" ? "bg-amber-300/15 ring-amber-200/40" : "bg-rose-400/15 ring-rose-300/40";
  const head = rc.status === "ok" ? "Plenty of range to get back" : rc.status === "tight" ? "Range is tight: charge on the way" : "Charge before heading back";
  return (
    <div className={`rounded-2xl p-3 ring-1 ${tone} ${className}`}>
      <p className="flex items-center gap-2 text-[14px] font-bold text-white"><Route className="h-4 w-4" /> {head}</p>
      <p className="mt-0.5 text-[13px] text-white/75">
        About <b className="text-white">{rc.range_mi} mi</b> of real-world range. The return spot ({kind === "home" ? "N Kings Rd" : "98th St garage"}) is about <b className="text-white">{rc.miles} mi</b> away by road.
      </p>
    </div>
  );
}

/** "Send to car" without words: a car with an arrow dropping into it. */
export function SendToCarIcon({ className = "" }: { className?: string }) {
  return (
    <span className={`relative grid h-7 w-7 place-items-end justify-items-center ${className}`} aria-hidden>
      <ArrowDown className="absolute -top-0.5 left-1/2 h-3.5 w-3.5 -translate-x-1/2" strokeWidth={3} />
      <Car className="h-5 w-5" strokeWidth={2.4} />
    </span>
  );
}

/**
 * "Send a Supercharger to the car": the Supercharger closest to where the car is RIGHT NOW (Tesla's live list,
 * nearest with an open stall first), sent to the car's navigation. Returns null when Tesla can't list sites
 * (car asleep, no answer), so the caller can fall back to the fixed nearby Supercharger.
 */
export async function sendNearestSupercharger(token: string, onStage?: (s: string) => void): Promise<string | null> {
  onStage?.("Finding the Supercharger closest to the car");
  let sites: Site[] | null = null;
  for (let i = 0; i < 12 && !sites; i++) {
    const { data } = await rpc("trip_superchargers", { p_token: token });
    const r = data as { ok: boolean; sites?: Site[]; pending?: boolean; asleep?: boolean } | null;
    if (!r?.ok || r.asleep) return null;
    if (r.sites) sites = r.sites.filter((s) => !s.closed);
    else await new Promise((res) => setTimeout(res, 2500));
  }
  if (!sites?.length) return null;
  const byDist = [...sites].sort((a, b) => a.miles - b.miles);
  const pick = byDist.find((s) => (s.open ?? 1) > 0) ?? byDist[0];
  onStage?.(`Sending ${nice(pick.name)} (${pick.miles < 10 ? pick.miles.toFixed(1) : Math.round(pick.miles)} mi)`);
  const { data } = await rpc("trip_supercharger_nav", { p_token: token, p_lat: pick.lat, p_lon: pick.lon });
  const r = data as { ok: boolean; id?: number; error?: string } | null;
  if (!r?.ok) throw new Error(r?.error ?? "Couldn't send it.");
  track(token, "nav_point", { nearest: nice(pick.name) });
  if (r.id) {
    for (let i = 0; i < 45; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const { data: j } = await rpc("lax_guest_car_job", { p_token: token, p_id: r.id });
      const job = j as { status: string; result?: { error?: string } } | null;
      if (job?.status === "done") return nice(pick.name);
      if (job?.status === "failed") throw new Error(job.result?.error ?? "The car didn't respond");
    }
    throw new Error("The car is taking a while. Try again in a minute.");
  }
  return nice(pick.name);
}

