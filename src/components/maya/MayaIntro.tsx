/**
 * The first thing a visitor sees after tapping "Talk to Maya" (Jared, 2026-10-11): what she is and what she can do,
 * so nobody mistakes her for a chat box. "Start talking" opens her with the microphone on (voice is the default);
 * "Type instead" opens her ready to type.
 *
 * Anchored to the launcher (it grows out of the bottom-right corner on desktop, rises as a sheet on phones), a light
 * scrim focuses it, Escape or a tap outside closes it. Reduce Motion: a plain fade.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Calculator, CalendarCheck, Mic, MousePointerClick, Keyboard, X } from "lucide-react";

export function MayaIntro({ onTalk, onType, onClose }: { onTalk: () => void; onType: () => void; onClose: () => void }) {
  const talk = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    talk.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[61]" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} tabIndex={-1}
        className="maya-scrim absolute inset-0 cursor-default motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200" />
      <section role="dialog" aria-modal="true" aria-labelledby="maya-intro-title"
        className="maya-intro absolute text-white motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48"
          style={{ background: "radial-gradient(80% 100% at 30% 0%, #8E9BFF40, #E59CFF18 45%, transparent 75%)" }} />
        <div className="relative p-5 pb-4">
          <div className="flex items-start gap-3">
            <span aria-hidden className="maya-orb-live block h-14 w-14 shrink-0 rounded-full"
              style={{ background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,.85), rgba(255,255,255,0) 45%), conic-gradient(from 210deg, #8E9BFF, #E59CFF, #8E9BFF, #6CD3FF, #8E9BFF)",
                boxShadow: "0 0 30px -3px #8E9BFFAA" }} />
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#8E9BFF]">Bestly's AI agent</p>
              <h2 id="maya-intro-title" className="text-[24px] font-semibold leading-tight tracking-[-0.02em]">Meet Maya</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[0.08] ring-1 ring-white/15 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <p className="mt-3 text-[16px] leading-relaxed text-[#E4E6F7]">
            She's not a chat box. Maya talks with you out loud and works this website while you watch.
          </p>

          <ul className="mt-4 flex flex-col gap-2.5">
            <Row icon={<Mic className="h-4 w-4" aria-hidden />}>Talk like you would to a person. Interrupt her anytime.</Row>
            <Row icon={<MousePointerClick className="h-4 w-4" aria-hidden />}>She opens pages and points to exactly what you asked about.</Row>
            <Row icon={<Calculator className="h-4 w-4" aria-hidden />}>She runs your real numbers on the savings calculator, live.</Row>
            <Row icon={<CalendarCheck className="h-4 w-4" aria-hidden />}>She can book a call or get your question to the team.</Row>
          </ul>

          <div className="mt-5 flex flex-col gap-2">
            <button ref={talk} type="button" onClick={onTalk}
              className="flex h-[52px] items-center justify-center gap-2 rounded-full bg-[#8E9BFF] text-[17px] font-semibold text-[#0E1030] transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <Mic className="h-5 w-5" aria-hidden /><span className="whitespace-nowrap">Start talking</span>
            </button>
            <button type="button" onClick={onType}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-white/[0.08] text-[16px] font-semibold ring-1 ring-white/15 transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              <Keyboard className="h-5 w-5" aria-hidden /><span className="whitespace-nowrap">Type instead</span>
            </button>
          </div>
          <p className="mt-3 text-center text-[12px] leading-snug text-[#C7CBEA]">
            Maya is an AI. Conversations are recorded and transcribed to help you, and starting one means you agree (
            <a href="/privacy-policy" className="font-semibold text-white underline-offset-2 hover:underline">privacy</a>). Your mic is used only
            while you talk. Prefer a person?{" "}
            <a href="tel:+12136410074" className="whitespace-nowrap font-semibold text-white underline-offset-2 hover:underline">(213) 641-0074</a>
          </p>
        </div>
      </section>
    </div>, document.body);
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[15px] leading-snug">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#8E9BFF]/[0.16] text-[#AEB8FF]">{icon}</span>
      <span className="pt-1.5">{children}</span>
    </li>
  );
}
