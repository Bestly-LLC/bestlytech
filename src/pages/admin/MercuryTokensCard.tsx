/**
 * Mercury tokens card on /admin/cost-cutter (Jared, 2026-10-14).
 *
 * Two write-only paste boxes: the Bestly LLC business token (Vault pi:mercury_api_token, which the live Pi jobs read)
 * and an optional Mercury Personal token (Vault pi:mercury_personal_api_token, which nothing reads yet).
 * Same pattern as SecurityTokensCard / ChargingCard: mercury_tokens_save (admin only) puts the value straight into
 * Vault; what you paste is never read back by this page or anything else. Only saved-at times and a short state note return.
 *
 * The thing that actually breaks these tokens is Mercury's IP allowlist, so the Pi's address is shown up top, copyable.
 * Migration: 20261014230000_mercury_tokens_admin.sql.
 *
 * Privacy: anything derived from the personal token belongs in bestly_private_memory, never the shared bestly_memory.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Copy, KeyRound, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Lines } from "@/components/Lines";
import { cn } from "@/lib/utils";
import { Section, btnPrimary, btnTinted, card, field, label, pill, secondary, tint } from "./laxUi";
import { rpc, shortDay, shortTime } from "./settlementsShared";

/** The Pi's public IPv4 address, as given by Jared. A home connection can change it; update here if Mercury says "not allowed from this IP". */
const PI_IPV4 = "97.189.121.182";

type State = "missing" | "saved" | "working" | "trouble";
interface One { saved_at: string | null; state: State; note: string | null; checked_at?: string | null }
interface Status { business: One; personal: One }

const hairline = "border-[#38383A] bento:border-[#C6C6C8]";
const at = (iso: string) => <span className="whitespace-nowrap">{shortDay(iso)}, {shortTime(iso)}</span>;

function badge(kind: "business" | "personal", t: One) {
  if (t.state === "trouble") return { tone: pill.orange, icon: CircleAlert, text: "Needs attention" };
  if (t.state === "working") return { tone: pill.green, icon: Check, text: "Working" };
  if (t.state === "saved") return { tone: pill.blue, icon: Check, text: "Saved" };
  return kind === "business"
    ? { tone: pill.orange, icon: CircleAlert, text: "Needed" }
    : { tone: pill.blue, icon: CircleAlert, text: "Optional" };
}

export function MercuryTokensCard() {
  const [s, setS] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [business, setBusiness] = useState("");
  const [personal, setPersonal] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await rpc<Status>("mercury_tokens_status");
    if (error || !data) { setFailed(true); return; }
    setFailed(false);
    setS(data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function copyIp() {
    try { await navigator.clipboard.writeText(PI_IPV4); toast.success("Address copied"); }
    catch { toast.error("Couldn't copy. Select the address and copy it by hand."); }
  }

  async function save() {
    setBusy(true);
    const { data, error } = await rpc<Status>("mercury_tokens_save", {
      p_business: business.trim() || null,
      p_personal: personal.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message || "Couldn't save the token."); return; }
    setBusiness("");
    setPersonal("");
    if (data) setS(data);
    toast.success("Saved to Vault.");
  }

  if (failed) {
    return (
      <Section title="Mercury tokens">
        <div className={cn(card, "space-y-1")}>
          <p className={cn("text-[15px] font-semibold", label)}>Token storage isn&rsquo;t set up yet</p>
          <p className={cn("text-[13px] leading-snug", secondary)}>
            <Lines>The database function behind this card hasn&rsquo;t been applied yet. Apply migration 20261014230000_mercury_tokens_admin.sql, then reload.</Lines>
          </p>
        </div>
      </Section>
    );
  }
  if (!s) return null;

  const rows = [
    {
      key: "business" as const, title: "Business token (Bestly LLC)", value: business, set: setBusiness, placeholder: "Paste the business Mercury token",
      help: "Read only. Penny, Bank Watch and the weekly contacts sync all use this one.",
    },
    {
      key: "personal" as const, title: "Personal token (optional)", value: personal, set: setPersonal, placeholder: "Paste the personal Mercury token",
      help: "Only works if your personal Mercury account offers API tokens. That is not confirmed, so skip this if you don't see the option. Nothing reads this token yet, so saving it does not change what Penny sees.",
    },
  ];

  return (
    <Section title="Mercury tokens"
      footer="Stored in Vault under pi:mercury_api_token and pi:mercury_personal_api_token. Write-only: nothing pasted here can be read back, by this page or anyone. Anything learned from the personal token is kept private and never goes in shared notes.">
      <div className={cn(card, "space-y-5")}>
        <div className="space-y-2">
          <p className={cn("text-[15px] font-semibold", label)}>Mercury only talks to approved addresses</p>
          <div className="flex flex-wrap items-center gap-3">
            <code className={cn("select-all rounded-[10px] px-3 py-2 font-mono text-[17px] font-semibold tabular-nums whitespace-nowrap bg-[#2C2C2E] text-[#fff] bento:bg-[#7676801f] bento:text-[#000]")}>{PI_IPV4}</code>
            <button type="button" className={btnTinted} onClick={() => void copyIp()}>
              <Copy className="h-4 w-4" aria-hidden /> Copy address
            </button>
          </div>
          <p className={cn("text-[13px] leading-snug", secondary)}>
            <Lines>Each Mercury token has a list of addresses allowed to use it, and that list has to include the address above, or Mercury turns the Pi away.</Lines>
          </p>
          <p className={cn("text-[13px] leading-snug", secondary)}>
            <Lines>Make a token in Mercury: click the company logo, then Settings, then API tokens. Choose Read only, and add the address above to its allowed addresses.</Lines>
          </p>
          <p className={cn("text-[13px] leading-snug", secondary)}>
            <Lines>The Pi has two internet addresses. The weekly contacts sync is set to use the one above. Other Mercury jobs may still go out the other one until they get the same fix.</Lines>
          </p>
        </div>

        <div className={cn("space-y-5 border-t pt-5", hairline)}>
          {rows.map((r, i) => {
            const t = s[r.key];
            const b = badge(r.key, t);
            const Icon = b.icon;
            return (
              <div key={r.key} className={cn("space-y-1.5", i > 0 && cn("border-t pt-5", hairline))}>
                <div className="flex items-start justify-between gap-3">
                  <label htmlFor={`merc-${r.key}`} className={cn("text-[15px] font-semibold", label)}>{r.title}</label>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap", b.tone)}>
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {b.text}
                  </span>
                </div>
                <input id={`merc-${r.key}`} type="password" autoComplete="off" spellCheck={false} className={field}
                  value={r.value} onChange={(e) => r.set(e.target.value)}
                  placeholder={t.saved_at ? "Saved. Paste a new one to replace it." : r.placeholder} />
                <p className={cn("text-[13px] leading-snug", secondary)}><Lines>{r.help}</Lines></p>
                <p aria-live="polite" className={cn("text-[13px] leading-snug", t.state === "trouble" ? tint.orange : secondary)}>
                  {t.saved_at && <>Saved {at(t.saved_at)}. </>}
                  {t.checked_at && t.state !== "saved" && <>Last bank run {at(t.checked_at)}. </>}
                  {t.note && <Lines>{t.note}</Lines>}
                </p>
                {t.state === "trouble" && (
                  <p className={cn("text-[13px] leading-snug", secondary)}>
                    <Lines>If it says the address isn&rsquo;t allowed, open the token in Mercury and check that the address above is on its list.</Lines>
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={cn("inline-flex items-center gap-1.5 text-[13px]", secondary)}>
            <Lock className="h-3.5 w-3.5" aria-hidden /> Goes straight to Vault
          </p>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || (!business.trim() && !personal.trim())}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
            Save to Vault
          </button>
        </div>
      </div>
    </Section>
  );
}
