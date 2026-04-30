import { type ReactNode } from "react";

/**
 * Slow horizontal text scroll. Pure CSS keyframes; pauses on hover.
 * Two concatenated copies prevent the seam from showing.
 */
export function Marquee({
  children,
  speed = 40,
  className = "",
}: {
  children: ReactNode;
  /** seconds for one full loop */
  speed?: number;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className="flex w-max gap-12 will-change-transform [animation:wow-marquee_var(--marquee-speed)_linear_infinite] hover:[animation-play-state:paused] motion-reduce:[animation:none]"
        style={{ ["--marquee-speed" as string]: `${speed}s` }}
      >
        <div className="flex shrink-0 items-center gap-12">{children}</div>
        <div aria-hidden="true" className="flex shrink-0 items-center gap-12">
          {children}
        </div>
      </div>
    </div>
  );
}
