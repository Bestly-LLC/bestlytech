/**
 * /lax/:slug — "Getting your Tesla at LAX". One permanent link a Turo guest keeps on the curb:
 * this month's Park My Share QR (Add to Apple Wallet / save image), quick facts, and Jared's
 * step-by-step pickup guide (plane → shuttle → garage).
 * Data: lax_pass_public(slug) → code + guide (garage, level, spot, shuttle, after_hours, car), all edited
 * at /admin/turo/lax-pass. Returns nothing unless the slug matches.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { ArrowRight, BellRing, Check, Download, Flashlight, Loader2, Mail, MapPin, Phone, PlayCircle, Sun, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TagBar, TripSheet, tripTab } from "./lax/TripSheet";
import { AskButton, AskSheet } from "./lax/AskSheet";
import { Collapse } from "./lax/Collapse";
import { CarCard, ClimateAdvice, DEMO_CAR, EmailCard, TripCard, TripChanged, WeatherCard, climateNeed, type CarState, type Trip } from "./lax/GuestExtras";
import { WalletLoader } from "./lax/WalletLoader";
import { ScrollFx } from "./lax/ScrollFx";
import { track } from "./lax/track";
import HomeGuest, { CarButton, type CarAction, type HomeInfo, type KeyInfo } from "./lax/HomeGuest";
import { HomeGuide, VideoList, VideoPlayer } from "./lax/HomeGuide";
import { ChargerLine, SendToCar, useKeyWatch } from "./lax/KeyNext";
import { KeySteps, NextStep, ProfileTip, guideFor, useHasApp } from "./lax/Guide";
import { Carousel, TripSlides } from "./lax/Carousel";
import { ReturnChecklist } from "./lax/ReturnChecklist";
import { FindCarButton } from "./lax/FindCar";
import { Lines } from "./lax/Lines";
import { InstallToast } from "./lax/InstallToast";
import { Fold } from "./lax/HomeGuide";
import ExtraDrivers from "./lax/ExtraDrivers";
import { OpenTuro, TripDone, tripEnded } from "./lax/TripDone";
import { BatteryReturn, ChargingCard, ChargingFab, type BatteryHealth, type Charging } from "./lax/Charging";
import { ChargeNow, OpenStalls, RangeCheck, sendNearestSupercharger, type RangeCheckData } from "./lax/LiveCharge";
import { ReturnChargeBlock, returnCharge, returnChargeLive } from "./lax/ReturnCharge";
import { BestlyAd } from "./lax/BestlyAd";
import { PhoneHandoff } from "./lax/PhoneHandoff";
import { UnlockStart } from "./lax/Valet";
import { renderPassImage } from "./lax/passImage";
import { DemoBar, demoKind, demoPub, isDemo, useDemoStage, useDemoWeather, useRealDemoKey } from "./lax/demo";

type Guide = { garage?: string; level?: string; spot?: string; shuttle?: string; after_hours?: string; car?: string; shuttle_stop?: string };
type Pub = { ok: boolean; kind?: "lax" | "home"; home?: HomeInfo | null; spot?: { lat: number; lon: number; observed_at: string } | null; key?: KeyInfo | null; controls?: boolean; controls_state?: string; controls_opens_at?: string | null; ready?: boolean; google?: boolean; trip?: Trip; car?: CarState | null; email?: string | null; pickup_battery?: number | null; pickup_battery_at?: string | null; range_check?: RangeCheckData; battery_health?: BatteryHealth; car_connected_at?: string | null; trip_changed_at?: string | null; charging?: Charging | null; reminder_at?: string | null; reminder_sent_at?: string | null; code_for_trip_month?: boolean; payload?: string; note?: string | null; valid_through?: string; guide?: Guide };

const FN = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/wallet-pass";
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const PEACH = "#FFB878";
// Shared components (key card, next steps, car guide) read the theme from these variables; the home page sets its own.
const LAXVARS = { "--trip-accent": PEACH, "--trip-accent-2": "#E4527A", "--trip-title-font": "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" } as CSSProperties;

function platform(): "apple" | "android" | "other" {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "apple";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return "apple";
  return "other";
}
const dotted = (phone: string) => phone.replace(/[^\d]/g, "").replace(/^1?(\d{3})(\d{3})(\d{4})$/, "$1 · $2 · $3");
const telHref = (phone: string) => `tel:+1${phone.replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "")}`;

function AppleWalletButton({ href }: { href: string }) {
  const [loading, setLoading] = useState(false);
  const cancelled = useRef(false);
  const open = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (loading) return;
    cancelled.current = false;
    setLoading(true);
    const t0 = Date.now();
    try {
      // Build the pass first (the slow part), so tapping never looks broken. Then hand it to Wallet.
      await fetch(href, { cache: "no-store" }).catch(() => null);
    } finally {
      const wait = Math.max(0, 900 - (Date.now() - t0)); // let the animation land
      window.setTimeout(() => { if (cancelled.current) return; window.location.href = href; window.setTimeout(() => setLoading(false), 2500); }, wait);
    }
  };
  return (
    <>
    <WalletLoader open={loading} onCancel={() => { cancelled.current = true; setLoading(false); }} />
    <a href={href} onClick={open} aria-busy={loading} className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-black text-white shadow-lg shadow-black/30 ring-1 ring-white/15 active:scale-[0.99]">
      <svg viewBox="0 0 32 24" className="h-6 w-8" aria-hidden>
        <rect x="1" y="1" width="30" height="22" rx="4" fill="#fff" />
        <rect x="1" y="4" width="30" height="5" fill="#2E9BF0" /><rect x="1" y="8" width="30" height="5" fill="#F5B83D" />
        <rect x="1" y="12" width="30" height="5" fill="#F0605D" /><path d="M1 15h9a6 6 0 0 0 12 0h9v4a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4z" fill="#1c1c1e" />
      </svg>
      <span className="text-left leading-tight"><span className="block text-[11px] text-white/80">Add to</span><span className="block text-lg font-semibold">Apple Wallet</span></span>
    </a>
    </>
  );
}

function GoogleWalletButton({ href }: { href: string }) {
  return (
    <a href={href} className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-black text-white shadow-lg shadow-black/30 ring-1 ring-white/15 active:scale-[0.99]">
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5V9H3z" fill="#4285F4" />
        <path d="M3 9h18v2.5H3z" fill="#34A853" /><path d="M3 11.5h18V14H3z" fill="#FBBC04" />
        <path d="M3 14h18v2.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" fill="#EA4335" />
      </svg>
      <span className="text-left leading-tight"><span className="block text-[11px] text-white/80">Add to</span><span className="block text-lg font-semibold">Google Wallet</span></span>
    </a>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-white/10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>{label}</p>
      <div className="mt-1 text-[15px] font-medium leading-snug text-white">{children}</div>
    </div>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex gap-3 rounded-xl bg-[#E4527A]/15 p-3 text-[14px] leading-snug text-white/90 ring-1 ring-[#E4527A]/40">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E4527A] text-xs font-bold text-white">!</span>
      <div><Lines>{children}</Lines></div>
    </div>
  );
}

function Ok({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex gap-3 rounded-xl bg-emerald-400/10 p-3 text-[14px] leading-snug text-white/90 ring-1 ring-emerald-300/40">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-[#1A1140]"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
      <div><Lines>{children}</Lines></div>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-medium text-white/60">
      {items.map((t, i) => (
        <span key={t} className="contents">{i > 0 && <span>→</span>}<span className="rounded-full bg-white/10 px-2.5 py-1">{t}</span></span>
      ))}
    </p>
  );
}

function Step({ n, when, title, children }: { n: number; when: string; title: ReactNode; children: ReactNode }) {
  // One swipeable card per step (Pickup / Return carousels).
  return (
    <div className="flex h-full flex-col rounded-3xl bg-white/[0.07] p-5 ring-1 ring-white/10">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[18px] font-bold text-[#1A1140]" style={{ background: PEACH }}>{n}</span>
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/60">{when}</p>
      </div>
      <h3 className="mt-3 text-[21px] font-bold leading-snug text-white"><Lines>{title}</Lines></h3>
      <div className="mt-2 text-[16px] leading-relaxed text-white/80"><Lines>{children}</Lines></div>
    </div>
  );
}

export default function LaxGuest() {
  const { slug = "", token = "" } = useParams();
  const [pub, setPub] = useState<Pub | null>(null);
  const viewed = useRef(false);
  // /t/demo-home and /t/demo-lax: host previews, faked in the browser (no real guest, key, car or message is touched).
  const demo = isDemo(token);
  const dKind = demoKind(token || "");
  const [stage, setStage] = useDemoStage(dKind, demo);
  const [weather, setWeather] = useDemoWeather();
  // The minute timer below keeps its first closure: read the demo stage from a ref so it never snaps back to an old stage.
  const stageRef = useRef(stage); stageRef.current = stage;
  // Host only: a real Tesla key on the demo (null for everyone else).
  useRealDemoKey(demo, () => setPub(demoPub(dKind, stageRef.current) as Pub));
  // Errors on guests' phones go to the trip-apps health board (max 3 per visit; never from the host).
  useEffect(() => {
    let n = 0;
    // "Script error." = a cross-origin script (YouTube embed, a browser extension) failed; the browser hides the details and it is never ours.
    const send = (msg: string) => { if (/^Script error\.?$/i.test(msg.trim())) return; if (n++ < 3 && token) track(token, "error", { msg: msg.slice(0, 200), path: window.location.pathname }); };
    const onErr = (e: ErrorEvent) => send(e.message || "error");
    const onRej = (e: PromiseRejectionEvent) => send(String((e.reason as Error)?.message ?? e.reason ?? "rejection"));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, [token]);
  // Every outside web link opens in a new tab, so the trip page stays open behind it. Links that hand off to an app
  // (the Tesla key invite, App Store / Play Store, Turo, Wallet passes, Apple Maps) keep their normal tap so the app opens.
  useEffect(() => {
    const APP = /(^|\.)(tesla\.com|apple\.com|google\.com\/maps\/dir|play\.google\.com|turo\.com|pay\.google\.com)$|wallet-pass/i;
    const f = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.dataset.sameTab !== undefined) return;
      let u: URL; try { u = new URL(a.href, window.location.href); } catch { return; }
      if (!/^https?:$/.test(u.protocol) || u.origin === window.location.origin) return;
      if (APP.test(u.hostname) || APP.test(u.pathname)) return;
      a.target = "_blank"; a.rel = "noopener noreferrer";
    };
    document.addEventListener("click", f, true);
    return () => document.removeEventListener("click", f, true);
  }, []);
  // Pickup / Return steps live in a bottom sheet opened from the luggage-tag bar. #pickup / #return deep-link it open.
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
  const canvasWrap = useRef<HTMLDivElement>(null);
  const plat = useMemo(platform, []);
  // ?demo=car shows the car card with sample data and the climate buttons (preview only, nothing is sent to the car).
  const demoParam = useMemo(() => typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("demo") : null, []);
  const demoCar = demoParam === "car" || demoParam === "climate" || demoParam === "cold" || demoParam === "ending";
  const demoState: CarState = useMemo(() => demoParam === "climate"
    ? { ...DEMO_CAR, inside_f: 84, climate_on: true, climate_mode: "cool", climate_until: new Date(Date.now() + 17 * 60000 + 42000).toISOString() }
    : demoParam === "ending" ? { ...DEMO_CAR, inside_f: 76, climate_on: true, climate_mode: "cool", climate_until: new Date(Date.now() + 8000).toISOString() }
    : demoParam === "cold" ? { ...DEMO_CAR, inside_f: 54, outside_f: 49 } : DEMO_CAR, [demoParam]);
  const [outsideF, setOutsideF] = useState<number | null>(null);
  // From the reminder email: ?do=cool|warm#climate scrolls to the climate buttons and highlights them (never auto-sends).
  const [doClimate] = useState<"cool" | "warm" | null>(() => {
    if (typeof window === "undefined") return null;
    const d = new URLSearchParams(window.location.search).get("do");
    return d === "cool" || d === "warm" ? d : null;
  });
  useEffect(() => {
    if (!doClimate || !pub?.ok) return;
    const t = window.setTimeout(() => document.getElementById("climate")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    return () => window.clearTimeout(t);
  }, [doClimate, pub?.ok]);
  // ?demo=soon previews the greyed-out buttons (before they open).
  const demoSoon = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "soon" ? new Date(Date.now() + 3 * 3600 * 1000).toISOString() : null, []);

  useEffect(() => {
    if (demo) { setPub(demoPub(dKind, stage) as Pub); return; } // weather is read inside demoPub
    const load = () => (token
      ? rpc("lax_guest_public", { p_token: token })
      : rpc("lax_pass_public", { p_slug: slug })).then(({ data }) => {
        const p = (data as Pub) ?? { ok: false };
        if (token && p.kind) { try { localStorage.setItem(`tripkind:${token}`, p.kind); } catch { /* private mode */ } }
        if (token && p.ok && !viewed.current) {
          viewed.current = true;
          track(token, "view", { kind: p.kind });
          const d = new URLSearchParams(window.location.search).get("do");
          if (d) track(token, "reminder_click", { do: d });
        }
        setPub(p);
      });
    load();
    // Keep the live car card fresh while the page is open.
    const id = token ? window.setInterval(load, 5 * 60 * 1000) : 0;
    return () => window.clearInterval(id);
  }, [slug, token, demo, dKind, stage]);

  // Car buttons: queue the command, then wait for the Mac mini helper to send it (signed) and report back.
  // Personal link acts for its own trip; the shared Turo link acts for the trip happening now (unlocked by the guest's phone key).
  const reload = () => demo ? Promise.resolve(setPub(demoPub(dKind, stageRef.current) as Pub)) : (token ? rpc("lax_guest_public", { p_token: token }) : rpc("lax_pass_public", { p_slug: slug }))
    .then(({ data }) => data && setPub(data as Pub));
  // Home-screen icon + tab icon match the trip's look (home = midcentury sunset, LAX = the LAX mark).
  useEffect(() => {
    if (!pub?.ok || !pub.kind) return;
    const ico = pub.kind === "home" ? "/wallet/home/apple-touch-icon.png" : "/wallet/lax/apple-touch-icon.png";
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => { l.href = ico; });
  }, [pub?.ok, pub?.kind]);
  useEffect(() => { const f = () => { void reload(); }; window.addEventListener("trip-reload", f); return () => window.removeEventListener("trip-reload", f); });
  // Keep time-based parts fresh (buttons open 1h before pickup, key 2h before, exact spot, etc.) without a manual refresh.
  useEffect(() => {
    const f = () => { if (document.visibilityState === "visible") void reload(); };
    const id = window.setInterval(f, 60000);
    document.addEventListener("visibilitychange", f);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", f); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, slug]);
  const carCommand = async (action: CarAction, onStage?: (s: string) => void) => {
    if (demo) { onStage?.("Demo: nothing is sent to the car"); await new Promise((r) => setTimeout(r, 1200)); return; }
    // Supercharger: the one closest to where the car is now (falls back to the fixed nearby one if Tesla can't list sites).
    if (token && (action === "nav_charger" || action === "nav_charger_lax")) {
      const name = await sendNearestSupercharger(token, onStage);
      if (name) { onStage?.(`${name} is in the car's navigation`); return; }
    }
    if (action !== "refresh") track(token || undefined, ["cool", "warm", "seat", "off"].includes(action) ? "climate" : action, { action });
    // Honk / Flash are geofenced server-side: send where this phone is (only for those two).
    let here: { p_lat?: number; p_lon?: number; p_acc?: number } = {};
    if (token && (action === "honk" || action === "flash") && typeof navigator !== "undefined" && navigator.geolocation) {
      onStage?.("Checking you're near the car");
      here = await new Promise((res) => navigator.geolocation.getCurrentPosition(
        (p) => res({ p_lat: p.coords.latitude, p_lon: p.coords.longitude, p_acc: p.coords.accuracy }),
        () => res({}), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }));
    }
    const { data, error } = token
      ? await rpc("lax_guest_car_command", { p_token: token, p_action: action, ...here })
      : await rpc("lax_shared_car_command", { p_slug: slug, p_action: action });
    const r = data as { ok: boolean; id?: number; error?: string; cached?: boolean } | null;
    if (error || !r?.ok) throw new Error(r?.error ?? error?.message ?? "Couldn't reach the car");
    if (!r.id) return;
    onStage?.("Waiting for the car helper");
    for (let i = 0; i < 45; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const { data: j } = token
        ? await rpc("lax_guest_car_job", { p_token: token, p_id: r.id })
        : await rpc("lax_shared_car_job", { p_slug: slug, p_id: r.id });
      const job = j as { status: string; stage?: string | null; result?: { error?: string } } | null;
      if (job?.stage) onStage?.(job.stage);
      if (job?.status === "done") { reload(); return; }
      if (job?.status === "failed") throw new Error(job.result?.error ?? "The car didn't respond");
    }
    throw new Error("The car is taking a while. Try again in a minute.");
  };
  // Controls open but no fresh reading yet: ask for one (never wakes the car).
  const refreshed = useRef(false);
  useEffect(() => {
    if (!pub?.controls || pub.car || refreshed.current) return;
    refreshed.current = true;
    carCommand("refresh").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub?.controls, pub?.car, token, slug]);

  const key: KeyInfo | null = pub?.key ?? null;
  const ended = tripEnded(pub?.trip);
  const onTrip = !!pub?.trip && !ended && Date.now() >= +new Date(pub.trip.starts_at);
  // What to do now + what glows (same rules as the home page).
  const [hasApp, markHasApp] = useHasApp();
  useKeyWatch(token, pub?.kind === "lax" ? key?.state ?? "off" : "off", key?.opens_at, () => void reload());
  const guide = guideFor({ trip: pub?.trip, keyInfo: pub?.kind === "lax" ? key : null, hasApp, car: demoCar ? demoState : pub?.car ?? null, controlsOn: !!pub?.controls, kind: "lax", qrReady: !!pub?.ready, pickupBattery: pub?.pickup_battery, rc: pub?.range_check });
  const glow = guide.glow;
  const doNext = (a: string) => {
    if (a === "pickup" || a === "return") openSheet(a);
    else if (a === "climate") document.getElementById("climate")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (a === "qr") { window.dispatchEvent(new CustomEvent("open-section", { detail: "qr" })); window.setTimeout(() => document.getElementById("qr")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
  };
  const keySteps = !!token && !!key && key.state !== "off" && key.state !== "ended";
  const n0 = keySteps ? 2 : 0;
  const live = !!pub?.controls || demo;
  // Nice out and no climate to offer: hide the weather pane, car tile goes full width.
  const wxCar = demoCar ? demoState : pub?.car ?? null;
  const showWx = !wxCar || !!(wxCar.climate_until && +new Date(wxCar.climate_until) > Date.now()) || climateNeed(wxCar.inside_f, demo ? wxCar.outside_f : outsideF ?? wxCar.outside_f) !== "comfy";
  // "Set Up" done at the car (the car unlocked/moved by itself after the key was accepted), or 45 min into the trip.
  const carConnected = !!pub?.car_connected_at || (!!pub?.trip && Date.now() > +new Date(pub.trip.starts_at) + 45 * 60e3);
  // Lobby QR (Jared's rule): OPEN from booking until the phone key is set up at the car (they tapped "Set Up" and
  // the Bluetooth key connected, i.e. they're past the lobby). Then it folds, still one tap away. Gone after the trip.
  // The page decides open/closed (not a remembered tap), so it always matches where the guest is.
  const qrPhase: "pickup" | "set" | "done" = ended ? "done" : pub?.car_connected_at ? "set" : "pickup";
  const g = pub?.guide ?? {};
  const garage = g.garage || "5730 W 98th St, LA 90045";
  const level = g.level || "P3";
  const shuttle = g.shuttle || "The Parking Spot — Century";
  const shuttleShort = shuttle.replace(/^The Parking Spot\s*[—-]\s*/i, "").toUpperCase();
  const phone = g.after_hours || "";
  const stop = g.shuttle_stop || "5701 W Century Blvd";
  const maps = plat === "android" ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(garage)}` : `https://maps.apple.com/?q=${encodeURIComponent(garage)}`;
  const thru = pub?.valid_through
    ? new Date(pub.valid_through + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
    : "";
  const passUrl = token ? `${FN}?t=${encodeURIComponent(token)}` : `${FN}?slug=${encodeURIComponent(slug)}`;

  // Saves a picture of the Wallet pass (same look, fields and QR), not a bare QR.
  const [saving, setSaving] = useState(false);
  const saveImage = async () => {
    const c = canvasWrap.current?.querySelector("canvas");
    if (!c || saving) return;
    setSaving(true);
    try {
      const blob = await renderPassImage({
        qr: c, trip: pub?.trip ?? null, level, garage, thru,
        shuttle: shuttle.replace(/^The Parking Spot\s*[—-]\s*/i, "Parking Spot "),
        afterHours: phone || undefined,
      });
      const file = new File([blob], "LAX-parking-pass.png", { type: "image/png" });
      // Phones: the share sheet has "Save Image" (goes straight to Photos). Desktop: plain download.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "LAX parking pass" }).catch(() => {});
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    } finally { setSaving(false); }
  };

  const shadow = { textShadow: "0 2px 12px rgba(26,17,64,0.85), 0 1px 2px rgba(26,17,64,0.9)" };

  // Home pickup: while loading, show the Hollywood-hills loader if we know it's a home trip (matches trip.html's splash).
  const knownKind = (() => { try { return token ? localStorage.getItem(`tripkind:${token}`) : null; } catch { return null; } })();
  if (token && !pub && knownKind !== "lax") return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: "#132726" }} role="status" aria-label="Loading">
      <img src="/wallet/home/loader-mcm.svg" alt="" className="h-[88px] w-[88px] animate-pulse rounded-[20px] motion-reduce:animate-none" />
    </div>
  );
  // Home pickup (733 N Kings Rd): same page system, home look. No QR code, shuttle or garage.
  if (token && pub?.ok && pub.kind === "home") return <>
    <HomeGuest pub={pub} token={token} run={carCommand} demo={demoParam} demoPage={demo} reload={reload} />
    {demo && <DemoBar kind="home" stage={stage} onStage={setStage} weather={weather} onWeather={(w) => { setWeather(w); setPub(demoPub(dKind, stageRef.current) as Pub); }} />}
  </>;

  return (
    <div className="trip min-h-dvh bg-[#1A1140] text-white" style={{ ...LAXVARS, fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <Helmet>
        <title>Picking up your Turo car at LAX</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#2B1A73" />
        <link rel="apple-touch-icon" href="/wallet/lax/apple-touch-icon.png" />
        <style>{`.trip :is(a,button):focus-visible{outline:2px solid ${PEACH};outline-offset:3px;border-radius:14px}
.trip :is(a,button){touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.trip :is(a,button):not(:disabled):active{filter:brightness(1.08)}`}</style>
      </Helmet>

      <div className="relative overflow-hidden">
        <img data-fx-hero src="/wallet/lax/hero-live3.svg" alt="" className="block w-full object-cover object-[65%_center] will-change-transform" style={{ height: "calc(11rem + env(safe-area-inset-top))" }} />
        <div data-fx-title className="absolute inset-x-0 top-0 px-5 sm:px-8" style={{ paddingTop: "calc(env(safe-area-inset-top) + 24px)" }}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: PEACH, ...shadow }}>{pub?.trip?.first ? `Hi ${pub.trip.first} · your Turo rental` : "Your Turo rental"}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl" style={shadow}>Picking up your Turo car at LAX</h1>
        </div>
      </div>

      <main className="mx-auto max-w-md px-5 pb-48 pt-5">
        {!pub ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-white/60" /></div>
        ) : !pub.ok ? (
          <div className="rounded-3xl bg-white/[0.06] p-6 text-center ring-1 ring-white/10">
            <p className="text-lg font-semibold">This link isn't working right now.</p>
            <p className="mt-2 text-white/70">Message your host in the Turo app and they'll send you the parking code.</p>
          </div>
        ) : (
          <>
            {!ended && <p className="text-[17px] leading-relaxed text-white/85">Your Turo Tesla is in a garage 5 minutes from LAX. <b className="text-white">Your phone is the key</b>, and a QR code opens the lobby door.</p>}

            {pub.trip && <div className="mt-5"><TripCard trip={pub.trip} theme="lax" recap={pub.charging ? { charging: pub.charging.total, stops: pub.charging.count } : undefined} /><TripChanged at={pub.trip_changed_at} /></div>}

            {ended && pub.trip ? <TripDone trip={pub.trip} charging={pub.charging} token={token || undefined} /> : <>
            <NextStep next={guide.next} glow={glow.has("next")} onAction={doNext} onHasApp={markHasApp} run={live ? carCommand : undefined} kind="lax"
              extra={guide.next?.chargeCard ? <ReturnChargeBlock compact kind="lax" endsAt={pub.trip?.ends_at} pickup={pub.pickup_battery} battery={(demoCar ? demoState : pub.car)?.battery} rc={pub.range_check} run={live ? carCommand : undefined} observedAt={(demoCar ? demoState : pub.car)?.observed_at} /> : undefined} />

            {/* QR */}
            {qrPhase !== "done" && (
            <Collapse id="qr" remember={false} defaultOpen={qrPhase === "pickup"} kicker="Your QR code · opens the lobby door" title={pub.ready && qrPhase === "pickup" ? "Scan it at the lobby door" : undefined} accent={PEACH} className={guide.next?.action === "qr" ? "trip-glow trip-glow-card" : ""} summary={qrPhase === "set" ? "Your key is set up. Tap if you need the lobby door again." : pub.ready ? "Tap to show your QR code." : "Shows up here before your trip."}>
              {pub.ready ? (
                <>
                  <div className="mt-3 rounded-3xl bg-white p-6 text-center text-[#1A1140] shadow-2xl shadow-black/40">
                    <QRCodeSVG value={pub.payload!} size={240} level="M" className="mx-auto h-auto w-full max-w-[240px]" />
                    <p className="mt-4 text-sm font-medium text-[#1A1140]/70">Good through {thru}</p>
                  </div>
                  <div ref={canvasWrap} className="hidden"><QRCodeCanvas value={pub.payload!} size={1024} level="M" marginSize={4} /></div>
                  <div className="mt-4 space-y-3">
                    {plat !== "android" && <AppleWalletButton href={passUrl} />}
                    {plat !== "apple" && pub.google && <GoogleWalletButton href={token ? `${FN}/google?t=${encodeURIComponent(token)}` : `${FN}/google?slug=${encodeURIComponent(slug)}`} />}
                    {plat !== "apple" && (
                      <button type="button" onClick={saveImage} disabled={saving}
                        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-base font-semibold ring-1 ring-white/15 active:scale-[0.99]">
                        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />} Save the pass to your phone
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-[13px] leading-snug text-white/55">
                    {plat === "android" && pub.google
                      ? "Adding it to Google Wallet keeps it one tap away at the door. Saving the image works too."
                      : plat === "android"
                      ? "To keep it in Google Wallet: open Google Wallet, tap Add to Wallet → Everything else → Photo, and pick the saved code."
                      : "Adding it to Wallet keeps it one double-click away at the door. A screenshot works too."}
                  </p>
                </>
              ) : (
                <div className="mt-3 rounded-2xl bg-white/[0.06] p-4 text-white/80 ring-1 ring-white/10">Your QR code shows up right here before your trip. Nothing to do: this page updates by itself.</div>
              )}
            </Collapse>
            )}

            {/* On the trip these three swipe (Your car · Supercharging · Help & guides); before it they stack. */}
            <TripSlides on={onTrip} id="lax-trip" labels={[...(carConnected ? [] : ["Your car"]), ...(pub.charging ? ["Supercharging"] : []), "Help & guides"]}>
            {/* Once their phone key is connected to the car, they use the Tesla app for the car; this card goes away. */}
            {!carConnected && (
            <section id="climate" aria-label="Your car" className={`mt-6 scroll-mt-4 rounded-3xl p-3 ring-1 transition ${glow.has("climate") || doClimate ? "trip-glow trip-glow-card" : "ring-white/10"}`}
              style={{ background: "linear-gradient(160deg, rgba(255,184,120,0.10), rgba(255,255,255,0.04) 40%, rgba(122,46,158,0.22))" }}>
              <div className="px-1 pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>Your car</p>
                <h2 className="mt-0.5 text-[20px] font-bold leading-tight text-white"><a href={maps} onClick={() => track(token || undefined, "directions", { to: "the LAX garage", from: "car_heading" })} className="underline decoration-white/35 underline-offset-4 hover:decoration-white">{garage.split(",")[0]}</a> · {level}</h2>
              </div>
              {doClimate && <p className="mt-2 px-1 text-[15px] font-semibold" style={{ color: PEACH }}>{doClimate === "warm" ? "Tap Warm it up below to start the heat." : "Tap Cool it down below to start the A/C."}</p>}
              {(pub.trip || pub.car) && (
                <div className="mt-3 px-1"><ClimateAdvice car={demoCar ? demoState : pub.car ?? null} outsideF={demo ? null : outsideF} /></div>
              )}
              {pub.trip || pub.car ? (
                <div className={`mt-3 grid items-stretch gap-2.5 ${showWx ? "grid-cols-2" : "grid-cols-1"}`}>
                  {showWx && <WeatherCard trip={pub.trip ?? null} compact onNow={setOutsideF} />}
                  <CarCard trip={pub.trip ?? null} car={demoCar ? demoState : pub.car ?? null} demo={demoCar || demo} compact outsideF={demo ? null : outsideF}
                    actions={<>
                      {pub.trip && <div className="grid grid-cols-2 gap-1.5">
                        <CarButton small action="honk" label="Honk" icon={BellRing} run={live ? carCommand : undefined} />
                        <CarButton small action="flash" label="Flash" icon={Flashlight} run={live ? carCommand : undefined} />
                      </div>}
                      {pub.trip && !live && <p className="mt-1 text-center text-[11px] leading-snug text-white/60">Honk and Flash work 1 hour before pickup.</p>}
                      <a href={maps} onClick={() => track(token || undefined, "directions")} className="mt-1.5 flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-white text-[14px] font-semibold text-[#1A1140] active:scale-[0.98]"><MapPin className="h-4 w-4" /> Directions</a>
                    </>} onClimate={!demoCar && !demoSoon && (pub.controls || demo) ? carCommand : undefined} lockedUntil={demoSoon ?? (demoCar || pub.controls || demo ? null : pub.controls_state === "soon" && pub.controls_opens_at ? pub.controls_opens_at : "pending")} />
                </div>
              ) : (
                <div className="mt-3"><WeatherCard trip={null} /></div>
              )}
              {!(pub.trip || pub.car) && <a href={maps} onClick={() => track(token || undefined, "directions")} className="mt-2.5 flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-semibold text-[#1A1140] active:scale-[0.98]"><MapPin className="h-4 w-4" /> Directions</a>}
              {/* Same as Home: Find the Car right under the car card. */}
              {pub.trip && <div className="mt-2.5">
                {pub.spot || demo
                  ? <FindCarButton kind="lax" spot={pub.spot ?? null} run={live ? carCommand : undefined} demo={demo} token={token || undefined} where={`on Level ${level}`} />
                  : <span className="flex min-h-[52px] items-center justify-center rounded-2xl bg-white/[0.04] px-2 text-center text-[12px] text-white/65 ring-1 ring-white/10">{Date.now() >= +new Date(pub.trip.starts_at) - 2 * 3600e3 ? "Car location updating… use Honk to find it" : "Find the Car turns on 2 hours before pickup"}</span>}
              </div>}
            </section>
            )}



            {pub.charging && <ChargingCard charging={pub.charging} token={token || undefined} battery={(demoCar ? demoState : pub.car)?.battery} pickupBattery={pub.pickup_battery} health={pub.battery_health} charging_now={["Charging", "Starting"].includes((demoCar ? demoState : pub.car)?.charging ?? "")}>
              <ChargeNow state={(demoCar ? demoState : pub.car)?.charging} battery={(demoCar ? demoState : pub.car)?.battery} detail={(demoCar ? demoState : pub.car)?.charge_detail} target={pub.pickup_battery} />
              {/* Stalls only when they likely need a charge (would return under the pickup level, or running low). */}
              {(returnCharge((demoCar ? demoState : pub.car)?.battery, pub.pickup_battery, pub.range_check).needs || ((demoCar ? demoState : pub.car)?.battery ?? 100) < 30) && <OpenStalls token={token || undefined} live={live} demo={demo} />}
              <RangeCheck rc={pub.range_check} kind="lax" className="mt-3" warnOnly />
            </ChargingCard>}

            <HomeGuide pickupBattery={pub.pickup_battery} kind="lax" valet={token ? (demo ? (key?.state === "added" ? <UnlockStart demo /> : null) : <UnlockStart token={token} />) : null}>
              {token && pub.kind === "lax" && key && (
                <Fold icon={Users} title="Someone else driving?" sub="Add them in Turo first, then get their key here">
                  <ExtraDrivers token={token} embedded />
                </Fold>
              )}
              <Fold icon={PlayCircle} title="How-to videos" sub="2-minute videos from Tesla">
                <VideoList />
              </Fold>
              {token && pub.trip && new Date(pub.trip.starts_at) > new Date() && (
                <Fold icon={Mail} title="Reminder email" sub="Get your QR code and steps by email">
                  <EmailCard token={token} email={pub.email ?? null} reminderAt={pub.reminder_at ?? null} sentAt={pub.reminder_sent_at ?? null} />
                </Fold>
              )}
            </HomeGuide>
            </TripSlides>

            {pub.trip && pub.ready && pub.code_for_trip_month === false && (
              <p className="mt-4 rounded-2xl bg-white/[0.06] p-3 text-[13px] text-white/70 ring-1 ring-white/10">Your trip is next month. The garage issues a new code on the 1st; this page and your Wallet pass switch to it automatically.</p>
            )}

            {pub.note && (
              <Collapse id="host-note" kicker="From your host" accent={PEACH} summary={pub.note.slice(0, 60) + (pub.note.length > 60 ? "…" : "")}>
                <p className="text-white/90">{pub.note}</p>
              </Collapse>
            )}



            </>}

            <TripSheet open={sheet === "pickup"} onClose={() => openSheet(null)} kicker="Your key → plane → garage" title="Pickup at LAX">
              <div className="grid grid-cols-2 gap-2">
                <Fact label="Garage"><a href={maps} className="inline-flex items-start gap-1 underline decoration-white/30 underline-offset-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: PEACH }} />{garage.split(",")[0]}</a></Fact>
                <Fact label="Level">{level} only{g.spot ? <span className="block text-white/70">Space {g.spot}</span> : null}</Fact>
                <Fact label="Shuttle">{shuttle.replace(/^The Parking Spot\s*[—-]\s*/i, "Parking Spot ")}</Fact>
                {phone ? <Fact label="After hours"><a href={telHref(phone)} className="inline-flex items-center gap-1 underline decoration-white/30 underline-offset-2"><Phone className="h-4 w-4" style={{ color: PEACH }} />{dotted(phone)}</a></Fact>
                  : <Fact label="Your car">{g.car || "Tesla Model 3"}</Fact>}
              </div>
              {keySteps && key && token && (
                <>
                  <p className="mt-6 text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>First: your phone is the key</p>
                  <div className="mt-3"><KeySteps k={key} token={token} hasApp={hasApp} onHasApp={markHasApp} onAdded={() => void reload()} glow={glow.has("key")} /></div>
                </>
              )}
              <p className="mt-7 text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>{keySteps ? "Then: plane → shuttle → garage" : "Plane → shuttle → garage"}</p>

              <p className="mt-1 text-[15px] leading-relaxed text-white/75">About 20 minutes from landing to driving away.</p>

              <Carousel id="lax-pickup" className="mt-4" labels={["After landing", "On the curb", "Shuttle", "Walk over", "Lobby door", ...(keySteps ? ["At the car"] : []), "Turo Guest profile"]}>
                <Step n={n0 + 1} when="After landing" title="Head to Level 2, then to the curb.">
                  From your terminal, go up to Level 2 (Departures) and step outside.
                  <span className="mt-1 block text-white/60">Yes, departures: that's where the off-airport shuttles board.</span>
                </Step>
                <Step n={n0 + 2} when="On the curb" title="Find the red sign.">
                  Look for the red <b className="text-white">Hotel &amp; Private Parking Shuttles</b> sign on the terminal curb. That's your waiting spot.
                </Step>
                <Step n={n0 + 3} when="Every 15–20 min" title={`Board The Parking Spot · ${shuttleShort}`}>
                  Yellow shuttle with black spots. Tell the driver you're a Park My Share / Turo guest headed to {garage.split(",")[0]}.
                  <Warn><b className="text-white">Not the Sepulveda shuttle.</b> Same company, different lot. It won't drop you at our garage.</Warn>
                </Step>
                <Step n={n0 + 4} when="~5 min ride" title="Walk across the alley.">
                  At drop-off, follow the Park My Share signs across the alley to the garage entrance.
                  <Chips items={["Shuttle drop", "Alley", "Lobby door"]} />
                </Step>
                <Step n={n0 + 5} when="At the door" title="Scan your QR code at the lobby door.">
                  {pub.ready ? <>Your QR code is <a href="#qr" onClick={() => openSheet(null)} className="underline decoration-white/40 underline-offset-2">on the main page</a>. </> : null}
                  Scan at the lobby door, take the elevator to {level}.
                  {g.spot ? <> Your space is <b className="text-white">{level} · {g.spot}</b>.</> : <> I'll text your exact {level} space the day before your trip.</>}
                  <Warn><b className="text-white">{level} only.</b> Please don't park on other levels. If the QR doesn't scan, there's an intercom right next to the door; someone will buzz you in.</Warn>
                  <FindCarButton className="mt-3" kind="lax" spot={pub.spot ?? null} run={live ? carCommand : undefined} demo={demo} token={token || undefined} where={`on Level ${level}`}
                    opensAt={pub.trip && Date.now() < +new Date(pub.trip.starts_at) - 2 * 3600e3 ? pub.trip.starts_at : null} />
                </Step>
                {keySteps && (
                  <Step n={n0 + 6} when="At the car" title={<>Tap &ldquo;Set Up&rdquo; -<br />then Unlock</>}>
                    Next to the car, with Bluetooth on, open the Tesla app and tap <b className="text-white">&ldquo;Set Up&rdquo;</b>. Follow the steps, then tap <b className="text-white">Unlock</b>. Take your check-in photos in the Turo app.
                    <span className="mt-1 block text-white/60">Not sure which one is yours? Use Find the Car, or tap Honk.</span>
                    <OpenTuro className="mt-3 w-full" label="Open Turo for photos" />
                  </Step>
                )}
                <Step n={n0 + (keySteps ? 7 : 6)} when="Inside the car" title="Pick your driver profile.">
                  <ProfileTip />
                </Step>
              </Carousel>

              {phone && (
                <div className="mt-8 rounded-2xl p-4 ring-1 ring-white/10" style={{ background: "linear-gradient(135deg, rgba(122,46,158,0.35), rgba(228,82,122,0.25))" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>10 PM – 6 AM</p>
                  <p className="mt-1 text-lg font-semibold">Late arrival? Call for the shuttle.</p>
                  <p className="mt-1 text-[15px] leading-relaxed text-white/80">Shuttles run every 15–20 minutes around the clock. Between 10 PM and 6 AM, call to request a pickup:</p>
                  <a href={telHref(phone)} className="mt-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-white text-base font-semibold text-[#1A1140]">
                    <Phone className="h-4 w-4" /> {dotted(phone)}
                  </a>
                </div>
              )}

              {!keySteps && <OpenTuro className="mt-6 w-full" label="Open Turo for check-in photos" />}
              <p className="mt-6 flex items-center gap-2 text-sm text-white/60"><Sun className="h-4 w-4" style={{ color: PEACH }} /> Screen brightness up helps the QR scan on the first try.</p>
            
            </TripSheet>
            <TripSheet open={sheet === "return"} onClose={() => openSheet(null)} kicker="Drop the car → catch your flight" title="Return: car → shuttle → LAX">

              <Carousel id="lax-return" className="mt-1" labels={["Drive in", "Park", "Walk out", "Shuttle"]}>
                <Step n={1} when="Drive in" title="Use the carshare return lane on 98th St.">
                  Drive to <a href={maps} className="underline decoration-white/40 underline-offset-2">{garage.split(",")[0]}</a> and take the car share return lane on 98th St.
                  <span className="mt-1 block text-white/60"><b className="text-white/80">After 10 PM:</b> use the alley return lane between Century Blvd and 98th St instead.</span>
                  <span className="mt-3 block"><SendToCar run={live ? carCommand : undefined} kind="lax" action="nav_garage_lax" label="Send the garage to the car" /></span>
                </Step>
                <Step n={2} when="Inside" title={`Park on ${level}. Designated carshare area only.`}>
                  Same level you picked up from. The carshare zone is marked.
                  <Warn><b className="text-white">Do not return to The Parking Spot Century at {stop.replace(/ Blvd$/, "")}.</b> Your car won't have access there and you may be charged an improper-return fee.</Warn>
                  {token && <ReturnChecklist compact token={token} kind="lax" run={live ? carCommand : undefined} demo={demo} endsAt={pub.trip?.ends_at} />}
                </Step>
                <Step n={3} when="Walk out" title="Elevator down, exit on 98th St.">
                  From {level}, take the elevator down, exit onto 98th St, and follow the Park My Share signs.
                  <Chips items={[level, "Elevator", "98th St exit", "Shuttle stop"]} />
                </Step>
                <Step n={4} when="Shuttle pickup" title={<>Catch the shuttle at<span className="block">{stop}</span></>}>
                  Signs point you right to it. Board this shuttle back to LAX:
                  <b className="block text-white">The Parking Spot · {shuttleShort}</b>
                  <Ok>Allow <b className="text-white">at least 1 hour</b> before your terminal arrival for return + shuttle + TSA buffer.</Ok>
                </Step>
              </Carousel>
              <OpenTuro className="mt-6 w-full" label="Open Turo for return photos" />

              {phone && (
                <div className="mt-8 rounded-2xl p-4 ring-1 ring-white/10" style={{ background: "linear-gradient(135deg, rgba(122,46,158,0.35), rgba(228,82,122,0.25))" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>10 PM – 6 AM</p>
                  <p className="mt-1 text-lg font-semibold">Late departure? Request the shuttle.</p>
                  <p className="mt-1 text-[15px] leading-relaxed text-white/80">Between 10 PM and 6 AM, call to request a shuttle to your terminal:</p>
                  <a href={telHref(phone)} className="mt-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-white text-base font-semibold text-[#1A1140]">
                    <Phone className="h-4 w-4" /> {dotted(phone)}
                  </a>
                </div>
              )}
            
            </TripSheet>
            <TagBar open={sheet === "ask" ? null : sheet} onOpen={openSheet} top={<AskButton onOpen={() => openSheet("ask")} />} hideTags={ended} only={tripTab(pub?.trip, ended, pub?.car_connected_at)}
              glow={glow.has("pickup") ? "pickup" : glow.has("return") ? "return" : null} badge={glow.has("key") ? "Key ready" : undefined} />
            {demo && <DemoBar kind="lax" stage={stage} onStage={setStage} weather={weather} onWeather={(w) => { setWeather(w); setPub(demoPub(dKind, stageRef.current) as Pub); }} />}
            <AskSheet open={sheet === "ask"} onClose={() => openSheet(null)} token={token || undefined} slug={token ? undefined : slug} />
            {pub.charging && !ended && <ChargingFab charging={pub.charging} />}
            {token && !ended && <InstallToast token={token} kind="lax" />}
            {token && !ended && <PhoneHandoff token={token} keyReady={!!key && ["ready", "making"].includes(key.state)} />}
            <VideoPlayer />
            <ScrollFx />


            <BestlyAd campaign="lax-trip-page" blurb="We make websites, apps, and tools for small businesses. Like this page: a phone key that shows up by itself, live car info, A/C buttons, and a lobby door pass right in your phone." />
          </>
        )}
      </main>
    </div>
  );
}
