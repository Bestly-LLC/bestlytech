import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { KeyRound, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { toast } from "sonner";

/**
 * One-time "set up a username and password" sheet. Shows after any admin sign-in until done,
 * so there's always a fallback when Apple / passkey / the QR can't be used on a device.
 * "Later" hides it for this browser session only; it asks again on the next sign-in.
 *
 * Built on Radix rather than a bare fixed div: a hand-rolled overlay has no focus trap, so you
 * could Tab straight out of it into the admin behind, and no Escape, so the keyboard had no way
 * out at all. Escape now means "Next time". A click on the backdrop deliberately does NOT —
 * losing a half-typed password to a stray click is worse than one extra button press.
 */
const LATER = "bestly-pw-setup-later";

export function PasswordSetup() {
  const { user } = useAdminAuth();
  const meta = (user?.user_metadata ?? {}) as { password_set?: boolean; username?: string };
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(LATER) === "1"; } catch { return false; } });
  const [username, setUsername] = useState(meta.username ?? "jared");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!user || meta.password_set || hidden) return null;

  const later = () => { try { sessionStorage.setItem(LATER, "1"); } catch { /* ok */ } setHidden(true); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const u = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(u)) return setErr("Username: 3 to 32 letters, numbers, dots or dashes.");
    if (pw.length < 10) return setErr("Password needs at least 10 characters.");
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw, data: { username: u, password_set: true } });
    setBusy(false);
    if (error) return setErr(error.message);
    toast.success(`Saved. You can now sign in with "${u}" and your password.`);
    setHidden(true);
  };

  const field = "h-12 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 text-[16px] text-white outline-none placeholder:text-white/35 focus:border-white/40 bento:border-white/10 bento:bg-[#fff]";
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o && !busy) later(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" />
        {/* A sheet at the bottom on a phone, centred once there is room. */}
        <DialogPrimitive.Content
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-sm focus:outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2"
        >
          <form onSubmit={save} className="w-full rounded-[1.75rem] border border-white/10 bg-[#111114] p-6 text-white shadow-2xl bento:border-transparent bento:bg-[#fff]">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.08] bento:bg-[#F3F2EE]"><KeyRound className="h-5 w-5" aria-hidden /></span>
            <DialogPrimitive.Title className="mt-4 text-xl font-semibold tracking-tight">Set up a username and password</DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-[0.9375rem] leading-snug text-white/60">
              A backup way in for when Apple or a passkey isn't available. One time only.
            </DialogPrimitive.Description>
            <div className="mt-5 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-white/55">Username</span>
                <input className={field} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-white/55">Password (10+ characters)</span>
                <input className={field} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-white/55">Same password again</span>
                <input className={field} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              </label>
            </div>
            {err && <p role="alert" className="mt-3 text-sm text-red-400 bento:text-red-600">{err}</p>}
            <button type="submit" disabled={busy} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-[1rem] font-semibold text-black disabled:opacity-50 bento:bg-[#111114] bento:text-[#fff]">
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={later} disabled={busy} className="mt-2 h-11 w-full rounded-2xl text-[0.9375rem] font-medium text-white/60 disabled:opacity-50">Next time</button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
