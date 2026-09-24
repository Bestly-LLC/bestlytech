/**
 * "Unlock & Start" from the trip page (valet-style backup to the phone key).
 * Shown only after the guest's own Tesla phone key is confirmed on the car (tesla_guest_keys = accepted), from 30 min
 * before pickup to the end of the trip, and only after the guest accepts the terms once (trip_consents, versioned).
 * Tap → the car unlocks and allows driving for 2 minutes without a key (Tesla remote start). Every use pings the host.
 * Server: trip_valet_state / trip_valet_consent / trip_unlock_start → worker action unlock_start (door_unlock + remote_start_drive).
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, ShieldAlert, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { track } from "./track";

const ACCENT = "var(--trip-accent)";
const VERSION = "2026-09-24";
const rpc = (fn: string, args: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
type St = { ok: boolean; enabled?: boolean; key_confirmed?: boolean | null; consented_at?: string | null; window?: boolean };

export function UnlockStart({ token, demo }: { token?: string; demo?: boolean }) {
  const [st, setSt] = useState<St | null>(demo ? { ok: true, enabled: true, key_confirmed: true, consented_at: null, window: true } : null);
  const [terms, setTerms] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const load = useCallback(async () => {
    if (demo || !token) return;
    const { data } = await rpc("trip_valet_state", { p_token: token });
    setSt(data as St);
  }, [token, demo]);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 60000); return () => window.clearInterval(id); }, [load]);

  if (!st?.ok || !st.enabled || !st.window) return null;
  if (!st.key_confirmed) return (
    <p className="mt-3 flex items-start gap-2 rounded-2xl bg-white/[0.04] p-3 text-[12px] leading-snug text-white/60 ring-1 ring-white/10">
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0" /> Unlock &amp; Start shows up here once your phone key is added to the car.
    </p>
  );

  const go = async () => {
    setBusy(true); setMsg(null); setReady(false);
    try {
      if (demo) { await new Promise((r) => setTimeout(r, 1500)); setReady(true); return; }
      const { data } = await rpc("trip_unlock_start", { p_token: token });
      const r = data as { ok: boolean; id?: number; error?: string } | null;
      if (!r?.ok || !r.id) { setMsg(r?.error ?? "Couldn't reach the car."); return; }
      track(token, "unlock_start");
      for (let i = 0; i < 45; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const { data: j } = await rpc("lax_guest_car_job", { p_token: token, p_id: r.id });
        const job = j as { status: string; stage?: string | null; result?: { error?: string } } | null;
        if (job?.stage) setMsg(job.stage);
        if (job?.status === "done") { setMsg(null); setReady(true); return; }
        if (job?.status === "failed") { setMsg(job.result?.error ?? "The car didn't respond. Use your Tesla app."); return; }
      }
      setMsg("The car is taking a while. Use your Tesla app to unlock.");
    } finally { setBusy(false); }
  };
  const accept = async () => {
    if (!agree) return;
    if (!demo && token) {
      const { data } = await rpc("trip_valet_consent", { p_token: token, p_version: VERSION, p_ua: navigator.userAgent });
      if (!(data as { ok?: boolean } | null)?.ok) { setMsg("Couldn't save that. Try again."); return; }
    }
    setSt((s) => (s ? { ...s, consented_at: new Date().toISOString() } : s));
    setTerms(false);
    void go();
  };

  return (
    <div className="mt-3">
      <button type="button" onClick={() => (st.consented_at ? void go() : setTerms(true))} disabled={busy}
        className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#1A1140] shadow-lg shadow-black/25 active:scale-[0.99] disabled:opacity-60" style={{ background: ACCENT }}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />} {busy ? "Unlocking…" : "Unlock & Start"}
      </button>
      <p className="mt-1.5 px-1 text-[12px] text-white/60">Backup if your phone key is slow. The car unlocks and you have 2 minutes to press the brake and drive.</p>
      {ready && <p className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-400/15 p-2.5 text-[14px] font-semibold text-emerald-100" aria-live="polite"><CheckCircle2 className="h-5 w-5" /> Unlocked. Press the brake and shift within 2 minutes.{demo ? " (Demo)" : ""}</p>}
      {msg && <p className="mt-2 text-[13px] text-white/75" aria-live="polite">{msg}</p>}

      {terms && (
        <div className="fixed inset-0 z-[70] grid place-items-end p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="valet-title">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTerms(false)} />
          <div className="trip-glass trip-glass-dark trip-pop-in relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-[28px] p-5 text-white">
            <button type="button" onClick={() => setTerms(false)} aria-label="Close"
              className="absolute right-0 top-0 z-[2] grid h-[60px] w-[60px] place-items-center rounded-bl-[30px] bg-white/[0.10] pb-1 pl-1 text-white/85"><X className="h-[18px] w-[18px]" strokeWidth={2.5} /></button>
            <span className="grid h-11 w-11 place-items-center rounded-full bg-amber-300/20"><ShieldAlert className="h-6 w-6 text-amber-200" /></span>
            <h2 id="valet-title" className="mt-3 pr-12 text-[21px] font-bold leading-tight">Before you use Unlock &amp; Start</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] leading-snug text-white/85">
              <li><b className="text-white">Only approved drivers may drive.</b> That's you, and anyone Turo approved as an extra driver on this trip. Letting anyone else drive breaks Turo's terms and can void your protection plan.</li>
              <li><b className="text-white">It unlocks the car and lets it drive for 2 minutes without a key.</b> Only tap it when you're standing at the car. If you walk away, lock it in the Tesla app or on this page.</li>
              <li><b className="text-white">You're responsible for the car</b> from the moment it's unlocked, the same as with your phone key: damage, tickets, tolls and fees follow Turo's rules for your trip.</li>
              <li>Each use is logged (time and your trip) and your host is told.</li>
            </ul>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--trip-accent)]" />
              <span className="text-[14px] leading-snug">I'm an approved driver on this Turo trip. I'll only use this at the car, I won't let unapproved people drive, and I accept responsibility for the car while it's unlocked.</span>
            </label>
            <button type="button" onClick={() => void accept()} disabled={!agree}
              className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#1A1140] disabled:opacity-40" style={{ background: ACCENT }}>
              <KeyRound className="h-5 w-5" /> I agree: Unlock &amp; Start
            </button>
            <p className="mt-2 text-center text-[11px] text-white/50">Your Tesla phone key still works as usual. This is a backup.</p>
          </div>
        </div>
      )}
    </div>
  );
}
