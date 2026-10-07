/**
 * Shared bits for the Reviews (Stella) and Maintenance (Mae) tabs on /admin/turo.
 * Rules (docs/admin-ui-conventions.md): rem only, 12-hour Pacific times, US units, and a number never
 * wraps away from its unit. Tables and RPCs are new, so calls go through the same `as never` cast the other Turo pages use.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
export const well = "rounded-xl bg-white/[0.04] bento:bg-[var(--bento-well)]";
export const pill = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-opacity disabled:opacity-40 active:opacity-80";
export const pillPrimary = `${pill} bg-white text-black bento:bg-[#111114] bento:text-[#fff]`;
export const pillSecondary = `${pill} bg-white/[0.08] text-white bento:bg-[#0000000d] bento:text-[#111]`;
export const fieldCls = "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base text-white outline-none placeholder:text-white/55 focus-visible:ring-2 focus-visible:ring-white/40 bento:bg-[var(--bento-well)] bento:border-white/5";
export const muted = "text-white/60";

export type RpcResult = { data: unknown; error: { message: string } | null };
export const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<RpcResult>;

const LA = "America/Los_Angeles";
/** Keep a value and its unit on one line. */
export const nb = (s: string) => s.replace(/ /g, " ");

/** "Sep 27" for a date-only string (a calendar date, not an instant). */
export function dayOnly(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return nb(new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
}

/** "Oct 7, 10:00 AM" in Pacific time, 12-hour. */
export function whenLA(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  const day = dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: LA });
  const time = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: LA });
  return `${nb(day)}, ${nb(time)}`;
}

export function agoText(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 2) return "just now";
  if (mins < 90) return nb(`${mins} min ago`);
  const h = Math.round(mins / 60);
  if (h < 36) return nb(`${h} hr ago`);
  return nb(`${Math.round(h / 24)} days ago`);
}

/** Load an admin RPC once, refresh on a timer, and expose load/error so the tab can show Retry. */
export function useAdminRpc<T>(fn: string, everyMs = 60000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data: d, error: e } = await rpc(fn);
    if (e) setError(e.message);
    else { setData(d as T); setError(null); }
  }, [fn]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, everyMs);
    return () => window.clearInterval(t);
  }, [load, everyMs]);
  return { data, setData, error, load };
}

/** Run one write: disable while it runs, toast what happened, and treat an RPC error as a failure. */
export async function act<T = unknown>(busySet: (k: string | null) => void, key: string, fn: string, args: Record<string, unknown>, ok: string): Promise<T | null> {
  busySet(key);
  const { data, error } = await rpc(fn, args);
  busySet(null);
  if (error) { toast.error(error.message); return null; }
  toast.success(ok);
  return data as T;
}

export async function copyText(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); }
  catch { toast.error("Copy failed. Select the text and copy it by hand."); }
}

/** Stars as words + icons so meaning never rests on colour. */
export function starsLabel(n: number | null | undefined) {
  return n == null ? "No rating" : `${n} out of 5 stars`;
}
