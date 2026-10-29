import { useEffect, useId, useRef, useState } from "react";
import "./agent-orb.css";

/**
 * AgentOrb — the face of Bestly's voice agents (Jared, 2026-10-21).
 * A pearl sphere with a simple face inside a glowing ring. Same orb for every
 * agent; the glow tells them apart: Maya purple, Ava orange.
 *
 * Motion: on mount it glances left, then right, then smiles (~2.4s), then rests.
 * It replays when the control around it is hovered, focused or tapped. Nothing
 * loops except `talking`, which is a live-call status. Reduced motion shows the
 * final smiling frame.
 *
 * Talking: the mouth follows her voice. `level()` returns how loud she is right
 * now (0 to 1); one rAF loop smooths it and writes it to the CSS variable `--m`
 * (no React render per frame). The smile opens into a dark mouth, the eyes blink
 * every few seconds and the head bobs a hair. With no `level` (or when it returns
 * null) a procedural syllable rhythm drives the mouth instead. Reduced motion
 * keeps only the ring pulse.
 */
const TINTS = {
  maya: { ring: "#8b70f5", glow: "139,112,245" },
  ava: { ring: "#ff8a3d", glow: "255,138,61" },
} as const;

type Props = {
  tint?: keyof typeof TINTS;
  size?: number;
  animate?: "intro" | "none";
  talking?: boolean;
  /** Loudness of her voice right now, 0 to 1. Return null when there is no signal to read (falls back to a procedural rhythm). */
  level?: () => number | null | undefined;
  ring?: boolean;
  className?: string;
};

export function AgentOrb({ tint = "maya", size = 44, animate = "intro", talking = false, level, ring, className = "" }: Props) {
  const id = useId().replace(/:/g, "");
  const t = TINTS[tint];
  const showRing = ring ?? size > 24;
  const wrap = useRef<HTMLSpanElement>(null);
  const [play, setPlay] = useState(0);
  const talkingRef = useRef(talking);
  const levelRef = useRef(level);
  const kick = useRef<() => void>(() => {});
  talkingRef.current = talking;
  levelRef.current = level;

  // Lip-sync loop. Runs only while she talks (plus a ~150 ms ease back to the smile), never re-renders React.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let running = false;
    let last = 0;
    let m = 0; // smoothed mouth openness
    let blinkAt = 0; // when the next blink starts
    let blinkStart = -1;
    // procedural syllables
    let synEnd = 0, synStart = 0, synH = 0, left = 0;
    const write = (mv: number, bv: number) => {
      el.style.setProperty("--m", mv.toFixed(3));
      el.style.setProperty("--b", bv.toFixed(3));
    };
    const syllable = (now: number) => {
      if (now < synEnd) {
        const u = (now - synStart) / (synEnd - synStart);
        return u < 0 ? 0 : synH * Math.sin(Math.PI * Math.min(1, u));
      }
      // next one: a short gap, or now and then a longer pause between phrases
      if (left <= 0) { left = 3 + Math.floor(Math.random() * 5); synStart = now + 260 + Math.random() * 100; }
      else synStart = now + 20 + Math.random() * 50;
      left--;
      synEnd = synStart + 60 + Math.random() * 160;
      synH = Math.random() < 0.15 ? 0.2 + Math.random() * 0.15 : 0.4 + Math.random() * 0.6;
      return 0;
    };
    const frame = (now: number) => {
      if (document.hidden || reduce.matches) { running = false; write(0, 0); m = 0; return; }
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      const on = talkingRef.current;
      let target = 0;
      if (on) {
        const v = levelRef.current?.();
        if (typeof v === "number" && Number.isFinite(v)) {
          target = Math.pow(Math.min(1, Math.max(0, (v - 0.02) * 3)), 0.7);
        } else {
          target = syllable(now);
        }
      }
      // fast attack, slower release; a quicker release when she stops
      const tau = target > m ? 0.035 : on ? 0.11 : 0.05;
      m += (target - m) * (1 - Math.exp(-dt / tau));
      // blink: only while talking
      if (on && !blinkAt) blinkAt = now + 2500 + Math.random() * 3500;
      if (on && blinkStart < 0 && now >= blinkAt) { blinkStart = now; blinkAt = 0; }
      let b = 0;
      if (blinkStart >= 0) {
        const u = (now - blinkStart) / 140;
        if (u >= 1) blinkStart = -1;
        else b = u < 0.4 ? u / 0.4 : (1 - u) / 0.6;
      }
      if (!on) blinkAt = 0;
      write(m, b);
      if (on || m > 0.004 || blinkStart >= 0) raf = requestAnimationFrame(frame);
      else { running = false; write(0, 0); m = 0; }
    };
    kick.current = () => {
      if (running || reduce.matches || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const onVis = () => { if (!document.hidden && talkingRef.current) kick.current(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(raf);
      running = false;
      kick.current = () => {};
    };
  }, []);
  useEffect(() => { if (talking) kick.current(); }, [talking]);

  // Replay on hover / focus / tap of the control that holds the orb.
  useEffect(() => {
    if (animate !== "intro") return;
    const host = wrap.current?.closest("a,button,[role=button]") ?? wrap.current?.parentElement;
    if (!host) return;
    let last = 0;
    const replay = () => {
      const now = Date.now();
      if (now - last < 2600) return; // let a running glance finish
      last = now;
      setPlay((n) => n + 1);
    };
    host.addEventListener("pointerenter", replay);
    host.addEventListener("focusin", replay);
    host.addEventListener("pointerdown", replay);
    return () => {
      host.removeEventListener("pointerenter", replay);
      host.removeEventListener("focusin", replay);
      host.removeEventListener("pointerdown", replay);
    };
  }, [animate]);

  // The sphere fills more of the box when there is no ring.
  const r = showRing ? 39 : 46;
  const k = r / 39; // face scale

  return (
    <span
      ref={wrap}
      aria-hidden="true"
      className={`agent-orb ${animate === "intro" ? "is-intro" : "is-static"} ${talking ? "is-talking" : ""} ${className}`}
      style={{ width: size, height: size, ["--orb-glow" as string]: t.glow }}
    >
      <svg key={play} viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <radialGradient id={`g${id}`} cx="50%" cy="50%" r="50%">
            <stop offset={showRing ? "0.74" : "0.84"} stopColor={`rgb(${t.glow})`} stopOpacity="0" />
            <stop offset={showRing ? "0.9" : "0.93"} stopColor={`rgb(${t.glow})`} stopOpacity="0.35" />
            <stop offset="1" stopColor={`rgb(${t.glow})`} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`s${id}`} cx="36%" cy="30%" r="78%">
            <stop offset="0" stopColor="#fbfbfc" />
            <stop offset="0.38" stopColor="#e6e6ea" />
            <stop offset="0.72" stopColor="#b3afc6" />
            <stop offset="1" stopColor="#7c7699" />
          </radialGradient>
          <radialGradient id={`h${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`c${id}`}><circle cx="50" cy="50" r={r} /></clipPath>
        </defs>

        <circle cx="50" cy="50" r="50" fill={`url(#g${id})`} className="ao-glow" />
        {showRing && <circle cx="50" cy="50" r="46.5" fill="none" stroke={t.ring} strokeWidth="1.6" className="ao-ring" />}
        <circle cx="50" cy="50" r={r} fill={`url(#s${id})`} />
        <g clipPath={`url(#c${id})`}>
          <ellipse className="ao-spec" cx="40" cy="36" rx={14 * k} ry={11 * k} fill={`url(#h${id})`} />
        </g>
        <g transform={`translate(50 50) scale(${k}) translate(-50 -50)`}>
          <g className="ao-bob"><g className="ao-face">
            <g className="ao-eyes">
              <g className="ao-lids">
                <rect x="39.2" y="44.6" width="3.4" height="10.2" rx="1.7" fill="#141418" />
                <rect x="57.4" y="44.6" width="3.4" height="10.2" rx="1.7" fill="#141418" />
              </g>
            </g>
            <path className="ao-mouth" d="M42 59.2 Q50 57.2 58 59.2 Q58.5 68.6 50 68.6 Q41.5 68.6 42 59.2 Z" fill="#141418" />
            <path className="ao-smile" d="M42.4 59.6 Q50 66.8 57.6 59.6" fill="none" stroke="#141418" strokeWidth="3.2" strokeLinecap="round" />
          </g></g>
        </g>
      </svg>
    </span>
  );
}

export default AgentOrb;
