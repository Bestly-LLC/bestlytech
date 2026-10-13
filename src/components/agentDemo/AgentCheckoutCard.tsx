/**
 * The checkout card under the chosen plan on /agent#pricing. Name, email, business name, optional phone, a plain read-back
 * of what they are buying, then "Pay securely", which asks the agent-checkout edge function for a Stripe Checkout page and
 * sends this browser there. Only the visitor's own tap does that: Maya fills the fields but never presses the button, and card
 * details are only ever typed on Stripe's page. The price is never sent from here, only the plan name.
 */
import { useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CallConsentNote } from "@/components/CallConsentNote";
import { supabase } from "@/integrations/supabase/client";
import { getMayaConversationId } from "@/components/maya/formBridge";
import { dollars, planById, termsLine, type AgentPlanId } from "../../../supabase/functions/_shared/agent-plans";
import { CHECKOUT_FIELD_IDS, missingFor, type CheckoutFields } from "./pricingText";

const PHONE_LINE = "(213) 641-0074";
const nw = (s: string) => <span className="whitespace-nowrap">{s}</span>;

export function AgentCheckoutCard({ plan: planId, fields, onField, onClose }: {
  plan: AgentPlanId;
  fields: CheckoutFields;
  onField: (key: keyof CheckoutFields, value: string) => void;
  onClose: () => void;
}) {
  const plan = planById(planId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terms = termsLine();

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const missing = missingFor(fields);
    if (missing.length) {
      setError(`Please add your ${missing.join(", ")}.`);
      const first = missing[0] === "name" ? CHECKOUT_FIELD_IDS.name : missing[0] === "business name" ? CHECKOUT_FIELD_IDS.company : CHECKOUT_FIELD_IDS.email;
      document.getElementById(first)?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = await supabase.functions.invoke("agent-checkout", {
        body: {
          plan: planId,
          name: fields.name.trim(),
          email: fields.email.trim(),
          company: fields.company.trim(),
          phone: fields.phone.trim() || undefined,
          conversation_id: getMayaConversationId() || undefined,
        },
      });
      const url = typeof data?.url === "string" ? data.url : "";
      let host = "";
      try { host = new URL(url).hostname; } catch { /* not a link */ }
      if (err || data?.ok === false || !/(^|\.)stripe\.com$/.test(host)) {
        setError(typeof data?.error === "string" && data.error ? data.error : `We couldn't open the payment page. Try again, or call ${PHONE_LINE}.`);
        setBusy(false);
        return;
      }
      window.location.assign(url); // the visitor's own tap, same tab
    } catch {
      setError(`We couldn't open the payment page. Try again, or call ${PHONE_LINE}.`);
      setBusy(false);
    }
  }

  return (
    <form
      id="plan-checkout"
      aria-labelledby="plan-checkout-h"
      onSubmit={pay}
      noValidate
      className="relative mx-auto w-full max-w-2xl scroll-mt-24 rounded-2xl border border-primary/30 bg-card p-6 shadow-md sm:p-8"
      data-testid="plan-checkout"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">Almost there</p>
          <h3 id="plan-checkout-h" className="mt-1 font-modern text-2xl font-semibold tracking-[-0.015em] text-foreground">Start with {plan.name}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close and pick a different plan"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <p className="mt-3 rounded-xl bg-secondary/60 px-4 py-3 text-foreground" data-testid="plan-readback">
        {plan.name}, {nw(`${dollars(plan.monthlyCents)} a month`)}, {terms.charAt(0).toLowerCase()}{terms.slice(1)}.
      </p>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor={CHECKOUT_FIELD_IDS.name}>Your name</Label>
          <Input id={CHECKOUT_FIELD_IDS.name} name="name" autoComplete="name" className="mt-1.5 h-11" value={fields.name} onChange={(e) => onField("name", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={CHECKOUT_FIELD_IDS.email}>Email</Label>
          <Input id={CHECKOUT_FIELD_IDS.email} name="email" type="email" autoComplete="email" inputMode="email" className="mt-1.5 h-11" value={fields.email} onChange={(e) => onField("email", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={CHECKOUT_FIELD_IDS.company}>Business name</Label>
          <Input id={CHECKOUT_FIELD_IDS.company} name="company" autoComplete="organization" className="mt-1.5 h-11" value={fields.company} onChange={(e) => onField("company", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={CHECKOUT_FIELD_IDS.phone}>Phone <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id={CHECKOUT_FIELD_IDS.phone} name="phone" type="tel" autoComplete="tel" inputMode="tel" className="mt-1.5 h-11" value={fields.phone} onChange={(e) => onField("phone", e.target.value)} />
        </div>
      </div>

      {fields.phone.trim() && <CallConsentNote className="mt-4" />}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" size="lg" disabled={busy} className="mt-6 min-h-[48px] w-full sm:w-auto sm:min-w-[220px]">
        {busy
          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Opening Stripe</>
          : <><Lock className="mr-2 h-4 w-4" aria-hidden="true" /> Pay securely</>}
      </Button>
      <p className="mt-3 text-sm text-muted-foreground">
        Payments are handled by Stripe. Bestly never sees your card. After you pay, you come straight back here to set up your agent.
      </p>
    </form>
  );
}
