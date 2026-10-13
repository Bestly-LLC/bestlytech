import { useCallback, useEffect, useRef, useState } from "react";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";

/** A number and its unit never split: join with a no-break space. */
export const NBSP = " ";
const TZ = "America/Los_Angeles";

/** "3:05 PM" in Pacific time. */
export const time12 = (iso: string | null | undefined, none = "none scheduled") => iso
  ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/\s(AM|PM)/, `${NBSP}$1`)
  : none;
/** "Oct 12, 3:05 PM" in Pacific time. */
export const stamp = (iso: string | null | undefined, none = "never") => iso
  ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/\s(AM|PM)/, `${NBSP}$1`)
  : none;
/** Day label for the funnel axis: "Oct 12". Dates arrive as yyyy-mm-dd and are read as plain calendar days. */
export const dayLabel = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, dd)));
};
export const pct = (p: number | null | undefined) => p == null ? "–" : `${Math.round(p * 100)}%`;

type ErrLike = { message?: string; code?: string } | null;
/** The backend RPC isn't deployed yet (or not visible): show a calm message, not an error. */
export const isMissing = (e: unknown) => {
  const x = e as ErrLike;
  return !!x && (x.code === "PGRST202" || x.code === "42883" || /could not find the function|does not exist/i.test(x.message ?? ""));
};
export const errText = (e: unknown, fallback = "Couldn't finish that. Try again in a minute.") => {
  const m = (e as ErrLike)?.message;
  return m && !/^(JWT|FetchError|TypeError)/.test(m) && m.length < 160 ? m : fallback;
};

export type Load<T> = { data: T | null; loading: boolean; missing: boolean; error: string | null; reload: () => Promise<void> };

/**
 * Loads one RPC, then refreshes it every 60 seconds while the tab is visible. Never clears data on a failed poll (the last good value stays),
 * and `hold()` lets a save pause polling so a refresh can't overwrite what was just written.
 */
export function usePipelineRpc<T>(fn: string, args?: Record<string, unknown>, every = 60000): Load<T> & { hold: (on: boolean) => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writes = useRef(0);
  const argKey = JSON.stringify(args ?? {});
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    const { data: d, error: e } = await rpcArgs<T>(fn, JSON.parse(argKey));
    if (my !== seq.current || writes.current > 0) return;
    setLoading(false);
    if (e) {
      if (isMissing(e)) { setMissing(true); setError(null); } else setError(errText(e, "Couldn't refresh this. The last numbers are still showing."));
      return;
    }
    setMissing(false); setError(null); setData(d);
  }, [fn, argKey]);

  useEffect(() => {
    setLoading(true);
    void reload();
    const t = setInterval(() => { if (!document.hidden) void reload(); }, every);
    const vis = () => { if (!document.hidden) void reload(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [reload, every]);

  const hold = useCallback((on: boolean) => { writes.current += on ? 1 : -1; }, []);
  return { data, loading, missing, error, reload, hold };
}

/** A calm inline note for "this part isn't switched on yet" and for failed loads. */
export const MISSING_TEXT = "This part is being set up and will appear here as soon as it is ready.";

/** Fit may arrive as 0 to 1 or 0 to 100; show it as 0 to 100 either way. */
export const fit100 = (n: number | null | undefined) => n == null ? null : Math.round(n <= 1 ? n * 100 : n);
