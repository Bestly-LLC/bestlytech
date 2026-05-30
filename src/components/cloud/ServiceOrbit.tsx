import {
  Server, Folder, Mail, CalendarDays, MessageSquare,
  Brain, ShieldAlert, Globe, ServerCog, ListChecks,
  KeyRound, FileSignature, type LucideIcon,
} from "lucide-react";

/**
 * ServiceOrbit
 *
 * The visual centerpiece of the /cloud hero: a glowing on-prem server core
 * with the services it replaces orbiting around it in two counter-rotating
 * rings. Pure CSS motion (transform/opacity), GPU-friendly, and fully
 * disabled under prefers-reduced-motion (see index.css .cloud-orbit-*).
 *
 * The whole rig is laid out on a fixed 460px coordinate system, then scaled
 * down on smaller viewports so the geometry never breaks.
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

const SIZE = 460; // design coordinate system
const CENTER = SIZE / 2;

function Ring({
  items,
  radius,
  ringClass,
  iconRevClass,
  iconSize,
}: {
  items: Orbiter[];
  radius: number;
  ringClass: string;
  iconRevClass: string;
  iconSize: number;
}) {
  return (
    <div className={`absolute inset-0 ${ringClass}`} aria-hidden="true">
      {/* faint orbit path */}
      <div
        className="absolute rounded-full border border-[hsl(var(--gradient-end)/0.18)]"
        style={{
          left: CENTER - radius,
          top: CENTER - radius,
          width: radius * 2,
          height: radius * 2,
        }}
      />
      {items.map((o, i) => {
        const angle = (360 / items.length) * i - 90;
        const rad = (angle * Math.PI) / 180;
        const x = CENTER + radius * Math.cos(rad);
        const y = CENTER + radius * Math.sin(rad);
        return (
          <div
            key={`${o.label}-${i}`}
            className="absolute"
            style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
          >
            <div className={iconRevClass}>
              <div
                className="flex items-center justify-center rounded-2xl border border-border bg-card/90 shadow-premium backdrop-blur-sm"
                style={{ width: iconSize, height: iconSize }}
                title={o.label}
              >
                <o.icon
                  className="text-primary"
                  style={{ width: iconSize * 0.46, height: iconSize * 0.46 }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ServiceOrbit({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative mx-auto aspect-square w-full max-w-[460px] scale-[0.78] sm:scale-90 lg:scale-100 ${className}`}
      role="img"
      aria-label="A single on-premises server surrounded by the thirteen cloud services it replaces"
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        {/* Outer ring (slow) */}
        <Ring
          items={OUTER}
          radius={196}
          ringClass="cloud-orbit-slow"
          iconRevClass="cloud-orbit-rev-slow"
          iconSize={56}
        />
        {/* Inner ring (mid, opposite direction) */}
        <Ring
          items={INNER}
          radius={118}
          ringClass="cloud-orbit-rev-mid"
          iconRevClass="cloud-orbit-mid"
          iconSize={60}
        />

        {/* Pulsing rings emanating from the core */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="absolute h-40 w-40 rounded-full border border-[hsl(var(--glow-color)/0.4)] cloud-ping-ring" />
          <div className="absolute h-40 w-40 rounded-full border border-[hsl(var(--glow-color)/0.4)] cloud-ping-ring" style={{ animationDelay: "1.3s" }} />
          <div className="absolute h-40 w-40 rounded-full border border-[hsl(var(--glow-color)/0.4)] cloud-ping-ring" style={{ animationDelay: "2.6s" }} />
        </div>

        {/* Core server */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative flex h-32 w-32 items-center justify-center rounded-[28px] gradient-bg cloud-core-glow">
            <div className="absolute inset-[3px] rounded-[25px] bg-card/85 backdrop-blur-sm" />
            <Server className="relative h-12 w-12 text-primary" strokeWidth={1.75} />
            <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-card/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-foreground shadow-sm">
              Your server
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
