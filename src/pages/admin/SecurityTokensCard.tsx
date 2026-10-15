/**
 * Audit tokens card on /admin/security (Jared, 2026-10-14).
 *
 * The nightly audit runs on the Pi now (tools/security-audit/). Three of its checks need a token Bestly never
 * had: a Vercel API token (preview protection, team members, env var names, deploys), a Supabase Management
 * API token (the security advisors) and a Cloudflare API token (Worker routes, Workers usage, DNS, SSL, members;
 * docs/cloudflare-audit-opusplan.md). Until one is saved, the checks it powers are recorded as "couldn't check",
 * never as a pass.
 *
 * Same pattern as ChargingCard: a write-only RPC puts each token into Vault (security_tokens_save for Vercel and
 * Supabase, security_tokens_save_cloudflare for Cloudflare, both admin only).
 * What you paste is never read back, by this page or anything else. Only the saved-at time returns, plus
 * whether the last audit run could actually use it (the Pi reports that).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, CircleAlert, KeyRound, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Section, btnPrimary, card, field, label, pill, secondary } from "./laxUi";
import { Lines } from "@/components/Lines";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

type TokenStatus = "unknown" | "ok" | "missing" | "rejected";
interface One { saved_at: string | null; status: TokenStatus; note: string | null; checked_at: string | null }
/** `cloudflare` is absent until migration 20261015150000 is applied (and on old page builds): treated as not saved. */
interface Status { vercel: One; supabase: One; cloudflare?: One }
const NOT_SAVED: One = { saved_at: null, status: "unknown", note: null, checked_at: null };

/** The exact read-only permissions the Cloudflare token needs, one per line (nothing else is ticked). */
const CF_PERMS = [
  "Account: Account Settings Read, Workers Scripts Read, Account Analytics Read, Cloudflare Tunnel Read",
  "Zone (All zones): Zone Read, DNS Read, Workers Routes Read, Zone Settings Read",
  "User: API Tokens Read",
];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function badge(t: One) {
  if (t.saved_at && t.status === "rejected") return { tone: pill.orange, icon: CircleAlert, text: "Needs a new token" };
  if (!t.saved_at) return { tone: pill.orange, icon: CircleAlert, text: "Needed" };
  if (t.status === "ok") return { tone: pill.green, icon: Check, text: "Working" };
  return { tone: pill.blue, icon: Check, text: "Saved" };
}

/** A date and its time never break apart across lines. */
const At = ({ iso }: { iso: string }) => <span className="whitespace-nowrap">{when(iso)}</span>;

function foot(t: One): ReactNode {
  if (!t.saved_at) return "Nothing saved yet";
  if (t.status === "rejected") return t.note || "The last audit run was refused";
  if (t.status === "ok" && t.checked_at) return <>Worked on the audit run <At iso={t.checked_at} /></>;
  return <>Saved <At iso={t.saved_at} />, the next audit run will try it</>;
}

export function SecurityTokensCard() {
  const [s, setS] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vercel, setVercel] = useState("");
  const [supa, setSupa] = useState("");
  const [cf, setCf] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await rpc("security_tokens_status");
    if (error || !data) { setFailed(true); return; }
    setFailed(false);
    setS(data as Status);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true);
    let latest: unknown = null;
    if (vercel.trim() || supa.trim()) {
      const { data, error } = await rpc("security_tokens_save", {
        p_vercel: vercel.trim() || null,
        p_supabase: supa.trim() || null,
      });
      if (error) { setBusy(false); toast.error(error.message || "Couldn't save the token."); return; }
      latest = data;
      setVercel("");
      setSupa("");
      setS(data as Status);
    }
    if (cf.trim()) {
      const { data, error } = await rpc("security_tokens_save_cloudflare", { p_token: cf.trim() });
      if (error) { setBusy(false); toast.error(error.message || "Couldn't save the Cloudflare token."); return; }
      latest = data;
      setCf("");
      setS(data as Status);
    }
    setBusy(false);
    if (latest) toast.success("Saved to Vault. The next audit run will use it.");
  }

  if (failed) {
    return (
      <Section title="Audit tokens">
        <div className={cn(card, "space-y-1")}>
          <p className={cn("text-[15px] font-semibold", label)}>Token storage isn&rsquo;t set up yet</p>
          <p className={cn("text-[13px] leading-snug", secondary)}>
            <Lines>The database function behind this card hasn&rsquo;t been applied yet. Apply migration 20261014210000_security_audit_pi_rpcs.sql, then reload.</Lines>
          </p>
        </div>
      </Section>
    );
  }
  if (!s) return null;

  const rows: { key: "vercel" | "supabase" | "cloudflare"; title: string; help: string; perms?: string[]; value: string; set: (v: string) => void; placeholder: string }[] = [
    {
      key: "vercel", title: "Vercel API token", value: vercel, set: setVercel, placeholder: "paste the Vercel token",
      help: "Lets the audit check preview protection, who is on the team, which env var names look like secrets, and whether a homepage change came with a deploy. Create it at vercel.com/account/tokens, scoped to the Bestly team. The audit only ever reads, and it asks Vercel for env var names, never their values.",
    },
    {
      key: "supabase", title: "Supabase Management API token", value: supa, set: setSupa, placeholder: "paste the Supabase token",
      help: "Lets the audit read Supabase's own security advisor for each project. Create it under Account, Access Tokens in the Supabase dashboard. If it offers scopes, tick only advisors_read and projects_read. The audit only ever reads.",
    },
    {
      key: "cloudflare", title: "Cloudflare API token", value: cf, set: setCf, placeholder: "paste the Cloudflare token",
      help: "Lets the audit look for Worker routes, how close Workers are to the free daily limit, Workers nobody owns, DNS records pointing at nothing, SSL settings, who is on the account, and other API tokens. Create it at dash.cloudflare.com under My Profile, API Tokens, Create Custom Token. It must be a user token. Tick these and nothing else, all Read.",
      perms: CF_PERMS,
    },
  ];

  return (
    <Section title="Audit tokens"
      footer="Stored in Vault under pi:vercel:api_token, pi:supabase:management_token and pi:cloudflare:api_token. Write-only: nothing typed here can be read back, by this page or anyone.">
      <div className={cn(card, "space-y-4")}>
        <div>
          <p className={cn("text-[15px] font-semibold", label)}>Three keys the nightly audit is missing</p>
          <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
            <Lines>Until a key is saved, the checks it powers show as &ldquo;Couldn&rsquo;t check&rdquo; here instead of passing. Nothing is hidden and nothing is closed by a missing key.</Lines>
          </p>
        </div>

        {rows.map((r) => {
          const t = s[r.key] ?? NOT_SAVED;
          const b = badge(t);
          const Icon = b.icon;
          return (
            <div key={r.key} className="space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <label htmlFor={`tok-${r.key}`} className={cn("text-[15px] font-semibold", label)}>{r.title}</label>
                <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap", b.tone)}>
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {b.text}
                </span>
              </div>
              <input id={`tok-${r.key}`} type="password" autoComplete="off" spellCheck={false} className={field}
                value={r.value} onChange={(e) => r.set(e.target.value)}
                placeholder={t.saved_at ? "Saved · paste a new one to replace" : r.placeholder} />
              <p className={cn("text-[13px] leading-snug", secondary)}><Lines>{r.help}</Lines></p>
              {r.perms && (
                <ul className={cn("space-y-0.5 text-[13px] leading-snug", secondary)}>
                  {r.perms.map((line) => <li key={line}><Lines>{line}</Lines></li>)}
                </ul>
              )}
              <p aria-live="polite" className={cn("text-[13px]", t.status === "rejected" ? "text-[#FF9F0A] bento:text-[#C93400]" : secondary)}>{foot(t)}</p>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={cn("inline-flex items-center gap-1.5 text-[13px]", secondary)}>
            <Lock className="h-3.5 w-3.5" aria-hidden /> Goes straight to Vault
          </p>
          <button type="button" className={btnPrimary} onClick={save} disabled={busy || (!vercel.trim() && !supa.trim() && !cf.trim())}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
            Save to Vault
          </button>
        </div>
      </div>
    </Section>
  );
}
