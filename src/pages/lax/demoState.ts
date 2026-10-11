/**
 * One shared pretend car for the demo trip pages (/t/demo-lax, /t/demo-home), plus the "open demo" switch.
 *
 * Why this exists (2026-10-11): the demo page's buttons used to keep their own little fake state while Leo's tools
 * drove a separate pretend car on the server, so Leo could turn the A/C on and the page never showed it. Now the page
 * buttons AND Leo's results (the `leo:car` event) write here, and demoPub() reads from here, so there is one truth.
 * No imports on purpose: GuestExtras and demo.tsx both use it, and they import each other.
 */
import { useSyncExternalStore } from "react";

export type DemoClimateMode = "cool" | "warm" | "seat";
type Store = {
  climate: { mode: DemoClimateMode; until: string } | null;
  locked: boolean;
  battery: number | null; range: number | null; inside_f: number | null;
  open: boolean; openUntil: string | null;
};
let store: Store = { climate: null, locked: true, battery: null, range: null, inside_f: null, open: false, openUntil: null };
let version = 0;
const subs = new Set<() => void>();
const emit = () => { version++; subs.forEach((f) => { try { f(); } catch { /* a listener must never break the others */ } }); };
const set = (patch: Partial<Store>) => { store = { ...store, ...patch }; emit(); };

export const CLIMATE_MINUTES = 20;
export const demoStore = () => store;
export function subscribeDemo(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
/** Re-renders when the demo car or the open switch changes. */
export function useDemoVersion(): number { return useSyncExternalStore(subscribeDemo, () => version, () => 0); }
export function useDemoOpen(): { open: boolean; until: string | null } {
  useDemoVersion();
  return { open: store.open, until: store.openUntil };
}

export function setDemoClimate(mode: DemoClimateMode | "off", until?: string) {
  set({ climate: mode === "off" ? null : { mode, until: until ?? new Date(Date.now() + CLIMATE_MINUTES * 60000).toISOString() } });
}
export function setDemoLocked(locked: boolean) { set({ locked }); }
/** The host switched the demo weather: forget any cabin temperature Leo's status card set. */
export function clearDemoInside() { if (store.inside_f != null) set({ inside_f: null }); }
export function setDemoOpen(open: boolean, until: string | null) { if (store.open !== open || store.openUntil !== until) set({ open, openUntil: open ? until : null }); }

const LA = "America/Los_Angeles";
/** "11:18 AM" (a Leo card's time) -> an ISO time within the next ~hour, on the same minute. null if it can't be read. */
function untilFromLabel(label: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M?$/i.exec(String(label ?? "").trim());
  if (!m) return null;
  let h = Number(m[1]) % 12; if (/p/i.test(m[3])) h += 12;
  const want = h * 60 + Number(m[2]);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: LA, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
  const nowMin = (Number(parts.find((p) => p.type === "hour")?.value) % 24) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
  const diff = (want - nowMin + 1440) % 1440;
  if (diff > 60) return null;
  const t = Date.now();
  return new Date(t - (t % 60000) + diff * 60000).toISOString();
}

type Any = Record<string, unknown>;
/** A car tool result from Leo (or a card button): fold it into the pretend car so the page shows the same thing. */
export function applyLeoCar(result: Any | null | undefined): boolean {
  const card = (result?.card ?? null) as (Any & { type?: string }) | null;
  if (!card || typeof card.type !== "string") return false;
  switch (card.type) {
    case "climate": {
      const mode = String(card.mode ?? "off");
      const on = !!card.on && mode !== "off" && (mode === "cool" || mode === "warm" || mode === "seat");
      if (on) setDemoClimate(mode as DemoClimateMode, String(card.until_iso ?? "") && !Number.isNaN(+new Date(String(card.until_iso))) ? String(card.until_iso) : untilFromLabel(card.until) ?? undefined);
      else setDemoClimate("off");
      return true;
    }
    case "lock": set({ locked: !!card.locked }); return true;
    case "unlock": set({ locked: false }); return true;
    case "car": {
      const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
      set({
        battery: num(card.battery) ?? store.battery, range: num(card.range_mi) ?? store.range, inside_f: num(card.inside_f) ?? store.inside_f,
        locked: typeof card.locked === "boolean" ? card.locked : store.locked,
      });
      return true;
    }
  }
  return false;
}
