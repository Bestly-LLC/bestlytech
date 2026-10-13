/**
 * /y/:code - Jared's tap on an Ava request (docs/ava-fix-issues-opusplan.md, Phase B).
 *
 * Ava asked on a call; she can't approve anything herself. This page is where the approval really happens: it runs only inside the
 * signed-in admin (AdminRoute sends a signed-out visit to passkey login and back here), and Approve needs a fresh Face ID every time
 * (webauthn-authenticate approval_options / approval_verify, user verification required). Only then does ava_approval_decide let the
 * action through, and this page runs it exactly the way the Fix Ladder's "Yes, do it" does: admin-chat as Jared, not autopilot.
 *
 * One screen, one decision: what will run, who asked, when it expires, then Approve or No.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ChevronDown, Clock, Loader2, ScanFace, ShieldCheck, Undo2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { confirmApprovalWithPasskey } from "@/lib/passkey";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { AdminMark } from "@/components/AdminMark";
import { cn } from "@/lib/utils";

type Approval = {
  code: string; kind: "approve" | "undo"; title: string; action_text: string; action_plain: string; action_hash: string;
  status: "pending" | "approved" | "running" | "done" | "failed" | "declined" | "expired";
  created_at: string; expires_at: string; seconds_left: number; from_call: boolean; selftest: boolean; stale: boolean;
  thread_id: string | null; result: string | null;
};
type Phase = "idle" | "tap" | "deciding" | "starting" | "running" | "finished" | "failed" | "declined";

const TZ = "America/Los_Angeles";
const clock = (iso: string | number) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const PREFIX = "Yes, do it: ";

/** sha256 hex of the text, the same bytes the database hashed when Ava made the request. */
async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const REFUSED: Record<string, string> = {
  expired: "This request expired. Ask Ava again.",
  used: "This request was already used.",
  declined: "You already said no to this one.",
  mismatch: "This request changed while it was open. Reload it and read it again.",
  no_tap: "The Face ID tap didn't register in time. Tap Approve again.",
  changed: "That fix changed since Ava asked, so it was dropped. Ask Ava again.",
  selftest: "This is a test request. Nothing runs from it.",
  not_found: "That request link isn't valid.",
};

const CSS = `
.ava-in { animation: ava-in 360ms cubic-bezier(0.2, 0.9, 0.3, 1) both; }
@keyframes ava-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
.ava-pop { animation: ava-pop 480ms cubic-bezier(0.3, 1.5, 0.5, 1) both; }
@keyframes ava-pop { from { opacity: 0; transform: scale(0.5) } to { opacity: 1; transform: none } }
.ava-draw { stroke-dasharray: 30; stroke-dashoffset: 30; animation: ava-draw 340ms 200ms ease-out forwards; }
@keyframes ava-draw { to { stroke-dashoffset: 0 } }
.ava-press { transition: transform 110ms ease, opacity 150ms ease, background-color 150ms ease; }
.ava-press:active:not(:disabled) { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) {
  .ava-in, .ava-pop { animation: none !important }
  .ava-draw { animation: none; stroke-dashoffset: 0 }
  .ava-press { transition: none }
}
`;

export default function AvaApprove() {
  const { code: raw = "" } = useParams();
  const code = raw.toLowerCase();
  const { bento } = useAdminTheme();
  const [ap, setAp] = useState<Approval | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const run = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("ava_approval_get" as never, { p_code: code } as never);
    if (error) { setLoadErr(error.message.includes("admin only") ? "This request is only for the Bestly admin." : "Couldn't open that request. Check your connection and reload."); return; }
    const r = data as unknown as { ok: boolean; approval?: Approval };
    if (!r?.ok || !r.approval) { setLoadErr("That request link isn't valid."); return; }
    setLoadErr(null);
    setAp(r.approval);
    if (r.approval.status === "declined") setPhase("declined");
  }, [code]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const left = ap ? Math.max(0, Math.floor((Date.parse(ap.expires_at) - now) / 1000)) : 0;
  const mins = Math.ceil(left / 60);
  const status = ap?.status ?? "pending";
  const live = !!ap && status === "pending" && left > 0 && !ap.stale && !ap.selftest;
  const busy = phase === "tap" || phase === "deciding" || phase === "starting";
  const undo = ap?.kind === "undo";
  const exact = useMemo(() => (ap ? ap.action_text.replace(PREFIX, "") : ""), [ap]);

  const approve = async () => {
    if (!ap || !live || run.current) return;
    run.current = true;
    setMsg(null);
    try {
      // 1. a fresh Face ID for THIS request (never reused, never just the signed-in session)
      setPhase("tap");
      const problem = await confirmApprovalWithPasskey(ap.code);
      if (problem === "cancelled") { setPhase("idle"); return; }
      if (problem) { setPhase("idle"); setMsg(problem); return; }
      // 2. the database checks the tap is fresh, ours, and that what we show is what was asked
      setPhase("deciding");
      const hash = await sha256Hex(ap.action_text);
      const { data, error } = await supabase.rpc("ava_approval_decide" as never, { p_code: ap.code, p_decision: "approve", p_hash: hash } as never);
      const d = data as unknown as { ok: boolean; reason?: string; action_text?: string; thread_id?: string } | null;
      if (error || !d?.ok || !d.action_text) {
        setPhase("idle");
        setMsg(REFUSED[d?.reason ?? ""] ?? "That didn't go through. Try again.");
        void load();
        return;
      }
      // 3. run it the way the Fix Ladder's "Yes, do it" does: Scout as Jared, with his admin session
      setPhase("starting");
      try { navigator.vibrate?.(12); } catch { /* no haptics here */ }
      void supabase.rpc("ava_approval_started" as never, { p_code: ap.code } as never);
      const job = supabase.functions.invoke("admin-chat", {
        body: { body: d.action_text, thread_id: d.thread_id ?? null, page: { path: "/y", title: "Ava request", heading: "", about: `Ava asked by phone and Jared approved with Face ID: ${ap.title}` } },
      });
      const early = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
      if (early && early.error) {
        await supabase.rpc("ava_approval_finished" as never, { p_code: ap.code, p_ok: false, p_note: "Scout didn't start" } as never);
        setPhase("failed");
        return;
      }
      setPhase("running");
      void job.then(async (res) => {
        const ok = !res.error;
        await supabase.rpc("ava_approval_finished" as never, { p_code: ap.code, p_ok: ok, p_note: ok ? "Scout finished" : "Scout stopped early" } as never);
        setPhase(ok ? "finished" : "failed");
      });
    } finally {
      run.current = false;
    }
  };

  const decline = async () => {
    if (!ap || busy) return;
    setPhase("deciding");
    const { data } = await supabase.rpc("ava_approval_decide" as never, { p_code: ap.code, p_decision: "decline", p_hash: null } as never);
    const d = data as unknown as { ok: boolean; reason?: string } | null;
    if (d?.ok) setPhase("declined");
    else { setPhase("idle"); setMsg(REFUSED[d?.reason ?? ""] ?? "That didn't go through. Try again."); void load(); }
  };

  // ----- what to say when it can't be approved -----
  const blocked =
    !ap ? null
    : phase === "declined" || status === "declined" ? { tone: "quiet", title: "You said no", body: "Nothing ran. Ask Ava again if you change your mind." }
    : ap.selftest ? { tone: "quiet", title: "Test request", body: "This one is Ava's hourly self-check. Nothing runs from it." }
    : ap.stale && status === "pending" ? { tone: "warn", title: "This changed", body: "The fix is different from when Ava asked, so it was dropped. Ask her again." }
    : status === "expired" || (status === "pending" && left <= 0) ? { tone: "warn", title: "This expired", body: "Requests last 10 minutes. Ask Ava again." }
    : (status === "approved" || status === "running" || status === "done" || status === "failed") && phase === "idle" ? { tone: "quiet", title: "Already used", body: status === "failed" ? "Your tap went through but Scout didn't start. Use Yes, do it in the admin." : "This request was already approved. Ava can tell you how it went." }
    : null;

  const shell = cn("admin-shell flex min-h-dvh flex-col text-white", bento ? "admin-bento bg-[#F3F2EE]" : "bg-black");

  if (loadErr) {
    return (
      <div className={shell} style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}>
        <style>{CSS}</style>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-5 text-center" role="alert">
          <AlertCircle className="h-10 w-10 text-white/60" aria-hidden />
          <h1 className="mt-5 text-[1.5rem] font-semibold tracking-[-0.02em]">Can't open this</h1>
          <p className="mt-2 text-[1.0625rem] leading-relaxed text-white/60">{loadErr}</p>
          <Link to="/admin" className="ava-press mt-8 flex h-[3.25rem] w-full items-center justify-center rounded-2xl bg-white text-[1.0625rem] font-semibold text-black">Open the admin</Link>
        </main>
      </div>
    );
  }
  if (!ap) {
    return (
      <div className={shell}>
        <main className="grid flex-1 place-items-center" aria-busy="true" aria-label="Opening Ava's request">
          <Loader2 className="h-6 w-6 animate-spin text-white/50" aria-hidden />
        </main>
      </div>
    );
  }

  // ----- finished states -----
  if (phase === "running" || phase === "finished" || phase === "failed") {
    const bad = phase === "failed";
    return (
      <div className={shell} style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}>
        <style>{CSS}</style>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-5 text-center" aria-live="polite">
          <div className={cn("ava-pop grid h-24 w-24 place-items-center rounded-full", bad ? "bg-red-500/15 text-red-400 bento:text-red-600" : "bg-emerald-500/15 text-emerald-400 bento:text-emerald-600")}>
            {bad ? <X className="h-11 w-11" aria-hidden /> : (
              <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path className="ava-draw" d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
          </div>
          <h1 className="mt-6 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
            {bad ? "Scout didn't start" : phase === "finished" ? "Scout finished" : undo ? "Approved. Scout is putting it back" : "Approved. Scout is on it"}
          </h1>
          <p className="mt-2 max-w-[19rem] text-[1.0625rem] leading-relaxed text-white/60">
            {bad ? "Your tap went through, but Scout couldn't start it. Use Yes, do it in the admin." : phase === "finished" ? "Ask Ava how it went, or read Scout's answer in the Ava (voice) chat in the admin." : "You can close this. If you're still on the call, ask Ava to check."}
          </p>
          {phase === "running" && <Loader2 className="mt-5 h-5 w-5 animate-spin text-white/45" aria-label="Scout is working" />}
        </main>
        <footer className="mx-auto w-full max-w-sm px-5 pt-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}>
          <Link to="/admin" className="ava-press flex h-[3.25rem] w-full items-center justify-center rounded-2xl bg-white text-[1.0625rem] font-semibold text-black">Done</Link>
        </footer>
      </div>
    );
  }

  const asked = ap.from_call ? `Ava, from your call at ${clock(ap.created_at)}` : `Ava, at ${clock(ap.created_at)}`;

  return (
    <div className={shell} style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}>
      <style>{CSS}</style>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col px-5">
        <header className="pt-4 text-center">
          <AdminMark label="Bestly Admin" className="mx-auto h-10 w-10" />
          <p className="mt-4 text-[0.875rem] font-medium tracking-[0.01em] text-white/65">{undo ? "Ava wants to put something back" : "Ava wants to run a fix"}</p>
          <h1 className="mt-1 text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.025em] [text-wrap:balance]">{ap.title}</h1>
        </header>

        <section className="ava-in mt-6 space-y-3" aria-label="What will run">
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 bento:border-white/5 bento:bg-[#fff]">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-white/65">
              {undo ? <Undo2 className="h-3.5 w-3.5" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
              {undo ? "What will be put back" : "What Scout will do"}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-[1.0625rem] leading-relaxed">{undo ? ap.action_plain : exact}</p>
            {undo && (
              <div className="mt-3 border-t border-white/10 pt-3 bento:border-black/5">
                <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
                  className="ava-press flex min-h-[2.75rem] w-full items-center justify-between text-left text-[0.9375rem] font-medium text-white/70">
                  Show the exact command
                  <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
                </button>
                {open && <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-3 text-[0.75rem] leading-relaxed text-white/75 bento:bg-black/5">{exact}</pre>}
              </div>
            )}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-1 text-[0.9375rem]">
            <dt className="text-white/65">Asked by</dt>
            <dd className="text-right">{asked}</dd>
            <dt className="text-white/65">Expires</dt>
            <dd className="text-right">
              <span className="whitespace-nowrap">{clock(ap.expires_at)}</span>
              {live && <span className="text-white/65"> · <span className="whitespace-nowrap">{mins} min</span> left</span>}
            </dd>
          </dl>

          {blocked && (
            <div className={cn("flex gap-3 rounded-2xl p-4", blocked.tone === "warn" ? "bg-amber-400/10 text-amber-200 bento:bg-amber-50 bento:text-amber-800" : "bg-white/[0.05] text-white/80 bento:bg-[#fff]")} role="status">
              <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div>
                <p className="text-[1.0625rem] font-semibold">{blocked.title}</p>
                <p className="mt-0.5 text-[0.9375rem] leading-snug opacity-85">{blocked.body}</p>
              </div>
            </div>
          )}
          <p className="min-h-[1.25rem] px-1 text-[0.9375rem] text-red-400 bento:text-red-600" role={msg ? "alert" : undefined}>{msg}</p>
        </section>
        <div className="flex-1" />
      </main>

      <footer
        className="sticky bottom-0 mx-auto w-full max-w-sm bg-gradient-to-t from-black via-black/95 to-black/0 px-5 pt-6 bento:from-[#F3F2EE] bento:via-[#F3F2EE]/95 bento:to-[#F3F2EE]/0"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}
      >
        {blocked ? (
          <Link to="/admin" className="ava-press flex h-[3.25rem] w-full items-center justify-center rounded-2xl bg-white text-[1.0625rem] font-semibold text-black">Done</Link>
        ) : (
          <>
            <button type="button" onClick={approve} disabled={!live || busy}
              className="ava-press flex h-[3.25rem] w-full items-center justify-center gap-2 rounded-2xl bg-white text-[1.0625rem] font-semibold text-black disabled:opacity-40">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ScanFace className="h-5 w-5" aria-hidden />}
              {phase === "tap" ? "Confirm with Face ID" : phase === "deciding" ? "Checking your tap" : phase === "starting" ? "Starting Scout" : "Approve with Face ID"}
            </button>
            <button type="button" onClick={decline} disabled={!live || busy}
              className="ava-press mt-2 flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl text-[1.0625rem] font-medium text-white/70 disabled:opacity-0">
              No, don't
            </button>
            <p className="mt-1 text-center text-[0.8125rem] text-white/60">Only approve what you just asked Ava for.</p>
          </>
        )}
      </footer>
    </div>
  );
}
