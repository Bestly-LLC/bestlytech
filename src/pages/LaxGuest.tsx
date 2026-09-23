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
import { Download, Loader2, MapPin, Phone, Sun } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Guide = { garage?: string; level?: string; spot?: string; shuttle?: string; after_hours?: string; car?: string };
type Pub = { ok: boolean; ready?: boolean; payload?: string; note?: string | null; valid_through?: string; guide?: Guide };

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
  const { slug = "" } = useParams();
  const [pub, setPub] = useState<Pub | null>(null);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const plat = useMemo(platform, []);

  useEffect(() => {
    rpc("lax_pass_public", { p_slug: slug }).then(({ data }) => setPub((data as Pub) ?? { ok: false }));
  }, [slug]);

  const g = pub?.guide ?? {};
  const garage = g.garage || "5730 W 98th St, LA 90045";
  const level = g.level || "P3";
  const shuttle = g.shuttle || "The Parking Spot — Century";
  const shuttleShort = shuttle.replace(/^The Parking Spot\s*[—-]\s*/i, "").toUpperCase();
  const phone = g.after_hours || "";
  const maps = plat === "android" ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(garage)}` : `https://maps.apple.com/?q=${encodeURIComponent(garage)}`;
  const thru = pub?.valid_through
    ? new Date(pub.valid_through + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
    : "";
  const passUrl = `${FN}?slug=${encodeURIComponent(slug)}`;

  const saveImage = () => {
    const c = canvasWrap.current?.querySelector("canvas");
    if (!c) return;
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b); a.download = "LAX-parking-QR.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  };

  const shadow = { textShadow: "0 2px 12px rgba(26,17,64,0.85), 0 1px 2px rgba(26,17,64,0.9)" };

  return (
    <div className="min-h-screen bg-[#1A1140] text-white" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <Helmet>
        <title>Getting your Tesla at LAX</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#2B1A73" />
        <link rel="apple-touch-icon" href="/wallet/lax/apple-touch-icon.png" />
      </Helmet>

      <div className="relative">
        <img src="/wallet/lax/hero.svg" alt="" className="block h-44 w-full object-cover object-[65%_center] sm:h-56" />
        <div className="absolute inset-x-0 top-0 px-5 pt-6 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: PEACH, ...shadow }}>Welcome to LA</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl" style={shadow}>Getting your Tesla at LAX</h1>
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
            <p className="text-[16px] leading-relaxed text-white/80">Skim before you fly, keep it handy on the curb. Questions any time.</p>

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
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: PEACH }}>Your QR code · scan it at the garage door</p>
              {pub.ready ? (
                <>
                  <div className="mt-3 rounded-3xl bg-white p-6 text-center text-[#1A1140] shadow-2xl shadow-black/40">
                    <QRCodeSVG value={pub.payload!} size={240} level="M" className="mx-auto h-auto w-full max-w-[240px]" />
                    <p className="mt-4 text-sm font-medium text-[#1A1140]/70">Good through {thru}</p>
                  </div>
                  <div ref={canvasWrap} className="hidden"><QRCodeCanvas value={pub.payload!} size={1024} level="M" marginSize={4} /></div>
                  <div className="mt-4 space-y-3">
                    {plat !== "android" && <AppleWalletButton href={passUrl} />}
                    {plat !== "apple" && (
                      <button type="button" onClick={saveImage}
                        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-base font-semibold ring-1 ring-white/15 active:scale-[0.99]">
                        <Download className="h-5 w-5" /> Save the QR code to your phone
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-[13px] leading-snug text-white/55">
                    {plat === "android"
                      ? "To keep it in Google Wallet: open Google Wallet, tap Add to Wallet → Everything else → Photo, and pick the saved code."
                      : "Adding it to Wallet keeps it one double-click away at the door. A screenshot works too."}
                  </p>
                </>
              ) : (
                <div className="mt-3 rounded-2xl bg-white/[0.06] p-4 text-white/80 ring-1 ring-white/10">Your host will text your QR code the day before your trip.</div>
              )}
            </section>

            {pub.note && (
              <div className="mt-6 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
                <p className="text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: PEACH }}>From your host</p>
                <p className="mt-1 text-white/90">{pub.note}</p>
              </div>
            )}

            {/* Pickup guide */}
            <section className="mt-10">
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
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-medium text-white/60">
                    <span className="rounded-full bg-white/10 px-2.5 py-1">Shuttle drop</span>→<span className="rounded-full bg-white/10 px-2.5 py-1">Alley</span>→<span className="rounded-full bg-white/10 px-2.5 py-1">Garage door</span>
                  </p>
                </Step>
                <Step n={5} when="At the door" title="Scan your QR code.">
                  {pub.ready ? <>Your QR code is <a href="#qr" className="underline decoration-white/40 underline-offset-2">at the top of this page</a>. </> : null}
                  Scan at the door, take the elevator to {level}.
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

            <p className="mt-10 text-center text-sm text-white/50">Questions? Message your host in the Turo app.</p>
          </>
        )}
        <p className="mt-6 text-center text-xs text-white/30">Pass by Bestly · Los Angeles</p>
      </main>
    </div>
  );
}
