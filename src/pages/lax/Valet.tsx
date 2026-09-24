/**
 * "Unlock & Start" from the trip page (valet-style backup to the phone key).
 * Shown only after the guest's own Tesla phone key is confirmed on the car (tesla_guest_keys = accepted), from 30 min
 * before pickup to the end of the trip, and only after the guest accepts the terms once (trip_consents, versioned).
 * Tap → the car unlocks and allows driving for 2 minutes without a key (Tesla remote start). Every use pings the host.
 * Server: trip_valet_state / trip_valet_consent / trip_unlock_start → worker action unlock_start (door_unlock + remote_start_drive).
 */
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldAlert, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { track } from "./track";

const ACCENT = "var(--trip-accent)";
const VERSION = "2026-09-24-valet";
const rpc = (fn: string, args: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
type St = { ok: boolean; enabled?: boolean; key_confirmed?: boolean | null; consented_at?: string | null; window?: boolean };

export function UnlockStart({ token, demo }: { token?: string; demo?: boolean }) {
  const [st, setSt] = useState<St | null>(demo ? { ok: true, enabled: true, key_confirmed: true, consented_at: null, window: true } : null);
  const [terms, setTerms] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // The 2-minute driving window: counts down on the button (kept across a reload in this tab).
  const WIN = 120e3;
  const uKey = `valet-until:${token ?? "demo"}`;
  const [until, setUntil] = useState<number>(() => { try { return Number(sessionStorage.getItem(uKey) || 0); } catch { return 0; } });
  const [now, setNow] = useState(() => Date.now());
  const [closed, setClosed] = useState(false);
  const left = Math.max(0, until - now);
  const active = left > 0;
  useEffect(() => {
    if (!until || Date.now() >= until) return;
    const id = window.setInterval(() => { const t = Date.now(); setNow(t); if (t >= until) { window.clearInterval(id); setClosed(true); } }, 250);
    return () => window.clearInterval(id);
  }, [until]);
  const startWindow = () => { const u = Date.now() + WIN; setUntil(u); setNow(Date.now()); setClosed(false); try { sessionStorage.setItem(uKey, String(u)); } catch { /* ignore */ } };
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
    if (active) return;
    setBusy(true); setMsg(null); setClosed(false);
    try {
      if (demo) { await new Promise((r) => setTimeout(r, 1500)); startWindow(); return; }
      const { data } = await rpc("trip_unlock_start", { p_token: token });
      const r = data as { ok: boolean; id?: number; error?: string } | null;
      if (!r?.ok || !r.id) { setMsg(r?.error ?? "Couldn't reach the car."); return; }
      track(token, "unlock_start");
      for (let i = 0; i < 45; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const { data: j } = await rpc("lax_guest_car_job", { p_token: token, p_id: r.id });
        const job = j as { status: string; stage?: string | null; result?: { error?: string } } | null;
        if (job?.stage) setMsg(job.stage);
        if (job?.status === "done") { setMsg(null); startWindow(); return; }
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
      {active ? (
        // During the window: pressed-in, greyed out, counting down, with a bar draining inside the button.
        <div role="timer" aria-live="polite" aria-label={`Driving window: ${Math.ceil(left / 1000)} seconds left`}
          className="relative flex min-h-[52px] w-full cursor-not-allowed items-center justify-center gap-2 overflow-hidden rounded-2xl bg-white/[0.08] text-[16px] font-bold text-white/80 shadow-[inset_0_3px_8px_rgba(0,0,0,.55)] ring-1 ring-white/10">
          <span aria-hidden className="absolute inset-y-0 left-0 bg-emerald-400/20" style={{ width: `${(left / WIN) * 100}%`, transition: "width 250ms linear" }} />
          <KeyRound className="relative h-5 w-5" />
          <span className="relative tabular-nums">Unlocked · drive within {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}</span>
        </div>
      ) : (
        <button type="button" onClick={() => (st.consented_at ? void go() : setTerms(true))} disabled={busy}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#1A1140] shadow-lg shadow-black/25 active:scale-[0.99] disabled:opacity-60" style={{ background: ACCENT }}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />} {busy ? "Unlocking…" : closed ? "Unlock & Start again" : "Unlock & Start"}
        </button>
      )}
      <p className="mt-1.5 px-1 text-[12px] text-white/60">
        {active ? <>Press the brake and shift into Drive before the timer ends{demo ? " (Demo)" : ""}.</>
          : closed ? "The 2-minute window ended. If nobody drove off, lock the car in the Tesla app. Tap to start a new window."
          : "Unlocks the car and starts the same 2-minute driving window: hand it to the valet, or get in and go."}
      </p>
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
              <li><b className="text-white">Only approved drivers may drive.</b> That's you, and anyone Turo approved as an extra driver on this trip. A parking valet may move and park the car for you. Letting anyone else drive breaks Turo's terms and can void your protection plan.</li>
              <li><b className="text-white">It unlocks the car and lets it drive for 2 minutes without a key.</b> Only tap it when you or the valet are at the car. If you walk away, lock it in the Tesla app or on this page.</li>
              <li><b className="text-white">You're responsible for the car</b> from the moment it's unlocked, the same as with your phone key: damage, tickets, tolls and fees follow Turo's rules for your trip.</li>
              <li>Each use is logged (time and your trip) and your host is told.</li>
            </ul>
            <div className="sticky -bottom-5 -mx-5 mt-4 bg-[linear-gradient(180deg,transparent,rgba(18,16,34,.96)_18%)] px-5 pb-5 pt-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--trip-accent)]" />
              <span className="text-[14px] leading-snug">I'm an approved driver on this Turo trip. I'll only use this at the car or to hand it to a parking valet, I won't let unapproved people drive, and I accept responsibility for the car while it's unlocked.</span>
            </label>
            <button type="button" onClick={() => void accept()} disabled={!agree}
              className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-[#1A1140] disabled:opacity-40" style={{ background: ACCENT }}>
              <KeyRound className="h-5 w-5" /> I agree: Unlock &amp; Start
            </button>
            <p className="mt-2 text-center text-[11px] text-white/50">Your Tesla phone key still works as usual. This is a backup.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
