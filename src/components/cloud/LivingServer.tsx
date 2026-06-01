import { useRef } from "react";
import {
  motion, useMotionValue, useSpring, useTransform, useReducedMotion,
} from "framer-motion";
import {
  Server, Folder, Mail, CalendarDays, MessageSquare,
  Brain, ShieldAlert, Globe, ServerCog, ListChecks,
  KeyRound, FileSignature, type LucideIcon,
} from "lucide-react";
import { EASE_OUT } from "@/lib/motion";

/**
 * LivingServer — the brand's signature visual (evolution of ServiceOrbit).
 *
 * A glowing on-prem server core with the services it replaces orbiting in
 * two counter-rotating rings, data-packets streaming inward along spokes,
 * and an optional pointer-parallax 3D tilt. Boots in on mount.
 *
 * Reusable across /cloud, /get-started, and the live-status portal.
 * All motion is transform/opacity and disabled under prefers-reduced-motion;
 * pointer-parallax is additionally disabled on touch / coarse pointers.
 */

type Orbiter = { icon: LucideIcon; label: string };

const INNER: Orbiter[] = [
  { icon: Folder, label: "Drive" },
  { icon: Mail, label: "Mail" },
  { icon: CalendarDays, label: "Calendar" },
  { icon: MessageSquare, label: "Chat" },
];

const OUTER: Orbiter[] = [
  { icon: Brain, label: "AI" },
  { icon: ShieldAlert, label: "Shield" },
  { icon: Globe, label: "VPN" },
  { icon: ServerCog, label: "Backup" },
  { icon: ListChecks, label: "Projects" },
  { icon: KeyRound, label: "Passwords" },
  { icon: FileSignature, label: "Sign" },
  { icon: Mail, label: "Webmail" },
];

const SIZE = 460;
const CENTER = SIZE / 2;
const SPOKE_LEN = 150;
const SPOKES = 6;

function Ring({
  items, radius, ringClass, iconRevClass, iconSize,
}: {
  items: Orbiter[]; radius: number; ringClass: string; iconRevClass: string; iconSize: number;
}) {
  return (
    <div className={`absolute inset-0 ${ringClass}`} aria-hidden="true">
      <div
        className="absolute rounded-full border border-[hsl(var(--gradient-end)/0.18)]"
        style={{ left: CENTER - radius, top: CENTER - radius, width: radius * 2, height: radius * 2 }}
      />
      {items.map((o, i) => {
        const angle = (360 / items.length) * i - 90;
        const rad = (angle * Math.PI) / 180;
        const x = CENTER + radius * Math.cos(rad);
        const y = CENTER + radius * Math.sin(rad);
        return (
          <div key={`${o.label}-${i}`} className="absolute" style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}>
            <div className={iconRevClass}>
              <div
                className="flex items-center justify-center rounded-2xl border border-border bg-card/90 shadow-premium backdrop-blur-sm"
                style={{ width: iconSize, height: iconSize }}
                title={o.label}
              >
                <o.icon className="text-primary" style={{ width: iconSize * 0.46, height: iconSize * 0.46 }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LivingServer({
  className = "",
  parallax = true,
}: {
  className?: string;
  parallax?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const mvX = useMotionValue(0);
  const mvY = useMotionValue(0);
  const sx = useSpring(mvX, { stiffness: 150, damping: 18 });
  const sy = useSpring(mvY, { stiffness: 150, damping: 18 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [14, -14]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [-14, 14]);

  const finePointer =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: fine)").matches;
  const enableParallax = parallax && !reduce && !!finePointer;

  const onMove = (e: React.MouseEvent) => {
    if (!enableParallax || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mvX.set((e.clientX - r.left) / r.width - 0.5);
    mvY.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => { mvX.set(0); mvY.set(0); };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`relative mx-auto aspect-square w-full max-w-[460px] scale-[0.78] [perspective:1100px] sm:scale-90 lg:scale-100 ${className}`}
      role="img"
      aria-label="A single on-premises server surrounded by the thirteen cloud services it replaces, with data streaming into it"
    >
      <motion.div
        className="relative"
        style={{
          width: SIZE,
          height: SIZE,
          ...(enableParallax ? { rotateX, rotateY, transformStyle: "preserve-3d" as const } : {}),
        }}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: EASE_OUT }}
      >
        {/* Spokes + inward data packets */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {Array.from({ length: SPOKES }).map((_, i) => {
            const angle = (360 / SPOKES) * i;
            return (
              <div
                key={i}
                className="absolute left-1/2 top-1/2"
                style={{ width: 2, height: SPOKE_LEN, transformOrigin: "top center", transform: `translate(-50%, 0) rotate(${angle}deg)` }}
              >
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[hsl(var(--glow-color)/0.18)]" />
                <span
                  className="cloud-packet absolute top-0 h-1.5 w-1.5 rounded-full bg-[hsl(var(--glow-color))]"
                  style={{ left: "50%", marginLeft: -3, ["--cloud-spoke-h" as string]: `${SPOKE_LEN}px`, animationDelay: `${i * 0.5}s` }}
                />
              </div>
            );
          })}
        </div>

        <Ring items={OUTER} radius={196} ringClass="cloud-orbit-slow" iconRevClass="cloud-orbit-rev-slow" iconSize={56} />
        <Ring items={INNER} radius={118} ringClass="cloud-orbit-rev-mid" iconRevClass="cloud-orbit-mid" iconSize={60} />

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="absolute h-40 w-40 rounded-full border border-[hsl(var(--glow-color)/0.4)] cloud-ping-ring" />
          <div className="absolute h-40 w-40 rounded-full border border-[hsl(var(--glow-color)/0.4)] cloud-ping-ring" style={{ animationDelay: "1.3s" }} />
          <div className="absolute h-40 w-40 rounded-full border border-[hsl(var(--glow-color)/0.4)] cloud-ping-ring" style={{ animationDelay: "2.6s" }} />
        </div>

        <div className="absolute inset-0 flex items-center justify-center" style={enableParallax ? { transform: "translateZ(40px)" } : undefined}>
          <div className="relative flex h-32 w-32 items-center justify-center rounded-[28px] gradient-bg cloud-core-glow">
            <div className="absolute inset-[3px] rounded-[25px] bg-card/85 backdrop-blur-sm" />
            <Server className="relative h-12 w-12 text-primary" strokeWidth={1.75} />
            <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-card/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-foreground shadow-sm">
              Your server
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
