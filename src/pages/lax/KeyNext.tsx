/**
 * Home trip key: what happens after the guest taps "Add the car to my Tesla app".
 *  - KeyPending: the button greys out ("Opened in the Tesla app"), with a small "Try the link again",
 *    while we ask Tesla whether it worked (lax_guest_key_check every 12 s for 4 min, and right away
 *    when they come back from the Tesla app). When it flips to added, the page reloads its data.
 *  - KeyNextSteps: once the key is added, what to do next based on where they are in the trip.
 */
import { useEffect, useRef, useState } from "react";
import { BatteryCharging, CheckCircle2, Clock, KeyRound, Loader2, MapPin, Navigation, RotateCcw, Snowflake, Smartphone, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtWhen, type Trip } from "./GuestExtras";
import { track } from "./track";

const ACCENT = "var(--trip-accent)";
const tapKey = (t: string) => `keytap:${t}`;
export function keyTapped(token: string): number | null {
  try { const v = localStorage.getItem(tapKey(token)); return v ? Number(v) : null; } catch { return null; }
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

type Step = { icon: typeof Clock; title: string; body: string; action?: { label: string; onClick?: () => void; href?: string } };

export function KeyNextSteps({ trip, pickupBattery, address, maps, go }: {
  trip: Trip; pickupBattery?: number | null; address: string; maps: string;
  go: (where: "climate" | "before" | "return" | "pickup") => void;
}) {
  const now = Date.now(), s = +new Date(trip.starts_at), e = +new Date(trip.ends_at);
  const H = 3600e3;
  let title: string, steps: Step[];
  if (now < s - H) {
    title = "Up next";
    steps = [
      { icon: Clock, title: `Pickup ${fmtWhen(trip.starts_at)}`, body: `It's parked on N Kings Rd by ${address.split(",")[0]}.`, action: { label: "Directions", href: maps } },
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
      { icon: Undo2, title: `Return by ${fmtWhen(trip.ends_at)}`, body: "Back on N Kings Rd near the building. Changes go through the Turo app." },
      { icon: BatteryCharging, title: pickupBattery != null ? `Bring it back with at least ${pickupBattery}%` : "Bring it back with the charge you picked up", body: "Closest Supercharger: Tesla Diner, 7001 Santa Monica Blvd.", action: { label: "Directions", href: maps.replace(encodeURIComponent(address), encodeURIComponent("7001 Santa Monica Blvd, West Hollywood, CA")) } },
    ];
  } else {
    title = "Almost time to return";
    steps = [
      { icon: Undo2, title: `Return by ${fmtWhen(trip.ends_at)}`, body: "Park on N Kings Rd near the building, legal spot. Watch the sweeping signs.", action: { label: "Return steps", onClick: () => go("return") } },
      { icon: BatteryCharging, title: pickupBattery != null ? `Charge to at least ${pickupBattery}%` : "Charge back to pickup level", body: "Avoids Turo's recharge fee." },
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
