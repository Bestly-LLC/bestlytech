/**
 * The debriefs waiting on Jared.
 *
 * Reads call_debrief_list() on load, again whenever the table changes (realtime), every 2 minutes
 * while the tab is visible, and whenever the tab comes back to the front. If the server function
 * does not exist yet (or says this is not an admin) nothing is ever shown and nothing is thrown:
 * the hook simply reports `ready: false` and checks again in 10 minutes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { debriefApi } from "./api";
import type { DebriefRow } from "./types";

const POLL_MS = 120_000;
const RETRY_MISSING_MS = 600_000;

/** "Not now" snoozes are remembered here too, so a reload inside the hour does not bring the pop-up straight back. */
const SNOOZE_KEY = "bestly.debrief.snooze.v1";
export const SNOOZE_MS = 60 * 60 * 1000;

function readSnoozes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    const o = raw ? (JSON.parse(raw) as unknown) : null;
    if (!o || typeof o !== "object") return {};
    const now = Date.now();
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === "number" && v > now) out[k] = v;
    return out;
  } catch {
    return {};
  }
}
function writeSnoozes(s: Record<string, number>) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)); } catch { /* private mode: this tab still remembers */ }
}

export function useCallDebriefs() {
  const [rows, setRows] = useState<DebriefRow[] | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [snoozes, setSnoozes] = useState<Record<string, number>>(readSnoozes);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const retryAt = useRef(0);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    if (Date.now() < retryAt.current) return;
    inFlight.current = true;
    try {
      // A signed-out tab would only fill the logs with permission errors.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const r = await debriefApi.list();
      if (!alive.current) return;
      if (r.ok === true) {
        setRows(r.data);
        setAvailable(true);
        retryAt.current = 0;
      } else if (r.missing || r.forbidden) {
        // The feature is not switched on yet, or this is not an admin: stay hidden, look again later.
        setAvailable(false);
        setRows(null);
        retryAt.current = Date.now() + RETRY_MISSING_MS;
      }
      // Any other failure keeps what we had: a failed read is not "nothing is waiting".
    } catch {
      /* never crash the admin over this */
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();

    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    // Realtime is the fast path; the poll above covers a table that is not published yet.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel("call-debriefs")
        .on("postgres_changes" as never, { event: "*", schema: "public", table: "call_debriefs" } as never, () => { void refresh(); })
        .subscribe();
    } catch {
      channel = null;
    }

    return () => {
      alive.current = false;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (channel) { try { void supabase.removeChannel(channel); } catch { /* already gone */ } }
    };
  }, [refresh]);

  /** Hide a debrief for an hour (this browser), and mark it so the pop-up does not come back early. */
  const snoozeLocal = useCallback((id: string) => {
    setSnoozes((cur) => {
      const next = { ...readSnoozes(), ...cur, [id]: Date.now() + SNOOZE_MS };
      writeSnoozes(next);
      return next;
    });
  }, []);
  const unsnoozeLocal = useCallback((id: string) => {
    setSnoozes((cur) => {
      const next = { ...readSnoozes(), ...cur };
      delete next[id];
      writeSnoozes(next);
      return next;
    });
  }, []);

  // When the nearest snooze runs out, look again so the pop-up comes back on time.
  const nextWake = useMemo(() => {
    const times: number[] = [];
    for (const v of Object.values(snoozes)) times.push(v);
    for (const r of rows ?? []) {
      const t = r.remindAt ? Date.parse(r.remindAt) : NaN;
      if (Number.isFinite(t)) times.push(t);
    }
    const future = times.filter((t) => t > Date.now());
    return future.length ? Math.min(...future) : null;
  }, [rows, snoozes]);
  useEffect(() => {
    if (nextWake == null) return;
    const wait = Math.min(2_147_000_000, Math.max(1_000, nextWake - Date.now() + 500));
    const t = window.setTimeout(() => setTick((n) => n + 1), wait);
    return () => window.clearTimeout(t);
  }, [nextWake]);

  /** Pending debriefs, newest call first. */
  const pending = useMemo(() => {
    const at = (r: DebriefRow) => Date.parse(r.stoppedAt ?? r.startedAt ?? r.createdAt ?? "") || 0;
    return (rows ?? []).filter((r) => r.status === "pending").sort((a, b) => at(b) - at(a));
  }, [rows]);

  /** Pending and not snoozed right now: the ones that may pop up on their own. */
  const due = useMemo(() => {
    const now = Date.now();
    return pending.filter((r) => {
      const local = snoozes[r.id];
      if (local && local > now) return false;
      const server = r.remindAt ? Date.parse(r.remindAt) : NaN;
      return !(Number.isFinite(server) && server > now);
    });
    // `tick` makes this re-run when a snooze expires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, snoozes, tick]);

  return { rows, pending, due, available: available === true, loaded: available !== null, refresh, snoozeLocal, unsnoozeLocal };
}
