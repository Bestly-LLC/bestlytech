import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AdminMark } from "@/components/AdminMark";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { Check, Laptop, Loader2, ShieldX, Smartphone, Monitor } from "lucide-react";

/**
 * /admin/approve — let another browser in, from your phone.
 *
 * Mobile-first, one task per screen, in the iOS idiom: big segmented code cells that
 * accept paste and one-time-code autofill, a single primary action pinned to the bottom
 * above the home indicator, and a clear success state.
 *
 * Safety: typing the code proves you can see the other screen. Arriving from a QR or
 * link (code pre-filled) also needs the 2-digit number shown there; a wrong number
 * blocks the request for good (admin-device-login).
 */
type Lookup = { code: string; status: string; created_at: string; expires_at: string; user_agent: string | null; ip: string | null; live: boolean };

const CODE_LEN = 8;
const clip = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function describe(ua: string | null) {
  if (!ua) return { name: "Unknown browser", Icon: Monitor };
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  const app = /Claude/i.test(ua) ? "Claude app" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  const Icon = os === "iPhone" || os === "Android" ? Smartphone : os === "Mac" || os === "Windows PC" ? Laptop : Monitor;
  return { name: os ? `${app} on ${os}` : app, Icon };
}

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 10 ? "just now" : s < 60 ? `${s} seconds ago` : `${Math.round(s / 60)} min ago`;
}

/** Segmented one-time-code field: one real input under the cells, so paste, autofill and VoiceOver just work. */
function CodeCells({
  value, length, onChange, label, autoFocus, numeric, groups, invalid,
}: {
  value: string; length: number; onChange: (v: string) => void; label: string;
  autoFocus?: boolean; numeric?: boolean; groups?: number[]; invalid?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const split = groups ?? [length];
  let i = 0;
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange((numeric ? e.target.value.replace(/\D/g, "") : clip(e.target.value)).slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode={numeric ? "numeric" : "text"}
        pattern={numeric ? "[0-9]*" : undefined}
        autoCapitalize="characters"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        maxLength={length + 2}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className="absolute inset-0 h-full w-full cursor-text opacity-0 [caret-color:transparent]"
        style={{ fontSize: 16 /* stops iOS zoom-on-focus */ }}
      />
      <div className={cn("pointer-events-none flex w-full items-center justify-center", numeric ? "gap-3" : "gap-1.5 sm:gap-2")} aria-hidden>
        {split.map((n, g) => (
          <div key={g} className={cn("flex min-w-0 items-center", numeric ? "gap-3" : "flex-1 gap-1 sm:gap-1.5")}>
            {g > 0 && <span className="mr-0.5 h-0.5 w-2 shrink-0 rounded-full bg-white/25 sm:mr-1 sm:w-2.5" />}
            {Array.from({ length: n }).map(() => {
              const idx = i++;
              const ch = value[idx] ?? "";
              const active = focused && idx === Math.min(value.length, length - 1);
              return (
                <span
                  key={idx}
                  className={cn(
                    "flex items-center justify-center rounded-xl border font-mono font-semibold tabular-nums text-white",
                    "bg-white/[0.06] transition-[border-color,box-shadow,background-color] duration-150 bento:bg-[#fff]",
                    numeric ? "h-16 w-14 text-[2rem]" : "aspect-[5/7] min-w-0 max-w-[2.75rem] flex-1 text-[clamp(1.125rem,5.5vw,1.625rem)]",
                    invalid ? "border-red-400/70" : active ? "border-white/60 shadow-[0_0_0_4px_rgba(255,255,255,0.08)]" : ch ? "border-white/20" : "border-white/10",
                  )}
                >
                  {ch || (active ? <span className="approve-caret h-7 w-0.5 rounded-full bg-white/70" /> : "")}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const CSS = `
.approve-caret { animation: approve-blink 1.05s steps(1) infinite; }
@keyframes approve-blink { 50% { opacity: 0 } }
.approve-in { animation: approve-in 320ms cubic-bezier(0.2, 0.9, 0.3, 1.1) both; }
@keyframes approve-in { from { opacity: 0; transform: translateY(12px) scale(0.98) } to { opacity: 1; transform: none } }
.approve-pop { animation: approve-pop 520ms cubic-bezier(0.3, 1.6, 0.5, 1) both; }
@keyframes approve-pop { from { opacity: 0; transform: scale(0.4) } to { opacity: 1; transform: none } }
.approve-draw { stroke-dasharray: 30; stroke-dashoffset: 30; animation: approve-draw 360ms 220ms ease-out forwards; }
@keyframes approve-draw { to { stroke-dashoffset: 0 } }
.approve-shake { animation: approve-shake 380ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
@keyframes approve-shake { 20%, 60% { transform: translateX(-6px) } 40%, 80% { transform: translateX(6px) } }
.approve-press { transition: transform 120ms ease, opacity 150ms ease, background-color 150ms ease; }
.approve-press:active:not(:disabled) { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) {
  .approve-caret, .approve-in, .approve-pop, .approve-shake { animation: none !important }
  .approve-draw { animation: none; stroke-dashoffset: 0 }
}
`;

export default function AdminApproveLogin() {
  const { bento } = useAdminTheme();
  const [params] = useSearchParams();
  const linked = clip(params.get("code") ?? "").slice(0, CODE_LEN);
  const [code, setCode] = useState(linked);
  const [num, setNum] = useState("");
  const [req, setReq] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);

  const complete = code.length === CODE_LEN;
  // Arrived through a QR or link: the code wasn't typed from the screen, so the number must be.
  const needsNumber = !!linked && code === linked;
  const device = useMemo(() => describe(req?.user_agent ?? null), [req?.user_agent]);

  useEffect(() => {
    setReq(null);
    setMsg(null);
    if (!complete) return;
    let gone = false;
    setLooking(true);
    (async () => {
      const { data, error } = await supabase.functions.invoke("admin-device-login", { body: { op: "lookup", code } });
      if (gone) return;
      setLooking(false);
      if (error || !data?.ok) {
        setMsg(data?.error ?? "No sign-in request with that code. Check the other screen.");
        setShake((n) => n + 1);
      } else setReq(data.request as Lookup);
    })();
    return () => {
      gone = true;
    };
  }, [code, complete]);

  const decide = async (approve: boolean) => {
    setBusy(approve ? "approve" : "deny");
    setMsg(null);
    const body: Record<string, unknown> = { op: "decide", code, approve };
    if (approve && needsNumber) body.match = Number(num);
    const { data, error } = await supabase.functions.invoke("admin-device-login", { body });
    setBusy(null);
    if (error || !data?.ok) {
      setMsg(data?.error ?? error?.message ?? "That didn't work. Try again.");
      setShake((n) => n + 1);
      if (approve && needsNumber) setNum("");
      return;
    }
    try {
      navigator.vibrate?.(approve ? 12 : [8, 60, 8]);
    } catch {
      /* no haptics here */
    }
    setDone(approve ? "approved" : "denied");
  };

  const canApprove = !!req?.live && (!needsNumber || num.length === 2) && !busy;

  return (
    <div
      className={cn(
        "admin-shell flex min-h-dvh flex-col text-white",
        bento ? "admin-bento bg-[#F3F2EE]" : "bg-black",
      )}
      style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
    >
      <style>{CSS}</style>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col px-5">
        {done ? (
          <section className="flex flex-1 flex-col items-center justify-center text-center" aria-live="polite">
            <div
              className={cn(
                "approve-pop grid h-24 w-24 place-items-center rounded-full",
                done === "approved" ? "bg-emerald-500/15 text-emerald-400 bento:text-emerald-600" : "bg-red-500/15 text-red-400 bento:text-red-600",
              )}
            >
              {done === "approved" ? (
                <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path className="approve-draw" d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : (
                <ShieldX className="h-11 w-11" aria-hidden />
              )}
            </div>
            <h1 className="mt-6 text-[1.75rem] font-semibold tracking-tight">{done === "approved" ? "Approved" : "Blocked"}</h1>
            <p className="mt-2 max-w-[18rem] text-[1.0625rem] leading-relaxed text-white/60">
              {done === "approved"
                ? "The other screen signs in within a couple of seconds. You can put your phone down."
                : "That browser stays signed out. If it wasn't you, nothing else is needed."}
            </p>
          </section>
        ) : (
          <>
            {/* Collapses once the request is found, so the next step sits above the keyboard */}
            <header className={cn("text-center transition-[padding] duration-300", req ? "pt-2" : "pt-6")}>
              {!req && <AdminMark label="Bestly Admin" className="mx-auto h-12 w-12" />}
              <h1 className={cn("font-semibold leading-tight tracking-tight", req ? "text-[1.25rem]" : "mt-5 text-[1.75rem]")}>
                Sign in another screen
              </h1>
              {!req && (
                <p className="mx-auto mt-2 max-w-[19rem] text-[1.0625rem] leading-relaxed text-white/60">
                  {needsNumber ? "Check the code matches the other screen." : "Type the code shown on the screen you want to sign in."}
                </p>
              )}
            </header>

            <section className={req ? "mt-5" : "mt-8"} aria-label="Sign-in code">
              <div key={shake} className={shake ? "approve-shake" : undefined}>
                <CodeCells
                  value={code}
                  length={CODE_LEN}
                  groups={[4, 4]}
                  onChange={(v) => {
                    setCode(v);
                    setNum("");
                  }}
                  label="Sign-in code, 8 letters and numbers"
                  autoFocus={!linked}
                  invalid={!!msg && !req}
                />
              </div>
              <p className="mt-3 min-h-[1.25rem] text-center text-[0.9375rem]" role={msg ? "alert" : undefined}>
                {looking ? (
                  <span className="inline-flex items-center gap-1.5 text-white/55">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Finding the request…
                  </span>
                ) : msg ? (
                  <span className="text-red-400 bento:text-red-600">{msg}</span>
                ) : null}
              </p>
            </section>

            {req && (
              <section className="approve-in mt-2 space-y-4" aria-live="polite">
                <div className="flex items-center gap-3.5 rounded-2xl border border-white/10 bg-white/[0.05] p-4 bento:border-black/5 bento:bg-[#fff]">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.08] bento:bg-[#F3F2EE]">
                    <device.Icon className="h-5 w-5 text-white/80" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[1.0625rem] font-medium">{device.name}</p>
                    <p className="text-[0.875rem] text-white/55">
                      Asked {ago(req.created_at)}
                      {req.ip ? ` · ${req.ip}` : ""}
                    </p>
                  </div>
                </div>

                {!req.live && (
                  <p className="rounded-2xl bg-white/[0.05] p-4 text-center text-[0.9375rem] text-white/70 bento:bg-[#fff]">
                    This request {req.status === "pending" ? "expired" : `was ${req.status}`}. Get a new code on the other screen.
                  </p>
                )}

                {req.live && needsNumber && (
                  <div className="pt-2 text-center">
                    <p className="text-[1.0625rem] font-medium">Type the number on the other screen</p>
                    <div className="mt-3">
                      <CodeCells value={num} length={2} numeric onChange={setNum} label="Two-digit number from the other screen" autoFocus />
                    </div>
                  </div>
                )}
              </section>
            )}

            <div className="flex-1" />
          </>
        )}
      </main>

      {/* Actions pinned above the home indicator: one primary, the destructive one below it */}
      <footer
        className={cn(
          "sticky bottom-0 mx-auto w-full max-w-sm px-5 pt-4",
          "bg-gradient-to-t from-black via-black to-black/0 bento:from-[#F3F2EE] bento:via-[#F3F2EE] bento:to-[#F3F2EE]/0",
        )}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}
      >
        {done ? (
          <Link
            to="/admin"
            className="approve-press flex h-[3.25rem] w-full items-center justify-center rounded-2xl bg-white text-[1.0625rem] font-semibold text-black"
          >
            Done
          </Link>
        ) : (
          <>
            <button
              type="button"
              disabled={!canApprove}
              onClick={() => decide(true)}
              className="approve-press flex h-[3.25rem] w-full items-center justify-center gap-2 rounded-2xl bg-white text-[1.0625rem] font-semibold text-black disabled:opacity-35"
            >
              {busy === "approve" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Check className="h-5 w-5" aria-hidden />}
              {busy === "approve" ? "Approving…" : "Approve sign-in"}
            </button>
            <button
              type="button"
              disabled={!req?.live || !!busy}
              onClick={() => decide(false)}
              className="approve-press mt-2 flex h-12 w-full items-center justify-center rounded-2xl text-[1.0625rem] font-medium text-red-400 disabled:opacity-0 bento:text-red-600"
            >
              {busy === "deny" ? "Blocking…" : "This wasn't me"}
            </button>
            <p className="mt-1 text-center text-[0.8125rem] text-white/40">Only approve a code you can see on your own screen right now.</p>
          </>
        )}
      </footer>
    </div>
  );
}
