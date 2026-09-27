/**
 * bestly.tech/sign — guests sign Jared's projection wall from their phone.
 *
 * Access: only from the NFC coasters. Each coaster opens bestly.tech/sign/<code>; the code is checked in the
 * database (wall_sign_open) and trades for a 20-minute signing session, then the URL is cleaned back to /sign so
 * reloads keep working. A plain /sign visit shows "Tap a coaster" (the old bare link works until
 * wall_sign_config.legacy_until, then switches off by itself).
 * Flow (landscape only; portrait shows a turn-your-phone prompt): sign -> one unique emoji (Scout places it on the
 * wall) -> a Kings Road x West Hollywood badge to save or email.
 */
import { useCallback, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useParams } from "react-router-dom";
import BadgeStep from "@/components/sign/BadgeStep";
import DrawStep, { type DrawResult } from "@/components/sign/DrawStep";
import EmojiStep from "@/components/sign/EmojiStep";
import RotatePrompt from "@/components/sign/RotatePrompt";
import TapCoaster from "@/components/sign/TapCoaster";
import type { BadgeInput } from "@/components/sign/badge";
import { forget, resolveSession, signWall, type Session } from "@/components/sign/signApi";

type Phase = "boot" | "gate" | "expired" | "draw" | "emoji" | "badge";

function useLandscape() {
  const q = "(orientation: landscape)";
  const [on, setOn] = useState(() => typeof window === "undefined" || window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener?.("change", f);
    window.addEventListener("resize", f);
    return () => { m.removeEventListener?.("change", f); window.removeEventListener("resize", f); };
  }, []);
  return on;
}

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

export default function SignWall() {
  const { code: pathCode } = useParams();
  const landscape = useLandscape();
  const [phase, setPhase] = useState<Phase>("boot");
  const [session, setSession] = useState<Session | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badge, setBadge] = useState<BadgeInput | null>(null);
  const [signedCount, setSignedCount] = useState(0);
  const [emoji, setEmoji] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const code = (pathCode || qs.get("t") || "").trim().toLowerCase() || null;
    resolveSession(code)
      .then((s) => {
        // keep the coaster code out of the address bar (and out of screenshots / shared links)
        if (code) window.history.replaceState(null, "", "/sign");
        if (!s) { setPhase("gate"); return; }
        setSession(s);
        setSignedCount(s.signed);
        setEmoji(s.emoji);
        setPhase("draw");
      })
      .catch(() => setPhase("gate"));
  }, [pathCode]);

  // session clock: when the 20 minutes run out mid-draw, show the tap screen instead of failing on send
  useEffect(() => {
    if (!session || phase === "badge") return;
    const ms = session.expiresAt - Date.now();
    const t = window.setTimeout(() => { if (phase === "draw" || phase === "emoji") { forget(); setPhase("expired"); } }, Math.max(0, ms));
    return () => window.clearTimeout(t);
  }, [session, phase]);

  const expired = useCallback(() => { forget(); setPhase("expired"); }, []);

  const onSend = async (r: DrawResult) => {
    if (!session) return;
    setSending(true);
    setError(null);
    try {
      const res = await signWall(session.token, r);
      if (navigator.vibrate) navigator.vibrate(30);
      setSignedCount((n) => n + 1);
      setBadge({ name: r.name, strokes: r.strokes, color: r.color, emoji, badgeNo: res.badgeNo, when: new Date() });
      setPhase(emoji ? "badge" : "emoji");
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (m.includes("coaster")) expired();
      else if (m.includes("plenty")) setError("That's the limit for one tap. Tap a coaster to sign again.");
      else setError(m.includes("slow down") ? "Easy, one sec. Try again in a moment." : "That didn't go through. Try again?");
    } finally {
      setSending(false);
    }
  };

  const banner = session?.legacy && session.legacyUntil ? `Old coaster link. Works until ${fmtDay(session.legacyUntil)}.` : null;
  const needsLandscape = phase === "draw" || phase === "emoji" || phase === "badge";

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white antialiased">
      <Helmet>
        <title>Sign the wall</title>
        <meta name="robots" content="noindex" />
        <meta name="theme-color" content="#000000" />
      </Helmet>
      <style>{`
        @keyframes sw-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes sw-pop { 0% { transform: scale(.85) rotate(-3deg); opacity: 0; } 60% { transform: scale(1.03) rotate(1deg); opacity: 1; } 100% { transform: none; } }
        @keyframes sw-draw { to { stroke-dashoffset: 0; } }
        @keyframes sw-ring { 0% { transform: scale(.7); opacity: .9; } 100% { transform: scale(1.35); opacity: 0; } }
        @keyframes sw-turn { 0%, 18% { transform: rotate(0deg); } 45%, 78% { transform: rotate(-90deg); } 100% { transform: rotate(0deg); } }
        @keyframes sw-arrow { 0%, 20% { opacity: .15; } 40%, 70% { opacity: 1; } 100% { opacity: .15; } }
        .sw-rise { animation: sw-rise .5s cubic-bezier(.2,.8,.2,1) both; }
        .sw-pop { animation: sw-pop .7s cubic-bezier(.2,.8,.2,1) both; }
        .sw-ring { animation: sw-ring 2s ease-out infinite; }
        .sw-rotate-phone { transform-box: fill-box; transform-origin: center; animation: sw-turn 2.8s cubic-bezier(.6,0,.2,1) infinite; }
        .sw-rotate-arrow { animation: sw-arrow 2.8s ease-in-out infinite; }
        .sw-check { stroke-dasharray: 1; stroke-dashoffset: 1; animation: sw-draw .5s .35s ease-out forwards; }
        .sw-scroll { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
        .sw-safe { padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
        @media (prefers-reduced-motion: reduce) {
          .sw-rise, .sw-pop, .sw-ring, .sw-rotate-phone, .sw-rotate-arrow { animation: none !important; }
          .sw-check { animation-duration: .01s; }
        }
      `}</style>

      {phase === "boot" && <div className="flex h-full items-center justify-center text-[15px] text-white/40" aria-live="polite">One sec…</div>}
      {phase === "gate" && <TapCoaster />}
      {phase === "expired" && <TapCoaster expired />}

      {needsLandscape && session && (
        <div className="sw-safe h-full">
          {phase === "draw" && <DrawStep sending={sending} error={error} banner={banner} onSend={onSend} />}
          {phase === "emoji" && (
            <EmojiStep
              token={session.token}
              onExpired={expired}
              onSkip={() => setPhase("badge")}
              onDone={(e) => {
                setEmoji(e.emoji);
                setBadge((b) => (b ? { ...b, emoji: e.emoji } : b));
                setPhase("badge");
              }}
            />
          )}
          {phase === "badge" && badge && (
            <BadgeStep
              token={session.token}
              badge={badge}
              canSignAgain={signedCount < 3 && Date.now() < session.expiresAt}
              onSignAgain={() => { setError(null); setPhase("draw"); }}
            />
          )}
        </div>
      )}

      {needsLandscape && !landscape && <RotatePrompt />}
    </main>
  );
}
