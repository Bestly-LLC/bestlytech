/**
 * Calendar status for personal Ava, shared by the Calendars card and every "Find times" button.
 * One fetch serves all readers (a message list can hold dozens of buttons): cached for 30 seconds, refreshed every minute while
 * something is watching, and right away after the Calendars card changes anything (CAL_EVENT).
 * The edge function only ever returns names, tick marks, hours and the last check result. Logins never leave Vault.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CalProvider = "nextcloud" | "icloud";
export type CalFound = { id: string; href: string; name: string; writable: boolean };
export type CalCheck = { at: string; ok: boolean; last_ok_at?: string | null; error?: string };
export type CalHours = { start: number; end: number; days: number[] };
export type CalProviderStatus = { connected: boolean; calendars: CalFound[]; checked: CalCheck | null; shared_login?: boolean };
export type CalStatus = {
  nextcloud: CalProviderStatus; icloud: CalProviderStatus; selected: string[]; book_to: string | null; hours: CalHours; turo_window_min: number;
  find_times: { ok: boolean; reason: string | null };
};

export const CAL_EVENT = "ava-cal-changed";
export const calChanged = () => { try { window.dispatchEvent(new Event(CAL_EVENT)); } catch { /* no window */ } };

type Store = { status: CalStatus | null; error: string | null; at: number; subs: Set<() => void>; timer: ReturnType<typeof setInterval> | null; inflight: boolean };
const store: Store = { status: null, error: null, at: 0, subs: new Set(), timer: null, inflight: false };

async function refresh(force = false) {
  if (store.inflight || (!force && Date.now() - store.at < 30_000 && store.status)) return;
  store.inflight = true;
  try {
    const { data, error } = await supabase.functions.invoke("ava-assistant", { body: { action: "cal_status" } });
    if (error || !data?.ok) { store.error = "Couldn't read the calendar settings."; }
    else { store.status = data as CalStatus; store.error = null; }
  } catch { store.error = "Couldn't read the calendar settings."; }
  store.at = Date.now(); store.inflight = false;
  store.subs.forEach((f) => f());
}

export function useCalStatus(): { status: CalStatus | null; error: string | null; reload: () => void } {
  const [, force] = useState(0);
  useEffect(() => {
    const sub = () => force((n) => n + 1);
    store.subs.add(sub);
    void refresh();
    if (!store.timer) store.timer = setInterval(() => { if (!document.hidden) void refresh(true); }, 60_000);
    const onChange = () => void refresh(true);
    window.addEventListener(CAL_EVENT, onChange);
    return () => {
      store.subs.delete(sub); window.removeEventListener(CAL_EVENT, onChange);
      if (store.subs.size === 0 && store.timer) { clearInterval(store.timer); store.timer = null; }
    };
  }, []);
  return { status: store.status, error: store.error, reload: () => void refresh(true) };
}
