/**
 * /lax/:slug — what a Turo guest sees. One permanent link that always shows this month's
 * Park My Share (LAX) parking QR, with Add to Apple Wallet (signed by the wallet-pass edge function)
 * and, on Android, a saved image + how to add it to Google Wallet.
 * Data: lax_pass_public(slug) — returns nothing unless the slug matches. Admin side: pages/admin/LaxPass.tsx.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { Download, Loader2, Sun } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Pub = { ok: boolean; ready?: boolean; payload?: string; note?: string | null; valid_month?: string; valid_through?: string; current?: boolean };

const FN = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/wallet-pass";
const rpc = supabase.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

function platform(): "apple" | "android" | "other" {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "apple";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return "apple";
  return "other";
}

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

export default function LaxGuest() {
  const { slug = "" } = useParams();
  const [pub, setPub] = useState<Pub | null>(null);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const plat = useMemo(platform, []);

  useEffect(() => {
    rpc("lax_pass_public", { p_slug: slug }).then(({ data }) => setPub((data as Pub) ?? { ok: false }));
  }, [slug]);

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

  return (
    <div className="min-h-screen bg-[#1A1140] text-white" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <Helmet>
        <title>Your LAX parking pass</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#2B1A73" />
        <link rel="apple-touch-icon" href="/wallet/lax/apple-touch-icon.png" />
      </Helmet>

      <div className="relative">
        <img src="/wallet/lax/hero.svg" alt="" className="block h-40 w-full object-cover object-[65%_center] sm:h-56" />
        <div className="absolute inset-x-0 top-0 px-5 pt-6 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#FFB878]">Welcome to LA</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Your LAX parking pass</h1>
        </div>
      </div>

      <main className="mx-auto max-w-md px-5 pb-16 pt-6">
        {!pub ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-white/60" /></div>
        ) : !pub.ok || !pub.ready ? (
          <div className="rounded-3xl bg-white/[0.06] p-6 text-center ring-1 ring-white/10">
            <p className="text-lg font-semibold">This link isn't working right now.</p>
            <p className="mt-2 text-white/70">Message your host in the Turo app and they'll send you the parking code.</p>
          </div>
        ) : (
          <>
            <p className="text-[17px] leading-relaxed text-white/85">
              Show this QR code at the <b className="text-white">Park My Share</b> lot at LAX to get in and out.
            </p>

            <div className="mt-5 rounded-3xl bg-white p-6 text-center text-[#1A1140] shadow-2xl shadow-black/40">
              <QRCodeSVG value={pub.payload!} size={240} level="M" className="mx-auto h-auto w-full max-w-[240px]" />
              <p className="mt-4 text-sm font-medium text-[#1A1140]/70">Good through {thru}</p>
            </div>
            <div ref={canvasWrap} className="hidden"><QRCodeCanvas value={pub.payload!} size={1024} level="M" marginSize={4} /></div>

            <div className="mt-6 space-y-3">
              {plat !== "android" && <AppleWalletButton href={passUrl} />}
              {plat !== "apple" && (
                <button type="button" onClick={saveImage}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-base font-semibold ring-1 ring-white/15 active:scale-[0.99]">
                  <Download className="h-5 w-5" /> Save the QR code to your phone
                </button>
              )}
            </div>

            <ol className="mt-7 space-y-3 text-[15px] text-white/80">
              {plat === "android" ? (
                <>
                  <li><b className="text-white">1.</b> Tap <b className="text-white">Save the QR code</b> above, or take a screenshot of this page.</li>
                  <li><b className="text-white">2.</b> To keep it in Google Wallet: open Google Wallet, tap <b className="text-white">Add to Wallet</b>, then <b className="text-white">Everything else</b> and <b className="text-white">Photo</b>, and pick the saved code.</li>
                  <li><b className="text-white">3.</b> At the lot, open it and hold your screen up to the scanner.</li>
                </>
              ) : (
                <>
                  <li><b className="text-white">1.</b> Tap <b className="text-white">Add to Apple Wallet</b>, then <b className="text-white">Add</b>.</li>
                  <li><b className="text-white">2.</b> At the lot, open Wallet (double-click the side button) and hold your screen up to the scanner.</li>
                  <li><b className="text-white">3.</b> No Wallet? A screenshot of this page works too.</li>
                </>
              )}
            </ol>

            <p className="mt-5 flex items-center gap-2 text-sm text-white/60"><Sun className="h-4 w-4 text-[#FFB878]" /> Turn your screen brightness up so it scans on the first try.</p>

            {pub.note && (
              <div className="mt-6 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FFB878]">From your host</p>
                <p className="mt-1 text-white/90">{pub.note}</p>
              </div>
            )}

            <p className="mt-10 text-center text-sm text-white/50">Questions? Message your host in the Turo app.</p>
          </>
        )}
        <p className="mt-6 text-center text-xs text-white/30">Pass by Bestly · Los Angeles</p>
      </main>
    </div>
  );
}
