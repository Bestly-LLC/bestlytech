/**
 * Shared pieces for the Settlements page (Nickel): the RPC caller, date helpers and small display components.
 * The settlement RPCs are not in the generated Supabase types, so they are called through a narrow cast.
 */
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { secondary, tint } from "./laxUi";

export type RpcResult<T> = { data: T | null; error: { message: string } | null };
export const rpc = <T,>(fn: string, args?: object) =>
  (supabase.rpc as unknown as (f: string, a?: object) => Promise<RpcResult<T>>)(fn, args);

export const TZ = "America/Los_Angeles";
export const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const shortDay = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" }) : "";
export const shortTime = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }) : "";
export const todayLA = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
export const daysUntil = (ymd: string) => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${todayLA()}T00:00:00Z`)) / 864e5);
export const dayFromYmd = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** Keeps every dollar amount in one piece so the number never wraps away from its sign or cents. */
export function Nb({ text }: { text: string }) {
  const parts = text.split(/(\$\s?[\d,]+(?:\.\d+)?)/g);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}

export function DeadlineChip({ ymd }: { ymd: string | null }) {
  if (!ymd) return <span className={cn("text-[13px]", secondary)}>No deadline listed</span>;
  const n = daysUntil(ymd);
  const left = n < 0 ? "passed" : n === 0 ? "today" : `${n} ${n === 1 ? "day" : "days"} left`;
  return (
    <span className={cn("text-[13px]", n <= 3 ? tint.orange : secondary)}>
      Deadline <span className="whitespace-nowrap">{dayFromYmd(ymd)}</span> · <span className="whitespace-nowrap">{left}</span>
    </span>
  );
}

export function ClassDefinition({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <details className="group mt-3">
      <summary className={cn("flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-[14px] font-medium sm:min-h-0", tint.blue)}>
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden /> Who counts as a class member
      </summary>
      <p className={cn("mt-1 whitespace-pre-wrap rounded-xl bg-[#ffffff0d] px-3 py-2.5 text-[14px] leading-snug bento:bg-[#0000000a]", secondary)}><Nb text={text} /></p>
    </details>
  );
}

/** "3 settlements" with the number and unit kept together. */
export const count = (n: number, one: string, many = `${one}s`) => <span className="whitespace-nowrap">{n} {n === 1 ? one : many}</span>;
