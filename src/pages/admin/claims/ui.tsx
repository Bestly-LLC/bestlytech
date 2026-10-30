/** Small shared pieces for the Claims page: media query hook, panels, disclosure rows, status dots. */
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { card, label, pill, secondary, tint } from "../laxUi";

/** True when the viewport matches. Used to pick the sheet side and split view vs. push navigation. */
export function useMediaQuery(query: string) {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}
/** Tailwind's lg breakpoint: split view above, iOS-style push navigation below. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

export function Dot({ tone = "orange", className }: { tone?: "orange" | "green" | "gray"; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full",
    tone === "orange" && "bg-[#FF9F0A] bento:bg-[#E36A00]", tone === "green" && "bg-[#30D158] bento:bg-[#34C759]",
    tone === "gray" && "bg-[#8E8E93]", className)} />;
}

/** The orange "Your call" marker used on list rows and headers. */
export function YourCallPill({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold", pill.orange, className)}><Dot />Your call</span>;
}

/** A card with a 17px semibold title. `tone="orange"` rings it for the things that wait on Jared. */
export function Panel({ title, aside, tone, className, children }: { title?: ReactNode; aside?: ReactNode; tone?: "orange"; className?: string; children: ReactNode }) {
  return (
    <section className={cn(card, "p-4 sm:p-5", tone === "orange" && "ring-[#FF9F0A66] bento:ring-[#C9340055]", className)}>
      {(title || aside) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className={cn("text-[17px] font-semibold", label)}>{title}</h3>
          {aside}
        </div>
      )}
      <div className={title || aside ? "mt-3" : undefined}>{children}</div>
    </section>
  );
}

/**
 * A native <details> with a chevron that turns. `row` is a full-width line in a grouped list (48px tall, easy to hit on a phone);
 * `inline` is a quiet text link that opens a small form under a block.
 */
export function Disclosure({ title, onToggle, variant = "row", children }: { title: ReactNode; onToggle?: (open: boolean) => void; variant?: "row" | "inline"; children: ReactNode }) {
  const row = variant === "row";
  return (
    <details className="group" onToggle={onToggle ? (e) => onToggle((e.target as HTMLDetailsElement).open) : undefined}>
      <summary className={cn("flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]",
        row ? cn("min-h-[48px] px-4 py-2 text-[15px] font-medium", label) : cn("min-h-[44px] text-[13px] font-medium sm:min-h-[36px]", tint.blue))}>
        <span className="min-w-0">{title}</span>
        <ChevronRight aria-hidden className={cn("h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none", secondary)} />
      </summary>
      <div className={row ? "px-4 pb-4 pt-1" : "pb-1 pt-1"}>{children}</div>
    </details>
  );
}

/** Label above, value below (value never splits a number from its unit: wrap the number in whitespace-nowrap yourself). */
export function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={cn("text-[13px]", secondary)}>{name}</dt>
      <dd className={cn("mt-0.5 text-[15px] leading-snug", label)}>{children}</dd>
    </div>
  );
}

export const Nw = ({ children }: { children: ReactNode }) => <span className="whitespace-nowrap">{children}</span>;
