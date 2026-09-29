/**
 * When the phone key won't come: say so in plain words and hand the guest ONE button that asks the trip helper
 * to fix it (the helper can make or re-send the key). Used by the Home page key card and the Pickup sheet.
 */
import { useEffect, useState } from "react";
import { IdCard, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";
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

/** Key held until the host confirms the license and finishes the car check-in: say why, and what the guest can do. */
export type KeyHold = { license?: boolean; checkin?: boolean };
export const holdTitle = (h: KeyHold) => h.license ? "Upload your driver's license" : "Your host is getting the car ready";
export const holdSub = (h: KeyHold) => h.license
  ? "Do it in the Turo app if you haven't yet. Your key shows up here once your host checks it."
  : "Your key shows up here by itself as soon as the car is ready.";

export function KeyHoldNote({ hold, accent }: { hold: KeyHold; accent?: string }) {
  const c = accent ?? "var(--trip-accent, #FFB878)";
  return (
    <div className="space-y-2.5">
      {hold.license && (
        <div className="flex gap-3 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10">
          <IdCard className="mt-0.5 h-6 w-6 shrink-0" style={{ color: c }} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold text-white">Upload your driver's license</p>
            <p className="mt-0.5 text-[14px] leading-snug text-white/70">Haven't yet? Open the <b className="text-white">Turo app</b>, go to this trip, and add your license. Already did it? You're all set.</p>
          </div>
        </div>
      )}
      <div className="flex gap-3 rounded-2xl p-3 ring-1 ring-white/10">
        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold text-white">{hold.license ? "Then your host checks it" : "Your host is getting the car ready"}</p>
          <p className="mt-0.5 text-[14px] leading-snug text-white/70">Your host checks your license and preps the car. Your key button shows up right here by itself. No need to refresh.</p>
        </div>
      </div>
    </div>
  );
}
