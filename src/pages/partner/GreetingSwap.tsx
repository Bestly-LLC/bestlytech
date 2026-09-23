import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * "Good evening, Eli" that turns into the partner's company while the pointer is on it.
 *
 * The sequence (about a second end to end):
 *   1. pointer lands on the greeting -> onExcite(true): the partner's mark shakes, spins its
 *      globe and looks over at the name (PartnerMark `excited`)
 *   2. the greeting's letters lift and blur away, one after another
 *   3. the company name decodes in place: each letter flickers through glyphs and locks,
 *      left to right, under a moving light sweep
 * Pointer leaves -> the company fades out and the greeting fades back.
 * Touch: a tap shows it for three seconds. Reduced motion: a plain crossfade, no scramble.
 */
const GLYPHS = "◆◇●○■□▲△◢◣◤◥✦✧/\\<>#%&*+=~";
const REVEAL_DELAY_MS = 420;   // let the mark shake first
const STEP_MS = 38;            // per letter

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

const CSS = `
.gs-letter{display:inline-block;transition:transform .42s cubic-bezier(.3,1.4,.5,1),opacity .32s ease,filter .32s ease}
.gs-away .gs-letter{transform:translateY(-0.55em) rotate(-8deg) scale(.9);opacity:0;filter:blur(6px)}
.gs-co{color:inherit}
.gs-lock{display:inline-block;animation:gs-pop .7s cubic-bezier(.3,1.6,.5,1) both}
.gs-scr{display:inline-block;color:#7cc4ff;opacity:.7}
.admin-bento .gs-scr{color:#0A84FF}
@keyframes gs-pop{0%{transform:translateY(.3em) scale(.6);opacity:.2;color:#34d399;text-shadow:0 0 18px rgba(52,211,153,.9)}35%{transform:translateY(-.06em) scale(1.08);opacity:1;color:#7cc4ff;text-shadow:0 0 14px rgba(124,196,255,.8)}100%{transform:none;opacity:1;color:inherit;text-shadow:0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.gs-letter{transition:opacity .2s}.gs-away .gs-letter{transform:none;filter:none}.gs-lock{animation:none}}
`;

export function GreetingSwap({ greeting, name, company, onExcite, className }: {
  greeting: string;
  name: string;
  company?: string | null;
  onExcite?: (on: boolean) => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(false);
  const [shown, setShown] = useState(""); // decoded part of the company name
  const [tail, setTail] = useState("");   // the still-scrambling rest
  const timers = useRef<number[]>([]);
  const touchTimer = useRef<number | null>(null);
  const line = `${greeting}, ${name}`;

  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  const start = useCallback(() => {
    if (!company) return;
    clear();
    setOn(true);
    onExcite?.(true);
    setShown(""); setTail("");
    if (reduced) { setShown(company); return; }
    const chars = [...company];
    const t0 = REVEAL_DELAY_MS;
    // scramble frames, then lock letter i at t0 + i*STEP
    for (let f = 0; f < chars.length + 6; f++) {
      timers.current.push(window.setTimeout(() => {
        const locked = Math.max(0, f - 5);
        setShown(chars.slice(0, locked).join(""));
        setTail(chars.slice(locked).map((c) => (c === " " ? " " : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(""));
      }, t0 + f * STEP_MS));
    }
    timers.current.push(window.setTimeout(() => { setShown(company); setTail(""); }, t0 + (chars.length + 6) * STEP_MS));
  }, [company, onExcite, reduced]);

  const stop = useCallback(() => {
    clear();
    setOn(false);
    onExcite?.(false);
  }, [onExcite]);

  useEffect(() => () => { clear(); if (touchTimer.current) window.clearTimeout(touchTimer.current); }, []);

  if (!company) {
    return <h1 className={className}>{line}</h1>;
  }

  return (
    <h1
      className={cn("relative cursor-default select-none", className)}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") start(); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") stop(); }}
      onPointerUp={(e) => {
        if (e.pointerType === "mouse") return; // mouse uses hover; this is for touch and pen
        if (on) { stop(); return; }
        start();
        if (touchTimer.current) window.clearTimeout(touchTimer.current);
        touchTimer.current = window.setTimeout(stop, 3000);
      }}
      aria-label={on ? company : line}
    >
      <style>{CSS}</style>
      <span aria-hidden style={{ display: "grid" }}>
        {/* the greeting, letter by letter so it can peel away */}
        <span style={{ gridArea: "1 / 1" }} className={cn(on && "gs-away")}>
          {[...line].map((c, i) => (
            <span key={i} className="gs-letter" style={{ transitionDelay: on ? `${i * 14}ms` : `${Math.max(0, 200 - i * 6)}ms` }}>
              {c === " " ? " " : c}
            </span>
          ))}
        </span>
        {/* the company, decoding in */}
        <span style={{ gridArea: "1 / 1", transition: "opacity .3s", opacity: on ? 1 : 0 }}>
          {on && (
            <span className="gs-co">
              {[...shown].map((c, i) => <span key={`s${i}`} className="gs-lock">{c === " " ? " " : c}</span>)}
              <span className="gs-scr">{tail}</span>
            </span>
          )}
        </span>
      </span>
    </h1>
  );
}
