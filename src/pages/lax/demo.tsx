/**
 * Demo trip pages for the host: /t/demo-home and /t/demo-lax. Everything is faked in the browser, so nothing
 * touches a real guest, car or message. ?stage=… jumps to a point in the trip; the bar at the bottom switches it.
 * One exception: for the host (signed-in admin, or the host link with ?dk=…) the "Add the car" button is a REAL
 * Tesla key for Blue Steel. Anyone who adds it is removed automatically (2 hours by default; Turo settings > Demo key).
 */
import { useEffect, useState } from "react";
import { FlaskConical, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_CAR } from "./GuestExtras";

const PASS_KEY = "bestly-demo-dk";
/** Host pass from the host link (?dk=…), remembered on this device and stripped from the address bar. */
export function demoPass(): string | null {
  try {
    const u = new URL(window.location.href);
    const q = u.searchParams.get("dk");
    if (q) {
      localStorage.setItem(PASS_KEY, q);
      document.cookie = `${PASS_KEY}=${encodeURIComponent(q)}; max-age=${365 * 864e2}; path=/t; SameSite=Lax; Secure`;
      u.searchParams.delete("dk"); history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
    const ls = localStorage.getItem(PASS_KEY);
    if (ls) return ls;
    // Backup copy in a cookie: restores the host pass if Safari cleared local storage.
    const c = document.cookie.split("; ").find((x) => x.startsWith(`${PASS_KEY}=`));
    if (c) { const v = decodeURIComponent(c.split("=")[1]); localStorage.setItem(PASS_KEY, v); return v; }
    return null;
  } catch { return null; }
}
type RealKey = { state: string; link: string | null; keep_minutes?: number; expires_at?: string | null } | null;
/** null = not the host, so the pretend key is used. */
export let realKey: RealKey = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Promise.resolve: the Supabase builder is only a thenable (no .catch), and it sends nothing until awaited.
const rpc = (fn: string, args: Record<string, unknown>): Promise<{ data: any }> => Promise.resolve(supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ data: any }>);

/** Asks for the real demo key; re-asks every 10s while it's being made, every 5 min after. */
export function useRealDemoKey(enabled: boolean, onChange: () => void) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stop = false; let t = 0;
    const load = async () => {
      const { data } = await rpc("demo_key_get", { p_pass: demoPass() }).catch(() => ({ data: null }));
      if (stop) return;
      const next: RealKey = data && data.state !== "off" ? { state: data.state, link: data.link ?? null, keep_minutes: data.keep_minutes, expires_at: data.expires_at ?? null } : null;
      if (JSON.stringify(next) !== JSON.stringify(realKey)) { realKey = next; bump((n) => n + 1); onChange(); }
      t = window.setTimeout(load, next && !next.link ? 10e3 : 5 * 60e3);
    };
    load();
    return () => { stop = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return realKey;
}
/**
 * Record the tap on the real demo key.
 *
 * Without this the server could not tell a link nobody touched from one that was tapped and did
 * nothing — the page just kept asking "is a new driver there yet?" and a silent no looked exactly
 * like a broken key. demo_key_watchdog judges the outcome against the tap: no new driver ten
 * minutes later and it rotates the invite once and says what else stops a Tesla invite being
 * accepted (an account that already holds a key to this car, or the owner's own account).
 */
export async function realDemoKeyTapped(): Promise<void> {
  await rpc("demo_key_tap", { p_pass: demoPass() }).catch(() => ({ data: null }));
}

/** After the tap on a real demo key: true once Tesla shows a new driver. */
export async function realDemoKeyAdded(): Promise<boolean> {
  const { data } = await rpc("demo_key_check", { p_pass: demoPass() }).catch(() => ({ data: null }));
  return data?.state === "added";
}

export const isDemo = (token?: string) => !!token && token.startsWith("demo-");
export const demoKind = (token: string): "home" | "lax" => (token.startsWith("demo-lax") ? "lax" : "home");

export const STAGES: Record<"home" | "lax", { id: string; label: string }[]> = {
  home: [
    { id: "booked", label: "Booked (3 days out)" },
    { id: "key-soon", label: "3 hours before" },
    { id: "key-ready", label: "Pickup soon: key ready (tap it to add)" },
    { id: "on-way", label: "On the way (30 min before, key added)" },
    { id: "on-trip", label: "On the trip (2½ days left)" },
    { id: "return-2d", label: "2 days before return (car check turns on)" },
    { id: "returning", label: "Return in 90 min" },
    { id: "returning-ok", label: "Return in 90 min (charged)" },
    { id: "grace", label: "Just past return time (30-min buffer)" },
    { id: "ended", label: "Trip ended (30+ min after)" },
  ],
  lax: [
    { id: "booked", label: "Booked (3 days out)" },
    { id: "day-of", label: "Pickup soon: key ready (tap it to add)" },
    { id: "on-way", label: "On the way (30 min before, key added)" },
    { id: "on-trip", label: "On the trip (2½ days left)" },
    { id: "return-2d", label: "2 days before return (car check turns on)" },
    { id: "returning", label: "Return in 90 min" },
    { id: "returning-ok", label: "Return in 90 min (charged)" },
    { id: "grace", label: "Just past return time (30-min buffer)" },
    { id: "ended", label: "Trip ended (30+ min after)" },
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

const anchor = { stage: "", t: 0 };
/** A fake lax_guest_public() answer for the chosen stage. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** Demo weather: what the climate buttons look like when it's hot, cold or nice. Host-only switch in the DemoBar. */
export type DemoWeather = "hot" | "cold" | "nice";
export const DEMO_WEATHER: { id: DemoWeather; label: string; inside_f: number; outside_f: number }[] = [
  { id: "hot", label: "Hot · A/C", inside_f: 97, outside_f: 84 },
  { id: "cold", label: "Cold · heat", inside_f: 46, outside_f: 49 },
  { id: "nice", label: "Nice · none", inside_f: 71, outside_f: 70 },
];
export function demoWeather(): DemoWeather {
  try { const w = sessionStorage.getItem("demo-weather"); if (w === "hot" || w === "cold" || w === "nice") return w; } catch { /* ignore */ }
  return "hot";
}
export function useDemoWeather(): [DemoWeather, (w: DemoWeather) => void] {
  const [w, setW] = useState<DemoWeather>(demoWeather);
  return [w, (x) => { try { sessionStorage.setItem("demo-weather", x); } catch { /* ignore */ } setW(x); }];
}

export function demoPub(kind: "home" | "lax", stage: string): any {
  const now = Date.now();
  // Trip times are pinned when a stage is picked, so the minute refresh never shifts them; the page then runs in real time.
  if (anchor.stage !== stage) { anchor.stage = stage; anchor.t = now; }
  const startIn: Record<string, number> = { booked: 72 * H, "key-soon": 3 * H, "key-ready": 1.5 * H, "key-added": 0.5 * H, "day-of": 1.5 * H, "on-way": 0.5 * H, "on-trip": -12 * H, "return-2d": -26 * H, returning: -70.5 * H, "returning-ok": -70.5 * H, grace: -72.25 * H, ended: -74 * H };
  const s = anchor.t + (startIn[stage] ?? 72 * H);
  const e = s + 72 * H;
  const trip = { first: "Demo", starts_at: iso(s), ends_at: iso(e), car_opens_at: iso(s - H) };
  const keyOpens = s - 2 * H;
  let added = false; try { added = sessionStorage.getItem("demo-key-added") === "1"; } catch { /* ignore */ }
  const controlsOn = (now >= s - H && now < e) || added;
  const controls_state = now >= e ? "ended" : controlsOn ? "on" : "soon";
  let keyState = stage === "booked" || stage === "key-soon" ? "soon" : stage === "key-ready" || stage === "day-of" ? (added ? "added" : "ready") : stage === "ended" ? "ended" : "added";
  // Host: the button is a real Tesla key ("making" for the few seconds a fresh invite takes).
  const real = keyState === "ready" && realKey ? realKey : null;
  if (real && !real.link) keyState = "making";
  const key = { state: keyState, opens_at: iso(keyOpens), link: keyState === "ready" ? (real?.link ?? "#demo-key") : null, expires_at: keyState === "ready" ? (real?.expires_at ?? iso(now + 23 * H)) : null, unlock: false, real: !!real };
  const base = {
    ok: true, kind, trip, car: (() => { const w = DEMO_WEATHER.find((x) => x.id === demoWeather())!; return { ...DEMO_CAR, inside_f: w.inside_f, outside_f: w.outside_f, observed_at: iso(now - 3 * 60e3) }; })(), controls: controls_state === "on", controls_state,
    controls_opens_at: iso(s - H), email: null, reminder_at: null, reminder_sent_at: null, pickup_battery: now >= s ? (stage === "returning" ? 90 : 76) : null, pickup_battery_at: now >= s ? iso(s) : null, car_connected_at: now >= s ? iso(s + 10 * 60e3) : null, demo: true,
    range_check: now >= s && now < e + 0.5 * H ? { range_mi: 188, miles: 6.4, spare: 182, status: "ok" } : null,
    charging: now < s ? null : demoCharging(s, now >= e),
    battery_health: { score: "good", pct: 80, range_full: 192 },
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
    ...base, key, ready: true, payload: "BESTLY-DEMO-QR", note: null, google: false, code_for_trip_month: true,
    valid_through: (() => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10); })(), // QR codes expire at the end of the month
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
export function DemoBar({ kind, stage, onStage, weather, onWeather }: { kind: "home" | "lax"; stage: string; onStage: (s: string) => void; weather?: DemoWeather; onWeather?: (w: DemoWeather) => void }) {
  return (
    <div className="fixed inset-x-0 bottom-[8.5rem] z-40 flex justify-center px-3" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <label className="flex w-full max-w-md items-center gap-2 rounded-2xl bg-black/85 px-3 py-2 text-white shadow-2xl ring-1 ring-white/20 backdrop-blur">
        <FlaskConical className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
        <span className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-amber-300">Demo</span>
        <select value={stage} onChange={(e) => onStage(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[14px] text-white">
          {STAGES[kind].map((s) => <option key={s.id} value={s.id} className="text-black">{s.label}</option>)}
        </select>
        {onWeather && (
          <select value={weather} onChange={(e) => onWeather(e.target.value as DemoWeather)} aria-label="Demo weather"
            className="w-[7.5rem] shrink-0 rounded-lg bg-white/10 px-2 py-1.5 text-[14px] text-white">
            {DEMO_WEATHER.map((w) => <option key={w.id} value={w.id} className="text-black">{w.label}</option>)}
          </select>
        )}
        {realKey && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-1 text-[12px] font-semibold text-emerald-300 ring-1 ring-emerald-300/30"
            title={`Real Tesla key. Anyone who adds it is removed after ${Math.round((realKey.keep_minutes ?? 120) / 60 * 10) / 10} hr.`}>
            <KeyRound className="h-3.5 w-3.5" aria-hidden /> Real key
          </span>
        )}
      </label>
    </div>
  );
}
