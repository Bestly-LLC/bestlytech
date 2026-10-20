/**
 * /b/:code - Jared's tap when someone is at the building callbox.
 *
 * Ava is holding the visitor on the line; the short link lands on Jared's phone. One screen, no scrolling: who is there
 * (what they said), a live countdown, then two huge buttons. Runs only inside the signed-in admin (AdminRoute sends a signed-out
 * visit to passkey login and back here). Polls callbox_event_get every 2 s while pending so a decision made elsewhere shows up.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, DoorOpen, Loader2, Clock, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { AdminMark } from "@/components/AdminMark";
import { Lines } from "@/components/Lines";
import { cn } from "@/lib/utils";

type EventStatus = "pending" | "open" | "deny" | "expired" | "done";
type CallboxEvent = {
  ok: boolean; reason?: "sign_in" | "not_found"; code?: string; status?: EventStatus; visitor_said?: string | null;
  caller?: string | null; known_callbox?: boolean | null; created_at?: string; expires_at?: string;
};
type Phase = "idle" | "sending" | "opened" | "denied";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

const CSS = `
.cb-in { animation: cb-in 360ms cubic-bezier(0.2, 0.9, 0.3, 1) both; }
@keyframes cb-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
.cb-pop { animation: cb-pop 480ms cubic-bezier(0.3, 1.5, 0.5, 1) both; }
@keyframes cb-pop { from { opacity: 0; transform: scale(0.5) } to { opacity: 1; transform: none } }
.cb-draw { stroke-dasharray: 30; stroke-dashoffset: 30; animation: cb-draw 340ms 200ms ease-out forwards; }
@keyframes cb-draw { to { stroke-dashoffset: 0 } }
.cb-press { transition: transform 110ms ease, opacity 150ms ease, background-color 150ms ease; }
.cb-press:active:not(:disabled) { transform: scale(0.97); }
.cb-glow { animation: cb-glow 2.4s ease-in-out infinite; }
@keyframes cb-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.0), 0 0 44px 8px rgba(255,255,255,0.10) } 50% { box-shadow: 0 0 0 0 rgba(255,255,255,0.0), 0 0 64px 18px rgba(255,255,255,0.0) } }
@media (prefers-reduced-motion: reduce) {
  .cb-in, .cb-pop, .cb-glow { animation: none !important }
  .cb-draw { animation: none; stroke-dashoffset: 0 }
  .cb-press { transition: none }
}
`;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function CallboxTap() {
  const { code: raw = "" } = useParams();
  const code = raw.toLowerCase();
  const { bento } = useAdminTheme();
  const [ev, setEv] = useState<CallboxEvent | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await rpc("callbox_event_get", { p_code: code });
    if (error) {
      setLoadErr(error.message.includes("admin only") ? "This is only for the Bestly admin." : "Couldn't open this. Check your connection and reload.");
      return;
    }
    const r = data as CallboxEvent | null;
    if (!r?.ok) {
      setLoadErr(r?.reason === "sign_in" ? "Sign in to the Bestly admin to answer the door." : "That link isn't valid.");
      return;
    }
    setLoadErr(null);
    setEv(r);
  }, [code]);

  useEffect(() => { void load(); }, [load]);

  const status: EventStatus = ev?.status ?? "pending";

  // Poll every 2 s while pending, so an answer from anywhere else shows here. Stops the moment it is decided.
  useEffect(() => {
    if (!ev || status !== "pending" || phase !== "idle") return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 2000);
    return () => window.clearInterval(t);
  }, [ev, status, phase, load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const left = ev?.expires_at ? Math.max(0, Math.floor((Date.parse(ev.expires_at) - now) / 1000)) : 0;
  const total = ev?.expires_at && ev.created_at ? Math.max(1, (Date.parse(ev.expires_at) - Date.parse(ev.created_at)) / 1000) : 60;
  const live = !!ev && status === "pending" && left > 0;
  const showRemember = ev?.known_callbox === false;

  const decide = async (open: boolean) => {
    if (!ev || !live || busy.current) return;
    busy.current = true;
    setMsg(null);
    setPhase("sending");
    try {
      try { navigator.vibrate?.(12); } catch { /* no haptics here */ }
      const { data, error } = await rpc("callbox_decide", { p_code: code, p_open: open, p_remember: remember });
      const d = data as { ok: boolean; reason?: string; status?: string } | null;
      if (error) { setPhase("idle"); setMsg("That didn't go through. Tap again."); return; }
      if (!d?.ok) {
        setPhase("idle");
        if (d?.reason === "expired") setEv((e) => (e ? { ...e, status: "expired" } : e));
        else if (d?.reason === "already") void load();
        else setMsg("That didn't go through. Tap again.");
        if (d?.reason === "not_found") setLoadErr("That link isn't valid.");
        return;
      }
      setPhase(open ? "opened" : "denied");
    } finally {
      busy.current = false;
    }
  };

  const shell = cn("admin-shell flex min-h-dvh flex-col text-white", bento ? "admin-bento bg-[#F3F2EE]" : "bg-black");
  const safeTop = { paddingTop: "max(env(safe-area-inset-top), 16px)" };

  if (loadErr) {
    return (
      <div className={shell} style={safeTop}>
        <style>{CSS}</style>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-5 text-center" role="alert">
          <AlertCircle className="h-10 w-10 text-white/60" aria-hidden />
          <h1 className="mt-5 text-[1.5rem] font-semibold tracking-[-0.02em]">Can't open this</h1>
          <p className="mt-2 text-[1.0625rem] leading-relaxed text-white/60"><Lines>{loadErr}</Lines></p>
          <Link to="/admin" className="cb-press mt-8 flex h-[3.25rem] w-full items-center justify-center rounded-2xl bg-white text-[1.0625rem] font-semibold text-black">Open the admin</Link>
        </main>
      </div>
    );
  }
  if (!ev) {
    return (
      <div className={shell}>
        <main className="grid flex-1 place-items-center" aria-busy="true" aria-label="Opening the callbox request">
          <Loader2 className="h-6 w-6 animate-spin text-white/50" aria-hidden />
        </main>
      </div>
    );
  }

  // ----- result and already-decided states (centered, one message, one button) -----
  const expired = phase === "idle" && (status === "expired" || (status === "pending" && left <= 0));
  let done: { good: boolean; title: string; body: string } | null = null;
  if (phase === "opened") done = { good: true, title: "Ava's letting them in", body: "You can close this." };
  else if (phase === "denied") done = { good: false, title: "Ava will tell them no", body: "You can close this." };
  else if (expired) done = { good: false, title: "Too late", body: "Nobody answered in time, so Ava took a message." };
  else if (phase === "idle" && status === "open") done = { good: true, title: "Already opened", body: "Ava's letting them in." };
  else if (phase === "idle" && status === "deny") done = { good: false, title: "Already sent off", body: "Ava told them no." };
  else if (phase === "idle" && status === "done") done = { good: true, title: "All done", body: "This one was already handled." };

  if (done) {
    return (
      <div className={shell} style={safeTop}>
        <style>{CSS}</style>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-5 text-center" aria-live="polite">
          <div className={cn("cb-pop grid h-24 w-24 place-items-center rounded-full", done.good ? "bg-emerald-500/15 text-emerald-400 bento:text-emerald-600" : "bg-white/10 text-white/70 bento:text-black/60")}>
            {done.good ? (
              <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path className="cb-draw" d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : phase === "denied" || status === "deny" ? <X className="h-11 w-11" aria-hidden /> : <Clock className="h-11 w-11" aria-hidden />}
          </div>
          <h1 className="mt-6 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] [text-wrap:balance]">{done.title}</h1>
          <p className="mt-2 max-w-[19rem] text-[1.0625rem] leading-relaxed text-white/60"><Lines>{done.body}</Lines></p>
        </main>
        <footer className="mx-auto w-full max-w-sm px-5 pt-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}>
          <Link to="/admin" className="cb-press flex h-[3.25rem] w-full items-center justify-center rounded-2xl bg-white text-[1.0625rem] font-semibold text-black">Done</Link>
        </footer>
      </div>
    );
  }

  // ----- the decision -----
  const said = ev.visitor_said?.trim();
  const sending = phase === "sending";
  const pct = Math.min(100, Math.max(0, (left / total) * 100));

  return (
    <div className={shell} style={safeTop}>
      <style>{CSS}</style>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col px-5">
        <header className="pt-3 text-center">
          <AdminMark label="Bestly Admin" className="mx-auto h-9 w-9" />
          <h1 className="mt-3 text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.025em] [text-wrap:balance]">Someone's at the callbox</h1>
        </header>

        <section className="cb-in mt-5" aria-label="Who is at the door">
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 bento:border-white/5 bento:bg-[#fff]">
            <p className="text-[0.8125rem] font-medium text-white/65">What they said</p>
            <p className={cn("mt-1.5 break-words text-[1.25rem] leading-snug", said ? "font-medium" : "text-white/70")}>
              {said ? `“${said}”` : "They didn't say who."}
            </p>
          </div>

          <div className="mt-4 px-1" role="timer" aria-live="off" aria-label={`${mmss(left)} left to answer`}>
            <div className="flex items-baseline justify-between text-[0.9375rem]">
              <span className="text-white/65">Ava is holding the line</span>
              <span className="whitespace-nowrap text-[1.125rem] font-semibold tabular-nums">{mmss(left)} left</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10 bento:bg-black/10">
              <div className="h-full rounded-full bg-white/80 bento:bg-black/70 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </section>
        <div className="flex-1" />
      </main>

      <footer
        className="sticky bottom-0 mx-auto w-full max-w-sm bg-gradient-to-t from-black via-black/95 to-black/0 px-5 pt-6 bento:from-[#F3F2EE] bento:via-[#F3F2EE]/95 bento:to-[#F3F2EE]/0"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}
      >
        <p className="min-h-[1.25rem] pb-1 text-center text-[0.9375rem] text-red-400 bento:text-red-600" role={msg ? "alert" : undefined}><Lines>{msg}</Lines></p>
        <button type="button" onClick={() => decide(true)} disabled={!live || sending}
          className="cb-press cb-glow flex h-[5.5rem] w-full items-center justify-center gap-3 rounded-3xl bg-white text-[1.5rem] font-semibold text-black disabled:opacity-40">
          {sending ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden /> : <DoorOpen className="h-7 w-7" aria-hidden />}
          Open the door
        </button>
        <button type="button" onClick={() => decide(false)} disabled={!live || sending}
          className="cb-press mt-3 flex h-[4.5rem] w-full items-center justify-center rounded-3xl bg-white/[0.10] text-[1.25rem] font-semibold text-white disabled:opacity-40 bento:bg-black/[0.07] bento:text-black">
          Send them off
        </button>
        {showRemember && (
          <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center gap-2.5 text-[0.9375rem] text-white/75 bento:text-black/70">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 rounded accent-white bento:accent-black" />
            This number is my building's callbox
          </label>
        )}
      </footer>
    </div>
  );
}
