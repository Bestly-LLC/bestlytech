/**
 * The four tyre pressures either side of the car, seen from above — front at the top,
 * driver's side on the left. Read as a picture, no legend needed.
 *
 * Shared by the Car health card on /admin/turo/lax-pass and the Tire pressure row in
 * Car protection, so the two can never drift apart.
 */
import { cn } from "@/lib/utils";

export const POSITIONS = [
  ["fl", "Front left"],
  ["fr", "Front right"],
  ["rl", "Rear left"],
  ["rr", "Rear right"],
] as const;

/**
 * Top-down outline: narrower nose, cabin set back, four wheels level with the four numbers.
 * Everything smaller than this — wing mirrors, pillar lines — turns to noise at 60px tall.
 */
function CarTop({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 76" fill="none" aria-hidden className={className}>
      <path
        d="M22 2c-5 0-8.6 2.4-10.2 7-1.9 5.6-3.2 13.2-3.9 21.2-.8 10-1 22-.2 32 .6 7.6 4.9 11.8 14.3 11.8s13.7-4.2 14.3-11.8c.8-10 .6-22-.2-32-.7-8-2-15.6-3.9-21.2C30.6 4.4 27 2 22 2Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity="0.55"
      />
      <path
        d="M15.4 26h13.2c1.4 0 2.5 1.1 2.6 2.4l.6 21c.1 1.5-1 2.6-2.5 2.6H14.7c-1.5 0-2.6-1.1-2.5-2.6l.6-21c.1-1.3 1.2-2.4 2.6-2.4Z"
        stroke="currentColor" strokeWidth="1.2" opacity="0.34"
      />
      <g fill="currentColor" opacity="0.6">
        <rect x="4.6" y="12.5" width="4.6" height="12.5" rx="2.3" />
        <rect x="34.8" y="12.5" width="4.6" height="12.5" rx="2.3" />
        <rect x="4.3" y="50" width="4.6" height="12.5" rx="2.3" />
        <rect x="35.1" y="50" width="4.6" height="12.5" rx="2.3" />
      </g>
    </svg>
  );
}

export function TirePsiGrid({
  tires,
  low,
  size = "sm",
  className,
}: {
  tires: Record<string, number | null>;
  /** Under this, the number is tinted and announced as low. */
  low: number;
  size?: "sm" | "lg";
  className?: string;
}) {
  const num = (pos: string, name: string, align: string) => {
    const v = tires[pos];
    const under = typeof v === "number" && v < low;
    return (
      <span className={cn("tabular-nums", align, under ? "text-[#FF9F0A] bento:text-[#C93400]" : "text-white")}>
        <span className="sr-only">{name}: </span>
        {v ?? "?"}
        {under && <span className="sr-only"> (low)</span>}
      </span>
    );
  };
  const big = size === "lg";
  return (
    <div
      className={cn(
        "grid w-fit items-center font-semibold leading-none",
        big ? "gap-x-3 gap-y-6 text-[19px]" : "gap-x-2.5 gap-y-5 text-[15px]",
        "grid-cols-[1.9em_auto_1.9em]",
        className,
      )}
    >
      {num("fl", "Front left", "text-right")}
      <CarTop className={cn("row-span-2 text-white/45 bento:text-black/30", big ? "h-[5rem]" : "h-[3.75rem]")} />
      {num("fr", "Front right", "text-left")}
      {num("rl", "Rear left", "text-right")}
      {num("rr", "Rear right", "text-left")}
    </div>
  );
}
