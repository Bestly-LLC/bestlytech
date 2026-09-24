/**
 * Home trip key: what happens after the guest taps "Add the car to my Tesla app".
 *  - KeyPending: the button greys out ("Opened in the Tesla app"), with a small "Try the link again",
 *    while we ask Tesla whether it worked (lax_guest_key_check every 12 s for 4 min, and right away
 *    when they come back from the Tesla app). When it flips to added, the page reloads its data.
 *  - KeyNextSteps: once the key is added, what to do next based on where they are in the trip.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BatteryCharging, CheckCircle2, Clock, KeyRound, Loader2, MapPin, Navigation, RotateCcw, Snowflake, Smartphone, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtWhen, type Trip } from "./GuestExtras";
import { track } from "./track";
import { CHARGERS, chargerMaps, type Place, type TripKind } from "./places";

const ACCENT = "var(--trip-accent)";
const tapKey = (t: string) => `keytap:${t}`;
export function keyTapped(token: string): number | null {
  try { const v = localStorage.getItem(tapKey(token)); return v ? Number(v) : null; } catch { return null; }
}
/** Keeps the key card in sync with Tesla (via the server): makes the key when due, spots acceptance, spots self-removal. */
export function useKeyWatch(token: string, state: string, opensAt: string | undefined, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    // soon/making/ready: every 15s (key appears / gets accepted). added: every 60s, to catch a guest who removed
    // the car from their own Tesla app (the server makes a fresh key and the card resets to "add it").
    if (!["making", "soon", "ready", "added"].includes(state)) return;
    const every = state === "added" ? 60000 : 15000;
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== "visible") return;
      if (state === "soon" && opensAt && Date.parse(opensAt) > Date.now()) return;
      const { data } = await (supabase.rpc("lax_guest_key_check" as never, { p_token: token } as never) as unknown as Promise<{ data: { state?: string } | null }>);
      if (!stop && data?.state && data.state !== state) cb.current();
    };
    void tick();
    const id = window.setInterval(tick, every);
    const vis = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; window.clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [token, state, opensAt]);
}
export function markKeyTapped(token: string) { try { localStorage.setItem(tapKey(token), String(Date.now())); } catch { /* private mode */ } }

export function KeyPending({ token, link, onAdded }: { token: string; link: string | null | undefined; onAdded: () => void }) {
  const [checks, setChecks] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (busy.current || stop) return;
      busy.current = true;
      try {
        const { data } = await (supabase.rpc("lax_guest_key_check" as never, { p_token: token } as never) as unknown as Promise<{ data: { state?: string } | null }>);
        if (data?.state === "added") { stop = true; onAdded(); }
      } finally { busy.current = false; setChecks((n) => n + 1); }
    };
    check();
    const id = window.setInterval(() => { if (Date.now() - (keyTapped(token) ?? 0) < 4 * 60e3) check(); }, 12000);
    const back = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { stop = true; window.clearInterval(id); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [token, onAdded]);
  const slow = Date.now() - (keyTapped(token) ?? Date.now()) > 3 * 60e3;
  return (
    <div className="mt-4">
      <div aria-disabled className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white/[0.08] text-[16px] font-bold text-white/70 ring-1 ring-white/10">
        <CheckCircle2 className="h-5 w-5 text-emerald-300" /> Opened in the Tesla app
      </div>
      <p className="mt-2 flex items-center gap-2 text-[14px] text-white/80" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" style={{ color: ACCENT }} />
        {slow ? "Still waiting for Tesla. Make sure you tapped Accept in the Tesla app." : "Checking with Tesla. This page updates by itself."}
      </p>
      {link && (
        <a href={link} onClick={() => { markKeyTapped(token); track(token, "key_tap", { retry: true }); }}
          className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-semibold underline decoration-white/40 underline-offset-2" style={{ color: ACCENT }}>
          <RotateCcw className="h-4 w-4" /> Didn't work? Try the link again
        </a>
      )}
      <span className="sr-only">{checks} checks</span>
    </div>
  );
}

type Step = { icon: typeof Clock; title: string; body: ReactNode; action?: { label: string; onClick?: () => void; href?: string }; send?: boolean };

/** "Closest Supercharger: <name>, <street>" with the street linked to Maps. */
export const ChargerLine = ({ kind }: { kind: TripKind }) => {
  const c = CHARGERS[kind];
  return <>Closest Supercharger: {c.name}, <a href={chargerMaps(c)} onClick={() => track(undefined, "charger_maps", { kind })} className="font-semibold text-white underline decoration-white/40 underline-offset-2">{c.street}</a>.</>;
};

type NavRun = (a: "nav_charger" | "nav_charger_lax", onStage?: (s: string) => void) => Promise<void>;
/** "Send to car": puts the closest Supercharger in the car's navigation (TezLab first, Tesla backup). */
function SendToCar({ run, kind }: { run?: NavRun; kind: TripKind }) {
  const [st, setSt] = useState<"idle" | "busy" | "done" | "err">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  if (!run) return null;
  const go = async () => {
    setSt("busy"); setMsg(null);
    try { await run(CHARGERS[kind].action, (s) => setMsg(s)); setSt("done"); setMsg("It's in the car's navigation."); }
    catch (e) { setSt("err"); setMsg((e as Error).message || "Couldn't reach the car. Tap the address instead."); }
  };
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={() => void go()} disabled={st === "busy"}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-[#1A1140] shadow-md shadow-black/20 active:scale-95 disabled:opacity-60" style={{ background: ACCENT }}>
        {st === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : st === "done" ? <CheckCircle2 className="h-4 w-4" /> : <Navigation className="h-4 w-4" />}
        {st === "done" ? "Sent to your car" : "Send to car's navigation"}
      </button>
      {msg && <p className={`min-w-0 flex-1 text-[12px] leading-snug ${st === "err" ? "text-red-300" : "text-white/65"}`} aria-live="polite">{msg}</p>}
    </div>
  );
}

export function KeyNextSteps({ trip, pickupBattery, place, kind, maps, go, run }: {
  trip: Trip; pickupBattery?: number | null; place: Place; kind: TripKind; maps: string;
  go: (where: "climate" | "before" | "return" | "pickup") => void;
  run?: NavRun;
}) {
  const now = Date.now(), s = +new Date(trip.starts_at), e = +new Date(trip.ends_at);
  const H = 3600e3;
  let title: string, steps: Step[];
  if (now < s - H) {
    title = "Up next";
    steps = [
      { icon: Clock, title: `Pickup ${fmtWhen(trip.starts_at)}`, body: place.parked, action: { label: "Directions", href: maps } },
      { icon: Snowflake, title: "1 hour before: get it comfy", body: "The Cool it down and Warm it up buttons turn on then.", action: { label: "Car controls", onClick: () => go("climate") } },
      { icon: KeyRound, title: "Skim Before you drive", body: "Trip changes, the Turo Guest profile, paperwork. 1 minute.", action: { label: "Open", onClick: () => go("before") } },
    ];
  } else if (now < s + H) {
    title = "At the car";
    steps = [
      { icon: Smartphone, title: "Open the Tesla app and tap Unlock", body: "First time? The app asks you to set up your phone as the key. Keep Bluetooth on." },
      { icon: MapPin, title: "Not sure which car?", body: "Tap Honk or Flash lights and it'll beep or blink.", action: { label: "Find the car", onClick: () => go("climate") } },
      { icon: CheckCircle2, title: "Take your check-in photos", body: "All around the car, in the Turo app, before you drive off." },
    ];
  } else if (now < e - 3 * H) {
    title = "Enjoy the drive";
    steps = [
      { icon: Undo2, title: `Return by ${fmtWhen(trip.ends_at)}`, body: place.returnTo },
      { icon: BatteryCharging, title: pickupBattery != null ? `Bring it back with at least ${pickupBattery}%` : "Bring it back with the charge you picked up", body: <ChargerLine kind={kind} />, send: true },
    ];
  } else {
    title = "Almost time to return";
    steps = [
      { icon: Undo2, title: `Return by ${fmtWhen(trip.ends_at)}`, body: place.returnSoon, action: { label: "Return steps", onClick: () => go("return") } },
      { icon: BatteryCharging, title: pickupBattery != null ? `Charge to at least ${pickupBattery}%` : "Charge back to pickup level", body: <>Avoids Turo's recharge fee. <ChargerLine kind={kind} /></>, send: true },
      { icon: CheckCircle2, title: "Photos, grab your stuff, lock it", body: "Return photos in the Turo app, then lock in the Tesla app. Your access ends by itself." },
    ];
  }
  return (
    <div className="mt-4 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>{title}</p>
      <ol className="mt-1 divide-y divide-white/10">
        {steps.map((st) => (
          <li key={st.title} className="flex items-start gap-3 px-1 py-3">
            <st.icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: ACCENT }} strokeWidth={1.75} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-snug text-white">{st.title}</p>
              <p className="mt-0.5 text-[14px] leading-snug text-white/75">{st.body}</p>
              {st.send && <SendToCar run={run} kind={kind} />}
            </div>
            {st.action && (st.action.href
              ? <a href={st.action.href} className="shrink-0 rounded-full bg-white/10 px-3 py-2 text-[13px] font-semibold text-white ring-1 ring-white/15 active:scale-95"><Navigation className="mr-1 inline h-3.5 w-3.5" />{st.action.label}</a>
              : <button type="button" onClick={st.action.onClick} className="min-h-[36px] shrink-0 rounded-full bg-white/10 px-3 py-2 text-[13px] font-semibold text-white ring-1 ring-white/15 active:scale-95">{st.action.label}</button>)}
          </li>
        ))}
      </ol>
    </div>
  );
}
