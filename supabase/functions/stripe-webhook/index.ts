import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  const parts = sigHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.split("=")[1];
  const signature = parts.find((p) => p.startsWith("v1="))?.split("=")[1];

  if (!timestamp || !signature) return false;

  // Reject stale webhooks (>5 minutes old) to prevent replay attacks
  const tsSeconds = parseInt(timestamp, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - tsSeconds) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expectedSig === signature;
}

// Helper to send transactional email via Edge Function
async function sendEmail(
  supabase: any,
  templateName: string,
  recipientEmail: string,
  idempotencyKey: string,
  templateData?: Record<string, any>
) {
  try {
    const { error } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName,
        recipientEmail,
        idempotencyKey,
        ...(templateData ? { templateData } : {}),
      },
    });
    if (error) {
      console.error(`Failed to send ${templateName} email:`, error);
    } else {
      console.log(`Queued ${templateName} email to ${recipientEmail}`);
    }
  } catch (err) {
    console.error(`Error sending ${templateName} email:`, err);
  }
}

function formatAmount(amountInCents: number | null | undefined): string {
  if (!amountInCents) return "—";
  return `$${(amountInCents / 100).toFixed(2)}`;
}

function formatPlanName(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = SB_SECRET;

  if (!STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing configuration");
    return new Response("Server configuration error", { status: 500 });
  }

  const body = await req.text();
  const sigHeader = req.headers.get("stripe-signature");

  if (!sigHeader) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const isValid = await verifyStripeSignature(body, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    console.error("Invalid signature");
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(body);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("Received event:", event.type);

  // Log every webhook event before processing
  const eventEmail =
    event.data?.object?.customer_email?.toLowerCase()?.trim() ||
    event.data?.object?.customer_details?.email?.toLowerCase()?.trim() ||
    null;

  // Deduplicate: skip if this Stripe event was already processed
  const { data: existingEvent } = await supabase
    .from("webhook_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existingEvent) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase.from("webhook_events").insert({
    event_type: event.type,
    stripe_event_id: event.id,
    email: eventEmail,
    payload: event,
  });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const rawEmail = session.customer_email || session.customer_details?.email;
        const email = rawEmail?.toLowerCase()?.trim();
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const mode = session.mode;

        // ─── Cloud deal payment short-circuit ─────────────────
        // Payment links created by cloud-deal-payment-link include a
        // metadata.deal_id. If present, this is a B2B cloud deployment
        // payment (deposit, final, etc.) — handle separately and bail out
        // before the Cookie Yeti subscription path runs.
        const dealIdMeta = session.metadata?.deal_id as string | undefined;
        if (dealIdMeta) {
          const { data: deal } = await supabase
            .from("cloud_deals")
            .select("id, lead_id, current_stage, deposit_paid_at, company_name, primary_contact_name, intake_token")
            .eq("id", dealIdMeta)
            .maybeSingle();

          if (!deal) {
            console.error("cloud deal payment but deal not found", dealIdMeta);
            break;
          }

          const paidAmount = `$${((session.amount_total ?? 0) / 100).toFixed(2)}`;
          const sendNtfy = async (title: string, message: string, priority: string) => {
            try {
              const ntfyToken = Deno.env.get("NTFY_TOKEN");
              const headers: Record<string, string> = {
                Title: title,
                Tags: "money-bag",
                Priority: priority,
                Click: `https://bestly.tech/admin/cloud/${deal.lead_id}`,
              };
              if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
              await fetch("https://ntfy.sh/bestly-sysalert-7q2k9mx4", { method: "POST", headers, body: message });
            } catch (ntfyErr) {
              console.error("ntfy push failed (cloud deal)", ntfyErr);
            }
          };

          if (customerId && typeof customerId === "string") {
            await supabase.from("cloud_deals").update({ stripe_customer_id: customerId }).eq("id", deal.id);
          }

          // Idempotent per deal: only the first completed payment claims deposit_paid_at.
          // The conditional update is the guard, so two different Stripe events for the
          // same deal (e.g. an old link paid twice) can't both log deposit_paid or email.
          let firstDeposit = false;
          if (!deal.deposit_paid_at) {
            const { data: claimed, error: claimErr } = await supabase
              .from("cloud_deals")
              .update({ deposit_paid_at: new Date().toISOString() })
              .eq("id", deal.id)
              .is("deposit_paid_at", null)
              .select("id");
            if (claimErr) {
              console.error("cloud_deal payment update error", claimErr);
              break;
            }
            firstDeposit = !!claimed?.length;
          }

          if (!firstDeposit) {
            // Deposit already recorded: note the extra payment for the operator, no customer email.
            await supabase.from("cloud_deal_events").insert({
              deal_id: deal.id,
              lead_id: deal.lead_id,
              event_type: "payment_received",
              event_payload: {
                deposit_already_paid: true,
                amount_total: session.amount_total,
                currency: session.currency,
                session_id: session.id,
                payment_intent: session.payment_intent,
              },
              triggered_by: "stripe-webhook",
            });
            await sendNtfy(
              `Extra payment: ${deal.company_name} (${paidAmount})`,
              "Deposit was already recorded for this deal. Check Stripe; this may need a refund.",
              "5"
            );
            console.log("Cloud deal payment after deposit already recorded", deal.id);
            break;
          }

          // Auto-advance to Stage 5 (Tech intake) only if currently <= 4
          if ((deal.current_stage ?? 0) <= 4) {
            const { error: stageErr } = await supabase
              .from("cloud_deals")
              .update({ current_stage: 5 })
              .eq("id", deal.id)
              .lte("current_stage", 4);
            if (stageErr) console.error("cloud_deal stage advance error", stageErr);
          }

          // The receipt email carries the intake link, so make sure the deal has a token.
          // Same format as the admin "Copy intake link" button (24 random bytes, 48 hex chars).
          if (!deal.intake_token) {
            const buf = new Uint8Array(24);
            crypto.getRandomValues(buf);
            const token = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
            const { error: tokErr } = await supabase
              .from("cloud_deals")
              .update({ intake_token: token })
              .eq("id", deal.id)
              .is("intake_token", null);
            if (tokErr) console.error("intake_token create error", tokErr);
          }

          await supabase.from("cloud_deal_events").insert({
            deal_id: deal.id,
            lead_id: deal.lead_id,
            event_type: "deposit_paid",
            event_payload: {
              amount_total: session.amount_total,
              currency: session.currency,
              session_id: session.id,
              payment_intent: session.payment_intent,
            },
            triggered_by: "stripe-webhook",
          });

          await sendNtfy(
            `Deposit paid: ${deal.company_name} (${paidAmount})`,
            `${deal.primary_contact_name ?? "Client"} just paid the deposit. Auto-advanced to Stage 5: Tech intake.`,
            "5"
          );

          // Customer-facing receipt + intake invitation
          const { data: dealFull } = await supabase
            .from("cloud_deals")
            .select("primary_contact_email, primary_contact_name, company_name, intake_token")
            .eq("id", deal.id)
            .single();
          if (dealFull?.primary_contact_email) {
            const intakeUrl = dealFull.intake_token
              ? `https://bestly.tech/intake/${dealFull.intake_token}`
              : null;
            const amount = session.amount_total
              ? `$${((session.amount_total as number) / 100).toFixed(2)}`
              : null;
            await sendEmail(
              supabase,
              "cloud-deposit-paid",
              dealFull.primary_contact_email,
              // One deposit email per deal, whatever Stripe event triggered it.
              `cloud-deposit-paid-${deal.id}`,
              {
                contact_name: dealFull.primary_contact_name,
                company_name: dealFull.company_name,
                amount,
                intake_url: intakeUrl,
              }
            );
          }

          console.log("Cloud deal payment processed for", deal.id);
          break;
        }
        // ─── End cloud deal handler ───────────────────────────

        if (!email) {
          console.error("No email found in session");
          break;
        }

        // Determine plan from metadata or line items
        let plan = "monthly";
        let status = "active";
        let periodEnd: string | null = null;

        if (mode === "payment") {
          plan = "lifetime";
        } else if (subscriptionId) {
          const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
          if (STRIPE_SECRET_KEY) {
            const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
              headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
            });
            const sub = await subRes.json();
            const priceId = sub.items?.data?.[0]?.price?.id;
            const monthlyPrice = Deno.env.get("STRIPE_PRICE_MONTHLY");
            const yearlyPrice = Deno.env.get("STRIPE_PRICE_YEARLY");
            if (priceId === yearlyPrice) plan = "yearly";
            else if (priceId === monthlyPrice) plan = "monthly";
            periodEnd = sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null;
          }
        }

        // CY-LIVE-01: session.metadata.plan is set authoritatively by create-checkout
        // and is mode-agnostic, so it is the source of truth for the plan label. The
        // price-ID comparison above relies on STRIPE_PRICE_* env vars (test IDs) which
        // will NOT match live price IDs, so without this a live yearly purchase would be
        // mislabeled "monthly". periodEnd is still taken from the subscription fetch above.
        const metaPlan = session.metadata?.plan;
        if (metaPlan === "monthly" || metaPlan === "yearly" || metaPlan === "lifetime") {
          plan = metaPlan;
        }

        const { error } = await supabase
          .from("subscriptions")
          .upsert(
            {
              email,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              plan,
              status,
              current_period_end: periodEnd,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "email" }
          );

        if (error) console.error("Upsert error:", error);
        else console.log("Subscription upserted for", email);

        // Send order confirmation email
        const amountTotal = session.amount_total;
        await sendEmail(supabase, "order-confirmation", email, `order-confirm-${event.id}`, {
          plan: formatPlanName(plan),
          amount: formatAmount(amountTotal),
          orderDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        });

        // Send welcome email
        await sendEmail(supabase, "welcome", email, `welcome-${event.id}`, {
          plan: formatPlanName(plan),
        });

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const subStatus = subscription.cancel_at_period_end ? "canceled" : subscription.status === "past_due" ? "past_due" : "active";
        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;

        const { error } = await supabase
          .from("subscriptions")
          .update({
            status: subStatus,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("Update error:", error);
        else console.log("Subscription updated for customer", customerId);

        // Look up email for notification
        const { data: subRecord } = await supabase
          .from("subscriptions")
          .select("email, plan")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (subRecord?.email) {
          const emailStatus = subStatus === "active" ? "renewed" : subStatus;
          const formattedPeriodEnd = periodEnd
            ? new Date(periodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
            : undefined;

          await sendEmail(supabase, "subscription-update", subRecord.email, `sub-update-${event.id}`, {
            status: emailStatus,
            plan: formatPlanName(subRecord.plan || "subscription"),
            periodEnd: formattedPeriodEnd,
          });
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        // Look up email before updating status
        const { data: subRecord } = await supabase
          .from("subscriptions")
          .select("email, plan")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        const { error } = await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("Delete error:", error);
        else console.log("Subscription canceled for customer", customerId);

        if (subRecord?.email) {
          await sendEmail(supabase, "subscription-update", subRecord.email, `sub-cancel-${event.id}`, {
            status: "canceled",
            plan: formatPlanName(subRecord.plan || "subscription"),
          });
        }

        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Webhook handler error", { status: 500 });
  }
});
