/**
 * Building blocks for the Wall admin (grouped inset lists, Apple HIG): Group, Row, Segmented, button styles.
 * Shared by src/pages/admin/Wall.tsx and its section components (WallR4.tsx) so every card looks the same.
 */
import { cn } from "@/lib/utils";

/* ───────── building blocks (grouped inset list, Apple style) ───────── */

/** `id` makes the group a deep-link target (#id); scroll-mt clears the sticky admin header. */
export function Group({ id, title, footer, children }: { id?: string; title?: string; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-2">
      {title && <h3 className="px-4 text-[13px] font-medium uppercase tracking-[0.06em] text-white/50">{title}</h3>}
      <div className="overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10">{children}</div>
      {footer && <p className="px-4 text-[13px] leading-snug text-white/50">{footer}</p>}
    </section>
  );
}

export function Row({ label, detail, children, htmlFor, dim }: { label: React.ReactNode; detail?: React.ReactNode; children?: React.ReactNode; htmlFor?: string; dim?: boolean }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 border-b border-white/[0.07] px-4 py-2.5 last:border-b-0">
      <div className={cn("min-w-0 flex-1", dim && "opacity-50")}>
        <label htmlFor={htmlFor} className="block text-[16px] text-white">{label}</label>
        {detail && <div className="mt-0.5 text-[13px] text-white/50">{detail}</div>}
      </div>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, compact }: {
  value: T; options: { id: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string;
  /** Tighter padding and 13 pt text so 4-5 options fit a 390 pt phone without wrapping. */
  compact?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full gap-1 rounded-xl bg-white/[0.07] p-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
            className={cn(
              "flex min-h-[40px] min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors duration-150 touch-manipulation",
              compact ? "px-1 text-[13px] sm:px-2 sm:text-[14px]" : "px-2 text-[14px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
              on ? "bg-white text-black shadow-sm" : "text-white/75 hover:text-white",
            )}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const btn =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium text-white ring-1 ring-white/15 " +
  "transition-colors duration-150 hover:bg-white/[0.06] active:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40";

/** The one filled button in a section (Apple: one primary action per group). */
export const btnPrimary =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-white px-4 text-[16px] font-semibold text-black " +
  "transition-colors duration-150 hover:bg-white/90 active:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40 touch-manipulation";

/** Grows a 44x24 switch's tap area to 44 pt tall without changing how it looks. */
export const swHit = "relative after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']";

/** Keeps a number with its unit, or a time with AM/PM, on one line. */
export const NW = ({ children }: { children: React.ReactNode }) => <span className="whitespace-nowrap">{children}</span>;

