/**
 * Demo trip pages for the host: /t/demo-home and /t/demo-lax. Everything is faked in the browser, so nothing
 * touches a real guest, key, car or message. ?stage=… jumps to a point in the trip; the bar at the bottom switches it.
 */
import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { DEMO_CAR } from "./GuestExtras";

export const isDemo = (token?: string) => !!token && token.startsWith("demo-");
export const demoKind = (token: string): "home" | "lax" => (token.startsWith("demo-lax") ? "lax" : "home");

export const STAGES: Record<"home" | "lax", { id: string; label: string }[]> = {
  home: [
    { id: "booked", label: "Booked (3 days out)" },
    { id: "key-soon", label: "3 hours before" },
    { id: "key-ready", label: "Pickup soon: key ready (tap it to add)" },
    { id: "on-trip", label: "On the trip" },
    { id: "returning", label: "Return in 90 min" },
    { id: "ended", label: "Trip ended" },
  ],
  lax: [
    { id: "booked", label: "Booked (3 days out)" },
    { id: "day-of", label: "Pickup soon: key ready (tap it to add)" },
    { id: "on-trip", label: "On the trip" },
    { id: "returning", label: "Return in 90 min" },
    { id: "ended", label: "Trip ended" },
  ],
};

const H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();

/** Two sample Supercharger stops (the real numbers come from TezLab during the trip, then Tesla's bill). */
function demoCharging(start: number, ended: boolean) {
  const sessions = [
    { at: iso(start + 4 * H), place: "Los Angeles, CA - Venice Boulevard", kwh: 14.5, from: 42, to: 77, cost: 7.19, idle: 0, final: ended, invoices: ended ? [{ id: "demo-1" }] : null },
    { at: iso(start + 20 * H), place: "Santa Monica, CA", kwh: 15.3, from: 42, to: 80, cost: 8.19, idle: ended ? 1.0 : 0, final: ended, invoices: ended ? [{ id: "demo-2" }] : null },
  ].filter((x) => +new Date(x.at) < Date.now());
  const total = sessions.reduce((a, x) => a + x.cost + x.idle, 0);
  return { sessions, total: Math.round(total * 100) / 100, idle: ended ? 1 : 0, kwh: Math.round(sessions.reduce((a, x) => a + x.kwh, 0) * 10) / 10,
    count: sessions.length, final: ended, updated_at: iso(Date.now() - 12 * 60e3) };
}

/** A fake lax_guest_public() answer for the chosen stage. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function demoPub(kind: "home" | "lax", stage: string): any {
  const now = Date.now();
  const startIn: Record<string, number> = { booked: 72 * H, "key-soon": 3 * H, "key-ready": 1.5 * H, "key-added": 0.5 * H, "day-of": 1.5 * H, "on-trip": -24 * H, returning: -70.5 * H, ended: -74 * H };
  const s = now + (startIn[stage] ?? 72 * H);
  const e = s + 72 * H;
  const trip = { first: "Demo", starts_at: iso(s), ends_at: iso(e), car_opens_at: iso(s - H) };
  const keyOpens = s - 2 * H;
  let added = false; try { added = sessionStorage.getItem("demo-key-added") === "1"; } catch { /* ignore */ }
  const controlsOn = (now >= s - H && now < e) || added;
  const controls_state = now >= e ? "ended" : controlsOn ? "on" : "soon";
  const keyState = stage === "booked" || stage === "key-soon" ? "soon" : stage === "key-ready" || stage === "day-of" ? (added ? "added" : "ready") : stage === "ended" ? "ended" : "added";
  const key = { state: keyState, opens_at: iso(keyOpens), link: keyState === "ready" ? "#demo-key" : null, expires_at: keyState === "ready" ? iso(now + 23 * H) : null, unlock: false };
  const base = {
    ok: true, kind, trip, car: { ...DEMO_CAR, observed_at: iso(now - 3 * 60e3) }, controls: controls_state === "on", controls_state,
    controls_opens_at: iso(s - H), email: null, reminder_at: null, reminder_sent_at: null, pickup_battery: 80, demo: true,
    charging: now < s ? null : demoCharging(s, now >= e),
  };
  if (kind === "home") {
    return {
      ...base,
      home: { address: "733 N Kings Rd, West Hollywood, CA 90069", lat: 34.0838, lon: -118.3708, parking_note: "It's parked on N Kings Rd, right by the building. Tap Exact spot to see where, or Honk to find it.", return_note: "Park on N Kings Rd near 733, lock it in the Tesla app, and take your return photos in the Turo app.", host_note: null },
      spot: now >= s - 2 * H && now < e ? { lat: 34.0836, lon: -118.3712, observed_at: iso(now - 4 * 60e3) } : null,
      key,
    };
  }
  return {
    ...base, key, ready: stage !== "booked", payload: "BESTLY-DEMO-QR", note: null, google: false, code_for_trip_month: true,
    valid_through: iso(now + 20 * 24 * H).slice(0, 10),
    guide: { car: "Tesla Model 3", garage: "5730 W 98th St, LA 90045", level: "P3", spot: "", shuttle: "The Parking Spot — Century", after_hours: "310-642-0947", shuttle_stop: "5701 W Century Blvd" },
  };
}

export function useDemoStage(kind: "home" | "lax", enabled: boolean) {
  const [stage, setStage] = useState(() => new URLSearchParams(window.location.search).get("stage") ?? STAGES[kind][0].id);
  useEffect(() => {
    if (!enabled) return;
    // Each stage starts fresh: the key isn't added/tapped until the host taps it again.
    try { sessionStorage.removeItem("demo-key-added"); localStorage.removeItem(`keytap:demo-${kind}`); } catch { /* ignore */ }
    const u = new URL(window.location.href); u.searchParams.set("stage", stage);
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  }, [stage, enabled, kind]);
  return [stage, setStage] as const;
}

/** Floating switcher so the host can walk the trip from booking to return. */
export function DemoBar({ kind, stage, onStage }: { kind: "home" | "lax"; stage: string; onStage: (s: string) => void }) {
  return (
    <div className="fixed inset-x-0 bottom-[8.5rem] z-50 flex justify-center px-3" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <label className="flex w-full max-w-md items-center gap-2 rounded-2xl bg-black/85 px-3 py-2 text-white shadow-2xl ring-1 ring-white/20 backdrop-blur">
        <FlaskConical className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
        <span className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-amber-300">Demo</span>
        <select value={stage} onChange={(e) => onStage(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[14px] text-white">
          {STAGES[kind].map((s) => <option key={s.id} value={s.id} className="text-black">{s.label}</option>)}
        </select>
      </label>
    </div>
  );
}
