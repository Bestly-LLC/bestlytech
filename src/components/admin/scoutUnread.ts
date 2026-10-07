import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Scout's unread dots (2026-10-06, Jared: "if I have unread messages from Scout in chat have a purple dot with
 * normal things waiting for me, and orange for urgent or needs follow-up from me").
 *
 *   purple  = Scout wrote something he hasn't read, or a normal Needs-you item is waiting
 *   orange  = it needs him: an unread reply that asks him something, a Mac job waiting for Run, or an urgent item
 *
 * Unread is `admin_chat_thread_list.unread` (assistant messages after the thread's read_at); `needs_you` comes from
 * the same view. The list is polled once for the whole page (the launcher, the History list and the phone tab bar
 * all read the same store), every 30 s and whenever the tab comes back into view.
 */

export const SCOUT_ORANGE = "#FF9F0A"; // Apple orange: needs you
export const SCOUT_PURPLE = "#BF5AF2"; // Apple purple: waiting, nothing urgent

export type ScoutDotColor = "orange" | "purple" | null;

export interface UnreadThread {
  id: string;
  unread: number;
  needs_you: boolean;
}

const POLL_MS = 30_000;

let threads: UnreadThread[] = [];
let subs = 0;
let timer: number | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function refreshScoutUnread() {
  const { data, error } = await supabase
    .from("admin_chat_thread_list" as any)
    .select("id, unread, needs_you")
    .or("unread.gt.0,needs_you.eq.true")
    .limit(100);
  if (error) return; // a failed read is not "nothing unread": keep what we had
  threads = ((data ?? []) as unknown as UnreadThread[]).map((r) => ({
    id: r.id,
    unread: Number(r.unread) || 0,
    needs_you: !!r.needs_you,
  }));
  emit();
}

const onVisible = () => document.visibilityState === "visible" && void refreshScoutUnread();

function start() {
  void refreshScoutUnread();
  timer = window.setInterval(() => void refreshScoutUnread(), POLL_MS);
  document.addEventListener("visibilitychange", onVisible);
}
function stop() {
  window.clearInterval(timer);
  document.removeEventListener("visibilitychange", onVisible);
}

/** Tell the server he has seen this thread, then re-read the list so the dot clears at once. */
export async function markScoutThreadRead(id: string) {
  const { error } = await (supabase.rpc as any)("admin_chat_mark_read", { p_thread: id });
  if (error) return;
  // Clear it locally first so the dot doesn't wait for the round trip.
  if (threads.some((t) => t.id === id)) {
    threads = threads.filter((t) => t.id !== id);
    emit();
  }
  void refreshScoutUnread();
}

/**
 * Unread Scout threads. `open` only triggers an extra refresh when the panel opens or closes
 * (same pattern as useNeedsYou); the polling itself is shared.
 */
export function useScoutUnread(open: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (subs++ === 0) start();
    return () => {
      listeners.delete(l);
      if (--subs === 0) stop();
    };
  }, []);
  useEffect(() => {
    void refreshScoutUnread();
  }, [open]);
  const refresh = useCallback(() => refreshScoutUnread(), []);
  return {
    threads,
    anyUnread: threads.some((t) => t.unread > 0),
    anyNeedsYou: threads.some((t) => t.needs_you),
    refresh,
  };
}

/** The one color rule: anything that needs him wins, otherwise anything waiting, otherwise no dot. */
export function scoutDotColor(o: {
  anyNeedsYou: boolean;
  urgent: number;
  pendingJobs: number;
  anyUnread: boolean;
  normalWaiting: number;
}): ScoutDotColor {
  if (o.anyNeedsYou || o.urgent > 0 || o.pendingJobs > 0) return "orange";
  if (o.anyUnread || o.normalWaiting > 0) return "purple";
  return null;
}

/* The finished color is published by <Scout/> (it already holds the Needs-you rows and Mac jobs) so the phone tab
   bar can show the same dot without polling any of it a second time. */
let dot: ScoutDotColor = null;
const dotListeners = new Set<() => void>();

export function publishScoutDot(c: ScoutDotColor) {
  if (c === dot) return;
  dot = c;
  dotListeners.forEach((l) => l());
}

export function useScoutDot(): ScoutDotColor {
  return useSyncExternalStore(
    (l) => {
      dotListeners.add(l);
      return () => dotListeners.delete(l);
    },
    () => dot,
    () => null,
  );
}

export const dotHex = (c: ScoutDotColor) => (c === "orange" ? SCOUT_ORANGE : c === "purple" ? SCOUT_PURPLE : undefined);
