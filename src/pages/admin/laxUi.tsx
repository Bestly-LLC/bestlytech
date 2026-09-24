/**
 * Apple-style building blocks for the LAX Parking Pass admin page (and its cards).
 * iOS system colors, grouped-inset sections, 44px touch targets. Colors are hex on purpose:
 * the admin light ("bento") theme swaps white/black utilities, so fixed colors must be literal.
 *   dark:  surface #1C1C1E · label #FFF · secondary #EBEBF5/60% · separator #38383A · blue #0A84FF
 *   light: surface #FFF    · label #000 · secondary #3C3C43/60% · separator #C6C6C8 · blue #007AFF
 */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A grouped card (iOS inset-grouped list cell). */
export const card =
  "rounded-[22px] bg-[#1C1C1E] p-5 ring-1 ring-[#ffffff0f] bento:bg-[#fff] bento:ring-[#0000000a] bento:shadow-[0_1px_2px_#0000000d]";

/** Text roles. */
export const label = "text-[#fff] bento:text-[#000]";
export const secondary = "text-[#EBEBF599] bento:text-[#3C3C4399]";
export const tertiary = "text-[#EBEBF54d] bento:text-[#3C3C434d]";
export const separator = "divide-[#38383A] bento:divide-[#C6C6C8]";

/** Buttons: one filled primary per view; tinted secondary; plain text. All ≥ 44px tall on touch. */
const base =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-[transform,opacity,background-color] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#000] bento:focus-visible:ring-offset-[#fff] sm:min-h-[36px]";
export const btnPrimary = cn(base, "bg-[#0A84FF] text-[#fff] hover:bg-[#409CFF] bento:bg-[#007AFF] bento:text-[#fff] bento:hover:bg-[#0062CC]");
export const btnTinted = cn(base, "bg-[#0A84FF26] text-[#409CFF] hover:bg-[#0A84FF33] bento:bg-[#007AFF1a] bento:text-[#007AFF] bento:hover:bg-[#007AFF26]");
export const btnPlain = "inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-[#409CFF] hover:opacity-80 active:opacity-60 bento:text-[#007AFF] sm:min-h-0";
export const btnDestructivePlain = "inline-flex min-h-[44px] items-center gap-1.5 text-[13px] font-medium text-[#FF453A] hover:opacity-80 bento:text-[#FF3B30] sm:min-h-0";

/** Text fields (iOS: filled, no hard border). */
export const field =
  "w-full rounded-[12px] bg-[#2C2C2E] px-3.5 py-2.5 text-[16px] text-[#fff] placeholder:text-[#EBEBF54d] outline-none ring-0 transition focus:bg-[#3A3A3C] focus:ring-2 focus:ring-[#0A84FF] sm:text-[15px] bento:bg-[#7676801f] bento:text-[#000] bento:placeholder:text-[#3C3C434d] bento:focus:bg-[#7676802e] bento:focus:ring-[#007AFF]";

/** Status tints (never color alone: always paired with an icon + words). */
export const tint = {
  green: "text-[#30D158] bento:text-[#248A3D]",
  orange: "text-[#FF9F0A] bento:text-[#C93400]",
  red: "text-[#FF453A] bento:text-[#D70015]",
  blue: "text-[#409CFF] bento:text-[#007AFF]",
};
export const pill = {
  green: "bg-[#30D15826] text-[#30D158] bento:bg-[#34C7591f] bento:text-[#248A3D]",
  orange: "bg-[#FF9F0A26] text-[#FF9F0A] bento:bg-[#FF95001f] bento:text-[#C93400]",
  blue: "bg-[#0A84FF26] text-[#409CFF] bento:bg-[#007AFF1a] bento:text-[#007AFF]",
};

/** A grouped section: small header above, optional footnote below (like Settings.app). */
export function Section({ title, footer, id, className, children }: { title: string; footer?: ReactNode; id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cn("scroll-mt-24 space-y-2", className)}>
      <h2 className={cn("px-4 text-[13px] font-semibold uppercase tracking-[0.02em]", secondary)}>{title}</h2>
      <div className="space-y-3">{children}</div>
      {footer && <p className={cn("px-4 text-[13px] leading-snug", secondary)}>{footer}</p>}
    </section>
  );
}

/** iOS segmented control. */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex w-full rounded-[10px] bg-[#7676803d] p-[2px] sm:w-auto bento:bg-[#7676801f]">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn("min-h-[36px] flex-1 rounded-[8px] px-4 text-[13px] font-semibold transition-colors duration-150 sm:flex-none",
            value === o.value
              ? "bg-[#636366] text-[#fff] shadow-[0_3px_8px_#0000001f] bento:bg-[#fff] bento:text-[#000]"
              : "text-[#fff] bento:text-[#000]")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** iOS switch (a real checkbox underneath, so it's keyboard + screen-reader friendly). */
export function Switch({ checked, onChange, label: text, detail, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; detail?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className={cn("flex min-h-[44px] cursor-pointer items-center justify-between gap-4 py-2", disabled && "cursor-not-allowed opacity-50")}>
      <span className="min-w-0">
        <span className={cn("block text-[15px]", label)}>{text}</span>
        {detail && <span className={cn("mt-0.5 block text-[13px] leading-snug", secondary)}>{detail}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-[31px] w-[51px] rounded-full bg-[#39393D] transition-colors duration-200 peer-checked:bg-[#30D158] peer-focus-visible:ring-2 peer-focus-visible:ring-[#0A84FF] bento:bg-[#E9E9EA] bento:peer-checked:bg-[#34C759]" />
        <span className="pointer-events-none absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-[#fff] shadow-[0_3px_8px_#00000026,0_3px_1px_#0000000f] transition-transform duration-200 peer-checked:translate-x-[20px]" />
      </span>
    </label>
  );
}

/** A sheet (card window) over a dimmed page. Esc or the scrim closes it. */
export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-[#00000080] backdrop-blur-[2px] animate-in fade-in duration-200" />
      <div className="relative flex max-h-[88dvh] w-full flex-col rounded-t-[22px] bg-[#1C1C1E] shadow-[0_20px_60px_#00000080] ring-1 ring-[#ffffff14] animate-in slide-in-from-bottom-6 fade-in duration-200 sm:max-w-lg sm:rounded-[22px] bento:bg-[#F2F2F7] bento:ring-[#0000000f]">
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
          <span className="w-14" />
          <h3 className={cn("text-[17px] font-semibold", label)}>{title}</h3>
          <button type="button" onClick={onClose} className={cn(btnPlain, "w-14 justify-end font-semibold")} autoFocus>Done</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="border-t border-[#38383A] px-5 py-3 bento:border-[#C6C6C8]">{footer}</div>}
      </div>
    </div>
  );
}
