/**
 * Is a call being recorded right now?
 *
 * The one live signal the browser can read is the recorder's own status row (the Mac mini reports it
 * every few seconds). While it says "recording", a debrief must not pop over the call Jared is on:
 * the host shows a quiet toast instead and opens the debrief when the call ends.
 *
 * It only looks while `enabled` (a debrief is waiting); with nothing waiting there is nothing to hold
 * back, so it costs nothing. A heartbeat that has gone quiet counts as "not live" so a crashed recorder
 * can never keep a debrief hidden.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const POLL_MS = 15_000;
/** The Mac skips a few beats while it is busy recording; give it three minutes before we stop believing it. */
const STALE_AFTER_S = 180;

export function useCallLive(enabled: boolean): boolean {
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!enabled) { setLive(false); return; }
    let alive = true;
    const look = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data, error } = await supabase.from("meeting_recorder_status" as never).select("status, seconds_since").maybeSingle();
        if (!alive || error) return; // a failed read changes nothing
        const row = data as { status?: string; seconds_since?: number | null } | null;
        // No heartbeat age is the same as no heartbeat (ScoutRecorder reads it that way too).
        const fresh = row?.seconds_since != null && row.seconds_since <= STALE_AFTER_S;
        setLive(row?.status === "recording" && fresh);
      } catch {
        /* the recorder view may not be readable: then nothing is ever held back */
      }
    };
    void look();
    const t = window.setInterval(() => { if (!document.hidden) void look(); }, POLL_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, [enabled]);

  return live;
}
