/**
 * The "what do I do now?" layer shared by the Home and LAX trip pages.
 *  - guideFor(): from the trip time, key state and car, the ONE next step + which things on the page should glow
 *    (the next-step card, the Pickup / Return ticket, the key button, the climate controls).
 *  - NextStep: one line + one button, right under the trip card.
 *  - KeySteps: steps 1–2 of Pickup (Tesla app, then the real "Add the car" button), shown inside the Pickup sheet.
 *  - useHasApp: "I already have the Tesla app", shared by every place that asks.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, KeyRound, Loader2, Lock, ShieldAlert, Smartphone, Snowflake, Undo2, UserRound, Zap } from "lucide-react";
import { fmtWhen, climateNeed, type CarState, type Trip } from "./GuestExtras";
import type { KeyInfo } from "./HomeGuest";
import { KeyPending, SendToCar, keyTapped, markKeyTapped } from "./KeyNext";
import { openCharging } from "./Charging";
import type { RangeCheckData } from "./LiveCharge";
import { returnCharge } from "./ReturnCharge";
import type { TripKind } from "./places";
import { track } from "./track";
import { Lines } from "./Lines";

const ACCENT = "var(--trip-accent)";
const H = 3600e3;
const appStore = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
  ? "https://play.google.com/store/apps/details?id=com.teslamotors.tesla" : "https://apps.apple.com/app/tesla/id582007913";

export function useHasApp() {
  const read = () => { try { return localStorage.getItem("hasTeslaApp") === "1"; } catch { return false; } };
  const [has, setHas] = useState(read);
  useEffect(() => { const f = () => setHas(read()); window.addEventListener("has-app", f); return () => window.removeEventListener("has-app", f); }, []);
  const mark = () => { track(undefined, "have_app"); try { localStorage.setItem("hasTeslaApp", "1"); } catch { /* private mode */ } window.dispatchEvent(new Event("has-app")); };
  return [has, mark] as const;
}

export type GlowTarget = "next" | "pickup" | "return" | "key" | "climate";
export type Next = { icon: typeof Zap; title: string; sub?: string; action?: "getapp" | "pickup" | "return" | "climate" | "send" | "qr"; label?: string; charging?: boolean; chargeCard?: boolean } | null;

/** One place decides what the guest should do now, and what glows. */
export function guideFor({ trip, keyInfo, hasApp, car, controlsOn, kind, qrReady, pickupBattery, rc, now = Date.now() }: {
  trip?: Trip | null; keyInfo?: KeyInfo | null; hasApp: boolean; car?: CarState | null; controlsOn?: boolean; kind: TripKind; qrReady?: boolean; pickupBattery?: number | null; rc?: RangeCheckData; now?: number;
}): { next: Next; glow: Set<GlowTarget> } {
  const glow = new Set<GlowTarget>();
  if (!trip) return { next: null, glow };
  const s = +new Date(trip.starts_at), e = +new Date(trip.ends_at);
  if (now >= e + 30 * 60e3) return { next: null, glow };
  const k = keyInfo && keyInfo.state !== "off" ? keyInfo : null;
  const added = k?.state === "added";
  const opens = k?.opens_at ? +new Date(k.opens_at) : s - 2 * H;

  // After pickup
  if (now >= s + 45 * 60e3) {
    // Charging only comes up when the car would likely get back under the pickup level (= Turo recharge fee).
    const r = returnCharge(car?.battery, pickupBattery, rc);
    const chargeLine = !r.known ? "" : r.needs ? ` Charge to ${pickupBattery}% (same as pickup) first: add about ${r.add}%.` : " You're good on charge.";
    if (now >= e - 3 * H) {
      glow.add("return"); glow.add("next");
      // Short on charge: the card shows the charge arc (headline + gauge) instead of a charge sentence.
      return { next: { icon: Undo2, title: now >= e ? "Return time: park and lock it" : "Time to head back", sub: `${now >= e ? "It was due" : "Return by"} ${fmtWhen(trip.ends_at)}.${r.needs ? "" : chargeLine}`, action: "return", label: "Return steps", chargeCard: r.needs }, glow };
    }
    if (r.needs) return { next: { icon: Zap, title: `Return by ${fmtWhen(trip.ends_at)}`, sub: `Bring it back at ${pickupBattery}%, same as pickup. Add about ${r.add}% before you return.`, action: "send", label: "Send charger to car", charging: true }, glow };
    return { next: { icon: Undo2, title: `Return by ${fmtWhen(trip.ends_at)}`, sub: `Bring it back at the same charge as pickup${pickupBattery != null ? ` (${pickupBattery}%)` : ""}.${r.known ? " You're good on charge right now." : ""}`, charging: true }, glow };
  }
  // Key: not ready yet
  if (k && !added && now < opens) {
    if (!hasApp) { glow.add("next"); return { next: { icon: Smartphone, title: "Step 1: get the free Tesla app", sub: "Your phone will be the car key. Takes 2 minutes.", action: "getapp", label: "Get the app" }, glow }; }
    return { next: { icon: KeyRound, title: "You're set for now", sub: `Come back ${fmtWhen(k.opens_at ?? new Date(opens).toISOString())}. Your key shows up then.`, action: "pickup", label: "See the steps" }, glow };
  }
  // Key: ready (or being made), not added yet
  if (k && !added && ["ready", "making", "problem"].includes(k.state)) {
    glow.add("next"); glow.add("pickup"); glow.add("key");
    return { next: { icon: KeyRound, title: "Your key is ready", sub: "Add the car to your Tesla app. Takes 1 minute.", action: "pickup", label: "Start pickup" }, glow };
  }
  // On the way: 1 hour before pickup until just after it
  if (now >= s - H && controlsOn) {
    glow.add("pickup");
    const need = climateNeed(car?.inside_f, car?.outside_f); // 72° goal: A/C at 80°+, heat at 52° or below
    if (now < s - 10 * 60e3 && !added && (need === "cool" || need === "warm")) {
      glow.add("climate");
      return { next: { icon: Snowflake, title: need === "cool" ? "On your way? Cool the car first." : "On your way? Warm the car first.", sub: car?.inside_f != null ? `It's ${Math.round(car.inside_f)}° inside right now.` : undefined, action: "climate", label: need === "cool" ? "Cool it down" : "Warm it up" }, glow };
    }
    return { next: { icon: KeyRound, title: k ? "At the car: tap “Set Up”, then Unlock" : "Pickup time", sub: k ? "In the Tesla app, next to the car, Bluetooth on." : "Follow the pickup steps.", action: "pickup", label: "Pickup steps" }, glow };
  }
  // Key added, pickup later
  if (added) return { next: { icon: CheckCircle2, title: "Key added. You're all set.", sub: `Pickup ${fmtWhen(trip.starts_at)}. You can cool or warm the car 1 hour before.`, action: "pickup", label: "Pickup steps" }, glow };
  // No phone key on this trip (older LAX trips)
  if (kind === "lax" && qrReady && now >= s - 24 * H) return { next: { icon: Lock, title: "Your QR code opens the lobby door", sub: "Add it to your phone's Wallet now.", action: "qr", label: "Show QR code" }, glow };
  return { next: { icon: ArrowRight, title: `Pickup ${fmtWhen(trip.starts_at)}`, sub: "Tap Pickup at the bottom for the steps.", action: "pickup", label: "Pickup steps" }, glow };
}

export function NextStep({ next, glow, onAction, onHasApp, run, kind, extra }: {
  next: Next; glow: boolean; onAction: (a: NonNullable<NonNullable<Next>["action"]>) => void; onHasApp: () => void; extra?: ReactNode;
  run?: (a: "nav_charger" | "nav_charger_lax", onStage?: (s: string) => void) => Promise<void>; kind: TripKind;
}) {
  if (!next) return null;
  const Icon = next.icon;
  return (
    <section aria-label="Next step" className={`mt-4 rounded-3xl p-4 ring-1 ring-white/10 ${glow ? "trip-glow trip-glow-card" : "bg-white/[0.06]"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Next step</p>
      <div className="mt-1.5 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: ACCENT }}><Icon className="h-5 w-5 text-[#1A1140]" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-bold leading-snug text-white">{next.title}</p>
          {next.sub && <p className="mt-0.5 text-[14px] leading-snug text-white/75"><Lines>{next.sub}</Lines></p>}
        </div>
      </div>
      {extra && <div className="mt-3 text-[14px] leading-relaxed text-white/80">{extra}</div>}
      {next.action === "send" ? (
        <div className="mt-1 pl-[52px]"><SendToCar run={run} kind={kind} /></div>
      ) : next.action === "getapp" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a href={appStore()} onClick={() => track(undefined, "get_app")} className="flex h-12 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-bold text-[#1A1140]" style={{ background: ACCENT }}><Smartphone className="h-4 w-4" /> Get the app</a>
          <button type="button" onClick={onHasApp} className="flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-white/10 text-[15px] font-semibold text-white ring-1 ring-white/15"><CheckCircle2 className="h-4 w-4" /> I have it</button>
        </div>
      ) : next.action ? (
        <button type="button" onClick={() => onAction(next.action!)}
          // With the charge card up, charging is the main action: Return steps steps back to a secondary button.
          className={`mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold active:scale-[0.99] ${next.chargeCard ? "bg-white/10 text-white ring-1 ring-white/15" : "text-[#1A1140] shadow-lg shadow-black/25"}`} style={next.chargeCard ? undefined : { background: ACCENT }}>
          {next.label}<ArrowRight className="h-4 w-4" />
        </button>
      ) : null}
      {next.charging && (
        // On the trip: tell them where Supercharging costs show up.
        <button type="button" onClick={() => { track(undefined, "next_charging"); openCharging(); }}
          className="mt-3 flex min-h-[44px] w-full items-center gap-2.5 border-t border-white/10 pt-3 text-left text-[14px] leading-snug text-white/80 active:opacity-70">
          <Zap className="h-4 w-4 shrink-0" style={{ color: ACCENT }} aria-hidden />
          <span className="min-w-0 flex-1"><b className="font-semibold text-white">Supercharging?</b> Come back here to see each stop and what it cost.</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
        </button>
      )}
    </section>
  );
}

function Row({ n, done, title, children }: { n: number; done?: boolean; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      {done ? <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-emerald-300" />
        : <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[14px] font-bold text-[#1A1140]" style={{ background: ACCENT }}>{n}</span>}
      <div className="min-w-0 flex-1">
        <p className={`text-[17px] font-semibold leading-snug ${done ? "text-white/70" : "text-white"}`}>{title}</p>
        {children && <div className="mt-1 text-[15px] leading-relaxed text-white/80">{children}</div>}
      </div>
    </li>
  );
}

/** Pickup steps 1–2: the phone key. The real "Add the car" button lives here (it glows when it's time). */
export function KeySteps({ k, token, hasApp, onHasApp, onAdded, glow }: { k: KeyInfo; token: string; hasApp: boolean; onHasApp: () => void; onAdded: () => void; glow?: boolean }) {
  const inviteFrom = k.expires_at ? Date.parse(k.expires_at) - 24 * 3600e3 - 5e3 : Date.now() - 24 * 3600e3;
  const [tapped, setTapped] = useState(() => (keyTapped(token) ?? 0) > inviteFrom);
  useEffect(() => { setTapped((keyTapped(token) ?? 0) > inviteFrom); }, [k.link, inviteFrom, token]);
  const added = k.state === "added";
  return (
    <ol className="space-y-5">
      <Row n={1} done={hasApp || added} title={hasApp || added ? "Tesla app: done" : "Get the free Tesla app"}>
        {!(hasApp || added) && (
          <>
            Sign in, or make a free account. About 2 minutes.
            <span className="mt-2.5 grid grid-cols-2 gap-2">
              <a href={appStore()} onClick={() => track(undefined, "get_app")} className="flex h-11 items-center justify-center gap-1.5 rounded-xl text-[14px] font-bold text-[#1A1140]" style={{ background: ACCENT }}><Smartphone className="h-4 w-4" /> Get the app</a>
              <button type="button" onClick={onHasApp} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-[14px] font-semibold text-white ring-1 ring-white/15"><CheckCircle2 className="h-4 w-4" /> I have it</button>
            </span>
          </>
        )}
      </Row>
      <Row n={2} done={added} title={added ? "Car added to your Tesla app" : "Add the car to your Tesla app"}>
        {k.state === "soon" && (
          <>
            <span className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white/[0.06] text-[15px] font-semibold text-white/55 ring-1 ring-white/10"><Lock className="h-4 w-4" /> Turns on {k.opens_at ? fmtWhen(k.opens_at) : "2 hours before pickup"}</span>
            <span className="mt-1.5 block text-[13px] text-white/60">Come back then. This button turns on by itself.</span>
          </>
        )}
        {k.state === "making" && <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" style={{ color: ACCENT }} /> Making your key. This updates by itself.</span>}
        {k.state === "ready" && (k.link
          ? tapped ? <KeyPending token={token} link={k.link} onAdded={onAdded} />
            : <>
                <span className={`block rounded-2xl ${glow ? "trip-glow" : ""}`}>
                  <a href={k.link} onClick={() => { track(undefined, "key_tap"); markKeyTapped(token); window.setTimeout(() => setTapped(true), 600); }}
                    className="flex h-14 items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#1A1140] shadow-lg shadow-black/30 active:scale-[0.99]" style={{ background: ACCENT }}>
                    <KeyRound className="h-5 w-5" /> {k.link === "#demo-key" ? "Pretend: add the car" : "Add the car to my Tesla app"}
                  </a>
                </span>
                {k.link === "#demo-key"
                  ? <span className="mt-1.5 block rounded-xl bg-amber-400/10 px-3 py-2 text-[13px] leading-snug text-amber-100 ring-1 ring-amber-300/30">This device isn't set up as yours yet, so this key is pretend. <a href="/admin" className="font-semibold text-white underline underline-offset-2">Sign in to admin once on this device</a>, then come back: from then on it's the real key here.</span>
                  : <span className="mt-1.5 block text-[13px] text-white/65">Then tap <b className="text-white">Accept</b> in the Tesla app. One-time link, just for you.</span>}
              </>
          : <span className="block rounded-xl bg-white/10 p-3 text-[14px]">Preview: the real button appears here 2 hours before pickup.</span>)}
        {k.state === "problem" && <span className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />Your key is taking longer than usual. Your host knows and it retries by itself.</span>}
        {added && "Walk up with your phone and it unlocks. Access ends by itself after your trip."}
      </Row>
    </ol>
  );
}

/** Wraps a ticket (Pickup / Return) so the glow can sit outside its clipped shape. */
export function GlowWrap({ on, children, className = "" }: { on: boolean; children: ReactNode; className?: string }) {
  return <span className={`relative flex flex-1 rounded-[18px] ${on ? "trip-glow" : ""} ${className}`}>{children}</span>;
}


/** The car can't be switched to the "Turo Guest" driver profile remotely (Tesla has no API for it), so we ask once, clearly. */
export function ProfileTip() {
  return (
    <span className="mt-3 flex items-start gap-2.5 rounded-2xl bg-white/[0.08] p-3 text-[15px] leading-snug text-white/85 ring-1 ring-white/10">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15"><UserRound className="h-4 w-4 text-white" aria-hidden /></span>
      <span>Tap the <b className="text-white">person icon</b> at the top of the car's screen and pick <b className="text-white">&ldquo;Turo Guest&rdquo;</b>. It's your driver profile for the trip.</span>
    </span>
  );
}
