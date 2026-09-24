/**
 * Shown after "Add to Apple Wallet" while the pass is built and signed (can take up to a minute on a cold start).
 * A pass slides into a wallet pocket on a loop, like Apple Wallet's add animation. Respects reduced motion.
 */
import { useEffect, useState } from "react";

const STEPS = ["Building your pass", "Adding your lobby door QR code", "Signing it for Apple Wallet", "Almost there"];

export function WalletLoader({ open, onCancel }: { open: boolean; onCancel: () => void }) {
  const [step, setStep] = useState(0);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!open) { setStep(0); setSecs(0); return; }
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [open]);
  useEffect(() => { setStep(Math.min(STEPS.length - 1, Math.floor(secs / 5))); }, [secs]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 backdrop-blur-md sm:items-center" role="dialog" aria-modal="true" aria-label="Adding your pass to Apple Wallet">
      <style>{`
        @keyframes wl-drop { 0% { transform: translateY(-46px) scale(.96); opacity: 0 } 18% { opacity: 1 } 55% { transform: translateY(14px) scale(1) } 70%,100% { transform: translateY(30px) scale(1); opacity: 1 } }
        @keyframes wl-shine { 0% { transform: translateX(-120%) } 100% { transform: translateX(220%) } }
        @keyframes wl-in { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .wl-sheet { animation: wl-in 320ms cubic-bezier(.2,.8,.2,1) both }
        .wl-pass { animation: wl-drop 1.9s cubic-bezier(.34,1.3,.5,1) infinite }
        .wl-shine { animation: wl-shine 1.9s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .wl-sheet, .wl-pass, .wl-shine { animation: none } }
      `}</style>
      <div className="wl-sheet w-full max-w-sm rounded-t-[28px] bg-[#1c1c1e] px-6 pb-8 pt-7 text-center text-white shadow-2xl sm:rounded-[28px]" style={{ paddingBottom: "max(32px, env(safe-area-inset-bottom))" }}>
        {/* Wallet with a pass dropping in */}
        <div className="relative mx-auto h-[128px] w-[170px]" aria-hidden>
          <div className="wl-pass absolute left-1/2 top-2 h-[88px] w-[140px] overflow-hidden rounded-[12px] shadow-lg" style={{ background: "linear-gradient(160deg,#3b2a8f,#2B1A73 55%,#1A1140)", marginLeft: -70 }}>
            <div className="absolute inset-x-0 bottom-0 h-7" style={{ background: "linear-gradient(90deg,#FFB878,#E4527A,#7A2E9E)" }} />
            <div className="absolute left-2.5 top-2 h-1.5 w-12 rounded-full bg-white/70" />
            <div className="absolute right-2.5 top-2 h-5 w-5 rounded-[4px] bg-white/90" />
            <div className="wl-shine absolute inset-y-0 w-10 -skew-x-12 bg-white/25" />
          </div>
          {/* pocket (in front) */}
          <div className="absolute inset-x-0 bottom-0 h-[70px] rounded-[18px] shadow-[0_-6px_18px_rgba(0,0,0,.35)]" style={{ background: "linear-gradient(180deg,#2c2c2e,#1a1a1c)" }}>
            <div className="absolute inset-x-3 top-3 flex gap-1.5">
              {["#2E9BF0", "#F5B83D", "#F0605D", "#34C759"].map((c) => <span key={c} className="h-1.5 flex-1 rounded-full" style={{ background: c }} />)}
            </div>
          </div>
        </div>
        <p className="mt-5 text-[20px] font-semibold tracking-tight">Getting your pass ready</p>
        <p className="mt-1 min-h-[1.5rem] text-[15px] text-white/70" aria-live="polite">{STEPS[step]}…</p>
        <p className="mt-3 text-[13px] leading-snug text-white/45">This can take up to a minute. Apple Wallet opens on its own when it's ready.</p>
        <button type="button" onClick={onCancel} className="mt-5 min-h-[44px] rounded-full px-5 text-[15px] font-medium text-[#0A84FF] active:opacity-60">Cancel</button>
      </div>
    </div>
  );
}
