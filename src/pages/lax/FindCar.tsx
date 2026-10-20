/**
 * Find the Car: Find My-style precision finding for the guest pages (Home + LAX), themed per page.
 * 1. Explainer sheet (asks for location + motion only after "Continue").
 * 2. Finding: a big arrow from the phone's GPS + compass toward the car's last spot, huge distance, Honk / Flash.
 *    The whole screen changes color when you face the car (LAX: sunset, Home: teal-green).
 * 3. Found (within ~30 ft): "You're There" + Flash / Honk + Next.
 * Fallbacks: no compass, Motion or Location denied → distance + Open in Maps (the arrow comes back if the compass
 *   shows up late). Old spot (> 6 h) → says so and points to Honk. Inside the GPS error circle → "Right around here".
 * Demo pages: fully simulated (no location asked), so the host can see the whole flow anywhere.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BellRing, Check, Flashlight, Loader2, MapPin, Navigation, X } from "lucide-react";
import { track } from "./track";
import { Lines } from "@/components/Lines";

type Spot = { lat: number; lon: number; observed_at: string };
type Act = "honk" | "flash";
type Run = (a: Act, onStage?: (s: string) => void) => Promise<void>;
type Kind = "home" | "lax";

const THEME: Record<Kind, CSSProperties & Record<string, string>> = {
  lax: {
    "--fc-bg": "linear-gradient(180deg,#2B1A73 0%,#1A1140 70%)", "--fc-start": "linear-gradient(180deg,#2B1A73 0%,#1A1140 60%)",
    "--fc-aligned": "linear-gradient(180deg,#7A2E9E 0%,#E4527A 55%,#FFB878 130%)", "--fc-found": "linear-gradient(180deg,#E4527A 0%,#B8387A 40%,#2B1A73 100%)",
    "--fc-accent": "#FFB878", "--fc-accent2": "#E4527A", "--fc-on": "#1A1140", "--fc-font": "Inter, -apple-system, system-ui, sans-serif",
  },
  home: {
    "--fc-bg": "linear-gradient(180deg,#1f4442 0%,#132726 70%)", "--fc-start": "linear-gradient(180deg,#1f4442 0%,#132726 60%)",
    "--fc-aligned": "linear-gradient(180deg,#2a6b66 0%,#3f8f6a 55%,#E8A93A 135%)", "--fc-found": "linear-gradient(180deg,#E36F3C 0%,#C9602F 35%,#1f4442 100%)",
    "--fc-accent": "#E8A93A", "--fc-accent2": "#E36F3C", "--fc-on": "#132726", "--fc-font": "'Josefin Sans', Futura, 'Avenir Next', sans-serif",
  },
};

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
// -180..180 for ANY input. The old ((d + 540) % 360) - 180 went out of range below -540 (JS % keeps the sign).
export const norm = (d: number) => ((((d % 360) + 540) % 360) - 180);
const fmtDist = (m: number) => { const ft = m * 3.281; return ft < 1000 ? { n: String(Math.max(0, Math.round(ft / 5) * 5)), u: "ft" } : { n: (m / 1609.34).toFixed(1), u: "mi" }; };
const hintFor = (rel: number) => (Math.abs(rel) < 15 ? "ahead" : Math.abs(rel) > 150 ? "behind you" : rel > 0 ? "to your right" : "to your left");
const FOUND_M = 10; // about 30 ft
const FOUND_ACC = 25; // GPS must be good to about 80 ft before we say "You're There"
const mapsFor = (lat: number, lon: number) =>
  /iPhone|iPad|Mac/.test(navigator.userAgent) ? `https://maps.apple.com/?q=Your%20Turo%20Tesla&ll=${lat},${lon}&dirflg=w` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;

/** iOS asks for Motion access; everyone else just says yes. "denied" sticks for the Safari session. */
async function askMotion(): Promise<"granted" | "denied"> {
  const D = (typeof window !== "undefined" ? (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent : undefined);
  if (D && typeof D.requestPermission === "function") { try { return (await D.requestPermission()) === "granted" ? "granted" : "denied"; } catch { return "denied"; } }
  return "granted";
}

/** How far the screen is turned from portrait (0, 90, 180, 270), so a sideways phone still points right. */
function screenAngle() {
  const so = typeof screen !== "undefined" ? (screen as Screen & { orientation?: { angle?: number } }).orientation : undefined;
  if (so && typeof so.angle === "number") return so.angle;
  const wo = (window as unknown as { orientation?: number }).orientation;
  return typeof wo === "number" ? wo : 0;
}

/** One orientation event → compass heading (0 = north) and iOS accuracy, or null if this event has no real heading. */
export function readHeading(e: { webkitCompassHeading?: number; webkitCompassAccuracy?: number; absolute?: boolean | null; type?: string; alpha?: number | null }, angle = 0) {
  let v: number | null = null, acc: number | null = null;
  if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading) && e.webkitCompassHeading >= 0) {
    v = e.webkitCompassHeading;
    acc = typeof e.webkitCompassAccuracy === "number" ? e.webkitCompassAccuracy : null;
  } else if ((e.absolute || e.type === "deviceorientationabsolute") && typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
    v = 360 - e.alpha;
  }
  if (v == null) return null;
  return { h: (((v + angle) % 360) + 360) % 360, acc };
}

/**
 * Compass heading, smoothed. null until the phone reports one.
 * Events arrive ~60 times a second; we smooth every one but only re-render once per frame,
 * and only when the heading moved half a degree (the old version re-rendered the whole
 * full-screen sheet on every event, which is what made the arrow stutter and lag).
 */
function useHeading(on: boolean) {
  const [s, setS] = useState<{ h: number; acc: number | null } | null>(null);
  useEffect(() => {
    if (!on) { setS(null); return; }
    let last: number | null = null, acc: number | null = null, shown: number | null = null, shownAcc: number | null = null, raf = 0;
    const flush = () => {
      raf = 0;
      if (last == null) return;
      if (shown == null || Math.abs(norm(last - shown)) >= 0.5 || acc !== shownAcc) { shown = last; shownAcc = acc; setS({ h: last, acc }); }
    };
    const f = (e: Event) => {
      const r = readHeading(e as DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number }, screenAngle());
      if (!r) return;
      acc = r.acc;
      last = last == null ? r.h : (((last + norm(r.h - last) * 0.25) % 360) + 360) % 360;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    window.addEventListener("deviceorientationabsolute", f);
    window.addEventListener("deviceorientation", f);
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener("deviceorientationabsolute", f); window.removeEventListener("deviceorientation", f); };
  }, [on]);
  return s;
}

function usePosition(on: boolean) {
  const [p, setP] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (!on) { setP(null); setErr(null); setDenied(false); return; }
    if (!navigator.geolocation) { setErr("This browser can't share your location."); setDenied(true); return; }
    const id = navigator.geolocation.watchPosition(
      (x) => { setErr(null); setDenied(false); setP({ lat: x.coords.latitude, lon: x.coords.longitude, acc: x.coords.accuracy }); },
      (e) => { if (e.code === 1) { setDenied(true); setErr("Location is off for this page."); } else setErr("Can't find your location right now."); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [on]);
  return { p, err, denied };
}

function Pill({ act, run, demo, token }: { act: Act; run?: Run; demo?: boolean; token?: string }) {
  const [st, setSt] = useState<"idle" | "busy" | "done" | string>("idle");
  const Icon = act === "honk" ? BellRing : Flashlight;
  const go = async () => {
    if (st === "busy") return;
    setSt("busy"); track(token, "find_car_" + act);
    try { if (demo || !run) await new Promise((r) => setTimeout(r, 900)); else await run(act); setSt("done"); window.setTimeout(() => setSt("idle"), 2500); }
    catch (e) { setSt((e as Error).message || "Couldn't reach the car"); window.setTimeout(() => setSt("idle"), 5000); }
  };
  const label = act === "honk" ? "Honk" : "Flash";
  return (
    <div className="flex flex-1 flex-col items-center">
      <button type="button" onClick={() => void go()} disabled={!run && !demo}
        className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-white/[0.14] text-[16px] font-semibold text-white ring-1 ring-inset ring-white/20 transition active:scale-95 disabled:opacity-40 motion-reduce:transition-none">
        {st === "busy" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : st === "done" ? <Check className="h-5 w-5" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
        {st === "done" ? (act === "honk" ? "Honked" : "Flashed") : label}
      </button>
      {st !== "idle" && st !== "busy" && st !== "done" && <p className="mt-1 text-center text-[12px] leading-snug text-white/85" role="alert">{st}</p>}
    </div>
  );
}

export function FindCar({ open, onClose, kind, spot: spotProp, run, demo, token, where, onNext, nextLabel }: {
  open: boolean; onClose: () => void; kind: Kind; spot: Spot | null; run?: Run; demo?: boolean; token?: string;
  where: string; onNext?: () => void; nextLabel?: string;
}) {
  const [phase, setPhase] = useState<"start" | "find" | "found">("start");
  const live = open && phase !== "start" && !demo;
  const hs = useHeading(live);
  const heading = hs?.h ?? null;
  const { p, err, denied: locDenied } = usePosition(live);
  const [noCompass, setNoCompass] = useState(false);
  const [motionDenied, setMotionDenied] = useState(false);
  const spun = useRef(0); // cumulative arrow angle (no 359° → 0° spins)
  const [sim, setSim] = useState({ m: 98, rel: 62 });
  const buzzed = useRef(false);
  const disarmed = useRef(false); // after "Back to the arrow": don't jump straight back to "You're There"
  // Keep the last spot while open, so a page refresh that briefly has no spot can't break the arrow mid-walk.
  const lastSpot = useRef<Spot | null>(null);
  if (spotProp) lastSpot.current = spotProp;
  const spot = spotProp ?? (open ? lastSpot.current : null);

  useEffect(() => { if (!open) { setPhase("start"); setNoCompass(false); setMotionDenied(false); buzzed.current = false; disarmed.current = false; } }, [open]);
  useEffect(() => { if (open) track(token, "find_car_open"); }, [open, token]);
  useEffect(() => { // Escape closes
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  // No compass after 4 s of finding: show the distance + map instead of a wrong arrow.
  // The moment a heading shows up (slow compass, iOS calibration), the arrow comes back. The old version
  // set this once and never cleared it, so a late compass left the screen stuck on "No compass".
  const hasHeading = heading != null;
  useEffect(() => {
    if (!live) return;
    if (hasHeading) { setNoCompass(false); return; }
    const t = window.setTimeout(() => { setNoCompass(true); track(token, "find_car_no_compass"); }, 4000);
    return () => window.clearTimeout(t);
  }, [live, hasHeading, token]);
  // Demo: walk toward the car.
  useEffect(() => {
    if (!open || !demo || phase !== "find") return;
    const id = window.setInterval(() => setSim((s) => {
      const m = s.m > 12 ? s.m - 5 : 98;
      const rel = m === 98 ? 62 : s.rel + (0 - s.rel) * 0.28 + (Math.random() * 10 - 5);
      return { m, rel };
    }), 1100);
    return () => window.clearInterval(id);
  }, [open, demo, phase]);

  const m = demo ? sim.m : p && spot ? distM(p, spot) : null;
  const rel = demo ? sim.rel : p && spot && heading != null ? norm(bearing(p, spot) - heading) : null;
  const aligned = rel != null && Math.abs(rel) < 15;
  if (rel != null) spun.current += norm(rel - norm(spun.current));
  const staleH = spot ? (Date.now() - +new Date(spot.observed_at)) / 3600e3 : 0;

  // "You're There" needs a GPS fix good enough to trust (garage GPS can be 40+ ft off and used to fire early),
  // and after "Back to the arrow" the guest has to step away first, or the screen would bounce straight back.
  const pAcc = p?.acc ?? null;
  useEffect(() => {
    if (phase !== "find" || m == null) return;
    if (disarmed.current) { if (m > FOUND_M * 2) disarmed.current = false; return; }
    if (m <= FOUND_M && (demo || (pAcc != null && pAcc <= FOUND_ACC))) { setPhase("found"); track(token, "find_car_found"); }
  }, [m, phase, token, demo, pAcc]);
  useEffect(() => { if (aligned && !buzzed.current) { buzzed.current = true; navigator.vibrate?.(15); } if (!aligned) buzzed.current = false; }, [aligned]);

  if (!open) return null;
  const start = async () => {
    if (!demo) {
      const r = await askMotion();
      setMotionDenied(r === "denied");
      if (r === "denied") track(token, "find_car_motion_denied");
    }
    setPhase("find");
  };
  // Within the GPS error circle the bearing is noise, so say "right around here" instead of left/right.
  const close = !demo && m != null && p != null && m < Math.min(Math.max(p.acc, FOUND_M), 40);
  const calib = !demo && hs?.acc != null && (hs.acc < 0 || hs.acc > 25);
  const fallback = demo ? null
    : locDenied ? "Location is off for this page, so no arrow. Follow the map instead."
    : motionDenied ? "Motion access is off for this page, so no arrow. Follow the map instead."
    : noCompass && heading == null ? "No compass on this device, so no arrow. Follow the map instead."
    : null;
  const d = m != null ? fmtDist(m) : null;
  const map = spot ? mapsFor(spot.lat, spot.lon) : null;
  const titleFont = { fontFamily: "var(--fc-font)" };

  const body = (
    <div role="dialog" aria-modal="true" aria-label="Find the Car" className="fixed inset-0 z-[70] flex flex-col text-white" style={{ ...THEME[kind], background: phase === "found" ? "var(--fc-found)" : phase === "start" ? "var(--fc-start)" : "var(--fc-bg)" }}>
      {phase === "find" && <div aria-hidden className="pointer-events-none absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none" style={{ background: "var(--fc-aligned)", opacity: aligned && !close ? 1 : 0 }} />}
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-4" style={{ paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
        <div className="flex h-11 items-center justify-between">
          {phase === "start" ? <span /> : <button type="button" onClick={onClose} className="-ml-2 min-h-[44px] px-2 text-[17px] font-semibold" style={{ color: (aligned && !close) || phase === "found" ? "#fff" : "var(--fc-accent)" }}>Done</button>}
          {phase === "start" && <button type="button" onClick={onClose} aria-label="Close" className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white/[0.12] text-white/70"><X className="h-4 w-4" /></button>}
        </div>

        {phase === "start" && (
          <>
            <div className="relative mx-auto mt-6 grid h-[84px] w-[84px] place-items-center rounded-[20px] shadow-[0_12px_34px_rgba(0,0,0,.35)]" style={{ background: "linear-gradient(160deg,var(--fc-accent),var(--fc-accent2))" }}>
              {kind === "home" && <span aria-hidden className="absolute -inset-2 rounded-[26px] border-[1.5px] border-dashed border-[#E8A93A]/45" />}
              <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden><path d="M12 2 20 21 12 16.5 4 21Z" fill="#fff" /></svg>
            </div>
            <p className="mt-5 text-center text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--fc-accent)", ...titleFont }}>Pickup</p>
            <h2 className="mt-2 text-center text-[28px] font-bold leading-tight" style={titleFont}>Find the Car</h2>
            <p className="mx-3 mt-2 text-center text-[16px] leading-snug text-white/70">An arrow points you straight to the Tesla {where}.</p>
            <ul className="mt-6 overflow-hidden rounded-[14px] bg-white/[0.07] ring-1 ring-inset ring-white/10">
              {[["📍", "Uses your location only while this is open"], ["📱", "Hold your phone flat, top pointing ahead"], ["✨", kind === "lax" ? "The screen lights up like a sunset when you face it" : "The screen turns teal-green when you face it"]].map(([e, t], i) => (
                <li key={t} className={`flex min-h-[46px] items-center gap-3 px-3.5 py-2.5 ${i ? "border-t border-white/10" : ""}`}>
                  <span aria-hidden className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-lg bg-white/10 text-[16px]">{e}</span>
                  <span className="text-[15px] leading-snug">{t}</span>
                </li>
              ))}
            </ul>
            {!spot && !demo && <p className="mt-3 text-center text-[13px] text-white/60"><Lines>The car's spot isn't in yet. Try again in a minute, or use Honk once you're close.</Lines></p>}
            <div className="flex-1" />
            <button type="button" onClick={() => void start()} disabled={!spot && !demo}
              className="h-[52px] w-full rounded-2xl text-[17px] font-bold shadow-[0_8px_22px_rgba(0,0,0,.28)] active:scale-[0.98] disabled:opacity-50" style={{ background: "var(--fc-accent)", color: "var(--fc-on)" }}>Continue</button>
            {map && <a href={map} onClick={() => track(token, "find_car_maps")} className="mt-1 flex h-11 items-center justify-center text-[17px] font-semibold" style={{ color: "var(--fc-accent)" }}>Open in Maps instead</a>}
          </>
        )}

        {phase === "find" && (
          <>
            <div className="mt-1 text-center">
              <p className="text-[17px] font-bold" style={titleFont}>Tesla Model 3</p>
              <p className="mt-0.5 text-[14px] text-white/75"><Lines>{demo ? `${where.replace(/^(on|in) /, "")} · spot updated 4 min ago` : staleH > 6 ? `Last seen ${Math.round(staleH)} hours ago. Tap Honk to find it.` : `${where.replace(/^(on|in) /, "")} · spot updated ${Math.max(1, Math.round(staleH * 60))} min ago`}</Lines></p>
            </div>
            <div className="relative grid flex-1 place-items-center">
              <span aria-hidden className={`absolute h-[236px] w-[236px] rounded-full ${kind === "home" ? "border-[1.5px] border-dashed border-[#E8A93A]/30" : "border border-white/15"}`} />
              {fallback ? (
                <div className="relative px-6 text-center">
                  <MapPin className="mx-auto h-12 w-12" style={{ color: "var(--fc-accent)" }} aria-hidden />
                  <p className="mt-3 text-[15px] leading-snug text-white/80"><Lines>{fallback}</Lines></p>
                  {map && <a href={map} onClick={() => track(token, "find_car_maps")} className="mt-4 inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-full px-5 text-[15px] font-bold" style={{ background: "var(--fc-accent)", color: "var(--fc-on)" }}><Navigation className="h-4 w-4" /> Open in Maps</a>}
                </div>
              ) : rel == null ? (
                <Loader2 className="h-10 w-10 animate-spin text-white/60" aria-label="Finding your location" />
              ) : (
                // Short, smooth turn: the heading is already smoothed in JS, so a long CSS ease just made the arrow lag behind the phone.
                <svg viewBox="0 0 100 100" className="relative h-[180px] w-[180px] drop-shadow-[0_10px_26px_rgba(0,0,0,.35)] transition-transform duration-200 ease-out motion-reduce:transition-none"
                  style={{ transform: `rotate(${spun.current}deg)`, opacity: close ? 0.55 : 1, willChange: "transform" }} role="img" aria-label={close ? "Arrow: the car is right around here" : `Arrow: the car is ${hintFor(rel)}`}>
                  <path d="M50 6 86 90 50 70 14 90Z" style={{ fill: aligned && !close ? "#fff" : "var(--fc-accent)", transition: "fill .5s" }} />
                </svg>
              )}
            </div>
            <div aria-live="polite">
              <p className="whitespace-nowrap text-[64px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">{d ? <>{d.n}<small className="ml-1 text-[32px] font-bold tracking-normal">{d.u}</small></> : "—"}</p>
              <p className="mt-1.5 text-[20px] font-semibold text-white/80"><Lines>{fallback ? "away" : close ? "Right around here" : rel != null ? hintFor(rel) : err ?? "Finding you…"}</Lines></p>
              {calib && !fallback && <p className="mt-1 text-[13px] text-white/65"><Lines>Compass needs a moment. Move your phone in a figure 8.</Lines></p>}
              {!demo && !fallback && p && p.acc > 40 && <p className="mt-1 text-[13px] text-white/65"><Lines>{kind === "lax" ? "GPS is weak inside the garage. Tap Honk or Flash." : "GPS is weak here. Honk or Flash helps."}</Lines></p>}
              {!demo && !fallback && close && !(p && p.acc > 40) && <p className="mt-1 text-[13px] text-white/65"><Lines>Not sure which one? Flash the lights.</Lines></p>}
            </div>
            <div className="mt-5 flex gap-2.5"><Pill act="honk" run={run} demo={demo} token={token} /><Pill act="flash" run={run} demo={demo} token={token} /></div>
          </>
        )}

        {phase === "found" && (
          <>
            <div className="relative mx-auto mt-14 grid h-[168px] w-[168px] place-items-center rounded-full bg-white/[0.16]">
              <span aria-hidden className="absolute -inset-3.5 animate-ping rounded-full border-2 border-white/30 [animation-duration:1.8s] motion-reduce:animate-none" />
              {kind === "home" && <span aria-hidden className="absolute -inset-7 rounded-full border-[1.5px] border-dashed border-[#F4EAD5]/30" />}
              <Check className="h-[72px] w-[72px]" strokeWidth={2.6} aria-hidden />
            </div>
            <h2 className="mt-7 text-center text-[28px] font-bold leading-tight" style={titleFont}>You're There</h2>
            <p className="mx-4 mt-2 text-center text-[16px] leading-snug text-white/90"><Lines>{kind === "lax" ? "It's the Model 3 right in front of you." : "It's the Model 3 parked right next to you."} Not sure which one? Flash the lights.</Lines></p>
            <div className="flex-1" />
            <div className="mb-2.5 flex gap-2.5"><Pill act="flash" run={run} demo={demo} token={token} /><Pill act="honk" run={run} demo={demo} token={token} /></div>
            <button type="button" onClick={() => { onClose(); onNext?.(); }} className="h-[52px] w-full rounded-2xl bg-white text-[17px] font-bold active:scale-[0.98]" style={{ color: "var(--fc-on)" }}>{nextLabel ?? "Next: Set Up and Unlock"}</button>
            <button type="button" onClick={() => { disarmed.current = true; setPhase("find"); }} className="mt-1 h-11 text-[15px] font-semibold text-white/85">Back to the arrow</button>
          </>
        )}
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

/**
 * Entry button + the Find the Car screen.
 * Pages render this ALWAYS (pass soonText for the "not yet" line) instead of swapping it out for a
 * placeholder when the spot or hold changes. Swapping unmounted the open finder mid-walk whenever the
 * page refreshed with no spot for a moment, which closed or reset the arrow on the guest.
 */
export function FindCarButton({ kind, spot, run, demo, token, where, className = "", opensAt, onNext, held, soonText }: {
  kind: Kind; spot: Spot | null; run?: Run; demo?: boolean; token?: string; where: string; className?: string; opensAt?: string | null; onNext?: () => void; held?: boolean; soonText?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const soon = !!held || (!demo && !spot);
  return (
    <>
      {soonText && !open ? (
        <span className={`flex min-h-[52px] items-center justify-center rounded-2xl bg-white/[0.04] px-2 text-center text-[12px] text-white/65 ring-1 ring-white/10 ${className}`}>{soonText}</span>
      ) : (
        <button type="button" onClick={() => setOpen(true)} disabled={soon}
          className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold shadow-md shadow-black/25 transition active:scale-[0.98] disabled:bg-white/[0.06] disabled:text-white/60 disabled:shadow-none motion-reduce:transition-none ${className}`}
          style={soon ? undefined : { background: "var(--trip-accent)", color: kind === "home" ? "#132726" : "#1A1140" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M12 2 20 21 12 16.5 4 21Z" fill="currentColor" /></svg>
          {held ? "Find the Car unlocks once your license is checked" : soon ? (opensAt ? "Find the Car turns on 2 hours before pickup" : "Find the Car: car location updating…") : "Find the Car"}
        </button>
      )}
      <FindCar open={open} onClose={() => setOpen(false)} kind={kind} spot={spot} run={run} demo={demo} token={token} where={where} onNext={onNext} />
    </>
  );
}
