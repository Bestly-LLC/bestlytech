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
import { ScrollFx } from "./ScrollFx";
import { track } from "./track";
import ExtraDrivers from "./ExtraDrivers";
import { Collapse } from "./Collapse";
import { KeyNextSteps, KeyPending, keyTapped, markKeyTapped } from "./KeyNext";

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

export type CarAction = ClimateAction | "refresh" | "honk" | "flash" | "unlock";
export type HomeInfo = { address: string; lat: number; lon: number; parking_note?: string | null; return_note?: string | null; host_note?: string | null };
export type KeyInfo = { state: "soon" | "making" | "ready" | "added" | "ended" | "problem" | "off"; opens_at?: string; link?: string | null; expires_at?: string | null; unlock?: boolean };
export type HomePub = {
  trip?: Trip; car?: CarState | null; controls?: boolean; controls_state?: string; controls_opens_at?: string | null;
  pickup_battery?: number | null; email?: string | null; reminder_at?: string | null; reminder_sent_at?: string | null; home?: HomeInfo | null; spot?: { lat: number; lon: number; observed_at: string } | null; key?: KeyInfo | null;
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

function Section({ kicker, title, children, id, summary, defaultOpen }: { kicker: string; title?: string; children: ReactNode; id?: string; summary?: ReactNode; defaultOpen?: boolean }) {
  return <Collapse id={id ?? `s-${kicker.toLowerCase().replace(/[^a-z]+/g, "-")}`} kicker={kicker} title={title} summary={summary} defaultOpen={defaultOpen}
    accent={PEACH} titleStyle={{ fontFamily: "'Josefin Sans', Futura, 'Avenir Next', sans-serif" }}>{children}</Collapse>;
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-[#1A1140]" style={{ background: PEACH }}>{n}</span>
      <div className="text-[15px] leading-relaxed text-white/85">{children}</div>
    </li>
  );
}

/** Runs a car button (honk, flash, unlock) and shows what happened. */
function CarButton({ action, label, icon: Icon, run, disabled, hint }: { action: CarAction; label: string; icon: typeof BellRing; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void>; disabled?: boolean; hint?: string }) {
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

function KeyCard({ k, trip, run, token, onAdded, next }: { k: KeyInfo; trip: Trip | undefined; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void>; token: string; onAdded: () => void; next?: ReactNode }) {
  // After the guest taps the key button, grey it out and keep checking with Tesla until it says added.
  // Only a tap on THIS invite counts: a host "Resend key" makes a new invite (new 24h expiry), so the button comes back.
  const inviteFrom = k.expires_at ? Date.parse(k.expires_at) - 24 * 3600e3 - 120e3 : Date.now() - 24 * 3600e3;
  const [tapped, setTapped] = useState(() => (keyTapped(token) ?? 0) > inviteFrom);
  useEffect(() => { setTapped((keyTapped(token) ?? 0) > inviteFrom); }, [k.link, inviteFrom, token]);
  // Guest says they already have the Tesla app: skip that step and show what's next instead.
  const [hasApp, setHasApp] = useState(() => { try { return localStorage.getItem("hasTeslaApp") === "1"; } catch { return false; } });
  const haveIt = () => { track(undefined, "have_app"); setHasApp(true); try { localStorage.setItem("hasTeslaApp", "1"); } catch { /* private mode */ } };
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const appStore = platform() === "android" ? "https://play.google.com/store/apps/details?id=com.teslamotors.tesla" : "https://apps.apple.com/app/tesla/id582007913";
  return (
    <Section kicker="Your key" title={k.state === "added" ? "You're all set. Your phone is the key." : "Your phone is the key"} id="key"
      summary={k.state === "added" ? "Phone key is on. Extra drivers inside." : k.state === "ready" ? "Your key link is ready: open to add the car." : k.state === "soon" ? `Key appears ${k.opens_at ? fmtWhen(k.opens_at) : "2 hours before pickup"}.` : undefined}>
      {k.state === "soon" && (
        <p className="text-[15px] leading-relaxed text-white/80">
          Your key shows up here <b className="text-white">{k.opens_at ? fmtWhen(k.opens_at) : "2 hours before pickup"}</b>. You'll add the car to the free Tesla app with one tap. There's no key card with this car.
          {!hasApp ? (
            <>
              <span className="mt-1 block">In the meantime, get the Tesla app and sign in or make a free account.</span>
              <span className="mt-3 grid grid-cols-2 gap-2">
                <a href={appStore} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-semibold text-[#132726]"><Smartphone className="h-4 w-4" /> Get the app</a>
                <button type="button" onClick={haveIt} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white/10 text-[14px] font-semibold text-white ring-1 ring-white/15"><CheckCircle2 className="h-4 w-4" /> I already have it</button>
              </span>
            </>
          ) : (
            <>
              <span className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-400/10 p-3 text-[14px] text-white/90 ring-1 ring-emerald-300/30"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />You're set with the Tesla app. Just make sure you're signed in.</span>
              <span className="mt-3 block text-[13px] font-semibold uppercase tracking-[0.12em] text-white/65">While you wait</span>
              <span className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => jump("before")} className="flex min-h-[48px] items-center justify-center rounded-xl bg-white/10 px-2 text-[14px] font-semibold text-white ring-1 ring-white/15">Before you drive</button>
                <button type="button" onClick={() => jump("videos")} className="flex min-h-[48px] items-center justify-center rounded-xl bg-white/10 px-2 text-[14px] font-semibold text-white ring-1 ring-white/15">2-min videos</button>
              </span>
            </>
          )}
        </p>
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
            <Step n={2}>Tap the button below on this phone and accept. The car shows up in your Tesla app.</Step>
            <Step n={3}>At the car, open the Tesla app and tap <b className="text-white">Unlock</b>. The app walks you through turning on your phone key.</Step>
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


export default function HomeGuest({ pub, token, run, demo, reload }: { pub: HomePub; token: string; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void>; demo: string | null; reload?: () => void }) {
  const [sheet, setSheet] = useState<"pickup" | "return" | "ask" | null>(() => {
    if (typeof window === "undefined") return null;
    const h = window.location.hash;
    return h === "#return" ? "return" : h === "#pickup" ? "pickup" : h === "#ask" ? "ask" : null;
  });
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
        <img data-fx-hero src="/wallet/home/hero-mcm-v5.svg" alt="" className="block h-52 w-full object-cover object-[60%_70%] will-change-transform sm:h-64" />
        <div data-fx-title className="absolute inset-x-0 top-0 px-5 pt-6 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: PEACH, ...shadow }}>{pub.trip?.first ? `Hi ${pub.trip.first} · your Turo rental` : "Your Turo rental"}</p>
          <h1 className="mt-1 text-[32px] leading-[1.05] sm:text-5xl" style={{ ...shadow, fontFamily: "'Josefin Sans', Futura, 'Avenir Next', sans-serif", fontWeight: 700, color: "#F4EAD5" }}>Your Tesla in<br />West Hollywood</h1>
        </div>
      </div>
      <DecoRule className="mx-5 -mt-px" />

      <main className="mx-auto max-w-md px-5 pb-48 pt-5">
        <p className="text-[17px] leading-relaxed text-white/85">You rented a <b className="text-white">Tesla Model 3</b> on <b className="text-white">Turo</b>. It's parked on the street at <b className="text-white">{street}</b>. Your phone is the key: no meetup, no keys to hand over. Tap <b className="text-white">Pickup</b> or <b className="text-white">Return</b> at the bottom for the steps.</p>

        {pub.trip && <div className="mt-5"><TripCard trip={pub.trip} battery={car?.battery ?? null} keyState={key && key.state !== "off" ? key.state : undefined} /></div>}

        {key && key.state !== "off" && <KeyCard k={key} trip={pub.trip} run={live ? run : undefined} token={token} onAdded={() => reload?.()}
          next={pub.trip ? <KeyNextSteps trip={pub.trip} pickupBattery={pub.pickup_battery} address={home.address} maps={mapsFor(home.address)}
            go={(w) => { if (w === "return" || w === "pickup") openSheet(w); else { if (w === "before") window.dispatchEvent(new Event("open-before")); document.getElementById(w)?.scrollIntoView({ behavior: "smooth", block: "start" }); } }} /> : null} />}

        {/* One widget for the car: where it is, weather + cabin + climate buttons, find-it buttons. */}
        <section id="climate" aria-label="Your car" className={`mt-6 scroll-mt-4 rounded-3xl p-3 ring-1 transition ${doClimate ? "ring-2 ring-[#E8A93A]" : "ring-white/10"}`}
          style={{ background: "linear-gradient(160deg, rgba(232,169,58,0.10), rgba(255,255,255,0.04) 40%, rgba(42,107,102,0.18))" }}>
          <div className="flex items-start justify-between gap-3 px-1 pt-1">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>Your car · find it + get it comfy</p>
              <h2 className="mt-0.5 text-[20px] font-bold leading-tight text-white" style={{ fontFamily: "'Josefin Sans', Futura, 'Avenir Next', sans-serif" }}>{street}</h2>
            </div>
            <Starburst className="mt-1 h-6 w-6 shrink-0 text-[#E8A93A]" />
          </div>
          <p className="mt-1 px-1 text-[14px] leading-relaxed text-white/75">{home.parking_note}</p>
          {doClimate && <p className="mt-2 px-1 text-[15px] font-semibold text-[#E8A93A]">{doClimate === "warm" ? "Tap Warm it up below to start the heat." : "Tap Cool it down below to start the A/C."}</p>}
          {(pub.trip || car) && <div className="mt-3 px-1"><ClimateAdvice car={car} outsideF={outsideF} /></div>}
          <div className="mt-3 grid grid-cols-2 items-stretch gap-2.5">
            <WeatherCard trip={pub.trip ?? null} compact onNow={setOutsideF} lat={home.lat} lon={home.lon} place="WeHo" />
            <CarCard trip={pub.trip ?? null} car={car} demo={demoCar} compact onClimate={live ? (a, s) => run!(a, s) : undefined} lockedUntil={lockedUntil} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <a href={mapsFor(home.address)} onClick={() => track(undefined, "directions")} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-semibold text-[#132726] active:scale-[0.98]"><Navigation className="h-4 w-4" /> Directions</a>
            {spot
              ? <a href={mapsFor("Your Turo Tesla", spot.lat, spot.lon)} onClick={() => track(undefined, "spot")} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white/[0.09] text-[15px] font-semibold ring-1 ring-white/15 active:scale-[0.98]"><MapPin className="h-4 w-4" style={{ color: PEACH }} /> Exact spot</a>
              : <span className="flex min-h-[52px] items-center justify-center rounded-2xl bg-white/[0.04] px-2 text-center text-[12px] text-white/65 ring-1 ring-white/10">Exact spot shows 2 hours before pickup</span>}
          </div>
          {spot && <p className="mt-1.5 px-1 text-[12px] text-white/65">Car location updated {ago(spot.observed_at)}</p>}
          <div className="mt-3 flex gap-2.5">
            <CarButton action="honk" label="Honk" icon={BellRing} run={live ? run : undefined} hint={live ? "Short beep" : "Works 1 hour before pickup"} />
            <CarButton action="flash" label="Flash lights" icon={Flashlight} run={live ? run : undefined} hint={live ? "Good at night" : " "} />
          </div>
        </section>

        {pub.trip && new Date(pub.trip.starts_at) > new Date() && (
          <div className="mt-6"><EmailCard token={token} email={pub.email ?? null} reminderAt={pub.reminder_at ?? null} sentAt={pub.reminder_sent_at ?? null} home /></div>
        )}

        <HomeGuide pickupBattery={pub.pickup_battery} />

        <Section kicker="Learn your Tesla" title="Short videos from Tesla" id="videos">
          <VideoList />
        </Section>

        {pub.home?.host_note && (
          <Section kicker="From your host"><p className="text-white/90">{pub.home.host_note}</p></Section>
        )}

        <TripSheet open={sheet === "pickup"} onClose={() => openSheet(null)} kicker="Street → your car" title={`Pickup at ${street}`}>
          <p className="text-[15px] leading-relaxed text-white/75">About 5 minutes once you're here. Follow the steps in order.</p>
          <ol className="mt-5 space-y-4">
            <Step n={1}><b className="text-white">Before you come:</b> add the car to your Tesla app. The button is in <a href="#key" onClick={() => openSheet(null)} className="underline decoration-white/40 underline-offset-2">Your key</a> on the main page, 2 hours before pickup.</Step>
            <Step n={2}><b className="text-white">Get here:</b> <a href={mapsFor(home.address)} className="underline decoration-white/40 underline-offset-2">{home.address}</a>. Rideshare can drop you right on N Kings Rd.</Step>
            <Step n={3}><b className="text-white">Find the car</b> on N Kings Rd near the building. Not sure which one? Tap <b className="text-white">Honk</b> or <b className="text-white">Flash lights</b>.</Step>
            <Step n={4}><b className="text-white">Unlock</b> with the Tesla app, then take your check-in photos all around the car in the Turo app.</Step>
            <Step n={5}><b className="text-white">Drive:</b> sit down, press the brake, and push the <b className="text-white">right stalk</b> down for Drive. Up is Reverse.</Step>
          </ol>
          <p className="mt-5 text-[14px] text-white/60">Hot or cold out? Use Cool it down or Warm it up on the main page before you walk over.</p>
        </TripSheet>

        <TripSheet open={sheet === "return"} onClose={() => openSheet(null)} kicker="Your car → done" title={`Return at ${street}`}>
          <p className="text-[15px] leading-relaxed text-white/75">{home.return_note}</p>
          <ol className="mt-5 space-y-4">
            <Step n={1}><b className="text-white">Charge:</b> bring it back with {pub.pickup_battery != null ? <b className="text-white">at least {pub.pickup_battery}%</b> : "the same charge you picked it up with"} to avoid Turo's recharge fee. Closest: Tesla Diner Supercharger, 7001 Santa Monica Blvd (free parking, 24/7).</Step>
            <Step n={2}><b className="text-white">Park on N Kings Rd</b> near the building. Legal spot, not blocking a driveway or hydrant.</Step>
            <Step n={3}><b className="text-white">Street sweeping:</b> don't leave it on the <b className="text-white">west side Monday 8–10 AM</b> or the <b className="text-white">east side Tuesday 8–10 AM</b>. Tickets are $75.</Step>
            <Step n={4}><b className="text-white">Photos + lock:</b> take your return photos in the Turo app, grab your stuff, and lock it in the Tesla app.</Step>
          </ol>
          <p className="mt-5 text-[14px] text-white/60">Your Tesla access turns off by itself after the trip. Nothing to hand back.</p>
        </TripSheet>

        <TagBar open={sheet === "ask" ? null : sheet} onOpen={openSheet} top={<AskButton onOpen={() => openSheet("ask")} />} variant="home" />
        <VideoPlayer />
        <ScrollFx />
        <AskSheet open={sheet === "ask"} onClose={() => openSheet(null)} token={token} home />

        <p className="mt-10 text-center text-sm text-white/65">Questions? Tap Ask a question, or message your host in the Turo app.</p>

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
