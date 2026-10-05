/**
 * Ava's mascot, "Orb" (Jared picked it 2026-10-04 from the mascot canvas): a pearl sphere with a calm face and one soft glow.
 * Used on both Ava pages (personal + RoofGuard) so they look the same. `speaking` makes the glow breathe during a live call
 * (off when the viewer asked for reduced motion). Pure SVG, scales from a 16 px badge to a hero.
 */
import { useId } from "react";
import { cn } from "@/lib/utils";

export const AVA_GLOW = "#FFA270";

/** Sidebar-sized Orb, shaped like a lucide icon component (className in, sized by the caller's h/w classes). */
export function AvaOrbIcon({ className }: { className?: string }) {
  return <span className={cn("inline-grid place-items-center", className)}><AvaOrb size={20} /></span>;
}

export function AvaOrb({ size = 40, glow = AVA_GLOW, speaking = false, label, className }:
  { size?: number; glow?: string; speaking?: boolean; label?: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={cn("shrink-0", className)}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <radialGradient id={`p${id}`} cx="36%" cy="30%" r="78%">
          <stop offset="0" stopColor="#ffffff" /><stop offset="0.58" stopColor="#ececf1" /><stop offset="1" stopColor="#b4b4be" />
        </radialGradient>
        <radialGradient id={`a${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={glow} stopOpacity="0.55" /><stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className={speaking ? "motion-safe:animate-pulse" : undefined} style={{ transformOrigin: "100px 100px" }}>
        <circle cx="100" cy="100" r="98" fill={`url(#a${id})`} />
        <circle cx="100" cy="100" r="77" fill="none" stroke={glow} strokeWidth="2" opacity={speaking ? 0.7 : 0.4} />
      </g>
      <circle cx="100" cy="100" r="64" fill={`url(#p${id})`} />
      <ellipse cx="80" cy="72" rx="20" ry="10" fill="#ffffff" opacity="0.75" transform="rotate(-28 80 72)" />
      <rect x="81" y="90" width="8" height="18" rx="4" fill="#1c1c1e" />
      <rect x="111" y="90" width="8" height="18" rx="4" fill="#1c1c1e" />
      <path d="M88 121 Q100 129 112 121" fill="none" stroke="#1c1c1e" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
