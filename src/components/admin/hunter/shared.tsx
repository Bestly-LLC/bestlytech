/**
 * Small pieces shared by Hunter's pages (overview, Jev card, score screen).
 * House rules baked in: a number never wraps away from its unit (NB), times are 12-hour, nothing is cut off with "...".
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const NB = " ";

/** "Oct 11, 3:05 PM" (12-hour, AM/PM glued to the time). */
export const when = (iso: string | null | undefined, never = "never") => iso
  ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/\s(AM|PM)/, `${NB}$1`)
  : never;

/** Keeps "11 AM", "62 %", "180 ms" from splitting across lines inside free text. */
export const glue = (t: string) => t
  .replace(/(\d(?:\s*(?:AM|PM))?)\s+(to|and)\s+(\d)/g, `$1${NB}$2${NB}$3`)   // "8 to 11 AM" stays on one line
  .replace(/(\d)\s+(AM|PM|ms|mi|ft|mph|min|sec|hr)\b/g, `$1${NB}$2`);

export function Stat({ label, value, warn, hint }: { label: string; value: number | string | undefined; warn?: boolean; hint?: string }) {
  return (
    <div className={cn("rounded-2xl px-3 py-3 ring-1", warn ? "bg-orange-500/10 ring-orange-500/30" : "bg-white/[0.04] ring-white/10")}>
      <div className={cn("text-[26px] font-semibold leading-none tabular-nums", warn ? "text-orange-300" : "text-white")}>{value ?? "–"}</div>
      <div className={cn("mt-1.5 text-[12px] leading-snug", warn ? "text-orange-200" : "text-white/60")}>{label}</div>
      {hint && <div className="mt-0.5 text-[12px] leading-snug text-white/55">{hint}</div>}
    </div>
  );
}

export function Card({ title, hint, children, aside }: { title: string; hint?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h2 className="text-[17px] font-semibold text-white">{title}</h2>
        {aside}
      </div>
      {hint && <p className="mt-1 text-[14px] leading-relaxed text-white/65">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function NumberField({ label, value, min, max, onSave, suffix }: { label: string; value: number; min: number; max: number; onSave: (n: number) => void; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) { setV(String(value)); toast.error(`${label} must be ${min} to ${max}.`); return; }
    if (n !== value) onSave(n);
  };
  return (
    <label className="flex items-center justify-between gap-3 text-[15px] text-white/85">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="h-11 w-20 rounded-xl bg-white/[0.06] px-3 text-right text-[15px] tabular-nums text-white outline-none ring-1 ring-white/10 focus:ring-white/30"
          aria-label={label} />
        {suffix && <span className="whitespace-nowrap text-[13px] text-white/60">{suffix}</span>}
      </span>
    </label>
  );
}
