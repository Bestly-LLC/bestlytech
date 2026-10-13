/**
 * "Owner PIN" card on /admin/ava. Jared calls from his own cell and Ava just listens (no code). From any other phone he can say a
 * six-digit PIN once; ava-admin /verify checks it against a salted hash in Vault. This card is the only place the PIN is set:
 * write-only, through the admin-guarded ava_owner_pin_set RPC. The page can read WHEN it was set and whether it is locked, never the
 * PIN or the hash. Plan: docs/ava-owner-mode-opusplan.md. Approving or undoing a fix still needs his phone and Face ID either way.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AVA_GLOW } from "./AvaOrb";
import { whenShort } from "./AvaShared";
import { CollapsibleSection } from "./CollapsibleSection";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Lock } from "lucide-react";

type PinStatus = { set: boolean; set_at: string | null; exposed: boolean; locked_until: string | null; failed_24h: number; last_verified_at: string | null };
type Err = { message: string } | null;

// loose access: these functions are newer than the generated types
const rpc = (fn: string, args?: object) =>
  (supabase.rpc as unknown as (f: string, a?: object) => PromiseLike<{ data: unknown; error: Err }>)(fn, args);

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
const field = cn("min-h-[44px] w-full rounded-xl bg-white/[0.06] px-3 text-center font-mono text-lg tracking-[0.4em] text-white placeholder:tracking-normal placeholder:text-white/35 ring-1 ring-white/10", ring);

export function AvaOwnerPin({ className }: { className?: string }) {
  const [s, setS] = useState<PinStatus | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const idA = useId(), idB = useId(), hint = useId();

  const load = useCallback(async () => {
    const { data, error } = await rpc("ava_owner_pin_status");
    if (error) { setLoadErr(error.message); return; }
    setLoadErr(null);
    setS(data as PinStatus);
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const six = (v: string) => /^[0-9]{6}$/.test(v);
  const mismatch = b.length === 6 && a !== b;
  const ready = six(a) && a === b && !busy;

  const save = async () => {
    if (!ready) return;
    setBusy(true); setMsg(null);
    const { error } = await rpc("ava_owner_pin_set", { p_pin: a });
    setBusy(false);
    // the digits leave memory the moment the call returns, win or lose
    setA(""); setB("");
    if (error) { setMsg({ ok: false, text: `Couldn't save that. ${error.message}` }); return; }
    setMsg({ ok: true, text: "Saved. Any call that was unlocked has to say the new PIN." });
    void load();
  };

  const locked = !!s?.locked_until;
  const summary = loadErr ? "Couldn't load" : !s ? "Loading" : !s.set ? "Not set yet" : locked ? `Locked until ${whenShort(s.locked_until as string)}` : s.exposed ? "Change it: the first one is in chat history" : `Set ${whenShort(s.set_at as string)}`;
  const attention = !!s && (!s.set || s.exposed || locked);

  return (
    <CollapsibleSection id="ava-owner-pin" anchorId="ava-owner-pin" title="Owner PIN" className={className}
      icon={<KeyRound className="h-4 w-4" style={{ color: AVA_GLOW }} />} summary={summary}
      badge={attention ? <AlertTriangle className="h-4 w-4 text-amber-300" aria-label="Needs attention" /> : undefined}>
      <div className="space-y-4 p-4">
        <p id={hint} className="text-[13px] leading-relaxed text-white/70">
          When you call Ava from your own cell she just listens. From any other phone, say this six-digit PIN once and she'll pull up status, numbers and the fix list.
          Approving or undoing a fix still takes your phone and Face ID.
        </p>

        {s?.exposed && (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-400/10 px-3 py-2 text-[13px] text-amber-200 ring-1 ring-amber-300/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            This PIN was in Ava's prompt and is in chat history. Change it when you get a sec.
          </p>
        )}
        {locked && (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-red-400/10 px-3 py-2 text-[13px] text-red-200 ring-1 ring-red-300/20">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Locked after too many wrong tries, until {whenShort(s?.locked_until as string)}. Saving a new PIN opens it right away.
          </p>
        )}
        {loadErr && <p role="alert" className="text-sm text-red-300">{loadErr}</p>}

        {s && (
          <p className="text-xs text-white/60">
            {s.set ? <>Set {whenShort(s.set_at as string)}.</> : <>No PIN yet, so only your own cell works.</>}
            {s.failed_24h > 0 ? <> {s.failed_24h} wrong {s.failed_24h === 1 ? "try" : "tries"} in the last 24 hours.</> : null}
            {s.last_verified_at ? <> Last used {whenShort(s.last_verified_at)}.</> : null}
          </p>
        )}

        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(); }} autoComplete="off">
          <div>
            <label htmlFor={idA} className="mb-1.5 block text-[13px] font-medium text-white">{s?.set ? "New PIN" : "PIN"}</label>
            <input id={idA} type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="new-password" value={a} aria-describedby={hint}
              onChange={(e) => setA(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 digits" className={field} />
          </div>
          <div>
            <label htmlFor={idB} className="mb-1.5 block text-[13px] font-medium text-white">Once more</label>
            <input id={idB} type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="new-password" value={b} aria-invalid={mismatch || undefined}
              onChange={(e) => setB(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 digits" className={field} />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" disabled={!ready}
              className={cn("inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-[#1c1c1e] transition-[transform,opacity] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100", ring)}
              style={{ background: AVA_GLOW }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {s?.set ? "Change PIN" : "Save PIN"}
            </button>
            <span className="text-xs text-white/55" aria-live="polite">
              {mismatch ? "The two don't match yet." : a.length > 0 && a.length < 6 ? `${6 - a.length} more ${6 - a.length === 1 ? "digit" : "digits"}.` : ""}
            </span>
          </div>
        </form>

        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={cn("flex items-start gap-2 text-sm", msg.ok ? "text-emerald-300" : "text-red-300")}>
            {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            {msg.text}
          </p>
        )}
        <p className="text-xs text-white/50">Stored as a salted hash in the vault. This page can never show it back to you.</p>
      </div>
    </CollapsibleSection>
  );
}
