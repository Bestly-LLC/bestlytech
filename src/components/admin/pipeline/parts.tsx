/** Small shared pieces for the Pipeline page: ring gauge, load states, section frame. */
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MISSING_TEXT } from "./lib";

export function Ring({ value, of, size = 84, stroke = 7, tone = "text-sky-400", children, label }: {
  value: number; of?: number; size?: number; stroke?: number; tone?: string; children?: ReactNode; label: string;
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const frac = of && of > 0 ? Math.max(0, Math.min(1, value / of)) : value > 0 ? 1 : 0;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-white/10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={cn("stroke-current motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700 motion-safe:ease-out", tone)}
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center">{children}</span>
    </span>
  );
}

export function Section({ title, hint, aside, children }: { title: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-white">{title}</h2>
          {hint && <p className="mt-0.5 text-[14px] text-white/60">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const Panel = ({ children, className }: { children: ReactNode; className?: string }) =>
  <div className={cn("rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 sm:p-5", className)}>{children}</div>;

export const Skeleton = ({ h = 120 }: { h?: number }) =>
  <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" style={{ height: h }} aria-hidden />;

/** Loading, "not set up yet" and error states in one place. Renders children when there is data. */
export function Gate({ loading, missing, error, hasData, h, onRetry, children }: {
  loading: boolean; missing: boolean; error: string | null; hasData: boolean; h?: number; onRetry?: () => void; children: ReactNode;
}) {
  if (hasData) return <>{children}{error && <p role="status" className="mt-2 text-[13px] text-amber-200/90">{error}</p>}</>;
  if (loading) return <Skeleton h={h} />;
  if (missing) return <Panel><p className="text-[15px] text-white/65">{MISSING_TEXT}</p></Panel>;
  return (
    <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
      <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error ?? "Couldn't load this."}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Try again</button>}
    </div>
  );
}

/** Nothing-yet text that is still useful. */
export const Empty = ({ children }: { children: ReactNode }) => <p className="py-2 text-[15px] text-white/60">{children}</p>;

export const btn = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium transition-[background-color,transform] duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50 disabled:active:scale-100 motion-reduce:active:scale-100";
export const btnQuiet = `${btn} bg-white/10 text-white hover:bg-white/15`;
export const btnMain = `${btn} bg-sky-400 text-black hover:bg-sky-300`;
