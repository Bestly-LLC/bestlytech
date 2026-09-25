/**
 * The four tyre pressures laid out the way they sit on the car, split by a hairline cross —
 * front on top, driver's side on the left. Read as a picture, no legend needed.
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
  return (
    <div
      className={cn(
        "grid w-fit grid-cols-2 font-semibold leading-tight tabular-nums",
        size === "lg" ? "text-[19px]" : "text-[15px]",
        size === "lg" ? "[&>span]:px-3 [&>span]:py-1" : "[&>span]:px-2 [&>span]:py-0.5",
        "[&>span:nth-child(even)]:border-l [&>span:nth-child(odd)]:pl-0",
        "[&>span:nth-child(n+3)]:border-t",
        "[&>span]:border-white/[0.14] bento:[&>span]:border-black/10",
        className,
      )}
    >
      {POSITIONS.map(([pos, name]) => {
        const v = tires[pos];
        const under = typeof v === "number" && v < low;
        return (
          <span key={pos} className={under ? "text-[#FF9F0A] bento:text-[#C93400]" : "text-white"}>
            <span className="sr-only">{name}: </span>
            {v ?? "?"}
            {under && <span className="sr-only"> (low)</span>}
          </span>
        );
      })}
    </div>
  );
}
