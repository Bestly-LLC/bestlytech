/**
 * /lax/:slug — "Getting your Tesla at LAX". One permanent link a Turo guest keeps on the curb:
 * this month's Park My Share QR (Add to Apple Wallet / save image), quick facts, and Jared's
 * step-by-step pickup guide (plane → shuttle → garage).
 * Data: lax_pass_public(slug) → code + guide (garage, level, spot, shuttle, after_hours, car), all edited
 * at /admin/turo/lax-pass. Returns nothing unless the slug matches.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { Check, Download, Loader2, MapPin, Phone, Sun } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CarCard, DEMO_CAR, EmailCard, TripCard, WeatherCard, type CarState, type Trip } from "./lax/GuestExtras";
import { renderPassImage } from "./lax/passImage";

type Guide = { garage?: string; level?: string; spot?: string; shuttle?: string; after_hours?: string; car?: string; shuttle_stop?: string };
type Pub = { ok: boolean; ready?: boolean; google?: boolean; trip?: Trip; car?: CarState | null; email?: string | null; reminder_at?: string | null; reminder_sent_at?: string | null; code_for_trip_month?: boolean; payload?: string; note?: string | null; valid_through?: string; guide?: Guide };

const FN = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/wallet-pass";
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const PEACH = "#FFB878";

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
  return (
    <a href={href} className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-black text-white shadow-lg shadow-black/30 ring-1 ring-white/15 active:scale-[0.99]">
      <svg viewBox="0 0 32 24" className="h-6 w-8" aria-hidden>
        <rect x="1" y="1" width="30" height="22" rx="4" fill="#fff" />
        <rect x="1" y="4" width="30" height="5" fill="#2E9BF0" /><rect x="1" y="8" width="30" height="5" fill="#F5B83D" />
        <rect x="1" y="12" width="30" height="5" fill="#F0605D" /><path d="M1 15h9a6 6 0 0 0 12 0h9v4a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4z" fill="#1c1c1e" />
      </svg>
      <span className="text-left leading-tight"><span className="block text-[11px] text-white/80">Add to</span><span className="block text-lg font-semibold">Apple Wallet</span></span>
    </a>
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
      <div>{children}</div>
    </div>
  );
}

function Ok({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex gap-3 rounded-xl bg-emerald-400/10 p-3 text-[14px] leading-snug text-white/90 ring-1 ring-emerald-300/40">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-[#1A1140]"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
      <div>{children}</div>
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

function Step({ n, when, title, children }: { n: number; when: string; title: string; children: ReactNode }) {
  return (
    <li className="relative pl-12">
      <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[#2B1A73] text-sm font-bold text-white ring-2" style={{ boxShadow: `0 0 0 2px ${PEACH}` }}>{n}</span>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">{when}</p>
      <h3 className="mt-0.5 text-lg font-semibold text-white">{title}</h3>
      <div className="mt-1 text-[15px] leading-relaxed text-white/80">{children}</div>
    </li>
  );
}

export default function LaxGuest() {
  const { slug = "", token = "" } = useParams();
  const [pub, setPub] = useState<Pub | null>(null);
  const [tab, setTab] = useState<"pickup" | "return">(() => (typeof window !== "undefined" && window.location.hash === "#return" ? "return" : "pickup"));
  const pick = (t: "pickup" | "return") => { setTab(t); try { history.replaceState(null, "", t === "return" ? "#return" : window.location.pathname); } catch { /* ignore */ } };
  const canvasWrap = useRef<HTMLDivElement>(null);
  const plat = useMemo(platform, []);
  // ?demo=car shows the car card with sample data and the climate buttons (preview only, nothing is sent to the car).
  const demoCar = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "car", []);

  useEffect(() => {
    const load = () => (token
      ? rpc("lax_guest_public", { p_token: token })
      : rpc("lax_pass_public", { p_slug: slug })).then(({ data }) => setPub((data as Pub) ?? { ok: false }));
    load();
    // Keep the live car card fresh while the page is open.
    const id = token ? window.setInterval(load, 5 * 60 * 1000) : 0;
    return () => window.clearInterval(id);
  }, [slug, token]);

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

  return (
    <div className="min-h-screen bg-[#1A1140] text-white" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <Helmet>
        <title>Picking up your Turo car at LAX</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#2B1A73" />
        <link rel="apple-touch-icon" href="/wallet/lax/apple-touch-icon.png" />
      </Helmet>

      <div className="relative">
        <img src="/wallet/lax/hero.svg" alt="" className="block h-44 w-full object-cover object-[65%_center] sm:h-56" />
        <div className="absolute inset-x-0 top-0 px-5 pt-6 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: PEACH, ...shadow }}>{pub?.trip?.first ? `Hi ${pub.trip.first} · your Turo rental` : "Your Turo rental"}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl" style={shadow}>Picking up your Turo car at LAX</h1>
        </div>
      </div>

      <main className="mx-auto max-w-md px-5 pb-16 pt-5">
        {!pub ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-white/60" /></div>
        ) : !pub.ok ? (
          <div className="rounded-3xl bg-white/[0.06] p-6 text-center ring-1 ring-white/10">
            <p className="text-lg font-semibold">This link isn't working right now.</p>
            <p className="mt-2 text-white/70">Message your host in the Turo app and they'll send you the parking code.</p>
          </div>
        ) : (
          <>
            <p className="text-[17px] leading-relaxed text-white/85">You rented a <b className="text-white">{pub.guide?.car || "Tesla Model 3"}</b> on <b className="text-white">Turo</b>. It's parked in a garage 5 minutes from LAX. Below: how to get there, and the QR code that opens the garage door.</p>

            {pub.trip && <div className="mt-5"><TripCard trip={pub.trip} /></div>}
            {/* Weather next to the car: see how hot it is, then turn on the A/C right there. */}
            {pub.trip ? (
              <div className="mt-2.5 grid grid-cols-2 items-stretch gap-2.5">
                <WeatherCard trip={pub.trip} compact />
                <CarCard trip={pub.trip} car={demoCar ? DEMO_CAR : pub.car ?? null} demo={demoCar} compact />
              </div>
            ) : (
              <div className="mt-2.5"><WeatherCard trip={null} /></div>
            )}

            {/* Quick facts */}
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <Fact label="Garage"><a href={maps} className="inline-flex items-start gap-1 underline decoration-white/30 underline-offset-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: PEACH }} />{garage}</a></Fact>
              <Fact label="Level">{level} only{g.spot ? <span className="block text-white/70">Space {g.spot}</span> : null}</Fact>
              <Fact label="Shuttle">{shuttle}</Fact>
              {phone
                ? <Fact label="After hours"><a href={telHref(phone)} className="inline-flex items-center gap-1 underline decoration-white/30 underline-offset-2"><Phone className="h-4 w-4" style={{ color: PEACH }} />{dotted(phone)}</a></Fact>
                : <Fact label="Your car">{g.car || "Tesla Model 3"}</Fact>}
            </div>

            {/* QR */}
            <section id="qr" className="mt-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>Your QR code · scan it at the lobby door</p>
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
                <div className="mt-3 rounded-2xl bg-white/[0.06] p-4 text-white/80 ring-1 ring-white/10">Your host will text your QR code the day before your trip.</div>
              )}
            </section>

            {token && pub.trip && (
              <div className="mt-6"><EmailCard token={token} email={pub.email ?? null} reminderAt={pub.reminder_at ?? null} sentAt={pub.reminder_sent_at ?? null} /></div>
            )}
            {pub.trip && pub.ready && pub.code_for_trip_month === false && (
              <p className="mt-4 rounded-2xl bg-white/[0.06] p-3 text-[13px] text-white/70 ring-1 ring-white/10">Your trip is next month. The garage issues a new code on the 1st; this page and your Wallet pass switch to it automatically.</p>
            )}

            {pub.note && (
              <div className="mt-6 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
                <p className="text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: PEACH }}>From your host</p>
                <p className="mt-1 text-white/90">{pub.note}</p>
              </div>
            )}

            {/* Pickup / Return */}
            <div className="mt-10 grid grid-cols-2 rounded-2xl bg-white/[0.06] p-1 ring-1 ring-white/10" role="tablist">
              {(["pickup", "return"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => pick(t)}
                  className={"h-11 rounded-xl text-[15px] font-semibold transition-colors " + (tab === t ? "bg-white text-[#1A1140]" : "text-white/70")}>
                  {t === "pickup" ? "Pickup" : "Return"}
                </button>
              ))}
            </div>

            {tab === "pickup" ? (
            <section className="mt-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">Arriving at LAX</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight">Pickup. Plane → shuttle → garage.</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-white/75">About 20 minutes from wheels-down to driving away. Follow the steps in order.</p>

              <ol className="mt-6 space-y-7">
                <Step n={1} when="After landing" title="Head to Level 2, then to the curb.">
                  From your terminal, go up to Level 2 (Departures) and step outside.
                  <span className="mt-1 block text-white/60">Yes, departures: that's where the off-airport shuttles board.</span>
                </Step>
                <Step n={2} when="On the curb" title="Find the red sign.">
                  Look for the red <b className="text-white">Hotel &amp; Private Parking Shuttles</b> sign on the terminal curb. That's your waiting spot.
                </Step>
                <Step n={3} when="Every 15–20 min" title={`Board The Parking Spot · ${shuttleShort}`}>
                  Yellow shuttle with black spots. Tell the driver you're a Park My Share / Turo guest headed to {garage.split(",")[0]}.
                  <Warn><b className="text-white">Not the Sepulveda shuttle.</b> Same company, different lot. It won't drop you at our garage.</Warn>
                </Step>
                <Step n={4} when="~5 min ride" title="Walk across the alley.">
                  At drop-off, follow the Park My Share signs across the alley to the garage entrance.
                  <Chips items={["Shuttle drop", "Alley", "Garage door"]} />
                </Step>
                <Step n={5} when="At the door" title="Scan your QR code at the lobby door.">
                  {pub.ready ? <>Your QR code is <a href="#qr" className="underline decoration-white/40 underline-offset-2">at the top of this page</a>. </> : null}
                  Scan at the lobby door, take the elevator to {level}.
                  {g.spot ? <> Your space is <b className="text-white">{level} · {g.spot}</b>.</> : <> I'll text your exact {level} space the day before your trip.</>}
                  <Warn><b className="text-white">{level} only.</b> Please don't park on other levels. If the QR doesn't scan, there's an intercom right next to the door; someone will buzz you in.</Warn>
                </Step>
              </ol>

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

              <p className="mt-6 flex items-center gap-2 text-sm text-white/60"><Sun className="h-4 w-4" style={{ color: PEACH }} /> Screen brightness up helps the QR scan on the first try.</p>
            </section>
            ) : (
            <section className="mt-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">LAX drop-off</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight">Return. Drop the car → catch the shuttle.</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-white/75">
                Reverse of the morning. The two things to watch: <b className="text-white">which entrance you use</b>, and <b className="text-white">which address you drive to</b>. Get those right and you're done.
              </p>

              <ol className="mt-6 space-y-7">
                <Step n={1} when="Drive in" title="Use the carshare return lane on 98th St.">
                  Drive to <a href={maps} className="underline decoration-white/40 underline-offset-2">{garage.split(",")[0]}</a> and take the car share return lane on 98th St.
                  <span className="mt-1 block text-white/60"><b className="text-white/80">After 10 PM:</b> use the alley return lane between Century Blvd and 98th St instead.</span>
                </Step>
                <Step n={2} when="Inside" title={`Park on ${level}. Designated carshare area only.`}>
                  Same level you picked up from. The carshare zone is marked.
                  <Warn><b className="text-white">Do not return to The Parking Spot Century at {stop.replace(/ Blvd$/, "")}.</b> Your car won't have access there and you may be charged an improper-return fee.</Warn>
                </Step>
                <Step n={3} when="Walk out" title="Elevator down, exit on 98th St.">
                  From {level}, take the elevator down, exit onto 98th St, and follow the Park My Share signs.
                  <Chips items={[level, "Elevator", "98th St exit", "Shuttle stop"]} />
                </Step>
                <Step n={4} when="Shuttle pickup" title={`Catch the shuttle at ${stop}.`}>
                  Signs point you right to it. Board <b className="text-white">The Parking Spot · {shuttleShort}</b> back to LAX.
                  <Ok>Allow <b className="text-white">at least 1 hour</b> before your terminal arrival for return + shuttle + TSA buffer.</Ok>
                </Step>
              </ol>

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
            </section>
            )}

            <p className="mt-10 text-center text-sm text-white/50">Questions? Message your host in the Turo app.</p>
          </>
        )}
      </main>
    </div>
  );
}
