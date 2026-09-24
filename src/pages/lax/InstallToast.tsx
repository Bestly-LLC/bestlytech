/**
 * "Put this trip on your Home Screen" toast for the trip pages.
 *  - iPhone/iPad Safari: can't install from a button, so we show how, with an arrow bouncing toward
 *    Safari's menu (bottom-right on iPhone, top-right on iPad): ••• / Share → "Add to Home Screen".
 *    Shows our real icon so they know what they'll get, and why: trip alerts (key ready, return time).
 *  - Android Chrome: the real "Install" button (beforeinstallprompt).
 *  - Already on the Home Screen: a one-tap "Turn on trip alerts" card instead (push needs a tap).
 * Shows once after a short delay; "Not now" hides it for 3 days. Never in the demo's first seconds of a stage switch.
 */
import { useEffect, useState } from "react";
import { BellRing, MoreHorizontal, Plus, Share, X } from "lucide-react";
import { track } from "./track";
import { enableTripPush, refreshTripPush, tripPushState } from "./tripPush";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const ACCENT = "var(--trip-accent)";
const KEY = "a2hs-dismissed";
const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);
const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
const isIPad = () => /iPad/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
const isSafari = () => isIOS() && !/CriOS|FxiOS|EdgiOS|GSA\//.test(ua());
const standalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const snoozed = () => { try { return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < 3 * 864e5; } catch { return false; } };

export function InstallToast({ token, kind }: { token: string; kind: "home" | "lax" }) {
  const [show, setShow] = useState(false);
  const [bip, setBip] = useState<BIP | null>(null);
  const [mode, setMode] = useState<"ios" | "android" | "alerts" | null>(null);
  const [busy, setBusy] = useState(false);
  const icon = kind === "home" ? "/wallet/home/apple-touch-icon.png" : "/wallet/lax/apple-touch-icon.png";

  useEffect(() => {
    if (!token) return;
    // Preview: add ?a2hs=1 (or ?a2hs=alerts) to any trip page, demo included.
    const force = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("a2hs") : null;
    if (force) { const t0 = window.setTimeout(() => { setMode(force === "alerts" ? "alerts" : "ios"); setShow(true); }, 1200); return () => window.clearTimeout(t0); }
    if (token.startsWith("demo-")) return;
    if (standalone()) void refreshTripPush(token); // keep an already-on subscription fresh
    if (snoozed()) return;
    const f = (e: Event) => { e.preventDefault(); setBip(e as BIP); setMode("android"); };
    window.addEventListener("beforeinstallprompt", f);
    let t = 0;
    (async () => {
      if (standalone()) {
        const st = await tripPushState();
        if (st === "off") { setMode("alerts"); t = window.setTimeout(() => setShow(true), 2500); }
        return;
      }
      if (isSafari()) { setMode("ios"); t = window.setTimeout(() => setShow(true), 6000); }
    })();
    const t2 = window.setTimeout(() => { if (!isSafari() && !standalone()) setShow(true); }, 6000);
    return () => { window.removeEventListener("beforeinstallprompt", f); window.clearTimeout(t); window.clearTimeout(t2); };
  }, [token]);

  const close = () => { setShow(false); try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } track(token, "a2hs_dismiss", { mode }); };
  if (!show || !mode) return null;

  const turnOn = async () => {
    setBusy(true);
    const st = await enableTripPush(token).catch(() => "off" as const);
    setBusy(false);
    track(token, "push_enable", { result: st });
    if (st === "on") setShow(false);
  };

  return (
    <>
      {/* iPhone: arrow bouncing at Safari's ••• button (bottom right). iPad: top right. */}
      {mode === "ios" && (
        <div aria-hidden className={`pointer-events-none fixed z-[61] ${isIPad() ? "right-4 top-2" : "bottom-1 right-5"}`} style={isIPad() ? {} : { paddingBottom: "env(safe-area-inset-bottom)" }}>
          <svg viewBox="0 0 40 56" className={`h-14 w-10 ${isIPad() ? "rotate-180" : ""} trip-a2hs-arrow`} style={{ color: "#fff", filter: "drop-shadow(0 0 8px var(--trip-accent))" }}>
            <path d="M20 4 V44 M8 32 L20 46 L32 32" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <div role="dialog" aria-label="Add this trip to your Home Screen" className="fixed inset-x-0 z-[60] flex justify-center px-3"
        style={{ bottom: isIPad() ? "auto" : "calc(env(safe-area-inset-bottom) + 64px)", top: isIPad() ? 64 : "auto" }}>
        <div className="trip-glass w-full max-w-md rounded-3xl p-4 text-white shadow-2xl" style={{ background: "linear-gradient(160deg, rgba(255,255,255,.22), rgba(255,255,255,.08)), rgba(14,12,28,.86)" }}>
          <div className="flex items-start gap-3">
            <img src={icon} alt="" className="h-14 w-14 shrink-0 rounded-[14px] shadow-lg ring-1 ring-white/20" />
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-bold leading-snug">{mode === "alerts" ? "Turn on trip alerts" : "Add your trip to your Home Screen"}</p>
              <p className="mt-0.5 text-[14px] leading-snug text-white/80">
                {mode === "alerts" ? "Get a nudge when your key is ready and when it's time to return." : "One tap to open it, and alerts when your key is ready and when it's time to return."}
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Not now" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10"><X className="h-4 w-4" /></button>
          </div>
          {mode === "ios" && (
            <ol className="mt-3 grid grid-cols-3 gap-2 text-center text-[12px] leading-tight text-white/85">
              <li className="rounded-2xl bg-white/10 px-1.5 py-2.5"><span className="mx-auto mb-1.5 grid h-8 w-8 place-items-center rounded-full bg-white/15"><MoreHorizontal className="h-4 w-4" /></span>1. Tap <b className="text-white">•••</b> {isIPad() ? "up top" : "below"}</li>
              <li className="rounded-2xl bg-white/10 px-1.5 py-2.5"><span className="mx-auto mb-1.5 grid h-8 w-8 place-items-center rounded-full bg-white/15"><Share className="h-4 w-4" /></span>2. Tap <b className="text-white">Share</b></li>
              <li className="rounded-2xl bg-white/10 px-1.5 py-2.5"><span className="mx-auto mb-1.5 grid h-8 w-8 place-items-center rounded-full bg-white/15"><Plus className="h-4 w-4" /></span>3. <b className="text-white">Add to Home Screen</b></li>
            </ol>
          )}
          {mode === "ios" && <p className="mt-2 text-center text-[12px] text-white/60">Don't see •••? Tap the Share button <Share className="inline h-3 w-3" /> in Safari's toolbar.</p>}
          {mode === "android" && bip && (
            <button type="button" onClick={async () => { await bip.prompt(); const c = await bip.userChoice; track(token, "a2hs_android", { outcome: c.outcome }); setShow(false); }}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#1A1140]" style={{ background: ACCENT }}>
              <Plus className="h-4 w-4" /> Add to Home Screen
            </button>
          )}
          {mode === "alerts" && (
            <button type="button" onClick={() => void turnOn()} disabled={busy}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#1A1140] disabled:opacity-60" style={{ background: ACCENT }}>
              <BellRing className="h-4 w-4" /> {busy ? "Turning on…" : "Turn on alerts"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
