/**
 * Delivery version of the Turo trip page (/t/:token when the trip is not at LAX and not a home pickup: hotels, pods,
 * Union Station, any address). Jared drives the Tesla to the guest, so there is no garage, no spot to find and no QR.
 *
 * Leo-first, built fresh (Jared, 2026-10-12): the page IS Leo's orb. Tap it and Leo talks, right here, no sheet. He collects
 * the room number and what the front desk said about parking and hands it to Jared (agentic); the guest can type it instead.
 * The look is the printed "Hi, I'm Leo." delivery card: light cream, orange orb, ink text (delivery.css).
 *
 * Data: lax_guest_public(token) -> `place: "delivery"` + `delivery` { kind, name, short, address, lat, lon, ask, info }, with
 * `kind` still "home" so older pages keep working. Same key / car / charging fields as the Home page, so key gating is shared:
 * no key until the license is checked and Jared's check-in photos are done.
 * Typed fallback: trip_delivery_report(token, room, front_desk, parking, eta, via 'page'). Demo (/t/demo-delivery) never calls it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { Camera, CheckCircle2, Car, ChevronDown, KeyRound, Loader2, MapPin, Navigation, Phone, Send, Star, Undo2, Users, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import "./delivery.css";
import { tripTab } from "./TripSheet";
import { KeyHelp, useStuck } from "./KeyHelp";
import { CarCard, ClimateAdvice, DEMO_CAR, TripCard, TripChanged, WeatherCard, climateNeed, fmtWhen } from "./GuestExtras";
import { KeyPending, SendToCar, keyTapped, markKeyTapped, useKeyWatch } from "./KeyNext";
import { useHasApp } from "./Guide";
import ExtraDrivers from "./ExtraDrivers";
import { HostPanel } from "./HostPanel";
import { InstallToast } from "./InstallToast";
import { TURO_TRIPS, type Delivery, type DeliveryInfo, type DeliveryKey } from "./places";
import { TripDone, tripEnded } from "./TripDone";
import { track } from "./track";
import { askPage, emitLeoCar } from "./leoBridge";
import { tv, useLeoSession, type Any, type LeoApi } from "./useLeoSession";
import { AskChips, LeoHero } from "./DeliveryLeo";
import { LeoDock } from "./LeoDock";
import { leoNudgeItems, type NudgeKey, type NudgeSection } from "./leoNudges";
import type { CarAction, HomePub, KeyInfo } from "./HomeGuest";

export type DeliveryPub = HomePub & { place?: "lax" | "home" | "delivery"; delivery?: Delivery | null };

const CALL = "(310) 622-7052";
const CALL_HREF = "tel:+13106227052";
const INK = "var(--d-ink)", BODY = "var(--d-body)", LABEL = "var(--d-label)";
const nw = (s: ReactNode) => <span className="whitespace-nowrap">{s}</span>;
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const rpc = (fn: string, args?: Record<string, unknown>) => supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const android = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
const mapsHref = (q: string, lat?: number | null, lon?: number | null) => android()
  ? (lat != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`)
  : (lat != null ? `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(q)}` : `https://maps.apple.com/?q=${encodeURIComponent(q)}`);
/** First name only if it is a clean short word (never cut it; drop it instead). */
const cleanFirst = (f?: string | null) => { const w = (f ?? "").trim().split(/\s+/)[0] ?? ""; return /^[A-Za-zÀ-ÿ'-]{1,20}$/.test(w) && w.toLowerCase() !== "demo" ? w : ""; };
const cityOf = (address: string, fallback: string) => { const p = address.split(",").map((x) => x.trim()); return p.length >= 3 ? p[p.length - 2] : fallback; };
const t12 = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
function useTick(ms: number) { const [, n] = useState(0); useEffect(() => { const id = window.setInterval(() => n((x) => x + 1), ms); return () => window.clearInterval(id); }, [ms]); }

// ---------------------------------------------------------------------------------------------------------------------
// What Leo collects, per kind of place. `ask` from the server says which of these are still needed.
type Field = { key: DeliveryKey; label: string; question: string; ph: string; optional?: boolean };
const FIELDS: Record<Delivery["kind"], Field[]> = {
  hotel: [
    { key: "room", label: "Room number", question: "Room number", ph: "For example 214" },
    { key: "front_desk", label: "Parking, from the front desk", question: "What did the front desk say about parking?", ph: "Garage, valet, fees, overnight rules" },
  ],
  pod: [
    { key: "room", label: "Pod or room number", question: "Pod or room number", ph: "For example Pod 12" },
    { key: "front_desk", label: "Parking, from the front desk", question: "What did the front desk say about parking?", ph: "Garage, valet, fees, overnight rules" },
  ],
  train: [{ key: "eta", label: "When your train gets in", question: "When does your train get in?", ph: "For example 3:40 PM" }],
  custom: [
    { key: "room", label: "Unit or apt", question: "Unit or apt (optional)", ph: "Leave blank if there isn't one", optional: true },
    { key: "parking", label: "Parking notes", question: "Parking notes", ph: "Gate code, where to park, anything Jared should know" },
  ],
};
const DONE_LINE: Record<Delivery["kind"], string> = {
  hotel: "Got it. Jared has your room number.", pod: "Got it. Jared has your pod number.",
  train: "Got it. Jared knows when your train gets in.", custom: "Got it. Jared has your notes.",
};
const REPORT_ARG: Record<DeliveryKey, string> = { room: "p_room", front_desk: "p_front_desk", parking: "p_parking", eta: "p_eta" };

type Step = 0 | 1 | 2 | 3; // 0 Jared drives over, 1 photos, 2 key turns on, 3 all done
function stepNow(o: { now: number; startsAt?: string; key: KeyInfo | null; ended: boolean; carConnected: boolean }): Step {
  if (o.ended || o.carConnected || o.key?.state === "added") return 3;
  if (o.key && ["ready", "making", "problem"].includes(o.key.state)) return 2;
  if (o.startsAt && o.now >= +new Date(o.startsAt) - 30 * 60e3) return 1;
  return 0;
}

/** The one line under "Hi, I'm Leo." It changes with the moment of the trip. */
function leoLine(o: { d: Delivery; pending: DeliveryKey[]; complete: boolean; step: Step; key: KeyInfo | null; trip?: { starts_at: string; ends_at: string }; ended: boolean; now: number }): string {
  const { d, pending, complete, step, key, trip, ended, now } = o;
  if (ended) return "Thanks for the ride. Left something in the car? Tell me and I'll pass it to Jared.";
  const mtr = trip ? Math.round((+new Date(trip.ends_at) - now) / 60000) : null;
  if (step === 3 && key?.state === "added" && mtr != null && mtr <= 180 && mtr > -30) return `Your return is ${fmtWhen(trip!.ends_at)}. Want the quick return steps?`;
  if (step === 3) return "Your key is on. Need help with anything?";
  if (key?.state === "ready") return "Your key is ready. Tap the button below to add it to your Tesla app.";
  if (key?.state === "making") return "Jared's done with the check-in. Your key is on its way.";
  if (pending.length && d.kind === "train") return "Tell me when your train gets in and I'll pass it to Jared.";
  if (pending.length && d.kind === "custom") return "Tell me any unit number or parking notes and I'll pass them to Jared.";
  if (pending.length) return `Tell me your ${d.kind === "pod" ? "pod or room number" : "room number"} and I'll pass it to Jared.`;
  const mtp = trip ? Math.round((+new Date(trip.starts_at) - now) / 60000) : null;
  if (step === 1 || (mtp != null && mtp <= 45)) return "Jared's on his way with your Tesla.";
  if (complete) return `${DONE_LINE[d.kind]} Ask me anything while you wait.`;
  return "Your 24/7 trip helper. The water's on us.";
}

// ---------------------------------------------------------------------------------------------------------------------
function Panel({ id, kicker, title, children, className = "" }: { id?: string; kicker: string; title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-label={kicker} className={`mt-5 scroll-mt-4 rounded-[28px] bg-white/[0.66] p-4 ring-1 ring-[rgba(19,40,42,0.09)] ${className}`} style={{ boxShadow: "0 16px 34px -26px rgba(143,77,18,.45)" }}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: LABEL }}>{kicker}</p>
      {title && <h2 className="mt-1.5 text-[24px] font-bold leading-tight tracking-[-0.01em]" style={{ fontFamily: "var(--trip-title-font)", color: INK }}>{title}</h2>}
      <div className={title ? "mt-3" : "mt-2"}>{children}</div>
    </section>
  );
}

const btnPrimary = "flex min-h-[52px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[#E2733A] px-3 text-[16px] font-bold text-[#13282A] shadow-md shadow-[rgba(143,77,18,0.25)] active:scale-[0.99] disabled:opacity-60";
const btnQuiet = "flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[rgba(19,40,42,0.07)] px-4 text-[15px] font-semibold ring-1 ring-[rgba(19,40,42,0.14)] active:scale-[0.98]";

// ---------- Where Jared is bringing it, and what Leo still needs ----------
function DeliveryCard({ d, info, token, demo, onSaved, askLeo }: { d: Delivery; info: DeliveryInfo; token: string; demo: boolean; onSaved: (v: DeliveryInfo) => void; askLeo: () => void }) {
  const fields = FIELDS[d.kind] ?? FIELDS.custom;
  const ask = d.ask ?? fields.filter((f) => !f.optional).map((f) => f.key);
  const rows = fields.filter((f) => info[f.key] || ask.includes(f.key));
  const missing = rows.filter((f) => !info[f.key] && !f.optional);
  const complete = rows.length > 0 && missing.length === 0;
  const [form, setForm] = useState(false);
  const [vals, setVals] = useState<Partial<Record<DeliveryKey, string>>>({});
  const [st, setSt] = useState<"idle" | "busy" | "ok" | "err">("idle");
  useEffect(() => { setVals(Object.fromEntries(fields.map((f) => [f.key, info[f.key] ?? ""]))); }, [d.kind, info.room, info.front_desk, info.parking, info.eta]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = Object.fromEntries(fields.map((f) => [f.key, (vals[f.key] ?? "").trim().slice(0, 200)])) as Record<DeliveryKey, string>;
    if (!fields.some((f) => clean[f.key])) return;
    setSt("busy");
    if (!demo) {
      const args: Record<string, unknown> = { p_token: token, p_room: null, p_front_desk: null, p_parking: null, p_eta: null, p_via: "page" };
      fields.forEach((f) => { args[REPORT_ARG[f.key]] = clean[f.key] || null; });
      const { error } = await rpc("trip_delivery_report", args).catch((x) => ({ data: null, error: { message: String(x) } }));
      if (error) { setSt("err"); return; }
    } else await new Promise((r) => setTimeout(r, 500));
    track(token, "delivery_info", { via: "page" });
    onSaved({ ...Object.fromEntries(fields.map((f) => [f.key, clean[f.key] || null])), reported_at: new Date().toISOString(), via: "page" });
    setSt("ok"); setForm(false);
  };

  return (
    <Panel id="delivery" kicker="Delivered to" title={d.name}>
      <a href={mapsHref(d.address, d.lat, d.lon)} onClick={() => track(token, "directions", { to: "delivery" })} className="-mt-1 inline-flex min-h-[44px] items-start gap-2 text-[16px] leading-snug underline decoration-[rgba(19,40,42,0.35)] underline-offset-4" style={{ color: BODY }}>
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{d.address}</span>
      </a>

      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-[rgba(19,40,42,0.10)] rounded-2xl bg-[rgba(255,255,255,0.7)] ring-1 ring-[rgba(19,40,42,0.08)]" aria-label="What Jared needs from you">
          {rows.map((f) => {
            const v = info[f.key];
            return (
              <li key={f.key} className="flex items-start gap-3 px-3.5 py-3">
                {v ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" style={{ color: "#1B7A4B" }} aria-label="Done" />
                  : <span aria-label={f.optional ? "Optional" : "Still needed"} className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full ring-2 ring-[#E2733A]"><span className="h-2 w-2 rounded-full bg-[#E2733A]" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.1em]" style={{ color: BODY }}>{f.label}</p>
                  <p className={`mt-0.5 break-words text-[17px] leading-snug ${v ? "font-semibold" : ""}`} style={{ color: v ? INK : BODY }}>{v ?? (f.optional ? "Optional" : "Still needed")}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {complete ? (
        <p role="status" className="mt-3 flex items-start gap-2 text-[16px] font-semibold leading-snug" style={{ color: "#1B6B42" }}><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />{DONE_LINE[d.kind]}</p>
      ) : rows.length > 0 && (
        <p className="mt-3 text-[15px] leading-snug" style={{ color: BODY }}>Tell Leo above, or type it here. It goes straight to Jared.</p>
      )}

      {rows.length > 0 && !form && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {!complete && <button type="button" onClick={askLeo} className={btnPrimary}>Tell Leo</button>}
          <button type="button" onClick={() => { setForm(true); setSt("idle"); }} className={`${btnQuiet} ${complete ? "col-span-2" : ""}`}>{complete ? "Change it" : "Rather type it?"}</button>
        </div>
      )}

      {form && (
        <form onSubmit={submit} className="mt-3 grid gap-3">
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-[14px] font-semibold" style={{ color: INK }}>{f.question}</span>
              <input value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} maxLength={200} placeholder={f.ph}
                inputMode={f.key === "room" && d.kind !== "pod" ? "text" : undefined} autoComplete="off"
                className="mt-1 h-12 w-full rounded-xl border-0 bg-white px-3 text-[16px] text-[#13282A] ring-1 ring-[rgba(19,40,42,0.20)] placeholder:text-[#6A7371] focus:outline-none focus:ring-2 focus:ring-[#13282A]" />
            </label>
          ))}
          {st === "err" && <p role="alert" className="text-[14px] font-medium" style={{ color: "#B3261E" }}>That didn't send. Try again, or tell Leo.</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setForm(false)} className={btnQuiet}>Cancel</button>
            <button type="submit" disabled={st === "busy" || !fields.some((f) => (vals[f.key] ?? "").trim())} className={btnPrimary}>
              {st === "busy" ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}Send to Jared
            </button>
          </div>
        </form>
      )}
      {st === "ok" && !form && <p role="status" className="sr-only">Sent to Jared.</p>}
    </Panel>
  );
}

// ---------- How delivery works ----------
function HowItWorks({ step, d, startsAt }: { step: Step; d: Delivery; startsAt?: string }) {
  const rows: { title: string; sub: string }[] = [
    { title: `Jared drives your Tesla to ${d.short}`, sub: startsAt ? `Scheduled for ${fmtWhen(startsAt)}.` : "He brings it right to you." },
    { title: "About 10 minutes of photos", sub: "He checks the car over and takes photos, so you're both covered." },
    { title: "Your phone key turns on", sub: "Tap the key button here, then walk up and the car unlocks." },
  ];
  return (
    <Panel id="how" kicker="How delivery works">
      <ol className="grid gap-1">
        {rows.map((r, i) => {
          const done = step > i, cur = step === i;
          return (
            <li key={r.title} aria-current={cur ? "step" : undefined} className={`flex gap-3 rounded-2xl p-2.5 ${cur ? "bg-white/[0.8] ring-1 ring-[rgba(226,115,58,0.55)]" : ""}`}
              style={cur ? { boxShadow: "0 0 26px -6px rgba(226,115,58,0.45)" } : undefined}>
              {done ? <CheckCircle2 className="mt-0.5 h-8 w-8 shrink-0" style={{ color: "#1B7A4B" }} aria-label="Done" />
                : <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[15px] font-bold ${cur ? "bg-[#E2733A] text-[#13282A]" : "bg-transparent ring-2 ring-[rgba(19,40,42,0.28)]"}`} style={cur ? undefined : { color: BODY }}>{i + 1}</span>}
              <div className="min-w-0 flex-1">
                <p className="text-[17px] font-semibold leading-snug" style={{ color: done ? BODY : INK }}>{r.title}</p>
                <p className="mt-0.5 text-[15px] leading-snug" style={{ color: BODY }}>{r.sub}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

// ---------- Your key (same states and gating as the Home page) ----------
function KeyBlock({ k, token, d, hasApp, onHasApp, onAdded }: { k: KeyInfo; token: string; d: Delivery; hasApp: boolean; onHasApp: () => void; onAdded: () => void }) {
  const inviteFrom = k.expires_at ? Date.parse(k.expires_at) - 24 * 3600e3 - 5e3 : Date.now() - 24 * 3600e3;
  const [tapped, setTapped] = useState(() => (keyTapped(token) ?? 0) > inviteFrom);
  useEffect(() => { setTapped((keyTapped(token) ?? 0) > inviteFrom); }, [k.link, inviteFrom, token]);
  const slow = useStuck(k.state === "making", 150_000);
  const added = k.state === "added";
  const store = android() ? "https://play.google.com/store/apps/details?id=com.teslamotors.tesla" : "https://apps.apple.com/app/tesla/id582007913";
  if (k.state === "off") return null;
  const title = added ? "You're all set. Your phone is the key." : k.state === "ready" ? "Your key is ready. Tap the button." : "Your phone is the car key";
  if (k.state === "ended") return <Panel id="key" kicker="Your key"><p className="text-[16px] leading-snug" style={{ color: BODY }}>Your trip is over, so your key has been turned off. Thanks for driving with us.</p></Panel>;
  const Row = ({ n, done, t, children }: { n: number; done?: boolean; t: string; children?: ReactNode }) => (
    <li className="flex gap-3">
      {done ? <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0" style={{ color: "#1B7A4B" }} aria-label="Done" />
        : <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#E2733A] text-[14px] font-bold text-[#13282A]">{n}</span>}
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold leading-snug" style={{ color: done ? BODY : INK }}>{t}</p>
        {children && <div className="mt-1 text-[15px] leading-relaxed" style={{ color: BODY }}>{children}</div>}
      </div>
    </li>
  );
  return (
    <Panel id="key" kicker="Your key" title={title} className={k.state === "ready" && !tapped ? "dl-ready" : ""}>
      {added ? (
        <p className="flex items-start gap-2 text-[16px] leading-relaxed" style={{ color: BODY }}><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "#1B7A4B" }} aria-hidden />The car is in your Tesla app. Walk up with your phone and it unlocks. Access ends by itself after your trip.</p>
      ) : (
        <ol className="space-y-5">
          <Row n={1} done={hasApp} t={hasApp ? "Tesla app: done" : "Get the free Tesla app"}>
            {!hasApp && <>
              Sign in, or make a free account. About 2 minutes.
              <span className="mt-2.5 grid grid-cols-2 gap-2">
                <a href={store} onClick={() => track(undefined, "get_app")} className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#E2733A] text-[15px] font-bold text-[#13282A]">Get the app</a>
                <button type="button" onClick={onHasApp} className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[rgba(19,40,42,0.07)] text-[15px] font-semibold ring-1 ring-[rgba(19,40,42,0.14)]" style={{ color: INK }}><CheckCircle2 className="h-4 w-4" aria-hidden />I have it</button>
              </span></>}
          </Row>
          <Row n={2} t="Add the car to your Tesla app">
            {k.state === "soon" && k.hold && (
              <span className="grid gap-2.5">
                {k.hold.license && <span className="flex gap-3 rounded-2xl bg-[rgba(19,40,42,0.05)] p-3"><Camera className="mt-0.5 h-5 w-5 shrink-0" style={{ color: LABEL }} aria-hidden /><span><b style={{ color: INK }}>Add your driver's license in the Turo app.</b> Already did? You're all set.</span></span>}
                <span className="flex gap-3 rounded-2xl bg-[rgba(19,40,42,0.05)] p-3"><Car className="mt-0.5 h-5 w-5 shrink-0" style={{ color: LABEL }} aria-hidden /><span><b style={{ color: INK }}>Jared's check-in photos at {d.short}.</b> When he's done, your key button shows up right here by itself. No need to refresh.</span></span>
              </span>
            )}
            {k.state === "soon" && !k.hold && (
              <span className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-[rgba(19,40,42,0.06)] px-3 text-center text-[15px] font-semibold" style={{ color: BODY }}><Lock className="h-4 w-4 shrink-0" aria-hidden />Turns on {k.opens_at ? fmtWhen(k.opens_at) : "after Jared's check-in"}</span>
            )}
            {k.state === "making" && (slow ? <KeyHelp slow accent="var(--trip-accent)" /> : <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Making your key. This updates by itself.</span>)}
            {k.state === "ready" && (k.link
              ? tapped ? <KeyPending token={token} link={k.link} onAdded={onAdded} />
                : <>
                    <a href={k.link} onClick={() => { track(undefined, "key_tap"); markKeyTapped(token); window.setTimeout(() => setTapped(true), 600); }} className={`${btnPrimary} h-14 text-[17px]`}>
                      <KeyRound className="h-5 w-5" aria-hidden />{k.link === "#demo-key" ? "Pretend: add the car" : "Add the car to my Tesla app"}
                    </a>
                    <span className="mt-2 block text-[14px]">Then tap <b style={{ color: INK }}>Accept</b> in the Tesla app. One-time link, just for you.</span>
                  </>
              : <span className="block rounded-xl bg-[rgba(19,40,42,0.06)] p-3 text-[14px]">Preview: the real button appears here after Jared's check-in.</span>)}
            {k.state === "problem" && <KeyHelp slow={false} accent="var(--trip-accent)" />}
          </Row>
        </ol>
      )}
      <details className="group mt-4 rounded-2xl bg-[rgba(19,40,42,0.04)] ring-1 ring-[rgba(19,40,42,0.08)]">
        <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-3.5 text-[15px] font-semibold" style={{ color: INK }}>
          <Users className="h-4 w-4 shrink-0" aria-hidden /><span className="flex-1">Someone else driving?</span><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="px-3.5 pb-3.5"><ExtraDrivers token={token} embedded /></div>
      </details>
    </Panel>
  );
}

// ---------- Return: same place, same charge ----------
function ReturnBlock({ d, trip, pickup, battery, run }: { d: Delivery; trip?: { ends_at: string }; pickup?: number | null; battery?: number | null; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void> }) {
  const known = pickup != null && battery != null;
  const add = known ? Math.max(0, pickup! - battery!) : 0;
  const rows = [
    { Icon: MapPin, t: `Park at ${d.short}, same spot as pickup`, s: d.return_note && !/same place/i.test(d.return_note) ? d.return_note : "Where Jared dropped it off." },
    { Icon: Camera, t: "Return photos in the Turo app", s: "All around the car." },
    { Icon: Lock, t: "Lock it in the Tesla app", s: "Your key turns off by itself. Nothing to hand back." },
  ];
  return (
    <Panel id="return" kicker="Return" title={<>Bring it back to {d.short}</>}>
      <p className="text-[17px] leading-snug" style={{ color: BODY }}>Same place as pickup.{trip && <> Return by <b style={{ color: INK }}>{fmtWhen(trip.ends_at)}</b>.</>}</p>
      <div className="mt-3 rounded-2xl bg-[rgba(255,255,255,0.7)] p-3.5 ring-1 ring-[rgba(19,40,42,0.08)]">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: LABEL }}>Charge rule</p>
        <p className="mt-1 text-[17px] font-semibold leading-snug" style={{ color: INK }}>Bring it back at the same battery level as pickup{pickup != null ? <> ({nw(`${pickup}%`)})</> : null}.</p>
        {known && <p className="mt-1 text-[15px] leading-snug" style={{ color: BODY }}>{add > 0 ? <>It's at {nw(`${battery}%`)} now. Add about {nw(`${add}%`)} before you return to avoid Turo's recharge fee.</> : <>It's at {nw(`${battery}%`)} now. You're good on charge.</>}</p>}
        {!known && <p className="mt-1 text-[15px] leading-snug" style={{ color: BODY }}>Under that level, Turo adds a recharge fee. Leo can find a Supercharger.</p>}
        {add > 0 && <SendToCar center run={run} kind="home" label="Send nearest Supercharger to car" />}
      </div>
      <ul className="mt-3 grid gap-3">
        {rows.map(({ Icon, t, s }) => (
          <li key={t} className="flex items-start gap-3"><Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: LABEL }} strokeWidth={1.9} aria-hidden />
            <div className="min-w-0"><p className="text-[16px] font-semibold leading-snug" style={{ color: INK }}>{t}</p><p className="text-[15px] leading-snug" style={{ color: BODY }}>{s}</p></div></li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={mapsHref(d.address, d.lat, d.lon)} onClick={() => track(undefined, "directions", { to: "delivery_return" })} className={btnQuiet}><Navigation className="h-4 w-4" aria-hidden />Directions</a>
        <a href={TURO_TRIPS} target="_blank" rel="noreferrer" onClick={() => track(undefined, "turo_app")} className={btnQuiet}><Undo2 className="h-4 w-4" aria-hidden />Open Turo</a>
      </div>
    </Panel>
  );
}

// ---------- Footer, from the back of the card ----------
function Footer() {
  return (
    <footer className="mt-10 text-center">
      <a href={TURO_TRIPS} target="_blank" rel="noreferrer" onClick={() => track(undefined, "review_tap")} className="mx-auto block max-w-[19rem] rounded-2xl px-2 py-2 active:opacity-80">
        <span className="flex justify-center gap-1.5" role="img" aria-label="5 stars">{[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-5 w-5" style={{ color: "var(--d-star)", fill: "var(--d-star)" }} strokeWidth={1.5} aria-hidden />)}</span>
        <span className="mt-2.5 block text-[16px] leading-snug" style={{ color: INK }}>Loved the ride? A 5-star review on Turo helps a small host a ton.</span>
      </a>
      <a href={CALL_HREF} onClick={() => track(undefined, "call_leo")} className="mx-auto mt-3 inline-flex min-h-[48px] items-center gap-2 rounded-full px-5 text-[16px] font-semibold ring-1 ring-[rgba(19,40,42,0.18)]" style={{ color: INK }}>
        <Phone className="h-4 w-4" aria-hidden />Call Leo {nw(CALL)}
      </a>
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.26em]" style={{ color: LABEL }}>Powered by Bestly Agents</p>
    </footer>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
export default function DeliveryGuest({ pub, token, run, demoPage, reload }: { pub: DeliveryPub; token: string; run?: (a: CarAction, onStage?: (s: string) => void) => Promise<void>; demo?: string | null; demoPage?: boolean; reload?: () => void }) {
  useTick(30_000);
  const now = Date.now();
  const d: Delivery = pub.delivery ?? { kind: "custom", name: "your location", short: "your location", address: "", ask: [], info: null };
  const fields = FIELDS[d.kind] ?? FIELDS.custom;
  const isDemo = token.startsWith("demo-");
  const trip = pub.trip;
  const ended = tripEnded(trip);
  const onTrip = !!trip && !ended && now >= +new Date(trip.starts_at);
  const key: KeyInfo | null = pub.key ?? null;
  const first = cleanFirst(demoPage ? null : trip?.first);

  // What Jared knows so far. The server's copy replaces ours whenever it changes (Leo saved something, or the demo stage moved).
  const [info, setInfo] = useState<DeliveryInfo>(d.info ?? {});
  const infoKey = JSON.stringify(d.info ?? null);
  useEffect(() => { setInfo(d.info ?? {}); }, [infoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ask = d.ask ?? fields.filter((f) => !f.optional).map((f) => f.key);
  const pending = ask.filter((k) => !info[k]);
  const rows = fields.filter((f) => info[f.key] || ask.includes(f.key));
  const complete = rows.length > 0 && rows.every((f) => f.optional || info[f.key]);

  // Key (same gating as Home): the key button only exists after the license is checked and Jared's photos are done.
  const [hasApp, markHasApp] = useHasApp();
  useKeyWatch(token, key?.state ?? "off", key?.opens_at, () => reload?.());
  const carConnected = !pub.demo_open && (!!pub.car_connected_at || (!!trip && now > +new Date(trip.starts_at) + 45 * 60e3));
  const step = stepNow({ now, startsAt: trip?.starts_at, key, ended, carConnected });
  const line = leoLine({ d, pending, complete, step, key, trip, ended, now });
  const keyBlock = !ended && !!key && key.state !== "off";
  const keyFirst = !!key && ["ready", "making", "problem"].includes(key.state);

  // ---- Leo ----
  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    return true;
  }, []);
  const stage = tripTab(trip, ended, pub.car_connected_at, key?.state) ?? "unknown";
  const mtp = trip ? Math.round((+new Date(trip.starts_at) - now) / 60000) : 9999;
  const sess = useLeoSession({
    token,
    greeting: `Hi${first ? ` ${first}` : ""}, I'm Leo. ${line}`,
    variables: () => ({
      pickup_place: "delivery", delivery_name: d.name, delivery_kind: d.kind, delivery_missing: pending.join(","), return_place: d.short,
      trip_stage: stage, guest_first_name: first, minutes_to_pickup: mtp, controls_state: pub.controls_state ?? "unknown",
      greeting_offer: pending.length ? "delivery_info" : "none",
    }),
    clientTools: (api) => ({
      show_card: async (p: Any) => showCard(String(p?.card ?? ""), api),
      page_action: async (p: Any) => pageAction(p),
    }),
    onConnect: (c) => {
      const known = fields.filter((f) => info[f.key]).map((f) => `${f.question}: ${info[f.key]}`);
      if (known.length) try { c.sendContextualUpdate(`Delivery info already on file for Jared: ${known.join("; ")}.`); } catch { /* ignore */ }
    },
    onToolResponse: (res, tool, api) => {
      if (tool === "delivery_info") {
        // Leo saved (or read) what Jared needs: show it now, then re-read the page so the server's copy wins.
        const src = ((res?.info ?? res?.saved ?? res) ?? {}) as Any;
        const next: DeliveryInfo = {};
        (["room", "front_desk", "parking", "eta"] as const).forEach((k) => { if (typeof src[k] === "string" && src[k]) next[k] = src[k] as string; });
        if (Object.keys(next).length) setInfo((i) => ({ ...i, ...next, via: "leo", reported_at: new Date().toISOString() }));
        reload?.(); window.setTimeout(() => reload?.(), 3000);
        return;
      }
      if (!res) return;
      const card = res.card as Any | undefined;
      if (card) api.push({ kind: "card", card: card as never });
      const ct = String((card?.type ?? "") as string);
      if (["climate", "lock", "unlock", "car"].includes(ct) || tool.startsWith("car_")) emitLeoCar(res);
    },
  });

  const showCard = async (card: string, api: LeoApi): Promise<string> => {
    switch (card) {
      case "controls": return scrollTo("car") ? "Showing the car card with the A/C buttons on the page." : "The car controls aren't on the page right now. Once the phone key is connected they use the Tesla app.";
      case "key": return scrollTo("key") ? "Showing their key on the page." : "There's no key on the page right now.";
      case "charging": {
        const r = await tv({ op: "act", token, tool: "charging_summary", args: {} });
        if (r?.card) api.push({ kind: "card", card: r.card as never });
        return String(r?.say ?? "Showing the Supercharging total on screen.");
      }
      case "return": case "guide": return scrollTo(card === "return" ? "return" : "delivery") ? "Showing it on the page." : "That isn't on the page right now.";
      case "qr": return "There's no QR code on a delivery. Jared brings the car to them.";
      case "backup_unlock": return "That isn't on this page. If the phone key won't work, offer to fix the key.";
    }
    return "That card isn't available.";
  };
  const pageAction = async (p: Any): Promise<string> => {
    const action = String(p?.action ?? "").trim(), value = p?.value == null ? undefined : String(p.value).trim();
    if (!action) return "Which action? I need one, like show_car_controls.";
    const done = (id: string, ok: string, no: string) => (scrollTo(id) ? ok : no);
    switch (action) {
      case "show_car_controls": return done("car", "Showing the car card with the A/C buttons on the page.", "The car controls aren't on the page right now. Once the phone key is connected they use the Tesla app.");
      case "open_return": return done("return", "Showing the return steps on the page.", "The return steps aren't on the page right now.");
      case "open_pickup": return done(keyBlock ? "key" : "delivery", "Showing the delivery and key steps on the page.", "That isn't on the page right now.");
      case "show_qr": return "There's no QR code on a delivery. Jared brings the car to them.";
      case "show_charging": return "There's no Supercharging card on this page. I can show the charging total here on screen instead.";
      case "show_help": return done("how", "Showing how delivery works on the page.", "That isn't on the page right now.");
      case "next_step": return line;
      case "demo_stage": case "demo_weather": return (await askPage(action, value, 3000)).say;
    }
    return "I can't do that on this page.";
  };

  // Ask Leo something: sends it (starts a typing session if none is running) and brings his answer into view.
  const [typing, setTyping] = useState(false);
  const askLeo = useCallback((q: string) => { void sess.send(q); window.setTimeout(() => scrollTo("leo"), 60); }, [sess, scrollTo]);
  const askRef = useRef(askLeo); askRef.current = askLeo;
  // "Fix it for me" on the key card asks the trip helper (a window event); here that is Leo.
  useEffect(() => {
    const f = (e: Event) => { const q = (e as CustomEvent<string>).detail; if (q) askRef.current(q); try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* ignore */ } };
    window.addEventListener("trip-ask", f);
    return () => window.removeEventListener("trip-ask", f);
  }, []);
  const tellLeoTyped = useCallback((v: DeliveryInfo) => {
    setInfo((i) => ({ ...i, ...v }));
    try { sess.conv.current?.sendContextualUpdate(`The guest typed this on the page and it was sent to Jared: ${fields.filter((f) => v[f.key]).map((f) => `${f.question}: ${v[f.key]}`).join("; ")}.`); } catch { /* not connected */ }
    window.setTimeout(() => reload?.(), 900);
  }, [sess.conv, fields, reload]);

  // ---- the car (before the phone key connects; after that guests use the Tesla app) ----
  const [outsideF, setOutsideF] = useState<number | null>(null);
  const demoCar = !!demoPage;
  const car = pub.car ?? (demoCar ? DEMO_CAR : null);
  const live = !!pub.controls;
  const lockedUntil = demoPage ? null : pub.controls ? null : pub.controls_state === "soon" && pub.controls_opens_at ? pub.controls_opens_at : "pending";
  const showWx = !car || !!(car.climate_until && +new Date(car.climate_until) > now) || climateNeed(car.inside_f, demoPage ? car.outside_f : outsideF ?? car.outside_f) !== "comfy";
  const lat = d.lat ?? 34.0838, lon = d.lon ?? -118.3708;
  const city = useMemo(() => cityOf(d.address, d.short), [d.address, d.short]);

  // ---- mini Leo: is the big orb on screen, and which section is the guest reading? ----
  const [heroVisible, setHeroVisible] = useState(true);
  useEffect(() => {
    const el = document.getElementById("leo-stage");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [section, setSection] = useState<NudgeSection | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = (["delivery", "how", "key", "car", "charging", "return"] as NudgeSection[]).map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    // The "reading band" is the upper-middle of the screen. The section covering most of it is the one in view.
    const pick = () => {
      const H = window.innerHeight, top = H * 0.2, bot = H * 0.55;
      let best: NudgeSection | null = null, bestOv = 24;
      for (const el of els) { const r = el.getBoundingClientRect(), ov = Math.min(r.bottom, bot) - Math.max(r.top, top); if (ov > bestOv) { bestOv = ov; best = el.id as NudgeSection; } }
      setSection(best);
    };
    const io = new IntersectionObserver(pick, { rootMargin: "-20% 0px -45% 0px", threshold: [0, 0.1, 0.3, 0.6, 1] });
    els.forEach((e) => io.observe(e));
    pick();
    return () => io.disconnect();
  }, [ended, keyBlock, carConnected, !!trip]); // eslint-disable-line react-hooks/exhaustive-deps
  const nudgeKey: NudgeKey | null = key ? (key.state === "soon" && key.hold ? "held" : key.state as NudgeKey) : null;
  const nudges = leoNudgeItems({
    now, startsAt: trip?.starts_at, endsAt: trip?.ends_at, ended, kind: d.kind, missing: pending, key: nudgeKey,
    cabinF: car?.inside_f ?? null, outsideF: (demoPage ? car?.outside_f : outsideF ?? car?.outside_f) ?? null, batteryPct: car?.battery ?? null, rangeMi: car?.range ?? null,
    controlsOn: live || demoCar, section,
  });

  return (
    <div className="trip trip-light dl-page min-h-dvh" style={{ background: "radial-gradient(120% 70% at 50% 0%, #FFF8EC 0%, #F6EEDD 55%, #E9DCC2 100%)", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <Helmet>
        <title>Your Turo Tesla, delivered</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#F6EEDD" />
        <link rel="apple-touch-icon" href="/wallet/delivery/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@600;700&display=swap" />
        <style>{`.trip :is(a,button):not(:disabled):active{filter:brightness(1.04)}
.trip :is(a,button){touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.trip details>summary::-webkit-details-marker{display:none}`}</style>
      </Helmet>

      <main className="mx-auto max-w-md px-4 pb-16" style={{ paddingTop: "calc(env(safe-area-inset-top) + 26px)" }}>
        {/* Host-only strip (shows only on the host's device). It keeps its own dark surface. */}
        <div className="trip-keep mb-5 rounded-3xl bg-[#13282A] empty:hidden"><HostPanel token={token} /></div>

        <p className="text-center text-[12px] font-semibold uppercase leading-relaxed tracking-[0.24em]" style={{ color: LABEL }}>
          <span className="whitespace-nowrap">Your Turo Tesla</span> <span aria-hidden>·</span> <span className="whitespace-nowrap">Delivered to you</span>
        </p>

        <LeoHero sess={sess} line={line} typing={typing} setTyping={setTyping} />
        {pub.trip && !ended && <p className="sr-only">Trip {fmtWhen(pub.trip.starts_at)} to {fmtWhen(pub.trip.ends_at)}. Pickup {t12(pub.trip.starts_at)}.</p>}

        {ended && trip ? <>
          <TripDone trip={trip} charging={pub.charging} token={token} titleFont="'Josefin Sans', Futura, 'Avenir Next', sans-serif" />
        </> : <>
          {keyFirst && key && <KeyBlock k={key} token={token} d={d} hasApp={hasApp} onHasApp={markHasApp} onAdded={() => reload?.()} />}
          <AskChips where={d.short} onAsk={askLeo} />
          <DeliveryCard d={d} info={info} token={token} demo={isDemo} onSaved={tellLeoTyped} askLeo={() => { scrollTo("leo"); if (sess.phase !== "live") void sess.start(true); }} />
          <HowItWorks step={step} d={d} startsAt={trip?.starts_at} />
          {trip && <div id="charging" className="mt-5 scroll-mt-4"><TripCard trip={trip} theme="delivery" where={d.short} recap={pub.charging ? { charging: pub.charging.total, stops: pub.charging.count } : undefined} /><TripChanged at={pub.trip_changed_at} /></div>}
          {!keyFirst && keyBlock && key && <KeyBlock k={key} token={token} d={d} hasApp={hasApp} onHasApp={markHasApp} onAdded={() => reload?.()} />}

          {!carConnected && (
            <Panel id="car" kicker="Your car" title="Get it comfy first">
              {(trip || car) && <div className="mb-3"><ClimateAdvice car={car} outsideF={demoPage ? null : outsideF} /></div>}
              <div className={`grid items-stretch gap-2.5 ${showWx ? "grid-cols-2" : "grid-cols-1"}`}>
                {showWx && <div className="trip-keep min-w-0 rounded-3xl"><WeatherCard trip={trip ?? null} compact onNow={setOutsideF} lat={lat} lon={lon} place={city} /></div>}
                <CarCard trip={trip ?? null} car={car} demo={demoCar} compact outsideF={demoPage ? null : outsideF}
                  onClimate={live || demoPage ? (a, s) => run!(a, s) : undefined} lockedUntil={lockedUntil} />
              </div>
            </Panel>
          )}

          <ReturnBlock d={d} trip={trip} pickup={pub.pickup_battery} battery={car?.battery} run={live && run ? run : undefined} />
        </>}

        <Footer />
        {!ended && <div className="trip-keep"><InstallToast token={token} kind="delivery" /></div>}
      </main>
      <LeoDock sess={sess} token={token} heroVisible={heroVisible} nudges={nudges} section={section} />
    </div>
  );
}
