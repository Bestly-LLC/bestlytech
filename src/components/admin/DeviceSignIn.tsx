import { useCallback, useEffect, useRef, useState } from "react";
import { Smartphone, RefreshCw, Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sign in without a passkey prompt: for browsers that can't show one (the Claude
 * app's built-in browser, a TV, a kiosk). This browser shows a code; Jared types it
 * on a device where he is already signed in (bestly.tech/admin/approve), taps
 * Approve, and this browser gets a one-time session. See admin-device-login.
 */
type Req = { id: string; code: string; secret: string; expires_at: string };

export function DeviceSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [req, setReq] = useState<Req | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "waiting" | "approved" | "denied" | "expired" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const timer = useRef<number | null>(null);

  const start = useCallback(async () => {
    setState("starting");
    setError(null);
    const { data, error } = await supabase.functions.invoke("admin-device-login", { body: { op: "start" } });
    if (error || !data?.ok) {
      setError(data?.error ?? error?.message ?? "Could not start. Try again.");
      setState("error");
      return;
    }
    setReq(data as Req);
    setState("waiting");
  }, []);

  // Poll every 2s until approved, denied or expired.
  useEffect(() => {
    if (state !== "waiting" || !req) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      setLeft(Math.max(0, Math.round((new Date(req.expires_at).getTime() - Date.now()) / 1000)));
      const { data } = await supabase.functions.invoke("admin-device-login", {
        body: { op: "poll", id: req.id, secret: req.secret },
      });
      if (stop) return;
      if (data?.status === "approved" && data.token_hash) {
        setState("approved");
        const { error } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
        if (error) {
          setError(error.message);
          setState("error");
        } else onSignedIn();
        return;
      }
      if (data?.status === "denied" || data?.status === "expired" || data?.status === "used") {
        setState(data.status === "used" ? "expired" : data.status);
        return;
      }
      timer.current = window.setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stop = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [state, req, onSignedIn]);

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={start}
        className="w-full h-12 rounded-full bg-transparent text-white/80 font-medium text-[0.9375rem] flex items-center justify-center gap-2.5 border border-white/10 transition-all duration-200 hover:bg-white/5 hover:text-white active:scale-[0.98]"
      >
        <Smartphone className="h-[1.125rem] w-[1.125rem]" />
        Approve from my phone
      </button>
    );
  }

  const mins = Math.floor(left / 60);
  const secs = String(left % 60).padStart(2, "0");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-white" aria-live="polite">
      {state === "starting" && (
        <p className="flex items-center justify-center gap-2 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" /> Getting a code…
        </p>
      )}
      {state === "waiting" && req && (
        <>
          <p className="text-xs text-white/60">On your phone, open</p>
          <p className="mt-0.5 text-sm font-semibold">bestly.tech/admin/approve</p>
          <p className="mt-1 text-xs text-white/60">and type this code (a push is on its way too)</p>
          <p className="mt-4 select-all font-mono text-[2rem] font-semibold tracking-[0.18em]">{req.code}</p>
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-white/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for your OK · {mins}:{secs}
          </p>
        </>
      )}
      {state === "approved" && (
        <p className="flex items-center justify-center gap-2 text-sm text-emerald-300">
          <Check className="h-4 w-4" /> Approved. Signing you in…
        </p>
      )}
      {(state === "denied" || state === "expired" || state === "error") && (
        <>
          <p className="text-sm text-white/80">
            {state === "denied" ? "That request was denied." : state === "expired" ? "That code expired." : error}
          </p>
          <button
            type="button"
            onClick={start}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs text-white/80 hover:bg-white/5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Get a new code
          </button>
        </>
      )}
    </div>
  );
}
