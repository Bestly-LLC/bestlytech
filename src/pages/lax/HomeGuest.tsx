/**
 * Home pickup version of the Turo trip page (/t/:token when the trip is not at LAX).
 * Same look as the LAX page; the garage, shuttle and QR code are replaced by:
 *  - Your key: a Tesla "add driver" invite made automatically 2 hours before pickup (tesla_guest_keys),
 *    removed automatically after the trip. Backup Unlock button in the pickup window.
 *  - Find the car: address, where it's parked (live pin), Honk / Flash lights.
 *  - Weather at the house, the car + climate buttons, Tesla how-to videos, return guide.
 * Data: lax_guest_public(token) → kind 'home' + home, spot, key.
 * Previews: ?demo=key (key ready), ?demo=added, ?demo=car (car card), ?demo=soon.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { ArrowRight, BellRing, CheckCircle2, Flashlight, KeyRound, Loader2, MapPin, Navigation, ShieldAlert, Smartphone } from "lucide-react";
import { TagBar, TripSheet } from "./TripSheet";
import { AskButton, AskSheet } from "./AskSheet";
import { CarCard, ClimateAdvice, DEMO_CAR, EmailCard, TripCard, WeatherCard, fmtWhen, type CarState, type ClimateAction, type Trip } from "./GuestExtras";
import { HomeGuide, VideoList, VideoPlayer } from "./HomeGuide";
import { Mail, PlayCircle, Users } from "lucide-react";
import { ScrollFx } from "./ScrollFx";
import { track } from "./track";
import ExtraDrivers from "./ExtraDrivers";
import { Collapse } from "./Collapse";
import { ChargerLine, KeyPending, SendToCar, keyTapped, markKeyTapped, useKeyWatch } from "./KeyNext";
import { KeySteps, NextStep, ProfileTip, guideFor, useHasApp } from "./Guide";
import { Carousel, TripSlides } from "./Carousel";
import { ReturnChecklist } from "./ReturnChecklist";
import { InstallToast } from "./InstallToast";
import { Fold } from "./HomeGuide";
import { homePlace } from "./places";
import { OpenTuro, TripDone, tripEnded } from "./TripDone";
import { BatteryReturn, ChargingCard, ChargingFab, type Charging } from "./Charging";
import { ChargeNow, OpenStalls, RangeCheck, type RangeCheckData } from "./LiveCharge";
import { PhoneHandoff } from "./PhoneHandoff";
import { UnlockStart } from "./Valet";

// Midcentury modern LA: dusk over the hills, Case Study glass house, Googie sign, atomic stars.
// Mustard + burnt orange + cream on deep teal.
const PEACH = "var(--trip-accent)";
const MCM = {
  "--trip-accent": "#E8A93A",
  "--trip-accent-2": "#E36F3C",
  "--trip-bg": "#132726",
  "--trip-bar": "rgba(19,39,38,0.95)",
  "--trip-sheet-head": "linear-gradient(180deg, #1f4442, #132726)",
  "--trip-strap": "radial-gradient(circle, #E8A93A 1.5px, transparent 2px) 0 50% / 12px 3px repeat-x",
} as CSSProperties;

export function Starburst({ className = "" }: { className?: string }) {
  return <svg viewBox="-10 -10 20 20" className={className} aria-hidden><polygon points="0,-10 1.6,-1.6 10,0 1.6,1.6 0,10 -1.6,1.6 -10,0 -1.6,-1.6" fill="currentColor" /></svg>;
}

/** Midcentury rule under the hero: two lines and an atomic star. */
function DecoRule({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`flex items-center gap-2 ${className}`}>
      <span className="h-[2px] flex-1 rounded-full bg-[#E8A93A]/60" />
      <Starburst className="h-4 w-4 text-[#E8A93A]" />
      <span className="h-[2px] w-10 rounded-full bg-[#E36F3C]" />
    </div>
  );
}

export type CarAction = ClimateAction | "refresh" | "honk" | "flash" | "unlock" | "nav_charger" | "nav_charger_lax" | "nav_garage_lax" | "nav_home" | "lock" | "windows_close";
export type HomeInfo = { address: string; lat: number; lon: number; parking_note?: string | null; return_note?: string | null; host_note?: string | null };
export type KeyInfo = { state: "soon" | "making" | "ready" | "added" | "ended" | "problem" | "off"; opens_at?: string; link?: string | null; expires_at?: string | null; unlock?: boolean };
export type HomePub = {
  trip?: Trip; car?: CarState | null; controls?: boolean; controls_state?: string; controls_opens_at?: string | null;
  pickup_battery?: number | null; email?: string | null; reminder_at?: string | null; reminder_sent_at?: string | null; home?: HomeInfo | null; spot?: { lat: number; lon: number; observed_at: string } | null; key?: KeyInfo | null; charging?: Charging | null;
  pickup_battery_at?: string | null; range_check?: RangeCheckData;
};

function platform(): "apple" | "android" | "other" {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod|Macintosh/.test(ua)) return "apple";
  return "other";
}
const mapsFor = (q: string, lat?: number, lon?: number) => {
  const apple = lat != null ? `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(q)}` : `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
  const google = lat != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  return platform() === "android" ? google : apple;
};
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`;
};

export function Section({ kicker, title, children, id, summary, defaultOpen, glow }: { kicker: string; title?: string; children: ReactNode; id?: string; summary?: ReactNode; defaultOpen?: boolean; glow?: boolean }) {
  return <Collapse id={id ?? `s-${kicker.toLowerCase().replace(/[^a-z]+/g, "-")}`} kicker={kicker} title={title} summary={summary} defaultOpen={defaultOpen} className={glow ? "trip-glow" : ""}
    accent={PEACH} titleStyle={{ fontFamily: "var(--trip-title-font, 'Josefin Sans', Futura, 'Avenir Next', sans-serif)" }}>{children}</Collapse>;
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  // One swipeable card per step (Pickup / Return carousels).
  return (
    <div className="flex h-full flex-col rounded-3xl bg-white/[0.07] p-5 ring-1 ring-white/10">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[18px] font-bold text-[#1A1140]" style={{ background: PEACH }}>{n}</span>
      <div className="mt-3 text-[17px] leading-relaxed text-white/85">{children}</div>
    </div>
  );
}

/** Runs a car button (honk, flash, unlock) and shows what happened. */
export function CarButton({ action, label, icon: Icon, run, disabled, hint }: { action: CarAction; label: string; icon: typeof BellRing; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void>; disabled?: boolean; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const press = async () => {
    if (!run || busy) return;
    setBusy(true); setMsg(null);
    try { await run(action, (s) => setMsg(s)); setMsg("Done"); }
    catch (e) { setMsg(`Couldn't: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-w-0 flex-1">
      <button type="button" onClick={press} disabled={disabled || !run || busy}
        className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.09] px-3 text-[15px] font-semibold text-white ring-1 ring-white/15 transition active:scale-[0.98] disabled:opacity-40">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" style={{ color: PEACH }} /> : <Icon className="h-5 w-5" style={{ color: PEACH }} />}{label}
      </button>
      <p className={`mt-1 min-h-[1rem] text-center text-[12px] ${msg?.startsWith("Couldn't") ? "text-red-300" : "text-white/65"}`} aria-live="polite">{msg ?? hint ?? ""}</p>
    </div>
  );
}

export function KeyCard({ k, trip, run, token, onAdded, next }: { k: KeyInfo; trip: Trip | undefined; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void>; token: string; onAdded: () => void; next?: ReactNode }) {
  // After the guest taps the key button, grey it out and keep checking with Tesla until it says added.
  // Only a tap on THIS invite counts: a host "Resend key" makes a new invite (new 24h expiry), so the button comes back.
  const inviteFrom = k.expires_at ? Date.parse(k.expires_at) - 24 * 3600e3 - 5e3 : Date.now() - 24 * 3600e3;
  const [tapped, setTapped] = useState(() => (keyTapped(token) ?? 0) > inviteFrom);
  useEffect(() => { setTapped((keyTapped(token) ?? 0) > inviteFrom); }, [k.link, inviteFrom, token]);
  useKeyWatch(token, k.state, k.opens_at, onAdded);
  // Guest says they already have the Tesla app: skip that step and show what's next instead.
  const [hasApp, setHasApp] = useState(() => { try { return localStorage.getItem("hasTeslaApp") === "1"; } catch { return false; } });
  const haveIt = () => { track(undefined, "have_app"); setHasApp(true); try { localStorage.setItem("hasTeslaApp", "1"); } catch { /* private mode */ } };
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const appStore = platform() === "android" ? "https://play.google.com/store/apps/details?id=com.teslamotors.tesla" : "https://apps.apple.com/app/tesla/id582007913";
  return (
    <Section kicker="Your key" title={k.state === "added" ? "You're all set. Your phone is the key." : k.state === "ready" ? "Your key is ready. Tap the button." : "Your phone is the car key"} id="key"
      glow={k.state === "soon" || k.state === "ready"}
      summary={k.state === "added" ? "Phone key is on. Extra drivers inside." : k.state === "ready" ? "Tap to add the car to your Tesla app." : k.state === "soon" ? (hasApp ? `Next: come back ${k.opens_at ? fmtWhen(k.opens_at) : "2 hours before pickup"} and tap one button.` : "Step 1: get the free Tesla app now.") : undefined}>
      {k.state === "soon" && (
        <div>
          <p className="text-[16px] leading-relaxed text-white/85">No keys. No meetup. <b className="text-white">Your phone unlocks the car</b> with the free Tesla app. 3 easy steps:</p>
          <ol className="mt-4 space-y-2.5">
            <li className="flex gap-3 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10">
              {hasApp ? <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-300" /> : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[14px] font-bold text-[#1A1140]" style={{ background: PEACH }}>1</span>}
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold text-white">{hasApp ? "Tesla app: done" : "Now: get the Tesla app"}</p>
                <p className="mt-0.5 text-[14px] leading-snug text-white/70">{hasApp ? "Just make sure you're signed in." : "It's free. Sign in, or make an account. About 2 minutes."}</p>
                {!hasApp && (
                  <span className="mt-2.5 grid grid-cols-2 gap-2">
                    <a href={appStore} onClick={() => track(undefined, "get_app")} className="flex h-11 items-center justify-center gap-1.5 rounded-xl text-[14px] font-bold text-[#1A1140]" style={{ background: PEACH }}><Smartphone className="h-4 w-4" /> Get the app</a>
                    <button type="button" onClick={haveIt} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-[14px] font-semibold text-white ring-1 ring-white/15"><CheckCircle2 className="h-4 w-4" /> I have it</button>
                  </span>
                )}
              </div>
            </li>
            <li className="flex gap-3 rounded-2xl p-3 ring-1 ring-white/10">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/15 text-[14px] font-bold text-white">2</span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold text-white">{k.opens_at ? fmtWhen(k.opens_at) : "2 hours before pickup"}: tap one button</p>
                <p className="mt-0.5 text-[14px] leading-snug text-white/70">Come back to this page. A button shows up right here. Tap it, and the car is in your Tesla app.</p>
              </div>
            </li>
            <li className="flex gap-3 rounded-2xl p-3 ring-1 ring-white/10">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/15 text-[14px] font-bold text-white">3</span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold text-white">At the car: tap &ldquo;Set Up&rdquo;, then Unlock</p>
                <p className="mt-0.5 text-[14px] leading-snug text-white/70">Stand next to the car with Bluetooth on. Open the Tesla app and tap <b className="text-white">&ldquo;Set Up&rdquo;</b>. Follow the steps. Then tap <b className="text-white">Unlock</b> and drive.</p>
              </div>
            </li>
          </ol>
          {hasApp && (
            <>
              <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-white/65">While you wait</p>
              <span className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => jump("before")} className="flex min-h-[48px] items-center justify-center rounded-xl bg-white/10 px-2 text-[14px] font-semibold text-white ring-1 ring-white/15">Before you drive</button>
                <button type="button" onClick={() => jump("videos")} className="flex min-h-[48px] items-center justify-center rounded-xl bg-white/10 px-2 text-[14px] font-semibold text-white ring-1 ring-white/15">2-min videos</button>
              </span>
            </>
          )}
        </div>
      )}
      {k.state === "making" && (
        <p className="flex items-center gap-2 text-[15px] text-white/80"><Loader2 className="h-4 w-4 animate-spin" style={{ color: PEACH }} /> Making your key. This page updates by itself.</p>
      )}
      {k.state === "ready" && (
        <>
          <ol className="space-y-3">
            {hasApp
              ? <li className="flex items-center gap-3 text-[15px] text-white/60"><CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-300" /><span className="line-through decoration-white/30">Get the Tesla app</span> <span className="no-underline">You have it</span></li>
              : <Step n={1}>Get the free <a href={appStore} className="font-semibold text-white underline decoration-white/40 underline-offset-2">Tesla app</a> and sign in, or make an account. It takes a minute. <button type="button" onClick={haveIt} className="ml-1 font-semibold underline decoration-white/40 underline-offset-2" style={{ color: PEACH }}>I already have it</button></Step>}
            <Step n={2}>Tap the button below on this phone, then tap <b className="text-white">Accept</b> in the Tesla app. The car shows up in your app.</Step>
            <Step n={3}>At the car (Bluetooth on), open the Tesla app and tap <b className="text-white">&ldquo;Set Up&rdquo;</b>. Follow the steps. Then tap <b className="text-white">Unlock</b>.</Step>
          </ol>
          {k.link
            ? tapped ? <KeyPending token={token} link={k.link} onAdded={onAdded} /> : <a href={k.link} onClick={() => { track(undefined, "key_tap"); markKeyTapped(token); window.setTimeout(() => setTapped(true), 600); }} className="mt-4 flex h-14 items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#132726] shadow-lg shadow-black/30 active:scale-[0.99]" style={{ background: PEACH }}>
                <KeyRound className="h-5 w-5" /> Add the car to my Tesla app
              </a>
            : <p className="mt-4 rounded-xl bg-white/10 p-3 text-[14px] text-white/80">Preview: the real button appears here 2 hours before pickup.</p>}
          <p className="mt-2 text-[12px] text-white/65">One-time link, just for you.{k.expires_at ? ` Works until ${fmtWhen(k.expires_at)}; a new one appears here if it runs out.` : ""}</p>
        </>
      )}
      {k.state === "added" && (
        <><p className="flex items-start gap-2 text-[15px] leading-relaxed text-white/85"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />The car is in your Tesla app. Walk up with your phone and it unlocks. Access ends by itself after your trip.</p>{next}</>
      )}
      {k.state === "ended" && <p className="text-[15px] text-white/75">Your trip is over, so your key has been turned off. Thanks for driving with us.</p>}
      {k.state === "problem" && (
        <p className="flex items-start gap-2 text-[15px] leading-relaxed text-white/85"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />Your key is taking longer than usual. Your host has been told and it retries by itself. If pickup is soon, message your host in the Turo app.</p>
      )}
      {k.state !== "ended" && k.state !== "off" && <ExtraDrivers token={token} embedded />}
      {trip && k.state !== "ended" && <p className="mt-1 text-[12px] text-white/65">Access turns off by itself after your {fmtWhen(trip.ends_at)} return.</p>}
    </Section>
  );
}


export default function HomeGuest({ pub, token, run, demo, demoPage, reload }: { pub: HomePub; token: string; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void>; demo: string | null; demoPage?: boolean; reload?: () => void }) {
  const [sheet, setSheet] = useState<"pickup" | "return" | "ask" | null>(() => {
    if (typeof window === "undefined") return null;
    const h = window.location.hash;
    return h === "#return" ? "return" : h === "#pickup" ? "pickup" : h === "#ask" ? "ask" : null;
  });
  // #pickup / #return / #ask open the sheet, also when the page is already open (a notification tap, an in-page link).
  useEffect(() => {
    const f = () => { const h = window.location.hash; if (h === "#pickup" || h === "#return" || h === "#ask") setSheet(h.slice(1) as "pickup" | "return" | "ask"); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const openSheet = (t: "pickup" | "return" | "ask" | null) => {
    setSheet(t);
    try { history.replaceState(null, "", t ? `#${t}` : window.location.pathname + window.location.search); } catch { /* ignore */ }
  };
  const [outsideF, setOutsideF] = useState<number | null>(null);
  // From the reminder email: ?do=cool|warm#climate scrolls to the climate buttons and highlights them (never auto-sends).
  const [doClimate] = useState<"cool" | "warm" | null>(() => {
    if (typeof window === "undefined") return null;
    const d = new URLSearchParams(window.location.search).get("do");
    return d === "cool" || d === "warm" ? d : null;
  });
  useEffect(() => {
    if (!doClimate) return;
    const t = window.setTimeout(() => document.getElementById("climate")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    return () => window.clearTimeout(t);
  }, [doClimate]);
  const home: HomeInfo = pub.home ?? { address: "733 N Kings Rd, West Hollywood, CA 90069", lat: 34.0838, lon: -118.3708 };
  const demoCar = demo === "car" || demo === "key" || demo === "added";
  const car = demoCar ? DEMO_CAR : pub.car ?? null;
  const key: KeyInfo | null = demo === "key" ? { state: "ready", link: null, expires_at: null, unlock: false }
    : demo === "added" ? { state: "added" } : demo === "soon" ? { state: "soon", opens_at: pub.trip ? new Date(+new Date(pub.trip.starts_at) - 2 * 3600e3).toISOString() : undefined } : pub.key ?? null;
  const live = !!pub.controls && !demo;
  const spot = pub.spot ?? (demoCar ? { lat: home.lat, lon: home.lon, observed_at: new Date(Date.now() - 4 * 60e3).toISOString() } : null);
  const street = home.address.split(",")[0];
  const shadow = { textShadow: "0 2px 14px rgba(19,39,38,0.9), 0 1px 2px rgba(19,39,38,0.9)" };
  const ended = tripEnded(pub.trip);
  const onTrip = !!pub.trip && !ended && Date.now() >= +new Date(pub.trip.starts_at);
  // What to do now + what glows (next-step card, Pickup/Return ticket, key button, climate controls).
  const [hasApp, markHasApp] = useHasApp();
  useKeyWatch(token, key?.state ?? "off", key?.opens_at, () => reload?.());
  const { next, glow } = guideFor({ trip: pub.trip, keyInfo: key, hasApp, car, controlsOn: !!pub.controls, kind: "home", pickupBattery: pub.pickup_battery });
  const keySteps = !!key && key.state !== "off" && key.state !== "ended";
  const n0 = keySteps ? 2 : 0;
  const doNext = (a: string) => {
    if (a === "pickup" || a === "return") openSheet(a);
    else if (a === "climate") document.getElementById("climate")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const lockedUntil = demoCar ? null : pub.controls ? null : pub.controls_state === "soon" && pub.controls_opens_at ? pub.controls_opens_at : "pending";

  return (
    <div className="trip min-h-dvh text-white" style={{ ...MCM, background: "radial-gradient(120% 60% at 50% 0%, #1f4442 0%, #132726 62%)", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <Helmet>
        <title>Picking up your Turo Tesla in West Hollywood</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#132726" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@600;700&display=swap" />
        <style>{`.trip :is(a,button):focus-visible{outline:2px solid #E8A93A;outline-offset:3px;border-radius:14px}
.trip :is(a,button){touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.trip :is(a,button):not(:disabled):active{filter:brightness(1.08)}`}</style>
      </Helmet>

      <div className="relative overflow-hidden">
        <img data-fx-hero src="/wallet/home/hero-mcm-v5.svg" alt="" className="block w-full object-cover object-[60%_70%] will-change-transform" style={{ height: "calc(13rem + env(safe-area-inset-top))" }} />
        <div data-fx-title className="absolute inset-x-0 top-0 px-5 sm:px-8" style={{ paddingTop: "calc(env(safe-area-inset-top) + 24px)" }}>
          <p className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: PEACH, ...shadow }}>{pub.trip?.first ? `Hi ${pub.trip.first} · your Turo rental` : "Your Turo rental"}</p>
          <h1 className="mt-1 text-[32px] leading-[1.05] sm:text-5xl" style={{ ...shadow, fontFamily: "'Josefin Sans', Futura, 'Avenir Next', sans-serif", fontWeight: 700, color: "#F4EAD5" }}>Your Tesla in<br />West Hollywood</h1>
        </div>
      </div>
      <DecoRule className="mx-5 -mt-px" />

      <main className="mx-auto max-w-md px-5 pb-48 pt-5">
        {!ended && <p className="text-[17px] leading-relaxed text-white/85">Your Turo Tesla is parked on <b className="text-white">{street.replace(/^\d+\s*/, "")}</b>. <b className="text-white">Your phone is the key.</b> No meetup, no keys.</p>}

        {pub.trip && <div className="mt-5"><TripCard trip={pub.trip} theme="home" recap={pub.charging ? { charging: pub.charging.total, stops: pub.charging.count } : undefined} /></div>}

        {ended && pub.trip ? <TripDone trip={pub.trip} charging={pub.charging} token={token} titleFont="'Josefin Sans', Futura, 'Avenir Next', sans-serif" /> : <>
        <NextStep next={next} glow={glow.has("next")} onAction={doNext} onHasApp={markHasApp} run={live ? run : undefined} kind="home" />

        {/* On the trip these three swipe (Your car · Supercharging · Help & guides); before it they stack. */}
        <TripSlides on={onTrip} id="home-trip" labels={pub.charging ? ["Your car", "Supercharging", "Help & guides"] : ["Your car", "Help & guides"]}>
        <section id="climate" aria-label="Your car" className={`mt-6 scroll-mt-4 rounded-3xl p-3 ring-1 transition ${glow.has("climate") || doClimate ? "trip-glow trip-glow-card" : "ring-white/10"}`}
          style={{ background: "linear-gradient(160deg, rgba(232,169,58,0.10), rgba(255,255,255,0.04) 40%, rgba(42,107,102,0.18))" }}>
          <div className="flex items-start justify-between gap-3 px-1 pt-1">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>Your car</p>
              <h2 className="mt-0.5 text-[20px] font-bold leading-tight text-white" style={{ fontFamily: "var(--trip-title-font, 'Josefin Sans', Futura, 'Avenir Next', sans-serif)" }}>{street}</h2>
            </div>
            <Starburst className="mt-1 h-6 w-6 shrink-0 text-[#E8A93A]" />
          </div>
          {doClimate && <p className="mt-2 px-1 text-[15px] font-semibold text-[#E8A93A]">{doClimate === "warm" ? "Tap Warm it up below to start the heat." : "Tap Cool it down below to start the A/C."}</p>}
          {(pub.trip || car) && <div className="mt-2 px-1"><ClimateAdvice car={car} outsideF={outsideF} /></div>}
          <div className="mt-3 grid grid-cols-2 items-stretch gap-2.5">
            <WeatherCard trip={pub.trip ?? null} compact onNow={setOutsideF} lat={home.lat} lon={home.lon} place="WeHo" />
            <CarCard trip={pub.trip ?? null} car={car} demo={demoCar || !!demoPage} compact onClimate={live ? (a, s) => run!(a, s) : undefined} lockedUntil={lockedUntil} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <a href={mapsFor(home.address)} onClick={() => track(undefined, "directions")} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-semibold text-[#132726] active:scale-[0.98]"><Navigation className="h-4 w-4" /> Directions</a>
            <SendToCar run={live ? run : undefined} kind="home" action="nav_home" label="Send to car" full />
          </div>
          <p className="mt-1.5 px-1 text-[12px] text-white/60">Send to car puts {street} in the car's navigation. Handy for the return.</p>
          <div className="mt-2.5">
            {spot
              ? <a href={mapsFor("Your Turo Tesla", spot.lat, spot.lon)} onClick={() => track(undefined, "spot")} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white/[0.09] text-[15px] font-semibold ring-1 ring-white/15 active:scale-[0.98]"><MapPin className="h-4 w-4" style={{ color: PEACH }} /> Exact spot of the car</a>
              : <span className="flex min-h-[52px] items-center justify-center rounded-2xl bg-white/[0.04] px-2 text-center text-[12px] text-white/65 ring-1 ring-white/10">{pub.trip && Date.now() >= +new Date(pub.trip.starts_at) - 2 * 3600e3 ? "Car location updating… use Honk to find it" : "Exact spot of the car shows 2 hours before pickup"}</span>}
          </div>
          <div className="mt-3 flex gap-2.5">
            <CarButton action="honk" label="Honk" icon={BellRing} run={live ? run : undefined} hint={live ? "Short beep" : "Works 1 hour before pickup"} />
            <CarButton action="flash" label="Flash lights" icon={Flashlight} run={live ? run : undefined} hint={live ? "Good at night" : " "} />
          </div>
        </section>

        {pub.charging && <ChargingCard charging={pub.charging} token={token} battery={car?.battery} pickupBattery={pub.pickup_battery} titleFont="'Josefin Sans', Futura, 'Avenir Next', sans-serif">
          <ChargeNow state={car?.charging} battery={car?.battery} detail={car?.charge_detail} target={pub.pickup_battery} />
          <OpenStalls token={token} live={live} demo={!!demoPage} />
          <RangeCheck rc={pub.range_check} kind="home" className="mt-3" />
        </ChargingCard>}

        <HomeGuide pickupBattery={pub.pickup_battery} valet={demoPage ? (key?.state === "added" ? <UnlockStart demo /> : null) : <UnlockStart token={token} />}>
          <Fold icon={Users} title="Someone else driving?" sub="Add them in Turo first, then get their key here">
            <ExtraDrivers token={token} embedded />
          </Fold>
          <Fold icon={PlayCircle} title="How-to videos" sub="2-minute videos from Tesla">
            <VideoList />
          </Fold>
          {pub.trip && new Date(pub.trip.starts_at) > new Date() && (
            <Fold icon={Mail} title="Reminder email" sub="Get a nudge 1 hour before pickup">
              <EmailCard token={token} email={pub.email ?? null} reminderAt={pub.reminder_at ?? null} sentAt={pub.reminder_sent_at ?? null} home />
            </Fold>
          )}
        </HomeGuide>
        </TripSlides>

        {pub.home?.host_note && (
          <Section kicker="From your host"><p className="text-white/90">{pub.home.host_note}</p></Section>
        )}
        </>}

        <TripSheet open={sheet === "pickup"} onClose={() => openSheet(null)} kicker="Your key → your car" title={`Pickup at ${street}`}>
          {key && keySteps && (
            <>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>First: your phone is the key</p>
              <div className="mt-3"><KeySteps k={key} token={token} hasApp={hasApp} onHasApp={markHasApp} onAdded={() => reload?.()} glow={glow.has("key")} /></div>
              <p className="mt-7 text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>Then: at the car</p>
            </>
          )}
          <Carousel id="home-pickup" className="mt-4" labels={["Go to the car", "\u201cSet Up\u201d + Unlock", "Turo Guest profile", "Photos", "Drive"]}>
            <Step n={n0 + 1}><b className="text-white">Go to</b> <a href={mapsFor(home.address)} className="underline decoration-white/40 underline-offset-2">{home.address}</a>. It's on N Kings Rd near the building. Not sure which car? Tap <b className="text-white">Honk</b> on the main page.</Step>
            <Step n={n0 + 2}>Next to the car (Bluetooth on), open the Tesla app. Tap <b className="text-white">&ldquo;Set Up&rdquo;</b> and follow the steps. Then tap <b className="text-white">Unlock</b>.</Step>
            <Step n={n0 + 3}><b className="text-white">Get in and pick your profile.</b><ProfileTip /></Step>
            <Step n={n0 + 4}><b className="text-white">Take check-in photos</b> all around the car in the Turo app.<OpenTuro className="mt-2 w-full" label="Open Turo for photos" /></Step>
            <Step n={n0 + 5}><b className="text-white">Drive:</b> press the brake, push the <b className="text-white">right stalk</b> down. Up is Reverse.<BatteryReturn className="mt-3" startsAt={pub.trip?.starts_at} setAt={pub.pickup_battery_at} target={pub.pickup_battery} now={car?.battery} observedAt={car?.observed_at} /></Step>
          </Carousel>
        </TripSheet>

        <TripSheet open={sheet === "return"} onClose={() => openSheet(null)} kicker="Your car → done" title={`Return at ${street}`}>
          <Carousel id="home-return" className="mt-1" labels={["Charge", "Park", "Photos + lock"]}>
            <Step n={1}><b className="text-white">Charge:</b> bring it back with {pub.pickup_battery != null ? <b className="text-white">at least {pub.pickup_battery}%</b> : "the charge you picked it up with"}.<RangeCheck rc={pub.range_check} kind="home" className="mt-3" /><BatteryReturn className="mt-3" setAt={pub.pickup_battery_at} startsAt={pub.trip?.starts_at} target={pub.pickup_battery} now={car?.battery} observedAt={car?.observed_at} /><span className="mt-3 block"><ChargerLine kind="home" /></span><SendToCar run={live ? run : undefined} kind="home" /></Step>
            <Step n={2}><b className="text-white">Park on N Kings Rd</b> near the building. <b className="text-white">Avoid the Joybird street parking.</b> Watch for <b className="text-white">street sweeping on Mondays and Tuesdays</b>: west side Monday 8–10 AM, east side Tuesday 8–10 AM ($75 tickets).<span className="mt-3 block"><SendToCar run={live ? run : undefined} kind="home" action="nav_home" label="Send 733 N Kings Rd to the car" /></span><ReturnChecklist compact token={token} kind="home" run={live ? run : undefined} demo={!!demoPage} endsAt={pub.trip?.ends_at} /></Step>
            <Step n={3}><b className="text-white">Return photos</b> in the Turo app, grab your stuff, lock it in the Tesla app.<OpenTuro className="mt-2 w-full" label="Open Turo for photos" /></Step>
          </Carousel>
          <p className="mt-5 text-[14px] text-white/60">Your key turns off by itself after the trip. Nothing to hand back.</p>
        </TripSheet>

        <TagBar open={sheet === "ask" ? null : sheet} onOpen={openSheet} top={<AskButton onOpen={() => openSheet("ask")} />} variant="home" hideTags={ended}
          glow={glow.has("pickup") ? "pickup" : glow.has("return") ? "return" : null} badge={glow.has("key") ? "Key ready" : undefined} />
        {pub.charging && !ended && <ChargingFab charging={pub.charging} />}
        {!ended && <InstallToast token={token} kind="home" />}
        {!ended && <PhoneHandoff token={token} keyReady={!!key && ["ready", "making"].includes(key.state)} />}
        <VideoPlayer />
        <ScrollFx />
        <AskSheet open={sheet === "ask"} onClose={() => openSheet(null)} token={token} home />

        <a href="https://www.bestly.tech/hire?utm_source=turo&utm_medium=guest-page&utm_campaign=home-trip-page" target="_blank" rel="noopener"
          className="mt-8 block rounded-3xl p-5 ring-1 ring-white/15 transition active:scale-[0.99]"
          style={{ background: "linear-gradient(135deg, rgba(122,46,158,0.35), rgba(43,26,115,0.6))" }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>Who made this page?</p>
          <p className="mt-1 text-lg font-semibold text-white">Bestly built it. We can build one for you.</p>
          <p className="mt-1.5 text-[15px] leading-relaxed text-white/75">We make websites, apps, and tools for small businesses. Like this page: a phone key that shows up by itself, live car info and A/C buttons.</p>
          <span className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-full bg-white px-5 text-[15px] font-semibold text-[#1A1140]">Tell us what you need <ArrowRight className="h-4 w-4" aria-hidden /></span>
        </a>
      </main>
    </div>
  );
}
