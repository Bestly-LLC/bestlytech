/**
 * When the phone key won't come: say so in plain words and hand the guest ONE button that asks the trip helper
 * to fix it (the helper can make or re-send the key). Used by the Home page key card and the Pickup sheet.
 */
import { useEffect, useState } from "react";
import { ShieldAlert, Wrench } from "lucide-react";
import { track } from "./track";

export const KEY_FIX_Q = "My Tesla key isn't showing up. Can you fix it?";

/** True once `on` has stayed true for `ms` without a break (a key that is "being made" for too long is stuck). */
export function useStuck(on: boolean, ms: number) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!on) { setStuck(false); return; }
    const t = window.setTimeout(() => setStuck(true), ms);
    return () => window.clearTimeout(t);
  }, [on, ms]);
  return stuck;
}

/** Opens the trip helper and sends this question for the guest (AskSheet listens for "trip-ask"). */
export function askHelper(q: string) {
  window.dispatchEvent(new CustomEvent("trip-ask", { detail: q }));
  try { window.location.hash = "#ask"; } catch { /* ignore */ }
}

export function KeyHelp({ slow, accent }: { slow: boolean; accent?: string }) {
  return (
    <div>
      <p className="flex items-start gap-2 text-[15px] leading-relaxed text-white/85">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        {slow ? "Still making your key. This is taking longer than it should." : "Your key isn't ready yet."}
      </p>
      <button type="button" onClick={() => { track(undefined, "ask"); askHelper(KEY_FIX_Q); }}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#132726] shadow-lg shadow-black/30 active:scale-[0.99]"
        style={{ background: accent ?? "var(--trip-accent, #FFB878)" }}>
        <Wrench className="h-5 w-5" aria-hidden /> Fix it for me
      </button>
      <p className="mt-2 text-[13px] leading-snug text-white/65">The trip helper tries again right now. Still stuck? Message your host in the Turo app.</p>
    </div>
  );
}
