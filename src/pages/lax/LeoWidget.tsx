/**
 * Leo on the trip pages: shared pieces (theme, greeting, the docked bar, SDK preload).
 *
 * 2026-10-11 (Jared: "Leo is the page"): the official ElevenLabs widget is retired here. Leo now opens as his own
 * full-screen conversation (LeoScreen.tsx) built on the ElevenLabs SDK, where his actions show up as cards with real
 * buttons and a short confirmation toast. This file keeps:
 * - THEME: one agent, two looks (LAX purple + peach, Home teal + mustard).
 * - leoGreeting: Leo's opening line from the trip's stage and key state.
 * - LeoBar: the docked bar that replaced "Talk to our team 24/7" ("Leo, 24/7 trip helper - real help": Call Leo,
 *   message, open). It hands LeoScreen how to open (takeLeoMode) and steps aside while Leo is open.
 * - preloadLeo: imports the SDK shortly after the trip page opens. iPhone only plays audio from an AudioContext unlocked
 *   inside a tap, and the SDK arms that unlock when it is imported, so it must be loaded before the guest's first tap.
 */
import { useEffect, useState } from "react";
import { Loader2, Maximize2, MessageCircle, Phone } from "lucide-react";
import type { TripContext } from "./AskSheet";

/** Leo's opening line: says who he is, then offers the two things that fit this moment of the trip. */
export function leoGreeting(ctx: TripContext | undefined, home: boolean): string {
  const hi = "Hi, I'm Leo, your trip helper.";
  const k = ctx?.keyState ?? null;
  if (k === "soon" || k === "making") return `${hi} Your key shows up once your host has checked your license. I can check where it's at, or walk you through pickup. What would help?`;
  if (k === "problem") return `${hi} Looks like your key hit a snag. Want me to check it and send a fresh one?`;
  if (k === "ready") return `${hi} Your key is ready. Want help adding the car to your Tesla app, or is the link giving you trouble?`;
  if (ctx?.stage === "pickup") return `${hi} I can help you unlock and start the car, or find ${home ? "where it's parked" : "your way into the garage"}. What do you need?`;
  if (ctx?.stage === "return") return `${hi} I can find you a Supercharger, or tell you how much charge to bring it back with. What do you need?`;
  return `${hi} I can help with your phone key, the car's A/C, charging, or anything about the trip. What do you need?`;
}

/** Leo's palette per page: LAX = deep purple, peach + pink. Home (WeHo) = deep teal, mustard + orange. */
export const THEME = {
  lax: { base: "#241A57", raised: "#2E2268", subtle: "#CFC8EC", accent: "#FFB878", onAccent: "#1A1140", error: "#FF9DB3", orb: ["#FFB878", "#E4527A"] },
  home: { base: "#1B3836", raised: "#224341", subtle: "#C3D6D3", accent: "#E8A93A", onAccent: "#132726", error: "#FFAA8E", orb: ["#E8A93A", "#E36F3C"] },
} as const;
export type LeoTheme = (typeof THEME)[keyof typeof THEME];

/** How Leo should open: dial right away, open ready to type, or just open. Set by LeoBar right before it opens. */
export type LeoMode = "call" | "chat" | "open";
let nextMode: LeoMode = "open";
export function takeLeoMode(): LeoMode { const m = nextMode; nextMode = "open"; return m; }

/** Leo's orb: a soft conic swirl with a feathered glow. */
export function LeoOrb({ theme, size = 40, live = false }: { theme: LeoTheme; size?: number; live?: boolean }) {
  const [o1, o2] = theme.orb;
  return (
    <span aria-hidden className={`block shrink-0 rounded-full ${live ? "leo-orb-live" : ""}`}
      style={{ width: size, height: size,
        background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,.85), rgba(255,255,255,0) 45%), conic-gradient(from 210deg, ${o1}, ${o2}, ${o1}, ${o2}, ${o1})`,
        boxShadow: `0 0 ${Math.round(size * 0.45)}px -${Math.round(size * 0.05)}px ${o1}99` }} />
  );
}

/**
 * The docked bar in the trip page's bottom dock (replaces "Talk to our team 24/7"): Leo's orb and line, then Call Leo,
 * message and open. While Leo is open (full screen or minimized to his pill) the bar keeps its space but hides.
 */
export function LeoBar({ home, onOpen }: { home: boolean; hidden?: boolean; onOpen: () => void }) {
  const t = THEME[home ? "home" : "lax"];
  const [phase, setPhase] = useState<{ k: "idle" } | { k: "opening"; m: LeoMode } | { k: "open" }>({ k: "idle" });
  useEffect(() => {
    const ready = () => setPhase({ k: "open" });
    const closed = () => setPhase({ k: "idle" });
    window.addEventListener("leo:ready", ready);
    window.addEventListener("leo:closed", closed);
    return () => { window.removeEventListener("leo:ready", ready); window.removeEventListener("leo:closed", closed); };
  }, []);

  const busy = phase.k === "opening";
  const go = (m: LeoMode) => { if (busy) return; nextMode = m; setPhase({ k: "opening", m }); onOpen(); };
  const spin = <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />;
  const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  const icon = `grid h-12 w-12 shrink-0 place-items-center rounded-full text-white ring-1 ring-white/25 transition-transform duration-100 active:scale-95 disabled:opacity-60 motion-reduce:transition-none ${ring}`;
  return (
    <div className={`rounded-[22px] p-3 ring-1 ring-white/15 transition-opacity duration-200 motion-reduce:transition-none ${phase.k === "open" ? "invisible opacity-0" : "opacity-100"}`}
      aria-hidden={phase.k === "open" || undefined} aria-busy={busy || undefined}
      style={{ background: t.base, boxShadow: "0 12px 32px -14px rgba(0,0,0,.75)" }}>
      <div className="flex items-center gap-3">
        <LeoOrb theme={t} />
        <p className="min-w-0 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-white">
          Leo, 24/7 trip helper <span className="whitespace-nowrap font-medium" style={{ color: t.subtle }}>- real help</span>
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => go("call")} disabled={busy}
          className={`flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full text-[17px] font-semibold transition-transform duration-100 active:scale-[0.98] disabled:opacity-90 motion-reduce:transition-none ${ring}`}
          style={{ background: t.accent, color: t.onAccent }}>
          {busy && phase.m === "call" ? <>{spin}<span className="whitespace-nowrap">Connecting</span></>
            : <><Phone className="h-5 w-5 shrink-0" aria-hidden /><span className="whitespace-nowrap">Call Leo</span></>}
        </button>
        <button type="button" aria-label="Message Leo" onClick={() => go("chat")} disabled={busy} className={icon}>
          {busy && phase.m === "chat" ? spin : <MessageCircle className="h-5 w-5" aria-hidden />}
        </button>
        <button type="button" aria-label="Open Leo" onClick={() => go("open")} disabled={busy} className={icon}>
          {busy && phase.m === "open" ? spin : <Maximize2 className="h-5 w-5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

/** Import the voice SDK early (idle, about 2 seconds after the trip page opens) so the guest's first tap unlocks audio. */
let sdk: Promise<typeof import("@elevenlabs/client")> | null = null;
export function loadLeoSdk() { return (sdk ??= import("@elevenlabs/client")); }
export function preloadLeo() {
  const go = () => { void loadLeoSdk().catch(() => { sdk = null; }); };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  window.setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : go()), 2000);
}
