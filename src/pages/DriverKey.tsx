/**
 * An extra driver's own page: bestly.tech/d/<7-char token> (the guest texts it to them).
 * Their key (Add the car to my Tesla app), 3 short steps, where the car is, and a key-only trip helper
 * that can check their key and send a fresh one. Updates itself every 20 s. /d/demo shows an example.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Clock, KeyRound, Loader2, MapPin, MessageCircleQuestion, ShieldAlert, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AskSheet } from "./lax/AskSheet";
import { useHasApp } from "./lax/Guide";
import { fmtWhen } from "./lax/GuestExtras";
import { track } from "./lax/track";

type Pub = { ok: boolean; kind?: "home" | "lax"; guest?: string | null; where?: string; ended?: boolean;
  trip?: { starts_at: string; ends_at: string };
  driver?: { id: number; name: string; state: "waiting" | "making" | "ready" | "added" | "ended" | "problem"; link?: string | null; expires_at?: string | null } };

const THEMES: Record<"home" | "lax", CSSProperties & Record<string, string>> = {
  home: { "--trip-accent": "#E8A93A", "--trip-accent-2": "#E36F3C", "--trip-bg": "#132726", "--trip-bar": "rgba(19,39,38,0.95)", "--trip-sheet-head": "linear-gradient(180deg, #1f4442, #132726)" },
  lax: { "--trip-accent": "#FFB878", "--trip-accent-2": "#E4527A", "--trip-bg": "#1A1140" },
};
const appStore = () => /android/i.test(navigator.userAgent) ? "https://play.google.com/store/apps/details?id=com.teslamotors.tesla" : "https://apps.apple.com/app/tesla/id582007913";
const maps = (q: string) => /iPhone|iPad|Mac/.test(navigator.userAgent) ? `https://maps.apple.com/?q=${encodeURIComponent(q)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

function demoPub(): Pub {
  const s = Date.now() + 90 * 60e3;
  return { ok: true, kind: "home", guest: "Demo", where: "733 N Kings Rd, West Hollywood, CA 90069", ended: false,
    trip: { starts_at: new Date(s).toISOString(), ends_at: new Date(s + 72 * 3600e3).toISOString() },
    driver: { id: 0, name: "Test", state: "ready", link: "https://www.tesla.com/_rs/1/DEMO-KEY", expires_at: new Date(Date.now() + 20 * 3600e3).toISOString() } };
}

export default function DriverKey() {
  const { token = "" } = useParams();
  const demo = token === "demo";
  const [pub, setPub] = useState<Pub | null>(demo ? demoPub() : null);
  const [ask, setAsk] = useState(false);
  const [hasApp, markHasApp] = useHasApp();
  const load = useCallback(async () => {
    if (demo) return;
    const { data } = await (supabase.rpc("lax_driver_public" as never, { p_token: token } as never) as unknown as Promise<{ data: Pub | null }>);
    setPub(data ?? { ok: false });
  }, [token, demo]);
  useEffect(() => { void load(); track(undefined, "driver_page_open"); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20000);
    return () => window.clearInterval(id);
  }, [load]);
  useEffect(() => { document.getElementById("boot-splash")?.remove(); }, []);

  const kind = pub?.kind ?? "home";
  const d = pub?.driver;
  const bg = kind === "lax" ? "#1A1140" : "#132726";
  const titleFont = { fontFamily: kind === "home" ? "'Josefin Sans', Futura, 'Avenir Next', sans-serif" : "Inter, -apple-system, system-ui, sans-serif" };
  const card = "mt-4 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10";
  const btn = "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold active:scale-[0.98]";

  if (pub && !pub.ok) return (
    <main className="grid min-h-dvh place-items-center px-6 text-center text-white" style={{ background: bg }}>
      <div><KeyRound className="mx-auto h-10 w-10 text-white/50" aria-hidden /><h1 className="mt-3 text-[22px] font-bold">This key link isn't active</h1>
        <p className="mt-2 text-white/70">Ask the person who booked the trip to send it again from their trip page.</p></div>
    </main>
  );

  return (
    <main className="min-h-dvh text-white" style={{ ...THEMES[kind], background: bg, fontFamily: "Inter, -apple-system, system-ui, sans-serif" }}>
      <div className="mx-auto max-w-md px-4 pb-32" style={{ paddingTop: "max(20px, env(safe-area-inset-top))" }}>
        {!pub ? <div className="grid h-[60vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-white/60" aria-label="Loading" /></div> : (<>
          <p className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--trip-accent)", ...titleFont }}>Your Tesla key{demo ? " · Demo" : ""}</p>
          <h1 className="mt-2 text-[28px] font-bold leading-tight" style={titleFont}>Hi {d?.name?.split(" ")[0]}, you're driving {pub.guest ? `${pub.guest}'s` : "the"} Turo Tesla</h1>
          {pub.trip && <p className="mt-2 text-[15px] text-white/75">Pickup {fmtWhen(pub.trip.starts_at)} · Return {fmtWhen(pub.trip.ends_at)}</p>}

          <section className={card} aria-live="polite">
            {d?.state === "ready" && d.link && (<>
              <h2 className="text-[20px] font-bold" style={titleFont}>Your key is ready</h2>
              <ol className="mt-3 space-y-2.5 text-[15px] leading-snug text-white/85">
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[14px] font-bold text-[#132726]" style={{ background: "var(--trip-accent)" }}>1</span>
                  <span>{hasApp ? <>You have the Tesla app. Make sure you're signed in to <b className="text-white">your own</b> Tesla account.</> : <>Get the free <a href={appStore()} className="font-semibold underline underline-offset-2">Tesla app</a> and sign in (or make an account). <button type="button" onClick={markHasApp} className="font-semibold underline underline-offset-2" style={{ color: "var(--trip-accent)" }}>I already have it</button></>}</span></li>
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[14px] font-bold text-[#132726]" style={{ background: "var(--trip-accent)" }}>2</span><span>Tap the button below, then tap <b className="text-white">Accept</b> in the Tesla app.</span></li>
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[14px] font-bold text-[#132726]" style={{ background: "var(--trip-accent)" }}>3</span><span>At the car, with Bluetooth on: tap <b className="text-white">"Set Up"</b> in the Tesla app, then <b className="text-white">Unlock</b>.</span></li>
              </ol>
              <a href={demo ? "#" : d.link} onClick={(e) => { if (demo) e.preventDefault(); track(undefined, "driver_key_tap"); }} className={`${btn} mt-4 text-[#132726]`} style={{ background: "var(--trip-accent)" }}>
                <KeyRound className="h-5 w-5" aria-hidden />{demo ? "Pretend: Add the car to my Tesla app" : "Add the car to my Tesla app"}
              </a>
              {d.expires_at && <p className="mt-2 text-center text-[12px] text-white/55">This link works until {fmtWhen(d.expires_at)}. If it expires, ask the helper below for a fresh one.</p>}
            </>)}
            {d?.state === "added" && <><h2 className="flex items-center gap-2 text-[20px] font-bold" style={titleFont}><CheckCircle2 className="h-6 w-6 text-emerald-300" aria-hidden />You're all set</h2>
              <p className="mt-2 text-[15px] text-white/80">The car is in your Tesla app. At the car, with Bluetooth on: tap <b className="text-white">"Set Up"</b> the first time, then <b className="text-white">Unlock</b>.</p></>}
            {(d?.state === "waiting" || d?.state === "making") && <><h2 className="flex items-center gap-2 text-[20px] font-bold" style={titleFont}><Clock className="h-6 w-6 text-white/70" aria-hidden />{d.state === "waiting" ? "Waiting for Turo" : "Making your key"}</h2>
              <p className="mt-2 text-[15px] text-white/80">{d.state === "waiting" ? <>{pub.guest ?? "The guest"} added you. Once Turo confirms you're approved to drive, your key shows up right here. Keep this page. It updates by itself.</> : "Turo approved you. Your key will be here in about a minute."}</p></>}
            {d?.state === "problem" && <><h2 className="flex items-center gap-2 text-[20px] font-bold" style={titleFont}><ShieldAlert className="h-6 w-6 text-red-300" aria-hidden />Your key is delayed</h2>
              <p className="mt-2 text-[15px] text-white/80">It's being retried, and the host has been told. Ask the helper below if you need it now.</p></>}
            {d?.state === "ended" && <><h2 className="text-[20px] font-bold" style={titleFont}>This trip is over</h2><p className="mt-2 text-[15px] text-white/80">Your access to the car has ended. Thanks for driving!</p></>}
          </section>

          {pub.where && !pub.ended && (
            <section className={card}>
              <p className="text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--trip-accent)" }}>Where the car is</p>
              <a href={maps(pub.where.split(" · ")[0])} className="mt-1 flex items-center gap-2 text-[17px] font-semibold underline decoration-white/35 underline-offset-4"><MapPin className="h-5 w-5 shrink-0" style={{ color: "var(--trip-accent)" }} aria-hidden />{pub.where}</a>
              <p className="mt-2 text-[13px] text-white/60">For everything else about the trip, ask {pub.guest ?? "the person who booked"}.</p>
            </section>
          )}
          {!hasApp && d?.state !== "ready" && d?.state !== "added" && !pub.ended && (
            <a href={appStore()} className={`${btn} mt-4 bg-white/[0.09] text-white ring-1 ring-white/15`}><Smartphone className="h-5 w-5" aria-hidden />Get the Tesla app now</a>
          )}
        </>)}
      </div>
      {pub?.ok && !pub.ended && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 px-4 pt-3 backdrop-blur-md" style={{ background: kind === "lax" ? "rgba(20,12,51,0.92)" : "rgba(19,39,38,0.95)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button type="button" onClick={() => setAsk(true)} className="mx-auto flex h-12 w-full max-w-md items-center justify-center gap-2 rounded-2xl bg-white/[0.09] text-[16px] font-semibold ring-1 ring-white/15 active:scale-[0.98]">
            <MessageCircleQuestion className="h-5 w-5" style={{ color: "var(--trip-accent)" }} aria-hidden />Key not working? Ask here
          </button>
        </div>
      )}
      <div style={THEMES[kind]}><AskSheet open={ask} onClose={() => setAsk(false)} token={demo ? "demo-home" : token} home={kind === "home"} driver /></div>
    </main>
  );
}
