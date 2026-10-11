/**
 * Settlements page parts: "Your claim details" (settlement_profile_*), "Your answers" (settlement_fact*), and the digest
 * confirm card (settlement_digest_get / settlement_digest_confirm, opened from the lock-screen notification).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, CircleAlert, FileCheck2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Section, Segmented, btnDestructivePlain, btnPlain, btnPrimary, btnTinted, card, field, label, secondary, tint } from "./laxUi";
import { ClassDefinition, DeadlineChip, Nb, count, rpc, shortDay, shortTime } from "./settlementsShared";

/* ------------------------------------------------------------------ claim details */
export type Profile = {
  full_name?: string | null; email?: string | null; phone?: string | null; street?: string | null; unit?: string | null; city?: string | null;
  state?: string | null; zip?: string | null; payout_pref?: "paypal" | "venmo" | "check" | null; paypal_email?: string | null;
  venmo_handle?: string | null; confirmed_at?: string | null;
};
const TEXT_KEYS = ["full_name", "email", "phone", "street", "unit", "city", "state", "zip", "paypal_email", "venmo_handle"] as const;
type TextKey = (typeof TEXT_KEYS)[number];

function missing(d: Profile): string[] {
  const m: string[] = [];
  if (!d.full_name?.trim()) m.push("name");
  if (!d.email?.trim()) m.push("email");
  if (!d.street?.trim() || !d.city?.trim() || !d.state?.trim() || !d.zip?.trim()) m.push("address");
  if (!d.payout_pref) m.push("how you get paid");
  else if (d.payout_pref === "paypal" && !d.paypal_email?.trim()) m.push("PayPal email");
  else if (d.payout_pref === "venmo" && !d.venmo_handle?.trim()) m.push("Venmo name");
  return m;
}

export function ProfileCard({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const confirmed = !!profile.confirmed_at;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Profile>(profile);
  const [busy, setBusy] = useState(false);
  const open = !confirmed || editing;
  const gaps = missing(draft);

  const set = (k: TextKey, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    if (gaps.length || busy) return;
    setBusy(true);
    const payload: Record<string, unknown> = { confirm: true, payout_pref: draft.payout_pref };
    TEXT_KEYS.forEach((k) => { payload[k] = draft[k] ?? ""; });
    const before = profile;
    onSaved({ ...draft, confirmed_at: new Date().toISOString() }); // optimistic
    const { data, error } = await rpc<Profile>("settlement_profile_set", { p: payload });
    setBusy(false);
    if (error) { onSaved(before); toast.error(error.message); return; }
    if (data) { onSaved(data); setDraft(data); }
    setEditing(false);
    toast.success("Saved. Nickel can use these details now.");
  };

  const line = [draft.street, draft.unit, draft.city, [draft.state, draft.zip].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join(", ");
  const payout = profile.payout_pref === "paypal" ? `PayPal ${profile.paypal_email ?? ""}` : profile.payout_pref === "venmo" ? `Venmo ${profile.venmo_handle ?? ""}` : profile.payout_pref === "check" ? "Paper check" : "Not chosen";

  return (
    <Section title="Your claim details" footer={open ? "Nickel types these into settlement forms for you. Never enter a bank or card number here. Nickel never asks for one." : undefined}>
      {!confirmed && (
        <div role="alert" className={cn(card, "flex items-start gap-2.5 ring-1 ring-[#FF9F0A66] bento:ring-[#FF950066]")}>
          <CircleAlert className={cn("mt-0.5 h-5 w-5 shrink-0", tint.orange)} aria-hidden />
          <p className={cn("text-[15px] font-medium leading-snug", label)}>Nickel can&rsquo;t file anything until you confirm these.</p>
        </div>
      )}
      {!open ? (
        <section className={card}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={cn("text-[17px] font-semibold leading-snug", label)}>{profile.full_name}</p>
              <p className={cn("mt-0.5 text-[14px] leading-snug", secondary)}>{profile.email}{profile.phone ? ` · ${profile.phone}` : ""}</p>
              <p className={cn("text-[14px] leading-snug", secondary)}>{line}</p>
              <p className={cn("mt-1 text-[14px] leading-snug", label)}>Paid by {payout}</p>
              <p className={cn("mt-1 flex items-center gap-1 text-[13px]", tint.green)}>
                <Check className="h-4 w-4" aria-hidden /> Confirmed <span className="whitespace-nowrap">{shortDay(profile.confirmed_at)}, {shortTime(profile.confirmed_at)}</span>
              </p>
            </div>
            <button type="button" className={btnPlain} onClick={() => { setDraft(profile); setEditing(true); }}><Pencil className="h-4 w-4" aria-hidden /> Edit</button>
          </div>
        </section>
      ) : (
        <section className={card}>
          <div className="space-y-3">
            <Field label="Full name" value={draft.full_name} onChange={(v) => set("full_name", v)} autoComplete="name" />
            <Field label="Email" value={draft.email} onChange={(v) => set("email", v)} autoComplete="email" inputMode="email" type="email" />
            <Field label="Phone (optional)" value={draft.phone} onChange={(v) => set("phone", v)} autoComplete="tel" inputMode="tel" type="tel" />
            <Field label="Street address" value={draft.street} onChange={(v) => set("street", v)} autoComplete="address-line1" />
            <Field label="Apt or unit (optional)" value={draft.unit} onChange={(v) => set("unit", v)} autoComplete="address-line2" />
            <div className="grid grid-cols-[1fr_5rem_7rem] gap-3">
              <Field label="City" value={draft.city} onChange={(v) => set("city", v)} autoComplete="address-level2" />
              <Field label="State" value={draft.state} onChange={(v) => set("state", v.toUpperCase().slice(0, 2))} autoComplete="address-level1" autoCapitalize="characters" />
              <Field label="ZIP" value={draft.zip} onChange={(v) => set("zip", v.replace(/[^0-9-]/g, "").slice(0, 10))} autoComplete="postal-code" inputMode="numeric" />
            </div>
            <div>
              <span className={cn("text-[13px]", secondary)}>How should you get paid?</span>
              <div className="mt-1">
                <Segmented ariaLabel="How you get paid" value={draft.payout_pref ?? ("" as "paypal")}
                  options={[{ value: "paypal", label: "PayPal" }, { value: "venmo", label: "Venmo" }, { value: "check", label: "Check" }]}
                  onChange={(v) => setDraft((d) => ({ ...d, payout_pref: v }))} />
              </div>
              <p className={cn("mt-1.5 text-[13px] leading-snug", secondary)}>
                {draft.payout_pref === "check"
                  ? "A paper check goes to the address above. It can take weeks, and Nickel can only spot it in your USPS mail scans."
                  : "PayPal or Venmo pays fastest and lets Nickel see the money arrive."}
              </p>
            </div>
            {draft.payout_pref === "paypal" && <Field label="PayPal email" value={draft.paypal_email} onChange={(v) => set("paypal_email", v)} autoComplete="email" inputMode="email" type="email" />}
            {draft.payout_pref === "venmo" && <Field label="Venmo username" value={draft.venmo_handle} onChange={(v) => set("venmo_handle", v)} autoCapitalize="none" />}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className={cn(btnPrimary, "flex-1 basis-48")} disabled={gaps.length > 0 || busy} onClick={() => void save()}>
              <Check className="h-4 w-4" aria-hidden /> These are right
            </button>
            {confirmed && <button type="button" className={btnPlain} onClick={() => { setDraft(profile); setEditing(false); }}>Cancel</button>}
          </div>
          {gaps.length > 0 && <p className={cn("mt-2 text-[13px] leading-snug", secondary)}>Still needed: {gaps.join(", ")}.</p>}
        </section>
      )}
    </Section>
  );
}

function Field({ label: text, value, onChange, ...rest }: {
  label: string; value: string | null | undefined; onChange: (v: string) => void;
  autoComplete?: string; inputMode?: "email" | "tel" | "numeric" | "text"; type?: string; autoCapitalize?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className={cn("text-[13px]", secondary)}>{text}</span>
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={cn(field, "mt-1")} spellCheck={false} {...rest} />
    </label>
  );
}

/* ------------------------------------------------------------------ your answers */
export type Fact = { key: string; question: string; answer: boolean | null; answered_at: string | null; claims_count: number };

export function FactsSection({ facts, onSet }: { facts: Fact[]; onSet: (key: string, answer: boolean | null) => void }) {
  return (
    <Section title="Your answers" footer="You can change or forget any answer. Nickel only uses what you answered here.">
      <section className={card}>
        <p className={cn("text-[15px] leading-snug", label)}>Answer once. Nickel reuses it for every matching settlement.</p>
        <ul className="mt-3 divide-y divide-[#38383A] bento:divide-[#C6C6C8]">
          {facts.map((f) => (
            <li key={f.key} className="py-3 first:pt-0 last:pb-0">
              <p className={cn("text-[16px] font-medium leading-snug", label)}>{f.question}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" aria-pressed={f.answer === true} className={cn(f.answer === true ? btnPrimary : btnTinted, "min-w-[72px]")} onClick={() => onSet(f.key, true)}>Yes</button>
                <button type="button" aria-pressed={f.answer === false} className={cn(f.answer === false ? btnPrimary : btnTinted, "min-w-[72px]")} onClick={() => onSet(f.key, false)}>No</button>
                {f.answer != null && <button type="button" className={btnDestructivePlain} onClick={() => onSet(f.key, null)}><X className="h-4 w-4" aria-hidden /> Forget</button>}
              </div>
              <p className={cn("mt-1.5 text-[13px]", secondary)}>
                {f.answer == null ? "Not answered yet. " : f.answered_at ? <>Answered <span className="whitespace-nowrap">{shortDay(f.answered_at)}</span>. </> : ""}
                {f.claims_count > 0 ? <>Used by {count(f.claims_count, "settlement")}</> : "Not used by any open settlement right now"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </Section>
  );
}

/* ------------------------------------------------------------------ digest confirm */
export type DigestClaim = { id: string; status: string; name: string; defendant: string | null; administrator: string | null; deadline: string | null;
  est_payout: string | null; class_definition: string | null; proof_required: boolean | null };
export type Digest = { id: string; sent_at: string; acted_at: string | null; action: string | null; approved_n: number | null; expired: boolean; claims: DigestClaim[] };

export function DigestCard({ digest, detailsConfirmed, busy, onConfirm }: { digest: Digest | null; detailsConfirmed: boolean; busy: boolean; onConfirm: () => void }) {
  const ready = useMemo(() => (digest?.claims ?? []).filter((c) => c.status === "ready"), [digest]);
  if (!digest) {
    return <Section title="Digest"><section className={card}><p className={cn("text-[15px]", secondary)}>That digest was not found. Everything still waiting is listed below.</p></section></Section>;
  }
  const sent = <span className="whitespace-nowrap">{shortDay(digest.sent_at)}, {shortTime(digest.sent_at)}</span>;
  return (
    <Section title="Digest from your notification">
      <section className={cn(card, "ring-1 ring-[#0A84FF66] bento:ring-[#007AFF66]")}>
        <p className={cn("text-[13px]", secondary)}>Sent {sent}</p>
        {digest.acted_at ? (
          <p className={cn("mt-2 flex items-start gap-1.5 text-[16px] font-medium leading-snug", tint.green)}>
            <Check className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span>Approved {count(digest.approved_n ?? 0, "claim")} <span className="whitespace-nowrap">{shortDay(digest.acted_at)}, {shortTime(digest.acted_at)}</span>. Nickel is filing {(digest.approved_n ?? 0) === 1 ? "it" : "them"}.</span>
          </p>
        ) : digest.expired ? (
          <p className={cn("mt-2 text-[15px] leading-snug", label)}>This digest is more than 3 days old, so its button is off. Review what is Ready below instead.</p>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-[#38383A] bento:divide-[#C6C6C8]">
              {digest.claims.map((c) => (
                <li key={c.id} className="py-3 first:pt-1">
                  <p className={cn("text-[16px] font-semibold leading-snug", label)}>{c.name}</p>
                  {(c.defendant || c.administrator) && (
                    <p className={cn("text-[13px]", secondary)}>{[c.defendant && `Against ${c.defendant}`, c.administrator && `Run by ${c.administrator}`].filter(Boolean).join(" · ")}</p>
                  )}
                  <p><DeadlineChip ymd={c.deadline} /></p>
                  {c.est_payout && <p className={cn("text-[13px]", secondary)}>Estimated payout <span className={label}><Nb text={c.est_payout} /></span></p>}
                  {c.status !== "ready" && <p className={cn("mt-0.5 text-[13px]", tint.orange)}>No longer ready, so it will be left out.</p>}
                  <ClassDefinition text={c.class_definition} />
                </li>
              ))}
            </ul>
            <button type="button" className={cn(btnPrimary, "mt-3 w-full text-[17px] sm:min-h-[44px]")} disabled={ready.length === 0 || busy} onClick={onConfirm}>
              <FileCheck2 className="h-5 w-5" aria-hidden /> Yes, file all <span className="whitespace-nowrap">({ready.length})</span>
            </button>
            <p className={cn("mt-3 text-[14px] leading-snug", label)}>Yes means you&rsquo;re swearing you&rsquo;re in each class above. Only the claims listed here are approved.</p>
            {!detailsConfirmed && <p className={cn("mt-1 text-[13px] leading-snug", tint.orange)}>Confirm your claim details below first, or Nickel will wait to file.</p>}
          </>
        )}
      </section>
    </Section>
  );
}
