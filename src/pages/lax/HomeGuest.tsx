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
import { useState, type CSSProperties, type ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { ArrowRight, BellRing, CheckCircle2, ExternalLink, Flashlight, KeyRound, Loader2, LockOpen, MapPin, Navigation, PlayCircle, ShieldAlert, Smartphone } from "lucide-react";
import { TagBar, TripSheet } from "./TripSheet";
import { AskButton, AskSheet } from "./AskSheet";
import { CarCard, ClimateAdvice, DEMO_CAR, TripCard, WeatherCard, fmtWhen, type CarState, type ClimateAction, type Trip } from "./GuestExtras";
import { HomeGuide, VIDEOS } from "./HomeGuide";

// WeHo / LA theme: Sunset Strip at night. Neon pink + mint on late-night purple, palms, city lights.
const PEACH = "var(--trip-accent)";
const WEHO = {
  "--trip-accent": "#FF5DB1",
  "--trip-accent-2": "#8FF3E4",
  "--trip-bg": "#140826",
  "--trip-bar": "rgba(20,8,38,0.92)",
  "--trip-sheet-head": "linear-gradient(180deg, #3a1260, #140826)",
  "--trip-strap": "repeating-linear-gradient(90deg, #FF5DB166 0 10px, transparent 10px 16px)",
} as CSSProperties;
const NEON = { textShadow: "0 0 6px rgba(255,93,177,0.9), 0 0 18px rgba(255,93,177,0.6), 0 2px 10px rgba(20,8,38,0.9)" };

/** Neon tube under the hero, like a Sunset Strip sign. */
function NeonLine({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`h-[3px] rounded-full ${className}`} style={{ background: "linear-gradient(90deg, transparent, #FF5DB1 20%, #8FF3E4 80%, transparent)", boxShadow: "0 0 12px rgba(255,93,177,0.7)" }} />;
}

export type CarAction = ClimateAction | "refresh" | "honk" | "flash" | "unlock";
export type HomeInfo = { address: string; lat: number; lon: number; parking_note?: string | null; return_note?: string | null; host_note?: string | null };
export type KeyInfo = { state: "soon" | "making" | "ready" | "added" | "ended" | "problem" | "off"; opens_at?: string; link?: string | null; expires_at?: string | null; unlock?: boolean };
export type HomePub = {
  trip?: Trip; car?: CarState | null; controls?: boolean; controls_state?: string; controls_opens_at?: string | null;
  pickup_battery?: number | null; home?: HomeInfo | null; spot?: { lat: number; lon: number; observed_at: string } | null; key?: KeyInfo | null;
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

function Section({ kicker, title, children, id }: { kicker: string; title?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-6 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>{kicker}</p>
      {title && <h2 className="mt-1 text-[19px] font-semibold leading-snug text-white">{title}</h2>}
      <div className="mt-2">{children}</div>
    </section>
  );
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
      <p className={`mt-1 min-h-[1rem] text-center text-[12px] ${msg?.startsWith("Couldn't") ? "text-red-300" : "text-white/55"}`} aria-live="polite">{msg ?? hint ?? ""}</p>
    </div>
  );
}

function KeyCard({ k, trip, run }: { k: KeyInfo; trip: Trip | undefined; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void> }) {
  const appStore = platform() === "android" ? "https://play.google.com/store/apps/details?id=com.teslamotors.tesla" : "https://apps.apple.com/app/tesla/id582007913";
  return (
    <Section kicker="Your key" title={k.state === "added" ? "You're all set. Your phone is the key." : "Your phone is the key"} id="key">
      {k.state === "soon" && (
        <p className="text-[15px] leading-relaxed text-white/80">
          Your key shows up here <b className="text-white">{k.opens_at ? fmtWhen(k.opens_at) : "2 hours before pickup"}</b>. You'll add the car to the free Tesla app with one tap. There's no key card with this car. In the meantime, download the Tesla app and sign in or make a free account.
          <a href={appStore} className="mt-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-semibold text-[#1A1140]"><Smartphone className="h-4 w-4" /> Get the Tesla app</a>
        </p>
      )}
      {k.state === "making" && (
        <p className="flex items-center gap-2 text-[15px] text-white/80"><Loader2 className="h-4 w-4 animate-spin" style={{ color: PEACH }} /> Making your key. This page updates by itself.</p>
      )}
      {k.state === "ready" && (
        <>
          <ol className="space-y-3">
            <Step n={1}>Get the free <a href={appStore} className="font-semibold text-white underline decoration-white/40 underline-offset-2">Tesla app</a> and sign in, or make an account. It takes a minute.</Step>
            <Step n={2}>Tap the button below on this phone and accept. The car shows up in your Tesla app.</Step>
            <Step n={3}>At the car, open the Tesla app and tap <b className="text-white">Unlock</b>. The app walks you through turning on your phone key.</Step>
          </ol>
          {k.link
            ? <a href={k.link} className="mt-4 flex h-14 items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#1A1140] shadow-lg shadow-black/30 active:scale-[0.99]" style={{ background: PEACH }}>
                <KeyRound className="h-5 w-5" /> Add the car to my Tesla app
              </a>
            : <p className="mt-4 rounded-xl bg-white/10 p-3 text-[14px] text-white/80">Preview: the real button appears here 2 hours before pickup.</p>}
          <p className="mt-2 text-[12px] text-white/50">One-time link, just for you.{k.expires_at ? ` Works until ${fmtWhen(k.expires_at)}; a new one appears here if it runs out.` : ""}</p>
        </>
      )}
      {k.state === "added" && (
        <p className="flex items-start gap-2 text-[15px] leading-relaxed text-white/85"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />The car is in your Tesla app. Walk up with your phone and it unlocks. Access ends by itself after your trip.</p>
      )}
      {k.state === "ended" && <p className="text-[15px] text-white/75">Your trip is over, so your key has been turned off. Thanks for driving with us.</p>}
      {k.state === "problem" && (
        <p className="flex items-start gap-2 text-[15px] leading-relaxed text-white/85"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />Your key is taking longer than usual. Your host has been told and it retries by itself. If pickup is soon, message your host in the Turo app.</p>
      )}
      {k.unlock && run && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="text-[13px] text-white/60">Phone key not working? Unlock it from here:</p>
          <div className="mt-2 flex"><CarButton action="unlock" label="Unlock the car" icon={LockOpen} run={run} /></div>
        </div>
      )}
      {trip && k.state !== "ended" && <p className="mt-1 text-[12px] text-white/45">Access turns off by itself after your {fmtWhen(trip.ends_at)} return.</p>}
    </Section>
  );
}


export default function HomeGuest({ pub, token, run, demo }: { pub: HomePub; token: string; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void>; demo: string | null }) {
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
  const home: HomeInfo = pub.home ?? { address: "733 N Kings Rd, West Hollywood, CA 90069", lat: 34.0838, lon: -118.3708 };
  const demoCar = demo === "car" || demo === "key" || demo === "added";
  const car = demoCar ? DEMO_CAR : pub.car ?? null;
  const key: KeyInfo | null = demo === "key" ? { state: "ready", link: null, expires_at: null, unlock: false }
    : demo === "added" ? { state: "added" } : demo === "soon" ? { state: "soon", opens_at: pub.trip ? new Date(+new Date(pub.trip.starts_at) - 2 * 3600e3).toISOString() : undefined } : pub.key ?? null;
  const live = !!pub.controls && !demo;
  const spot = pub.spot ?? (demoCar ? { lat: home.lat, lon: home.lon, observed_at: new Date(Date.now() - 4 * 60e3).toISOString() } : null);
  const street = home.address.split(",")[0];
  const shadow = { textShadow: "0 2px 12px rgba(26,17,64,0.85), 0 1px 2px rgba(26,17,64,0.9)" };
  const lockedUntil = demoCar ? null : pub.controls ? null : pub.controls_state === "soon" && pub.controls_opens_at ? pub.controls_opens_at : "pending";

  return (
    <div className="min-h-screen text-white" style={{ ...WEHO, background: "radial-gradient(120% 60% at 50% 0%, #2a0f4d 0%, #140826 60%)", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <Helmet>
        <title>Picking up your Turo Tesla in West Hollywood</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#140826" />
      </Helmet>

      <div className="relative">
        <img src="/wallet/home/hero.svg" alt="" className="block h-48 w-full object-cover object-[55%_center] sm:h-60" />
        <div className="absolute inset-x-0 top-0 px-5 pt-6 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: PEACH, ...shadow }}>{pub.trip?.first ? `Hi ${pub.trip.first} · your Turo rental` : "Your Turo rental"}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl" style={shadow}>Your Tesla in <span className="text-[#FFD6EC]" style={NEON}>WeHo</span></h1>
        </div>
      </div>
      <NeonLine className="mx-5" />

      <main className="mx-auto max-w-md px-5 pb-48 pt-5">
        <p className="text-[17px] leading-relaxed text-white/85">You rented a <b className="text-white">Tesla Model 3</b> on <b className="text-white">Turo</b>. It's parked on the street at <b className="text-white">{street}</b>. Your phone is the key: no meetup, no keys to hand over. Tap <b className="text-white">Pickup</b> or <b className="text-white">Return</b> at the bottom for the steps.</p>

        {pub.trip && <div className="mt-5"><TripCard trip={pub.trip} /></div>}

        {key && key.state !== "off" && <KeyCard k={key} trip={pub.trip} run={live ? run : undefined} />}

        <Section kicker="Find the car" title={street}>
          <p className="text-[14px] leading-relaxed text-white/75">{home.parking_note}</p>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <a href={mapsFor(home.address)} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-semibold text-[#1A1140] active:scale-[0.98]"><Navigation className="h-4 w-4" /> Directions</a>
            {spot
              ? <a href={mapsFor("Your Turo Tesla", spot.lat, spot.lon)} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white/[0.09] text-[15px] font-semibold ring-1 ring-white/15 active:scale-[0.98]"><MapPin className="h-4 w-4" style={{ color: PEACH }} /> Exact spot</a>
              : <span className="flex min-h-[52px] items-center justify-center rounded-2xl bg-white/[0.04] px-2 text-center text-[12px] text-white/50 ring-1 ring-white/10">Exact spot shows 2 hours before pickup</span>}
          </div>
          {spot && <p className="mt-1.5 text-[12px] text-white/45">Car location updated {ago(spot.observed_at)}</p>}
          <div className="mt-3 flex gap-2.5">
            <CarButton action="honk" label="Honk" icon={BellRing} run={live ? run : undefined} hint={live ? "Short beep" : "Works 1 hour before pickup"} />
            <CarButton action="flash" label="Flash lights" icon={Flashlight} run={live ? run : undefined} hint={live ? "Good at night" : " "} />
          </div>
        </Section>

        {(pub.trip || car) && <div className="mt-6"><ClimateAdvice car={car} outsideF={outsideF} /></div>}
        <div className="mt-2.5 grid grid-cols-2 items-stretch gap-2.5">
          <WeatherCard trip={pub.trip ?? null} compact onNow={setOutsideF} lat={home.lat} lon={home.lon} place="WeHo" />
          <CarCard trip={pub.trip ?? null} car={car} demo={demoCar} compact onClimate={live ? (a, s) => run!(a, s) : undefined} lockedUntil={lockedUntil} />
        </div>

        <HomeGuide pickupBattery={pub.pickup_battery} />

        <Section kicker="Learn your Tesla" title="Short videos from Tesla">
          <ul className="divide-y divide-white/10">
            {VIDEOS.map((v) => (
              <li key={v.title}>
                <a href={v.href} target="_blank" rel="noreferrer" className="flex items-center gap-3 py-3 active:opacity-70">
                  <PlayCircle className="h-8 w-8 shrink-0" style={{ color: PEACH }} strokeWidth={1.5} />
                  <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-white">{v.title}</span><span className="block text-[13px] leading-snug text-white/60">{v.sub}</span></span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-white/40" />
                </a>
              </li>
            ))}
          </ul>
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
        <AskSheet open={sheet === "ask"} onClose={() => openSheet(null)} token={token} home />

        <p className="mt-10 text-center text-sm text-white/50">Questions? Tap Ask a question, or message your host in the Turo app.</p>

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
