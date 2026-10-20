/**
 * The iPostal1 login slot (Jared, 2026-10-19), shown inside the audit-tokens card on /admin/security.
 *
 * Hermes (Mail Clerk) reads the iPostal1 alert emails with no login at all. It only signs in to iPostal1 to look at a
 * mailbox item or to run a paid step Jared approved in Needs you. The login is saved ONCE here: hermes_login_save (admin only)
 * writes one JSON secret into Vault as pi:ipostal1_login. Nothing typed here can be read back, by this page or anyone; only
 * the saved-at time, a masked email hint and whether the last sign-in worked come back. Every sign-in Hermes makes is logged
 * (hermes_logins) and shown on its Team card.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, KeyRound, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Section, btnPrimary, card, field, label, pill, secondary } from "./laxUi";
import { Lines } from "@/components/Lines";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

type State = "missing" | "saved" | "working" | "rejected" | "trouble";
interface Status { state: State; saved_at?: string | null; last_ok_at?: string | null; last_fail_at?: string | null; note?: string | null; hint?: string | null }

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const At = ({ iso }: { iso: string }) => <span className="whitespace-nowrap">{when(iso)}</span>;

function badge(s: State) {
  if (s === "working") return { tone: pill.green, icon: Check, text: "Working" };
  if (s === "saved") return { tone: pill.blue, icon: Check, text: "Saved" };
  if (s === "rejected") return { tone: pill.orange, icon: CircleAlert, text: "Needs a new login" };
  if (s === "trouble") return { tone: pill.orange, icon: CircleAlert, text: "Trouble signing in" };
  return { tone: pill.orange, icon: CircleAlert, text: "Needed" };
}

export function IPostalLoginSlot() {
  const [s, setS] = useState<Status | null>(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await rpc("hermes_login_status");
    if (!error && data) setS(data as Status);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Needs you links here with #ipostal1: bring this card into view even when the route did not reload.
  useEffect(() => {
    if (!s || window.location.hash !== "#ipostal1") return;
    document.getElementById("ipostal1")?.scrollIntoView({ block: "start" });
  }, [s]);

  async function save() {
    setBusy(true);
    const { data, error } = await rpc("hermes_login_save", { p_email: email.trim(), p_password: pw });
    setBusy(false);
    if (error) { toast.error(error.message || "Couldn't save the login."); return; }
    setEmail("");
    setPw("");
    setS(data as Status);
    window.dispatchEvent(new Event("hermes:decided"));   // the "Add the iPostal1 login" row leaves Needs you
    toast.success("Saved to Vault. Hermes signs in once to check it, within 5 minutes.");
  }

  if (!s) return null;
  const b = badge(s.state);
  const Icon = b.icon;
  const saved = s.state !== "missing";

  return (
    <Section id="ipostal1" title="iPostal1 mailbox login"
      footer="Stored in Vault as pi:ipostal1_login. Write-only: nothing typed here can be read back, by this page or anyone. Hermes uses it only to look at a mail item or to run a step you approved in Needs you, and every sign-in is logged on its Team card.">
      <div className={cn(card, "space-y-4")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cn("text-[15px] font-semibold", label)}>Hermes, the Mail Clerk, needs one login</p>
            <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
              <Lines>Hermes reads the iPostal1 alert emails on its own, so you never see them. Opening, scanning or depositing an item needs this email and password, saved once. Until then it works from the alerts alone.</Lines>
            </p>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap", b.tone)}>
            <Icon className="h-3.5 w-3.5" aria-hidden /> {b.text}
          </span>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ipostal-email" className={cn("text-[15px] font-semibold", label)}>iPostal1 email</label>
          <input id="ipostal-email" type="email" autoComplete="off" spellCheck={false} className={field}
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={saved && s.hint ? `Saved for ${s.hint} · type a new one to replace` : "the email you sign in to iPostal1 with"} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ipostal-pw" className={cn("text-[15px] font-semibold", label)}>iPostal1 password</label>
          <input id="ipostal-pw" type="password" autoComplete="new-password" spellCheck={false} className={field}
            value={pw} onChange={(e) => setPw(e.target.value)}
            placeholder={saved ? "Saved · type a new one to replace" : "paste the password"} />
          <p aria-live="polite" className={cn("text-[13px]", s.state === "rejected" || s.state === "trouble" ? "text-[#FF9F0A] bento:text-[#C93400]" : secondary)}>
            {s.state === "missing" && "Nothing saved yet"}
            {s.state === "saved" && s.saved_at && <>Saved <At iso={s.saved_at} />, Hermes checks it on its next pass</>}
            {s.state === "working" && s.last_ok_at && <>Signed in fine on <At iso={s.last_ok_at} /></>}
            {s.state === "rejected" && (s.note || "iPostal1 refused the saved email or password")}
            {s.state === "trouble" && (s.note || "The last sign-in did not finish; Hermes tries again")}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={cn("inline-flex items-center gap-1.5 text-[13px]", secondary)}>
            <Lock className="h-3.5 w-3.5" aria-hidden /> Goes straight to Vault
          </p>
          <button type="button" className={btnPrimary} onClick={save} disabled={busy || !email.trim() || !pw}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
            Save to Vault
          </button>
        </div>
      </div>
    </Section>
  );
}
