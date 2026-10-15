import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Focus ring + no 300 ms tap delay, shared by the Kitchen page's custom buttons. */
export const TAP = "touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50";

/** Segmented control with a sliding thumb: equal columns, so the thumb moves by whole widths. The thumb only moves
 * because a choice changed; reduced motion snaps it. A value outside the options (an item that is "on the way") hides it. */
export function Segmented({ label, value, onChange, options, className, dense }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { key: string; label: ReactNode; thumb?: string; ink?: string }[]; className?: string;
  /** Five-up controls on a phone: a step smaller so every label fits its column. */
  dense?: boolean;
}) {
  const idx = options.findIndex((o) => o.key === value);
  const sel = idx >= 0 ? options[idx] : null;
  return (
    <div
      role="group" aria-label={label}
      className={cn("relative grid sm:inline-grid rounded-xl bg-white/[0.05] p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-1 bottom-1 left-1 rounded-lg shadow-sm",
          "motion-safe:transition-[transform,background-color,opacity] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]",
          sel?.thumb ?? "bg-white/[0.14]", sel ? "opacity-100" : "opacity-0",
        )}
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${Math.max(idx, 0) * 100}%)` }}
      />
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key} type="button" aria-pressed={on} onClick={() => onChange(o.key)}
            className={cn(
              "relative min-h-11 sm:min-h-8 rounded-lg font-medium whitespace-nowrap",
              dense ? "px-1 sm:px-3 text-[0.8125rem] sm:text-sm" : "px-2 sm:px-3 text-sm",
              "motion-safe:transition-[color,transform] motion-safe:duration-150 motion-safe:active:scale-[0.96]", TAP,
              on ? (o.ink ?? "text-white") : "text-white/60 hover:text-white",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
