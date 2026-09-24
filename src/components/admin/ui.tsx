/**
 * Command Center primitives: one card, one section header, one row, one pill, one disclosure.
 * Apple grouped-list look (laxUi.tsx tokens: 22px cards, 13px caps headers, 44px touch targets)
 * built on the white/black utilities, so the light "bento" theme swaps them on its own:
 *   bg-white/[0.03] + rounded-2xl becomes a white card, text-white/60 becomes ink at 60%.
 * Spacing is an 8pt grid: 8 between header and card, 16/24 inset, 32 between sections.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { tint } from "@/pages/admin/laxUi";

export { btnPrimary, btnTinted, btnPlain, tint } from "@/pages/admin/laxUi";

/** Visible keyboard focus, iOS blue. Add `focus-visible:ring-inset` on full-bleed rows. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF] bento:focus-visible:ring-[#007AFF]";

/** The one card. rounded-2xl + bg-white/[0.03] are what the bento theme keys on; keep both. */
export const cardCls = "rounded-2xl [border-radius:22px] border border-white/[0.08] bg-white/[0.03]";
/** Card inset: 16 on phones, 24 from sm. Rows use the same numbers so text lines up. */
export const inset = "px-4 sm:px-6";
export const divider = "divide-y divide-white/[0.06]";
export const hairline = "border-white/[0.06]";

/** Type scale (iOS: body 15, footnote 13, title 22). */
export const text = {
  title: "text-[15px] font-medium leading-snug text-white",
  detail: "text-[13px] leading-snug text-white/60",
  meta: "text-[13px] tabular-nums text-white/60",
  stat: "text-[22px] font-semibold leading-tight tabular-nums text-white",
};

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(cardCls, className)} {...rest}>{children}</div>;
}

/** iOS grouped-list header: small caps above the card, optional short aside on the right. */
export function SectionHeader({ id, title, aside, icon }: { id?: string; title: ReactNode; aside?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={cn("mb-2 flex min-h-9 items-center justify-between gap-3", inset)}>
      <h2 id={id} className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white/60">
        {icon}
        {title}
      </h2>
      {aside && <div className="flex shrink-0 items-center gap-1 text-[13px] tabular-nums text-white/60">{aside}</div>}
    </div>
  );
}

/** A list row: 44px minimum, card inset. */
export const rowCls = cn("flex min-h-[44px] items-center gap-3 py-3", inset);
const rowLinkCls = cn(rowCls, "group w-full transition-colors hover:bg-white/[0.04] focus-visible:ring-inset", focusRing);

/** A row that goes somewhere: internal route, external URL, or nowhere (plain row). */
export function RowLink({ href, children, className, label }: { href?: string | null; children: ReactNode; className?: string; label?: string }) {
  const chevron = <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition-colors group-hover:text-white/70" aria-hidden />;
  if (!href) return <div className={cn(rowCls, className)}>{children}</div>;
  if (/^https?:/i.test(href)) {
    return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={cn(rowLinkCls, className)}>{children}{chevron}</a>;
  }
  return <Link to={href} aria-label={label} className={cn(rowLinkCls, className)}>{children}{chevron}</Link>;
}

type PillTone = "neutral" | "red" | "orange" | "green" | "blue";
const PILL: Record<PillTone, string> = {
  neutral: "bg-white/[0.08] text-white/75",
  red: "bg-[#FF453A26] text-[#FF6961] bento:bg-[#FF3B301f] bento:text-[#D70015]",
  orange: "bg-[#FF9F0A26] text-[#FF9F0A] bento:bg-[#FF95001f] bento:text-[#C93400]",
  green: "bg-[#30D15826] text-[#30D158] bento:bg-[#34C7591f] bento:text-[#248A3D]",
  blue: "bg-[#0A84FF26] text-[#409CFF] bento:bg-[#007AFF1a] bento:text-[#007AFF]",
};

/** Always words inside, so color is never the only signal. */
export function Pill({ tone = "neutral", children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4", PILL[tone], className)}>
      {children}
    </span>
  );
}

/** Icon-only button: 44px on touch, 36px from sm. `label` is required and becomes aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  ({ label, className, children, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50 sm:h-9 sm:w-9",
        focusRing,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";

/**
 * "Show all" / "Hide" control. `footer` sits full width at the bottom of a card;
 * `inline` sits under a section as plain blue text.
 */
export function Disclosure({ open, onToggle, controls, children, variant = "footer", className }: {
  open: boolean; onToggle: () => void; controls?: string; children: ReactNode; variant?: "footer" | "inline"; className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium transition-opacity hover:opacity-80",
        tint.blue,
        variant === "footer" ? cn("w-full justify-center border-t focus-visible:ring-inset", hairline, inset) : "rounded-md sm:min-h-9",
        focusRing,
        className,
      )}
    >
      <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      {children}
    </button>
  );
}

/** "Couldn't load X · Retry" in its own spot, never read as zero or healthy. */
export function LoadError({ label, onRetry, busy, detail, message }: {
  label: string; onRetry: () => void; busy?: boolean; detail?: string | null;
  /** Replaces "Couldn't load {label}" when the failure was a save, not a load. */
  message?: string;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-white/80">
      <AlertTriangle className={cn("h-4 w-4 shrink-0", tint.orange)} aria-hidden />
      <span title={detail ?? undefined}>{message ?? `Couldn't load ${label}`}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        aria-label={`Retry loading ${label}`}
        className={cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-1 font-medium disabled:opacity-60 sm:min-h-9", tint.blue, focusRing)}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
        {busy ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

/** Loading placeholder rows inside a card. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className={cn(cardCls, divider, "overflow-hidden")} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn(rowCls, "flex-col items-start gap-2")}>
          <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}
