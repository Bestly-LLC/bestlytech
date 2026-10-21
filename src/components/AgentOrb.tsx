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
  ring?: boolean;
  className?: string;
};

export function AgentOrb({ tint = "maya", size = 44, animate = "intro", talking = false, ring, className = "" }: Props) {
  const id = useId().replace(/:/g, "");
  const t = TINTS[tint];
  const showRing = ring ?? size > 24;
  const wrap = useRef<HTMLSpanElement>(null);
  const [play, setPlay] = useState(0);

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
          <g className="ao-face">
            <g className="ao-eyes">
              <rect x="39.2" y="44.6" width="3.4" height="10.2" rx="1.7" fill="#141418" />
              <rect x="57.4" y="44.6" width="3.4" height="10.2" rx="1.7" fill="#141418" />
            </g>
            <path className="ao-smile" d="M42.4 59.6 Q50 66.8 57.6 59.6" fill="none" stroke="#141418" strokeWidth="3.2" strokeLinecap="round" />
          </g>
        </g>
      </svg>
    </span>
  );
}

export default AgentOrb;
