/**
 * /partner — the business partner's view of Bestly (Eli).
 *
 *   /partner          sign in (email + password), then Home
 *   /partner/welcome  the one-time link Jared texts: signs in, then "choose a password"
 *
 * Signed in, it renders PartnerHome (PartnerHome.tsx): Home, Calls, Ask (free AI), Mail, Files.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Check, Eye, EyeOff, Fingerprint, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { cn } from "@/lib/utils";
import { AdminMark, SIGNIN_STARE_RADIUS_PX } from "@/components/AdminMark";
import { PartnerMark } from "@/components/PartnerMark";
import { PartnerHome } from "./PartnerHome";
import { addPasskey, passkeysSupported, signInWithPasskey } from "@/lib/passkey";

const card = "rounded-[1.5rem] bg-white/[0.04] border border-white/[0.06] bento:bg-[#fff] bento:border-transparent";
const btnSolid = "inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 text-[1rem] font-semibold text-black transition active:scale-[0.98] disabled:opacity-50 bento:bg-[#111114] bento:text-[#fff]";
const input = "h-[52px] w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white outline-none placeholder:text-white/35 focus:border-white/30 bento:bg-[var(--bento-well)] bento:border-black/5";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Shell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const { bento } = useAdminTheme();
  useEffect(() => { document.title = "Bestly · Partner"; }, []);
  return (
    <div className={cn("admin-shell min-h-dvh text-white", bento ? "admin-bento bg-[#F3F2EE]" : "bg-black")}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <header className="flex h-14 items-center justify-between">
          <span className="flex items-center gap-2 text-[0.95rem] font-semibold tracking-tight">
            <AdminMark className="h-7 w-7" />
            Bestly <span className="text-white/45">· Partner</span>
          </span>
          {right}
        </header>
        {children}
      </div>
    </div>
  );
}

/** The pair: Jared's binoculars spot it, the partner's globe steers it. Both watch the cursor. */
function Duo() {
  return (
    <figure className="flex flex-col items-center">
      <div className="flex items-end gap-5">
        <div className="flex flex-col items-center gap-1.5">
          <AdminMark stareRadius={SIGNIN_STARE_RADIUS_PX} label="Binoculars" className="h-20 w-20" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Spot</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <PartnerMark watchCursor stareRadius={SIGNIN_STARE_RADIUS_PX} label="Globe" className="h-20 w-20" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Steer</span>
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-white/50">Jared spots it. You steer it.</figcaption>
    </figure>
  );
}

/* ───────── sign in ───────── */

function SignIn() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
  };
  const [pkBusy, setPkBusy] = useState(false);
  const passkey = async () => {
    setPkBusy(true); setErr("");
    const problem = await signInWithPasskey(email.trim() || undefined);
    setPkBusy(false);
    if (problem && problem !== "cancelled") setErr(problem === "That didn't work." ? "No passkey found for this account yet." : problem);
  };
  return (
    <Shell>
      <div className="mx-auto mt-8 max-w-sm">
        <Duo />
        <h1 className="mt-8 text-[1.9rem] font-bold leading-tight tracking-tight">Sign in</h1>
        <p className="mt-2 text-[0.975rem] text-white/60">Calls, to-dos and the pipeline you share with Jared.</p>
        <form onSubmit={submit} className="mt-8 space-y-3">
          <input className={input} type="email" autoComplete="username" inputMode="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div className="relative">
            <input className={cn(input, "pr-12")} type={show ? "text" : "password"} autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-white/50">
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          {err && <p role="alert" className="text-sm text-red-400 bento:text-red-600">{err}</p>}
          <button className={btnSolid} disabled={busy}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}</button>
        </form>
        {passkeysSupported() && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-white/35"><span className="h-px flex-1 bg-white/10" />or<span className="h-px flex-1 bg-white/10" /></div>
            <button type="button" onClick={passkey} disabled={pkBusy}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-white/15 px-5 text-[1rem] font-semibold text-white disabled:opacity-50 bento:border-black/15 bento:text-black">
              {pkBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-5 w-5" />} Sign in with Face ID or a passkey
            </button>
          </>
        )}
        <p className="mt-6 text-center text-sm text-white/50">First time, or forgot your password? Ask Jared for a sign-in link.</p>
      </div>
    </Shell>
  );
}

/* ───────── /partner/welcome ───────── */

export function PartnerWelcome() {
  const nav = useNavigate();
  const [stage, setStage] = useState<"checking" | "passkey" | "password" | "bad" | "done">("checking");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const q = new URLSearchParams(window.location.search);
    const code = q.get("c") ?? h.get("c");          // the new link: a claim code, good for a week
    const t = q.get("t") ?? h.get("t");             // the old link: a one-time token
    history.replaceState(null, "", "/partner/welcome");  // keep the secret out of the address bar
    (async () => {
      const finish = async (token: string) => {
        await supabase.auth.signOut({ scope: "local" });
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: "magiclink" });
        if (error || !data.session) return false;
        setName(String(data.user?.user_metadata?.name ?? ""));
        setStage(passkeysSupported() ? "passkey" : "password");
        return true;
      };
      if (code) {
        // The sign-in token is minted now, on this tap, so an older link can never be stale.
        const { data, error } = await supabase.functions.invoke("partner-admin", { body: { op: "claim", code } });
        const token = (data as { token?: string } | null)?.token;
        if (!error && token && (await finish(token))) return;
        setName(String((data as { name?: string } | null)?.name ?? ""));
        setStage("bad");
        return;
      }
      if (t) { if (await finish(t)) return; setStage("bad"); return; }
      const { data } = await supabase.auth.getSession();
      if (data.session) { setName(String(data.session.user.user_metadata?.name ?? "")); setStage(passkeysSupported() ? "passkey" : "password"); }
      else setStage("bad");
    })();
  }, []);

  // Face ID / Touch ID / Windows Hello first: nothing to remember, nothing to type next time.
  const [pkBusy, setPkBusy] = useState(false);
  const makePasskey = async () => {
    setPkBusy(true); setErr("");
    const problem = await addPasskey();
    setPkBusy(false);
    if (!problem) { setStage("done"); return; }
    if (problem !== "cancelled") setErr(problem);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) { setErr("Use at least 10 characters."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.auth.updateUser({ password: pw, data: { password_set: true } });
    setBusy(false);
    if (error) setErr(error.message);
    else nav("/partner", { replace: true });
  };

  return (
    <Shell>
      <div className="mx-auto mt-10 max-w-sm">
        {stage === "checking" && <p className="flex items-center gap-2 text-white/60"><Loader2 className="h-5 w-5 animate-spin" /> Signing you in…</p>}
        {stage === "bad" && (
          <>
            <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight">This link doesn't work</h1>
            <p className="mt-2 text-[0.975rem] text-white/60">It may have been replaced by a newer one. Ask Jared to send the latest link, or sign in with your password.</p>
            <button className={cn(btnSolid, "mt-8")} onClick={() => nav("/partner", { replace: true })}>Go to sign in</button>
          </>
        )}
        {stage === "passkey" && (
          <>
            <Duo />
            <h1 className="mt-8 text-[1.9rem] font-bold leading-tight tracking-tight">Welcome{name ? `, ${name}` : ""}</h1>
            <p className="mt-2 text-[0.975rem] text-white/60">Set up Face ID (or your fingerprint) so next time you just look at your phone. No password to remember.</p>
            {err && <p role="alert" className="mt-4 text-sm text-red-400 bento:text-red-600">{err}</p>}
            <button className={cn(btnSolid, "mt-8 gap-2")} onClick={makePasskey} disabled={pkBusy}>
              {pkBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-5 w-5" />} Set up Face ID
            </button>
            <button className="mt-4 w-full text-center text-sm text-white/50" onClick={() => { setErr(""); setStage("password"); }}>Use a password instead</button>
          </>
        )}
        {stage === "done" && (
          <>
            <Duo />
            <h1 className="mt-8 flex items-center gap-2 text-[1.9rem] font-bold leading-tight tracking-tight"><Check className="h-7 w-7 text-emerald-400" /> You're set</h1>
            <p className="mt-2 text-[0.975rem] text-white/60">Next time, open bestly.tech/partner and it's Face ID — no password, no link.</p>
            <button className={cn(btnSolid, "mt-8")} onClick={() => nav("/partner", { replace: true })}>Go to my portal</button>
            <button className="mt-4 w-full text-center text-sm text-white/50" onClick={() => setStage("password")}>Also set a password</button>
          </>
        )}
        {stage === "password" && (
          <>
            <Duo />
            <h1 className="mt-8 text-[1.9rem] font-bold leading-tight tracking-tight">Welcome{name ? `, ${name}` : ""}</h1>
            <p className="mt-2 text-[0.975rem] text-white/60">Choose a password so you can sign in any time. Your phone's password manager can save it.</p>
            <form onSubmit={save} className="mt-8 space-y-3">
              <input className={input} type="password" autoComplete="new-password" placeholder="New password (10+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
              {err && <p role="alert" className="text-sm text-red-400 bento:text-red-600">{err}</p>}
              <button className={btnSolid} disabled={busy}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save and continue"}</button>
            </form>
            <button className="mt-4 w-full text-center text-sm text-white/50" onClick={() => nav("/partner", { replace: true })}>Skip for now</button>
          </>
        )}
      </div>
    </Shell>
  );
}

/* ───────── home ───────── */

/* ───────── entry ───────── */

export default function PartnerPortal() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const loc = useLocation();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  const key = useMemo(() => loc.pathname, [loc.pathname]);
  if (session === undefined) return <Shell><p className="mt-10 flex items-center gap-2 text-white/60" key={key}><Loader2 className="h-5 w-5 animate-spin" /> Loading…</p></Shell>;
  return session ? <PartnerHome session={session} /> : <SignIn />;
}
