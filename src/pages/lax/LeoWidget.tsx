/**
 * Leo on the trip pages: shared pieces (theme, greeting, the docked bar, SDK preload).
 *
 * 2026-10-11 (Jared: "Leo is the page"): the official ElevenLabs widget is retired here. Leo now opens as his own
 * full-screen conversation (LeoScreen.tsx) built on the ElevenLabs SDK, where his actions show up as cards with real
 * buttons and a short confirmation toast. This file keeps:
 * - THEME: one agent, two looks (LAX purple + peach, Home teal + mustard).
 * - leoGreeting: Leo's opening line from the trip's stage, key state, car and timing (leoOffer.ts).
 * - LeoBar: the docked bar that replaced "Talk to our team 24/7" ("Leo, 24/7 trip helper - real help": Call Leo,
 *   message, open). It hands LeoScreen how to open (takeLeoMode) and steps aside while Leo is open.
 * - preloadLeo: imports the SDK shortly after the trip page opens. iPhone only plays audio from an AudioContext unlocked
 *   inside a tap, and the SDK arms that unlock when it is imported, so it must be loaded before the guest's first tap.
 */
import { useEffect, useState } from "react";
import { Loader2, Maximize2, MessageCircle, Phone } from "lucide-react";
import type { TripContext } from "./AskSheet";
import { installAudioRescue } from "@/lib/audioRescue";
import { leoOpening } from "./leoOffer";

// Before the SDK can load: track its audio contexts so a stuck (silent) one resumes on the next tap. See src/lib/audioRescue.ts.
installAudioRescue();

/** Leo's opening line: says who he is, then offers the one thing that fits this moment of the trip (see leoOffer.ts). */
export function leoGreeting(ctx: TripContext | undefined, _home: boolean): string {
  return leoOpening(ctx ?? {}).text;
}

/** Leo's palette per page: LAX = deep purple, peach + pink. Home (WeHo) = deep teal, mustard + orange. */
export const THEME = {
  lax: { base: "#241A57", raised: "#2E2268", subtle: "#CFC8EC", accent: "#FFB878", onAccent: "#1A1140", error: "#FF9DB3", orb: ["#FFB878", "#E4527A"] },
  home: { base: "#1B3836", raised: "#224341", subtle: "#C3D6D3", accent: "#E8A93A", onAccent: "#132726", error: "#FFAA8E", orb: ["#E8A93A", "#E36F3C"] },
  // Delivery: the printed card's ink (#13282A) with its orange orb. The trip page itself is cream; Leo's full-screen sheet stays dark ink so every shared white-on-dark card in it keeps its contrast.
  delivery: { base: "#13282A", raised: "#1D3638", subtle: "#D3DEDB", accent: "#EDB253", onAccent: "#13282A", error: "#FFAA8E", orb: ["#EDB253", "#E2733A"] },
} as const;
export type LeoTheme = { base: string; raised: string; subtle: string; accent: string; onAccent: string; error: string; orb: readonly [string, string] };

/** How Leo should open: dial right away, open ready to type, or just open. Set by LeoBar right before it opens. */
export type LeoMode = "call" | "chat" | "open";
let nextMode: LeoMode = "open";
export function takeLeoMode(): LeoMode { const m = nextMode; nextMode = "open"; return m; }
/** Set how Leo opens next (the link-down page opens him directly, without the docked bar). */
export function setLeoMode(m: LeoMode) { nextMode = m; }

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
  // Minimized Leo (2026-10-11, Jared): the pill lives here in the dock, where Leo sits before he's opened.
  const [mini, setMini] = useState<LeoMini | null>(null);
  useEffect(() => {
    const ready = () => setPhase({ k: "open" });
    const closed = () => { setPhase({ k: "idle" }); setMini(null); };
    const onMini = (e: Event) => setMini((e as CustomEvent<LeoMini | null>).detail ?? null);
    window.addEventListener("leo:ready", ready);
    window.addEventListener("leo:closed", closed);
    window.addEventListener("leo:mini", onMini);
    return () => { window.removeEventListener("leo:ready", ready); window.removeEventListener("leo:closed", closed); window.removeEventListener("leo:mini", onMini); };
  }, []);

  const busy = phase.k === "opening";
  const go = (m: LeoMode) => { if (busy) return; nextMode = m; setPhase({ k: "opening", m }); onOpen(); };
  const spin = <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />;
  const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  const icon = `grid h-12 w-12 shrink-0 place-items-center rounded-full text-white ring-1 ring-white/25 transition-transform duration-100 active:scale-95 disabled:opacity-60 motion-reduce:transition-none ${ring}`;

  if (phase.k === "open" && mini) return <LeoMiniPill theme={t} mini={mini} />;
  return (
    <div data-leo-bar className={`rounded-[22px] p-3 ring-1 ring-white/15 transition-opacity duration-200 motion-reduce:transition-none ${phase.k === "open" ? "invisible opacity-0" : "opacity-100"}`}
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

/** What minimized Leo shows: his status line, and whether he's talking (the orb breathes). Sent by LeoScreen as `leo:mini`. */
export type LeoMini = { label: string; live: boolean };

/**
 * Minimized Leo: one row in the dock (orb, name, status, open). Tapping it sends `leo:restore` and LeoScreen
 * comes back full screen. `floating` pins it to the bottom of the screen for pages without the dock bar.
 */
export function LeoMiniPill({ theme, mini, floating = false }: { theme: LeoTheme; mini: LeoMini; floating?: boolean }) {
  return (
    <button type="button" data-leo-bar={floating ? undefined : ""} onClick={() => window.dispatchEvent(new Event("leo:restore"))} aria-label={`Back to Leo, ${mini.label}`}
      className={`flex min-h-14 w-full items-center gap-3 rounded-full px-2 py-2 text-left text-white ring-1 ring-white/20 transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${floating ? "fixed inset-x-4 z-[70] mx-auto w-auto max-w-md" : ""}`}
      style={{ background: theme.base, boxShadow: `0 12px 32px -14px rgba(0,0,0,.75), 0 0 28px -10px ${theme.orb[0]}`,
        ...(floating ? { bottom: "max(12px, env(safe-area-inset-bottom))" } : {}) }}>
      <LeoOrb theme={theme} size={40} live={mini.live} />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <span className="whitespace-nowrap text-[17px] font-semibold tracking-[-0.01em]">Leo</span>
        <span className="whitespace-nowrap text-[15px] font-medium" style={{ color: theme.subtle }}>{mini.label}</span>
      </span>
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ring-white/25">
        <Maximize2 className="h-[18px] w-[18px]" />
      </span>
    </button>
  );
}

/** Import the voice SDK as soon as the trip page opens, so its iPhone audio unlock is armed before the guest's first tap.
 * (It used to wait 2 to 6 seconds; a quick tap on Call Leo beat it and the call was silent.) */
let sdk: Promise<typeof import("@elevenlabs/client")> | null = null;
export function loadLeoSdk() { return (sdk ??= import("@elevenlabs/client")); }
export function preloadLeo() {
  void loadLeoSdk().catch(() => { sdk = null; });
}
