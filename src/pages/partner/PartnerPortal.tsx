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
import { BrandLoader } from "@/components/BrandLoader";
import { armNotifySound } from "@/lib/notifySound";
import { AdminMark, SIGNIN_STARE_RADIUS_PX } from "@/components/AdminMark";
import { PartnerMark } from "@/components/PartnerMark";
import { PartnerHome } from "./PartnerHome";
import { addPasskey, passkeyCount, passkeysSupported, signInWithPasskey } from "@/lib/passkey";

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [email, setEmail] = useState("");
  const [askEmail, setAskEmail] = useState(false);

  // Passkeys only — no passwords anywhere in the portal. The browser offers whichever passkey it
  // holds for this site; if it has none to offer, we ask for the email and try that account's.
  const passkey = async (withEmail?: string) => {
    setBusy(true); setErr("");
    const problem = await signInWithPasskey(withEmail?.trim() || undefined);
    setBusy(false);
    if (!problem || problem === "cancelled") return;
    if (!withEmail && !askEmail) { setAskEmail(true); setErr(""); return; }
    setErr(problem.startsWith("No passkey") ? "No passkey on this account yet — ask Jared for a sign-in link." : problem);
  };

  return (
    <Shell>
      <div className="mx-auto mt-8 max-w-sm">
        <Duo />
        <h1 className="mt-8 text-[1.9rem] font-bold leading-tight tracking-tight">Sign in</h1>
        <p className="mt-2 text-[0.975rem] text-white/60">Calls, to-dos and the pipeline you share with Jared.</p>

        {!passkeysSupported() ? (
          <p className="mt-8 rounded-2xl bg-amber-500/10 p-4 text-[0.95rem] text-amber-200 bento:text-amber-800">
            This browser can't do Face ID or passkeys. Open bestly.tech/partner on your phone, or ask Jared for a sign-in link.
          </p>
        ) : (
          <>
            {askEmail && (
              <input className={cn(input, "mt-8")} type="email" autoComplete="username webauthn" inputMode="email" placeholder="Your email"
                value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            )}
            {err && <p role="alert" className="mt-4 text-sm text-red-400 bento:text-red-600">{err}</p>}
            <button type="button" onClick={() => passkey(askEmail ? email : undefined)} disabled={busy || (askEmail && !email.trim())}
              className={cn(btnSolid, "mt-6 gap-2")}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-5 w-5" />} Sign in with Face ID
            </button>
          </>
        )}
        <p className="mt-6 text-center text-sm text-white/50">First time, or on a new device? Ask Jared for a sign-in link.</p>
      </div>
    </Shell>
  );
}

/* ───────── /partner/welcome ───────── */

export function PartnerWelcome() {
  const nav = useNavigate();
  const [stage, setStage] = useState<"checking" | "passkey" | "bad" | "done">("checking");
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
        setStage("passkey");
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
      if (data.session) { setName(String(data.session.user.user_metadata?.name ?? "")); setStage("passkey"); }
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

  return (
    <Shell>
      <div className="mx-auto mt-10 max-w-sm">
        {stage === "checking" && <p className="flex items-center gap-2 text-white/60"><Loader2 className="h-5 w-5 animate-spin" /> Signing you in…</p>}
        {stage === "bad" && (
          <>
            <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight">This link doesn't work</h1>
            <p className="mt-2 text-[0.975rem] text-white/60">It may have been replaced by a newer one. Ask Jared to send the latest one.</p>
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
            {!passkeysSupported() && (
              <p className="mt-4 text-sm text-white/50">This browser can't do passkeys. Open this same link on your phone and set it up there.</p>
            )}
          </>
        )}
        {stage === "done" && (
          <>
            <Duo />
            <h1 className="mt-8 flex items-center gap-2 text-[1.9rem] font-bold leading-tight tracking-tight"><Check className="h-7 w-7 text-emerald-400" /> You're set</h1>
            <p className="mt-2 text-[0.975rem] text-white/60">Next time, open bestly.tech/partner and it's Face ID — no password, no link.</p>
            <button className={cn(btnSolid, "mt-8")} onClick={() => nav("/partner", { replace: true })}>Go to my portal</button>

          </>
        )}
      </div>
    </Shell>
  );
}

/* ───────── home ───────── */

/* ───────── entry ───────── */

/**
 * Passkeys only: a partner who signs in without one is asked to set it up before anything else.
 * There is no password to fall back to, so this is the gate to the portal, not a nudge.
 */
function PasskeyGate({ session, done }: { session: Session; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const first = String(session.user.user_metadata?.name ?? "").split(" ")[0];
  const add = async () => {
    setBusy(true); setErr("");
    const problem = await addPasskey();
    setBusy(false);
    if (!problem) { done(); return; }
    if (problem !== "cancelled") setErr(problem);
  };
  return (
    <Shell>
      <div className="mx-auto mt-10 max-w-sm">
        <Duo />
        <h1 className="mt-8 text-[1.9rem] font-bold leading-tight tracking-tight">One step{first ? `, ${first}` : ""}</h1>
        <p className="mt-2 text-[0.975rem] text-white/60">
          Set up Face ID (or your fingerprint) now. It's how you get in from here on — there's no password to remember, and nothing to type.
        </p>
        {err && <p role="alert" className="mt-4 text-sm text-red-400 bento:text-red-600">{err}</p>}
        <button className={cn(btnSolid, "mt-8 gap-2")} onClick={add} disabled={busy || !passkeysSupported()}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-5 w-5" />} Set up Face ID
        </button>
        {!passkeysSupported() && (
          <p className="mt-4 text-sm text-white/55">This browser can't do passkeys. Open bestly.tech/partner on your phone and set it up there — then this device works too.</p>
        )}
        <button className="mt-6 w-full text-center text-sm text-white/40" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </Shell>
  );
}

export default function PartnerPortal() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const loc = useLocation();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  // Does this account have a passkey yet? Until it does, the gate is the whole portal.
  const [keys, setKeys] = useState<number | null>(null);
  useEffect(() => {
    if (!session) { setKeys(null); return; }
    let gone = false;
    passkeyCount(session.user.id).then((n) => { if (!gone) setKeys(n); }).catch(() => { if (!gone) setKeys(1); });
    return () => { gone = true; };
  }, [session?.user.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => armNotifySound(), []);

  const key = useMemo(() => loc.pathname, [loc.pathname]);
  if (session === undefined) return <Shell><div key={key}><BrandLoader tone="dark" label="Loading your portal" /></div></Shell>;
  if (!session) return <SignIn />;
  if (keys === null) return <Shell><BrandLoader tone="dark" label="Loading your portal" /></Shell>;
  if (keys === 0) return <PasskeyGate session={session} done={() => setKeys(1)} />;
  return <PartnerHome session={session} />;
}
