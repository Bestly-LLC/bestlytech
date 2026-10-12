/**
 * Link-down page (2026-10-11, Jared): what a guest sees when their trip link stops working.
 * It says only that the link doesn't work right now, plus one short line on why, and Leo runs the page.
 * Two looks, matching the trip pages: Home (WeHo teal + mustard) and LAX (purple + peach).
 *
 * Reasons come from lax_guest_public (unknown / changed / ended); "fixing" = the page couldn't reach us.
 * Leo opens on a limited session here (trip-voice channel page_unknown): he can't see the trip, so he points a
 * rebooked guest to the sign-in page and takes a message for the host. Each guest visit is logged as
 * link_down, which pings Jared signed Leo (lax_track).
 */
import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { ChevronRight, MessageCircle, Phone } from "lucide-react";
import { LeoOrb, THEME, preloadLeo, setLeoMode, type LeoMode } from "./LeoWidget";
import { LeoScreen } from "./LeoScreen";
import type { LinkDownReason } from "./leoOffer";
import { track } from "./track";

const WHY: Record<LinkDownReason, string> = {
  changed: "This trip was changed or canceled.",
  ended: "This trip has ended.",
  unknown: "We can't find a trip for this link.",
  fixing: "Something on our end isn't loading.",
};

const LOOK = {
  home: { bg: "radial-gradient(120% 60% at 50% 0%, #1f4442 0%, #132726 62%)", color: "#132726", label: "Home pickup", signIn: "/turo-key" },
  lax: { bg: "radial-gradient(120% 60% at 50% 0%, #2B1A73 0%, #1A1140 62%)", color: "#1A1140", label: "LAX", signIn: "/turo-lax" },
} as const;

export function LinkDown({ token, kind, reason }: { token: string; kind: "home" | "lax"; reason: LinkDownReason }) {
  const home = kind === "home";
  const t = THEME[kind];
  const look = LOOK[kind];
  const [leo, setLeo] = useState(false);
  const logged = useRef(false);

  useEffect(() => { preloadLeo(); }, []);
  useEffect(() => {
    if (logged.current || reason === "fixing") return;
    logged.current = true;
    track(token, "link_down", { reason, kind });
  }, [token, reason, kind]);

  const open = (m: LeoMode) => { setLeoMode(m); setLeo(true); };

  return (
    <div className="trip relative min-h-dvh overflow-hidden text-white" style={{ background: look.bg, fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <Helmet>
        <title>This link doesn't work right now</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content={look.color} />
        <style>{`.trip :is(a,button):focus-visible{outline:2px solid ${t.accent};outline-offset:3px;border-radius:18px}
.trip :is(a,button){touch-action:manipulation;-webkit-tap-highlight-color:transparent}`}</style>
      </Helmet>

      {/* Feathered glow behind Leo: soft edges only, no motion at rest. */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: `radial-gradient(closest-side, ${t.orb[0]}2E, ${t.orb[0]}0F 55%, ${t.orb[0]}00 100%)` }} />

      <main className="relative mx-auto flex min-h-dvh max-w-md flex-col px-6"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 48px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 28px)" }}>
        <p className="text-[13px] font-semibold uppercase tracking-[0.16em]" style={{ color: t.subtle }}>Your Turo trip · {look.label}</p>
        <h1 className="mt-4 text-[34px] font-bold leading-[1.1] tracking-[-0.02em]">This link doesn't work right now.</h1>
        <p className="mt-3 text-[17px] leading-relaxed" style={{ color: t.subtle }}>{WHY[reason]}</p>

        <section aria-label="Leo, your trip helper" className="mt-10 rounded-[28px] p-6 ring-1 ring-white/10" style={{ background: `${t.raised}E6` }}>
          <div className="flex items-center gap-4">
            <LeoOrb theme={t} size={64} />
            <div className="min-w-0">
              <h2 className="text-[22px] font-bold tracking-[-0.01em]">Leo</h2>
              <p className="text-[15px]" style={{ color: t.subtle }}>24/7 trip helper - real help</p>
            </div>
          </div>
          <p className="mt-5 text-[16px] leading-relaxed text-white/90">Leo can help you right now, by voice or text.</p>
          <button type="button" onClick={() => open("call")}
            className="mt-5 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl text-[18px] font-bold shadow-lg shadow-black/25 transition-transform duration-100 ease-out active:scale-[0.97] motion-reduce:transition-none"
            style={{ background: t.accent, color: t.onAccent }}>
            <Phone className="h-5 w-5" aria-hidden /> Talk to Leo
          </button>
          <button type="button" onClick={() => open("chat")}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.08] text-[16px] font-semibold ring-1 ring-white/15 transition-transform duration-100 ease-out active:scale-[0.97] motion-reduce:transition-none">
            <MessageCircle className="h-5 w-5" aria-hidden /> Message Leo instead
          </button>
        </section>

        <div className="flex-1" />
        {reason !== "ended" && (
          <a href={look.signIn} className="mx-auto mt-8 inline-flex min-h-[44px] items-center gap-1 text-[15px] font-medium" style={{ color: t.accent }}>
            Rebooked? Sign in with your phone number <ChevronRight className="h-4 w-4" aria-hidden />
          </a>
        )}
      </main>

      {leo && <LeoScreen token={token} home={home} context={{ stage: null, ended: reason === "ended", linkDown: reason }} onEnd={() => setLeo(false)} />}
    </div>
  );
}
