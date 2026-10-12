/**
 * Leo texting card on the Turo settings page (Jared 2026-10-12).
 *
 * Leo can text Turo guests only after the carrier approves Bestly LLC's 10DLC registration. The carrier wants the business
 * EIN once. It is pasted here, goes straight into Vault through leo_sms_ein_put (write-only: the page can see "saved at",
 * never the value), and the filing resumes by itself. After that the hourly check does everything: files the brand and
 * campaign, assigns Leo's number, tests it to Jared's own number, and switches texting on. Status below is read-only.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Loader2, Lock, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Section, btnPrimary, card, field, label, pill, secondary, tertiary } from "./laxUi";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

interface Admin {
  mode: "off" | "owner_only" | "live"; ready: boolean; why: string | null; campaign_status: string | null; checked_at: string | null;
  ein_saved_at: string | null;
  filing: { step?: string; brand_status?: string; identity_status?: string; campaign_status?: string; error?: string; at?: string };
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const einFmt = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 9); return d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d; };

function status(a: Admin): { text: string; tone: "green" | "orange" | "gray" } {
  if (a.ready && a.mode === "live") return { text: "Texting is on", tone: "green" };
  if (a.ready && a.mode !== "off") return { text: "Approved, switching on", tone: "green" };
  switch (a.filing.step) {
    case "need_ein": return { text: "Needs the EIN", tone: "orange" };
    case "brand_rejected": case "brand_not_accepted": return { text: "Brand needs a fix", tone: "orange" };
    case "campaign_rejected": case "campaign_rejected_by_tcr": return { text: "Campaign needs a fix", tone: "orange" };
    case "brand_created": case "campaign_created": case "waiting_for_carrier": return { text: "With the carrier", tone: "gray" };
    default: return { text: a.ein_saved_at ? "Filing soon" : "Needs the EIN", tone: a.ein_saved_at ? "gray" : "orange" };
  }
}

export function LeoSmsCard() {
  const [a, setA] = useState<Admin | null>(null);
  const [ein, setEin] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await rpc("leo_sms_admin");
    if (error) { toast.error("Couldn't read the Leo texting status."); return; }
    setA(data as Admin);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    const { error } = await rpc("leo_sms_ein_put", { p_ein: ein });
    setBusy(false);
    if (error) { toast.error(error.message || "Couldn't save the EIN."); return; }
    setEin("");
    toast.success("Saved. Leo is filing the registration now.");
    setTimeout(() => { void load(); }, 4000);
    await load();
  };

  if (!a) {
    return (
      <Section title="Leo texting">
        <div className={cn(card, "flex h-24 items-center justify-center")}>
          <Loader2 className={cn("h-6 w-6 animate-spin", tertiary)} aria-label="Loading" />
        </div>
      </Section>
    );
  }
  const st = status(a);
  const f = a.filing;
  return (
    <Section
      title="Leo texting"
      id="leo-texting"
      footer={<>US carriers make every business register before it texts. Leo files Bestly LLC&rsquo;s brand and one customer-care campaign, assigns (310)&nbsp;622-7052, sends one test to your business number, then switches guest texts on. About $15 once plus a few dollars a month.</>}
    >
      <div className={cn(card, "space-y-3")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn("inline-flex items-center gap-1.5 text-[15px] font-semibold", label)}>
              <MessageSquareText className="h-4 w-4" aria-hidden /> Carrier registration
            </p>
            <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
              {f.error ? f.error : a.why ? `Waiting: ${a.why}.` : "Everything is in place."}
            </p>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold", st.tone === "green" ? pill.green : st.tone === "orange" ? pill.orange : pill.blue)}>
            {st.tone === "green" ? <Check className="h-3.5 w-3.5" aria-hidden /> : st.tone === "orange" ? <CircleAlert className="h-3.5 w-3.5" aria-hidden /> : <Loader2 className="h-3.5 w-3.5" aria-hidden />}
            {st.text}
          </span>
        </div>

        <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]", secondary)}>
          <dt>Brand</dt><dd className={label}>{f.brand_status || (a.ein_saved_at ? "Not filed yet" : "Waiting for EIN")}</dd>
          <dt>Campaign</dt><dd className={label}>{f.campaign_status || a.campaign_status || "Not filed yet"}</dd>
          <dt>Texting</dt><dd className={label}>{a.mode === "live" ? "On for guests" : a.mode === "owner_only" ? "Testing, your number only" : "Off"}</dd>
          {a.checked_at && (<><dt>Checked</dt><dd className={label}>{when(a.checked_at)}</dd></>)}
        </dl>

        <label className="block">
          <span className={cn("mb-1 block text-[13px]", secondary)}>Bestly LLC EIN</span>
          <input type="password" inputMode="numeric" autoComplete="off" className={field} value={ein}
            onChange={(e) => setEin(einFmt(e.target.value))}
            placeholder={a.ein_saved_at ? "Saved · type to replace" : "12-3456789"} />
          <span className={cn("mt-1.5 block text-[12px] leading-snug", tertiary)}>
            Paste it once. It goes straight into Vault and is never shown again. Nothing is charged until Leo files.
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={cn("inline-flex items-center gap-1.5 text-[12px]", tertiary)}>
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {a.ein_saved_at ? `EIN saved ${when(a.ein_saved_at)}` : "Nothing saved yet"}
          </p>
          <button type="button" className={btnPrimary} onClick={save} disabled={busy || ein.replace(/\D/g, "").length !== 9}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageSquareText className="h-4 w-4" aria-hidden />}
            Save to Vault
          </button>
        </div>
      </div>
    </Section>
  );
}
