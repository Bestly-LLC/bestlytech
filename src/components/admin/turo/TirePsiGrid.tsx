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
 * Top-down car drawn the way a system glyph is: one filled silhouette, a lighter glass
 * layer, and four solid wheels — no hairline outlines, which turn to fuzz at 60px.
 * Everything is currentColor at three fixed weights (body 18%, glass 32%, wheels 60%), so
 * it reads the same on the dark admin and the light bento theme; only the colour flips
 * (white → near-black, via the theme's --tw-white token).
 *
 * viewBox is 50×90 and the wheels sit at y=22 and y=68 — exactly a quarter and three
 * quarters of the height — so when the grid gives the glyph two equal rows, each wheel
 * pair lines up with its row of numbers.
 */
function CarTop({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 50 90" fill="currentColor" aria-hidden className={className}>
      {/* body: gentle taper at the nose, squarer shoulders at the rear */}
      <path
        opacity="0.18"
        d="M25 4c-7.5 0-12.5 2-14 8-2 7-3.8 18-3.8 32 0 14 .8 26 2.4 34 1.4 6 7.4 8 15.4 8s14-2 15.4-8c1.6-8 2.4-20 2.4-34 0-14-1.8-25-3.8-32-1.5-6-6.5-8-14-8Z"
      />
      {/* glass: windscreen, roof and rear window as one lighter pane */}
      <path
        opacity="0.32"
        d="M14.5 27c2.5-4 18.5-4 21 0 1.1 6 1.7 14 1.7 22 0 8-3.2 13-12.2 13S12.8 57 12.8 49c0-8 .6-16 1.7-22Z"
      />
      {/* wheels: the anchors the four numbers hang off */}
      <g opacity="0.6">
        <rect x="4.25" y="14" width="7.5" height="16" rx="3.2" />
        <rect x="38.25" y="14" width="7.5" height="16" rx="3.2" />
        <rect x="5.05" y="60" width="7.5" height="16" rx="3.2" />
        <rect x="37.45" y="60" width="7.5" height="16" rx="3.2" />
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
      {/* text-white is the theme token: it flips to near-black on the light bento skin by itself */}
      <CarTop className={cn("row-span-2 text-white", big ? "h-[5rem]" : "h-[3.75rem]")} />
      {num("fr", "Front right", "text-left")}
      {num("rl", "Rear left", "text-right")}
      {num("rr", "Rear right", "text-left")}
    </div>
  );
}
